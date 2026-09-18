import { SELF, env } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const webhookUrl = "https://dorm.test/webhook/line";
const roomsUrl = "https://dorm.test/api/rooms";
const tenantsUrl = "https://dorm.test/api/tenants";
const settingsUrl = "https://dorm.test/api/settings";
const pendingUrl = "https://dorm.test/api/line/pending";
const billsUrl = "https://dorm.test/api/bills";

const lineReplyUrl = "https://api.line.me/v2/bot/message/reply";
const lineProfileUrl = "https://api.line.me/v2/bot/profile";

const dormName = "หอพักทดสอบ";

const welcomeText = `ยินดีต้อนรับสู่${dormName} กรุณาพิมพ์เลขห้องของคุณ เช่น A101 เพื่อเชื่อม LINE`;
const ownerLinkedText = "เชื่อม LINE เจ้าของเรียบร้อย ระบบจะแจ้งเตือนที่ห้องแชทนี้";

function linkedText(fullName: string, roomNumber: string): string {
  return `เชื่อม LINE กับ คุณ${fullName} ห้อง ${roomNumber} สำเร็จ`;
}

function notMatchedText(text: string): string {
  return `ไม่พบห้อง ${text} ที่มีผู้เช่าอยู่ในระบบ กรุณาตรวจสอบเลขห้องอีกครั้ง หรือติดต่อเจ้าของหอ`;
}

const guidanceText = "ยังไม่พบห้องของคุณ กรุณาพิมพ์เลขห้อง เช่น A101 เพื่อเชื่อม LINE หรือติดต่อเจ้าของหอ";

const registerUrl = "https://dorm.test/register";
const slipInstructionText = "ส่งรูปสลิปโอนเงินในแชทนี้ได้เลย ระบบจะตรวจสอบสลิปให้อัตโนมัติ";
const registerRequiredText = `กรุณาลงทะเบียนผู้เช่าเพื่อผูก LINE กับห้องของคุณก่อน ลงทะเบียนได้ที่ ${registerUrl}`;
const registerLinkText = `ลิงก์ลงทะเบียนผู้เช่า ${registerUrl}`;

interface RoomPayload {
  id: string;
  roomNumber: string;
  status: string;
}

interface TenantPayload {
  id: string;
  fullName: string;
  roomId: string;
  roomNumber: string;
  lineUserId: string | null;
  status: string;
}

interface TenantListBody {
  ok: boolean;
  tenants: TenantPayload[];
}

interface SettingsPayload {
  dormName: string;
  ownerName: string;
  ownerPhone: string;
  ownerLinkCode: string;
  ownerLineConnected: boolean;
}

interface SettingsBody {
  ok: boolean;
  settings: SettingsPayload;
}

interface BillPayload {
  id: string;
  roomId: string;
  period: string;
  total: number;
  status: "paid" | "unpaid";
}

interface PendingLink {
  lineUserId: string;
  displayName: string;
  lastMessage: string | null;
  lastSeenAt: string;
}

interface PendingBody {
  ok: boolean;
  pending: PendingLink[];
}

interface ErrorBody {
  ok: boolean;
  error: { code: string; message: string; field?: string };
}

interface OutboundCall {
  url: string;
  method: string;
  body: string;
  authorization: string;
}

interface ReplyBody {
  replyToken: string;
  messages: { type: string; text: string }[];
}

