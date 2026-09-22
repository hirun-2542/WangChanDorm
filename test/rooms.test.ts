import { SELF, env } from "cloudflare:test";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import type { AppEnv } from "../src/worker/lib/auth";
import rooms from "../src/worker/routes/rooms";
import { configurePayout, createFamily, signIn, withAuth, type TestSession } from "./auth-helper";

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
  excludedDormChargeIds: string[];
  ownCharges: ChargePayload[];
}

interface DormChargePayload {
  id: string;
  name: string;
  amount: number;
}

interface DormChargesBody {
  ok: boolean;
  charges: DormChargePayload[];
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
  arrears: { periods: string[]; amount: number };
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
const dormChargesUrl = "https://dorm.test/api/settings/charges";

let session: TestSession;

beforeEach(async () => {
  session = await signIn();
  await configurePayout();
});

function createRoom(payload: Record<string, unknown>, as: TestSession = session): Promise<Response> {
  return SELF.fetch(
    roomsUrl,
    withAuth(as, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

function patchRoom(id: string, payload: Record<string, unknown>, as: TestSession = session): Promise<Response> {
  return SELF.fetch(
    `${roomsUrl}/${id}`,
    withAuth(as, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

function putDormCharges(charges: { id?: string; name: string; amount: number }[], as: TestSession = session): Promise<Response> {
  return SELF.fetch(
    dormChargesUrl,
    withAuth(as, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ charges }),
    }),
  );
}

async function setDormCharges(charges: { id?: string; name: string; amount: number }[], as: TestSession = session): Promise<DormChargePayload[]> {
  const response = await putDormCharges(charges, as);
  expect(response.status).toBe(200);
  return (await response.json<DormChargesBody>()).charges;
}

async function getDormCharges(as: TestSession = session): Promise<DormChargePayload[]> {
  const response = await SELF.fetch(dormChargesUrl, withAuth(as));
  expect(response.status).toBe(200);
  return (await response.json<DormChargesBody>()).charges;
}

async function listRooms(as: TestSession = session): Promise<RoomListBody> {
  const response = await SELF.fetch(roomsUrl, withAuth(as));
  expect(response.status).toBe(200);
  return await response.json<RoomListBody>();
}

function dormChargeNamed(charges: DormChargePayload[], name: string): DormChargePayload {
  const found = charges.find((charge) => charge.name === name);

  if (found === undefined) {
    throw new Error(`expected a dorm charge named ${name}`);
  }

  return found;
}

async function occupyRoom(roomId: string, fullName: string): Promise<void> {
  const response = await SELF.fetch(
    tenantsUrl,
    withAuth(session, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fullName, phone: "081-234-5678", roomId, checkInDate: "2025-03-01" }),
    }),
  );

  expect(response.status).toBe(201);
}

async function generateFlatBill(roomId: string, period: string, waterCurrent: number, electricCurrent: number, amount: number): Promise<BillPayload> {
  const response = await SELF.fetch(
    `${billsUrl}/generate`,
    withAuth(session, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ period, entries: [{ roomId, waterCurrent, electricCurrent, flatElectricAmount: amount }] }),
    }),
  );

  expect(response.status).toBe(201);

  const body = await response.json<{ ok: boolean; bills: BillPayload[] }>();
  const bill = body.bills[0];

  if (bill === undefined) {
    throw new Error("expected a generated bill");
  }

  return bill;
}

async function markBillPaid(id: string): Promise<void> {
  const response = await SELF.fetch(
    `${billsUrl}/${id}/mark-paid`,
    withAuth(session, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: "transfer" }),
    }),
  );

  expect(response.status).toBe(200);
}

