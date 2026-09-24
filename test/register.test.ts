import { SELF, env } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type TestSession, createFamily, signIn, withAuth } from "./auth-helper";
import { contrastRatio, fontSizePx, hexToken, ruleDeclarations, styleBlock } from "./html-style";

const roomsUrl = "https://dorm.test/api/rooms";
const tenantsUrl = "https://dorm.test/api/tenants";
const registerRoomsUrl = "https://dorm.test/api/register/rooms";
const registerUrl = "https://dorm.test/api/register";
const registerPageUrl = "https://dorm.test/register";
const lineProfileUrl = "https://api.line.me/v2/profile";
const lineVerifyUrl = "https://api.line.me/oauth2/v2.1/verify";
const linePushUrl = "https://api.line.me/v2/bot/message/push";

const appChannelId = "2010453783";
const appLiffId = `${appChannelId}-KryBOXrc`;

const tokenPrefix = "valid-liff-token-";

let session: TestSession;
let tokenChannelId = appChannelId;

beforeAll(async () => {
  session = await signIn();
});

function liffToken(label: string): string {
  return `${tokenPrefix}${label}`;
}

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
  checkInDate: string;
  status: string;
}

interface RegisterRoom {
  id: string;
  roomNumber: string;
}

interface RegisterRoomsBody {
  ok: boolean;
  rooms: RegisterRoom[];
}

interface RegisterBody {
  ok: boolean;
  tenant: { name: string; roomNumber: string };
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

interface PushBody {
  to: string;
  messages: { type: string; text?: string }[];
}

let outboundCalls: OutboundCall[] = [];

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

async function listTenants(): Promise<TenantPayload[]> {
  const response = await SELF.fetch(tenantsUrl, withAuth(session));
  expect(response.status).toBe(200);
  return (await response.json<{ ok: boolean; tenants: TenantPayload[] }>()).tenants;
}

async function listRooms(): Promise<RoomPayload[]> {
  const response = await SELF.fetch(roomsUrl, withAuth(session));
  expect(response.status).toBe(200);
  return (await response.json<{ ok: boolean; rooms: RoomPayload[] }>()).rooms;
}

async function listRegisterRooms(): Promise<RegisterRoomsBody> {
  const response = await SELF.fetch(registerRoomsUrl);
  expect(response.status).toBe(200);
  return await response.json<RegisterRoomsBody>();
}

async function roomStatus(roomId: string): Promise<string> {
  return pick(await listRooms(), (room) => room.id === roomId).status;
}

async function linkOwner(lineUserId: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO settings (family_id, key, value, updated_at) VALUES (?, 'owner_line_user_id', ?, datetime('now')) ON CONFLICT(family_id, key) DO UPDATE SET value = excluded.value",
  )
    .bind(session.familyId, lineUserId)
    .run();
}

async function seedPending(lineUserId: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO line_pending (line_user_id, family_id, display_name, last_message, last_seen_at) VALUES (?, ?, ?, ?, datetime('now')) ON CONFLICT(line_user_id) DO UPDATE SET last_message = excluded.last_message",
  )
    .bind(lineUserId, session.familyId, "รอเชื่อม", "hello")
    .run();
}

async function pendingExists(lineUserId: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT line_user_id FROM line_pending WHERE line_user_id = ?").bind(lineUserId).first();
  return row !== null;
}

function profileCalls(): OutboundCall[] {
  return outboundCalls.filter((call) => call.url === lineProfileUrl);
}

function verifyCalls(): OutboundCall[] {
  return outboundCalls.filter((call) => call.url.startsWith(lineVerifyUrl));
}

function pushBodies(): PushBody[] {
  return outboundCalls
    .filter((call) => call.url === linePushUrl)
    .map((call) => JSON.parse(call.body) as PushBody);
}

function pushTextsFor(lineUserId: string): string[] {
  return pushBodies()
    .filter((push) => push.to === lineUserId)
    .map((push) => first(push.messages).text ?? "");
}

function ownerText(name: string, roomNumber: string, phone: string): string {
  return `ผู้เช่าลงทะเบียนใหม่: ${name} ห้อง ${roomNumber} เบอร์ ${phone}`;
}

function tenantText(roomNumber: string): string {
  return `ลงทะเบียนห้อง ${roomNumber} เรียบร้อยแล้ว เจ้าของหอจะตรวจสอบและติดต่อกลับ`;
}

function setLiffId(value: string): void {
  (env as unknown as { LIFF_ID: string }).LIFF_ID = value;
}

