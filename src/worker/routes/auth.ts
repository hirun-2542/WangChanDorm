import { Hono } from "hono";
import type { AppEnv } from "../lib/auth";
import { isSecureRequest, maxFamilyMembers, requireAuth, sameOriginOnly } from "../lib/auth";
import {
  clearedGoogleStateCookie,
  exchangeGoogleCode,
  googleAuthorizeUrl,
  googleRedirectUri,
  googleStateCookie,
  readGoogleStateCookie,
} from "../lib/google";
import {
  clearedSessionCookie,
  createSession,
  hashToken,
  newSessionToken,
  revokeSession,
  sessionCookie,
} from "../lib/session";
import { errorBody } from "./shared";

const auth = new Hono<AppEnv>();

auth.use("*", sameOriginOnly);

/** ครอบครัวที่ migration สร้างไว้ให้ข้อมูลเดิม รอเจ้าของมา claim */
const legacyFamilyId = "00000000-0000-4000-8000-000000000001";

const maxEmailLength = 254;

function normaliseEmail(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const email = value.trim().toLowerCase();

  if (email.length < 3 || email.length > maxEmailLength || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null;
  }

  return email;
}

/** เทียบอีเมลแบบไม่สนตัวพิมพ์ — ใช้ตัดสินว่าใครเป็นเจ้าของที่ตั้งค่าไว้ */
function sameEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** อีเมลเจ้าของระบบที่ตั้งไว้ใน config — ค่าว่างแปลว่ายังไม่ได้ตั้ง */
function configuredOwnerEmail(env: Env): string {
  return normaliseEmail(env.OWNER_EMAIL ?? "") ?? "";
}

/** ครอบครัวเดิมมีเจ้าของแล้วหรือยัง — ตัวตัดสินว่าใครมีสิทธิ์ยึดข้อมูลเดิม */
async function familyHasOwner(db: D1Database, family: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS one FROM family_members WHERE family_id = ? LIMIT 1")
    .bind(family)
    .first<{ one: number }>();

  return row !== null;
}

/**
 * เพิ่มสมาชิกโดยไม่ให้เกินเพดาน แม้สองคำขอจะมาพร้อมกัน
 *
 * เงื่อนไขนับอยู่ในคำสั่ง INSERT เดียว และ ON CONFLICT ทำให้การเพิ่มซ้ำ
 * (คำขอที่แข่งกันของคนเดียวกัน) ไม่กลายเป็น error
 * คืน true เมื่อได้เป็นสมาชิกจริง ๆ ไม่ว่าจะเพิ่งเพิ่มหรือมีอยู่ก่อนแล้ว
 */
async function joinFamilyOnce(
  db: D1Database,
  family: string,
  userId: string,
  role: string,
): Promise<boolean> {
  const inserted = await db
    .prepare(
      `INSERT INTO family_members (family_id, user_id, role)
       SELECT ?, ?, ? WHERE (SELECT COUNT(*) FROM family_members WHERE family_id = ?) < ?
       ON CONFLICT(family_id, user_id) DO NOTHING`,
    )
    .bind(family, userId, role, family, maxFamilyMembers)
    .run();

  if (inserted.meta.changes > 0) {
    return true;
  }

  // ไม่ได้เพิ่มแถวใหม่: เป็นสมาชิกอยู่แล้ว (คำขอที่แข่งกัน) หรือครอบครัวเต็ม
  const existing = await db
    .prepare("SELECT 1 AS one FROM family_members WHERE family_id = ? AND user_id = ?")
    .bind(family, userId)
    .first<{ one: number }>();

  return existing !== null;
}

/**
 * ตั้งเจ้าของคนแรกให้ครอบครัวเดิมที่ถือข้อมูลอยู่
 *
 * เดิมด่านนี้เป็น BOOTSTRAP_SECRET ซึ่งเจ้าของหอต้องไปหามาจากที่ไหนสักแห่ง
 * และจำไว้ ต่อมาใช้ OWNER_EMAIL ที่ตั้งไว้ใน config แทน และตอนนี้เหลือทางเดียว
 * คือเข้าด้วย Google ด้วยอีเมลนั้น: ตั้งบัญชีได้เฉพาะตอนที่ครอบครัวเดิมยังไม่มี
 * เจ้าของเท่านั้น
 *
 * ไม่เปิดสร้างครอบครัวใหม่จากที่นี่อีกแล้ว — การเพิ่มคนเข้าครอบครัวต้องผ่าน
 * เจ้าของครอบครัวเท่านั้น (คำเชิญ) จึงไม่มีทางเกิดครอบครัวแปลกปลอมขึ้นเอง
 */
