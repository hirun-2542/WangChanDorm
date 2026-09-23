import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configurePayout, createFamily, signIn, withAuth, type TestSession } from "./auth-helper";

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
  lastBilledPeriod: string | null;
  behindPeriods: number;
  arrears: { periods: string[]; amount: number };
}

interface DashboardPayload {
  ok: boolean;
  period: string;
  latestBilledPeriod: string | null;
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

let session: TestSession;

function post(url: string, payload: Record<string, unknown>): Promise<Response> {
  return SELF.fetch(
    url,
    withAuth(session, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

async function putRates(water: number, electric: number): Promise<void> {
  const response = await SELF.fetch(
    settingsUrl,
    withAuth(session, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ defaultWaterRate: water, defaultElectricRate: electric }),
    }),
  );

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
    "INSERT INTO slips (id, family_id, bill_id, line_user_id, image_key, verify_result, amount, trans_ref, bill_total, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review')",
  )
    .bind(
      crypto.randomUUID(),
      session.familyId,
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

/**
 * ใส่ห้อง ผู้เช่า และบิลตรงลงฐานข้อมูลของครอบครัวที่ระบุ
 *
 * ใช้พิสูจน์ว่าการกรองระดับ SQL ของแดชบอร์ดกันครอบครัวอื่นได้จริง
 * โดยไม่ต้องพึ่ง route ของห้อง/ผู้เช่า/บิล
 */
async function seedFamilyBill(
  familyId: string,
  bill: { roomNumber: string; tenantName: string; period: string; total: number; status: "paid" | "unpaid" },
): Promise<void> {
  const roomId = crypto.randomUUID();

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO rooms (id, family_id, room_number, rent, status) VALUES (?, ?, ?, ?, 'occupied')",
    ).bind(roomId, familyId, bill.roomNumber, bill.total),
    env.DB.prepare(
      "INSERT INTO tenants (id, family_id, full_name, phone, room_id, check_in_date, status) VALUES (?, ?, ?, '081-234-5678', ?, '2025-03-01', 'current')",
    ).bind(crypto.randomUUID(), familyId, bill.tenantName, roomId),
    env.DB.prepare(
      "INSERT INTO bills (id, family_id, room_id, tenant_id, period, room_number, tenant_name, rent, water_previous, water_current, water_units, water_rate, water_amount, electric_mode, electric_previous, electric_current, electric_units, electric_rate, electric_amount, total, status) SELECT ?, ?, r.id, t.id, ?, ?, ?, ?, 0, 0, 0, 18, 0, 'meter', 0, 0, 0, 7, 0, ?, ? FROM rooms r JOIN tenants t ON t.room_id = r.id WHERE r.id = ?",
    ).bind(
      crypto.randomUUID(),
      familyId,
      bill.period,
      bill.roomNumber,
      bill.tenantName,
      bill.total,
      bill.total,
      bill.status,
      roomId,
    ),
  ]);
}

