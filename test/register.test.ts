import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const roomsUrl = "https://dorm.test/api/rooms";
const tenantsUrl = "https://dorm.test/api/tenants";
const registerRoomsUrl = "https://dorm.test/api/register/rooms";
const registerUrl = "https://dorm.test/api/register";
const registerPageUrl = "https://dorm.test/register";
const lineProfileUrl = "https://api.line.me/v2/profile";
const linePushUrl = "https://api.line.me/v2/bot/message/push";

const tokenPrefix = "valid-liff-token-";

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
  return SELF.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
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
  const response = await SELF.fetch(tenantsUrl);
  expect(response.status).toBe(200);
  return (await response.json<{ ok: boolean; tenants: TenantPayload[] }>()).tenants;
}

async function listRooms(): Promise<RoomPayload[]> {
  const response = await SELF.fetch(roomsUrl);
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
    "INSERT INTO settings (key, value, updated_at) VALUES ('owner_line_user_id', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  )
    .bind(lineUserId)
    .run();
}

async function seedPending(lineUserId: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO line_pending (line_user_id, display_name, last_message, last_seen_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(line_user_id) DO UPDATE SET last_message = excluded.last_message",
  )
    .bind(lineUserId, "รอเชื่อม", "hello")
    .run();
}

async function pendingExists(lineUserId: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT line_user_id FROM line_pending WHERE line_user_id = ?").bind(lineUserId).first();
  return row !== null;
}

function profileCalls(): OutboundCall[] {
  return outboundCalls.filter((call) => call.url === lineProfileUrl);
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
  env.LINE_CHANNEL_ACCESS_TOKEN = "test-channel-access-token";

  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? init.body : "";
    const authorization = headers.get("authorization") ?? "";

    outboundCalls.push({ url, method: init?.method ?? "GET", body, authorization });

    const json = (payload: unknown, status: number): Response =>
      new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });

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

    expect(profileCalls()).toHaveLength(1);
    expect(pushBodies()).toEqual([]);
    expect(await roomStatus(room.id)).toBe("vacant");
    expect((await listTenants()).some((tenant) => tenant.roomNumber === "RG111")).toBe(false);
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

function styleBlock(html: string): string {
  const match = html.match(/<style>([\s\S]*?)<\/style>/);
  return match?.[1] ?? "";
}

function ruleDeclarations(styles: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? "";
}

function fontSizePx(declarations: string): number {
  const match = declarations.match(/font-size:\s*(\d+(?:\.\d+)?)px/);
  return match === null ? 0 : Number(match[1]);
}

function hexToken(styles: string, name: string): string {
  const match = styles.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  return match?.[1] ?? "";
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => {
    const value = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const [red, green, blue] = channels;

  return 0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0);
}

function contrastRatio(foreground: string, background: string): number {
  const high = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const low = Math.min(relativeLuminance(foreground), relativeLuminance(background));

  return (high + 0.05) / (low + 0.05);
}

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
