import { SELF, createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/worker/index";
import { type TestSession, configurePayout, createFamily, signIn, withAuth } from "./auth-helper";
import { flexText } from "./flex";

const webhookUrl = "https://dorm.test/webhook/line";
const roomsUrl = "https://dorm.test/api/rooms";
const tenantsUrl = "https://dorm.test/api/tenants";
const settingsUrl = "https://dorm.test/api/settings";
const pendingUrl = "https://dorm.test/api/line/pending";
const billsUrl = "https://dorm.test/api/bills";
const lineMessagesUrl = "https://dorm.test/api/line/messages";

const lineReplyUrl = "https://api.line.me/v2/bot/message/reply";
const lineProfileUrl = "https://api.line.me/v2/bot/profile";
const lineBotInfoUrl = "https://api.line.me/v2/bot/info";
const lineWebhookEndpointUrl = "https://api.line.me/v2/bot/channel/webhook/endpoint";

const dormName = "หอพักทดสอบ";

const registerUrl = "https://dorm.test/register";

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
  ownerLineId: string;
  ownerLinkCode: string;
  ownerLineConnected: boolean;
  ownerLineDisplayName: string | null;
  lineBot: { displayName: string; basicId: string } | null;
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
  messages: Record<string, unknown>[];
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

  const ctx = createExecutionContext();
  const response = await app.fetch(new Request(webhookUrl, { method: "POST", headers, body }), env, ctx);
  await waitOnExecutionContext(ctx);

  return response;
}

function lineEvents(events: unknown[]): string {
  return JSON.stringify({ events });
}

let eventSeq = 0;

/** LINE ส่ง webhookEventId มาเสมอ ใช้ค่าที่ไม่ซ้ำเพื่อไม่ให้เหตุการณ์ข้ามเทสต์ถูกกันซ้ำ */
function uniqueEventId(): string {
  eventSeq += 1;
  return `evt-${String(eventSeq)}-${Math.random().toString(16).slice(2)}`;
}

function followEvent(userId: string, replyToken: string, eventId = uniqueEventId()): Record<string, unknown> {
  return {
    type: "follow",
    replyToken,
    timestamp: 0,
    mode: "active",
    webhookEventId: eventId,
    source: { type: "user", userId },
  };
}

function textEvent(userId: string, replyToken: string, text: string, eventId = uniqueEventId()): Record<string, unknown> {
  return {
    type: "message",
    replyToken,
    timestamp: 0,
    mode: "active",
    webhookEventId: eventId,
    source: { type: "user", userId },
    message: { type: "text", id: "msg-1", text },
  };
}

let session: TestSession;
let outboundCalls: OutboundCall[] = [];
let profileDisplayName = "ผู้ใช้ LINE ทดสอบ";
let botInfoDisplayName = "Chumsaeng (DEV)";
let botInfoBasicId = "@490secnd";
let botInfoFails = false;
let webhookEndpoint = "https://wangchan-dorm.nodhk2545.workers.dev/webhook/line";
let webhookActive = true;
let webhookEndpointFails = false;
let replyFails = false;

function replyCalls(): OutboundCall[] {
  return outboundCalls.filter((call) => call.url === lineReplyUrl);
}

function replyMessages(): Record<string, unknown>[] {
  return replyCalls().map((call) => (JSON.parse(call.body) as ReplyBody).messages[0] ?? {});
}

/** ข้อความแจ้งเตือนบางอย่างเป็นข้อความธรรมดา ไม่ใช่การ์ด Flex */
function expectTextMessage(message: unknown, needle: string): void {
  expect((message as { type?: unknown }).type).toBe("text");
  expect(flexText(message)).toContain(needle);
}

function expectFlexMessage(message: unknown): void {
  expect((message as { type?: unknown }).type).toBe("flex");
  expect(typeof (message as { altText?: unknown }).altText).toBe("string");
}

async function readPending(): Promise<PendingLink[]> {
  const response = await SELF.fetch(pendingUrl, withAuth(session));
  expect(response.status).toBe(200);
  return (await response.json<PendingBody>()).pending;
}

async function pendingFor(lineUserId: string): Promise<PendingLink | undefined> {
  return (await readPending()).find((item) => item.lineUserId === lineUserId);
}

async function readSettings(): Promise<SettingsPayload> {
  const response = await SELF.fetch(settingsUrl, withAuth(session));
  expect(response.status).toBe(200);
  return (await response.json<SettingsBody>()).settings;
}

async function newRoom(roomNumber: string): Promise<RoomPayload> {
  const response = await SELF.fetch(
    roomsUrl,
    withAuth(session, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomNumber, rent: 3500 }),
    }),
  );
  expect(response.status).toBe(201);
  return (await response.json<{ ok: boolean; room: RoomPayload }>()).room;
}

async function newTenant(roomId: string, fullName: string): Promise<TenantPayload> {
  const response = await SELF.fetch(
    tenantsUrl,
    withAuth(session, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fullName, phone: "081-234-5678", roomId, checkInDate: "2025-03-01" }),
    }),
  );
  expect(response.status).toBe(201);
  return (await response.json<{ ok: boolean; tenant: TenantPayload }>()).tenant;
}

async function tenantById(tenantId: string): Promise<TenantPayload> {
  const body = await (await SELF.fetch(tenantsUrl, withAuth(session))).json<TenantListBody>();
  const found = body.tenants.find((tenant) => tenant.id === tenantId);

  if (found === undefined) {
    throw new Error(`tenant ${tenantId} not found`);
  }

  return found;
}

function checkoutTenant(tenantId: string, checkOutDate: string): Promise<Response> {
  return SELF.fetch(
    `${tenantsUrl}/${tenantId}/checkout`,
    withAuth(session, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ checkOutDate }),
    }),
  );
}

function linkPending(lineUserId: string, tenantId: string): Promise<Response> {
  return SELF.fetch(
    `${pendingUrl}/${encodeURIComponent(lineUserId)}/link`,
    withAuth(session, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId }),
    }),
  );
}

function putSettings(payload: Record<string, unknown>): Promise<Response> {
  return SELF.fetch(
    settingsUrl,
    withAuth(session, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

/** เบอร์ที่ลงทะเบียนในเทสต์คือ 081-234-5678 เลขท้าย 4 ตัวจึงเป็น 5678 */
async function linkRoom(lineUserId: string, roomNumber: string): Promise<void> {
  const response = await postWebhook(lineEvents([textEvent(lineUserId, `tok-link-${lineUserId}`, `${roomNumber} 5678`)]));
  expect(response.status).toBe(200);
  expectFlexMessage(replyMessages()[0]);
  expect(flexText(replyMessages()[0])).toContain("เชื่อม LINE");
}

async function generateBill(roomId: string, period: string): Promise<BillPayload> {
  const response = await SELF.fetch(
    `${billsUrl}/generate`,
    withAuth(session, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ period, entries: [{ roomId, waterCurrent: 0, electricCurrent: 0 }] }),
    }),
  );
  expect(response.status).toBe(201);

  const bill = (await response.json<{ ok: boolean; bills: BillPayload[] }>()).bills[0];

  if (bill === undefined) {
    throw new Error("expected a generated bill");
  }

  return bill;
}

