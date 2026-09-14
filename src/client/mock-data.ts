export type ElectricMode = "meter" | "flat";
export type BillStatus = "paid" | "unpaid";
export type TenantStatus = "current" | "moved-out";
export type ReviewReason = "ยอดไม่ตรง" | "ตรวจไม่ผ่าน";
export type LineAudience = "ผู้เช่า" | "เจ้าของ";

export interface DormInfo {
  name: string;
  ownerName: string;
  phone: string;
  promptPayId: string;
  promptPayName: string;
  waterRate: number;
  electricRate: number;
  pairingCode: string;
  lineConnected: boolean;
  easySlipPlan: string;
  easySlipChecksLeft: number;
}

export interface Room {
  id: string;
  rent: number;
  waterRate: number;
  electricRate: number;
  electricMode: ElectricMode;
  flatElectricAmount: number;
  occupied: boolean;
  previousWater: number;
  previousElectric: number;
}

export interface Tenant {
  id: string;
  name: string;
  roomId: string;
  phone: string;
  checkIn: string;
  lineLinked: boolean;
  status: TenantStatus;
  movedOutAt: string | null;
}

export interface ExtraCharge {
  label: string;
  amount: number;
}

export interface Bill {
  id: string;
  period: string;
  roomId: string;
  tenantId: string;
  tenantName: string;
  rent: number;
  waterRate: number;
  waterPrevious: number;
  waterCurrent: number;
  waterUnits: number;
  waterAmount: number;
  electricMode: ElectricMode;
  electricRate: number;
  electricPrevious: number | null;
  electricCurrent: number | null;
  electricUnits: number | null;
  electricAmount: number;
  extraCharges: ExtraCharge[];
  total: number;
  status: BillStatus;
  lineSentAt: string | null;
}

export interface SlipReview {
  id: string;
  billId: string;
  roomId: string;
  tenantName: string;
  slipAmount: number | null;
  billAmount: number;
  delta: number | null;
  reason: ReviewReason;
  easySlipState: string;
  bank: string | null;
  transferredAt: string | null;
  submittedAt: string;
}

export interface MonthlyRevenue {
  month: string;
  amount: number;
}

export interface MonthSummary {
  month: string;
  due: number;
  collected: number;
  unpaid: number;
  vacantRooms: number;
  unpaidRoomIds: string[];
}

export interface LineRow {
  label: string;
  value: string;
}

export interface LineEvent {
  id: string;
  label: string;
  audience: LineAudience;
  description: string;
  headline: string;
  rows: LineRow[];
  variables: string[];
}

export const dorm: DormInfo = {
  name: "หอพักวังจันทร์",
  ownerName: "สมศักดิ์ ใจดี",
  phone: "081-234-5678",
  promptPayId: "081-234-5678",
  promptPayName: "สมศักดิ์ ใจดี",
  waterRate: 18,
  electricRate: 7,
  pairingCode: "529407",
  lineConnected: true,
  easySlipPlan: "ทดลอง",
  easySlipChecksLeft: 37,
};

export const period = "กันยายน 2569";

