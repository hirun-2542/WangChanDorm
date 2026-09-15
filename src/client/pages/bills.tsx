import { useCallback, useEffect, useState } from "react";
import { ApiError, fetchBills, fetchSettings, fetchTenants, type Bill, type Settings, type Tenant } from "../api";
import { useSearch } from "../search";
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  PageHeader,
  Select,
  Skeleton,
  StatBlock,
  StatusBadge,
  type DataTableColumn,
  type PageProps,
} from "../ui";
import { LineStateBadge, baht, periodLabel, recentPeriods } from "./bills-shared";
import { BillDetail } from "./bills-detail";
import { CreateWizard } from "./bills-create";

const monthCount = 3;

interface BillListProps {
  connectedIds: Set<string> | null;
  onOpen: (bill: Bill) => void;
  onCreate: () => void;
}

function chargesTotal(bill: Bill): number {
  return bill.charges.reduce((sum, charge) => sum + charge.amount, 0);
}

function BillList({ connectedIds, onOpen, onCreate }: BillListProps) {
  const { query, setQuery } = useSearch();
  const [periods] = useState<string[]>(() => recentPeriods(monthCount));
  const [period, setPeriod] = useState<string>(() => periods[0] ?? "");
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    if (period === "") {
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    void fetchBills(period)
      .then((list) => {
        if (!active) {
          return;
        }

        setBills(list);
      })
      .catch((loadError: unknown) => {
        if (!active) {
          return;
        }

        setBills([]);
        setError(loadError instanceof ApiError ? loadError.message : "โหลดข้อมูลบิลไม่สำเร็จ");
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

  const retry = useCallback(() => {
    setReloadKey((value) => value + 1);
  }, []);

  const connectedOf = (bill: Bill): boolean | null => (connectedIds === null ? null : connectedIds.has(bill.tenantId));
  const paidCount = bills.filter((bill) => bill.status === "paid").length;
  const unpaidCount = bills.length - paidCount;
  const monthTotal = bills.reduce((sum, bill) => sum + bill.total, 0);

  const needle = query.trim().toLowerCase();
  const filtered = bills.filter((bill) => {
    const matchesQuery =
      needle === "" || bill.roomNumber.toLowerCase().includes(needle) || bill.tenantName.toLowerCase().includes(needle);
    const matchesStatus = statusFilter === "all" || bill.status === statusFilter;
    return matchesQuery && matchesStatus;
  });

  const columns: DataTableColumn<Bill>[] = [
    {
      key: "room",
      header: "ห้อง / ผู้เช่า",
      render: (bill) => (
        <button type="button" className="text-left" onClick={() => onOpen(bill)}>
          <span className="block font-medium text-charcoal hover:underline">{bill.roomNumber}</span>
          <span className="block text-xs text-fog">{bill.tenantName}</span>
        </button>
      ),
    },
    { key: "rent", header: "ค่าห้อง", align: "right", render: (bill) => baht(bill.rent) },
    { key: "water", header: "ค่าน้ำ", align: "right", render: (bill) => baht(bill.waterAmount) },
    {
      key: "electric",
      header: "ค่าไฟ",
      align: "right",
      render: (bill) => (
        <div className="flex flex-col items-end">
          <span>{baht(bill.electricAmount)}</span>
          {bill.electricMode === "flat" && <span className="chip mt-1">ไฟเหมา</span>}
        </div>
      ),
    },
    {
      key: "extra",
      header: "ค่าใช้จ่ายเพิ่ม",
      align: "right",
      render: (bill) => {
        const extraTotal = chargesTotal(bill);
        return extraTotal === 0 ? <span className="text-fog">—</span> : baht(extraTotal);
      },
    },
    { key: "total", header: "รวม", align: "right", render: (bill) => <span className="font-medium">{baht(bill.total)}</span> },
    { key: "status", header: "สถานะ", render: (bill) => <StatusBadge status={bill.status} /> },
    { key: "line", header: "LINE", render: (bill) => <LineStateBadge sentAt={bill.sentAt} connected={connectedOf(bill)} /> },
    {
      key: "action",
      header: "จัดการ",
      align: "right",
      render: (bill) => (
        <div className="flex justify-end">
          <Button size="sm" variant="secondary" onClick={() => onOpen(bill)}>
            ดูบิล
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="บิล"
        supporting={
          loading
            ? "กำลังโหลดข้อมูลบิล"
            : error !== null
              ? "โหลดข้อมูลบิลไม่สำเร็จ"
              : `${periodLabel(period)} · ${bills.length} ใบ · จ่ายแล้ว ${paidCount} · ยังไม่จ่าย ${unpaidCount}`
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <label className="field-label mb-0" htmlFor="bills-period">
              รอบบิล
            </label>
            <select
              id="bills-period"
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
            <Button variant="primary" icon="add" onClick={onCreate}>
              สร้างบิล
            </Button>
          </div>
        }
      />

      {loading ? (
        <Card>
          <div className="grid gap-3" aria-busy="true">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-2/3" />
          </div>
        </Card>
      ) : error !== null ? (
        <Card>
          <EmptyState
            icon="cloud_off"
            title="โหลดข้อมูลบิลไม่สำเร็จ"
            description={error}
            action={
              <Button variant="secondary" icon="refresh" onClick={retry}>
                ลองใหม่
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <Card className="mb-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatBlock label="จำนวนบิล" value={`${bills.length} ใบ`} supporting={periodLabel(period)} />
              <StatBlock label="จ่ายแล้ว" value={String(paidCount)} />
              <StatBlock label="ยังไม่จ่าย" value={String(unpaidCount)} />
              <StatBlock label="ยอดรวม" value={`${baht(monthTotal)} บาท`} />
            </div>
          </Card>

          <Card className="mb-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-full md:hidden sm:w-60">
                <Field label="ค้นหาห้องหรือผู้เช่า" value={query} onChange={setQuery} placeholder="เช่น A103 หรือ ธนา" />
              </div>
              <div className="w-full sm:w-40">
                <Select
                  label="สถานะบิล"
                  value={statusFilter}
                  onChange={setStatusFilter}
                  options={[
                    { value: "all", label: "ทั้งหมด" },
                    { value: "unpaid", label: "ยังไม่จ่าย" },
                    { value: "paid", label: "จ่ายแล้ว" },
                  ]}
                />
              </div>
            </div>
          </Card>

          {bills.length === 0 ? (
            <Card>
              <EmptyState
                icon="receipt_long"
                title="ยังไม่มีบิลเดือนนี้"
                description="เริ่มสร้างบิลทั้งหอจากการกรอกเลขมิเตอร์ของทุกห้องในครั้งเดียว"
                action={
                  <Button variant="primary" icon="add" onClick={onCreate}>
                    สร้างบิลเดือนนี้
                  </Button>
                }
              />
            </Card>
          ) : (
            <>
              <Card className="hidden md:block">
                <DataTable
                  columns={columns}
                  rows={filtered}
                  getRowKey={(bill) => bill.id}
                  minWidth={900}
                  emptyMessage="ไม่พบบิลที่ตรงกับเงื่อนไข"
                />
              </Card>

              <div className="grid gap-3 md:hidden">
                {filtered.length === 0 && (
                  <Card>
                    <EmptyState icon="receipt_long" title="ไม่พบบิลที่ตรงกับเงื่อนไข" description="ลองล้างคำค้นหาหรือเปลี่ยนตัวกรองสถานะ" />
                  </Card>
                )}
                {filtered.map((bill) => (
                  <Card key={bill.id}>
                    <div className="flex items-start justify-between gap-3">
                      <button type="button" className="min-w-0 text-left" onClick={() => onOpen(bill)}>
                        <span className="block font-medium text-charcoal">{bill.roomNumber}</span>
                        <span className="block text-xs text-fog">{bill.tenantName}</span>
                      </button>
                      <StatusBadge status={bill.status} />
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <span className="text-sm text-steel">ยอดรวม</span>
                      <span className="num text-lg text-charcoal">{baht(bill.total)} บาท</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <LineStateBadge sentAt={bill.sentAt} connected={connectedOf(bill)} />
                      {bill.electricMode === "flat" && <span className="chip">ไฟเหมา</span>}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={() => onOpen(bill)}>
                        ดูบิล
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

export function BillsPage({ view }: PageProps) {
  const [selected, setSelected] = useState<Bill | null>(null);
  const [tenantList, setTenantList] = useState<Tenant[] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    let active = true;

    void fetchTenants()
      .then((list) => {
        if (active) {
          setTenantList(list);
        }
      })
      .catch(() => {
        if (active) {
          setTenantList([]);
        }
      });

    void fetchSettings()
      .then((value) => {
        if (active) {
          setSettings(value);
        }
      })
      .catch(() => {
        if (active) {
          setSettings(null);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const connectedIds =
    tenantList === null ? null : new Set(tenantList.filter((tenant) => tenant.lineUserId !== null).map((tenant) => tenant.id));

  const go = (hash: string) => {
    window.location.hash = hash;
  };

  if (view === "create") {
    return (
      <CreateWizard
        settings={settings}
        tenants={tenantList}
        onFinish={() => {
          go("#bills");
        }}
      />
    );
  }

  if (view === "detail") {
    if (selected === null) {
      return (
        <Card>
          <EmptyState
            icon="receipt_long"
            title="ไม่พบบิลที่จะแสดง"
            description="เปิดบิลอีกครั้งจากรายการบิลของเดือนนั้น"
            action={
              <Button
                variant="secondary"
                icon="arrow_back"
                onClick={() => {
                  go("#bills");
                }}
              >
                กลับรายการบิล
              </Button>
            }
          />
        </Card>
      );
    }

    return (
      <BillDetail
        bill={selected}
        dormName={settings?.dormName ?? null}
        connected={connectedIds === null ? null : connectedIds.has(selected.tenantId)}
        onBack={() => {
          go("#bills");
        }}
      />
    );
  }

  return (
    <BillList
      connectedIds={connectedIds}
      onOpen={(bill) => {
        setSelected(bill);
        go("#bills/detail");
      }}
      onCreate={() => {
        go("#bills/create");
      }}
    />
  );
}
