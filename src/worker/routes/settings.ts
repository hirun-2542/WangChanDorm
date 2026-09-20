import { Hono } from "hono";
import type { AppEnv } from "../lib/auth";
import { familyId } from "../lib/auth";
import {
  loadDormCharges,
  maxDormCharges,
  parseChargeList,
  replaceDormCharges,
} from "../lib/charges";
import { errorBody, readJsonObject, upsertSettingSql } from "./shared";

const settings = new Hono<AppEnv>();

type PromptpayType = "phone" | "citizen-id";

export const defaultWaterRate = 18;
export const defaultElectricRate = 7;

const defaultSettings = {
  dorm_name: "หอพักวังจันทร์",
  owner_name: "สมศักดิ์ ใจดี",
  owner_phone: "",
  default_water_rate: String(defaultWaterRate),
  default_electric_rate: String(defaultElectricRate),
  promptpay_type: "phone",
  // ค่าเริ่มต้นของช่องทางรับเงินต้องว่าง เพื่อให้ "ยังไม่ได้ตั้งค่า" แทนได้จริง
  // และตรงกับที่เส้นทางใบแจ้งหนี้อ่าน (อ่านจากฐานข้อมูลเท่านั้น ไม่ใส่ค่าแทน)
  promptpay_id: "",
  promptpay_name: "",
  bank_name: "",
  bank_account_number: "",
  bank_account_name: "",
} as const;

/** คีย์ที่บอกว่าหอนี้รับเงินทางไหนได้บ้าง — bank_name ต้องมาคู่ bank_account_number เสมอ */
const payoutKeys = ["promptpay_id", "bank_name", "bank_account_number"] as const;

/** รหัสเชื่อม LINE ของเจ้าของ: หมดอายุใน 15 นาที และใช้ได้ครั้งเดียว */
const ownerCodeKey = "owner_link_code";
const ownerCodeExpiresKey = "owner_link_code_expires_at";
const ownerCodeTtlMs = 15 * 60 * 1000;

const noPayoutMessage =
  "ต้องมีพร้อมเพย์ หรือทั้งชื่อธนาคารและเลขบัญชีธนาคารคู่กันอย่างน้อยหนึ่งช่องทาง เพื่อให้ผู้เช่ารู้ว่าจะโอนไปที่ไหน";

/**
 * กันไม่ให้คำขอเดียวลบวิธีรับเงินทางสุดท้ายออกไป
 *
 * ต้องเช็คในทรานแซกชันเดียวกับการเขียน เพราะอ่านก่อนแล้วค่อยเขียนเปิดช่องให้
 * PUT สองคำขอที่มาพร้อมกันผ่านการตรวจทั้งคู่ แล้วหอเหลือศูนย์วิธีรับเงิน
 * (ใบแจ้งหนี้ทุกใบจะไม่มีคิวอาร์ให้โอน) แถวนี้จะถูก INSERT ก็ต่อเมื่อตอนนั้น
 * ไม่เหลือวิธีรับเงินแล้ว และค่า NULL จะชน NOT NULL ของ settings.value
 * ทำให้ทั้ง batch ถูกยกเลิกไปพร้อมกัน
 *
 * บัญชีธนาคารนับว่า "ใช้ได้" เฉพาะเมื่อมีทั้งชื่อธนาคารและเลขบัญชีครบคู่
 * เลขบัญชีอย่างเดียวโดยไม่รู้ธนาคารทำให้ผู้เช่าโอนเงินไม่ได้จริง
 */
const payoutGuardSql = `INSERT INTO settings (family_id, key, value, updated_at) SELECT ?, 'payout_guard', NULL, datetime('now') WHERE NOT EXISTS (SELECT 1 FROM settings WHERE family_id = ? AND key = 'promptpay_id' AND trim(value) <> '') AND NOT (EXISTS (SELECT 1 FROM settings WHERE family_id = ? AND key = 'bank_name' AND trim(value) <> '') AND EXISTS (SELECT 1 FROM settings WHERE family_id = ? AND key = 'bank_account_number' AND trim(value) <> ''))`;


type SettingsKey = keyof typeof defaultSettings;

const writableKeys = [
  "dormName",
  "ownerName",
  "ownerPhone",
  "defaultWaterRate",
  "defaultElectricRate",
  "promptpayType",
  "promptpayId",
  "promptpayName",
  "bankName",
  "bankAccountNumber",
  "bankAccountName",
] as const;

type WritableKey = (typeof writableKeys)[number];