export const rooms: Room[] = [
  { id: "A101", rent: 3500, waterRate: 18, electricRate: 7, electricMode: "meter", flatElectricAmount: 0, occupied: true, previousWater: 120, previousElectric: 320 },
  { id: "A102", rent: 3500, waterRate: 18, electricRate: 7, electricMode: "meter", flatElectricAmount: 0, occupied: true, previousWater: 98, previousElectric: 280 },
  { id: "A103", rent: 4200, waterRate: 20, electricRate: 7, electricMode: "meter", flatElectricAmount: 0, occupied: true, previousWater: 130, previousElectric: 310 },
  { id: "A104", rent: 3500, waterRate: 18, electricRate: 7, electricMode: "meter", flatElectricAmount: 0, occupied: false, previousWater: 190, previousElectric: 500 },
  { id: "A105", rent: 3500, waterRate: 18, electricRate: 7, electricMode: "meter", flatElectricAmount: 0, occupied: true, previousWater: 76, previousElectric: 245 },
  { id: "A106", rent: 3800, waterRate: 18, electricRate: 7, electricMode: "meter", flatElectricAmount: 0, occupied: true, previousWater: 112, previousElectric: 300 },
  { id: "A107", rent: 4200, waterRate: 18, electricRate: 7, electricMode: "meter", flatElectricAmount: 0, occupied: true, previousWater: 90, previousElectric: 250 },
  { id: "A108", rent: 3500, waterRate: 18, electricRate: 7, electricMode: "meter", flatElectricAmount: 0, occupied: true, previousWater: 88, previousElectric: 260 },
  { id: "A109", rent: 3800, waterRate: 18, electricRate: 7, electricMode: "meter", flatElectricAmount: 0, occupied: false, previousWater: 145, previousElectric: 420 },
  { id: "A110", rent: 3800, waterRate: 18, electricRate: 7, electricMode: "flat", flatElectricAmount: 600, occupied: true, previousWater: 130, previousElectric: 460 },
  { id: "A111", rent: 3500, waterRate: 18, electricRate: 7, electricMode: "meter", flatElectricAmount: 0, occupied: true, previousWater: 95, previousElectric: 330 },
  { id: "A112", rent: 1500, waterRate: 18, electricRate: 7, electricMode: "meter", flatElectricAmount: 0, occupied: true, previousWater: 62, previousElectric: 180 },
  { id: "A113", rent: 4200, waterRate: 18, electricRate: 7, electricMode: "meter", flatElectricAmount: 0, occupied: true, previousWater: 118, previousElectric: 275 },
  { id: "A114", rent: 3500, waterRate: 18, electricRate: 7, electricMode: "meter", flatElectricAmount: 0, occupied: true, previousWater: 102, previousElectric: 210 },
  { id: "A115", rent: 3800, waterRate: 18, electricRate: 7, electricMode: "meter", flatElectricAmount: 0, occupied: true, previousWater: 134, previousElectric: 388 },
  { id: "A116", rent: 3500, waterRate: 18, electricRate: 7, electricMode: "meter", flatElectricAmount: 0, occupied: true, previousWater: 79, previousElectric: 296 },
  { id: "A117", rent: 3500, waterRate: 18, electricRate: 7, electricMode: "meter", flatElectricAmount: 0, occupied: false, previousWater: 160, previousElectric: 455 },
  { id: "A118", rent: 4200, waterRate: 18, electricRate: 7, electricMode: "meter", flatElectricAmount: 0, occupied: true, previousWater: 121, previousElectric: 305 },
];

export const tenants: Tenant[] = [
  { id: "t-a101", name: "สมชาย ใจดี", roomId: "A101", phone: "081-234-5678", checkIn: "01 มี.ค. 68", lineLinked: true, status: "current", movedOutAt: null },
  { id: "t-a102", name: "มาลี ศรีสุข", roomId: "A102", phone: "082-345-6789", checkIn: "12 เม.ย. 68", lineLinked: true, status: "current", movedOutAt: null },
  { id: "t-a103", name: "ธนา เจริญกิจ", roomId: "A103", phone: "085-456-7890", checkIn: "05 มี.ค. 68", lineLinked: true, status: "current", movedOutAt: null },
  { id: "t-a105", name: "อรุณี แสงทอง", roomId: "A105", phone: "086-567-8901", checkIn: "20 พ.ค. 68", lineLinked: true, status: "current", movedOutAt: null },
  { id: "t-a106", name: "ปริญญา สุวรรณโชติ", roomId: "A106", phone: "087-678-9012", checkIn: "01 มิ.ย. 68", lineLinked: true, status: "current", movedOutAt: null },
  { id: "t-a107", name: "วิภา สุขสันต์", roomId: "A107", phone: "090-111-2223", checkIn: "10 มิ.ย. 68", lineLinked: false, status: "current", movedOutAt: null },
  { id: "t-a108", name: "ศิริพร ทองคำ", roomId: "A108", phone: "088-789-0123", checkIn: "15 มิ.ย. 68", lineLinked: true, status: "current", movedOutAt: null },
  { id: "t-a110", name: "ณัฐพล กล้าหาญ", roomId: "A110", phone: "089-890-1234", checkIn: "01 ก.ค. 68", lineLinked: true, status: "current", movedOutAt: null },
  { id: "t-a111", name: "วีระ คำมณี", roomId: "A111", phone: "091-123-4567", checkIn: "03 ก.ค. 68", lineLinked: true, status: "current", movedOutAt: null },
  { id: "t-a112", name: "นพดล อินทร์แปลง", roomId: "A112", phone: "092-234-5678", checkIn: "10 ก.ค. 68", lineLinked: true, status: "current", movedOutAt: null },
  { id: "t-a113", name: "จันทร์เพ็ญ อินทรีย์", roomId: "A113", phone: "093-345-6789", checkIn: "01 ส.ค. 68", lineLinked: true, status: "current", movedOutAt: null },
  { id: "t-a114", name: "สมปอง ใจกล้า", roomId: "A114", phone: "094-456-7890", checkIn: "05 ส.ค. 68", lineLinked: true, status: "current", movedOutAt: null },
  { id: "t-a115", name: "รัตนา แก้วมณี", roomId: "A115", phone: "095-567-8901", checkIn: "12 ส.ค. 68", lineLinked: true, status: "current", movedOutAt: null },
  { id: "t-a116", name: "อนันต์ พูลสุข", roomId: "A116", phone: "096-678-9012", checkIn: "01 ก.ย. 68", lineLinked: true, status: "current", movedOutAt: null },
  { id: "t-a118", name: "กิตติศักดิ์ บุญมา", roomId: "A118", phone: "097-789-0123", checkIn: "01 ก.ย. 68", lineLinked: true, status: "current", movedOutAt: null },
  { id: "t-a104-out", name: "ปกรณ์ วังทอง", roomId: "A104", phone: "098-890-1234", checkIn: "01 มี.ค. 68", lineLinked: true, status: "moved-out", movedOutAt: "30 ส.ค. 68" },
];

