import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const webhookUrl = "https://dorm.test/webhook/line";
const roomsUrl = "https://dorm.test/api/rooms";
const tenantsUrl = "https://dorm.test/api/tenants";
const billsUrl = "https://dorm.test/api/bills";
const settingsUrl = "https://dorm.test/api/settings";
const slipBaseUrl = "https://dorm.test/slips";
const slipsUrl = "https://dorm.test/api/slips";

const lineContentBase = "https://api-data.line.me/v2/bot/message";
const linePushUrl = "https://api.line.me/v2/bot/message/push";
const lineReplyUrl = "https://api.line.me/v2/bot/message/reply";
const slipOkBranchId = "10275";
const slipOkUrl = `https://api.slipok.com/api/line/apikey/${slipOkBranchId}`;

const slipDate = "2026-09-03T10:15:00+07:00";
const slipPaidAt = "2026-09-03T03:15:00.000Z";

const notLinkedText = "กรุณาเชื่อม LINE กับห้องของคุณก่อนส่งสลิป พิมพ์เลขห้อง เช่น A101 เพื่อเชื่อม";
const downloadFailedText = "ระบบดาวน์โหลดรูปสลิปไม่สำเร็จ กรุณาส่งรูปสลิปอีกครั้ง";
const pendingReviewText = "ได้รับสลิปแล้ว เจ้าของหอจะตรวจสอบและยืนยันผลการชำระให้อีกครั้ง";
const duplicateText = "สลิปนี้ถูกใช้ปิดบิลไปแล้ว กรุณาส่งสลิปของรายการใหม่หรือติดต่อเจ้าของหอ";

function matchedText(amount: string, period: string): string {
  return `ได้รับชำระบิลประจำเดือน ${period} ยอด ${amount} บาท เรียบร้อยแล้ว`;
}

const slipImageBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

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
  roomId: string;
  tenantId: string;
  period: string;
  charges: ChargePayload[];
  total: number;
  status: string;
  paidAt: string | null;
  paidMethod: string | null;
}

interface SlipRow {
  id: string;
  bill_id: string | null;
  line_user_id: string;
  image_key: string;
  verify_result: string | null;
  amount: number | null;
  trans_ref: string | null;
  bill_total: number | null;
  status: string;
  created_at: string;
}

interface ErrorBody {
  ok: boolean;
  error: { code: string; message: string; field?: string };
}

interface QueueBill {
  id: string;
  roomNumber: string;
  tenantName: string;
  period: string;
  total: number;
}

interface QueueSlip {
  id: string;
  createdAt: string;
  imageKey: string;
  imageUrl: string;
  status: string;
  reason: string | null;
  slipAmount: number | null;
  bill: QueueBill | null;
  verified: boolean;
  verify: { verified: boolean; transRef: string | null; date: string | null };
  transferAt: string | null;
}

interface OutboundCall {
  url: string;
  method: string;
  body: string;
  authorization: string;
  xAuthorization: string;
}

interface LineMessage {
  type: string;
  text?: string;
}

interface PushBody {
  to: string;
  messages: LineMessage[];
}

interface ReplyBody {
  replyToken: string;
  messages: LineMessage[];
}

interface TextResult {
  to: string;
  text: string;
}

let outboundCalls: OutboundCall[] = [];
let imageStatus = 200;
let imageContentType = "image/png";
let imageBytes: Uint8Array = slipImageBytes;
let imageContentLength: number | null = null;
let slipOkStatus = 200;
let slipOkBody: unknown = {};
let beforeSlipOkResponse: (() => Promise<void>) | null = null;

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

function asJson<T>(text: string): T {
  return JSON.parse(text) as T;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

async function sign(rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.LINE_CHANNEL_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  return toBase64(new Uint8Array(signature));
}

function lineEvents(events: unknown[]): string {
  return JSON.stringify({ events });
}

async function postWebhook(body: string): Promise<Response> {
  return SELF.fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "x-line-signature": await sign(body) },
    body,
  });
}

function textEvent(userId: string, replyToken: string, text: string): Record<string, unknown> {
  return {
    type: "message",
    replyToken,
    timestamp: 0,
    mode: "active",
    source: { type: "user", userId },
    message: { type: "text", id: "msg-text", text },
  };
}

function imageEvent(userId: string, replyToken: string, messageId: string): Record<string, unknown> {
  return {
    type: "message",
    replyToken,
    timestamp: 0,
    mode: "active",
    source: { type: "user", userId },
    message: { type: "image", id: messageId, contentProvider: { type: "line" } },
  };
}

function downloadCalls(): OutboundCall[] {
  return outboundCalls.filter((call) => call.url.startsWith(lineContentBase));
}

function slipOkCalls(): OutboundCall[] {
  return outboundCalls.filter((call) => call.url === slipOkUrl);
}

function pushTexts(): TextResult[] {
  return outboundCalls
    .filter((call) => call.url === linePushUrl)
    .map((call) => {
      const body = asJson<PushBody>(call.body);
      return { to: body.to, text: body.messages[0]?.text ?? "" };
    });
}

function pushTextsFor(lineUserId: string): string[] {
  return pushTexts()
    .filter((push) => push.to === lineUserId)
    .map((push) => push.text);
}

function replyTexts(): string[] {
  return outboundCalls
    .filter((call) => call.url === lineReplyUrl)
    .map((call) => asJson<ReplyBody>(call.body).messages[0]?.text ?? "");
}

