import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

interface ChargePayload {
  name: string;
  amount: number;
}

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
  lastElectricAmount: number | null;
  lastElectricPeriod: string | null;
  charges: ChargePayload[];
}

interface RoomListBody {
  ok: boolean;
  rooms: RoomPayload[];
}

interface RoomBody {
  ok: boolean;
  room: RoomPayload;
}

interface BillPayload {
  id: string;
  roomId: string;
  roomNumber: string;
  period: string;
  status: "paid" | "unpaid";
}

interface RoomStatPayload {
  id: string;
  roomNumber: string;
  status: string;
  hasPendingSlip: boolean;
  lastBilledPeriod: string | null;
  behindPeriods: number;
}

interface DashboardPayload {
  ok: boolean;
  period: string;
  latestBilledPeriod: string | null;
  rooms: RoomStatPayload[];
}

interface ErrorBody {
  ok: boolean;
  error: { code: string; message: string; field?: string };
}

const roomsUrl = "https://dorm.test/api/rooms";
const tenantsUrl = "https://dorm.test/api/tenants";
const billsUrl = "https://dorm.test/api/bills";
const statsUrl = "https://dorm.test/api/stats/dashboard";

function createRoom(payload: Record<string, unknown>): Promise<Response> {
  return SELF.fetch(roomsUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function patchRoom(id: string, payload: Record<string, unknown>): Promise<Response> {
  return SELF.fetch(`${roomsUrl}/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function occupyRoom(roomId: string, fullName: string): Promise<void> {
  const response = await SELF.fetch(tenantsUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fullName, phone: "081-234-5678", roomId, checkInDate: "2025-03-01" }),
  });

  expect(response.status).toBe(201);
}

async function generateFlatBill(roomId: string, period: string, waterCurrent: number, electricCurrent: number, amount: number): Promise<BillPayload> {
  const response = await SELF.fetch(`${billsUrl}/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ period, entries: [{ roomId, waterCurrent, electricCurrent, flatElectricAmount: amount }] }),
  });

  expect(response.status).toBe(201);

  const body = await response.json<{ ok: boolean; bills: BillPayload[] }>();
  const bill = body.bills[0];

  if (bill === undefined) {
    throw new Error("expected a generated bill");
  }

  return bill;
}

async function markBillPaid(id: string): Promise<void> {
  const response = await SELF.fetch(`${billsUrl}/${id}/mark-paid`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method: "transfer" }),
  });

  expect(response.status).toBe(200);
}

async function dashboardOf(period: string): Promise<DashboardPayload> {
  const response = await SELF.fetch(`${statsUrl}?period=${period}`);
  expect(response.status).toBe(200);
  return await response.json<DashboardPayload>();
}

function roomStat(payload: DashboardPayload, roomNumber: string): RoomStatPayload {
  const found = payload.rooms.find((room) => room.roomNumber === roomNumber);

  if (found === undefined) {
    throw new Error(`expected a dashboard row for room ${roomNumber}`);
  }

  return found;
}

async function occupiedRoom(roomNumber: string): Promise<RoomPayload> {
  const response = await createRoom({
    roomNumber,
    rent: 3500,
    waterRate: 18,
    electricMode: "flat",
    waterMeterInit: 0,
    electricMeterInit: 0,
  });

  expect(response.status).toBe(201);

  const room = (await response.json<RoomBody>()).room;
  await occupyRoom(room.id, `ผู้เช่า ${roomNumber}`);

  return room;
}

async function listedRoom(id: string): Promise<RoomPayload | undefined> {
  const list = await (await SELF.fetch(roomsUrl)).json<RoomListBody>();
  return list.rooms.find((room) => room.id === id);
}