async function dashboardOf(period: string): Promise<DashboardPayload> {
  const response = await SELF.fetch(`${statsUrl}?period=${period}`, withAuth(session));
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

async function listedRoom(id: string, as: TestSession = session): Promise<RoomPayload | undefined> {
  const list = await listRooms(as);
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

    const listResponse = await SELF.fetch(roomsUrl, withAuth(session));
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

    const list = await listRooms();
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

    const list = await listRooms();
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

    const list = await listRooms();
    const listed = list.rooms.map((room) => room.roomNumber);
    expect(listed).toEqual([...listed].sort());
    expect(listed.indexOf("F601")).toBeLessThan(listed.indexOf("F602"));
    expect(listed.indexOf("F602")).toBeLessThan(listed.indexOf("F603"));
  });

  it("lists rooms in natural number order, with numbered sub-rooms before two-digit ones", async () => {
    const naturalOrder = ["201", "208", "208/1", "208/2", "208/10"];
    const created = new Set<string>();

    for (const roomNumber of ["208/10", "208/2", "201", "208/1", "208"]) {
      const response = await createRoom({ roomNumber, rent: 2600 });
      expect(response.status).toBe(201);
      created.add((await response.json<RoomBody>()).room.id);
    }

    const list = await listRooms();
    expect(list.rooms.filter((room) => created.has(room.id)).map((room) => room.roomNumber)).toEqual(naturalOrder);
  });

  it("stores a room's recurring charges and returns them in position order", async () => {
    const created = await (await createRoom({ roomNumber: "G701", rent: 3000 })).json<RoomBody>();
    expect(created.room.ownCharges).toEqual([]);
    expect(created.room.excludedDormChargeIds).toEqual([]);
    expect(created.room.charges).toEqual([]);

    const response = await patchRoom(created.room.id, {
      ownCharges: [
        { name: "  ค่าบริการ  ", amount: 10 },
        { name: "ค่าขยะ", amount: 20 },
        { name: "ค่าไวไฟ", amount: 100 },
      ],
    });
    expect(response.status).toBe(200);

    const patched = await response.json<RoomBody>();
    expect(patched.room.ownCharges).toEqual([
      { name: "ค่าบริการ", amount: 10 },
      { name: "ค่าขยะ", amount: 20 },
      { name: "ค่าไวไฟ", amount: 100 },
    ]);
    expect(patched.room.charges).toEqual([
      { name: "ค่าบริการ", amount: 10 },
      { name: "ค่าขยะ", amount: 20 },
      { name: "ค่าไวไฟ", amount: 100 },
    ]);

    const list = await listRooms();
    const found = list.rooms.find((room) => room.id === created.room.id);
    expect(found?.ownCharges).toEqual(patched.room.ownCharges);
    expect(found?.charges).toEqual(patched.room.charges);
  });

  it("replaces a room's own recurring charges wholesale", async () => {
    const created = await (await createRoom({ roomNumber: "G702", rent: 3000 })).json<RoomBody>();

    const seeded = await patchRoom(created.room.id, {
      ownCharges: [
        { name: "ค่าบริการ", amount: 10 },
        { name: "ค่าขยะ", amount: 20 },
        { name: "ค่าไวไฟ", amount: 100 },
      ],
    });
    expect(seeded.status).toBe(200);
    expect((await seeded.json<RoomBody>()).room.ownCharges).toHaveLength(3);

    const reordered = await patchRoom(created.room.id, {
      ownCharges: [
        { name: "ค่าไวไฟ", amount: 100 },
        { name: "ค่าบริการ", amount: 10 },
      ],
    });
    expect(reordered.status).toBe(200);
    expect((await reordered.json<RoomBody>()).room.ownCharges).toEqual([
      { name: "ค่าไวไฟ", amount: 100 },
      { name: "ค่าบริการ", amount: 10 },
    ]);

    const cleared = await patchRoom(created.room.id, { ownCharges: [] });
    expect(cleared.status).toBe(200);
    expect((await cleared.json<RoomBody>()).room.ownCharges).toEqual([]);

    const list = await listRooms();
    const found = list.rooms.find((room) => room.id === created.room.id);
    expect(found?.ownCharges).toEqual([]);
    expect(found?.charges).toEqual([]);
  });

  it("leaves a room's own recurring charges untouched when the ownCharges key is absent", async () => {
    const created = await (await createRoom({ roomNumber: "G703", rent: 3000 })).json<RoomBody>();
    await patchRoom(created.room.id, { ownCharges: [{ name: "ค่าขยะ", amount: 20 }] });

    const response = await patchRoom(created.room.id, { rent: 3300 });
    expect(response.status).toBe(200);

    const patched = await response.json<RoomBody>();
    expect(patched.room.rent).toBe(3300);
    expect(patched.room.ownCharges).toEqual([{ name: "ค่าขยะ", amount: 20 }]);
    expect(patched.room.charges).toEqual([{ name: "ค่าขยะ", amount: 20 }]);
  });

  it("keeps a room numbered like a path segment intact", async () => {
    const created = await (await createRoom({ roomNumber: "208/7", rent: 2600 })).json<RoomBody>();
    expect(created.room.roomNumber).toBe("208/7");

    const response = await patchRoom(created.room.id, { ownCharges: [{ name: "ค่าบริการ", amount: 10 }] });
    expect(response.status).toBe(200);

    const patched = await response.json<RoomBody>();
    expect(patched.room.roomNumber).toBe("208/7");
    expect(patched.room.ownCharges).toEqual([{ name: "ค่าบริการ", amount: 10 }]);
    expect(patched.room.charges).toEqual([{ name: "ค่าบริการ", amount: 10 }]);

    const list = await listRooms();
    const found = list.rooms.find((room) => room.id === created.room.id);
    expect(found?.roomNumber).toBe("208/7");
    expect(found?.ownCharges).toEqual([{ name: "ค่าบริการ", amount: 10 }]);
  });

  it("rejects malformed own recurring charges with 400 and a field", async () => {
    const created = await (await createRoom({ roomNumber: "G704", rent: 3000 })).json<RoomBody>();
    const seeded = await patchRoom(created.room.id, { ownCharges: [{ name: "ค่าขยะ", amount: 20 }] });
    expect(seeded.status).toBe(200);

    const emptyName = await patchRoom(created.room.id, { ownCharges: [{ name: "   ", amount: 10 }] });
    expect(emptyName.status).toBe(400);
    expect((await emptyName.json<ErrorBody>()).error.field).toBe("ownCharges");

    const fractional = await patchRoom(created.room.id, { ownCharges: [{ name: "ค่าบริการ", amount: 12.5 }] });
    expect(fractional.status).toBe(400);
    expect((await fractional.json<ErrorBody>()).error.field).toBe("ownCharges");

    const negative = await patchRoom(created.room.id, { ownCharges: [{ name: "ค่าบริการ", amount: -1 }] });
    expect(negative.status).toBe(400);
    expect((await negative.json<ErrorBody>()).error.field).toBe("ownCharges");

    const notArray = await patchRoom(created.room.id, { ownCharges: "ค่าบริการ" });
    expect(notArray.status).toBe(400);

    const tooMany = await patchRoom(created.room.id, {
      ownCharges: Array.from({ length: 11 }, (_, index) => ({ name: `รายการ ${index}`, amount: index })),
    });
    expect(tooMany.status).toBe(400);
    expect((await tooMany.json<ErrorBody>()).error.field).toBe("ownCharges");

    const list = await listRooms();
    expect(list.rooms.find((room) => room.id === created.room.id)?.ownCharges).toEqual([{ name: "ค่าขยะ", amount: 20 }]);
  });
});

