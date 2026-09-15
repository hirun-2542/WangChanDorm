import { Hono } from "hono";
import { defaultElectricRate, defaultWaterRate } from "./settings";
import { asRecord, errorBody, readJsonObject } from "./shared";

const bills = new Hono<{ Bindings: Env }>();

type ElectricMode = "meter" | "flat";
type BillStatus = "paid" | "unpaid";

const periodPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

const billColumns =
  "b.id, b.room_id, r.room_number, b.tenant_id, t.full_name AS tenant_name, b.period, b.rent, b.water_previous, b.water_current, b.water_units, b.water_rate, b.water_amount, b.electric_mode, b.electric_previous, b.electric_current, b.electric_units, b.electric_rate, b.electric_amount, b.total, b.status, b.paid_at, b.paid_method, b.sent_at";

const billFrom = "FROM bills b JOIN rooms r ON r.id = b.room_id JOIN tenants t ON t.id = b.tenant_id";

const occupiedRoomColumns =
  "r.id AS room_id, r.room_number, r.rent, r.water_rate, r.electric_mode, r.electric_rate, r.water_meter_init, r.electric_meter_init, t.id AS tenant_id, t.full_name AS tenant_name";

const occupiedRoomFrom = "FROM rooms r JOIN tenants t ON t.room_id = r.id AND t.status = 'current'";

const insertBillSql =
  "INSERT INTO bills (id, room_id, tenant_id, period, rent, water_previous, water_current, water_units, water_rate, water_amount, electric_mode, electric_previous, electric_current, electric_units, electric_rate, electric_amount, total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

const insertChargeSql = "INSERT INTO bill_charges (id, bill_id, name, amount, position) VALUES (?, ?, ?, ?, ?)";

interface BillRow {
  id: string;
  room_id: string;
  room_number: string;
  tenant_id: string;
  tenant_name: string;
  period: string;
  rent: number;
  water_previous: number;
  water_current: number;
  water_units: number;
  water_rate: number;
  water_amount: number;
  electric_mode: string;
  electric_previous: number;
  electric_current: number;
  electric_units: number | null;
  electric_rate: number | null;
  electric_amount: number;
  total: number;
  status: string;
  paid_at: string | null;
  paid_method: string | null;
  sent_at: string | null;
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
  electricMode: ElectricMode;
  electricPrevious: number;
  electricCurrent: number;
  electricUnits: number | null;
  electricRate: number | null;
  electricAmount: number;
  charges: ChargePayload[];
  total: number;
  status: BillStatus;
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
  electricMode: ElectricMode;
  electricRate: number | null;
  waterPrevious: number;
  electricPrevious: number;
  existingBillId: string | null;
}

interface OccupiedRoomRow {
  room_id: string;
  room_number: string;
  rent: number;
  water_rate: number | null;
  electric_mode: string;
  electric_rate: number | null;
  water_meter_init: number;
  electric_meter_init: number;
  tenant_id: string;
  tenant_name: string;
}

interface LatestReadingRow {
  room_id: string;
  water_current: number;
  electric_current: number;
}

interface GenerateEntry {
  roomId: string;
  waterCurrent: number;
  electricCurrent: number;
  flatElectricAmount: number | null;
  charges: ChargePayload[];
}

type EntryParse = { ok: true; entry: GenerateEntry } | { ok: false; field: string; message: string };

function isPeriod(value: unknown): value is string {
  return typeof value === "string" && periodPattern.test(value);
}

function toElectricMode(value: string): ElectricMode {
  return value === "flat" ? "flat" : "meter";
}