const fieldToKey: Record<WritableKey, SettingsKey> = {
  dormName: "dorm_name",
  ownerName: "owner_name",
  ownerPhone: "owner_phone",
  defaultWaterRate: "default_water_rate",
  defaultElectricRate: "default_electric_rate",
  promptpayType: "promptpay_type",
  promptpayId: "promptpay_id",
  promptpayName: "promptpay_name",
  bankName: "bank_name",
  bankAccountNumber: "bank_account_number",
  bankAccountName: "bank_account_name",
};

const textMessages: Record<"dormName" | "ownerName", string> = {
  dormName: "กรุณากรอกชื่อหอ",
  ownerName: "กรุณากรอกชื่อเจ้าของ",
};

const rateMessages: Record<"defaultWaterRate" | "defaultElectricRate", string> =
  {
    defaultWaterRate: "อัตราค่าน้ำต้องเป็นตัวเลขมากกว่า 0",
    defaultElectricRate: "อัตราค่าไฟต้องเป็นตัวเลขมากกว่า 0",
  };

interface SettingsPayload {
  dormName: string;
  ownerName: string;
  ownerPhone: string;
  defaultWaterRate: number;
  defaultElectricRate: number;
  promptpayType: PromptpayType;
  promptpayId: string;
  promptpayName: string;
  bankName: string;
  bankAccountNumber: string;
  bankAccountName: string;
  ownerLinkCode: string;
  ownerLineConnected: boolean;
  integrations: { lineConfigured: boolean; slipOkConfigured: boolean };
}

function isWritableKey(key: string): key is WritableKey {
  return (writableKeys as readonly string[]).includes(key);
}

function isConfigured(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== "";
}

function toNumber(key: SettingsKey, value: string, fallback: number): number {
  const parsed = Number(value);

  if (Number.isFinite(parsed)) {
    return parsed;
  }

  console.error(
    JSON.stringify({ message: "invalid stored setting", key, value }),
  );
  return fallback;
}

function generateOwnerCode(): string {
  const digits = new Uint32Array(1);
  let code = "000000";

  while (code === "000000") {
    crypto.getRandomValues(digits);
    code = String((digits[0] ?? 0) % 1000000).padStart(6, "0");
  }

  return code;
}

function promptpayIdError(id: string, type: PromptpayType): string | null {
  const digits = id.replace(/\D/g, "");

  if (type === "phone") {
    return digits.length === 9 || digits.length === 10
      ? null
      : "พร้อมเพย์ไอดีประเภทเบอร์โทรต้องเป็นเบอร์ 9 หรือ 10 หลัก";
  }

  return digits.length === 13
    ? null
    : "พร้อมเพย์ไอดีประเภทเลขบัตรต้องเป็นเลข 13 หลัก";
}

function normalizeOwnerPhone(value: string): string {
  return value.replace(/[\s-]/g, "");
}

function ownerPhoneError(value: string): string | null {
  return /^0\d{9}$/.test(normalizeOwnerPhone(value))
    ? null
    : "เบอร์โทรเจ้าของต้องเป็นเบอร์ 10 หลัก เริ่มด้วย 0";
}

/** เลขบัญชีธนาคารไทย 10–15 หลัก — เก็บเฉพาะตัวเลข ไม่เก็บขีดคั่น */
function normalizeAccountNumber(value: string): string {
  return value.replace(/\D/g, "");
}

function accountNumberError(value: string): string | null {
  const digits = normalizeAccountNumber(value);

  if (digits.length < 10 || digits.length > 15) {
    return "เลขบัญชีต้องเป็นตัวเลข 10–15 หลัก";
  }

  return null;
}

function ownerCodeExpiry(): string {
  return new Date(Date.now() + ownerCodeTtlMs).toISOString();
}

/** รหัสที่ยังใช้ได้เท่านั้น — รหัสที่หมดอายุหรือถูกใช้ไปแล้วอ่านกลับมาไม่ได้ */
function ownerCodeFrom(stored: Map<string, string>): string {
  const code = stored.get(ownerCodeKey) ?? "";
  const expires = Date.parse(stored.get(ownerCodeExpiresKey) ?? "");

  if (code !== "" && Number.isFinite(expires) && expires > Date.now()) {
    return code;
  }

  return "";
}

