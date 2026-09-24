import { describe, expect, it } from "vitest";
import {
  markAllRead,
  maxNotifications,
  notificationDetail,
  notificationHref,
  notificationIcon,
  notificationOf,
  notificationText,
  notificationTime,
  tenantJoinedNotificationOf,
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
    const [kept] = twice;
    expect(kept?.kind).toBe("bill-paid");
    expect(kept?.kind === "bill-paid" ? kept.total : null).toBe(9999);
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
    expect(notificationText(notificationOf(notice("b1", "A101", 3935)))).toBe(
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

describe("tenant joined notifications", () => {
  function joined(tenantId: string, roomNumber = "B202", source: "self" | "owner" = "self") {
    return {
      tenantId,
      roomNumber,
      tenantName: "สมหญิง ใหม่",
      source,
      joinedAt: "2026-09-24T08:15:00.000Z",
    };
  }

  it("says a new tenant arrived, not that money came in", () => {
    const item = tenantJoinedNotificationOf(joined("t1"));
    expect(item.kind).toBe("tenant-joined");
    expect(notificationText(item)).toBe("ห้อง B202 มีผู้เช่าใหม่ สมหญิง ใหม่");
    // ต้องไม่พูดถึงยอดเงินเลย — เป็นคนละเหตุการณ์กับการชำระ
    expect(notificationText(item)).not.toContain("ชำระ");
  });

  it("distinguishes a self-registration from a link the owner made", () => {
    /**
     * สองทางนี้ต่างกันที่การกระทำที่ต้องทำต่อ: ลงทะเบียนเอง = คนที่เจ้าของยัง
     * ไม่รู้จัก ต้องเข้าไปดูว่าเขาตั้งไว้ถูกไหม · เชื่อมให้ = เจ้าของทำเองแล้ว
     */
    expect(notificationDetail(tenantJoinedNotificationOf(joined("t1", "B202", "self")))).toBe(
      "ลงทะเบียนเองผ่าน LINE",
    );
    expect(notificationDetail(tenantJoinedNotificationOf(joined("t1", "B202", "owner")))).toBe(
      "เชื่อม LINE ให้แล้ว",
    );
  });

  it("uses its own icon so the two kinds are told apart at a glance", () => {
    expect(notificationIcon(tenantJoinedNotificationOf(joined("t1")))).toBe("person_add");
    expect(notificationIcon(notificationOf(notice("b1")))).toBe("check_circle");
  });

  it("links tenant events to the tenant list, since a tenant has no page of its own", () => {
    expect(notificationHref(tenantJoinedNotificationOf(joined("t1")))).toBe("#tenants");
    expect(notificationHref(notificationOf(notice("b1")))).toBe(
      "#bills/detail/b1?period=2026-09",
    );
  });

  it("does not let a tenant event be mistaken for a bill by id collision", () => {
    // id ของสองชนิดอยู่ในเนมสเปซเดียวกัน — กันซ้ำด้วย id รวมจึงยังถูกต้อง
    const list = withNotification(
      withNotification([], notificationOf(notice("same-id"))),
      tenantJoinedNotificationOf(joined("same-id")),
    );

    expect(list).toHaveLength(2);
    expect(list.map((item) => item.kind)).toEqual(["tenant-joined", "bill-paid"]);
  });

  it("counts both kinds as unread and clears both on open", () => {
    const list = [
      notificationOf(notice("b1")),
      tenantJoinedNotificationOf(joined("t1")),
    ];

    expect(unreadCount(list)).toBe(2);
    expect(unreadCount(markAllRead(list))).toBe(0);
  });
});
