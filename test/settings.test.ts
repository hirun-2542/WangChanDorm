import { SELF, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createFamily,
  signIn,
  testFamilyId,
  withAuth,
  type TestSession,
} from "./auth-helper";

interface SettingsPayload {
  dormName: string;
  ownerName: string;
  defaultWaterRate: number;
  defaultElectricRate: number;
  promptpayType: "phone" | "citizen-id";
  promptpayId: string;
  promptpayName: string;
  bankName: string;
  bankAccountNumber: string;
  bankAccountName: string;
  ownerLinkCode: string;
  ownerLineConnected: boolean;
  integrations: { lineConfigured: boolean; slipOkConfigured: boolean };
}

interface SettingsBody {
  ok: boolean;
  settings: SettingsPayload;
}

interface OwnerCodeBody {
  ok: boolean;
  ownerLinkCode: string;
}

interface ErrorBody {
  ok: boolean;
  error: { code: string; message: string; field?: string };
}

const settingsUrl = "https://dorm.test/api/settings";

const knownDefaults = {
  dormName: "หอพักวังจันทร์",
  ownerName: "สมศักดิ์ ใจดี",
  defaultWaterRate: 18,
  defaultElectricRate: 7,
  promptpayType: "phone",
  promptpayId: "081-234-5678",
  promptpayName: "สมศักดิ์ ใจดี",
} as const;

let session: TestSession;

function putSettings(
  payload: Record<string, unknown>,
  as: TestSession = session,
): Promise<Response> {
  return SELF.fetch(
    settingsUrl,
    withAuth(as, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

function regenerateOwnerCode(as: TestSession = session): Promise<Response> {
  return SELF.fetch(`${settingsUrl}/owner-code`, withAuth(as, { method: "POST" }));
}

async function readSettings(as: TestSession = session): Promise<SettingsPayload> {
  const response = await SELF.fetch(settingsUrl, withAuth(as));
  expect(response.status).toBe(200);
  return (await response.json<SettingsBody>()).settings;
}

beforeEach(async () => {
  session = await signIn();
});

beforeAll(async () => {
  const seed = await signIn();
  const response = await SELF.fetch(
    settingsUrl,
    withAuth(seed, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...knownDefaults }),
    }),
  );
  expect(response.status).toBe(200);
});

