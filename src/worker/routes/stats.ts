import { Hono } from "hono";
import { errorBody, roomNumberOrder } from "./shared";

const stats = new Hono<{ Bindings: Env }>();

type RoomBillStatus = "paid" | "unpaid" | "unbilled" | "vacant";

const periodPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

const revenueMonths = 6;

interface RoomStatsRow {
  id: string;
  room_number: string;
  tenant_id: string | null;
  bill_id: string | null;
  bill_status: string | null;
  last_billed_period: string | null;
}

interface BillStatsRow {
  id: string;
  room_number: string;
  tenant_name: string;
  status: string;
  total: number;
  sent_at: string | null;
  created_at: string;
}

interface PendingSlipRow {
  bill_id: string | null;
}

interface RevenueRow {
  period: string;
  amount: number;
}

interface DashboardKpis {
  bills: number;
  dueAmount: number;
  collectedAmount: number;
  unpaidAmount: number;
  unpaidRooms: number;
  unbilledRooms: number;
  vacantRooms: number;
  totalRooms: number;
  sentCount: number;
  paidCount: number;
}

interface RevenuePoint {
  period: string;
  amount: number;
}

interface UnpaidBill {
  id: string;
  roomNumber: string;
  tenantName: string;
  total: number;
  createdAt: string;
  sentAt: string | null;
  hasPendingSlip: boolean;
}

interface RoomStat {
  id: string;
  roomNumber: string;
  status: RoomBillStatus;
  hasPendingSlip: boolean;
  lastBilledPeriod: string | null;
  behindPeriods: number;
}

const lastBilledPeriodSql = "(SELECT b2.period FROM bills b2 WHERE b2.room_id = r.id ORDER BY b2.period DESC LIMIT 1)";

const roomsSql = `SELECT r.id, r.room_number, t.id AS tenant_id, b.id AS bill_id, b.status AS bill_status, ${lastBilledPeriodSql} AS last_billed_period FROM rooms r LEFT JOIN tenants t ON t.room_id = r.id AND t.status = 'current' LEFT JOIN bills b ON b.room_id = r.id AND b.period = ? ORDER BY ${roomNumberOrder("r.room_number")}`;

const latestBilledPeriodSql = "SELECT period FROM bills ORDER BY period DESC LIMIT 1";

const billsSql = `SELECT b.id, r.room_number, t.full_name AS tenant_name, b.status, b.total, b.sent_at, b.created_at FROM bills b JOIN rooms r ON r.id = b.room_id JOIN tenants t ON t.id = b.tenant_id WHERE b.period = ? ORDER BY b.created_at ASC, ${roomNumberOrder("r.room_number")}`;

const pendingSlipsSql =
  "SELECT s.bill_id FROM slips s JOIN bills b ON b.id = s.bill_id WHERE s.status = 'pending_review' AND b.period = ?";

const revenueSql =
  "SELECT b.period AS period, SUM(b.total) AS amount FROM bills b WHERE b.status = 'paid' AND b.period >= ? AND b.period <= ? GROUP BY b.period";

function isPeriod(value: unknown): value is string {
  return typeof value === "string" && periodPattern.test(value);
}

function shiftPeriod(period: string, delta: number): string {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  const index = year * 12 + (month - 1) + delta;
  const shiftedYear = Math.floor(index / 12);
  const shiftedMonth = index - shiftedYear * 12 + 1;

  return `${String(shiftedYear).padStart(4, "0")}-${String(shiftedMonth).padStart(2, "0")}`;
}

function monthsBetween(from: string, to: string): number {
  const fromIndex = Number(from.slice(0, 4)) * 12 + Number(from.slice(5, 7));
  const toIndex = Number(to.slice(0, 4)) * 12 + Number(to.slice(5, 7));

  return toIndex - fromIndex;
}

