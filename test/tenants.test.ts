import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createFamily, signIn, withAuth, type TestSession } from "./auth-helper";

interface RoomPayload {
  id: string;
  roomNumber: string;
  rent: number;
  status: "vacant" | "occupied";
  occupiedBy: string | null;
}

interface TenantPayload {
  id: string;
  fullName: string;
  phone: string;
  roomId: string;
  roomNumber: string;
  checkInDate: string;
  checkOutDate: string | null;
  lineUserId: string | null;
  status: "current" | "moved-out";
}

interface RoomListBody {
  ok: boolean;
  rooms: RoomPayload[];
}

interface TenantListBody {
  ok: boolean;
  tenants: TenantPayload[];
}

interface TenantBody {
  ok: boolean;
  tenant: TenantPayload;
}

interface ErrorBody {
  ok: boolean;
  error: { code: string; message: string; field?: string };
}

const roomsUrl = "https://dorm.test/api/rooms";
const tenantsUrl = "https://dorm.test/api/tenants";

let session: TestSession;

beforeEach(async () => {
  session = await signIn();
});

function createRoom(roomNumber: string, as: TestSession = session): Promise<Response> {
  return SELF.fetch(
    roomsUrl,
    withAuth(as, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomNumber, rent: 3500 }),
    }),
  );
}

