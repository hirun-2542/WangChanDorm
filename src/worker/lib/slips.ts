import { failureDetail, fetchMessageContent, logLineFailure, pushMessage, replyMessage } from "../line/api";
import { type SlipOkResult, verifySlip } from "../line/slipok";
import {
  ownerSlipPendingMessage,
  slipDownloadFailedMessage,
  slipDuplicateMessage,
  slipMatchedMessage,
  slipNotLinkedMessage,
  slipPendingReviewMessage,
} from "../line/messages";
import { asRecord } from "../routes/shared";

export type SlipReason = "mismatch" | "not_verified" | "no_unpaid_bill" | "duplicate_slip";

export interface StoredSlipResult {
  verified: boolean;
  amount: number | null;
  transRef: string | null;
  date: string | null;
  reason: SlipReason | null;
  raw: unknown;
}

const slipReasons: readonly SlipReason[] = ["mismatch", "not_verified", "no_unpaid_bill", "duplicate_slip"];

const emptySlipResult: StoredSlipResult = {
  verified: false,
  amount: null,
  transRef: null,
  date: null,
  reason: null,
  raw: null,
};

const insertSlipSql = "INSERT INTO slips (id, line_user_id, image_key, status) VALUES (?, ?, ?, 'pending_review')";

const updateSlipSql = "UPDATE slips SET status = ?, bill_id = ?, bill_total = ?, amount = ?, trans_ref = ?, verify_result = ? WHERE id = ?";

const closeBillSql = "UPDATE bills SET status = 'paid', paid_at = ?, paid_method = 'transfer' WHERE id = ? AND status = 'unpaid'";

const matchSlipSql = "UPDATE slips SET status = 'matched', bill_id = ?, bill_total = ?, amount = ?, trans_ref = ?, verify_result = ? WHERE id = ?";

interface SlipSenderRow {
  id: string;
  room_id: string;
  full_name: string;
  room_number: string;
}

interface UnpaidBillRow {
  id: string;
  period: string;
  total: number;
}