interface WebhookOptions {
  signature?: string | null;
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

async function postWebhook(body: string, options: WebhookOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const signature = options.signature === undefined ? await sign(body) : options.signature;

  if (signature !== null) {
    headers["x-line-signature"] = signature;
  }

  return SELF.fetch(webhookUrl, { method: "POST", headers, body });
}

function lineEvents(events: unknown[]): string {
  return JSON.stringify({ events });
}

function followEvent(userId: string, replyToken: string): Record<string, unknown> {
  return { type: "follow", replyToken, timestamp: 0, mode: "active", source: { type: "user", userId } };
}

function textEvent(userId: string, replyToken: string, text: string): Record<string, unknown> {
  return {
    type: "message",
    replyToken,
    timestamp: 0,
    mode: "active",
    source: { type: "user", userId },
    message: { type: "text", id: "msg-1", text },
  };
}

let outboundCalls: OutboundCall[] = [];
let profileDisplayName = "ผู้ใช้ LINE ทดสอบ";
let replyFails = false;

function replyCalls(): OutboundCall[] {
  return outboundCalls.filter((call) => call.url === lineReplyUrl);
}

function replyTexts(): string[] {
  return replyCalls().map((call) => {
    const body = JSON.parse(call.body) as ReplyBody;
    return body.messages[0]?.text ?? "";
  });
}

async function readPending(): Promise<PendingLink[]> {
  const response = await SELF.fetch(pendingUrl);
  expect(response.status).toBe(200);
  return (await response.json<PendingBody>()).pending;
}

async function pendingFor(lineUserId: string): Promise<PendingLink | undefined> {
  return (await readPending()).find((item) => item.lineUserId === lineUserId);
}

async function readSettings(): Promise<SettingsPayload> {
  const response = await SELF.fetch(settingsUrl);
  expect(response.status).toBe(200);
  return (await response.json<SettingsBody>()).settings;
}

async function newRoom(roomNumber: string): Promise<RoomPayload> {
  const response = await SELF.fetch(roomsUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roomNumber, rent: 3500 }),
  });
  expect(response.status).toBe(201);
  return (await response.json<{ ok: boolean; room: RoomPayload }>()).room;
}

async function newTenant(roomId: string, fullName: string): Promise<TenantPayload> {
  const response = await SELF.fetch(tenantsUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fullName, phone: "081-234-5678", roomId, checkInDate: "2025-03-01" }),
  });
  expect(response.status).toBe(201);
  return (await response.json<{ ok: boolean; tenant: TenantPayload }>()).tenant;
}

async function tenantById(tenantId: string): Promise<TenantPayload> {
  const body = await (await SELF.fetch(tenantsUrl)).json<TenantListBody>();
  const found = body.tenants.find((tenant) => tenant.id === tenantId);

  if (found === undefined) {
    throw new Error(`tenant ${tenantId} not found`);
  }

  return found;
}

function checkoutTenant(tenantId: string, checkOutDate: string): Promise<Response> {
  return SELF.fetch(`${tenantsUrl}/${tenantId}/checkout`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ checkOutDate }),
  });
}

function linkPending(lineUserId: string, tenantId: string): Promise<Response> {
  return SELF.fetch(`${pendingUrl}/${encodeURIComponent(lineUserId)}/link`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId }),
  });
}

