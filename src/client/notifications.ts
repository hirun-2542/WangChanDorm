/**
 * ข้อความ "บิลถูกปิด" ที่รับมาทาง WebSocket
 *
 * ประกาศไว้ที่นี่ (โมดูลข้อมูลล้วน) ไม่ใช่ใน `realtime.ts` เพราะ `realtime.ts`
 * แตะ `window`/`document` — ถ้าโมดูลนี้ import ประเภทจากที่นั่น ไฟล์ฝั่ง DOM จะ
 * ถูกดึงเข้า tsconfig ของ worker (ซึ่งไม่มี lib DOM) แล้ว typecheck พังทั้งที่
 * โค้ดฝั่ง worker ไม่ได้เกี่ยวข้องอะไรด้วย
 */
export interface BillPaidNotice {
  billId: string;
  roomNumber: string;
  tenantName: string;
  period: string;
  total: number;
  methodLabel: string;
  paidAt: string;
}

/**
 * รายการแจ้งเตือนที่เก็บในหน่วยความจำของแท็บ
 *
 * เก็บเฉพาะ "การชำระเงิน" ที่เข้ามาทาง WebSocket ระหว่างที่แท็บนี้เปิดอยู่
 * ไม่ได้อ่านจากเซิร์ฟเวอร์ เพราะเซิร์ฟเวอร์ไม่เก็บประวัติ (DO ไม่มี replay buffer)
 * — ความหมายของปุ่มนี้จึงเป็น "มีอะไรเกิดขึ้นระหว่างที่ฉันเปิดหน้านี้" ไม่ใช่
 * "กล่องข้อความที่อ่านย้อนหลังได้" ถ้าอยากได้แบบหลังต้องมีตารางใน D1 ซึ่งเป็น
 * คนละงานกัน
 *
 * หน่วยความจำอย่างเดียวโดยตั้งใจ: ข้อความพวกนี้หมดความหมายหลังรีเฟรช (ข้อมูล
 * จริงอยู่ในหน้าบิล/แดชบอร์ดอยู่แล้ว) และการเก็บลง sessionStorage จะทำให้ผู้ใช้
 * เห็นตัวเลขเก่าที่อาจไม่ตรงกับบิลแล้ว
 */
export interface AppNotification {
  /** ใช้ billId เป็น id เพราะบิลใบหนึ่งถูกปิดได้ครั้งเดียว — กันรายการซ้ำได้เอง */
  id: string;
  billId: string;
  roomNumber: string;
  tenantName: string;
  period: string;
  total: number;
  methodLabel: string;
  /** ISO string */
  paidAt: string;
  read: boolean;
}

/** เพดานรายการที่เก็บ — พอให้เห็นย้อนหลังในรอบการใช้งานหนึ่ง ไม่กินหน่วยความจำโตไม่จำกัด */
export const maxNotifications = 50;

export function notificationOf(notice: BillPaidNotice): AppNotification {
  return {
    id: notice.billId,
    billId: notice.billId,
    roomNumber: notice.roomNumber,
    tenantName: notice.tenantName,
    period: notice.period,
    total: notice.total,
    methodLabel: notice.methodLabel,
    paidAt: notice.paidAt,
    read: false,
  };
}

/**
 * แทรกรายการใหม่ไว้บนสุด และไม่เก็บ id ซ้ำ
 *
 * กันซ้ำด้วย billId ไม่ใช่ด้วยเวลาหรือข้อความ เพราะการเชื่อมต่อที่หลุดแล้วต่อใหม่
 * อาจทำให้ข้อความเดียวกันมาถึงสองครั้ง (เซิร์ฟเวอร์ไม่มี replay แต่แท็บที่ต่อใหม่
 * ยังรับข้อความใหม่ได้ตามปกติ) การมีบิลใบเดียวกันสองแถวจะทำให้ผู้ใช้อ่านสับสน
 */
export function withNotification(
  list: readonly AppNotification[],
  item: AppNotification,
): AppNotification[] {
  return [item, ...list.filter((existing) => existing.id !== item.id)].slice(
    0,
    maxNotifications,
  );
}

/** จำนวนที่ยังไม่ได้อ่าน — ตัวเลขบนปุ่มกระดิ่ง */
export function unreadCount(list: readonly AppNotification[]): number {
  return list.reduce((total, item) => (item.read ? total : total + 1), 0);
}

/** ทำเครื่องหมายว่าอ่านแล้วทั้งหมด (ตอนเปิดแผง) */
export function markAllRead(list: readonly AppNotification[]): AppNotification[] {
  return list.map((item) => (item.read ? item : { ...item, read: true }));
}

/**
 * ข้อความบรรทัดเดียวที่ผู้ใช้เห็น — ใช้ทั้งบน toast และในแผง
 *
 * อยู่ที่นี่ที่เดียวเพื่อให้ทั้งสองที่ไม่พูดไม่ตรงกัน
 */
export function notificationText(item: {
  roomNumber: string;
  total: number;
}): string {
  return `ห้อง ${item.roomNumber} ชำระแล้ว ${item.total.toLocaleString("en-US")} บาท`;
}

/** เวลาที่แสดงในแผง — ใช้เวลาท้องถิ่นของเครื่อง ไม่ต้องแปลงเขตเวลาเอง */
export function notificationTime(paidAt: string): string {
  const date = new Date(paidAt);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleTimeString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
