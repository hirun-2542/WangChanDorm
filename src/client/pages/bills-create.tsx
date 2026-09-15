import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  fetchMeterSheet,
  generateBills,
  type Bill,
  type BillCharge,
  type BillEntryInput,
  type MeterSheetRow,
  type Settings,
  type Tenant,
} from "../api";
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  IconButton,
  PageHeader,
  Select,
  Skeleton,
  type DataTableColumn,
} from "../ui";
import { InvoicePreview, Sheet, baht, periodLabel, recentPeriods, type InvoiceData } from "./bills-shared";

const monthCount = 3;

export interface CreateWizardProps {
  settings: Settings | null;
  tenants: Tenant[] | null;
  onFinish: () => void;
}

interface ChargeDraft {
  id: string;
  name: string;
  amount: string;
}

interface MeterRow {
  sheet: MeterSheetRow;
  selected: boolean;
  waterCurrent: string;
  electricCurrent: string;
  flatAmount: string;
  charges: ChargeDraft[];
}

type RowStatus = "ready" | "empty" | "error" | "billed";

interface RowCalc {
  isFlat: boolean;
  waterCurrent: number | null;
  waterUnits: number | null;
  waterAmount: number;
  waterInvalid: boolean;
  electricCurrent: number | null;
  electricUnits: number | null;
  flatAmount: number | null;
  electricAmount: number;
  electricInvalid: boolean;
  charges: BillCharge[];
  chargesTotal: number;
  chargeInvalid: boolean;
  total: number;
  status: RowStatus;
}

interface Entry {
  row: MeterRow;
  calc: RowCalc;
}

type ServerField = "waterCurrent" | "electricCurrent" | "flatElectricAmount";

interface RowError {
  roomId: string;
  field: ServerField;
  message: string;
}

