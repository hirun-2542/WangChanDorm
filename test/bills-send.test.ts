import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configurePayout, createFamily, signIn, withAuth, type TestSession } from "./auth-helper";

const roomsUrl = "https://dorm.test/api/rooms";
const tenantsUrl = "https://dorm.test/api/tenants";
const billsUrl = "https://dorm.test/api/bills";
const settingsUrl = "https://dorm.test/api/settings";
const qrUrl = "https://dorm.test/qr";
const linePushUrl = "https://api.line.me/v2/bot/message/push";

interface RoomPayload {
  id: string;
  roomNumber: string;
}

interface TenantPayload {
  id: string;
  fullName: string;
  roomId: string;
  roomNumber: string;
  lineUserId: string | null;
}

interface ChargePayload {
  name: string;
  amount: number;
}

interface BillPayload {
  id: string;
  roomNumber: string;
  tenantId: string;
  tenantName: string;
  period: string;
  rent: number;
  waterUnits: number;
  waterRate: number;
  waterAmount: number;
  electricMode: "meter" | "flat";
  electricUnits: number | null;
  electricRate: number | null;
  electricAmount: number;
  charges: ChargePayload[];
  total: number;
  sentAt: string | null;
}

interface ErrorBody {
  ok: boolean;
  error: { code: string; message: string; field?: string };
}

interface SkippedBill {
  roomNumber: string;
  tenantName: string;
}

interface SendAllBody {
  ok: boolean;
  period: string;
  sent: number;
  failed: number;
  failedIds: string[];
  skipped: SkippedBill[];
  alreadyPaid: SkippedBill[];
  alreadyPaidIds: string[];
}

interface OutboundCall {
  url: string;
  method: string;
  body: string;
  authorization: string;
}

interface LineMessage {
  type: string;
  altText?: string;
  text?: string;
  contents?: unknown;
}

interface PushBody {
  to: string;
  messages: LineMessage[];
}

let outboundCalls: OutboundCall[] = [];
let pushStatus = 200;
let failingUserIds = new Set<string>();

function first<T>(items: T[]): T {
  const [item] = items;

  if (item === undefined) {
    throw new Error("expected at least one item");
  }

  return item;
}

function pick<T>(items: T[], predicate: (item: T) => boolean): T {
  const found = items.find(predicate);

  if (found === undefined) {
    throw new Error("expected a matching item");
  }

  return found;
}

function pushCalls(): OutboundCall[] {
  return outboundCalls.filter((call) => call.url === linePushUrl);
}

function pushBodies(): PushBody[] {
  return pushCalls().map((call) => JSON.parse(call.body) as PushBody);
}

function flexBodies(): PushBody[] {
  return pushBodies().filter((body) =>
    body.messages.some((message) => message.type === "flex"),
  );
}

function textBodies(): PushBody[] {
  return pushBodies().filter((body) =>
    body.messages.some((message) => message.type === "text"),
  );
}

function collectTexts(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node as unknown[]) {
      collectTexts(item, out);
    }

    return;
  }

  if (typeof node !== "object" || node === null) {
    return;
  }

  const record = node as Record<string, unknown>;
  const text = record.text;

  if (typeof text === "string") {
    out.push(text);
  }

  collectTexts(record.contents, out);
  collectTexts(record.header, out);
  collectTexts(record.body, out);
  collectTexts(record.footer, out);
}

function flexTexts(message: LineMessage): string[] {
  const out: string[] = [];
  collectTexts(message.contents, out);
  return out;
}

/** เรียกเส้นทางสาธารณะ (เช่น /qr) ที่ไม่ต้องมีคุกกี้ */
function get(url: string): Promise<Response> {
  return SELF.fetch(url);
}

let session: TestSession;

/** ยิง API ภายใต้ /api ด้วยเซสชันของเทสต์นี้ */
function api(url: string, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(url, withAuth(session, init));
}

beforeEach(async () => {
  session = await signIn();
  await configurePayout();
});

function post(
  url: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  return api(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function putRates(water: number, electric: number): Promise<void> {
  const response = await api(settingsUrl, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      defaultWaterRate: water,
      defaultElectricRate: electric,
    }),
  });

  expect(response.status).toBe(200);
}

async function putPayee(
  promptpayId: string,
  promptpayName: string,
): Promise<void> {
  const response = await api(settingsUrl, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ promptpayId, promptpayName }),
  });

  expect(response.status).toBe(200);
}

async function newRoom(payload: Record<string, unknown>): Promise<RoomPayload> {
  const response = await post(roomsUrl, payload);
  expect(response.status).toBe(201);
  return (await response.json<{ ok: boolean; room: RoomPayload }>()).room;
}

async function newTenant(
  roomId: string,
  fullName: string,
): Promise<TenantPayload> {
  const response = await post(tenantsUrl, {
    fullName,
    phone: "081-234-5678",
    roomId,
    checkInDate: "2025-03-01",
  });
  expect(response.status).toBe(201);
  return (await response.json<{ ok: boolean; tenant: TenantPayload }>()).tenant;
}

function generate(payload: Record<string, unknown>): Promise<Response> {
  return post(`${billsUrl}/generate`, payload);
}

async function generatedBill(
  roomId: string,
  entry: Record<string, unknown>,
  period = "2026-09",
): Promise<BillPayload> {
  const response = await generate({ period, entries: [{ roomId, ...entry }] });
  expect(response.status).toBe(201);
  return first(
    (await response.json<{ ok: boolean; bills: BillPayload[] }>()).bills,
  );
}

