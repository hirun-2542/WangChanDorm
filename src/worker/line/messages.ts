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
