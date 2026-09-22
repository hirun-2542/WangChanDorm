import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { billsFocusHash, billsFocusOf, billsFocusTarget } from "../src/client/api";
import { configurePayout, createFamily, signIn, withAuth, type TestSession } from "./auth-helper";
import { flexText } from "./flex";

interface RoomPayload {
  id: string;
  roomNumber: string;
  rent: number;
  waterRate: number | null;
  electricMode: "meter" | "flat";
  electricRate: number | null;
  waterMeterInit: number;
  electricMeterInit: number;
  status: "vacant" | "occupied";
  lastElectricPeriod: string | null;
  charges: ChargePayload[];
  excludedDormChargeIds: string[];
  ownCharges: ChargePayload[];
}

interface TenantPayload {
  id: string;
  fullName: string;
  roomId: string;
  roomNumber: string;
  status: "current" | "moved-out";
}

interface ChargePayload {
  name: string;
  amount: number;
}

interface BillPayload {
  id: string;
  roomId: string;
  roomNumber: string;
  tenantId: string;
  tenantName: string;
  period: string;
  rent: number;
  waterPrevious: number;
  waterCurrent: number;
  waterUnits: number;
  waterRate: number;
  waterAmount: number;
  electricMode: "meter" | "flat";
  electricPrevious: number;
  electricCurrent: number;
  electricUnits: number | null;
  electricRate: number | null;
  electricAmount: number;
  charges: ChargePayload[];
  total: number;
  status: "paid" | "unpaid";
  paidAt: string | null;
  paidMethod: string | null;
  sentAt: string | null;
  createdAt: string;
}

interface MeterRowPayload {
  roomId: string;
  roomNumber: string;
  tenantId: string;
  tenantName: string;
  rent: number;
  waterRate: number;
  electricMode: "meter" | "flat";
  electricRate: number | null;
  waterPrevious: number;
  electricPrevious: number;
  existingBillId: string | null;
  charges: ChargePayload[];
}

interface ErrorBody {
  ok: boolean;
  error: { code: string; message: string; field?: string };
}

const roomsUrl = "https://dorm.test/api/rooms";
const tenantsUrl = "https://dorm.test/api/tenants";
const billsUrl = "https://dorm.test/api/bills";
const settingsUrl = "https://dorm.test/api/settings";

let session: TestSession;

/** ยิง API ด้วยเซสชันของครอบครัวที่เทสต์นี้ล็อกอินไว้ */
function api(url: string, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(url, withAuth(session, init));
}

beforeEach(async () => {
  session = await signIn();
  await configurePayout();
});