async function listBills(period: string): Promise<BillPayload[]> {
  const response = await api(`${billsUrl}?period=${period}`);
  expect(response.status).toBe(200);
  return (
    await response.json<{ ok: boolean; period: string; bills: BillPayload[] }>()
  ).bills;
}

async function sentAtOf(
  period: string,
  billId: string,
): Promise<string | null> {
  return pick(await listBills(period), (bill) => bill.id === billId).sentAt;
}

function sendOne(id: string): Promise<Response> {
  return post(`${billsUrl}/${id}/send`, {});
}

function sendAll(period: string, billIds?: string[]): Promise<Response> {
  return post(
    `${billsUrl}/send-all`,
    billIds === undefined ? { period } : { period, billIds },
  );
}

async function linkTenant(tenantId: string, lineUserId: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE tenants SET line_user_id = ? WHERE family_id = ? AND id = ?",
  )
    .bind(lineUserId, session.familyId, tenantId)
    .run();
}

async function linkOwner(lineUserId: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO settings (family_id, key, value, updated_at) VALUES (?, 'owner_line_user_id', ?, datetime('now')) ON CONFLICT(family_id, key) DO UPDATE SET value = excluded.value",
  )
    .bind(session.familyId, lineUserId)
    .run();
}

async function unlinkOwner(): Promise<void> {
  await env.DB.prepare(
    "DELETE FROM settings WHERE family_id = ? AND key = 'owner_line_user_id'",
  )
    .bind(session.familyId)
    .run();
}

beforeEach(() => {
  outboundCalls = [];
  pushStatus = 200;
  failingUserIds = new Set<string>();

  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? init.body : "";

    outboundCalls.push({
      url,
      method: init?.method ?? "GET",
      body,
      authorization: headers.get("authorization") ?? "",
    });

    let status = 200;

    if (url === linePushUrl) {
      status = pushStatus;

      if (
        status === 200 &&
        body !== "" &&
        failingUserIds.has((JSON.parse(body) as { to?: string }).to ?? "")
      ) {
        status = 500;
      }
    }

    return Promise.resolve(
      new Response(JSON.stringify({}), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  });
});

afterEach(() => {
  env.LINE_CHANNEL_ACCESS_TOKEN = "test-channel-access-token";
  vi.restoreAllMocks();
});