function verifiedBody(amount: number, transRef: string, date = "2026-09-03", time = "10:15"): unknown {
  return {
    success: true,
    data: {
      amount,
      date,
      time,
      bank: "KBANK",
      sender: "สมชาย ใจดี",
      receiver: "หอพักวังจันทร์",
      transRef,
    },
  };
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

async function generateBill(roomId: string, entry: Record<string, unknown>, period = "2026-09"): Promise<BillPayload> {
  const response = await post(`${billsUrl}/generate`, { period, entries: [{ roomId, ...entry }] });
  expect(response.status).toBe(201);
  return first((await response.json<{ ok: boolean; bills: BillPayload[] }>()).bills);
}

async function listBills(period: string): Promise<BillPayload[]> {
  const response = await SELF.fetch(`${billsUrl}?period=${period}`);
  expect(response.status).toBe(200);
  return (await response.json<{ ok: boolean; bills: BillPayload[] }>()).bills;
}

async function billOf(period: string, billId: string): Promise<BillPayload> {
  return pick(await listBills(period), (bill) => bill.id === billId);
}

async function readSlipsFor(lineUserId: string): Promise<SlipRow[]> {
  const result = await env.DB.prepare("SELECT * FROM slips WHERE line_user_id = ? ORDER BY created_at ASC, id ASC")
    .bind(lineUserId)
    .all<SlipRow>();
  return result.results;
}

async function readOneSlipFor(lineUserId: string): Promise<SlipRow> {
  return first(await readSlipsFor(lineUserId));
}

async function storedImageKeys(): Promise<string[]> {
  const objects = await env.SLIPS.list();
  return objects.objects.map((object) => object.key).sort();
}

async function linkTenantByRoomNumber(roomNumber: string, lineUserId: string, fullName: string): Promise<void> {
  const response = await postWebhook(lineEvents([textEvent(lineUserId, `tok-${lineUserId}`, roomNumber)]));
  expect(response.status).toBe(200);
  expect(replyTexts()).toEqual([`เชื่อม LINE กับ คุณ${fullName} ห้อง ${roomNumber} สำเร็จ`]);
}

async function sendSlip(lineUserId: string, messageId: string): Promise<Response> {
  return postWebhook(lineEvents([imageEvent(lineUserId, `tok-${messageId}`, messageId)]));
}

function slipResultOf(slip: SlipRow): Record<string, unknown> {
  return asJson<Record<string, unknown>>(slip.verify_result ?? "null");
}

function queueIds(slips: QueueSlip[]): string[] {
  return slips.map((slip) => slip.id);
}

async function listQueue(query = ""): Promise<QueueSlip[]> {
  const response = await SELF.fetch(`${slipsUrl}${query}`);
  expect(response.status).toBe(200);
  return (await response.json<{ ok: boolean; slips: QueueSlip[] }>()).slips;
}

function resolveSlip(id: string, payload: Record<string, unknown>): Promise<Response> {
  return post(`${slipsUrl}/${id}/resolve`, payload);
}

async function linkOwner(lineUserId: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES ('owner_line_user_id', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  )
    .bind(lineUserId)
    .run();
}

async function unlinkOwner(): Promise<void> {
  await env.DB.prepare("DELETE FROM settings WHERE key = 'owner_line_user_id'").run();
}

function ownerAlertText(roomNumber: string, tenantName: string, amountText: string, compareText: string): string {
  return `มีสลิปใหม่รอตรวจจากห้อง ${roomNumber} คุณ${tenantName} ${amountText} ${compareText} เปิดหน้าคิวรอตรวจเพื่อปิดบิลหรือปฏิเสธ`;
}

beforeEach(() => {
  outboundCalls = [];
  imageStatus = 200;
  imageContentType = "image/png";
  imageBytes = slipImageBytes;
  imageContentLength = null;
  slipOkStatus = 200;
  slipOkBody = {};
  beforeSlipOkResponse = null;
  env.SLIPOK_API_KEY = "test-slipok-api-key";
  env.SLIPOK_BRANCH_ID = slipOkBranchId;

  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);

    outboundCalls.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : "",
      authorization: headers.get("authorization") ?? "",
      xAuthorization: headers.get("x-authorization") ?? "",
    });

    if (url.startsWith(`${lineContentBase}/`)) {
      if (imageStatus !== 200) {
        return new Response("failed", { status: imageStatus });
      }

      const responseHeaders = new Headers({ "content-type": imageContentType });

      if (imageContentLength !== null) {
        responseHeaders.set("content-length", String(imageContentLength));
      }

      return new Response(imageBytes, { status: 200, headers: responseHeaders });
    }

    if (url === slipOkUrl) {
      if (beforeSlipOkResponse !== null) {
        await beforeSlipOkResponse();
      }

      return new Response(JSON.stringify(slipOkBody), { status: slipOkStatus, headers: { "content-type": "application/json" } });
    }

    return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
  });
});

afterEach(() => {
  env.SLIPOK_API_KEY = "test-slipok-api-key";
  env.SLIPOK_BRANCH_ID = slipOkBranchId;
  vi.restoreAllMocks();
});