function putSettings(payload: Record<string, unknown>): Promise<Response> {
  return SELF.fetch(settingsUrl, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function linkRoom(lineUserId: string, roomNumber: string): Promise<void> {
  const response = await postWebhook(lineEvents([textEvent(lineUserId, `tok-link-${lineUserId}`, roomNumber)]));
  expect(response.status).toBe(200);
}

async function generateBill(roomId: string, period: string): Promise<BillPayload> {
  const response = await SELF.fetch(`${billsUrl}/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ period, entries: [{ roomId, waterCurrent: 0, electricCurrent: 0 }] }),
  });
  expect(response.status).toBe(201);

  const bill = (await response.json<{ ok: boolean; bills: BillPayload[] }>()).bills[0];

  if (bill === undefined) {
    throw new Error("expected a generated bill");
  }

  return bill;
}

async function markBillPaid(billId: string): Promise<void> {
  const response = await SELF.fetch(`${billsUrl}/${encodeURIComponent(billId)}/mark-paid`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method: "transfer" }),
  });
  expect(response.status).toBe(200);
}

beforeAll(async () => {
  const response = await SELF.fetch(settingsUrl, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dormName }),
  });
  expect(response.status).toBe(200);
});

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  outboundCalls = [];
  profileDisplayName = "ผู้ใช้ LINE ทดสอบ";
  replyFails = false;

  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);

    outboundCalls.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : "",
      authorization: headers.get("authorization") ?? "",
    });

    if (url.startsWith(lineProfileUrl)) {
      const userId = url.slice(lineProfileUrl.length + 1);
      return Promise.resolve(
        new Response(JSON.stringify({ userId, displayName: profileDisplayName }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }

    if (replyFails) {
      return Promise.resolve(new Response("failed", { status: 500 }));
    }

    return Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } }));
  });
});

describe("LINE test bindings", () => {
  it("uses the known channel secret and access token", () => {
    expect(env.LINE_CHANNEL_SECRET).toBe("test-channel-secret");
    expect(env.LINE_CHANNEL_ACCESS_TOKEN).toBe("test-channel-access-token");
  });
});

describe("POST /webhook/line signature gate", () => {
  it("rejects a request with no signature and changes nothing", async () => {
    const before = await readPending();

    const response = await postWebhook(lineEvents([followEvent("U-unsigned", "tok-unsigned")]), { signature: null });
    expect(response.status).toBe(403);

    const body = await response.json<ErrorBody>();
    expect(body.ok).toBe(false);
    expect(await readPending()).toEqual(before);
  });

  it("rejects a signature that does not match the body", async () => {
    const before = await readPending();
    const signature = await sign(lineEvents([followEvent("U-tampered", "tok-1")]));

    const response = await postWebhook(lineEvents([followEvent("U-tampered", "tok-2")]), { signature });
    expect(response.status).toBe(403);
    expect(await readPending()).toEqual(before);
  });

  it("rejects a signature that is not base64", async () => {
    const before = await readPending();

    const response = await postWebhook(lineEvents([followEvent("U-junk", "tok-junk")]), { signature: "not a signature" });
    expect(response.status).toBe(403);
    expect(await readPending()).toEqual(before);
  });

  it("accepts a malformed body that carries a valid signature without changing state", async () => {
    const before = await readPending();

    const response = await postWebhook("{", {});
    expect(response.status).toBe(200);

    const body = await response.json<{ ok: boolean }>();
    expect(body).toEqual({ ok: true });
    expect(await readPending()).toEqual(before);
  });
});

describe("POST /webhook/line events", () => {
  it("answers a follow event with the welcome text and stores a pending row", async () => {
    profileDisplayName = "พลอย LINE";

    const response = await postWebhook(lineEvents([followEvent("U-follow", "tok-follow")]));
    expect(response.status).toBe(200);

    expect(replyTexts()).toEqual([welcomeText]);

    const followed = await pendingFor("U-follow");
    expect(followed?.lineUserId).toBe("U-follow");
    expect(followed?.displayName).toBe("พลอย LINE");
    expect(followed?.lastMessage).toBeNull();
    expect(followed?.lastSeenAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("answers a greeting that is not a room number with the guidance reply", async () => {
    const response = await postWebhook(lineEvents([textEvent("U-greeting", "tok-greeting", "สวัสดี")]));
    expect(response.status).toBe(200);

    expect(replyTexts()).toEqual([guidanceText]);

    const row = await pendingFor("U-greeting");
    expect(row?.lastMessage).toBe("สวัสดี");
  });

  it("answers 500 when a database write fails so LINE retries the event", async () => {
    await env.DB.prepare(
      "CREATE TRIGGER fail_pending_insert BEFORE INSERT ON line_pending BEGIN SELECT RAISE(ABORT, 'forced failure'); END;",
    ).run();

    try {
      const response = await postWebhook(lineEvents([followEvent("U-db-fail", "tok-db-fail")]));
      expect(response.status).toBe(500);

      const body = await response.json<ErrorBody>();
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("INTERNAL");
      expect(await pendingFor("U-db-fail")).toBeUndefined();
    } finally {
      await env.DB.prepare("DROP TRIGGER IF EXISTS fail_pending_insert").run();
    }
  });

  it("answers 200 and applies the link when the outbound reply fails", async () => {
    const room = await newRoom("L208");
    const tenant = await newTenant(room.id, "วิภา ใจงาม");

    replyFails = true;

    const response = await postWebhook(lineEvents([textEvent("U-reply-fail", "tok-reply-fail", "L208")]));
    expect(response.status).toBe(200);

    expect(replyCalls()).toHaveLength(1);
    expect((await tenantById(tenant.id)).lineUserId).toBe("U-reply-fail");
    expect(await pendingFor("U-reply-fail")).toBeUndefined();
  });

  it("links the tenant of an occupied room and clears that user's pending row", async () => {
    const room = await newRoom("L201");
    const tenant = await newTenant(room.id, "สมชาย ใจดี");

    const unknown = await postWebhook(lineEvents([textEvent("U-link", "tok-room-1", "Z901")]));
    expect(unknown.status).toBe(200);
    expect(await pendingFor("U-link")).toBeDefined();

    outboundCalls.length = 0;
    const linked = await postWebhook(lineEvents([textEvent("U-link", "tok-room-2", "l201")]));
    expect(linked.status).toBe(200);

    expect((await tenantById(tenant.id)).lineUserId).toBe("U-link");
    expect(await pendingFor("U-link")).toBeUndefined();
    expect(replyTexts()).toEqual([linkedText("สมชาย ใจดี", "L201")]);
  });

  it("keeps an unknown and a vacant room number as pending rows with the not-matched reply", async () => {
    await newRoom("L202");

    const unknown = await postWebhook(lineEvents([textEvent("U-unknown", "tok-unknown", "Z902")]));
    expect(unknown.status).toBe(200);
    const vacant = await postWebhook(lineEvents([textEvent("U-vacant", "tok-vacant", "L202")]));
    expect(vacant.status).toBe(200);

    expect(replyTexts()).toEqual([notMatchedText("Z902"), notMatchedText("L202")]);

    const vacantRow = await pendingFor("U-vacant");
    expect(vacantRow?.lineUserId).toBe("U-vacant");
    expect(vacantRow?.displayName).toBe("");
    expect(vacantRow?.lastMessage).toBe("L202");
    expect(vacantRow?.lastSeenAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect((await pendingFor("U-unknown"))?.lastMessage).toBe("Z902");
  });

  it("links the owner when the text is the current owner code", async () => {
    const before = await readSettings();
    expect(before.ownerLinkCode).toMatch(/^\d{6}$/);

    const response = await postWebhook(lineEvents([textEvent("U-owner", "tok-owner", before.ownerLinkCode)]));
    expect(response.status).toBe(200);

    const after = await readSettings();
    expect(after.ownerLineConnected).toBe(true);
    expect(after.ownerLinkCode).toBe(before.ownerLinkCode);
    expect(replyTexts()).toEqual([ownerLinkedText]);
    expect(await pendingFor("U-owner")).toBeUndefined();
  });

  it("stops accepting an owner code that was replaced", async () => {
    const before = await readSettings();
    const regenerated = await SELF.fetch(`${settingsUrl}/owner-code`, { method: "POST" });
    expect(regenerated.status).toBe(200);

    const next = await regenerated.json<{ ok: boolean; ownerLinkCode: string }>();
    expect(next.ownerLinkCode).not.toBe(before.ownerLinkCode);

    const response = await postWebhook(lineEvents([textEvent("U-old-code", "tok-old", before.ownerLinkCode)]));
    expect(response.status).toBe(200);
    expect(replyTexts()).toEqual([notMatchedText(before.ownerLinkCode)]);
    expect((await pendingFor("U-old-code"))?.lastMessage).toBe(before.ownerLinkCode);
  });

  it("sends no reply and stores nothing for an already linked tenant", async () => {
    const room = await newRoom("L203");
    const tenant = await newTenant(room.id, "มาลี ศรีสุข");

    await postWebhook(lineEvents([textEvent("U-linked", "tok-1", "L203")]));
    expect((await tenantById(tenant.id)).lineUserId).toBe("U-linked");
    expect(replyTexts()).toHaveLength(1);

    outboundCalls.length = 0;
    const response = await postWebhook(lineEvents([textEvent("U-linked", "tok-2", "สวัสดี")]));
    expect(response.status).toBe(200);
    expect(outboundCalls).toEqual([]);
    expect(await pendingFor("U-linked")).toBeUndefined();
  });

  it("answers other event types with 200 and changes nothing", async () => {
    const before = await readPending();

    const response = await postWebhook(
      lineEvents([{ type: "unfollow", timestamp: 0, mode: "active", source: { type: "user", userId: "U-other" } }]),
    );

    expect(response.status).toBe(200);
    expect(outboundCalls).toEqual([]);
    expect(await readPending()).toEqual(before);
  });
});

describe("LINE rich menu keywords", () => {
  it("answers ส่งสลิป with the slip instruction for a linked tenant", async () => {
    const room = await newRoom("K301");
    await newTenant(room.id, "ก้อง LINE");
    await linkRoom("U-keyword-slip", "K301");

    outboundCalls.length = 0;
    const response = await postWebhook(lineEvents([textEvent("U-keyword-slip", "tok-keyword-slip", "ส่งสลิป")]));
    expect(response.status).toBe(200);

    expect(replyTexts()).toEqual([slipInstructionText]);
  });

  it("answers บิลของฉัน with the latest unpaid bill for a linked tenant", async () => {
    const room = await newRoom("K302");
    await newTenant(room.id, "บี LINE");
    await generateBill(room.id, "2026-09");
    await linkRoom("U-keyword-bills", "K302");

    outboundCalls.length = 0;
    const response = await postWebhook(lineEvents([textEvent("U-keyword-bills", "tok-keyword-bills", "บิลของฉัน")]));
    expect(response.status).toBe(200);

    expect(replyTexts()).toEqual([
      "บิลของห้อง K302 ประจำเดือน กันยายน 2569 ยอด 3,500 บาท ยังไม่ชำระ กรุณาชำระและส่งสลิปในแชทนี้",
    ]);
  });

  it("tells a linked tenant their latest bill is paid when nothing is outstanding", async () => {
    const room = await newRoom("K303");
    await newTenant(room.id, "แคท LINE");
    const bill = await generateBill(room.id, "2026-09");
    await markBillPaid(bill.id);
    await linkRoom("U-keyword-paid", "K303");

    outboundCalls.length = 0;
    const response = await postWebhook(lineEvents([textEvent("U-keyword-paid", "tok-keyword-paid", "บิลของฉัน")]));
    expect(response.status).toBe(200);

    expect(replyTexts()).toEqual([
      "บิลล่าสุดของห้อง K303 ประจำเดือน กันยายน 2569 ยอด 3,500 บาท ชำระแล้ว ไม่มียอดค้างชำระ",
    ]);
  });

  it("answers บิลของฉัน honestly when a linked tenant has no bill yet", async () => {
    const room = await newRoom("K304");
    await newTenant(room.id, "ดิว LINE");
    await linkRoom("U-keyword-nobill", "K304");

    outboundCalls.length = 0;
    const response = await postWebhook(lineEvents([textEvent("U-keyword-nobill", "tok-keyword-nobill", "บิลของฉัน")]));
    expect(response.status).toBe(200);

    expect(replyTexts()).toEqual([
      "ยังไม่มีบิลของห้อง K304 ในระบบ เมื่อเจ้าของหอออกบิลแล้วจะแจ้งให้ทราบในแชทนี้",
    ]);
  });

  it("answers ติดต่อเจ้าของ with the configured owner name and phone for a linked tenant", async () => {
    const room = await newRoom("K305");
    await newTenant(room.id, "ฟ้า LINE");
    await linkRoom("U-keyword-owner", "K305");

    const saved = await putSettings({ ownerName: "สมศักดิ์ ใจดี", ownerPhone: "081-234-5678" });
    expect(saved.status).toBe(200);

    outboundCalls.length = 0;
    const response = await postWebhook(lineEvents([textEvent("U-keyword-owner", "tok-keyword-owner", "ติดต่อเจ้าของ")]));
    expect(response.status).toBe(200);

    expect(replyTexts()).toEqual(["เจ้าของหอ สมศักดิ์ ใจดี เบอร์โทร 0812345678"]);
  });

  it("answers ติดต่อเจ้าของ without a blank number when the owner phone is empty", async () => {
    const saved = await putSettings({ ownerName: "สมศักดิ์ ใจดี", ownerPhone: "" });
    expect(saved.status).toBe(200);

    outboundCalls.length = 0;
    const response = await postWebhook(lineEvents([textEvent("U-keyword-owner-empty", "tok-keyword-owner-empty", "ติดต่อเจ้าของ")]));
    expect(response.status).toBe(200);

    const [text] = replyTexts();
    expect(text).toBe("เจ้าของหอ สมศักดิ์ ใจดี ยังไม่ได้บันทึกเบอร์โทรไว้ กรุณาฝากคำถามไว้ในแชทนี้แล้วรอการติดต่อกลับ");
    expect(text).not.toMatch(/เบอร์โทร\s*$/);
  });

  it("answers ลงทะเบียน with the registration link for a linked tenant", async () => {
    const room = await newRoom("K306");
    await newTenant(room.id, "เอ LINE");
    await linkRoom("U-keyword-register", "K306");

    outboundCalls.length = 0;
    const response = await postWebhook(lineEvents([textEvent("U-keyword-register", "tok-keyword-register", "ลงทะเบียน")]));
    expect(response.status).toBe(200);

    expect(replyTexts()).toEqual([registerLinkText]);
  });

  it("points บิลของฉัน and ลงทะเบียน from an unlinked user at registration and records no pending row", async () => {
    const billsResponse = await postWebhook(lineEvents([textEvent("U-unlinked-bills", "tok-unlinked-bills", "บิลของฉัน")]));
    expect(billsResponse.status).toBe(200);

    const registerResponse = await postWebhook(lineEvents([textEvent("U-unlinked-register", "tok-unlinked-register", "ลงทะเบียน")]));
    expect(registerResponse.status).toBe(200);

    expect(replyTexts()).toEqual([registerRequiredText, registerRequiredText]);

    expect(await pendingFor("U-unlinked-bills")).toBeUndefined();
    expect(await pendingFor("U-unlinked-register")).toBeUndefined();
  });

  it("still ignores an already linked tenant's ordinary text", async () => {
    const room = await newRoom("K307");
    const tenant = await newTenant(room.id, "จีน LINE");
    await linkRoom("U-keyword-plain", "K307");
    expect((await tenantById(tenant.id)).lineUserId).toBe("U-keyword-plain");

    outboundCalls.length = 0;
    const response = await postWebhook(lineEvents([textEvent("U-keyword-plain", "tok-keyword-plain", "A101")]));
    expect(response.status).toBe(200);

    expect(outboundCalls).toEqual([]);
    expect(await pendingFor("U-keyword-plain")).toBeUndefined();
  });
});

describe("owner phone setting", () => {
  it("round-trips owner_phone through the settings API and rejects a malformed value", async () => {
    const saved = await putSettings({ ownerPhone: "081-234-5678" });
    expect(saved.status).toBe(200);
    expect((await saved.json<SettingsBody>()).settings.ownerPhone).toBe("0812345678");

    expect((await readSettings()).ownerPhone).toBe("0812345678");

    const malformed = await putSettings({ ownerPhone: "08123" });
    expect(malformed.status).toBe(400);

    const body = await malformed.json<ErrorBody>();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.field).toBe("ownerPhone");
    expect((await readSettings()).ownerPhone).toBe("0812345678");

    const cleared = await putSettings({ ownerPhone: "" });
    expect(cleared.status).toBe(200);
    expect((await readSettings()).ownerPhone).toBe("");
  });
});

describe("POST /api/line/pending/:lineUserId/link", () => {
  it("links a pending user to a current tenant and removes the pending row", async () => {
    const room = await newRoom("L204");
    const tenant = await newTenant(room.id, "นพดล อินทร์แปลง");

    await postWebhook(lineEvents([textEvent("U-manual", "tok-manual", "Z904")]));
    expect(await pendingFor("U-manual")).toBeDefined();

    const response = await linkPending("U-manual", tenant.id);
    expect(response.status).toBe(200);
    expect(await response.json<{ ok: boolean }>()).toEqual({ ok: true });

    expect((await tenantById(tenant.id)).lineUserId).toBe("U-manual");
    expect(await pendingFor("U-manual")).toBeUndefined();
  });

  it("rejects linking a second pending user to an already linked tenant", async () => {
    const room = await newRoom("L205");
    const tenant = await newTenant(room.id, "วีระ คำมณี");

    await postWebhook(lineEvents([textEvent("U-first", "tok-1", "Z905")]));
    const first = await linkPending("U-first", tenant.id);
    expect(first.status).toBe(200);

    await postWebhook(lineEvents([textEvent("U-second", "tok-2", "Z906")]));
    const response = await linkPending("U-second", tenant.id);
    expect(response.status).toBe(409);

    const body = await response.json<ErrorBody>();
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.field).toBe("tenantId");
    expect((await tenantById(tenant.id)).lineUserId).toBe("U-first");
    expect(await pendingFor("U-second")).toBeDefined();
  });

  it("rejects linking a tenant that already moved out", async () => {
    const room = await newRoom("L206");
    const tenant = await newTenant(room.id, "อรุณี แสงทอง");
    const checkout = await checkoutTenant(tenant.id, "2025-08-30");
    expect(checkout.status).toBe(200);

    await postWebhook(lineEvents([textEvent("U-late", "tok-late", "Z907")]));
    const response = await linkPending("U-late", tenant.id);
    expect(response.status).toBe(409);

    const body = await response.json<ErrorBody>();
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.field).toBe("tenantId");
    expect((await tenantById(tenant.id)).lineUserId).toBeNull();
    expect(await pendingFor("U-late")).toBeDefined();
  });

  it("returns 404 for an unknown pending user", async () => {
    const room = await newRoom("L207");
    const tenant = await newTenant(room.id, "ศิริพร ทองคำ");

    const response = await linkPending("U-missing", tenant.id);
    expect(response.status).toBe(404);

    const body = await response.json<ErrorBody>();
    expect(body.error.code).toBe("NOT_FOUND");
    expect((await tenantById(tenant.id)).lineUserId).toBeNull();
  });

  it("returns 404 with a tenantId field for an unknown tenant", async () => {
    await postWebhook(lineEvents([textEvent("U-known", "tok-known", "Z908")]));

    const response = await linkPending("U-known", "tenant-missing");
    expect(response.status).toBe(404);

    const body = await response.json<ErrorBody>();
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.field).toBe("tenantId");
    expect(await pendingFor("U-known")).toBeDefined();
  });
});

describe("outbound LINE calls", () => {
  it("fetches the profile and replies with the bearer token", async () => {
    profileDisplayName = "สมหญิง LINE";

    const response = await postWebhook(lineEvents([followEvent("U-bearer", "tok-bearer")]));
    expect(response.status).toBe(200);

    const expectedToken = `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`;
    const profile = outboundCalls.find((call) => call.url === `${lineProfileUrl}/U-bearer`);
    expect(profile?.method).toBe("GET");
    expect(profile?.authorization).toBe(expectedToken);

    const replies = replyCalls();
    expect(replies).toHaveLength(1);

    const reply = replies[0];
    expect(reply?.method).toBe("POST");
    expect(reply?.authorization).toBe(expectedToken);
    expect(JSON.parse(reply?.body ?? "") as ReplyBody).toEqual({
      replyToken: "tok-bearer",
      messages: [{ type: "text", text: welcomeText }],
    });

    expect((await pendingFor("U-bearer"))?.displayName).toBe("สมหญิง LINE");
  });
});