/**
 * ออกรหัสให้ครอบครัวที่ยังไม่มีรหัสที่ใช้ได้ หรือรหัสเดิมหมดอายุไปแล้ว
 *
 * เขียนแบบมีเงื่อนไขในคำสั่งเดียว (ไม่ใช่ ON CONFLICT DO NOTHING เฉย ๆ) เพราะ
 * ถ้ารหัสเดิมมีแถวอยู่แล้วแต่หมดอายุ DO NOTHING จะข้ามไปเฉย ๆ แล้วอ่านรหัส
 * เก่าที่หมดอายุกลับมาเสิร์ฟซ้ำตลอดไป ไม่มีทางได้รหัสใหม่จาก GET อีกเลย
 * เงื่อนไขคือ "แทนที่ได้ก็ต่อเมื่อยังไม่มีรหัสที่ใช้ได้จริงตอนนี้" ประเมินจาก
 * แถวเดิมก่อนเขียนเสมอ (มาตรฐาน SQL UPDATE/UPSERT ... WHERE) ทั้งสองคำสั่ง
 * (code, expiry) ใช้เงื่อนไขเดียวกันที่อ้างอิงแถว expiry เดิม จึงลง/ไม่ลงพร้อมกัน
 */
async function ensureOwnerCode(db: D1Database, family: string): Promise<string> {
  const stillValidSql = `NOT EXISTS (SELECT 1 FROM settings WHERE family_id = ? AND key = ? AND value <> '' AND datetime(value) > datetime('now'))`;
  const upsertIfExpired = `INSERT INTO settings (family_id, key, value, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(family_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at WHERE ${stillValidSql}`;
  const code = generateOwnerCode();

  const results = await db.batch<{ value: string }>([
    db.prepare(upsertIfExpired).bind(family, ownerCodeKey, code, family, ownerCodeExpiresKey),
    db.prepare(upsertIfExpired).bind(family, ownerCodeExpiresKey, ownerCodeExpiry(), family, ownerCodeExpiresKey),
    db
      .prepare("SELECT value FROM settings WHERE family_id = ? AND key = ?")
      .bind(family, ownerCodeKey),
  ]);

  return results[2]?.results[0]?.value ?? code;
}

async function loadSettings(env: Env, family: string): Promise<SettingsPayload> {
  const result = await env.DB.prepare(
    "SELECT key, value FROM settings WHERE family_id = ?",
  )
    .bind(family)
    .all<{ key: string; value: string }>();
  const stored = new Map(result.results.map((row) => [row.key, row.value]));
  const valueOf = (key: SettingsKey): string =>
    stored.get(key) ?? defaultSettings[key];
  const ownerLineUserId = stored.get("owner_line_user_id") ?? "";
  const ownerLineConnected = ownerLineUserId !== "";
  const promptpayType =
    valueOf("promptpay_type") === "citizen-id" ? "citizen-id" : "phone";

  // GET ต้องไม่หมุนรหัส: ส่งรหัสที่ยังใช้ได้กลับไปเสมอ ถ้าไม่มีรหัสที่ใช้ได้
  // และยังไม่ได้ผูก LINE จึงออกรหัสใหม่ให้ครั้งเดียว ถ้าผูกแล้วต้องกดออกรหัสใหม่
  // (POST /api/settings/owner-code) เท่านั้น จึงจะได้รหัสอีก
  let ownerLinkCode = ownerCodeFrom(stored);

  if (ownerLinkCode === "" && !ownerLineConnected) {
    ownerLinkCode = await ensureOwnerCode(env.DB, family);
  }

  return {
    dormName: valueOf("dorm_name"),
    ownerName: valueOf("owner_name"),
    ownerPhone: valueOf("owner_phone"),
    defaultWaterRate: toNumber(
      "default_water_rate",
      valueOf("default_water_rate"),
      Number(defaultSettings.default_water_rate),
    ),
    defaultElectricRate: toNumber(
      "default_electric_rate",
      valueOf("default_electric_rate"),
      Number(defaultSettings.default_electric_rate),
    ),
    promptpayType,
    promptpayId: valueOf("promptpay_id"),
    promptpayName: valueOf("promptpay_name"),
    bankName: valueOf("bank_name"),
    bankAccountNumber: valueOf("bank_account_number"),
    bankAccountName: valueOf("bank_account_name"),
    ownerLinkCode,
    ownerLineConnected,
    integrations: {
      lineConfigured: isConfigured(env.LINE_CHANNEL_ACCESS_TOKEN),
      slipOkConfigured:
        isConfigured(env.SLIPOK_API_KEY) && isConfigured(env.SLIPOK_BRANCH_ID),
    },
  };
}

settings.get("/", async (c) => {
  try {
    const payload = await loadSettings(c.env, familyId(c));
    return c.json({ ok: true, settings: payload }, 200);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({ message: "load settings failed", error: detail }),
    );
    return c.json(errorBody("INTERNAL", "โหลดการตั้งค่าไม่สำเร็จ"), 500);
  }
});