beforeEach(() => {
  outboundCalls = [];
  tokenChannelId = appChannelId;
  env.LINE_CHANNEL_ACCESS_TOKEN = "test-channel-access-token";
  setLiffId(appLiffId);

  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? init.body : "";
    const authorization = headers.get("authorization") ?? "";

    outboundCalls.push({ url, method: init?.method ?? "GET", body, authorization });

    const json = (payload: unknown, status: number): Response =>
      new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });

    if (url.startsWith(lineVerifyUrl)) {
      const token = new URL(url).searchParams.get("access_token") ?? "";
      const valid = token.startsWith(tokenPrefix);
      return Promise.resolve(
        valid
          ? json({ client_id: tokenChannelId, expires_in: 2_592_000, scope: "profile openid" }, 200)
          : json({ error: "invalid_request", error_description: "Invalid access token" }, 400),
      );
    }

    if (url === lineProfileUrl) {
      const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
      const valid = token.startsWith(tokenPrefix);
      return Promise.resolve(valid ? json({ userId: token, displayName: "ชื่อจาก LINE" }, 200) : json({ message: "invalid token" }, 401));
    }

    return Promise.resolve(json({}, 200));
  });
});

afterEach(() => {
  setLiffId("");
  env.LINE_CHANNEL_ACCESS_TOKEN = "test-channel-access-token";
  vi.restoreAllMocks();
});

describe("GET /api/register/rooms", () => {
  it("lists only vacant rooms, ordered by number, without leaking tenant names", async () => {
    const occupied = await newRoom({ roomNumber: "RG222", rent: 3500, waterMeterInit: 0, electricMeterInit: 0 });
    await newTenant(occupied.id, "ผู้เช่าไม่ว่าง");
    await newRoom({ roomNumber: "RG221", rent: 3500, waterMeterInit: 0, electricMeterInit: 0 });
    await newRoom({ roomNumber: "RG220", rent: 3500, waterMeterInit: 0, electricMeterInit: 0 });

    const body = await listRegisterRooms();
    expect(body.ok).toBe(true);

    const numbers = body.rooms.map((room) => room.roomNumber);
    expect(numbers).toContain("RG220");
    expect(numbers).toContain("RG221");
    expect(numbers).not.toContain("RG222");

    expect(numbers).toEqual([...numbers].sort());

    for (const room of body.rooms) {
      expect(Object.keys(room).sort()).toEqual(["id", "roomNumber"]);
    }

    expect(JSON.stringify(body)).not.toContain("ผู้เช่าไม่ว่าง");
  });
});

