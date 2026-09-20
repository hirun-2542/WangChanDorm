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
import { hashPassword, passwordError, verifyPassword } from "../lib/password";
import {
  clearedSessionCookie,
  createSession,
  hashToken,
  newSessionToken,
  revokeSession,
  sessionCookie,
  sessionExpiryIso,
} from "../lib/session";
import { errorBody, readJsonObject } from "./shared";

const auth = new Hono<AppEnv>();

auth.use("*", sameOriginOnly);

/** ครอบครัวที่ migration สร้างไว้ให้ข้อมูลเดิม รอเจ้าของมา claim */
const legacyFamilyId = "00000000-0000-4000-8000-000000000001";

/** ยอมให้ล็อกอินพลาดได้เท่านี้ครั้งต่อหนึ่งช่วงเวลา */
const maxAttempts = 8;
const attemptWindowMinutes = 15;

const maxNameLength = 80;
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

function normaliseName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const name = value.trim().replace(/\s+/g, " ");

  if (name.length < 2 || name.length > maxNameLength) {
    return null;
  }

  return name;
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

async function tooManyAttempts(db: D1Database, scope: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM login_attempts WHERE scope = ? AND attempted_at > datetime('now', ?)`,
    )
    .bind(scope, `-${attemptWindowMinutes} minutes`)
    .first<{ n: number }>();

  return (row?.n ?? 0) >= maxAttempts;
}

async function recordAttempt(db: D1Database, scope: string): Promise<void> {
  await db.batch([
    db.prepare("INSERT INTO login_attempts (id, scope) VALUES (?, ?)").bind(crypto.randomUUID(), scope),
    db.prepare("DELETE FROM login_attempts WHERE attempted_at < datetime('now', '-1 day')"),
  ]);
}

async function clearAttempts(db: D1Database, scopes: string[]): Promise<void> {
  await db.batch(scopes.map((scope) => db.prepare("DELETE FROM login_attempts WHERE scope = ?").bind(scope)));
}

function clientScope(c: { req: { header: (name: string) => string | undefined } }): string {
  return `ip:${c.req.header("cf-connecting-ip") ?? "unknown"}`;
}

/**
 * ตั้งเจ้าของคนแรกให้ครอบครัวเดิมที่ถือข้อมูลอยู่
 *
 * เดิมด่านนี้เป็น BOOTSTRAP_SECRET ซึ่งเจ้าของหอต้องไปหามาจากที่ไหนสักแห่ง
 * และจำไว้ ตอนนี้ใช้ OWNER_EMAIL ที่ตั้งไว้ใน config แทน: ตั้งบัญชีได้เฉพาะ
 * อีเมลนั้น และเฉพาะตอนที่ครอบครัวเดิมยังไม่มีเจ้าของเท่านั้น
 *
 * ไม่เปิดสร้างครอบครัวใหม่จากที่นี่อีกแล้ว — การเพิ่มคนเข้าครอบครัวต้องผ่าน
 * เจ้าของครอบครัวเท่านั้น (คำเชิญ) จึงไม่มีทางเกิดครอบครัวแปลกปลอมขึ้นเอง
 */
async function claimLegacyFamily(
  db: D1Database,
  email: string,
  displayName: string,
  passwordHash: string,
  familyName: string,
): Promise<{ userId: string; familyId: string } | "taken"> {
  const userId = crypto.randomUUID();

  // "ยังไม่มีเจ้าของ" ต้องเป็นเงื่อนไขของการสร้างบัญชีเอง ไม่ใช่ตรวจก่อนแล้วค่อยเขียน
  // สองคำขอที่มาพร้อมกันจึงยึดครอบครัวเดียวกันได้ไม่ทั้งคู่ (SQLite เรียงคิวการเขียน
  // คำขอที่สองจึงเห็นผลของคำขอแรกแล้ว)
  //
  // คำสั่งที่สองมี EXISTS กำกับเพราะ family_members อ้าง users(id): ถ้าคำสั่งแรก
  // ไม่ได้สร้างผู้ใช้ (เพราะมีเจ้าของแล้ว) คำสั่งที่สองต้องไม่ทำอะไร ไม่ใช่พังเรื่อง FK
  const statements = [
    db
      .prepare(
        `INSERT INTO users (id, email, display_name, password_hash)
         SELECT ?, ?, ?, ?
         WHERE NOT EXISTS (SELECT 1 FROM family_members WHERE family_id = ?)`,
      )
      .bind(userId, email, displayName, passwordHash, legacyFamilyId),
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

auth.post("/setup", async (c) => {
  const ownerEmail = configuredOwnerEmail(c.env);

  if (ownerEmail === "") {
    return c.json(errorBody("VALIDATION", "ยังไม่ได้ตั้งค่าอีเมลเจ้าของระบบ"), 503);
  }

  const body = await readJsonObject(c.req.raw);

  if (body === null) {
    return c.json(errorBody("VALIDATION", "รูปแบบข้อมูลไม่ถูกต้อง"), 400);
  }

  const scope = clientScope(c);

  if (await tooManyAttempts(c.env.DB, scope)) {
    return c.json(errorBody("VALIDATION", "พยายามหลายครั้งเกินไป กรุณารอสักครู่"), 429);
  }

  const email = normaliseEmail(body.email);
  const displayName = normaliseName(body.displayName);
  const passwordMessage = passwordError(body.password);

  if (email === null) {
    return c.json(errorBody("VALIDATION", "อีเมลไม่ถูกต้อง", "email"), 400);
  }

  if (displayName === null) {
    return c.json(errorBody("VALIDATION", "ชื่อต้องยาว 2–80 ตัวอักษร", "displayName"), 400);
  }

  if (passwordMessage !== null) {
    return c.json(errorBody("VALIDATION", passwordMessage, "password"), 400);
  }

  // สามคำตอบข้างล่างนี้จงใจไม่ผูกกับช่องใด (ไม่ส่ง field) เพราะหน้าจอต้องบอก
  // "ให้ทำอะไรต่อ" ไม่ใช่ชี้ว่าอีเมลผิด — ถ้าผูก field ไว้ ฝั่งเว็บจะแสดงข้อความ
  // ใต้ช่องอีเมลแทน และข้อความช่วยเหลือใน setupDetail() จะไม่ถูกเรียกเลย
  if (!sameEmail(email, ownerEmail)) {
    await recordAttempt(c.env.DB, scope);
    return c.json(
      errorBody("VALIDATION", "อีเมลนี้ไม่ใช่เจ้าของระบบที่ตั้งค่าไว้"),
      403,
    );
  }

  const rawFamilyName = typeof body.familyName === "string" ? body.familyName.trim().replace(/\s+/g, " ") : "";

  if (rawFamilyName.length > 80) {
    return c.json(errorBody("VALIDATION", "ชื่อหอต้องยาวไม่เกิน 80 ตัวอักษร", "familyName"), 400);
  }

  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: string }>();

  if (existing !== null) {
    return c.json(errorBody("DUPLICATE", "อีเมลนี้มีบัญชีอยู่แล้ว"), 409);
  }

  const claimed = await claimLegacyFamily(
    c.env.DB,
    email,
    displayName,
    hashPassword(body.password as string),
    rawFamilyName,
  );

  if (claimed === "taken") {
    return c.json(errorBody("CONFLICT", "หอนี้มีเจ้าของแล้ว กรุณาเข้าสู่ระบบ"), 409);
  }

  const token = await createSession(c.env.DB, claimed.userId, claimed.familyId);
  c.header("set-cookie", sessionCookie(token, isSecureRequest(c)));

  return c.json(
    {
      ok: true,
      user: { id: claimed.userId, email, displayName, role: "owner", familyId: claimed.familyId },
    },
    201,
  );
});

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
    const claimed = await claimLegacyFamily(c.env.DB, profile.email, profile.displayName, "", "");

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

auth.post("/login", async (c) => {
  const body = await readJsonObject(c.req.raw);

  if (body === null) {
    return c.json(errorBody("VALIDATION", "รูปแบบข้อมูลไม่ถูกต้อง"), 400);
  }

  const email = normaliseEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  const ipScope = clientScope(c);
  const emailScope = `email:${email ?? "invalid"}`;

  if ((await tooManyAttempts(c.env.DB, ipScope)) || (await tooManyAttempts(c.env.DB, emailScope))) {
    return c.json(errorBody("VALIDATION", "พยายามเข้าสู่ระบบหลายครั้งเกินไป กรุณารอสักครู่"), 429);
  }

  const failed = async () => {
    await recordAttempt(c.env.DB, ipScope);
    await recordAttempt(c.env.DB, emailScope);
    return c.json(errorBody("VALIDATION", "อีเมลหรือรหัสผ่านไม่ถูกต้อง"), 401);
  };

  if (email === null || password === "" || password.length > 256) {
    return failed();
  }

  const row = await c.env.DB.prepare(
    `SELECT u.id, u.password_hash, m.family_id
     FROM users u
     LEFT JOIN family_members m ON m.user_id = u.id
     WHERE u.email = ?
     ORDER BY m.created_at ASC
     LIMIT 1`,
  )
    .bind(email)
    .first<{ id: string; password_hash: string; family_id: string | null }>();

  if (row === null || !verifyPassword(password, row.password_hash)) {
    return failed();
  }

  if (row.family_id === null) {
    return c.json(errorBody("VALIDATION", "บัญชีนี้ยังไม่ได้อยู่ในครอบครัวใด"), 403);
  }

  await clearAttempts(c.env.DB, [ipScope, emailScope]);

  const token = await createSession(c.env.DB, row.id, row.family_id);
  c.header("set-cookie", sessionCookie(token, isSecureRequest(c)));

  return c.json({ ok: true });
});

/**
 * ข้อมูลคำเชิญสำหรับหน้าตั้งบัญชีของผู้รับ
 *
 * คนที่เปิดลิงก์คือคนที่ยังไม่มีบัญชี เส้นทางนี้จึงอยู่ใต้ /api/auth/ ที่ไม่ต้องล็อกอิน
 * และตอบเฉพาะสิ่งที่ผู้ถือลิงก์ควรเห็นอยู่แล้ว — ชื่อหอ · อีเมลที่ถูกเชิญ · วันหมดอายุ
 * ไม่ตอบว่าใครเชิญหรือมีใครอยู่ในครอบครัวแล้วบ้าง
 *
 * ไม่บันทึกความพยายามที่ล้มเหลวเหมือนเส้นทางอื่น เพราะตัวนับแยกตาม IP ร่วมกับ
 * การล็อกอิน การเปิดลิงก์เก่าซ้ำ ๆ จึงต้องไม่ทำให้เจ้าของหอล็อกอินตัวเองไม่ได้
 */
auth.get("/invites/:token", async (c) => {
  const rawToken = c.req.param("token").trim();

  if (rawToken === "" || rawToken.length > 200) {
    return c.json(errorBody("VALIDATION", "คำเชิญไม่ถูกต้องหรือหมดอายุแล้ว", "token"), 400);
  }

  if (await tooManyAttempts(c.env.DB, clientScope(c))) {
    return c.json(errorBody("VALIDATION", "พยายามหลายครั้งเกินไป กรุณารอสักครู่"), 429);
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
auth.post("/accept-invite", async (c) => {
  const body = await readJsonObject(c.req.raw);

  if (body === null) {
    return c.json(errorBody("VALIDATION", "รูปแบบข้อมูลไม่ถูกต้อง"), 400);
  }

  const scope = clientScope(c);

  if (await tooManyAttempts(c.env.DB, scope)) {
    return c.json(errorBody("VALIDATION", "พยายามหลายครั้งเกินไป กรุณารอสักครู่"), 429);
  }

  const rawToken = typeof body.token === "string" ? body.token.trim() : "";

  if (rawToken === "" || rawToken.length > 200) {
    await recordAttempt(c.env.DB, scope);
    return c.json(errorBody("VALIDATION", "คำเชิญไม่ถูกต้อง", "token"), 400);
  }

  const invite = await c.env.DB.prepare(
    `SELECT token_hash, family_id, email, role FROM family_invites
     WHERE token_hash = ? AND accepted_at IS NULL AND expires_at > datetime('now')`,
  )
    .bind(await hashToken(rawToken))
    .first<{ token_hash: string; family_id: string; email: string; role: string }>();

  if (invite === null) {
    await recordAttempt(c.env.DB, scope);
    return c.json(errorBody("VALIDATION", "คำเชิญไม่ถูกต้องหรือหมดอายุแล้ว", "token"), 400);
  }

  const displayName = normaliseName(body.displayName);
  const passwordMessage = passwordError(body.password);

  if (displayName === null) {
    return c.json(errorBody("VALIDATION", "ชื่อต้องยาว 2–80 ตัวอักษร", "displayName"), 400);
  }

  if (passwordMessage !== null) {
    return c.json(errorBody("VALIDATION", passwordMessage, "password"), 400);
  }

  const password = body.password as string;

  const existing = await c.env.DB.prepare("SELECT id, password_hash FROM users WHERE email = ?")
    .bind(invite.email)
    .first<{ id: string; password_hash: string }>();

  const statements = [];
  let userId: string;

  if (existing === null) {
    // อีเมลนี้ยังไม่มีบัญชี คำเชิญจึงเป็นตัวสร้างบัญชีใหม่ได้
    userId = crypto.randomUUID();
    statements.push(
      c.env.DB.prepare("INSERT INTO users (id, email, display_name, password_hash) VALUES (?, ?, ?, ?)").bind(
        userId,
        invite.email,
        displayName,
        hashPassword(password),
      ),
    );
  } else {
    // อีเมลนี้มีบัญชีอยู่แล้ว การถือคำเชิญอย่างเดียวต้องไม่ได้สิทธิ์เป็นเจ้าของบัญชีนั้น
    // จึงบังคับให้พิสูจน์ด้วยรหัสผ่านเดิมก่อน
    if (!verifyPassword(password, existing.password_hash)) {
      await recordAttempt(c.env.DB, scope);
      return c.json(errorBody("VALIDATION", "อีเมลนี้มีบัญชีอยู่แล้ว กรุณากรอกรหัสผ่านของบัญชีเดิม", "password"), 401);
    }

    const joined = await c.env.DB.prepare("SELECT family_id FROM family_members WHERE user_id = ?")
      .bind(existing.id)
      .first<{ family_id: string }>();

    if (joined !== null) {
      return c.json(
        errorBody(
          "CONFLICT",
          joined.family_id === invite.family_id ? "คุณอยู่ในครอบครัวนี้แล้ว" : "บัญชีนี้อยู่ในอีกครอบครัวหนึ่งแล้ว",
        ),
        409,
      );
    }

    userId = existing.id;
  }

  if (statements.length > 0) {
    await c.env.DB.batch(statements);
  }

  // เพดานสมาชิกบังคับตอน "เข้าครอบครัว" ไม่ใช่ตอนออกคำเชิญ เพราะคำเชิญหลายใบ
  // อาจถูกออกไว้ก่อนที่ครอบครัวจะเต็ม
  const joined = await joinFamilyOnce(
    c.env.DB,
    invite.family_id,
    userId,
    invite.role === "owner" ? "owner" : "member",
  );

  if (!joined) {
    return c.json(errorBody("CONFLICT", "ครอบครัวนี้มีสมาชิกครบแล้ว"), 409);
  }

  await c.env.DB.prepare(
    "UPDATE family_invites SET accepted_at = datetime('now'), accepted_by = ? WHERE token_hash = ? AND accepted_at IS NULL",
  )
    .bind(userId, invite.token_hash)
    .run();

  const token = await createSession(c.env.DB, userId, invite.family_id);
  c.header("set-cookie", sessionCookie(token, isSecureRequest(c)));

  return c.json({ ok: true, user: { id: userId, email: invite.email, role: invite.role } }, 201);
});

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

auth.post("/password", requireAuth, async (c) => {
  const body = await readJsonObject(c.req.raw);

  if (body === null) {
    return c.json(errorBody("VALIDATION", "รูปแบบข้อมูลไม่ถูกต้อง"), 400);
  }

  const session = c.get("session");
  const current = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const passwordMessage = passwordError(body.newPassword);

  if (passwordMessage !== null) {
    return c.json(errorBody("VALIDATION", passwordMessage, "newPassword"), 400);
  }

  const row = await c.env.DB.prepare("SELECT password_hash FROM users WHERE id = ?")
    .bind(session.userId)
    .first<{ password_hash: string }>();

  if (row === null || !verifyPassword(current, row.password_hash)) {
    return c.json(errorBody("VALIDATION", "รหัสผ่านเดิมไม่ถูกต้อง", "currentPassword"), 400);
  }

  const newHash = hashPassword(body.newPassword as string);
  const token = newSessionToken();
  const tokenHash = await hashToken(token);
  const expiresAt = sessionExpiryIso();

  // สามคำสั่งนี้ต้องเป็นธุรกรรมเดียว ไม่งั้นสองคำขอเปลี่ยนรหัสผ่านพร้อมกันด้วย
  // รหัสผ่านเดิมเดียวกันจะแข่งกันชนะได้ทั้งคู่ — ฝ่ายแพ้ต้องไม่ได้เซสชันใหม่ที่ใช้ได้จริง
  // แม้ batch ของฝ่ายแพ้จะยังรันครบ (D1 ไม่ยกเลิกคำสั่งถัดไปเมื่อคำสั่งก่อนหน้าไม่มีอะไรเปลี่ยน)
  //
  // คำสั่งแรกอัปเดตแบบมีเงื่อนไข (optimistic: password_hash ต้องตรงกับที่เพิ่งตรวจ)
  // คำสั่งที่สองและสามอ้างอิง newHash ที่เพิ่งพยายามตั้งเป็นเงื่อนไขของตัวเอง จึงเดิน
  // ต่อได้ก็ต่อเมื่อคำสั่งแรก "ของคำขอนี้เอง" เป็นฝ่ายชนะจริง ไม่ใช่แค่ตรวจสถานะเก่า
  const results = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ?").bind(
      newHash,
      session.userId,
      row.password_hash,
    ),
    c.env.DB.prepare(
      `UPDATE sessions SET revoked_at = datetime('now')
       WHERE user_id = ? AND revoked_at IS NULL
         AND EXISTS (SELECT 1 FROM users WHERE id = ? AND password_hash = ?)`,
    ).bind(session.userId, session.userId, newHash),
    c.env.DB.prepare(
      `INSERT INTO sessions (token_hash, user_id, family_id, expires_at)
       SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND password_hash = ?)`,
    ).bind(tokenHash, session.userId, session.familyId, expiresAt, session.userId, newHash),
  ]);

  if ((results[0]?.meta.changes ?? 0) === 0) {
    return c.json(
      errorBody("CONFLICT", "รหัสผ่านถูกเปลี่ยนโดยคำขออื่นไปแล้ว กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง"),
      409,
    );
  }

  c.header("set-cookie", sessionCookie(token, isSecureRequest(c)));

  return c.json({ ok: true });
});

export default auth;
