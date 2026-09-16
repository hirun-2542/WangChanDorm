import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const roomsUrl = "https://dorm.test/api/rooms";
const tenantsUrl = "https://dorm.test/api/tenants";
const billsUrl = "https://dorm.test/api/bills";
const settingsUrl = "https://dorm.test/api/settings";
const statsUrl = "https://dorm.test/api/stats/dashboard";

interface RoomPayload {
  id: string;
  roomNumber: string;
}

interface TenantPayload {
  id: string;
  fullName: string;
  roomId: string;
  roomNumber: string;
}

interface BillPayload {
  id: string;
  roomId: string;
  roomNumber: string;
  tenantName: string;
  period: string;
  total: number;
  status: "paid" | "unpaid";
  sentAt: string | null;
  createdAt: string;
}

interface ErrorBody {
  ok: boolean;
  error: { code: string; message: string; field?: string };
}

interface DashboardKpis {
  bills: number;
  dueAmount: number;
  collectedAmount: number;
  unpaidAmount: number;
  unpaidRooms: number;
  vacantRooms: number;
  totalRooms: number;
  sentCount: number;
  paidCount: number;
}

interface RevenuePoint {
  period: string;
  amount: number;
}

interface UnpaidBillPayload {
  id: string;
  roomNumber: string;
  tenantName: string;
  total: number;
  createdAt: string;
  sentAt: string | null;
  hasPendingSlip: boolean;
}

interface RoomStatPayload {
  id: string;
  roomNumber: string;
  status: string;
  hasPendingSlip: boolean;
}

interface DashboardPayload {
  ok: boolean;
  period: string;
  kpis: DashboardKpis;
  revenue: RevenuePoint[];
  unpaidBills: UnpaidBillPayload[];
  rooms: RoomStatPayload[];
}

function first<T>(items: T[]): T {
  const [item] = items;

  if (item === undefined) {
    throw new Error("expected at least one item");
  }

  return item;
}

function pick<T>(items: T[], predicate: (item: T) => boolean): T {
  const found = items.find(predicate);

  if (found === undefined) {
    throw new Error("expected a matching item");
  }

  return found;
}

function post(url: string, payload: Record<string, unknown>): Promise<Response> {
  return SELF.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function putRates(water: number, electric: number): Promise<void> {
  const response = await SELF.fetch(settingsUrl, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ defaultWaterRate: water, defaultElectricRate: electric }),
  });

  expect(response.status).toBe(200);
}

async function newRoom(payload: Record<string, unknown>): Promise<RoomPayload> {
  const response = await post(roomsUrl, payload);
  expect(response.status).toBe(201);
  return (await response.json<{ ok: boolean; room: RoomPayload }>()).room;
}

async function newTenant(roomId: string, fullName: string): Promise<TenantPayload> {
  const response = await post(tenantsUrl, { fullName, phone: "081-234-5678", roomId, checkInDate: "2025-03-01" });
  expect(response.status).toBe(201);
  return (await response.json<{ ok: boolean; tenant: TenantPayload }>()).tenant;
}

async function occupiedRoom(roomNumber: string, payload: Record<string, unknown> = {}): Promise<{ room: RoomPayload; tenant: TenantPayload }> {
  const room = await newRoom({ roomNumber, rent: 3500, ...payload });
  const tenant = await newTenant(room.id, `ผู้เช่า ${roomNumber}`);
  return { room, tenant };
}

async function generate(period: string, entries: Record<string, unknown>[]): Promise<BillPayload[]> {
  const response = await post(`${billsUrl}/generate`, { period, entries });
  expect(response.status).toBe(201);
  return (await response.json<{ ok: boolean; bills: BillPayload[] }>()).bills;
}

async function generateOne(period: string, roomId: string, entry: Record<string, unknown>): Promise<BillPayload> {
  return first(await generate(period, [{ roomId, ...entry }]));
}

async function markPaid(id: string): Promise<void> {
  const response = await post(`${billsUrl}/${id}/mark-paid`, { method: "transfer" });
  expect(response.status).toBe(200);
}