describe("POST /api/register", () => {
  it("creates the tenant, links the LINE id, flips the room, clears pending and pushes both", async () => {
    const token = liffToken("create");
    await linkOwner("U-owner-register");
    const room = await newRoom({ roomNumber: "RG101", rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    await seedPending(token);

    const response = await post(registerUrl, { name: "สมชาย ใจดี", phone: "081-234-5678", roomId: room.id, accessToken: token });
    expect(response.status).toBe(200);

    const body = await response.json<RegisterBody>();
    expect(body.ok).toBe(true);
    expect(body.tenant).toEqual({ name: "สมชาย ใจดี", roomNumber: "RG101" });

    const tenant = pick(await listTenants(), (item) => item.roomNumber === "RG101");
    expect(tenant.fullName).toBe("สมชาย ใจดี");
    expect(tenant.lineUserId).toBe(token);
    expect(tenant.status).toBe("current");
    expect(tenant.checkInDate).toBe(new Date().toISOString().slice(0, 10));

    expect(await roomStatus(room.id)).toBe("occupied");
    expect(await pendingExists(token)).toBe(false);

    const profiles = profileCalls();
    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.method).toBe("GET");
    expect(profiles[0]?.authorization).toBe(`Bearer ${token}`);

    expect(pushTextsFor("U-owner-register")).toEqual([ownerText("สมชาย ใจดี", "RG101", "0812345678")]);
    expect(pushTextsFor(token)).toEqual([tenantText("RG101")]);
    expect(pushBodies()).toHaveLength(2);
  });

  it("answers 401 for an invalid or expired token and creates nothing", async () => {
    const room = await newRoom({ roomNumber: "RG111", rent: 3500, waterMeterInit: 0, electricMeterInit: 0 });

    const response = await post(registerUrl, { name: "สมชาย ใจดี", phone: "0812345678", roomId: room.id, accessToken: "expired-token" });
    expect(response.status).toBe(401);

    const body = await response.json<ErrorBody>();
    expect(body.ok).toBe(false);
    expect(body.error.message).toBe("ลิงก์ยืนยันตัวตนไม่ถูกต้อง กรุณาเปิดฟอร์มจาก LINE อีกครั้ง");

    expect(verifyCalls()).toHaveLength(1);
    expect(profileCalls()).toEqual([]);
    expect(pushBodies()).toEqual([]);
    expect(await roomStatus(room.id)).toBe("vacant");
    expect((await listTenants()).some((tenant) => tenant.roomNumber === "RG111")).toBe(false);
  });

  it("answers 401 for a token issued for another LINE channel and creates nothing", async () => {
    const room = await newRoom({ roomNumber: "RG112", rent: 3500, waterMeterInit: 0, electricMeterInit: 0 });
    tokenChannelId = "9999999999";

    const response = await post(registerUrl, { name: "สมชาย ใจดี", phone: "0812345678", roomId: room.id, accessToken: liffToken("foreign") });
    expect(response.status).toBe(401);
    expect((await response.json<ErrorBody>()).error.message).toBe("ลิงก์ยืนยันตัวตนไม่ถูกต้อง กรุณาเปิดฟอร์มจาก LINE อีกครั้ง");

    expect(verifyCalls()).toHaveLength(1);
    expect(profileCalls()).toEqual([]);
    expect(pushBodies()).toEqual([]);
    expect(await roomStatus(room.id)).toBe("vacant");
    expect((await listTenants()).some((tenant) => tenant.roomNumber === "RG112")).toBe(false);
  });

  it("answers 401 and never calls LINE when this app's channel is unknown", async () => {
    const room = await newRoom({ roomNumber: "RG113", rent: 3500, waterMeterInit: 0, electricMeterInit: 0 });
    setLiffId("");

    const response = await post(registerUrl, { name: "สมชาย ใจดี", phone: "0812345678", roomId: room.id, accessToken: liffToken("no-channel") });
    expect(response.status).toBe(401);

    expect(outboundCalls).toEqual([]);
    expect(await roomStatus(room.id)).toBe("vacant");
    expect((await listTenants()).some((tenant) => tenant.roomNumber === "RG113")).toBe(false);
  });

  it("keeps rooms of another family out of the public registration list", async () => {
    const otherFamily = await createFamily("ครอบครัวอื่น");
    const room = await newRoom({ roomNumber: "RG151", rent: 3500, waterMeterInit: 0, electricMeterInit: 0 });
    const foreignRoomId = crypto.randomUUID();

    await env.DB.prepare(
      "INSERT INTO rooms (id, family_id, room_number, rent, water_meter_init, electric_meter_init, status) VALUES (?, ?, 'RG999', 3500, 0, 0, 'vacant')",
    )
      .bind(foreignRoomId, otherFamily)
      .run();

    const listed = await listRegisterRooms();
    expect(listed.rooms.map((item) => item.roomNumber)).toContain("RG151");
    expect(listed.rooms.map((item) => item.roomNumber)).not.toContain("RG999");

    const response = await post(registerUrl, {
      name: "สมชาย ข้ามครอบครัว",
      phone: "0812345678",
      roomId: foreignRoomId,
      accessToken: liffToken("cross-family"),
    });
    expect(response.status).toBe(404);
    expect((await response.json<ErrorBody>()).error.code).toBe("NOT_FOUND");
    expect(await roomStatus(room.id)).toBe("vacant");
  });

  it("answers 409 naming the room when the LINE user is already registered", async () => {
    const token = liffToken("duplicate");
    const taken = await newRoom({ roomNumber: "RG121", rent: 3500, waterMeterInit: 0, electricMeterInit: 0 });
    const tenant = await newTenant(taken.id, "ผู้เช่าเดิม");
    await env.DB.prepare("UPDATE tenants SET line_user_id = ? WHERE id = ?").bind(token, tenant.id).run();
    const spare = await newRoom({ roomNumber: "RG122", rent: 3500, waterMeterInit: 0, electricMeterInit: 0 });

    const response = await post(registerUrl, { name: "สมชาย ใหม่", phone: "0812345678", roomId: spare.id, accessToken: token });
    expect(response.status).toBe(409);

    const body = await response.json<ErrorBody>();
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.message).toContain("RG121");

    expect(pushBodies()).toEqual([]);
    expect(await roomStatus(spare.id)).toBe("vacant");
    expect((await listTenants()).some((item) => item.roomNumber === "RG122")).toBe(false);
  });

  it("answers 409 for an occupied room and creates nothing", async () => {
    const token = liffToken("occupied");
    const room = await newRoom({ roomNumber: "RG131", rent: 3500, waterMeterInit: 0, electricMeterInit: 0 });
    await newTenant(room.id, "ผู้เช่าปัจจุบัน");

    const response = await post(registerUrl, { name: "สมชาย ใหม่", phone: "0812345678", roomId: room.id, accessToken: token });
    expect(response.status).toBe(409);

    const body = await response.json<ErrorBody>();
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.message).toBe("ห้องนี้มีผู้เช่าอยู่แล้ว กรุณาติดต่อเจ้าของ");

    expect(pushBodies()).toEqual([]);
    expect((await listTenants()).filter((item) => item.roomNumber === "RG131")).toHaveLength(1);
  });

  it("answers 404 for a room that does not exist", async () => {
    const response = await post(registerUrl, {
      name: "สมชาย ใจดี",
      phone: "0812345678",
      roomId: "room-missing",
      accessToken: liffToken("missing"),
    });
    expect(response.status).toBe(404);
    expect((await response.json<ErrorBody>()).error.code).toBe("NOT_FOUND");
    expect(pushBodies()).toEqual([]);
  });

  it("answers 400 with the right field for bad input and never calls LINE", async () => {
    const token = liffToken("badinput");
    const room = await newRoom({ roomNumber: "RG141", rent: 3500, waterMeterInit: 0, electricMeterInit: 0 });

    const badName = await post(registerUrl, { name: "ก", phone: "0812345678", roomId: room.id, accessToken: token });
    expect(badName.status).toBe(400);
    expect(await badName.json<ErrorBody>()).toEqual({
      ok: false,
      error: { code: "VALIDATION", message: "กรุณากรอกชื่อ-นามสกุล", field: "name" },
    });

    const badPhone = await post(registerUrl, { name: "สมชาย ใจดี", phone: "12345", roomId: room.id, accessToken: token });
    expect(badPhone.status).toBe(400);
    expect((await badPhone.json<ErrorBody>()).error.field).toBe("phone");

    const missingRoom = await post(registerUrl, { name: "สมชาย ใจดี", phone: "0812345678", roomId: "", accessToken: token });
    expect(missingRoom.status).toBe(400);
    expect((await missingRoom.json<ErrorBody>()).error.field).toBe("roomId");

    const missingToken = await post(registerUrl, { name: "สมชาย ใจดี", phone: "0812345678", roomId: room.id, accessToken: "" });
    expect(missingToken.status).toBe(400);
    expect((await missingToken.json<ErrorBody>()).error.field).toBe("accessToken");

    expect(profileCalls()).toEqual([]);
    expect(pushBodies()).toEqual([]);
    expect(await roomStatus(room.id)).toBe("vacant");
  });
});

