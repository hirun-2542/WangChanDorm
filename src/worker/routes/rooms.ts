import { Hono } from "hono";
import { errorBody, readJsonObject } from "./shared";

const rooms = new Hono<{ Bindings: Env }>();

type ElectricMode = "meter" | "flat";
type RoomStatus = "vacant" | "occupied";

interface RoomRow {
  id: string;
  room_number: string;
  rent: number;
  water_rate: number | null;
  electric_mode: string;
  electric_rate: number | null;
  water_meter_init: number;
  electric_meter_init: number;
  status: string;
  created_at: string;
  occupied_by: string | null;
}

interface RoomPayload {
  id: string;
  roomNumber: string;
  rent: number;
  waterRate: number | null;
  electricMode: ElectricMode;
  electricRate: number | null;
  waterMeterInit: number;
  electricMeterInit: number;
  status: RoomStatus;
  occupiedBy: string | null;
}

const roomColumns =
  "r.id, r.room_number, r.rent, r.water_rate, r.electric_mode, r.electric_rate, r.water_meter_init, r.electric_meter_init, r.status, r.created_at, t.full_name AS occupied_by";

const roomFrom = "FROM rooms r LEFT JOIN tenants t ON t.room_id = r.id AND t.status = 'current'";

function toRoom(row: RoomRow): RoomPayload {
  return {
    id: row.id,
    roomNumber: row.room_number,
    rent: row.rent,
    waterRate: row.water_rate,
    electricMode: row.electric_mode === "flat" ? "flat" : "meter",
    electricRate: row.electric_rate,
    waterMeterInit: row.water_meter_init,
    electricMeterInit: row.electric_meter_init,
    status: row.status === "occupied" ? "occupied" : "vacant",
    occupiedBy: row.occupied_by,
  };
}

function parsePositiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function parseNonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function parseOptionalPositive(value: unknown): { valid: boolean; value: number | null } {
  if (value === undefined || value === null) {
    return { valid: true, value: null };
  }

  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return { valid: true, value };
  }

  return { valid: false, value: null };
}

function parseElectricMode(value: unknown): ElectricMode | null {
  return value === "meter" || value === "flat" ? value : null;
}

rooms.get("/", async (c) => {
  try {
    const result = await c.env.DB.prepare(`SELECT ${roomColumns} ${roomFrom} ORDER BY r.room_number ASC`).all<RoomRow>();
    return c.json({ ok: true, rooms: result.results.map(toRoom) }, 200);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ message: "list rooms failed", error: detail }));
    return c.json(errorBody("INTERNAL", "โหลดข้อมูลห้องไม่สำเร็จ"), 500);
  }
});

rooms.post("/", async (c) => {
  const body = await readJsonObject(c.req.raw);

  if (body === null) {
    return c.json(errorBody("VALIDATION", "รูปแบบข้อมูลไม่ถูกต้อง"), 400);
  }

  const roomNumber = typeof body.roomNumber === "string" ? body.roomNumber.trim().toUpperCase() : "";

  if (roomNumber === "") {
    return c.json(errorBody("VALIDATION", "กรุณากรอกเลขห้อง", "roomNumber"), 400);
  }

  const rent = parsePositiveInt(body.rent);

  if (rent === null) {
    return c.json(errorBody("VALIDATION", "ค่าเช่าต้องเป็นจำนวนเต็มมากกว่า 0", "rent"), 400);
  }

  const waterRate = parseOptionalPositive(body.waterRate);

  if (!waterRate.valid) {
    return c.json(errorBody("VALIDATION", "อัตราค่าน้ำต้องเป็นตัวเลขมากกว่า 0", "waterRate"), 400);
  }

  const electricMode = body.electricMode === undefined ? "meter" : parseElectricMode(body.electricMode);

  if (electricMode === null) {
    return c.json(errorBody("VALIDATION", "โหมดค่าไฟต้องเป็น meter หรือ flat", "electricMode"), 400);
  }

  const electricRate = parseOptionalPositive(body.electricRate);

  if (!electricRate.valid) {
    return c.json(errorBody("VALIDATION", "อัตราค่าไฟต้องเป็นตัวเลขมากกว่า 0", "electricRate"), 400);
  }

  const waterMeterInit = body.waterMeterInit === undefined ? 0 : parseNonNegative(body.waterMeterInit);

  if (waterMeterInit === null) {
    return c.json(errorBody("VALIDATION", "มิเตอร์น้ำเริ่มต้นต้องเป็นตัวเลขไม่ติดลบ", "waterMeterInit"), 400);
  }

  const electricMeterInit = body.electricMeterInit === undefined ? 0 : parseNonNegative(body.electricMeterInit);

  if (electricMeterInit === null) {
    return c.json(errorBody("VALIDATION", "มิเตอร์ไฟเริ่มต้นต้องเป็นตัวเลขไม่ติดลบ", "electricMeterInit"), 400);
  }

  const storedElectricRate = electricMode === "flat" ? null : electricRate.value;
  const id = crypto.randomUUID();

  try {
    const existing = await c.env.DB.prepare("SELECT id FROM rooms WHERE room_number = ?").bind(roomNumber).first<{ id: string }>();

    if (existing !== null) {
      return c.json(errorBody("DUPLICATE", "เลขห้องนี้ถูกใช้แล้ว", "roomNumber"), 409);
    }

    await c.env.DB.prepare(
      "INSERT INTO rooms (id, room_number, rent, water_rate, electric_mode, electric_rate, water_meter_init, electric_meter_init, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'vacant')",
    )
      .bind(id, roomNumber, rent, waterRate.value, electricMode, storedElectricRate, waterMeterInit, electricMeterInit)
      .run();

    const row = await c.env.DB.prepare(`SELECT ${roomColumns} ${roomFrom} WHERE r.id = ?`).bind(id).first<RoomRow>();

    if (row === null) {
      console.error(JSON.stringify({ message: "create room readback failed", roomId: id }));
      return c.json(errorBody("INTERNAL", "สร้างห้องไม่สำเร็จ"), 500);
    }

    return c.json({ ok: true, room: toRoom(row) }, 201);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ message: "create room failed", error: detail }));

    if (detail.includes("UNIQUE")) {
      return c.json(errorBody("DUPLICATE", "เลขห้องนี้ถูกใช้แล้ว", "roomNumber"), 409);
    }

    return c.json(errorBody("INTERNAL", "สร้างห้องไม่สำเร็จ"), 500);
  }
});

