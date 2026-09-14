import { useState } from "react";
import {
  dorm,
  occupiedRooms,
  type Bill,
  type Room,
  type Tenant,
} from "../mock-data";
import { Badge, Button, Card, DataTable, Dialog, Field, PageHeader, Select, type DataTableColumn } from "../ui";
import {
  InvoicePreview,
  Sheet,
  baht,
  monthCode,
  periods,
  tenantById,
  tenantByRoom,
  type InvoiceData,
} from "./bills-shared";

export interface CreateWizardProps {
  onCreated: (bills: Bill[]) => void;
  onSent: (billIds: string[]) => void;
  onFinish: () => void;
  showToast: (message: string) => void;
}

interface MeterRow {
  room: Room;
  tenant: Tenant;
  selected: boolean;
  waterCurrent: string;
  electricCurrent: string;
  flatAmount: string;
}

type RowStatus = "ready" | "empty" | "error";

interface RowCalc {
  isFlat: boolean;
  waterCurrent: number | null;
  waterUnits: number | null;
  waterAmount: number;
  waterInvalid: boolean;
  electricCurrent: number | null;
  electricUnits: number | null;
  electricAmount: number;
  electricInvalid: boolean;
  total: number;
  status: RowStatus;
}

interface Entry {
  row: MeterRow;
  calc: RowCalc;
}