async function claimLegacyFamily(
  db: D1Database,
  email: string,
  displayName: string,
  familyName: string,
): Promise<{ userId: string; familyId: string } | "taken"> {
  const userId = crypto.randomUUID();

  // "ยังไม่มีเจ้าของ" ต้องเป็นเงื่อนไขของการสร้างบัญชีเอง ไม่ใช่ตรวจก่อนแล้วค่อยเขียน
  // สองคำขอที่มาพร้อมกันจึงยึดครอบครัวเดียวกันได้ไม่ทั้งคู่ (SQLite เรียงคิวการเขียน
  // คำขอที่สองจึงเห็นผลของคำขอแรกแล้ว)
  //
  // คำสั่งที่สองมี EXISTS กำกับเพราะ family_members อ้าง users(id): ถ้าคำสั่งแรก
  // ไม่ได้สร้างผู้ใช้ (เพราะมีเจ้าของแล้ว) คำสั่งที่สองต้องไม่ทำอะไร ไม่ใช่พังเรื่อง FK
  //
  // password_hash เก็บเป็นค่าว่างเพราะทั้งระบบเลิกใช้รหัสผ่านแล้ว เข้าด้วย Google
  // ทางเดียว คอลัมน์ยังเป็น NOT NULL อยู่จึงต้องใส่อะไรไป
  const statements = [
    db
      .prepare(
        `INSERT INTO users (id, email, display_name, password_hash)
         SELECT ?, ?, ?, ''
         WHERE NOT EXISTS (SELECT 1 FROM family_members WHERE family_id = ?)`,
      )
      .bind(userId, email, displayName, legacyFamilyId),
    db
      .prepare(
        `INSERT INTO family_members (family_id, user_id, role)
         SELECT ?, ?, 'owner' WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)`,
      )
      .bind(legacyFamilyId, userId, userId),
  ];

  if (familyName !== "") {
    statements.push(
      db.prepare("UPDATE families SET name = ? WHERE id = ?").bind(familyName, legacyFamilyId),
    );
  }

  const results = await db.batch(statements);

  if ((results[1]?.meta.changes ?? 0) === 0) {
    return "taken";
  }

  return { userId, familyId: legacyFamilyId };
}



/** พาไปหน้าเลือกบัญชีของ Google พร้อม state ที่เราจำไว้ */
auth.get("/google/start", (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID ?? "";

  if (clientId === "") {
    return c.redirect("/?auth=error&reason=google_disabled");
  }

  const state = newSessionToken();
  const redirectUri = googleRedirectUri(c.req.url);
  const response = c.redirect(googleAuthorizeUrl(clientId, redirectUri, state));

  response.headers.append("set-cookie", googleStateCookie(state, isSecureRequest(c)));

  return response;
});

/**
 * สร้างคำตอบเด้งกลับหน้าแรก
 *
 * สร้างเองแทน Response.redirect() เพราะ Response.redirect() ให้ header ที่แก้ไม่ได้
 * (immutable) จึงต่อคุกกี้เข้าไปด้วยไม่ได้ — จะ throw ตอนรัน
 */
function redirectHome(origin: string, params: Record<string, string>, cookies: string[]): Response {
  const target = new URL("/", origin);

  for (const [key, value] of Object.entries(params)) {
    target.searchParams.set(key, value);
  }

  const headers = new Headers({ location: target.toString() });

  for (const cookie of cookies) {
    headers.append("set-cookie", cookie);
  }

  return new Response(null, { status: 302, headers });
}

/** เด้งกลับหน้าแรกพร้อมรหัสสาเหตุ ให้หน้าเว็บแปลเป็นข้อความไทย */
function googleError(c: { req: { url: string } }, reason: string, secure: boolean): Response {
  return redirectHome(
    new URL(c.req.url).origin,
    { auth: "error", reason },
    [clearedGoogleStateCookie(secure)],
  );
}

/** ล็อกอินสำเร็จ: ตั้งคุกกี้เซสชันแล้วกลับหน้าแรก พร้อมล้าง state ที่ใช้แล้ว */
function googleSuccess(c: { req: { url: string } }, token: string, secure: boolean): Response {
  return redirectHome(new URL(c.req.url).origin, {}, [
    sessionCookie(token, secure),
    clearedGoogleStateCookie(secure),
  ]);
}