describe("room recurring charges and latest electric reading", () => {
  it("accepts own recurring charges at creation and reports a total that matches their sum", async () => {
    const response = await createRoom({
      roomNumber: "H801",
      rent: 3200,
      ownCharges: [
        { name: "ค่าบริการ", amount: 10 },
        { name: "ค่าขยะ", amount: 20 },
        { name: "ค่าไวไฟ", amount: 100 },
      ],
    });
    expect(response.status).toBe(201);

    const created = await response.json<RoomBody>();
    expect(created.room.ownCharges).toEqual([
      { name: "ค่าบริการ", amount: 10 },
      { name: "ค่าขยะ", amount: 20 },
      { name: "ค่าไวไฟ", amount: 100 },
    ]);
    expect(created.room.charges).toEqual(created.room.ownCharges);
    expect(created.room.excludedDormChargeIds).toEqual([]);

    const row = await listedRoom(created.room.id);
    expect(row?.ownCharges).toHaveLength(3);
    expect(row?.charges).toHaveLength(3);
    expect((row?.charges ?? []).reduce((sum, charge) => sum + charge.amount, 0)).toBe(130);

    const bare = await createRoom({ roomNumber: "H802", rent: 3200 });
    expect(bare.status).toBe(201);

    const bareCreated = await bare.json<RoomBody>();
    expect(bareCreated.room.ownCharges).toEqual([]);
    expect(bareCreated.room.charges).toEqual([]);
    expect(bareCreated.room.lastElectricAmount).toBeNull();
    expect(bareCreated.room.lastElectricPeriod).toBeNull();

    const bareRow = await listedRoom(bareCreated.room.id);
    expect(bareRow?.ownCharges).toEqual([]);
    expect(bareRow?.charges).toEqual([]);
    expect((bareRow?.charges ?? []).reduce((sum, charge) => sum + charge.amount, 0)).toBe(0);
  });

  it("rejects malformed own recurring charges on creation with 400 and a field", async () => {
    const emptyName = await createRoom({ roomNumber: "H803", rent: 3200, ownCharges: [{ name: " ", amount: 10 }] });
    expect(emptyName.status).toBe(400);
    expect((await emptyName.json<ErrorBody>()).error.field).toBe("ownCharges");

    const fractional = await createRoom({ roomNumber: "H804", rent: 3200, ownCharges: [{ name: "ค่าบริการ", amount: 12.5 }] });
    expect(fractional.status).toBe(400);
    expect((await fractional.json<ErrorBody>()).error.field).toBe("ownCharges");

    const list = await listRooms();
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

describe("dorm charges", () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM room_charge_excludes"),
      env.DB.prepare("DELETE FROM dorm_charges"),
    ]);
  });

  it("reaches every room that has no rows of its own", async () => {
    await setDormCharges([
      { name: "ค่าบริการส่วนกลาง", amount: 50 },
      { name: "ค่าขยะส่วนกลาง", amount: 30 },
    ]);

    const created = await (await createRoom({ roomNumber: "J901", rent: 3000 })).json<RoomBody>();

    expect(created.room.ownCharges).toEqual([]);
    expect(created.room.excludedDormChargeIds).toEqual([]);
    expect(created.room.charges).toEqual([
      { name: "ค่าบริการส่วนกลาง", amount: 50 },
      { name: "ค่าขยะส่วนกลาง", amount: 30 },
    ]);

    const listed = await listedRoom(created.room.id);
    expect(listed?.charges).toEqual(created.room.charges);
  });

  it("opts a room out of one dorm charge without affecting other rooms", async () => {
    const seed = await setDormCharges([
      { name: "ค่าบริการส่วนกลาง", amount: 50 },
      { name: "ค่าขยะส่วนกลาง", amount: 30 },
    ]);
    const service = dormChargeNamed(seed, "ค่าบริการส่วนกลาง");
    const trash = dormChargeNamed(seed, "ค่าขยะส่วนกลาง");

    const roomA = await (await createRoom({ roomNumber: "J902", rent: 3000 })).json<RoomBody>();
    const roomB = await (await createRoom({ roomNumber: "J903", rent: 3000 })).json<RoomBody>();

    const response = await patchRoom(roomA.room.id, { excludedDormChargeIds: [service.id] });
    expect(response.status).toBe(200);

    const patchedA = (await response.json<RoomBody>()).room;
    expect(patchedA.excludedDormChargeIds).toEqual([service.id]);
    expect(patchedA.ownCharges).toEqual([]);
    expect(patchedA.charges).toEqual([{ name: "ค่าขยะส่วนกลาง", amount: 30 }]);

    const listedB = await listedRoom(roomB.room.id);
    expect(listedB?.excludedDormChargeIds).toEqual([]);
    expect(listedB?.charges).toEqual([
      { name: "ค่าบริการส่วนกลาง", amount: 50 },
      { name: "ค่าขยะส่วนกลาง", amount: 30 },
    ]);
    expect(dormChargeNamed(await getDormCharges(), "ค่าบริการส่วนกลาง").id).toBe(service.id);
    expect(trash.id).not.toBe(service.id);
  });

  it("keeps a room opted out when a dorm charge's price changes, because the update must preserve the charge id", async () => {
    const seed = await setDormCharges([
      { name: "ค่าบริการส่วนกลาง", amount: 50 },
      { name: "ค่าขยะส่วนกลาง", amount: 30 },
    ]);
    const service = dormChargeNamed(seed, "ค่าบริการส่วนกลาง");
    const trash = dormChargeNamed(seed, "ค่าขยะส่วนกลาง");

    const room = await (await createRoom({ roomNumber: "J904", rent: 3000 })).json<RoomBody>();
    const excluded = await patchRoom(room.room.id, { excludedDormChargeIds: [service.id] });
    expect(excluded.status).toBe(200);

    const updated = await setDormCharges([
      { id: service.id, name: "ค่าบริการส่วนกลาง", amount: 80 },
      { id: trash.id, name: "ค่าขยะส่วนกลาง", amount: 45 },
    ]);

    expect(dormChargeNamed(updated, "ค่าบริการส่วนกลาง")).toEqual({ id: service.id, name: "ค่าบริการส่วนกลาง", amount: 80 });
    expect(dormChargeNamed(updated, "ค่าขยะส่วนกลาง")).toEqual({ id: trash.id, name: "ค่าขยะส่วนกลาง", amount: 45 });

    const listed = await listedRoom(room.room.id);
    expect(listed?.excludedDormChargeIds).toEqual([service.id]);
    expect(listed?.charges).toEqual([{ name: "ค่าขยะส่วนกลาง", amount: 45 }]);
  });

  it("drops a room's opt-out when its dorm charge is deleted", async () => {
    const seed = await setDormCharges([
      { name: "ค่าบริการส่วนกลาง", amount: 50 },
      { name: "ค่าขยะส่วนกลาง", amount: 30 },
    ]);
    const service = dormChargeNamed(seed, "ค่าบริการส่วนกลาง");
    const trash = dormChargeNamed(seed, "ค่าขยะส่วนกลาง");

    const room = await (await createRoom({ roomNumber: "J905", rent: 3000 })).json<RoomBody>();
    const excluded = await patchRoom(room.room.id, { excludedDormChargeIds: [service.id] });
    expect(excluded.status).toBe(200);

    const remaining = await setDormCharges([{ id: trash.id, name: "ค่าขยะส่วนกลาง", amount: 30 }]);
    expect(remaining.map((charge) => charge.id)).toEqual([trash.id]);

    const listed = await listedRoom(room.room.id);
    expect(listed?.excludedDormChargeIds).not.toContain(service.id);
    expect(listed?.excludedDormChargeIds).toEqual([]);
    expect(listed?.charges).toEqual([{ name: "ค่าขยะส่วนกลาง", amount: 30 }]);
  });

  it("rejects a bad dorm charge payload with 400 and a charges field", async () => {
    const seed = await setDormCharges([{ name: "ค่าบริการส่วนกลาง", amount: 50 }]);
    const service = dormChargeNamed(seed, "ค่าบริการส่วนกลาง");

    const unknownId = await putDormCharges([{ id: "nope", name: "ค่าบริการส่วนกลาง", amount: 50 }]);
    expect(unknownId.status).toBe(400);
    expect((await unknownId.json<ErrorBody>()).error.field).toBe("charges");

    const duplicateId = await putDormCharges([
      { id: service.id, name: "ค่าบริการส่วนกลาง", amount: 50 },
      { id: service.id, name: "ค่าบริการส่วนกลาง", amount: 50 },
    ]);
    expect(duplicateId.status).toBe(400);
    expect((await duplicateId.json<ErrorBody>()).error.field).toBe("charges");

    const emptyName = await putDormCharges([{ name: "   ", amount: 10 }]);
    expect(emptyName.status).toBe(400);
    expect((await emptyName.json<ErrorBody>()).error.field).toBe("charges");

    const negative = await putDormCharges([{ name: "ค่าบริการ", amount: -1 }]);
    expect(negative.status).toBe(400);
    expect((await negative.json<ErrorBody>()).error.field).toBe("charges");

    const fractional = await putDormCharges([{ name: "ค่าบริการ", amount: 12.5 }]);
    expect(fractional.status).toBe(400);
    expect((await fractional.json<ErrorBody>()).error.field).toBe("charges");

    const stored = await getDormCharges();
    expect(stored).toEqual([{ id: service.id, name: "ค่าบริการส่วนกลาง", amount: 50 }]);
  });

  it("rejects an unknown dorm charge id on a room write with 400 and an excludedDormChargeIds field", async () => {
    const seed = await setDormCharges([{ name: "ค่าบริการส่วนกลาง", amount: 50 }]);
    const service = dormChargeNamed(seed, "ค่าบริการส่วนกลาง");

    const created = await (await createRoom({ roomNumber: "J906", rent: 3000 })).json<RoomBody>();

    const unknown = await patchRoom(created.room.id, { excludedDormChargeIds: ["nope"] });
    expect(unknown.status).toBe(400);
    const unknownBody = await unknown.json<ErrorBody>();
    expect(unknownBody.ok).toBe(false);
    expect(unknownBody.error.code).toBe("VALIDATION");
    expect(unknownBody.error.field).toBe("excludedDormChargeIds");

    const duplicated = await patchRoom(created.room.id, { excludedDormChargeIds: [service.id, service.id] });
    expect(duplicated.status).toBe(400);
    expect((await duplicated.json<ErrorBody>()).error.field).toBe("excludedDormChargeIds");

    const unknownOnCreate = await createRoom({ roomNumber: "J907", rent: 3000, excludedDormChargeIds: ["nope"] });
    expect(unknownOnCreate.status).toBe(400);
    expect((await unknownOnCreate.json<ErrorBody>()).error.field).toBe("excludedDormChargeIds");

    const list = await listRooms();
    expect(list.rooms.some((room) => room.roomNumber === "J907")).toBe(false);
  });

  it("appends a room's own extras after the inherited dorm charges", async () => {
    const seed = await setDormCharges([
      { name: "ค่าบริการส่วนกลาง", amount: 50 },
      { name: "ค่าขยะส่วนกลาง", amount: 30 },
    ]);
    const service = dormChargeNamed(seed, "ค่าบริการส่วนกลาง");

    const room = await (await createRoom({ roomNumber: "J908", rent: 3000 })).json<RoomBody>();
    const response = await patchRoom(room.room.id, { ownCharges: [{ name: "ค่าที่จอดรถ", amount: 100 }] });
    expect(response.status).toBe(200);

    const patched = (await response.json<RoomBody>()).room;
    expect(patched.ownCharges).toEqual([{ name: "ค่าที่จอดรถ", amount: 100 }]);
    expect(patched.charges).toEqual([
      { name: "ค่าบริการส่วนกลาง", amount: 50 },
      { name: "ค่าขยะส่วนกลาง", amount: 30 },
      { name: "ค่าที่จอดรถ", amount: 100 },
    ]);

    const excluded = await patchRoom(room.room.id, { excludedDormChargeIds: [service.id] });
    expect(excluded.status).toBe(200);
    expect((await excluded.json<RoomBody>()).room.charges).toEqual([
      { name: "ค่าขยะส่วนกลาง", amount: 30 },
      { name: "ค่าที่จอดรถ", amount: 100 },
    ]);
  });
});