function post(url: string, payload: Record<string, unknown>): Promise<Response> {
  return api(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
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

async function putRates(water: number, electric: number): Promise<void> {
  const response = await api(settingsUrl, {
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

async function roomsList(): Promise<RoomPayload[]> {
  return (await (await api(roomsUrl)).json<{ ok: boolean; rooms: RoomPayload[] }>()).rooms;
}

async function setOwnCharges(roomId: string, ownCharges: ChargePayload[]): Promise<void> {
  const response = await api(`${roomsUrl}/${roomId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ownCharges }),
  });

  expect(response.status).toBe(200);
}

async function newTenant(roomId: string, fullName: string): Promise<TenantPayload> {
  const response = await post(tenantsUrl, { fullName, phone: "081-234-5678", roomId, checkInDate: "2025-03-01" });
  expect(response.status).toBe(201);
  return (await response.json<{ ok: boolean; tenant: TenantPayload }>()).tenant;
}

async function occupiedRoom(roomNumber: string, payload: Record<string, unknown> = {}): Promise<RoomPayload> {
  const room = await newRoom({ roomNumber, rent: 3500, ...payload });
  await newTenant(room.id, `ผู้เช่า ${roomNumber}`);
  return room;
}

function generate(payload: Record<string, unknown>): Promise<Response> {
  return post(`${billsUrl}/generate`, payload);
}

async function listBills(period: string): Promise<BillPayload[]> {
  const response = await api(`${billsUrl}?period=${period}`);
  expect(response.status).toBe(200);
  return (await response.json<{ ok: boolean; period: string; bills: BillPayload[] }>()).bills;
}

async function meterSheet(period: string): Promise<MeterRowPayload[]> {
  const response = await api(`${billsUrl}/meter-sheet?period=${period}`);
  expect(response.status).toBe(200);
  return (await response.json<{ ok: boolean; period: string; rows: MeterRowPayload[] }>()).rows;
}

function patchBill(id: string, payload: Record<string, unknown>): Promise<Response> {
  return api(`${billsUrl}/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function deleteBill(id: string): Promise<Response> {
  return api(`${billsUrl}/${id}`, { method: "DELETE" });
}

function markPaid(id: string, payload: Record<string, unknown>): Promise<Response> {
  return post(`${billsUrl}/${id}/mark-paid`, payload);
}

async function generatedBill(roomId: string, entry: Record<string, unknown>): Promise<BillPayload> {
  const response = await generate({ period: "2026-09", entries: [{ roomId, ...entry }] });
  expect(response.status).toBe(201);
  return first((await response.json<{ ok: boolean; bills: BillPayload[] }>()).bills);
}

async function findBill(period: string, id: string): Promise<BillPayload> {
  return pick(await listBills(period), (item) => item.id === id);
}

describe("monthly bill generation", () => {
  it("builds the meter sheet from occupied rooms only, with init readings and effective rates", async () => {
    await putRates(18, 7);
    const plain = await occupiedRoom("B201", { waterMeterInit: 10, electricMeterInit: 20 });
    const override = await occupiedRoom("B202", { waterRate: 25, electricRate: 9, waterMeterInit: 100, electricMeterInit: 200 });
    const vacant = await newRoom({ roomNumber: "B203", rent: 3200, waterMeterInit: 5, electricMeterInit: 6 });

    const rows = await meterSheet("2026-09");
    const occupiedNumbers = (await roomsList()).filter((room) => room.status === "occupied").map((room) => room.roomNumber);
    expect(rows.map((row) => row.roomNumber)).toEqual(occupiedNumbers);
    expect(rows.some((row) => row.roomId === vacant.id)).toBe(false);

    const plainRow = pick(rows, (row) => row.roomId === plain.id);
    expect(plainRow.tenantName).toBe("ผู้เช่า B201");
    expect(plainRow.rent).toBe(3500);
    expect(plainRow.waterRate).toBe(18);
    expect(plainRow.electricMode).toBe("meter");
    expect(plainRow.electricRate).toBe(7);
    expect(plainRow.waterPrevious).toBe(10);
    expect(plainRow.electricPrevious).toBe(20);
    expect(plainRow.existingBillId).toBeNull();

    const overrideRow = pick(rows, (row) => row.roomId === override.id);
    expect(overrideRow.waterRate).toBe(25);
    expect(overrideRow.electricRate).toBe(9);
    expect(overrideRow.waterPrevious).toBe(100);
    expect(overrideRow.electricPrevious).toBe(200);
  });

  it("orders the meter sheet and the bill list by room number naturally", async () => {
    await putRates(18, 7);
    const naturalOrder = ["201", "208", "208/1", "208/2", "208/10"];
    const roomIds: string[] = [];

    for (const roomNumber of ["208/10", "208/2", "201", "208/1", "208"]) {
      roomIds.push((await occupiedRoom(roomNumber, { waterMeterInit: 0, electricMeterInit: 0 })).id);
    }

    const rows = await meterSheet("2026-09");
    expect(rows.filter((row) => roomIds.includes(row.roomId)).map((row) => row.roomNumber)).toEqual(naturalOrder);

    const response = await generate({
      period: "2026-09",
      entries: roomIds.map((roomId) => ({ roomId, waterCurrent: 5, electricCurrent: 5 })),
    });
    expect(response.status).toBe(201);

    const created = (await response.json<{ ok: boolean; bills: BillPayload[] }>()).bills;
    expect(created.map((bill) => bill.roomNumber)).toEqual(naturalOrder);

    const listed = await listBills("2026-09");
    expect(listed.filter((bill) => roomIds.includes(bill.roomId)).map((bill) => bill.roomNumber)).toEqual(naturalOrder);
  });

  it("reads the dorm default rate from settings for rooms without an override", async () => {
    await putRates(20, 8);
    const plain = await occupiedRoom("B204", { waterMeterInit: 1, electricMeterInit: 2 });
    const override = await occupiedRoom("B205", { waterRate: 30, electricRate: 9.5, waterMeterInit: 1, electricMeterInit: 2 });

    const rows = await meterSheet("2026-09");
    const plainRow = pick(rows, (row) => row.roomId === plain.id);
    expect(plainRow.waterRate).toBe(20);
    expect(plainRow.electricRate).toBe(8);

    const overrideRow = pick(rows, (row) => row.roomId === override.id);
    expect(overrideRow.waterRate).toBe(30);
    expect(overrideRow.electricRate).toBe(9.5);
  });

  it("generates a metered bill, computes every amount and lists it as unpaid", async () => {
    await putRates(18, 7);
    const room = await occupiedRoom("B210", { rent: 3500, waterRate: 17.5, waterMeterInit: 10, electricMeterInit: 20 });

    const response = await generate({
      period: "2026-09",
      entries: [{ roomId: room.id, waterCurrent: 13.4, electricCurrent: 25 }],
    });
    expect(response.status).toBe(201);

    const created = (await response.json<{ ok: boolean; bills: BillPayload[] }>()).bills;
    expect(created).toHaveLength(1);

    const bill = first(created);
    expect(bill.roomId).toBe(room.id);
    expect(bill.roomNumber).toBe("B210");
    expect(bill.tenantName).toBe("ผู้เช่า B210");
    expect(bill.period).toBe("2026-09");
    expect(bill.rent).toBe(3500);
    expect(bill.waterPrevious).toBe(10);
    expect(bill.waterCurrent).toBe(13.4);
    expect(bill.waterUnits).toBeCloseTo(3.4);
    expect(bill.waterRate).toBe(17.5);
    expect(bill.waterAmount).toBe(Math.round(bill.waterUnits * bill.waterRate));
    expect(bill.waterAmount).toBe(60);
    expect(bill.electricMode).toBe("meter");
    expect(bill.electricPrevious).toBe(20);
    expect(bill.electricCurrent).toBe(25);
    expect(bill.electricUnits).toBeCloseTo(5);
    expect(bill.electricRate).toBe(7);
    expect(bill.electricAmount).toBe(35);
    expect(bill.charges).toEqual([]);
    expect(bill.total).toBe(3500 + 60 + 35);
    expect(bill.status).toBe("unpaid");
    expect(bill.paidAt).toBeNull();
    expect(bill.paidMethod).toBeNull();
    expect(bill.sentAt).toBeNull();

    const listed = pick(await listBills("2026-09"), (item) => item.id === bill.id);
    expect(listed).toEqual(bill);
    expect(listed.status).toBe("unpaid");
  });

  it("stores extra charges in order and counts them into the total", async () => {
    await putRates(18, 7);
    const room = await occupiedRoom("B211", { rent: 4200, waterMeterInit: 50, electricMeterInit: 60 });

    const response = await generate({
      period: "2026-09",
      entries: [
        {
          roomId: room.id,
          waterCurrent: 55,
          electricCurrent: 70,
          charges: [
            { name: "  ค่าอินเทอร์เน็ต  ", amount: 200 },
            { name: "ค่าจัดการขยะ", amount: 40 },
          ],
        },
      ],
    });
    expect(response.status).toBe(201);

    const bill = first((await response.json<{ ok: boolean; bills: BillPayload[] }>()).bills);
    expect(bill.charges).toEqual([
      { name: "ค่าอินเทอร์เน็ต", amount: 200 },
      { name: "ค่าจัดการขยะ", amount: 40 },
    ]);
    expect(bill.waterAmount).toBe(5 * 18);
    expect(bill.electricAmount).toBe(10 * 7);
    expect(bill.total).toBe(4200 + 90 + 70 + 240);

    const listed = first((await listBills("2026-09")).filter((item) => item.id === bill.id));
    expect(listed.charges).toEqual(bill.charges);
    expect(listed.total).toBe(bill.total);
  });

  it("bills a flat room with the supplied amount and still records the meter reading", async () => {
    await putRates(18, 7);
    const room = await newRoom({
      roomNumber: "B212",
      rent: 3800,
      electricMode: "flat",
      electricRate: 9,
      waterMeterInit: 130,
      electricMeterInit: 460,
    });
    await newTenant(room.id, "ผู้เช่า B212");

    const response = await generate({
      period: "2026-09",
      entries: [{ roomId: room.id, waterCurrent: 135, electricCurrent: 470, flatElectricAmount: 600 }],
    });
    expect(response.status).toBe(201);

    const bill = first((await response.json<{ ok: boolean; bills: BillPayload[] }>()).bills);
    expect(bill.electricMode).toBe("flat");
    expect(bill.electricUnits).toBeNull();
    expect(bill.electricRate).toBeNull();
    expect(bill.electricAmount).toBe(600);
    expect(bill.electricPrevious).toBe(460);
    expect(bill.electricCurrent).toBe(470);
    expect(bill.waterAmount).toBe(5 * 18);
    expect(bill.total).toBe(3800 + 90 + 600);
  });

  it("rejects a flat room without an amount and a flat reading below the previous one", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "B213", rent: 3800, electricMode: "flat", waterMeterInit: 130, electricMeterInit: 460 });
    await newTenant(room.id, "ผู้เช่า B213");
    const before = await listBills("2026-09");

    const missingAmount = await generate({
      period: "2026-09",
      entries: [{ roomId: room.id, waterCurrent: 135, electricCurrent: 470 }],
    });
    expect(missingAmount.status).toBe(400);

    const missingBody = await missingAmount.json<ErrorBody>();
    expect(missingBody.ok).toBe(false);
    expect(missingBody.error.code).toBe("VALIDATION");
    expect(missingBody.error.field).toBe("flatElectricAmount");

    const below = await generate({
      period: "2026-09",
      entries: [{ roomId: room.id, waterCurrent: 135, electricCurrent: 459, flatElectricAmount: 600 }],
    });
    expect(below.status).toBe(400);
    expect((await below.json<ErrorBody>()).error.field).toBe("electricCurrent");

    expect(await listBills("2026-09")).toEqual(before);
  });

  it("rejects a reading below the previous one for both meters and writes nothing", async () => {
    await putRates(18, 7);
    const room = await occupiedRoom("B214", { waterMeterInit: 100, electricMeterInit: 200 });
    const before = await listBills("2026-09");

    const water = await generate({
      period: "2026-09",
      entries: [{ roomId: room.id, waterCurrent: 99, electricCurrent: 210 }],
    });
    expect(water.status).toBe(400);

    const waterBody = await water.json<ErrorBody>();
    expect(waterBody.error.code).toBe("VALIDATION");
    expect(waterBody.error.field).toBe("waterCurrent");
    expect(waterBody.error.message).toContain("B214");

    const electric = await generate({
      period: "2026-09",
      entries: [{ roomId: room.id, waterCurrent: 100, electricCurrent: 199 }],
    });
    expect(electric.status).toBe(400);
    expect((await electric.json<ErrorBody>()).error.field).toBe("electricCurrent");

    expect(await listBills("2026-09")).toEqual(before);
  });

  it("rejects a second bill for the same room and period and writes nothing", async () => {
    await putRates(18, 7);
    const room = await occupiedRoom("B215", { waterMeterInit: 100, electricMeterInit: 200 });

    const created = await generate({
      period: "2026-09",
      entries: [{ roomId: room.id, waterCurrent: 110, electricCurrent: 215 }],
    });
    expect(created.status).toBe(201);

    const before = await listBills("2026-09");
    expect(before.filter((item) => item.roomId === room.id)).toHaveLength(1);

    const again = await generate({
      period: "2026-09",
      entries: [{ roomId: room.id, waterCurrent: 120, electricCurrent: 220 }],
    });
    expect(again.status).toBe(409);

    const body = await again.json<ErrorBody>();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.message).toContain("B215");

    expect(await listBills("2026-09")).toEqual(before);
  });

  /**
   * กฎของหอ: คิดบิลเป็นเดือนต่อเดือน บิลค้างของงวดก่อนเป็นเพียงข้อมูลที่ต้อง
   * บันทึกไว้ ไม่ใช่เงื่อนไขที่กันการออกบิลงวดใหม่ — ห้องที่ค้าง 3 งวดยังต้อง
   * ออกบิลของเดือนถัดไปได้ตามปกติ และเลขมิเตอร์ต้องต่อเนื่องจากใบล่าสุด
   */
  it("bills a new period normally while older periods are still unpaid", async () => {
    await putRates(18, 7);
    const room = await occupiedRoom("B250", { waterMeterInit: 100, electricMeterInit: 200 });

    const july = await generate({ period: "2026-07", entries: [{ roomId: room.id, waterCurrent: 105, electricCurrent: 210 }] });
    expect(july.status).toBe(201);
    const august = await generate({ period: "2026-08", entries: [{ roomId: room.id, waterCurrent: 110, electricCurrent: 220 }] });
    expect(august.status).toBe(201);

    const september = await generate({ period: "2026-09", entries: [{ roomId: room.id, waterCurrent: 115, electricCurrent: 230 }] });
    expect(september.status).toBe(201);

    const bill = first((await september.json<{ ok: boolean; bills: BillPayload[] }>()).bills);
    expect(bill.status).toBe("unpaid");
    // เลขตั้งต้นมาจากใบของงวดก่อนหน้าที่ใกล้ที่สุด ไม่ใช่เลขเริ่มต้นของห้อง
    expect(bill.waterPrevious).toBe(110);
    expect(bill.electricPrevious).toBe(220);

    const all = await listBills("2026-07");
    expect(all.filter((item) => item.roomId === room.id)).toHaveLength(1);
  });

  it("answers 409 instead of 500 when the same room is generated twice at once", async () => {
    await putRates(18, 7);
    const room = await occupiedRoom("B220", { waterMeterInit: 100, electricMeterInit: 200 });

    const responses = await Promise.all([
      generate({ period: "2026-09", entries: [{ roomId: room.id, waterCurrent: 110, electricCurrent: 215 }] }),
      generate({ period: "2026-09", entries: [{ roomId: room.id, waterCurrent: 111, electricCurrent: 216 }] }),
    ]);

    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([201, 409]);

    const conflict = first(responses.filter((response) => response.status === 409));
    const body = await conflict.json<ErrorBody>();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("CONFLICT");

    expect((await listBills("2026-09")).filter((item) => item.roomId === room.id)).toHaveLength(1);
  });

  it("uses the room's initial readings when billing a month older than an existing bill", async () => {
    await putRates(18, 7);
    const room = await occupiedRoom("B221", { waterMeterInit: 100, electricMeterInit: 200 });

    const september = await generate({
      period: "2026-09",
      entries: [{ roomId: room.id, waterCurrent: 118, electricCurrent: 240 }],
    });
    expect(september.status).toBe(201);

    const augustSheet = pick(await meterSheet("2026-08"), (row) => row.roomId === room.id);
    expect(augustSheet.waterPrevious).toBe(100);
    expect(augustSheet.electricPrevious).toBe(200);

    const august = await generate({
      period: "2026-08",
      entries: [{ roomId: room.id, waterCurrent: 110, electricCurrent: 230 }],
    });
    expect(august.status).toBe(201);

    const bill = first((await august.json<{ ok: boolean; bills: BillPayload[] }>()).bills);
    expect(bill.period).toBe("2026-08");
    expect(bill.waterPrevious).toBe(100);
    expect(bill.electricPrevious).toBe(200);
    expect(bill.waterUnits).toBeCloseTo(10);
    expect(bill.electricUnits).toBeCloseTo(30);
  });

  it("keeps a stored bill unchanged after the dorm defaults and the room's mode and rate change", async () => {
    await putRates(18, 7);
    const room = await occupiedRoom("B222", { rent: 3500, waterMeterInit: 100, electricMeterInit: 200 });

    const created = await generate({
      period: "2026-09",
      entries: [{ roomId: room.id, waterCurrent: 118, electricCurrent: 240 }],
    });
    expect(created.status).toBe(201);
    const bill = first((await created.json<{ ok: boolean; bills: BillPayload[] }>()).bills);
    expect(bill.waterRate).toBe(18);
    expect(bill.electricRate).toBe(7);
    expect(bill.electricMode).toBe("meter");

    await putRates(25, 9);

    const patched = await api(`${roomsUrl}/${room.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ waterRate: 40, electricMode: "flat", electricRate: 11 }),
    });
    expect(patched.status).toBe(200);

    const listed = first((await listBills("2026-09")).filter((item) => item.id === bill.id));
    expect(listed.waterRate).toBe(18);
    expect(listed.electricRate).toBe(7);
    expect(listed.electricMode).toBe("meter");
    expect(listed.waterAmount).toBe(bill.waterAmount);
    expect(listed.electricAmount).toBe(bill.electricAmount);
    expect(listed.total).toBe(bill.total);
    expect(listed).toEqual(bill);
  });

  it("rejects a vacant or unknown room and writes nothing", async () => {
    await putRates(18, 7);
    const occupied = await occupiedRoom("B216", { waterMeterInit: 100, electricMeterInit: 200 });
    const vacant = await newRoom({ roomNumber: "B217", rent: 3200, waterMeterInit: 10, electricMeterInit: 20 });
    const before = await listBills("2026-09");

    const vacantCall = await generate({
      period: "2026-09",
      entries: [
        { roomId: occupied.id, waterCurrent: 110, electricCurrent: 215 },
        { roomId: vacant.id, waterCurrent: 12, electricCurrent: 25 },
      ],
    });
    expect(vacantCall.status).toBe(400);

    const vacantBody = await vacantCall.json<ErrorBody>();
    expect(vacantBody.error.code).toBe("VALIDATION");
    expect(vacantBody.error.field).toBe("entries");
    expect(vacantBody.error.message).toContain("B217");

    const unknown = await generate({
      period: "2026-09",
      entries: [{ roomId: "room-does-not-exist", waterCurrent: 1, electricCurrent: 1 }],
    });
    expect(unknown.status).toBe(400);
    expect((await unknown.json<ErrorBody>()).error.field).toBe("entries");

    const repeated = await generate({
      period: "2026-09",
      entries: [
        { roomId: occupied.id, waterCurrent: 110, electricCurrent: 215 },
        { roomId: occupied.id, waterCurrent: 111, electricCurrent: 216 },
      ],
    });
    expect(repeated.status).toBe(400);
    expect((await repeated.json<ErrorBody>()).error.field).toBe("entries");

    expect(await listBills("2026-09")).toEqual(before);
  });

  it("carries a bill's readings into the next period's meter sheet", async () => {
    await putRates(18, 7);
    const room = await occupiedRoom("B218", { waterMeterInit: 100, electricMeterInit: 200 });

    const created = await generate({
      period: "2026-09",
      entries: [{ roomId: room.id, waterCurrent: 118.5, electricCurrent: 240 }],
    });
    expect(created.status).toBe(201);
    const bill = first((await created.json<{ ok: boolean; bills: BillPayload[] }>()).bills);

    const september = await meterSheet("2026-09");
    expect(pick(september, (row) => row.roomId === room.id).existingBillId).toBe(bill.id);

    const october = await meterSheet("2026-10");
    const nextRow = pick(october, (row) => row.roomId === room.id);
    expect(nextRow.waterPrevious).toBe(118.5);
    expect(nextRow.electricPrevious).toBe(240);
    expect(nextRow.existingBillId).toBeNull();
  });

  it("rejects a reading below the previous bill's reading in the next period", async () => {
    await putRates(18, 7);
    const room = await occupiedRoom("B219", { waterMeterInit: 100, electricMeterInit: 200 });

    const created = await generate({
      period: "2026-09",
      entries: [{ roomId: room.id, waterCurrent: 118, electricCurrent: 240 }],
    });
    expect(created.status).toBe(201);

    const before = await listBills("2026-10");

    const below = await generate({
      period: "2026-10",
      entries: [{ roomId: room.id, waterCurrent: 117, electricCurrent: 241 }],
    });
    expect(below.status).toBe(400);

    const body = await below.json<ErrorBody>();
    expect(body.error.field).toBe("waterCurrent");
    expect(body.error.message).toContain("B219");

    expect(await listBills("2026-10")).toEqual(before);
  });

  it("rejects a malformed period and an empty entry list", async () => {
    await putRates(18, 7);

    const badPeriod = await api(`${billsUrl}?period=2026-13`);
    expect(badPeriod.status).toBe(400);
    expect((await badPeriod.json<ErrorBody>()).error.field).toBe("period");

    const missingPeriod = await api(billsUrl);
    expect(missingPeriod.status).toBe(400);
    expect((await missingPeriod.json<ErrorBody>()).error.field).toBe("period");

    const badSheet = await api(`${billsUrl}/meter-sheet?period=กันยายน-2569`);
    expect(badSheet.status).toBe(400);
    expect((await badSheet.json<ErrorBody>()).error.field).toBe("period");

    const badGenerate = await generate({ period: "2026-9", entries: [{ roomId: "x", waterCurrent: 1, electricCurrent: 1 }] });
    expect(badGenerate.status).toBe(400);
    expect((await badGenerate.json<ErrorBody>()).error.field).toBe("period");

    const emptyEntries = await generate({ period: "2026-09", entries: [] });
    expect(emptyEntries.status).toBe(400);
    expect((await emptyEntries.json<ErrorBody>()).error.field).toBe("entries");

    const badCharge = await generate({
      period: "2026-09",
      entries: [{ roomId: "x", waterCurrent: 1, electricCurrent: 1, charges: [{ name: "   ", amount: 10 }] }],
    });
    expect(badCharge.status).toBe(400);

    const badChargeBody = await badCharge.json<ErrorBody>();
    expect(badChargeBody.error.field).toBe("charges");
    expect(badChargeBody.error.message.length).toBeGreaterThan(0);
  });
});

describe("bill management", () => {
  it("corrects an unpaid metered bill's readings from the snapshot rate", async () => {
    await putRates(18, 7);
    const room = await occupiedRoom("B230", { rent: 3500, waterRate: 17.5, waterMeterInit: 10, electricMeterInit: 20 });
    const bill = await generatedBill(room.id, { waterCurrent: 13, electricCurrent: 25 });
    expect(bill.waterRate).toBe(17.5);
    expect(bill.electricRate).toBe(7);
    expect(bill.createdAt.length).toBeGreaterThan(0);

    const response = await patchBill(bill.id, { waterCurrent: 20, electricCurrent: 30 });
    expect(response.status).toBe(200);

    const patched = (await response.json<{ ok: boolean; bill: BillPayload }>()).bill;
    expect(patched.id).toBe(bill.id);
    expect(patched.waterPrevious).toBe(10);
    expect(patched.waterCurrent).toBe(20);
    expect(patched.waterUnits).toBeCloseTo(10);
    expect(patched.waterRate).toBe(17.5);
    expect(patched.waterAmount).toBe(Math.round(10 * 17.5));
    expect(patched.electricPrevious).toBe(20);
    expect(patched.electricCurrent).toBe(30);
    expect(patched.electricUnits).toBeCloseTo(10);
    expect(patched.electricRate).toBe(7);
    expect(patched.electricAmount).toBe(70);
    expect(patched.total).toBe(3500 + 175 + 70);
    expect(patched.status).toBe("unpaid");

    const listed = await findBill("2026-09", bill.id);
    expect(listed.waterCurrent).toBe(20);
    expect(listed.waterAmount).toBe(175);
    expect(listed.total).toBe(3745);
  });

  it("replaces a bill's extra charges and counts them into the total", async () => {
    await putRates(18, 7);
    const room = await occupiedRoom("B231", { rent: 4000, waterMeterInit: 10, electricMeterInit: 20 });
    const bill = await generatedBill(room.id, { waterCurrent: 12, electricCurrent: 24 });
    expect(bill.total).toBe(4000 + 36 + 28);

    const added = await patchBill(bill.id, {
      charges: [
        { name: "ค่าอินเทอร์เน็ต", amount: 200 },
        { name: "ค่าจัดการขยะ", amount: 40 },
      ],
    });
    expect(added.status).toBe(200);

    const withCharges = (await added.json<{ ok: boolean; bill: BillPayload }>()).bill;
    expect(withCharges.charges).toEqual([
      { name: "ค่าอินเทอร์เน็ต", amount: 200 },
      { name: "ค่าจัดการขยะ", amount: 40 },
    ]);
    expect(withCharges.total).toBe(4000 + 36 + 28 + 240);

    const listed = await findBill("2026-09", bill.id);
    expect(listed.charges).toEqual(withCharges.charges);
    expect(listed.total).toBe(withCharges.total);

    const cleared = await patchBill(bill.id, { charges: [] });
    expect(cleared.status).toBe(200);

    const empty = (await cleared.json<{ ok: boolean; bill: BillPayload }>()).bill;
    expect(empty.charges).toEqual([]);
    expect(empty.total).toBe(4000 + 36 + 28);
    expect((await findBill("2026-09", bill.id)).charges).toEqual([]);
  });

  it("updates a flat bill's amount while keeping its units and rate null", async () => {
    await putRates(18, 7);
    const room = await newRoom({ roomNumber: "B232", rent: 3800, electricMode: "flat", waterMeterInit: 130, electricMeterInit: 460 });
    await newTenant(room.id, "ผู้เช่า B232");
    const bill = await generatedBill(room.id, { waterCurrent: 135, electricCurrent: 470, flatElectricAmount: 600 });
    expect(bill.electricUnits).toBeNull();
    expect(bill.electricRate).toBeNull();
    expect(bill.total).toBe(3800 + 90 + 600);

    const response = await patchBill(bill.id, { flatElectricAmount: 720 });
    expect(response.status).toBe(200);

    const patched = (await response.json<{ ok: boolean; bill: BillPayload }>()).bill;
    expect(patched.electricMode).toBe("flat");
    expect(patched.electricUnits).toBeNull();
    expect(patched.electricRate).toBeNull();
    expect(patched.electricAmount).toBe(720);
    expect(patched.waterAmount).toBe(5 * 18);
    expect(patched.total).toBe(3800 + 90 + 720);

    const listed = await findBill("2026-09", bill.id);
    expect(listed.electricAmount).toBe(720);
    expect(listed.electricUnits).toBeNull();
    expect(listed.total).toBe(4610);
  });

  it("rejects a corrected reading that would double-bill the units of the next month's bill", async () => {
    await putRates(18, 7);
    const room = await occupiedRoom("B243", { waterMeterInit: 100, electricMeterInit: 200 });
    const september = await generatedBill(room.id, { waterCurrent: 110, electricCurrent: 215 });

    const october = await generate({
      period: "2026-10",
      entries: [{ roomId: room.id, waterCurrent: 120, electricCurrent: 225 }],
    });
    expect(october.status).toBe(201);

    const waterOverlap = await patchBill(september.id, { waterCurrent: 120 });
    expect(waterOverlap.status).toBe(400);

    const waterBody = await waterOverlap.json<ErrorBody>();
    expect(waterBody.ok).toBe(false);
    expect(waterBody.error.code).toBe("VALIDATION");
    expect(waterBody.error.field).toBe("waterCurrent");
    expect(waterBody.error.message).toContain("B243");

    const electricOverlap = await patchBill(september.id, { electricCurrent: 230 });
    expect(electricOverlap.status).toBe(400);
    expect((await electricOverlap.json<ErrorBody>()).error.field).toBe("electricCurrent");

    expect(await findBill("2026-09", september.id)).toEqual(september);

    // ยังแก้ได้ตราบใดที่ไม่ก้าวล่วงเข้าไปในเดือนถัดไป
    const allowed = await patchBill(september.id, { waterCurrent: 105, electricCurrent: 210 });
    expect(allowed.status).toBe(200);

    const patched = (await allowed.json<{ ok: boolean; bill: BillPayload }>()).bill;
    expect(patched.waterUnits).toBeCloseTo(5);
    expect(patched.electricUnits).toBeCloseTo(10);
    expect(await findBill("2026-09", september.id)).toEqual(patched);
  });

  it("rejects a corrected reading below the bill's previous one and changes nothing", async () => {
    await putRates(18, 7);
    const room = await occupiedRoom("B233", { waterMeterInit: 100, electricMeterInit: 200 });
    const bill = await generatedBill(room.id, { waterCurrent: 110, electricCurrent: 215 });

    const water = await patchBill(bill.id, { waterCurrent: 99 });
    expect(water.status).toBe(400);

    const waterBody = await water.json<ErrorBody>();
    expect(waterBody.error.code).toBe("VALIDATION");
    expect(waterBody.error.field).toBe("waterCurrent");
    expect(waterBody.error.message).toContain("B233");

    const electric = await patchBill(bill.id, { electricCurrent: 199 });
    expect(electric.status).toBe(400);
    expect((await electric.json<ErrorBody>()).error.field).toBe("electricCurrent");

    expect(await findBill("2026-09", bill.id)).toEqual(bill);
  });

  it("refuses to edit or delete a paid bill", async () => {
    await putRates(18, 7);
    const room = await occupiedRoom("B234", { waterMeterInit: 100, electricMeterInit: 200 });
    const bill = await generatedBill(room.id, { waterCurrent: 110, electricCurrent: 215 });

    const paidResponse = await markPaid(bill.id, { method: "cash" });
    expect(paidResponse.status).toBe(200);
    const paidBill = (await paidResponse.json<{ ok: boolean; bill: BillPayload }>()).bill;

    const patch = await patchBill(bill.id, { waterCurrent: 120 });
    expect(patch.status).toBe(409);
    expect((await patch.json<ErrorBody>()).error.code).toBe("CONFLICT");

    const removed = await deleteBill(bill.id);
    expect(removed.status).toBe(409);
    expect((await removed.json<ErrorBody>()).error.code).toBe("CONFLICT");

    expect(await findBill("2026-09", bill.id)).toEqual(paidBill);
  });

  it("deletes an unpaid bill with its charges and frees the room for the period", async () => {
    await putRates(18, 7);
    const room = await occupiedRoom("B235", { waterMeterInit: 100, electricMeterInit: 200 });
    const bill = await generatedBill(room.id, {
      waterCurrent: 110,
      electricCurrent: 215,
      charges: [{ name: "ค่าอินเทอร์เน็ต", amount: 200 }],
    });
    expect((await findBill("2026-09", bill.id)).charges).toHaveLength(1);

    const response = await deleteBill(bill.id);
    expect(response.status).toBe(200);
    expect((await response.json<{ ok: boolean }>()).ok).toBe(true);

    const after = await listBills("2026-09");
    expect(after.some((item) => item.id === bill.id)).toBe(false);
    expect(after.filter((item) => item.roomId === room.id)).toHaveLength(0);

    const again = await generate({ period: "2026-09", entries: [{ roomId: room.id, waterCurrent: 112, electricCurrent: 218 }] });
    expect(again.status).toBe(201);

    const regenerated = first((await again.json<{ ok: boolean; bills: BillPayload[] }>()).bills);
    expect(regenerated.roomId).toBe(room.id);
    expect(regenerated.charges).toEqual([]);
    expect((await findBill("2026-09", regenerated.id)).charges).toEqual([]);
  });

  /**
   * สลิปต้องอ้างถึงบิลที่มันเทียบไว้เพื่อให้ย้อนตรวจได้ จึงลบบิลที่มีสลิปอ้างถึง
   * ไม่ได้ — FK บังคับไว้แล้ว แต่เดิมตอบ 500 "ลบบิลไม่สำเร็จ" ซึ่งผู้ใช้อ่านแล้ว
   * ไม่รู้ว่าต้องทำอะไร ต้องเป็น 409 พร้อมบอกทางออก
   */
  it("refuses to delete a bill a slip references, with a reason the owner can act on", async () => {
    await putRates(18, 7);

    for (const slipStatus of ["pending_review", "rejected"]) {
      const room = await occupiedRoom(slipStatus === "pending_review" ? "B251" : "B252", {
        waterMeterInit: 100,
        electricMeterInit: 200,
      });
      const bill = await generatedBill(room.id, { waterCurrent: 110, electricCurrent: 215 });

      await env.DB.prepare(
        "INSERT INTO slips (id, family_id, bill_id, line_user_id, image_key, verify_result, status) VALUES (?, ?, ?, 'U-guard', ?, '{}', ?)",
      )
        .bind(crypto.randomUUID(), session.familyId, bill.id, `${slipStatus}.png`, slipStatus)
        .run();

      const response = await deleteBill(bill.id);
      expect(response.status).toBe(409);

      const body = await response.json<ErrorBody>();
      expect(body.error.code).toBe("CONFLICT");
      expect(body.error.message).toContain("สลิป");
      expect(body.error.message).not.toContain("ไม่สำเร็จ");

      // บิลและค่าใช้จ่ายต้องอยู่ครบ
      expect((await findBill("2026-09", bill.id)).id).toBe(bill.id);
    }
  });

  it("marks a bill paid and rejects a repeat or a bad method", async () => {
    await putRates(18, 7);
    const room = await occupiedRoom("B236", { waterMeterInit: 100, electricMeterInit: 200 });
    const bill = await generatedBill(room.id, { waterCurrent: 110, electricCurrent: 215 });

    const badMethod = await markPaid(bill.id, { method: "cheque" });
    expect(badMethod.status).toBe(400);
    expect((await badMethod.json<ErrorBody>()).error.field).toBe("method");

    const response = await markPaid(bill.id, { method: "transfer" });
    expect(response.status).toBe(200);

    const paid = (await response.json<{ ok: boolean; bill: BillPayload }>()).bill;
    expect(paid.status).toBe("paid");
    expect(paid.paidMethod).toBe("transfer");
    expect(typeof paid.paidAt).toBe("string");
    expect(paid.paidAt).not.toBeNull();

    const listed = await findBill("2026-09", bill.id);
    expect(listed.status).toBe("paid");
    expect(listed.paidMethod).toBe("transfer");
    expect(listed.paidAt).toBe(paid.paidAt);

    const again = await markPaid(bill.id, { method: "cash" });
    expect(again.status).toBe(409);
    expect((await again.json<ErrorBody>()).error.code).toBe("CONFLICT");

    // คำขอที่สองต้องไม่เขียนทับเวลาที่ปิดบิลไปแล้ว
    const afterRepeat = await findBill("2026-09", bill.id);
    expect(afterRepeat.paidAt).toBe(paid.paidAt);
    expect(afterRepeat.paidMethod).toBe("transfer");
  });

  it("lets only one of two simultaneous mark-paid calls rewrite the bill", async () => {
    await putRates(18, 7);
    const room = await occupiedRoom("B244", { waterMeterInit: 100, electricMeterInit: 200 });
    const bill = await generatedBill(room.id, { waterCurrent: 110, electricCurrent: 215 });

    const responses = await Promise.all([
      markPaid(bill.id, { method: "cash", paidAt: "2026-09-30" }),
      markPaid(bill.id, { method: "transfer", paidAt: "2026-10-01" }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);

    const winner = first(responses.filter((response) => response.status === 200));
    const winnerBill = (await winner.json<{ ok: boolean; bill: BillPayload }>()).bill;
    const stored = await findBill("2026-09", bill.id);

    expect(stored.paidAt).toBe(winnerBill.paidAt);
    expect(stored.paidMethod).toBe(winnerBill.paidMethod);
    expect(["2026-09-30", "2026-10-01"]).toContain(stored.paidAt);
    expect(stored.paidAt).toBe(stored.paidMethod === "cash" ? "2026-09-30" : "2026-10-01");
  });

  it("stores the given paid date and rejects a malformed one", async () => {
    await putRates(18, 7);
    const room = await occupiedRoom("B237", { waterMeterInit: 100, electricMeterInit: 200 });
    const bill = await generatedBill(room.id, { waterCurrent: 110, electricCurrent: 215 });

    const bad = await markPaid(bill.id, { method: "cash", paidAt: "30/09/2026" });
    expect(bad.status).toBe(400);
    expect((await bad.json<ErrorBody>()).error.field).toBe("paidAt");

    const ok = await markPaid(bill.id, { method: "cash", paidAt: "2026-09-30" });
    expect(ok.status).toBe(200);

    const paid = (await ok.json<{ ok: boolean; bill: BillPayload }>()).bill;
    expect(paid.paidAt).toBe("2026-09-30");
    expect(paid.paidMethod).toBe("cash");
    expect((await findBill("2026-09", bill.id)).paidAt).toBe("2026-09-30");
  });

  it("answers 404 for an unknown bill on patch, delete and mark-paid", async () => {
    const missing = "bill-does-not-exist";

    const patch = await patchBill(missing, { waterCurrent: 1 });
    expect(patch.status).toBe(404);
    expect((await patch.json<ErrorBody>()).error.code).toBe("NOT_FOUND");

    const removed = await deleteBill(missing);
    expect(removed.status).toBe(404);
    expect((await removed.json<ErrorBody>()).error.code).toBe("NOT_FOUND");

    const paid = await markPaid(missing, { method: "transfer" });
    expect(paid.status).toBe(404);
    expect((await paid.json<ErrorBody>()).error.code).toBe("NOT_FOUND");
  });

  it("rejects malformed extra charges on a correction", async () => {
    await putRates(18, 7);
    const room = await occupiedRoom("B238", { waterMeterInit: 100, electricMeterInit: 200 });
    const bill = await generatedBill(room.id, { waterCurrent: 110, electricCurrent: 215 });

    const emptyName = await patchBill(bill.id, { charges: [{ name: "   ", amount: 10 }] });
    expect(emptyName.status).toBe(400);
    expect((await emptyName.json<ErrorBody>()).error.field).toBe("charges");

    const fractional = await patchBill(bill.id, { charges: [{ name: "ค่าอินเทอร์เน็ต", amount: 12.5 }] });
    expect(fractional.status).toBe(400);
    expect((await fractional.json<ErrorBody>()).error.field).toBe("charges");

    const negative = await patchBill(bill.id, { charges: [{ name: "ค่าอินเทอร์เน็ต", amount: -1 }] });
    expect(negative.status).toBe(400);
    expect((await negative.json<ErrorBody>()).error.field).toBe("charges");

    expect(await findBill("2026-09", bill.id)).toEqual(bill);
  });

  it("rejects a flat amount on a meter bill and a flat bill without one", async () => {
    await putRates(18, 7);
    const metered = await occupiedRoom("B239", { waterMeterInit: 100, electricMeterInit: 200 });
    const meterBill = await generatedBill(metered.id, { waterCurrent: 110, electricCurrent: 215 });

    const onMeter = await patchBill(meterBill.id, { flatElectricAmount: 500 });
    expect(onMeter.status).toBe(400);
    expect((await onMeter.json<ErrorBody>()).error.field).toBe("flatElectricAmount");

    const flatRoom = await newRoom({ roomNumber: "B240", rent: 3800, electricMode: "flat", waterMeterInit: 130, electricMeterInit: 460 });
    await newTenant(flatRoom.id, "ผู้เช่า B240");
    const flatBill = await generatedBill(flatRoom.id, { waterCurrent: 135, electricCurrent: 470, flatElectricAmount: 600 });

    const missing = await patchBill(flatBill.id, { charges: [] });
    expect(missing.status).toBe(400);
    expect((await missing.json<ErrorBody>()).error.field).toBe("flatElectricAmount");

    expect(await findBill("2026-09", meterBill.id)).toEqual(meterBill);
    expect(await findBill("2026-09", flatBill.id)).toEqual(flatBill);
  });

  it("answers 409 instead of 400 when an already-paid bill is marked paid with a bad method", async () => {
    await putRates(18, 7);
    const room = await occupiedRoom("B241", { waterMeterInit: 100, electricMeterInit: 200 });
    const bill = await generatedBill(room.id, { waterCurrent: 110, electricCurrent: 215 });

    const paid = await markPaid(bill.id, { method: "cash" });
    expect(paid.status).toBe(200);

    const conflict = await markPaid(bill.id, { method: "cheque" });
    expect(conflict.status).toBe(409);
    expect((await conflict.json<ErrorBody>()).error.code).toBe("CONFLICT");
  });

  it("rejects an impossible paid timestamp but stores a valid one as given", async () => {
    await putRates(18, 7);
    const room = await occupiedRoom("B242", { waterMeterInit: 100, electricMeterInit: 200 });
    const bill = await generatedBill(room.id, { waterCurrent: 110, electricCurrent: 215 });

    const impossible = await markPaid(bill.id, { method: "cash", paidAt: "2026-02-30T10:00Z" });
    expect(impossible.status).toBe(400);
    expect((await impossible.json<ErrorBody>()).error.field).toBe("paidAt");
    expect((await findBill("2026-09", bill.id)).status).toBe("unpaid");

    const response = await markPaid(bill.id, { method: "cash", paidAt: "2026-09-30T10:00Z" });
    expect(response.status).toBe(200);

    const paid = (await response.json<{ ok: boolean; bill: BillPayload }>()).bill;
    expect(paid.paidAt).toBe("2026-09-30T10:00Z");
    expect(paid.paidMethod).toBe("cash");
    expect((await findBill("2026-09", bill.id)).paidAt).toBe("2026-09-30T10:00Z");
  });
});

describe("room recurring charges", () => {
  it("carries a room's recurring charges into the meter sheet", async () => {
    await putRates(18, 7);
    const room = await occupiedRoom("H301", { waterMeterInit: 10, electricMeterInit: 20 });
    const plain = await occupiedRoom("H302", { waterMeterInit: 10, electricMeterInit: 20 });

    await setOwnCharges(room.id, [
      { name: "ค่าบริการ", amount: 10 },
      { name: "ค่าขยะ", amount: 20 },
      { name: "ค่าไวไฟ", amount: 100 },
    ]);

    const rows = await meterSheet("2026-09");
    expect(pick(rows, (row) => row.roomId === room.id).charges).toEqual([
      { name: "ค่าบริการ", amount: 10 },
      { name: "ค่าขยะ", amount: 20 },
      { name: "ค่าไวไฟ", amount: 100 },
    ]);
    expect(pick(rows, (row) => row.roomId === plain.id).charges).toEqual([]);

    const roomRow = pick(await roomsList(), (item) => item.id === room.id);
    expect(roomRow.excludedDormChargeIds).toEqual([]);
    expect(roomRow.ownCharges).toEqual([
      { name: "ค่าบริการ", amount: 10 },
      { name: "ค่าขยะ", amount: 20 },
      { name: "ค่าไวไฟ", amount: 100 },
    ]);
    expect(roomRow.charges).toEqual([
      { name: "ค่าบริการ", amount: 10 },
      { name: "ค่าขยะ", amount: 20 },
      { name: "ค่าไวไฟ", amount: 100 },
    ]);
  });

  it("stores the meter sheet's charges on the generated bill and counts them in the total", async () => {
    await putRates(18, 7);
    const room = await occupiedRoom("H303", { rent: 4200, waterMeterInit: 50, electricMeterInit: 60 });
    await setOwnCharges(room.id, [
      { name: "ค่าบริการ", amount: 10 },
      { name: "ค่าขยะ", amount: 20 },
      { name: "ค่าไวไฟ", amount: 100 },
    ]);

    const sheetRow = pick(await meterSheet("2026-09"), (row) => row.roomId === room.id);
    expect(sheetRow.charges).toHaveLength(3);

    const response = await generate({
      period: "2026-09",
      entries: [{ roomId: room.id, waterCurrent: 55, electricCurrent: 70, charges: sheetRow.charges }],
    });
    expect(response.status).toBe(201);

    const bill = first((await response.json<{ ok: boolean; bills: BillPayload[] }>()).bills);
    expect(bill.charges).toEqual([
      { name: "ค่าบริการ", amount: 10 },
      { name: "ค่าขยะ", amount: 20 },
      { name: "ค่าไวไฟ", amount: 100 },
    ]);
    expect(bill.waterAmount).toBe(5 * 18);
    expect(bill.electricAmount).toBe(10 * 7);
    expect(bill.total).toBe(4200 + 90 + 70 + 130);

    const listed = await findBill("2026-09", bill.id);
    expect(listed.charges).toEqual(bill.charges);
    expect(listed.total).toBe(bill.total);
  });

  it("leaves an existing bill untouched when a room's recurring defaults change", async () => {
    await putRates(18, 7);
    const room = await occupiedRoom("H304", { rent: 4000, waterMeterInit: 100, electricMeterInit: 200 });
    await setOwnCharges(room.id, [{ name: "ค่าขยะ", amount: 20 }]);

    const sheetRow = pick(await meterSheet("2026-09"), (row) => row.roomId === room.id);
    const bill = await generatedBill(room.id, { waterCurrent: 110, electricCurrent: 215, charges: sheetRow.charges });
    expect(bill.charges).toEqual([{ name: "ค่าขยะ", amount: 20 }]);
    expect(bill.total).toBe(4000 + 180 + 105 + 20);

    await setOwnCharges(room.id, [
      { name: "ค่าบริการ", amount: 10 },
      { name: "ค่าไวไฟ", amount: 100 },
    ]);

    const listed = await findBill("2026-09", bill.id);
    expect(listed).toEqual(bill);
    expect(listed.charges).toEqual([{ name: "ค่าขยะ", amount: 20 }]);
    expect(listed.total).toBe(bill.total);

    const nextSheet = pick(await meterSheet("2026-10"), (row) => row.roomId === room.id);
    expect(nextSheet.charges).toEqual([
      { name: "ค่าบริการ", amount: 10 },
      { name: "ค่าไวไฟ", amount: 100 },
    ]);
  });
});

describe("owner send summary", () => {
  const linePushUrl = "https://api.line.me/v2/bot/message/push";
  const ownerUserId = "U-owner-summary";

  interface OutboundPush {
    url: string;
    to: string;
    messages: Record<string, unknown>[];
  }

  let pushes: OutboundPush[] = [];
  let failingUserIds = new Set<string>();

  function pushesTo(lineUserId: string): OutboundPush[] {
    return pushes.filter((push) => push.url === linePushUrl && push.to === lineUserId);
  }

  async function linkRoomLine(roomId: string, lineUserId: string): Promise<void> {
    await env.DB.prepare("UPDATE tenants SET line_user_id = ? WHERE room_id = ?").bind(lineUserId, roomId).run();
  }

  async function linkOwner(): Promise<void> {
    await env.DB.prepare(
      "INSERT INTO settings (family_id, key, value, updated_at) VALUES (?, 'owner_line_user_id', ?, datetime('now')) ON CONFLICT(family_id, key) DO UPDATE SET value = excluded.value",
    )
      .bind(session.familyId, ownerUserId)
      .run();
  }

  beforeEach(() => {
    pushes = [];
    failingUserIds = new Set<string>();

    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const raw = typeof init?.body === "string" ? init.body : "";
      const payload =
        raw === ""
          ? { to: "", messages: [] as Record<string, unknown>[] }
          : (JSON.parse(raw) as { to: string; messages: Record<string, unknown>[] });

      pushes.push({ url, to: payload.to, messages: payload.messages });

      const status = url === linePushUrl && failingUserIds.has(payload.to) ? 500 : 200;

      return Promise.resolve(new Response(JSON.stringify({}), { status, headers: { "content-type": "application/json" } }));
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await env.DB.prepare(
      "DELETE FROM settings WHERE family_id = ? AND key = 'owner_line_user_id'",
    )
      .bind(session.familyId)
      .run();
  });

  it("pushes the owner one success card carrying the real outcome of a clean send", async () => {
    await putRates(18, 7);
    const firstRoom = await occupiedRoom("S401", { rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    const secondRoom = await occupiedRoom("S402", { rent: 3600, waterMeterInit: 30, electricMeterInit: 40 });
    await linkRoomLine(firstRoom.id, "U-s401");
    await linkRoomLine(secondRoom.id, "U-s402");
    await linkOwner();

    const created = await generate({
      period: "2026-03",
      entries: [
        { roomId: firstRoom.id, waterCurrent: 12, electricCurrent: 24 },
        { roomId: secondRoom.id, waterCurrent: 33, electricCurrent: 44 },
      ],
    });
    expect(created.status).toBe(201);

    const response = await post(`${billsUrl}/send-all`, { period: "2026-03" });
    expect(response.status).toBe(200);

    const body = await response.json<{ ok: boolean; sent: number; failed: number; skipped: unknown[] }>();
    expect(body.sent).toBe(2);
    expect(body.failed).toBe(0);
    expect(body.skipped).toEqual([]);

    const owner = pushesTo(ownerUserId);
    expect(owner).toHaveLength(1);

    const message = first(first(owner).messages);
    expect(message.type).toBe("flex");
    expect(typeof message.altText).toBe("string");

    const text = flexText(message);
    expect(text).toContain("รอบบิล");
    expect(text).toContain("มีนาคม 2569");
    expect(text).toContain("บิลทั้งหมด");
    expect(text).toContain("2 ใบ");
    expect(text).toContain("7,246");
    expect(text).toContain("ส่งสำเร็จ");
    expect(text).toContain("ส่งไม่สำเร็จ");
    expect(text).toContain("0 ใบ");
    expect(text).toContain("ยังไม่เชื่อม LINE");
    expect(text).toContain("0 ห้อง");
    expect(text).not.toContain("S401");
    expect(text).not.toContain("S402");
    expect(JSON.stringify(message.contents)).toContain("#ECFDF5");
  });

  it("pushes the owner one warning card naming the rooms that failed or were skipped", async () => {
    await putRates(18, 7);
    const linked = await occupiedRoom("S411", { rent: 3500, waterMeterInit: 10, electricMeterInit: 20 });
    const unlinked = await occupiedRoom("S412", { rent: 3600, waterMeterInit: 30, electricMeterInit: 40 });
    await linkRoomLine(linked.id, "U-s411");
    await linkOwner();

    failingUserIds = new Set(["U-s411"]);

    const created = await generate({
      period: "2026-04",
      entries: [
        { roomId: linked.id, waterCurrent: 12, electricCurrent: 24 },
        { roomId: unlinked.id, waterCurrent: 33, electricCurrent: 44 },
      ],
    });
    expect(created.status).toBe(201);

    const response = await post(`${billsUrl}/send-all`, { period: "2026-04" });
    expect(response.status).toBe(200);

    const body = await response.json<{ sent: number; failed: number; skipped: { roomNumber: string }[] }>();
    expect(body.sent).toBe(0);
    expect(body.failed).toBe(1);
    expect(body.skipped.map((item) => item.roomNumber)).toEqual(["S412"]);

    const message = first(first(pushesTo(ownerUserId)).messages);
    expect(message.type).toBe("flex");

    const text = flexText(message);
    expect(text).toContain("เมษายน 2569");
    expect(text).toContain("ส่งบิลไม่ครบทุกห้อง");
    expect(text).toContain("ส่งสำเร็จ");
    expect(text).toContain("0 ใบ");
    expect(text).toContain("ส่งไม่สำเร็จ");
    expect(text).toContain("1 ใบ");
    expect(text).toContain("S411");
    expect(text).toContain("S412");
    expect(text).toContain("ผู้เช่า S412");
    expect(JSON.stringify(message.contents)).toContain("#FFFBEB");
  });
});

describe("room-scoped ดูบิล link", () => {
  it("points at the period the room was last billed, not the dorm's newest, and that period holds the room's bill", async () => {
    await putRates(18, 7);
    const stale = await occupiedRoom("H601", { rent: 3500, waterMeterInit: 0, electricMeterInit: 0 });
    const newest = await occupiedRoom("H602", { rent: 3500, waterMeterInit: 0, electricMeterInit: 0 });

    await generate({ period: "2026-07", entries: [{ roomId: stale.id, waterCurrent: 10, electricCurrent: 20 }] });
    await generate({ period: "2026-08", entries: [{ roomId: newest.id, waterCurrent: 10, electricCurrent: 20 }] });

    const listedRooms = await roomsList();
    const staleRoom = pick(listedRooms, (room) => room.id === stale.id);
    const newestRoom = pick(listedRooms, (room) => room.id === newest.id);

    expect(staleRoom.lastElectricPeriod).toBe("2026-07");
    expect(newestRoom.lastElectricPeriod).toBe("2026-08");

    const hash = billsFocusHash(billsFocusTarget(staleRoom, "2026-09"));
    expect(hash).toBe("#bills?room=H601&period=2026-07");

    const arrived = billsFocusOf(hash);

    if (arrived === null) {
      throw new Error("expected the ดูบิล hash to parse back to a room and period");
    }

    expect(arrived).toEqual({ roomNumber: "H601", period: "2026-07" });

    const arrivedBills = (await listBills(arrived.period)).filter((bill) => bill.roomNumber === arrived.roomNumber);
    expect(arrivedBills).toHaveLength(1);
    expect(arrivedBills[0]?.period).toBe("2026-07");
    expect(arrivedBills[0]?.roomId).toBe(stale.id);
  });

  it("falls back to the period selected on the rooms page for a room with no bill yet", async () => {
    await putRates(18, 7);
    const fresh = await occupiedRoom("H501", { rent: 3500, waterMeterInit: 0, electricMeterInit: 0 });
    const freshRoom = pick(await roomsList(), (room) => room.id === fresh.id);

    expect(freshRoom.lastElectricPeriod).toBeNull();
    expect(billsFocusTarget(freshRoom, "2026-09")).toEqual({ roomNumber: "H501", period: "2026-09" });
    expect(billsFocusHash(billsFocusTarget(freshRoom, null))).toBe("#bills?room=H501");
    expect(billsFocusOf("#bills?room=H501")).toEqual({ roomNumber: "H501", period: "" });
  });

  it("round-trips a room number shaped like a path segment and ignores hashes without a room", () => {
    expect(billsFocusHash({ roomNumber: "208/7", period: "2026-08" })).toBe("#bills?room=208%2F7&period=2026-08");
    expect(billsFocusOf("#bills?room=208%2F7&period=2026-08")).toEqual({ roomNumber: "208/7", period: "2026-08" });

    expect(billsFocusOf("#bills")).toBeNull();
    expect(billsFocusOf("#bills?period=2026-08")).toBeNull();
    expect(billsFocusOf("#tenants?room=208&period=2026-08")).toBeNull();
  });
});

describe("family isolation", () => {
  it("hides another family's bills and refuses to touch them", async () => {
    await putRates(18, 7);
    const room = await occupiedRoom("F701", { waterMeterInit: 100, electricMeterInit: 200 });
    const bill = await generatedBill(room.id, { waterCurrent: 110, electricCurrent: 215 });
    expect((await listBills("2026-09")).filter((item) => item.roomId === room.id)).toHaveLength(1);

    const other = await signIn("owner", await createFamily("หอของอีกครอบครัว"));
    await configurePayout(other.familyId);

    function asOther(url: string, init: RequestInit = {}): Promise<Response> {
      return SELF.fetch(url, withAuth(other, init));
    }

    const json = { "content-type": "application/json" };

    const listed = await asOther(`${billsUrl}?period=2026-09`);
    expect(listed.status).toBe(200);
    expect((await listed.json<{ ok: boolean; bills: BillPayload[] }>()).bills).toEqual([]);

    const periods = await asOther(`${billsUrl}/periods`);
    expect(periods.status).toBe(200);
    expect((await periods.json<{ ok: boolean; periods: string[] }>()).periods).toEqual([]);

    const sheet = await asOther(`${billsUrl}/meter-sheet?period=2026-09`);
    expect(sheet.status).toBe(200);
    expect((await sheet.json<{ ok: boolean; rows: MeterRowPayload[] }>()).rows).toEqual([]);

    const patch = await asOther(`${billsUrl}/${bill.id}`, {
      method: "PATCH",
      headers: json,
      body: JSON.stringify({ waterCurrent: 900 }),
    });
    expect(patch.status).toBe(404);
    expect((await patch.json<ErrorBody>()).error.code).toBe("NOT_FOUND");

    const removed = await asOther(`${billsUrl}/${bill.id}`, { method: "DELETE" });
    expect(removed.status).toBe(404);
    expect((await removed.json<ErrorBody>()).error.code).toBe("NOT_FOUND");

    const paid = await asOther(`${billsUrl}/${bill.id}/mark-paid`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ method: "cash" }),
    });
    expect(paid.status).toBe(404);
    expect((await paid.json<ErrorBody>()).error.code).toBe("NOT_FOUND");

    const sent = await asOther(`${billsUrl}/${bill.id}/send`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({}),
    });
    expect(sent.status).toBe(404);

    // ออกบิลให้ห้องของครอบครัวอื่นก็ไม่ได้ ห้องนั้นไม่รู้จักในครอบครัวนี้
    const generated = await asOther(`${billsUrl}/generate`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        period: "2026-09",
        entries: [{ roomId: room.id, waterCurrent: 120, electricCurrent: 220 }],
      }),
    });
    expect(generated.status).toBe(400);
    expect((await generated.json<ErrorBody>()).error.field).toBe("entries");

    expect(await findBill("2026-09", bill.id)).toEqual(bill);
  });
});
