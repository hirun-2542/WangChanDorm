import { useEffect, useId, useMemo, useRef, type ReactNode } from "react";
import { type Bill, type BillCharge, type ElectricMode } from "../api";
import { Badge, IconButton } from "../ui";

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

const buddhistYearOffset = 543;

export const monthCount = 3;

export function baht(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export function chargesTotal(charges: BillCharge[]): number {
  return charges.reduce((sum, charge) => sum + charge.amount, 0);
}

export function periodLabel(period: string): string {
  const [yearPart, monthPart] = period.split("-");
  const year = Number(yearPart);
  const month = Number(monthPart);
  const monthName = thaiMonths[month - 1];

  if (!Number.isInteger(year) || !Number.isInteger(month) || monthName === undefined) {
    return period;
  }

  return `${monthName} ${year + buddhistYearOffset}`;
}

export function periodCode(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function periodAt(monthOffset: number): string {
  const now = new Date();
  return periodCode(new Date(now.getFullYear(), now.getMonth() + monthOffset, 1));
}

export function recentPeriods(count: number): string[] {
  const list: string[] = [];

  for (let index = 0; index < count; index += 1) {
    list.push(periodAt(-index));
  }

  return list;
}

export function stampLabel(value: string): string {
  const [datePart = "", timePart = ""] = value.split(/[T ]/);
  const [yearPart, monthPart, dayPart] = datePart.split("-");
  const year = Number(yearPart);
  const month = Number(monthPart);
  const day = Number(dayPart);
  const monthName = thaiMonthsShort[month - 1];

  if (!Number.isInteger(year) || !Number.isInteger(day) || monthName === undefined) {
    return value;
  }

  const stamp = `${day} ${monthName} ${String((year + buddhistYearOffset) % 100).padStart(2, "0")}`;
  const time = timePart.slice(0, 5);

  return time === "" ? stamp : `${stamp} · ${time}`;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function dateLabel(value: string): string {
  const [datePart = ""] = value.split(/[T ]/);
  const [yearPart, monthPart, dayPart] = datePart.split("-");
  const year = Number(yearPart);
  const month = Number(monthPart);
  const day = Number(dayPart);
  const monthName = thaiMonthsShort[month - 1];

  if (!Number.isInteger(year) || !Number.isInteger(day) || monthName === undefined) {
    return value;
  }

  return `${day} ${monthName} ${String((year + buddhistYearOffset) % 100).padStart(2, "0")}`;
}

export function billNumber(bill: { period: string; roomNumber: string }): string {
  const [yearPart, monthPart] = bill.period.split("-");
  const year = Number(yearPart);

  if (!Number.isInteger(year) || monthPart === undefined) {
    return `${bill.period}-${bill.roomNumber}`;
  }

  return `B${year + buddhistYearOffset}-${monthPart}-${bill.roomNumber}`;
}

export function paidMethodLabel(method: string | null): string {
  if (method === "transfer") {
    return "โอน";
  }

  if (method === "cash") {
    return "เงินสด";
  }

  return "ไม่ระบุ";
}

export type LineState = "sent" | "unsent" | "blocked";

export function lineStateOf(sentAt: string | null, connected: boolean | null): LineState {
  if (sentAt !== null) {
    return "sent";
  }

  return connected === false ? "blocked" : "unsent";
}

export function LineStateBadge({ sentAt, connected }: { sentAt: string | null; connected: boolean | null }) {
  const state = lineStateOf(sentAt, connected);

  return (
    <span className="flex flex-wrap items-center gap-1">
      {state === "sent" ? (
        <Badge tone="paid" icon="check_circle">
          ส่งแล้ว
        </Badge>
      ) : (
        <Badge tone="neutral" icon="schedule">
          ยังไม่ส่ง
        </Badge>
      )}
      {state === "blocked" && (
        <Badge tone="review" icon="error">
          ยังไม่เชื่อม LINE
        </Badge>
      )}
    </span>
  );
}

export interface PaymentRecord {
  method: string;
  when: string;
  note: string;
}

export interface InvoiceData {
  roomNumber: string;
  tenantName: string;
  period: string;
  rent: number;
  waterPrevious: number;
  waterCurrent: number | null;
  waterUnits: number | null;
  waterRate: number;
  waterAmount: number;
  electricMode: ElectricMode;
  electricPrevious: number | null;
  electricCurrent: number | null;
  electricUnits: number | null;
  electricRate: number | null;
  electricAmount: number;
  charges: BillCharge[];
  total: number;
}

export function toInvoice(bill: Bill): InvoiceData {
  return {
    roomNumber: bill.roomNumber,
    tenantName: bill.tenantName,
    period: bill.period,
    rent: bill.rent,
    waterPrevious: bill.waterPrevious,
    waterCurrent: bill.waterCurrent,
    waterUnits: bill.waterUnits,
    waterRate: bill.waterRate,
    waterAmount: bill.waterAmount,
    electricMode: bill.electricMode,
    electricPrevious: bill.electricPrevious,
    electricCurrent: bill.electricCurrent,
    electricUnits: bill.electricUnits,
    electricRate: bill.electricRate,
    electricAmount: bill.electricAmount,
    charges: bill.charges,
    total: bill.total,
  };
}

function waterLine(data: InvoiceData): string {
  if (data.waterCurrent === null || data.waterUnits === null) {
    return "ยังไม่กรอกมิเตอร์";
  }

  return `${data.waterPrevious} → ${data.waterCurrent} · ${data.waterUnits} หน่วย × ${data.waterRate}`;
}

function electricLine(data: InvoiceData): string {
  if (data.electricMode === "flat") {
    return "เหมาจ่ายรายเดือน";
  }

  if (data.electricCurrent === null || data.electricUnits === null || data.electricPrevious === null) {
    return "ยังไม่กรอกมิเตอร์";
  }

  return `${data.electricPrevious} → ${data.electricCurrent} · ${data.electricUnits} หน่วย × ${data.electricRate ?? 0}`;
}

function qrCell(x: number, y: number, size: number): boolean {
  const finderValue = (originX: number, originY: number) => {
    const localX = x - originX;
    const localY = y - originY;
    const edge = localX === 0 || localY === 0 || localX === 6 || localY === 6;
    const core = localX >= 2 && localX <= 4 && localY >= 2 && localY <= 4;
    return edge || core;
  };

  if (x < 7 && y < 7) {
    return finderValue(0, 0);
  }

  if (x >= size - 7 && y < 7) {
    return finderValue(size - 7, 0);
  }

  if (x < 7 && y >= size - 7) {
    return finderValue(0, size - 7);
  }

  return (x * 3 + y * 5 + ((x * y) % 7)) % 11 < 5;
}

function qrPath(size: number): string {
  let path = "";

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (qrCell(x, y, size)) {
        path += `M${x} ${y}h1v1h-1z`;
      }
    }
  }

  return path;
}

export function QrBlock({ amount }: { amount: number }) {
  const path = useMemo(() => qrPath(21), []);

  return (
    <div className="rounded-xl border border-ash p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-fog">พร้อมเพย์ · PromptPay</span>
        <Badge tone="neutral">ตัวอย่าง</Badge>
      </div>
      <div className="mx-auto mt-2 w-36 text-charcoal" aria-hidden="true">
        <svg viewBox="-2 -2 25 25" width="100%" role="presentation">
          <path d={path} fill="currentColor" shapeRendering="crispEdges" />
        </svg>
      </div>
      <p className="num mt-2 text-center text-sm text-charcoal">{baht(amount)} บาท</p>
      <p className="mt-0.5 text-center text-[11px] text-fog">ตัวอย่างรหัสสำหรับพรีวิว ไม่ใช่รหัสที่ใช้สแกนจ่ายจริง</p>
    </div>
  );
}

function Line({ label, detail, value }: { label: string; detail: string; value: number }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-steel">
        {label}
        <span className="mt-0.5 block text-[11px] text-fog">{detail}</span>
      </dt>
      <dd className="num text-charcoal">{baht(value)}</dd>
    </div>
  );
}

