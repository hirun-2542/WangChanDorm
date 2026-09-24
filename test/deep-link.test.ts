import { describe, expect, it } from "vitest";
import { billDetailUrl, lineMessageUrl } from "../src/worker/lib/line-link";
import { safeReturnPath } from "../src/shared/return-path";

/**
 * ที่หมายหลังล็อกอิน ("next") ถูกอ่านจากคุกกี้ที่ผู้ใช้แก้เองได้ และถูกต่อท้าย
 * Location ตรง ๆ — ถ้าปล่อยผ่านแม้กรณีเดียวคือช่อง open redirect / header injection
 */
describe("safeReturnPath", () => {
  it("accepts the in-app fragments we actually generate", () => {
    for (const value of [
      "#bills/detail/abc-123",
      "#bills/detail/abc-123?period=2026-09&room=101",
      "#invite/tok_ABC-123",
      "#dashboard",
      "#bills?period=2026-09",
    ]) {
      expect(safeReturnPath(value)).toBe(value);
    }
  });

  it("rejects anything that is not a fragment", () => {
    for (const value of [
      "https://evil.example/steal",
      "/bills/detail/1",
      "#",
      "",
      `#x${"y".repeat(600)}`,
      undefined,
      null,
      42,
    ]) {
      expect(safeReturnPath(value)).toBeNull();
    }
  });

  it("rejects control characters that could break out of the Location header", () => {
    expect(safeReturnPath("#a\nb")).toBeNull();
    expect(safeReturnPath("#a\rb")).toBeNull();
    expect(safeReturnPath("#a\tb")).toBeNull();
    expect(safeReturnPath("#a\u0000b")).toBeNull();
  });

  it("keeps fragments that merely look like schemes, because a fragment cannot change the host", () => {
    // ค่าที่ผ่านการตรวจจะถูกต่อท้าย origin ของเราเสมอ — สิ่งเหล่านี้จึงเป็นแค่
    // ข้อความใน fragment ไม่ใช่ปลายทางใหม่
    expect(safeReturnPath("#javascript:alert(1)")).toBe("#javascript:alert(1)");
    expect(safeReturnPath("#bills?x=a:b")).toBe("#bills?x=a:b");
    expect(safeReturnPath("#//evil.example")).toBe("#//evil.example");
  });
});

/**
 * ลิงก์ที่บอทส่งในแชทถูกเปิดใน in-app browser ของ LINE และ Google บล็อก OAuth
 * ที่นั่น — พารามิเตอร์นี้คือสิ่งที่ทำให้ปุ่มกดแล้วใช้งานได้จริง
 */
describe("lineMessageUrl", () => {
  it("adds the parameter before the fragment so LINE can see it", () => {
    const url = lineMessageUrl("https://dorm.test/#bills/detail/abc");

    expect(url).toBe("https://dorm.test/?openExternalBrowser=1#bills/detail/abc");
    // ลำดับสำคัญ: fragment ต้องอยู่ท้ายเสมอ ไม่งั้นพารามิเตอร์ไปอยู่ใน fragment
    expect(url.indexOf("openExternalBrowser=1")).toBeLessThan(url.indexOf("#"));
  });

  it("keeps existing query parameters", () => {
    const url = lineMessageUrl("https://dorm.test/#invite/tok?x=1");
    expect(url).toContain("openExternalBrowser=1");
    expect(url.endsWith("#invite/tok?x=1")).toBe(true);
  });

  it("overrides a conflicting value instead of duplicating the parameter", () => {
    const url = lineMessageUrl("https://dorm.test/?openExternalBrowser=0#bills");
    expect(url.match(/openExternalBrowser/g)).toHaveLength(1);
    expect(url).toContain("openExternalBrowser=1");
  });

  it("builds a bill link that carries its period, so the detail view can find the bill", () => {
    /**
     * หน้ารายละเอียดหาบิลจากรายการที่โหลดมาตามรอบบิล ค่าเริ่มต้นคือรอบปัจจุบัน
     * ลิงก์ของบิลเดือนก่อนที่ไม่มี period จึงขึ้น "ไม่พบบิลที่จะแสดง"
     */
    const url = billDetailUrl("https://dorm.test", "abc-123", "2026-06");

    expect(url).toBe("https://dorm.test/?openExternalBrowser=1#bills/detail/abc-123?period=2026-06");
    // id และ period ต้อง encode ก่อนต่อเข้า fragment
    expect(billDetailUrl("https://dorm.test", "a/b", "2026-06")).toContain("#bills/detail/a%2Fb?period=2026-06");
    expect(billDetailUrl("https://dorm.test", "abc", "")).toBe("https://dorm.test/?openExternalBrowser=1#bills/detail/abc");
  });

  it("leaves LIFF and non-http URLs untouched", () => {
    // เอกสาร LINE ระบุว่าพารามิเตอร์นี้ไม่ทำงานบน LIFF — เติมไปก็รกโดยไม่ได้อะไร
    const liff = "https://liff.line.me/1234567890-abcdefgh";
    expect(lineMessageUrl(liff)).toBe(liff);
    expect(lineMessageUrl("not a url")).toBe("not a url");
  });
});