function parseReading(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function parseCharges(value: unknown): ChargePayload[] | null {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const charges: ChargePayload[] = [];

  for (const item of value) {
    const record = asRecord(item);

    if (record === null) {
      return null;
    }

    const name = typeof record.name === "string" ? record.name.trim() : "";
    const amount = record.amount;

    if (name === "" || typeof amount !== "number" || !Number.isInteger(amount) || amount < 0) {
      return null;
    }

    charges.push({ name, amount });
  }

  return charges;
}

function parseEntry(raw: unknown): EntryParse {
  const record = asRecord(raw);

  if (record === null) {
    return { ok: false, field: "entries", message: "รายการห้องไม่ถูกต้อง" };
  }

  const roomId = typeof record.roomId === "string" ? record.roomId.trim() : "";

  if (roomId === "") {
    return { ok: false, field: "entries", message: "กรุณาระบุห้องในทุกรายการ" };
  }

  const waterCurrent = parseReading(record.waterCurrent);

  if (waterCurrent === null) {
    return { ok: false, field: "waterCurrent", message: "เลขมิเตอร์น้ำต้องเป็นตัวเลขไม่ติดลบ" };
  }

  const electricCurrent = parseReading(record.electricCurrent);

  if (electricCurrent === null) {
    return { ok: false, field: "electricCurrent", message: "เลขมิเตอร์ไฟต้องเป็นตัวเลขไม่ติดลบ" };
  }

  const charges = parseCharges(record.charges);

  if (charges === null) {
    return { ok: false, field: "charges", message: "ค่าใช้จ่ายเพิ่มเติมต้องมีชื่อและจำนวนเงินเป็นจำนวนเต็มไม่ติดลบ" };
  }

  const rawFlat = record.flatElectricAmount;
  let flatElectricAmount: number | null = null;

  if (rawFlat !== undefined && rawFlat !== null) {
    if (typeof rawFlat !== "number" || !Number.isFinite(rawFlat) || rawFlat < 0) {
      return { ok: false, field: "flatElectricAmount", message: "ยอดค่าไฟเหมาจ่ายต้องเป็นตัวเลขไม่ติดลบ" };
    }

    flatElectricAmount = rawFlat;
  }

  return { ok: true, entry: { roomId, waterCurrent, electricCurrent, flatElectricAmount, charges } };
}

function parseRate(key: string, value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);

  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  console.error(JSON.stringify({ message: "invalid stored setting", key, value }));
  return fallback;
}

async function loadEffectiveRates(env: Env): Promise<{ water: number; electric: number }> {
  const result = await env.DB.prepare(
    "SELECT key, value FROM settings WHERE key IN ('default_water_rate', 'default_electric_rate')",
  ).all<{ key: string; value: string }>();
  const stored = new Map(result.results.map((row) => [row.key, row.value]));

  return {
    water: parseRate("default_water_rate", stored.get("default_water_rate"), defaultWaterRate),
    electric: parseRate("default_electric_rate", stored.get("default_electric_rate"), defaultElectricRate),
  };
}

async function loadOccupiedRooms(env: Env): Promise<OccupiedRoomRow[]> {
  const result = await env.DB.prepare(`SELECT ${occupiedRoomColumns} ${occupiedRoomFrom} ORDER BY r.room_number ASC`).all<OccupiedRoomRow>();
  return result.results;
}

async function loadLatestReadings(env: Env, period: string): Promise<Map<string, LatestReadingRow>> {
  const result = await env.DB.prepare(
    `SELECT b.room_id, b.water_current, b.electric_current FROM bills b JOIN (SELECT room_id, MAX(period) AS period FROM bills WHERE period < ? GROUP BY room_id) latest ON latest.room_id = b.room_id AND latest.period = b.period`,
  )
    .bind(period)
    .all<LatestReadingRow>();

  return new Map(result.results.map((row) => [row.room_id, row]));
}

async function loadCharges(env: Env, period: string): Promise<Map<string, ChargePayload[]>> {
  const result = await env.DB.prepare(
    "SELECT bc.bill_id, bc.name, bc.amount FROM bill_charges bc JOIN bills b ON b.id = bc.bill_id WHERE b.period = ? ORDER BY bc.bill_id ASC, bc.position ASC",
  )
    .bind(period)
    .all<{ bill_id: string; name: string; amount: number }>();

  const grouped = new Map<string, ChargePayload[]>();

  for (const row of result.results) {
    const list = grouped.get(row.bill_id) ?? [];
    list.push({ name: row.name, amount: row.amount });
    grouped.set(row.bill_id, list);
  }

  return grouped;
}

function toBill(row: BillRow, charges: ChargePayload[]): BillPayload {
  return {
    id: row.id,
    roomId: row.room_id,
    roomNumber: row.room_number,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    period: row.period,
    rent: row.rent,
    waterPrevious: row.water_previous,
    waterCurrent: row.water_current,
    waterUnits: row.water_units,
    waterRate: row.water_rate,
    waterAmount: row.water_amount,
    electricMode: toElectricMode(row.electric_mode),
    electricPrevious: row.electric_previous,
    electricCurrent: row.electric_current,
    electricUnits: row.electric_units,
    electricRate: row.electric_rate,
    electricAmount: row.electric_amount,
    charges,
    total: row.total,
    status: row.status === "paid" ? "paid" : "unpaid",
    paidAt: row.paid_at,
    paidMethod: row.paid_method,
    sentAt: row.sent_at,
  };
}