async function markBillPaid(billId: string): Promise<void> {
  const response = await SELF.fetch(
    `${billsUrl}/${encodeURIComponent(billId)}/mark-paid`,
    withAuth(session, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: "transfer" }),
    }),
  );
  expect(response.status).toBe(200);
}

beforeAll(async () => {
  session = await signIn();
  await configurePayout();

  const response = await SELF.fetch(
    settingsUrl,
    withAuth(session, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dormName }),
    }),
  );
  expect(response.status).toBe(200);
});

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  outboundCalls = [];
  profileDisplayName = "ผู้ใช้ LINE ทดสอบ";
  botInfoDisplayName = "Chumsaeng (DEV)";
  botInfoBasicId = "@490secnd";
  botInfoFails = false;
  webhookEndpoint = "https://wangchan-dorm.nodhk2545.workers.dev/webhook/line";
  webhookActive = true;
  webhookEndpointFails = false;
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

    // OA ของหอ — ใช้บอกเจ้าของว่าต้องเพิ่มเพื่อนตัวไหนก่อนพิมพ์รหัส
    if (url === lineBotInfoUrl) {
      if (botInfoFails) {
        return Promise.resolve(new Response("failed", { status: 500 }));
      }

      return Promise.resolve(
        new Response(JSON.stringify({ displayName: botInfoDisplayName, basicId: botInfoBasicId, userId: "U-bot" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }

    // webhook endpoint: GET อ่านค่าที่ตั้งไว้, PUT บันทึกแทนค่าเดิม (จำลอง LINE)
    if (url === lineWebhookEndpointUrl) {
      if (webhookEndpointFails) {
        return Promise.resolve(new Response("failed", { status: 500 }));
      }

      if ((init?.method ?? "GET") === "PUT") {
        const parsed = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as { endpoint?: string };
        webhookEndpoint = typeof parsed.endpoint === "string" ? parsed.endpoint : webhookEndpoint;
      }

      return Promise.resolve(
        new Response(JSON.stringify({ endpoint: webhookEndpoint, active: webhookActive }), {
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

    const [welcome] = replyMessages();
    expectFlexMessage(welcome);
    expect(flexText(welcome)).toContain(dormName);
    expect(flexText(welcome)).toContain("A101");
    expect(flexText(welcome)).toContain("เชื่อม LINE");

    const followed = await pendingFor("U-follow");
    expect(followed?.lineUserId).toBe("U-follow");
    expect(followed?.displayName).toBe("พลอย LINE");
    expect(followed?.lastMessage).toBeNull();
    expect(followed?.lastSeenAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("blocks the LINE profile fetch and reply outright in demo mode, even with the channel configured", async () => {
    outboundCalls = [];

    const demoModeEnv = env as unknown as { DEMO_MODE: string };
    const originalDemoMode = demoModeEnv.DEMO_MODE;
    demoModeEnv.DEMO_MODE = "1";

    try {
      const response = await postWebhook(lineEvents([followEvent("U-follow-demo", "tok-follow-demo")]));
      expect(response.status).toBe(200);
      expect(outboundCalls).toEqual([]);

      const followed = await pendingFor("U-follow-demo");
      expect(followed?.lineUserId).toBe("U-follow-demo");
    } finally {
      demoModeEnv.DEMO_MODE = originalDemoMode;
    }
  });

  it("answers a greeting that is not a room number with the guidance reply", async () => {
    const response = await postWebhook(lineEvents([textEvent("U-greeting", "tok-greeting", "สวัสดี")]));
    expect(response.status).toBe(200);

    const [guidance] = replyMessages();
    expectFlexMessage(guidance);
    expect(flexText(guidance)).toContain("ยังไม่พบห้องของคุณ");
    expect(flexText(guidance)).toContain("A101");
    expect(flexText(guidance)).toContain("ติดต่อเจ้าของหอ");

    const row = await pendingFor("U-greeting");
    expect(row?.lastMessage).toBe("สวัสดี");
  });

  it("answers 200, records the failure and releases the event so a retry succeeds once the failure clears", async () => {
    await env.DB.prepare(
      "CREATE TRIGGER fail_pending_insert BEFORE INSERT ON line_pending BEGIN SELECT RAISE(ABORT, 'forced failure'); END;",
    ).run();

    const errorSpy = vi.spyOn(console, "error");
    const body = lineEvents([followEvent("U-db-fail", "tok-db-fail")]);

    try {
      // ตอบ 200 เสมอ เพราะ LINE ไม่ส่งซ้ำให้อีก (redelivery ปิดโดยค่าเริ่มต้น)
      // การตอบ 500 จึงไม่ช่วยให้งานสำเร็จ แต่ทำให้ LINE มองว่า webhook พังทั้งชุด
      const response = await postWebhook(body);
      expect(response.status).toBe(200);

      const ok = await response.json<{ ok: boolean }>();
      expect(ok.ok).toBe(true);
      expect(await pendingFor("U-db-fail")).toBeUndefined();

      const failures = errorSpy.mock.calls
        .map((call) => JSON.parse(String(call[0])) as { message: string; error?: string })
        .filter((entry) => entry.message === "line webhook failed");

      expect(failures).toHaveLength(1);
      expect(typeof failures[0]?.error).toBe("string");
    } finally {
      errorSpy.mockRestore();
      await env.DB.prepare("DROP TRIGGER IF EXISTS fail_pending_insert").run();
    }

    // ส่ง event ตัวเดิม (webhookEventId เดิม) อีกครั้งหลังลบสาเหตุที่ทำให้ล้มเหลว
    // ต้องประมวลผลได้จริง ไม่ถูกมองว่า "เคยทำไปแล้ว" จากความล้มเหลวครั้งก่อน
    outboundCalls.length = 0;
    const retried = await postWebhook(body);
    expect(retried.status).toBe(200);
    expect(replyCalls()).toHaveLength(1);
    expect(await pendingFor("U-db-fail")).toBeDefined();
  });

  it("answers 200 and applies the link when the outbound reply fails", async () => {
    const room = await newRoom("L208");
    const tenant = await newTenant(room.id, "วิภา ใจงาม");

    replyFails = true;

    const response = await postWebhook(lineEvents([textEvent("U-reply-fail", "tok-reply-fail", "L208 5678")]));
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
    const linked = await postWebhook(lineEvents([textEvent("U-link", "tok-room-2", "l201 5678")]));
    expect(linked.status).toBe(200);

    expect((await tenantById(tenant.id)).lineUserId).toBe("U-link");
    expect(await pendingFor("U-link")).toBeUndefined();
    const [linkedReply] = replyMessages();
    expectFlexMessage(linkedReply);
    expect(flexText(linkedReply)).toContain("สมชาย ใจดี");
    expect(flexText(linkedReply)).toContain("L201");
  });

  it("keeps an unknown and a vacant room number as pending rows with the not-matched reply", async () => {
    await newRoom("L202");

    const unknown = await postWebhook(lineEvents([textEvent("U-unknown", "tok-unknown", "Z902")]));
    expect(unknown.status).toBe(200);
    const vacant = await postWebhook(lineEvents([textEvent("U-vacant", "tok-vacant", "L202")]));
    expect(vacant.status).toBe(200);

    const notMatched = replyMessages();
    expect(notMatched).toHaveLength(2);
    expectFlexMessage(notMatched[0]);
    expectFlexMessage(notMatched[1]);
    expect(flexText(notMatched[0])).toContain("Z902");
    expect(flexText(notMatched[1])).toContain("L202");
    expect(flexText(notMatched[0])).toContain("ไม่พบห้อง");

    const vacantRow = await pendingFor("U-vacant");
    expect(vacantRow?.lineUserId).toBe("U-vacant");
    expect(vacantRow?.displayName).toBe("");
    expect(vacantRow?.lastMessage).toBe("L202");
    expect(vacantRow?.lastSeenAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect((await pendingFor("U-unknown"))?.lastMessage).toBe("Z902");
  });

  it("links the owner with the current code, consumes it, and refuses to reuse it", async () => {
    const before = await readSettings();
    expect(before.ownerLinkCode).toMatch(/^\d{6}$/);

    const response = await postWebhook(lineEvents([textEvent("U-owner", "tok-owner", before.ownerLinkCode)]));
    expect(response.status).toBe(200);

    const after = await readSettings();
    expect(after.ownerLineConnected).toBe(true);
    const [owner] = replyMessages();
    expectFlexMessage(owner);
    expect(flexText(owner)).toContain("เชื่อม LINE เจ้าของ");
    expect(flexText(owner)).toContain("แจ้งเตือน");
    expect(await pendingFor("U-owner")).toBeUndefined();

    const ownerRow = await env.DB.prepare("SELECT value FROM settings WHERE family_id = ? AND key = 'owner_line_user_id'")
      .bind(session.familyId)
      .first<{ value: string }>();
    expect(ownerRow?.value).toBe("U-owner");

    const consumed = await env.DB.prepare(
      "SELECT key, value FROM settings WHERE family_id = ? AND key IN ('owner_link_code', 'owner_link_code_expires_at')",
    )
      .bind(session.familyId)
      .all<{ key: string; value: string }>();
    expect(consumed.results.map((row) => row.value)).toEqual(["", ""]);

    outboundCalls.length = 0;
    const reused = await postWebhook(lineEvents([textEvent("U-owner-thief", "tok-owner-thief", before.ownerLinkCode)]));
    expect(reused.status).toBe(200);

    const stillOwner = await env.DB.prepare("SELECT value FROM settings WHERE family_id = ? AND key = 'owner_line_user_id'")
      .bind(session.familyId)
      .first<{ value: string }>();
    expect(stillOwner?.value).toBe("U-owner");
    expect(flexText(replyMessages()[0])).toContain("ไม่พบห้อง");
  });

  it("lets only one of two concurrent claimants win the same owner code", async () => {
    // ล้างสถานะเดิมและออกรหัสใหม่เอง ไม่พึ่งรหัสจากเทสต์ก่อนหน้า เพราะเทสต์
    // ก่อนหน้าอาจผูกเจ้าของไปแล้ว ทำให้ไม่มีรหัสให้แข่งกันเลย
    await env.DB.prepare("DELETE FROM settings WHERE family_id = ? AND key = 'owner_line_user_id'")
      .bind(session.familyId)
      .run();
    const regenerated = await SELF.fetch(`${settingsUrl}/owner-code`, withAuth(session, { method: "POST" }));
    expect(regenerated.status).toBe(200);
    const { ownerLinkCode: code } = await regenerated.json<{ ok: boolean; ownerLinkCode: string }>();
    expect(code).toMatch(/^\d{6}$/);

    const [first, second] = await Promise.all([
      postWebhook(lineEvents([textEvent("U-owner-race-a", "tok-owner-race-a", code)])),
      postWebhook(lineEvents([textEvent("U-owner-race-b", "tok-owner-race-b", code)])),
    ]);

    // ทั้งสองฝ่ายได้ 200 เสมอ (ฝ่ายแพ้ตกไปตอบแบบ "ไม่ตรง" อย่างสุภาพ ไม่ใช่ error)
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const ownerRow = await env.DB.prepare(
      "SELECT value FROM settings WHERE family_id = ? AND key = 'owner_line_user_id'",
    )
      .bind(session.familyId)
      .first<{ value: string }>();

    // ต้องมีผู้ชนะเพียงคนเดียว ไม่ใช่ค่าว่างหรือถูกเขียนทับจนไม่รู้ว่าใครชนะ
    expect(["U-owner-race-a", "U-owner-race-b"]).toContain(ownerRow?.value);

    const consumed = await env.DB.prepare(
      "SELECT key, value FROM settings WHERE family_id = ? AND key IN ('owner_link_code', 'owner_link_code_expires_at')",
    )
      .bind(session.familyId)
      .all<{ key: string; value: string }>();
    expect(consumed.results.map((row) => row.value)).toEqual(["", ""]);
  });

  it("refuses an owner code whose expiry has passed", async () => {
    await env.DB.prepare("DELETE FROM settings WHERE family_id = ? AND key = 'owner_line_user_id'").bind(session.familyId).run();
    const code = (await readSettings()).ownerLinkCode;
    await env.DB.prepare(
      "UPDATE settings SET value = ? WHERE family_id = ? AND key = 'owner_link_code_expires_at'",
    )
      .bind("2020-01-01T00:00:00.000Z", session.familyId)
      .run();

    const response = await postWebhook(lineEvents([textEvent("U-owner-expired", "tok-owner-expired", code)]));
    expect(response.status).toBe(200);
    expect(flexText(replyMessages()[0])).toContain("ไม่พบห้อง");

    const connected = await env.DB.prepare("SELECT value FROM settings WHERE family_id = ? AND key = 'owner_line_user_id'")
      .bind(session.familyId)
      .first<{ value: string }>();
    expect(connected).toBeNull();
  });

  it("stops accepting an owner code that was replaced", async () => {
    const before = await readSettings();
    const regenerated = await SELF.fetch(`${settingsUrl}/owner-code`, withAuth(session, { method: "POST" }));
    expect(regenerated.status).toBe(200);

    const next = await regenerated.json<{ ok: boolean; ownerLinkCode: string }>();
    expect(next.ownerLinkCode).not.toBe(before.ownerLinkCode);

    const response = await postWebhook(lineEvents([textEvent("U-old-code", "tok-old", before.ownerLinkCode)]));
    expect(response.status).toBe(200);
    const [stale] = replyMessages();
    expectFlexMessage(stale);
    expect(flexText(stale)).toContain(before.ownerLinkCode);
    expect(flexText(stale)).toContain("ไม่พบห้อง");
    expect((await pendingFor("U-old-code"))?.lastMessage).toBe(before.ownerLinkCode);
  });

  it("sends no reply and stores nothing for an already linked tenant", async () => {
    const room = await newRoom("L203");
    const tenant = await newTenant(room.id, "มาลี ศรีสุข");

    await postWebhook(lineEvents([textEvent("U-linked", "tok-1", "L203 5678")]));
    expect((await tenantById(tenant.id)).lineUserId).toBe("U-linked");
    expect(replyMessages()).toHaveLength(1);

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

  it("processes a redelivered event only once", async () => {
    const body = lineEvents([followEvent("U-redelivered", "tok-redelivered")]);

    const first = await postWebhook(body);
    expect(first.status).toBe(200);
    expect(replyCalls()).toHaveLength(1);

    outboundCalls.length = 0;
    const second = await postWebhook(body);
    expect(second.status).toBe(200);
    expect(replyCalls()).toEqual([]);
  });

  it("prunes event ids older than a day and keeps the fresh ones", async () => {
    await env.DB.prepare("INSERT INTO line_events (id, received_at) VALUES ('evt-stale', datetime('now', '-2 days'))").run();

    const response = await postWebhook(lineEvents([followEvent("U-prune", "tok-prune")]));
    expect(response.status).toBe(200);

    const stale = await env.DB.prepare("SELECT id FROM line_events WHERE id = 'evt-stale'").first();
    expect(stale).toBeNull();

    const fresh = await env.DB.prepare("SELECT COUNT(*) AS total FROM line_events").first<{ total: number }>();
    expect(fresh?.total).toBeGreaterThan(0);
  });
});

interface ForeignFamilySeed {
  familyId: string;
  tenantId: string;
  lineUserId: string;
  roomNumber: string;
}

/** ข้อมูลของครอบครัวอื่น ใช้พิสูจน์ว่ามองไม่เห็นกัน */
async function seedForeignFamily(): Promise<ForeignFamilySeed> {
  const family = await createFamily("ครอบครัวอื่น");
  const roomId = crypto.randomUUID();
  const tenantId = crypto.randomUUID();
  const lineUserId = `U-foreign-${crypto.randomUUID()}`;
  const roomNumber = `X9${String(Math.floor(Math.random() * 90) + 10)}`;

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO rooms (id, family_id, room_number, rent, water_meter_init, electric_meter_init, status) VALUES (?, ?, ?, 3500, 0, 0, 'occupied')",
    ).bind(roomId, family, roomNumber),
    env.DB.prepare(
      "INSERT INTO tenants (id, family_id, full_name, phone, room_id, check_in_date, status) VALUES (?, ?, 'ผู้เช่าครอบครัวอื่น', '0899999999', ?, '2025-01-01', 'current')",
    ).bind(tenantId, family, roomId),
    env.DB.prepare(
      "INSERT INTO line_pending (line_user_id, family_id, display_name, last_message, last_seen_at) VALUES (?, ?, 'ต่างครอบครัว', ?, datetime('now'))",
    ).bind(lineUserId, family, roomNumber),
  ]);

  return { familyId: family, tenantId, lineUserId, roomNumber };
}

describe("tenant linking needs a second factor", () => {
  it("refuses a bare room number and asks for the phone tail instead of linking", async () => {
    const room = await newRoom("L301");
    const tenant = await newTenant(room.id, "สมชาย สองชั้น");

    const response = await postWebhook(lineEvents([textEvent("U-bare", "tok-bare", "L301")]));
    expect(response.status).toBe(200);

    expect((await tenantById(tenant.id)).lineUserId).toBeNull();
    const [prompt] = replyMessages();
    expectTextMessage(prompt, "เลขท้าย 4 ตัว");
    expect(flexText(prompt)).toContain("302 1234");
    expect(flexText(prompt)).not.toContain("สมชาย สองชั้น");
    expect((await pendingFor("U-bare"))?.lastMessage).toBe("L301");
  });

  it("refuses a room number with a phone tail that does not match the tenant", async () => {
    const room = await newRoom("L302");
    const tenant = await newTenant(room.id, "สมหญิง ผิดเบอร์");

    const response = await postWebhook(lineEvents([textEvent("U-wrong-phone", "tok-wrong-phone", "L302 0000")]));
    expect(response.status).toBe(200);

    expect((await tenantById(tenant.id)).lineUserId).toBeNull();
    const [refusal] = replyMessages();
    expectTextMessage(refusal, "เลขท้าย 4 ตัวไม่ตรงกับเบอร์ที่ลงทะเบียนไว้");
    expect(flexText(refusal)).not.toContain("สมหญิง ผิดเบอร์");
    expect((await pendingFor("U-wrong-phone"))?.lastMessage).toBe("L302 0000");
  });

  it("links when the room number and the registered phone tail both match", async () => {
    const room = await newRoom("L303");
    const tenant = await newTenant(room.id, "สมปอง ถูกเบอร์");

    const response = await postWebhook(lineEvents([textEvent("U-both", "tok-both", "l303 5678")]));
    expect(response.status).toBe(200);

    expect((await tenantById(tenant.id)).lineUserId).toBe("U-both");
    const [linked] = replyMessages();
    expect(flexText(linked)).toContain("สมปอง ถูกเบอร์");
    expect(flexText(linked)).toContain("L303");
    expect(await pendingFor("U-both")).toBeUndefined();
  });

  it("refuses to take over a room whose tenant is already linked to someone else", async () => {
    const room = await newRoom("L304");
    const tenant = await newTenant(room.id, "วีระ มีเจ้าของแล้ว");
    await linkRoom("U-first-owner", "L304");

    outboundCalls.length = 0;
    const response = await postWebhook(lineEvents([textEvent("U-imposter", "tok-imposter", "L304 5678")]));
    expect(response.status).toBe(200);

    expect((await tenantById(tenant.id)).lineUserId).toBe("U-first-owner");
    const [refusal] = replyMessages();
    expectTextMessage(refusal, "ห้องนี้เชื่อม LINE ไว้แล้ว");
    expect(await pendingFor("U-imposter")).toBeUndefined();
  });
});

describe("LINE family isolation", () => {
  it("keeps another family's pending rows and tenants out of reach", async () => {
    const foreign = await seedForeignFamily();

    const own = await readPending();
    expect(own.some((item) => item.lineUserId === foreign.lineUserId)).toBe(false);

    const other = await signIn("owner", foreign.familyId);
    const otherResponse = await SELF.fetch(pendingUrl, withAuth(other));
    expect(otherResponse.status).toBe(200);
    const otherPending = (await otherResponse.json<PendingBody>()).pending;
    expect(otherPending.map((item) => item.lineUserId)).toEqual([foreign.lineUserId]);

    const linked = await linkPending(foreign.lineUserId, foreign.tenantId);
    expect(linked.status).toBe(404);
    expect((await linked.json<ErrorBody>()).error.code).toBe("NOT_FOUND");

    const tenantRow = await env.DB.prepare("SELECT line_user_id FROM tenants WHERE id = ?")
      .bind(foreign.tenantId)
      .first<{ line_user_id: string | null }>();
    expect(tenantRow?.line_user_id).toBeNull();
  });

  it("never links a tenant of another family through the LINE channel", async () => {
    const foreign = await seedForeignFamily();

    const response = await postWebhook(lineEvents([textEvent("U-cross", "tok-cross", `${foreign.roomNumber} 9999`)]));
    expect(response.status).toBe(200);

    const tenantRow = await env.DB.prepare("SELECT line_user_id FROM tenants WHERE id = ?")
      .bind(foreign.tenantId)
      .first<{ line_user_id: string | null }>();
    expect(tenantRow?.line_user_id).toBeNull();
    expect((await pendingFor("U-cross"))?.lastMessage).toBe(`${foreign.roomNumber} 9999`);
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

    const [instruction] = replyMessages();
    expectFlexMessage(instruction);
    expect(flexText(instruction)).toContain("ส่งรูปสลิปโอนเงิน");
    expect(flexText(instruction)).toContain("ตรวจสอบสลิป");
  });

  it("answers บิลของฉัน with the latest unpaid bill for a linked tenant", async () => {
    const room = await newRoom("K302");
    await newTenant(room.id, "บี LINE");
    await generateBill(room.id, "2026-09");
    await linkRoom("U-keyword-bills", "K302");

    outboundCalls.length = 0;
    const response = await postWebhook(lineEvents([textEvent("U-keyword-bills", "tok-keyword-bills", "บิลของฉัน")]));
    expect(response.status).toBe(200);

    const [unpaid] = replyMessages();
    expectFlexMessage(unpaid);
    expect(flexText(unpaid)).toContain("K302");
    expect(flexText(unpaid)).toContain("กันยายน 2569");
    expect(flexText(unpaid)).toContain("3,500");
    expect(flexText(unpaid)).toContain("ค้างชำระ");
    expect(flexText(unpaid)).toContain("ส่งสลิปในแชทนี้");
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

    const [paid] = replyMessages();
    expectFlexMessage(paid);
    expect(flexText(paid)).toContain("K303");
    expect(flexText(paid)).toContain("กันยายน 2569");
    expect(flexText(paid)).toContain("3,500");
    expect(flexText(paid)).toContain("ชำระแล้ว");
    expect(flexText(paid)).toContain("ไม่มียอดค้างชำระ");
  });

  it("answers บิลของฉัน honestly when a linked tenant has no bill yet", async () => {
    const room = await newRoom("K304");
    await newTenant(room.id, "ดิว LINE");
    await linkRoom("U-keyword-nobill", "K304");

    outboundCalls.length = 0;
    const response = await postWebhook(lineEvents([textEvent("U-keyword-nobill", "tok-keyword-nobill", "บิลของฉัน")]));
    expect(response.status).toBe(200);

    const [missingBill] = replyMessages();
    expectFlexMessage(missingBill);
    expect(flexText(missingBill)).toContain("K304");
    expect(flexText(missingBill)).toContain("ยังไม่มีบิล");
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

    const [contact] = replyMessages();
    expectFlexMessage(contact);
    expect(flexText(contact)).toContain("สมศักดิ์ ใจดี");
    expect(flexText(contact)).toContain("เบอร์โทร");
    expect(flexText(contact)).toContain("0812345678");
  });

  it("answers ติดต่อเจ้าของ without a blank number when the owner phone is empty", async () => {
    const saved = await putSettings({ ownerName: "สมศักดิ์ ใจดี", ownerPhone: "" });
    expect(saved.status).toBe(200);

    outboundCalls.length = 0;
    const response = await postWebhook(lineEvents([textEvent("U-keyword-owner-empty", "tok-keyword-owner-empty", "ติดต่อเจ้าของ")]));
    expect(response.status).toBe(200);

    const [contact] = replyMessages();
    expectFlexMessage(contact);
    const text = flexText(contact);
    expect(text).toContain("สมศักดิ์ ใจดี");
    expect(text).toContain("ยังไม่ได้บันทึกช่องทางติดต่อไว้");
    expect(text).toContain("กรุณาฝากคำถามไว้ในแชทนี้แล้วรอการติดต่อกลับ");
    expect(text).not.toMatch(/เบอร์โทร\s*\d/);
  });

  it("sends the owner's LINE id with a copy button so a tenant can add them", async () => {
    const room = await newRoom("K308");
    await newTenant(room.id, "เมย์ LINE");
    await linkRoom("U-keyword-lineid", "K308");

    const saved = await putSettings({
      ownerName: "สมศักดิ์ ใจดี",
      ownerPhone: "081-234-5678",
      ownerLineId: "@somchai_owner",
    });
    expect(saved.status).toBe(200);

    outboundCalls.length = 0;
    const response = await postWebhook(lineEvents([textEvent("U-keyword-lineid", "tok-keyword-lineid", "ติดต่อเจ้าของ")]));
    expect(response.status).toBe(200);

    const [contact] = replyMessages();
    expectFlexMessage(contact);
    const text = flexText(contact);
    expect(text).toContain("LINE ส่วนตัวของเจ้าของ");
    expect(text).toContain("@somchai_owner");
    // เบอร์โทรยังอยู่ครบ — LINE เป็นช่องทางเพิ่ม ไม่ใช่ตัวแทน
    expect(text).toContain("0812345678");

    // ปุ่มคัดลอกต้องพาค่าเดียวกันไปวางในคลิปบอร์ด ไม่ใช่แค่แสดงข้อความ
    const json = JSON.stringify(contact);
    expect(json).toContain('"type":"clipboard"');
    expect(json).toContain('"clipboardText":"@somchai_owner"');
  });

  it("shows only the LINE id when the owner has no phone, and rejects a malformed LINE id", async () => {
    const saved = await putSettings({ ownerName: "สมศักดิ์ ใจดี", ownerPhone: "", ownerLineId: "@somchai_owner" });
    expect(saved.status).toBe(200);

    outboundCalls.length = 0;
    await postWebhook(lineEvents([textEvent("U-keyword-lineonly", "tok-keyword-lineonly", "ติดต่อเจ้าของ")]));

    const [contact] = replyMessages();
    const text = flexText(contact);
    expect(text).toContain("@somchai_owner");
    expect(text).not.toContain("ยังไม่ได้บันทึกช่องทางติดต่อไว้");

    const bad = await putSettings({ ownerLineId: "มีช่องว่าง ไม่ได้" });
    expect(bad.status).toBe(400);
    expect((await bad.json<{ error: { field: string } }>()).error.field).toBe("ownerLineId");

    const tooShort = await putSettings({ ownerLineId: "@ab" });
    expect(tooShort.status).toBe(400);
  });

  it("normalises a pasted LINE id by stripping quotes and spaces", async () => {
    const saved = await putSettings({ ownerLineId: '  "@somchai_owner"  ' });
    expect(saved.status).toBe(200);

    expect(((await saved.json<{ settings: { ownerLineId: string } }>()).settings).ownerLineId).toBe("@somchai_owner");
  });

  it("refuses the dorm's own OA id as the owner's personal LINE", async () => {
    // OA ของหอคือบัญชีที่ผู้เช่ากำลังคุยด้วย การ์ดที่ส่ง id นี้กลับไปจึงไร้ประโยชน์
    const withAt = await putSettings({ ownerLineId: "@490secnd" });
    expect(withAt.status).toBe(400);
    const body = await withAt.json<{ error: { field: string; message: string } }>();
    expect(body.error.field).toBe("ownerLineId");
    expect(body.error.message).toContain("OA หอ");

    // ไม่ใส่ @ ก็ต้องถูกปฏิเสธเหมือนกัน (ตัด @ ที่ผู้ใช้มักคัดลอกมาทิ้งก่อนเทียบ)
    expect((await putSettings({ ownerLineId: "490secnd" })).status).toBe(400);

    // ค่าที่บันทึกไว้เดิมต้องไม่ถูกทับด้วยคำขอที่ถูกปฏิเสธ
    const saved = await putSettings({ ownerLineId: "@somchai_owner" });
    expect(saved.status).toBe(200);
    expect((await readSettings()).ownerLineId).toBe("@somchai_owner");
  });

  it("answers ลงทะเบียน with the registration link for a linked tenant", async () => {
    const room = await newRoom("K306");
    await newTenant(room.id, "เอ LINE");
    await linkRoom("U-keyword-register", "K306");

    outboundCalls.length = 0;
    const response = await postWebhook(lineEvents([textEvent("U-keyword-register", "tok-keyword-register", "ลงทะเบียน")]));
    expect(response.status).toBe(200);

    const links = replyMessages();
    const [link] = links;
    expectFlexMessage(link);
    expect(flexText(link)).toContain("ลิงก์ลงทะเบียนผู้เช่า");
    expect(flexText(link)).toContain(registerUrl);
    /**
     * หน้านี้ต้องเปิด **ใน** แอป LINE เพราะใช้ `liff.isInClient()` และส่ง access
     * token ของ LIFF ไปยืนยัน — ห้ามเติม openExternalBrowser ไม่งั้นฟอร์มจะขึ้น
     * "เปิดฟอร์มนี้จากในแอป LINE เท่านั้น" แล้วลงทะเบียนไม่ได้เลย
     */
    expect(JSON.stringify(link)).not.toContain("openExternalBrowser");
  });

  it("points บิลของฉัน and ลงทะเบียน from an unlinked user at registration and records no pending row", async () => {
    const billsResponse = await postWebhook(lineEvents([textEvent("U-unlinked-bills", "tok-unlinked-bills", "บิลของฉัน")]));
    expect(billsResponse.status).toBe(200);

    const registerResponse = await postWebhook(lineEvents([textEvent("U-unlinked-register", "tok-unlinked-register", "ลงทะเบียน")]));
    expect(registerResponse.status).toBe(200);

    const required = replyMessages();
    expect(required).toHaveLength(2);
    expectFlexMessage(required[0]);
    expectFlexMessage(required[1]);
    expect(flexText(required[0])).toContain(registerUrl);
    expect(flexText(required[1])).toContain(registerUrl);

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

describe("dorm OA identity shown in settings", () => {
  /** cache ของ OA อยู่ในตาราง meta ซึ่งไม่ถูกล้างระหว่างเทสต์ — ต้องล้างเอง */
  async function clearBotInfoCache(): Promise<void> {
    await env.DB.prepare("DELETE FROM meta WHERE key = 'line_bot_info'").run();
  }

  it("reports the OA name and basic id fetched from LINE so the owner knows what to add", async () => {
    await clearBotInfoCache();
    const settings = await readSettings();
    expect(settings.lineBot).toEqual({ displayName: "Chumsaeng (DEV)", basicId: "@490secnd" });
  });

  it("caches the OA info instead of calling LINE on every settings load", async () => {
    await clearBotInfoCache();
    await readSettings();
    const callsAfterFirst = outboundCalls.filter((call) => call.url === lineBotInfoUrl).length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    outboundCalls.length = 0;
    await readSettings();
    await readSettings();
    expect(outboundCalls.filter((call) => call.url === lineBotInfoUrl)).toEqual([]);
  });

  it("reuses the cached OA info when LINE later fails", async () => {
    await clearBotInfoCache();
    const warm = await readSettings();
    expect(warm.lineBot?.basicId).toBe("@490secnd");

    // cache ยังไม่หมดอายุ → ดึงไม่ได้ก็ยังตอบค่าเดิมได้ ไม่ใช่หายไปเฉย ๆ
    botInfoFails = true;
    const stillThere = await readSettings();
    expect(stillThere.lineBot?.basicId).toBe("@490secnd");
  });

  it("falls back to a usable answer when LINE cannot be reached", async () => {
    await clearBotInfoCache();
    // ดึงไม่ได้ครั้งแรก → ต้องไม่ล้ม และต้องไม่แสดงค่าปลอม
    botInfoFails = true;
    const first = await readSettings();
    expect(first.lineBot).toBeNull();
    // ค่าอื่นยังอ่านได้ปกติ (หน้าตั้งค่าไม่ล้มทั้งหน้าเพราะ LINE ล่ม)
    expect(first.dormName).not.toBe("");

    // ค่าที่ดึงไม่ได้ต้องไม่ถูก cache ทิ้ง — พอ LINE กลับมาแล้วต้องได้ค่าจริง
    botInfoFails = false;
    const recovered = await readSettings();
    expect(recovered.lineBot?.basicId).toBe("@490secnd");
  });
});

describe("owner unlink and LINE channel status", () => {
  async function linkOwnerDirect(lineUserId: string, displayName: string): Promise<void> {
    await env.DB.prepare(
      "INSERT INTO settings (family_id, key, value, updated_at) VALUES (?, 'owner_line_user_id', ?, datetime('now')) ON CONFLICT(family_id, key) DO UPDATE SET value = excluded.value",
    )
      .bind(session.familyId, lineUserId)
      .run();
    await env.DB.prepare(
      "INSERT INTO line_pending (line_user_id, family_id, display_name, last_message, last_seen_at) VALUES (?, ?, ?, NULL, datetime('now')) ON CONFLICT(line_user_id) DO UPDATE SET display_name = excluded.display_name",
    )
      .bind(lineUserId, session.familyId, displayName)
      .run();
  }

  async function unlink(): Promise<Response> {
    return SELF.fetch(`${settingsUrl}/owner-link`, withAuth(session, { method: "DELETE" }));
  }

  it("says who is connected, not just that someone is", async () => {
    await linkOwnerDirect("U-owner-who", "สมชาย เจ้าของหอ");

    const settings = await readSettings();
    expect(settings.ownerLineConnected).toBe(true);
    expect(settings.ownerLineDisplayName).toBe("สมชาย เจ้าของหอ");
  });

  it("reports null (not an empty name) when nobody is connected", async () => {
    await env.DB.prepare("DELETE FROM settings WHERE family_id = ? AND key = 'owner_line_user_id'")
      .bind(session.familyId)
      .run();

    const settings = await readSettings();
    expect(settings.ownerLineConnected).toBe(false);
    expect(settings.ownerLineDisplayName).toBeNull();
  });

  it("clears the link, the pending row and the old code so an old code cannot re-link", async () => {
    await linkOwnerDirect("U-owner-unlink", "สมหญิง เลิกเชื่อม");
    const regenerated = await SELF.fetch(`${settingsUrl}/owner-code`, withAuth(session, { method: "POST" }));
    const { ownerLinkCode: oldCode } = await regenerated.json<{ ok: boolean; ownerLinkCode: string }>();
    expect(oldCode).toMatch(/^\d{6}$/);

    const response = await unlink();
    expect(response.status).toBe(200);

    const after = await readSettings();
    expect(after.ownerLineConnected).toBe(false);
    expect(after.ownerLineDisplayName).toBeNull();

    /**
     * `readSettings()` ข้างบนทำให้หน้าตั้งค่าออกรหัสใหม่ให้เอง (ตามตรรกะใน
     * loadSettings: ยังไม่ผูก + ไม่มีรหัสที่ใช้ได้ → ออกให้) จึงต้องตรวจว่า
     * "รหัสเดิมถูกยกเลิก" ไม่ใช่ "ไม่มีรหัสเลย" — และ userId ต้องว่างจริง
     */
    const unlinkedOwnerRow = await env.DB.prepare(
      "SELECT value FROM settings WHERE family_id = ? AND key = 'owner_line_user_id'",
    )
      .bind(session.familyId)
      .first<{ value: string }>();
    expect(unlinkedOwnerRow?.value).toBe("");

    const freshCodeRow = await env.DB.prepare(
      "SELECT value FROM settings WHERE family_id = ? AND key = 'owner_link_code'",
    )
      .bind(session.familyId)
      .first<{ value: string }>();
    expect(freshCodeRow?.value).not.toBe(oldCode);

    // pending ของบัญชีเดิมต้องไม่ค้าง (ไม่งั้นหน้าจอจะยังโชว์ชื่อที่ผูกอยู่)
    expect(await pendingFor("U-owner-unlink")).toBeUndefined();

    // รหัสเดิมต้องใช้ไม่ได้ทันที ไม่งั้นคนถือรหัสเก่าผูกกลับเข้ามาได้เอง
    outboundCalls.length = 0;
    await postWebhook(lineEvents([textEvent("U-owner-intruder", "tok-owner-intruder", oldCode)]));
    const ownerRow = await env.DB.prepare(
      "SELECT value FROM settings WHERE family_id = ? AND key = 'owner_line_user_id'",
    )
      .bind(session.familyId)
      .first<{ value: string }>();
    expect(ownerRow?.value).toBe("");

    // และหน้าตั้งค่าต้องออกรหัสใหม่ให้ หลังไม่มีรหัสที่ใช้ได้และยังไม่ผูก
    const fresh = await readSettings();
    expect(fresh.ownerLinkCode).toMatch(/^\d{6}$/);
    expect(fresh.ownerLinkCode).not.toBe(oldCode);
  });

  it("reports which OA the token points at and whether the webhook points back here", async () => {
    const response = await SELF.fetch(`${settingsUrl}/line-channel`, withAuth(session));
    expect(response.status).toBe(200);

    const { channel } = await response.json<{
      channel: {
        tokenConfigured: boolean;
        secretConfigured: boolean;
        bot: { displayName: string; basicId: string } | null;
        webhook: { endpoint: string; active: boolean } | null;
        webhookPointsHere: boolean;
        expectedWebhookEndpoint: string;
      };
    }>();

    expect(channel.tokenConfigured).toBe(true);
    expect(channel.secretConfigured).toBe(true);
    expect(channel.bot?.basicId).toBe("@490secnd");
    expect(channel.expectedWebhookEndpoint).toBe("https://dorm.test/webhook/line");
    // LINE ตั้ง webhook ไว้ที่ production ในเทสต์ (mock) → ต้องบอกว่าไม่ตรง ไม่ใช่เงียบ
    expect(channel.webhookPointsHere).toBe(false);
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
    const replyBody = JSON.parse(reply?.body ?? "") as ReplyBody;
    expect(replyBody.replyToken).toBe("tok-bearer");
    expect(replyBody.messages).toHaveLength(1);
    const welcome = replyBody.messages[0];
    expect((welcome as { type?: unknown }).type).toBe("flex");
    expect(flexText(welcome)).toContain(dormName);
    expect(flexText(welcome)).toContain("A101");

    expect((await pendingFor("U-bearer"))?.displayName).toBe("สมหญิง LINE");
  });
});

interface LineMessageKindPayload {
  key: string;
  title: string;
  audience: string;
  trigger: string;
  message: { type: string; altText?: string; contents?: unknown };
}

interface LineMessagesBody {
  ok: boolean;
  source: { period: string; roomNumber: string; tenantName: string } | null;
  lastSent: { sentAt: string; roomNumber: string; period: string } | null;
  messages: LineMessageKindPayload[];
}

async function readLineMessages(): Promise<LineMessagesBody> {
  const response = await SELF.fetch(lineMessagesUrl, withAuth(session));
  expect(response.status).toBe(200);
  return response.json<LineMessagesBody>();
}

async function clearBills(): Promise<void> {
  await env.DB.prepare("DELETE FROM bill_charges").run();
  await env.DB.prepare("DELETE FROM bills").run();
}

describe("GET /api/line/messages", () => {
  it("returns the real message kinds, each as a Flex card", async () => {
    await clearBills();

    const body = await readLineMessages();
    expect(body.ok).toBe(true);
    expect(body.messages.length).toBeGreaterThan(0);

    for (const kind of body.messages) {
      expect(kind.key).not.toBe("");
      expect(kind.title).not.toBe("");
      expect(kind.trigger).not.toBe("");
      expect(["tenant", "owner"]).toContain(kind.audience);
      expect(kind.message.type).toBe("flex");
      expect(typeof kind.message.altText).toBe("string");
      expect(typeof kind.message.contents).toBe("object");
    }
  });

  it("omits the bill-dependent kinds when no bill exists", async () => {
    await clearBills();

    const body = await readLineMessages();
    const keys = body.messages.map((kind) => kind.key);

    expect(body.source).toBeNull();
    expect(keys).not.toContain("bill");
    expect(keys).not.toContain("payment");
    expect(keys).not.toContain("owner_slip");
    expect(keys).toContain("welcome");
    expect(keys).toContain("slip_review");
    expect(keys).toContain("contact_owner");
  });

  it("carries the real room number and total on the bill card when a bill exists", async () => {
    await clearBills();

    const room = await newRoom("M401");
    await newTenant(room.id, "สมหญิง รักดี");
    const bill = await generateBill(room.id, "2026-11");

    const body = await readLineMessages();
    const billKind = body.messages.find((kind) => kind.key === "bill");

    expect(billKind).toBeDefined();
    expect(billKind?.message.type).toBe("flex");
    expect(body.source?.roomNumber).toBe("M401");
    expect(body.source?.tenantName).toBe("สมหญิง รักดี");

    const text = flexText(billKind?.message);
    expect(text).toContain("M401");
    expect(text).toContain("สมหญิง รักดี");
    expect(text).toContain(bill.total.toLocaleString("en-US"));
  });

  it("lists the owner send summary as a card built from the real bills of the latest period", async () => {
    await clearBills();

    const withoutBills = await readLineMessages();
    expect(withoutBills.messages.some((kind) => kind.key === "owner_send_summary")).toBe(false);

    const room = await newRoom("M402");
    const tenant = await newTenant(room.id, "ปรีชา ส่งบิล");
    const bill = await generateBill(room.id, "2026-12");

    const body = await readLineMessages();
    const summary = body.messages.find((kind) => kind.key === "owner_send_summary");

    expect(summary).toBeDefined();
    expect(summary?.audience).toBe("owner");
    expect(summary?.title).not.toBe("");
    expect(summary?.trigger).not.toBe("");
    expect(summary?.message.type).toBe("flex");
    expect(typeof summary?.message.altText).toBe("string");

    const text = flexText(summary?.message);
    expect(text).toContain("ธันวาคม 2569");
    expect(text).toContain("บิลทั้งหมด");
    expect(text).toContain(bill.total.toLocaleString("en-US"));
    expect(text).toContain("ยังไม่เชื่อม LINE");
    expect(text).toContain("M402");
    expect(text).toContain("ปรีชา ส่งบิล");
    expect(text).toContain("ส่งบิลไม่ครบทุกห้อง");

    await env.DB.prepare("UPDATE tenants SET line_user_id = ? WHERE id = ?").bind("U-m402", tenant.id).run();

    const linked = await readLineMessages();
    const linkedText = flexText(linked.messages.find((kind) => kind.key === "owner_send_summary")?.message);
    expect(linkedText).toContain("ไม่เชื่อม LINE 0 ห้อง");
    expect(linkedText).toContain("ส่งไม่สำเร็จ 0 ใบ");
    expect(linkedText).toContain("ส่งบิลไม่ครบทุกห้อง");
    expect(linkedText).not.toContain("M402");
  });

  it("reports the most recent real bill send so the page can answer 'when'", async () => {
    await clearBills();

    const withoutSend = await readLineMessages();
    expect(withoutSend.lastSent).toBeNull();

    const firstRoom = await newRoom("M501");
    await newTenant(firstRoom.id, "สมปอง ส่งก่อน");
    await generateBill(firstRoom.id, "2026-05");

    const room = await newRoom("M502");
    const tenant = await newTenant(room.id, "วิภา ส่งทีหลัง");
    const bill = await generateBill(room.id, "2026-06");
    await env.DB.prepare("UPDATE tenants SET line_user_id = ? WHERE id = ?").bind("U-m502", tenant.id).run();

    const sentAt = "2026-06-05 03:00:00";
    await env.DB.prepare("UPDATE bills SET sent_at = ? WHERE id = ?").bind(sentAt, bill.id).run();
    await env.DB.prepare("UPDATE bills SET sent_at = ? WHERE family_id = ? AND period = ?")
      .bind("2026-05-01 03:00:00", session.familyId, "2026-05")
      .run();

    const body = await readLineMessages();
    expect(body.lastSent).toEqual({ sentAt, roomNumber: "M502", period: "2026-06" });
  });

  it("keeps the sample provenance separate from the send time", async () => {
    await clearBills();

    const room = await newRoom("M503");
    await newTenant(room.id, "อรทัย คนละเรื่อง");
    const bill = await generateBill(room.id, "2026-07");

    const unsent = await readLineMessages();
    // `source` บอกว่าใช้บิลใบไหนเป็นตัวอย่าง ไม่ได้แปลว่าส่งแล้ว
    expect(unsent.source?.roomNumber).toBe("M503");
    expect(unsent.lastSent).toBeNull();

    await env.DB.prepare("UPDATE bills SET sent_at = ? WHERE id = ?").bind("2026-07-09 02:30:00", bill.id).run();

    const sent = await readLineMessages();
    expect(sent.lastSent?.roomNumber).toBe("M503");
    expect(sent.lastSent?.sentAt).toBe("2026-07-09 02:30:00");
  });
});
