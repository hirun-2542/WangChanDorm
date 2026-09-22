import { SELF, createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/worker/index";
import { type TestSession, configurePayout, createFamily, signIn, withAuth } from "./auth-helper";
import { flexStrings } from "./flex";

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

/** เวลาบนสลิปตามที่ผู้ให้บริการอ่านได้ (10:15:07 น. ไทย = 03:15:07Z) */
const slipTimestamp = "2026-09-03T03:15:07.000Z";
const slipDate = slipTimestamp;
const slipPaidAt = slipTimestamp;

let session: TestSession;

beforeAll(async () => {
  session = await signIn();
  await configurePayout();
});



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
  verify: {
    verified: boolean;
    transRef: string | null;
    date: string | null;
    code: number | null;
    message: string | null;
    detail: string | null;
  };
  transferAt: string | null;
}

interface OutboundCall {
  url: string;
  method: string;
  body: string;
  contentType: string;
  form: FormData;
  authorization: string;
  xAuthorization: string;
}

interface LineMessage {
  type: string;
  altText?: string;
  contents?: unknown;
}

interface PushBody {
  to: string;
  messages: LineMessage[];
}

interface ReplyBody {
  replyToken: string;
  messages: LineMessage[];
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

function asFile(value: string | File | null): File {
  if (!(value instanceof File)) {
    throw new Error("expected a file part");
  }

  return value;
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
  const ctx = createExecutionContext();
  const response = await app.fetch(
    new Request(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "x-line-signature": await sign(body) },
      body,
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);

  return response;
}

let eventSeq = 0;

/** LINE ส่ง webhookEventId มาเสมอ ใช้ค่าที่ไม่ซ้ำเพื่อไม่ให้เหตุการณ์ข้ามเทสต์ถูกกันซ้ำ */
function uniqueEventId(): string {
  eventSeq += 1;
  return `evt-${String(eventSeq)}-${Math.random().toString(16).slice(2)}`;
}

function textEvent(userId: string, replyToken: string, text: string): Record<string, unknown> {
  return {
    type: "message",
    replyToken,
    timestamp: 0,
    mode: "active",
    webhookEventId: uniqueEventId(),
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
    webhookEventId: uniqueEventId(),
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

function pushMessages(): PushBody[] {
  return outboundCalls
    .filter((call) => call.url === linePushUrl)
    .map((call) => asJson<PushBody>(call.body));
}

function pushTexts(): PushBody[] {
  return pushMessages();
}

function pushStringsFor(lineUserId: string): string[] {
  return pushMessages()
    .filter((push) => push.to === lineUserId)
    .flatMap((push) => push.messages.flatMap((message) => flexStrings(message)));
}

function pushTextFor(lineUserId: string): string {
  return pushStringsFor(lineUserId).join(" ");
}

function expectPushed(lineUserId: string, ...needles: string[]): void {
  const haystack = pushTextFor(lineUserId);

  for (const needle of needles) {
    expect(haystack).toContain(needle);
  }
}

function replyText(): string {
  return outboundCalls
    .filter((call) => call.url === lineReplyUrl)
    .flatMap((call) => asJson<ReplyBody>(call.body).messages.flatMap((message) => flexStrings(message)))
    .join(" ");
}

function expectReplied(...needles: string[]): void {
  const haystack = replyText();

  for (const needle of needles) {
    expect(haystack).toContain(needle);
  }
}

interface SlipOkOverrides {
  transDate?: unknown;
  transTime?: unknown;
  transTimestamp?: unknown;
  receiver?: unknown;
}

function verifiedBody(amount: number, transRef: string, overrides: SlipOkOverrides = {}): unknown {
  return {
    success: true,
    data: {
      success: true,
      amount,
      transRef,
      transDate: "20260903",
      transTime: "10:15:07",
      transTimestamp: slipTimestamp,
      receivingBank: "006",
      sendingBank: "004",
      sender: { displayName: "สมชาย ใจดี", name: "SOMCHAI J", proxy: { type: "MSISDN", value: "089xxx1234" } },
      receiver: {
        displayName: "หอพักวังจันทร์",
        name: "WANGCHAN DORM",
        proxy: { type: "MSISDN", value: "081xxx5678" },
        account: { type: "BANKAC", value: "xxx-x-x5678-x" },
      },
      ...overrides,
    },
  };
}

function post(url: string, payload: Record<string, unknown>): Promise<Response> {
  return SELF.fetch(
    url,
    withAuth(session, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

async function putRates(water: number, electric: number): Promise<void> {
  const response = await SELF.fetch(
    settingsUrl,
    withAuth(session, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ defaultWaterRate: water, defaultElectricRate: electric }),
    }),
  );

  expect(response.status).toBe(200);
}

/** ตั้งบัญชีรับเงินของหอ เพื่อให้เทียบกับบัญชีผู้รับบนสลิปได้ */
async function putPayee(promptpayId: string): Promise<void> {
  const response = await SELF.fetch(
    settingsUrl,
    withAuth(session, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ promptpayType: "phone", promptpayId }),
    }),
  );

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
  const response = await SELF.fetch(`${billsUrl}?period=${period}`, withAuth(session));
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

/** เบอร์ที่ลงทะเบียนในเทสต์คือ 081-234-5678 เลขท้าย 4 ตัวจึงเป็น 5678 */
async function linkTenantByRoomNumber(roomNumber: string, lineUserId: string, fullName: string): Promise<void> {
  const response = await postWebhook(lineEvents([textEvent(lineUserId, `tok-${lineUserId}`, `${roomNumber} 5678`)]));
  expect(response.status).toBe(200);
  expectReplied(fullName, roomNumber, "เชื่อม LINE");
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
  const response = await SELF.fetch(`${slipsUrl}${query}`, withAuth(session));
  expect(response.status).toBe(200);
  return (await response.json<{ ok: boolean; slips: QueueSlip[] }>()).slips;
}

function resolveSlip(id: string, payload: Record<string, unknown>): Promise<Response> {
  return post(`${slipsUrl}/${id}/resolve`, payload);
}

async function linkOwner(lineUserId: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO settings (family_id, key, value, updated_at) VALUES (?, 'owner_line_user_id', ?, datetime('now')) ON CONFLICT(family_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  )
    .bind(session.familyId, lineUserId)
    .run();
}

async function unlinkOwner(): Promise<void> {
  await env.DB.prepare("DELETE FROM settings WHERE family_id = ? AND key = 'owner_line_user_id'").bind(session.familyId).run();
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
      contentType: headers.get("content-type") ?? "",
      form: init?.body instanceof FormData ? init.body : new FormData(),
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
  it("stores the slip under a random key, uploads the image to SlipOK and closes the exact bill", async () => {
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

    const unauthenticated = await SELF.fetch(`${slipBaseUrl}/${slip.image_key}`);
    expect(unauthenticated.status).toBe(401);

    const stored = await SELF.fetch(`${slipBaseUrl}/${slip.image_key}`, withAuth(session));
    expect(stored.status).toBe(200);
    expect(stored.headers.get("content-type")).toBe("image/png");
    expect(stored.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await stored.arrayBuffer())).toEqual(slipImageBytes);

    const verifies = slipOkCalls();
    expect(verifies).toHaveLength(1);
    expect(verifies[0]?.method).toBe("POST");
    expect(verifies[0]?.url).toBe(slipOkUrl);
    expect(verifies[0]?.xAuthorization).toBe(env.SLIPOK_API_KEY);
    expect(verifies[0]?.contentType).toBe("");

    const form = await new Request(slipOkUrl, { method: "POST", body: first(verifies).form }).formData();
    const image = asFile(form.get("files"));
    expect(image.name).toBe("slip.png");
    expect(image.type).toBe("image/png");
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(slipImageBytes);
    expect(form.get("log")).toBe("true");
    expect(form.get("amount")).toBe("3550");
    expect([...form.keys()].sort()).toEqual(["amount", "files", "log"]);

    const paid = await billOf("2026-09", bill.id);
    expect(paid.status).toBe("paid");
    expect(paid.paidMethod).toBe("transfer");
    expect(paid.paidAt).toBe(slipPaidAt);

    expectPushed("U-slip-1", "กันยายน 2569", "3,550", "ปิดบิลเรียบร้อย");

    const result = slipResultOf(slip);
    expect(result.verified).toBe(true);
    expect(result.transRef).toBe("TR-0001");
    expect(result.amount).toBe(3550);
    expect(result.date).toBe(slipDate);
  });

