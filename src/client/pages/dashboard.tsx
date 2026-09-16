import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  fetchDashboardStats,
  type DashboardRoom,
  type DashboardRoomStatus,
  type DashboardStats,
} from "../api";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Skeleton,
  StatBlock,
  Toast,
  type BadgeTone,
} from "../ui";
import { baht, periodAt, periodLabel } from "./bills-shared";
import { RevenueChart, type MonthlyRevenue } from "./dashboard-chart";

type RoomStatus = DashboardRoomStatus | "review";

const roomStatusMeta: Record<RoomStatus, { word: string; tone: BadgeTone; icon: string }> = {
  paid: { word: "จ่ายแล้ว", tone: "paid", icon: "check_circle" },
  unpaid: { word: "ยังไม่จ่าย", tone: "unpaid", icon: "schedule" },
  vacant: { word: "ว่าง", tone: "vacant", icon: "door_front" },
  review: { word: "รอตรวจ", tone: "review", icon: "fact_check" },
};

const legendOrder: RoomStatus[] = ["paid", "unpaid", "vacant", "review"];

const thaiMonthsShort = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

const msPerDay = 86400000;

function shortMonth(period: string): string {
  const month = Number(period.split("-")[1]);
  return thaiMonthsShort[month - 1] ?? period;
}

function ageInDays(createdAt: string): number {
  const normalized = createdAt.includes("T") ? createdAt : createdAt.replace(" ", "T");
  const parsed = new Date(normalized.endsWith("Z") ? normalized : `${normalized}Z`);

  if (Number.isNaN(parsed.getTime())) {
    return 0;
  }

  const days = Math.floor((Date.now() - parsed.getTime()) / msPerDay);
  return days < 0 ? 0 : days;
}

function roomStatusOf(room: DashboardRoom): RoomStatus {
  if (room.status === "vacant") {
    return "vacant";
  }

  return room.status === "paid" ? "paid" : "unpaid";
}

