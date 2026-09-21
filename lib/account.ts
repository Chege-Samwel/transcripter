import bcrypt from "bcryptjs";
import { authConfiguration, getSession, normalizeEmail } from "./auth";
import { databaseConfigured, describeDatabaseError, getPool } from "./database";
import { demoWordCap } from "./limits";
import { makeId } from "./workflow";
import { databaseReadiness } from "./migrate";
import type { Account, UserRole, UserStatus } from "./types";

export type DbUser = {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  status: UserStatus;
  role: UserRole;
  workspace_config: unknown;
  created_at: Date | string;
  approved_at: Date | string | null;
  approved_by: string | null;
};

function displayNameFromEmail(email: string) {
  return email.split("@")[0] || "Editor";
}

export function syntheticAccount(email: string, role: UserRole = "admin"): Account {
  return {
    email,
    displayName: displayNameFromEmail(email),
    status: "approved",
    role,
    canBookJob: true,
    demoWordCap: demoWordCap(),
    persistence: databaseConfigured() ? "database" : "browser",
  };
}

function toAccount(user: DbUser): Account {
  const admin = user.role === "admin";
  const approved = user.status === "approved" || admin;
  return {
    email: user.email,
    displayName: user.display_name || displayNameFromEmail(user.email),
    status: user.status,
    role: user.role,
    canBookJob: approved && user.status !== "suspended",
    demoWordCap: demoWordCap(),
    persistence: "database",
  };
}

async function readyPool() {
  if (!databaseConfigured()) return null;
  const readiness = await databaseReadiness();
  if (readiness.error) return null;
  return getPool();
}

export async function findUserByEmail(email: string): Promise<DbUser | null> {
  const pool = await readyPool();
  if (!pool) return null;
  try {
    const result = await pool.query(
      `SELECT id, email, password_hash, display_name, status, role, workspace_config, created_at, approved_at, approved_by
       FROM transcripter_users WHERE email = $1 LIMIT 1`,
      [normalizeEmail(email)],
    );
    return (result.rows[0] as DbUser | undefined) || null;
  } catch (error) {
    console.error("Transcripter: could not load user", error);
    return null;
  }
}

export async function getCurrentUser(): Promise<Account | null> {
  const session = getSession();
  if (!session) return null;
  if (!databaseConfigured()) return syntheticAccount(session.email, "admin");

  const user = await findUserByEmail(session.email);
  if (user) return toAccount(user);

  const creds = authConfiguration();
  if (session.email === creds.email) return { ...syntheticAccount(session.email, "admin"), persistence: "database" };

  return {
    email: session.email,
    displayName: displayNameFromEmail(session.email),
    status: "awaiting_approval",
    role: "editor",
    canBookJob: false,
    demoWordCap: demoWordCap(),
    persistence: "database",
  };
}

export async function createRegisteredUser(input: { email: string; password: string; displayName?: string }) {
  const email = normalizeEmail(input.email);
  const password = input.password || "";
  const displayName = (input.displayName || "").trim().slice(0, 80) || displayNameFromEmail(email);
  if (!email || !email.includes("@")) return { ok: false as const, error: "Enter a valid email address.", status: 400 };
  if (password.length < 8) return { ok: false as const, error: "Use a password of at least 8 characters.", status: 400 };
  if (password.length > 200) return { ok: false as const, error: "That password is too long.", status: 400 };
  if (!databaseConfigured()) {
    return { ok: false as const, error: "Registration needs a database. Set DATABASE_URL, then try again.", status: 503 };
  }

  const pool = await readyPool();
  if (!pool) return { ok: false as const, error: "The database is not ready for registrations yet.", status: 503 };

  const creds = authConfiguration();
  const bootstrap = email === creds.email;
  const passwordHash = await bcrypt.hash(password, 12);
  const status: UserStatus = bootstrap ? "approved" : "awaiting_approval";
  const role: UserRole = bootstrap ? "admin" : "editor";

  try {
    const result = await pool.query(
      `INSERT INTO transcripter_users (id, email, password_hash, display_name, status, role, approved_at, approved_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, email, password_hash, display_name, status, role, workspace_config, created_at, approved_at, approved_by`,
      [makeId(), email, passwordHash, displayName, status, role, bootstrap ? new Date() : null, bootstrap ? "bootstrap" : null],
    );
    const user = result.rows[0] as DbUser;
    return { ok: true as const, account: toAccount(user) };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: string }).code) : "";
    if (code === "23505") return { ok: false as const, error: "An account with that email already exists. Sign in instead.", status: 409 };
    console.error("Transcripter: could not register user", error);
    return { ok: false as const, error: describeDatabaseError(error), status: 500 };
  }
}

