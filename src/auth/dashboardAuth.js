/**
 * Small dashboard login + role system.
 *
 * Local learning mode: if DASHBOARD_USERS is empty, writes stay open.
 * Production mode: set DASHBOARD_USERS and DASHBOARD_SESSION_SECRET.
 */

import crypto from "crypto";
import { config } from "../config.js";

const ROLE_LEVEL = { viewer: 1, operator: 2, admin: 3 };
const COOKIE = "bs_session";

/** @type {Map<string, { username: string, role: string, expiresAt: number }>} */
const sessions = new Map();

function parseUsers() {
  const users = new Map();
  const raw = String(config.dashboardUsersRaw || "").trim();
  if (!raw) return users;

  for (const part of raw.split(",")) {
    const [username, password, role = "viewer"] = part.split(":").map((v) => v?.trim());
    if (!username || !password) continue;
    users.set(username, {
      username,
      password,
      role: ROLE_LEVEL[role] ? role : "viewer",
    });
  }
  return users;
}

export function dashboardAuthEnabled() {
  return parseUsers().size > 0;
}

export function dashboardAuthStatus() {
  return {
    enabled: dashboardAuthEnabled(),
    roles: Object.keys(ROLE_LEVEL),
  };
}

function sign(value) {
  return crypto
    .createHmac("sha256", config.dashboardSessionSecret)
    .update(value)
    .digest("base64url");
}

function makeCookie(value) {
  return `${COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${8 * 60 * 60}`;
}

function parseCookie(req) {
  const raw = String(req.headers.cookie || "");
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === COOKIE) return rest.join("=");
  }
  return "";
}

export function loginDashboard({ username, password } = {}) {
  const user = parseUsers().get(String(username || "").trim());
  if (!user || user.password !== String(password || "")) {
    return null;
  }

  const id = crypto.randomUUID();
  const token = `${id}.${sign(id)}`;
  sessions.set(id, {
    username: user.username,
    role: user.role,
    expiresAt: Date.now() + 8 * 60 * 60 * 1000,
  });
  return {
    user: { username: user.username, role: user.role },
    cookie: makeCookie(token),
  };
}

export function logoutDashboard(req, res) {
  const token = parseCookie(req);
  const id = token.split(".")[0];
  if (id) sessions.delete(id);
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

export function currentDashboardUser(req) {
  if (!dashboardAuthEnabled()) {
    return { username: "local-dev", role: "admin", authDisabled: true };
  }

  const token = parseCookie(req);
  const [id, sig] = token.split(".");
  if (!id || !sig || sig !== sign(id)) return null;

  const row = sessions.get(id);
  if (!row || row.expiresAt <= Date.now()) {
    sessions.delete(id);
    return null;
  }
  return { username: row.username, role: row.role };
}

export function requireDashboardRole(role = "viewer") {
  const needed = ROLE_LEVEL[role] || ROLE_LEVEL.viewer;
  return (req, res, next) => {
    const user = currentDashboardUser(req);
    if (!user) {
      return res.status(401).json({
        error: "Dashboard login required",
        code: "DASHBOARD_LOGIN_REQUIRED",
      });
    }
    if ((ROLE_LEVEL[user.role] || 0) < needed) {
      return res.status(403).json({
        error: "Dashboard role not allowed",
        code: "DASHBOARD_ROLE_DENIED",
        required: role,
        role: user.role,
      });
    }
    req.dashboardUser = user;
    return next();
  };
}

export function resetDashboardSessions() {
  sessions.clear();
}
