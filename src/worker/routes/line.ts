import { Hono } from "hono";
import { handleSlipImage } from "../lib/slips";
import { fetchProfile, replyMessage } from "../line/api";
import { linkedMessage, notMatchedMessage, ownerLinkedMessage, welcomeMessage } from "../line/messages";
import { verifyLineSignature } from "../line/signature";
import { asRecord, errorBody, readJsonObject, upsertSettingSql } from "./shared";

const lineWebhook = new Hono<{ Bindings: Env }>();
export const lineAdmin = new Hono<{ Bindings: Env }>();

const defaultDormName = "หอพักวังจันทร์";

const upsertPendingSql =
  "INSERT INTO line_pending (line_user_id, display_name, last_message, last_seen_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(line_user_id) DO UPDATE SET display_name = COALESCE(excluded.display_name, line_pending.display_name), last_message = excluded.last_message, last_seen_at = excluded.last_seen_at";

interface PendingRow {
  line_user_id: string;
  display_name: string | null;
  last_message: string | null;
  last_seen_at: string;
}

interface TenantRow {
  id: string;
  full_name: string;
  room_number: string;
}

interface PendingPayload {
  lineUserId: string;
  displayName: string;
  lastMessage: string | null;
  lastSeenAt: string;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function parseEvents(rawBody: string): unknown[] | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }

  const record = asRecord(parsed);

  if (record === null) {
    return null;
  }

  const events = record.events;

  if (!Array.isArray(events)) {
    return null;
  }

  return events.map((event) => event as unknown);
}

function toPending(row: PendingRow): PendingPayload {
  return {
    lineUserId: row.line_user_id,
    displayName: row.display_name ?? "",
    lastMessage: row.last_message,
    lastSeenAt: row.last_seen_at,
  };
}

async function readSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

async function upsertPending(env: Env, lineUserId: string, displayName: string | null, lastMessage: string | null): Promise<void> {
  await env.DB.prepare(upsertPendingSql).bind(lineUserId, displayName, lastMessage).run();
}

async function handleFollow(env: Env, userId: string, replyToken: string): Promise<void> {
  const profile = await fetchProfile(env, userId);
  const dormName = (await readSetting(env, "dorm_name")) ?? defaultDormName;

  await upsertPending(env, userId, profile === null ? null : profile.displayName, null);
  await replyMessage(env, replyToken, welcomeMessage(dormName));
}

async function linkTenant(env: Env, userId: string, target: TenantRow): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("UPDATE tenants SET line_user_id = ? WHERE id = ?").bind(userId, target.id),
    env.DB.prepare("DELETE FROM line_pending WHERE line_user_id = ?").bind(userId),
  ]);
}

async function handleTextMessage(env: Env, userId: string, replyToken: string, text: string): Promise<void> {
  const sender = await env.DB.prepare("SELECT id FROM tenants WHERE line_user_id = ?").bind(userId).first<{ id: string }>();

  if (sender !== null) {
    return;
  }

  const roomNumber = text.trim().toUpperCase();

  if (roomNumber !== "") {
    const target = await env.DB.prepare(
      "SELECT t.id, t.full_name, r.room_number FROM tenants t JOIN rooms r ON r.id = t.room_id WHERE r.room_number = ? AND t.status = 'current' AND t.line_user_id IS NULL",
    )
      .bind(roomNumber)
      .first<TenantRow>();

    if (target !== null) {
      await linkTenant(env, userId, target);
      await replyMessage(env, replyToken, linkedMessage(target.full_name, target.room_number));
      return;
    }
  }

  const ownerCode = await readSetting(env, "owner_link_code");

  if (ownerCode !== null && ownerCode !== "" && text.trim() === ownerCode) {
    await env.DB.batch([
      env.DB.prepare(upsertSettingSql).bind("owner_line_user_id", userId),
      env.DB.prepare("DELETE FROM line_pending WHERE line_user_id = ?").bind(userId),
    ]);
    await replyMessage(env, replyToken, ownerLinkedMessage());
    return;
  }

  await upsertPending(env, userId, null, text);
  await replyMessage(env, replyToken, notMatchedMessage(text));
}