interface SlipOwnerAlert {
  roomNumber: string;
  tenantName: string;
  slipAmount: number | null;
  billTotal: number | null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function parseSlipResult(value: string | null): StoredSlipResult {
  if (value === null || value.trim() === "") {
    return emptySlipResult;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    return emptySlipResult;
  }

  const record = asRecord(parsed);

  if (record === null) {
    return emptySlipResult;
  }

  const reason = typeof record.reason === "string" && (slipReasons as readonly string[]).includes(record.reason)
    ? (record.reason as SlipReason)
    : null;

  return {
    verified: record.verified === true,
    amount: readNumber(record.amount),
    transRef: readText(record.transRef),
    date: readText(record.date),
    reason,
    raw: record.raw ?? null,
  };
}

export function rejectedSlipResultJson(value: string | null, decidedAt: string): string {
  const stored = parseSlipResult(value);
  const payload: Record<string, unknown> = {
    verified: stored.verified,
    amount: stored.amount,
    transRef: stored.transRef,
    date: stored.date,
    raw: stored.raw,
  };

  if (stored.reason !== null) {
    payload.reason = stored.reason;
  }

  payload.decision = "rejected";
  payload.decidedAt = decidedAt;

  return JSON.stringify(payload);
}

export function isUniqueViolation(error: unknown): boolean {
  const detail = error instanceof Error ? error.message : String(error);
  return detail.includes("UNIQUE");
}

export function canonicalPaidAt(date: string | null): string {
  if (date !== null) {
    const parsed = new Date(date);

    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return new Date().toISOString();
}

function randomImageKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}.png`;
}

function toSatang(amount: number): number {
  return Math.round(amount * 100);
}

function slipResultJson(result: SlipOkResult, reason: SlipReason | null): string {
  const payload: Record<string, unknown> = {
    verified: result.verified,
    amount: result.amount,
    transRef: result.transRef,
    date: result.date,
    raw: result.raw,
  };

  if (reason !== null) {
    payload.reason = reason;
  }

  return JSON.stringify(payload);
}

async function notifyOwnerOfSlipInReview(env: Env, slipId: string, alert: SlipOwnerAlert): Promise<void> {
  try {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'owner_line_user_id'").first<{ value: string }>();
    const ownerId = (row?.value ?? "").trim();

    if (ownerId === "") {
      console.log(JSON.stringify({ message: "slip owner alert skipped", slipId, reason: "owner line is not linked" }));
      return;
    }

    const delivered = await pushMessage(env, ownerId, [
      { type: "text", text: ownerSlipPendingMessage(alert.roomNumber, alert.tenantName, alert.slipAmount, alert.billTotal) },
    ]);

    console.log(JSON.stringify({ message: "slip owner alerted", slipId, delivered: delivered === true }));
  } catch (error) {
    logLineFailure("slip owner alert failed", failureDetail(error));
  }
}

async function keepSlipForReview(
  env: Env,
  slipId: string,
  result: SlipOkResult,
  lineUserId: string,
  reason: SlipReason,
  bill: UnpaidBillRow | null,
  sender: SlipSenderRow,
): Promise<void> {
  await env.DB.prepare(updateSlipSql)
    .bind("pending_review", bill?.id ?? null, bill?.total ?? null, result.amount, result.transRef, slipResultJson(result, reason), slipId)
    .run();

  console.log(JSON.stringify({ message: "slip kept for review", slipId, lineUserId, verified: result.verified, reason }));
  await pushMessage(env, lineUserId, [{ type: "text", text: slipPendingReviewMessage() }]);
  await notifyOwnerOfSlipInReview(env, slipId, {
    roomNumber: sender.room_number,
    tenantName: sender.full_name,
    slipAmount: result.amount,
    billTotal: bill?.total ?? null,
  });
}

async function rejectDuplicateSlip(
  env: Env,
  slipId: string,
  result: SlipOkResult,
  lineUserId: string,
  usedSlipId: string | null,
): Promise<void> {
  await env.DB.prepare(updateSlipSql)
    .bind("rejected", null, null, result.amount, result.transRef, slipResultJson(result, "duplicate_slip"), slipId)
    .run();

  console.log(JSON.stringify({ message: "slip rejected as a duplicate transfer reference", slipId, lineUserId, usedSlipId }));
  await pushMessage(env, lineUserId, [{ type: "text", text: slipDuplicateMessage() }]);
}

export async function handleSlipImage(env: Env, origin: string, userId: string, replyToken: string, messageId: string): Promise<void> {
  const sender = await env.DB.prepare(
    "SELECT t.id, t.room_id, t.full_name, r.room_number FROM tenants t JOIN rooms r ON r.id = t.room_id WHERE t.line_user_id = ?",
  )
    .bind(userId)
    .first<SlipSenderRow>();

  if (sender === null) {
    await replyMessage(env, replyToken, slipNotLinkedMessage());
    return;
  }

  const content = await fetchMessageContent(env, messageId);

  if (content === null) {
    await replyMessage(env, replyToken, slipDownloadFailedMessage());
    return;
  }

  const imageKey = randomImageKey();
  const slipId = crypto.randomUUID();

  await env.SLIPS.put(imageKey, content.bytes, { httpMetadata: { contentType: content.contentType } });
  await env.DB.prepare(insertSlipSql).bind(slipId, userId, imageKey).run();

  const bill = await env.DB.prepare(
    "SELECT id, period, total FROM bills WHERE room_id = ? AND tenant_id = ? AND status = 'unpaid' ORDER BY period DESC LIMIT 1",
  )
    .bind(sender.room_id, sender.id)
    .first<UnpaidBillRow>();

  const result = await verifySlip(env, `${origin}/slips/${imageKey}`, bill?.total ?? null);
  const amount = result.amount;
  const transRef = result.transRef;

  if (result.duplicate) {
    const used = transRef === null
      ? null
      : await env.DB.prepare("SELECT id FROM slips WHERE trans_ref = ? AND status <> 'rejected' LIMIT 1")
          .bind(transRef)
          .first<{ id: string }>();
    await rejectDuplicateSlip(env, slipId, result, userId, used?.id ?? null);
    return;
  }

  if (!result.verified || amount === null || bill === null || toSatang(amount) !== toSatang(bill.total)) {
    const reason: SlipReason = bill === null ? "no_unpaid_bill" : !result.verified || amount === null ? "not_verified" : "mismatch";
    await keepSlipForReview(env, slipId, result, userId, reason, bill, sender);
    return;
  }

  if (transRef !== null) {
    const used = await env.DB.prepare("SELECT id FROM slips WHERE trans_ref = ? AND status <> 'rejected' LIMIT 1")
      .bind(transRef)
      .first<{ id: string }>();

    if (used !== null) {
      await rejectDuplicateSlip(env, slipId, result, userId, used.id);
      return;
    }
  }

  try {
    const results = await env.DB.batch([
      env.DB.prepare(closeBillSql).bind(canonicalPaidAt(result.date), bill.id),
      env.DB.prepare(matchSlipSql).bind(bill.id, bill.total, amount, transRef, slipResultJson(result, null), slipId),
    ]);

    if ((results[0]?.meta.changes ?? 0) === 0) {
      await keepSlipForReview(env, slipId, result, userId, "no_unpaid_bill", null, sender);
      return;
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      await rejectDuplicateSlip(env, slipId, result, userId, null);
      return;
    }

    throw error;
  }

  console.log(JSON.stringify({ message: "slip closed a bill", slipId, lineUserId: userId, billId: bill.id }));
  await pushMessage(env, userId, [{ type: "text", text: slipMatchedMessage(bill.total, bill.period) }]);
}