function createTenant(payload: Record<string, unknown>, as: TestSession = session): Promise<Response> {
  return SELF.fetch(
    tenantsUrl,
    withAuth(as, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

function patchTenant(id: string, payload: Record<string, unknown>, as: TestSession = session): Promise<Response> {
  return SELF.fetch(
    `${tenantsUrl}/${id}`,
    withAuth(as, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

function checkoutTenant(id: string, payload: Record<string, unknown>, as: TestSession = session): Promise<Response> {
  return SELF.fetch(
    `${tenantsUrl}/${id}/checkout`,
    withAuth(as, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

async function newRoom(roomNumber: string, as: TestSession = session): Promise<RoomPayload> {
  const response = await createRoom(roomNumber, as);
  expect(response.status).toBe(201);
  const body = await response.json<{ ok: boolean; room: RoomPayload }>();
  return body.room;
}

async function newTenant(roomId: string, fullName: string, checkInDate: string): Promise<TenantPayload> {
  const response = await createTenant({ fullName, phone: "081-234-5678", roomId, checkInDate });
  expect(response.status).toBe(201);
  const body = await response.json<TenantBody>();
  return body.tenant;
}

async function roomById(id: string, as: TestSession = session): Promise<RoomPayload> {
  const list = await (await SELF.fetch(roomsUrl, withAuth(as))).json<RoomListBody>();
  const found = list.rooms.find((room) => room.id === id);
  if (found === undefined) {
    throw new Error("room not found");
  }
  return found;
}

async function tenantsList(as: TestSession = session): Promise<TenantPayload[]> {
  return (await (await SELF.fetch(tenantsUrl, withAuth(as))).json<TenantListBody>()).tenants;
}

describe("tenants check-in and check-out", () => {
  it("creates a tenant into a vacant room and marks the room occupied with its occupant", async () => {
    const room = await newRoom("T101");

    const response = await createTenant({
      fullName: "สมชาย ใจดี",
      phone: "081-234-5678",
      roomId: room.id,
      checkInDate: "2025-03-01",
    });

    expect(response.status).toBe(201);

    const created = await response.json<TenantBody>();
    expect(created.ok).toBe(true);
    expect(created.tenant.id.length).toBeGreaterThan(0);
    expect(created.tenant.fullName).toBe("สมชาย ใจดี");
    expect(created.tenant.roomId).toBe(room.id);
    expect(created.tenant.roomNumber).toBe("T101");
    expect(created.tenant.checkInDate).toBe("2025-03-01");
    expect(created.tenant.checkOutDate).toBeNull();
    expect(created.tenant.lineUserId).toBeNull();
    expect(created.tenant.status).toBe("current");

    const updatedRoom = await roomById(room.id);
    expect(updatedRoom.status).toBe("occupied");
    expect(updatedRoom.occupiedBy).toBe("สมชาย ใจดี");
  });

  it("rejects a second current tenant in the same room and stores no extra tenant", async () => {
    const room = await newRoom("T102");
    await newTenant(room.id, "มาลี ศรีสุข", "2025-04-12");

    const conflict = await createTenant({
      fullName: "ธนา เจริญกิจ",
      phone: "085-456-7890",
      roomId: room.id,
      checkInDate: "2025-05-01",
    });

    expect(conflict.status).toBe(409);

    const body = await conflict.json<ErrorBody>();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.field).toBe("roomId");
    expect(body.error.message.length).toBeGreaterThan(0);

    const forRoom = (await tenantsList()).filter((tenant) => tenant.roomId === room.id);
    expect(forRoom).toHaveLength(1);
    expect(forRoom[0]?.fullName).toBe("มาลี ศรีสุข");
  });

  it("checks a tenant out, frees the room and keeps the tenant history", async () => {
    const room = await newRoom("T103");
    const tenant = await newTenant(room.id, "อรุณี แสงทอง", "2025-05-20");

    const response = await checkoutTenant(tenant.id, { checkOutDate: "2025-08-30" });
    expect(response.status).toBe(200);

    const checkedOut = await response.json<TenantBody>();
    expect(checkedOut.tenant.status).toBe("moved-out");
    expect(checkedOut.tenant.checkOutDate).toBe("2025-08-30");

    const updatedRoom = await roomById(room.id);
    expect(updatedRoom.status).toBe("vacant");
    expect(updatedRoom.occupiedBy).toBeNull();

    const kept = (await tenantsList()).find((item) => item.id === tenant.id);
    expect(kept?.status).toBe("moved-out");
    expect(kept?.checkOutDate).toBe("2025-08-30");
  });

  it("rejects checking out a tenant that already moved out", async () => {
    const room = await newRoom("T104");
    const tenant = await newTenant(room.id, "ปริญญา สุวรรณโชติ", "2025-06-01");
    await checkoutTenant(tenant.id, { checkOutDate: "2025-08-30" });

    const again = await checkoutTenant(tenant.id, { checkOutDate: "2025-09-01" });
    expect(again.status).toBe(409);

    const body = await again.json<ErrorBody>();
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.message.length).toBeGreaterThan(0);
  });

  it("rejects a check-out date earlier than the check-in date", async () => {
    const room = await newRoom("T105");
    const tenant = await newTenant(room.id, "วิภา สุขสันต์", "2025-06-10");

    const response = await checkoutTenant(tenant.id, { checkOutDate: "2025-05-01" });
    expect(response.status).toBe(400);

    const body = await response.json<ErrorBody>();
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.field).toBe("checkOutDate");

    const kept = (await tenantsList()).find((item) => item.id === tenant.id);
    expect(kept?.status).toBe("current");
  });

  it("edits a tenant name and phone", async () => {
    const room = await newRoom("T106");
    const tenant = await newTenant(room.id, "ศิริพร ทองคำ", "2025-06-15");

    const response = await patchTenant(tenant.id, { fullName: "ศิริพร ใจดี", phone: "080-000-0000" });
    expect(response.status).toBe(200);

    const patched = await response.json<TenantBody>();
    expect(patched.tenant.fullName).toBe("ศิริพร ใจดี");
    expect(patched.tenant.phone).toBe("080-000-0000");

    const stored = (await tenantsList()).find((item) => item.id === tenant.id);
    expect(stored?.fullName).toBe("ศิริพร ใจดี");
    expect(stored?.phone).toBe("080-000-0000");
  });

  it("returns 404 for an unknown tenant and rejects changing rooms", async () => {
    const missing = await patchTenant("missing-id", { fullName: "ไม่มีจริง" });
    expect(missing.status).toBe(404);

    const missingBody = await missing.json<ErrorBody>();
    expect(missingBody.error.code).toBe("NOT_FOUND");

    const room = await newRoom("T107");
    const other = await newRoom("T108");
    const tenant = await newTenant(room.id, "นพดล อินทร์แปลง", "2025-07-10");

    const move = await patchTenant(tenant.id, { roomId: other.id });
    expect(move.status).toBe(400);

    const moveBody = await move.json<ErrorBody>();
    expect(moveBody.error.code).toBe("VALIDATION");
    expect(moveBody.error.field).toBe("roomId");
  });

  it("validates the required tenant fields", async () => {
    const room = await newRoom("T109");

    const noName = await createTenant({ phone: "081-234-5678", roomId: room.id, checkInDate: "2025-07-01" });
    expect(noName.status).toBe(400);
    expect((await noName.json<ErrorBody>()).error.field).toBe("fullName");

    const noPhone = await createTenant({ fullName: "วีระ คำมณี", roomId: room.id, checkInDate: "2025-07-01" });
    expect(noPhone.status).toBe(400);
    expect((await noPhone.json<ErrorBody>()).error.field).toBe("phone");

    const unknownRoom = await createTenant({
      fullName: "วีระ คำมณี",
      phone: "081-234-5678",
      roomId: "room-does-not-exist",
      checkInDate: "2025-07-01",
    });
    expect(unknownRoom.status).toBe(404);
    expect((await unknownRoom.json<ErrorBody>()).error.field).toBe("roomId");
  });

  it("lists current tenants before moved-out tenants", async () => {
    const currentRoom = await newRoom("T110");
    const leavingRoom = await newRoom("T111");
    const staying = await newTenant(currentRoom.id, "วีระ คำมณี", "2025-07-03");
    const leaving = await newTenant(leavingRoom.id, "จันทร์เพ็ญ อินทรีย์", "2025-08-01");

    await checkoutTenant(leaving.id, { checkOutDate: "2025-08-30" });

    const list = await tenantsList();
    const stayingIndex = list.findIndex((tenant) => tenant.id === staying.id);
    const leavingIndex = list.findIndex((tenant) => tenant.id === leaving.id);

    expect(stayingIndex).toBeGreaterThanOrEqual(0);
    expect(leavingIndex).toBeGreaterThanOrEqual(0);
    expect(stayingIndex).toBeLessThan(leavingIndex);
    expect(list[stayingIndex]?.status).toBe("current");
    expect(list[leavingIndex]?.status).toBe("moved-out");
  });

  it("rejects editing a moved-out tenant to a check-in date after the check-out", async () => {
    const room = await newRoom("T112");
    const tenant = await newTenant(room.id, "สมหญิง รักดี", "2025-07-01");
    await checkoutTenant(tenant.id, { checkOutDate: "2025-08-15" });

    const response = await patchTenant(tenant.id, { checkInDate: "2025-09-01" });
    expect(response.status).toBe(400);

    const body = await response.json<ErrorBody>();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.field).toBe("checkInDate");

    const kept = (await tenantsList()).find((item) => item.id === tenant.id);
    expect(kept?.checkInDate).toBe("2025-07-01");

    const boundary = await patchTenant(tenant.id, { checkInDate: "2025-08-15" });
    expect(boundary.status).toBe(200);

    const boundaryBody = await boundary.json<TenantBody>();
    expect(boundaryBody.tenant.checkInDate).toBe("2025-08-15");
  });

  it("rejects a junk phone but accepts and stores a real one", async () => {
    const junkRoom = await newRoom("T113");
    const junk = await createTenant({
      fullName: "ธนากร พูนสุข",
      phone: "--------1",
      roomId: junkRoom.id,
      checkInDate: "2025-07-01",
    });
    expect(junk.status).toBe(400);

    const junkBody = await junk.json<ErrorBody>();
    expect(junkBody.ok).toBe(false);
    expect(junkBody.error.code).toBe("VALIDATION");
    expect(junkBody.error.field).toBe("phone");

    const realRoom = await newRoom("T114");
    const real = await createTenant({
      fullName: "กมล ใจเย็น",
      phone: "+081-234-5678",
      roomId: realRoom.id,
      checkInDate: "2025-07-02",
    });
    expect(real.status).toBe(201);

    const created = await real.json<TenantBody>();
    expect(created.tenant.phone).toBe("+081-234-5678");

    const stored = (await tenantsList()).find((item) => item.id === created.tenant.id);
    expect(stored?.phone).toBe("+081-234-5678");
  });

  it("accepts 9-10 digit phones with spaces or dashes and rejects anything else", async () => {
    const spacedRoom = await newRoom("T115");
    const spaced = await createTenant({
      fullName: "สมหมาย ใจงาม",
      phone: "081 234 5678",
      roomId: spacedRoom.id,
      checkInDate: "2025-07-03",
    });
    expect(spaced.status).toBe(201);
    expect((await spaced.json<TenantBody>()).tenant.phone).toBe("081 234 5678");

    const shortRoom = await newRoom("T116");
    const short = await createTenant({
      fullName: "บุญมี พูนทรัพย์",
      phone: "081-234-567",
      roomId: shortRoom.id,
      checkInDate: "2025-07-04",
    });
    expect(short.status).toBe(201);
    const shortTenant = (await short.json<TenantBody>()).tenant;

    const longRoom = await newRoom("T117");
    const tooLong = await createTenant({
      fullName: "สมบัติ ร่ำรวย",
      phone: "08123456789",
      roomId: longRoom.id,
      checkInDate: "2025-07-05",
    });
    expect(tooLong.status).toBe(400);
    expect((await tooLong.json<ErrorBody>()).error.field).toBe("phone");

    const bracketedRoom = await newRoom("T118");
    const bracketed = await createTenant({
      fullName: "อารีย์ สุขใจ",
      phone: "(081)2345678",
      roomId: bracketedRoom.id,
      checkInDate: "2025-07-06",
    });
    expect(bracketed.status).toBe(400);
    expect((await bracketed.json<ErrorBody>()).error.field).toBe("phone");

    const edited = await patchTenant(shortTenant.id, { phone: "08123456789" });
    expect(edited.status).toBe(400);
    expect((await edited.json<ErrorBody>()).error.field).toBe("phone");

    const kept = (await tenantsList()).find((item) => item.id === shortTenant.id);
    expect(kept?.phone).toBe("081-234-567");
  });
});

describe("family isolation", () => {
  it("hides another family's room and tenant and refuses to edit them", async () => {
    const other = await signIn("owner", await createFamily());

    const room = await newRoom("S201");
    const tenant = await newTenant(room.id, "สมชาย ใจดี", "2025-03-01");

    const theirRooms = await (await SELF.fetch(roomsUrl, withAuth(other))).json<RoomListBody>();
    expect(theirRooms.rooms.some((item) => item.id === room.id)).toBe(false);

    const theirTenants = await tenantsList(other);
    expect(theirTenants.some((item) => item.id === tenant.id)).toBe(false);

    const patched = await patchTenant(tenant.id, { fullName: "แก้ไขข้ามครอบครัว" }, other);
    expect(patched.status).toBe(404);
    expect((await patched.json<ErrorBody>()).error.code).toBe("NOT_FOUND");

    const checkedOut = await checkoutTenant(tenant.id, { checkOutDate: "2025-08-30" }, other);
    expect(checkedOut.status).toBe(404);

    const kept = (await tenantsList()).find((item) => item.id === tenant.id);
    expect(kept?.fullName).toBe("สมชาย ใจดี");
    expect(kept?.status).toBe("current");

    const keptRoom = await roomById(room.id);
    expect(keptRoom.status).toBe("occupied");
    expect(keptRoom.occupiedBy).toBe("สมชาย ใจดี");
  });

  it("refuses to check a tenant into another family's room", async () => {
    const other = await signIn("owner", await createFamily());
    const room = await newRoom("S202");

    const response = await createTenant(
      { fullName: "ข้ามครอบครัว", phone: "081-234-5678", roomId: room.id, checkInDate: "2025-03-01" },
      other,
    );

    expect(response.status).toBe(404);
    expect((await response.json<ErrorBody>()).error.field).toBe("roomId");

    const keptRoom = await roomById(room.id);
    expect(keptRoom.status).toBe("vacant");
    expect((await tenantsList()).some((item) => item.roomId === room.id)).toBe(false);
  });
});
