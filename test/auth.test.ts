import { SELF, env } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createFamily, signIn, type TestSession } from "./auth-helper";

const base = "https://example.com";
const ownerEmail = env.OWNER_EMAIL;
const legacyFamilyId = "00000000-0000-4000-8000-000000000001";

const googleTokenUrl = "https://oauth2.googleapis.com/token";
const googleUserinfoUrl = "https://www.googleapis.com/oauth2/v3/userinfo";

interface StubbedGoogleProfile {
  email: string;
  name: string;
  email_verified?: boolean;
}

/** แทนที่ fetch ขาออกด้วยคำตอบปลอมของ Google (แลก code + ขอโปรไฟล์) */
function stubGoogle(profile: StubbedGoogleProfile): void {
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (url === googleTokenUrl) {
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: "stub-access-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }

    if (url === googleUserinfoUrl) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            email: profile.email,
            name: profile.name,
            email_verified: profile.email_verified ?? true,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }

    return Promise.resolve(new Response("unexpected", { status: 500 }));
  });
}

/** เริ่มล็อกอินด้วย Google แล้วคืน state ที่เซิร์ฟเวอร์ตั้งไว้ในคุกกี้ */
async function googleStart(): Promise<{ state: string; cookie: string; location: string }> {
  const response = await SELF.fetch(`${base}/api/auth/google/start`, { redirect: "manual" });
  const location = response.headers.get("location") ?? "";
  const state = new URL(location).searchParams.get("state") ?? "";
  const setCookie = response.headers.get("set-cookie") ?? "";

  return { state, cookie: setCookie.split(";")[0] ?? "", location };
}

