import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

interface SettingsPayload {
  dormName: string;
  ownerName: string;
  defaultWaterRate: number;
  defaultElectricRate: number;
  promptpayType: "phone" | "citizen-id";
  promptpayId: string;
  promptpayName: string;
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

function putSettings(payload: Record<string, unknown>): Promise<Response> {
  return SELF.fetch(settingsUrl, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function regenerateOwnerCode(): Promise<Response> {
  return SELF.fetch(`${settingsUrl}/owner-code`, { method: "POST" });
}

async function readSettings(): Promise<SettingsPayload> {
  const response = await SELF.fetch(settingsUrl);
  expect(response.status).toBe(200);
  return (await response.json<SettingsBody>()).settings;
}

beforeAll(async () => {
  const response = await putSettings({ ...knownDefaults });
  expect(response.status).toBe(200);
});

describe("dorm settings", () => {
  it("returns the API defaults with a numeric rate and no owner LINE", async () => {
    const body = await (await SELF.fetch(settingsUrl)).json<SettingsBody>();
    expect(body.ok).toBe(true);
    expect(body.settings.dormName).toBe(knownDefaults.dormName);
    expect(body.settings.ownerName).toBe(knownDefaults.ownerName);
    expect(body.settings.defaultWaterRate).toBe(knownDefaults.defaultWaterRate);
    expect(body.settings.defaultElectricRate).toBe(knownDefaults.defaultElectricRate);
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

    const response = await putSettings({ dormName: "หอพักทดสอบ", defaultWaterRate: 20, defaultElectricRate: 8 });
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
    const response = await putSettings({ promptpayType: "citizen-id", promptpayId: "1234567890123" });
    expect(response.status).toBe(200);

    const stored = await readSettings();
    expect(stored.promptpayType).toBe("citizen-id");
    expect(stored.promptpayId).toBe("1234567890123");
  });

  it("validates the promptpay id against the type in the same request", async () => {
    const badPhone = await putSettings({ promptpayType: "phone", promptpayId: "12345" });
    expect(badPhone.status).toBe(400);
    expect((await badPhone.json<ErrorBody>()).error.field).toBe("promptpayId");

    const badCitizen = await putSettings({ promptpayType: "citizen-id", promptpayId: "123456789012" });
    expect(badCitizen.status).toBe(400);
    expect((await badCitizen.json<ErrorBody>()).error.field).toBe("promptpayId");

    const thirteenOnPhone = await putSettings({ promptpayType: "phone", promptpayId: "1234567890123" });
    expect(thirteenOnPhone.status).toBe(400);
    expect((await thirteenOnPhone.json<ErrorBody>()).error.field).toBe("promptpayId");

    const goodCitizen = await putSettings({ promptpayType: "citizen-id", promptpayId: "1234567890123" });
    expect(goodCitizen.status).toBe(200);
    expect((await goodCitizen.json<SettingsBody>()).settings.promptpayType).toBe("citizen-id");

    const goodPhone = await putSettings({ promptpayType: "phone", promptpayId: "0812345678" });
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
});