  it("blocks slip image download, SlipOK verification and LINE push outright in demo mode, even with keys configured", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S135", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมชาย โหมดสาธิต");
    await linkTenantByRoomNumber("S135", "U-slip-demo", "สมชาย โหมดสาธิต");
    await linkOwner("U-owner-demo");
    await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });

    outboundCalls = [];
    slipOkBody = verifiedBody(3550, "TR-DEMO-BLOCKED");
    const demoModeEnv = env as unknown as { DEMO_MODE: string };
    const originalDemoMode = demoModeEnv.DEMO_MODE;
    demoModeEnv.DEMO_MODE = "1";

    try {
      const response = await sendSlip("U-slip-demo", "msg-slip-demo");
      expect(response.status).toBe(200);

      // การดาวน์โหลดรูปสลิปจาก LINE ก็เป็น outbound call จริงเช่นกัน จึงถูกกันไว้
      // ตั้งแต่ก่อนจะมีข้อมูลให้บันทึกด้วยซ้ำ — ไม่มีแถวสลิปเกิดขึ้นเลย
      expect(await readSlipsFor("U-slip-demo")).toEqual([]);
      expect(outboundCalls).toEqual([]);
    } finally {
      demoModeEnv.DEMO_MODE = originalDemoMode;
    }
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
    expectPushed("U-slip-2", "กันยายน 2569", "3,790");
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
    expectPushed("U-slip-3", "กันยายน 2569", "4,490");
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

    expectPushed("U-slip-4", "ได้รับสลิปแล้ว", "เจ้าของหอจะตรวจสอบ");
    expect(pushTextFor("U-slip-4")).not.toContain("ปิดบิลเรียบร้อย");
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
    expectPushed("U-slip-5", "ได้รับสลิปแล้ว", "เจ้าของหอจะตรวจสอบ");
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
    expectPushed("U-slip-19", "ได้รับสลิปแล้ว", "เจ้าของหอจะตรวจสอบ");
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
    // 1009 = ฝั่งธนาคารยังไม่พร้อม ยังตัดสินสลิปไม่ได้ ไม่ใช่สลิปไม่ผ่าน
    expect(slipResultOf(slip).reason).toBe("verify_failed");
    expect(String(slipResultOf(slip).detail)).toContain("1009");
    expect((await billOf("2026-09", bill.id)).status).toBe("unpaid");
    expectPushed("U-slip-20", "ได้รับสลิปแล้ว", "เจ้าของหอจะตรวจสอบ");
  });

  it("never treats a success payload without an amount as a match", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S106", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมนึก ไม่มียอด");
    await linkTenantByRoomNumber("S106", "U-slip-6", "สมนึก ไม่มียอด");

    const bill = await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });

    outboundCalls = [];
    slipOkBody = { success: true, data: { transDate: "20260903", transTime: "10:15:07", bank: "KBANK", sender: "สมชาย ใจดี" } };

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
    expectPushed("U-slip-6", "ได้รับสลิปแล้ว", "เจ้าของหอจะตรวจสอบ");
  });

  it("keeps the slip for review for a payload without the success flag", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S107", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมจิตร ไม่มีสถานะ");
    await linkTenantByRoomNumber("S107", "U-slip-7", "สมจิตร ไม่มีสถานะ");

    const bill = await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });

    outboundCalls = [];
    slipOkBody = { status: 200, data: { amount: 3550, transDate: "20260903", transTime: "10:15:07", bank: "KBANK", sender: "สมชาย ใจดี", transRef: "TR-0007" } };

    const response = await sendSlip("U-slip-7", "msg-slip-7");
    expect(response.status).toBe(200);

    const slip = await readOneSlipFor("U-slip-7");
    expect(slip.status).toBe("pending_review");
    expect(slip.trans_ref).toBeNull();
    expect(slipResultOf(slip).verified).toBe(false);
    expect(slipResultOf(slip).reason).toBe("not_verified");
    expect((await billOf("2026-09", bill.id)).status).toBe("unpaid");
    expectPushed("U-slip-7", "ได้รับสลิปแล้ว", "เจ้าของหอจะตรวจสอบ");
  });

  it("never treats a payload that says success false as verified", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S112", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมพงษ์ สถานะขัดกัน");
    await linkTenantByRoomNumber("S112", "U-slip-12", "สมพงษ์ สถานะขัดกัน");

    const bill = await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });

    outboundCalls = [];
    slipOkStatus = 200;
    slipOkBody = { success: false, code: 1007, message: "ไม่พบ QR ในรูปภาพ", data: { amount: 3550, transDate: "20260903", transTime: "10:15:07" } };

    const response = await sendSlip("U-slip-12", "msg-slip-12");
    expect(response.status).toBe(200);

    const slip = await readOneSlipFor("U-slip-12");
    expect(slip.status).toBe("pending_review");
    expect(slip.trans_ref).toBeNull();
    expect(slip.amount).toBeNull();
    expect(slipResultOf(slip).verified).toBe(false);
    expect(slipResultOf(slip).reason).toBe("not_verified");
    expect((await billOf("2026-09", bill.id)).status).toBe("unpaid");
    expectPushed("U-slip-12", "ได้รับสลิปแล้ว", "เจ้าของหอจะตรวจสอบ");
  });

  /**
   * provider บอกว่าซ้ำ แต่เรายังไม่พบบิลที่ปิดด้วยสลิปนี้
   *
   * ข้อความเดิม "สลิปนี้ถูกใช้ปิดบิลไปแล้ว" เป็นคำกล่าวอ้างที่เราไม่มีหลักฐาน
   * รองรับ — ในเคสนี้เงินนั้นยังไม่ถูกใช้ปิดบิล จึงต้องเข้าคิวให้เจ้าของหอตรวจ
   * และต้องเก็บเลขอ้างอิง/ยอดที่ผู้ให้บริการอ่านได้ไว้ให้เทียบ
   */
  it("keeps a provider-reported duplicate in review when no bill was closed with it", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S121", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมปอง สลิปซ้ำผู้ให้บริการ");
    await linkTenantByRoomNumber("S121", "U-slip-21", "สมปอง สลิปซ้ำผู้ให้บริการ");

    const bill = await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });
    expect(bill.total).toBe(3550);

    outboundCalls = [];
    slipOkStatus = 400;
    slipOkBody = {
      code: 1012,
      message: "สลิปซ้ำ สลิปนี้เคยส่งเข้ามาในระบบเมื่อ 2026-09-22 02:29:31",
      data: { transRef: "TR-1012", amount: 3550, transDate: "20260903", transTime: "10:15:07", transTimestamp: slipTimestamp },
    };

    const response = await sendSlip("U-slip-21", "msg-slip-21");
    expect(response.status).toBe(200);

    const slip = await readOneSlipFor("U-slip-21");
    expect(slip.status).toBe("pending_review");
    expect(slip.bill_id).toBe(bill.id);
    expect(slip.bill_total).toBe(3550);
    // เลขอ้างอิงและยอดต้องรอดจาก payload ของผู้ให้บริการ ไม่ถูกล้างเป็น null
    expect(slip.trans_ref).toBe("TR-1012");
    expect(slip.amount).toBe(3550);
    expect(slipResultOf(slip).reason).toBe("duplicate_slip");
    expect(slipResultOf(slip).message).toContain("สลิปซ้ำ");

    // ยังไม่ปิดบิล จึงต้องไม่บอกผู้เช่าว่าถูกใช้ไปแล้ว
    expectPushed("U-slip-21", "ระบบเคยเห็นสลิปใบนี้แล้ว", "ยังไม่พบบิลที่ปิดด้วยสลิปนี้");
    expect(pushTextFor("U-slip-21")).not.toContain("ถูกใช้ปิดบิลไปแล้ว");

    const unchanged = await billOf("2026-09", bill.id);
    expect(unchanged.status).toBe("unpaid");
    expect(unchanged.paidAt).toBeNull();
    expect(unchanged.paidMethod).toBeNull();
  });

  /**
   * ผู้ให้บริการอ่านไม่ได้รอบแรก แต่เราอ่านได้และเก็บเลขอ้างอิงไว้
   * พอโอนมาอีกรอบต้องปิดบิลได้ ไม่ใช่ถูกกล่าวหาว่าซ้ำ
   */
  it("closes the bill on a resend whose reference was stored but never used to close one", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S134", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมจิต เก็บเลขอ้างอิงไว้");
    await linkTenantByRoomNumber("S134", "U-slip-34", "สมจิต เก็บเลขอ้างอิงไว้");

    // รอบแรก: ห้องยังไม่มีบิลค้าง ผู้ให้บริการอ่านได้ เราจึงเก็บ TR-0034 ไว้ที่สลิปที่ยังไม่ปิดบิล
    outboundCalls = [];
    slipOkBody = verifiedBody(3500, "TR-0034");
    const firstSend = await sendSlip("U-slip-34", "msg-slip-34a");
    expect(firstSend.status).toBe(200);

    const firstSlip = await readOneSlipFor("U-slip-34");
    expect(firstSlip.status).toBe("pending_review");
    expect(firstSlip.trans_ref).toBe("TR-0034");

    // ออกบิลให้ห้องแล้วส่งสลิปใบเดิมมาอีกครั้ง
    const bill = await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });
    expect(bill.total).toBe(3550);

    outboundCalls = [];
    slipOkBody = verifiedBody(3550, "TR-0034");
    const resend = await sendSlip("U-slip-34", "msg-slip-34b");
    expect(resend.status).toBe(200);

    const slips = await readSlipsFor("U-slip-34");
    expect(slips).toHaveLength(2);

    const matched = pick(slips, (slip) => slip.status === "matched");
    expect(matched.bill_id).toBe(bill.id);
    expect(matched.trans_ref).toBe("TR-0034");
    expect((await billOf("2026-09", bill.id)).status).toBe("paid");
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
      data: { amount: 3500, transDate: "20260903", transTime: "10:15:07", bank: "KBANK", sender: "สมศรี ผู้ให้บริการยอดไม่ตรง", transRef: "TR-3001" },
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
    expectPushed("U-slip-22", "ได้รับสลิปแล้ว", "เจ้าของหอจะตรวจสอบ");
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
    // ตรวจไม่ได้เพราะเราตั้งค่าไม่ครบ ไม่ใช่เพราะสลิปไม่ผ่าน
    expect(slipResultOf(slip).reason).toBe("verify_failed");
    expect(String(slipResultOf(slip).detail)).toContain("SLIPOK_API_KEY");
    expect((await billOf("2026-09", bill.id)).status).toBe("unpaid");
    expectPushed("U-slip-8", "ได้รับสลิปแล้ว", "เจ้าของหอจะตรวจสอบ");
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
    expect(slipResultOf(slip).reason).toBe("verify_failed");
    expect(String(slipResultOf(slip).detail)).toContain("SLIPOK_BRANCH_ID");
    expect((await billOf("2026-09", bill.id)).status).toBe("unpaid");
    expectPushed("U-slip-23", "ได้รับสลิปแล้ว", "เจ้าของหอจะตรวจสอบ");
  });

  it("keeps the slip for review when the room has no unpaid bill and uploads no expected amount", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S109", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมชาย จ่ายแล้ว");
    await linkTenantByRoomNumber("S109", "U-slip-9", "สมชาย จ่ายแล้ว");

    const bill = await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });
    const settled = await post(`${billsUrl}/${bill.id}/mark-paid`, { method: "cash", paidAt: "2026-09-02" });
    expect(settled.status).toBe(200);

    outboundCalls = [];
    imageContentType = "image/jpeg";
    slipOkBody = verifiedBody(3550, "TR-0009");

    const response = await sendSlip("U-slip-9", "msg-slip-9");
    expect(response.status).toBe(200);

    const form = await new Request(slipOkUrl, { method: "POST", body: first(slipOkCalls()).form }).formData();
    expect(form.has("amount")).toBe(false);
    expect(form.get("log")).toBe("true");
    expect(asFile(form.get("files")).name).toBe("slip.jpg");
    expect(asFile(form.get("files")).type).toBe("image/jpeg");

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
    expectPushed("U-slip-9", "ได้รับสลิปแล้ว", "เจ้าของหอจะตรวจสอบ");
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
    expectPushed("U-slip-10", "ตุลาคม 2569", "3,550");

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
    // ปฏิเสธเพราะมีใบ matched ด้วยเลขอ้างอิงเดียวกันอยู่จริง จึงอ้างได้ว่า "ถูกใช้ไปแล้ว"
    expect(result.usedSlipId).toBe(matched.id);

    expectPushed("U-slip-10", "ถูกใช้ปิดบิลไปแล้ว");

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

    expectReplied("เชื่อม LINE กับห้องของคุณ", "A101");
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
    expectReplied("ดาวน์โหลดรูปสลิปไม่สำเร็จ");
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
    slipOkBody = verifiedBody(3550, "TR-0013", { transTimestamp: null, transDate: "17/09/2026", transTime: null });

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
    expectReplied("ดาวน์โหลดรูปสลิปไม่สำเร็จ");
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
    expectReplied("ดาวน์โหลดรูปสลิปไม่สำเร็จ");
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
    expectReplied("ดาวน์โหลดรูปสลิปไม่สำเร็จ");
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
    expect(slip.trans_ref).toBe("TR-0017");
    expect(slipResultOf(slip).reason).toBe("no_unpaid_bill");

    // บิลถูกปิดไปก่อนระหว่างตรวจ แต่เรารู้ว่าสลิปนี้เทียบกับใบไหน จึงต้องเก็บไว้
    // ไม่ใช่ทิ้งเป็น null แล้วบอกเจ้าของหอว่า "ไม่มีบิลให้เทียบ"
    expect(slip.bill_id).toBe(bill.id);
    expect(slip.bill_total).toBe(3550);

    const queued = (await listQueue()).find((item) => item.id === slip.id);
    expect(queued?.bill?.id).toBe(bill.id);
    expect(queued?.bill?.period).toBe("2026-09");

    const settled = await billOf("2026-09", bill.id);
    expect(settled.status).toBe("paid");
    expect(settled.paidMethod).toBe("cash");
    expect(settled.paidAt).toBe("2026-09-02");
    expectPushed("U-slip-17", "ได้รับสลิปแล้ว", "เจ้าของหอจะตรวจสอบ");
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

  it("processes a redelivered image event exactly once and calls SlipOK once", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S124", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมชาย ส่งซ้ำเหตุการณ์");
    await linkTenantByRoomNumber("S124", "U-slip-24", "สมชาย ส่งซ้ำเหตุการณ์");

    const bill = await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });
    expect(bill.total).toBe(3550);

    outboundCalls = [];
    slipOkBody = verifiedBody(3550, "TR-0024");

    const body = lineEvents([imageEvent("U-slip-24", "tok-slip-24", "msg-slip-24")]);

    expect((await postWebhook(body)).status).toBe(200);
    expect((await postWebhook(body)).status).toBe(200);

    const slips = await readSlipsFor("U-slip-24");
    expect(slips).toHaveLength(1);
    expect(slips[0]?.status).toBe("matched");
    expect(slips[0]?.bill_id).toBe(bill.id);
    expect(downloadCalls()).toHaveLength(1);
    expect(slipOkCalls()).toHaveLength(1);

    const paid = await billOf("2026-09", bill.id);
    expect(paid.status).toBe("paid");
  });

  it("keeps a slip paid to another account in review and leaves the bill open", async () => {
    await putRates(18, 7);
    await putPayee("0812345678");
    const room = await newRoom({ roomNumber: "S125", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมหญิง โอนผิดบัญชี");
    await linkTenantByRoomNumber("S125", "U-slip-25", "สมหญิง โอนผิดบัญชี");

    const bill = await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });
    expect(bill.total).toBe(3550);

    outboundCalls = [];
    slipOkBody = verifiedBody(3550, "TR-0025", {
      receiver: {
        displayName: "คนอื่น",
        name: "SOMEONE ELSE",
        proxy: { type: "MSISDN", value: "081xxx0000" },
        account: { type: "BANKAC", value: "xxx-x-x0000-x" },
      },
    });

    const response = await sendSlip("U-slip-25", "msg-slip-25");
    expect(response.status).toBe(200);

    const slip = await readOneSlipFor("U-slip-25");
    expect(slip.status).toBe("pending_review");
    expect(slip.bill_id).toBe(bill.id);
    expect(slip.bill_total).toBe(3550);
    expect(slip.trans_ref).toBe("TR-0025");
    expect(slipResultOf(slip).reason).toBe("not_verified");

    const unchanged = await billOf("2026-09", bill.id);
    expect(unchanged.status).toBe("unpaid");
    expect(unchanged.paidAt).toBeNull();

    expectPushed("U-slip-25", "โอนเข้าบัญชีอื่น", "บัญชีรับเงินของหอ");
    expect(pushTextFor("U-slip-25")).not.toContain("ปิดบิลเรียบร้อย");
  });

  it("keeps a slip the provider flags as the wrong receiver in review", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S126", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมปอง ผู้ให้บริการรู้ทัน");
    await linkTenantByRoomNumber("S126", "U-slip-26", "สมปอง ผู้ให้บริการรู้ทัน");

    const bill = await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });

    outboundCalls = [];
    slipOkStatus = 400;
    slipOkBody = { success: false, code: 1014, message: "บัญชีผู้รับไม่ตรงกับบัญชีหลักของร้าน" };

    const response = await sendSlip("U-slip-26", "msg-slip-26");
    expect(response.status).toBe(200);

    const slip = await readOneSlipFor("U-slip-26");
    expect(slip.status).toBe("pending_review");
    expect(slip.bill_id).toBe(bill.id);
    expect(slipResultOf(slip).reason).toBe("not_verified");
    expect((await billOf("2026-09", bill.id)).status).toBe("unpaid");
    expectPushed("U-slip-26", "โอนเข้าบัญชีอื่น");
  });

  /**
   * กรณี HTTP 400 พร้อม data ที่สมบูรณ์: เลขอ้างอิงและยอดที่ผู้ให้บริการอ่านได้
   * ต้องไม่ถูกทิ้ง เพราะเจ้าของหอใช้เทียบกับใบเสร็จของธนาคารตอนตัดสินใจด้วยมือ
   */
  it("keeps the reference and amount the provider read from a rejected slip", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S128", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมพร โอนผิดบัญชี");
    await linkTenantByRoomNumber("S128", "U-slip-28", "สมพร โอนผิดบัญชี");

    await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });

    outboundCalls = [];
    slipOkStatus = 400;
    slipOkBody = {
      code: 1014,
      message: "บัญชีผู้รับไม่ตรงกับบัญชีหลักของร้าน",
      data: {
        success: true,
        transRef: "202601010DEMOREF00001234A",
        transDate: "20260101",
        transTime: "10:15:00",
        amount: 4200,
        receiver: { proxy: { type: "MSISDN", value: "xxx-xxx-1234" }, account: { type: "", value: "" } },
      },
    };

    const response = await sendSlip("U-slip-28", "msg-slip-28");
    expect(response.status).toBe(200);

    const slip = await readOneSlipFor("U-slip-28");
    expect(slip.status).toBe("pending_review");
    expect(slip.trans_ref).toBe("202601010DEMOREF00001234A");
    expect(slip.amount).toBe(4200);
    // สลิปจริงแต่ผู้รับผิดบัญชี จึงไม่นับว่าตรวจผ่าน และห้ามปิดบิลอัตโนมัติ
    expect(slipResultOf(slip).verified).toBe(false);
    expect(slipResultOf(slip).reason).toBe("not_verified");

    const queue = await listQueue();
    const queued = queue.find((item) => item.id === slip.id);
    expect(queued?.verify.transRef).toBe("202601010DEMOREF00001234A");
    expect(queued?.slipAmount).toBe(4200);
  });

  /**
   * 1012 ที่มาเป็น HTTP 400 ต้องเข้าเส้นทางสลิปซ้ำ ไม่ใช่ "ตรวจไม่ผ่าน"
   * และต้องเก็บรหัส/ข้อความ/เลขอ้างอิงที่ผู้ให้บริการส่งมาด้วย
   */
  it("routes a 1012 on a 400 response into the duplicate path with its identifiers intact", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S129", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมศักดิ์ สลิปซ้ำ424");
    await linkTenantByRoomNumber("S129", "U-slip-29", "สมศักดิ์ สลิปซ้ำ424");

    const bill = await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });

    outboundCalls = [];
    slipOkStatus = 400;
    slipOkBody = {
      code: 1012,
      message: "สลิปซ้ำ สลิปนี้เคยส่งเข้ามาในระบบเมื่อ 2026-09-22 01:35:00",
      data: { transRef: "TR-4242", amount: 3550, transDate: "20260903", transTime: "01:35:00", transTimestamp: slipTimestamp },
    };

    const response = await sendSlip("U-slip-29", "msg-slip-29");
    expect(response.status).toBe(200);

    const slip = await readOneSlipFor("U-slip-29");

    // ยังไม่มีบิลที่ปิดด้วยเลขอ้างอิงนี้ จึงเข้าคิว ไม่ถูกปฏิเสธทิ้ง
    expect(slip.status).toBe("pending_review");
    expect(slip.trans_ref).toBe("TR-4242");
    expect(slip.amount).toBe(3550);
    expect(slipResultOf(slip).reason).toBe("duplicate_slip");
    expect(slipResultOf(slip).code).toBe(1012);

    expect((await billOf("2026-09", bill.id)).status).toBe("unpaid");
  });

  /**
   * "ตรวจไม่ได้" ต้องแยกจาก "ตรวจแล้วไม่ผ่าน" และต้องเห็นได้จากหน้ารอตรวจ
   *
   * เดิมกรณีนี้จบที่ log ของ Cloudflare เจ้าของหอจึงเห็นแค่ "ตรวจไม่ผ่าน"
   * เหมือนสลิปปลอม แล้วไม่รู้ว่าต้องไปแก้ที่คีย์ ผู้ให้บริการ หรือตัวรูป
   */
  it("keeps the provider's reason visible when the check itself cannot run", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S130", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมหมาย ผู้ให้บริการล่ม");
    await linkTenantByRoomNumber("S130", "U-slip-30", "สมหมาย ผู้ให้บริการล่ม");

    const bill = await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });

    outboundCalls = [];
    slipOkStatus = 503;
    slipOkBody = {};

    const response = await sendSlip("U-slip-30", "msg-slip-30");
    expect(response.status).toBe(200);

    const slip = await readOneSlipFor("U-slip-30");
    expect(slip.status).toBe("pending_review");
    expect(slip.bill_id).toBe(bill.id);

    const result = slipResultOf(slip);
    expect(result.reason).toBe("verify_failed");
    expect(result.verified).toBe(false);
    expect(String(result.detail)).toContain("503");
    expect((await billOf("2026-09", bill.id)).status).toBe("unpaid");

    // คิวต้องส่งเหตุผลต่อไปให้หน้า รอตรวจ ไม่ใช่แค่ป้าย "ตรวจไม่ผ่าน"
    const queued = (await listQueue()).find((item) => item.id === slip.id);
    expect(queued?.reason).toBe("verify_failed");
    expect(queued?.verify.detail).toContain("503");
  });

  it("tells the owner the check itself failed so they know to look by hand", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S133", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมพร ผู้ให้บริการล่ม");
    await linkTenantByRoomNumber("S133", "U-slip-33", "สมพร ผู้ให้บริการล่ม");
    await linkOwner("U-boss-33");

    await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });

    outboundCalls = [];
    slipOkStatus = 503;
    slipOkBody = {};

    const response = await sendSlip("U-slip-33", "msg-slip-33");
    expect(response.status).toBe(200);

    expectPushed("U-boss-33", "ระบบตรวจสลิปกับผู้ให้บริการไม่สำเร็จ", "503");
  });

  it("keeps the provider's own code and message for a slip it rejected", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S132", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมนึก รูปไม่มีคิวอาร์");
    await linkTenantByRoomNumber("S132", "U-slip-32", "สมนึก รูปไม่มีคิวอาร์");

    await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });

    outboundCalls = [];
    slipOkStatus = 400;
    slipOkBody = { code: 1007, message: "รูปภาพไม่มี QR Code" };

    const response = await sendSlip("U-slip-32", "msg-slip-32");
    expect(response.status).toBe(200);

    const slip = await readOneSlipFor("U-slip-32");
    const result = slipResultOf(slip);
    expect(result.reason).toBe("not_verified");
    expect(result.code).toBe(1007);
    expect(result.message).toBe("รูปภาพไม่มี QR Code");

    const queued = (await listQueue()).find((item) => item.id === slip.id);
    expect(queued?.verify.code).toBe(1007);
    expect(queued?.verify.message).toBe("รูปภาพไม่มี QR Code");
  });

  /**
   * กฎของหอ: คิดบิลเป็นเดือนต่อเดือน และเมื่อผู้เช่าโอนเงินที่มียอดตรงกับงวดเก่า
   * ระบบยึด "บิลล่าสุดที่ยังไม่จ่าย" เท่านั้น ไม่ย้อนไปปิดงวดเก่าตามยอดที่ตรง
   * เพราะยอดรายเดือนของหอใกล้งกันจนแยกไม่ออกจากตัวเลขเพียงอย่างเดียว
   */
  it("closes the latest unpaid bill for a transfer whose amount matches an older period", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S131", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมพงษ์ โอนงวดเก่า");
    await linkTenantByRoomNumber("S131", "U-slip-31", "สมพงษ์ โอนงวดเก่า");

    // งวด 2026-07 ออกบิลแล้วไม่จ่าย (ยอดตรงกับที่จะโอนมา) แล้วออกบิลงวด 2026-09 อีกใบ
    // ตั้งใจให้ทั้งสองงวดยอดเท่ากัน ยอดในสลิปจึงชี้ได้ทั้งสองใบ — คำตอบที่ถูกคือใบล่าสุด
    const july = await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 }, "2026-07");
    const september = await generateBill(room.id, { waterCurrent: 14, electricCurrent: 24 }, "2026-09");
    expect(july.total).toBe(september.total);

    outboundCalls = [];
    slipOkBody = verifiedBody(september.total, "TR-OLD-PERIOD");

    const response = await sendSlip("U-slip-31", "msg-slip-31");
    expect(response.status).toBe(200);

    // สลิปปิดงวดล่าสุด ไม่ใช่ใบเก่าที่มียอดเท่ากัน
    const slip = await readOneSlipFor("U-slip-31");
    expect(slip.status).toBe("matched");
    expect(slip.bill_id).toBe(september.id);
    expect((await billOf("2026-09", september.id)).status).toBe("paid");
    expect((await billOf("2026-07", july.id)).status).toBe("unpaid");
  });

  it("still closes the bill when the receiver matches the configured payee", async () => {
    await putRates(18, 7);
    await putPayee("0812345678");
    const room = await newRoom({ roomNumber: "S127", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมชาย โอนถูกบัญชี");
    await linkTenantByRoomNumber("S127", "U-slip-27", "สมชาย โอนถูกบัญชี");

    const bill = await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });

    outboundCalls = [];
    slipOkBody = verifiedBody(3550, "TR-0027");

    const response = await sendSlip("U-slip-27", "msg-slip-27");
    expect(response.status).toBe(200);

    expect((await readOneSlipFor("U-slip-27")).status).toBe("matched");
    expect((await billOf("2026-09", bill.id)).status).toBe("paid");
  });
});