describe("POST /webhook/line image events", () => {
  it("stores the slip under a random key, verifies the public url and closes the exact bill", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S101", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    const tenant = await newTenant(room.id, "สมชาย สลิป");
    await linkTenantByRoomNumber("S101", "U-slip-1", "สมชาย สลิป");

    const bill = await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });
    expect(bill.total).toBe(3550);

    outboundCalls = [];
    slipOkBody = verifiedBody(3550, "TR-0001");

    const response = await sendSlip("U-slip-1", "msg-slip-1");
    expect(response.status).toBe(200);

    const downloads = downloadCalls();
    expect(downloads).toHaveLength(1);
    expect(downloads[0]?.url).toBe(`${lineContentBase}/msg-slip-1/content`);
    expect(downloads[0]?.method).toBe("GET");
    expect(downloads[0]?.authorization).toBe(`Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`);

    const slip = await readOneSlipFor("U-slip-1");
    expect(slip.status).toBe("matched");
    expect(slip.bill_id).toBe(bill.id);
    expect(slip.bill_total).toBe(3550);
    expect(slip.line_user_id).toBe("U-slip-1");
    expect(slip.amount).toBe(3550);
    expect(slip.trans_ref).toBe("TR-0001");
    expect(slip.image_key).toMatch(/^[0-9a-f]{32}\.png$/);
    expect(slip.image_key).not.toContain("msg-slip-1");
    expect(slip.image_key).not.toContain(tenant.id);
    expect(slip.image_key).not.toContain(bill.id);

    const stored = await SELF.fetch(`${slipBaseUrl}/${slip.image_key}`);
    expect(stored.status).toBe(200);
    expect(stored.headers.get("content-type")).toBe("image/png");
    expect(stored.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(new Uint8Array(await stored.arrayBuffer())).toEqual(slipImageBytes);

    const verifies = slipOkCalls();
    expect(verifies).toHaveLength(1);
    expect(verifies[0]?.method).toBe("POST");
    expect(verifies[0]?.url).toBe(slipOkUrl);
    expect(verifies[0]?.xAuthorization).toBe(env.SLIPOK_API_KEY);
    expect(asJson<Record<string, unknown>>(verifies[0]?.body ?? "")).toEqual({
      url: `https://dorm.test/slips/${slip.image_key}`,
      log: false,
      amount: 3550,
    });

    const paid = await billOf("2026-09", bill.id);
    expect(paid.status).toBe("paid");
    expect(paid.paidMethod).toBe("transfer");
    expect(paid.paidAt).toBe(slipPaidAt);

    expect(pushTextsFor("U-slip-1")).toEqual([matchedText("3,550", "กันยายน 2569")]);

    const result = slipResultOf(slip);
    expect(result.verified).toBe(true);
    expect(result.transRef).toBe("TR-0001");
    expect(result.amount).toBe(3550);
    expect(result.date).toBe(slipDate);
  });

  it("closes a bill that carries extra charges using the bill total", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S102", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมหญิง ค่าเพิ่ม");
    await linkTenantByRoomNumber("S102", "U-slip-2", "สมหญิง ค่าเพิ่ม");

    const bill = await generateBill(room.id, {
      waterCurrent: 12,
      electricCurrent: 22,
      charges: [
        { name: "ค่าอินเทอร์เน็ต", amount: 200 },
        { name: "ค่าขยะ", amount: 40 },
      ],
    });
    expect(bill.total).toBe(3790);

    outboundCalls = [];
    slipOkBody = verifiedBody(3790, "TR-0002");

    const response = await sendSlip("U-slip-2", "msg-slip-2");
    expect(response.status).toBe(200);

    expect((await billOf("2026-09", bill.id)).status).toBe("paid");
    expect((await readOneSlipFor("U-slip-2")).status).toBe("matched");
    expect(pushTextsFor("U-slip-2")).toEqual([matchedText("3,790", "กันยายน 2569")]);
  });

  it("closes a flat electric bill using the bill total", async () => {
    await putRates(18, 7);
    const room = await newRoom({
      roomNumber: "S103",
      rent: 3800,
      waterMeterInit: 130,
      electricMeterInit: 460,
      electricMode: "flat",
    });
    await newTenant(room.id, "สมปอง เหมาจ่าย");
    await linkTenantByRoomNumber("S103", "U-slip-3", "สมปอง เหมาจ่าย");

    const bill = await generateBill(room.id, { waterCurrent: 135, electricCurrent: 470, flatElectricAmount: 600 });
    expect(bill.total).toBe(4490);

    outboundCalls = [];
    slipOkBody = verifiedBody(4490, "TR-0003");

    const response = await sendSlip("U-slip-3", "msg-slip-3");
    expect(response.status).toBe(200);

    expect((await billOf("2026-09", bill.id)).status).toBe("paid");
    expect((await readOneSlipFor("U-slip-3")).status).toBe("matched");
    expect(pushTextsFor("U-slip-3")).toEqual([matchedText("4,490", "กันยายน 2569")]);
  });

  it("keeps a bill open when the slip amount differs by fifty satang", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S104", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมศรี ยอดไม่ตรง");
    await linkTenantByRoomNumber("S104", "U-slip-4", "สมศรี ยอดไม่ตรง");

    const bill = await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });
    expect(bill.total).toBe(3550);

    outboundCalls = [];
    slipOkBody = verifiedBody(3550.5, "TR-0004");

    const response = await sendSlip("U-slip-4", "msg-slip-4");
    expect(response.status).toBe(200);

    const slip = await readOneSlipFor("U-slip-4");
    expect(slip.status).toBe("pending_review");
    expect(slip.bill_id).toBe(bill.id);
    expect(slip.bill_total).toBe(3550);
    expect(slip.amount).toBe(3550.5);
    expect(slip.trans_ref).toBe("TR-0004");
    expect(slipResultOf(slip).verified).toBe(true);
    expect(slipResultOf(slip).reason).toBe("mismatch");

    const unchanged = await billOf("2026-09", bill.id);
    expect(unchanged.status).toBe("unpaid");
    expect(unchanged.paidAt).toBeNull();
    expect(unchanged.paidMethod).toBeNull();

    expect(pushTextsFor("U-slip-4")).toEqual([pendingReviewText]);
    expect(pushTextsFor("U-slip-4")).not.toContain(matchedText("3,550", "กันยายน 2569"));
  });

  it("keeps the slip for review when the verification fails", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S105", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมหมาย ตรวจไม่ผ่าน");
    await linkTenantByRoomNumber("S105", "U-slip-5", "สมหมาย ตรวจไม่ผ่าน");

    const bill = await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });

    outboundCalls = [];
    slipOkBody = { success: false, code: 1006, message: "รูปแบบไฟล์รูปภาพไม่ถูกต้อง" };

    const response = await sendSlip("U-slip-5", "msg-slip-5");
    expect(response.status).toBe(200);

    const slip = await readOneSlipFor("U-slip-5");
    expect(slip.status).toBe("pending_review");
    expect(slip.amount).toBeNull();
    expect(slip.trans_ref).toBeNull();
    expect(slip.bill_id).toBe(bill.id);
    expect(slip.bill_total).toBe(3550);

    const result = slipResultOf(slip);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("not_verified");
    expect(result.raw).not.toBeNull();

    expect((await billOf("2026-09", bill.id)).status).toBe("unpaid");
    expect(pushTextsFor("U-slip-5")).toEqual([pendingReviewText]);
  });

  it("keeps the slip for review when SlipOK finds no QR code in the image", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S119", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมนึก ไม่เจอคิวอาร์");
    await linkTenantByRoomNumber("S119", "U-slip-19", "สมนึก ไม่เจอคิวอาร์");

    const bill = await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });

    outboundCalls = [];
    slipOkBody = { success: false, code: 1007, message: "ไม่พบ QR ในรูปภาพ" };

    const response = await sendSlip("U-slip-19", "msg-slip-19");
    expect(response.status).toBe(200);

    const slip = await readOneSlipFor("U-slip-19");
    expect(slip.status).toBe("pending_review");
    expect(slip.amount).toBeNull();
    expect(slip.bill_id).toBe(bill.id);
    expect(slipResultOf(slip).verified).toBe(false);
    expect(slipResultOf(slip).reason).toBe("not_verified");
    expect((await billOf("2026-09", bill.id)).status).toBe("unpaid");
    expect(pushTextsFor("U-slip-19")).toEqual([pendingReviewText]);
  });

  it("keeps the slip for review when the bank is temporarily unavailable", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S120", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมหญิง ธนาคารไม่ว่าง");
    await linkTenantByRoomNumber("S120", "U-slip-20", "สมหญิง ธนาคารไม่ว่าง");

    const bill = await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });

    outboundCalls = [];
    slipOkStatus = 503;
    slipOkBody = { success: false, code: 1009, message: "ธนาคารไม่พร้อมให้บริการชั่วคราว" };

    const response = await sendSlip("U-slip-20", "msg-slip-20");
    expect(response.status).toBe(200);

    const slip = await readOneSlipFor("U-slip-20");
    expect(slip.status).toBe("pending_review");
    expect(slip.bill_id).toBe(bill.id);
    expect(slip.bill_total).toBe(3550);
    expect(slipResultOf(slip).verified).toBe(false);
    expect(slipResultOf(slip).reason).toBe("not_verified");
    expect((await billOf("2026-09", bill.id)).status).toBe("unpaid");
    expect(pushTextsFor("U-slip-20")).toEqual([pendingReviewText]);
  });

  it("never treats a success payload without an amount as a match", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S106", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมนึก ไม่มียอด");
    await linkTenantByRoomNumber("S106", "U-slip-6", "สมนึก ไม่มียอด");

    const bill = await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });

    outboundCalls = [];
    slipOkBody = { success: true, data: { date: "2026-09-03", time: "10:15", bank: "KBANK", sender: "สมชาย ใจดี" } };

    const response = await sendSlip("U-slip-6", "msg-slip-6");
    expect(response.status).toBe(200);

    const slip = await readOneSlipFor("U-slip-6");
    expect(slip.status).toBe("pending_review");
    expect(slip.amount).toBeNull();
    expect(slip.trans_ref).toBeNull();
    expect(slip.bill_id).toBe(bill.id);
    expect(slip.bill_total).toBe(3550);
    expect(slipResultOf(slip).verified).toBe(false);
    expect(slipResultOf(slip).reason).toBe("not_verified");
    expect((await billOf("2026-09", bill.id)).status).toBe("unpaid");
    expect(pushTextsFor("U-slip-6")).toEqual([pendingReviewText]);
  });

  it("keeps the slip for review for a payload without the success flag", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S107", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมจิตร ไม่มีสถานะ");
    await linkTenantByRoomNumber("S107", "U-slip-7", "สมจิตร ไม่มีสถานะ");

    const bill = await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });

    outboundCalls = [];
    slipOkBody = { status: 200, data: { amount: 3550, date: "2026-09-03", time: "10:15", bank: "KBANK", sender: "สมชาย ใจดี", transRef: "TR-0007" } };

    const response = await sendSlip("U-slip-7", "msg-slip-7");
    expect(response.status).toBe(200);

    const slip = await readOneSlipFor("U-slip-7");
    expect(slip.status).toBe("pending_review");
    expect(slip.trans_ref).toBeNull();
    expect(slipResultOf(slip).verified).toBe(false);
    expect(slipResultOf(slip).reason).toBe("not_verified");
    expect((await billOf("2026-09", bill.id)).status).toBe("unpaid");
    expect(pushTextsFor("U-slip-7")).toEqual([pendingReviewText]);
  });

  it("never treats a payload that says success false as verified", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S112", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมพงษ์ สถานะขัดกัน");
    await linkTenantByRoomNumber("S112", "U-slip-12", "สมพงษ์ สถานะขัดกัน");

    const bill = await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });

    outboundCalls = [];
    slipOkStatus = 200;
    slipOkBody = { success: false, code: 1007, message: "ไม่พบ QR ในรูปภาพ", data: { amount: 3550, date: "2026-09-03", time: "10:15" } };

    const response = await sendSlip("U-slip-12", "msg-slip-12");
    expect(response.status).toBe(200);

    const slip = await readOneSlipFor("U-slip-12");
    expect(slip.status).toBe("pending_review");
    expect(slip.trans_ref).toBeNull();
    expect(slip.amount).toBeNull();
    expect(slipResultOf(slip).verified).toBe(false);
    expect(slipResultOf(slip).reason).toBe("not_verified");
    expect((await billOf("2026-09", bill.id)).status).toBe("unpaid");
    expect(pushTextsFor("U-slip-12")).toEqual([pendingReviewText]);
  });

  it("rejects a slip the provider reports as already submitted without touching the bill", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S121", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมปอง สลิปซ้ำผู้ให้บริการ");
    await linkTenantByRoomNumber("S121", "U-slip-21", "สมปอง สลิปซ้ำผู้ให้บริการ");

    const bill = await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });
    expect(bill.total).toBe(3550);

    outboundCalls = [];
    slipOkBody = { success: false, code: 1012, message: "สลิปนี้ถูกส่งเข้ามาแล้ว" };

    const response = await sendSlip("U-slip-21", "msg-slip-21");
    expect(response.status).toBe(200);

    const slip = await readOneSlipFor("U-slip-21");
    expect(slip.status).toBe("rejected");
    expect(slip.bill_id).toBeNull();
    expect(slip.bill_total).toBeNull();
    expect(slipResultOf(slip).verified).toBe(false);
    expect(slipResultOf(slip).reason).toBe("duplicate_slip");

    expect(pushTextsFor("U-slip-21")).toEqual([duplicateText]);

    const unchanged = await billOf("2026-09", bill.id);
    expect(unchanged.status).toBe("unpaid");
    expect(unchanged.paidAt).toBeNull();
    expect(unchanged.paidMethod).toBeNull();
  });

  it("keeps a provider amount mismatch out of the auto-close and lets our comparison decide", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S122", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมศรี ผู้ให้บริการยอดไม่ตรง");
    await linkTenantByRoomNumber("S122", "U-slip-22", "สมศรี ผู้ให้บริการยอดไม่ตรง");

    const bill = await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });
    expect(bill.total).toBe(3550);

    outboundCalls = [];
    slipOkBody = {
      success: false,
      code: 1013,
      message: "ยอดเงินที่ส่งไปไม่ตรงกับสลิป",
      data: { amount: 3500, date: "2026-09-03", time: "10:15", bank: "KBANK", sender: "สมศรี ผู้ให้บริการยอดไม่ตรง", transRef: "TR-3001" },
    };

    const response = await sendSlip("U-slip-22", "msg-slip-22");
    expect(response.status).toBe(200);

    const slip = await readOneSlipFor("U-slip-22");
    expect(slip.status).toBe("pending_review");
    expect(slip.bill_id).toBe(bill.id);
    expect(slip.bill_total).toBe(3550);
    expect(slip.amount).toBe(3500);
    expect(slip.trans_ref).toBe("TR-3001");
    expect(slipResultOf(slip).verified).toBe(true);
    expect(slipResultOf(slip).reason).toBe("mismatch");

    const unchanged = await billOf("2026-09", bill.id);
    expect(unchanged.status).toBe("unpaid");
    expect(pushTextsFor("U-slip-22")).toEqual([pendingReviewText]);
  });

  it("keeps the slip for review when the SlipOK key is not configured", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S108", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมพงษ์ ไม่มีคีย์");
    await linkTenantByRoomNumber("S108", "U-slip-8", "สมพงษ์ ไม่มีคีย์");

    const bill = await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });

    outboundCalls = [];
    env.SLIPOK_API_KEY = "";

    const response = await sendSlip("U-slip-8", "msg-slip-8");
    expect(response.status).toBe(200);

    expect(slipOkCalls()).toEqual([]);

    const slip = await readOneSlipFor("U-slip-8");
    expect(slip.status).toBe("pending_review");
    expect(slip.bill_id).toBe(bill.id);
    expect(slip.bill_total).toBe(3550);
    expect(slipResultOf(slip).verified).toBe(false);
    expect(slipResultOf(slip).reason).toBe("not_verified");
    expect((await billOf("2026-09", bill.id)).status).toBe("unpaid");
    expect(pushTextsFor("U-slip-8")).toEqual([pendingReviewText]);
  });

  it("keeps the slip for review when the SlipOK branch id is not configured", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S123", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมหมาย ไม่มีสาขา");
    await linkTenantByRoomNumber("S123", "U-slip-23", "สมหมาย ไม่มีสาขา");

    const bill = await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });

    outboundCalls = [];
    env.SLIPOK_BRANCH_ID = "";

    const response = await sendSlip("U-slip-23", "msg-slip-23");
    expect(response.status).toBe(200);

    expect(slipOkCalls()).toEqual([]);

    const slip = await readOneSlipFor("U-slip-23");
    expect(slip.status).toBe("pending_review");
    expect(slip.bill_id).toBe(bill.id);
    expect(slipResultOf(slip).verified).toBe(false);
    expect(slipResultOf(slip).reason).toBe("not_verified");
    expect((await billOf("2026-09", bill.id)).status).toBe("unpaid");
    expect(pushTextsFor("U-slip-23")).toEqual([pendingReviewText]);
  });

  it("keeps the slip for review when the room has no unpaid bill", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S109", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมชาย จ่ายแล้ว");
    await linkTenantByRoomNumber("S109", "U-slip-9", "สมชาย จ่ายแล้ว");

    const bill = await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });
    const settled = await post(`${billsUrl}/${bill.id}/mark-paid`, { method: "cash", paidAt: "2026-09-02" });
    expect(settled.status).toBe(200);

    outboundCalls = [];
    slipOkBody = verifiedBody(3550, "TR-0009");

    const response = await sendSlip("U-slip-9", "msg-slip-9");
    expect(response.status).toBe(200);

    const slip = await readOneSlipFor("U-slip-9");
    expect(slip.status).toBe("pending_review");
    expect(slip.bill_id).toBeNull();
    expect(slip.bill_total).toBeNull();
    expect(slip.amount).toBe(3550);
    expect(slip.trans_ref).toBe("TR-0009");
    expect(slipResultOf(slip).reason).toBe("no_unpaid_bill");

    const listed = await listBills("2026-09");
    const unchanged = pick(listed, (item) => item.roomId === room.id);
    expect(listed.filter((item) => item.roomId === room.id)).toHaveLength(1);
    expect(unchanged.status).toBe("paid");
    expect(unchanged.paidMethod).toBe("cash");
    expect(unchanged.paidAt).toBe("2026-09-02");
    expect(pushTextsFor("U-slip-9")).toEqual([pendingReviewText]);
  });

  it("rejects a resent slip and never closes a second bill with the same reference", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S110", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมศักดิ์ ส่งซ้ำ");
    await linkTenantByRoomNumber("S110", "U-slip-10", "สมศักดิ์ ส่งซ้ำ");

    const first = await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 }, "2026-09");
    const second = await generateBill(room.id, { waterCurrent: 14, electricCurrent: 24 }, "2026-10");
    expect(first.total).toBe(3550);
    expect(second.total).toBe(3550);

    outboundCalls = [];
    slipOkBody = verifiedBody(3550, "TR-0010");

    const opened = await sendSlip("U-slip-10", "msg-slip-10a");
    expect(opened.status).toBe(200);

    const closed = await readOneSlipFor("U-slip-10");
    expect(closed.status).toBe("matched");
    expect(closed.bill_id).toBe(second.id);
    expect(pushTextsFor("U-slip-10")).toEqual([matchedText("3,550", "ตุลาคม 2569")]);

    outboundCalls = [];
    const resent = await sendSlip("U-slip-10", "msg-slip-10b");
    expect(resent.status).toBe(200);

    const slips = await readSlipsFor("U-slip-10");
    expect(slips).toHaveLength(2);

    const matched = pick(slips, (slip) => slip.status === "matched");
    const rejected = pick(slips, (slip) => slip.status === "rejected");
    expect(matched.id).toBe(closed.id);
    expect(rejected.bill_id).toBeNull();
    expect(rejected.bill_total).toBeNull();
    expect(rejected.amount).toBe(3550);
    expect(rejected.trans_ref).toBe("TR-0010");
    expect(rejected.image_key).not.toBe(matched.image_key);

    const result = slipResultOf(rejected);
    expect(result.verified).toBe(true);
    expect(result.reason).toBe("duplicate_slip");

    expect(pushTextsFor("U-slip-10")).toEqual([duplicateText]);

    const september = await billOf("2026-09", first.id);
    expect(september.status).toBe("unpaid");
    expect(september.paidAt).toBeNull();

    const october = await billOf("2026-10", second.id);
    expect(october.status).toBe("paid");
    expect(october.paidAt).toBe(slipPaidAt);
  });

  it("stores nothing and asks an unlinked sender to connect first", async () => {
    outboundCalls = [];
    const imagesBefore = await storedImageKeys();

    const response = await sendSlip("U-stray", "msg-stray");
    expect(response.status).toBe(200);

    expect(replyTexts()).toEqual([notLinkedText]);
    expect(downloadCalls()).toEqual([]);
    expect(slipOkCalls()).toEqual([]);
    expect(pushTexts()).toEqual([]);
    expect(await readSlipsFor("U-stray")).toEqual([]);
    expect(await storedImageKeys()).toEqual(imagesBefore);
  });

  it("answers honestly and stores nothing when the download from LINE fails", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S111", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมพร ดาวน์โหลดไม่ผ่าน");
    await linkTenantByRoomNumber("S111", "U-slip-11", "สมพร ดาวน์โหลดไม่ผ่าน");

    outboundCalls = [];
    imageStatus = 500;
    const imagesBefore = await storedImageKeys();

    const response = await sendSlip("U-slip-11", "msg-slip-11");
    expect(response.status).toBe(200);

    expect(downloadCalls()).toHaveLength(1);
    expect(replyTexts()).toEqual([downloadFailedText]);
    expect(slipOkCalls()).toEqual([]);
    expect(await readSlipsFor("U-slip-11")).toEqual([]);
    expect(await storedImageKeys()).toEqual(imagesBefore);
  });

  it("stores a canonical paid time and falls back to now when the provider date is unusable", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S113", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมหญิง ไม่มีวันที่");
    await linkTenantByRoomNumber("S113", "U-slip-13", "สมหญิง ไม่มีวันที่");

    const bill = await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });

    outboundCalls = [];
    slipOkBody = verifiedBody(3550, "TR-0013", "17/09/2026");

    const response = await sendSlip("U-slip-13", "msg-slip-13");
    expect(response.status).toBe(200);

    const slip = await readOneSlipFor("U-slip-13");
    expect(slip.status).toBe("matched");
    expect(slipResultOf(slip).date).toBeNull();

    const paid = await billOf("2026-09", bill.id);
    expect(paid.status).toBe("paid");
    expect(paid.paidMethod).toBe("transfer");
    expect(paid.paidAt).not.toBeNull();
    expect(paid.paidAt).not.toBe(slipPaidAt);
    expect(Number.isNaN(new Date(paid.paidAt ?? "").getTime())).toBe(false);
  });

  it("refuses a slip image whose body exceeds the size cap without storing anything", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S114", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมชาย รูปใหญ่");
    await linkTenantByRoomNumber("S114", "U-slip-14", "สมชาย รูปใหญ่");

    const bill = await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });

    outboundCalls = [];
    slipOkBody = verifiedBody(3550, "TR-0014");
    imageBytes = new Uint8Array(5 * 1024 * 1024 + 1);
    const imagesBefore = await storedImageKeys();

    const response = await sendSlip("U-slip-14", "msg-slip-14");
    expect(response.status).toBe(200);

    expect(downloadCalls()).toHaveLength(1);
    expect(replyTexts()).toEqual([downloadFailedText]);
    expect(slipOkCalls()).toEqual([]);
    expect(await readSlipsFor("U-slip-14")).toEqual([]);
    expect(await storedImageKeys()).toEqual(imagesBefore);
    expect((await billOf("2026-09", bill.id)).status).toBe("unpaid");
  });

  it("refuses a slip image whose declared length exceeds the size cap", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S115", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมหญิง ประกาศขนาด");
    await linkTenantByRoomNumber("S115", "U-slip-15", "สมหญิง ประกาศขนาด");

    await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });

    outboundCalls = [];
    slipOkBody = verifiedBody(3550, "TR-0015");
    imageBytes = slipImageBytes;
    imageContentLength = 5 * 1024 * 1024 + 1;
    const imagesBefore = await storedImageKeys();

    const response = await sendSlip("U-slip-15", "msg-slip-15");
    expect(response.status).toBe(200);

    expect(downloadCalls()).toHaveLength(1);
    expect(replyTexts()).toEqual([downloadFailedText]);
    expect(slipOkCalls()).toEqual([]);
    expect(await readSlipsFor("U-slip-15")).toEqual([]);
    expect(await storedImageKeys()).toEqual(imagesBefore);
  });

  it("refuses a slip whose content type is not an allowed image type", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S116", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมปอง ชนิดไฟล์ผิด");
    await linkTenantByRoomNumber("S116", "U-slip-16", "สมปอง ชนิดไฟล์ผิด");

    await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });

    outboundCalls = [];
    slipOkBody = verifiedBody(3550, "TR-0016");
    imageContentType = "image/svg+xml";
    const imagesBefore = await storedImageKeys();

    const response = await sendSlip("U-slip-16", "msg-slip-16");
    expect(response.status).toBe(200);

    expect(downloadCalls()).toHaveLength(1);
    expect(replyTexts()).toEqual([downloadFailedText]);
    expect(slipOkCalls()).toEqual([]);
    expect(await readSlipsFor("U-slip-16")).toEqual([]);
    expect(await storedImageKeys()).toEqual(imagesBefore);
  });

  it("never re-pays a bill the owner settled while the slip was being verified", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S117", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมปอง จ่ายก่อน");
    await linkTenantByRoomNumber("S117", "U-slip-17", "สมปอง จ่ายก่อน");

    const bill = await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });

    outboundCalls = [];
    slipOkBody = verifiedBody(3550, "TR-0017");
    beforeSlipOkResponse = async () => {
      await env.DB.prepare("UPDATE bills SET status = 'paid', paid_at = ?, paid_method = ? WHERE id = ?")
        .bind("2026-09-02", "cash", bill.id)
        .run();
    };

    const response = await sendSlip("U-slip-17", "msg-slip-17");
    expect(response.status).toBe(200);

    const slip = await readOneSlipFor("U-slip-17");
    expect(slip.status).toBe("pending_review");
    expect(slip.bill_id).toBeNull();
    expect(slip.bill_total).toBeNull();
    expect(slip.trans_ref).toBe("TR-0017");
    expect(slipResultOf(slip).reason).toBe("no_unpaid_bill");

    const settled = await billOf("2026-09", bill.id);
    expect(settled.status).toBe("paid");
    expect(settled.paidMethod).toBe("cash");
    expect(settled.paidAt).toBe("2026-09-02");
    expect(pushTextsFor("U-slip-17")).toEqual([pendingReviewText]);
  });

  it("cannot let two webhooks with the same transfer reference close two bills", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S118", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมศักดิ์ แข่งกัน");
    await linkTenantByRoomNumber("S118", "U-slip-18", "สมศักดิ์ แข่งกัน");

    const first = await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 }, "2026-09");
    const second = await generateBill(room.id, { waterCurrent: 14, electricCurrent: 24 }, "2026-10");
    expect(first.total).toBe(3550);
    expect(second.total).toBe(3550);

    outboundCalls = [];
    slipOkBody = verifiedBody(3550, "TR-0018");

    const [a, b] = await Promise.all([sendSlip("U-slip-18", "msg-slip-18a"), sendSlip("U-slip-18", "msg-slip-18b")]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const slips = await readSlipsFor("U-slip-18");
    expect(slips).toHaveLength(2);
    expect(slips.filter((slip) => slip.status === "matched")).toHaveLength(1);
    expect(slips.filter((slip) => slip.status === "rejected")).toHaveLength(1);

    const september = await billOf("2026-09", first.id);
    const october = await billOf("2026-10", second.id);
    expect([september.status, october.status].filter((status) => status === "paid")).toHaveLength(1);
  });
});

