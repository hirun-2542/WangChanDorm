import { describe, expect, it } from "vitest";
import {
  markAllRead,
  maxNotifications,
  notificationOf,
  notificationText,
  notificationTime,
  unreadCount,
  withNotification,
  type AppNotification,
} from "../src/client/notifications";

function notice(billId: string, roomNumber = "101", total = 3500) {
  return {
    billId,
    roomNumber,
    tenantName: "สมชาย ทดสอบ",
    period: "2026-09",
    total,
    methodLabel: "สลิปอัตโนมัติ",
    paidAt: "2026-09-24T07:05:00.000Z",
  };
}

describe("notification list", () => {
  it("puts the newest first", () => {
    const list = withNotification(
      withNotification([], notificationOf(notice("b1"))),
      notificationOf(notice("b2", "102")),
    );

    expect(list.map((item) => item.id)).toEqual(["b2", "b1"]);
  });

  it("does not store the same bill twice", () => {
    /**
     * socket ที่หลุดแล้วต่อใหม่สามารถรับข้อความเดิมซ้ำได้ — บิลใบเดียวกันสองแถว
     * ทำให้ผู้ใช้อ่านสับสนและตัวเลขบนปุ่มเกินจริง
     */
    const once = withNotification([], notificationOf(notice("b1")));
    const twice = withNotification(once, notificationOf(notice("b1", "101", 9999)));

    expect(twice).toHaveLength(1);
    // ของใหม่ทับของเก่า ไม่ใช่เก็บค่าเก่าไว้
    expect(twice[0]?.total).toBe(9999);
  });

  it("caps the list so a long-lived tab cannot grow without bound", () => {
    let list: AppNotification[] = [];

    for (let index = 0; index < maxNotifications + 10; index += 1) {
      list = withNotification(list, notificationOf(notice(`b${index}`)));
    }

    expect(list).toHaveLength(maxNotifications);
    // เก็บของใหม่สุดไว้ ไม่ใช่ของเก่าสุด
    expect(list[0]?.id).toBe(`b${maxNotifications + 9}`);
  });

  it("counts only what has not been read and clears the count when opened", () => {
    const list = [
      notificationOf(notice("b1")),
      notificationOf(notice("b2", "102")),
    ];

    expect(unreadCount(list)).toBe(2);
    expect(unreadCount(markAllRead(list))).toBe(0);
    expect(unreadCount([])).toBe(0);
  });

  it("keeps the list intact when marking read, so history is not lost", () => {
    const list = [notificationOf(notice("b1")), notificationOf(notice("b2", "102"))];
    const read = markAllRead(list);

    expect(read).toHaveLength(2);
    expect(read.map((item) => item.id)).toEqual(["b1", "b2"]);
    expect(read.every((item) => item.read)).toBe(true);
  });
});

describe("notification text", () => {
  it("states the room and the amount, grouped so four digits are readable", () => {
    expect(notificationText({ roomNumber: "A101", total: 3935 })).toBe(
      "ห้อง A101 ชำระแล้ว 3,935 บาท",
    );
  });

  it("renders the time in the viewer's own clock", () => {
    // เวลาที่แสดงคือเวลาท้องถิ่นของเครื่อง ไม่ใช่ UTC ของ ISO string
    const shown = notificationTime("2026-09-24T07:05:00.000Z");
    const expected = new Date("2026-09-24T07:05:00.000Z").toLocaleTimeString("th-TH", {
      hour: "2-digit",
      minute: "2-digit",
    });

    expect(shown).toBe(expected);
  });

  it("returns nothing rather than NaN for an unparsable timestamp", () => {
    expect(notificationTime("not-a-date")).toBe("");
  });
});