async function sendBill(id: string): Promise<void> {
  const response = await post(`${billsUrl}/${id}/send`, {});
  expect(response.status).toBe(200);
}

async function linkTenant(tenantId: string, lineUserId: string): Promise<void> {
  await env.DB.prepare("UPDATE tenants SET line_user_id = ? WHERE id = ?").bind(lineUserId, tenantId).run();
}

async function insertPendingSlip(billId: string, lineUserId: string, imageKey: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO slips (id, bill_id, line_user_id, image_key, easyslip_result, amount, trans_ref, bill_total, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_review')",
  )
    .bind(
      crypto.randomUUID(),
      billId,
      lineUserId,
      imageKey,
      JSON.stringify({ verified: true, amount: 100, transRef: `TR-${imageKey.slice(0, 8)}`, date: null, reason: "mismatch" }),
      100,
      `TR-${imageKey.slice(0, 8)}`,
      100,
    )
    .run();
}

async function dashboard(period: string): Promise<DashboardPayload> {
  const response = await SELF.fetch(`${statsUrl}?period=${period}`);
  expect(response.status).toBe(200);
  return await response.json<DashboardPayload>();
}

async function resetData(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM bill_charges"),
    env.DB.prepare("DELETE FROM slips"),
    env.DB.prepare("DELETE FROM bills"),
    env.DB.prepare("DELETE FROM tenants"),
    env.DB.prepare("DELETE FROM rooms"),
    env.DB.prepare("DELETE FROM line_pending"),
    env.DB.prepare("DELETE FROM settings"),
  ]);
}

