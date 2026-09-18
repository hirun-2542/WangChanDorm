#!/usr/bin/env node
// Reads the owner's public dorm Google Sheet over the network and emits SQL for the
// wangchan-dorm D1 schema, plus a verification report on stdout.
//
//   node scripts/import-dorm-sheet.mjs [--out seed/live/import.sql]
//
// The output file contains real tenant data and must stay in the gitignored seed/live/.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const OUT_DEFAULT = "seed/live/import.sql";

const TAB_TENANTS = "ข้อมูลผู้เช่า";
const TAB_CONFIG = "Config";
const TAB_METERS = "มิเตอร์เริ่มต้น";
const TAB_FORM = "การตอบแบบฟอร์ม 2";
const TAB_INVOICES = "Invoice_History";

// ---------------------------------------------------------------- CSV parsing

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

async function fetchTab(name) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(name)}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`failed to fetch tab "${name}": HTTP ${response.status}`);
  }

  return parseCsv(await response.text());
}

// ------------------------------------------------------------ value coercion

function toNumber(raw) {
  if (raw === undefined || raw === null) {
    return null;
  }

  const cleaned = String(raw).replace(/฿/g, "").replace(/,/g, "").replace(/\s+/g, "");
  if (cleaned === "") {
    return null;
  }

  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function isInt(value) {
  return typeof value === "number" && Number.isInteger(value);
}

function normalizePhone(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "");

  if (digits.length === 10 && digits[0] === "0") {
    return digits;
  }

  if (digits.length === 9) {
    return `0${digits}`;
  }

  return digits;
}

function parseThaiDateTime(raw) {
  const match = String(raw ?? "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);

  if (match === null) {
    return null;
  }

  const pad = (value) => String(value).padStart(2, "0");
  const [, day, month, year, hour = "0", minute = "0", second = "0"] = match;
  const date = `${year}-${pad(month)}-${pad(day)}`;

  return { date, iso: `${date}T${pad(hour)}:${pad(minute)}:${pad(second)}+07:00` };
}

function periodFromMonthYear(raw) {
  const match = String(raw ?? "").trim().match(/^(\d{1,2})\/(\d{4})$/);
  return match === null ? null : `${match[2]}-${match[1].padStart(2, "0")}`;
}

function naturalCompare(a, b) {
  const pa = a.split(/(\d+)/).filter((part) => part !== "");
  const pb = b.split(/(\d+)/).filter((part) => part !== "");
  const length = Math.max(pa.length, pb.length);

  for (let i = 0; i < length; i += 1) {
    const left = pa[i];
    const right = pb[i];

    if (left === undefined) {
      return -1;
    }

    if (right === undefined) {
      return 1;
    }

    if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
      const diff = Number(left) - Number(right);
      if (diff !== 0) {
        return diff;
      }
    } else if (left !== right) {
      return left < right ? -1 : 1;
    }
  }

  return 0;
}

// ------------------------------------------------------------ table helpers

function indexOfColumn(header, matcher) {
  for (let i = 0; i < header.length; i += 1) {
    if (matcher(header[i].trim())) {
      return i;
    }
  }

  throw new Error(`column not found in header: ${header.join(" | ")}`);
}

function makeGetter(header, matcher) {
  const index = indexOfColumn(header, matcher);

  return (row) => row[index] ?? "";
}

function splitTable(rows) {
  if (rows.length === 0) {
    throw new Error("tab has no rows");
  }

  const [header, ...body] = rows;
  return { header, body };
}

// ------------------------------------------------------------ deterministic ids

