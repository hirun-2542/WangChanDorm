import { useEffect, useId, useMemo, useRef, type ReactNode } from "react";
import {
  bills as pinnedBills,
  currentTenants,
  dorm,
  monthSummaries,
  occupiedRooms,
  type Bill,
  type ElectricMode,
  type ExtraCharge,
  type Room,
  type Tenant,
} from "../mock-data";
import { Badge, IconButton } from "../ui";

export const periods = ["กันยายน 2569", "สิงหาคม 2569", "กรกฎาคม 2569"] as const;

const thaiMonthsShort = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

export function baht(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export function nowLabel(): string {
  const now = new Date();
  const month = thaiMonthsShort[now.getMonth()] ?? "";
  const year = String((now.getFullYear() + 543) % 100).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  return `${now.getDate()} ${month} ${year} · ${hours}:${minutes}`;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export const tenantById = new Map<string, Tenant>(currentTenants.map((tenant) => [tenant.id, tenant]));
export const tenantByRoom = new Map<string, Tenant>(currentTenants.map((tenant) => [tenant.roomId, tenant]));
export const roomById = new Map<string, Room>(occupiedRooms.map((room) => [room.id, room]));

export function monthCode(periodLabel: string): string {
  if (periodLabel === "สิงหาคม 2569") {
    return "08";
  }

  if (periodLabel === "กรกฎาคม 2569") {
    return "07";
  }

  return "09";
}

function historyBills(): Bill[] {
  const out: Bill[] = [];
  const labels = ["สิงหาคม 2569", "กรกฎาคม 2569"];

  for (const month of labels) {
    const summary = monthSummaries.find((item) => item.month === month);
    const unpaidRooms = summary?.unpaidRoomIds ?? [];
    const monthShort = month === "สิงหาคม 2569" ? "ส.ค." : "ก.ค.";

    occupiedRooms.forEach((room, index) => {
      const tenant = tenantByRoom.get(room.id);

      if (tenant === undefined) {
        return;
      }

      const waterUnits = 14 + ((index * 5) % 24);
      const waterPrevious = room.previousWater - waterUnits;
      const waterCurrent = room.previousWater;
      const waterAmount = waterUnits * room.waterRate;
      const isFlat = room.electricMode === "flat";
      const electricUnits = isFlat ? null : 45 + ((index * 9) % 85);
      const electricPrevious = isFlat || electricUnits === null ? null : room.previousElectric - electricUnits;
      const electricCurrent = isFlat ? null : room.previousElectric;
      const electricAmount = isFlat ? room.flatElectricAmount : (electricUnits ?? 0) * room.electricRate;
      const minutes = String(10 + (index % 45)).padStart(2, "0");

      out.push({
        id: `${room.id}-2569-${monthCode(month)}`,
        period: month,
        roomId: room.id,
        tenantId: tenant.id,
        tenantName: tenant.name,
        rent: room.rent,
        waterRate: room.waterRate,
        waterPrevious,
        waterCurrent,
        waterUnits,
        waterAmount,
        electricMode: room.electricMode,
        electricRate: room.electricRate,
        electricPrevious,
        electricCurrent,
        electricUnits,
        electricAmount,
        extraCharges: [],
        total: room.rent + waterAmount + electricAmount,
        status: unpaidRooms.includes(room.id) ? "unpaid" : "paid",
        lineSentAt: tenant.lineLinked ? `5 ${monthShort} 68 · 09:${minutes}` : null,
      });
    });
  }

  return out;
}

export const seedBills: Bill[] = [...pinnedBills, ...historyBills()];

export type LineState = "sent" | "unsent" | "blocked";

export function lineStateOf(bill: Bill): LineState {
  const tenant = tenantById.get(bill.tenantId);

  if (tenant === undefined || !tenant.lineLinked) {
    return "blocked";
  }

  return bill.lineSentAt === null ? "unsent" : "sent";
}

export function LineStateBadge({ bill }: { bill: Bill }) {
  const state = lineStateOf(bill);

  if (state === "blocked") {
    return (
      <Badge tone="review" icon="error">
        ยังไม่เชื่อม LINE
      </Badge>
    );
  }

  if (state === "unsent") {
    return (
      <Badge tone="neutral" icon="schedule">
        ยังไม่ส่ง
      </Badge>
    );
  }

  return (
    <Badge tone="paid" icon="check_circle">
      ส่งแล้ว
    </Badge>
  );
}

export interface PaymentRecord {
  method: "โอน" | "เงินสด";
  when: string;
  note: string;
  hasSlip: boolean;
}

export function seedPayments(all: Bill[]): Record<string, PaymentRecord[]> {
  const out: Record<string, PaymentRecord[]> = {};

  for (const bill of all) {
    if (bill.status !== "paid" || bill.lineSentAt === null) {
      continue;
    }

    const datePart = bill.lineSentAt.split(" · ")[0] ?? bill.lineSentAt;
    out[bill.id] = [
      {
        method: "โอน",
        when: `${datePart} · 11:30`,
        note: "ปิดบิลอัตโนมัติเมื่อสลิปยอดตรง",
        hasSlip: true,
      },
    ];
  }

  return out;
}

export interface InvoiceData {
  roomId: string;
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
  electricRate: number;
  electricAmount: number;
  extraCharges: ExtraCharge[];
  total: number;
}

export function toInvoice(bill: Bill): InvoiceData {
  return {
    roomId: bill.roomId,
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
    extraCharges: bill.extraCharges,
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

  return `${data.electricPrevious} → ${data.electricCurrent} · ${data.electricUnits} หน่วย × ${data.electricRate}`;
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

export function InvoicePreview({ data }: { data: InvoiceData }) {
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-charcoal">{dorm.name}</p>
          <p className="mt-0.5 text-xs text-fog">ใบแจ้งหนี้ค่าที่พัก</p>
        </div>
        <span className="chip">ห้อง {data.roomId}</span>
      </div>

      <p className="mt-3 text-xs text-fog">ประจำเดือน</p>
      <p className="text-sm text-charcoal">{data.period}</p>

      <dl className="mt-3 grid gap-2.5 border-t border-ash pt-3 text-sm">
        <div className="flex items-start justify-between gap-3">
          <dt className="text-steel">ผู้เช่า</dt>
          <dd className="text-charcoal">{data.tenantName}</dd>
        </div>
        <Line label="ค่าเช่าห้อง" detail="รายเดือน" value={data.rent} />
        <Line label="ค่าน้ำ" detail={waterLine(data)} value={data.waterAmount} />
        <Line label="ค่าไฟ" detail={electricLine(data)} value={data.electricAmount} />
        {data.extraCharges.map((charge) => (
          <Line key={charge.label} label={charge.label} detail="ค่าใช้จ่ายเพิ่มเติม" value={charge.amount} />
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
