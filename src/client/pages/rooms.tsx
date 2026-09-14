import { useCallback, useEffect, useState } from "react";
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
  StatusBadge,
  Toast,
  type DataTableColumn,
} from "../ui";
import { dorm, rooms as pinnedRooms, type Room } from "../mock-data";
import { baht, tenantByRoom } from "./bills-shared";
import { ChoiceRow, numericValue } from "./dorm-shared";

type StatusFilter = "all" | "occupied" | "vacant";
type RoomView = "table" | "cards";
type WaterMode = "default" | "custom";
type ElectricChoice = "default" | "custom" | "flat";

interface RoomForm {
  id: string;
  rent: string;
  previousWater: string;
  previousElectric: string;
  waterMode: WaterMode;
  waterRate: string;
  electricChoice: ElectricChoice;
  electricRate: string;
  flatAmount: string;
}

const emptyRoomForm = (): RoomForm => ({
  id: "",
  rent: "",
  previousWater: "0",
  previousElectric: "0",
  waterMode: "default",
  waterRate: String(dorm.waterRate),
  electricChoice: "default",
  electricRate: String(dorm.electricRate),
  flatAmount: "",
});

const roomFormOf = (room: Room): RoomForm => ({
  id: room.id,
  rent: String(room.rent),
  previousWater: String(room.previousWater),
  previousElectric: String(room.previousElectric),
  waterMode: room.waterRate === dorm.waterRate ? "default" : "custom",
  waterRate: String(room.waterRate),
  electricChoice: room.electricMode === "flat" ? "flat" : room.electricRate === dorm.electricRate ? "default" : "custom",
  electricRate: String(room.electricRate),
  flatAmount: room.flatElectricAmount > 0 ? String(room.flatElectricAmount) : "",
});

function waterRateText(room: Room): string {
  return `${room.waterRate} บาท/หน่วย`;
}

function electricText(room: Room): string {
  return room.electricMode === "flat" ? `${baht(room.flatElectricAmount)} บาท/เดือน` : `${room.electricRate} บาท/หน่วย`;
}

