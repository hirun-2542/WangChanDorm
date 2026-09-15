export type ElectricMode = "meter" | "flat";

const buddhistYearOffset = 543;

const thaiMonths = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];

const thaiMonthsShort = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

export interface InvoiceCharge {
  name: string;
  amount: number;
}

export interface InvoiceAmountSource {
  rent: number;
  waterUnits: number;
  waterRate: number;
  waterAmount: number;
  electricMode: ElectricMode;
  electricUnits: number | null;
  electricRate: number | null;
  electricAmount: number;
  charges: InvoiceCharge[];
}

export interface InvoiceBill extends InvoiceAmountSource {
  roomNumber: string;
  tenantName: string;
  period: string;
  waterPrevious: number;
  waterCurrent: number;
  electricPrevious: number;
  electricCurrent: number;
  total: number;
  createdAt: string;
}

export interface InvoiceRow {
  label: string;
  detail: string;
  amount: number;
}

export interface InvoiceDocument {
  number: string;
  issueDate: string;
  periodLabel: string;
  roomNumber: string;
  tenantName: string;
  waterMeter: string;
  electricMeter: string;
  rows: InvoiceRow[];
  total: number;
}

export function formatBaht(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export function formatUnits(value: number): string {
  return String(Math.round(value * 100) / 100);
}

export function invoiceNumber(period: string, roomNumber: string): string {
  const [yearPart, monthPart] = period.split("-");
  const year = Number(yearPart);

  if (!Number.isInteger(year) || monthPart === undefined) {
    return `${period}-${roomNumber}`;
  }

  return `B${year + buddhistYearOffset}-${monthPart}-${roomNumber}`;
}

export function thaiPeriodLabel(period: string): string {
  const [yearPart, monthPart] = period.split("-");
  const year = Number(yearPart);
  const month = Number(monthPart);
  const monthName = thaiMonths[month - 1];

  if (!Number.isInteger(year) || monthName === undefined) {
    return period;
  }

  return `${monthName} ${year + buddhistYearOffset}`;
}

export function thaiDateLabel(value: string): string {
  const [datePart = ""] = value.split(/[T ]/);
  const [yearPart, monthPart, dayPart] = datePart.split("-");
  const year = Number(yearPart);
  const month = Number(monthPart);
  const day = Number(dayPart);
  const monthName = thaiMonthsShort[month - 1];

  if (!Number.isInteger(year) || !Number.isInteger(day) || monthName === undefined) {
    return value;
  }

  return `${day} ${monthName} ${year + buddhistYearOffset}`;
}

function waterRow(bill: InvoiceAmountSource): InvoiceRow {
  return {
    label: "ค่าน้ำ",
    detail: `${formatUnits(bill.waterUnits)} หน่วย × ${formatUnits(bill.waterRate)} บาท/หน่วย`,
    amount: bill.waterAmount,
  };
}

function electricRow(bill: InvoiceAmountSource): InvoiceRow {
  if (bill.electricMode === "flat") {
    return { label: "ค่าไฟ", detail: `เหมาจ่าย ${formatBaht(bill.electricAmount)} บาท`, amount: bill.electricAmount };
  }

  return {
    label: "ค่าไฟ",
    detail: `${formatUnits(bill.electricUnits ?? 0)} หน่วย × ${formatUnits(bill.electricRate ?? 0)} บาท/หน่วย`,
    amount: bill.electricAmount,
  };
}

export function buildInvoiceRows(bill: InvoiceAmountSource): InvoiceRow[] {
  const rows: InvoiceRow[] = [
    { label: "ค่าเช่าห้อง", detail: "รายเดือน", amount: bill.rent },
    waterRow(bill),
    electricRow(bill),
  ];

  for (const charge of bill.charges) {
    rows.push({ label: charge.name, detail: "ค่าใช้จ่ายเพิ่มเติม", amount: charge.amount });
  }

  return rows;
}

export function buildInvoiceDocument(bill: InvoiceBill): InvoiceDocument {
  return {
    number: invoiceNumber(bill.period, bill.roomNumber),
    issueDate: thaiDateLabel(bill.createdAt),
    periodLabel: thaiPeriodLabel(bill.period),
    roomNumber: bill.roomNumber,
    tenantName: bill.tenantName,
    waterMeter: `${formatUnits(bill.waterPrevious)} → ${formatUnits(bill.waterCurrent)}`,
    electricMeter: `${formatUnits(bill.electricPrevious)} → ${formatUnits(bill.electricCurrent)}`,
    rows: buildInvoiceRows(bill),
    total: bill.total,
  };
}
