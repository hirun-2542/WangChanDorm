import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  billsFocusHash,
  fetchBillPeriods,
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
  type BadgeTone,
} from "../ui";
import { baht, periodAt, periodLabel, periodOptions } from "./bills-shared";
import { RevenueChart, type MonthlyRevenue } from "./dashboard-chart";

type RoomStatus = DashboardRoomStatus | "review";

const roomStatusMeta: Record<RoomStatus, { word: string; tone: BadgeTone; icon: string }> = {
  paid: { word: "จ่ายแล้ว", tone: "paid", icon: "check_circle" },
  unpaid: { word: "ยังไม่จ่าย", tone: "unpaid", icon: "schedule" },
  unbilled: { word: "ยังไม่ออกบิล", tone: "unbilled", icon: "receipt_long" },
  vacant: { word: "ว่าง", tone: "vacant", icon: "door_front" },
  review: { word: "รอตรวจ", tone: "review", icon: "fact_check" },
};

const legendOrder: RoomStatus[] = ["paid", "unpaid", "unbilled", "vacant", "review"];

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

  if (room.status === "unbilled") {
    return "unbilled";
  }

  return room.status === "paid" ? "paid" : "unpaid";
}

function roomHref(room: DashboardRoom, period: string): string {
  if (room.status === "vacant") {
    return "#rooms";
  }

  const focusPeriod = room.status === "unbilled" ? room.lastBilledPeriod ?? "" : period;

  return billsFocusHash({ roomNumber: room.roomNumber, period: focusPeriod });
}

interface KpiCardProps {
  href: string;
  icon: string;
  label: string;
  value: string;
  supporting: string;
  valueClassName?: string;
}

function KpiCard({ href, icon, label, value, supporting, valueClassName }: KpiCardProps) {
  return (
    <a href={href} className="-m-1.5 block rounded-lg p-1.5 no-underline transition-colors hover:bg-paper-mist">
      <StatBlock icon={icon} label={label} value={value} supporting={supporting} valueClassName={valueClassName} />
    </a>
  );
}

