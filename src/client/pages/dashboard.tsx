import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, CardHeader, PageHeader, StatBlock, Toast, type BadgeTone } from "../ui";
import {
  bills,
  monthSummaries,
  monthlyRevenue,
  occupiedRooms,
  period,
  reviewQueue,
  rooms,
  tenants,
  type Tenant,
} from "../mock-data";
import { baht } from "./bills-shared";
import { RevenueChart } from "./dashboard-chart";

type RoomStatus = "paid" | "unpaid" | "vacant" | "review";

const roomStatusMeta: Record<RoomStatus, { word: string; tone: BadgeTone; icon: string }> = {
  paid: { word: "จ่ายแล้ว", tone: "paid", icon: "check_circle" },
  unpaid: { word: "ยังไม่จ่าย", tone: "unpaid", icon: "schedule" },
  vacant: { word: "ว่าง", tone: "vacant", icon: "door_front" },
  review: { word: "รอตรวจ", tone: "review", icon: "fact_check" },
};

const legendOrder: RoomStatus[] = ["paid", "unpaid", "vacant", "review"];

const monthShort: Record<string, string> = {
  "กันยายน 2569": "ก.ย.",
  "สิงหาคม 2569": "ส.ค.",
  "กรกฎาคม 2569": "ก.ค.",
};

const overdueAgeDays: Record<string, number> = { A103: 17, A107: 21, A112: 9 };

const tenantByRoom = new Map<string, Tenant>(
  tenants.filter((tenant) => tenant.status === "current").map((tenant) => [tenant.roomId, tenant]),
);

interface OverdueRow {
  roomId: string;
  tenantName: string;
  amount: number;
  ageDays: number;
}

