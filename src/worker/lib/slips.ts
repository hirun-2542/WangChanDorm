import { failureDetail, fetchMessageContent, logLineFailure, pushMessage, replyMessage } from "../line/api";
import { type SlipOkResult, type SlipPayee, compareReceiver, verifySlip } from "../line/slipok";
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

const insertSlipSql =
  "INSERT INTO slips (id, family_id, line_user_id, image_key, status) VALUES (?, ?, ?, ?, 'pending_review')";

const updateSlipSql =
  "UPDATE slips SET status = ?, bill_id = ?, bill_total = ?, amount = ?, trans_ref = ?, verify_result = ? WHERE id = ? AND family_id = ? AND status = 'pending_review'";

/**
 * ปิดบิลและผูกสลิปต้องเกิดใน transaction เดียวกัน (DB.batch)
 *
 * คำสั่งแรกผูกสลิปได้เฉพาะเมื่อบิลยังไม่ถูกปิด คำสั่งที่สองปิดบิลได้เฉพาะเมื่อ
 * สลิปถูกผูกกับบิลใบนั้นจริง ๆ สองเงื่อนไขนี้ตัดกันเอง จึงไม่มีทางที่สลิปจะถูก
 * ทำเครื่องหมายว่าปิดบิลทั้งที่บิลยังเปิดอยู่ แม้ Worker จะล้มกลางทาง
 */
const matchSlipSql =
  "UPDATE slips SET status = 'matched', bill_id = ?, bill_total = ?, amount = ?, trans_ref = ?, verify_result = ? WHERE id = ? AND family_id = ? AND status = 'pending_review' AND EXISTS (SELECT 1 FROM bills WHERE id = ? AND family_id = ? AND status = 'unpaid') AND NOT EXISTS (SELECT 1 FROM slips WHERE family_id = ? AND trans_ref = ? AND status = 'matched' AND id <> ?)";

const closeBillSql =
  "UPDATE bills SET status = 'paid', paid_at = ?, paid_method = 'transfer' WHERE id = ? AND family_id = ? AND status = 'unpaid' AND EXISTS (SELECT 1 FROM slips WHERE id = ? AND family_id = ? AND bill_id = bills.id AND status = 'matched')";

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
  payee_promptpay_type: string;
  payee_promptpay_id: string;
  payee_bank_account_number: string;
}

interface SlipOwnerAlert {
  roomNumber: string;
  tenantName: string;
  slipAmount: number | null;
  billTotal: number | null;
}

/** ข้อความถึงผู้เช่าเมื่อสลิปโอนเข้าบัญชีที่ไม่ใช่บัญชีรับเงินของหอ */
const slipReceiverMismatchMessage =
  "สลิปนี้โอนเข้าบัญชีอื่น ไม่ใช่บัญชีรับเงินของหอ จึงยังปิดบิลให้ไม่ได้ กรุณาส่งสลิปที่โอนเข้าบัญชีของหอ หรือรอเจ้าของหอตรวจสอบ";

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

async function notifyOwnerOfSlipInReview(env: Env, familyId: string, slipId: string, alert: SlipOwnerAlert): Promise<void> {
  try {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE family_id = ? AND key = 'owner_line_user_id'")
      .bind(familyId)
      .first<{ value: string }>();
    const ownerId = (row?.value ?? "").trim();

    if (ownerId === "") {
      console.log(JSON.stringify({ message: "slip owner alert skipped", slipId, reason: "owner line is not linked" }));
      return;
    }

    const delivered = await pushMessage(env, ownerId, [
      ownerSlipPendingMessage(alert.roomNumber, alert.tenantName, alert.slipAmount, alert.billTotal),
    ]);

    console.log(JSON.stringify({ message: "slip owner alerted", slipId, delivered: delivered === true }));
  } catch (error) {
    logLineFailure("slip owner alert failed", failureDetail(error));
  }
}