export interface InvoiceMeta {
  ownerName: string | null;
  promptpayId: string | null;
  number: string;
  issueDate: string;
}

function meterWaterNote(data: InvoiceData): string {
  if (data.waterUnits === null) {
    return "ยังไม่กรอกมิเตอร์";
  }

  return `${data.waterUnits} หน่วย × ${data.waterRate} บาท/หน่วย`;
}

function meterElectricNote(data: InvoiceData): string {
  if (data.electricMode === "flat") {
    return `เหมาจ่าย ${baht(data.electricAmount)} บาท`;
  }

  if (data.electricUnits === null) {
    return "ยังไม่กรอกมิเตอร์";
  }

  return `${data.electricUnits} หน่วย × ${data.electricRate ?? 0} บาท/หน่วย`;
}

function MeterPanel({ data }: { data: InvoiceData }) {
  return (
    <div className="rounded-xl border border-ash p-3">
      <h3 className="text-xs text-fog">มิเตอร์รอบนี้</h3>
      <dl className="mt-2 grid gap-3 text-sm">
        <div>
          <dt className="text-steel">น้ำ</dt>
          <dd className="num mt-0.5 text-charcoal">
            {data.waterPrevious} → {data.waterCurrent ?? "—"}
          </dd>
          <dd className="mt-0.5 text-[11px] text-fog">{meterWaterNote(data)}</dd>
        </div>
        <div>
          <dt className="text-steel">ไฟ</dt>
          <dd className="num mt-0.5 text-charcoal">
            {data.electricPrevious ?? "—"} → {data.electricCurrent ?? "—"}
          </dd>
          <dd className="mt-0.5 text-[11px] text-fog">{meterElectricNote(data)}</dd>
          {data.electricMode === "flat" && <span className="chip mt-1.5">ไฟเหมา</span>}
        </div>
      </dl>
    </div>
  );
}