describe("GET /register", () => {
  it("serves the LIFF form page carrying the injected LIFF id when set", async () => {
    setLiffId("1234567890-liff-register");

    const response = await SELF.fetch(registerPageUrl);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");

    const html = await response.text();
    expect(html).toContain("1234567890-liff-register");
    expect(html).toContain('id="register-form"');
    expect(html).toContain("https://static.line-scdn.net/liff/edge/2/sdk.js");
  });

  it("shows the open-from-LINE screen and the owner setup steps when the LIFF id is empty", async () => {
    setLiffId("");

    const response = await SELF.fetch(registerPageUrl);
    expect(response.status).toBe(200);

    const html = await response.text();
    expect(html).toContain("เปิดฟอร์มนี้จากในแอป LINE เท่านั้น");
    expect(html).toContain("LIFF app");
    expect(html).not.toContain('id="register-form"');
  });
});

describe("GET /register composition", () => {
  it("centres the whole stack in the viewport on a full-height grid with a dvh fallback", async () => {
    setLiffId("");

    const html = await (await SELF.fetch(registerPageUrl)).text();
    const body = ruleDeclarations(styleBlock(html), "body");

    expect(body).toContain("display: grid");
    expect(body).toContain("align-content: center");
    expect(body).toContain("justify-items: center");
    expect(body).toContain("min-height: 100vh");
    expect(body).toContain("min-height: 100dvh");
    expect(body.indexOf("min-height: 100vh")).toBeLessThan(body.indexOf("min-height: 100dvh"));

    expect(ruleDeclarations(styleBlock(html), ".page")).toContain("max-width: 420px");
    expect(html.indexOf('class="brand"')).toBeLessThan(html.indexOf('class="card"'));
  });

  it("keeps the border-only card treatment and a readable type hierarchy", async () => {
    setLiffId("");

    const html = await (await SELF.fetch(registerPageUrl)).text();
    const styles = styleBlock(html);
    const card = ruleDeclarations(styles, ".card");
    const heading = ruleDeclarations(styles, "h1");
    const paragraph = ruleDeclarations(styles, "p");

    expect(card).toContain("border: 1px solid var(--ash)");
    expect(card).toContain("border-radius: var(--radius-card)");
    expect(card).not.toContain("box-shadow");
    expect(styles).toContain("--radius-card: 12px");

    expect(fontSizePx(heading)).toBeGreaterThanOrEqual(fontSizePx(paragraph) * 1.5);
    expect(heading).toContain("font-weight: 700");
    expect(paragraph).toContain("color: var(--steel)");
    expect(paragraph).toMatch(/max-width:\s*\d+ch/);

    const canvas = hexToken(styles, "canvas");
    const steel = hexToken(styles, "steel");
    expect(canvas).not.toBe("");
    expect(steel).not.toBe("");
    expect(contrastRatio(steel, canvas)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("register fan-out to open tabs", () => {
  /**
   * การลงทะเบียนเกิดบนอุปกรณ์ของผู้เช่า ไม่ใช่ในแท็บของเจ้าของ — แท็บที่เปิดค้าง
   * จึงต้องได้สัญญาณทาง WebSocket ไม่งั้นเจ้าของจะไม่เห็นคนใหม่จนกว่าจะรีเฟรช
   */
  async function openSocket(cookie: string): Promise<{
    envelope: () => Promise<Record<string, unknown>>;
    send: (data: string) => void;
    nextMessage: () => Promise<string>;
    close: () => void;
  }> {
    const { createExecutionContext, waitOnExecutionContext } = await import("cloudflare:test");
    const { default: app } = await import("../src/worker/index");
    const ctx = createExecutionContext();

    const response = await app.fetch(
      new Request("https://dorm.test/api/realtime", {
        headers: {
          cookie,
          upgrade: "websocket",
          connection: "upgrade",
          origin: "https://dorm.test",
        },
      }),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);

    const socket = response.webSocket;

    if (socket === null) {
      throw new Error("expected a WebSocket upgrade response");
    }

    socket.accept();

    const messages: string[] = [];
    const waiters: ((value: string) => void)[] = [];

    socket.addEventListener("message", (event: MessageEvent) => {
      const data = typeof event.data === "string" ? event.data : "<binary>";
      const waiter = waiters.shift();

      if (waiter === undefined) {
        messages.push(data);
        return;
      }

      waiter(data);
    });

    const nextMessage = (): Promise<string> => {
      const buffered = messages.shift();

      if (buffered !== undefined) {
        return Promise.resolve(buffered);
      }

      const { promise, resolve } = Promise.withResolvers<string>();
      waiters.push(resolve);
      return promise;
    };

    return {
      envelope: async () => JSON.parse(await nextMessage()) as Record<string, unknown>,
      send: (data) => {
        socket.send(data);
      },
      nextMessage,
      close: () => {
        socket.close();
      },
    };
  }

  it("tells open tabs that someone registered, with the room and the name", async () => {
    const token = liffToken("fanout");
    await linkOwner("U-owner-fanout");
    const room = await newRoom({ roomNumber: "RG901", rent: 3500, waterMeterInit: 5, electricMeterInit: 5 });
    await seedPending(token);

    const socket = await openSocket(session.cookie);
    // hello มาก่อนเสมอ
    expect((await socket.envelope()).type).toBe("hello");

    const response = await post(registerUrl, {
      name: "สมหญิง ลงทะเบียน",
      phone: "089-999-8888",
      roomId: room.id,
      accessToken: token,
    });
    expect(response.status).toBe(200);

    const envelope = await Promise.race([
      socket.envelope(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("no tenant-joined envelope arrived")), 4000),
      ),
    ]);

    expect(envelope.type).toBe("tenant-joined");
    expect(envelope.roomNumber).toBe("RG901");
    expect(envelope.tenantName).toBe("สมหญิง ลงทะเบียน");
    // ลงทะเบียนเอง ไม่ใช่เจ้าของกดเชื่อม
    expect(envelope.source).toBe("self");

    socket.close();
  });

  it("sends nothing when the registration is rejected", async () => {
    const socket = await openSocket(session.cookie);
    expect((await socket.envelope()).type).toBe("hello");

    // ห้องมีผู้เช่าอยู่แล้ว → 409 และต้องไม่มี event
    const occupied = await newRoom({ roomNumber: "RG902", rent: 3500, waterMeterInit: 1, electricMeterInit: 1 });
    await newTenant(occupied.id, "ผู้เช่าเดิม");

    const rejected = await post(registerUrl, {
      name: "คนที่มาทีหลัง",
      phone: "081-000-0000",
      roomId: occupied.id,
      accessToken: liffToken("rejected"),
    });
    expect(rejected.status).toBe(409);

    socket.send("ping");
    expect(await socket.nextMessage()).toBe("pong");

    socket.close();
  });
});
