import { SELF, env } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { hashPassword, verifyPassword } from "../src/worker/lib/password";
import { createFamily, signIn } from "./auth-helper";

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

// fetch ขาออกถูกแทนที่ในเทสต์ Google ต้องคืนของจริงทุกครั้ง ไม่งั้นเทสต์ถัดไป
// ที่ต้องเรียกออกไปข้างนอกจะได้คำตอบปลอมค้างอยู่
afterEach(() => {
  vi.restoreAllMocks();
});

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

describe("setting up the first owner", () => {
  it("refuses an email that is not the configured owner", async () => {
    const response = await post("/api/auth/setup", {
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

  it("refuses a short password", async () => {
    const response = await post("/api/auth/setup", {
      email: ownerEmail,
      displayName: "รหัสสั้น",
      password: "sh0rt",
    });

    expect(response.status).toBe(400);
    expect((await response.json<{ error: { field?: string } }>()).error.field).toBe("password");
  });

  it("claims the family holding the existing data, and only once even under a race", async () => {
    const setup = () =>
      post("/api/auth/setup", {
        email: ` ${ownerEmail.toUpperCase()} `,
        displayName: "เจ้าของหอ",
        password: "a-long-enough-password",
        familyName: "หอพักวังจันทร์",
      });

    // สองคำขอที่อีเมลถูกต้องมาพร้อมกัน: เงื่อนไข "ยังไม่มีเจ้าของ" ต้องอยู่ใน
    // คำสั่ง SQL เดียวกัน ไม่งั้นทั้งคู่จะผ่านและกลายเป็นสองเจ้าของคนละบัญชี
    const [first, second] = await Promise.all([setup(), setup()]);
    const statuses = [first.status, second.status];

    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(1);

    const winner = first.status === 201 ? first : second;
    const body = await winner.json<{ user: { familyId: string; email: string; role: string } }>();

    expect(body.user.familyId).toBe(legacyFamilyId);
    expect(body.user.email).toBe(ownerEmail);
    expect(body.user.role).toBe("owner");

    const members = await env.DB.prepare("SELECT COUNT(*) AS n FROM family_members WHERE family_id = ?")
      .bind(legacyFamilyId)
      .first<{ n: number }>();
    expect(members?.n).toBe(1);

    const family = await env.DB.prepare("SELECT name FROM families WHERE id = ?")
      .bind(legacyFamilyId)
      .first<{ name: string }>();
    expect(family?.name).toBe("หอพักวังจันทร์");

    const cookie = winner.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");

    // เซสชันที่ได้มาใช้ได้จริง
    const me = await SELF.fetch(`${base}/api/auth/me`, {
      headers: { cookie: cookie.split(";")[0] ?? "" },
    });
    expect(me.status).toBe(200);
  });

  it("refuses a second setup once the family has an owner", async () => {
    const response = await post("/api/auth/setup", {
      email: ownerEmail,
      displayName: "คนที่สอง",
      password: "a-long-enough-password",
    });

    expect(response.status).toBe(409);
  });
});

describe("Google sign-in", () => {
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

/**
 * สร้างบัญชีที่มีรหัสผ่านจริงผ่านเส้นทางการเชิญ (ทางเดียวที่สร้างบัญชีได้แล้ว)
 * คืน cookie ของสมาชิกคนนั้นพร้อม id ครอบครัวที่เขาเข้าร่วม
 */
async function createAccountWithPassword(
  email: string,
  password: string,
  displayName = "ผู้ทดสอบ",
): Promise<{ cookie: string; familyId: string }> {
  const family = await createFamily("หอทดสอบบัญชี");
  const owner = await signIn("owner", family);

  const invited = await post("/api/family/invites", { email, role: "member" }, owner.cookie);
  const { invite } = await invited.json<{ invite: { token: string } }>();

  const accepted = await post("/api/auth/accept-invite", {
    token: invite.token,
    displayName,
    password,
  });

  return { cookie: cookieFrom(accepted), familyId: family };
}

describe("family membership", () => {
  // ทุกเทสต์ใช้ครอบครัวของตัวเอง เพราะหนึ่งครอบครัวรับได้ 2 คน (เพดานของผลิตภัณฑ์)
  // การยืมครอบครัวเดิมจะทำให้เทสต์หลัง ๆ เจอ "ครอบครัวเต็ม" แทนที่จะทดสอบสิ่งที่ตั้งใจ

  it("invites a new person and lets them join with their own credentials", async () => {
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
    expect(me.user.familyId).toBe(family);
  });

  it("refuses the same invite a second time", async () => {
    const family = await createFamily("หอคำเชิญซ้ำ");
    const owner = await signIn("owner", family);

    const invited = await post("/api/family/invites", { email: "twice@example.com", role: "member" }, owner.cookie);
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

  it("stops a family at its member limit", async () => {
    const family = await createFamily("หอเต็ม");
    const owner = await signIn("owner", family);

    const invited = await post("/api/family/invites", { email: "second@example.com", role: "member" }, owner.cookie);
    expect(invited.status).toBe(201);

    const { invite } = await invited.json<{ invite: { token: string } }>();
    const accepted = await post("/api/auth/accept-invite", {
      token: invite.token,
      displayName: "คนที่สอง",
      password: "another-long-password",
    });
    expect(accepted.status).toBe(201);

    // ตอนนี้ครบ 2 คนแล้ว: ออกคำเชิญเพิ่มไม่ได้
    const extra = await post("/api/family/invites", { email: "third@example.com", role: "member" }, owner.cookie);
    expect(extra.status).toBe(409);
  });

  it("refuses to let an invite that was issued earlier push a family past its limit", async () => {
    const family = await createFamily("หอเต็มระหว่างทาง");
    const owner = await signIn("owner", family);

    // ออกคำเชิญสองใบตั้งแต่ยังมีสมาชิกคนเดียว ใบไหนถึงก่อนก็ได้ ไม่มีใบไหนพาเกินเพดาน
    const firstInvite = await post("/api/family/invites", { email: "one@example.com", role: "member" }, owner.cookie);
    const secondInvite = await post("/api/family/invites", { email: "two@example.com", role: "member" }, owner.cookie);

    const firstToken = (await firstInvite.json<{ invite: { token: string } }>()).invite.token;
    const secondToken = (await secondInvite.json<{ invite: { token: string } }>()).invite.token;

    const accepted = await post("/api/auth/accept-invite", {
      token: firstToken,
      displayName: "คนแรก",
      password: "another-long-password",
    });
    const rejected = await post("/api/auth/accept-invite", {
      token: secondToken,
      displayName: "คนที่สอง",
      password: "another-long-password",
    });

    expect(accepted.status).toBe(201);
    expect(rejected.status).toBe(409);

    const members = await env.DB.prepare("SELECT COUNT(*) AS n FROM family_members WHERE family_id = ?")
      .bind(family)
      .first<{ n: number }>();
    expect(members?.n).toBe(2);
  });

  it("does not let an invite hand over an account that already exists", async () => {
    const outsider = await createAccountWithPassword("outsider@example.com", "outsider-long-password", "คนนอก");

    const family = await createFamily("หอที่อยากได้คนนอก");
    const owner = await signIn("owner", family);

    const crossInvite = await post("/api/family/invites", { email: "outsider@example.com", role: "owner" }, owner.cookie);
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
      displayName: "คนนอก",
      password: "outsider-long-password",
    });
    expect(correct.status).toBe(409);

    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM family_members WHERE family_id = ?")
      .bind(outsider.familyId)
      .first<{ n: number }>();
    expect(rows?.n).toBe(2);
  });

  it("keeps at least one owner and revokes sessions when a member is removed", async () => {
    const family = await createFamily("หอถอดสมาชิก");
    const owner = await signIn("owner", family);

    const invited = await post("/api/family/invites", { email: "leaver@example.com", role: "member" }, owner.cookie);
    const { invite } = await invited.json<{ invite: { token: string } }>();

    const accepted = await post("/api/auth/accept-invite", {
      token: invite.token,
      displayName: "ผู้จะถูกถอด",
      password: "another-long-password",
    });
    const leaverCookie = cookieFrom(accepted);

    const overview = await (
      await SELF.fetch(`${base}/api/family`, { headers: { cookie: owner.cookie } })
    ).json<{ members: { userId: string; email: string }[] }>();
    const leaver = overview.members.find((member) => member.email === "leaver@example.com");
    expect(leaver).toBeDefined();

    expect((await SELF.fetch(`${base}/api/rooms`, { headers: { cookie: leaverCookie } })).status).toBe(200);

    const removed = await SELF.fetch(`${base}/api/family/members/${leaver?.userId ?? ""}`, {
      method: "DELETE",
      headers: { cookie: owner.cookie },
    });
    expect(removed.status).toBe(200);

    expect((await SELF.fetch(`${base}/api/rooms`, { headers: { cookie: leaverCookie } })).status).toBe(401);
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

    const invited = await post("/api/family/invites", { email: "reader@example.com", role: "member" }, owner.cookie);
    const { invite } = await invited.json<{ invite: { token: string } }>();

    const accepted = await post("/api/auth/accept-invite", {
      token: invite.token,
      displayName: "สมาชิกอ่านอย่างเดียว",
      password: "another-long-password",
    });
    const memberCookie = cookieFrom(accepted);

    // ออกคำเชิญเพิ่มไม่ได้ (คนละใบกับที่ตัวเองใช้ไปแล้ว)
    const secondInvite = await post("/api/family/invites", { email: "nobody@example.com", role: "member" }, owner.cookie);
    expect(secondInvite.status).toBe(409);

    const forbidden = await post("/api/family/invites", { email: "nope@example.com", role: "member" }, memberCookie);
    expect(forbidden.status).toBe(403);

    // ดูรายชื่อคนในครอบครัวได้ แต่ไม่เห็นรายการคำเชิญของเจ้าของ
    const overview = await (
      await SELF.fetch(`${base}/api/family`, { headers: { cookie: memberCookie } })
    ).json<{ members: { email: string }[]; invites: unknown[]; maxMembers: number }>();

    expect(overview.members.map((member) => member.email)).toContain("reader@example.com");
    expect(overview.invites).toEqual([]);
    expect(overview.maxMembers).toBe(2);
  });
});

describe("changing password", () => {
  it("rejects the wrong current password and accepts the right one, revoking the old session", async () => {
    const account = await createAccountWithPassword("changer@example.com", "original-long-password", "ผู้เปลี่ยนรหัส");
    const oldCookie = account.cookie;

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
    const account = await createAccountWithPassword("racer@example.com", "racer-original-password", "ผู้แข่งเปลี่ยนรหัส");
    const cookie = account.cookie;

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
