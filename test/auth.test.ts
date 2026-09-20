import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/worker/lib/password";
import { createFamily, signIn } from "./auth-helper";

const base = "https://example.com";
const secret = env.BOOTSTRAP_SECRET;
const legacyFamilyId = "00000000-0000-4000-8000-000000000001";

function cookieFrom(response: Response): string {
  const header = response.headers.get("set-cookie") ?? "";
  return header.split(";")[0] ?? "";
}

async function post(path: string, body: unknown, cookie?: string): Promise<Response> {
  return SELF.fetch(`${base}${path}`, {
    method: "POST",
    headers: cookie === undefined ? { "content-type": "application/json" } : { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

describe("password hashing", () => {
  it("round-trips a password and rejects a wrong one", () => {
    const stored = hashPassword("correct horse battery staple");

    expect(stored.startsWith("$argon2id$v=19$m=19456,t=2,p=1$")).toBe(true);
    expect(verifyPassword("correct horse battery staple", stored)).toBe(true);
    expect(verifyPassword("Correct horse battery staple", stored)).toBe(false);
  });

  it("produces a different hash for the same password", () => {
    expect(hashPassword("correct horse battery staple")).not.toBe(hashPassword("correct horse battery staple"));
  });

  it("rejects a malformed or tampered stored hash", () => {
    expect(verifyPassword("whatever", "not-a-hash")).toBe(false);
    expect(verifyPassword("whatever", "$argon2id$v=19$m=999999999,t=99,p=99$c2FsdA==$aGFzaA==")).toBe(false);
  });
});

describe("owner API is closed without a session", () => {
  it("refuses every owner endpoint with 401", async () => {
    for (const path of ["/api/rooms", "/api/tenants", "/api/bills", "/api/settings", "/api/stats/dashboard"]) {
      const response = await SELF.fetch(`${base}${path}`);
      expect([path, response.status]).toEqual([path, 401]);
    }
  });

  it("returns a JSON error envelope, not bare text", async () => {
    const response = await SELF.fetch(`${base}/api/rooms`);
    const body = await response.json<{ ok: boolean; error: { code: string; message: string } }>();

    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.message).toBe("กรุณาเข้าสู่ระบบ");
  });

  it("refuses an unknown api path the same as any other unauthenticated api call", async () => {
    // ยังไม่ล็อกอินจึงเห็น 401 เหมือน path ที่มีจริงทุกอัน ไม่ใช่ 404 ที่บอกใบ้ว่า
    // path นี้ไม่มีอยู่ (ถ้าตอบต่างกัน ผู้โจมตีใช้เดา route ที่มีจริงได้)
    const response = await SELF.fetch(`${base}/api/nope`);
    expect(response.status).toBe(401);
  });
});

describe("json error envelope", () => {
  it("returns a JSON 404 for an unknown api path once signed in", async () => {
    // ใช้ครอบครัวแยกต่างหาก ไม่ใช้ signIn() แบบ default ที่ผูกกับครอบครัวเดิม
    // เพราะการมีสมาชิกในครอบครัวเดิมก่อนเวลาจะไปรบกวนสมมติฐาน "ยังไม่มีใคร
    // claim" ที่ชุดเทสต์ bootstrap ด้านล่างต้องการ
    const family = await createFamily("หอทดสอบ 404");
    const session = await signIn("owner", family);

    const response = await SELF.fetch(`${base}/api/nope`, { headers: { cookie: session.cookie } });

    expect(response.status).toBe(404);
    expect((await response.json<{ error: { code: string } }>()).error.code).toBe("NOT_FOUND");
  });
});

describe("bootstrap", () => {
  it("rejects a wrong secret without creating anything", async () => {
    const response = await post("/api/auth/bootstrap", {
      secret: "wrong-secret",
      email: "intruder@example.com",
      displayName: "ผู้บุกรุก",
      password: "a-long-enough-password",
    });

    expect(response.status).toBe(403);

    const users = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE email = ?")
      .bind("intruder@example.com")
      .first<{ n: number }>();
    expect(users?.n).toBe(0);
  });

  it("claims the family holding the existing data and returns a session cookie", async () => {
    const response = await post("/api/auth/bootstrap", {
      secret,
      email: "Owner@Example.com ",
      displayName: "เจ้าของหอ",
      password: "a-long-enough-password",
    });

    expect(response.status).toBe(201);

    const body = await response.json<{ claimedExistingData: boolean; user: { familyId: string; email: string } }>();
    expect(body.claimedExistingData).toBe(true);
    expect(body.user.familyId).toBe(legacyFamilyId);
    expect(body.user.email).toBe("owner@example.com");

    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
  });

  it("refuses a second claim of the same family and creates a separate family instead", async () => {
    const response = await post("/api/auth/bootstrap", {
      secret,
      email: "second@example.com",
      displayName: "เจ้าของอีกหอ",
      password: "a-long-enough-password",
      familyName: "หอที่สอง",
    });

    expect(response.status).toBe(201);

    const body = await response.json<{ claimedExistingData: boolean; user: { familyId: string } }>();
    expect(body.claimedExistingData).toBe(false);
    expect(body.user.familyId).not.toBe(legacyFamilyId);

    const rooms = await env.DB.prepare("SELECT COUNT(*) AS n FROM rooms WHERE family_id = ?")
      .bind(body.user.familyId)
      .first<{ n: number }>();
    expect(rooms?.n).toBe(0);
  });

  it("refuses an email that already has an account", async () => {
    const response = await post("/api/auth/bootstrap", {
      secret,
      email: "owner@example.com",
      displayName: "ซ้ำ",
      password: "a-long-enough-password",
      familyName: "หอซ้ำ",
    });

    expect(response.status).toBe(409);
  });

  it("refuses a short password", async () => {
    const response = await post("/api/auth/bootstrap", {
      secret,
      email: "short@example.com",
      displayName: "รหัสสั้น",
      password: "sh0rt",
      familyName: "หอรหัสสั้น",
    });

    expect(response.status).toBe(400);
    expect((await response.json<{ error: { field?: string } }>()).error.field).toBe("password");
  });
});

describe("login and session", () => {
  let cookie = "";

  beforeAll(async () => {
    const response = await post("/api/auth/login", { email: "owner@example.com", password: "a-long-enough-password" });
    cookie = cookieFrom(response);
  });

  it("rejects a wrong password with the same wording as an unknown email", async () => {
    const wrongPassword = await post("/api/auth/login", { email: "owner@example.com", password: "not-the-password" });
    const unknownEmail = await post("/api/auth/login", { email: "ghost@example.com", password: "not-the-password" });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect((await wrongPassword.json<{ error: { message: string } }>()).error.message).toBe(
      (await unknownEmail.json<{ error: { message: string } }>()).error.message,
    );
  });

  it("opens the owner API once signed in", async () => {
    const response = await SELF.fetch(`${base}/api/rooms`, { headers: { cookie } });
    expect(response.status).toBe(200);
  });

  it("reports the signed-in user", async () => {
    const response = await SELF.fetch(`${base}/api/auth/me`, { headers: { cookie } });
    const body = await response.json<{ user: { email: string; role: string; familyId: string } }>();

    expect(body.user.email).toBe("owner@example.com");
    expect(body.user.role).toBe("owner");
    expect(body.user.familyId).toBe(legacyFamilyId);
  });

  it("stores only a hash of the session token", async () => {
    const token = cookie.split("=")[1] ?? "";
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?")
      .bind(token)
      .first<{ n: number }>();

    expect(token.length).toBeGreaterThan(30);
    expect(row?.n).toBe(0);
  });

  it("revokes the session on logout", async () => {
    const loginResponse = await post("/api/auth/login", {
      email: "owner@example.com",
      password: "a-long-enough-password",
    });
    const throwaway = cookieFrom(loginResponse);

    expect((await SELF.fetch(`${base}/api/rooms`, { headers: { cookie: throwaway } })).status).toBe(200);

    await post("/api/auth/logout", {}, throwaway);

    expect((await SELF.fetch(`${base}/api/rooms`, { headers: { cookie: throwaway } })).status).toBe(401);
  });

  it("refuses a cross-origin state change", async () => {
    const response = await SELF.fetch(`${base}/api/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin: "https://evil.example" },
      body: JSON.stringify({ roomNumber: "999", rent: 1000 }),
    });

    expect(response.status).toBe(403);
  });
});

describe("login rate limiting", () => {
  it("stops answering after repeated failures for the same email", async () => {
    let sawTooMany = false;

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await post("/api/auth/login", { email: "target@example.com", password: "guess-guess-guess" });

      if (response.status === 429) {
        sawTooMany = true;
        break;
      }
    }

    expect(sawTooMany).toBe(true);

    // ทดสอบนี้ยิงจน IP scope (ไม่มี cf-connecting-ip ในสภาพทดสอบ จึงใช้ "unknown"
    // ร่วมกันทุกคำขอ) ถูกล็อก ต้องล้างก่อนเทสต์ถัดไปเพื่อไม่ให้ล็อกอินจริงถัดไปโดนบล็อกไปด้วย
    await env.DB.prepare("DELETE FROM login_attempts").run();
  });
});

describe("family membership", () => {
  let ownerCookie = "";

  beforeAll(async () => {
    const response = await post("/api/auth/login", { email: "owner@example.com", password: "a-long-enough-password" });
    ownerCookie = cookieFrom(response);
  });

  it("invites a new person and lets them join with their own credentials", async () => {
    const invited = await post("/api/family/invites", { email: "helper@example.com", role: "member" }, ownerCookie);
    expect(invited.status).toBe(201);

    const { invite } = await invited.json<{ invite: { token: string; url: string } }>();
    expect(invite.url).toContain("#invite/");

    const stored = await env.DB.prepare("SELECT COUNT(*) AS n FROM family_invites WHERE token_hash = ?")
      .bind(invite.token)
      .first<{ n: number }>();
    expect(stored?.n).toBe(0);

    const accepted = await post("/api/auth/accept-invite", {
      token: invite.token,
      displayName: "ผู้ช่วย",
      password: "another-long-password",
    });
    expect(accepted.status).toBe(201);

    const memberCookie = cookieFrom(accepted);
    const me = await (
      await SELF.fetch(`${base}/api/auth/me`, { headers: { cookie: memberCookie } })
    ).json<{ user: { role: string; familyId: string } }>();

    expect(me.user.role).toBe("member");
    expect(me.user.familyId).toBe(legacyFamilyId);
  });

  it("refuses the same invite a second time", async () => {
    const invited = await post("/api/family/invites", { email: "twice@example.com", role: "member" }, ownerCookie);
    const { invite } = await invited.json<{ invite: { token: string } }>();

    const first = await post("/api/auth/accept-invite", {
      token: invite.token,
      displayName: "ครั้งแรก",
      password: "another-long-password",
    });
    const second = await post("/api/auth/accept-invite", {
      token: invite.token,
      displayName: "ครั้งที่สอง",
      password: "another-long-password",
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(400);
  });

  it("does not let an invite hand over an account that already exists", async () => {
    const invited = await post("/api/family/invites", { email: "owner@example.com", role: "member" }, ownerCookie);

    // เจ้าของอยู่ในครอบครัวนี้อยู่แล้ว จึงเชิญซ้ำไม่ได้ตั้งแต่ต้น
    expect(invited.status).toBe(409);

    const second = await post("/api/auth/bootstrap", {
      secret,
      email: "outsider@example.com",
      displayName: "คนนอก",
      password: "outsider-long-password",
      familyName: "หอคนนอก",
    });
    const outsiderFamily = (await second.json<{ user: { familyId: string } }>()).user.familyId;
    const outsiderCookie = cookieFrom(second);

    const crossInvite = await post(
      "/api/family/invites",
      { email: "helper@example.com", role: "owner" },
      outsiderCookie,
    );
    expect(crossInvite.status).toBe(201);

    const { invite } = await crossInvite.json<{ invite: { token: string } }>();

    // ถือคำเชิญอย่างเดียวต้องไม่พอ ต้องรู้รหัสผ่านของบัญชีนั้นด้วย
    const guessed = await post("/api/auth/accept-invite", {
      token: invite.token,
      displayName: "ขโมย",
      password: "wrong-password-guess",
    });
    expect(guessed.status).toBe(401);

    // แม้รหัสผ่านถูก ก็ยังย้ายครอบครัวไม่ได้เพราะอยู่ครอบครัวอื่นแล้ว
    const correct = await post("/api/auth/accept-invite", {
      token: invite.token,
      displayName: "ผู้ช่วย",
      password: "another-long-password",
    });
    expect(correct.status).toBe(409);

    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM family_members WHERE family_id = ?")
      .bind(outsiderFamily)
      .first<{ n: number }>();
    expect(rows?.n).toBe(1);
  });

  it("keeps at least one owner and revokes sessions when a member is removed", async () => {
    const invited = await post("/api/family/invites", { email: "leaver@example.com", role: "member" }, ownerCookie);
    const { invite } = await invited.json<{ invite: { token: string } }>();

    const accepted = await post("/api/auth/accept-invite", {
      token: invite.token,
      displayName: "ผู้จะถูกถอด",
      password: "another-long-password",
    });
    const leaverCookie = cookieFrom(accepted);

    const family = await (
      await SELF.fetch(`${base}/api/family`, { headers: { cookie: ownerCookie } })
    ).json<{ members: { userId: string; email: string }[] }>();
    const leaver = family.members.find((member) => member.email === "leaver@example.com");
    expect(leaver).toBeDefined();

    expect((await SELF.fetch(`${base}/api/rooms`, { headers: { cookie: leaverCookie } })).status).toBe(200);

    const removed = await SELF.fetch(`${base}/api/family/members/${leaver?.userId ?? ""}`, {
      method: "DELETE",
      headers: { cookie: ownerCookie },
    });
    expect(removed.status).toBe(200);

    expect((await SELF.fetch(`${base}/api/rooms`, { headers: { cookie: leaverCookie } })).status).toBe(401);
  });

  it("refuses to demote the last owner", async () => {
    const me = await (
      await SELF.fetch(`${base}/api/auth/me`, { headers: { cookie: ownerCookie } })
    ).json<{ user: { id: string } }>();

    const response = await SELF.fetch(`${base}/api/family/members/${me.user.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ role: "member" }),
    });

    expect(response.status).toBe(409);
  });

  it("cannot be raced to zero owners by two owners demoting each other concurrently", async () => {
    // ครอบครัวแยกต่างหากที่มีเจ้าของสองคนพอดี เพื่อไม่ให้ปนกับสถานะของ
    // ครอบครัวเดิมที่เทสต์ก่อนหน้านี้แก้ไขไว้แล้ว
    const raceFamily = await createFamily("หอทดสอบแข่งกันลดตำแหน่ง");
    const ownerA = await signIn("owner", raceFamily);
    const ownerB = await signIn("owner", raceFamily);

    // ทั้งสองคนพยายามลดตำแหน่งอีกฝ่ายเป็นสมาชิกพร้อมกัน ถ้าเช็คแล้วค่อยเขียน
    // แยกกันสองคำสั่ง ทั้งคู่จะเห็นว่า "ยังมีเจ้าของอีกคน" พร้อมกันและผ่านทั้งคู่
    const patch = (actor: typeof ownerA, targetUserId: string) =>
      SELF.fetch(`${base}/api/family/members/${targetUserId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: actor.cookie },
        body: JSON.stringify({ role: "member" }),
      });

    const [resultA, resultB] = await Promise.all([
      patch(ownerA, ownerB.userId),
      patch(ownerB, ownerA.userId),
    ]);

    const statuses = [resultA.status, resultB.status];

    // ผู้แพ้ถูกปฏิเสธได้สองแบบตามจังหวะที่แต่ละคำขอมาถึง: 409 เมื่อ UPDATE
    // แบบมีเงื่อนไขในคำสั่งเดียวพบว่าเจ้าของอีกคนถูกลดตำแหน่งไปแล้ว หรือ 403
    // เมื่อผู้แพ้เองถูกลดตำแหน่งไปแล้วก่อน requireRole ของคำขอตัวเองจะตรวจ
    // ทั้งสองแบบคือการปฏิเสธที่ปลอดภัย สิ่งที่ต้องยืนยันคือสำเร็จได้แค่คนเดียว
    const winners = statuses.filter((status) => status === 200);
    const losers = statuses.filter((status) => status !== 200);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect([403, 409]).toContain(losers[0]);

    const owners = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM family_members WHERE family_id = ? AND role = 'owner'",
    )
      .bind(raceFamily)
      .first<{ n: number }>();
    expect(owners?.n).toBe(1);
  });

  it("does not let a member manage the family", async () => {
    const login = await post("/api/auth/login", { email: "helper@example.com", password: "another-long-password" });
    const memberCookie = cookieFrom(login);

    const response = await post("/api/family/invites", { email: "nope@example.com", role: "member" }, memberCookie);

    expect(response.status).toBe(403);
  });
});

describe("changing password", () => {
  it("rejects the wrong current password and accepts the right one, revoking the old session", async () => {
    const bootstrap = await post("/api/auth/bootstrap", {
      secret,
      email: "changer@example.com",
      displayName: "ผู้เปลี่ยนรหัส",
      password: "original-long-password",
      familyName: "หอเปลี่ยนรหัส",
    });
    const oldCookie = cookieFrom(bootstrap);

    const wrong = await post(
      "/api/auth/password",
      { currentPassword: "not-the-password", newPassword: "brand-new-long-password" },
      oldCookie,
    );
    expect(wrong.status).toBe(400);

    const changed = await post(
      "/api/auth/password",
      { currentPassword: "original-long-password", newPassword: "brand-new-long-password" },
      oldCookie,
    );
    expect(changed.status).toBe(200);

    const newCookie = cookieFrom(changed);
    expect(newCookie).not.toBe(oldCookie);

    // เซสชันเก่าถูกเพิกถอนแล้ว เซสชันใหม่ใช้งานได้
    expect((await SELF.fetch(`${base}/api/rooms`, { headers: { cookie: oldCookie } })).status).toBe(401);
    expect((await SELF.fetch(`${base}/api/rooms`, { headers: { cookie: newCookie } })).status).toBe(200);

    const loginOld = await post("/api/auth/login", {
      email: "changer@example.com",
      password: "original-long-password",
    });
    expect(loginOld.status).toBe(401);

    const loginNew = await post("/api/auth/login", {
      email: "changer@example.com",
      password: "brand-new-long-password",
    });
    expect(loginNew.status).toBe(200);
  });

  it("lets only one of two concurrent password changes with the same current password win", async () => {
    const bootstrap = await post("/api/auth/bootstrap", {
      secret,
      email: "racer@example.com",
      displayName: "ผู้แข่งเปลี่ยนรหัส",
      password: "racer-original-password",
      familyName: "หอแข่งเปลี่ยนรหัส",
    });
    const cookie = cookieFrom(bootstrap);

    const [first, second] = await Promise.all([
      post(
        "/api/auth/password",
        { currentPassword: "racer-original-password", newPassword: "racer-new-password-a" },
        cookie,
      ),
      post(
        "/api/auth/password",
        { currentPassword: "racer-original-password", newPassword: "racer-new-password-b" },
        cookie,
      ),
    ]);

    const statuses = [first.status, second.status];
    const winners = statuses.filter((status) => status === 200);
    const losers = statuses.filter((status) => status !== 200);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    // ฝ่ายแพ้ถูกปฏิเสธได้สองแบบตามจังหวะ: 409 เมื่อ UPDATE แบบมีเงื่อนไขในคำขอ
    // ของตัวเองพบว่ารหัสผ่านถูกเปลี่ยนไปแล้ว หรือ 401 เมื่อ requireAuth ของ
    // คำขอตัวเองพบว่าเซสชันที่ใช้ร่วมกันถูกเพิกถอนไปแล้วจากฝ่ายชนะ
    expect([401, 409]).toContain(losers[0]);

    const firstWon = first.status === 200;
    const winningResponse = firstWon ? first : second;
    const losingResponse = firstWon ? second : first;
    const winningPassword = firstWon ? "racer-new-password-a" : "racer-new-password-b";
    const losingPassword = firstWon ? "racer-new-password-b" : "racer-new-password-a";

    // ฝ่ายแพ้ต้องไม่ได้เซสชันใหม่ที่ใช้งานได้เลย
    expect(losingResponse.headers.get("set-cookie")).toBeNull();

    const winningCookie = cookieFrom(winningResponse);
    expect((await SELF.fetch(`${base}/api/rooms`, { headers: { cookie: winningCookie } })).status).toBe(200);

    const loginWinner = await post("/api/auth/login", { email: "racer@example.com", password: winningPassword });
    expect(loginWinner.status).toBe(200);

    const loginLoser = await post("/api/auth/login", { email: "racer@example.com", password: losingPassword });
    expect(loginLoser.status).toBe(401);
  });
});