settings.put("/", async (c) => {
  const body = await readJsonObject(c.req.raw);

  if (body === null) {
    return c.json(errorBody("VALIDATION", "รูปแบบข้อมูลไม่ถูกต้อง"), 400);
  }

  try {
    const family = familyId(c);
    const rawType = body.promptpayType;

    if (
      "promptpayType" in body &&
      rawType !== "phone" &&
      rawType !== "citizen-id"
    ) {
      return c.json(
        errorBody(
          "VALIDATION",
          "ประเภทพร้อมเพย์ต้องเป็น phone หรือ citizen-id",
          "promptpayType",
        ),
        400,
      );
    }

    const storedTypeRow = await c.env.DB.prepare(
      "SELECT value FROM settings WHERE family_id = ? AND key = 'promptpay_type'",
    )
      .bind(family)
      .first<{ value: string }>();
    const storedType: PromptpayType =
      storedTypeRow?.value === "citizen-id" ? "citizen-id" : "phone";
    const effectiveType: PromptpayType =
      rawType === "phone" || rawType === "citizen-id" ? rawType : storedType;
    const updates = new Map<SettingsKey, string>();

    for (const key of Object.keys(body)) {
      if (!isWritableKey(key)) {
        return c.json(errorBody("VALIDATION", "ไม่รู้จักฟิลด์นี้", key), 400);
      }

      const value = body[key];
      const target = fieldToKey[key];

      if (key === "ownerPhone") {
        const raw = typeof value === "string" ? value.trim() : "";
        const message = raw === "" ? null : ownerPhoneError(raw);

        if (message !== null) {
          return c.json(errorBody("VALIDATION", message, key), 400);
        }

        updates.set(target, normalizeOwnerPhone(raw));
        continue;
      }

      if (
        key === "dormName" ||
        key === "ownerName" ||
        key === "promptpayId" ||
        key === "promptpayName" ||
        key === "bankName" ||
        key === "bankAccountName" ||
        key === "bankAccountNumber"
      ) {
        const text = typeof value === "string" ? value.trim() : "";

        if (key === "dormName" || key === "ownerName") {
          if (text === "") {
            return c.json(errorBody("VALIDATION", textMessages[key], key), 400);
          }

          updates.set(target, text);
          continue;
        }

        if (key === "promptpayId" && text !== "") {
          const message = promptpayIdError(text, effectiveType);

          if (message !== null) {
            return c.json(errorBody("VALIDATION", message, key), 400);
          }
        }

        if (key === "bankAccountNumber") {
          const message = text === "" ? null : accountNumberError(text);

          if (message !== null) {
            return c.json(errorBody("VALIDATION", message, key), 400);
          }

          updates.set(target, normalizeAccountNumber(text));
          continue;
        }

        updates.set(target, text);
        continue;
      }

      if (key === "defaultWaterRate" || key === "defaultElectricRate") {
        if (
          typeof value !== "number" ||
          !Number.isFinite(value) ||
          value <= 0
        ) {
          return c.json(errorBody("VALIDATION", rateMessages[key], key), 400);
        }

        updates.set(target, String(value));
        continue;
      }

      if (value !== "phone" && value !== "citizen-id") {
        return c.json(
          errorBody(
            "VALIDATION",
            "ประเภทพร้อมเพย์ต้องเป็น phone หรือ citizen-id",
            key,
          ),
          400,
        );
      }

      updates.set(target, value);
    }

    if (updates.size > 0) {
      const storedRow = await c.env.DB.prepare(
        "SELECT key, value FROM settings WHERE family_id = ?",
      )
        .bind(family)
        .all<{ key: string; value: string }>();
      const stored = new Map(
        storedRow.results.map((row) => [row.key, row.value]),
      );

      // ส่งค่าว่างทับช่องทางรับเงินที่ว่างอยู่แล้วไม่ใช่การลบวิธีรับเงิน
      // (และเป็นเรื่องปกติของการบันทึกฟอร์มทั้งใบของหอที่ยังไม่ได้ตั้งค่า)
      // ค่าที่เทียบคือค่าที่เก็บจริงเท่านั้น ค่าเริ่มต้นของช่องทางรับเงินว่างอยู่แล้ว
      for (const key of payoutKeys) {
        if (updates.get(key) === "" && !isConfigured(stored.get(key))) {
          updates.delete(key);
        }
      }

      if (updates.size > 0) {
        const statements = [...updates].map(([key, value]) =>
          c.env.DB.prepare(upsertSettingSql).bind(family, key, value),
        );
        const touchesPayout = payoutKeys.some((key) => updates.has(key));

        if (touchesPayout) {
          statements.push(
            c.env.DB.prepare(payoutGuardSql).bind(family, family, family, family),
          );
        }

        try {
          await c.env.DB.batch(statements);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);

          // คำขอที่แตะช่องทางรับเงินจะพ่วงแถวกันที่เขียนด้วยค่า NULL ไว้เสมอ
          // จึงพังที่ NOT NULL ของ settings.value เมื่อตอนเขียนจริงไม่เหลือ
          // วิธีรับเงินแล้ว ส่วนการเขียนค่าอื่นใน batch นี้เป็น NULL ไม่ได้
          // ถ้าข้อความไม่ตรง แปลว่าเป็นข้อผิดพลาดอื่นจริง ๆ
          if (
            !touchesPayout ||
            !detail.includes("NOT NULL constraint failed") ||
            !detail.includes("settings.value")
          ) {
            throw error;
          }

          return c.json(
            errorBody("VALIDATION", noPayoutMessage, "promptpayId"),
            400,
          );
        }
      }
    }

    const payload = await loadSettings(c.env, family);
    return c.json({ ok: true, settings: payload }, 200);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({ message: "save settings failed", error: detail }),
    );
    return c.json(errorBody("INTERNAL", "บันทึกการตั้งค่าไม่สำเร็จ"), 500);
  }
});