describe("POST /api/bills/:id/send", () => {
  it("pushes one flex bill to the linked tenant and records the sent time", async () => {
    await putRates(18, 7);
    const room = await newRoom({
      roomNumber: "C301",
      rent: 3800,
      electricMode: "flat",
      waterMeterInit: 130,
      electricMeterInit: 460,
    });
    const tenant = await newTenant(room.id, "สมชาย ทดสอบ");
    await linkTenant(tenant.id, "U-tenant-1");

    const bill = await generatedBill(room.id, {
      waterCurrent: 135,
      electricCurrent: 470,
      flatElectricAmount: 600,
      charges: [
        { name: "ค่าอินเทอร์เน็ต", amount: 200 },
        { name: "ค่าขยะ", amount: 40 },
      ],
    });
    expect(bill.sentAt).toBeNull();

    const response = await sendOne(bill.id);
    expect(response.status).toBe(200);

    const body = await response.json<{ ok: boolean; bill: BillPayload }>();
    expect(body.ok).toBe(true);
    expect(body.bill.id).toBe(bill.id);
    expect(body.bill.sentAt).not.toBeNull();

    const pushes = pushCalls();
    expect(pushes).toHaveLength(1);
    expect(pushes[0]?.method).toBe("POST");
    expect(pushes[0]?.authorization).toBe(
      `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
    );

    const payload = first(pushBodies());
    expect(payload.to).toBe("U-tenant-1");

    const message = first(payload.messages);
    expect(message.type).toBe("flex");

    const texts = flexTexts(message);
    expect(texts).toContain("ห้อง C301 | ประจำเดือน กันยายน 2569");
    expect(texts).toContain("ผู้เช่า");
    expect(texts).toContain("สมชาย ทดสอบ");
    expect(texts).toContain("3,800 บาท");
    expect(texts).toContain("90 บาท");
    expect(texts).toContain("600 บาท");
    expect(texts).toContain("200 บาท");
    expect(texts).toContain("40 บาท");
    expect(texts).toContain("4,730 บาท");
    expect(texts).toContain("ค่าเช่าห้อง");
    expect(texts).toContain("ค่าไฟ");
    expect(texts).toContain("ค่าอินเทอร์เน็ต");
    expect(texts).toContain("ค่าขยะ");
    expect(texts).toContain("ยอดรวม");

    const contents = JSON.stringify(message.contents);
    expect(contents).toContain(`https://dorm.test/invoices/${bill.id}.pdf`);
    expect(contents).toContain("เปิดใบแจ้งหนี้ PDF");
    expect(contents).not.toContain("/qr/");

    expect(await sentAtOf("2026-09", bill.id)).toBe(body.bill.sentAt);
  });

  it("leaves sent_at null when the push fails", async () => {
    await putRates(18, 7);
    const room = await newRoom({
      roomNumber: "C311",
      rent: 3500,
      waterMeterInit: 10,
      electricMeterInit: 20,
    });
    const tenant = await newTenant(room.id, "ผู้เช่าเชื่อม");
    await linkTenant(tenant.id, "U-fail");
    const bill = await generatedBill(
      room.id,
      { waterCurrent: 12, electricCurrent: 24 },
      "2026-10",
    );

    pushStatus = 500;

    const response = await sendOne(bill.id);
    expect(response.status).toBe(502);
    expect((await response.json<ErrorBody>()).error.code).toBe("UPSTREAM");
    expect(pushCalls()).toHaveLength(1);
    expect(await sentAtOf("2026-10", bill.id)).toBeNull();
  });

  it("reports the LINE channel as not configured instead of a per-bill failure", async () => {
    await putRates(18, 7);
    const room = await newRoom({
      roomNumber: "C341",
      rent: 3500,
      waterMeterInit: 10,
      electricMeterInit: 20,
    });
    const tenant = await newTenant(room.id, "ผู้เช่าไม่มีโทเคน");
    await linkTenant(tenant.id, "U-no-token");
    const bill = await generatedBill(
      room.id,
      { waterCurrent: 12, electricCurrent: 24 },
      "2025-01",
    );

    env.LINE_CHANNEL_ACCESS_TOKEN = "";

    const response = await sendOne(bill.id);
    expect(response.status).toBe(503);

    const body = await response.json<ErrorBody>();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("UPSTREAM");
    expect(body.error.message.length).toBeGreaterThan(0);
    expect(pushCalls()).toEqual([]);
    expect(await sentAtOf("2025-01", bill.id)).toBeNull();
  });

  it("reports demo mode instead of the missing-token message when DEMO_MODE is on", async () => {
    await putRates(18, 7);
    const room = await newRoom({
      roomNumber: "C349",
      rent: 3500,
      waterMeterInit: 10,
      electricMeterInit: 20,
    });
    const tenant = await newTenant(room.id, "ผู้เช่าโหมดสาธิต");
    await linkTenant(tenant.id, "U-demo-send-one");
    const bill = await generatedBill(
      room.id,
      { waterCurrent: 12, electricCurrent: 24 },
      "2025-03",
    );

    const demoModeEnv = env as unknown as { DEMO_MODE: string };
    const originalDemoMode = demoModeEnv.DEMO_MODE;
    demoModeEnv.DEMO_MODE = "1";

    try {
      const response = await sendOne(bill.id);
      expect(response.status).toBe(503);

      const body = await response.json<ErrorBody>();
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("UPSTREAM");
      expect(body.error.message).toContain("โหมดสาธิต");
      expect(pushCalls()).toEqual([]);
      expect(await sentAtOf("2025-03", bill.id)).toBeNull();
    } finally {
      demoModeEnv.DEMO_MODE = originalDemoMode;
    }
  });

  it("rejects a paid bill and sends nothing", async () => {
    await putRates(18, 7);
    const room = await newRoom({
      roomNumber: "C344",
      rent: 3500,
      waterMeterInit: 10,
      electricMeterInit: 20,
    });
    const tenant = await newTenant(room.id, "ผู้เช่าจ่ายแล้ว");
    await linkTenant(tenant.id, "U-paid");
    const bill = await generatedBill(
      room.id,
      { waterCurrent: 12, electricCurrent: 24 },
      "2025-03",
    );

    const paid = await post(`${billsUrl}/${bill.id}/mark-paid`, {
      method: "cash",
    });
    expect(paid.status).toBe(200);

    const response = await sendOne(bill.id);
    expect(response.status).toBe(409);

    const body = await response.json<ErrorBody>();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.message.length).toBeGreaterThan(0);
    expect(pushCalls()).toEqual([]);
    expect(await sentAtOf("2025-03", bill.id)).toBeNull();
  });

  it("answers 409 and sends nothing for a tenant with no LINE link", async () => {
    await putRates(18, 7);
    const room = await newRoom({
      roomNumber: "C312",
      rent: 3500,
      waterMeterInit: 10,
      electricMeterInit: 20,
    });
    await newTenant(room.id, "ยังไม่เชื่อม");
    const bill = await generatedBill(
      room.id,
      { waterCurrent: 12, electricCurrent: 24 },
      "2026-11",
    );

    const response = await sendOne(bill.id);
    expect(response.status).toBe(409);

    const body = await response.json<ErrorBody>();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.message.length).toBeGreaterThan(0);
    expect(pushCalls()).toEqual([]);
    expect(await sentAtOf("2026-11", bill.id)).toBeNull();
  });

  it("answers 404 for an unknown bill id", async () => {
    const response = await sendOne("bill-does-not-exist");
    expect(response.status).toBe(404);
    expect((await response.json<ErrorBody>()).error.code).toBe("NOT_FOUND");
    expect(pushCalls()).toEqual([]);
  });

  it("carries a clipboard action with the promptpay number so the tenant can copy it", async () => {
    await putRates(18, 7);
    await putPayee("089-999-1234", "สมศักดิ์ ใจดี");
    const room = await newRoom({
      roomNumber: "C314",
      rent: 3500,
      waterMeterInit: 10,
      electricMeterInit: 20,
    });
    const tenant = await newTenant(room.id, "ผู้เช่า copy");
    await linkTenant(tenant.id, "U-copy");
    const bill = await generatedBill(room.id, {
      waterCurrent: 12,
      electricCurrent: 24,
    });

    const response = await sendOne(bill.id);
    expect(response.status).toBe(200);

    const message = first(first(pushBodies()).messages);
    const contents = JSON.stringify(message.contents);

    expect(contents).toContain('"type":"clipboard"');
    expect(contents).toContain('"clipboardText":"089-999-1234"');
    expect(flexTexts(message)).toContain("089-999-1234");
  });

  it("leaves the promptpay copy action out when no promptpay number is configured, keeping the bank one", async () => {
    await putRates(18, 7);
    await putPayee("089-999-1234", "สมศักดิ์ ใจดี");
    // ต้องเขียนค่าว่างลง DB ตรง ๆ เพราะ API จะปฏิเสธถ้าล้างพร้อมเพย์แล้วไม่เหลือช่องทางรับเงิน
    await env.DB.prepare(
      "UPDATE settings SET value = '' WHERE family_id = ? AND key = 'promptpay_id'",
    )
      .bind(session.familyId)
      .run();
    // ออกบิลได้ต้องมีช่องทางรับเงินอย่างน้อยหนึ่งอย่าง เมื่อไม่มีพร้อมเพย์แล้ว
    // จึงต้องมีบัญชีธนาคารครบคู่ (ชื่อธนาคาร + เลขบัญชี) แทน
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO settings (family_id, key, value, updated_at) VALUES (?, 'bank_name', ?, datetime('now')) ON CONFLICT(family_id, key) DO UPDATE SET value = excluded.value",
      ).bind(session.familyId, "kbank"),
      env.DB.prepare(
        "INSERT INTO settings (family_id, key, value, updated_at) VALUES (?, 'bank_account_number', ?, datetime('now')) ON CONFLICT(family_id, key) DO UPDATE SET value = excluded.value",
      ).bind(session.familyId, "1234567890"),
    ]);

    const room = await newRoom({
      roomNumber: "C315",
      rent: 3500,
      waterMeterInit: 10,
      electricMeterInit: 20,
    });
    const tenant = await newTenant(room.id, "ผู้เช่า ไม่มีพร้อมเพย์");
    await linkTenant(tenant.id, "U-nopay");
    const bill = await generatedBill(room.id, {
      waterCurrent: 12,
      electricCurrent: 24,
    });

    const response = await sendOne(bill.id);
    expect(response.status).toBe(200);

    const contents = JSON.stringify(
      first(first(pushBodies()).messages).contents,
    );
    // ไม่มีส่วนพร้อมเพย์เลย แต่บัญชีธนาคารยังมีปุ่มคัดลอกของตัวเองอยู่ — เหลือปุ่ม
    // คัดลอกเดียว (ของบัญชีธนาคาร) แทนที่จะเป็นศูนย์หรือสองปุ่ม
    expect(contents.split('"type":"clipboard"').length - 1).toBe(1);

    await putPayee("081-234-5678", "สมศักดิ์ ใจดี");
    await env.DB.prepare(
      "DELETE FROM settings WHERE family_id = ? AND key IN ('bank_name', 'bank_account_number')",
    )
      .bind(session.familyId)
      .run();
  });

  it("names the room, the period and the total in the alt text", async () => {
    await putRates(18, 7);
    const room = await newRoom({
      roomNumber: "C313",
      rent: 3500,
      waterMeterInit: 10,
      electricMeterInit: 20,
    });
    const tenant = await newTenant(room.id, "ผู้เช่า alt");
    await linkTenant(tenant.id, "U-alt");
    const bill = await generatedBill(room.id, {
      waterCurrent: 12,
      electricCurrent: 24,
    });

    const response = await sendOne(bill.id);
    expect(response.status).toBe(200);

    const message = first(first(pushBodies()).messages);
    expect(message.type).toBe("flex");
    const altText = message.altText ?? "";
    expect(altText).toContain("C313");
    expect(altText).toContain("กันยายน 2569");
    expect(altText).toContain("3,564");
  });
});