export function DashboardPage() {
  const [selectedPeriod, setSelectedPeriod] = useState<string>(() => periodAt(0));
  const [periods, setPeriods] = useState<string[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (selectedPeriod === "") {
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    void fetchDashboardStats(selectedPeriod)
      .then((data) => {
        if (!active) {
          return;
        }

        setStats(data);
        setPeriods((prev) => (prev.length === 0 ? data.revenue.map((point) => point.period).reverse() : prev));
      })
      .catch((loadError: unknown) => {
        if (!active) {
          return;
        }

        setStats(null);
        setError(loadError instanceof ApiError ? loadError.message : "โหลดข้อมูลแดชบอร์ดไม่สำเร็จ");
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [selectedPeriod, reloadKey]);

  useEffect(() => {
    if (toast === null) {
      return;
    }

    const timer = window.setTimeout(() => {
      setToast(null);
    }, 2600);

    return () => {
      window.clearTimeout(timer);
    };
  }, [toast]);

  const retry = useCallback(() => {
    setReloadKey((value) => value + 1);
  }, []);

  const kpis = stats?.kpis;
  const rooms = stats?.rooms ?? [];
  const unpaidBills = stats?.unpaidBills ?? [];

  const pendingSlipBills = unpaidBills.filter((bill) => bill.hasPendingSlip).length;
  const occupancy =
    kpis === undefined || kpis.totalRooms === 0
      ? 0
      : Math.round(((kpis.totalRooms - kpis.vacantRooms) / kpis.totalRooms) * 100);
  const paidPercent = kpis === undefined || kpis.bills === 0 ? 0 : Math.round((kpis.paidCount / kpis.bills) * 100);

  const counts: Record<RoomStatus, number> = { paid: 0, unpaid: 0, vacant: 0, review: 0 };

  for (const room of rooms) {
    counts[roomStatusOf(room)] += 1;

    if (room.hasPendingSlip) {
      counts.review += 1;
    }
  }

  const revenuePoints = useMemo<MonthlyRevenue[]>(
    () => (stats?.revenue ?? []).map((point) => ({ month: shortMonth(point.period), amount: point.amount })),
    [stats],
  );

  const chartLabel = `รายรับ 6 เดือน · ${(stats?.revenue ?? [])
    .map((point) => `${periodLabel(point.period)} ${baht(point.amount)} บาท`)
    .join(" · ")}`;

  const go = (hash: string) => {
    window.location.hash = hash;
  };

  return (
    <div>
      <PageHeader
        title="แดชบอร์ด"
        supporting={`ภาพรวมหอพักและรายรับ · ${periodLabel(selectedPeriod)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <label className="field-label mb-0" htmlFor="dashboard-month">
              เดือน
            </label>
            <select
              id="dashboard-month"
              className="input w-auto"
              value={selectedPeriod}
              onChange={(event) => {
                setSelectedPeriod(event.target.value);
                setToast(`แสดงข้อมูลเดือน ${periodLabel(event.target.value)}`);
              }}
            >
              {periods.map((option) => (
                <option key={option} value={option}>
                  {periodLabel(option)}
                </option>
              ))}
            </select>
            <Button variant="primary" icon="add" onClick={() => go("#bills/create")}>
              สร้างบิลเดือนนี้
            </Button>
          </div>
        }
      />

      {loading ? (
        <Card>
          <div className="grid gap-3" aria-busy="true">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-44 w-full" />
            <Skeleton className="h-24 w-2/3" />
          </div>
        </Card>
      ) : error !== null ? (
        <Card>
          <EmptyState
            icon="cloud_off"
            title="โหลดข้อมูลแดชบอร์ดไม่สำเร็จ"
            description={error}
            action={
              <Button variant="secondary" icon="refresh" onClick={retry}>
                ลองใหม่
              </Button>
            }
          />
        </Card>
      ) : stats === null || kpis === undefined ? null : (
        <>
          <Card className="mb-4">
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
              <StatBlock
                icon="payments"
                label="ยอดที่ควรเก็บ"
                value={`${baht(kpis.dueAmount)} บาท`}
                supporting={`${kpis.bills} บิล`}
              />
              <StatBlock
                icon="savings"
                label="เก็บแล้ว"
                value={`${baht(kpis.collectedAmount)} บาท`}
                supporting={`${kpis.paidCount}/${kpis.bills} บิล`}
              />
              <StatBlock
                icon="schedule"
                label="ค้างชำระ"
                value={`${baht(kpis.unpaidAmount)} บาท`}
                supporting={`${kpis.unpaidRooms} ห้อง · มีสลิปรอตรวจ ${pendingSlipBills}`}
              />
              <StatBlock
                icon="door_front"
                label="ห้องว่าง"
                value={`${kpis.vacantRooms}/${kpis.totalRooms}`}
                supporting={`อัตราการเช่า ${occupancy}%`}
              />
            </div>
          </Card>

          <div className="mb-4 grid items-start gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader title="รายรับ 6 เดือน" description={`เดือนที่เลือก ${periodLabel(selectedPeriod)} แสดงเป็นแท่งสีน้ำเงิน`} />
              <RevenueChart points={revenuePoints} highlight={shortMonth(selectedPeriod)} label={chartLabel} />
            </Card>

            <Card>
              <CardHeader title="เก็บเงินของเดือนนี้" />
              <p className="num text-lg text-charcoal">{baht(kpis.collectedAmount)} บาท</p>
              <div
                className="mt-3 h-2 w-full overflow-hidden rounded-full bg-paper-mist"
                role="progressbar"
                aria-label="สัดส่วนบิลที่เก็บเงินแล้ว"
                aria-valuemin={0}
                aria-valuemax={kpis.bills}
                aria-valuenow={kpis.paidCount}
                aria-valuetext={`${kpis.paidCount} จาก ${kpis.bills} บิล`}
              >
                <div className="h-full rounded-full bg-electric-blue" style={{ width: `${paidPercent}%` }} />
              </div>
              <div className="mt-3 flex items-center justify-between gap-2 text-xs text-steel">
                <span>
                  {kpis.paidCount} จาก {kpis.bills} บิล
                </span>
                <span className="num">{paidPercent}%</span>
              </div>
            </Card>
          </div>

          <div className="mb-4 grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader title="บิลค้างชำระ" description={`${unpaidBills.length} ห้อง · เรียงเก่าสุดก่อน`} />
              {unpaidBills.length === 0 ? (
                <p className="py-6 text-center text-sm text-fog">เดือนนี้ไม่มีบิลค้างชำระ</p>
              ) : (
                <ul className="grid gap-2">
                  {unpaidBills.map((bill) => (
                    <li key={bill.id}>
                      <a
                        href="#bills"
                        className="flex items-center justify-between gap-3 rounded-lg border border-ash px-3 py-2 no-underline transition-colors hover:bg-paper-mist"
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-charcoal">ห้อง {bill.roomNumber}</span>
                          <span className="block truncate text-xs text-fog">{bill.tenantName}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          {bill.hasPendingSlip && (
                            <Badge tone="review" icon="fact_check">
                              รอตรวจ
                            </Badge>
                          )}
                          <span className="text-right">
                            <span className="num block text-sm text-charcoal">{baht(bill.total)} บาท</span>
                            <span className="block text-xs text-steel">ค้าง {ageInDays(bill.createdAt)} วัน</span>
                          </span>
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <CardHeader title="สถานะห้อง" description={`ทั้งหมด ${rooms.length} ห้อง · ${periodLabel(selectedPeriod)}`} />
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                {rooms.map((room) => {
                  const meta = roomStatusMeta[roomStatusOf(room)];

                  return (
                    <li key={room.id} className="rounded-lg border border-ash p-2">
                      <span className="num block text-sm text-charcoal">{room.roomNumber}</span>
                      <span className="mt-1 block">
                        <Badge tone={meta.tone} icon={meta.icon}>
                          {meta.word}
                        </Badge>
                      </span>
                      {room.hasPendingSlip && (
                        <span className="mt-1 block">
                          <Badge tone="review" icon="fact_check">
                            รอตรวจ
                          </Badge>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 border-t border-ash pt-3">
                {legendOrder.map((status) => {
                  const meta = roomStatusMeta[status];

                  return (
                    <span key={status} className="flex items-center gap-2">
                      <Badge tone={meta.tone} icon={meta.icon}>
                        {meta.word}
                      </Badge>
                      <span className="num text-xs text-steel">{counts[status]}</span>
                    </span>
                  );
                })}
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader title="งานที่ใช้บ่อย" description="ทางลัดไปยังงานต้นเดือนที่ทำบ่อย" />
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" icon="add" onClick={() => go("#bills/create")}>
                สร้างบิล
              </Button>
              <Button variant="secondary" icon="receipt_long" onClick={() => go("#bills")}>
                ดูบิลค้าง
              </Button>
              <Button variant="secondary" icon="fact_check" onClick={() => go("#review")}>
                ตรวจสลิป
              </Button>
            </div>
          </Card>
        </>
      )}

      <Toast message={toast ?? ""} open={toast !== null} />
    </div>
  );
}
