import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const roomsUrl = "https://dorm.test/api/rooms";
const tenantsUrl = "https://dorm.test/api/tenants";
const billsUrl = "https://dorm.test/api/bills";
const settingsUrl = "https://dorm.test/api/settings";
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
  return pushBodies().filter((body) => body.messages.some((message) => message.type === "flex"));
}

function textBodies(): PushBody[] {
  return pushBodies().filter((body) => body.messages.some((message) => message.type === "text"));
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

function messageText(body: PushBody): string {
  return first(body.messages).text ?? "";
}

function post(url: string, payload: Record<string, unknown>): Promise<Response> {
  return SELF.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function putRates(water: number, electric: number): Promise<void> {
  const response = await SELF.fetch(settingsUrl, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ defaultWaterRate: water, defaultElectricRate: electric }),
  });

  expect(response.status).toBe(200);
}

async function newRoom(payload: Record<string, unknown>): Promise<RoomPayload> {
  const response = await post(roomsUrl, payload);
  expect(response.status).toBe(201);
  return (await response.json<{ ok: boolean; room: RoomPayload }>()).room;
}

async function newTenant(roomId: string, fullName: string): Promise<TenantPayload> {
  const response = await post(tenantsUrl, { fullName, phone: "081-234-5678", roomId, checkInDate: "2025-03-01" });
  expect(response.status).toBe(201);
  return (await response.json<{ ok: boolean; tenant: TenantPayload }>()).tenant;
}

function generate(payload: Record<string, unknown>): Promise<Response> {
  return post(`${billsUrl}/generate`, payload);
}

async function generatedBill(roomId: string, entry: Record<string, unknown>, period = "2026-09"): Promise<BillPayload> {
  const response = await generate({ period, entries: [{ roomId, ...entry }] });
  expect(response.status).toBe(201);
  return first((await response.json<{ ok: boolean; bills: BillPayload[] }>()).bills);
}

async function listBills(period: string): Promise<BillPayload[]> {
  const response = await SELF.fetch(`${billsUrl}?period=${period}`);
  expect(response.status).toBe(200);
  return (await response.json<{ ok: boolean; period: string; bills: BillPayload[] }>()).bills;
}

async function sentAtOf(period: string, billId: string): Promise<string | null> {
  return pick(await listBills(period), (bill) => bill.id === billId).sentAt;
}

function sendOne(id: string): Promise<Response> {
  return post(`${billsUrl}/${id}/send`, {});
}

function sendAll(period: string, billIds?: string[]): Promise<Response> {
  return post(`${billsUrl}/send-all`, billIds === undefined ? { period } : { period, billIds });
}

async function linkTenant(tenantId: string, lineUserId: string): Promise<void> {
  await env.DB.prepare("UPDATE tenants SET line_user_id = ? WHERE id = ?").bind(lineUserId, tenantId).run();
}

async function linkOwner(lineUserId: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES ('owner_line_user_id', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  )
    .bind(lineUserId)
    .run();
}

async function unlinkOwner(): Promise<void> {
  await env.DB.prepare("DELETE FROM settings WHERE key = 'owner_line_user_id'").run();
}