beforeEach(async () => {
  await resetData();

  vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } })),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/stats/dashboard", () => {
  it("returns the exact KPI numbers for a month with paid, unpaid and vacant rooms", async () => {
    await putRates(18, 7);
    const paid = await occupiedRoom("P101", { rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    const unpaid = await occupiedRoom("P102", { rent: 4000, waterMeterInit: 30, electricMeterInit: 40 });
    await newRoom({ roomNumber: "P103", rent: 3200, waterMeterInit: 0, electricMeterInit: 0 });

    const bills = await generate("2026-09", [
      { roomId: paid.room.id, waterCurrent: 12, electricCurrent: 24 },
      { roomId: unpaid.room.id, waterCurrent: 35, electricCurrent: 45 },
    ]);

    const paidBill = pick(bills, (bill) => bill.roomId === paid.room.id);
    const unpaidBill = pick(bills, (bill) => bill.roomId === unpaid.room.id);
    expect(paidBill.total).toBe(3500 + 2 * 18 + 4 * 7);
    expect(unpaidBill.total).toBe(4000 + 5 * 18 + 5 * 7);

    await markPaid(paidBill.id);
    await linkTenant(unpaid.tenant.id, "U-stats-1");
    await sendBill(unpaidBill.id);

    const payload = await dashboard("2026-09");

    expect(payload.period).toBe("2026-09");
    expect(payload.kpis).toEqual({
      bills: 2,
      dueAmount: paidBill.total + unpaidBill.total,
      collectedAmount: paidBill.total,
      unpaidAmount: unpaidBill.total,
      unpaidRooms: 1,
      vacantRooms: 1,
      totalRooms: 3,
      sentCount: 1,
      paidCount: 1,
    });
  });

  it("returns six revenue bars ending at the requested month with zeros for the empty months", async () => {
    await putRates(18, 7);
    const { room } = await occupiedRoom("P111", { rent: 3500, waterMeterInit: 0, electricMeterInit: 0 });

    const january = await generateOne("2027-01", room.id, { waterCurrent: 10, electricCurrent: 10 });
    await generateOne("2027-02", room.id, { waterCurrent: 20, electricCurrent: 20 });
    const march = await generateOne("2027-03", room.id, { waterCurrent: 30, electricCurrent: 30 });

    await markPaid(january.id);
    await markPaid(march.id);

    const payload = await dashboard("2027-03");

    expect(payload.revenue).toEqual([
      { period: "2026-10", amount: 0 },
      { period: "2026-11", amount: 0 },
      { period: "2026-12", amount: 0 },
      { period: "2027-01", amount: january.total },
      { period: "2027-02", amount: 0 },
      { period: "2027-03", amount: march.total },
    ]);
    expect(payload.kpis.collectedAmount).toBe(march.total);
    expect(payload.kpis.unpaidAmount).toBe(0);
  });

  it("lists the month's unpaid bills oldest first with the room, tenant, amount and no pending slip", async () => {
    await putRates(18, 7);
    const a = await occupiedRoom("P121", { rent: 3500, waterMeterInit: 0, electricMeterInit: 0 });
    const b = await occupiedRoom("P122", { rent: 3600, waterMeterInit: 0, electricMeterInit: 0 });
    const c = await occupiedRoom("P123", { rent: 3700, waterMeterInit: 0, electricMeterInit: 0 });

    const bills = await generate("2026-09", [
      { roomId: a.room.id, waterCurrent: 5, electricCurrent: 5 },
      { roomId: b.room.id, waterCurrent: 5, electricCurrent: 5 },
      { roomId: c.room.id, waterCurrent: 5, electricCurrent: 5 },
    ]);

    const billA = pick(bills, (bill) => bill.roomId === a.room.id);
    const billB = pick(bills, (bill) => bill.roomId === b.room.id);
    const billC = pick(bills, (bill) => bill.roomId === c.room.id);

    await env.DB.prepare("UPDATE bills SET created_at = ? WHERE id = ?").bind("2026-09-03 09:00:00", billA.id).run();
    await env.DB.prepare("UPDATE bills SET created_at = ? WHERE id = ?").bind("2026-09-01 09:00:00", billB.id).run();
    await env.DB.prepare("UPDATE bills SET created_at = ? WHERE id = ?").bind("2026-09-02 09:00:00", billC.id).run();

    const payload = await dashboard("2026-09");

    expect(payload.unpaidBills.map((bill) => bill.roomNumber)).toEqual(["P122", "P123", "P121"]);
    expect(payload.unpaidBills.map((bill) => bill.createdAt)).toEqual([
      "2026-09-01 09:00:00",
      "2026-09-02 09:00:00",
      "2026-09-03 09:00:00",
    ]);

    const oldest = first(payload.unpaidBills);
    expect(oldest.id).toBe(billB.id);
    expect(oldest.roomNumber).toBe("P122");
    expect(oldest.tenantName).toBe("ผู้เช่า P122");
    expect(oldest.total).toBe(billB.total);
    expect(oldest.sentAt).toBeNull();
    expect(oldest.hasPendingSlip).toBe(false);
  });

  it("flags the bill and the room when a slip for that bill waits in review", async () => {
    await putRates(18, 7);
    const withSlip = await occupiedRoom("P131", { rent: 3500, waterMeterInit: 0, electricMeterInit: 0 });
    const withoutSlip = await occupiedRoom("P132", { rent: 3500, waterMeterInit: 0, electricMeterInit: 0 });

    const bills = await generate("2026-09", [
      { roomId: withSlip.room.id, waterCurrent: 5, electricCurrent: 5 },
      { roomId: withoutSlip.room.id, waterCurrent: 5, electricCurrent: 5 },
    ]);

    const slipBill = pick(bills, (bill) => bill.roomId === withSlip.room.id);
    const plainBill = pick(bills, (bill) => bill.roomId === withoutSlip.room.id);

    await insertPendingSlip(slipBill.id, "U-stats-slip", `${"a".repeat(32)}.png`);

    const payload = await dashboard("2026-09");

    expect(pick(payload.unpaidBills, (bill) => bill.id === slipBill.id).hasPendingSlip).toBe(true);
    expect(pick(payload.unpaidBills, (bill) => bill.id === plainBill.id).hasPendingSlip).toBe(false);

    expect(pick(payload.rooms, (room) => room.id === withSlip.room.id).hasPendingSlip).toBe(true);
    expect(pick(payload.rooms, (room) => room.id === withoutSlip.room.id).hasPendingSlip).toBe(false);
    expect(pick(payload.rooms, (room) => room.id === withSlip.room.id).status).toBe("unpaid");
  });

  it("decides each room's status from the requested month's bill", async () => {
    await putRates(18, 7);
    const paidRoom = await occupiedRoom("P141", { rent: 3500, waterMeterInit: 0, electricMeterInit: 0 });
    await occupiedRoom("P142", { rent: 3500, waterMeterInit: 0, electricMeterInit: 0 });
    await newRoom({ roomNumber: "P143", rent: 3200, waterMeterInit: 0, electricMeterInit: 0 });

    const september = await generateOne("2026-09", paidRoom.room.id, { waterCurrent: 5, electricCurrent: 5 });
    await markPaid(september.id);
    await generateOne("2026-10", paidRoom.room.id, { waterCurrent: 10, electricCurrent: 10 });

    const septemberPayload = await dashboard("2026-09");
    const septemberStatus = new Map(septemberPayload.rooms.map((room) => [room.roomNumber, room.status]));
    expect(septemberPayload.rooms.map((room) => room.roomNumber)).toEqual(["P141", "P142", "P143"]);
    expect(septemberStatus.get("P141")).toBe("paid");
    expect(septemberStatus.get("P142")).toBe("unpaid");
    expect(septemberStatus.get("P143")).toBe("vacant");

    const octoberPayload = await dashboard("2026-10");
    const octoberStatus = new Map(octoberPayload.rooms.map((room) => [room.roomNumber, room.status]));
    expect(octoberStatus.get("P141")).toBe("unpaid");
    expect(octoberStatus.get("P142")).toBe("unpaid");
    expect(octoberStatus.get("P143")).toBe("vacant");
  });

  it("answers 400 with the period field for a missing or malformed period", async () => {
    const missing = await SELF.fetch(statsUrl);
    expect(missing.status).toBe(400);

    const missingBody = await missing.json<ErrorBody>();
    expect(missingBody.ok).toBe(false);
    expect(missingBody.error.code).toBe("VALIDATION");
    expect(missingBody.error.field).toBe("period");

    for (const bad of ["2026-13", "2026-9", "2026-00", "กันยายน-2569"]) {
      const response = await SELF.fetch(`${statsUrl}?period=${encodeURIComponent(bad)}`);
      expect(response.status).toBe(400);

      const body = await response.json<ErrorBody>();
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("VALIDATION");
      expect(body.error.field).toBe("period");
    }
  });

  it("answers zeros and six zero bars for a period with no bills", async () => {
    await newRoom({ roomNumber: "P151", rent: 3200, waterMeterInit: 0, electricMeterInit: 0 });

    const payload = await dashboard("2030-01");

    expect(payload.period).toBe("2030-01");
    expect(payload.kpis).toEqual({
      bills: 0,
      dueAmount: 0,
      collectedAmount: 0,
      unpaidAmount: 0,
      unpaidRooms: 0,
      vacantRooms: 1,
      totalRooms: 1,
      sentCount: 0,
      paidCount: 0,
    });
    expect(payload.revenue).toEqual([
      { period: "2029-08", amount: 0 },
      { period: "2029-09", amount: 0 },
      { period: "2029-10", amount: 0 },
      { period: "2029-11", amount: 0 },
      { period: "2029-12", amount: 0 },
      { period: "2030-01", amount: 0 },
    ]);
    expect(payload.unpaidBills).toEqual([]);
    expect(payload.rooms).toHaveLength(1);
    expect(first(payload.rooms).roomNumber).toBe("P151");
    expect(first(payload.rooms).status).toBe("vacant");
    expect(first(payload.rooms).hasPendingSlip).toBe(false);
  });
});