describe("slip family isolation", () => {
  it("keeps another family's slips out of the queue and out of reach", async () => {
    const otherFamily = await createFamily("ครอบครัวอื่น");
    const foreignSlipId = crypto.randomUUID();

    await env.DB.prepare(
      "INSERT INTO slips (id, family_id, line_user_id, image_key, status) VALUES (?, ?, 'U-foreign-slip', 'foreign.png', 'pending_review')",
    )
      .bind(foreignSlipId, otherFamily)
      .run();

    const queue = await listQueue();
    expect(queueIds(queue)).not.toContain(foreignSlipId);

    const rejected = await resolveSlip(foreignSlipId, { action: "reject" });
    expect(rejected.status).toBe(404);
    expect((await rejected.json<ErrorBody>()).error.code).toBe("NOT_FOUND");

    const settled = await resolveSlip(foreignSlipId, { action: "settle" });
    expect(settled.status).toBe(404);

    const untouched = await env.DB.prepare("SELECT status FROM slips WHERE id = ?")
      .bind(foreignSlipId)
      .first<{ status: string }>();
    expect(untouched?.status).toBe("pending_review");

    const other = await signIn("owner", otherFamily);
    const response = await SELF.fetch(slipsUrl, withAuth(other));
    expect(response.status).toBe(200);
    const foreignQueue = (await response.json<{ ok: boolean; slips: QueueSlip[] }>()).slips;
    expect(queueIds(foreignQueue)).toEqual([foreignSlipId]);
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

    expectPushed("U-alert-1", "ได้รับสลิปแล้ว", "เจ้าของหอจะตรวจสอบ");
    expectPushed(
      "U-boss-1",
      "S201",
      "สมชาย แจ้งเจ้าของ",
      "ยอดในสลิป",
      "3,550.50",
      "เทียบกับยอดบิล",
      "3,550",
      "ยอดในสลิปไม่ตรงกับยอดบิล",
    );

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

    expectPushed("U-boss-2", "S202", "สมหญิง ไม่มีบิลค้าง", "3,550", "ตอนรับสลิปไม่พบบิลค้าง");

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

    expect(pushMessages().map((push) => push.to)).toEqual(["U-alert-3"]);
    expectPushed("U-alert-3", "ได้รับสลิปแล้ว", "เจ้าของหอจะตรวจสอบ");

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
    expect(item.verify).toEqual({
      verified: true,
      transRef: "TR-2004",
      date: slipDate,
      code: null,
      message: null,
      detail: null,
      usedSlipId: null,
    });
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

    const invalid = await SELF.fetch(`${slipsUrl}?status=done`, withAuth(session));
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

    expectPushed("U-resolve-1", "กันยายน 2569", "3,550", "ปิดบิลเรียบร้อย");
    expect(pushStringsFor("U-boss-6")).toEqual([]);
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
    expectPushed("U-resolve-6", "กันยายน 2569", "3,550", "ปิดบิลเรียบร้อย");
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
  it("refuses an unauthenticated request", async () => {
    const response = await SELF.fetch(`${slipBaseUrl}/00000000000000000000000000000000.png`);
    expect(response.status).toBe(401);
  });

  it("answers 404 for an unknown key", async () => {
    const response = await SELF.fetch(`${slipBaseUrl}/00000000000000000000000000000000.png`, withAuth(session));
    expect(response.status).toBe(404);

    const body = await response.json<ErrorBody>();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("answers 404 for a file that is not a slip image", async () => {
    const response = await SELF.fetch(`${slipBaseUrl}/slip.txt`, withAuth(session));
    expect(response.status).toBe(404);
    expect((await response.json<ErrorBody>()).error.code).toBe("NOT_FOUND");
  });

  it("hides another family's slip image even with the exact key", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "S199", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await newTenant(room.id, "สมชาย กันข้ามครอบครัว");
    await linkTenantByRoomNumber("S199", "U-slip-cross", "สมชาย กันข้ามครอบครัว");
    await generateBill(room.id, { waterCurrent: 12, electricCurrent: 22 });

    outboundCalls = [];
    slipOkBody = verifiedBody(3550, "TR-CROSS");
    await sendSlip("U-slip-cross", "msg-slip-cross");

    const slip = await readOneSlipFor("U-slip-cross");

    const other = await signIn("owner", await createFamily("หอของอีกครอบครัว"));
    const response = await SELF.fetch(`${slipBaseUrl}/${slip.image_key}`, withAuth(other));
    expect(response.status).toBe(404);

    const mine = await SELF.fetch(`${slipBaseUrl}/${slip.image_key}`, withAuth(session));
    expect(mine.status).toBe(200);
  });
});