describe("POST /api/bills/send-all", () => {
  async function setupTwoRooms(
    period: string,
    linkedRoomNumber: string,
    unlinkedRoomNumber: string,
  ): Promise<{ bill: BillPayload; lineUserId: string }> {
    const lineUserId = `U-${linkedRoomNumber}`;
    const linkedRoom = await newRoom({
      roomNumber: linkedRoomNumber,
      rent: 3500,
      waterMeterInit: 10,
      electricMeterInit: 20,
    });
    const linkedTenant = await newTenant(linkedRoom.id, "ผู้เช่าเชื่อม");
    const unlinkedRoom = await newRoom({
      roomNumber: unlinkedRoomNumber,
      rent: 3600,
      waterMeterInit: 30,
      electricMeterInit: 40,
    });
    await newTenant(unlinkedRoom.id, "ผู้เช่าไม่เชื่อม");
    await linkTenant(linkedTenant.id, lineUserId);

    const response = await generate({
      period,
      entries: [
        { roomId: linkedRoom.id, waterCurrent: 12, electricCurrent: 24 },
        { roomId: unlinkedRoom.id, waterCurrent: 33, electricCurrent: 44 },
      ],
    });
    expect(response.status).toBe(201);

    const created = (
      await response.json<{ ok: boolean; bills: BillPayload[] }>()
    ).bills;
    return {
      bill: pick(created, (bill) => bill.roomNumber === linkedRoomNumber),
      lineUserId,
    };
  }

  async function twoLinkedBills(
    period: string,
    firstRoomNumber: string,
    secondRoomNumber: string,
  ): Promise<{
    first: BillPayload;
    second: BillPayload;
    secondUserId: string;
  }> {
    const secondUserId = `U-${secondRoomNumber}`;
    const firstRoom = await newRoom({
      roomNumber: firstRoomNumber,
      rent: 3500,
      waterMeterInit: 10,
      electricMeterInit: 20,
    });
    const firstTenant = await newTenant(firstRoom.id, "ผู้เช่าเชื่อมหนึ่ง");
    await linkTenant(firstTenant.id, `U-${firstRoomNumber}`);
    const secondRoom = await newRoom({
      roomNumber: secondRoomNumber,
      rent: 3600,
      waterMeterInit: 30,
      electricMeterInit: 40,
    });
    const secondTenant = await newTenant(secondRoom.id, "ผู้เช่าเชื่อมสอง");
    await linkTenant(secondTenant.id, secondUserId);

    const response = await generate({
      period,
      entries: [
        { roomId: firstRoom.id, waterCurrent: 12, electricCurrent: 24 },
        { roomId: secondRoom.id, waterCurrent: 33, electricCurrent: 44 },
      ],
    });
    expect(response.status).toBe(201);

    const created = (
      await response.json<{ ok: boolean; bills: BillPayload[] }>()
    ).bills;
    return {
      first: pick(created, (bill) => bill.roomNumber === firstRoomNumber),
      second: pick(created, (bill) => bill.roomNumber === secondRoomNumber),
      secondUserId,
    };
  }

  it("pushes only to linked tenants, records them and reports the skipped list", async () => {
    await putRates(18, 7);
    const { bill: linkedBill, lineUserId } = await setupTwoRooms(
      "2026-08",
      "C321",
      "C322",
    );
    await linkOwner("U-owner");

    const response = await sendAll("2026-08");
    expect(response.status).toBe(200);

    const body = await response.json<SendAllBody>();
    expect(body.ok).toBe(true);
    expect(body.period).toBe("2026-08");
    expect(body.sent).toBe(1);
    expect(body.failed).toBe(0);
    expect(body.skipped).toEqual([
      { roomNumber: "C322", tenantName: "ผู้เช่าไม่เชื่อม" },
    ]);

    const flex = flexBodies();
    expect(flex).toHaveLength(2);
    expect(flex.some((body) => body.to === lineUserId)).toBe(true);

    const summaryPushes = flex.filter((body) => body.to === "U-owner");
    expect(summaryPushes).toHaveLength(1);
    expect(first(first(summaryPushes).messages).type).toBe("flex");

    const summaryText = flexTexts(first(first(summaryPushes).messages)).join(
      " ",
    );
    expect(summaryText).toContain("บิลทั้งหมด");
    expect(summaryText).toContain("2 ใบ");
    expect(summaryText).toContain("7,246");
    expect(summaryText).toContain("ส่งสำเร็จ");
    expect(summaryText).toContain("1 ใบ");
    expect(summaryText).toContain("C322");

    const listed = await listBills("2026-08");
    expect(
      pick(listed, (bill) => bill.id === linkedBill.id).sentAt,
    ).not.toBeNull();
    expect(
      pick(listed, (bill) => bill.roomNumber === "C322").sentAt,
    ).toBeNull();
  });

  it("still sends to tenants and skips the summary when the owner has no LINE link", async () => {
    await putRates(18, 7);
    await unlinkOwner();
    await setupTwoRooms("2026-07", "C323", "C324");

    const response = await sendAll("2026-07");
    expect(response.status).toBe(200);

    const body = await response.json<SendAllBody>();
    expect(body.sent).toBe(1);
    expect(body.failed).toBe(0);
    expect(body.skipped).toHaveLength(1);

    expect(flexBodies()).toHaveLength(1);
    expect(textBodies()).toEqual([]);
  });

  it("collects per-bill failures instead of aborting and keeps sent_at null", async () => {
    await putRates(18, 7);
    const { bill: linkedBill } = await setupTwoRooms("2026-06", "C325", "C326");
    await linkOwner("U-owner");

    pushStatus = 500;

    const response = await sendAll("2026-06");
    expect(response.status).toBe(200);

    const body = await response.json<SendAllBody>();
    expect(body.sent).toBe(0);
    expect(body.failed).toBe(1);
    expect(body.skipped).toEqual([
      { roomNumber: "C326", tenantName: "ผู้เช่าไม่เชื่อม" },
    ]);

    expect(await sentAtOf("2026-06", linkedBill.id)).toBeNull();
  });

  it("answers 400 for a period with no bills", async () => {
    const response = await sendAll("2026-05");
    expect(response.status).toBe(400);

    const body = await response.json<ErrorBody>();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.message.length).toBeGreaterThan(0);
    expect(pushCalls()).toEqual([]);
  });

  it("answers 400 for a malformed period", async () => {
    const response = await sendAll("2026-13");
    expect(response.status).toBe(400);
    expect((await response.json<ErrorBody>()).error.field).toBe("period");
    expect(pushCalls()).toEqual([]);
  });

  it("records only the successful bill when one push succeeds and another fails", async () => {
    await putRates(18, 7);
    await linkOwner("U-owner");
    const { first, second, secondUserId } = await twoLinkedBills(
      "2025-04",
      "C351",
      "C352",
    );

    failingUserIds = new Set([secondUserId]);

    const response = await sendAll("2025-04");
    expect(response.status).toBe(200);

    const body = await response.json<SendAllBody>();
    expect(body.sent).toBe(1);
    expect(body.failed).toBe(1);
    expect(body.failedIds).toEqual([second.id]);
    expect(body.skipped).toEqual([]);

    expect(await sentAtOf("2025-04", first.id)).not.toBeNull();
    expect(await sentAtOf("2025-04", second.id)).toBeNull();
  });

  it("sends only the bills named in billIds and leaves the rest unsent", async () => {
    await putRates(18, 7);
    const { first, second, secondUserId } = await twoLinkedBills(
      "2025-05",
      "C361",
      "C362",
    );

    const response = await sendAll("2025-05", [second.id]);
    expect(response.status).toBe(200);

    const body = await response.json<SendAllBody>();
    expect(body.sent).toBe(1);
    expect(body.failed).toBe(0);
    expect(body.failedIds).toEqual([]);
    expect(body.skipped).toEqual([]);
    expect(
      flexBodies().filter((push) => push.to === secondUserId),
    ).toHaveLength(1);
    expect(flexBodies().filter((push) => push.to === `U-C361`)).toEqual([]);

    expect(await sentAtOf("2025-05", first.id)).toBeNull();
    expect(await sentAtOf("2025-05", second.id)).not.toBeNull();
  });

  it("answers 400 and sends nothing for a billIds entry outside the period", async () => {
    await putRates(18, 7);
    const { first } = await twoLinkedBills("2025-06", "C371", "C372");

    const response = await sendAll("2025-06", [
      first.id,
      "bill-not-in-the-period",
    ]);
    expect(response.status).toBe(400);

    const body = await response.json<ErrorBody>();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.field).toBe("billIds");
    expect(pushCalls()).toEqual([]);
    expect(await sentAtOf("2025-06", first.id)).toBeNull();
  });

  it("answers 503 with UPSTREAM and attempts no push when the channel token is missing", async () => {
    await putRates(18, 7);
    await twoLinkedBills("2025-02", "C342", "C343");

    env.LINE_CHANNEL_ACCESS_TOKEN = "";

    const response = await sendAll("2025-02");
    expect(response.status).toBe(503);

    const body = await response.json<ErrorBody>();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("UPSTREAM");
    expect(body.error.message.length).toBeGreaterThan(0);
    expect(pushCalls()).toEqual([]);
  });

  it("reports demo mode instead of the missing-token message for send-all when DEMO_MODE is on", async () => {
    await putRates(18, 7);
    await twoLinkedBills("2025-04", "C401", "C402");

    const demoModeEnv = env as unknown as { DEMO_MODE: string };
    const originalDemoMode = demoModeEnv.DEMO_MODE;
    demoModeEnv.DEMO_MODE = "1";

    try {
      const response = await sendAll("2025-04");
      expect(response.status).toBe(503);

      const body = await response.json<ErrorBody>();
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("UPSTREAM");
      expect(body.error.message).toContain("โหมดสาธิต");
      expect(pushCalls()).toEqual([]);
    } finally {
      demoModeEnv.DEMO_MODE = originalDemoMode;
    }
  });

  it("pushes nothing and reports the paid bills when every bill of the period is paid", async () => {
    await putRates(18, 7);
    await unlinkOwner();
    await setupTwoRooms("2026-02", "C327", "C328");

    const created = await listBills("2026-02");

    for (const bill of created) {
      const paid = await post(`${billsUrl}/${bill.id}/mark-paid`, {
        method: "cash",
      });
      expect(paid.status).toBe(200);
    }

    const response = await sendAll("2026-02");
    expect(response.status).toBe(200);

    const body = await response.json<SendAllBody>();
    expect(body.sent).toBe(0);
    expect(body.failed).toBe(0);
    expect(body.skipped).toEqual([]);
    expect(body.alreadyPaid).toEqual([
      { roomNumber: "C327", tenantName: "ผู้เช่าเชื่อม" },
      { roomNumber: "C328", tenantName: "ผู้เช่าไม่เชื่อม" },
    ]);
    expect(body.alreadyPaidIds).toEqual(created.map((bill) => bill.id));

    expect(pushCalls()).toEqual([]);
    expect((await listBills("2026-02")).map((bill) => bill.sentAt)).toEqual([
      null,
      null,
    ]);
  });

  it("sends only the unpaid linked bills of a mixed period", async () => {
    await putRates(18, 7);
    await linkOwner("U-owner");

    const paidRoom = await newRoom({
      roomNumber: "C331",
      rent: 3500,
      waterMeterInit: 10,
      electricMeterInit: 20,
    });
    const paidTenant = await newTenant(paidRoom.id, "ผู้เช่าจ่ายแล้ว");
    await linkTenant(paidTenant.id, "U-paid-mixed");
    const openRoom = await newRoom({
      roomNumber: "C332",
      rent: 3600,
      waterMeterInit: 30,
      electricMeterInit: 40,
    });
    const openTenant = await newTenant(openRoom.id, "ผู้เช่าเชื่อม");
    await linkTenant(openTenant.id, "U-open-mixed");
    const unlinkedRoom = await newRoom({
      roomNumber: "C333",
      rent: 3700,
      waterMeterInit: 50,
      electricMeterInit: 60,
    });
    await newTenant(unlinkedRoom.id, "ผู้เช่าไม่เชื่อม");

    const generated = await generate({
      period: "2026-03",
      entries: [
        { roomId: paidRoom.id, waterCurrent: 12, electricCurrent: 24 },
        { roomId: openRoom.id, waterCurrent: 33, electricCurrent: 44 },
        { roomId: unlinkedRoom.id, waterCurrent: 55, electricCurrent: 66 },
      ],
    });
    expect(generated.status).toBe(201);

    const created = (
      await generated.json<{ ok: boolean; bills: BillPayload[] }>()
    ).bills;
    const paidBill = pick(created, (bill) => bill.roomNumber === "C331");
    const openBill = pick(created, (bill) => bill.roomNumber === "C332");

    expect(
      (
        await post(`${billsUrl}/${paidBill.id}/mark-paid`, {
          method: "transfer",
        })
      ).status,
    ).toBe(200);

    const response = await sendAll("2026-03");
    expect(response.status).toBe(200);

    const body = await response.json<SendAllBody>();
    expect(body.sent).toBe(1);
    expect(body.failed).toBe(0);
    expect(body.failedIds).toEqual([]);
    expect(body.skipped).toEqual([
      { roomNumber: "C333", tenantName: "ผู้เช่าไม่เชื่อม" },
    ]);
    expect(body.alreadyPaid).toEqual([
      { roomNumber: "C331", tenantName: "ผู้เช่าจ่ายแล้ว" },
    ]);
    expect(body.alreadyPaidIds).toEqual([paidBill.id]);

    const flex = flexBodies();
    expect(flex.filter((push) => push.to === "U-paid-mixed")).toEqual([]);
    expect(flex.filter((push) => push.to === "U-open-mixed")).toHaveLength(1);

    // การปิดบิลด้วยมือยิงการ์ดถึงเจ้าของด้วย จึงต้องเลือกใบสรุปการส่งให้ถูกใบ
    const ownerPushes = flex.filter((push) => push.to === "U-owner");
    const summaryPush = first(
      ownerPushes.filter((push) =>
        flexTexts(first(push.messages)).join(" ").includes("บิลทั้งหมด"),
      ),
    );
    const summary = flexTexts(first(summaryPush.messages)).join(" ");
    expect(summary).toContain("บิลทั้งหมด");
    expect(summary).toContain("2 ใบ");
    expect(summary).toContain("7,514");

    const listed = await listBills("2026-03");
    expect(pick(listed, (bill) => bill.id === paidBill.id).sentAt).toBeNull();
    expect(
      pick(listed, (bill) => bill.id === openBill.id).sentAt,
    ).not.toBeNull();
  });

  it("reports a paid bill named in billIds instead of pushing it", async () => {
    await putRates(18, 7);
    await unlinkOwner();
    const { first, second } = await twoLinkedBills("2025-07", "C373", "C374");

    expect(
      (await post(`${billsUrl}/${first.id}/mark-paid`, { method: "cash" }))
        .status,
    ).toBe(200);

    const response = await sendAll("2025-07", [first.id]);
    expect(response.status).toBe(200);

    const body = await response.json<SendAllBody>();
    expect(body.sent).toBe(0);
    expect(body.failed).toBe(0);
    expect(body.skipped).toEqual([]);
    expect(body.alreadyPaid).toEqual([
      { roomNumber: "C373", tenantName: "ผู้เช่าเชื่อมหนึ่ง" },
    ]);
    expect(body.alreadyPaidIds).toEqual([first.id]);

    expect(pushCalls()).toEqual([]);
    expect(await sentAtOf("2025-07", first.id)).toBeNull();
    expect(await sentAtOf("2025-07", second.id)).toBeNull();
  });
});

