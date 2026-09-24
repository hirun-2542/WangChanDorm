import { describe, expect, it } from "vitest";
import {
  defaultExportRange,
  exportFileName,
  trailingYearRange,
  yearToDateRange,
} from "../src/client/bills-export-range";

describe("defaultExportRange", () => {
  it("returns null when nothing is billed yet", () => {
    expect(defaultExportRange([], "2026-09")).toBeNull();
  });

  it("defaults to the month on screen when that month has bills", () => {
    expect(defaultExportRange(["2026-09", "2026-08"], "2026-09")).toEqual({
      from: "2026-09",
      to: "2026-09",
    });
  });

  it("falls back to the latest billed month when the month on screen has none", () => {
    expect(defaultExportRange(["2026-08", "2026-07"], "2026-09")).toEqual({
      from: "2026-08",
      to: "2026-08",
    });
  });

  it("finds the latest billed month even if billed is not sorted DESC", () => {
    // ไม่พึ่งว่า /api/bills/periods ต้องส่งมาเรียงเสมอ — หาค่ามากที่สุดเอง
    expect(defaultExportRange(["2026-06", "2026-08", "2026-07"], "2026-09")).toEqual({
      from: "2026-08",
      to: "2026-08",
    });
  });
});

describe("yearToDateRange", () => {
  it("spans the first to the last billed month within the given year", () => {
    const billed = ["2026-09", "2026-01", "2025-12"];
    expect(yearToDateRange(billed, new Date(2026, 8, 24))).toEqual({
      from: "2026-01",
      to: "2026-09",
    });
  });

  it("is null when the given year has no billed month", () => {
    expect(yearToDateRange(["2025-12"], new Date(2026, 8, 24))).toBeNull();
  });
});

describe("trailingYearRange", () => {
  it("spans the billed months within the trailing 12 months, excluding what falls outside", () => {
    // "ตอนนี้" = 2026-09 → หน้าต่าง 12 เดือนคือ 2025-10..2026-09
    const billed = ["2026-09", "2025-11", "2025-09"];
    expect(trailingYearRange(billed, new Date(2026, 8, 24))).toEqual({
      from: "2025-11",
      to: "2026-09",
    });
  });

  it("is null when nothing billed falls in the trailing 12 months", () => {
    expect(trailingYearRange(["2024-01"], new Date(2026, 8, 24))).toBeNull();
  });
});

describe("exportFileName", () => {
  it("names a single-month export after that month", () => {
    expect(exportFileName({ from: "2026-09", to: "2026-09" })).toBe(
      "บิล กันยายน 2569.xlsx",
    );
  });

  it("names a multi-month export as a start–end range", () => {
    expect(exportFileName({ from: "2026-01", to: "2026-09" })).toBe(
      "บิล มกราคม 2569 - กันยายน 2569.xlsx",
    );
  });
});