describe("room billing state for a period", () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM bill_charges"),
      env.DB.prepare("DELETE FROM room_charges"),
      env.DB.prepare("DELETE FROM room_charge_excludes"),
      env.DB.prepare("DELETE FROM dorm_charges"),
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

describe("family isolation", () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM bill_charges"),
      env.DB.prepare("DELETE FROM room_charges"),
      env.DB.prepare("DELETE FROM room_charge_excludes"),
      env.DB.prepare("DELETE FROM slips"),
      env.DB.prepare("DELETE FROM bills"),
      env.DB.prepare("DELETE FROM tenants"),
      env.DB.prepare("DELETE FROM rooms"),
    ]);
  });

  it("lets each family keep its own room numbered 201", async () => {
    const other = await signIn("owner", await createFamily());

    const mine = await createRoom({ roomNumber: "201", rent: 3000 });
    expect(mine.status).toBe(201);
    const myRoom = (await mine.json<RoomBody>()).room;

    const theirs = await createRoom({ roomNumber: "201", rent: 4200 }, other);
    expect(theirs.status).toBe(201);
    const theirRoom = (await theirs.json<RoomBody>()).room;

    expect(theirRoom.id).not.toBe(myRoom.id);
    expect(theirRoom.rent).toBe(4200);
    expect(myRoom.rent).toBe(3000);

    const myList = await listRooms();
    expect(myList.rooms.map((room) => room.id)).toContain(myRoom.id);
    expect(myList.rooms.map((room) => room.id)).not.toContain(theirRoom.id);

    const theirList = await listRooms(other);
    expect(theirList.rooms.map((room) => room.id)).toContain(theirRoom.id);
    expect(theirList.rooms.map((room) => room.id)).not.toContain(myRoom.id);
  });

  it("still reports a duplicate room number inside the same family", async () => {
    const other = await signIn("owner", await createFamily());

    const first = await createRoom({ roomNumber: "202", rent: 3000 }, other);
    expect(first.status).toBe(201);

    const duplicate = await createRoom({ roomNumber: "202", rent: 3000 }, other);
    expect(duplicate.status).toBe(409);

    const body = await duplicate.json<ErrorBody>();
    expect(body.error.code).toBe("DUPLICATE");
    expect(body.error.field).toBe("roomNumber");
  });

  it("hides another family's room from reads and refuses to patch it", async () => {
    const other = await signIn("owner", await createFamily());

    const mine = await createRoom({ roomNumber: "203", rent: 3000, ownCharges: [{ name: "ค่าบริการ", amount: 10 }] });
    expect(mine.status).toBe(201);
    const myRoom = (await mine.json<RoomBody>()).room;

    expect(await listedRoom(myRoom.id, other)).toBeUndefined();

    const patched = await patchRoom(myRoom.id, { rent: 9999 }, other);
    expect(patched.status).toBe(404);
    expect((await patched.json<ErrorBody>()).error.code).toBe("NOT_FOUND");

    const stillMine = await listedRoom(myRoom.id);
    expect(stillMine?.rent).toBe(3000);
    expect(stillMine?.ownCharges).toEqual([{ name: "ค่าบริการ", amount: 10 }]);
  });

  it("rejects another family's dorm charge id on a room write", async () => {
    const other = await signIn("owner", await createFamily());
    const theirCharges = await setDormCharges([{ name: "ค่าส่วนกลางของอีกครอบครัว", amount: 50 }], other);
    const theirCharge = theirCharges[0];

    if (theirCharge === undefined) {
      throw new Error("expected the other family's dorm charge");
    }

    const mine = await createRoom({ roomNumber: "204", rent: 3000 });
    expect(mine.status).toBe(201);
    const myRoom = (await mine.json<RoomBody>()).room;

    const response = await patchRoom(myRoom.id, { excludedDormChargeIds: [theirCharge.id] });
    expect(response.status).toBe(400);

    const body = await response.json<ErrorBody>();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.field).toBe("excludedDormChargeIds");

    const stored = await listedRoom(myRoom.id);
    expect(stored?.excludedDormChargeIds).toEqual([]);
  });
});

