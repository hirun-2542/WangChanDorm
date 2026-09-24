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
 * ผู้เช่าใหม่เข้าระบบ — ลงทะเบียนเองผ่าน LIFF หรือเจ้าของกดเชื่อม LINE ให้
 *
 * `source` แยกสองทางนี้เพราะความหมายต่อเจ้าของต่างกัน: `self` คือคนที่เจ้าของ
 * ยังไม่รู้จัก (ต้องเข้าไปดูว่าตั้งค่าไว้ถูกไหม) ส่วน `owner` คือคนที่เจ้าของ
 * เพิ่มเข้าไปเองแล้ว (แค่ยืนยันว่าเชื่อมติด)
 */
export interface TenantJoinedNotice {
  tenantId: string;
  roomNumber: string;
  tenantName: string;
  source: "self" | "owner";
  joinedAt: string;
}

/**
 * รายการแจ้งเตือนที่เก็บในหน่วยความจำของแท็บ
 *
 * สองชนิดเท่านั้น: บิลถูกปิด กับ ผู้เช่าใหม่ — ใช้ discriminated union เพื่อให้
 * การเพิ่มชนิดที่สามในอนาคตบังคับให้ TypeScript ชี้ทุกจุดที่ต้องแก้ (ตัว render
 * ข้อความ/ไอคอน/ลิงก์) แทนที่จะเงียบ ๆ ตกหล่น
 *
 * เก็บเฉพาะเหตุการณ์ที่เข้ามาทาง WebSocket ระหว่างที่แท็บนี้เปิดอยู่ ไม่ได้อ่าน
 * จากเซิร์ฟเวอร์ เพราะเซิร์ฟเวอร์ไม่เก็บประวัติ (DO ไม่มี replay buffer) —
 * ความหมายของปุ่มนี้จึงเป็น "มีอะไรเกิดขึ้นระหว่างที่ฉันเปิดหน้านี้" ไม่ใช่
 * "กล่องข้อความที่อ่านย้อนหลังได้" ถ้าอยากได้แบบหลังต้องมีตารางใน D1 ซึ่งเป็น
 * คนละงานกัน
 *
 * หน่วยความจำอย่างเดียวโดยตั้งใจ: ข้อความพวกนี้หมดความหมายหลังรีเฟรช (ข้อมูล
 * จริงอยู่ในหน้าบิล/หน้าผู้เช่าอยู่แล้ว) และการเก็บลง sessionStorage จะทำให้ผู้ใช้
 * เห็นรายการเก่าที่อาจไม่ตรงกับข้อมูลจริงแล้ว
 */
export interface BillPaidNotification {
  kind: "bill-paid";
  /** บิลใบหนึ่งถูกปิดได้ครั้งเดียว — ใช้ billId กันรายการซ้ำได้เอง */
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

export interface TenantJoinedNotification {
  kind: "tenant-joined";
  /** ผู้เช่าหนึ่งคนเข้าได้ครั้งเดียว (ลงทะเบียน/เชื่อม) — ใช้ tenantId กันซ้ำ */
  id: string;
  tenantId: string;
  roomNumber: string;
  tenantName: string;
  source: "self" | "owner";
  /** ISO string */
  joinedAt: string;
  read: boolean;
}

export type AppNotification = BillPaidNotification | TenantJoinedNotification;

/** เพดานรายการที่เก็บ — พอให้เห็นย้อนหลังในรอบการใช้งานหนึ่ง ไม่กินหน่วยความจำโตไม่จำกัด */
export const maxNotifications = 50;

export function notificationOf(notice: BillPaidNotice): BillPaidNotification {
  return {
    kind: "bill-paid",
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

export function tenantJoinedNotificationOf(
  notice: TenantJoinedNotice,
): TenantJoinedNotification {
  return {
    kind: "tenant-joined",
    id: notice.tenantId,
    tenantId: notice.tenantId,
    roomNumber: notice.roomNumber,
    tenantName: notice.tenantName,
    source: notice.source,
    joinedAt: notice.joinedAt,
    read: false,
  };
}

/**
 * แทรกรายการใหม่ไว้บนสุด และไม่เก็บซ้ำ
 *
 * กันซ้ำด้วย "ชนิด + id" ไม่ใช่ id เดี่ยว ๆ เพราะ id ของทั้งสองชนิดมาจาก
 * ตัวสร้างเดียวกัน (UUID) แต่เป็นคนละเนมสเปซโดยความหมาย — ถ้าวันหนึ่งมี id
 * ตรงกัน การเทียบแบบไม่แยกชนิดจะทำให้รายการหนึ่งหายไปเงียบ ๆ ซึ่งผู้ใช้จะ
 * ไม่มีทางรู้เลยว่ามีเหตุการณ์ที่สองเกิดขึ้น
 */
function dedupeKey(item: AppNotification): string {
  return `${item.kind}:${item.id}`;
}

export function withNotification(
  list: readonly AppNotification[],
  item: AppNotification,
): AppNotification[] {
  const key = dedupeKey(item);

  return [item, ...list.filter((existing) => dedupeKey(existing) !== key)].slice(
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
export function notificationText(item: AppNotification): string {
  if (item.kind === "tenant-joined") {
    return `ห้อง ${item.roomNumber} มีผู้เช่าใหม่ ${item.tenantName}`;
  }

  return `ห้อง ${item.roomNumber} ชำระแล้ว ${item.total.toLocaleString("en-US")} บาท`;
}

/** บรรทัดรองในแผง — บอกรายละเอียดที่ข้อความหลักไม่มีที่พอ */
export function notificationDetail(item: AppNotification): string {
  if (item.kind === "tenant-joined") {
    return item.source === "owner" ? "เชื่อม LINE ให้แล้ว" : "ลงทะเบียนเองผ่าน LINE";
  }

  return `${item.tenantName} · ${item.methodLabel} · ${notificationTime(item.paidAt)}`;
}

/** ไอคอน Material Symbols ของแต่ละชนิด */
export function notificationIcon(item: AppNotification): string {
  return item.kind === "tenant-joined" ? "person_add" : "check_circle";
}

/**
 * ลิงก์ไปดูของจริง
 *
 * ผู้เช่าไม่มีหน้าของตัวเองให้เปิดตรง ๆ (รายชื่อผู้เช่าอยู่ในหน้าเดียวกับห้อง)
 * จึงพาไปที่หน้ารายชื่อผู้เช่า ส่วนบิลเปิดได้ตรงใบเพราะมี id กับรอบบิล
 */
export function notificationHref(item: AppNotification): string {
  if (item.kind === "tenant-joined") {
    return "#tenants";
  }

  return `#bills/detail/${encodeURIComponent(item.billId)}?period=${encodeURIComponent(item.period)}`;
}

/** เวลาที่แสดงในแผง — ใช้เวลาท้องถิ่นของเครื่อง ไม่ต้องแปลงเขตเวลาเอง */
export function notificationTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleTimeString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
