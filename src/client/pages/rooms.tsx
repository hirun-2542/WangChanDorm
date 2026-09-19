import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  ApiError,
  billsFocusHash,
  billsFocusTarget,
  createRoom,
  fetchDashboardStats,
  fetchRooms,
  fetchSettings,
  fetchTenants,
  updateRoom,
  type BillCharge,
  type DashboardKpis,
  type DashboardRoom,
  type DashboardRoomStatus,
  type Room,
  type RoomInput,
  type Tenant,
} from "../api";
import { useSearch } from "../search";
import {
  Badge,
  Button,
  Card,
  DataTable,
  Drawer,
  EmptyState,
  Field,
  IconButton,
  PageHeader,
  Select,
  Skeleton,
  Toast,
  type BadgeTone,
  type DataTableColumn,
} from "../ui";
import { baht, chargesTotal, periodAt, periodLabel, periodOptions } from "./bills-shared";
import { ChoiceRow, numericValue } from "./dorm-shared";

type StatusFilter = "all" | "occupied" | "vacant" | "unpaid" | "unbilled";
type RoomView = "table" | "cards";
type WaterMode = "default" | "custom";
type ElectricChoice = "default" | "custom" | "flat";

interface RateDefaults {
  waterRate: number;
  electricRate: number;
}

interface RoomForm {
  id: string;
  rent: string;
  waterMeterInit: string;
  electricMeterInit: string;
  waterMode: WaterMode;
  waterRate: string;
  electricChoice: ElectricChoice;
  electricRate: string;
  charges: ChargeDraft[];
}

interface ChargeDraft {
  id: string;
  name: string;
  amount: string;
}

let chargeSequence = 0;

function chargeDraft(name: string, amount: number): ChargeDraft {
  chargeSequence += 1;
  return { id: `charge-${chargeSequence}`, name, amount: String(amount) };
}

function newChargeDraft(): ChargeDraft {
  return chargeDraft("", 0);
}

function chargeDrafts(charges: BillCharge[]): ChargeDraft[] {
  return charges.map((charge) => chargeDraft(charge.name, charge.amount));
}

const dormChargeFallback: BillCharge[] = [
  { name: "ค่าบริการ", amount: 10 },
  { name: "ค่าขยะ", amount: 20 },
  { name: "ค่าไวไฟ", amount: 100 },
];

function sameCharges(left: BillCharge[], right: BillCharge[]): boolean {
  return (
    left.length === right.length &&
    left.every((charge, index) => charge.name === right[index]?.name && charge.amount === right[index]?.amount)
  );
}

function commonCharges(rooms: Room[]): BillCharge[] {
  const baskets = rooms.map((room) => room.charges).filter((charges) => charges.length > 0);
  let best: BillCharge[] = [];
  let bestCount = 0;

  for (const candidate of baskets) {
    const count = baskets.filter((charges) => sameCharges(charges, candidate)).length;

    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }

  return bestCount === 0 ? dormChargeFallback : best;
}