export const bills: Bill[] = [
  { id: "A101-2569-09", period, roomId: "A101", tenantId: "t-a101", tenantName: "สมชาย ใจดี", rent: 3500, waterRate: 18, waterPrevious: 120, waterCurrent: 163, waterUnits: 43, waterAmount: 774, electricMode: "meter", electricRate: 7, electricPrevious: 320, electricCurrent: 460, electricUnits: 140, electricAmount: 980, extraCharges: [], total: 5254, status: "paid", lineSentAt: "3 ก.ย. 68 · 09:10" },
  { id: "A102-2569-09", period, roomId: "A102", tenantId: "t-a102", tenantName: "มาลี ศรีสุข", rent: 3500, waterRate: 18, waterPrevious: 98, waterCurrent: 141, waterUnits: 43, waterAmount: 774, electricMode: "meter", electricRate: 7, electricPrevious: 280, electricCurrent: 365, electricUnits: 85, electricAmount: 595, extraCharges: [], total: 4869, status: "paid", lineSentAt: "3 ก.ย. 68 · 09:11" },
  { id: "A103-2569-09", period, roomId: "A103", tenantId: "t-a103", tenantName: "ธนา เจริญกิจ", rent: 4200, waterRate: 20, waterPrevious: 130, waterCurrent: 182, waterUnits: 52, waterAmount: 1040, electricMode: "meter", electricRate: 7, electricPrevious: 310, electricCurrent: 400, electricUnits: 90, electricAmount: 630, extraCharges: [{ label: "ค่าอินเทอร์เน็ต", amount: 200 }, { label: "ค่าจัดการขยะ", amount: 40 }], total: 6110, status: "unpaid", lineSentAt: "3 ก.ย. 68 · 09:12" },
  { id: "A105-2569-09", period, roomId: "A105", tenantId: "t-a105", tenantName: "อรุณี แสงทอง", rent: 3500, waterRate: 18, waterPrevious: 76, waterCurrent: 107, waterUnits: 31, waterAmount: 558, electricMode: "meter", electricRate: 7, electricPrevious: 245, electricCurrent: 302, electricUnits: 57, electricAmount: 399, extraCharges: [], total: 4457, status: "paid", lineSentAt: "3 ก.ย. 68 · 09:13" },
  { id: "A106-2569-09", period, roomId: "A106", tenantId: "t-a106", tenantName: "ปริญญา สุวรรณโชติ", rent: 3800, waterRate: 18, waterPrevious: 112, waterCurrent: 136, waterUnits: 24, waterAmount: 432, electricMode: "meter", electricRate: 7, electricPrevious: 300, electricCurrent: 374, electricUnits: 74, electricAmount: 518, extraCharges: [], total: 4750, status: "paid", lineSentAt: "3 ก.ย. 68 · 09:14" },
  { id: "A107-2569-09", period, roomId: "A107", tenantId: "t-a107", tenantName: "วิภา สุขสันต์", rent: 4200, waterRate: 18, waterPrevious: 90, waterCurrent: 105, waterUnits: 15, waterAmount: 270, electricMode: "meter", electricRate: 7, electricPrevious: 250, electricCurrent: 318, electricUnits: 68, electricAmount: 476, extraCharges: [], total: 4946, status: "unpaid", lineSentAt: null },
  { id: "A108-2569-09", period, roomId: "A108", tenantId: "t-a108", tenantName: "ศิริพร ทองคำ", rent: 3500, waterRate: 18, waterPrevious: 88, waterCurrent: 112, waterUnits: 24, waterAmount: 432, electricMode: "meter", electricRate: 7, electricPrevious: 260, electricCurrent: 384, electricUnits: 124, electricAmount: 868, extraCharges: [], total: 4800, status: "paid", lineSentAt: "3 ก.ย. 68 · 09:15" },
  { id: "A110-2569-09", period, roomId: "A110", tenantId: "t-a110", tenantName: "ณัฐพล กล้าหาญ", rent: 3800, waterRate: 18, waterPrevious: 130, waterCurrent: 145, waterUnits: 15, waterAmount: 270, electricMode: "flat", electricRate: 7, electricPrevious: null, electricCurrent: null, electricUnits: null, electricAmount: 600, extraCharges: [], total: 4670, status: "paid", lineSentAt: "3 ก.ย. 68 · 09:16" },
  { id: "A111-2569-09", period, roomId: "A111", tenantId: "t-a111", tenantName: "วีระ คำมณี", rent: 3500, waterRate: 18, waterPrevious: 95, waterCurrent: 120, waterUnits: 25, waterAmount: 450, electricMode: "meter", electricRate: 7, electricPrevious: 330, electricCurrent: 430, electricUnits: 100, electricAmount: 700, extraCharges: [], total: 4650, status: "paid", lineSentAt: "3 ก.ย. 68 · 09:17" },
  { id: "A112-2569-09", period, roomId: "A112", tenantId: "t-a112", tenantName: "นพดล อินทร์แปลง", rent: 1500, waterRate: 18, waterPrevious: 62, waterCurrent: 75, waterUnits: 13, waterAmount: 234, electricMode: "meter", electricRate: 7, electricPrevious: 180, electricCurrent: 250, electricUnits: 70, electricAmount: 490, extraCharges: [], total: 2224, status: "unpaid", lineSentAt: "3 ก.ย. 68 · 09:18" },
  { id: "A113-2569-09", period, roomId: "A113", tenantId: "t-a113", tenantName: "จันทร์เพ็ญ อินทรีย์", rent: 4200, waterRate: 18, waterPrevious: 118, waterCurrent: 141, waterUnits: 23, waterAmount: 414, electricMode: "meter", electricRate: 7, electricPrevious: 275, electricCurrent: 373, electricUnits: 98, electricAmount: 686, extraCharges: [], total: 5300, status: "paid", lineSentAt: "3 ก.ย. 68 · 09:19" },
  { id: "A114-2569-09", period, roomId: "A114", tenantId: "t-a114", tenantName: "สมปอง ใจกล้า", rent: 3500, waterRate: 18, waterPrevious: 102, waterCurrent: 124, waterUnits: 22, waterAmount: 396, electricMode: "meter", electricRate: 7, electricPrevious: 210, electricCurrent: 332, electricUnits: 122, electricAmount: 854, extraCharges: [], total: 4750, status: "paid", lineSentAt: "3 ก.ย. 68 · 09:20" },
  { id: "A115-2569-09", period, roomId: "A115", tenantId: "t-a115", tenantName: "รัตนา แก้วมณี", rent: 3800, waterRate: 18, waterPrevious: 134, waterCurrent: 154, waterUnits: 20, waterAmount: 360, electricMode: "meter", electricRate: 7, electricPrevious: 388, electricCurrent: 458, electricUnits: 70, electricAmount: 490, extraCharges: [], total: 4650, status: "paid", lineSentAt: "3 ก.ย. 68 · 09:21" },
  { id: "A116-2569-09", period, roomId: "A116", tenantId: "t-a116", tenantName: "อนันต์ พูลสุข", rent: 3500, waterRate: 18, waterPrevious: 79, waterCurrent: 98, waterUnits: 19, waterAmount: 342, electricMode: "meter", electricRate: 7, electricPrevious: 296, electricCurrent: 440, electricUnits: 144, electricAmount: 1008, extraCharges: [], total: 4850, status: "paid", lineSentAt: "3 ก.ย. 68 · 09:22" },
  { id: "A118-2569-09", period, roomId: "A118", tenantId: "t-a118", tenantName: "กิตติศักดิ์ บุญมา", rent: 4200, waterRate: 18, waterPrevious: 121, waterCurrent: 140, waterUnits: 19, waterAmount: 342, electricMode: "meter", electricRate: 7, electricPrevious: 305, electricCurrent: 399, electricUnits: 94, electricAmount: 658, extraCharges: [], total: 5200, status: "paid", lineSentAt: "3 ก.ย. 68 · 09:23" },
];