export function DashboardPage() {
  const [selectedPeriod, setSelectedPeriod] = useState<string>(() => periodAt(0));
  const [billedPeriods, setBilledPeriods] = useState<string[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

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
    let active = true;

    void fetchBillPeriods()
      .then((list) => {
        if (active) {
          setBilledPeriods(list);
        }
      })
      .catch(() => {
        // the recent months remain available when the billed period list cannot be loaded
      });

    return () => {
      active = false;
    };
  }, []);

  const retry = useCallback(() => {
    setReloadKey((value) => value + 1);
  }, []);

  const periods = useMemo(() => {
    const list = periodOptions(billedPeriods);

    return list.includes(selectedPeriod) ? list : [selectedPeriod, ...list].sort().reverse();
  }, [billedPeriods, selectedPeriod]);

  const kpis = stats?.kpis;
  const rooms = stats?.rooms ?? [];
  const unpaidBills = stats?.unpaidBills ?? [];

  const pendingSlipBills = unpaidBills.filter((bill) => bill.hasPendingSlip).length;
  const occupancy =
    kpis === undefined || kpis.totalRooms === 0
      ? 0
      : Math.round(((kpis.totalRooms - kpis.vacantRooms) / kpis.totalRooms) * 100);
  const paidPercent = kpis === undefined || kpis.bills === 0 ? 0 : Math.round((kpis.paidCount / kpis.bills) * 100);

  const billingDay = kpis !== undefined && kpis.bills === 0 && kpis.unbilledRooms > 0;

  const counts: Record<RoomStatus, number> = { paid: 0, unpaid: 0, unbilled: 0, vacant: 0, review: 0 };

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
    .map((point) =>
      point.amount === 0 ? `${periodLabel(point.period)} ไม่มีรายรับ` : `${periodLabel(point.period)} ${baht(point.amount)} บาท`,
    )
    .join(" · ")}`;

  const createHref = `#bills/create?period=${encodeURIComponent(selectedPeriod)}`;
  const billsHref = `#bills?period=${encodeURIComponent(selectedPeriod)}`;
  const roomsLeftToBill = kpis?.unbilledRooms ?? 0;
  const legend = legendOrder.filter((status) => counts[status] > 0);

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
              }}
            >
              {periods.map((option) => (
                <option key={option} value={option}>
                  {periodLabel(option)}
                </option>
              ))}
            </select>
            {roomsLeftToBill > 0 && (
              <Button variant={billingDay ? "primary" : "secondary"} icon="add" onClick={() => go(createHref)}>
                {billingDay ? "สร้างบิลเดือนนี้" : `ออกบิลที่เหลือ ${roomsLeftToBill} ห้อง`}
              </Button>
            )}
          </div>
        }
      />

      {loading ? (
        <>
          <Card className="mb-4">
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-4" aria-busy="true">
              {[0, 1, 2, 3].map((index) => (
                <div key={index} className="grid gap-2">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-5 w-28" />
                  <Skeleton className="h-3 w-32" />
                </div>
              ))}
            </div>
          </Card>
          <div className="mb-4 grid gap-4 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <Skeleton className="h-44 w-full" />
            </Card>
            <div className="grid content-start gap-4 lg:col-span-2">
              <Card>
                <Skeleton className="h-16 w-full" />
              </Card>
              <Card>
                <Skeleton className="h-24 w-full" />
              </Card>
            </div>
          </div>
          <Card>
            <Skeleton className="h-36 w-full" />
          </Card>
        </>
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
              <KpiCard
                href={billsHref}
                icon="payments"
                label="ยอดที่ควรเก็บ"
                value={`${baht(kpis.dueAmount)} บาท`}
                supporting={`${kpis.bills} บิล`}
              />
              <KpiCard
                href={billsHref}
                icon="savings"
                label="เก็บแล้ว"
                value={`${baht(kpis.collectedAmount)} บาท`}
                supporting={`${kpis.paidCount}/${kpis.bills} บิล`}
                valueClassName={kpis.collectedAmount > 0 ? "text-status-paid-fg" : undefined}
              />
              <KpiCard
                href={billsHref}
                icon="schedule"
                label="ค้างชำระ"
                value={`${baht(kpis.unpaidAmount)} บาท`}
                supporting={`${kpis.unpaidRooms} ห้อง · ยังไม่ออกบิล ${kpis.unbilledRooms} ห้อง · มีสลิปรอตรวจ ${pendingSlipBills}`}
                valueClassName={kpis.unpaidAmount > 0 ? "text-status-review-fg" : undefined}
              />
              <KpiCard
                href="#rooms"
                icon="door_front"
                label="ห้องว่าง"
                value={`${kpis.vacantRooms}/${kpis.totalRooms}`}
                supporting={`อัตราการเช่า ${occupancy}%`}
              />
            </div>
          </Card>

          <div className="mb-4 grid gap-4 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader title="รายรับ 6 เดือน" description={`นับถึง ${periodLabel(selectedPeriod)} · แท่งทึบคือเดือนที่เลือก`} />
              <RevenueChart points={revenuePoints} highlight={shortMonth(selectedPeriod)} label={chartLabel} />
            </Card>

            <div className="grid content-start gap-4 lg:col-span-2">
              {!billingDay && (
                <Card>
                  <CardHeader title="ความคืบหน้าการเก็บเงิน" />
                  <div
                    className="mt-3 h-2 w-full overflow-hidden rounded-full bg-paper-mist"
                    role="progressbar"
                    aria-label={`สัดส่วนบิลที่เก็บเงินแล้ว เดือน${periodLabel(selectedPeriod)}`}
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
              )}

              <Card>
                <CardHeader
                  title="บิลค้างชำระ"
                  description={unpaidBills.length === 0 ? "เรียงเก่าสุดก่อน" : `${unpaidBills.length} ห้อง · เรียงเก่าสุดก่อน`}
                  actions={
                    <a href={billsHref} className="text-xs font-medium">
                      ดูทั้งหมด
                    </a>
                  }
                />
                {unpaidBills.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                    <span className="ms text-[24px] text-status-paid-fg" aria-hidden="true">
                      check_circle
                    </span>
                    <p className="text-sm text-charcoal">ไม่มีบิลค้างชำระ</p>
                    <p className="max-w-[28ch] text-xs text-fog">บิลที่ยังไม่ได้รับชำระของเดือนนี้จะมาแสดงที่นี่</p>
                  </div>
                ) : (
                  <ul className="grid gap-2">
                    {unpaidBills.map((bill) => (
                      <li key={bill.id}>
                        <a
                          href={billsFocusHash({ roomNumber: bill.roomNumber, period: selectedPeriod })}
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
            </div>
          </div>

          <Card className="mb-4">
            <CardHeader
              title="ภาพรวมห้อง"
              description={`สถานะบิลของเดือน${periodLabel(selectedPeriod)} · ${rooms.length} ห้อง`}
              actions={
                legend.length === 0 ? undefined : (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    {legend.map((status) => {
                      const meta = roomStatusMeta[status];

                      return (
                        <span key={status} className="flex items-center gap-1.5">
                          <Badge tone={meta.tone} icon={meta.icon}>
                            {meta.word}
                          </Badge>
                          <span className="num text-xs text-steel">{counts[status]}</span>
                        </span>
                      );
                    })}
                  </div>
                )
              }
            />
            {rooms.length === 0 ? (
              <EmptyState
                icon="door_front"
                title="ยังไม่มีห้องในระบบ"
                description="เพิ่มห้องที่หน้าห้องพัก แล้วกลับมาดูสถานะบิลของทุกห้องที่นี่"
                action={
                  <Button variant="secondary" icon="door_front" onClick={() => go("#rooms")}>
                    ไปหน้าห้องพัก
                  </Button>
                }
              />
            ) : (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                {rooms.map((room) => {
                  const meta = roomStatusMeta[roomStatusOf(room)];
                  const label = [
                    `ห้อง ${room.roomNumber}`,
                    meta.word,
                    room.hasPendingSlip ? "มีสลิปรอตรวจ" : null,
                  ]
                    .filter((part) => part !== null)
                    .join(" · ");

                  return (
                    <li key={room.id} className="flex">
                      <a
                        href={roomHref(room, selectedPeriod)}
                        aria-label={label}
                        className="flex w-full flex-col items-start gap-1 rounded-lg border border-ash p-2 no-underline transition-colors hover:bg-paper-mist"
                      >
                        <span className="num text-sm text-charcoal">{room.roomNumber}</span>
                        <Badge tone={meta.tone} icon={meta.icon}>
                          {meta.word}
                        </Badge>
                        {room.hasPendingSlip && (
                          <Badge tone="review" icon="fact_check">
                            รอตรวจ
                          </Badge>
                        )}
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="งานที่ใช้บ่อย" description="ทางลัดไปยังงานต้นเดือนที่ทำบ่อย" />
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" icon="add" onClick={() => go(createHref)}>
                สร้างบิล
              </Button>
              <Button variant="secondary" icon="receipt_long" onClick={() => go(billsHref)}>
                ดูบิลค้าง
              </Button>
              <Button variant="secondary" icon="fact_check" onClick={() => go("#review")}>
                ตรวจสลิป
              </Button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