describe("dorm settings", () => {
  it("returns the API defaults with a numeric rate and no owner LINE", async () => {
    const body = await (
      await SELF.fetch(settingsUrl, withAuth(session))
    ).json<SettingsBody>();
    expect(body.ok).toBe(true);
    expect(body.settings.dormName).toBe(knownDefaults.dormName);
    expect(body.settings.ownerName).toBe(knownDefaults.ownerName);
    expect(body.settings.defaultWaterRate).toBe(knownDefaults.defaultWaterRate);
    expect(body.settings.defaultElectricRate).toBe(
      knownDefaults.defaultElectricRate,
    );
    expect(typeof body.settings.defaultWaterRate).toBe("number");
    expect(typeof body.settings.defaultElectricRate).toBe("number");
    expect(body.settings.promptpayType).toBe("phone");
    expect(body.settings.promptpayId).toBe(knownDefaults.promptpayId);
    expect(body.settings.promptpayName).toBe(knownDefaults.promptpayName);
    expect(body.settings.ownerLinkCode).toMatch(/^\d{6}$/);
    expect(body.settings.ownerLinkCode).not.toBe("000000");
    expect(body.settings.ownerLineConnected).toBe(false);
  });

  it("reports the LINE integration as configured and SlipOK as not configured", async () => {
    const settings = await readSettings();
    expect(settings.integrations.lineConfigured).toBe(true);
    expect(settings.integrations.slipOkConfigured).toBe(false);
  });

  it("writes a subset and leaves the other keys untouched", async () => {
    const before = await readSettings();

    const response = await putSettings({
      dormName: "หอพักทดสอบ",
      defaultWaterRate: 20,
      defaultElectricRate: 8,
    });
    expect(response.status).toBe(200);

    const written = await response.json<SettingsBody>();
    expect(written.ok).toBe(true);
    expect(written.settings.dormName).toBe("หอพักทดสอบ");
    expect(written.settings.defaultWaterRate).toBe(20);
    expect(written.settings.defaultElectricRate).toBe(8);

    const stored = await readSettings();
    expect(stored.dormName).toBe("หอพักทดสอบ");
    expect(stored.defaultWaterRate).toBe(20);
    expect(stored.defaultElectricRate).toBe(8);
    expect(stored.ownerName).toBe(before.ownerName);
    expect(stored.promptpayType).toBe(before.promptpayType);
    expect(stored.promptpayId).toBe(before.promptpayId);
    expect(stored.promptpayName).toBe(before.promptpayName);
    expect(stored.ownerLinkCode).toBe(before.ownerLinkCode);
  });

  it("accepts a citizen-id promptpay type and serves it back", async () => {
    const response = await putSettings({
      promptpayType: "citizen-id",
      promptpayId: "1234567890123",
    });
    expect(response.status).toBe(200);

    const stored = await readSettings();
    expect(stored.promptpayType).toBe("citizen-id");
    expect(stored.promptpayId).toBe("1234567890123");
  });

  it("validates the promptpay id against the type in the same request", async () => {
    const badPhone = await putSettings({
      promptpayType: "phone",
      promptpayId: "12345",
    });
    expect(badPhone.status).toBe(400);
    expect((await badPhone.json<ErrorBody>()).error.field).toBe("promptpayId");

    const badCitizen = await putSettings({
      promptpayType: "citizen-id",
      promptpayId: "123456789012",
    });
    expect(badCitizen.status).toBe(400);
    expect((await badCitizen.json<ErrorBody>()).error.field).toBe(
      "promptpayId",
    );

    const thirteenOnPhone = await putSettings({
      promptpayType: "phone",
      promptpayId: "1234567890123",
    });
    expect(thirteenOnPhone.status).toBe(400);
    expect((await thirteenOnPhone.json<ErrorBody>()).error.field).toBe(
      "promptpayId",
    );

    const goodCitizen = await putSettings({
      promptpayType: "citizen-id",
      promptpayId: "1234567890123",
    });
    expect(goodCitizen.status).toBe(200);
    expect(
      (await goodCitizen.json<SettingsBody>()).settings.promptpayType,
    ).toBe("citizen-id");

    const goodPhone = await putSettings({
      promptpayType: "phone",
      promptpayId: "0812345678",
    });
    expect(goodPhone.status).toBe(200);
    const stored = await readSettings();
    expect(stored.promptpayType).toBe("phone");
    expect(stored.promptpayId).toBe("0812345678");
  });

  it("rejects invalid values with 400 and a field, storing nothing", async () => {
    const before = await readSettings();

    const cases: Array<{ payload: Record<string, unknown>; field: string }> = [
      { payload: { defaultWaterRate: 0 }, field: "defaultWaterRate" },
      { payload: { defaultElectricRate: -3 }, field: "defaultElectricRate" },
      { payload: { defaultWaterRate: "18" }, field: "defaultWaterRate" },
      { payload: { dormName: "   " }, field: "dormName" },
      { payload: { promptpayType: "bank" }, field: "promptpayType" },
    ];

    for (const item of cases) {
      const response = await putSettings(item.payload);
      expect(response.status).toBe(400);

      const body = await response.json<ErrorBody>();
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("VALIDATION");
      expect(body.error.field).toBe(item.field);
      expect(body.error.message.length).toBeGreaterThan(0);
    }

    expect(await readSettings()).toEqual(before);
  });

  it("rejects an unknown key so a typo cannot silently no-op", async () => {
    const before = await readSettings();

    const response = await putSettings({ dormNam: "หอพักทดสอบ" });
    expect(response.status).toBe(400);

    const body = await response.json<ErrorBody>();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.field).toBe("dormNam");

    expect(await readSettings()).toEqual(before);
  });

  it("stores a bank account and keeps the digits only", async () => {
    const response = await putSettings({
      bankName: "ธนาคารกสิกรไทย",
      bankAccountNumber: "123-4-56789-0",
      bankAccountName: "สมศักดิ์ ใจดี",
    });
    expect(response.status).toBe(200);

    const stored = await readSettings();
    expect(stored.bankName).toBe("ธนาคารกสิกรไทย");
    expect(stored.bankAccountNumber).toBe("1234567890");
    expect(stored.bankAccountName).toBe("สมศักดิ์ ใจดี");
  });

  it("rejects a bank account number outside 10–15 digits", async () => {
    const before = await readSettings();

    const short = await putSettings({ bankAccountNumber: "12345" });
    expect(short.status).toBe(400);
    expect((await short.json<ErrorBody>()).error.field).toBe(
      "bankAccountNumber",
    );

    const long = await putSettings({ bankAccountNumber: "1234567890123456" });
    expect(long.status).toBe(400);
    expect((await long.json<ErrorBody>()).error.field).toBe(
      "bankAccountNumber",
    );

    expect(await readSettings()).toEqual(before);
  });

  it("accepts clearing promptpay once a bank account is on file", async () => {
    const cleared = await putSettings({
      promptpayId: "",
      promptpayName: "",
      bankAccountNumber: "1234567890",
    });
    expect(cleared.status).toBe(200);

    const stored = await readSettings();
    expect(stored.promptpayId).toBe("");
    expect(stored.bankAccountNumber).toBe("1234567890");

    await putSettings({
      promptpayId: "0812345678",
      promptpayName: "สมศักดิ์ ใจดี",
    });
  });

  it("refuses to leave the dorm with no way to receive money", async () => {
    const before = await readSettings();
    expect(before.promptpayId).not.toBe("");
    expect(before.bankAccountNumber).not.toBe("");

    // ล้างพร้อมเพย์และบัญชีในคำขอเดียว ต้องไม่ผ่าน เพราะไม่มีทางรับเงินเหลือ
    const response = await putSettings({
      promptpayId: "",
      bankAccountNumber: "",
    });
    expect(response.status).toBe(400);

    const body = await response.json<ErrorBody>();
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.field).toBe("promptpayId");

    expect(await readSettings()).toEqual(before);

    const rows = await env.DB.prepare(
      "SELECT key, value FROM settings WHERE family_id = ? AND key IN ('promptpay_id', 'bank_account_number')",
    )
      .bind(testFamilyId)
      .all<{ key: string; value: string }>();
    expect(new Map(rows.results.map((row) => [row.key, row.value]))).toEqual(
      new Map([
        ["promptpay_id", before.promptpayId],
        ["bank_account_number", before.bankAccountNumber],
      ]),
    );
  });

  it("refuses to clear the only remaining way to receive money", async () => {
    expect(
      (await putSettings({ promptpayId: "", bankAccountNumber: "1234567890" }))
        .status,
    ).toBe(200);

    const before = await readSettings();
    expect(before.promptpayId).toBe("");
    expect(before.bankAccountNumber).toBe("1234567890");

    const response = await putSettings({ bankAccountNumber: "" });
    expect(response.status).toBe(400);
    expect((await response.json<ErrorBody>()).error.field).toBe("promptpayId");

    expect(await readSettings()).toEqual(before);

    await putSettings({
      promptpayId: "0812345678",
      bankAccountNumber: "1234567890",
    });
  });

  it("does not count a bank account number alone as a valid payout without the bank name", async () => {
    const fresh = await signIn("owner", await createFamily("หอที่มีแต่เลขบัญชี"));

    // เลขบัญชีอย่างเดียวโดยไม่รู้ธนาคารทำให้ผู้เช่าโอนเงินไม่ได้จริง จึงต้องไม่นับ
    // ว่าเป็นช่องทางรับเงินที่ใช้ได้ แม้ยังไม่มีพร้อมเพย์เลยก็ตาม
    const bankNumberOnly = await putSettings(
      { promptpayId: "", bankAccountNumber: "1234567890" },
      fresh,
    );
    expect(bankNumberOnly.status).toBe(400);
    expect((await bankNumberOnly.json<ErrorBody>()).error.field).toBe(
      "promptpayId",
    );

    // ใส่ชื่อธนาคารมาคู่กันในคำขอเดียวกันแล้วต้องผ่าน
    const withBankName = await putSettings(
      { bankName: "ธนาคารกสิกรไทย", bankAccountNumber: "1234567890" },
      fresh,
    );
    expect(withBankName.status).toBe(200);

    const stored = await readSettings(fresh);
    expect(stored.bankName).toBe("ธนาคารกสิกรไทย");
    expect(stored.bankAccountNumber).toBe("1234567890");

    // ถอดชื่อธนาคารออกทีหลังโดยเหลือแต่เลขบัญชี ก็ต้องไม่ผ่านเช่นกัน
    const removeBankName = await putSettings({ bankName: "" }, fresh);
    expect(removeBankName.status).toBe(400);
    expect(await readSettings(fresh)).toEqual(stored);
  });

  it("still saves a dorm that has not set up any payout method yet", async () => {
    const other = await signIn("owner", await createFamily("หอที่ยังไม่ตั้งค่า"));

    const response = await putSettings(
      {
        dormName: "หอใหม่",
        promptpayId: "",
        promptpayName: "",
        bankName: "",
        bankAccountNumber: "",
        bankAccountName: "",
      },
      other,
    );
    expect(response.status).toBe(200);

    const stored = await readSettings(other);
    expect(stored.dormName).toBe("หอใหม่");
    expect(stored.promptpayId).toBe("");
    expect(stored.bankAccountNumber).toBe("");
  });

  it("keeps a way to receive money when two saves clear one method each at once", async () => {
    const both = await putSettings({
      promptpayId: "0812345678",
      promptpayName: "สมศักดิ์ ใจดี",
      bankAccountNumber: "1234567890",
    });
    expect(both.status).toBe(200);

    const [clearPromptpay, clearAccount] = await Promise.all([
      putSettings({ promptpayId: "" }),
      putSettings({ bankAccountNumber: "" }),
    ]);

    // คำขอใดจะลงก่อนก็ได้ แต่ทั้งคู่ต้องไม่ผ่านพร้อมกัน ไม่งั้นหอจะไม่มีทางรับเงิน
    expect([clearPromptpay.status, clearAccount.status].sort()).toEqual([
      200, 400,
    ]);

    const after = await readSettings();
    const methods = [after.promptpayId, after.bankAccountNumber].filter(
      (value) => value !== "",
    );
    expect(methods).toHaveLength(1);
  });

  it("reads the same owner code every time without rotating it", async () => {
    const first = await readSettings();
    expect(first.ownerLinkCode).toMatch(/^\d{6}$/);

    const second = await readSettings();
    expect(second.ownerLinkCode).toBe(first.ownerLinkCode);

    // อ่านพร้อมกันสองคำขอต้องไม่ได้รหัสคนละใบ
    const [left, right] = await Promise.all([readSettings(), readSettings()]);
    expect(left.ownerLinkCode).toBe(first.ownerLinkCode);
    expect(right.ownerLinkCode).toBe(first.ownerLinkCode);

    const expiry = await env.DB.prepare(
      "SELECT value FROM settings WHERE family_id = ? AND key = 'owner_link_code_expires_at'",
    )
      .bind(testFamilyId)
      .first<{ value: string }>();
    expect(Date.parse(expiry?.value ?? "")).toBeGreaterThan(Date.now());

    const stored = await env.DB.prepare(
      "SELECT value FROM settings WHERE family_id = ? AND key = 'owner_link_code'",
    )
      .bind(testFamilyId)
      .first<{ value: string }>();
    expect(stored?.value).toBe(first.ownerLinkCode);
  });

  it("gives a family that never opened the page one code even when read twice at once", async () => {
    const fresh = await signIn(
      "owner",
      await createFamily("หอที่ยังไม่เคยเปิดหน้าตั้งค่า"),
    );

    const [left, right] = await Promise.all([
      readSettings(fresh),
      readSettings(fresh),
    ]);

    expect(left.ownerLinkCode).toMatch(/^\d{6}$/);
    expect(right.ownerLinkCode).toBe(left.ownerLinkCode);

    const rows = await env.DB.prepare(
      "SELECT value FROM settings WHERE family_id = ? AND key = 'owner_link_code'",
    )
      .bind(fresh.familyId)
      .all<{ value: string }>();
    expect(rows.results).toEqual([{ value: left.ownerLinkCode }]);
  });

  it("keeps each family's settings to itself", async () => {
    const mine = await putSettings({
      dormName: "หอของเรา",
      promptpayId: "0812345678",
      promptpayName: "สมศักดิ์ ใจดี",
      bankAccountNumber: "",
    });
    expect(mine.status).toBe(200);

    const before = await readSettings();
    expect(before.dormName).toBe("หอของเรา");
    expect(before.promptpayId).toBe("0812345678");

    const other = await signIn("owner", await createFamily());
    const otherBefore = await readSettings(other);
    expect(otherBefore.dormName).toBe("หอพักวังจันทร์");
    expect(otherBefore.promptpayId).toBe("");
    expect(otherBefore.bankAccountNumber).toBe("");
    expect(otherBefore.ownerLinkCode).not.toBe(before.ownerLinkCode);

    const written = await putSettings(
      {
        dormName: "หอของอีกครอบครัว",
        promptpayId: "0899999999",
        bankAccountNumber: "9998887776",
      },
      other,
    );
    expect(written.status).toBe(200);

    const after = await readSettings(other);
    expect(after.dormName).toBe("หอของอีกครอบครัว");
    expect(after.bankAccountNumber).toBe("9998887776");

    // ค่าของครอบครัวเราและรหัสเชื่อมต่อต้องไม่ถูกแตะเลย
    expect(await readSettings()).toEqual(before);

    const rows = await env.DB.prepare(
      "SELECT family_id, value FROM settings WHERE key = 'dorm_name' AND family_id IN (?, ?)",
    )
      .bind(testFamilyId, other.familyId)
      .all<{ family_id: string; value: string }>();
    const dormNames = new Map(
      rows.results.map((row) => [row.family_id, row.value]),
    );
    expect(dormNames.size).toBe(2);
    expect(dormNames.get(testFamilyId)).toBe("หอของเรา");
    expect(dormNames.get(other.familyId)).toBe("หอของอีกครอบครัว");
  });

  it("regenerates the owner code and serves the new one back", async () => {
    const before = (await readSettings()).ownerLinkCode;

    const response = await regenerateOwnerCode();
    expect(response.status).toBe(200);

    const body = await response.json<OwnerCodeBody>();
    expect(body.ok).toBe(true);
    expect(body.ownerLinkCode).toMatch(/^\d{6}$/);
    expect(body.ownerLinkCode).not.toBe("000000");
    expect(body.ownerLinkCode).not.toBe(before);

    const after = (await readSettings()).ownerLinkCode;
    expect(after).toBe(body.ownerLinkCode);
  });

  it("issues two different owner codes in a row and reports the latest", async () => {
    const first = await (await regenerateOwnerCode()).json<OwnerCodeBody>();
    const second = await (await regenerateOwnerCode()).json<OwnerCodeBody>();

    expect(first.ownerLinkCode).toMatch(/^\d{6}$/);
    expect(second.ownerLinkCode).toMatch(/^\d{6}$/);
    expect(second.ownerLinkCode).not.toBe(first.ownerLinkCode);

    const latest = (await readSettings()).ownerLinkCode;
    expect(latest).toBe(second.ownerLinkCode);
  });

  it("rotates only the calling family's owner code", async () => {
    const other = await signIn("owner", await createFamily());
    const mine = await readSettings();
    const theirs = await readSettings(other);

    const rotated = await (await regenerateOwnerCode(other)).json<OwnerCodeBody>();
    expect(rotated.ownerLinkCode).not.toBe(theirs.ownerLinkCode);
    expect((await readSettings(other)).ownerLinkCode).toBe(
      rotated.ownerLinkCode,
    );
    expect((await readSettings()).ownerLinkCode).toBe(mine.ownerLinkCode);
  });
});