describe("GET /api/bills/periods", () => {
  it("lists each period that has bills once, newest first", async () => {
    await putRates(18, 7);
    const firstRoom = await newRoom({
      roomNumber: "C381",
      rent: 3500,
      waterMeterInit: 10,
      electricMeterInit: 20,
    });
    await newTenant(firstRoom.id, "ผู้เช่า periods หนึ่ง");
    const secondRoom = await newRoom({
      roomNumber: "C382",
      rent: 3600,
      waterMeterInit: 30,
      electricMeterInit: 40,
    });
    await newTenant(secondRoom.id, "ผู้เช่า periods สอง");

    const november = await generate({
      period: "2025-11",
      entries: [
        { roomId: firstRoom.id, waterCurrent: 12, electricCurrent: 24 },
      ],
    });
    expect(november.status).toBe(201);

    const january = await generate({
      period: "2026-01",
      entries: [
        { roomId: firstRoom.id, waterCurrent: 12, electricCurrent: 24 },
        { roomId: secondRoom.id, waterCurrent: 33, electricCurrent: 44 },
      ],
    });
    expect(january.status).toBe(201);

    const december = await generate({
      period: "2025-12",
      entries: [
        { roomId: firstRoom.id, waterCurrent: 12, electricCurrent: 24 },
      ],
    });
    expect(december.status).toBe(201);

    const response = await api(`${billsUrl}/periods`);
    expect(response.status).toBe(200);

    const body = await response.json<{ ok: boolean; periods: string[] }>();
    expect(body.ok).toBe(true);

    const periods = body.periods;
    expect(periods).toEqual(
      [...periods].sort((left, right) => (left < right ? 1 : -1)),
    );
    expect(new Set(periods).size).toBe(periods.length);
    expect(periods.filter((period) => period === "2026-01")).toHaveLength(1);
    expect(periods).toContain("2025-11");
    expect(periods).not.toContain("2024-01");
    expect(periods.indexOf("2026-01")).toBeLessThan(periods.indexOf("2025-12"));
    expect(periods.indexOf("2025-12")).toBeLessThan(periods.indexOf("2025-11"));
  });
});

