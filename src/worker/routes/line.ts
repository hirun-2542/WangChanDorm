import { Hono } from "hono";
import { handleSlipImage } from "../lib/slips";
import { fetchProfile, replyMessage } from "../line/api";
import { buildBillFlexMessage, type BillFlexMessage, type BillMessageBill, type BillMessageIssuer } from "../line/bill-message";
import {
  billStatusMessage,
  contactOwnerMessage,
  linkedMessage,
  notMatchedMessage,
  ownerLinkedMessage,
  ownerSendSummaryMessage,
  ownerSlipPendingMessage,
  registerLinkMessage,
  registerRequiredMessage,
  slipDuplicateMessage,
  slipInstructionMessage,
  slipMatchedMessage,
  slipPendingReviewMessage,
  type LineFlexMessage,
  type OwnerSendSkip,
  type OwnerSendSummary,
  type TenantBillSummary,
  welcomeMessage,
} from "../line/messages";
import { verifyLineSignature } from "../line/signature";
import { asRecord, errorBody, readJsonObject, roomNumberOrder, upsertSettingSql } from "./shared";

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

interface LinkedTenantRow {
  id: string;
  room_number: string;
}

const slipKeyword = "ส่งสลิป";
const myBillsKeyword = "บิลของฉัน";
const contactOwnerKeyword = "ติดต่อเจ้าของ";
const registerKeyword = "ลงทะเบียน";

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