async function loadBills(env: Env, period: string): Promise<BillPayload[]> {
  const result = await env.DB.prepare(`SELECT ${billColumns} ${billFrom} WHERE b.period = ? ORDER BY r.room_number ASC`)
    .bind(period)
    .all<BillRow>();
  const charges = await loadCharges(env, period);

  return result.results.map((row) => toBill(row, charges.get(row.id) ?? []));
}

function roomLabel(rooms: Map<string, OccupiedRoomRow>, roomId: string): string {
  return rooms.get(roomId)?.room_number ?? roomId;
}

bills.get("/", async (c) => {
  const period = c.req.query("period") ?? "";

  if (!isPeriod(period)) {
    return c.json(errorBody("VALIDATION", "เดือนต้องอยู่ในรูปแบบ YYYY-MM", "period"), 400);
  }

  try {
    const list = await loadBills(c.env, period);
    return c.json({ ok: true, period, bills: list }, 200);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ message: "list bills failed", period, error: detail }));
    return c.json(errorBody("INTERNAL", "โหลดข้อมูลบิลไม่สำเร็จ"), 500);
  }
});

bills.get("/meter-sheet", async (c) => {
  const period = c.req.query("period") ?? "";

  if (!isPeriod(period)) {
    return c.json(errorBody("VALIDATION", "เดือนต้องอยู่ในรูปแบบ YYYY-MM", "period"), 400);
  }

  try {
    const rates = await loadEffectiveRates(c.env);
    const occupied = await loadOccupiedRooms(c.env);
    const latest = await loadLatestReadings(c.env, period);
    const existing = await c.env.DB.prepare("SELECT id, room_id FROM bills WHERE period = ?")
      .bind(period)
      .all<{ id: string; room_id: string }>();
    const existingByRoom = new Map(existing.results.map((row) => [row.room_id, row.id]));

    const rows: MeterRowPayload[] = occupied.map((room) => {
      const previous = latest.get(room.room_id);
      const mode = toElectricMode(room.electric_mode);

      return {
        roomId: room.room_id,
        roomNumber: room.room_number,
        tenantId: room.tenant_id,
        tenantName: room.tenant_name,
        rent: room.rent,
        waterRate: room.water_rate ?? rates.water,
        electricMode: mode,
        electricRate: mode === "flat" ? null : (room.electric_rate ?? rates.electric),
        waterPrevious: previous?.water_current ?? room.water_meter_init,
        electricPrevious: previous?.electric_current ?? room.electric_meter_init,
        existingBillId: existingByRoom.get(room.room_id) ?? null,
      };
    });

    return c.json({ ok: true, period, rows }, 200);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ message: "load meter sheet failed", period, error: detail }));
    return c.json(errorBody("INTERNAL", "โหลดข้อมูลมิเตอร์ไม่สำเร็จ"), 500);
  }
});