export async function verifyLogin(emailInput: string, password: string): Promise<{ ok: true; account: Account } | { ok: false; error: string; status: number }> {
  const email = normalizeEmail(emailInput);
  if (!email || !password) return { ok: false, error: "Enter your email and password.", status: 400 };

  const creds = authConfiguration();
  const envEmailMatch = Boolean(creds.email && email === creds.email);
  const envPasswordMatch = creds.passwordHash
    ? await bcrypt.compare(password, creds.passwordHash)
    : Boolean(creds.password && password === creds.password);
  const envMatch = envEmailMatch && envPasswordMatch;

  const dbUser = await findUserByEmail(email);
  if (dbUser) {
    const dbMatch = await bcrypt.compare(password, dbUser.password_hash);
    if (!dbMatch && !envMatch) return { ok: false, error: "Those credentials do not match an active account.", status: 401 };
    if (dbUser.status === "suspended" && !envMatch) {
      return { ok: false, error: "This account is suspended. An admin has to restore access before you can sign in.", status: 403 };
    }
    if (envMatch && (dbUser.role !== "admin" || dbUser.status !== "approved")) {
      await setUserStatus(email, "approved", creds.email || "bootstrap", "admin");
      const updated = await findUserByEmail(email);
      return { ok: true, account: toAccount(updated || { ...dbUser, status: "approved", role: "admin" }) };
    }
    return { ok: true, account: toAccount(dbUser) };
  }

  if (envMatch) {
    if (databaseConfigured()) {
      await upsertBootstrapAdmin(email, password);
    }
    return { ok: true, account: syntheticAccount(email, "admin") };
  }

  if (!creds.email && !databaseConfigured()) {
    return { ok: false, error: "Authentication is not configured for this workspace.", status: 503 };
  }
  return { ok: false, error: "Those credentials do not match an active account.", status: 401 };
}

export async function upsertBootstrapAdmin(email: string, password: string) {
  const pool = await readyPool();
  if (!pool) return;
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    await pool.query(
      `INSERT INTO transcripter_users (id, email, password_hash, display_name, status, role, approved_at, approved_by)
       VALUES ($1, $2, $3, $4, 'approved', 'admin', NOW(), 'bootstrap')
       ON CONFLICT (email) DO UPDATE SET
         status = 'approved',
         role = 'admin',
         approved_at = COALESCE(transcripter_users.approved_at, NOW()),
         approved_by = COALESCE(transcripter_users.approved_by, 'bootstrap'),
         updated_at = NOW()`,
      [makeId(), normalizeEmail(email), passwordHash, displayNameFromEmail(email)],
    );
  } catch (error) {
    console.error("Transcripter: could not upsert bootstrap admin", error);
  }
}

export async function listUsers(): Promise<Array<Account & { createdAt?: string; approvedAt?: string | null; approvedBy?: string | null }>> {
  const pool = await readyPool();
  if (!pool) return [];
  const result = await pool.query(
    `SELECT id, email, password_hash, display_name, status, role, workspace_config, created_at, approved_at, approved_by
     FROM transcripter_users
     ORDER BY CASE status WHEN 'awaiting_approval' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, created_at DESC`,
  );
  return (result.rows as DbUser[]).map((user) => ({
    ...toAccount(user),
    createdAt: user.created_at instanceof Date ? user.created_at.toISOString() : String(user.created_at),
    approvedAt: user.approved_at instanceof Date ? user.approved_at.toISOString() : user.approved_at,
    approvedBy: user.approved_by,
  }));
}

export async function setUserStatus(email: string, status: UserStatus, actorEmail: string, role?: UserRole) {
  const pool = await readyPool();
  if (!pool) return { ok: false as const, error: "Database is not configured." };
  const approved = status === "approved";
  try {
    const result = await pool.query(
      `UPDATE transcripter_users
       SET status = $2::user_status,
           role = COALESCE($3::user_role, role),
           approved_at = CASE WHEN $2::user_status = 'approved'::user_status THEN COALESCE(approved_at, NOW()) ELSE NULL END,
           approved_by = CASE WHEN $2::user_status = 'approved'::user_status THEN $4 ELSE NULL END,
           updated_at = NOW()
       WHERE email = $1
       RETURNING email`,
      [normalizeEmail(email), status, role || null, actorEmail],
    );
    if (!result.rowCount) return { ok: false as const, error: "No account with that email." };
    return { ok: true as const, approved };
  } catch (error) {
    return { ok: false as const, error: describeDatabaseError(error) };
  }
}

export function assertCanBookJob(account: Account, kind: "demo" | "job") {
  if (account.status === "suspended") {
    return { ok: false as const, error: "This account is suspended.", code: "SUSPENDED", status: 403 };
  }
  if (kind === "job" && !account.canBookJob) {
    return {
      ok: false as const,
      error: `This account cannot book a job yet. Registrations stay on a ${account.demoWordCap}-word demo until an admin sets your status to approved.`,
      code: "APPROVAL_REQUIRED",
      status: 403,
    };
  }
  return { ok: true as const };
}