export const reviewQueue: SlipReview[] = [
  { id: "sr-a112", billId: "A112-2569-09", roomId: "A112", tenantName: "นพดล อินทร์แปลง", slipAmount: 2000, billAmount: 2224, delta: -224, reason: "ยอดไม่ตรง", easySlipState: "สลิปจริง", bank: "ธ.กสิกรไทย", transferredAt: "12 ก.ย. 68 · 20:15", submittedAt: "12 ก.ย. 68 · 20:16" },
  { id: "sr-a107", billId: "A107-2569-09", roomId: "A107", tenantName: "วิภา สุขสันต์", slipAmount: null, billAmount: 4946, delta: null, reason: "ตรวจไม่ผ่าน", easySlipState: "EasySlip ไม่ยืนยันธุรกรรม", bank: null, transferredAt: null, submittedAt: "13 ก.ย. 68 · 09:02" },
];

export const monthlyRevenue: MonthlyRevenue[] = [
  { month: "เม.ย.", amount: 55400 },
  { month: "พ.ค.", amount: 58100 },
  { month: "มิ.ย.", amount: 49900 },
  { month: "ก.ค.", amount: 61000 },
  { month: "ส.ค.", amount: 63800 },
  { month: "ก.ย.", amount: 58200 },
];

export const monthSummaries: MonthSummary[] = [
  { month: "กรกฎาคม 2569", due: 63500, collected: 61000, unpaid: 2500, vacantRooms: 3, unpaidRoomIds: ["A107"] },
  { month: "สิงหาคม 2569", due: 66000, collected: 63800, unpaid: 2200, vacantRooms: 3, unpaidRoomIds: ["A112"] },
  { month: "กันยายน 2569", due: 71480, collected: 58200, unpaid: 13280, vacantRooms: 3, unpaidRoomIds: ["A103", "A107", "A112"] },
];

