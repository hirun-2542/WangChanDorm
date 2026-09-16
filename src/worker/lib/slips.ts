import { fetchMessageContent, pushMessage, replyMessage } from "../line/api";
import { type EasySlipResult, verifySlip } from "../line/easyslip";
import {
  slipDownloadFailedMessage,
  slipDuplicateMessage,
  slipMatchedMessage,
  slipNotLinkedMessage,
  slipPendingReviewMessage,
} from "../line/messages";

export type SlipReason = "mismatch" | "not_verified" | "no_unpaid_bill" | "duplicate_slip";

const insertSlipSql = "INSERT INTO slips (id, line_user_id, image_key, status) VALUES (?, ?, ?, 'pending_review')";

const updateSlipSql = "UPDATE slips SET status = ?, bill_id = ?, bill_total = ?, amount = ?, trans_ref = ?, easyslip_result = ? WHERE id = ?";

const closeBillSql = "UPDATE bills SET status = 'paid', paid_at = ?, paid_method = 'transfer' WHERE id = ? AND status = 'unpaid'";

const matchSlipSql = "UPDATE slips SET status = 'matched', bill_id = ?, bill_total = ?, amount = ?, trans_ref = ?, easyslip_result = ? WHERE id = ?";

interface SlipSenderRow {
  id: string;
  room_id: string;
}

interface UnpaidBillRow {
  id: string;
  period: string;
  total: number;
}

function randomImageKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}.png`;
}

function toSatang(amount: number): number {
  return Math.round(amount * 100);
}

function slipResultJson(result: EasySlipResult, reason: SlipReason | null): string {
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

function canonicalPaidAt(date: string | null): string {
  if (date !== null) {
    const parsed = new Date(date);

    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return new Date().toISOString();
}

function isUniqueViolation(error: unknown): boolean {
  const detail = error instanceof Error ? error.message : String(error);
  return detail.includes("UNIQUE");
}

async function keepSlipForReview(
  env: Env,
  slipId: string,
  result: EasySlipResult,
  lineUserId: string,
  reason: SlipReason,
  bill: UnpaidBillRow | null,
): Promise<void> {
  await env.DB.prepare(updateSlipSql)
    .bind("pending_review", bill?.id ?? null, bill?.total ?? null, result.amount, result.transRef, slipResultJson(result, reason), slipId)
    .run();

  console.log(JSON.stringify({ message: "slip kept for review", slipId, lineUserId, verified: result.verified, reason }));
  await pushMessage(env, lineUserId, [{ type: "text", text: slipPendingReviewMessage() }]);
}

async function rejectDuplicateSlip(
  env: Env,
  slipId: string,
  result: EasySlipResult,
  amount: number,
  transRef: string,
  lineUserId: string,
  usedSlipId: string | null,
): Promise<void> {
  await env.DB.prepare(updateSlipSql)
    .bind("rejected", null, null, amount, transRef, slipResultJson(result, "duplicate_slip"), slipId)
    .run();

  console.log(JSON.stringify({ message: "slip rejected as a duplicate transfer reference", slipId, lineUserId, usedSlipId }));
  await pushMessage(env, lineUserId, [{ type: "text", text: slipDuplicateMessage() }]);
}

export async function handleSlipImage(env: Env, origin: string, userId: string, replyToken: string, messageId: string): Promise<void> {
  const sender = await env.DB.prepare("SELECT id, room_id FROM tenants WHERE line_user_id = ?")
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

  const result = await verifySlip(env, `${origin}/slips/${imageKey}`);
  const amount = result.amount;
  const transRef = result.transRef;
  const bill = await env.DB.prepare(
    "SELECT id, period, total FROM bills WHERE room_id = ? AND tenant_id = ? AND status = 'unpaid' ORDER BY period DESC LIMIT 1",
  )
    .bind(sender.room_id, sender.id)
    .first<UnpaidBillRow>();

  if (!result.verified || amount === null || transRef === null || bill === null || toSatang(amount) !== toSatang(bill.total)) {
    const reason: SlipReason = bill === null ? "no_unpaid_bill" : !result.verified || amount === null || transRef === null ? "not_verified" : "mismatch";
    await keepSlipForReview(env, slipId, result, userId, reason, bill);
    return;
  }

  const used = await env.DB.prepare("SELECT id FROM slips WHERE trans_ref = ? AND status <> 'rejected' LIMIT 1")
    .bind(transRef)
    .first<{ id: string }>();

  if (used !== null) {
    await rejectDuplicateSlip(env, slipId, result, amount, transRef, userId, used.id);
    return;
  }

  try {
    const results = await env.DB.batch([
      env.DB.prepare(closeBillSql).bind(canonicalPaidAt(result.date), bill.id),
      env.DB.prepare(matchSlipSql).bind(bill.id, bill.total, amount, transRef, slipResultJson(result, null), slipId),
    ]);

    if ((results[0]?.meta.changes ?? 0) === 0) {
      await keepSlipForReview(env, slipId, result, userId, "no_unpaid_bill", null);
      return;
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      await rejectDuplicateSlip(env, slipId, result, amount, transRef, userId, null);
      return;
    }

    throw error;
  }

  console.log(JSON.stringify({ message: "slip closed a bill", slipId, lineUserId: userId, billId: bill.id }));
  await pushMessage(env, userId, [{ type: "text", text: slipMatchedMessage(bill.total, bill.period) }]);
}