function toNumber(value: string): number | null {
  if (value.trim() === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

let chargeSequence = 0;

function newChargeDraft(): ChargeDraft {
  chargeSequence += 1;
  return { id: `charge-${chargeSequence}`, name: "", amount: "" };
}

function parseChargeAmount(value: string): number | null {
  const trimmed = value.trim();

  if (trimmed === "") {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function toBillCharge(charge: ChargeDraft): BillCharge | null {
  const name = charge.name.trim();
  const amount = parseChargeAmount(charge.amount);

  return name === "" || amount === null ? null : { name, amount };
}

function computeRow(row: MeterRow): RowCalc {
  const { sheet } = row;
  const isFlat = sheet.electricMode === "flat";
  const waterCurrent = toNumber(row.waterCurrent);
  const waterInvalid = waterCurrent !== null && (Number.isNaN(waterCurrent) || waterCurrent < sheet.waterPrevious);
  const waterUnits = waterCurrent !== null && !waterInvalid ? waterCurrent - sheet.waterPrevious : null;
  const waterAmount = waterUnits === null ? 0 : Math.round(waterUnits * sheet.waterRate);

  const electricCurrent = toNumber(row.electricCurrent);
  const electricInvalid = electricCurrent !== null && (Number.isNaN(electricCurrent) || electricCurrent < sheet.electricPrevious);
  const electricUnits =
    !isFlat && electricCurrent !== null && !electricInvalid ? electricCurrent - sheet.electricPrevious : null;
  const flatAmount = toNumber(row.flatAmount);
  const electricRate = sheet.electricRate ?? 0;
  const electricAmount = isFlat
    ? flatAmount === null || Number.isNaN(flatAmount)
      ? 0
      : Math.round(flatAmount)
    : electricUnits === null
      ? 0
      : Math.round(electricUnits * electricRate);

  const resolvedCharges = row.charges.map(toBillCharge);
  const charges = resolvedCharges.filter((charge): charge is BillCharge => charge !== null);
  const chargeInvalid = resolvedCharges.some((charge) => charge === null);
  const chargesTotal = charges.reduce((sum, charge) => sum + charge.amount, 0);

  const filled = waterCurrent !== null && electricCurrent !== null && (!isFlat || flatAmount !== null);
  const status: RowStatus =
    sheet.existingBillId !== null
      ? "billed"
      : waterInvalid || electricInvalid || chargeInvalid
        ? "error"
        : filled
          ? "ready"
          : "empty";

  return {
    isFlat,
    waterCurrent: waterCurrent !== null && Number.isNaN(waterCurrent) ? null : waterCurrent,
    waterUnits,
    waterAmount,
    waterInvalid,
    electricCurrent: electricCurrent !== null && Number.isNaN(electricCurrent) ? null : electricCurrent,
    electricUnits,
    flatAmount: flatAmount !== null && Number.isNaN(flatAmount) ? null : flatAmount,
    electricAmount,
    electricInvalid,
    charges,
    chargesTotal,
    chargeInvalid,
    total: sheet.rent + waterAmount + electricAmount + chargesTotal,
    status,
  };
}

function roomNumberFromMessage(message: string): string | null {
  const match = /ห้อง\s*([A-Za-z0-9-]+)/.exec(message);
  return match === null ? null : (match[1] ?? null);
}

function toDraftInvoice(entry: Entry, period: string): InvoiceData {
  const { row, calc } = entry;

  return {
    roomNumber: row.sheet.roomNumber,
    tenantName: row.sheet.tenantName,
    period,
    rent: row.sheet.rent,
    waterPrevious: row.sheet.waterPrevious,
    waterCurrent: calc.waterCurrent,
    waterUnits: calc.waterUnits,
    waterRate: row.sheet.waterRate,
    waterAmount: calc.waterAmount,
    electricMode: row.sheet.electricMode,
    electricPrevious: row.sheet.electricPrevious,
    electricCurrent: calc.electricCurrent,
    electricUnits: calc.electricUnits,
    electricRate: row.sheet.electricRate,
    electricAmount: calc.electricAmount,
    charges: calc.charges,
    total: calc.total,
  };
}

function MeterStatus({ entry }: { entry: Entry }) {
  const { status, waterInvalid, electricInvalid } = entry.calc;

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
        {waterInvalid || electricInvalid ? "มิเตอร์ย้อนหลัง" : "ค่าใช้จ่ายไม่ถูกต้อง"}
      </Badge>
    );
  }

  if (status === "billed") {
    return (
      <Badge tone="neutral" icon="receipt_long">
        ออกบิลแล้ว
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

function Stepper({ current }: { current: number }) {
  const steps = [
    { number: 1, title: "กรอกข้อมูลมิเตอร์", sub: "กรอกเลขปัจจุบัน" },
    { number: 2, title: "ตรวจสอบและยืนยัน", sub: "ตรวจยอดก่อนสร้าง" },
    { number: 3, title: "ผลการสร้างบิล", sub: "บิลที่บันทึกแล้ว" },
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

export function CreateWizard({ settings, tenants, onFinish }: CreateWizardProps) {
  const [step, setStep] = useState(1);
  const [periods] = useState<string[]>(() => recentPeriods(monthCount));
  const [period, setPeriod] = useState<string>(() => periods[0] ?? "");
  const [rows, setRows] = useState<MeterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [activeRoomId, setActiveRoomId] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDocked, setPreviewDocked] = useState<boolean>(() => window.matchMedia("(min-width: 1536px)").matches);
  const [createdBills, setCreatedBills] = useState<Bill[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [rowError, setRowError] = useState<RowError | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  useEffect(() => {
    if (period === "") {
      return;
    }

    let active = true;
    setLoading(true);
    setLoadError(null);

    void fetchMeterSheet(period)
      .then((sheet) => {
        if (!active) {
          return;
        }

        setRows(
          sheet.map((row) => ({
            sheet: row,
            selected: row.existingBillId === null,
            waterCurrent: "",
            electricCurrent: "",
            flatAmount: "",
            charges: [],
          })),
        );
        setActiveRoomId(sheet[0]?.roomId ?? "");
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }

        setRows([]);
        setLoadError(error instanceof ApiError ? error.message : "โหลดข้อมูลมิเตอร์ไม่สำเร็จ");
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [period, reloadKey]);

  const updateRow = (
    roomId: string,
    patch: Partial<Pick<MeterRow, "selected" | "waterCurrent" | "electricCurrent" | "flatAmount" | "charges">>,
  ) => {
    setRows((prev) => prev.map((row) => (row.sheet.roomId === roomId ? { ...row, ...patch } : row)));
  };

  const appendCharge = (roomId: string) => {
    setRows((prev) =>
      prev.map((row) => (row.sheet.roomId === roomId ? { ...row, charges: [...row.charges, newChargeDraft()] } : row)),
    );
  };

  const removeCharge = (roomId: string, chargeId: string) => {
    setRows((prev) =>
      prev.map((row) =>
        row.sheet.roomId === roomId ? { ...row, charges: row.charges.filter((charge) => charge.id !== chargeId) } : row,
      ),
    );
  };

  const editCharge = (roomId: string, chargeId: string, patch: Partial<Pick<ChargeDraft, "name" | "amount">>) => {
    setRows((prev) =>
      prev.map((row) =>
        row.sheet.roomId === roomId
          ? { ...row, charges: row.charges.map((charge) => (charge.id === chargeId ? { ...charge, ...patch } : charge)) }
          : row,
      ),
    );
  };

  const entries: Entry[] = rows.map((row) => ({ row, calc: computeRow(row) }));
  const ready = entries.filter((entry) => entry.calc.status === "ready");
  const emptyCount = entries.filter((entry) => entry.calc.status === "empty").length;
  const errorCount = entries.filter((entry) => entry.calc.status === "error").length;
  const billedEntries = entries.filter((entry) => entry.calc.status === "billed");
  const selectedEntries = entries.filter((entry) => entry.row.selected);
  const selectedReady = selectedEntries.filter((entry) => entry.calc.status === "ready");
  const blocked = selectedEntries.some((entry) => entry.calc.status === "error");
  const blockedByMeter = selectedEntries.some((entry) => entry.calc.waterInvalid || entry.calc.electricInvalid);
  const estimate = selectedReady.reduce((sum, entry) => sum + entry.calc.total, 0);

  const rentTotal = selectedReady.reduce((sum, entry) => sum + entry.row.sheet.rent, 0);
  const waterTotal = selectedReady.reduce((sum, entry) => sum + entry.calc.waterAmount, 0);
  const electricTotal = selectedReady.reduce((sum, entry) => sum + entry.calc.electricAmount, 0);
  const chargeTotal = selectedReady.reduce((sum, entry) => sum + entry.calc.chargesTotal, 0);
  const grandTotal = rentTotal + waterTotal + electricTotal + chargeTotal;

  const tenantById = useMemo(() => new Map((tenants ?? []).map((tenant) => [tenant.id, tenant])), [tenants]);

  const connectedOf = (tenantId: string): boolean | null => {
    const tenant = tenantById.get(tenantId);
    return tenant === undefined ? null : tenant.lineUserId !== null;
  };

  const connectedCount = tenants === null ? null : selectedReady.filter((entry) => connectedOf(entry.row.sheet.tenantId) === true).length;
  const unconnectedEntries = tenants === null ? [] : selectedReady.filter((entry) => connectedOf(entry.row.sheet.tenantId) === false);

  const query = search.trim().toLowerCase();
  const visibleEntries = entries.filter((entry) => {
    const matchesQuery =
      query === "" ||
      entry.row.sheet.roomNumber.toLowerCase().includes(query) ||
      entry.row.sheet.tenantName.toLowerCase().includes(query);
    const matchesStatus = statusFilter === "all" || entry.calc.status === statusFilter;
    return matchesQuery && matchesStatus;
  });

  const activeEntry = entries.find((entry) => entry.row.sheet.roomId === activeRoomId) ?? entries[0];
  const nextDisabled = blocked || selectedReady.length === 0;

  const waterRateOverridden = (entry: Entry): boolean =>
    settings !== null && entry.row.sheet.waterRate !== settings.defaultWaterRate;

  const electricRateOverridden = (entry: Entry): boolean =>
    settings !== null && entry.calc.isFlat === false && entry.row.sheet.electricRate !== settings.defaultElectricRate;

  const meterCell = (entry: Entry, kind: "water" | "electric") => {
    const billed = entry.calc.status === "billed";
    const invalid = kind === "water" ? entry.calc.waterInvalid : entry.calc.electricInvalid;
    const value = kind === "water" ? entry.row.waterCurrent : entry.row.electricCurrent;
    const previous = kind === "water" ? entry.row.sheet.waterPrevious : entry.row.sheet.electricPrevious;
    const field: ServerField = kind === "water" ? "waterCurrent" : "electricCurrent";
    const serverMessage =
      rowError !== null && rowError.roomId === entry.row.sheet.roomId && rowError.field === field ? rowError.message : undefined;

    if (billed) {
      return <span className="text-fog">—</span>;
    }

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
            className={`input-inline w-14${invalid || serverMessage !== undefined ? " border-danger" : ""}`}
            value={value}
            aria-label={`มิเตอร์${kind === "water" ? "น้ำ" : "ไฟ"}ครั้งนี้ ห้อง ${entry.row.sheet.roomNumber}`}
            aria-invalid={invalid || serverMessage !== undefined}
            aria-describedby={
              invalid || serverMessage !== undefined ? `${entry.row.sheet.roomId}-${kind}-error` : undefined
            }
            onChange={(event) => {
              setActiveRoomId(entry.row.sheet.roomId);
              setRowError(null);
              updateRow(entry.row.sheet.roomId, kind === "water" ? { waterCurrent: event.target.value } : { electricCurrent: event.target.value });
            }}
            onFocus={() => {
              setActiveRoomId(entry.row.sheet.roomId);
            }}
          />
        </div>
        {(invalid || serverMessage !== undefined) && (
          <span id={`${entry.row.sheet.roomId}-${kind}-error`} className="flex items-center gap-1 text-right text-[11px] text-danger">
            <span className="ms text-[14px]" aria-hidden="true">
              error
            </span>
            {serverMessage ?? `น้อยกว่าครั้งก่อน ${previous}`}
          </span>
        )}
      </div>
    );
  };

  const amountCell = (entry: Entry, kind: "water" | "electric") => {
    if (entry.calc.status === "billed") {
      return <span className="text-fog">—</span>;
    }

    if (kind === "electric" && entry.calc.isFlat) {
      const serverMessage = rowError !== null && rowError.roomId === entry.row.sheet.roomId && rowError.field === "flatElectricAmount" ? rowError.message : undefined;

      return (
        <div className="flex flex-col items-end gap-1">
          <input
            type="text"
            inputMode="numeric"
            className={`input-inline w-14${serverMessage === undefined ? "" : " border-danger"}`}
            value={entry.row.flatAmount}
            aria-label={`ค่าไฟเหมาจ่าย ห้อง ${entry.row.sheet.roomNumber}`}
            aria-invalid={serverMessage !== undefined}
            onChange={(event) => {
              setActiveRoomId(entry.row.sheet.roomId);
              setRowError(null);
              updateRow(entry.row.sheet.roomId, { flatAmount: event.target.value });
            }}
            onFocus={() => {
              setActiveRoomId(entry.row.sheet.roomId);
            }}
          />
          {serverMessage === undefined ? (
            <span className="text-[11px] text-fog">เหมาจ่าย</span>
          ) : (
            <span className="text-right text-[11px] text-danger">{serverMessage}</span>
          )}
        </div>
      );
    }

    const amount = kind === "water" ? entry.calc.waterAmount : entry.calc.electricAmount;
    const units = kind === "water" ? entry.calc.waterUnits : entry.calc.electricUnits;
    const rate = kind === "water" ? entry.row.sheet.waterRate : (entry.row.sheet.electricRate ?? 0);

    return (
      <div className="flex flex-col items-end">
        <span>{units === null ? "—" : baht(amount)}</span>
        <span className="text-[11px] text-fog">{units === null ? "รอกรอกมิเตอร์" : `${units} หน่วย × ${rate}`}</span>
      </div>
    );
  };

  const chargesCell = (entry: Entry) => {
    if (entry.calc.status === "billed") {
      return <span className="text-fog">—</span>;
    }

    const roomId = entry.row.sheet.roomId;
    const errorId = `${roomId}-charge-error`;

    if (entry.row.charges.length === 0) {
      return (
        <Button
          variant="ghost"
          size="sm"
          icon="add"
          onClick={() => {
            setActiveRoomId(roomId);
            setRowError(null);
            appendCharge(roomId);
          }}
        >
          เพิ่มค่าใช้จ่ายเพิ่มเติม
        </Button>
      );
    }

    return (
      <div className="flex flex-col gap-2">
        {entry.row.charges.map((charge) => {
          const nameId = `${roomId}-${charge.id}-name`;
          const amountId = `${roomId}-${charge.id}-amount`;
          const nameInvalid = charge.name.trim() === "";
          const amountInvalid = parseChargeAmount(charge.amount) === null;
          const describedBy = nameInvalid || amountInvalid ? errorId : undefined;

          return (
            <div key={charge.id} className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <label className="field-label" htmlFor={nameId}>
                  ชื่อรายการ
                </label>
                <input
                  id={nameId}
                  type="text"
                  className={`input-inline w-full text-left${nameInvalid ? " border-danger" : ""}`}
                  value={charge.name}
                  aria-invalid={nameInvalid}
                  aria-describedby={describedBy}
                  onChange={(event) => {
                    setActiveRoomId(roomId);
                    setRowError(null);
                    editCharge(roomId, charge.id, { name: event.target.value });
                  }}
                  onFocus={() => {
                    setActiveRoomId(roomId);
                  }}
                />
              </div>
              <div className="w-20 shrink-0">
                <label className="field-label" htmlFor={amountId}>
                  จำนวนเงิน
                </label>
                <input
                  id={amountId}
                  type="text"
                  inputMode="numeric"
                  className={`input-inline num w-full${amountInvalid ? " border-danger" : ""}`}
                  value={charge.amount}
                  aria-invalid={amountInvalid}
                  aria-describedby={describedBy}
                  onChange={(event) => {
                    setActiveRoomId(roomId);
                    setRowError(null);
                    editCharge(roomId, charge.id, { amount: event.target.value });
                  }}
                  onFocus={() => {
                    setActiveRoomId(roomId);
                  }}
                />
              </div>
              <IconButton
                icon="delete"
                label="ลบรายการนี้"
                onClick={() => {
                  setActiveRoomId(roomId);
                  setRowError(null);
                  removeCharge(roomId, charge.id);
                }}
              />
            </div>
          );
        })}
        {entry.calc.chargeInvalid && (
          <span id={errorId} className="flex items-center gap-1 text-[11px] text-danger">
            <span className="ms text-[14px]" aria-hidden="true">
              error
            </span>
            ค่าใช้จ่ายเพิ่มเติมต้องมีชื่อและจำนวนเงินเป็นจำนวนเต็มไม่ติดลบ
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          icon="add"
          onClick={() => {
            setActiveRoomId(roomId);
            setRowError(null);
            appendCharge(roomId);
          }}
        >
          เพิ่มรายการ
        </Button>
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
          disabled={entry.calc.status === "billed"}
          aria-label={`เลือกห้อง ${entry.row.sheet.roomNumber}`}
          onChange={(event) => {
            updateRow(entry.row.sheet.roomId, { selected: event.target.checked });
          }}
        />
      ),
    },
    {
      key: "room",
      header: "ห้อง",
      render: (entry) => (
        <div>
          <span className="font-medium text-charcoal">{entry.row.sheet.roomNumber}</span>
          {waterRateOverridden(entry) || electricRateOverridden(entry) ? <span className="chip mt-1 block w-fit">อัตราพิเศษ</span> : null}
          {entry.calc.status === "billed" && <span className="mt-1 block text-[11px] text-fog">ออกบิลเดือนนี้แล้ว</span>}
        </div>
      ),
    },
    { key: "tenant", header: "ผู้เช่า", render: (entry) => <span className="text-steel">{entry.row.sheet.tenantName}</span> },
    { key: "rent", header: "ค่าเช่า", align: "right", render: (entry) => baht(entry.row.sheet.rent) },
    { key: "waterMeter", header: "น้ำ", align: "right", render: (entry) => meterCell(entry, "water") },
    { key: "waterAmount", header: "ค่าน้ำ", align: "right", render: (entry) => amountCell(entry, "water") },
    { key: "electricMeter", header: "ไฟ", align: "right", render: (entry) => meterCell(entry, "electric") },
    { key: "electricAmount", header: "ค่าไฟ", align: "right", render: (entry) => amountCell(entry, "electric") },
    { key: "charges", header: "ค่าใช้จ่ายเพิ่มเติม", render: (entry) => chargesCell(entry) },
    {
      key: "total",
      header: "ยอดรวม",
      align: "right",
      render: (entry) =>
        entry.calc.status === "billed" ? <span className="text-fog">—</span> : <span className="font-medium">{baht(entry.calc.total)}</span>,
    },
    { key: "status", header: "สถานะ", render: (entry) => <MeterStatus entry={entry} /> },
  ];

  const reviewTotal = selectedReady.reduce((sum, entry) => sum + entry.calc.total, 0);

  const createdTotal = createdBills.reduce((sum, bill) => sum + bill.total, 0);
  const createdUnconnected = createdBills.filter((bill) => connectedOf(bill.tenantId) === false);

  const createBills = () => {
    const payload: BillEntryInput[] = selectedReady.map((entry) => {
      const input: BillEntryInput = {
        roomId: entry.row.sheet.roomId,
        waterCurrent: entry.calc.waterCurrent ?? 0,
        electricCurrent: entry.calc.electricCurrent ?? 0,
      };

      if (entry.calc.isFlat && entry.calc.flatAmount !== null) {
        input.flatElectricAmount = entry.calc.flatAmount;
      }

      if (entry.calc.charges.length > 0) {
        input.charges = entry.calc.charges;
      }

      return input;
    });

    setSubmitting(true);
    setRowError(null);
    setGenerateError(null);

    void generateBills(period, payload)
      .then((created) => {
        setCreatedBills(created);
        setStep(3);
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError) {
          setGenerateError(error.message);

          const roomNumber = roomNumberFromMessage(error.message);

          if (
            roomNumber !== null &&
            (error.field === "waterCurrent" || error.field === "electricCurrent" || error.field === "flatElectricAmount")
          ) {
            const target = rows.find((row) => row.sheet.roomNumber === roomNumber);

            if (target !== undefined) {
              setRowError({ roomId: target.sheet.roomId, field: error.field, message: error.message });
            }
          }
        } else {
          setGenerateError("สร้างบิลไม่สำเร็จ");
        }
      })
      .finally(() => {
        setSubmitting(false);
      });
  };

  const reloadSheet = () => {
    setStep(1);
    setGenerateError(null);
    setRowError(null);
    setReloadKey((value) => value + 1);
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
                    {periodLabel(option)}
                  </option>
                ))}
              </select>
              <Badge tone="neutral" icon="pending_actions">
                ยังไม่สร้างบิล
              </Badge>
              <span className="ml-auto text-xs text-fog">สร้างเฉพาะห้องที่มีผู้เช่า</span>
            </div>
          </Card>

          {loading ? (
            <Card>
              <div className="grid gap-3" aria-busy="true">
                <Skeleton className="h-5 w-44" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-2/3" />
              </div>
            </Card>
          ) : loadError !== null ? (
            <Card>
              <EmptyState
                icon="cloud_off"
                title="โหลดข้อมูลมิเตอร์ไม่สำเร็จ"
                description={loadError}
                action={
                  <Button
                    variant="secondary"
                    icon="refresh"
                    onClick={() => {
                      setReloadKey((value) => value + 1);
                    }}
                  >
                    ลองใหม่
                  </Button>
                }
              />
            </Card>
          ) : rows.length === 0 ? (
            <Card>
              <EmptyState
                icon="door_front"
                title="ยังไม่มีห้องที่มีผู้เช่า"
                description="เพิ่มผู้เช่าให้ห้องก่อน แล้วกลับมาเปิดบิลเดือนนี้"
                action={
                  <Button
                    variant="secondary"
                    icon="group"
                    onClick={() => {
                      window.location.hash = "#tenants";
                    }}
                  >
                    ไปหน้าผู้เช่า
                  </Button>
                }
              />
            </Card>
          ) : (
            <>
              <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <Metric label="ห้องที่มีผู้เช่า" value={String(entries.length)} />
                <Metric label="กรอกครบ" value={String(ready.length)} tone="good" />
                <Metric label="ยังไม่กรอก" value={String(emptyCount)} tone="warn" />
                <Metric label="มีข้อผิดพลาด" value={String(errorCount)} tone={errorCount > 0 ? "warn" : undefined} />
                <Metric label="ประมาณการยอดรวม" value={baht(estimate)} />
              </div>

              {billedEntries.length > 0 && (
                <div className="panel-muted mb-4">
                  <div className="flex items-start gap-3">
                    <span className="ms mt-0.5 text-[20px] text-steel" aria-hidden="true">
                      receipt_long
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-charcoal">{`มี ${billedEntries.length} ห้องที่ออกบิลเดือนนี้แล้ว`}</p>
                      <p className="mt-1 text-sm text-steel">{billedEntries.map((entry) => entry.row.sheet.roomNumber).join(" · ")}</p>
                      <p className="mt-1 text-xs text-fog">ห้องเหล่านี้ไม่ถูกเลือกให้สร้างบิลซ้ำในเดือนนี้</p>
                    </div>
                  </div>
                </div>
              )}

              <div className={previewDocked ? "items-start xl:grid xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-4" : "items-start"}>
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
                            { value: "billed", label: "ออกบิลแล้ว" },
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
                      getRowKey={(entry) => entry.row.sheet.roomId}
                      minWidth={1080}
                      emptyMessage="ไม่พบห้องที่ตรงกับเงื่อนไข"
                    />
                  </Card>
                </div>

                {previewDocked && (
                  <aside className="hidden xl:sticky xl:top-20 xl:block">
                    <p className="mb-2 text-xs text-fog">
                      พรีวิวบิลของห้อง {activeEntry === undefined ? "—" : activeEntry.row.sheet.roomNumber}
                    </p>
                    {activeEntry !== undefined && <InvoicePreview data={toDraftInvoice(activeEntry, period)} dormName={settings?.dormName ?? null} />}
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
                    <p className="text-xs text-fog">ค่าใช้จ่ายรวม</p>
                    <p className="num text-sm text-charcoal">{baht(chargeTotal)}</p>
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
                        ? blockedByMeter
                          ? "แก้มิเตอร์ที่น้อยกว่าครั้งก่อนก่อนไปต่อ"
                          : "แก้ค่าใช้จ่ายเพิ่มเติมที่ยังไม่ครบก่อนไปต่อ"
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
                {activeEntry !== undefined && <InvoicePreview data={toDraftInvoice(activeEntry, period)} dormName={settings?.dormName ?? null} />}
              </Sheet>
            </>
          )}
        </>
      )}

      {step === 2 && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="จะสร้าง" value={`${selectedReady.length} บิล`} />
            <Metric label="ยอดรวม" value={baht(reviewTotal)} />
            <Metric label="LINE พร้อมส่ง" value={connectedCount === null ? "—" : `${connectedCount} คน`} tone="good" />
            <Metric
              label="LINE ยังไม่เชื่อม"
              value={tenants === null ? "—" : `${unconnectedEntries.length} คน`}
              tone={tenants !== null && unconnectedEntries.length > 0 ? "warn" : undefined}
            />
          </div>

          {generateError !== null && (
            <div className="mt-4 rounded-xl border border-danger bg-danger-soft px-4 py-3" role="alert">
              <p className="text-sm font-medium text-charcoal">สร้างบิลไม่สำเร็จ</p>
              <p className="mt-1 text-sm text-steel">{generateError}</p>
              <Button
                variant="secondary"
                icon="refresh"
                className="mt-3"
                onClick={() => {
                  reloadSheet();
                }}
              >
                โหลดข้อมูลมิเตอร์ใหม่
              </Button>
            </div>
          )}

          {unconnectedEntries.length > 0 && (
            <div className="panel-muted mt-4">
              <div className="flex items-start gap-3">
                <span className="ms mt-0.5 text-[20px] text-status-review-fg" aria-hidden="true">
                  warning
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-charcoal">
                    {`มี ${unconnectedEntries.length} ห้องที่ผู้เช่ายังไม่เชื่อม LINE`}
                  </p>
                  <p className="mt-1 text-sm text-steel">
                    {unconnectedEntries.map((entry) => `${entry.row.sheet.roomNumber} ${entry.row.sheet.tenantName}`).join(" · ")}
                  </p>
                  <p className="mt-1 text-xs text-fog">บิลยังสร้างได้ การส่งบิลทาง LINE จะมาในงานถัดไป</p>
                </div>
              </div>
            </div>
          )}

          <Card className="mt-4">
            <DataTable
              minWidth={940}
              getRowKey={(entry) => entry.row.sheet.roomId}
              rows={selectedReady}
              columns={[
                {
                  key: "room",
                  header: "ห้อง",
                  render: (entry) => <span className="font-medium text-charcoal">{entry.row.sheet.roomNumber}</span>,
                },
                { key: "tenant", header: "ผู้เช่า", render: (entry) => <span className="text-steel">{entry.row.sheet.tenantName}</span> },
                { key: "rent", header: "ค่าเช่า", align: "right", render: (entry) => baht(entry.row.sheet.rent) },
                { key: "water", header: "ค่าน้ำ", align: "right", render: (entry) => baht(entry.calc.waterAmount) },
                { key: "electric", header: "ค่าไฟ", align: "right", render: (entry) => baht(entry.calc.electricAmount) },
                {
                  key: "charges",
                  header: "ค่าใช้จ่ายเพิ่มเติม",
                  align: "right",
                  render: (entry) =>
                    entry.calc.chargesTotal === 0 ? <span className="text-fog">—</span> : baht(entry.calc.chargesTotal),
                },
                { key: "total", header: "รวม", align: "right", render: (entry) => <span className="font-medium">{baht(entry.calc.total)}</span> },
                {
                  key: "line",
                  header: "LINE",
                  render: (entry) => {
                    const connected = connectedOf(entry.row.sheet.tenantId);

                    if (connected === null) {
                      return (
                        <Badge tone="neutral" icon="schedule">
                          ยังไม่ทราบสถานะ
                        </Badge>
                      );
                    }

                    return connected ? (
                      <Badge tone="paid" icon="check_circle">
                        เชื่อมแล้ว
                      </Badge>
                    ) : (
                      <Badge tone="review" icon="error">
                        ยังไม่เชื่อม
                      </Badge>
                    );
                  },
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
            <Button variant="primary" icon="receipt_long" disabled={selectedReady.length === 0 || submitting} onClick={createBills}>
              {submitting ? "กำลังสร้างบิล" : `สร้างบิล ${selectedReady.length} รายการ`}
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
                  {`บิลเดือน ${periodLabel(period)} ถูกบันทึกแล้ว ${createdBills.length} ใบ`}
                </p>
                <p className="mt-1 text-sm text-steel">การส่งบิลทาง LINE จะมาในงานถัดไป</p>
              </div>
            </div>
          </Card>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="สร้างแล้ว" value={`${createdBills.length} ใบ`} />
            <Metric label="ยอดรวม" value={baht(createdTotal)} />
            <Metric
              label="LINE เชื่อมแล้ว"
              value={tenants === null ? "—" : `${createdBills.length - createdUnconnected.length} คน`}
              tone="good"
            />
            <Metric
              label="LINE ยังไม่เชื่อม"
              value={tenants === null ? "—" : `${createdUnconnected.length} คน`}
              tone={createdUnconnected.length > 0 ? "warn" : undefined}
            />
          </div>

          <Card className="mt-4">
            <DataTable
              minWidth={640}
              getRowKey={(bill) => bill.id}
              rows={createdBills}
              columns={[
                { key: "room", header: "ห้อง", render: (bill) => <span className="font-medium text-charcoal">{bill.roomNumber}</span> },
                { key: "tenant", header: "ผู้เช่า", render: (bill) => <span className="text-steel">{bill.tenantName}</span> },
                { key: "water", header: "ค่าน้ำ", align: "right", render: (bill) => baht(bill.waterAmount) },
                { key: "electric", header: "ค่าไฟ", align: "right", render: (bill) => baht(bill.electricAmount) },
                { key: "total", header: "รวม", align: "right", render: (bill) => <span className="font-medium">{baht(bill.total)}</span> },
              ]}
            />
          </Card>

          {createdUnconnected.length > 0 && (
            <div className="panel-muted mt-4">
              <h3 className="text-sm font-medium text-charcoal">ห้องที่ยังไม่เชื่อม LINE</h3>
              <p className="mt-1 text-xs text-fog">
                ผู้เช่าเหล่านี้จะยังไม่ได้รับบิลทาง LINE เมื่อการส่งบิลเปิดใช้งานในงานถัดไป
              </p>
              <ul className="mt-3 grid gap-2">
                {createdUnconnected.map((bill) => (
                  <li key={bill.id} className="rounded-lg border border-ash bg-canvas-white px-3 py-2">
                    <p className="text-sm text-charcoal">
                      {bill.roomNumber} · {bill.tenantName}
                    </p>
                    <p className="mt-0.5 text-xs text-fog">ยังไม่เชื่อม LINE กับหอ</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4 flex flex-wrap justify-end">
            <Button variant="secondary" icon="arrow_back" onClick={onFinish}>
              กลับรายการบิล
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