function parseChargeAmount(value: string): number | null {
  const trimmed = value.trim();

  if (trimmed === "") {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function rateFieldText(rate: number | undefined): string {
  return rate === undefined ? "" : String(rate);
}

const emptyRoomForm = (defaults: RateDefaults | null, charges: BillCharge[]): RoomForm => ({
  id: "",
  rent: "",
  waterMeterInit: "0",
  electricMeterInit: "0",
  waterMode: "default",
  waterRate: rateFieldText(defaults?.waterRate),
  electricChoice: "default",
  electricRate: rateFieldText(defaults?.electricRate),
  charges: chargeDrafts(charges),
});

const roomFormOf = (room: Room, defaults: RateDefaults | null): RoomForm => ({
  id: room.roomNumber,
  rent: String(room.rent),
  waterMeterInit: String(room.waterMeterInit),
  electricMeterInit: String(room.electricMeterInit),
  waterMode: room.waterRate === null ? "default" : "custom",
  waterRate: room.waterRate === null ? rateFieldText(defaults?.waterRate) : String(room.waterRate),
  electricChoice: room.electricMode === "flat" ? "flat" : room.electricRate === null ? "default" : "custom",
  electricRate: room.electricRate === null ? rateFieldText(defaults?.electricRate) : String(room.electricRate),
  charges: chargeDrafts(room.charges),
});

function moneyText(value: number): string {
  return `${baht(value)} บาท`;
}

function rateText(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function chargeBreakdownText(charges: BillCharge[]): string {
  return `${charges.map((charge) => `${charge.name} ${baht(charge.amount)}`).join(" · ")} บาท`;
}

function rateValueClass(inherited: boolean): string {
  return inherited ? "num text-fog" : "num font-medium text-charcoal";
}

function electricInherited(room: Room): boolean {
  return room.electricMode === "meter" && room.electricRate === null;
}

function ElectricFact({ room, defaults, align }: { room: Room; defaults: RateDefaults | null; align: "left" | "right" }) {
  const justify = align === "right" ? "justify-end" : "justify-start";

  if (room.electricMode === "flat") {
    return (
      <span className={`flex items-baseline gap-1.5 ${justify}`}>
        <span className="chip">ไฟเหมา</span>
        <span className="num">{room.lastElectricAmount === null ? "—" : moneyText(room.lastElectricAmount)}</span>
      </span>
    );
  }

  const rate = room.electricRate ?? defaults?.electricRate ?? null;

  return (
    <span className={`flex items-baseline gap-1.5 ${justify}`}>
      <span className="text-[11px] text-fog">หน่วยละ</span>
      <span className={rateValueClass(electricInherited(room))}>{rate === null ? "—" : `${rateText(rate)} บาท`}</span>
    </span>
  );
}

const billStateMeta: Record<DashboardRoomStatus, { word: string; tone: BadgeTone; icon: string }> = {
  paid: { word: "จ่ายแล้ว", tone: "paid", icon: "check_circle" },
  unpaid: { word: "ยังไม่จ่าย", tone: "unpaid", icon: "schedule" },
  unbilled: { word: "ยังไม่ออกบิล", tone: "vacant", icon: "receipt_long" },
  vacant: { word: "ว่าง", tone: "vacant", icon: "door_front" },
};

function billStateOf(room: DashboardRoom): { word: string; tone: BadgeTone; icon: string } {
  if (room.status === "unpaid" && room.hasPendingSlip) {
    return { word: "รอตรวจ", tone: "review", icon: "fact_check" };
  }

  return billStateMeta[room.status];
}

function RoomBillState({ stat }: { stat: DashboardRoom | null }) {
  if (stat === null) {
    return <span className="text-xs text-fog">ยังไม่มีข้อมูลบิล</span>;
  }

  if (stat.status === "vacant") {
    return <span className="text-fog">ว่าง</span>;
  }

  const meta = billStateOf(stat);

  return (
    <span className="flex items-center gap-1.5">
      <Badge tone={meta.tone} icon={meta.icon}>
        {meta.word}
      </Badge>
      {stat.behindPeriods > 0 && stat.lastBilledPeriod !== null && (
        <Badge tone="danger" icon="error">
          {`ค้าง ${stat.behindPeriods} งวด`}
          <span className="sr-only">{` · บิลล่าสุด ${periodLabel(stat.lastBilledPeriod)}`}</span>
        </Badge>
      )}
    </span>
  );
}

function newestBilledPeriod(rooms: Room[]): string | null {
  let newest: string | null = null;

  for (const room of rooms) {
    const last = room.lastElectricPeriod;

    if (last !== null && (newest === null || last > newest)) {
      newest = last;
    }
  }

  return newest;
}

interface RoomMenuState {
  room: Room;
  trigger: HTMLElement;
  top: number;
  right: number;
}

interface RoomMenuProps {
  state: RoomMenuState;
  period: string | null;
  createBill: boolean;
  onClose: (restoreFocus: boolean) => void;
  onEdit: (room: Room) => void;
}

function RoomMenu({ state, period, createBill, onClose, onEdit }: RoomMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: state.top, right: state.right });

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus();
  }, []);

  useLayoutEffect(() => {
    const node = ref.current;

    if (node === null) {
      return;
    }

    const gap = 6;
    const margin = 8;
    const menuBox = node.getBoundingClientRect();
    const triggerBox = state.trigger.getBoundingClientRect();
    const below = triggerBox.bottom + gap;
    const above = triggerBox.top - gap - menuBox.height;
    const top = below + menuBox.height > window.innerHeight - margin && above >= margin ? above : below;

    setPosition({
      top: Math.min(Math.max(top, margin), Math.max(margin, window.innerHeight - margin - menuBox.height)),
      right: Math.min(
        Math.max(window.innerWidth - triggerBox.right, margin),
        Math.max(margin, window.innerWidth - margin - menuBox.width),
      ),
    });
  }, [state.trigger, state.top, state.right]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      onClose(true);
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (ref.current?.contains(target) === true || state.trigger.contains(target)) {
        return;
      }

      onClose(false);
    };

    const onViewportChange = () => {
      onClose(false);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
    document.addEventListener("pointerdown", onPointerDown, true);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [onClose, state.trigger]);

  const run = (action: (room: Room) => void) => {
    const room = state.room;
    onClose(false);
    action(room);
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`เมนูจัดการห้อง ${state.room.roomNumber}`}
      className="row-menu"
      style={{ top: position.top, right: position.right }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
          return;
        }

        event.preventDefault();
        const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? []);
        const current = items.findIndex((item) => item === document.activeElement);
        const step = event.key === "ArrowDown" ? 1 : -1;
        items[(current + step + items.length) % items.length]?.focus();
      }}
      onBlur={(event) => {
        const next = event.relatedTarget;

        if (next instanceof Node && (ref.current?.contains(next) === true || next === state.trigger)) {
          return;
        }

        onClose(false);
      }}
    >
      <button
        type="button"
        role="menuitem"
        className="row-menu-item"
        onClick={() => {
          run(onEdit);
        }}
      >
        <span className="ms text-[18px]" aria-hidden="true">
          edit
        </span>
        แก้ไขห้อง
      </button>
      <button
        type="button"
        role="menuitem"
        className="row-menu-item"
        onClick={() => {
          run((room) => {
            window.location.hash = billsFocusHash(billsFocusTarget(room, period));
          });
        }}
      >
        <span className="ms text-[18px]" aria-hidden="true">
          receipt_long
        </span>
        ดูบิล
      </button>
      {createBill && (
        <button
          type="button"
          role="menuitem"
          className="row-menu-item"
          onClick={() => {
            run((room) => {
              window.location.hash = billsFocusHash(billsFocusTarget(room, period));
            });
          }}
        >
          <span className="ms text-[18px]" aria-hidden="true">
            note_add
          </span>
          สร้างบิลห้องนี้
        </button>
      )}
      {state.room.status === "vacant" && (
        <button
          type="button"
          role="menuitem"
          className="row-menu-item"
          onClick={() => {
            run(() => {
              window.location.hash = "#tenants";
            });
          }}
        >
          <span className="ms text-[18px]" aria-hidden="true">
            person_add
          </span>
          เพิ่มผู้เช่า
        </button>
      )}
    </div>
  );
}