describe("owner alert for slips that land in review", () => {
  it("pushes the owner the room, the tenant, the slip amount and the compared bill total", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S201", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมชาย แจ้งเจ้าของ");
    await linkTenantByRoomNumber("S201", "U-alert-1", "สมชาย แจ้งเจ้าของ");
    await linkOwner("U-boss-1");

    const bill = await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });
    expect(bill.total).toBe(3550);

    outboundCalls = [];
    slipOkBody = verifiedBody(3550.5, "TR-2001");

    const response = await sendSlip("U-alert-1", "msg-alert-1");
    expect(response.status).toBe(200);

    expect(pushTextsFor("U-alert-1")).toEqual([pendingReviewText]);
    expect(pushTextsFor("U-boss-1")).toEqual([
      ownerAlertText("S201", "สมชาย แจ้งเจ้าของ", "ยอดในสลิป 3,550.50 บาท", "เทียบกับยอดบิล 3,550 บาท"),
    ]);

    const slip = await readOneSlipFor("U-alert-1");
    expect(slip.status).toBe("pending_review");
    expect(slip.bill_id).toBe(bill.id);
    expect(slip.bill_total).toBe(3550);
  });

  it("tells the owner there is no bill to compare when the room has no unpaid bill", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S202", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมหญิง ไม่มีบิลค้าง");
    await linkTenantByRoomNumber("S202", "U-alert-2", "สมหญิง ไม่มีบิลค้าง");
    await linkOwner("U-boss-2");

    outboundCalls = [];
    slipOkBody = verifiedBody(3550, "TR-2002");

    const response = await sendSlip("U-alert-2", "msg-alert-2");
    expect(response.status).toBe(200);

    expect(pushTextsFor("U-boss-2")).toEqual([
      ownerAlertText("S202", "สมหญิง ไม่มีบิลค้าง", "ยอดในสลิป 3,550 บาท", "ยังไม่มีบิลค้างให้เทียบ"),
    ]);

    const slip = await readOneSlipFor("U-alert-2");
    expect(slip.status).toBe("pending_review");
    expect(slipResultOf(slip).reason).toBe("no_unpaid_bill");
  });

  it("keeps the slip and pushes nothing extra when the owner has no LINE link", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S203", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมหมาย ยังไม่เชื่อมเจ้าของ");
    await linkTenantByRoomNumber("S203", "U-alert-3", "สมหมาย ยังไม่เชื่อมเจ้าของ");
    await unlinkOwner();

    const bill = await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });

    outboundCalls = [];
    slipOkBody = verifiedBody(3550.5, "TR-2003");

    const response = await sendSlip("U-alert-3", "msg-alert-3");
    expect(response.status).toBe(200);

    expect(pushTexts()).toEqual([{ to: "U-alert-3", text: pendingReviewText }]);

    const slip = await readOneSlipFor("U-alert-3");
    expect(slip.status).toBe("pending_review");
    expect(slip.bill_id).toBe(bill.id);
  });
});

