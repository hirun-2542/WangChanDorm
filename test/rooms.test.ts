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

interface RoomListBody {
  ok: boolean;
  rooms: RoomPayload[];
}

interface RoomBody {
  ok: boolean;
  room: RoomPayload;
}

interface ErrorBody {
  ok: boolean;
  error: { code: string; message: string; field?: string };
}

const roomsUrl = "https://dorm.test/api/rooms";

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
});