interface RoomDrawerProps {
  open: boolean;
  seedKey: string;
  base: Room | null;
  form: RoomForm;
  defaults: RateDefaults | null;
  duplicateId: boolean;
  saving: boolean;
  serverError: { message: string; field?: string } | null;
  onChange: (form: RoomForm) => void;
  onClose: () => void;
  onSave: (input: RoomInput) => void;
}

function RoomDrawer({
  open,
  seedKey,
  base,
  form,
  defaults,
  duplicateId,
  saving,
  serverError,
  onChange,
  onClose,
  onSave,
}: RoomDrawerProps) {
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [seededKey, setSeededKey] = useState<string | null>(null);

  if (!open) {
    if (seededKey !== null) {
      setSeededKey(null);
    }
  } else if (seededKey !== seedKey) {
    setSeededKey(seedKey);
    setTouched({});
  }

  const touchedError = (field: string, message: string | undefined): string | undefined =>
    touched[field] === true ? message : undefined;

  const touch = (field: string) => {
    setTouched((previous) => (previous[field] === true ? previous : { ...previous, [field]: true }));
  };

  const rent = numericValue(form.rent);
  const rentInvalid = rent === null || !Number.isInteger(rent) || rent <= 0;
  const waterMeterValue = numericValue(form.waterMeterInit);
  const waterMeterInvalid = waterMeterValue === null || waterMeterValue < 0;
  const electricMeterValue = numericValue(form.electricMeterInit);
  const electricMeterInvalid = electricMeterValue === null || electricMeterValue < 0;
  const customWater = numericValue(form.waterRate);
  const customWaterInvalid = form.waterMode === "custom" && (customWater === null || customWater <= 0);
  const customElectric = numericValue(form.electricRate);
  const customElectricInvalid = form.electricChoice === "custom" && (customElectric === null || customElectric <= 0);
  const chargeInvalid = form.charges.some((charge) => charge.name.trim() === "" || parseChargeAmount(charge.amount) === null);

  const idBlank = form.id.trim() === "";
  const canSave =
    defaults !== null &&
    !idBlank &&
    !duplicateId &&
    !rentInvalid &&
    !waterMeterInvalid &&
    !electricMeterInvalid &&
    !customWaterInvalid &&
    !customElectricInvalid &&
    !chargeInvalid &&
    !saving;

  const fieldError = (name: string): string | undefined =>
    serverError !== null && serverError.field === name ? serverError.message : undefined;

  const update = (patch: Partial<RoomForm>) => {
    onChange({ ...form, ...patch });
  };

  const appendCharge = () => {
    update({ charges: [...form.charges, newChargeDraft()] });
  };

  const removeCharge = (chargeId: string) => {
    update({ charges: form.charges.filter((charge) => charge.id !== chargeId) });
  };

  const editCharge = (chargeId: string, patch: Partial<Pick<ChargeDraft, "name" | "amount">>) => {
    update({ charges: form.charges.map((charge) => (charge.id === chargeId ? { ...charge, ...patch } : charge)) });
  };

  const save = () => {
    const input: RoomInput = {
      roomNumber: form.id.trim().toUpperCase(),
      rent: rent ?? 0,
      waterRate: form.waterMode === "custom" ? customWater : null,
      electricMode: form.electricChoice === "flat" ? "flat" : "meter",
      electricRate: form.electricChoice === "custom" ? customElectric : null,
      waterMeterInit: waterMeterValue ?? 0,
      electricMeterInit: electricMeterValue ?? 0,
      charges: form.charges.map((charge) => ({ name: charge.name.trim(), amount: parseChargeAmount(charge.amount) ?? 0 })),
    };

    onSave(input);
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={base === null ? "เพิ่มห้อง" : `แก้ไขห้อง ${base.roomNumber}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button variant="primary" icon="save" className={primaryFillClass} disabled={!canSave} onClick={save}>
            บันทึกห้อง
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {defaults === null && (
          <div className="rounded-xl border border-danger bg-danger-soft px-4 py-3" role="alert">
            <p className="text-sm text-danger">โหลดอัตราน้ำไฟของหอไม่สำเร็จ จึงยังตั้งอัตราของห้องนี้ไม่ได้ และยังบันทึกไม่ได้</p>
          </div>
        )}

        <div
          onBlur={() => {
            touch("id");
          }}
        >
          <Field
            label="เลขห้อง"
            value={form.id}
            onChange={(value) => {
              update({ id: value });
            }}
            placeholder="เช่น 108/7"
            error={fieldError("roomNumber") ?? touchedError("id", idBlank ? "กรอกเลขห้อง" : duplicateId ? "เลขห้องนี้ถูกใช้แล้ว" : undefined)}
          />
        </div>

        <div
          onBlur={() => {
            touch("rent");
          }}
        >
          <Field
            label="ค่าเช่า / เดือน (บาท)"
            value={form.rent}
            onChange={(value) => {
              update({ rent: value });
            }}
            inputMode="numeric"
            error={fieldError("rent") ?? touchedError("rent", rentInvalid ? "กรอกจำนวนเงินเป็นตัวเลข" : undefined)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div
            onBlur={() => {
              touch("waterMeterInit");
            }}
          >
            <Field
              label="มิเตอร์น้ำเริ่มต้น"
              value={form.waterMeterInit}
              onChange={(value) => {
                update({ waterMeterInit: value });
              }}
              inputMode="numeric"
              error={fieldError("waterMeterInit") ?? touchedError("waterMeterInit", waterMeterInvalid ? "กรอกตัวเลข" : undefined)}
            />
          </div>
          <div
            onBlur={() => {
              touch("electricMeterInit");
            }}
          >
            <Field
              label="มิเตอร์ไฟเริ่มต้น"
              value={form.electricMeterInit}
              onChange={(value) => {
                update({ electricMeterInit: value });
              }}
              inputMode="numeric"
              error={fieldError("electricMeterInit") ?? touchedError("electricMeterInit", electricMeterInvalid ? "กรอกตัวเลข" : undefined)}
            />
          </div>
        </div>

        <fieldset className="grid gap-2">
          <legend className="field-label">ค่าน้ำ</legend>
          <ChoiceRow
            name="room-water"
            checked={form.waterMode === "default"}
            title="ใช้อัตราทั้งหอ"
            helper={defaults === null ? "ยังโหลดอัตราทั้งหอไม่สำเร็จ" : `ใช้อัตราทั้งหอ ${defaults.waterRate} บาท/หน่วย`}
            onSelect={() => {
              update({ waterMode: "default" });
            }}
          />
          <ChoiceRow
            name="room-water"
            checked={form.waterMode === "custom"}
            title="กำหนดเอง"
            helper={
              defaults === null
                ? "ห้องนี้คิดค่าน้ำเอง กรอกอัตราต่อหน่วยของห้องนี้"
                : `ห้องนี้คิดค่าน้ำเอง เริ่มจากอัตราทั้งหอ ${defaults.waterRate} บาท/หน่วย`
            }
            onSelect={() => {
              update({ waterMode: "custom" });
            }}
          />
          {form.waterMode === "custom" && (
            <div
              className="pl-7"
              onBlur={() => {
                touch("waterRate");
              }}
            >
              <Field
                label="อัตราค่าน้ำต่อหน่วย (บาท)"
                value={form.waterRate}
                onChange={(value) => {
                  update({ waterRate: value });
                }}
                inputMode="numeric"
                error={fieldError("waterRate") ?? touchedError("waterRate", customWaterInvalid ? "กรอกอัตราที่มากกว่า 0" : undefined)}
              />
            </div>
          )}
        </fieldset>

        <fieldset className="grid gap-2">
          <legend className="field-label">ค่าไฟ</legend>
          <ChoiceRow
            name="room-electric"
            checked={form.electricChoice === "default"}
            title="ใช้อัตราทั้งหอ"
            helper={defaults === null ? "ยังโหลดอัตราทั้งหอไม่สำเร็จ" : `ใช้อัตราทั้งหอ ${defaults.electricRate} บาท/หน่วย`}
            onSelect={() => {
              update({ electricChoice: "default" });
            }}
          />
          <ChoiceRow
            name="room-electric"
            checked={form.electricChoice === "custom"}
            title="กำหนดเอง"
            helper="คิดตามหน่วยที่ใช้ ด้วยอัตราของห้องนี้"
            onSelect={() => {
              update({ electricChoice: "custom" });
            }}
          />
          <ChoiceRow
            name="room-electric"
            checked={form.electricChoice === "flat"}
            title="เหมาจ่ายรายเดือน"
            helper="เก็บค่าไฟเป็นยอดคงที่ทุกเดือน ไม่อ่านมิเตอร์"
            onSelect={() => {
              update({ electricChoice: "flat" });
            }}
          />
          {form.electricChoice === "custom" && (
            <div
              className="pl-7"
              onBlur={() => {
                touch("electricRate");
              }}
            >
              <Field
                label="อัตราค่าไฟต่อหน่วย (บาท)"
                value={form.electricRate}
                onChange={(value) => {
                  update({ electricRate: value });
                }}
                inputMode="numeric"
                error={fieldError("electricRate") ?? touchedError("electricRate", customElectricInvalid ? "กรอกอัตราที่มากกว่า 0" : undefined)}
              />
            </div>
          )}
          {form.electricChoice === "flat" && (
            <p className="pl-7 text-xs text-fog">โหมดเหมาจ่ายไม่ใช้อัตราต่อหน่วย จะกรอกยอดค่าไฟเต็มตอนสร้างบิล</p>
          )}
          {form.electricChoice === "flat" && base !== null && base.electricMode === "flat" && base.lastElectricPeriod !== null && base.lastElectricAmount !== null && (
            <p className="num pl-7 text-xs text-fog">
              {`ยอดที่ออกบิลล่าสุด ${periodLabel(base.lastElectricPeriod)} · ${moneyText(base.lastElectricAmount)}`}
            </p>
          )}
          {fieldError("electricMode") !== undefined && <p className="text-xs text-danger">{fieldError("electricMode")}</p>}
        </fieldset>

        <fieldset className="grid gap-2">
          <legend className="field-label">ค่าใช้จ่ายเพิ่มเติม</legend>
          <p className="text-xs text-fog">
            รายการที่เก็บทุกเดือนของห้องนี้ ระบบจะเติมให้อัตโนมัติตอนสร้างบิล และแก้ไขเฉพาะเดือนนั้นได้
          </p>
          {form.charges.length > 0 && (
            <div className="flex items-end gap-2" aria-hidden="true">
              <span className="field-label min-w-0 flex-1">ชื่อรายการ</span>
              <span className="field-label w-20 shrink-0 text-right">จำนวนเงิน</span>
              <span className="w-11 shrink-0 md:w-[38px]" />
            </div>
          )}
          {form.charges.map((charge, index) => {
            const showCharges = touched.charges === true;
            const nameInvalid = showCharges && charge.name.trim() === "";
            const amountInvalid = showCharges && parseChargeAmount(charge.amount) === null;

            return (
              <div key={charge.id} className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <input
                    type="text"
                    aria-label={`ชื่อรายการ ${index + 1}`}
                    className={`input-inline w-full text-left${nameInvalid ? " border-danger" : ""}`}
                    value={charge.name}
                    aria-invalid={nameInvalid}
                    onChange={(event) => {
                      editCharge(charge.id, { name: event.target.value });
                    }}
                    onBlur={() => {
                      touch("charges");
                    }}
                  />
                </div>
                <div className="w-20 shrink-0">
                  <input
                    type="text"
                    inputMode="numeric"
                    aria-label={`จำนวนเงิน ${index + 1}`}
                    className={`input-inline num w-full${amountInvalid ? " border-danger" : ""}`}
                    value={charge.amount}
                    aria-invalid={amountInvalid}
                    onChange={(event) => {
                      editCharge(charge.id, { amount: event.target.value });
                    }}
                    onBlur={() => {
                      touch("charges");
                    }}
                  />
                </div>
                <IconButton
                  icon="delete"
                  label="ลบรายการนี้"
                  onClick={() => {
                    removeCharge(charge.id);
                  }}
                />
              </div>
            );
          })}
          <Button variant="ghost" size="sm" icon="add" onClick={appendCharge}>
            เพิ่มรายการ
          </Button>
          {touched.charges === true && chargeInvalid && (
            <p className="text-xs text-danger">ค่าใช้จ่ายเพิ่มเติมต้องมีชื่อและจำนวนเงินเป็นจำนวนเต็มไม่ติดลบ</p>
          )}
          {fieldError("charges") !== undefined && <p className="text-xs text-danger">{fieldError("charges")}</p>}
        </fieldset>

        {serverError !== null && serverError.field === undefined && <p className="text-xs text-danger">{serverError.message}</p>}
      </div>
    </Drawer>
  );
}

const rosterTableName = "ตารางห้องพัก แต่ละแถวคือหนึ่งห้อง พร้อมค่าเช่า ค่าไฟ ค่าใช้จ่ายเพิ่มเติม และสถานะบิลของรอบบิล";

const primaryFillClass = "bg-[#000000] hover:bg-graphite";

export function RoomsPage() {
  const { query, setQuery } = useSearch();
  const [roomList, setRoomList] = useState<Room[]>([]);
  const [tenantList, setTenantList] = useState<Tenant[]>([]);
  const [rateDefaults, setRateDefaults] = useState<RateDefaults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [wideViewport, setWideViewport] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches,
  );
  const [view, setView] = useState<RoomView>(() =>
    typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches ? "table" : "cards",
  );
  const chosenView = useRef<RoomView>("table");
  const [period, setPeriod] = useState<string | null>(null);
  const [roomStatById, setRoomStatById] = useState<Map<string, DashboardRoom>>(() => new Map());
  const [periodKpis, setPeriodKpis] = useState<DashboardKpis | null>(null);
  const [statsPeriod, setStatsPeriod] = useState<string | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState(false);
  const [statsReload, setStatsReload] = useState(0);
  const [menu, setMenu] = useState<RoomMenuState | null>(null);
  const menuTrigger = useRef<HTMLElement | null>(null);
  const rosterRef = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState<RoomForm>(() => emptyRoomForm(null, dormChargeFallback));
  const [base, setBase] = useState<Room | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState<{ message: string; field?: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [list, settings, tenants] = await Promise.all([
        fetchRooms(),
        fetchSettings(),
        fetchTenants().catch(() => [] as Tenant[]),
      ]);
      setRoomList(list);
      setRateDefaults({ waterRate: settings.defaultWaterRate, electricRate: settings.defaultElectricRate });
      setTenantList(tenants);
      setPeriod((current) => current ?? newestBilledPeriod(list) ?? periodAt(0));
    } catch (loadError) {
      setError(loadError instanceof ApiError ? loadError.message : "โหลดข้อมูลห้องไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (period === null) {
      return;
    }

    let active = true;
    setStatsLoading(true);
    setStatsError(false);

    void fetchDashboardStats(period)
      .then((data) => {
        if (!active) {
          return;
        }

        const next = new Map<string, DashboardRoom>();

        for (const room of data.rooms) {
          next.set(room.id, room);
        }

        setRoomStatById(next);
        setPeriodKpis(data.kpis);
        setStatsPeriod(period);
      })
      .catch(() => {
        if (!active) {
          return;
        }

        setRoomStatById(new Map());
        setPeriodKpis(null);
        setStatsPeriod(null);
        setStatsError(true);
      })
      .finally(() => {
        if (active) {
          setStatsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [period, statsReload]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");

    const onMediaChange = (event: MediaQueryListEvent) => {
      setWideViewport(event.matches);
    };

    media.addEventListener("change", onMediaChange);

    return () => {
      media.removeEventListener("change", onMediaChange);
    };
  }, []);

  useEffect(() => {
    setView(wideViewport ? chosenView.current : "cards");
  }, [wideViewport]);

  useEffect(() => {
    if (toast === null) {
      return;
    }

    const timer = window.setTimeout(() => {
      setToast(null);
    }, 3000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [toast]);

  const total = roomList.length;
  const occupiedCount = roomList.filter((room) => room.status === "occupied").length;
  const vacantCount = total - occupiedCount;
  const statsReady = period !== null && statsPeriod === period && !statsLoading && !statsError;

  const needle = query.trim().toLowerCase();
  const needleDigits = needle.replace(/\D/g, "");
  const phoneByRoomId = new Map<string, string>();

  for (const tenant of tenantList) {
    if (tenant.status === "current") {
      phoneByRoomId.set(tenant.roomId, tenant.phone);
    }
  }

  const filtered = roomList.filter((room) => {
    const phone = phoneByRoomId.get(room.id) ?? "";
    const matchesQuery =
      needle === "" ||
      room.roomNumber.toLowerCase().includes(needle) ||
      (room.occupiedBy !== null && room.occupiedBy.toLowerCase().includes(needle)) ||
      (phone !== "" && (phone.includes(needle) || (needleDigits !== "" && phone.replace(/\D/g, "").includes(needleDigits))));
    const statStatus = statsReady ? roomStatById.get(room.id)?.status ?? null : null;
    const matchesStatus =
      statusFilter === "all"
        ? true
        : statusFilter === "occupied"
          ? room.status === "occupied"
          : statusFilter === "vacant"
            ? room.status === "vacant"
            : statusFilter === "unpaid"
              ? statStatus === "unpaid"
              : statStatus === "unbilled";
    return matchesQuery && matchesStatus;
  });

  useEffect(() => {
    rosterRef.current?.querySelector("table")?.setAttribute("aria-label", rosterTableName);
  }, [view, wideViewport, filtered.length]);

  const duplicateId = roomList.some((room) => room.roomNumber === form.id.trim().toUpperCase() && room.id !== base?.id);
  const dormCharges = commonCharges(roomList);

  const billedPeriods = roomList
    .map((room) => room.lastElectricPeriod)
    .filter((value): value is string => value !== null);
  const periodList = periodOptions(billedPeriods);

  const renderBillState = (room: Room): ReactNode => {
    if (statsError) {
      return <span className="text-fog">—</span>;
    }

    if (!statsReady) {
      return <span className="skeleton inline-block h-5 w-24 rounded-full" />;
    }

    return <RoomBillState stat={roomStatById.get(room.id) ?? null} />;
  };

  const filtering = needle !== "" || statusFilter !== "all";
  const loaded = !loading && error === null;
  const supporting = loading
    ? "กำลังโหลดข้อมูลห้อง"
    : error !== null
      ? undefined
      : filtering
        ? `แสดง ${filtered.length} จาก ${total} ห้อง · ทั้งหอมีผู้เช่า ${occupiedCount} · ว่าง ${vacantCount}`
        : `${total} ห้อง · มีผู้เช่า ${occupiedCount} · ว่าง ${vacantCount}`;
  const visibleAnnouncement = loaded && filtering ? `แสดง ${filtered.length} จาก ${total} ห้อง` : "";
  const behindRooms = Array.from(roomStatById.values()).filter((stat) => stat.behindPeriods > 0).length;
  const roundShape =
    statsReady && periodKpis !== null
      ? `${periodKpis.bills}/${periodKpis.totalRooms} มีบิล · เก็บแล้ว ${moneyText(periodKpis.collectedAmount)} · ค้าง ${behindRooms} ห้อง`
      : null;
  const summaryShown = loaded && total > 0 && period !== null;
  const summaryLine = summaryShown ? [periodLabel(period), roundShape].filter((part) => part !== null).join(" · ") : "";
  const recurringLine = summaryShown
    ? `ค่าใช้จ่ายเพิ่มเติมต่อห้อง ${moneyText(chargesTotal(dormCharges))} · ${chargeBreakdownText(dormCharges)}`
    : "";

  const closeMenu = useCallback((restoreFocus: boolean) => {
    if (restoreFocus) {
      menuTrigger.current?.focus();
    }

    setMenu(null);
  }, []);

  const openMenu = (room: Room, trigger: HTMLElement) => {
    if (menu !== null && menu.room.id === room.id) {
      closeMenu(true);
      return;
    }

    const rect = trigger.getBoundingClientRect();
    menuTrigger.current = trigger;
    setMenu({ room, trigger, top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) });
  };

  const openAdd = () => {
    setBase(null);
    setForm(emptyRoomForm(rateDefaults, dormCharges));
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (room: Room) => {
    setBase(room);
    setForm(roomFormOf(room, rateDefaults));
    setFormError(null);
    setFormOpen(true);
  };

  const retryStats = () => {
    setStatsReload((value) => value + 1);
  };

  const chooseView = (next: RoomView) => {
    chosenView.current = next;
    setView(next);
  };

  const saveRoom = async (input: RoomInput) => {
    setSaving(true);
    setFormError(null);

    try {
      if (base === null) {
        const created = await createRoom(input);
        showToast(`เพิ่มห้อง ${created.roomNumber} แล้ว`);
      } else {
        const updated = await updateRoom(base.id, input);
        showToast(`บันทึกห้อง ${updated.roomNumber} แล้ว`);
      }

      setFormOpen(false);
      setBase(null);
      await load();
    } catch (saveError) {
      if (saveError instanceof ApiError) {
        setFormError(saveError.field === undefined ? { message: saveError.message } : { message: saveError.message, field: saveError.field });
      } else {
        setFormError({ message: "บันทึกข้อมูลห้องไม่สำเร็จ" });
      }
    } finally {
      setSaving(false);
    }
  };

  const columns: DataTableColumn<Room>[] = [
    {
      key: "room",
      header: "ห้อง",
      render: (room) => <span className="num font-medium text-charcoal">{room.roomNumber}</span>,
    },
    {
      key: "tenant",
      header: "ผู้เช่า",
      render: (room) =>
        room.occupiedBy === null ? <span className="text-fog">—</span> : <span className="text-charcoal">{room.occupiedBy}</span>,
    },
    {
      key: "rent",
      header: "ค่าเช่า",
      align: "right",
      render: (room) => <span className="num text-charcoal">{moneyText(room.rent)}</span>,
    },
    {
      key: "electric",
      header: "ค่าไฟ",
      align: "right",
      render: (room) => <ElectricFact room={room} defaults={rateDefaults} align="right" />,
    },
    {
      key: "recurring",
      header: "ค่าใช้จ่ายเพิ่มเติม",
      align: "right",
      render: (room) =>
        room.charges.length === 0 ? <span className="text-fog">—</span> : <span className="num text-charcoal">{moneyText(chargesTotal(room.charges))}</span>,
    },
    {
      key: "bill",
      header: "บิลรอบนี้",
      render: (room) => renderBillState(room),
    },
    {
      key: "action",
      header: "⋮",
      align: "right",
      render: (room) => (
        <div className="flex justify-end">
          <IconButton
            className="h-6 w-6"
            icon="more_vert"
            label={`เปิดเมนูจัดการห้อง ${room.roomNumber}`}
            aria-haspopup="menu"
            aria-expanded={menu?.room.id === room.id}
            onClick={(event) => {
              openMenu(room, event.currentTarget);
            }}
          />
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="ห้องพัก"
        supporting={supporting}
        actions={
          <Button variant="primary" icon="add" className={primaryFillClass} onClick={openAdd}>
            เพิ่มห้อง
          </Button>
        }
      />

      <p className="sr-only" role="status" aria-live="polite">
        {visibleAnnouncement}
      </p>

      {error === null && (
        <Card className="mb-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full sm:w-60 md:hidden">
              <Field
                label="ค้นหาห้อง ผู้เช่า หรือเบอร์โทร"
                value={query}
                onChange={setQuery}
                placeholder="เช่น 108/7 หรือ นงลักษณ์"
              />
            </div>
            {period !== null && (
              <div className="w-full sm:w-48">
                <Select
                  label="รอบบิล"
                  value={period}
                  onChange={(value) => {
                    setPeriod(value);
                  }}
                  options={periodList.map((option) => ({ value: option, label: periodLabel(option) }))}
                />
              </div>
            )}
            <div className="w-full sm:w-40">
              <Select
                label="สถานะ"
                value={statusFilter}
                onChange={(value) => {
                  if (value === "all" || value === "occupied" || value === "vacant" || value === "unpaid" || value === "unbilled") {
                    setStatusFilter(value);
                  }
                }}
                options={[
                  { value: "all", label: "ทั้งหมด" },
                  { value: "occupied", label: "มีผู้เช่า" },
                  { value: "vacant", label: "ว่าง" },
                  { value: "unpaid", label: "ยังไม่จ่าย" },
                  { value: "unbilled", label: "ยังไม่ออกบิล" },
                ]}
              />
            </div>
            <div className="w-full sm:w-auto">
              <span className="field-label" id="rooms-view-label">
                มุมมอง
              </span>
              <div className="flex gap-1 rounded-lg border border-ash p-1" role="group" aria-labelledby="rooms-view-label">
                <button
                  type="button"
                  disabled={!wideViewport}
                  aria-pressed={wideViewport && view === "table"}
                  aria-label={wideViewport ? undefined : "ตาราง ใช้ได้บนหน้าจอใหญ่เท่านั้น"}
                  className={`btn ${!wideViewport ? "cursor-not-allowed" : view === "table" ? "bg-status-unpaid-bg font-medium text-deep-sapphire" : "text-steel"}`}
                  onClick={() => {
                    chooseView("table");
                  }}
                >
                  <span className="ms text-[18px]" aria-hidden="true">
                    table_rows
                  </span>
                  ตาราง
                </button>
                <button
                  type="button"
                  aria-pressed={view === "cards"}
                  className={`btn ${view === "cards" ? "bg-status-unpaid-bg font-medium text-deep-sapphire" : "text-steel"}`}
                  onClick={() => {
                    chooseView("cards");
                  }}
                >
                  <span className="ms text-[18px]" aria-hidden="true">
                    grid_view
                  </span>
                  การ์ด
                </button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {summaryShown && (
        <div className="mb-3">
          <p className="num text-sm text-charcoal">{summaryLine}</p>
          <p className="num mt-1 text-xs text-fog">{recurringLine}</p>
          <p className="mt-1 text-xs text-fog">ค้างคือห้องที่บิลล่าสุดเก่ากว่ารอบล่าสุดของหอ</p>
        </div>
      )}

      {loaded && statsError && (
        <div
          className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger bg-danger-soft px-4 py-3"
          role="alert"
        >
          <p className="text-sm text-danger">โหลดสถานะบิลของรอบนี้ไม่สำเร็จ จึงยังบอกไม่ได้ว่าห้องไหนจ่ายแล้ว</p>
          <Button variant="secondary" size="sm" icon="refresh" onClick={retryStats}>
            ลองใหม่
          </Button>
        </div>
      )}

      {loading ? (
        <Card>
          <div className="grid gap-3" aria-busy="true">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-2/3" />
          </div>
        </Card>
      ) : error !== null ? (
        <Card>
          <EmptyState
            icon="cloud_off"
            title="โหลดข้อมูลห้องไม่สำเร็จ"
            description={error}
            action={
              <Button
                variant="secondary"
                icon="refresh"
                onClick={() => {
                  void load();
                }}
              >
                ลองใหม่
              </Button>
            }
          />
        </Card>
      ) : filtered.length === 0 ? (
        total === 0 ? (
          <Card>
            <EmptyState
              icon="door_front"
              title="ยังไม่มีห้องพัก"
              description="เพิ่มห้องแรกเพื่อตั้งค่าเช่า อัตราน้ำไฟ และติดตามสถานะผู้เช่าในที่เดียว"
              action={
                <Button variant="primary" icon="add" className={primaryFillClass} onClick={openAdd}>
                  เพิ่มห้องแรก
                </Button>
              }
            />
          </Card>
        ) : (
          <Card>
            <EmptyState
              icon="search_off"
              title="ไม่พบห้องที่ตรงกับเงื่อนไข"
              description="ลองล้างคำค้นหาหรือตัวกรองสถานะเพื่อดูห้องทั้งหมด"
              action={
                <Button
                  variant="secondary"
                  icon="filter_alt_off"
                  onClick={() => {
                    setStatusFilter("all");
                    setQuery("");
                  }}
                >
                  ล้างตัวกรอง
                </Button>
              }
            />
          </Card>
        )
      ) : view === "table" && wideViewport ? (
        <Card>
          <div ref={rosterRef}>
            <DataTable
              columns={columns}
              rows={filtered}
              getRowKey={(room) => room.id}
              minWidth={860}
              wrapClassName="max-h-[calc(100dvh-28rem)] [&_tbody_tr]:h-11 [&_td]:whitespace-nowrap [&_td]:py-2 [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-canvas-white [&_th]:py-2"
            />
          </div>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((room) => (
            <Card key={room.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="num block text-base font-medium text-charcoal">{room.roomNumber}</span>
                  <span className="block truncate text-xs text-fog">{room.occupiedBy ?? "—"}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <IconButton
                    icon="more_vert"
                    label={`เปิดเมนูจัดการห้อง ${room.roomNumber}`}
                    aria-haspopup="menu"
                    aria-expanded={menu?.room.id === room.id}
                    onClick={(event) => {
                      openMenu(room, event.currentTarget);
                    }}
                  />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-ash pt-3">
                <span className="text-xs text-fog">บิลรอบนี้</span>
                {renderBillState(room)}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
                <div>
                  <dt className="text-xs text-fog">ค่าเช่า</dt>
                  <dd className="num mt-0.5 text-sm text-charcoal">{moneyText(room.rent)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-fog">ค่าไฟ</dt>
                  <dd className="mt-0.5 text-sm">
                    <ElectricFact room={room} defaults={rateDefaults} align="left" />
                  </dd>
                </div>
                {room.charges.length > 0 && (
                  <div>
                    <dt className="text-xs text-fog">ค่าใช้จ่ายเพิ่มเติม</dt>
                    <dd className="num mt-0.5 text-sm text-charcoal">{moneyText(chargesTotal(room.charges))}</dd>
                  </div>
                )}
              </dl>
            </Card>
          ))}
        </div>
      )}

      {menu !== null && (
        <RoomMenu
          state={menu}
          period={period}
          createBill={statsReady && roomStatById.get(menu.room.id)?.status === "unbilled"}
          onClose={closeMenu}
          onEdit={openEdit}
        />
      )}

      <RoomDrawer
        open={formOpen}
        seedKey={base === null ? "add" : base.id}
        base={base}
        form={form}
        defaults={rateDefaults}
        duplicateId={duplicateId}
        saving={saving}
        serverError={formError}
        onChange={setForm}
        onClose={() => {
          setFormOpen(false);
          setBase(null);
          setFormError(null);
        }}
        onSave={(input) => {
          void saveRoom(input);
        }}
      />

      <Toast message={toast ?? ""} open={toast !== null} />
    </div>
  );
}