describe("GET /api/slips", () => {
  it("lists only pending review slips by default and carries every field the queue renders", async () => {
    await putRates(18, 7);
    const reviewRoom = await newRoom({ roomNumber: "S204", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(reviewRoom.id, "สมหญิง คิวรอตรวจ");
    await linkTenantByRoomNumber("S204", "U-queue-1", "สมหญิง คิวรอตรวจ");
    outboundCalls = [];
    const reviewBill = await generateBill(reviewRoom.id, { waterCurrent: 12, electricCurrent: 22 });

    const closedRoom = await newRoom({ roomNumber: "S205", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(closedRoom.id, "สมปอง ปิดอัตโนมัติ");
    await linkTenantByRoomNumber("S205", "U-queue-2", "สมปอง ปิดอัตโนมัติ");
    const closedBill = await generateBill(closedRoom.id, { waterCurrent: 12, electricCurrent: 22 });

    outboundCalls = [];
    slipOkBody = verifiedBody(3550.5, "TR-2004");
    expect((await sendSlip("U-queue-1", "msg-queue-1")).status).toBe(200);

    slipOkBody = verifiedBody(3550, "TR-2005");
    expect((await sendSlip("U-queue-2", "msg-queue-2")).status).toBe(200);

    const reviewSlip = await readOneSlipFor("U-queue-1");
    const closedSlip = await readOneSlipFor("U-queue-2");
    expect(reviewSlip.status).toBe("pending_review");
    expect(closedSlip.status).toBe("matched");

    const queue = await listQueue();
    expect(queue.every((slip) => slip.status === "pending_review")).toBe(true);
    expect(queueIds(queue)).toContain(reviewSlip.id);
    expect(queueIds(queue)).not.toContain(closedSlip.id);

    const item = pick(queue, (slip) => slip.id === reviewSlip.id);
    expect(item.createdAt).toBe(reviewSlip.created_at);
    expect(item.imageKey).toBe(reviewSlip.image_key);
    expect(item.imageUrl).toBe(`/slips/${reviewSlip.image_key}`);
    expect(item.reason).toBe("mismatch");
    expect(item.slipAmount).toBe(3550.5);
    expect(item.verified).toBe(true);
    expect(item.verify).toEqual({ verified: true, transRef: "TR-2004", date: slipDate });
    expect(item.transferAt).toBe(slipDate);
    expect(item.bill).toEqual({
      id: reviewBill.id,
      roomNumber: "S204",
      tenantName: "สมหญิง คิวรอตรวจ",
      period: "2026-09",
      total: 3550,
    });

    const history = await listQueue(`?billId=${closedBill.id}`);
    expect(history.every((slip) => slip.bill?.id === closedBill.id)).toBe(true);
    expect(queueIds(history)).toContain(closedSlip.id);

    const settledSlip = pick(history, (slip) => slip.id === closedSlip.id);
    expect(settledSlip.status).toBe("matched");
    expect(settledSlip.reason).toBeNull();
    expect(settledSlip.bill).toEqual({
      id: closedBill.id,
      roomNumber: "S205",
      tenantName: "สมปอง ปิดอัตโนมัติ",
      period: "2026-09",
      total: 3550,
    });

    const pendingHistory = await listQueue(`?billId=${reviewBill.id}`);
    expect(pendingHistory.every((slip) => slip.bill?.id === reviewBill.id)).toBe(true);
    expect(queueIds(pendingHistory)).toContain(reviewSlip.id);

    const matched = await listQueue("?status=matched");
    expect(matched.every((slip) => slip.status === "matched")).toBe(true);
    expect(queueIds(matched)).toContain(closedSlip.id);
    expect(queueIds(matched)).not.toContain(reviewSlip.id);

    const invalid = await SELF.fetch(`${slipsUrl}?status=done`);
    expect(invalid.status).toBe(400);

    const invalidBody = await invalid.json<ErrorBody>();
    expect(invalidBody.ok).toBe(false);
    expect(invalidBody.error.code).toBe("VALIDATION");
    expect(invalidBody.error.field).toBe("status");
  });
});

describe("POST /api/slips/:id/resolve", () => {
  it("settles a queued slip into a paid bill and sends the tenant the confirmation", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S206", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมศรี ปิดจากคิว");
    await linkTenantByRoomNumber("S206", "U-resolve-1", "สมศรี ปิดจากคิว");
    await linkOwner("U-boss-6");

    const bill = await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });
    expect(bill.total).toBe(3550);

    outboundCalls = [];
    slipOkBody = verifiedBody(3550.5, "TR-2006");
    expect((await sendSlip("U-resolve-1", "msg-resolve-1")).status).toBe(200);

    const slip = await readOneSlipFor("U-resolve-1");
    expect(slip.status).toBe("pending_review");
    expect(queueIds(await listQueue())).toContain(slip.id);

    outboundCalls = [];
    const response = await resolveSlip(slip.id, { action: "settle" });
    expect(response.status).toBe(200);

    const body = await response.json<{ ok: boolean; slip: QueueSlip }>();
    expect(body.ok).toBe(true);
    expect(body.slip.id).toBe(slip.id);
    expect(body.slip.status).toBe("matched");
    expect(body.slip.bill).toEqual({
      id: bill.id,
      roomNumber: "S206",
      tenantName: "สมศรี ปิดจากคิว",
      period: "2026-09",
      total: 3550,
    });

    const paid = await billOf("2026-09", bill.id);
    expect(paid.status).toBe("paid");
    expect(paid.paidMethod).toBe("transfer");
    expect(paid.paidAt).toBe(slipPaidAt);

    const stored = await readOneSlipFor("U-resolve-1");
    expect(stored.status).toBe("matched");
    expect(stored.bill_id).toBe(bill.id);
    expect(stored.bill_total).toBe(3550);

    expect(pushTextsFor("U-resolve-1")).toEqual([matchedText("3,550", "กันยายน 2569")]);
    expect(pushTextsFor("U-boss-6")).toEqual([]);
    expect(queueIds(await listQueue())).not.toContain(slip.id);
  });

  it("refuses to settle against a bill that is already paid and changes nothing", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S207", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมหมาย ปิดไปแล้ว");
    await linkTenantByRoomNumber("S207", "U-resolve-2", "สมหมาย ปิดไปแล้ว");

    const bill = await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });

    outboundCalls = [];
    slipOkBody = verifiedBody(3550.5, "TR-2007");
    expect((await sendSlip("U-resolve-2", "msg-resolve-2")).status).toBe(200);

    const slip = await readOneSlipFor("U-resolve-2");
    expect(slip.status).toBe("pending_review");

    expect((await post(`${billsUrl}/${bill.id}/mark-paid`, { method: "cash", paidAt: "2026-09-02" })).status).toBe(200);

    outboundCalls = [];
    const response = await resolveSlip(slip.id, { action: "settle" });
    expect(response.status).toBe(409);
    expect((await response.json<ErrorBody>()).error.code).toBe("CONFLICT");

    const unchanged = await billOf("2026-09", bill.id);
    expect(unchanged.status).toBe("paid");
    expect(unchanged.paidMethod).toBe("cash");
    expect(unchanged.paidAt).toBe("2026-09-02");

    const stored = await readOneSlipFor("U-resolve-2");
    expect(stored.status).toBe("pending_review");
    expect(stored.bill_id).toBe(bill.id);
    expect(stored.bill_total).toBe(3550);
    expect(pushTexts()).toEqual([]);
  });

  it("refuses to settle a slip whose transfer reference already closed a bill", async () => {
    await putRates(18, 7);
    const firstRoom = await newRoom({ roomNumber: "S208", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(firstRoom.id, "สมศักดิ์ สลิปซ้ำคิว");
    await linkTenantByRoomNumber("S208", "U-resolve-3", "สมศักดิ์ สลิปซ้ำคิว");
    outboundCalls = [];
    const firstBill = await generateBill(firstRoom.id, { waterCurrent: 12, electricCurrent: 22 });

    const secondRoom = await newRoom({ roomNumber: "S209", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(secondRoom.id, "สมบัติ สลิปซ้ำคิว");
    await linkTenantByRoomNumber("S209", "U-resolve-4", "สมบัติ สลิปซ้ำคิว");
    const secondBill = await generateBill(secondRoom.id, { waterCurrent: 12, electricCurrent: 22 });

    outboundCalls = [];
    slipOkBody = verifiedBody(3550.5, "TR-2008");
    expect((await sendSlip("U-resolve-3", "msg-resolve-3")).status).toBe(200);
    slipOkBody = verifiedBody(3550.5, "TR-2008");
    expect((await sendSlip("U-resolve-4", "msg-resolve-4")).status).toBe(200);

    const firstSlip = await readOneSlipFor("U-resolve-3");
    const secondSlip = await readOneSlipFor("U-resolve-4");
    expect(firstSlip.status).toBe("pending_review");
    expect(secondSlip.status).toBe("pending_review");
    expect(firstSlip.trans_ref).toBe("TR-2008");
    expect(secondSlip.trans_ref).toBe("TR-2008");
    expect(firstSlip.bill_id).toBe(firstBill.id);
    expect(secondSlip.bill_id).toBe(secondBill.id);

    expect((await resolveSlip(firstSlip.id, { action: "settle" })).status).toBe(200);

    outboundCalls = [];
    const response = await resolveSlip(secondSlip.id, { action: "settle" });
    expect(response.status).toBe(409);
    expect((await response.json<ErrorBody>()).error.code).toBe("CONFLICT");

    const unchanged = await billOf("2026-09", secondBill.id);
    expect(unchanged.status).toBe("unpaid");
    expect(unchanged.paidAt).toBeNull();

    const stored = await readOneSlipFor("U-resolve-4");
    expect(stored.status).toBe("pending_review");
    expect(stored.bill_id).toBe(secondBill.id);
    expect(pushTexts()).toEqual([]);
  });

  it("refuses to resolve a slip that was already decided", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S210", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมปอง ตัดสินแล้ว");
    await linkTenantByRoomNumber("S210", "U-resolve-5", "สมปอง ตัดสินแล้ว");

    await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });

    outboundCalls = [];
    slipOkBody = verifiedBody(3550.5, "TR-2009");
    expect((await sendSlip("U-resolve-5", "msg-resolve-5")).status).toBe(200);

    const slip = await readOneSlipFor("U-resolve-5");
    expect((await resolveSlip(slip.id, { action: "settle" })).status).toBe(200);

    outboundCalls = [];
    const settledAgain = await resolveSlip(slip.id, { action: "settle" });
    expect(settledAgain.status).toBe(409);
    expect((await settledAgain.json<ErrorBody>()).error.code).toBe("CONFLICT");

    const rejected = await resolveSlip(slip.id, { action: "reject" });
    expect(rejected.status).toBe(409);
    expect((await rejected.json<ErrorBody>()).error.code).toBe("CONFLICT");
    expect(pushTexts()).toEqual([]);
  });

  it("closes the bill named in the body and asks for one when the slip has no bill", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S211", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมชาย เลือกบิลเอง");
    await linkTenantByRoomNumber("S211", "U-resolve-6", "สมชาย เลือกบิลเอง");

    outboundCalls = [];
    slipOkBody = verifiedBody(3550, "TR-2010");
    expect((await sendSlip("U-resolve-6", "msg-resolve-6")).status).toBe(200);

    const slip = await readOneSlipFor("U-resolve-6");
    expect(slip.status).toBe("pending_review");
    expect(slip.bill_id).toBeNull();
    expect(slipResultOf(slip).reason).toBe("no_unpaid_bill");

    const missing = await resolveSlip(slip.id, { action: "settle" });
    expect(missing.status).toBe(400);

    const missingBody = await missing.json<ErrorBody>();
    expect(missingBody.error.code).toBe("VALIDATION");
    expect(missingBody.error.field).toBe("billId");

    const unknown = await resolveSlip(slip.id, { action: "settle", billId: "00000000-0000-4000-8000-000000000000" });
    expect(unknown.status).toBe(404);
    expect((await unknown.json<ErrorBody>()).error.code).toBe("NOT_FOUND");

    const bill = await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });
    expect(bill.total).toBe(3550);

    outboundCalls = [];
    const response = await resolveSlip(slip.id, { action: "settle", billId: bill.id });
    expect(response.status).toBe(200);

    const body = await response.json<{ ok: boolean; slip: QueueSlip }>();
    expect(body.slip.status).toBe("matched");
    expect(body.slip.bill).toEqual({
      id: bill.id,
      roomNumber: "S211",
      tenantName: "สมชาย เลือกบิลเอง",
      period: "2026-09",
      total: 3550,
    });

    const paid = await billOf("2026-09", bill.id);
    expect(paid.status).toBe("paid");
    expect(paid.paidMethod).toBe("transfer");
    expect(paid.paidAt).toBe(slipPaidAt);

    const stored = await readOneSlipFor("U-resolve-6");
    expect(stored.status).toBe("matched");
    expect(stored.bill_id).toBe(bill.id);
    expect(stored.bill_total).toBe(3550);
    expect(pushTextsFor("U-resolve-6")).toEqual([matchedText("3,550", "กันยายน 2569")]);
  });

  it("rejects a slip without touching the bill and without pushing anything", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S212", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมนึก ปฏิเสธสลิป");
    await linkTenantByRoomNumber("S212", "U-resolve-7", "สมนึก ปฏิเสธสลิป");

    const bill = await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });

    outboundCalls = [];
    slipOkBody = verifiedBody(3550.5, "TR-2011");
    expect((await sendSlip("U-resolve-7", "msg-resolve-7")).status).toBe(200);

    const slip = await readOneSlipFor("U-resolve-7");
    expect(slip.status).toBe("pending_review");
    expect(queueIds(await listQueue())).toContain(slip.id);

    outboundCalls = [];
    const response = await resolveSlip(slip.id, { action: "reject" });
    expect(response.status).toBe(200);

    const body = await response.json<{ ok: boolean; slip: QueueSlip }>();
    expect(body.slip.status).toBe("rejected");
    expect(body.slip.reason).toBe("mismatch");
    expect(body.slip.bill).toEqual({
      id: bill.id,
      roomNumber: "S212",
      tenantName: "สมนึก ปฏิเสธสลิป",
      period: "2026-09",
      total: 3550,
    });

    const stored = await readOneSlipFor("U-resolve-7");
    expect(stored.status).toBe("rejected");
    expect(stored.bill_id).toBe(bill.id);
    expect(stored.bill_total).toBe(3550);
    expect(stored.trans_ref).toBe("TR-2011");

    const result = slipResultOf(stored);
    expect(result.verified).toBe(true);
    expect(result.reason).toBe("mismatch");
    expect(result.decision).toBe("rejected");
    expect(typeof result.decidedAt).toBe("string");

    const untouched = await billOf("2026-09", bill.id);
    expect(untouched.status).toBe("unpaid");
    expect(untouched.paidAt).toBeNull();
    expect(untouched.paidMethod).toBeNull();

    expect(pushTexts()).toEqual([]);
    expect(queueIds(await listQueue())).not.toContain(slip.id);
    expect(queueIds(await listQueue(`?billId=${bill.id}`))).toContain(slip.id);
  });

  it("answers 404 for an unknown slip and 400 for an unknown action", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";

    const settled = await resolveSlip(missing, { action: "settle" });
    expect(settled.status).toBe(404);
    expect((await settled.json<ErrorBody>()).error.code).toBe("NOT_FOUND");

    const rejected = await resolveSlip(missing, { action: "reject" });
    expect(rejected.status).toBe(404);
    expect((await rejected.json<ErrorBody>()).error.code).toBe("NOT_FOUND");

    const invalid = await resolveSlip(missing, { action: "approve" });
    expect(invalid.status).toBe(400);

    const invalidBody = await invalid.json<ErrorBody>();
    expect(invalidBody.error.code).toBe("VALIDATION");
    expect(invalidBody.error.field).toBe("action");
  });
});

describe("GET /slips/:file", () => {
  it("answers 404 for an unknown key", async () => {
    const response = await SELF.fetch(`${slipBaseUrl}/00000000000000000000000000000000.png`);
    expect(response.status).toBe(404);

    const body = await response.json<ErrorBody>();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("answers 404 for a file that is not a slip image", async () => {
    const response = await SELF.fetch(`${slipBaseUrl}/slip.txt`);
    expect(response.status).toBe(404);
    expect((await response.json<ErrorBody>()).error.code).toBe("NOT_FOUND");
  });
});