async function dashboard(period: string, as: TestSession = session): Promise<DashboardPayload> {
  const response = await SELF.fetch(`${statsUrl}?period=${period}`, withAuth(as));
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
  session = await signIn();
  await resetData();
  await configurePayout();
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
      unbilledRooms: 0,
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
    expect(septemberStatus.get("P142")).toBe("unbilled");
    expect(septemberStatus.get("P143")).toBe("vacant");
    expect(septemberPayload.kpis.unbilledRooms).toBe(1);

    const octoberPayload = await dashboard("2026-10");
    const octoberStatus = new Map(octoberPayload.rooms.map((room) => [room.roomNumber, room.status]));
    expect(octoberStatus.get("P141")).toBe("unpaid");
    expect(octoberStatus.get("P142")).toBe("unbilled");
    expect(octoberStatus.get("P143")).toBe("vacant");
    expect(octoberPayload.kpis.unbilledRooms).toBe(1);
  });

  /**
   * กฎของหอ: คิดบิลเป็นรายเดือน และบิลค้างของงวดก่อนไม่มีผลกับการออกบิลงวดใหม่
   * แต่ "ห้องไหนค้าง" ต้องไม่หายไปจากสายตาเจ้าของหอ — behindPeriods บอกแค่ว่า
   * ยังไม่ออกบิลของงวดนั้น ส่วน arrears บอกว่าเงินของงวดก่อนยังไม่เข้า
   */
  it("records a room's arrears even while its current period is billed and unpaid", async () => {
    await putRates(18, 7);
    const room = await occupiedRoom("Q221", { rent: 3500, waterMeterInit: 0, electricMeterInit: 0 });

    const july = await generateOne("2026-07", room.room.id, { waterCurrent: 5, electricCurrent: 5 });
    const august = await generateOne("2026-08", room.room.id, { waterCurrent: 7, electricCurrent: 7 });
    const september = await generateOne("2026-09", room.room.id, { waterCurrent: 9, electricCurrent: 9 });

    // จ่ายแต่งวด 2026-07 ที่เก่าสุด
    await markPaid(july.id);

    const sept = pick((await dashboard("2026-09")).rooms, (item) => item.roomNumber === "Q221");
    expect(sept.status).toBe("unpaid");
    expect(sept.behindPeriods).toBe(0);
    expect(sept.arrears.periods).toEqual(["2026-08"]);
    expect(sept.arrears.amount).toBe(august.total);

    // ดูงวด 2026-07: บิลของงวดนั้นจ่ายแล้วจึงไม่มีอะไรค้าง และงวดถัดไปไม่ถูกนับเป็นค้าง
    const julyView = pick((await dashboard("2026-07")).rooms, (item) => item.roomNumber === "Q221");
    expect(julyView.status).toBe("paid");
    expect(julyView.arrears.periods).toEqual([]);
    expect(julyView.arrears.amount).toBe(0);

    // งวด 2026-08 ยังไม่จ่าย และ 2026-07 จ่ายแล้ว จึงไม่มี arrears ก่อนหน้านั้น
    const augustView = pick((await dashboard("2026-08")).rooms, (item) => item.roomNumber === "Q221");
    expect(augustView.status).toBe("unpaid");
    expect(augustView.arrears.periods).toEqual([]);

    expect(september.total).toBeGreaterThan(0);
  });

  it("never counts the requested period itself as arrears", async () => {
    await putRates(18, 7);
    const room = await occupiedRoom("Q222", { rent: 3500, waterMeterInit: 0, electricMeterInit: 0 });

    await generateOne("2026-08", room.room.id, { waterCurrent: 5, electricCurrent: 5 });

    const payload = await dashboard("2026-08");
    const stat = pick(payload.rooms, (item) => item.roomNumber === "Q222");

    expect(stat.status).toBe("unpaid");
    expect(stat.arrears.periods).toEqual([]);
    expect(stat.arrears.amount).toBe(0);
  });

  it("reports the newest billed period and how many periods each occupied room is behind it", async () => {
    await putRates(18, 7);
    const behind = await occupiedRoom("Q201", { rent: 3500, waterMeterInit: 0, electricMeterInit: 0 });
    const current = await occupiedRoom("Q202", { rent: 3500, waterMeterInit: 0, electricMeterInit: 0 });
    await occupiedRoom("Q203", { rent: 3500, waterMeterInit: 0, electricMeterInit: 0 });
    await newRoom({ roomNumber: "Q204", rent: 3200, waterMeterInit: 0, electricMeterInit: 0 });

    await generateOne("2026-07", behind.room.id, { waterCurrent: 5, electricCurrent: 5 });
    await generateOne("2026-08", current.room.id, { waterCurrent: 5, electricCurrent: 5 });

    const payload = await dashboard("2026-08");

    expect(payload.latestBilledPeriod).toBe("2026-08");

    const behindStat = pick(payload.rooms, (room) => room.roomNumber === "Q201");
    expect(behindStat.status).toBe("unbilled");
    expect(behindStat.lastBilledPeriod).toBe("2026-07");
    expect(behindStat.behindPeriods).toBe(1);

    const currentStat = pick(payload.rooms, (room) => room.roomNumber === "Q202");
    expect(currentStat.status).toBe("unpaid");
    expect(currentStat.lastBilledPeriod).toBe("2026-08");
    expect(currentStat.behindPeriods).toBe(0);

    const neverStat = pick(payload.rooms, (room) => room.roomNumber === "Q203");
    expect(neverStat.status).toBe("unbilled");
    expect(neverStat.lastBilledPeriod).toBeNull();
    expect(neverStat.behindPeriods).toBe(0);

    const vacantStat = pick(payload.rooms, (room) => room.roomNumber === "Q204");
    expect(vacantStat.status).toBe("vacant");
    expect(vacantStat.behindPeriods).toBe(0);
  });

  it("never flags a vacant room as behind even when its last bill predates the newest period", async () => {
    await putRates(18, 7);
    const movedOut = await occupiedRoom("Q211", { rent: 3500, waterMeterInit: 0, electricMeterInit: 0 });
    const stays = await occupiedRoom("Q212", { rent: 3500, waterMeterInit: 0, electricMeterInit: 0 });

    await generateOne("2026-07", movedOut.room.id, { waterCurrent: 5, electricCurrent: 5 });
    await generateOne("2026-08", stays.room.id, { waterCurrent: 5, electricCurrent: 5 });

    const checkout = await post(`${tenantsUrl}/${movedOut.tenant.id}/checkout`, { checkOutDate: "2026-08-31" });
    expect(checkout.status).toBe(200);

    const payload = await dashboard("2026-08");

    expect(payload.latestBilledPeriod).toBe("2026-08");

    const stat = pick(payload.rooms, (room) => room.roomNumber === "Q211");
    expect(stat.status).toBe("vacant");
    expect(stat.lastBilledPeriod).toBe("2026-07");
    expect(stat.behindPeriods).toBe(0);
  });

  it("reports every occupied room as unbilled for a month with no bills", async () => {
    await putRates(18, 7);
    await occupiedRoom("P171", { rent: 3500, waterMeterInit: 0, electricMeterInit: 0 });
    await occupiedRoom("P172", { rent: 3600, waterMeterInit: 0, electricMeterInit: 0 });
    await occupiedRoom("P173", { rent: 3700, waterMeterInit: 0, electricMeterInit: 0 });
    await newRoom({ roomNumber: "P174", rent: 3200, waterMeterInit: 0, electricMeterInit: 0 });

    const payload = await dashboard("2026-09");

    expect(payload.rooms.map((room) => room.roomNumber)).toEqual(["P171", "P172", "P173", "P174"]);
    expect(payload.rooms.map((room) => room.status)).toEqual(["unbilled", "unbilled", "unbilled", "vacant"]);
    expect(payload.rooms.some((room) => room.status === "unpaid")).toBe(false);
    expect(payload.kpis).toEqual({
      bills: 0,
      dueAmount: 0,
      collectedAmount: 0,
      unpaidAmount: 0,
      unpaidRooms: 0,
      unbilledRooms: 3,
      vacantRooms: 1,
      totalRooms: 4,
      sentCount: 0,
      paidCount: 0,
    });
    expect(payload.unpaidBills).toEqual([]);
  });

  it("separates paid, unpaid, unbilled and vacant rooms so the counts add up to the total", async () => {
    await putRates(18, 7);
    const paidRoom = await occupiedRoom("P181", { rent: 3500, waterMeterInit: 0, electricMeterInit: 0 });
    const unpaidRoom = await occupiedRoom("P182", { rent: 3600, waterMeterInit: 0, electricMeterInit: 0 });
    await occupiedRoom("P183", { rent: 3700, waterMeterInit: 0, electricMeterInit: 0 });
    await newRoom({ roomNumber: "P184", rent: 3200, waterMeterInit: 0, electricMeterInit: 0 });

    const bills = await generate("2026-09", [
      { roomId: paidRoom.room.id, waterCurrent: 5, electricCurrent: 5 },
      { roomId: unpaidRoom.room.id, waterCurrent: 5, electricCurrent: 5 },
    ]);

    await markPaid(pick(bills, (bill) => bill.roomId === paidRoom.room.id).id);

    const payload = await dashboard("2026-09");
    const statuses = payload.rooms.map((room) => room.status);

    expect(statuses).toEqual(["paid", "unpaid", "unbilled", "vacant"]);
    expect(statuses.filter((status) => status === "paid")).toHaveLength(1);
    expect(statuses.filter((status) => status === "unpaid")).toHaveLength(1);
    expect(statuses.filter((status) => status === "unbilled")).toHaveLength(1);
    expect(statuses.filter((status) => status === "vacant")).toHaveLength(1);
    expect(payload.kpis.paidCount + payload.kpis.unpaidRooms + payload.kpis.unbilledRooms + payload.kpis.vacantRooms).toBe(
      payload.kpis.totalRooms,
    );
    expect(payload.kpis.unbilledRooms).toBe(1);
    expect(payload.kpis.unpaidRooms).toBe(1);
    expect(payload.kpis.vacantRooms).toBe(1);
    expect(payload.kpis.paidCount).toBe(1);
    expect(payload.kpis.bills).toBe(2);
  });

  it("keeps each family's dashboard to itself", async () => {
    const other = await signIn("owner", await createFamily("หอของอีกครอบครัว"));

    await seedFamilyBill(session.familyId, {
      roomNumber: "F101",
      tenantName: "ผู้เช่าของเรา",
      period: "2026-09",
      total: 4000,
      status: "unpaid",
    });
    await seedFamilyBill(other.familyId, {
      roomNumber: "F101",
      tenantName: "ผู้เช่าของอีกครอบครัว",
      period: "2026-12",
      total: 9000,
      status: "paid",
    });

    const mine = await dashboard("2026-09");

    expect(mine.latestBilledPeriod).toBe("2026-09");
    expect(mine.kpis).toEqual({
      bills: 1,
      dueAmount: 4000,
      collectedAmount: 0,
      unpaidAmount: 4000,
      unpaidRooms: 1,
      unbilledRooms: 0,
      vacantRooms: 0,
      totalRooms: 1,
      sentCount: 0,
      paidCount: 0,
    });
    expect(mine.rooms.map((room) => room.roomNumber)).toEqual(["F101"]);
    expect(mine.rooms.map((room) => room.status)).toEqual(["unpaid"]);
    expect(mine.rooms.map((room) => room.lastBilledPeriod)).toEqual(["2026-09"]);
    expect(mine.rooms.map((room) => room.behindPeriods)).toEqual([0]);
    expect(mine.unpaidBills.map((bill) => bill.tenantName)).toEqual([
      "ผู้เช่าของเรา",
    ]);
    expect(mine.revenue.map((point) => point.amount)).toEqual([0, 0, 0, 0, 0, 0]);

    const theirs = await dashboard("2026-12", other);

    expect(theirs.latestBilledPeriod).toBe("2026-12");
    expect(theirs.kpis.bills).toBe(1);
    expect(theirs.kpis.totalRooms).toBe(1);
    expect(theirs.kpis.dueAmount).toBe(9000);
    expect(theirs.kpis.collectedAmount).toBe(9000);
    expect(theirs.unpaidBills).toEqual([]);
    expect(theirs.rooms.map((room) => room.roomNumber)).toEqual(["F101"]);
    expect(theirs.revenue.at(-1)).toEqual({ period: "2026-12", amount: 9000 });
  });

  it("answers 400 with the period field for a missing or malformed period", async () => {
    const missing = await SELF.fetch(statsUrl, withAuth(session));
    expect(missing.status).toBe(400);

    const missingBody = await missing.json<ErrorBody>();
    expect(missingBody.ok).toBe(false);
    expect(missingBody.error.code).toBe("VALIDATION");
    expect(missingBody.error.field).toBe("period");

    for (const bad of ["2026-13", "2026-9", "2026-00", "กันยายน-2569"]) {
      const response = await SELF.fetch(
        `${statsUrl}?period=${encodeURIComponent(bad)}`,
        withAuth(session),
      );
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
      unbilledRooms: 0,
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