async function keepSlipForReview(
  env: Env,
  familyId: string,
  slipId: string,
  result: SlipOkResult,
  lineUserId: string,
  reason: SlipReason,
  bill: UnpaidBillRow | null,
  sender: SlipSenderRow,
  receiverMismatch = false,
): Promise<void> {
  await env.DB.prepare(updateSlipSql)
    .bind(
      "pending_review",
      bill?.id ?? null,
      bill?.total ?? null,
      result.amount,
      result.transRef,
      slipResultJson(result, reason),
      slipId,
      familyId,
    )
    .run();

  console.log(JSON.stringify({ message: "slip kept for review", slipId, lineUserId, verified: result.verified, reason, receiverMismatch }));

  await pushMessage(env, lineUserId, [
    receiverMismatch ? { type: "text", text: slipReceiverMismatchMessage } : slipPendingReviewMessage(),
  ]);
  await notifyOwnerOfSlipInReview(env, familyId, slipId, {
    roomNumber: sender.room_number,
    tenantName: sender.full_name,
    slipAmount: result.amount,
    billTotal: bill?.total ?? null,
  });
}

async function rejectDuplicateSlip(
  env: Env,
  familyId: string,
  slipId: string,
  result: SlipOkResult,
  lineUserId: string,
  usedSlipId: string | null,
): Promise<void> {
  await env.DB.prepare(updateSlipSql)
    .bind("rejected", null, null, result.amount, result.transRef, slipResultJson(result, "duplicate_slip"), slipId, familyId)
    .run();

  console.log(JSON.stringify({ message: "slip rejected as a duplicate transfer reference", slipId, lineUserId, usedSlipId }));
  await pushMessage(env, lineUserId, [slipDuplicateMessage()]);
}

/**
 * บัญชีรับเงินที่ต้องใช้เทียบกับสลิปนี้ — มาจาก snapshot ในบิลที่กำลังจะปิด
 * ไม่ใช่ตั้งค่าปัจจุบันของหอ
 *
 * ถ้าเจ้าของหอเปลี่ยนพร้อมเพย์หรือบัญชีธนาคารหลังจากออกบิลไปแล้ว ผู้เช่าที่
 * โอนเข้าบัญชีเดิมตามที่ระบุในบิลของตัวเองต้องไม่ถูกตีว่าโอนผิดบัญชี และ
 * สลิปที่โอนเข้าบัญชีใหม่ (ที่ยังไม่มีในบิลเก่าใบนี้) ก็ต้องไม่ปิดบิลเก่าได้
 * เช่นกัน — ไม่มีบิลให้เทียบ (bill เป็น null) ถือว่ายังไม่รู้ ปล่อยผ่านไปให้
 * ขั้นถัดไปตัดสินด้วยเหตุผลอื่น (ไม่มีบิลค้างชำระ)
 */
function payeeFromBill(bill: UnpaidBillRow | null): SlipPayee | null {
  if (bill === null) {
    return null;
  }

  const proxyId = bill.payee_promptpay_id.trim();
  const accountNumber = bill.payee_bank_account_number.trim();

  if (proxyId === "" && accountNumber === "") {
    return null;
  }

  return {
    proxyType: bill.payee_promptpay_type === "citizen-id" ? "NATID" : "MSISDN",
    proxyId,
    accountNumber,
  };
}

