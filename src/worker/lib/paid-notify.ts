import { logLineFailure, failureDetail, pushMessage } from "../line/api";
import { ownerBillPaidMessage } from "../line/messages";
import type { RealtimeBillPaid } from "../realtime";
import { billDetailUrl } from "./line-link";
import { signedSlipUrl } from "./slip-link";

export type BillPaidSource = "auto-slip" | "owner-settle" | "mark-paid";

export interface BillPaidEvent {
  billId: string;
  roomNumber: string;
  tenantName: string;
  period: string;
  total: number;
  method: "transfer" | "cash";
  source: BillPaidSource;
  /** ISO string */
  paidAt: string;
  /** คีย์รูปใน R2 — null เมื่อปิดบิลโดยไม่มีสลิป */
  slipImageKey: string | null;
}

/** แปลงเวลาชำระเป็นข้อความไทยตามเวลาไทย */
export function paidAtLabel(paidAt: string): string {
  const parsed = Date.parse(paidAt);

  if (Number.isNaN(parsed)) {
    return "-";
  }

  return new Date(parsed).toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** ข้อความช่องทางที่ใช้ทั้งในการ์ด LINE และ toast บนเว็บ */
export function methodLabel(event: BillPaidEvent): string {
  if (event.source === "auto-slip") {
    return "สลิปอัตโนมัติ";
  }

  if (event.source === "owner-settle") {
    return "ยืนยันจากคิวรอตรวจ";
  }

  return event.method === "cash" ? "เงินสด" : "โอน (บันทึกเอง)";
}

/**
 * ส่งเข้า WebSocket ของครอบครัวนี้ — await ก่อนตอบ HTTP
 *
 * ห้ามให้ขั้นนี้ทำให้คำขอปิดบิลล้มเหลว: บิลถูกปิดใน D1 ไปแล้ว ความผิดพลาด
 * ของการกระจายข้อความต้องเป็นแค่ log ไม่ใช่ 500 ที่ทำให้ผู้ใช้เข้าใจว่าปิด
 * ไม่สำเร็จแล้วกดซ้ำ (ซึ่งจะได้ 409)
 */
export async function broadcastBillPaid(
  env: Env,
  familyId: string,
  event: BillPaidEvent,
  excludeConnectionId: string | null,
): Promise<void> {
  const payload: RealtimeBillPaid = {
    v: 1,
    type: "bill-paid",
    billId: event.billId,
    roomNumber: event.roomNumber,
    tenantName: event.tenantName,
    period: event.period,
    total: event.total,
    methodLabel: methodLabel(event),
    paidAt: event.paidAt,
  };

  try {
    await env.REALTIME.get(env.REALTIME.idFromName(familyId)).broadcast(
      JSON.stringify(payload),
      excludeConnectionId,
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "bill paid broadcast failed",
        billId: event.billId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

/**
 * push LINE หาเจ้าของ — ผู้เรียกใช้ waitUntil ได้
 *
 * ถ้าเจ้าของยังไม่เชื่อม LINE ไว้ก็ไม่ใช่ความผิดพลาด แค่ข้ามพร้อม log
 * (เทียบ notifyOwnerOfSlipInReview ใน lib/slips.ts ที่ทำแบบเดียวกัน)
 */
export async function pushOwnerBillPaid(
  env: Env,
  familyId: string,
  origin: string,
  event: BillPaidEvent,
): Promise<void> {
  try {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE family_id = ? AND key = 'owner_line_user_id'")
      .bind(familyId)
      .first<{ value: string }>();
    const ownerId = (row?.value ?? "").trim();

    if (ownerId === "") {
      console.log(
        JSON.stringify({
          message: "bill paid owner alert skipped",
          billId: event.billId,
          reason: "owner line is not linked",
        }),
      );
      return;
    }

    const slipUrl =
      event.slipImageKey === null ? null : await signedSlipUrl(env, origin, event.slipImageKey);
    const delivered = await pushMessage(env, ownerId, [
      ownerBillPaidMessage({
        roomNumber: event.roomNumber,
        tenantName: event.tenantName,
        period: event.period,
        total: event.total,
        methodLabel: methodLabel(event),
        paidAtLabel: paidAtLabel(event.paidAt),
        billUrl: billDetailUrl(origin, event.billId, event.period),
        slipUrl,
      }),
    ]);

    console.log(
      JSON.stringify({
        message: "bill paid owner alerted",
        billId: event.billId,
        delivered: delivered === true,
      }),
    );
  } catch (error) {
    logLineFailure("bill paid owner alert failed", failureDetail(error));
  }
}