function registrationUrl(env: Env, origin: string): string {
  const liffId = typeof env.LIFF_ID === "string" ? env.LIFF_ID.trim() : "";
  return liffId === "" ? `${origin}/register` : `https://liff.line.me/${liffId}`;
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

async function handleTextMessage(env: Env, origin: string, userId: string, replyToken: string, text: string): Promise<void> {
  const sender = await env.DB.prepare(
    "SELECT t.id, r.room_number FROM tenants t JOIN rooms r ON r.id = t.room_id WHERE t.line_user_id = ?",
  )
    .bind(userId)
    .first<LinkedTenantRow>();

  const trimmed = text.trim();

  if (trimmed === slipKeyword) {
    await replyMessage(env, replyToken, slipInstructionMessage());
    return;
  }

  if (trimmed === myBillsKeyword) {
    if (sender === null) {
      await replyMessage(env, replyToken, registerRequiredMessage(registrationUrl(env, origin)));
    } else {
      const bills = await env.DB.prepare("SELECT period, total, status FROM bills WHERE tenant_id = ? ORDER BY period DESC")
        .bind(sender.id)
        .all<TenantBillSummary>();

      await replyMessage(env, replyToken, billStatusMessage(sender.room_number, bills.results));
    }

    return;
  }

  if (trimmed === contactOwnerKeyword) {
    const ownerName = (await readSetting(env, "owner_name")) ?? "";
    const ownerPhone = (await readSetting(env, "owner_phone")) ?? "";

    await replyMessage(env, replyToken, contactOwnerMessage(ownerName, ownerPhone));
    return;
  }

  if (trimmed === registerKeyword) {
    const url = registrationUrl(env, origin);

    await replyMessage(env, replyToken, sender === null ? registerRequiredMessage(url) : registerLinkMessage(url));
    return;
  }

  if (sender !== null) {
    return;
  }

  const roomNumber = trimmed.toUpperCase();

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

  if (ownerCode !== null && ownerCode !== "" && trimmed === ownerCode) {
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
    await handleTextMessage(env, origin, userId, replyToken, readString(message, "text"));
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

  const webhookEnv = c.env;
  const origin = new URL(c.req.url).origin;

  c.executionCtx.waitUntil(
    (async () => {
      try {
        for (const event of events) {
          await handleEvent(webhookEnv, origin, event);
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error(JSON.stringify({ message: "line webhook failed", error: detail }));
      }
    })(),
  );

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

interface LineMessageKind {
  key: string;
  title: string;
  audience: "tenant" | "owner";
  trigger: string;
  message: LineFlexMessage | BillFlexMessage;
}

interface SampleBillRow {
  id: string;
  room_number: string;
  tenant_name: string;
  period: string;
  rent: number;
  water_units: number;
  water_rate: number;
  water_amount: number;
  electric_mode: string;
  electric_units: number | null;
  electric_rate: number | null;
  electric_amount: number;
  total: number;
  created_at: string;
}

async function loadSampleBill(env: Env): Promise<{ bill: BillMessageBill; period: string } | null> {
  const latest = await env.DB.prepare("SELECT period FROM bills ORDER BY period DESC LIMIT 1").first<{ period: string }>();

  if (latest === null) {
    return null;
  }

  const row = await env.DB.prepare(
    `SELECT b.id, r.room_number, t.full_name AS tenant_name, b.period, b.rent, b.water_units, b.water_rate, b.water_amount, b.electric_mode, b.electric_units, b.electric_rate, b.electric_amount, b.total, b.created_at FROM bills b JOIN rooms r ON r.id = b.room_id JOIN tenants t ON t.id = b.tenant_id WHERE b.period = ? ORDER BY ${roomNumberOrder("r.room_number")} LIMIT 1`,
  )
    .bind(latest.period)
    .first<SampleBillRow>();

  if (row === null) {
    return null;
  }

  const charges = await env.DB.prepare("SELECT name, amount FROM bill_charges WHERE bill_id = ? ORDER BY position ASC")
    .bind(row.id)
    .all<{ name: string; amount: number }>();

  return {
    period: row.period,
    bill: {
      id: row.id,
      roomNumber: row.room_number,
      tenantName: row.tenant_name,
      period: row.period,
      rent: row.rent,
      waterUnits: row.water_units,
      waterRate: row.water_rate,
      waterAmount: row.water_amount,
      electricMode: row.electric_mode === "flat" ? "flat" : "meter",
      electricUnits: row.electric_units,
      electricRate: row.electric_rate,
      electricAmount: row.electric_amount,
      charges: charges.results,
      total: row.total,
      createdAt: row.created_at,
    },
  };
}

interface OwnerSendSummaryRow {
  room_number: string;
  tenant_name: string;
  line_user_id: string | null;
  total: number;
  sent_at: string | null;
}

async function loadOwnerSendSummary(env: Env, period: string): Promise<OwnerSendSummary> {
  const result = await env.DB.prepare(
    `SELECT r.room_number, t.full_name AS tenant_name, t.line_user_id, b.total, b.sent_at FROM bills b JOIN rooms r ON r.id = b.room_id JOIN tenants t ON t.id = b.tenant_id WHERE b.period = ? ORDER BY ${roomNumberOrder("r.room_number")}`,
  )
    .bind(period)
    .all<OwnerSendSummaryRow>();

  const skipped: OwnerSendSkip[] = [];
  let total = 0;
  let sent = 0;

  for (const row of result.results) {
    total += row.total;

    if (row.sent_at !== null) {
      sent += 1;
    }

    if (row.line_user_id === null || row.line_user_id.trim() === "") {
      skipped.push({ roomNumber: row.room_number, tenantName: row.tenant_name });
    }
  }

  return { period, count: result.results.length, total, sent, failed: 0, failedRooms: [], skipped };
}

lineAdmin.get("/messages", async (c) => {
  try {
    const origin = new URL(c.req.url).origin;
    const dormName = (await readSetting(c.env, "dorm_name")) ?? defaultDormName;
    const ownerName = (await readSetting(c.env, "owner_name")) ?? "";
    const ownerPhone = (await readSetting(c.env, "owner_phone")) ?? "";
    const promptpayName = (await readSetting(c.env, "promptpay_name")) ?? "";
    const sample = await loadSampleBill(c.env);
    const messages: LineMessageKind[] = [];

    if (sample !== null) {
      const issuer: BillMessageIssuer = { promptpayName };

      messages.push({
        key: "bill",
        title: "บิลรายเดือน",
        audience: "tenant",
        trigger: "ส่งเมื่อเจ้าของกดส่งบิลให้ผู้เช่า บอทแนบการ์ดบิลพร้อม QR พร้อมเพย์และปุ่มเปิดใบแจ้งหนี้ PDF",
        message: buildBillFlexMessage(sample.bill, issuer, origin),
      });
      messages.push({
        key: "payment",
        title: "ยืนยันการชำระ",
        audience: "tenant",
        trigger: "ส่งเมื่อสลิปยอดตรงปิดบิลอัตโนมัติ หรือเจ้าของกดปิดบิลจากคิวรอตรวจ",
        message: slipMatchedMessage(sample.bill.total, sample.bill.period),
      });
    }

    messages.push({
      key: "slip_review",
      title: "สลิปรอตรวจสอบ",
      audience: "tenant",
      trigger: "ส่งเมื่อบอทรับสลิปแล้วยังยืนยันไม่ได้ เช่น ยอดไม่ตรง ตรวจไม่ผ่าน หรือยังไม่มีบิลค้าง",
      message: slipPendingReviewMessage(),
    });
    messages.push({
      key: "slip_duplicate",
      title: "สลิปซ้ำ",
      audience: "tenant",
      trigger: "ส่งเมื่อสลิปหรือเลขอ้างอิงโอนถูกใช้ปิดบิลไปแล้ว",
      message: slipDuplicateMessage(),
    });
    messages.push({
      key: "welcome",
      title: "ยินดีต้อนรับ",
      audience: "tenant",
      trigger: "ส่งเมื่อผู้เช่าแอดบอทเป็นครั้งแรกและบอทยังไม่รู้จักห้อง",
      message: welcomeMessage(dormName),
    });

    if (sample !== null) {
      messages.push({
        key: "link",
        title: "เชื่อม LINE สำเร็จ",
        audience: "tenant",
        trigger: "ส่งเมื่อผู้เช่าพิมพ์เลขห้องแล้วจับคู่กับผู้เช่าในระบบได้",
        message: linkedMessage(sample.bill.tenantName, sample.bill.roomNumber),
      });
    }

    messages.push({
      key: "instructions",
      title: "ส่งสลิปได้เลย",
      audience: "tenant",
      trigger: "ส่งเมื่อผู้เช่าพิมพ์คำว่า ส่งสลิป เพื่อขอวิธีส่งสลิป",
      message: slipInstructionMessage(),
    });
    messages.push({
      key: "contact_owner",
      title: "ติดต่อเจ้าของหอ",
      audience: "tenant",
      trigger: "ส่งเมื่อผู้เช่าพิมพ์คำว่า ติดต่อเจ้าของ",
      message: contactOwnerMessage(ownerName, ownerPhone),
    });

    if (sample !== null) {
      messages.push({
        key: "owner_slip",
        title: "มีสลิปใหม่รอตรวจ",
        audience: "owner",
        trigger: "ส่งถึงเจ้าของทุกครั้งที่มีสลิปถูกบันทึกเข้ารอตรวจ",
        message: ownerSlipPendingMessage(sample.bill.roomNumber, sample.bill.tenantName, null, sample.bill.total),
      });
      messages.push({
        key: "owner_send_summary",
        title: "สรุปการส่งบิลทั้งหอ",
        audience: "owner",
        trigger: "ส่งถึงเจ้าของหลังกดส่งบิลทั้งหอ สรุปว่าส่งสำเร็จกี่ใบ ไม่สำเร็จกี่ใบ และห้องใดยังไม่เชื่อม LINE",
        message: ownerSendSummaryMessage(await loadOwnerSendSummary(c.env, sample.period)),
      });
    }

    return c.json(
      {
        ok: true,
        source: sample === null ? null : { period: sample.period, roomNumber: sample.bill.roomNumber, tenantName: sample.bill.tenantName },
        messages,
      },
      200,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ message: "list line message kinds failed", error: detail }));
    return c.json(errorBody("INTERNAL", "โหลดข้อความ LINE ไม่สำเร็จ"), 500);
  }
});

export default lineWebhook;