settings.post("/owner-code", async (c) => {
  const family = familyId(c);

  try {
    const currentRow = await c.env.DB.prepare(
      "SELECT value FROM settings WHERE family_id = ? AND key = ?",
    )
      .bind(family, ownerCodeKey)
      .first<{ value: string }>();
    const current = currentRow?.value ?? "";
    let code = generateOwnerCode();

    for (let attempt = 0; attempt < 20 && code === current; attempt += 1) {
      code = generateOwnerCode();
    }

    // รหัสกับเวลาหมดอายุต้องถูกเขียนพร้อมกันเสมอ ไม่งั้นจะเหลือรหัสที่ไม่มีวันหมดอายุ
    await c.env.DB.batch([
      c.env.DB.prepare(upsertSettingSql).bind(family, ownerCodeKey, code),
      c.env.DB.prepare(upsertSettingSql).bind(
        family,
        ownerCodeExpiresKey,
        ownerCodeExpiry(),
      ),
    ]);

    return c.json({ ok: true, ownerLinkCode: code }, 200);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({
        message: "regenerate owner code failed",
        error: detail,
      }),
    );
    return c.json(errorBody("INTERNAL", "ออกรหัสเชื่อมต่อใหม่ไม่สำเร็จ"), 500);
  }
});

settings.get("/charges", async (c) => {
  try {
    const charges = await loadDormCharges(c.env, familyId(c));
    return c.json(
      {
        ok: true,
        charges: charges.map((charge) => ({
          id: charge.id,
          name: charge.name,
          amount: charge.amount,
        })),
      },
      200,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({ message: "load dorm charges failed", error: detail }),
    );
    return c.json(errorBody("INTERNAL", "โหลดค่าใช้จ่ายของหอไม่สำเร็จ"), 500);
  }
});

settings.put("/charges", async (c) => {
  const body = await readJsonObject(c.req.raw);

  if (body === null) {
    return c.json(errorBody("VALIDATION", "รูปแบบข้อมูลไม่ถูกต้อง"), 400);
  }

  const parsed = parseChargeList(body.charges, maxDormCharges);

  if (parsed === null) {
    return c.json(
      errorBody(
        "VALIDATION",
        "ค่าใช้จ่ายของหอต้องมีชื่อและจำนวนเงินเป็นจำนวนเต็มไม่ติดลบ ไม่เกิน 20 รายการ",
        "charges",
      ),
      400,
    );
  }

  try {
    const saved = await replaceDormCharges(c.env, familyId(c), parsed);

    if (saved === null) {
      return c.json(
        errorBody(
          "VALIDATION",
          "มีรายการที่อ้างถึงไม่พบ หรืออ้างซ้ำ",
          "charges",
        ),
        400,
      );
    }

    return c.json(
      {
        ok: true,
        charges: saved.map((charge) => ({
          id: charge.id,
          name: charge.name,
          amount: charge.amount,
        })),
      },
      200,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({ message: "save dorm charges failed", error: detail }),
    );
    return c.json(errorBody("INTERNAL", "บันทึกค่าใช้จ่ายของหอไม่สำเร็จ"), 500);
  }
});

export default settings;
