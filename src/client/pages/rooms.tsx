import { useCallback, useEffect, useState } from "react";
import { ApiError, createRoom, fetchRooms, fetchSettings, updateRoom, type BillCharge, type Room, type RoomInput } from "../api";
import { useSearch } from "../search";
import {
  Badge,
  Button,
  Card,
  DataTable,
  Dialog,
  Drawer,
  EmptyState,
  Field,
  IconButton,
  PageHeader,
  Select,
  Skeleton,
  StatusBadge,
  Toast,
  type DataTableColumn,
} from "../ui";
import { baht } from "./bills-shared";
import { ChoiceRow, numericValue } from "./dorm-shared";

type StatusFilter = "all" | "occupied" | "vacant";
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

function newChargeDraft(): ChargeDraft {
  chargeSequence += 1;
  return { id: `charge-${chargeSequence}`, name: "", amount: "" };
}

function chargeDrafts(charges: BillCharge[]): ChargeDraft[] {
  return charges.map((charge) => {
    chargeSequence += 1;
    return { id: `charge-${chargeSequence}`, name: charge.name, amount: String(charge.amount) };
  });
}

function parseChargeAmount(value: string): number | null {
  const trimmed = value.trim();

  if (trimmed === "") {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

const emptyRoomForm = (defaults: RateDefaults): RoomForm => ({
  id: "",
  rent: "",
  waterMeterInit: "0",
  electricMeterInit: "0",
  waterMode: "default",
  waterRate: String(defaults.waterRate),
  electricChoice: "default",
  electricRate: String(defaults.electricRate),
  charges: [],
});

const roomFormOf = (room: Room, defaults: RateDefaults): RoomForm => ({
  id: room.roomNumber,
  rent: String(room.rent),
  waterMeterInit: String(room.waterMeterInit),
  electricMeterInit: String(room.electricMeterInit),
  waterMode: room.waterRate === null ? "default" : "custom",
  waterRate: String(room.waterRate ?? defaults.waterRate),
  electricChoice: room.electricMode === "flat" ? "flat" : room.electricRate === null ? "default" : "custom",
  electricRate: String(room.electricRate ?? defaults.electricRate),
  charges: chargeDrafts(room.charges),
});

function waterRateText(room: Room, defaults: RateDefaults): string {
  return `${room.waterRate ?? defaults.waterRate} บาท/หน่วย`;
}

function electricText(room: Room, defaults: RateDefaults): string {
  if (room.electricMode === "flat") {
    return "เหมาจ่ายรายเดือน";
  }

  return `${room.electricRate ?? defaults.electricRate} บาท/หน่วย`;
}

function RoomStatusBadge({ room }: { room: Room }) {
  if (room.status === "vacant") {
    return <StatusBadge status="vacant" />;
  }

  return (
    <Badge tone="paid" icon="person">
      มีผู้เช่า
    </Badge>
  );
}

interface RoomDrawerProps {
  open: boolean;
  base: Room | null;
  form: RoomForm;
  defaults: RateDefaults;
  duplicateId: boolean;
  saving: boolean;
  serverError: { message: string; field?: string } | null;
  onChange: (form: RoomForm) => void;
  onClose: () => void;
  onSave: (input: RoomInput) => void;
}

function RoomDrawer({ open, base, form, defaults, duplicateId, saving, serverError, onChange, onClose, onSave }: RoomDrawerProps) {
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
    };

    if (base !== null) {
      input.charges = form.charges.map((charge) => ({ name: charge.name.trim(), amount: parseChargeAmount(charge.amount) ?? 0 }));
    }

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
          <Button variant="primary" icon="save" disabled={!canSave} onClick={save}>
            บันทึกห้อง
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field
          label="เลขห้อง"
          value={form.id}
          onChange={(value) => {
            update({ id: value });
          }}
          placeholder="เช่น A119"
          error={idBlank ? "กรอกเลขห้อง" : fieldError("roomNumber") ?? (duplicateId ? "เลขห้องนี้ถูกใช้แล้ว" : undefined)}
        />

        <Field
          label="ค่าเช่า / เดือน (บาท)"
          value={form.rent}
          onChange={(value) => {
            update({ rent: value });
          }}
          inputMode="numeric"
          error={rentInvalid ? "กรอกจำนวนเงินเป็นตัวเลข" : fieldError("rent")}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="มิเตอร์น้ำเริ่มต้น"
            value={form.waterMeterInit}
            onChange={(value) => {
              update({ waterMeterInit: value });
            }}
            inputMode="numeric"
            error={waterMeterInvalid ? "กรอกตัวเลข" : fieldError("waterMeterInit")}
          />
          <Field
            label="มิเตอร์ไฟเริ่มต้น"
            value={form.electricMeterInit}
            onChange={(value) => {
              update({ electricMeterInit: value });
            }}
            inputMode="numeric"
            error={electricMeterInvalid ? "กรอกตัวเลข" : fieldError("electricMeterInit")}
          />
        </div>

        <fieldset className="grid gap-2">
          <legend className="field-label">ค่าน้ำ</legend>
          <ChoiceRow
            name="room-water"
            checked={form.waterMode === "default"}
            title="ใช้อัตราทั้งหอ"
            helper={`ใช้อัตราทั้งหอ ${defaults.waterRate} บาท/หน่วย`}
            onSelect={() => {
              update({ waterMode: "default" });
            }}
          />
          <ChoiceRow
            name="room-water"
            checked={form.waterMode === "custom"}
            title="กำหนดเอง"
            helper={`ห้องนี้คิดค่าน้ำเอง เริ่มจากอัตราทั้งหอ ${defaults.waterRate} บาท/หน่วย`}
            onSelect={() => {
              update({ waterMode: "custom" });
            }}
          />
          {form.waterMode === "custom" && (
            <div className="pl-7">
              <Field
                label="อัตราค่าน้ำต่อหน่วย (บาท)"
                value={form.waterRate}
                onChange={(value) => {
                  update({ waterRate: value });
                }}
                inputMode="numeric"
                error={customWaterInvalid ? "กรอกอัตราที่มากกว่า 0" : fieldError("waterRate")}
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
            helper={`ใช้อัตราทั้งหอ ${defaults.electricRate} บาท/หน่วย`}
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
            <div className="pl-7">
              <Field
                label="อัตราค่าไฟต่อหน่วย (บาท)"
                value={form.electricRate}
                onChange={(value) => {
                  update({ electricRate: value });
                }}
                inputMode="numeric"
                error={customElectricInvalid ? "กรอกอัตราที่มากกว่า 0" : fieldError("electricRate")}
              />
            </div>
          )}
          {form.electricChoice === "flat" && (
            <p className="pl-7 text-xs text-fog">โหมดเหมาจ่ายไม่ใช้อัตราต่อหน่วย จะกรอกยอดค่าไฟเต็มตอนสร้างบิล</p>
          )}
          {fieldError("electricMode") !== undefined && <p className="text-xs text-danger">{fieldError("electricMode")}</p>}
        </fieldset>

        {base !== null && (
          <fieldset className="grid gap-2">
            <legend className="field-label">ค่าใช้จ่ายประจำ</legend>
            <p className="text-xs text-fog">รายการที่เก็บทุกเดือนของห้องนี้ ระบบจะเติมให้อัตโนมัติตอนสร้างบิล และแก้ไขเฉพาะเดือนนั้นได้</p>
            {form.charges.map((charge) => {
              const nameInvalid = charge.name.trim() === "";
              const amountInvalid = parseChargeAmount(charge.amount) === null;

              return (
                <div key={charge.id} className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <label className="field-label" htmlFor={`${charge.id}-name`}>
                      ชื่อรายการ
                    </label>
                    <input
                      id={`${charge.id}-name`}
                      type="text"
                      className={`input-inline w-full text-left${nameInvalid ? " border-danger" : ""}`}
                      value={charge.name}
                      aria-invalid={nameInvalid}
                      onChange={(event) => {
                        editCharge(charge.id, { name: event.target.value });
                      }}
                    />
                  </div>
                  <div className="w-20 shrink-0">
                    <label className="field-label" htmlFor={`${charge.id}-amount`}>
                      จำนวนเงิน
                    </label>
                    <input
                      id={`${charge.id}-amount`}
                      type="text"
                      inputMode="numeric"
                      className={`input-inline num w-full${amountInvalid ? " border-danger" : ""}`}
                      value={charge.amount}
                      aria-invalid={amountInvalid}
                      onChange={(event) => {
                        editCharge(charge.id, { amount: event.target.value });
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
            {chargeInvalid && <p className="text-xs text-danger">ค่าใช้จ่ายประจำต้องมีชื่อและจำนวนเงินเป็นจำนวนเต็มไม่ติดลบ</p>}
            {fieldError("charges") !== undefined && <p className="text-xs text-danger">{fieldError("charges")}</p>}
          </fieldset>
        )}

        {serverError !== null && serverError.field === undefined && <p className="text-xs text-danger">{serverError.message}</p>}
      </div>
    </Drawer>
  );
}

export function RoomsPage() {
  const { query, setQuery } = useSearch();
  const [roomList, setRoomList] = useState<Room[]>([]);
  const [rateDefaults, setRateDefaults] = useState<RateDefaults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [view, setView] = useState<RoomView>(() =>
    typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches ? "table" : "cards",
  );
  const [menuId, setMenuId] = useState<string | null>(null);
  const [form, setForm] = useState<RoomForm>(() => emptyRoomForm({ waterRate: 0, electricRate: 0 }));
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
      const [list, settings] = await Promise.all([fetchRooms(), fetchSettings()]);
      setRoomList(list);
      setRateDefaults({ waterRate: settings.defaultWaterRate, electricRate: settings.defaultElectricRate });
    } catch (loadError) {
      setError(loadError instanceof ApiError ? loadError.message : "โหลดข้อมูลห้องไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  const needle = query.trim().toLowerCase();
  const filtered = roomList.filter((room) => {
    const matchesQuery =
      needle === "" ||
      room.roomNumber.toLowerCase().includes(needle) ||
      (room.occupiedBy !== null && room.occupiedBy.toLowerCase().includes(needle));
    const matchesStatus = statusFilter === "all" ? true : statusFilter === "occupied" ? room.status === "occupied" : room.status === "vacant";
    return matchesQuery && matchesStatus;
  });

  const menuRoom = roomList.find((room) => room.id === menuId) ?? null;
  const duplicateId = roomList.some((room) => room.roomNumber === form.id.trim().toUpperCase() && room.id !== base?.id);
  const defaults = rateDefaults ?? { waterRate: 0, electricRate: 0 };

  const openAdd = () => {
    setBase(null);
    setForm(emptyRoomForm(defaults));
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (room: Room) => {
    setBase(room);
    setForm(roomFormOf(room, defaults));
    setFormError(null);
    setFormOpen(true);
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
      key: "status",
      header: "สถานะ",
      render: (room) => <RoomStatusBadge room={room} />,
    },
    {
      key: "tenant",
      header: "ผู้เช่า",
      render: (room) =>
        room.occupiedBy === null ? <span className="text-fog">ยังไม่มีผู้เช่า</span> : <span className="text-charcoal">{room.occupiedBy}</span>,
    },
    {
      key: "rent",
      header: "ค่าเช่า",
      align: "right",
      render: (room) => <span className="num">{baht(room.rent)}</span>,
    },
    {
      key: "water",
      header: "ค่าน้ำ",
      align: "right",
      render: (room) => (
        <div className="flex items-center justify-end gap-2">
          <span className="num">{waterRateText(room, defaults)}</span>
          {room.waterRate !== null && <span className="chip">อัตราพิเศษ</span>}
        </div>
      ),
    },
    {
      key: "electric",
      header: "ค่าไฟ",
      align: "right",
      render: (room) => (
        <div className="flex items-center justify-end gap-2">
          <span className="num">{electricText(room, defaults)}</span>
          {room.electricMode === "flat" && <span className="chip">ไฟเหมา</span>}
          {room.electricMode === "meter" && room.electricRate !== null && <span className="chip">อัตราพิเศษ</span>}
        </div>
      ),
    },
    {
      key: "meter",
      header: "มิเตอร์เริ่มต้น",
      align: "right",
      render: (room) => (
        <span className="num text-steel">
          น้ำ {room.waterMeterInit} · ไฟ {room.electricMeterInit}
        </span>
      ),
    },
    {
      key: "action",
      header: "จัดการ",
      align: "right",
      render: (room) => (
        <div className="flex justify-end">
          <IconButton
            icon="more_vert"
            label={`เปิดเมนูจัดการห้อง ${room.roomNumber}`}
            onClick={() => {
              setMenuId(room.id);
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
        supporting={loading ? "กำลังโหลดข้อมูล" : `${total} ห้อง · มีผู้เช่า ${occupiedCount} · ว่าง ${vacantCount}`}
        actions={
          <Button variant="primary" icon="add" onClick={openAdd}>
            เพิ่มห้อง
          </Button>
        }
      />

      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-60 md:hidden">
            <Field label="ค้นหาห้องหรือผู้เช่า" value={query} onChange={setQuery} placeholder="เช่น A103 หรือ ธนา" />
          </div>
          <div className="w-full sm:w-40">
            <Select
              label="สถานะ"
              value={statusFilter}
              onChange={(value) => {
                if (value === "all" || value === "occupied" || value === "vacant") {
                  setStatusFilter(value);
                }
              }}
              options={[
                { value: "all", label: "ทั้งหมด" },
                { value: "occupied", label: "มีผู้เช่า" },
                { value: "vacant", label: "ว่าง" },
              ]}
            />
          </div>
          <div className="w-full sm:w-auto">
            <span className="field-label">มุมมอง</span>
            <div className="flex gap-1 rounded-lg border border-ash p-1" role="group" aria-label="มุมมองห้องพัก">
              <button
                type="button"
                aria-pressed={view === "table"}
                className={`btn ${view === "table" ? "bg-paper-mist text-charcoal" : "text-steel"}`}
                onClick={() => {
                  setView("table");
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
                className={`btn ${view === "cards" ? "bg-paper-mist text-charcoal" : "text-steel"}`}
                onClick={() => {
                  setView("cards");
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
                <Button variant="primary" icon="add" onClick={openAdd}>
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
      ) : view === "table" ? (
        <Card>
          <DataTable columns={columns} rows={filtered} getRowKey={(room) => room.id} minWidth={1040} />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((room) => (
            <Card key={room.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="num block text-base font-medium text-charcoal">{room.roomNumber}</span>
                  <span className="block text-xs text-fog">{room.occupiedBy ?? "ยังไม่มีผู้เช่า"}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <RoomStatusBadge room={room} />
                  <IconButton
                    icon="more_vert"
                    label={`เปิดเมนูจัดการห้อง ${room.roomNumber}`}
                    onClick={() => {
                      setMenuId(room.id);
                    }}
                  />
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-ash pt-3">
                <div>
                  <dt className="text-xs text-fog">ค่าเช่า</dt>
                  <dd className="num text-sm text-charcoal">{baht(room.rent)} บาท</dd>
                </div>
                <div>
                  <dt className="text-xs text-fog">ค่าน้ำ</dt>
                  <dd className="num text-sm text-charcoal">{waterRateText(room, defaults)}</dd>
                  {room.waterRate !== null && <span className="chip mt-1">อัตราพิเศษ</span>}
                </div>
                <div>
                  <dt className="text-xs text-fog">ค่าไฟ</dt>
                  <dd className="num text-sm text-charcoal">{electricText(room, defaults)}</dd>
                  {room.electricMode === "flat" && <span className="chip mt-1">ไฟเหมา</span>}
                  {room.electricMode === "meter" && room.electricRate !== null && <span className="chip mt-1">อัตราพิเศษ</span>}
                </div>
                <div>
                  <dt className="text-xs text-fog">มิเตอร์เริ่มต้น</dt>
                  <dd className="num text-sm text-charcoal">
                    น้ำ {room.waterMeterInit} · ไฟ {room.electricMeterInit}
                  </dd>
                </div>
              </dl>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={menuRoom !== null}
        onClose={() => {
          setMenuId(null);
        }}
        title={menuRoom === null ? "จัดการห้อง" : `จัดการห้อง ${menuRoom.roomNumber}`}
        footer={
          <Button
            variant="ghost"
            onClick={() => {
              setMenuId(null);
            }}
          >
            ปิด
          </Button>
        }
      >
        {menuRoom !== null && (
          <div className="grid gap-2">
            <Button
              variant="secondary"
              icon="edit"
              className="w-full justify-start"
              onClick={() => {
                setMenuId(null);
                openEdit(menuRoom);
              }}
            >
              แก้ไขห้อง
            </Button>
            <Button
              variant="secondary"
              icon="receipt_long"
              className="w-full justify-start"
              onClick={() => {
                setMenuId(null);
                window.location.hash = "#bills";
              }}
            >
              ดูบิล
            </Button>
            {menuRoom.status === "vacant" && (
              <Button
                variant="secondary"
                icon="person_add"
                className="w-full justify-start"
                onClick={() => {
                  setMenuId(null);
                  window.location.hash = "#tenants";
                }}
              >
                เพิ่มผู้เช่า
              </Button>
            )}
          </div>
        )}
      </Dialog>

      <RoomDrawer
        open={formOpen}
        base={base}
        form={form}
        defaults={defaults}
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
