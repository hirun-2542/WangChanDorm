import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

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
}

interface ErrorBody {
  ok: boolean;
  error: { code: string; message: string; field?: string };
}

const roomsUrl = "https://dorm.test/api/rooms";
const tenantsUrl = "https://dorm.test/api/tenants";
const billsUrl = "https://dorm.test/api/bills";
const settingsUrl = "https://dorm.test/api/settings";

function post(url: string, payload: Record<string, unknown>): Promise<Response> {
  return SELF.fetch(url, {
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

async function roomsList(): Promise<RoomPayload[]> {
  return (await (await SELF.fetch(roomsUrl)).json<{ ok: boolean; rooms: RoomPayload[] }>()).rooms;
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
  const response = await SELF.fetch(`${billsUrl}?period=${period}`);
  expect(response.status).toBe(200);
  return (await response.json<{ ok: boolean; period: string; bills: BillPayload[] }>()).bills;
}

async function meterSheet(period: string): Promise<MeterRowPayload[]> {
  const response = await SELF.fetch(`${billsUrl}/meter-sheet?period=${period}`);
  expect(response.status).toBe(200);
  return (await response.json<{ ok: boolean; period: string; rows: MeterRowPayload[] }>()).rows;
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

    const patched = await SELF.fetch(`${roomsUrl}/${room.id}`, {
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

    const badPeriod = await SELF.fetch(`${billsUrl}?period=2026-13`);
    expect(badPeriod.status).toBe(400);
    expect((await badPeriod.json<ErrorBody>()).error.field).toBe("period");

    const missingPeriod = await SELF.fetch(billsUrl);
    expect(missingPeriod.status).toBe(400);
    expect((await missingPeriod.json<ErrorBody>()).error.field).toBe("period");

    const badSheet = await SELF.fetch(`${billsUrl}/meter-sheet?period=กันยายน-2569`);
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
