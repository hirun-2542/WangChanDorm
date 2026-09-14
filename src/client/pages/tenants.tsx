import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import { useSearch } from "../search";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  Dialog,
  Drawer,
  EmptyState,
  Field,
  PageHeader,
  Select,
  StatusBadge,
  Toast,
  type DataTableColumn,
} from "../ui";
import {
  bills as pinnedBills,
  rooms as pinnedRooms,
  tenants as pinnedTenants,
  type Room,
  type Tenant,
  type TenantStatus,
} from "../mock-data";
import { baht, todayIso } from "./bills-shared";
import { PairingSurface, seedPendingUsers, type PairingResult, type PendingLineUser } from "./tenants-pairing";

const thaiMonthsShort = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

function formatThaiDate(iso: string): string {
  const [yearPart, monthPart, dayPart] = iso.split("-");
  const year = Number(yearPart);
  const month = Number(monthPart);

  if (!Number.isFinite(year) || !Number.isFinite(month) || dayPart === undefined) {
    return iso;
  }

  const monthLabel = thaiMonthsShort[month - 1] ?? "";
  const shortYear = String((year + 543) % 100).padStart(2, "0");
  return `${dayPart} ${monthLabel} ${shortYear}`;
}

function parseThaiDate(label: string): string {
  const [dayPart, monthPart, yearPart] = label.split(" ");
  const monthIndex = monthPart === undefined ? -1 : thaiMonthsShort.indexOf(monthPart);
  const day = Number(dayPart);
  const shortYear = Number(yearPart);

  if (monthIndex < 0 || !Number.isFinite(day) || !Number.isFinite(shortYear)) {
    return "";
  }

  const year = 2500 + shortYear - 543;
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function LineStatusBadge({ linked }: { linked: boolean }) {
  if (linked) {
    return (
      <Badge tone="paid" icon="check_circle">
        เชื่อมแล้ว
      </Badge>
    );
  }

  return (
    <Badge tone="review" icon="error">
      ยังไม่เชื่อม
    </Badge>
  );
}

function TenantStatusBadge({ status }: { status: TenantStatus }) {
  if (status === "current") {
    return (
      <Badge tone="paid" icon="check_circle">
        ปัจจุบัน
      </Badge>
    );
  }

  return (
    <Badge tone="vacant" icon="logout">
      ย้ายออกแล้ว
    </Badge>
  );
}

function DetailRow({ label, value, numeric }: { label: string; value: string; numeric?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-steel">{label}</dt>
      <dd className={numeric === true ? "num text-charcoal" : "text-charcoal"}>{value}</dd>
    </div>
  );
}

const tabOptions: { id: TenantStatus; label: string }[] = [
  { id: "current", label: "ปัจจุบัน" },
  { id: "moved-out", label: "ย้ายออกแล้ว" },
];

function TenantsTabs({ value, onChange }: { value: TenantStatus; onChange: (next: TenantStatus) => void }) {
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
      return;
    }

    event.preventDefault();
    const step = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (index + step + tabOptions.length) % tabOptions.length;
    const next = tabOptions[nextIndex];

    if (next !== undefined) {
      onChange(next.id);
      document.getElementById(`tenants-tab-${next.id}`)?.focus();
    }
  };

  return (
    <div role="tablist" aria-label="สถานะผู้เช่า" className="flex gap-1 rounded-lg border border-ash p-1">
      {tabOptions.map((option, index) => {
        const active = option.id === value;

        return (
          <button
            key={option.id}
            id={`tenants-tab-${option.id}`}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls="tenants-panel"
            tabIndex={active ? 0 : -1}
            className={`btn ${active ? "bg-paper-mist text-charcoal" : "text-steel"}`}
            onClick={() => {
              onChange(option.id);
            }}
            onKeyDown={(event) => {
              onTabKeyDown(event, index);
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

interface TenantFormValues {
  name: string;
  phone: string;
  roomId: string;
  checkIn: string;
}

interface TenantFormDrawerProps {
  open: boolean;
  seedKey: string;
  title: string;
  submitLabel: string;
  initial: TenantFormValues;
  roomLabel: string;
  roomOptions: { value: string; label: string }[];
  roomHelper: string;
  onClose: () => void;
  onSave: (values: TenantFormValues) => void;
}

function TenantFormDrawer({
  open,
  seedKey,
  title,
  submitLabel,
  initial,
  roomLabel,
  roomOptions,
  roomHelper,
  onClose,
  onSave,
}: TenantFormDrawerProps) {
  const [name, setName] = useState(initial.name);
  const [phone, setPhone] = useState(initial.phone);
  const [roomId, setRoomId] = useState(initial.roomId);
  const [checkIn, setCheckIn] = useState(initial.checkIn);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [seededKey, setSeededKey] = useState<string | null>(null);

  if (!open) {
    if (seededKey !== null) {
      setSeededKey(null);
    }
  } else if (seededKey !== seedKey) {
    setSeededKey(seedKey);
    setName(initial.name);
    setPhone(initial.phone);
    setRoomId(initial.roomId);
    setCheckIn(initial.checkIn);
    setTouched({});
  }

  const nameValid = name.trim() !== "";
  const phoneValid = phone.trim() !== "";
  const roomValid = roomId !== "";
  const dateValid = checkIn !== "";
  const canSave = nameValid && phoneValid && roomValid && dateValid;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button
            variant="primary"
            icon="save"
            disabled={!canSave}
            onClick={() => {
              onSave({ name: name.trim(), phone: phone.trim(), roomId, checkIn });
            }}
          >
            {submitLabel}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field
          label="ชื่อ-นามสกุล"
          value={name}
          onChange={(value) => {
            setName(value);
            setTouched((prev) => ({ ...prev, name: true }));
          }}
          error={touched.name === true && !nameValid ? "กรุณากรอกชื่อ-นามสกุล" : undefined}
        />

        <Field
          label="เบอร์โทร"
          value={phone}
          onChange={(value) => {
            setPhone(value);
            setTouched((prev) => ({ ...prev, phone: true }));
          }}
          inputMode="tel"
          error={touched.phone === true && !phoneValid ? "กรุณากรอกเบอร์โทร" : undefined}
        />

        <Select
          label={roomLabel}
          value={roomId}
          onChange={setRoomId}
          options={roomOptions}
          helper={touched.room === true && !roomValid ? "กรุณาเลือกห้อง" : roomHelper}
        />

        <Field
          label="วันเข้า"
          type="date"
          value={checkIn}
          onChange={setCheckIn}
          error={touched.checkIn === true && !dateValid ? "กรุณาเลือกวันเข้า" : undefined}
        />
      </div>
    </Drawer>
  );
}

interface CheckoutDialogProps {
  tenant: Tenant | null;
  onClose: () => void;
  onConfirm: (tenant: Tenant, dateIso: string) => void;
}

function CheckoutDialog({ tenant, onClose, onConfirm }: CheckoutDialogProps) {
  const [date, setDate] = useState(todayIso());
  const [seededId, setSeededId] = useState<string | null>(null);

  if (tenant !== null && tenant.id !== seededId) {
    setSeededId(tenant.id);
    setDate(todayIso());
  }

  if (tenant === null) {
    return (
      <Dialog open={false} onClose={onClose} title="เช็คเอาท์ผู้เช่า">
        {null}
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`เช็คเอาท์ · ${tenant.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button
            variant="danger-soft"
            icon="logout"
            disabled={date === ""}
            onClick={() => {
              onConfirm(tenant, date);
            }}
          >
            ยืนยันเช็คเอาท์
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="วันที่ออก" type="date" value={date} onChange={setDate} />

        <div className="panel-muted">
          <p className="text-sm text-charcoal">หลังยืนยันเช็คเอาท์</p>
          <p className="mt-1 text-sm text-steel">
            ห้อง {tenant.roomId} จะเปลี่ยนเป็นห้องว่าง แต่ประวัติผู้เช่าของ {tenant.name} จะยังถูกเก็บไว้ในระบบ
          </p>
        </div>
      </div>
    </Dialog>
  );
}

export function TenantsPage() {
  const [tenantList, setTenantList] = useState<Tenant[]>(() => pinnedTenants.map((tenant) => ({ ...tenant })));
  const [roomList, setRoomList] = useState<Room[]>(() => pinnedRooms.map((room) => ({ ...room })));
  const [pendingUsers, setPendingUsers] = useState<PendingLineUser[]>(() => seedPendingUsers());
  const [tab, setTab] = useState<TenantStatus>("current");
  const [pairingOpen, setPairingOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Tenant | null>(null);
  const [checkoutTarget, setCheckoutTarget] = useState<Tenant | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const { query, setQuery } = useSearch();

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

  const markPaired = (result: PairingResult) => {
    setTenantList((prev) => prev.map((item) => (item.id === result.tenantId ? { ...item, lineLinked: true } : item)));
    setPendingUsers((prev) => prev.filter((user) => user.id !== result.pendingId));
    showToast(`เชื่อม LINE กับ คุณ${result.tenantName} แล้ว`);
  };

  if (pairingOpen) {
    return (
      <div>
        <PairingSurface
          pending={pendingUsers}
          tenants={tenantList}
          onPaired={markPaired}
          onBack={() => {
            setPairingOpen(false);
          }}
        />
        <Toast message={toast ?? ""} open={toast !== null} />
      </div>
    );
  }

  const currentTenants = tenantList.filter((tenant) => tenant.status === "current");
  const movedOutTenants = tenantList.filter((tenant) => tenant.status === "moved-out");
  const visibleTenants = tab === "current" ? currentTenants : movedOutTenants;
  const vacantRooms = roomList.filter((room) => !room.occupied);
  const selectedTenant = tenantList.find((tenant) => tenant.id === selectedId) ?? null;

  const needle = query.trim().toLowerCase();
  const filtered = visibleTenants.filter(
    (tenant) =>
      needle === "" ||
      tenant.name.toLowerCase().includes(needle) ||
      tenant.roomId.toLowerCase().includes(needle) ||
      tenant.phone.includes(needle),
  );

  const recentBills = selectedTenant === null ? [] : pinnedBills.filter((bill) => bill.tenantId === selectedTenant.id);

  const openDetail = (tenant: Tenant) => {
    setSelectedId(tenant.id);
  };

  const addTenant = (values: TenantFormValues) => {
    const created: Tenant = {
      id: `t-${values.roomId.toLowerCase()}-${String(Date.now())}`,
      name: values.name,
      roomId: values.roomId,
      phone: values.phone,
      checkIn: formatThaiDate(values.checkIn),
      lineLinked: false,
      status: "current",
      movedOutAt: null,
    };

    setTenantList((prev) => [...prev, created]);
    setRoomList((prev) => prev.map((room) => (room.id === values.roomId ? { ...room, occupied: true } : room)));
    setAddOpen(false);
    showToast(`เพิ่มผู้เช่า ${created.name} ห้อง ${created.roomId} แล้ว`);
  };

  const saveEdit = (tenant: Tenant, values: TenantFormValues) => {
    setTenantList((prev) =>
      prev.map((item) =>
        item.id === tenant.id
          ? { ...item, name: values.name, phone: values.phone, roomId: values.roomId, checkIn: formatThaiDate(values.checkIn) }
          : item,
      ),
    );

    if (values.roomId !== tenant.roomId) {
      setRoomList((prev) =>
        prev.map((room) => {
          if (room.id === tenant.roomId) {
            return { ...room, occupied: false };
          }

          if (room.id === values.roomId) {
            return { ...room, occupied: true };
          }

          return room;
        }),
      );
    }

    setEditTarget(null);
    showToast(`บันทึกข้อมูล ${values.name} แล้ว`);
  };

  const confirmCheckout = (tenant: Tenant, dateIso: string) => {
    setTenantList((prev) =>
      prev.map((item) =>
        item.id === tenant.id ? { ...item, status: "moved-out", movedOutAt: formatThaiDate(dateIso) } : item,
      ),
    );
    setRoomList((prev) => prev.map((room) => (room.id === tenant.roomId ? { ...room, occupied: false } : room)));
    setCheckoutTarget(null);
    showToast(`เช็คเอาท์ ${tenant.name} แล้ว ห้อง ${tenant.roomId} กลายเป็นห้องว่าง`);
  };

  const columns: DataTableColumn<Tenant>[] = [
    {
      key: "name",
      header: "ผู้เช่า",
      render: (tenant) => (
        <button type="button" className="text-left" onClick={() => openDetail(tenant)}>
          <span className="block font-medium text-charcoal hover:underline">{tenant.name}</span>
        </button>
      ),
    },
    { key: "room", header: "ห้อง", render: (tenant) => <span className="num">{tenant.roomId}</span> },
    { key: "phone", header: "เบอร์โทร", render: (tenant) => <span className="num">{tenant.phone}</span> },
    { key: "checkIn", header: "วันที่เข้า", render: (tenant) => <span className="num">{tenant.checkIn}</span> },
    { key: "line", header: "LINE", render: (tenant) => <LineStatusBadge linked={tenant.lineLinked} /> },
    { key: "status", header: "สถานะ", render: (tenant) => <TenantStatusBadge status={tenant.status} /> },
    {
      key: "action",
      header: "จัดการ",
      align: "right",
      render: (tenant) => (
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => openDetail(tenant)}>
            ดูข้อมูล
          </Button>
        </div>
      ),
    },
  ];

  const addInitial: TenantFormValues = { name: "", phone: "", roomId: "", checkIn: todayIso() };
  const editInitial: TenantFormValues =
    editTarget === null
      ? { name: "", phone: "", roomId: "", checkIn: todayIso() }
      : { name: editTarget.name, phone: editTarget.phone, roomId: editTarget.roomId, checkIn: parseThaiDate(editTarget.checkIn) };

  const addRoomOptions =
    vacantRooms.length === 0
      ? [{ value: "", label: "ไม่เหลือห้องว่าง" }]
      : [
          { value: "", label: "ยังไม่ได้เลือก" },
          ...vacantRooms.map((room) => ({ value: room.id, label: `ห้อง ${room.id}` })),
        ];

  const editRoomOptions =
    editTarget === null
      ? []
      : [
          { value: editTarget.roomId, label: `ห้อง ${editTarget.roomId}` },
          ...vacantRooms.map((room) => ({ value: room.id, label: `ห้อง ${room.id}` })),
        ];

  return (
    <div>
      <PageHeader
        title="ผู้เช่า"
        supporting={`ผู้เช่าปัจจุบัน ${currentTenants.length} คน · ย้ายออกแล้ว ${movedOutTenants.length} คน`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <TenantsTabs value={tab} onChange={setTab} />
            <Button
              variant="primary"
              icon="add"
              onClick={() => {
                setAddOpen(true);
              }}
            >
              เพิ่มผู้เช่า
            </Button>
          </div>
        }
      />

      {pendingUsers.length > 0 && (
        <Card className="mb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <span
                className="ms grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-paper-mist text-[20px] text-slate"
                aria-hidden="true"
              >
                link
              </span>
              <div className="min-w-0">
                <p className="text-sm text-charcoal">
                  มี {pendingUsers.length} คนที่แอด LINE แล้วแต่ยังจับคู่ไม่ได้
                </p>
                <p className="mt-0.5 text-xs text-fog">จับคู่เพื่อให้บิลและข้อความยืนยันส่งถึงผู้เช่าได้</p>
              </div>
            </div>
            <Button
              variant="secondary"
              icon="link"
              onClick={() => {
                setPairingOpen(true);
              }}
            >
              จัดการการเชื่อม LINE
            </Button>
          </div>
        </Card>
      )}

      <Card className="mb-4 md:border-0 md:bg-transparent md:p-0">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="w-full md:hidden sm:w-72">
            <Field label="ค้นหาผู้เช่า" value={query} onChange={setQuery} placeholder="เช่น สมชาย หรือ A101" />
          </div>
          <p className="text-xs text-fog sm:max-w-xs sm:pb-3">LINE · ให้ผู้เช่าแอดบอทและพิมพ์เลขห้อง</p>
        </div>
      </Card>

      <div role="tabpanel" id="tenants-panel" aria-labelledby={`tenants-tab-${tab}`}>
        {visibleTenants.length === 0 ? (
          <Card>
            <EmptyState
              icon={tab === "current" ? "group" : "history"}
              title={tab === "current" ? "ยังไม่มีผู้เช่าปัจจุบัน" : "ยังไม่มีผู้เช่าที่ย้ายออก"}
              description={
                tab === "current"
                  ? "เพิ่มผู้เช่าคนแรกพร้อมห้อง เบอร์โทร และวันเข้า เพื่อเริ่มออกบิลและส่งข้อความ LINE"
                  : "ผู้เช่าที่เช็คเอาท์แล้วจะยังถูกเก็บประวัติไว้และแสดงในหน้านี้"
              }
              action={
                tab === "current" ? (
                  <Button
                    variant="primary"
                    icon="add"
                    onClick={() => {
                      setAddOpen(true);
                    }}
                  >
                    เพิ่มผู้เช่า
                  </Button>
                ) : undefined
              }
            />
          </Card>
        ) : (
          <>
            <Card className="hidden md:block">
              <DataTable
                columns={columns}
                rows={filtered}
                getRowKey={(tenant) => tenant.id}
                minWidth={960}
                emptyMessage="ไม่พบผู้เช่าที่ตรงกับเงื่อนไข"
              />
            </Card>

            <div className="grid gap-3 md:hidden">
              {filtered.length === 0 && (
                <Card>
                  <EmptyState
                    icon="group"
                    title="ไม่พบผู้เช่าที่ตรงกับเงื่อนไข"
                    description="ลองล้างคำค้นหาเพื่อดูรายชื่อผู้เช่าทั้งหมด"
                  />
                </Card>
              )}
              {filtered.map((tenant) => (
                <Card key={tenant.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-charcoal">{tenant.name}</p>
                      <p className="num mt-0.5 text-xs text-fog">
                        ห้อง {tenant.roomId} · {tenant.phone}
                      </p>
                    </div>
                    <TenantStatusBadge status={tenant.status} />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <LineStatusBadge linked={tenant.lineLinked} />
                    <span className="num text-xs text-fog">เข้า {tenant.checkIn}</span>
                  </div>
                  <div className="mt-3">
                    <Button size="sm" variant="secondary" className="w-full" onClick={() => openDetail(tenant)}>
                      ดูข้อมูล
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>

      <Drawer
        open={selectedTenant !== null}
        onClose={() => {
          setSelectedId(null);
        }}
        title={selectedTenant === null ? "ข้อมูลผู้เช่า" : `ข้อมูลผู้เช่า · ${selectedTenant.name}`}
        footer={
          selectedTenant === null ? undefined : (
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  setSelectedId(null);
                }}
              >
                ปิด
              </Button>
              <Button
                variant="secondary"
                icon="edit"
                onClick={() => {
                  setEditTarget(selectedTenant);
                  setSelectedId(null);
                }}
              >
                แก้ไข
              </Button>
              {selectedTenant.status === "current" && (
                <Button
                  variant="danger-soft"
                  icon="logout"
                  onClick={() => {
                    setCheckoutTarget(selectedTenant);
                    setSelectedId(null);
                  }}
                >
                  เช็คเอาท์
                </Button>
              )}
            </>
          )
        }
      >
        {selectedTenant !== null && (
          <div className="grid gap-5">
            <dl className="grid gap-2.5">
              <DetailRow label="ชื่อ-นามสกุล" value={selectedTenant.name} />
              <DetailRow label="ห้อง" value={selectedTenant.roomId} numeric />
              <DetailRow label="เบอร์โทร" value={selectedTenant.phone} numeric />
              <DetailRow label="วันที่เข้า" value={selectedTenant.checkIn} numeric />
              {selectedTenant.movedOutAt !== null && <DetailRow label="วันที่ออก" value={selectedTenant.movedOutAt} numeric />}
            </dl>

            <div>
              <p className="field-label">สถานะ LINE</p>
              <LineStatusBadge linked={selectedTenant.lineLinked} />
              <p className="mt-1.5 text-xs text-fog">ให้ผู้เช่าแอดบอทและพิมพ์เลขห้อง</p>
            </div>

            <div>
              <CardHeader title="บิลล่าสุด" description="บิลจากข้อมูลที่ปักหมุดไว้" />
              {recentBills.length === 0 ? (
                <p className="text-sm text-fog">ยังไม่มีบิลของผู้เช่ารายนี้ในระบบ</p>
              ) : (
                <ul className="grid gap-2">
                  {recentBills.map((bill) => (
                    <li
                      key={bill.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-ash px-3 py-2"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-charcoal">{bill.period}</span>
                        <span className="num block text-xs text-fog">ห้อง {bill.roomId}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="num text-sm text-charcoal">{baht(bill.total)} บาท</span>
                        <StatusBadge status={bill.status} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Drawer>

      <TenantFormDrawer
        open={addOpen}
        seedKey="add"
        title="เพิ่มผู้เช่า"
        submitLabel="บันทึกผู้เช่า"
        initial={addInitial}
        roomLabel="ห้องว่าง"
        roomOptions={addRoomOptions}
        roomHelper={vacantRooms.length === 0 ? "ตอนนี้ไม่มีห้องว่าง กรุณาเช็คเอาท์ผู้เช่าเดิมก่อน" : "เลือกห้องว่างที่ผู้เช่าจะย้ายเข้า"}
        onClose={() => {
          setAddOpen(false);
        }}
        onSave={addTenant}
      />

      <TenantFormDrawer
        open={editTarget !== null}
        seedKey={editTarget === null ? "edit" : editTarget.id}
        title={editTarget === null ? "แก้ไขข้อมูลผู้เช่า" : `แก้ไข · ${editTarget.name}`}
        submitLabel="บันทึกการแก้ไข"
        initial={editInitial}
        roomLabel="ห้อง"
        roomOptions={editRoomOptions}
        roomHelper="เปลี่ยนห้องได้เมื่อย้ายผู้เช่าไปห้องอื่น"
        onClose={() => {
          setEditTarget(null);
        }}
        onSave={(values) => {
          if (editTarget !== null) {
            saveEdit(editTarget, values);
          }
        }}
      />

      <CheckoutDialog
        tenant={checkoutTarget}
        onClose={() => {
          setCheckoutTarget(null);
        }}
        onConfirm={confirmCheckout}
      />

      <Toast message={toast ?? ""} open={toast !== null} />
    </div>
  );
}