beforeEach(() => {
  outboundCalls = [];
  pushStatus = 200;
  failingUserIds = new Set<string>();

  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
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

      if (status === 200 && body !== "" && failingUserIds.has((JSON.parse(body) as { to?: string }).to ?? "")) {
        status = 500;
      }
    }

    return Promise.resolve(new Response(JSON.stringify({}), { status, headers: { "content-type": "application/json" } }));
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
    expect(pushes[0]?.authorization).toBe(`Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`);

    const payload = first(pushBodies());
    expect(payload.to).toBe("U-tenant-1");

    const message = first(payload.messages);
    expect(message.type).toBe("flex");

    const texts = flexTexts(message);
    expect(texts).toContain("ห้อง C301 | ประจำเดือน กันยายน 2569");
    expect(texts).toContain("ผู้เช่า สมชาย ทดสอบ");
    expect(texts).toContain("3,800 บาท");
    expect(texts).toContain("90 บาท");
    expect(texts).toContain("600 บาท");
    expect(texts).toContain("200 บาท");
    expect(texts).toContain("40 บาท");
    expect(texts).toContain("4,730 บาท");
    expect(texts).toContain("ค่าเช่าห้อง");
    expect(texts).toContain("เหมาจ่าย 600 บาท");
    expect(texts).toContain("5 หน่วย × 18 บาท/หน่วย");
    expect(texts).toContain("ค่าใช้จ่ายเพิ่มเติม");

    const contents = JSON.stringify(message.contents);
    expect(contents).toContain(`https://dorm.test/qr/${bill.id}.png`);
    expect(contents).toContain(`https://dorm.test/invoices/${bill.id}.pdf`);

    expect(await sentAtOf("2026-09", bill.id)).toBe(body.bill.sentAt);
  });

  it("leaves sent_at null when the push fails", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "C311", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    const tenant = await newTenant(room.id, "ผู้เช่าเชื่อม");
    await linkTenant(tenant.id, "U-fail");
    const bill = await generatedBill(room.id, { waterCurrent: 12, electricCurrent: 24 }, "2026-10");

    pushStatus = 500;

    const response = await sendOne(bill.id);
    expect(response.status).toBe(502);
    expect((await response.json<ErrorBody>()).error.code).toBe("UPSTREAM");
    expect(pushCalls()).toHaveLength(1);
    expect(await sentAtOf("2026-10", bill.id)).toBeNull();
  });

  it("reports the LINE channel as not configured instead of a per-bill failure", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "C341", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    const tenant = await newTenant(room.id, "ผู้เช่าไม่มีโทเคน");
    await linkTenant(tenant.id, "U-no-token");
    const bill = await generatedBill(room.id, { waterCurrent: 12, electricCurrent: 24 }, "2025-01");

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

  it("rejects a paid bill and sends nothing", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "C344", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    const tenant = await newTenant(room.id, "ผู้เช่าจ่ายแล้ว");
    await linkTenant(tenant.id, "U-paid");
    const bill = await generatedBill(room.id, { waterCurrent: 12, electricCurrent: 24 }, "2025-03");

    const paid = await post(`${billsUrl}/${bill.id}/mark-paid`, { method: "cash" });
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
    const room = await newRoom({ roomNumber: "C312", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "ยังไม่เชื่อม");
    const bill = await generatedBill(room.id, { waterCurrent: 12, electricCurrent: 24 }, "2026-11");

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

  it("names the room, the period and the total in the alt text", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "C313", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    const tenant = await newTenant(room.id, "ผู้เช่า alt");
    await linkTenant(tenant.id, "U-alt");
    const bill = await generatedBill(room.id, { waterCurrent: 12, electricCurrent: 24 });

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
    const linkedRoom = await newRoom({ roomNumber: linkedRoomNumber, rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    const linkedTenant = await newTenant(linkedRoom.id, "ผู้เช่าเชื่อม");
    const unlinkedRoom = await newRoom({ roomNumber: unlinkedRoomNumber, rent: 3600, waterMeterInit: 30, electricMeterInit: 40 });
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

    const created = (await response.json<{ ok: boolean; bills: BillPayload[] }>()).bills;
    return { bill: pick(created, (bill) => bill.roomNumber === linkedRoomNumber), lineUserId };
  }

  async function twoLinkedBills(
    period: string,
    firstRoomNumber: string,
    secondRoomNumber: string,
  ): Promise<{ first: BillPayload; second: BillPayload; secondUserId: string }> {
    const secondUserId = `U-${secondRoomNumber}`;
    const firstRoom = await newRoom({ roomNumber: firstRoomNumber, rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    const firstTenant = await newTenant(firstRoom.id, "ผู้เช่าเชื่อมหนึ่ง");
    await linkTenant(firstTenant.id, `U-${firstRoomNumber}`);
    const secondRoom = await newRoom({ roomNumber: secondRoomNumber, rent: 3600, waterMeterInit: 30, electricMeterInit: 40 });
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

    const created = (await response.json<{ ok: boolean; bills: BillPayload[] }>()).bills;
    return {
      first: pick(created, (bill) => bill.roomNumber === firstRoomNumber),
      second: pick(created, (bill) => bill.roomNumber === secondRoomNumber),
      secondUserId,
    };
  }

  it("pushes only to linked tenants, records them and reports the skipped list", async () => {
    await putRates(18, 7);
    const { bill: linkedBill, lineUserId } = await setupTwoRooms("2026-08", "C321", "C322");
    await linkOwner("U-owner");

    const response = await sendAll("2026-08");
    expect(response.status).toBe(200);

    const body = await response.json<SendAllBody>();
    expect(body.ok).toBe(true);
    expect(body.period).toBe("2026-08");
    expect(body.sent).toBe(1);
    expect(body.failed).toBe(0);
    expect(body.skipped).toEqual([{ roomNumber: "C322", tenantName: "ผู้เช่าไม่เชื่อม" }]);

    const flex = flexBodies();
    expect(flex).toHaveLength(1);
    expect(first(flex).to).toBe(lineUserId);

    const summaries = textBodies();
    expect(summaries).toHaveLength(1);

    const summary = first(summaries);
    expect(summary.to).toBe("U-owner");
    const summaryText = messageText(summary);
    expect(summaryText).toContain("บิลทั้งหมด 2 ใบ");
    expect(summaryText).toContain("7,246");
    expect(summaryText).toContain("ส่งสำเร็จ 1 ใบ");
    expect(summaryText).toContain("C322");

    const listed = await listBills("2026-08");
    expect(pick(listed, (bill) => bill.id === linkedBill.id).sentAt).not.toBeNull();
    expect(pick(listed, (bill) => bill.roomNumber === "C322").sentAt).toBeNull();
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
    expect(body.skipped).toEqual([{ roomNumber: "C326", tenantName: "ผู้เช่าไม่เชื่อม" }]);

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
    const { first, second, secondUserId } = await twoLinkedBills("2025-04", "C351", "C352");

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
    const { first, second } = await twoLinkedBills("2025-05", "C361", "C362");

    const response = await sendAll("2025-05", [second.id]);
    expect(response.status).toBe(200);

    const body = await response.json<SendAllBody>();
    expect(body.sent).toBe(1);
    expect(body.failed).toBe(0);
    expect(body.failedIds).toEqual([]);
    expect(body.skipped).toEqual([]);
    expect(flexBodies()).toHaveLength(1);

    expect(await sentAtOf("2025-05", first.id)).toBeNull();
    expect(await sentAtOf("2025-05", second.id)).not.toBeNull();
  });

  it("answers 400 and sends nothing for a billIds entry outside the period", async () => {
    await putRates(18, 7);
    const { first } = await twoLinkedBills("2025-06", "C371", "C372");

    const response = await sendAll("2025-06", [first.id, "bill-not-in-the-period"]);
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
});