function ItemRow({ label, detail, value }: { label: string; detail: string; value: number }) {
  return (
    <tr className="border-t border-ash">
      <td className="px-3 py-2 align-top">
        <span className="block text-charcoal">{label}</span>
        <span className="mt-0.5 block text-[11px] text-fog">{detail}</span>
      </td>
      <td className="num px-3 py-2 text-right align-top text-charcoal">{baht(value)}</td>
    </tr>
  );
}

function FullInvoice({ data, dormName, meta }: { data: InvoiceData; dormName: string | null; meta: InvoiceMeta }) {
  const hasOwner = meta.ownerName !== null && meta.ownerName !== "";
  const hasPromptpay = meta.promptpayId !== null && meta.promptpayId !== "";

  return (
    <div className="card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {dormName !== null && dormName !== "" ? (
            <>
              <p className="truncate text-lg font-semibold text-charcoal">{dormName}</p>
              <p className="mt-0.5 text-xs text-fog">ใบแจ้งหนี้ค่าที่พัก</p>
            </>
          ) : (
            <p className="text-lg font-semibold text-charcoal">ใบแจ้งหนี้ค่าที่พัก</p>
          )}
          {hasOwner && <p className="mt-1 text-sm text-steel">เจ้าของหอ: {meta.ownerName}</p>}
          {hasPromptpay && <p className="num mt-0.5 text-sm text-steel">พร้อมเพย์: {meta.promptpayId}</p>}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs text-fog">เลขที่บิล</p>
          <p className="num text-sm text-charcoal">{meta.number}</p>
          <p className="mt-1.5 text-xs text-fog">วันที่ออก</p>
          <p className="num text-sm text-charcoal">{meta.issueDate}</p>
        </div>
      </div>

      <dl className="mt-3 grid gap-2.5 border-t border-ash pt-3 text-sm">
        <div className="flex items-start justify-between gap-3">
          <dt className="text-steel">รอบบิล</dt>
          <dd className="text-charcoal">{periodLabel(data.period)}</dd>
        </div>
        <div className="flex items-start justify-between gap-3">
          <dt className="text-steel">ห้อง / ผู้เช่า</dt>
          <dd className="text-charcoal">
            {data.roomNumber} · {data.tenantName}
          </dd>
        </div>
      </dl>

      <div className="mt-4 grid items-start gap-4 md:grid-cols-[minmax(0,190px)_minmax(0,1fr)]">
        <MeterPanel data={data} />

        <div className="overflow-hidden rounded-xl border border-ash">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-fog">
                <th scope="col" className="px-3 py-2 font-normal">
                  รายการ
                </th>
                <th scope="col" className="px-3 py-2 text-right font-normal">
                  จำนวนเงิน (บาท)
                </th>
              </tr>
            </thead>
            <tbody>
              <ItemRow label="ค่าเช่าห้อง" detail="รายเดือน" value={data.rent} />
              <ItemRow label="ค่าน้ำ" detail={waterLine(data)} value={data.waterAmount} />
              <ItemRow label="ค่าไฟ" detail={electricLine(data)} value={data.electricAmount} />
              {data.charges.map((charge, index) => (
                <ItemRow
                  key={`${charge.name}-${index}`}
                  label={charge.name}
                  detail="ค่าใช้จ่ายเพิ่มเติม"
                  value={charge.amount}
                />
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-[3px] border-double border-charcoal">
                <td className="px-3 py-2 font-medium text-charcoal">ยอดรวมทั้งสิ้น</td>
                <td className="num px-3 py-2 text-right text-base text-charcoal">{baht(data.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="mt-3">
        <QrBlock amount={data.total} />
      </div>
    </div>
  );
}

function CompactInvoice({ data, dormName }: { data: InvoiceData; dormName: string | null }) {
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {dormName !== null && dormName !== "" && <p className="truncate text-sm font-semibold text-charcoal">{dormName}</p>}
          <p className="mt-0.5 text-xs text-fog">ใบแจ้งหนี้ค่าที่พัก</p>
        </div>
        <span className="chip">ห้อง {data.roomNumber}</span>
      </div>

      <p className="mt-3 text-xs text-fog">ประจำเดือน</p>
      <p className="text-sm text-charcoal">{periodLabel(data.period)}</p>

      <dl className="mt-3 grid gap-2.5 border-t border-ash pt-3 text-sm">
        <div className="flex items-start justify-between gap-3">
          <dt className="text-steel">ผู้เช่า</dt>
          <dd className="text-charcoal">{data.tenantName}</dd>
        </div>
        <Line label="ค่าเช่าห้อง" detail="รายเดือน" value={data.rent} />
        <Line label="ค่าน้ำ" detail={waterLine(data)} value={data.waterAmount} />
        <Line label="ค่าไฟ" detail={electricLine(data)} value={data.electricAmount} />
        {data.charges.map((charge, index) => (
          <Line key={`${charge.name}-${index}`} label={charge.name} detail="ค่าใช้จ่ายเพิ่มเติม" value={charge.amount} />
        ))}
      </dl>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-ash pt-3">
        <span className="text-sm font-medium text-charcoal">ยอดรวมทั้งสิ้น</span>
        <span className="num text-lg text-charcoal">{baht(data.total)} บาท</span>
      </div>

      <div className="mt-3">
        <QrBlock amount={data.total} />
      </div>
    </div>
  );
}

export function InvoicePreview({
  data,
  dormName,
  meta,
}: {
  data: InvoiceData;
  dormName: string | null;
  meta?: InvoiceMeta;
}) {
  if (meta === undefined) {
    return <CompactInvoice data={data} dormName={dormName} />;
  }

  return <FullInvoice data={data} dormName={dormName} meta={meta} />;
}

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function Sheet({ open, onClose, title, children }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const node = ref.current;

    if (node === null) {
      return;
    }

    if (open && !node.open) {
      node.showModal();
    } else if (!open && node.open) {
      node.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) {
          onClose();
        }
      }}
    >
      <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-smoke" aria-hidden="true" />
      <div className="flex items-start justify-between gap-4 px-5 pt-3">
        <h2 id={titleId} className="text-base text-charcoal">
          {title}
        </h2>
        <IconButton icon="close" label="ปิด" onClick={onClose} />
      </div>
      <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
    </dialog>
  );
}