function RoomStatusBadge({ room }: { room: Room }) {
  if (!room.occupied) {
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
  duplicateId: boolean;
  onChange: (form: RoomForm) => void;
  onClose: () => void;
  onSave: (room: Room) => void;
}

function RoomDrawer({ open, base, form, duplicateId, onChange, onClose, onSave }: RoomDrawerProps) {
  const rent = numericValue(form.rent);
  const rentInvalid = rent === null || rent < 0;
  const waterMeter = numericValue(form.previousWater);
  const waterMeterInvalid = waterMeter === null || waterMeter < 0;
  const electricMeter = numericValue(form.previousElectric);
  const electricMeterInvalid = electricMeter === null || electricMeter < 0;
  const customWater = numericValue(form.waterRate);
  const customWaterInvalid = form.waterMode === "custom" && (customWater === null || customWater <= 0);
  const customElectric = numericValue(form.electricRate);
  const customElectricInvalid = form.electricChoice === "custom" && (customElectric === null || customElectric <= 0);
  const flatAmount = numericValue(form.flatAmount);
  const flatInvalid = form.electricChoice === "flat" && (flatAmount === null || flatAmount <= 0);

  const idBlank = form.id.trim() === "";
  const canSave =
    !idBlank &&
    !duplicateId &&
    !rentInvalid &&
    !waterMeterInvalid &&
    !electricMeterInvalid &&
    !customWaterInvalid &&
    !customElectricInvalid &&
    !flatInvalid;

  const update = (patch: Partial<RoomForm>) => {
    onChange({ ...form, ...patch });
  };

  const save = () => {
    onSave({
      id: form.id.trim(),
      rent: rent ?? 0,
      waterRate: form.waterMode === "custom" ? customWater ?? dorm.waterRate : dorm.waterRate,
      electricRate: form.electricChoice === "custom" ? customElectric ?? dorm.electricRate : dorm.electricRate,
      electricMode: form.electricChoice === "flat" ? "flat" : "meter",
      flatElectricAmount: form.electricChoice === "flat" ? flatAmount ?? 0 : 0,
      occupied: base?.occupied ?? false,
      previousWater: waterMeter ?? 0,
      previousElectric: electricMeter ?? 0,
    });
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={base === null ? "เพิ่มห้อง" : `แก้ไขห้อง ${base.id}`}
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
          error={idBlank ? "กรอกเลขห้อง" : duplicateId ? "เลขห้องนี้ถูกใช้แล้ว" : undefined}
        />

        <Field
          label="ค่าเช่า / เดือน (บาท)"
          value={form.rent}
          onChange={(value) => {
            update({ rent: value });
          }}
          inputMode="numeric"
          error={rentInvalid ? "กรอกจำนวนเงินเป็นตัวเลข" : undefined}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="มิเตอร์น้ำเริ่มต้น"
            value={form.previousWater}
            onChange={(value) => {
              update({ previousWater: value });
            }}
            inputMode="numeric"
            error={waterMeterInvalid ? "กรอกตัวเลข" : undefined}
          />
          <Field
            label="มิเตอร์ไฟเริ่มต้น"
            value={form.previousElectric}
            onChange={(value) => {
              update({ previousElectric: value });
            }}
            inputMode="numeric"
            error={electricMeterInvalid ? "กรอกตัวเลข" : undefined}
          />
        </div>

        <fieldset className="grid gap-2">
          <legend className="field-label">ค่าน้ำ</legend>
          <ChoiceRow
            name="room-water"
            checked={form.waterMode === "default"}
            title="ใช้อัตราทั้งหอ"
            helper={`ใช้อัตราทั้งหอ ${dorm.waterRate} บาท/หน่วย`}
            onSelect={() => {
              update({ waterMode: "default" });
            }}
          />
          <ChoiceRow
            name="room-water"
            checked={form.waterMode === "custom"}
            title="กำหนดเอง"
            helper={`ห้องนี้คิดค่าน้ำเอง เริ่มจากอัตราทั้งหอ ${dorm.waterRate} บาท/หน่วย`}
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
                error={customWaterInvalid ? "กรอกอัตราที่มากกว่า 0" : undefined}
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
            helper={`ใช้อัตราทั้งหอ ${dorm.electricRate} บาท/หน่วย`}
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
                error={customElectricInvalid ? "กรอกอัตราที่มากกว่า 0" : undefined}
              />
            </div>
          )}
          {form.electricChoice === "flat" && (
            <div className="pl-7">
              <Field
                label="ค่าไฟเหมาจ่ายต่อเดือน (บาท)"
                value={form.flatAmount}
                onChange={(value) => {
                  update({ flatAmount: value });
                }}
                inputMode="numeric"
                error={flatInvalid ? "กรอกจำนวนเงินต่อเดือน" : undefined}
              />
            </div>
          )}
        </fieldset>
      </div>
    </Drawer>
  );
}