stats.get("/dashboard", async (c) => {
  const period = c.req.query("period") ?? "";

  if (!isPeriod(period)) {
    return c.json(errorBody("VALIDATION", "เดือนต้องอยู่ในรูปแบบ YYYY-MM", "period"), 400);
  }

  try {
    const revenueStart = shiftPeriod(period, -(revenueMonths - 1));

    const [roomResult, billResult, slipResult, revenueResult, latestResult] = await Promise.all([
      c.env.DB.prepare(roomsSql).bind(period).all<RoomStatsRow>(),
      c.env.DB.prepare(billsSql).bind(period).all<BillStatsRow>(),
      c.env.DB.prepare(pendingSlipsSql).bind(period).all<PendingSlipRow>(),
      c.env.DB.prepare(revenueSql).bind(revenueStart, period).all<RevenueRow>(),
      c.env.DB.prepare(latestBilledPeriodSql).all<{ period: string }>(),
    ]);

    const latestBilledPeriod = latestResult.results[0]?.period ?? null;

    const pendingSlipBillIds = new Set(
      slipResult.results.map((row) => row.bill_id).filter((id): id is string => id !== null),
    );

    let dueAmount = 0;
    let collectedAmount = 0;
    let unpaidAmount = 0;
    let sentCount = 0;
    let paidCount = 0;

    const unpaidBills: UnpaidBill[] = [];

    for (const bill of billResult.results) {
      dueAmount += bill.total;

      if (bill.sent_at !== null) {
        sentCount += 1;
      }

      if (bill.status === "paid") {
        collectedAmount += bill.total;
        paidCount += 1;
        continue;
      }

      unpaidAmount += bill.total;
      unpaidBills.push({
        id: bill.id,
        roomNumber: bill.room_number,
        tenantName: bill.tenant_name,
        total: bill.total,
        createdAt: bill.created_at,
        sentAt: bill.sent_at,
        hasPendingSlip: pendingSlipBillIds.has(bill.id),
      });
    }

    let vacantRooms = 0;
    let unbilledRooms = 0;

    const rooms: RoomStat[] = roomResult.results.map((room) => {
      let status: RoomBillStatus = "unpaid";

      if (room.tenant_id === null) {
        status = "vacant";
        vacantRooms += 1;
      } else if (room.bill_id === null) {
        status = "unbilled";
        unbilledRooms += 1;
      } else if (room.bill_status === "paid") {
        status = "paid";
      }

      let behindPeriods = 0;

      if (status !== "vacant" && room.last_billed_period !== null && latestBilledPeriod !== null) {
        const gap = monthsBetween(room.last_billed_period, latestBilledPeriod);

        if (gap > 0) {
          behindPeriods = gap;
        }
      }

      return {
        id: room.id,
        roomNumber: room.room_number,
        status,
        hasPendingSlip: room.bill_id !== null && pendingSlipBillIds.has(room.bill_id),
        lastBilledPeriod: room.last_billed_period,
        behindPeriods,
      };
    });

    const revenueByPeriod = new Map(revenueResult.results.map((row) => [row.period, row.amount]));
    const revenue: RevenuePoint[] = [];

    for (let offset = revenueMonths - 1; offset >= 0; offset -= 1) {
      const month = shiftPeriod(period, -offset);
      revenue.push({ period: month, amount: revenueByPeriod.get(month) ?? 0 });
    }

    const kpis: DashboardKpis = {
      bills: billResult.results.length,
      dueAmount,
      collectedAmount,
      unpaidAmount,
      unpaidRooms: unpaidBills.length,
      unbilledRooms,
      vacantRooms,
      totalRooms: roomResult.results.length,
      sentCount,
      paidCount,
    };

    return c.json({ ok: true, period, latestBilledPeriod, kpis, revenue, unpaidBills, rooms }, 200);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ message: "load dashboard stats failed", period, error: detail }));
    return c.json(errorBody("INTERNAL", "โหลดข้อมูลแดชบอร์ดไม่สำเร็จ"), 500);
  }
});

export default stats;