function toNumber(value: string): number | null {
  if (value.trim() === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function computeRow(row: MeterRow): RowCalc {
  const isFlat = row.room.electricMode === "flat";
  const waterCurrent = toNumber(row.waterCurrent);
  const waterInvalid = waterCurrent !== null && (Number.isNaN(waterCurrent) || waterCurrent < row.room.previousWater);
  const waterUnits = waterCurrent !== null && !waterInvalid ? waterCurrent - row.room.previousWater : null;
  const waterAmount = waterUnits === null ? 0 : waterUnits * row.room.waterRate;

  const electricCurrent = toNumber(row.electricCurrent);
  const electricInvalid =
    electricCurrent !== null && (Number.isNaN(electricCurrent) || electricCurrent < row.room.previousElectric);
  const electricUnits = electricCurrent !== null && !electricInvalid ? electricCurrent - row.room.previousElectric : null;
  const flatAmount = toNumber(row.flatAmount);
  const electricAmount = isFlat
    ? flatAmount === null || Number.isNaN(flatAmount)
      ? 0
      : flatAmount
    : electricUnits === null
      ? 0
      : electricUnits * row.room.electricRate;

  const filled = waterCurrent !== null && electricCurrent !== null;
  const status: RowStatus = waterInvalid || electricInvalid ? "error" : filled ? "ready" : "empty";

  return {
    isFlat,
    waterCurrent: waterCurrent !== null && Number.isNaN(waterCurrent) ? null : waterCurrent,
    waterUnits,
    waterAmount,
    waterInvalid,
    electricCurrent: electricCurrent !== null && Number.isNaN(electricCurrent) ? null : electricCurrent,
    electricUnits,
    electricAmount,
    electricInvalid,
    total: row.room.rent + waterAmount + electricAmount,
    status,
  };
}

function MeterStatus({ status }: { status: RowStatus }) {
  if (status === "ready") {
    return (
      <Badge tone="paid" icon="check_circle">
        พร้อมสร้าง
      </Badge>
    );
  }

  if (status === "error") {
    return (
      <Badge tone="danger" icon="error">
        มิเตอร์ย้อนหลัง
      </Badge>
    );
  }

  return (
    <Badge tone="neutral" icon="schedule">
      ยังไม่กรอก
    </Badge>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" }) {
  const valueClass = tone === "good" ? "text-status-paid-fg" : tone === "warn" ? "text-status-review-fg" : "text-charcoal";

  return (
    <Card>
      <p className="text-xs text-fog">{label}</p>
      <p className={`num mt-1 text-lg ${valueClass}`}>{value}</p>
    </Card>
  );
}

function buildInitialRows(): MeterRow[] {
  const rows: MeterRow[] = [];

  occupiedRooms.forEach((room, index) => {
    const tenant = tenantByRoom.get(room.id);

    if (tenant === undefined) {
      return;
    }

    const skip = room.id === "A115" || room.id === "A116";

    rows.push({
      room,
      tenant,
      selected: true,
      waterCurrent: skip ? "" : String(room.previousWater + 15 + ((index * 3) % 18)),
      electricCurrent: skip ? "" : String(room.previousElectric + 40 + ((index * 7) % 60)),
      flatAmount: String(room.flatElectricAmount),
    });
  });

  return rows;
}

function buildBill(entry: Entry, period: string): Bill {
  const { row, calc } = entry;

  return {
    id: `${row.room.id}-2569-${monthCode(period)}`,
    period,
    roomId: row.room.id,
    tenantId: row.tenant.id,
    tenantName: row.tenant.name,
    rent: row.room.rent,
    waterRate: row.room.waterRate,
    waterPrevious: row.room.previousWater,
    waterCurrent: calc.waterCurrent ?? row.room.previousWater,
    waterUnits: calc.waterUnits ?? 0,
    waterAmount: calc.waterAmount,
    electricMode: row.room.electricMode,
    electricRate: row.room.electricRate,
    electricPrevious: row.room.previousElectric,
    electricCurrent: calc.electricCurrent,
    electricUnits: calc.electricUnits,
    electricAmount: calc.electricAmount,
    extraCharges: [],
    total: calc.total,
    status: "unpaid",
    lineSentAt: null,
  };
}

function toDraftInvoice(entry: Entry, period: string): InvoiceData {
  const { row, calc } = entry;

  return {
    roomId: row.room.id,
    tenantName: row.tenant.name,
    period,
    rent: row.room.rent,
    waterPrevious: row.room.previousWater,
    waterCurrent: calc.waterCurrent,
    waterUnits: calc.waterUnits,
    waterRate: row.room.waterRate,
    waterAmount: calc.waterAmount,
    electricMode: row.room.electricMode,
    electricPrevious: row.room.previousElectric,
    electricCurrent: calc.electricCurrent,
    electricUnits: calc.electricUnits,
    electricRate: row.room.electricRate,
    electricAmount: calc.electricAmount,
    extraCharges: [],
    total: calc.total,
  };
}

function Stepper({ current }: { current: number }) {
  const steps = [
    { number: 1, title: "กรอกข้อมูลมิเตอร์", sub: "กรอกเลขปัจจุบัน" },
    { number: 2, title: "ตรวจสอบและยืนยัน", sub: "ตรวจยอดก่อนสร้าง" },
    { number: 3, title: "ส่งบิล", sub: "ส่งผ่าน LINE" },
  ];

  return (
    <ol className="card mb-4 grid gap-3 sm:grid-cols-3" aria-label="ขั้นตอนการสร้างบิล">
      {steps.map((step) => {
        const done = step.number < current;
        const active = step.number === current;
        const dotClass = done
          ? "bg-status-paid-bg text-status-paid-fg"
          : active
            ? "bg-midnight-ink text-canvas-white"
            : "bg-paper-mist text-fog";

        return (
          <li key={step.number} className="flex items-center gap-3" aria-current={active ? "step" : undefined}>
            <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm ${dotClass}`}>
              {done ? (
                <span className="ms text-[18px]" aria-hidden="true">
                  check
                </span>
              ) : (
                <span className="num" aria-hidden="true">
                  {step.number}
                </span>
              )}
            </span>
            <span className="min-w-0">
              <span className={`block truncate text-sm ${active ? "text-charcoal" : "text-steel"}`}>{step.title}</span>
              <span className="block truncate text-[11px] text-fog">{step.sub}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function CreateWizard({ onCreated, onSent, onFinish, showToast }: CreateWizardProps) {
  const [step, setStep] = useState(1);
  const [period, setPeriod] = useState<string>(periods[0]);
  const [rows, setRows] = useState<MeterRow[]>(() => buildInitialRows());
  const [activeRoomId, setActiveRoomId] = useState<string>(() => occupiedRooms[0]?.id ?? "A101");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDocked, setPreviewDocked] = useState<boolean>(() => window.matchMedia("(min-width: 1536px)").matches);
  const [createdBills, setCreatedBills] = useState<Bill[]>([]);
  const [sendPhase, setSendPhase] = useState<"idle" | "sending" | "done">("idle");
  const [sentIds, setSentIds] = useState<string[]>([]);
  const [failedIds, setFailedIds] = useState<string[]>([]);
  const [confirmSendOpen, setConfirmSendOpen] = useState(false);

  const updateRow = (roomId: string, patch: Partial<Pick<MeterRow, "selected" | "waterCurrent" | "electricCurrent" | "flatAmount">>) => {
    setRows((prev) => prev.map((row) => (row.room.id === roomId ? { ...row, ...patch } : row)));
  };

  const entries: Entry[] = rows.map((row) => ({ row, calc: computeRow(row) }));
  const ready = entries.filter((entry) => entry.calc.status === "ready");
  const emptyCount = entries.filter((entry) => entry.calc.status === "empty").length;
  const errorCount = entries.filter((entry) => entry.calc.status === "error").length;
  const selectedEntries = entries.filter((entry) => entry.row.selected);
  const selectedReady = selectedEntries.filter((entry) => entry.calc.status === "ready");
  const blocked = selectedEntries.some((entry) => entry.calc.status === "error");
  const estimate = ready.reduce((sum, entry) => sum + entry.calc.total, 0);

  const rentTotal = selectedReady.reduce((sum, entry) => sum + entry.row.room.rent, 0);
  const waterTotal = selectedReady.reduce((sum, entry) => sum + entry.calc.waterAmount, 0);
  const electricTotal = selectedReady.reduce((sum, entry) => sum + entry.calc.electricAmount, 0);
  const grandTotal = rentTotal + waterTotal + electricTotal;

  const query = search.trim().toLowerCase();
  const visibleEntries = entries.filter((entry) => {
    const matchesQuery =
      query === "" || entry.row.room.id.toLowerCase().includes(query) || entry.row.tenant.name.toLowerCase().includes(query);
    const matchesStatus = statusFilter === "all" || entry.calc.status === statusFilter;
    return matchesQuery && matchesStatus;
  });

  const activeEntry = entries.find((entry) => entry.row.room.id === activeRoomId) ?? entries[0];
  const nextDisabled = blocked || selectedReady.length === 0;

  const meterCell = (entry: Entry, kind: "water" | "electric") => {
    const invalid = kind === "water" ? entry.calc.waterInvalid : entry.calc.electricInvalid;
    const value = kind === "water" ? entry.row.waterCurrent : entry.row.electricCurrent;
    const previous = kind === "water" ? entry.row.room.previousWater : entry.row.room.previousElectric;

    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center justify-end gap-1">
          <span className="num text-xs text-fog">{previous}</span>
          <span className="text-xs text-silver" aria-hidden="true">
            →
          </span>
          <input
            type="text"
            inputMode="numeric"
            className={`input-inline w-14${invalid ? " border-danger" : ""}`}
            value={value}
            aria-label={`มิเตอร์${kind === "water" ? "น้ำ" : "ไฟ"}ครั้งนี้ ห้อง ${entry.row.room.id}`}
            aria-invalid={invalid}
            aria-describedby={invalid ? `${entry.row.room.id}-${kind}-error` : undefined}
            onChange={(event) => {
              setActiveRoomId(entry.row.room.id);
              updateRow(entry.row.room.id, kind === "water" ? { waterCurrent: event.target.value } : { electricCurrent: event.target.value });
            }}
            onFocus={() => {
              setActiveRoomId(entry.row.room.id);
            }}
          />
        </div>
        {invalid && (
          <span id={`${entry.row.room.id}-${kind}-error`} className="flex items-center gap-1 text-[11px] text-danger">
            <span className="ms text-[14px]" aria-hidden="true">
              error
            </span>
            {`น้อยกว่าครั้งก่อน ${previous}`}
          </span>
        )}
      </div>
    );
  };

  const unitsLine = (units: number | null) => (units === null ? "—" : `${units} หน่วย`);

  const amountCell = (entry: Entry, kind: "water" | "electric") => {
    if (kind === "electric" && entry.calc.isFlat) {
      return (
        <div className="flex flex-col items-end gap-1">
          <input
            type="text"
            inputMode="numeric"
            className="input-inline w-14"
            value={entry.row.flatAmount}
            aria-label={`ค่าไฟเหมาจ่าย ห้อง ${entry.row.room.id}`}
            onChange={(event) => {
              setActiveRoomId(entry.row.room.id);
              updateRow(entry.row.room.id, { flatAmount: event.target.value });
            }}
            onFocus={() => {
              setActiveRoomId(entry.row.room.id);
            }}
          />
          <span className="text-[11px] text-fog">เหมาจ่าย</span>
        </div>
      );
    }

    const amount = kind === "water" ? entry.calc.waterAmount : entry.calc.electricAmount;
    const units = kind === "water" ? entry.calc.waterUnits : entry.calc.electricUnits;

    return (
      <div className="flex flex-col items-end">
        <span>{baht(amount)}</span>
        <span className="text-[11px] text-fog">{unitsLine(units)}</span>
      </div>
    );
  };

  const columns: DataTableColumn<Entry>[] = [
    {
      key: "select",
      header: "",
      render: (entry) => (
        <input
          type="checkbox"
          className="h-5 w-5 accent-charcoal"
          checked={entry.row.selected}
          aria-label={`เลือกห้อง ${entry.row.room.id}`}
          onChange={(event) => {
            updateRow(entry.row.room.id, { selected: event.target.checked });
          }}
        />
      ),
    },
    {
      key: "room",
      header: "ห้อง",
      render: (entry) => (
        <div>
          <span className="font-medium text-charcoal">{entry.row.room.id}</span>
          {entry.row.room.waterRate !== dorm.waterRate && <span className="chip mt-1 block w-fit">อัตราพิเศษ</span>}
        </div>
      ),
    },
    { key: "tenant", header: "ผู้เช่า", render: (entry) => <span className="text-steel">{entry.row.tenant.name}</span> },
    { key: "rent", header: "ค่าเช่า", align: "right", render: (entry) => baht(entry.row.room.rent) },
    { key: "waterMeter", header: "น้ำ", align: "right", render: (entry) => meterCell(entry, "water") },
    { key: "waterAmount", header: "ค่าน้ำ", align: "right", render: (entry) => amountCell(entry, "water") },
    { key: "electricMeter", header: "ไฟ", align: "right", render: (entry) => meterCell(entry, "electric") },
    { key: "electricAmount", header: "ค่าไฟ", align: "right", render: (entry) => amountCell(entry, "electric") },
    { key: "total", header: "ยอดรวม", align: "right", render: (entry) => <span className="font-medium">{baht(entry.calc.total)}</span> },
    { key: "status", header: "สถานะ", render: (entry) => <MeterStatus status={entry.calc.status} /> },
  ];

  const connectedReady = selectedReady.filter((entry) => entry.row.tenant.lineLinked);
  const unconnectedReady = selectedReady.filter((entry) => !entry.row.tenant.lineLinked);
  const reviewTotal = selectedReady.reduce((sum, entry) => sum + entry.calc.total, 0);

  const connectedBills = createdBills.filter((bill) => tenantById.get(bill.tenantId)?.lineLinked === true);
  const totalCreated = createdBills.reduce((sum, bill) => sum + bill.total, 0);

  const copyMessage = (roomId: string) => {
    const text = unconnectedMessage(roomId);

    try {
      void navigator.clipboard.writeText(text).then(
        () => {
          showToast(`คัดลอกข้อความสำหรับห้อง ${roomId} แล้ว`);
        },
        () => {
          showToast("คัดลอกไม่สำเร็จ กรุณาคัดลอกด้วยตนเอง");
        },
      );
    } catch {
      showToast("คัดลอกไม่สำเร็จ กรุณาคัดลอกด้วยตนเอง");
    }
  };

  const runSend = (targets: Bill[], simulateFailure: boolean) => {
    if (targets.length === 0) {
      showToast("ไม่มีผู้เช่าที่เชื่อม LINE ให้ส่งในรอบนี้");
      return;
    }

    setSendPhase("sending");

    window.setTimeout(() => {
      const failing = simulateFailure ? targets[targets.length - 1] : undefined;
      const ok = targets.filter((bill) => bill !== failing);
      setSentIds((prev) => Array.from(new Set([...prev, ...ok.map((bill) => bill.id)])));
      setFailedIds(failing === undefined ? [] : [failing.id]);
      setSendPhase("done");
      onSent(ok.map((bill) => bill.id));
      showToast(failing === undefined ? `ส่งบิลทาง LINE สำเร็จ ${ok.length} รายการ` : `ส่งสำเร็จ ${ok.length} รายการ · ส่งไม่สำเร็จ 1 รายการ`);
    }, 1200);
  };

  const createBills = () => {
    const bills = selectedReady.map((entry) => buildBill(entry, period));
    setCreatedBills(bills);
    onCreated(bills);
    setStep(3);
  };

  return (
    <div>
      <PageHeader title="สร้างบิล" supporting="กรอกเลขมิเตอร์ ตรวจยอด แล้วสร้างบิลทั้งหอ" />
      <Stepper current={step} />

      {step === 1 && (
        <>
          <Card className="mb-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <label className="field-label mb-0" htmlFor="wizard-period">
                รอบบิล
              </label>
              <select
                id="wizard-period"
                className="input w-auto"
                value={period}
                onChange={(event) => {
                  setPeriod(event.target.value);
                }}
              >
                {periods.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <Badge tone="neutral" icon="pending_actions">
                ยังไม่สร้างบิล
              </Badge>
              <span className="ml-auto text-xs text-fog">สร้างเฉพาะห้องที่มีผู้เช่า</span>
            </div>
          </Card>

          <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Metric label="ห้องที่มีผู้เช่า" value={String(entries.length)} />
            <Metric label="กรอกครบ" value={String(ready.length)} tone="good" />
            <Metric label="ยังไม่กรอก" value={String(emptyCount)} tone="warn" />
            <Metric label="มีข้อผิดพลาด" value={String(errorCount)} tone={errorCount > 0 ? "warn" : undefined} />
            <Metric label="ประมาณการยอดรวม" value={baht(estimate)} />
          </div>

          <div
            className={
              previewDocked ? "items-start xl:grid xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-4" : "items-start"
            }
          >
            <div>
              <Card>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-full sm:w-60">
                    <Field label="ค้นหาห้องหรือผู้เช่า" value={search} onChange={setSearch} placeholder="เช่น A101 หรือ สมชาย" />
                  </div>
                  <div className="w-full sm:w-40">
                    <Select
                      label="สถานะ"
                      value={statusFilter}
                      onChange={setStatusFilter}
                      options={[
                        { value: "all", label: "ทั้งหมด" },
                        { value: "ready", label: "พร้อมสร้าง" },
                        { value: "empty", label: "ยังไม่กรอก" },
                        { value: "error", label: "ผิดพลาด" },
                      ]}
                    />
                  </div>
                  <div className="ml-auto xl:hidden">
                    <Button
                      variant="secondary"
                      icon="receipt_long"
                      onClick={() => {
                        setPreviewOpen(true);
                      }}
                    >
                      ดูตัวอย่างบิล
                    </Button>
                  </div>
                  <div className="ml-auto hidden xl:block">
                    <Button
                      variant="ghost"
                      icon={previewDocked ? "right_panel_close" : "right_panel_open"}
                      onClick={() => {
                        setPreviewDocked((prev) => !prev);
                      }}
                    >
                      {previewDocked ? "ซ่อนตัวอย่างบิล" : "แสดงตัวอย่างบิล"}
                    </Button>
                  </div>
                </div>
              </Card>

              <Card className="mt-4">
                <DataTable
                  columns={columns}
                  rows={visibleEntries}
                  getRowKey={(entry) => entry.row.room.id}
                  minWidth={780}
                  emptyMessage="ไม่พบห้องที่ตรงกับเงื่อนไข"
                />
              </Card>
            </div>

            {previewDocked && (
            <aside className="hidden xl:sticky xl:top-20 xl:block">
              <p className="mb-2 text-xs text-fog">
                พรีวิวบิลของห้อง {activeEntry === undefined ? "—" : activeEntry.row.room.id}
              </p>
              {activeEntry !== undefined && <InvoicePreview data={toDraftInvoice(activeEntry, period)} />}
            </aside>
            )}
          </div>

          <div className="sticky bottom-[calc(56px_+_env(safe-area-inset-bottom))] z-20 -mx-4 mt-4 border-t border-ash bg-canvas-white px-4 py-4 md:-mx-6 md:bottom-0 md:px-6">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <div>
                <p className="text-xs text-fog">เลือกไว้</p>
                <p className="num text-sm text-charcoal">
                  {selectedEntries.length} ห้อง · พร้อมสร้าง {selectedReady.length}
                </p>
              </div>
              <div>
                <p className="text-xs text-fog">ค่าเช่ารวม</p>
                <p className="num text-sm text-charcoal">{baht(rentTotal)}</p>
              </div>
              <div>
                <p className="text-xs text-fog">ค่าน้ำรวม</p>
                <p className="num text-sm text-charcoal">{baht(waterTotal)}</p>
              </div>
              <div>
                <p className="text-xs text-fog">ค่าไฟรวม</p>
                <p className="num text-sm text-charcoal">{baht(electricTotal)}</p>
              </div>
              <div>
                <p className="text-xs text-fog">ยอดรวม</p>
                <p className="num text-sm font-medium text-charcoal">{baht(grandTotal)}</p>
              </div>
              <div className="ml-auto flex flex-col items-end gap-1">
                <Button
                  variant="primary"
                  icon="arrow_forward"
                  disabled={nextDisabled}
                  onClick={() => {
                    setStep(2);
                  }}
                >
                  ตรวจสอบและยืนยัน
                </Button>
                <p className="text-[11px] text-fog">
                  {blocked
                    ? "แก้มิเตอร์ที่น้อยกว่าครั้งก่อนก่อนไปต่อ"
                    : selectedReady.length === 0
                      ? "เลือกและกรอกมิเตอร์อย่างน้อย 1 ห้อง"
                      : `จะสร้าง ${selectedReady.length} บิล`}
                </p>
              </div>
            </div>
          </div>

          <Sheet
            open={previewOpen}
            onClose={() => {
              setPreviewOpen(false);
            }}
            title="ตัวอย่างบิล"
          >
            {activeEntry !== undefined && <InvoicePreview data={toDraftInvoice(activeEntry, period)} />}
          </Sheet>
        </>
      )}

      {step === 2 && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="จะสร้าง" value={`${selectedReady.length} บิล`} />
            <Metric label="ยอดรวม" value={baht(reviewTotal)} />
            <Metric label="LINE พร้อมส่ง" value={`${connectedReady.length} คน`} tone="good" />
            <Metric label="LINE ยังไม่เชื่อม" value={`${unconnectedReady.length} คน`} tone={unconnectedReady.length > 0 ? "warn" : undefined} />
          </div>

          {unconnectedReady.length > 0 && (
            <div className="panel-muted mt-4">
              <div className="flex items-start gap-3">
                <span className="ms mt-0.5 text-[20px] text-status-review-fg" aria-hidden="true">
                  warning
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-charcoal">
                    {`มี ${unconnectedReady.length} ห้องที่จะยังไม่ได้รับบิลทาง LINE`}
                  </p>
                  <p className="mt-1 text-sm text-steel">
                    {unconnectedReady.map((entry) => `${entry.row.room.id} ${entry.row.tenant.name}`).join(" · ")}
                  </p>
                  <p className="mt-1 text-xs text-fog">บิลยังสร้างได้ แต่ต้องแจ้งผู้เช่าด้วยช่องทางอื่น</p>
                </div>
              </div>
            </div>
          )}

          <Card className="mt-4">
            <DataTable
              minWidth={820}
              getRowKey={(entry) => entry.row.room.id}
              rows={selectedReady}
              columns={[
                { key: "room", header: "ห้อง", render: (entry) => <span className="font-medium text-charcoal">{entry.row.room.id}</span> },
                { key: "tenant", header: "ผู้เช่า", render: (entry) => <span className="text-steel">{entry.row.tenant.name}</span> },
                { key: "rent", header: "ค่าเช่า", align: "right", render: (entry) => baht(entry.row.room.rent) },
                { key: "water", header: "ค่าน้ำ", align: "right", render: (entry) => baht(entry.calc.waterAmount) },
                { key: "electric", header: "ค่าไฟ", align: "right", render: (entry) => baht(entry.calc.electricAmount) },
                { key: "total", header: "รวม", align: "right", render: (entry) => <span className="font-medium">{baht(entry.calc.total)}</span> },
                {
                  key: "line",
                  header: "LINE",
                  render: (entry) =>
                    entry.row.tenant.lineLinked ? (
                      <Badge tone="paid" icon="check_circle">
                        พร้อมส่ง
                      </Badge>
                    ) : (
                      <Badge tone="review" icon="error">
                        ยังไม่เชื่อม
                      </Badge>
                    ),
                },
              ]}
            />
          </Card>

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              icon="arrow_back"
              onClick={() => {
                setStep(1);
              }}
            >
              ย้อนกลับแก้ไข
            </Button>
            <Button variant="primary" icon="receipt_long" disabled={selectedReady.length === 0} onClick={createBills}>
              {`สร้างบิล ${selectedReady.length} รายการ`}
            </Button>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <Card className="mb-4">
            <div className="flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-status-paid-bg text-status-paid-fg" aria-hidden="true">
                <span className="ms text-[24px]">check_circle</span>
              </span>
              <div>
                <h2 className="text-lg text-charcoal">สร้างบิลเรียบร้อย</h2>
                <p className="mt-0.5 text-sm text-steel">
                  {`บิลเดือน ${period} ถูกสร้างแล้ว ${createdBills.length} ใบ ยังไม่ได้ส่ง LINE จนกว่าจะกดยืนยันด้านล่าง`}
                </p>
              </div>
            </div>
          </Card>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="สร้างแล้ว" value={`${createdBills.length} ใบ`} />
            <Metric label="ยอดรวม" value={baht(totalCreated)} />
            <Metric label="พร้อมส่ง LINE" value={`${connectedBills.length} คน`} tone="good" />
            <Metric label="ส่งไม่ได้" value={`${createdBills.length - connectedBills.length} คน`} tone={createdBills.length - connectedBills.length > 0 ? "warn" : undefined} />
          </div>

          {createdBills.length - connectedBills.length > 0 && (
            <div className="panel-muted mt-4">
              <h3 className="text-sm font-medium text-charcoal">ห้องที่ยังไม่เชื่อม LINE</h3>
              <p className="mt-1 text-xs text-fog">คัดลอกข้อความแล้วส่งให้ผู้เช่าทางช่องทางอื่น</p>
              <ul className="mt-3 grid gap-2">
                {createdBills
                  .filter((bill) => tenantById.get(bill.tenantId)?.lineLinked !== true)
                  .map((bill) => (
                    <li key={bill.id} className="rounded-lg border border-ash bg-canvas-white px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm text-charcoal">
                            {bill.roomId} · {bill.tenantName}
                          </p>
                          <p className="mt-0.5 text-xs text-fog">{unconnectedMessage(bill.roomId)}</p>
                        </div>
                        <Button
                          size="sm"
                          variant="secondary"
                          icon="content_copy"
                          onClick={() => {
                            copyMessage(bill.roomId);
                          }}
                        >
                          คัดลอกข้อความ
                        </Button>
                      </div>
                    </li>
                  ))}
              </ul>
            </div>
          )}

          <Card className="mt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm text-charcoal">ส่งบิลทาง LINE</p>
                <p className="mt-0.5 text-xs text-fog">
                  {sendPhase === "idle"
                    ? `${connectedBills.length} คนพร้อมรับบิล · การสร้างบิลและการส่ง LINE แยกจากกัน`
                    : sendPhase === "sending"
                      ? "กำลังส่งบิลทาง LINE"
                      : `ส่งสำเร็จ ${sentIds.length} รายการ${failedIds.length > 0 ? ` · ส่งไม่สำเร็จ ${failedIds.length} รายการ` : ""}`}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {failedIds.length > 0 && sendPhase === "done" && (
                  <Button
                    variant="secondary"
                    icon="refresh"
                    onClick={() => {
                      runSend(createdBills.filter((bill) => failedIds.includes(bill.id)), false);
                    }}
                  >
                    ลองส่งใหม่เฉพาะที่พลาด
                  </Button>
                )}
                <Button
                  variant="primary"
                  icon="send"
                  disabled={sendPhase === "sending" || connectedBills.length === 0}
                  onClick={() => {
                    setConfirmSendOpen(true);
                  }}
                >
                  {sendPhase === "sending" ? "กำลังส่ง LINE" : `ส่ง LINE ทั้งหมด ${connectedBills.length} คน`}
                </Button>
              </div>
            </div>
          </Card>

          <div className="mt-4 flex flex-wrap justify-end">
            <Button variant="secondary" icon="arrow_back" onClick={onFinish}>
              กลับรายการบิล
            </Button>
          </div>

          <Dialog
            open={confirmSendOpen}
            onClose={() => {
              setConfirmSendOpen(false);
            }}
            title="ยืนยันส่งบิลทาง LINE"
            footer={
              <>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setConfirmSendOpen(false);
                  }}
                >
                  ยกเลิก
                </Button>
                <Button
                  variant="primary"
                  icon="send"
                  onClick={() => {
                    setConfirmSendOpen(false);
                    runSend(connectedBills, sendPhase === "idle");
                  }}
                >
                  ยืนยันส่ง
                </Button>
              </>
            }
          >
            <p className="text-sm text-steel">
              {`บิลเดือน ${period} จำนวน ${connectedBills.length} ใบ จะถูกส่งให้ผู้เช่าที่เชื่อม LINE แล้ว การส่งไม่สามารถเรียกคืนได้`}
            </p>
          </Dialog>
        </>
      )}
    </div>
  );
}

function unconnectedMessage(roomId: string): string {
  return `กรุณาแอด LINE ของหอพักวังจันทร์ แล้วพิมพ์เลขห้อง ${roomId} ในแชท เพื่อรับบิลค่าที่พักและ QR พร้อมเพย์ประจำเดือน`;
}