bills.post("/generate", async (c) => {
  const body = await readJsonObject(c.req.raw);

  if (body === null) {
    return c.json(errorBody("VALIDATION", "รูปแบบข้อมูลไม่ถูกต้อง"), 400);
  }

  const period = body.period;

  if (!isPeriod(period)) {
    return c.json(errorBody("VALIDATION", "เดือนต้องอยู่ในรูปแบบ YYYY-MM", "period"), 400);
  }

  const rawEntries = body.entries;

  if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
    return c.json(errorBody("VALIDATION", "กรุณาส่งรายการห้องที่จะออกบิล", "entries"), 400);
  }

  const entries: GenerateEntry[] = [];

  for (const raw of rawEntries) {
    const parsed = parseEntry(raw);

    if (!parsed.ok) {
      return c.json(errorBody("VALIDATION", parsed.message, parsed.field), 400);
    }

    entries.push(parsed.entry);
  }

  try {
    const rates = await loadEffectiveRates(c.env);
    const occupiedById = new Map((await loadOccupiedRooms(c.env)).map((room) => [room.room_id, room]));

    const seen = new Set<string>();
    const repeated: string[] = [];

    for (const entry of entries) {
      if (seen.has(entry.roomId)) {
        repeated.push(roomLabel(occupiedById, entry.roomId));
      }

      seen.add(entry.roomId);
    }

    if (repeated.length > 0) {
      return c.json(errorBody("VALIDATION", `มีห้องซ้ำในรายการ: ${repeated.join(", ")}`, "entries"), 400);
    }

    const unknownRooms: string[] = [];
    const vacantRooms: string[] = [];

    for (const entry of entries) {
      if (occupiedById.has(entry.roomId)) {
        continue;
      }

      const room = await c.env.DB.prepare("SELECT room_number FROM rooms WHERE id = ?")
        .bind(entry.roomId)
        .first<{ room_number: string }>();

      if (room === null) {
        unknownRooms.push(entry.roomId);
      } else {
        vacantRooms.push(room.room_number);
      }
    }

    if (unknownRooms.length > 0) {
      return c.json(errorBody("VALIDATION", `ไม่พบห้องในรายการ: ${unknownRooms.join(", ")}`, "entries"), 400);
    }

    if (vacantRooms.length > 0) {
      return c.json(errorBody("VALIDATION", `ออกบิลได้เฉพาะห้องที่มีผู้เช่า: ${vacantRooms.join(", ")}`, "entries"), 400);
    }

    const billed = await c.env.DB.prepare("SELECT room_id FROM bills WHERE period = ?")
      .bind(period)
      .all<{ room_id: string }>();
    const billedRoomIds = new Set(billed.results.map((row) => row.room_id));
    const conflicts = entries.filter((entry) => billedRoomIds.has(entry.roomId)).map((entry) => roomLabel(occupiedById, entry.roomId));

    if (conflicts.length > 0) {
      return c.json(errorBody("CONFLICT", `เดือนนี้มีบิลแล้ว: ${conflicts.join(", ")}`, "entries"), 409);
    }

    const latest = await loadLatestReadings(c.env, period);
    const paired = entries
      .map((entry) => ({ entry, room: occupiedById.get(entry.roomId) }))
      .filter((item): item is { entry: GenerateEntry; room: OccupiedRoomRow } => item.room !== undefined);

    const statements: D1PreparedStatement[] = [];
    const createdIds: string[] = [];

    for (const item of paired) {
      const room = item.room;
      const entry = item.entry;
      const previousWater = latest.get(room.room_id)?.water_current ?? room.water_meter_init;
      const previousElectric = latest.get(room.room_id)?.electric_current ?? room.electric_meter_init;

      if (entry.waterCurrent < previousWater) {
        return c.json(errorBody("VALIDATION", `เลขมิเตอร์น้ำต้องไม่น้อยกว่าครั้งก่อน (ห้อง ${room.room_number})`, "waterCurrent"), 400);
      }

      if (entry.electricCurrent < previousElectric) {
        return c.json(errorBody("VALIDATION", `เลขมิเตอร์ไฟต้องไม่น้อยกว่าครั้งก่อน (ห้อง ${room.room_number})`, "electricCurrent"), 400);
      }

      const mode = toElectricMode(room.electric_mode);
      const waterUnits = entry.waterCurrent - previousWater;
      const waterRate = room.water_rate ?? rates.water;
      const waterAmount = Math.round(waterUnits * waterRate);
      let electricUnits: number | null = null;
      let electricRate: number | null = null;
      let electricAmount = 0;

      if (mode === "flat") {
        if (entry.flatElectricAmount === null) {
          return c.json(errorBody("VALIDATION", `กรุณากรอกยอดค่าไฟเหมาจ่าย (ห้อง ${room.room_number})`, "flatElectricAmount"), 400);
        }

        electricAmount = Math.round(entry.flatElectricAmount);
      } else {
        electricUnits = entry.electricCurrent - previousElectric;
        electricRate = room.electric_rate ?? rates.electric;
        electricAmount = Math.round(electricUnits * electricRate);
      }

      const chargeTotal = entry.charges.reduce((sum, charge) => sum + charge.amount, 0);
      const total = room.rent + waterAmount + electricAmount + chargeTotal;
      const id = crypto.randomUUID();

      createdIds.push(id);
      statements.push(
        c.env.DB.prepare(insertBillSql).bind(
          id,
          room.room_id,
          room.tenant_id,
          period,
          room.rent,
          previousWater,
          entry.waterCurrent,
          waterUnits,
          waterRate,
          waterAmount,
          mode,
          previousElectric,
          entry.electricCurrent,
          electricUnits,
          electricRate,
          electricAmount,
          total,
        ),
      );

      entry.charges.forEach((charge, index) => {
        statements.push(c.env.DB.prepare(insertChargeSql).bind(crypto.randomUUID(), id, charge.name, charge.amount, index));
      });
    }

    await c.env.DB.batch(statements);

    const createdIdSet = new Set(createdIds);
    const created = (await loadBills(c.env, period)).filter((bill) => createdIdSet.has(bill.id));

    return c.json({ ok: true, bills: created }, 201);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ message: "generate bills failed", period, error: detail }));

    if (detail.includes("UNIQUE") && detail.includes("bills")) {
      return c.json(errorBody("CONFLICT", `เดือนนี้มีบิลแล้ว: ${period}`, "entries"), 409);
    }

    return c.json(errorBody("INTERNAL", "สร้างบิลไม่สำเร็จ"), 500);
  }
});

export default bills;
