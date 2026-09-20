import { Hono } from "hono";
import type { AppEnv } from "../lib/auth";
import { isSecureRequest, requireAuth, sameOriginOnly } from "../lib/auth";
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

/** เทียบความลับแบบเวลาคงที่ ไม่บอกใบ้ความยาวที่ตรงกันผ่านเวลา */
async function secretMatches(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([hashToken(given), hashToken(expected)]);
  let diff = a.length ^ b.length;

  for (let index = 0; index < a.length && index < b.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }

  return diff === 0;
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
 * สร้างครอบครัวใหม่ หรือรับช่วงครอบครัวที่ถือข้อมูลเดิม
 *
 * ปิดตายไว้โดยตั้งใจ: ถ้าไม่ได้ตั้ง BOOTSTRAP_SECRET ไว้ endpoint นี้ใช้ไม่ได้เลย
 * ข้อมูลเดิมจึงไม่ตกเป็นของคนแรกที่บังเอิญยิงเข้ามา และไม่มีการเปิดสมัครอิสระ
 * ทางเข้าของสมาชิกคนอื่นคือคำเชิญจากเจ้าของเท่านั้น
 *
 * ครั้งแรกจะได้ครอบครัวเดิมที่ผูกกับห้อง ผู้เช่า และบิลทั้งหมดที่มีอยู่
 * ครั้งต่อ ๆ ไปถือเป็นการสร้างครอบครัวใหม่ที่เริ่มจากข้อมูลว่าง
 */
auth.post("/bootstrap", async (c) => {
  const expected = c.env.BOOTSTRAP_SECRET ?? "";

  if (expected.trim() === "") {
    return c.json(errorBody("VALIDATION", "ยังไม่ได้เปิดการตั้งค่าเจ้าของระบบ"), 503);
  }

  const body = await readJsonObject(c.req.raw);

  if (body === null) {
    return c.json(errorBody("VALIDATION", "รูปแบบข้อมูลไม่ถูกต้อง"), 400);
  }

  const scope = clientScope(c);

  if (await tooManyAttempts(c.env.DB, scope)) {
    return c.json(errorBody("VALIDATION", "พยายามหลายครั้งเกินไป กรุณารอสักครู่"), 429);
  }

  const given = typeof body.secret === "string" ? body.secret : "";

  if (!(await secretMatches(given, expected))) {
    await recordAttempt(c.env.DB, scope);
    return c.json(errorBody("VALIDATION", "รหัสเริ่มต้นระบบไม่ถูกต้อง", "secret"), 403);
  }

  const claimed = await c.env.DB.prepare("SELECT 1 AS one FROM family_members WHERE family_id = ? LIMIT 1")
    .bind(legacyFamilyId)
    .first<{ one: number }>();

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

  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: string }>();

  if (existing !== null) {
    return c.json(errorBody("DUPLICATE", "อีเมลนี้มีบัญชีอยู่แล้ว", "email"), 409);
  }

  const rawFamilyName = typeof body.familyName === "string" ? body.familyName.trim().replace(/\s+/g, " ") : "";

  if (rawFamilyName.length > 80) {
    return c.json(errorBody("VALIDATION", "ชื่อครอบครัวต้องยาวไม่เกิน 80 ตัวอักษร", "familyName"), 400);
  }

  // ครอบครัวเดิมยังไม่มีเจ้าของ = รับช่วงข้อมูลที่มีอยู่
  // มีเจ้าของแล้ว = สร้างครอบครัวใหม่ที่เริ่มจากศูนย์
  const claimingLegacy = claimed === null;

  if (!claimingLegacy && rawFamilyName === "") {
    return c.json(errorBody("VALIDATION", "กรุณาตั้งชื่อครอบครัวใหม่", "familyName"), 400);
  }

  const targetFamilyId = claimingLegacy ? legacyFamilyId : crypto.randomUUID();
  const userId = crypto.randomUUID();
  const passwordHash = hashPassword(body.password as string);
  const statements = [];

  if (claimingLegacy) {
    if (rawFamilyName !== "") {
      statements.push(
        c.env.DB.prepare("UPDATE families SET name = ? WHERE id = ?").bind(rawFamilyName, targetFamilyId),
      );
    }
  } else {
    statements.push(
      c.env.DB.prepare("INSERT INTO families (id, name) VALUES (?, ?)").bind(targetFamilyId, rawFamilyName),
    );
  }

  statements.push(
    c.env.DB.prepare("INSERT INTO users (id, email, display_name, password_hash) VALUES (?, ?, ?, ?)").bind(
      userId,
      email,
      displayName,
      passwordHash,
    ),
    c.env.DB.prepare("INSERT INTO family_members (family_id, user_id, role) VALUES (?, ?, 'owner')").bind(
      targetFamilyId,
      userId,
    ),
  );

  await c.env.DB.batch(statements);

  const token = await createSession(c.env.DB, userId, targetFamilyId);
  c.header("set-cookie", sessionCookie(token, isSecureRequest(c)));

  return c.json(
    {
      ok: true,
      claimedExistingData: claimingLegacy,
      user: { id: userId, email, displayName, role: "owner", familyId: targetFamilyId },
    },
    201,
  );
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

  statements.push(
    c.env.DB.prepare("INSERT INTO family_members (family_id, user_id, role) VALUES (?, ?, ?)").bind(
      invite.family_id,
      userId,
      invite.role === "owner" ? "owner" : "member",
    ),
    c.env.DB.prepare(
      "UPDATE family_invites SET accepted_at = datetime('now'), accepted_by = ? WHERE token_hash = ? AND accepted_at IS NULL",
    ).bind(userId, invite.token_hash),
  );

  await c.env.DB.batch(statements);

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