auth.get("/google/callback", async (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID ?? "";
  const clientSecret = c.env.GOOGLE_CLIENT_SECRET ?? "";
  const secure = isSecureRequest(c);
  const expectedState = readGoogleStateCookie(c.req.header("cookie"));
  const state = c.req.query("state") ?? "";

  const fail = (reason: string): Response => googleError(c, reason, secure);

  if (clientId === "" || clientSecret === "") {
    return fail("google_disabled");
  }

  if (c.req.query("error") !== undefined) {
    return fail("denied");
  }

  const code = c.req.query("code") ?? "";

  // state ต้องตรงกับคุกกี้ที่เราตั้งตอนเริ่ม ไม่งั้นเป็นคำขอที่ไม่ได้เริ่มจากเรา
  if (code === "" || state === "" || expectedState === null || state !== expectedState) {
    return fail("state");
  }

  const profile = await exchangeGoogleCode({
    code,
    clientId,
    clientSecret,
    redirectUri: googleRedirectUri(c.req.url),
  });

  if (profile === null) {
    return fail("google_failed");
  }

  const existing = await c.env.DB.prepare(
    `SELECT u.id AS user_id, u.display_name, m.family_id, m.role
     FROM users u LEFT JOIN family_members m ON m.user_id = u.id
     WHERE u.email = ?`,
  )
    .bind(profile.email)
    .first<{ user_id: string; display_name: string; family_id: string | null; role: string | null }>();

  if (existing !== null) {
    if (existing.family_id === null) {
      return fail("no_family");
    }

    const token = await createSession(c.env.DB, existing.user_id, existing.family_id);

    return googleSuccess(c, token, secure);
  }

  // ยังไม่มีบัญชี: รับได้เฉพาะอีเมลเจ้าของที่ตั้งค่าไว้ หรืออีเมลที่มีคำเชิญค้าง
  const ownerEmail = configuredOwnerEmail(c.env);

  if (ownerEmail !== "" && sameEmail(profile.email, ownerEmail) && !(await familyHasOwner(c.env.DB, legacyFamilyId))) {
    const claimed = await claimLegacyFamily(c.env.DB, profile.email, profile.displayName, "");

    if (claimed !== "taken") {
      const token = await createSession(c.env.DB, claimed.userId, claimed.familyId);

      return googleSuccess(c, token, secure);
    }
  }

  const invite = await c.env.DB.prepare(
    `SELECT token_hash, family_id, role FROM family_invites
     WHERE email = ? AND accepted_at IS NULL AND expires_at > datetime('now')
     ORDER BY created_at ASC LIMIT 1`,
  )
    .bind(profile.email)
    .first<{ token_hash: string; family_id: string; role: string }>();

  if (invite === null) {
    return fail("not_invited");
  }

  // สร้างบัญชีให้ก่อนแล้วค่อยเข้าครอบครัว เพราะ family_members อ้าง users(id)
  await c.env.DB.prepare(
    "INSERT INTO users (id, email, display_name, password_hash) VALUES (?, ?, ?, '') ON CONFLICT(email) DO NOTHING",
  )
    .bind(crypto.randomUUID(), profile.email, profile.displayName)
    .run();

  const created = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?")
    .bind(profile.email)
    .first<{ id: string }>();

  if (created === null) {
    return fail("google_failed");
  }

  const joined = await joinFamilyOnce(c.env.DB, invite.family_id, created.id, invite.role === "owner" ? "owner" : "member");

  if (!joined) {
    return fail("family_full");
  }

  await c.env.DB.prepare(
    "UPDATE family_invites SET accepted_at = datetime('now'), accepted_by = ? WHERE token_hash = ? AND accepted_at IS NULL",
  )
    .bind(created.id, invite.token_hash)
    .run();

  const token = await createSession(c.env.DB, created.id, invite.family_id);

  return googleSuccess(c, token, secure);
});



/**
 * ข้อมูลคำเชิญสำหรับหน้าเข้าครอบครัวของผู้รับ
 *
 * คนที่เปิดลิงก์คือคนที่ยังไม่มีบัญชี เส้นทางนี้จึงอยู่ใต้ /api/auth/ ที่ไม่ต้องล็อกอิน
 * และตอบเฉพาะสิ่งที่ผู้ถือลิงก์ควรเห็นอยู่แล้ว — ชื่อหอ · อีเมลที่ถูกเชิญ · วันหมดอายุ
 * ไม่ตอบว่าใครเชิญหรือมีใครอยู่ในครอบครัวแล้วบ้าง
 */
auth.get("/invites/:token", async (c) => {
  const rawToken = c.req.param("token").trim();

  if (rawToken === "" || rawToken.length > 200) {
    return c.json(errorBody("VALIDATION", "คำเชิญไม่ถูกต้องหรือหมดอายุแล้ว", "token"), 400);
  }

  const invite = await c.env.DB.prepare(
    `SELECT i.email, i.expires_at, f.name AS family_name
     FROM family_invites i
     JOIN families f ON f.id = i.family_id
     WHERE i.token_hash = ? AND i.accepted_at IS NULL AND i.expires_at > datetime('now')`,
  )
    .bind(await hashToken(rawToken))
    .first<{ email: string; expires_at: string; family_name: string }>();

  if (invite === null) {
    return c.json(errorBody("VALIDATION", "คำเชิญไม่ถูกต้องหรือหมดอายุแล้ว", "token"), 400);
  }

  return c.json({
    ok: true,
    familyName: invite.family_name,
    email: invite.email,
    expiresAt: invite.expires_at,
  });
});

/** สร้างบัญชีจากคำเชิญเท่านั้น ไม่เปิดสมัครอิสระ */


auth.post("/logout", requireAuth, async (c) => {
  await revokeSession(c.env.DB, c.get("sessionToken"));
  c.header("set-cookie", clearedSessionCookie(isSecureRequest(c)));

  return c.json({ ok: true });
});

auth.get("/me", requireAuth, (c) => {
  const session = c.get("session");

  return c.json({
    ok: true,
    user: {
      id: session.userId,
      email: session.email,
      displayName: session.displayName,
      role: session.role,
      familyId: session.familyId,
    },
  });
});

export default auth;