/** เข้าสู่ระบบด้วย Google ครบวงจรในเทสต์ แล้วคืนคุกกี้เซสชัน (ว่างถ้าไม่สำเร็จ) */
async function googleSignIn(email: string, name: string): Promise<string> {
  const { state, cookie } = await googleStart();
  stubGoogle({ email, name });

  const response = await SELF.fetch(
    `${base}/api/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`,
    { headers: { cookie }, redirect: "manual" },
  );

  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

// fetch ขาออกถูกแทนที่ในเทสต์ Google ต้องคืนของจริงทุกครั้ง ไม่งั้นเทสต์ถัดไป
// ที่ต้องเรียกออกไปข้างนอกจะได้คำตอบปลอมค้างอยู่
afterEach(() => {
  vi.restoreAllMocks();
});

async function post(path: string, body: unknown, cookie?: string): Promise<Response> {
  return SELF.fetch(`${base}${path}`, {
    method: "POST",
    headers: cookie === undefined ? { "content-type": "application/json" } : { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}



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



describe("Google sign-in", () => {
  it("claims the legacy family for the configured owner email when nobody owns it yet", async () => {
    // ในไฟล์นี้ครอบครัวเดิมยังไม่มีเจ้าของ เพราะการยึดเกิดขึ้นได้ทาง Google เท่านั้น
    const sessionCookie = await googleSignIn(ownerEmail, "เจ้าของหอ");
    expect(sessionCookie).toContain("wangchan_session=");

    const me = await SELF.fetch(`${base}/api/auth/me`, { headers: { cookie: sessionCookie } });
    const body = await me.json<{ user: { email: string; role: string; familyId: string } }>();

    expect(body.user.role).toBe("owner");
    expect(body.user.familyId).toBe(legacyFamilyId);

    const members = await env.DB.prepare("SELECT COUNT(*) AS n FROM family_members WHERE family_id = ?")
      .bind(legacyFamilyId)
      .first<{ n: number }>();
    expect(members?.n).toBe(1);
  });

  it("sends the browser to Google with our redirect URI and a state cookie", async () => {
    const { state, cookie, location } = await googleStart();
    const url = new URL(location);

    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("client_id")).toBe(env.GOOGLE_CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(`${base}/api/auth/google/callback`);
    expect(url.searchParams.get("scope")).toContain("email");
    expect(state.length).toBeGreaterThan(30);
    expect(cookie).toContain("wangchan_google_state=");
  });

  it("rejects a callback whose state does not match the cookie", async () => {
    const { cookie } = await googleStart();
    stubGoogle({ email: ownerEmail, name: "เจ้าของหอ" });

    const response = await SELF.fetch(
      `${base}/api/auth/google/callback?code=abc&state=not-the-state`,
      { headers: { cookie }, redirect: "manual" },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("reason=state");
    expect((response.headers.get("set-cookie") ?? "").includes("wangchan_session=")).toBe(false);
  });

  it("signs in an existing account with the email Google verified", async () => {
    const { state, cookie } = await googleStart();
    stubGoogle({ email: ownerEmail.toUpperCase(), name: "เจ้าของหอ" });

    const response = await SELF.fetch(
      `${base}/api/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`,
      { headers: { cookie }, redirect: "manual" },
    );

    expect(response.status).toBe(302);

    const sessionCookie = (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    expect(sessionCookie).toContain("wangchan_session=");

    const me = await SELF.fetch(`${base}/api/auth/me`, { headers: { cookie: sessionCookie } });
    expect(me.status).toBe(200);
    expect((await me.json<{ user: { email: string; role: string } }>()).user.email).toBe(ownerEmail);
  });

  it("refuses an email that was never invited", async () => {
    const { state, cookie } = await googleStart();
    stubGoogle({ email: "stranger@example.com", name: "คนแปลกหน้า" });

    const response = await SELF.fetch(
      `${base}/api/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`,
      { headers: { cookie }, redirect: "manual" },
    );

    expect(response.headers.get("location")).toContain("reason=not_invited");
  });

  it("refuses an email Google has not verified", async () => {
    const { state, cookie } = await googleStart();
    stubGoogle({ email: ownerEmail, name: "เจ้าของหอ", email_verified: false });

    const response = await SELF.fetch(
      `${base}/api/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`,
      { headers: { cookie }, redirect: "manual" },
    );

    expect(response.headers.get("location")).toContain("reason=google_failed");
  });

  it("treats a denied consent screen as a normal cancellation", async () => {
    const { state, cookie } = await googleStart();

    const response = await SELF.fetch(
      `${base}/api/auth/google/callback?error=access_denied&state=${encodeURIComponent(state)}`,
      { headers: { cookie }, redirect: "manual" },
    );

    expect(response.headers.get("location")).toContain("reason=denied");
  });

  it("lets an invited email join the family with Google instead of a password", async () => {
    const family = await createFamily("หอเชิญด้วยกูเกิล");
    const owner = await signIn("owner", family);

    const invited = await SELF.fetch(`${base}/api/family/invites`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({ email: "joiner@example.com", role: "member" }),
    });
    expect(invited.status).toBe(201);

    const { state, cookie } = await googleStart();
    stubGoogle({ email: "joiner@example.com", name: "ผู้ร่วมหอ" });

    const response = await SELF.fetch(
      `${base}/api/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`,
      { headers: { cookie }, redirect: "manual" },
    );

    const sessionCookie = (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const me = await SELF.fetch(`${base}/api/auth/me`, { headers: { cookie: sessionCookie } });
    const body = await me.json<{ user: { email: string; role: string; familyId: string } }>();

    expect(body.user.email).toBe("joiner@example.com");
    expect(body.user.role).toBe("member");
    expect(body.user.familyId).toBe(family);
  });

  it("refuses to add a third member to a family that is already full", async () => {
    const family = await createFamily("หอกูเกิลเต็ม");
    const owner = await signIn("owner", family);

    // ออกคำเชิญสองใบตั้งแต่ยังมีสมาชิกคนเดียว ทั้งสองใบยังไม่ถูกใช้
    for (const email of ["first@example.com", "second@example.com"]) {
      const invited = await post("/api/family/invites", { email, role: "member" }, owner.cookie);
      expect(invited.status).toBe(201);
    }

    // คนแรกเข้าครอบครัวได้ ครอบครัวจึงเต็มเพดาน 2 คน
    const firstSession = await googleSignIn("first@example.com", "คนแรก");
    expect((await SELF.fetch(`${base}/api/auth/me`, { headers: { cookie: firstSession } })).status).toBe(200);

    // คนที่สองยังมีคำเชิญค้างอยู่ แต่เข้าครอบครัวไม่ได้เพราะเพดาน
    const { state, cookie } = await googleStart();
    stubGoogle({ email: "second@example.com", name: "คนที่สอง" });

    const response = await SELF.fetch(
      `${base}/api/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`,
      { headers: { cookie }, redirect: "manual" },
    );

    expect(response.headers.get("location")).toContain("reason=family_full");

    const members = await env.DB.prepare("SELECT COUNT(*) AS n FROM family_members WHERE family_id = ?")
      .bind(family)
      .first<{ n: number }>();
    expect(members?.n).toBe(2);
  });

  it("never moves an account that already belongs to another family", async () => {
    // บัญชีที่เข้าอยู่ครอบครัวแรกแล้ว
    const firstFamily = await createFamily("หอแรกที่เข้าอยู่");
    const firstOwner = await signIn("owner", firstFamily);
    await post("/api/family/invites", { email: "mover@example.com", role: "member" }, firstOwner.cookie);

    const joined = await googleSignIn("mover@example.com", "ผู้ย้าย");
    const joinedMe = await (
      await SELF.fetch(`${base}/api/auth/me`, { headers: { cookie: joined } })
    ).json<{ user: { familyId: string } }>();
    expect(joinedMe.user.familyId).toBe(firstFamily);

    // หอที่สองออกคำเชิญให้อีเมลเดิม แม้เป็นสิทธิ์เจ้าของก็ยังย้ายครอบครัวไม่ได้
    const secondFamily = await createFamily("หอที่สองที่อยากได้คนนี้");
    const secondOwner = await signIn("owner", secondFamily);
    await post("/api/family/invites", { email: "mover@example.com", role: "owner" }, secondOwner.cookie);

    const again = await googleSignIn("mover@example.com", "ผู้ย้าย");
    const againMe = await (
      await SELF.fetch(`${base}/api/auth/me`, { headers: { cookie: again } })
    ).json<{ user: { familyId: string; role: string } }>();

    expect(againMe.user.familyId).toBe(firstFamily);
    expect(againMe.user.role).toBe("member");

    const moved = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM family_members WHERE family_id = ? AND user_id = (SELECT id FROM users WHERE email = ?)",
    )
      .bind(secondFamily, "mover@example.com")
      .first<{ n: number }>();
    expect(moved?.n).toBe(0);
  });
});

describe("session", () => {
  let session: TestSession;

  beforeAll(async () => {
    const family = await createFamily("หอทดสอบเซสชัน");
    session = await signIn("owner", family);
  });

  it("opens the owner API once signed in", async () => {
    const response = await SELF.fetch(`${base}/api/rooms`, { headers: { cookie: session.cookie } });
    expect(response.status).toBe(200);
  });

  it("reports the signed-in user", async () => {
    const response = await SELF.fetch(`${base}/api/auth/me`, { headers: { cookie: session.cookie } });
    const body = await response.json<{ user: { email: string; role: string; familyId: string } }>();

    expect(body.user.role).toBe("owner");
    expect(body.user.familyId).toBe(session.familyId);
  });

  it("stores only a hash of the session token", async () => {
    const token = session.cookie.split("=")[1] ?? "";
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?")
      .bind(token)
      .first<{ n: number }>();

    expect(token.length).toBeGreaterThan(30);
    expect(row?.n).toBe(0);
  });

  it("revokes the session on logout", async () => {
    const family = await createFamily("หอทดสอบออกจากระบบ");
    const throwaway = await signIn("owner", family);

    expect((await SELF.fetch(`${base}/api/rooms`, { headers: { cookie: throwaway.cookie } })).status).toBe(200);

    await post("/api/auth/logout", {}, throwaway.cookie);

    expect((await SELF.fetch(`${base}/api/rooms`, { headers: { cookie: throwaway.cookie } })).status).toBe(401);
  });

  it("refuses a cross-origin state change", async () => {
    const response = await SELF.fetch(`${base}/api/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: session.cookie, origin: "https://evil.example" },
      body: JSON.stringify({ roomNumber: "999", rent: 1000 }),
    });

    expect(response.status).toBe(403);
  });
});



describe("invite preview", () => {
  it("tells the person opening the link which dorm invited them, and to which email", async () => {
    const family = await createFamily("หอที่บอกชื่อตัวเอง");
    const owner = await signIn("owner", family);

    const invited = await post("/api/family/invites", { email: "invited@example.com", role: "member" }, owner.cookie);
    const { invite } = await invited.json<{ invite: { token: string } }>();

    const response = await SELF.fetch(`${base}/api/auth/invites/${encodeURIComponent(invite.token)}`);
    expect(response.status).toBe(200);

    const body = await response.json<{ ok: true; familyName: string; email: string; expiresAt: string }>();
    expect(body.familyName).toBe("หอที่บอกชื่อตัวเอง");
    expect(body.email).toBe("invited@example.com");
    expect(body.expiresAt.length).toBeGreaterThan(0);

    // เส้นนี้เปิดให้คนที่ยังไม่มีบัญชี จึงต้องตอบเท่าที่คนถือลิงก์ควรเห็น ไม่มากกว่านั้น
    expect(Object.keys(body).sort()).toEqual(["email", "expiresAt", "familyName", "ok"]);
  });

  it("treats an unknown invite exactly like one that was already used", async () => {
    const family = await createFamily("หอคำเชิญที่ใช้แล้ว");
    const owner = await signIn("owner", family);

    const invited = await post("/api/family/invites", { email: "used@example.com", role: "member" }, owner.cookie);
    const { invite } = await invited.json<{ invite: { token: string } }>();

    // ทำเครื่องหมายว่าถูกใช้ไปแล้วด้วยการเขียนตรงลงตาราง เพราะการเข้าครอบครัวจริง
    // ต้องผ่าน Google ซึ่งมีเทสต์ของตัวเองอยู่ด้านบน
    await env.DB.prepare("UPDATE family_invites SET accepted_at = datetime('now') WHERE email = ?")
      .bind("used@example.com")
      .run();

    for (const token of ["no-such-token", invite.token]) {
      const response = await SELF.fetch(`${base}/api/auth/invites/${encodeURIComponent(token)}`);
      const body = await response.json<{ error: { message: string } }>();

      expect([token, response.status]).toEqual([token, 400]);
      expect(body.error.message).toBe("คำเชิญไม่ถูกต้องหรือหมดอายุแล้ว");
    }
  });
});

describe("family membership", () => {
  // ทุกเทสต์ใช้ครอบครัวของตัวเอง เพราะหนึ่งครอบครัวรับได้ 2 คน (เพดานของผลิตภัณฑ์)
  // การยืมครอบครัวเดิมจะทำให้เทสต์หลัง ๆ เจอ "ครอบครัวเต็ม" แทนที่จะทดสอบสิ่งที่ตั้งใจ

  it("creates an invite link and stores only its hash", async () => {
    const family = await createFamily("หอเชิญสมาชิก");
    const owner = await signIn("owner", family);

    const invited = await post("/api/family/invites", { email: "helper@example.com", role: "member" }, owner.cookie);
    expect(invited.status).toBe(201);

    const { invite } = await invited.json<{ invite: { token: string; url: string } }>();
    expect(invite.url).toContain("#invite/");

    const stored = await env.DB.prepare("SELECT COUNT(*) AS n FROM family_invites WHERE token_hash = ?")
      .bind(invite.token)
      .first<{ n: number }>();
    expect(stored?.n).toBe(0);
  });

  it("stops a family at its member limit", async () => {
    const family = await createFamily("หอเต็ม");
    const owner = await signIn("owner", family);
    await signIn("member", family);

    // ครบ 2 คนแล้ว: ออกคำเชิญเพิ่มไม่ได้
    const extra = await post("/api/family/invites", { email: "third@example.com", role: "member" }, owner.cookie);
    expect(extra.status).toBe(409);
  });

  it("keeps at least one owner and revokes sessions when a member is removed", async () => {
    const family = await createFamily("หอถอดสมาชิก");
    const owner = await signIn("owner", family);
    const leaver = await signIn("member", family);

    expect((await SELF.fetch(`${base}/api/rooms`, { headers: { cookie: leaver.cookie } })).status).toBe(200);

    const removed = await SELF.fetch(`${base}/api/family/members/${leaver.userId}`, {
      method: "DELETE",
      headers: { cookie: owner.cookie },
    });
    expect(removed.status).toBe(200);

    expect((await SELF.fetch(`${base}/api/rooms`, { headers: { cookie: leaver.cookie } })).status).toBe(401);
  });

  it("refuses to demote the last owner", async () => {
    const family = await createFamily("หอเจ้าของคนเดียว");
    const owner = await signIn("owner", family);

    const response = await SELF.fetch(`${base}/api/family/members/${owner.userId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({ role: "member" }),
    });

    expect(response.status).toBe(409);
  });

  it("cannot be raced to zero owners by two owners demoting each other concurrently", async () => {
    // ครอบครัวแยกต่างหากที่มีเจ้าของสองคนพอดี
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

  it("does not let a member manage the family or see pending invites", async () => {
    const family = await createFamily("หอสมาชิกอ่านอย่างเดียว");
    const owner = await signIn("owner", family);
    const member = await signIn("member", family);

    // เจ้าของยังออกคำเชิญได้ตามกติกาปกติ (แต่ครอบครัวเต็มแล้วจึงได้ 409)
    const secondInvite = await post("/api/family/invites", { email: "nobody@example.com", role: "member" }, owner.cookie);
    expect(secondInvite.status).toBe(409);

    // สมาชิกถูกกันด้วยสิทธิ์ ไม่ใช่เพราะครอบครัวเต็ม — คนละเหตุผลกับเจ้าของ
    const forbidden = await post("/api/family/invites", { email: "nope@example.com", role: "member" }, member.cookie);
    expect(forbidden.status).toBe(403);

    // ดูรายชื่อคนในครอบครัวได้ แต่ไม่เห็นรายการคำเชิญของเจ้าของ
    const overview = await (
      await SELF.fetch(`${base}/api/family`, { headers: { cookie: member.cookie } })
    ).json<{ members: { email: string }[]; invites: unknown[]; maxMembers: number }>();

    expect(overview.members).toHaveLength(2);
    expect(overview.invites).toEqual([]);
    expect(overview.maxMembers).toBe(2);
  });
});