describe("recurring charge names", () => {
  it("rejects two room charges that share a trimmed, case-insensitive name", async () => {
    const created = await (await createRoom({ roomNumber: "L301", rent: 3000 })).json<RoomBody>();
    const seeded = await patchRoom(created.room.id, { ownCharges: [{ name: "ค่าขยะ", amount: 20 }] });
    expect(seeded.status).toBe(200);

    const sameName = await patchRoom(created.room.id, {
      ownCharges: [
        { name: "ค่าส่วนกลาง", amount: 50 },
        { name: "  ค่าส่วนกลาง  ", amount: 50 },
      ],
    });
    expect(sameName.status).toBe(400);
    const sameNameBody = await sameName.json<ErrorBody>();
    expect(sameNameBody.error.code).toBe("VALIDATION");
    expect(sameNameBody.error.field).toBe("ownCharges");

    const differentCase = await patchRoom(created.room.id, {
      ownCharges: [
        { name: "Parking", amount: 100 },
        { name: "parking", amount: 100 },
      ],
    });
    expect(differentCase.status).toBe(400);
    expect((await differentCase.json<ErrorBody>()).error.field).toBe("ownCharges");

    const onCreate = await createRoom({
      roomNumber: "L302",
      rent: 3000,
      ownCharges: [
        { name: "ค่าขยะ", amount: 20 },
        { name: "ค่าขยะ", amount: 30 },
      ],
    });
    expect(onCreate.status).toBe(400);
    expect((await onCreate.json<ErrorBody>()).error.field).toBe("ownCharges");

    const stored = await listedRoom(created.room.id);
    expect(stored?.ownCharges).toEqual([{ name: "ค่าขยะ", amount: 20 }]);
    expect((await listRooms()).rooms.some((room) => room.roomNumber === "L302")).toBe(false);
  });

  it("rejects two dorm charges that share a trimmed, case-insensitive name", async () => {
    const response = await putDormCharges([
      { name: "ค่าส่วนกลาง", amount: 50 },
      { name: "  ค่าส่วนกลาง  ", amount: 60 },
    ]);
    expect(response.status).toBe(400);

    const body = await response.json<ErrorBody>();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.field).toBe("charges");
  });
});