export async function handleSlipImage(
  env: Env,
  familyId: string,
  userId: string,
  replyToken: string,
  messageId: string,
): Promise<void> {
  const sender = await env.DB.prepare(
    "SELECT t.id, t.room_id, t.full_name, r.room_number FROM tenants t JOIN rooms r ON r.id = t.room_id WHERE t.family_id = ? AND r.family_id = ? AND t.line_user_id = ?",
  )
    .bind(familyId, familyId, userId)
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
  await env.DB.prepare(insertSlipSql).bind(slipId, familyId, userId, imageKey).run();

  const bill = await env.DB.prepare(
    "SELECT id, period, total, payee_promptpay_type, payee_promptpay_id, payee_bank_account_number FROM bills WHERE family_id = ? AND room_id = ? AND tenant_id = ? AND status = 'unpaid' ORDER BY period DESC LIMIT 1",
  )
    .bind(familyId, sender.room_id, sender.id)
    .first<UnpaidBillRow>();

  const result = await verifySlip(env, content.bytes, content.contentType, bill?.total ?? null);
  const amount = result.amount;
  const transRef = result.transRef;

  if (result.duplicate) {
    const used = transRef === null
      ? null
      : await env.DB.prepare("SELECT id FROM slips WHERE family_id = ? AND trans_ref = ? AND status <> 'rejected' LIMIT 1")
          .bind(familyId, transRef)
          .first<{ id: string }>();
    await rejectDuplicateSlip(env, familyId, slipId, result, userId, used?.id ?? null);
    return;
  }

  const payee = payeeFromBill(bill);
  const receiverVerdict = result.receiverMismatch
    ? "mismatch"
    : payee === null
      ? "unknown"
      : compareReceiver(result.receiver, payee);

  if (receiverVerdict === "mismatch") {
    console.log(
      JSON.stringify({
        message: "slip receiver does not match the dorm payee",
        slipId,
        lineUserId: userId,
        providerReported: result.receiverMismatch,
      }),
    );
    await keepSlipForReview(env, familyId, slipId, result, userId, "not_verified", bill, sender, true);
    return;
  }

  if (!result.verified || amount === null || bill === null || toSatang(amount) !== toSatang(bill.total)) {
    const reason: SlipReason = bill === null ? "no_unpaid_bill" : !result.verified || amount === null ? "not_verified" : "mismatch";
    await keepSlipForReview(env, familyId, slipId, result, userId, reason, bill, sender);
    return;
  }

  if (transRef !== null) {
    const used = await env.DB.prepare("SELECT id FROM slips WHERE family_id = ? AND trans_ref = ? AND status <> 'rejected' LIMIT 1")
      .bind(familyId, transRef)
      .first<{ id: string }>();

    if (used !== null) {
      await rejectDuplicateSlip(env, familyId, slipId, result, userId, used.id);
      return;
    }
  }

  let results: D1Result[];

  try {
    results = await env.DB.batch([
      env.DB.prepare(matchSlipSql).bind(
        bill.id,
        bill.total,
        amount,
        transRef,
        slipResultJson(result, null),
        slipId,
        familyId,
        bill.id,
        familyId,
        familyId,
        transRef,
        slipId,
      ),
      env.DB.prepare(closeBillSql).bind(canonicalPaidAt(result.date), bill.id, familyId, slipId, familyId),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      await rejectDuplicateSlip(env, familyId, slipId, result, userId, null);
      return;
    }

    throw error;
  }

  if ((results[0]?.meta.changes ?? 0) === 0 || (results[1]?.meta.changes ?? 0) === 0) {
    // ไม่มีอะไรถูกเขียนเลย: หรือบิลถูกปิดไปก่อนแล้ว หรือเลขอ้างอิงนี้ถูกใช้ปิดบิลไปแล้ว
    const used = transRef === null
      ? null
      : await env.DB.prepare(
          "SELECT id FROM slips WHERE family_id = ? AND trans_ref = ? AND status = 'matched' AND id <> ? LIMIT 1",
        )
          .bind(familyId, transRef, slipId)
          .first<{ id: string }>();

    if (used !== null) {
      await rejectDuplicateSlip(env, familyId, slipId, result, userId, used.id);
      return;
    }

    await keepSlipForReview(env, familyId, slipId, result, userId, "no_unpaid_bill", null, sender);
    return;
  }

  console.log(JSON.stringify({ message: "slip closed a bill", slipId, lineUserId: userId, billId: bill.id }));
  await pushMessage(env, userId, [slipMatchedMessage(bill.total, bill.period)]);
}