export const lineEvents: LineEvent[] = [
  {
    id: "bill",
    label: "บิลรายเดือน",
    audience: "ผู้เช่า",
    description: "ส่งบิลพร้อม QR พร้อมเพย์ยอดตรงให้ผู้เช่าในแชท LINE",
    headline: "บิลค่าเช่า · กันยายน 2569",
    rows: [
      { label: "ห้อง", value: "A103" },
      { label: "ค่าห้อง", value: "4,200" },
      { label: "ค่าน้ำ 52 × 20", value: "1,040" },
      { label: "ค่าไฟ 90 × 7", value: "630" },
      { label: "ค่าอินเทอร์เน็ต", value: "200" },
      { label: "ค่าจัดการขยะ", value: "40" },
      { label: "รวม", value: "6,110" },
    ],
    variables: ["{room}", "{tenant}", "{period}", "{water_units}", "{electric_units}", "{total}"],
  },
  {
    id: "payment",
    label: "ยืนยันการชำระ",
    audience: "ผู้เช่า",
    description: "ยืนยันเมื่อปิดบิลด้วยสลิปที่ยอดตรงหรือหลังเจ้าของกดปิดบิล",
    headline: "ได้รับชำระ 6,110 บาท · บิลเดือน กันยายน 2569 (ห้อง A103)",
    rows: [],
    variables: ["{total}", "{period}", "{room}"],
  },
  {
    id: "owner-slip",
    label: "สลิปรอตรวจ",
    audience: "เจ้าของ",
    description: "แจ้งเจ้าของเมื่อมีสลิปที่ต้องตรวจเอง",
    headline: "สลิปรอตรวจ 1 รายการ · ห้อง A112 ยอดสลิป 2,000 แต่บิล 2,224 บาท",
    rows: [],
    variables: ["{count}", "{room}", "{slip_amount}", "{bill_amount}"],
  },
  {
    id: "owner-send",
    label: "สรุปหลังส่งบิล",
    audience: "เจ้าของ",
    description: "สรุปผลหลังส่งบิลทั้งหอ",
    headline: "สร้างบิล 15 ใบ รวม 71,480 บาท · ส่ง LINE แล้ว 14 (A107 ยังไม่เชื่อม)",
    rows: [],
    variables: ["{bill_count}", "{grand_total}", "{sent_count}", "{pending_rooms}"],
  },
  {
    id: "link",
    label: "เชื่อม LINE สำเร็จ",
    audience: "เจ้าของ",
    description: "ยืนยันเมื่อผู้เช่าพิมพ์เลขห้องแล้วจับคู่สำเร็จ",
    headline: "เชื่อม LINE กับ คุณธนา เจริญกิจ ห้อง A103 สำเร็จ",
    rows: [],
    variables: ["{tenant}", "{room}"],
  },
];

export const occupiedRooms = rooms.filter((room) => room.occupied);
export const vacantRooms = rooms.filter((room) => !room.occupied);
export const currentTenants = tenants.filter((tenant) => tenant.status === "current");
export const movedOutTenants = tenants.filter((tenant) => tenant.status === "moved-out");
export const pendingReviewCount = reviewQueue.length;