rooms.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await readJsonObject(c.req.raw);

  if (body === null) {
    return c.json(errorBody("VALIDATION", "รูปแบบข้อมูลไม่ถูกต้อง"), 400);
  }

  try {
    const existing = await c.env.DB.prepare(`SELECT ${roomColumns} ${roomFrom} WHERE r.id = ?`).bind(id).first<RoomRow>();

    if (existing === null) {
      return c.json(errorBody("NOT_FOUND", "ไม่พบห้องที่ต้องการแก้ไข"), 404);
    }

    let roomNumber = existing.room_number;

    if (body.roomNumber !== undefined) {
      const parsed = typeof body.roomNumber === "string" ? body.roomNumber.trim().toUpperCase() : "";

      if (parsed === "") {
        return c.json(errorBody("VALIDATION", "กรุณากรอกเลขห้อง", "roomNumber"), 400);
      }

      roomNumber = parsed;
    }

    let rent = existing.rent;

    if (body.rent !== undefined) {
      const parsed = parsePositiveInt(body.rent);

      if (parsed === null) {
        return c.json(errorBody("VALIDATION", "ค่าเช่าต้องเป็นจำนวนเต็มมากกว่า 0", "rent"), 400);
      }

      rent = parsed;
    }

    let waterRate = existing.water_rate;

    if (body.waterRate !== undefined) {
      const parsed = parseOptionalPositive(body.waterRate);

      if (!parsed.valid) {
        return c.json(errorBody("VALIDATION", "อัตราค่าน้ำต้องเป็นตัวเลขมากกว่า 0", "waterRate"), 400);
      }

      waterRate = parsed.value;
    }

    let electricMode: ElectricMode = existing.electric_mode === "flat" ? "flat" : "meter";

    if (body.electricMode !== undefined) {
      const parsed = parseElectricMode(body.electricMode);

      if (parsed === null) {
        return c.json(errorBody("VALIDATION", "โหมดค่าไฟต้องเป็น meter หรือ flat", "electricMode"), 400);
      }

      electricMode = parsed;
    }

    let electricRate = existing.electric_rate;

    if (body.electricRate !== undefined) {
      const parsed = parseOptionalPositive(body.electricRate);

      if (!parsed.valid) {
        return c.json(errorBody("VALIDATION", "อัตราค่าไฟต้องเป็นตัวเลขมากกว่า 0", "electricRate"), 400);
      }

      electricRate = parsed.value;
    }

    let waterMeterInit = existing.water_meter_init;

    if (body.waterMeterInit !== undefined) {
      const parsed = parseNonNegative(body.waterMeterInit);

      if (parsed === null) {
        return c.json(errorBody("VALIDATION", "มิเตอร์น้ำเริ่มต้นต้องเป็นตัวเลขไม่ติดลบ", "waterMeterInit"), 400);
      }

      waterMeterInit = parsed;
    }

    let electricMeterInit = existing.electric_meter_init;

    if (body.electricMeterInit !== undefined) {
      const parsed = parseNonNegative(body.electricMeterInit);

      if (parsed === null) {
        return c.json(errorBody("VALIDATION", "มิเตอร์ไฟเริ่มต้นต้องเป็นตัวเลขไม่ติดลบ", "electricMeterInit"), 400);
      }

      electricMeterInit = parsed;
    }

    const storedElectricRate = electricMode === "flat" ? null : electricRate;

    const clash = await c.env.DB.prepare("SELECT id FROM rooms WHERE room_number = ? AND id != ?")
      .bind(roomNumber, id)
      .first<{ id: string }>();

    if (clash !== null) {
      return c.json(errorBody("DUPLICATE", "เลขห้องนี้ถูกใช้แล้ว", "roomNumber"), 409);
    }

    await c.env.DB.prepare(
      "UPDATE rooms SET room_number = ?, rent = ?, water_rate = ?, electric_mode = ?, electric_rate = ?, water_meter_init = ?, electric_meter_init = ? WHERE id = ?",
    )
      .bind(roomNumber, rent, waterRate, electricMode, storedElectricRate, waterMeterInit, electricMeterInit, id)
      .run();

    const row = await c.env.DB.prepare(`SELECT ${roomColumns} ${roomFrom} WHERE r.id = ?`).bind(id).first<RoomRow>();

    if (row === null) {
      console.error(JSON.stringify({ message: "update room readback failed", roomId: id }));
      return c.json(errorBody("INTERNAL", "บันทึกห้องไม่สำเร็จ"), 500);
    }

    return c.json({ ok: true, room: toRoom(row) }, 200);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ message: "update room failed", roomId: id, error: detail }));

    if (detail.includes("UNIQUE")) {
      return c.json(errorBody("DUPLICATE", "เลขห้องนี้ถูกใช้แล้ว", "roomNumber"), 409);
    }

    return c.json(errorBody("INTERNAL", "บันทึกห้องไม่สำเร็จ"), 500);
  }
});

export default rooms;
