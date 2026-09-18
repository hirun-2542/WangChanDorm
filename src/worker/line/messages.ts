import { formatBaht, thaiPeriodLabel } from "../lib/invoice";

export function welcomeMessage(dormName: string): string {
  return `ยินดีต้อนรับสู่${dormName} กรุณาพิมพ์เลขห้องของคุณ เช่น A101 เพื่อเชื่อม LINE`;
}

export function linkedMessage(fullName: string, roomNumber: string): string {
  return `เชื่อม LINE กับ คุณ${fullName} ห้อง ${roomNumber} สำเร็จ`;
}

export function notMatchedMessage(text: string): string {
  const trimmed = text.trim();

  if (/^[A-Za-z]\d+$/.test(trimmed) || /^\d+$/.test(trimmed)) {
    return `ไม่พบห้อง ${trimmed} ที่มีผู้เช่าอยู่ในระบบ กรุณาตรวจสอบเลขห้องอีกครั้ง หรือติดต่อเจ้าของหอ`;
  }

  return "ยังไม่พบห้องของคุณ กรุณาพิมพ์เลขห้อง เช่น A101 เพื่อเชื่อม LINE หรือติดต่อเจ้าของหอ";
}

export function ownerLinkedMessage(): string {
  return "เชื่อม LINE เจ้าของเรียบร้อย ระบบจะแจ้งเตือนที่ห้องแชทนี้";
}

export function slipNotLinkedMessage(): string {
  return "กรุณาเชื่อม LINE กับห้องของคุณก่อนส่งสลิป พิมพ์เลขห้อง เช่น A101 เพื่อเชื่อม";
}

export function slipDownloadFailedMessage(): string {
  return "ระบบดาวน์โหลดรูปสลิปไม่สำเร็จ กรุณาส่งรูปสลิปอีกครั้ง";
}

export function slipMatchedMessage(amount: number, period: string): string {
  return `ได้รับชำระบิลประจำเดือน ${thaiPeriodLabel(period)} ยอด ${formatBaht(amount)} บาท เรียบร้อยแล้ว`;
}

export function slipPendingReviewMessage(): string {
  return "ได้รับสลิปแล้ว เจ้าของหอจะตรวจสอบและยืนยันผลการชำระให้อีกครั้ง";
}

export function slipDuplicateMessage(): string {
  return "สลิปนี้ถูกใช้ปิดบิลไปแล้ว กรุณาส่งสลิปของรายการใหม่หรือติดต่อเจ้าของหอ";
}

function bahtText(value: number): string {
  const rounded = Math.round(value * 100) / 100;

  return Number.isInteger(rounded)
    ? formatBaht(rounded)
    : rounded.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ownerSlipPendingMessage(
  roomNumber: string,
  tenantName: string,
  slipAmount: number | null,
  billTotal: number | null,
): string {
  const amountText = slipAmount === null ? "ยอดในสลิปอ่านไม่ได้" : `ยอดในสลิป ${bahtText(slipAmount)} บาท`;
  const compareText = billTotal === null ? "ยังไม่มีบิลค้างให้เทียบ" : `เทียบกับยอดบิล ${bahtText(billTotal)} บาท`;

  return `มีสลิปใหม่รอตรวจจากห้อง ${roomNumber} คุณ${tenantName} ${amountText} ${compareText} เปิดหน้าคิวรอตรวจเพื่อปิดบิลหรือปฏิเสธ`;
}

export interface TenantBillSummary {
  period: string;
  total: number;
  status: "paid" | "unpaid";
}

export function slipInstructionMessage(): string {
  return "ส่งรูปสลิปโอนเงินในแชทนี้ได้เลย ระบบจะตรวจสอบสลิปให้อัตโนมัติ";
}

export function billStatusMessage(roomNumber: string, bills: readonly TenantBillSummary[]): string {
  const latest = bills[0];

  if (latest === undefined) {
    return `ยังไม่มีบิลของห้อง ${roomNumber} ในระบบ เมื่อเจ้าของหอออกบิลแล้วจะแจ้งให้ทราบในแชทนี้`;
  }

  const unpaid = bills.filter((bill) => bill.status === "unpaid");
  const outstanding = unpaid[0];

  if (outstanding === undefined) {
    return `บิลล่าสุดของห้อง ${roomNumber} ประจำเดือน ${thaiPeriodLabel(latest.period)} ยอด ${formatBaht(latest.total)} บาท ชำระแล้ว ไม่มียอดค้างชำระ`;
  }

  const more = unpaid.length > 1 ? ` มียอดค้างชำระอีก ${unpaid.length - 1} ใบ` : "";

  return `บิลของห้อง ${roomNumber} ประจำเดือน ${thaiPeriodLabel(outstanding.period)} ยอด ${formatBaht(outstanding.total)} บาท ยังไม่ชำระ${more} กรุณาชำระและส่งสลิปในแชทนี้`;
}

export function registerRequiredMessage(registerUrl: string): string {
  return `กรุณาลงทะเบียนผู้เช่าเพื่อผูก LINE กับห้องของคุณก่อน ลงทะเบียนได้ที่ ${registerUrl}`;
}

export function registerLinkMessage(registerUrl: string): string {
  return `ลิงก์ลงทะเบียนผู้เช่า ${registerUrl}`;
}

export function contactOwnerMessage(ownerName: string, ownerPhone: string): string {
  const name = ownerName.trim();
  const phone = ownerPhone.trim();
  const who = name === "" ? "เจ้าของหอ" : `เจ้าของหอ ${name}`;

  if (phone === "") {
    return `${who} ยังไม่ได้บันทึกเบอร์โทรไว้ กรุณาฝากคำถามไว้ในแชทนี้แล้วรอการติดต่อกลับ`;
  }

  return `${who} เบอร์โทร ${phone}`;
}