export function DashboardPage() {
  const [selectedMonth, setSelectedMonth] = useState(period);
  const [toast, setToast] = useState<string | null>(null);

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

  const summary = monthSummaries.find((item) => item.month === selectedMonth);
  const due = summary?.due ?? 0;
  const collected = summary?.collected ?? 0;
  const unpaidAmount = summary?.unpaid ?? 0;
  const vacant = summary?.vacantRooms ?? 0;
  const unpaidRoomIds = summary?.unpaidRoomIds ?? [];

  const totalBills = occupiedRooms.length;
  const paidBills = Math.max(totalBills - unpaidRoomIds.length, 0);
  const paidPercent = totalBills === 0 ? 0 : Math.round((paidBills / totalBills) * 100);
  const occupancy = rooms.length === 0 ? 0 : Math.round((occupiedRooms.length / rooms.length) * 100);

  const slipRooms = selectedMonth === period ? reviewQueue.map((item) => item.roomId) : [];
  const slipSet = new Set(slipRooms);
  const unpaidSet = new Set(unpaidRoomIds);
  const pendingSlips = unpaidRoomIds.filter((id) => slipSet.has(id)).length;

  const overdue = useMemo<OverdueRow[]>(() => {
    if (selectedMonth === period) {
      return bills
        .filter((bill) => bill.period === period && bill.status === "unpaid")
        .map((bill) => ({
          roomId: bill.roomId,
          tenantName: bill.tenantName,
          amount: bill.total,
          ageDays: overdueAgeDays[bill.roomId] ?? 1,
        }))
        .sort((a, b) => b.ageDays - a.ageDays);
    }

    const share = unpaidRoomIds.length === 0 ? 0 : Math.round(unpaidAmount / unpaidRoomIds.length);

    return unpaidRoomIds
      .map((roomId) => ({
        roomId,
        tenantName: tenantByRoom.get(roomId)?.name ?? "ไม่ระบุผู้เช่า",
        amount: share,
        ageDays: overdueAgeDays[roomId] ?? 1,
      }))
      .sort((a, b) => b.ageDays - a.ageDays);
  }, [selectedMonth, unpaidAmount, unpaidRoomIds]);

  const counts: Record<RoomStatus, number> = { paid: 0, unpaid: 0, vacant: 0, review: 0 };

  for (const room of rooms) {
    if (!room.occupied) {
      counts.vacant += 1;
    } else if (!unpaidSet.has(room.id)) {
      counts.paid += 1;
    } else {
      counts[slipSet.has(room.id) ? "review" : "unpaid"] += 1;
    }
  }

  const chartLabel = `รายรับ 6 เดือน · ${monthlyRevenue
    .map((point) => `${point.month} ${baht(point.amount)} บาท`)
    .join(" · ")}`;

  const go = (hash: string) => {
    window.location.hash = hash;
  };

  const cell = (roomId: string, occupied: boolean): RoomStatus => {
    if (!occupied) {
      return "vacant";
    }

    if (!unpaidSet.has(roomId)) {
      return "paid";
    }

    return slipSet.has(roomId) ? "review" : "unpaid";
  };

  return (
    <div>
      <PageHeader
        title="แดชบอร์ด"
        supporting={`ภาพรวมหอพักและรายรับ · ${selectedMonth}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <label className="field-label mb-0" htmlFor="dashboard-month">
              เดือน
            </label>
            <select
              id="dashboard-month"
              className="input w-auto"
              value={selectedMonth}
              onChange={(event) => {
                setSelectedMonth(event.target.value);
                setToast(`แสดงข้อมูลเดือน ${event.target.value}`);
              }}
            >
              {[...monthSummaries].reverse().map((item) => (
                <option key={item.month} value={item.month}>
                  {item.month}
                </option>
              ))}
            </select>
            <Button variant="primary" icon="add" onClick={() => go("#bills/create")}>
              สร้างบิลเดือนนี้
            </Button>
          </div>
        }
      />

      <Card className="mb-4">
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <StatBlock icon="payments" label="ยอดที่ควรเก็บ" value={`${baht(due)} บาท`} supporting={`${totalBills} บิล`} />
          <StatBlock icon="savings" label="เก็บแล้ว" value={`${baht(collected)} บาท`} supporting={`${paidBills}/${totalBills} บิล`} />
          <StatBlock
            icon="schedule"
            label="ค้างชำระ"
            value={`${baht(unpaidAmount)} บาท`}
            supporting={`${unpaidRoomIds.length} ห้อง · มีสลิปรอตรวจ ${pendingSlips}`}
          />
          <StatBlock icon="door_front" label="ห้องว่าง" value={`${vacant} ห้อง`} supporting={`อัตราการเช่า ${occupancy}%`} />
        </div>
      </Card>

      <div className="mb-4 grid items-start gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="รายรับ 6 เดือน" description={`เดือนที่เลือก ${selectedMonth} แสดงเป็นแท่งสีน้ำเงิน`} />
          <RevenueChart points={monthlyRevenue} highlight={monthShort[selectedMonth] ?? ""} label={chartLabel} />
        </Card>

        <Card>
          <CardHeader title="เก็บเงินของเดือนนี้" />
          <p className="num text-lg text-charcoal">{baht(collected)} บาท</p>
          <div
            className="mt-3 h-2 w-full overflow-hidden rounded-full bg-paper-mist"
            role="progressbar"
            aria-label="สัดส่วนบิลที่เก็บเงินแล้ว"
            aria-valuemin={0}
            aria-valuemax={totalBills}
            aria-valuenow={paidBills}
            aria-valuetext={`${paidBills} จาก ${totalBills} บิล`}
          >
            <div className="h-full rounded-full bg-electric-blue" style={{ width: `${paidPercent}%` }} />
          </div>
          <div className="mt-3 flex items-center justify-between gap-2 text-xs text-steel">
            <span>
              {paidBills} จาก {totalBills} บิล
            </span>
            <span className="num">{paidPercent}%</span>
          </div>
        </Card>
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="บิลค้างชำระ" description={`${overdue.length} ห้อง · เรียงเก่าสุดก่อน`} />
          {overdue.length === 0 ? (
            <p className="py-6 text-center text-sm text-fog">เดือนนี้ไม่มีบิลค้างชำระ</p>
          ) : (
            <ul className="grid gap-2">
              {overdue.map((row) => (
                <li key={row.roomId}>
                  <a
                    href="#bills"
                    className="flex items-center justify-between gap-3 rounded-lg border border-ash px-3 py-2 no-underline transition-colors hover:bg-paper-mist"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-charcoal">ห้อง {row.roomId}</span>
                      <span className="block truncate text-xs text-fog">{row.tenantName}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="num block text-sm text-charcoal">{baht(row.amount)} บาท</span>
                      <span className="block text-xs text-steel">ค้าง {row.ageDays} วัน</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="สถานะห้อง" description={`ทั้งหมด ${rooms.length} ห้อง · ${selectedMonth}`} />
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {rooms.map((room) => {
              const status = cell(room.id, room.occupied);
              const meta = roomStatusMeta[status];

              return (
                <li key={room.id} className="rounded-lg border border-ash p-2">
                  <span className="num block text-sm text-charcoal">{room.id}</span>
                  <span className="mt-1 block">
                    <Badge tone={meta.tone} icon={meta.icon}>
                      {meta.word}
                    </Badge>
                  </span>
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

      <Toast message={toast ?? ""} open={toast !== null} />
    </div>
  );
}
