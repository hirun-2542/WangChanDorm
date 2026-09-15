import { useCallback, useEffect, useState } from "react";
import { ApiError, fetchBills, fetchSettings, fetchTenants, type Bill, type Settings, type Tenant } from "../api";
import { useSearch } from "../search";
import {
  Button,
  Card,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  PageHeader,
  Select,
  Skeleton,
  StatBlock,
  StatusBadge,
  Toast,
  type DataTableColumn,
  type PageProps,
} from "../ui";
import { LineStateBadge, baht, chargesTotal, monthCount, periodLabel, recentPeriods } from "./bills-shared";
import { BillEditDrawer, DeleteBillDialog, MarkPaidDialog } from "./bills-actions";
import { BillDetail } from "./bills-detail";
import { CreateWizard } from "./bills-create";

interface BillListProps {
  bills: Bill[];
  loading: boolean;
  error: string | null;
  period: string;
  periods: string[];
  connectedIds: Set<string> | null;
  statusFilter: string;
  onPeriodChange: (period: string) => void;
  onStatusFilterChange: (value: string) => void;
  onOpen: (bill: Bill) => void;
  onManage: (bill: Bill) => void;
  onCreate: () => void;
  onRetry: () => void;
}

function BillList({
  bills,
  loading,
  error,
  period,
  periods,
  connectedIds,
  statusFilter,
  onPeriodChange,
  onStatusFilterChange,
  onOpen,
  onManage,
  onCreate,
  onRetry,
}: BillListProps) {
  const { query, setQuery } = useSearch();
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
        const extraTotal = chargesTotal(bill.charges);
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
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={() => onOpen(bill)}>
            ดูบิล
          </Button>
          {bill.status === "unpaid" && (
            <Button size="sm" variant="ghost" icon="more_horiz" onClick={() => onManage(bill)}>
              จัดการ
            </Button>
          )}
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
                onPeriodChange(event.target.value);
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
              <Button variant="secondary" icon="refresh" onClick={onRetry}>
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
                  onChange={onStatusFilterChange}
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
                  minWidth={940}
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
                      {bill.status === "unpaid" && (
                        <Button size="sm" variant="ghost" icon="more_horiz" onClick={() => onManage(bill)}>
                          จัดการ
                        </Button>
                      )}
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
  const [periods] = useState<string[]>(() => recentPeriods(monthCount));
  const [period, setPeriod] = useState<string>(() => periods[0] ?? "");
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tenantList, setTenantList] = useState<Tenant[] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [menuBillId, setMenuBillId] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<Bill | null>(null);
  const [payTarget, setPayTarget] = useState<Bill | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Bill | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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

  useEffect(() => {
    if (period === "") {
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    void fetchBills(period)
      .then((list) => {
        if (active) {
          setBills(list);
        }
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

  const refresh = useCallback(() => {
    setReloadKey((value) => value + 1);
  }, []);

  const applyBill = useCallback((updated: Bill) => {
    setBills((prev) => prev.map((bill) => (bill.id === updated.id ? updated : bill)));
  }, []);

  const connectedIds =
    tenantList === null ? null : new Set(tenantList.filter((tenant) => tenant.lineUserId !== null).map((tenant) => tenant.id));

  const go = (hash: string) => {
    window.location.hash = hash;
  };

  const selectedBill = bills.find((bill) => bill.id === selectedId) ?? null;
  const menuBill = bills.find((bill) => bill.id === menuBillId) ?? null;

  const handleSaved = (message: string) => (updated: Bill) => {
    setEditTarget(null);
    setPayTarget(null);
    applyBill(updated);
    refresh();
    setToast(message);
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
    if (selectedBill === null) {
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

    const detailBill = selectedBill;

    return (
      <BillDetail
        bill={detailBill}
        dormName={settings?.dormName ?? null}
        ownerName={settings?.ownerName ?? null}
        promptpayId={settings?.promptpayId ?? null}
        connected={connectedIds === null ? null : connectedIds.has(detailBill.tenantId)}
        onBack={() => {
          go("#bills");
        }}
        onSaved={(updated) => {
          applyBill(updated);
          refresh();
          setToast(updated.status === "paid" ? "ปิดบิลแล้ว" : "บันทึกบิลแล้ว");
        }}
        onDeleted={() => {
          setBills((prev) => prev.filter((bill) => bill.id !== detailBill.id));
          setSelectedId(null);
          refresh();
          go("#bills");
          setToast("ลบบิลแล้ว");
        }}
      />
    );
  }

  return (
    <>
      <BillList
        bills={bills}
        loading={loading}
        error={error}
        period={period}
        periods={periods}
        connectedIds={connectedIds}
        statusFilter={statusFilter}
        onPeriodChange={setPeriod}
        onStatusFilterChange={setStatusFilter}
        onOpen={(bill) => {
          setSelectedId(bill.id);
          go("#bills/detail");
        }}
        onManage={(bill) => {
          setMenuBillId(bill.id);
        }}
        onCreate={() => {
          go("#bills/create");
        }}
        onRetry={refresh}
      />

      <Dialog
        open={menuBill !== null}
        onClose={() => {
          setMenuBillId(null);
        }}
        title={menuBill === null ? "จัดการบิล" : `จัดการบิลห้อง ${menuBill.roomNumber}`}
        footer={
          <Button
            variant="ghost"
            onClick={() => {
              setMenuBillId(null);
            }}
          >
            ปิด
          </Button>
        }
      >
        {menuBill !== null && (
          <div className="grid gap-2">
            <Button
              variant="secondary"
              icon="edit"
              className="w-full justify-start"
              onClick={() => {
                setEditTarget(menuBill);
                setMenuBillId(null);
              }}
            >
              แก้ไขบิล
            </Button>
            <Button
              variant="primary"
              icon="check_circle"
              className="w-full justify-start"
              onClick={() => {
                setPayTarget(menuBill);
                setMenuBillId(null);
              }}
            >
              ปิดบิลด้วยมือ
            </Button>
            <Button variant="secondary" icon="sync" className="w-full justify-start" disabled title="ยังไม่เปิดใช้งาน">
              ส่ง LINE อีกครั้ง
            </Button>
            <p className="text-[11px] text-fog">การส่งบิลทาง LINE จะมาในงานถัดไป</p>
            <Button
              variant="danger-soft"
              icon="delete"
              className="mt-2 w-full justify-start"
              onClick={() => {
                setDeleteTarget(menuBill);
                setMenuBillId(null);
              }}
            >
              ลบบิล
            </Button>
          </div>
        )}
      </Dialog>

      <BillEditDrawer
        open={editTarget !== null}
        bill={editTarget}
        onClose={() => {
          setEditTarget(null);
        }}
        onSaved={handleSaved("บันทึกบิลแล้ว")}
      />

      <MarkPaidDialog
        open={payTarget !== null}
        bill={payTarget}
        onClose={() => {
          setPayTarget(null);
        }}
        onPaid={handleSaved("ปิดบิลแล้ว")}
      />

      <DeleteBillDialog
        open={deleteTarget !== null}
        bill={deleteTarget}
        onClose={() => {
          setDeleteTarget(null);
        }}
        onDeleted={() => {
          if (deleteTarget !== null) {
            const removedId = deleteTarget.id;
            setBills((prev) => prev.filter((bill) => bill.id !== removedId));
          }

          setDeleteTarget(null);
          refresh();
          setToast("ลบบิลแล้ว");
        }}
      />

      <Toast message={toast ?? ""} open={toast !== null} />
    </>
  );
}
