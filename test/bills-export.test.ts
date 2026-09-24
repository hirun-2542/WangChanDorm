import { describe, expect, it } from "vitest";
import {
  billsExportSheets,
  type BillsExportCell,
  type BillsExportSheet,
} from "../src/client/bills-export";
import type { Bill } from "../src/client/api";

/**
 * สร้างบิลตัวอย่างสำหรับทดสอบ — ค่าเริ่มต้นเป็นบิลปกติของห้องหนึ่งเดือน
 * ทดสอบเฉพาะฟิลด์ที่เกี่ยวกับการจัดชีตเท่านั้น ส่ง override เฉพาะที่ต้องการ
 */
function bill(
  overrides: Partial<Bill> & Pick<Bill, "roomNumber" | "period">,
): Bill {
  return {
    id: `bill-${overrides.roomNumber}-${overrides.period}`,
    roomId: `room-${overrides.roomNumber}`,
    tenantId: "tenant-1",
    tenantName: "สมชาย ใจดี",
    rent: 3000,
    waterPrevious: 100,
    waterCurrent: 110,
    waterUnits: 10,
    waterRate: 18,
    waterAmount: 180,
    electricMode: "meter",
    electricPrevious: 1000,
    electricCurrent: 1080,
    electricUnits: 80,
    electricRate: 8,
    electricAmount: 640,
    charges: [],
    total: 3820,
    status: "unpaid",
    paidAt: null,
    paidMethod: null,
    sentAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

/** เข้าถึงชีตที่เทสต์ยืนยันจำนวนมาแล้ว โดยไม่ให้ typecheck บ่นเรื่อง index */
function onlySheet(sheets: BillsExportSheet[]): BillsExportSheet {
  const [sheet] = sheets;
  if (sheet === undefined) throw new Error("expected at least one sheet");
  return sheet;
}

function headersOf(sheet: BillsExportSheet): string[] {
  return sheet.columns.map((column) => column.header);
}

/** อ่านเซลล์ตามตำแหน่งคอลัมน์ (ล้มเหลวชัดเจนถ้าแถวสั้นกว่าที่คาด) */
function cellAt(
  sheet: BillsExportSheet,
  rowIndex: number,
  columnIndex: number,
): BillsExportCell {
  const row = sheet.rows[rowIndex];
  if (row === undefined) throw new Error(`missing row ${rowIndex}`);
  const cell = row[columnIndex];
  if (cell === undefined) throw new Error(`missing cell ${columnIndex}`);
  return cell;
}

function cellIn(
  sheet: BillsExportSheet,
  rowIndex: number,
  header: string,
): BillsExportCell {
  return cellAt(sheet, rowIndex, headersOf(sheet).indexOf(header));
}

describe("billsExportSheets — sheets and their order", () => {
  it("orders sheets by room number, shorter first then alphabetically", () => {
    const sheets = billsExportSheets([
      bill({ roomNumber: "A10", period: "2026-09" }),
      bill({ roomNumber: "A100", period: "2026-08" }),
      bill({ roomNumber: "A9", period: "2026-09" }),
    ]);

    expect(sheets.map((sheet) => sheet.name)).toEqual(["A9", "A10", "A100"]);
  });

  it("returns no sheets for an empty bill list", () => {
    expect(billsExportSheets([])).toEqual([]);
  });
});

describe("billsExportSheets — columns", () => {
  it("gives every sheet the same columns in the same order, including every room's charge names", () => {
    const sheets = billsExportSheets([
      bill({
        roomNumber: "A1",
        period: "2026-09",
        charges: [{ name: "ค่าส่วนกลาง", amount: 200 }],
      }),
      bill({
        roomNumber: "A2",
        period: "2026-09",
        charges: [
          { name: "ค่าเน็ต", amount: 300 },
          { name: "ค่าส่วนกลาง", amount: 200 },
        ],
      }),
    ]);

    const expectedHeaders = [
      "รอบบิล",
      "ผู้เช่า",
      "ค่าห้อง",
      "หน่วยน้ำ",
      "หน่วยไฟ",
      "ค่าน้ำ",
      "ค่าไฟ",
      "ค่าส่วนกลาง",
      "ค่าเน็ต",
      "รวม",
      "สถานะ",
    ];
    expect(headersOf(onlySheet(sheets))).toEqual(expectedHeaders);
    expect(sheets[1]?.columns).toEqual(onlySheet(sheets).columns);
    expect(
      onlySheet(sheets).columns.map((column) => [column.kind, column.width]),
    ).toEqual([
      ["period", 14],
      ["text", 24],
      ["money", 10],
      ["units", 10],
      ["units", 10],
      ["money", 10],
      ["money", 10],
      ["money", 13],
      ["money", 10],
      ["money", 10],
      ["text", 12],
    ]);
  });

  it("skips a charge name that is blank after trimming", () => {
    const sheets = billsExportSheets([
      bill({
        roomNumber: "A1",
        period: "2026-09",
        charges: [{ name: "   ", amount: 99 }],
      }),
    ]);

    expect(headersOf(onlySheet(sheets))).toEqual([
      "รอบบิล",
      "ผู้เช่า",
      "ค่าห้อง",
      "หน่วยน้ำ",
      "หน่วยไฟ",
      "ค่าน้ำ",
      "ค่าไฟ",
      "รวม",
      "สถานะ",
    ]);
  });
});

describe("billsExportSheets — row cells", () => {
  it("places each value in its column and renders status as Thai text", () => {
    const sheets = billsExportSheets([
      bill({
        roomNumber: "A1",
        period: "2026-09",
        tenantName: "สมหญิง รักดี",
        rent: 3500,
        waterUnits: 12,
        electricUnits: 95,
        waterAmount: 216,
        electricAmount: 760,
        total: 4476,
        status: "paid",
      }),
    ]);

    expect(onlySheet(sheets).rows).toEqual([
      [
        new Date(Date.UTC(2026, 8, 1)),
        "สมหญิง รักดี",
        3500,
        12,
        95,
        216,
        760,
        4476,
        "จ่ายแล้ว",
      ],
    ]);
  });

  it("renders an unpaid bill's status as ยังไม่จ่าย", () => {
    const sheets = billsExportSheets([
      bill({ roomNumber: "A1", period: "2026-09", status: "unpaid" }),
    ]);

    expect(cellIn(onlySheet(sheets), 0, "สถานะ")).toBe("ยังไม่จ่าย");
  });

  it("falls back to the meter difference for a flat-rate bill with no stored unit count", () => {
    const sheets = billsExportSheets([
      bill({
        roomNumber: "A1",
        period: "2026-09",
        electricMode: "flat",
        electricUnits: null,
        electricPrevious: 100,
        electricCurrent: 130,
      }),
    ]);

    expect(cellIn(onlySheet(sheets), 0, "หน่วยไฟ")).toBe(30);
  });

  it("represents the billing period as the 1st of that month in UTC", () => {
    const sheets = billsExportSheets([
      bill({ roomNumber: "A1", period: "2026-09" }),
    ]);
    const period = cellAt(onlySheet(sheets), 0, 0) as Date;

    expect(period.getUTCFullYear()).toBe(2026);
    expect(period.getUTCMonth()).toBe(8);
    expect(period.getUTCDate()).toBe(1);
  });

  it("sums same-named charges on one bill and treats surrounding whitespace as the same name", () => {
    const sheets = billsExportSheets([
      bill({
        roomNumber: "A1",
        period: "2026-09",
        charges: [
          { name: "ค่าซ่อม", amount: 100 },
          { name: "ค่าซ่อม", amount: 50 },
        ],
      }),
      bill({
        roomNumber: "A2",
        period: "2026-09",
        charges: [{ name: " ค่าซ่อม ", amount: 70 }],
      }),
    ]);

    const headers = headersOf(onlySheet(sheets));
    const second = sheets[1];
    if (second === undefined) throw new Error("expected a second sheet");
    expect(headers.filter((header) => header === "ค่าซ่อม")).toHaveLength(1);
    expect(cellIn(onlySheet(sheets), 0, "ค่าซ่อม")).toBe(150);
    expect(cellIn(second, 0, "ค่าซ่อม")).toBe(70);
  });

  it("leaves a bill's missing charge blank, not zero", () => {
    const sheets = billsExportSheets([
      bill({
        roomNumber: "A1",
        period: "2026-09",
        charges: [{ name: "ค่าส่วนกลาง", amount: 200 }],
      }),
      bill({
        roomNumber: "A2",
        period: "2026-09",
        charges: [
          { name: "ค่าเน็ต", amount: 300 },
          { name: "ค่าส่วนกลาง", amount: 200 },
        ],
      }),
    ]);

    const sheet = onlySheet(sheets);
    const other = sheets[1];
    if (other === undefined) throw new Error("expected a second sheet");
    const netColumn = headersOf(sheet).indexOf("ค่าเน็ต");
    expect(netColumn).toBeGreaterThan(-1);
    expect(sheet.rows[0]).toHaveLength(headersOf(sheet).length);
    expect(cellAt(sheet, 0, netColumn)).toBeNull();
    expect(cellAt(other, 0, netColumn)).toBe(300);
  });

  it("always orders rows oldest to newest, regardless of the order bills arrive in", () => {
    const sheets = billsExportSheets([
      bill({
        roomNumber: "B10",
        period: "2026-08",
        tenantName: "ผู้เช่าคนใหม่",
      }),
      bill({ roomNumber: "B2", period: "2026-07" }),
      bill({
        roomNumber: "B10",
        period: "2026-07",
        tenantName: "ผู้เช่าคนเก่า",
      }),
    ]);

    expect(sheets.map((sheet) => sheet.name)).toEqual(["B2", "B10"]);
    const sheet = sheets[1];
    if (sheet === undefined) throw new Error("expected the B10 sheet");
    // ผู้เรียกส่งเดือน 08 มาก่อน 07 (ไม่เรียง) — โมดูลต้องสลับให้เองเป็น 07, 08
    expect(sheet.rows.map((row) => row[1])).toEqual([
      "ผู้เช่าคนเก่า",
      "ผู้เช่าคนใหม่",
    ]);
    expect((cellAt(sheet, 0, 0) as Date).getUTCMonth()).toBe(6);
    expect((cellAt(sheet, 1, 0) as Date).getUTCMonth()).toBe(7);
  });

  it("keeps sheet names unique when two different room numbers sanitize to the same name", () => {
    const sheets = billsExportSheets([
      bill({ roomNumber: "A/1", period: "2026-09" }),
      bill({ roomNumber: "A:1", period: "2026-09" }),
    ]);

    expect(sheets.map((sheet) => sheet.name)).toEqual(["A-1", "A-1 (2)"]);
  });
});

describe("billsExportSheets — sheet naming", () => {
  it("replaces every character Excel forbids in a sheet name", () => {
    const sheets = billsExportSheets([
      bill({ roomNumber: "A\\/?*[]:9", period: "2026-09" }),
    ]);

    expect(onlySheet(sheets).name).toBe("A-------9");
  });

  it("strips surrounding quotes and whitespace from a sheet name", () => {
    const sheets = billsExportSheets([
      bill({ roomNumber: "  'A1'  ", period: "2026-09" }),
    ]);

    expect(onlySheet(sheets).name).toBe("A1");
  });

  it("falls back to ห้อง when a room number sanitizes to nothing", () => {
    expect(
      onlySheet(billsExportSheets([bill({ roomNumber: "'", period: "2026-09" })]))
        .name,
    ).toBe("ห้อง");
    expect(
      onlySheet(billsExportSheets([bill({ roomNumber: "   ", period: "2026-09" })]))
        .name,
    ).toBe("ห้อง");
  });

  it("caps a sheet name at Excel's 31-character limit", () => {
    const sheets = billsExportSheets([
      bill({ roomNumber: "ห้อง".repeat(20), period: "2026-09" }),
    ]);

    expect(onlySheet(sheets).name).toHaveLength(31);
  });

  it("de-duplicates sheet names case-insensitively", () => {
    const sheets = billsExportSheets([
      bill({ roomNumber: "Room1", period: "2026-09" }),
      bill({ roomNumber: "room1", period: "2026-09" }),
    ]);

    // ทั้งสองยาว 5 ตัวเท่ากัน เรียงตามตัวอักษร 'R' < 'r' จึงได้ Room1 ก่อน
    expect(sheets.map((sheet) => sheet.name)).toEqual(["Room1", "room1 (2)"]);
  });

  it("truncates the base name so a de-duplicated suffix still fits in 31 characters", () => {
    const sheets = billsExportSheets([
      bill({ roomNumber: `${"A".repeat(27)}/1`, period: "2026-09" }),
      bill({ roomNumber: `${"A".repeat(27)}:1`, period: "2026-09" }),
    ]);

    // ทั้งสองแปลงเป็นชื่อฐานเดียวกัน (29 ตัว) — ตัวที่สองชนจึงต้องตัดฐานให้
    // เหลือ 27 ตัวก่อนต่อ " (2)" (4 ตัว) รวมแล้วพอดี 31 ตัวตามเพดานของ Excel
    const second = sheets[1];
    if (second === undefined) throw new Error("expected a second sheet");
    expect(second.name).toHaveLength(31);
    expect(second.name.endsWith(" (2)")).toBe(true);
    expect(second.name.startsWith("A".repeat(27))).toBe(true);
  });
});