function deterministicUuid(...parts) {
  const hex = createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20, 32)}`;
}

// ------------------------------------------------------------ sql helpers

function sqlText(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlNum(value) {
  if (value === null || value === undefined) {
    return "NULL";
  }

  if (!Number.isFinite(value)) {
    throw new Error(`not a finite number: ${value}`);
  }

  return String(value);
}

// ------------------------------------------------------------ model building

const chargeOrder = [
  { name: "ค่าบริการ", key: "service" },
  { name: "ค่าขยะ", key: "trash" },
  { name: "ค่าไวไฟ", key: "wifi" },
];

async function build() {
  const [tenantRows, configRows, meterRows, formRows, invoiceRows] = await Promise.all([
    fetchTab(TAB_TENANTS),
    fetchTab(TAB_CONFIG),
    fetchTab(TAB_METERS),
    fetchTab(TAB_FORM),
    fetchTab(TAB_INVOICES),
  ]);

  const problems = [];

  // --- Config -------------------------------------------------------------
  function configValue(label) {
    for (const row of configRows) {
      const index = row.findIndex((cell) => cell.trim() === label);

      if (index === -1) {
        continue;
      }

      for (let i = index + 1; i < row.length; i += 1) {
        const value = toNumber(row[i]);
        if (value !== null) {
          return value;
        }
      }
    }

    return null;
  }

  const waterRate = configValue("ราคาค่าน้ำต่อหน่วย");
  const electricRate = configValue("ราคาค่าไฟต่อหน่วย");

  if (waterRate === null || electricRate === null) {
    throw new Error("Config tab is missing ราคาค่าน้ำต่อหน่วย / ราคาค่าไฟต่อหน่วย");
  }

  // --- Rooms / tenants ----------------------------------------------------
  const tenantsTab = splitTable(tenantRows);
  const colRoomNumber = makeGetter(tenantsTab.header, (h) => h === "เลขห้อง");
  const colRent = makeGetter(tenantsTab.header, (h) => h === "ค่าห้อง");
  const colName = makeGetter(tenantsTab.header, (h) => h === "ชื่อผู้เช่า");
  const colPhone = makeGetter(tenantsTab.header, (h) => h === "เบอร์โทร");
  const colLine = makeGetter(tenantsTab.header, (h) => h === "Line Token");

  const rooms = new Map();

  for (const row of tenantsTab.body) {
    const roomNumber = String(colRoomNumber(row)).trim();
    if (roomNumber === "") {
      continue;
    }

    const rent = toNumber(colRent(row));

    if (!isInt(rent) || rent <= 0) {
      problems.push(`room ${roomNumber}: rent is not a positive integer (${JSON.stringify(colRent(row))})`);
      continue;
    }

    rooms.set(roomNumber, {
      roomNumber,
      rent,
      name: String(colName(row)).trim(),
      phoneRaw: String(colPhone(row)).trim(),
      phone: normalizePhone(colPhone(row)),
      lineUserId: String(colLine(row)).trim(),
      waterInit: null,
      electricInit: null,
      flat: false,
    });
  }

  for (const room of rooms.values()) {
    room.occupied = room.name !== "";
    room.status = room.occupied ? "occupied" : "vacant";
  }

  // --- Starting meters ----------------------------------------------------
  const metersTab = splitTable(meterRows);
  const colMeterRoom = makeGetter(metersTab.header, (h) => h === "เลขห้อง");
  const colMeterWater = makeGetter(metersTab.header, (h) => h === "มิเตอร์น้ำ");
  const colMeterElectric = makeGetter(metersTab.header, (h) => h === "มิเตอร์ไฟ");

  const meterRooms = new Set();

  for (const row of metersTab.body) {
    const roomNumber = String(colMeterRoom(row)).trim();
    if (roomNumber === "") {
      continue;
    }

    meterRooms.add(roomNumber);
    const room = rooms.get(roomNumber);

    if (room === undefined) {
      problems.push(`มิเตอร์เริ่มต้น has room ${roomNumber} that is absent from ${TAB_TENANTS}`);
      continue;
    }

    room.waterInit = toNumber(colMeterWater(row));
    room.electricInit = toNumber(colMeterElectric(row));
  }

  const missingMeterRooms = [];

  for (const room of rooms.values()) {
    if (!meterRooms.has(room.roomNumber)) {
      problems.push(`room ${room.roomNumber} has no row in ${TAB_METERS}`);
      missingMeterRooms.push(room.roomNumber);
    }

    if (room.waterInit === null || room.electricInit === null) {
      problems.push(`room ${room.roomNumber}: starting meter reading is missing in ${TAB_METERS}`);
      missingMeterRooms.push(room.roomNumber);
      room.waterInit = room.waterInit ?? 0;
      room.electricInit = room.electricInit ?? 0;
    }
  }

  // --- Monthly form (flat electric derivation + flat amounts) --------------
  const formTab = splitTable(formRows);
  const colFormTimestamp = makeGetter(formTab.header, (h) => h === "ประทับเวลา");
  const colFormRoom = makeGetter(formTab.header, (h) => h === "เลขห้อง");
  const colFormFlat = makeGetter(formTab.header, (h) => h.startsWith("ค่าไฟจริง"));

  const flatRooms = new Set();
  const formFlatByRoomPeriod = new Map();
  let formRowCount = 0;

  for (const row of formTab.body) {
    const roomNumber = String(colFormRoom(row)).trim();
    const timestamp = String(colFormTimestamp(row)).trim();

    if (roomNumber === "" || timestamp === "") {
      continue;
    }

    formRowCount += 1;

    if (!rooms.has(roomNumber)) {
      problems.push(`${TAB_FORM} has room ${roomNumber} that is absent from ${TAB_TENANTS}`);
    }

    const flatRaw = String(colFormFlat(row)).trim();
    const flatAmount = flatRaw === "" ? null : toNumber(flatRaw);

    if (flatAmount !== null) {
      flatRooms.add(roomNumber);
    }

    const parsed = parseThaiDateTime(timestamp);

    if (parsed !== null) {
      formFlatByRoomPeriod.set(`${roomNumber}|${parsed.date.slice(0, 7)}`, flatAmount);
    }
  }

  for (const room of rooms.values()) {
    room.flat = flatRooms.has(room.roomNumber);
  }

  // --- Invoices -----------------------------------------------------------
  const invoicesTab = splitTable(invoiceRows);
  const colInvTimestamp = makeGetter(invoicesTab.header, (h) => h === "Timestamp");
  const colInvRoom = makeGetter(invoicesTab.header, (h) => h === "Room No");
  const colInvNumber = makeGetter(invoicesTab.header, (h) => h === "Invoice No");
  const colInvMonthYear = makeGetter(invoicesTab.header, (h) => h === "Month Year");
  const colInvWaterBefore = makeGetter(invoicesTab.header, (h) => h === "Water Meter Before");
  const colInvWaterNow = makeGetter(invoicesTab.header, (h) => h === "Water Meter Now");
  const colInvWaterUnits = makeGetter(invoicesTab.header, (h) => h === "Water Unit Use");
  const colInvWaterPrice = makeGetter(invoicesTab.header, (h) => h === "Water Price");
  const colInvElecBefore = makeGetter(invoicesTab.header, (h) => h === "Elec Meter Before");
  const colInvElecNow = makeGetter(invoicesTab.header, (h) => h === "Elec Meter Now");
  const colInvElecUnits = makeGetter(invoicesTab.header, (h) => h === "Elec Unit Use");
  const colInvElecPrice = makeGetter(invoicesTab.header, (h) => h === "Elec Price");
  const colInvRoomFee = makeGetter(invoicesTab.header, (h) => h === "Room Fee");
  const colInvService = makeGetter(invoicesTab.header, (h) => h === "Service Fee");
  const colInvTrash = makeGetter(invoicesTab.header, (h) => h === "Trash Fee");
  const colInvWifi = makeGetter(invoicesTab.header, (h) => h === "Wifi Fee");
  const colInvTotal = makeGetter(invoicesTab.header, (h) => h === "Total Price");

  const invoices = [];

  for (const row of invoicesTab.body) {
    const roomNumber = String(colInvRoom(row)).trim();
    const monthYear = String(colInvMonthYear(row)).trim();
    const period = periodFromMonthYear(monthYear);
    const parsed = parseThaiDateTime(String(colInvTimestamp(row)).trim());

    const invoice = {
      roomNumber,
      invoiceNo: String(colInvNumber(row)).trim(),
      period,
      timestampRaw: String(colInvTimestamp(row)).trim(),
      timestamp: parsed,
      waterPrevious: toNumber(colInvWaterBefore(row)),
      waterCurrent: toNumber(colInvWaterNow(row)),
      waterUnits: toNumber(colInvWaterUnits(row)),
      waterPrice: toNumber(colInvWaterPrice(row)),
      electricPrevious: toNumber(colInvElecBefore(row)),
      electricCurrent: toNumber(colInvElecNow(row)),
      electricUnits: toNumber(colInvElecUnits(row)),
      electricPrice: toNumber(colInvElecPrice(row)),
      rent: toNumber(colInvRoomFee(row)),
      service: toNumber(colInvService(row)),
      trash: toNumber(colInvTrash(row)),
      wifi: toNumber(colInvWifi(row)),
      total: toNumber(colInvTotal(row)),
    };

    invoice.room = rooms.get(roomNumber) ?? null;

    if (invoice.room === null) {
      problems.push(`invoice ${invoice.invoiceNo || invoice.timestampRaw} references room ${roomNumber} absent from ${TAB_TENANTS}`);
    }

    if (period === null) {
      problems.push(`invoice ${invoice.invoiceNo || invoice.timestampRaw}: unparseable Month Year ${JSON.stringify(monthYear)}`);
    }

    if (parsed === null) {
      problems.push(`invoice ${invoice.invoiceNo || "?"}: unparseable Timestamp ${JSON.stringify(invoice.timestampRaw)}`);
    }

    invoices.push(invoice);
  }

  // ---------------------------------------------------- verification checks
  const nonNumeric = [];
  const unbalanced = [];

  for (const invoice of invoices) {
    const components = {
      "Room Fee": invoice.rent,
      "Water Price": invoice.waterPrice,
      "Elec Price": invoice.electricPrice,
      "Service Fee": invoice.service,
      "Trash Fee": invoice.trash,
      "Wifi Fee": invoice.wifi,
      "Total Price": invoice.total,
    };

    const bad = Object.entries(components).filter(([, value]) => value === null).map(([key]) => key);

    if (bad.length > 0) {
      nonNumeric.push({ invoice, fields: bad });
      continue;
    }

    const sum = invoice.rent + invoice.waterPrice + invoice.electricPrice + invoice.service + invoice.trash + invoice.wifi;

    if (sum !== invoice.total) {
      unbalanced.push({ invoice, sum });
    }
  }

  // phone normalisation vs the tenant sheet
  const colInvPhone = makeGetter(invoicesTab.header, (h) => h === "Phone");
  const phoneIssues = [];
  let phoneMatches = 0;
  let phonePadded = 0;

  for (let i = 0; i < invoices.length; i += 1) {
    const invoice = invoices[i];

    if (invoice.room === null) {
      continue;
    }

    const invoiceRawDigits = String(colInvPhone(invoicesTab.body[i])).replace(/\D/g, "");

    if (invoiceRawDigits.length === 9) {
      phonePadded += 1;
    }

    const invoicePhone = normalizePhone(colInvPhone(invoicesTab.body[i]));
    const tenantPhone = invoice.room.phone;

    if (invoicePhone === tenantPhone && /^0\d{9}$/.test(invoicePhone)) {
      phoneMatches += 1;
    } else {
      phoneIssues.push(`room ${invoice.roomNumber} period ${invoice.period}: invoice phone does not normalise to the tenant phone (${invoicePhone.length} vs ${tenantPhone.length} digits)`);
    }
  }

  // line id shape
  const lineIdIssues = [];
  const lineIds = new Set();

  for (const room of rooms.values()) {
    if (!room.occupied) {
      continue;
    }

    if (!/^U[0-9a-fA-F]{32}$/.test(room.lineUserId)) {
      lineIdIssues.push(`room ${room.roomNumber}: LINE user id is not a 33-char U-id`);
    } else if (lineIds.has(room.lineUserId)) {
      lineIdIssues.push(`room ${room.roomNumber}: duplicated LINE user id`);
    }

    lineIds.add(room.lineUserId);
  }

  // metered rate checks
  const waterMismatches = [];
  const electricMismatches = [];
  const flatChecks = [];
  const flatMismatches = [];
  const flatFractional = [];

  for (const invoice of invoices) {
    if (invoice.room === null) {
      continue;
    }

    // water: every room is water-metered
    if (invoice.waterUnits !== null && invoice.waterPrice !== null) {
      const expected = invoice.waterUnits * waterRate;

      if (Math.abs(invoice.waterPrice - expected) > 0.01) {
        waterMismatches.push({ invoice, expected });
      }
    }

    if (invoice.room.flat) {
      const flatAmount = formFlatByRoomPeriod.get(`${invoice.roomNumber}|${invoice.period}`);

      if (flatAmount === undefined || flatAmount === null) {
        flatMismatches.push({ invoice, flatAmount: null });
        continue;
      }

      if (!Number.isInteger(flatAmount)) {
        flatFractional.push({ invoice, flatAmount });
      }

      flatChecks.push(invoice);

      if (Math.round(flatAmount) !== Math.round(invoice.electricPrice)) {
        flatMismatches.push({ invoice, flatAmount });
      }
    } else if (invoice.electricUnits !== null && invoice.electricPrice !== null) {
      const expected = invoice.electricUnits * electricRate;

      if (Math.abs(invoice.electricPrice - expected) > 0.01) {
        electricMismatches.push({ invoice, expected });
      }
    }
  }

  // starting meter vs earliest invoice (supplementary)
  const startMeterIssues = [];
  const earliestByRoom = new Map();

  for (const invoice of invoices) {
    if (invoice.timestamp === null) {
      continue;
    }

    const current = earliestByRoom.get(invoice.roomNumber);

    if (current === undefined || invoice.timestamp.date < current.timestamp.date) {
      earliestByRoom.set(invoice.roomNumber, invoice);
    }
  }

  for (const [roomNumber, invoice] of earliestByRoom) {
    const room = rooms.get(roomNumber);

    if (room === undefined) {
      continue;
    }

    if (invoice.waterPrevious !== room.waterInit) {
      startMeterIssues.push(`room ${roomNumber}: first invoice water previous ${invoice.waterPrevious} != มิเตอร์เริ่มต้น ${room.waterInit}`);
    }

    if (invoice.electricPrevious !== room.electricInit) {
      startMeterIssues.push(`room ${roomNumber}: first invoice electric previous ${invoice.electricPrevious} != มิเตอร์เริ่มต้น ${room.electricInit}`);
    }
  }

  // ---------------------------------------------------- extras per room
  const roomChargeInconsistent = [];

  for (const room of rooms.values()) {
    const roomInvoices = invoices
      .filter((invoice) => invoice.roomNumber === room.roomNumber)
      .sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));

    room.charges = [];

    for (const def of chargeOrder) {
      const values = roomInvoices
        .map((invoice) => invoice[def.key])
        .filter((value) => typeof value === "number" && Number.isFinite(value));

      if (values.length === 0) {
        continue;
      }

      const distinct = [...new Set(values)];

      if (distinct.length > 1) {
        roomChargeInconsistent.push(`room ${room.roomNumber}: ${def.name} changed over time ${JSON.stringify(distinct)} (using the latest)`);
      }

      const amount = values[values.length - 1];

      if (amount > 0) {
        room.charges.push({ name: def.name, amount });
      }
    }
  }

  // ---------------------------------------------------- identifiers
  for (const room of rooms.values()) {
    room.id = deterministicUuid("wangchan-dorm-import", "room", room.roomNumber);
  }

  for (const room of rooms.values()) {
    if (!room.occupied) {
      continue;
    }

    const earliest = earliestByRoom.get(room.roomNumber);
    room.checkInDate = earliest !== undefined && earliest.timestamp !== null ? earliest.timestamp.date : null;
    room.tenantId = deterministicUuid("wangchan-dorm-import", "tenant", room.roomNumber);
  }

  for (const invoice of invoices) {
    invoice.id = deterministicUuid("wangchan-dorm-import", "bill", invoice.invoiceNo || `${invoice.roomNumber}|${invoice.period}`);
    invoice.chargeRows = chargeOrder
      .map((def, index) => ({ name: def.name, amount: invoice[def.key], position: index }))
      .filter((charge) => typeof charge.amount === "number" && Number.isFinite(charge.amount) && charge.amount > 0)
      .map((charge) => ({
        ...charge,
        id: deterministicUuid("wangchan-dorm-import", "bill-charge", invoice.invoiceNo || `${invoice.roomNumber}|${invoice.period}`, charge.name),
      }));
  }

  return {
    problems,
    waterRate,
    electricRate,
    rooms,
    invoices,
    formRowCount,
    missingMeterRooms,
    nonNumeric,
    unbalanced,
    phoneMatches,
    phonePadded,
    phoneIssues,
    lineIdIssues,
    waterMismatches,
    electricMismatches,
    flatChecks,
    flatMismatches,
    flatFractional,
    startMeterIssues,
    roomChargeInconsistent,
    flatRooms,
  };
}

// ------------------------------------------------------------ sql emission

function buildSql(model) {
  const lines = [];

  lines.push(`-- Dorm data imported from Google Sheet ${SHEET_ID}.`);
  lines.push(`-- Source tabs: ${TAB_TENANTS}, ${TAB_CONFIG}, ${TAB_METERS}, ${TAB_FORM}, ${TAB_INVOICES}.`);

  // foreign-key-safe wipe
  for (const table of ["bill_charges", "bills", "slips", "tenants", "room_charges", "rooms", "line_pending"]) {
    lines.push(`DELETE FROM ${table};`);
  }

  const sortedRooms = [...model.rooms.values()].sort((a, b) => naturalCompare(a.roomNumber, b.roomNumber));

  for (const room of sortedRooms) {
    lines.push(
      "INSERT INTO rooms (id, room_number, rent, water_rate, electric_mode, electric_rate, water_meter_init, electric_meter_init, status) VALUES (" +
        [
          sqlText(room.id),
          sqlText(room.roomNumber),
          sqlNum(room.rent),
          "NULL",
          sqlText(room.flat ? "flat" : "meter"),
          "NULL",
          sqlNum(room.waterInit),
          sqlNum(room.electricInit),
          sqlText(room.status),
        ].join(", ") +
        ");",
    );
  }

  for (const room of sortedRooms) {
    if (!room.occupied) {
      continue;
    }

    lines.push(
      "INSERT INTO tenants (id, full_name, phone, room_id, check_in_date, check_out_date, line_user_id, status) VALUES (" +
        [
          sqlText(room.tenantId),
          sqlText(room.name),
          sqlText(room.phone),
          sqlText(room.id),
          sqlText(room.checkInDate),
          "NULL",
          room.lineUserId === "" ? "NULL" : sqlText(room.lineUserId),
          "'current'",
        ].join(", ") +
        ");",
    );
  }

  for (const room of sortedRooms) {
    room.charges.forEach((charge, position) => {
      const id = deterministicUuid("wangchan-dorm-import", "room-charge", room.roomNumber, charge.name);
      lines.push(
        "INSERT INTO room_charges (id, room_id, name, amount, position) VALUES (" +
          [sqlText(id), sqlText(room.id), sqlText(charge.name), sqlNum(charge.amount), sqlNum(position)].join(", ") +
          ");",
      );
    });
  }

  const sortedInvoices = [...model.invoices].sort((a, b) => {
    if (a.period !== b.period) {
      return a.period < b.period ? -1 : 1;
    }

    return naturalCompare(a.roomNumber, b.roomNumber);
  });

  for (const invoice of sortedInvoices) {
    const room = invoice.room;
    const tenantId = room === null || room.tenantId === undefined ? null : room.tenantId;
    const flat = room !== null && room.flat;

    lines.push(
      "INSERT INTO bills (id, room_id, tenant_id, period, rent, water_previous, water_current, water_units, water_rate, water_amount, electric_mode, electric_previous, electric_current, electric_units, electric_rate, electric_amount, total, status, paid_at, paid_method, sent_at) VALUES (" +
        [
          sqlText(invoice.id),
          room === null ? "NULL" : sqlText(room.id),
          tenantId === null ? "NULL" : sqlText(tenantId),
          sqlText(invoice.period),
          sqlNum(invoice.rent),
          sqlNum(invoice.waterPrevious),
          sqlNum(invoice.waterCurrent),
          sqlNum(invoice.waterUnits),
          sqlNum(model.waterRate),
          sqlNum(invoice.waterPrice),
          sqlText(flat ? "flat" : "meter"),
          sqlNum(invoice.electricPrevious),
          sqlNum(invoice.electricCurrent),
          flat ? "NULL" : sqlNum(invoice.electricUnits),
          flat ? "NULL" : sqlNum(model.electricRate),
          sqlNum(invoice.electricPrice),
          sqlNum(invoice.total),
          "'paid'",
          invoice.timestamp === null ? "NULL" : sqlText(invoice.timestamp.iso),
          "'transfer'",
          "NULL",
        ].join(", ") +
        ");",
    );

    for (const charge of invoice.chargeRows) {
      lines.push(
        "INSERT INTO bill_charges (id, bill_id, name, amount, position) VALUES (" +
          [sqlText(charge.id), sqlText(invoice.id), sqlText(charge.name), sqlNum(charge.amount), sqlNum(charge.position)].join(", ") +
          ");",
      );
    }
  }

  for (const [key, value] of [
    ["default_water_rate", model.waterRate],
    ["default_electric_rate", model.electricRate],
  ]) {
    lines.push(
      `INSERT INTO settings (key, value, updated_at) VALUES (${sqlText(key)}, ${sqlText(String(value))}, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`,
    );
  }

  return lines;
}

// ------------------------------------------------------------ report

function formatBaht(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function printReport(model, statementCount, outPath) {
  const out = [];
  const rooms = [...model.rooms.values()].sort((a, b) => naturalCompare(a.roomNumber, b.roomNumber));
  const occupied = rooms.filter((room) => room.occupied);
  const vacant = rooms.filter((room) => !room.occupied);
  const flat = rooms.filter((room) => room.flat);
  const metered = rooms.filter((room) => !room.flat);

  out.push("Dorm sheet import - verification report");
  out.push(`source: Google Sheet ${SHEET_ID}`);
  out.push("");

  out.push("Tabs read");
  out.push(`  ${TAB_TENANTS}: ${rooms.length} rooms`);
  out.push(`  ${TAB_CONFIG}: water ${model.waterRate} / electric ${model.electricRate} baht per unit`);
  out.push(`  ${TAB_METERS}: ${rooms.length} rooms`);
  out.push(`  ${TAB_FORM}: ${model.formRowCount} submission rows`);
  out.push(`  ${TAB_INVOICES}: ${model.invoices.length} invoices`);
  out.push("");

  out.push(`Rooms: ${rooms.length} (occupied ${occupied.length}, vacant ${vacant.length})`);
  out.push(`  vacant rooms: ${vacant.map((room) => room.roomNumber).join(", ") || "-"}`);
  out.push(`  flat electric (derived from ค่าไฟจริง): ${flat.length} [${flat.map((room) => room.roomNumber).join(", ")}]`);
  out.push(`  metered electric: ${metered.length} [${metered.map((room) => room.roomNumber).join(", ")}]`);
  out.push(`  rooms with recurring charges derived from invoices: ${rooms.filter((room) => room.charges.length > 0).length}`);
  out.push("");

  out.push("Cross-checks");
  out.push(`  rooms missing from ${TAB_METERS}: ${model.missingMeterRooms.length}${model.missingMeterRooms.length > 0 ? ` [${model.missingMeterRooms.join(", ")}]` : ""}`);
  const unknownRoomInvoices = model.invoices.filter((invoice) => invoice.room === null).length;
  out.push(`  invoices whose room is absent from ${TAB_TENANTS}: ${unknownRoomInvoices}`);
  out.push(`  phones normalised to the tenant's 10-digit number: ${model.phoneMatches}/${model.invoices.length} (${model.phonePadded} needed a leading zero)`);
  out.push(`  LINE user ids valid (33-char U id, unique): ${occupied.length - model.lineIdIssues.length}/${occupied.length}`);
  out.push(`  first invoice's previous meter == ${TAB_METERS}: ${model.startMeterIssues.length === 0 ? "all match" : `${model.startMeterIssues.length} differ (an earlier month had no invoice)`}`);
  out.push("");

  out.push("Invoice arithmetic  (Total Price = Room Fee + Water Price + Elec Price + Service + Trash + Wifi)");
  out.push(`  rows with a non-numeric component: ${model.nonNumeric.length}`);
  for (const item of model.nonNumeric) {
    out.push(`    room ${item.invoice.roomNumber} period ${item.invoice.period}: ${item.fields.join(", ")} not a number`);
  }
  out.push(`  rows that do not balance: ${model.unbalanced.length}`);
  for (const item of model.unbalanced) {
    out.push(
      `    room ${item.invoice.roomNumber} period ${item.invoice.period}: components sum ${formatBaht(item.sum)} != Total Price ${formatBaht(item.invoice.total)}`,
    );
  }
  out.push("");

  out.push(`Metered rate check (water = units x ${model.waterRate}, electric = units x ${model.electricRate})`);
  out.push(`  water mismatches: ${model.waterMismatches.length}`);
  for (const item of model.waterMismatches) {
    out.push(
      `    room ${item.invoice.roomNumber} period ${item.invoice.period}: ${item.invoice.waterUnits} x ${model.waterRate} = ${item.expected} but sheet says ${item.invoice.waterPrice}`,
    );
  }
  out.push(`  electric mismatches (metered rooms): ${model.electricMismatches.length}`);
  for (const item of model.electricMismatches) {
    out.push(
      `    room ${item.invoice.roomNumber} period ${item.invoice.period}: ${item.invoice.electricUnits} x ${model.electricRate} = ${item.expected} but sheet says ${item.invoice.electricPrice}`,
    );
  }

  if (model.electricMismatches.length > 0) {
    const appMatches = model.electricMismatches.filter((item) => Math.round(item.expected) === item.invoice.electricPrice).length;
    out.push(`  note: the sheet rounds metered electric up to whole baht while the app uses Math.round; of the rows above, ${appMatches} already equal the app's rounded amount and ${model.electricMismatches.length - appMatches} are one baht higher than the app would compute.`);
  }

  out.push("");

  out.push("Flat electric check  (Elec Price = round(ค่าไฟจริง from the monthly form))");
  out.push(`  flat-room invoices checked: ${model.flatChecks.length}`);
  out.push(`  mismatches: ${model.flatMismatches.length}`);
  for (const item of model.flatMismatches) {
    out.push(
      `    room ${item.invoice.roomNumber} period ${item.invoice.period}: sheet Elec Price ${item.invoice.electricPrice} vs ค่าไฟจริง ${item.flatAmount}`,
    );
  }
  out.push(`  form values that were not whole baht (rounded by the sheet): ${model.flatFractional.length}`);
  for (const item of model.flatFractional) {
    out.push(
      `    room ${item.invoice.roomNumber} period ${item.invoice.period}: ค่าไฟจริง ${item.flatAmount} -> invoice ${item.invoice.electricPrice}`,
    );
  }
  out.push("");

  const byPeriod = new Map();

  for (const invoice of model.invoices) {
    const bucket = byPeriod.get(invoice.period) ?? { count: 0, total: 0 };
    bucket.count += 1;
    bucket.total += invoice.total ?? 0;
    byPeriod.set(invoice.period, bucket);
  }

  out.push("Per-month invoice totals");
  let grandCount = 0;
  let grandTotal = 0;

  for (const period of [...byPeriod.keys()].sort()) {
    const bucket = byPeriod.get(period);
    grandCount += bucket.count;
    grandTotal += bucket.total;
    out.push(`  ${period}: ${bucket.count} invoices, ${formatBaht(bucket.total)} baht`);
  }

  out.push(`  whole dataset: ${grandCount} invoices, ${formatBaht(grandTotal)} baht`);
  out.push("");

  out.push("Decisions / notes");
  out.push("  check_in_date is approximated as the date of each room's earliest invoice (the sheet has no check-in date).");
  for (const room of occupied) {
    out.push(`    room ${room.roomNumber}: check_in_date ${room.checkInDate}`);
  }
  out.push("  rooms.rent is the sheet's current ค่าห้อง; each bill's rent is the invoice's Room Fee (they can differ for a past period).");
  out.push("  flat rooms are derived from any non-empty ค่าไฟจริง in the monthly form (room 101 also carries one, so it is flat).");
  out.push("  phone format: digits only, 10 digits starting with 0 (matches the app's registration normalisation).");
  out.push("  bills are seeded as paid via bank transfer; paid_at is the invoice Timestamp as +07:00; sent_at is NULL.");
  out.push("  settings: only default_water_rate and default_electric_rate are upserted; no other key is touched.");

  if (model.roomChargeInconsistent.length > 0) {
    out.push("  recurring extras that changed over time:");
    for (const line of model.roomChargeInconsistent) {
      out.push(`    ${line}`);
    }
  }

  if (model.startMeterIssues.length > 0) {
    out.push("  start-meter vs first invoice:");
    for (const line of model.startMeterIssues) {
      out.push(`    ${line}`);
    }
  }

  if (model.phoneIssues.length > 0) {
    out.push("  phone inconsistencies:");
    for (const line of model.phoneIssues) {
      out.push(`    ${line}`);
    }
  }

  if (model.lineIdIssues.length > 0) {
    out.push("  LINE id inconsistencies:");
    for (const line of model.lineIdIssues) {
      out.push(`    ${line}`);
    }
  }

  if (model.problems.length > 0) {
    out.push("");
    out.push("PROBLEMS");
    for (const line of model.problems) {
      out.push(`  ${line}`);
    }
  }

  out.push("");
  out.push(`Wrote ${statementCount} statements to ${outPath}`);

  console.log(out.join("\n"));

  const failures =
    model.problems.length +
    model.nonNumeric.length +
    model.unbalanced.length +
    model.waterMismatches.length +
    model.electricMismatches.length +
    model.phoneIssues.length +
    model.lineIdIssues.length +
    model.flatMismatches.length;

  return failures;
}

// ------------------------------------------------------------ entrypoint

async function main() {
  const args = process.argv.slice(2);
  let outPath = OUT_DEFAULT;

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--out") {
      outPath = args[i + 1];
      i += 1;
    } else if (args[i].startsWith("--out=")) {
      outPath = args[i].slice("--out=".length);
    }
  }

  if (!outPath) {
    outPath = OUT_DEFAULT;
  }

  const model = await build();
  const statements = buildSql(model);
  const absolute = resolve(process.cwd(), outPath);

  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${statements.join("\n")}\n`, "utf8");

  const failures = printReport(model, statements.length, outPath);

  if (failures > 0) {
    console.error(`\n${failures} issue(s) need the owner's attention before this seed is used.`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