describe("GET /qr/preview.png", () => {
  it("renders the same QR as the per-bill route for the same promptpay id and amount", async () => {
    await putRates(18, 7);
    const room = await newRoom({
      roomNumber: "C391",
      rent: 3500,
      waterMeterInit: 10,
      electricMeterInit: 20,
    });
    await newTenant(room.id, "ผู้เช่า QR");
    const bill = await generatedBill(
      room.id,
      { waterCurrent: 12, electricCurrent: 24 },
      "2026-04",
    );

    const saved = await api(settingsUrl, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        promptpayId: "081-234-5678",
        promptpayType: "phone",
      }),
    });
    expect(saved.status).toBe(200);

    const billQr = await get(`${qrUrl}/${bill.id}.png`);
    expect(billQr.status).toBe(200);
    expect(billQr.headers.get("content-type")).toBe("image/png");

    const preview = await api(
      `${qrUrl}/preview.png?id=081-234-5678&type=phone&amount=${bill.total}`,
    );
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-type")).toBe("image/png");
    expect(preview.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await preview.arrayBuffer())).toEqual(
      new Uint8Array(await billQr.arrayBuffer()),
    );
  });

  it("refuses to render without a session", async () => {
    const anonymous = await get(
      `${qrUrl}/preview.png?id=081-234-5678&type=phone&amount=1200`,
    );
    expect(anonymous.status).toBe(401);

    const body = await anonymous.json<ErrorBody>();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION");
  });

  it("rejects a promptpay id that does not match its type", async () => {
    const tooShort = await api(
      `${qrUrl}/preview.png?id=081-2345&type=phone&amount=1200`,
    );
    expect(tooShort.status).toBe(400);

    const body = await tooShort.json<ErrorBody>();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.field).toBe("id");
    expect(body.error.message.length).toBeGreaterThan(0);

    const wrongType = await api(
      `${qrUrl}/preview.png?id=081-234-5678&type=citizen-id&amount=1200`,
    );
    expect(wrongType.status).toBe(400);
    expect((await wrongType.json<ErrorBody>()).error.field).toBe("id");
  });

  it("rejects an unknown promptpay type", async () => {
    const response = await api(
      `${qrUrl}/preview.png?id=081-234-5678&type=email&amount=1200`,
    );
    expect(response.status).toBe(400);

    const body = await response.json<ErrorBody>();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.field).toBe("type");
  });

  it("rejects an amount that is missing, non-numeric or not positive", async () => {
    const missing = await api(
      `${qrUrl}/preview.png?id=081-234-5678&type=phone`,
    );
    expect(missing.status).toBe(400);
    expect((await missing.json<ErrorBody>()).error.field).toBe("amount");

    const notANumber = await api(
      `${qrUrl}/preview.png?id=081-234-5678&type=phone&amount=abc`,
    );
    expect(notANumber.status).toBe(400);
    expect((await notANumber.json<ErrorBody>()).error.field).toBe("amount");

    const zero = await api(
      `${qrUrl}/preview.png?id=081-234-5678&type=phone&amount=0`,
    );
    expect(zero.status).toBe(400);

    const body = await zero.json<ErrorBody>();
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.field).toBe("amount");
  });

  it("caps the amount so the dorm domain cannot mint an oversized QR", async () => {
    const over = await api(
      `${qrUrl}/preview.png?id=081-234-5678&type=phone&amount=2000001`,
    );
    expect(over.status).toBe(400);

    const body = await over.json<ErrorBody>();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.field).toBe("amount");

    const atLimit = await api(
      `${qrUrl}/preview.png?id=081-234-5678&type=phone&amount=2000000`,
    );
    expect(atLimit.status).toBe(200);
    expect(atLimit.headers.get("content-type")).toBe("image/png");
  });
});