describe("rooms crud", () => {
  it("creates a room and lists it with every field intact", async () => {
    const response = await createRoom({
      roomNumber: "b201",
      rent: 4200,
      waterRate: 20,
      electricMode: "meter",
      electricRate: 8,
      waterMeterInit: 10,
      electricMeterInit: 20,
    });

    expect(response.status).toBe(201);

    const created = await response.json<RoomBody>();
    expect(created.ok).toBe(true);
    expect(created.room.roomNumber).toBe("B201");
    expect(created.room.id.length).toBeGreaterThan(0);
    expect(created.room.id).not.toBe("B201");
    expect(created.room.rent).toBe(4200);
    expect(created.room.waterRate).toBe(20);
    expect(created.room.electricMode).toBe("meter");
    expect(created.room.electricRate).toBe(8);
    expect(created.room.waterMeterInit).toBe(10);
    expect(created.room.electricMeterInit).toBe(20);
    expect(created.room.status).toBe("vacant");

    const listResponse = await SELF.fetch(roomsUrl);
    expect(listResponse.status).toBe(200);

    const list = await listResponse.json<RoomListBody>();
    const found = list.rooms.find((room) => room.id === created.room.id);
    expect(found).toEqual(created.room);
  });

  it("stores null overrides when rates are omitted", async () => {
    const response = await createRoom({ roomNumber: "B202", rent: 3000 });
    expect(response.status).toBe(201);

    const created = await response.json<RoomBody>();
    expect(created.room.waterRate).toBeNull();
    expect(created.room.electricRate).toBeNull();
    expect(created.room.electricMode).toBe("meter");
    expect(created.room.waterMeterInit).toBe(0);
    expect(created.room.electricMeterInit).toBe(0);
  });

  it("rejects a duplicate room number with 409 and keeps one stored room", async () => {
    const first = await createRoom({ roomNumber: "C301", rent: 3000 });
    expect(first.status).toBe(201);

    const duplicate = await createRoom({ roomNumber: "c301", rent: 3000 });
    expect(duplicate.status).toBe(409);

    const body = await duplicate.json<ErrorBody>();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("DUPLICATE");
    expect(body.error.field).toBe("roomNumber");
    expect(body.error.message.length).toBeGreaterThan(0);

    const list = await (await SELF.fetch(roomsUrl)).json<RoomListBody>();
    const matching = list.rooms.filter((room) => room.roomNumber === "C301");
    expect(matching).toHaveLength(1);
  });

  it("patches rent, meters and electric mode, nulling the rate on flat", async () => {
    const created = await (
      await createRoom({
        roomNumber: "D401",
        rent: 3000,
        waterRate: 20,
        electricMode: "meter",
        electricRate: 8,
        waterMeterInit: 1,
        electricMeterInit: 2,
      })
    ).json<RoomBody>();

    const response = await patchRoom(created.room.id, {
      rent: 3500,
      waterMeterInit: 50,
      electricMeterInit: 60,
      electricMode: "flat",
    });
    expect(response.status).toBe(200);

    const patched = await response.json<RoomBody>();
    expect(patched.room.rent).toBe(3500);
    expect(patched.room.waterMeterInit).toBe(50);
    expect(patched.room.electricMeterInit).toBe(60);
    expect(patched.room.electricMode).toBe("flat");
    expect(patched.room.electricRate).toBeNull();
    expect(patched.room.waterRate).toBe(20);

    const list = await (await SELF.fetch(roomsUrl)).json<RoomListBody>();
    const found = list.rooms.find((room) => room.id === created.room.id);
    expect(found?.rent).toBe(3500);
    expect(found?.electricMode).toBe("flat");
    expect(found?.electricRate).toBeNull();
  });

  it("returns 404 when patching an unknown room", async () => {
    const response = await patchRoom("missing-id", { rent: 100 });
    expect(response.status).toBe(404);

    const body = await response.json<ErrorBody>();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("rejects invalid payloads with 400 and a field", async () => {
    const missing = await createRoom({ rent: 3000 });
    expect(missing.status).toBe(400);
    const missingBody = await missing.json<ErrorBody>();
    expect(missingBody.error.code).toBe("VALIDATION");
    expect(missingBody.error.field).toBe("roomNumber");

    const zeroRent = await createRoom({ roomNumber: "E501", rent: 0 });
    expect(zeroRent.status).toBe(400);
    const zeroRentBody = await zeroRent.json<ErrorBody>();
    expect(zeroRentBody.error.field).toBe("rent");

    const bogusMode = await createRoom({ roomNumber: "E502", rent: 3000, electricMode: "bogus" });
    expect(bogusMode.status).toBe(400);
    const bogusModeBody = await bogusMode.json<ErrorBody>();
    expect(bogusModeBody.error.field).toBe("electricMode");
  });

  it("lists rooms in ascending room-number order", async () => {
    for (const roomNumber of ["F603", "F601", "F602"]) {
      const response = await createRoom({ roomNumber, rent: 3000 });
      expect(response.status).toBe(201);
    }

    const list = await (await SELF.fetch(roomsUrl)).json<RoomListBody>();
    const listed = list.rooms.map((room) => room.roomNumber);
    expect(listed).toEqual([...listed].sort());
    expect(listed.indexOf("F601")).toBeLessThan(listed.indexOf("F602"));
    expect(listed.indexOf("F602")).toBeLessThan(listed.indexOf("F603"));
  });

  it("lists rooms in natural number order, with numbered sub-rooms before two-digit ones", async () => {
    const naturalOrder = ["101", "108", "108/1", "108/2", "108/10"];
    const created = new Set<string>();

    for (const roomNumber of ["108/10", "108/2", "101", "108/1", "108"]) {
      const response = await createRoom({ roomNumber, rent: 2600 });
      expect(response.status).toBe(201);
      created.add((await response.json<RoomBody>()).room.id);
    }

    const list = await (await SELF.fetch(roomsUrl)).json<RoomListBody>();
    expect(list.rooms.filter((room) => created.has(room.id)).map((room) => room.roomNumber)).toEqual(naturalOrder);
  });

  it("stores a room's recurring charges and returns them in position order", async () => {
    const created = await (await createRoom({ roomNumber: "G701", rent: 3000 })).json<RoomBody>();
    expect(created.room.charges).toEqual([]);

    const response = await patchRoom(created.room.id, {
      charges: [
        { name: "  ค่าบริการ  ", amount: 10 },
        { name: "ค่าขยะ", amount: 20 },
        { name: "ค่าไวไฟ", amount: 100 },
      ],
    });
    expect(response.status).toBe(200);

    const patched = await response.json<RoomBody>();
    expect(patched.room.charges).toEqual([
      { name: "ค่าบริการ", amount: 10 },
      { name: "ค่าขยะ", amount: 20 },
      { name: "ค่าไวไฟ", amount: 100 },
    ]);

    const list = await (await SELF.fetch(roomsUrl)).json<RoomListBody>();
    const found = list.rooms.find((room) => room.id === created.room.id);
    expect(found?.charges).toEqual(patched.room.charges);
  });

  it("replaces a room's recurring charges wholesale", async () => {
    const created = await (await createRoom({ roomNumber: "G702", rent: 3000 })).json<RoomBody>();

    const seeded = await patchRoom(created.room.id, {
      charges: [
        { name: "ค่าบริการ", amount: 10 },
        { name: "ค่าขยะ", amount: 20 },
        { name: "ค่าไวไฟ", amount: 100 },
      ],
    });
    expect(seeded.status).toBe(200);
    expect((await seeded.json<RoomBody>()).room.charges).toHaveLength(3);

    const reordered = await patchRoom(created.room.id, {
      charges: [
        { name: "ค่าไวไฟ", amount: 100 },
        { name: "ค่าบริการ", amount: 10 },
      ],
    });
    expect(reordered.status).toBe(200);
    expect((await reordered.json<RoomBody>()).room.charges).toEqual([
      { name: "ค่าไวไฟ", amount: 100 },
      { name: "ค่าบริการ", amount: 10 },
    ]);

    const cleared = await patchRoom(created.room.id, { charges: [] });
    expect(cleared.status).toBe(200);
    expect((await cleared.json<RoomBody>()).room.charges).toEqual([]);

    const list = await (await SELF.fetch(roomsUrl)).json<RoomListBody>();
    expect(list.rooms.find((room) => room.id === created.room.id)?.charges).toEqual([]);
  });

  it("leaves a room's recurring charges untouched when the charges key is absent", async () => {
    const created = await (await createRoom({ roomNumber: "G703", rent: 3000 })).json<RoomBody>();
    await patchRoom(created.room.id, { charges: [{ name: "ค่าขยะ", amount: 20 }] });

    const response = await patchRoom(created.room.id, { rent: 3300 });
    expect(response.status).toBe(200);

    const patched = await response.json<RoomBody>();
    expect(patched.room.rent).toBe(3300);
    expect(patched.room.charges).toEqual([{ name: "ค่าขยะ", amount: 20 }]);
  });

  it("keeps a room numbered like a path segment intact", async () => {
    const created = await (await createRoom({ roomNumber: "108/7", rent: 2600 })).json<RoomBody>();
    expect(created.room.roomNumber).toBe("108/7");

    const response = await patchRoom(created.room.id, { charges: [{ name: "ค่าบริการ", amount: 10 }] });
    expect(response.status).toBe(200);

    const patched = await response.json<RoomBody>();
    expect(patched.room.roomNumber).toBe("108/7");
    expect(patched.room.charges).toEqual([{ name: "ค่าบริการ", amount: 10 }]);

    const list = await (await SELF.fetch(roomsUrl)).json<RoomListBody>();
    const found = list.rooms.find((room) => room.id === created.room.id);
    expect(found?.roomNumber).toBe("108/7");
    expect(found?.charges).toEqual([{ name: "ค่าบริการ", amount: 10 }]);
  });

  it("rejects malformed recurring charges with 400 and a field", async () => {
    const created = await (await createRoom({ roomNumber: "G704", rent: 3000 })).json<RoomBody>();
    const seeded = await patchRoom(created.room.id, { charges: [{ name: "ค่าขยะ", amount: 20 }] });
    expect(seeded.status).toBe(200);

    const emptyName = await patchRoom(created.room.id, { charges: [{ name: "   ", amount: 10 }] });
    expect(emptyName.status).toBe(400);
    expect((await emptyName.json<ErrorBody>()).error.field).toBe("charges");

    const fractional = await patchRoom(created.room.id, { charges: [{ name: "ค่าบริการ", amount: 12.5 }] });
    expect(fractional.status).toBe(400);
    expect((await fractional.json<ErrorBody>()).error.field).toBe("charges");

    const negative = await patchRoom(created.room.id, { charges: [{ name: "ค่าบริการ", amount: -1 }] });
    expect(negative.status).toBe(400);
    expect((await negative.json<ErrorBody>()).error.field).toBe("charges");

    const notArray = await patchRoom(created.room.id, { charges: "ค่าบริการ" });
    expect(notArray.status).toBe(400);

    const tooMany = await patchRoom(created.room.id, {
      charges: Array.from({ length: 11 }, (_, index) => ({ name: `รายการ ${index}`, amount: index })),
    });
    expect(tooMany.status).toBe(400);
    expect((await tooMany.json<ErrorBody>()).error.field).toBe("charges");

    const list = await (await SELF.fetch(roomsUrl)).json<RoomListBody>();
    expect(list.rooms.find((room) => room.id === created.room.id)?.charges).toEqual([{ name: "ค่าขยะ", amount: 20 }]);
  });
});

describe("room recurring charges and latest electric reading", () => {
  it("accepts recurring charges at creation and reports a total that matches their sum", async () => {
    const response = await createRoom({
      roomNumber: "H801",
      rent: 3200,
      charges: [
        { name: "ค่าบริการ", amount: 10 },
        { name: "ค่าขยะ", amount: 20 },
        { name: "ค่าไวไฟ", amount: 100 },
      ],
    });
    expect(response.status).toBe(201);

    const created = await response.json<RoomBody>();
    expect(created.room.charges).toEqual([
      { name: "ค่าบริการ", amount: 10 },
      { name: "ค่าขยะ", amount: 20 },
      { name: "ค่าไวไฟ", amount: 100 },
    ]);

    const row = await listedRoom(created.room.id);
    expect(row?.charges).toHaveLength(3);
    expect((row?.charges ?? []).reduce((sum, charge) => sum + charge.amount, 0)).toBe(130);

    const bare = await createRoom({ roomNumber: "H802", rent: 3200 });
    expect(bare.status).toBe(201);

    const bareCreated = await bare.json<RoomBody>();
    expect(bareCreated.room.charges).toEqual([]);
    expect(bareCreated.room.lastElectricAmount).toBeNull();
    expect(bareCreated.room.lastElectricPeriod).toBeNull();

    const bareRow = await listedRoom(bareCreated.room.id);
    expect(bareRow?.charges).toEqual([]);
    expect((bareRow?.charges ?? []).reduce((sum, charge) => sum + charge.amount, 0)).toBe(0);
  });

  it("rejects malformed recurring charges on creation with 400 and a field", async () => {
    const emptyName = await createRoom({ roomNumber: "H803", rent: 3200, charges: [{ name: " ", amount: 10 }] });
    expect(emptyName.status).toBe(400);
    expect((await emptyName.json<ErrorBody>()).error.field).toBe("charges");

    const fractional = await createRoom({ roomNumber: "H804", rent: 3200, charges: [{ name: "ค่าบริการ", amount: 12.5 }] });
    expect(fractional.status).toBe(400);
    expect((await fractional.json<ErrorBody>()).error.field).toBe("charges");

    const list = await (await SELF.fetch(roomsUrl)).json<RoomListBody>();
    expect(list.rooms.some((room) => room.roomNumber === "H803")).toBe(false);
    expect(list.rooms.some((room) => room.roomNumber === "H804")).toBe(false);
  });

  it("reports the latest billed electric amount and period for a flat room, and null before any bill", async () => {
    const created = await createRoom({ roomNumber: "H805", rent: 3200, electricMode: "flat", waterMeterInit: 0, electricMeterInit: 0 });
    expect(created.status).toBe(201);

    const room = (await created.json<RoomBody>()).room;
    expect(room.lastElectricAmount).toBeNull();
    expect(room.lastElectricPeriod).toBeNull();

    await occupyRoom(room.id, "ผู้เช่า H805");
    await generateFlatBill(room.id, "2026-08", 10, 470, 600);
    await generateFlatBill(room.id, "2026-09", 20, 480, 720);

    const row = await listedRoom(room.id);
    expect(row?.lastElectricPeriod).toBe("2026-09");
    expect(row?.lastElectricAmount).toBe(720);

    const patched = await patchRoom(room.id, { rent: 3300 });
    expect(patched.status).toBe(200);

    const patchedRoom = (await patched.json<RoomBody>()).room;
    expect(patchedRoom.lastElectricPeriod).toBe("2026-09");
    expect(patchedRoom.lastElectricAmount).toBe(720);
  });
});

describe("room billing state for a period", () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM bill_charges"),
      env.DB.prepare("DELETE FROM room_charges"),
      env.DB.prepare("DELETE FROM slips"),
      env.DB.prepare("DELETE FROM bills"),
      env.DB.prepare("DELETE FROM tenants"),
      env.DB.prepare("DELETE FROM rooms"),
    ]);
  });

  it("reports paid for a paid bill, unbilled for a missing bill, behind for an older last bill, and never behind when vacant", async () => {
    const paidRoom = await occupiedRoom("K101");
    await occupiedRoom("K102");
    const behindRoom = await occupiedRoom("K103");
    const vacantRoom = (await (await createRoom({ roomNumber: "K104", rent: 3200, waterMeterInit: 0, electricMeterInit: 0 })).json<RoomBody>())
      .room;

    expect(vacantRoom.status).toBe("vacant");

    const augustBill = await generateFlatBill(paidRoom.id, "2026-08", 10, 470, 600);
    await markBillPaid(augustBill.id);
    await generateFlatBill(behindRoom.id, "2026-07", 20, 480, 700);

    const payload = await dashboardOf("2026-08");

    expect(payload.latestBilledPeriod).toBe("2026-08");

    const paidStat = roomStat(payload, "K101");
    expect(paidStat.status).toBe("paid");
    expect(paidStat.lastBilledPeriod).toBe("2026-08");
    expect(paidStat.behindPeriods).toBe(0);

    const unbilledStat = roomStat(payload, "K102");
    expect(unbilledStat.status).toBe("unbilled");
    expect(unbilledStat.status).not.toBe("unpaid");
    expect(unbilledStat.behindPeriods).toBe(0);

    const behindStat = roomStat(payload, "K103");
    expect(behindStat.status).toBe("unbilled");
    expect(behindStat.lastBilledPeriod).toBe("2026-07");
    expect(behindStat.behindPeriods).toBe(1);

    const vacantStat = roomStat(payload, "K104");
    expect(vacantStat.status).toBe("vacant");
    expect(vacantStat.behindPeriods).toBe(0);
  });

  it("reads every room as unbilled for a period that has no bills yet, without borrowing an older period", async () => {
    const room = await occupiedRoom("K111");
    await generateFlatBill(room.id, "2026-08", 10, 470, 600);

    const payload = await dashboardOf("2026-09");

    expect(payload.latestBilledPeriod).toBe("2026-08");
    expect(roomStat(payload, "K111").status).toBe("unbilled");
    expect(roomStat(payload, "K111").lastBilledPeriod).toBe("2026-08");
    expect(roomStat(payload, "K111").behindPeriods).toBe(0);
  });
});