async function handleEvent(env: Env, origin: string, value: unknown): Promise<void> {
  const event = asRecord(value);

  if (event === null) {
    return;
  }

  const source = asRecord(event.source);
  const userId = source === null ? "" : readString(source, "userId");

  if (userId === "") {
    return;
  }

  const type = readString(event, "type");
  const replyToken = readString(event, "replyToken");

  if (type === "follow") {
    await handleFollow(env, userId, replyToken);
    return;
  }

  if (type !== "message") {
    return;
  }

  const message = asRecord(event.message);

  if (message === null) {
    return;
  }

  const messageType = readString(message, "type");

  if (messageType === "text") {
    await handleTextMessage(env, userId, replyToken, readString(message, "text"));
    return;
  }

  if (messageType === "image") {
    await handleSlipImage(env, origin, userId, replyToken, readString(message, "id"));
  }
}

lineWebhook.post("/", async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header("x-line-signature") ?? "";
  const verified = await verifyLineSignature(c.env.LINE_CHANNEL_SECRET, rawBody, signature);

  if (!verified) {
    console.error(JSON.stringify({ message: "line webhook rejected", reason: signature === "" ? "missing signature" : "invalid signature" }));
    return c.json(errorBody("VALIDATION", "ลายเซ็นของคำขอไม่ถูกต้อง"), 403);
  }

  const events = parseEvents(rawBody);

  if (events === null) {
    console.error(JSON.stringify({ message: "line webhook body is malformed" }));
    return c.json({ ok: true }, 200);
  }

  try {
    const origin = new URL(c.req.url).origin;

    for (const event of events) {
      await handleEvent(c.env, origin, event);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ message: "line webhook failed", error: detail }));
    return c.json(errorBody("INTERNAL", "ประมวลผลข้อความ LINE ไม่สำเร็จ"), 500);
  }

  return c.json({ ok: true }, 200);
});

lineAdmin.get("/pending", async (c) => {
  try {
    const result = await c.env.DB.prepare(
      "SELECT line_user_id, display_name, last_message, last_seen_at FROM line_pending ORDER BY last_seen_at DESC, line_user_id ASC",
    ).all<PendingRow>();

    return c.json({ ok: true, pending: result.results.map(toPending) }, 200);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ message: "list pending line users failed", error: detail }));
    return c.json(errorBody("INTERNAL", "โหลดรายการรอเชื่อม LINE ไม่สำเร็จ"), 500);
  }
});

lineAdmin.post("/pending/:lineUserId/link", async (c) => {
  const lineUserId = c.req.param("lineUserId");
  const body = await readJsonObject(c.req.raw);

  if (body === null) {
    return c.json(errorBody("VALIDATION", "รูปแบบข้อมูลไม่ถูกต้อง"), 400);
  }

  const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : "";

  if (tenantId === "") {
    return c.json(errorBody("VALIDATION", "กรุณาเลือกผู้เช่า", "tenantId"), 400);
  }

  try {
    const pending = await c.env.DB.prepare("SELECT line_user_id FROM line_pending WHERE line_user_id = ?")
      .bind(lineUserId)
      .first<{ line_user_id: string }>();

    if (pending === null) {
      return c.json(errorBody("NOT_FOUND", "ไม่พบผู้ใช้ LINE รายนี้ในรายการรอเชื่อม"), 404);
    }

    const tenant = await c.env.DB.prepare("SELECT id, status, line_user_id FROM tenants WHERE id = ?")
      .bind(tenantId)
      .first<{ id: string; status: string; line_user_id: string | null }>();

    if (tenant === null) {
      return c.json(errorBody("NOT_FOUND", "ไม่พบผู้เช่าที่เลือก", "tenantId"), 404);
    }

    if (tenant.status !== "current") {
      return c.json(errorBody("CONFLICT", "ผู้เช่ารายนี้ย้ายออกแล้ว เชื่อม LINE ไม่ได้", "tenantId"), 409);
    }

    if (tenant.line_user_id !== null) {
      return c.json(errorBody("CONFLICT", "ผู้เช่ารายนี้เชื่อม LINE แล้ว", "tenantId"), 409);
    }

    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE tenants SET line_user_id = ? WHERE id = ?").bind(lineUserId, tenantId),
      c.env.DB.prepare("DELETE FROM line_pending WHERE line_user_id = ?").bind(lineUserId),
    ]);

    return c.json({ ok: true }, 200);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ message: "link pending line user failed", lineUserId, tenantId, error: detail }));

    if (detail.includes("UNIQUE")) {
      return c.json(errorBody("CONFLICT", "LINE นี้เชื่อมกับผู้เช่ารายอื่นแล้ว", "tenantId"), 409);
    }

    return c.json(errorBody("INTERNAL", "เชื่อม LINE ไม่สำเร็จ"), 500);
  }
});

export default lineWebhook;