describe("family isolation", () => {
  it("never sends or lists another family's bills", async () => {
    await putRates(18, 7);
    const room = await newRoom({
      roomNumber: "C395",
      rent: 3500,
      waterMeterInit: 10,
      electricMeterInit: 20,
    });
    const tenant = await newTenant(room.id, "ผู้เช่าเจ้าของหอ");
    await linkTenant(tenant.id, "U-first-family");
    const bill = await generatedBill(
      room.id,
      { waterCurrent: 12, electricCurrent: 24 },
      "2026-06",
    );

    const other = await signIn("owner", await createFamily("หอของอีกครอบครัว"));
    const json = { "content-type": "application/json" };

    const listed = await SELF.fetch(`${billsUrl}?period=2026-06`, withAuth(other));
    expect(listed.status).toBe(200);
    expect(
      (await listed.json<{ ok: boolean; bills: BillPayload[] }>()).bills,
    ).toEqual([]);

    const one = await SELF.fetch(
      `${billsUrl}/${bill.id}/send`,
      withAuth(other, { method: "POST", headers: json, body: JSON.stringify({}) }),
    );
    expect(one.status).toBe(404);
    expect((await one.json<ErrorBody>()).error.code).toBe("NOT_FOUND");

    const all = await SELF.fetch(
      `${billsUrl}/send-all`,
      withAuth(other, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ period: "2026-06" }),
      }),
    );
    expect(all.status).toBe(400);
    expect((await all.json<ErrorBody>()).error.field).toBe("period");

    expect(pushCalls()).toEqual([]);
    expect(await sentAtOf("2026-06", bill.id)).toBeNull();
  });
});