export function RoomsPage() {
  const { query, setQuery } = useSearch();
  const [roomList, setRoomList] = useState<Room[]>(() => pinnedRooms.map((room) => ({ ...room })));
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [view, setView] = useState<RoomView>(() =>
    typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches ? "table" : "cards",
  );
  const [menuId, setMenuId] = useState<string | null>(null);
  const [form, setForm] = useState<RoomForm>(emptyRoomForm);
  const [base, setBase] = useState<Room | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
  }, []);

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
  const occupiedCount = roomList.filter((room) => room.occupied).length;
  const vacantCount = total - occupiedCount;

  const needle = query.trim().toLowerCase();
  const filtered = roomList.filter((room) => {
    const tenant = tenantByRoom.get(room.id);
    const matchesQuery =
      needle === "" || room.id.toLowerCase().includes(needle) || (tenant !== undefined && tenant.name.toLowerCase().includes(needle));
    const matchesStatus = statusFilter === "all" ? true : statusFilter === "occupied" ? room.occupied : !room.occupied;
    return matchesQuery && matchesStatus;
  });

  const menuRoom = roomList.find((room) => room.id === menuId) ?? null;
  const duplicateId = roomList.some((room) => room.id === form.id.trim() && room.id !== base?.id);

  const openAdd = () => {
    setBase(null);
    setForm(emptyRoomForm());
    setFormOpen(true);
  };

  const openEdit = (room: Room) => {
    setBase(room);
    setForm(roomFormOf(room));
    setFormOpen(true);
  };

  const saveRoom = (room: Room) => {
    setRoomList((prev) => (base === null ? [...prev, room] : prev.map((item) => (item.id === base.id ? room : item))));
    setFormOpen(false);
    showToast(base === null ? `เพิ่มห้อง ${room.id} แล้ว` : `บันทึกห้อง ${room.id} แล้ว`);
  };

  const columns: DataTableColumn<Room>[] = [
    {
      key: "room",
      header: "ห้อง",
      render: (room) => <span className="num font-medium text-charcoal">{room.id}</span>,
    },
    {
      key: "status",
      header: "สถานะ",
      render: (room) => <RoomStatusBadge room={room} />,
    },
    {
      key: "tenant",
      header: "ผู้เช่า",
      render: (room) => {
        const tenant = tenantByRoom.get(room.id);
        return tenant === undefined ? <span className="text-fog">ยังไม่มีผู้เช่า</span> : <span className="text-charcoal">{tenant.name}</span>;
      },
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
          <span className="num">{waterRateText(room)}</span>
          {room.waterRate !== dorm.waterRate && <span className="chip">อัตราพิเศษ</span>}
        </div>
      ),
    },
    {
      key: "electric",
      header: "ค่าไฟ",
      align: "right",
      render: (room) => (
        <div className="flex items-center justify-end gap-2">
          <span className="num">{electricText(room)}</span>
          {room.electricMode === "flat" && <span className="chip">ไฟเหมา</span>}
        </div>
      ),
    },
    {
      key: "meter",
      header: "มิเตอร์ล่าสุด",
      align: "right",
      render: (room) => (
        <span className="num text-steel">
          น้ำ {room.previousWater} · ไฟ {room.previousElectric}
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
            label={`เปิดเมนูจัดการห้อง ${room.id}`}
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
        supporting={`${total} ห้อง · มีผู้เช่า ${occupiedCount} · ว่าง ${vacantCount}`}
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

      {filtered.length === 0 ? (
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
                  <span className="num block text-base font-medium text-charcoal">{room.id}</span>
                  <span className="block text-xs text-fog">{tenantByRoom.get(room.id)?.name ?? "ยังไม่มีผู้เช่า"}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <RoomStatusBadge room={room} />
                  <IconButton
                    icon="more_vert"
                    label={`เปิดเมนูจัดการห้อง ${room.id}`}
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
                  <dd className="num text-sm text-charcoal">{waterRateText(room)}</dd>
                  {room.waterRate !== dorm.waterRate && <span className="chip mt-1">อัตราพิเศษ</span>}
                </div>
                <div>
                  <dt className="text-xs text-fog">ค่าไฟ</dt>
                  <dd className="num text-sm text-charcoal">{electricText(room)}</dd>
                  {room.electricMode === "flat" && <span className="chip mt-1">ไฟเหมา</span>}
                </div>
                <div>
                  <dt className="text-xs text-fog">มิเตอร์ล่าสุด</dt>
                  <dd className="num text-sm text-charcoal">
                    น้ำ {room.previousWater} · ไฟ {room.previousElectric}
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
        title={menuRoom === null ? "จัดการห้อง" : `จัดการห้อง ${menuRoom.id}`}
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
            {!menuRoom.occupied && (
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
        duplicateId={duplicateId}
        onChange={setForm}
        onClose={() => {
          setFormOpen(false);
        }}
        onSave={saveRoom}
      />

      <Toast message={toast ?? ""} open={toast !== null} />
    </div>
  );
}