describe("room patch when a dorm charge disappears mid-request", () => {
  const storedRoom = {
    id: "room-1",
    room_number: "M101",
    rent: 3000,
    water_rate: null,
    electric_mode: "meter",
    electric_rate: 8,
    water_meter_init: 0,
    electric_meter_init: 0,
    status: "vacant",
    created_at: "2026-01-01 00:00:00",
    occupied_by: null,
    last_electric_amount: null,
    last_electric_period: null,
  };

  /**
   * D1 ปลอมที่จำลองจังหวะอันตราย: ตอนตรวจ payload ยังเห็นรายการค่าใช้จ่ายของหอ
   * แต่พอถึงบรรทัด insert รายการนั้นถูกลบไปแล้ว คำสั่งชุดจึงล้มด้วย foreign key
   */
  function envWhereDormChargeVanishes(first: DormChargePayload[], later: DormChargePayload[]): Env {
    let dormReads = 0;

    const prepare = (sql: string) => {
      const statement = {
        bind: () => statement,
        first: () => Promise.resolve(sql.includes("FROM rooms r") ? storedRoom : null),
        all: () => Promise.resolve({ results: sql.includes("FROM dorm_charges") ? (dormReads++ === 0 ? first : later) : [] }),
        run: () => Promise.resolve({ success: true }),
      };

      return statement;
    };

    return {
      DB: {
        prepare,
        batch: () => Promise.reject(new Error("D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT")),
      },
    } as unknown as Env;

  }

  async function patchThroughRoute(target: Env, body: Record<string, unknown>): Promise<Response> {
    const app = new Hono<AppEnv>();

    app.use("*", async (c, next) => {
      c.set("session", { userId: "user-1", familyId: "family-1", email: "owner@example.com", displayName: "ผู้ทดสอบ", role: "owner" });
      c.set("sessionToken", "token-1");
      await next();
    });
    app.route("/api/rooms", rooms);

    return await app.request(
      "https://dorm.test/api/rooms/room-1",
      { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      target,
    );
  }

  it("answers with a validation error instead of a 500", async () => {
    const charge = { id: "dorm-1", name: "ค่าส่วนกลาง", amount: 50 };
    const response = await patchThroughRoute(envWhereDormChargeVanishes([charge], []), { excludedDormChargeIds: [charge.id] });

    expect(response.status).toBe(400);

    const body = await response.json<ErrorBody>();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.field).toBe("excludedDormChargeIds");
  });

  it("still reports a system failure when every referenced dorm charge is intact", async () => {
    const charge = { id: "dorm-1", name: "ค่าส่วนกลาง", amount: 50 };
    const response = await patchThroughRoute(envWhereDormChargeVanishes([charge], [charge]), { excludedDormChargeIds: [charge.id] });

    expect(response.status).toBe(500);
    expect((await response.json<ErrorBody>()).error.code).toBe("INTERNAL");
  });
});
