import { Hono } from "hono";
import { errorBody, readJsonObject, upsertSettingSql } from "./shared";

const settings = new Hono<{ Bindings: Env }>();

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
  promptpay_id: "081-234-5678",
  promptpay_name: "สมศักดิ์ ใจดี",
} as const;

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
};

const textMessages: Record<"dormName" | "ownerName" | "promptpayId" | "promptpayName", string> = {
  dormName: "กรุณากรอกชื่อหอ",
  ownerName: "กรุณากรอกชื่อเจ้าของ",
  promptpayId: "กรุณากรอกพร้อมเพย์ไอดี",
  promptpayName: "กรุณากรอกชื่อบัญชีรับเงิน",
};

const rateMessages: Record<"defaultWaterRate" | "defaultElectricRate", string> = {
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

  console.error(JSON.stringify({ message: "invalid stored setting", key, value }));
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
    return digits.length === 9 || digits.length === 10 ? null : "พร้อมเพย์ไอดีประเภทเบอร์โทรต้องเป็นเบอร์ 9 หรือ 10 หลัก";
  }

  return digits.length === 13 ? null : "พร้อมเพย์ไอดีประเภทเลขบัตรต้องเป็นเลข 13 หลัก";
}

function normalizeOwnerPhone(value: string): string {
  return value.replace(/[\s-]/g, "");
}

function ownerPhoneError(value: string): string | null {
  return /^0\d{9}$/.test(normalizeOwnerPhone(value)) ? null : "เบอร์โทรเจ้าของต้องเป็นเบอร์ 10 หลัก เริ่มด้วย 0";
}

async function readOwnerCode(env: Env, stored: Map<string, string>): Promise<string> {
  const existing = stored.get("owner_link_code");

  if (existing !== undefined && existing !== "") {
    return existing;
  }

  const code = generateOwnerCode();

  await env.DB.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES ('owner_link_code', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  )
    .bind(code)
    .run();

  return code;
}

async function loadSettings(env: Env): Promise<SettingsPayload> {
  const result = await env.DB.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  const stored = new Map(result.results.map((row) => [row.key, row.value]));
  const valueOf = (key: SettingsKey): string => stored.get(key) ?? defaultSettings[key];
  const ownerLineUserId = stored.get("owner_line_user_id") ?? "";
  const promptpayType = valueOf("promptpay_type") === "citizen-id" ? "citizen-id" : "phone";

  return {
    dormName: valueOf("dorm_name"),
    ownerName: valueOf("owner_name"),
    ownerPhone: valueOf("owner_phone"),
    defaultWaterRate: toNumber("default_water_rate", valueOf("default_water_rate"), Number(defaultSettings.default_water_rate)),
    defaultElectricRate: toNumber("default_electric_rate", valueOf("default_electric_rate"), Number(defaultSettings.default_electric_rate)),
    promptpayType,
    promptpayId: valueOf("promptpay_id"),
    promptpayName: valueOf("promptpay_name"),
    ownerLinkCode: await readOwnerCode(env, stored),
    ownerLineConnected: ownerLineUserId !== "",
    integrations: {
      lineConfigured: isConfigured(env.LINE_CHANNEL_ACCESS_TOKEN),
      slipOkConfigured: isConfigured(env.SLIPOK_API_KEY) && isConfigured(env.SLIPOK_BRANCH_ID),
    },
  };
}

settings.get("/", async (c) => {
  try {
    const payload = await loadSettings(c.env);
    return c.json({ ok: true, settings: payload }, 200);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ message: "load settings failed", error: detail }));
    return c.json(errorBody("INTERNAL", "โหลดการตั้งค่าไม่สำเร็จ"), 500);
  }
});

settings.put("/", async (c) => {
  const body = await readJsonObject(c.req.raw);

  if (body === null) {
    return c.json(errorBody("VALIDATION", "รูปแบบข้อมูลไม่ถูกต้อง"), 400);
  }

  try {
    const rawType = body.promptpayType;

    if ("promptpayType" in body && rawType !== "phone" && rawType !== "citizen-id") {
      return c.json(errorBody("VALIDATION", "ประเภทพร้อมเพย์ต้องเป็น phone หรือ citizen-id", "promptpayType"), 400);
    }

    const storedTypeRow = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'promptpay_type'").first<{ value: string }>();
    const storedType: PromptpayType = storedTypeRow?.value === "citizen-id" ? "citizen-id" : "phone";
    const effectiveType: PromptpayType = rawType === "phone" || rawType === "citizen-id" ? rawType : storedType;
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

      if (key === "dormName" || key === "ownerName" || key === "promptpayId" || key === "promptpayName") {
        const text = typeof value === "string" ? value.trim() : "";

        if (text === "") {
          return c.json(errorBody("VALIDATION", textMessages[key], key), 400);
        }

        if (key === "promptpayId") {
          const message = promptpayIdError(text, effectiveType);

          if (message !== null) {
            return c.json(errorBody("VALIDATION", message, key), 400);
          }
        }

        updates.set(target, text);
        continue;
      }

      if (key === "defaultWaterRate" || key === "defaultElectricRate") {
        if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
          return c.json(errorBody("VALIDATION", rateMessages[key], key), 400);
        }

        updates.set(target, String(value));
        continue;
      }

      if (value !== "phone" && value !== "citizen-id") {
        return c.json(errorBody("VALIDATION", "ประเภทพร้อมเพย์ต้องเป็น phone หรือ citizen-id", key), 400);
      }

      updates.set(target, value);
    }

    if (updates.size > 0) {
      await c.env.DB.batch(
        [...updates].map(([key, value]) => c.env.DB.prepare(upsertSettingSql).bind(key, value)),
      );
    }

    const payload = await loadSettings(c.env);
    return c.json({ ok: true, settings: payload }, 200);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ message: "save settings failed", error: detail }));
    return c.json(errorBody("INTERNAL", "บันทึกการตั้งค่าไม่สำเร็จ"), 500);
  }
});

settings.post("/owner-code", async (c) => {
  try {
    const currentRow = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'owner_link_code'").first<{ value: string }>();
    const current = currentRow?.value ?? "";
    let code = generateOwnerCode();

    for (let attempt = 0; attempt < 20 && code === current; attempt += 1) {
      code = generateOwnerCode();
    }

    await c.env.DB.prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES ('owner_link_code', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
      .bind(code)
      .run();

    return c.json({ ok: true, ownerLinkCode: code }, 200);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ message: "regenerate owner code failed", error: detail }));
    return c.json(errorBody("INTERNAL", "ออกรหัสเชื่อมต่อใหม่ไม่สำเร็จ"), 500);
  }
});

export default settings;
