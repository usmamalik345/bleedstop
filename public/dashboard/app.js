const API_KEY_STORAGE = "bleedstop_api_key";
let dashboardUser = null;
let dashboardAuth = { enabled: false };

function getApiKey() {
  const input = document.getElementById("api-key");
  return (input?.value || localStorage.getItem(API_KEY_STORAGE) || "").trim();
}

function authHeaders() {
  const key = getApiKey();
  const headers = { "Content-Type": "application/json" };
  if (key) headers["X-API-Key"] = key;
  return headers;
}

async function get(path) {
  try {
    const res = await fetch(path);
    if (!res.ok) {
      return { _error: true, status: res.status, path };
    }
    return await res.json();
  } catch (err) {
    return { _error: true, status: 0, path, message: err.message };
  }
}

async function post(path, body = {}) {
  const res = await fetch(path, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function refreshAuth() {
  const data = await get("/auth/me");
  dashboardUser = data.user;
  dashboardAuth = data.auth || { enabled: false };
  const state = document.getElementById("auth-state");
  const loginScreen = document.getElementById("login-screen");
  const dashboard = document.getElementById("dashboard-app");
  if (!state || !loginScreen || !dashboard) return data;

  if (!dashboardAuth.enabled) {
    state.textContent = "Auth off (local dev)";
    loginScreen.classList.add("hidden");
    dashboard.classList.remove("hidden");
    return data;
  }

  if (!dashboardUser) {
    loginScreen.classList.remove("hidden");
    dashboard.classList.add("hidden");
    return data;
  }

  state.textContent = `Logged in: ${dashboardUser.username} (${dashboardUser.role})`;
  loginScreen.classList.add("hidden");
  dashboard.classList.remove("hidden");
  return data;
}

function pretty(obj) {
  if (obj?._error) {
    return `(unavailable: ${obj.path || "endpoint"} → ${obj.status || obj.message || "error"})`;
  }
  return JSON.stringify(obj, null, 2);
}

function setStatus(message, kind = "") {
  const el = document.getElementById("status");
  el.textContent = message;
  el.className = `status ${kind}`.trim();
}

function renderBars(containerId, rows, { valueKey = "value", tone } = {}) {
  const el = document.getElementById(containerId);
  if (!rows.length) {
    el.innerHTML = `<p class="sub" style="margin:0;font-size:13px">No data yet — run benchmark or red team.</p>`;
    return;
  }
  const max = Math.max(...rows.map((r) => Number(r[valueKey]) || 0), 0.001);
  el.innerHTML = rows
    .map((r) => {
      const v = Number(r[valueKey]) || 0;
      const pct = Math.min(100, Math.round((v / max) * 100));
      const cls = tone ? `bar-fill ${tone(r)}` : "bar-fill";
      const label = r.label ?? r.id ?? "";
      const shown = r.display ?? (Number.isInteger(v) ? v : `$${v.toFixed(2)}`);
      return `<div class="bar-row">
        <span class="name" title="${label}">${label}</span>
        <div class="bar-track"><div class="${cls}" style="width:${pct}%"></div></div>
        <span class="val">${shown}</span>
      </div>`;
    })
    .join("");
}

function renderCharts(stats) {
  const clusters = (stats.clusters || []).map((c) => ({
    id: c.id,
    label: c.id,
    value: c.spend,
  }));
  renderBars("chart-clusters", clusters);

  const d = stats.decisions || {};
  const decisionRows = [
    { id: "ALLOW", label: "ALLOW", value: d.ALLOW || 0 },
    { id: "LIMIT", label: "LIMIT", value: d.LIMIT || 0 },
    { id: "DENY", label: "DENY", value: d.DENY || 0 },
  ];
  renderBars("chart-decisions", decisionRows, {
    tone: (r) => r.id.toLowerCase(),
    valueKey: "value",
  });
}

let refreshInFlight = false;

async function refresh() {
  if (refreshInFlight) return null;
  refreshInFlight = true;
  try {
  const results = await Promise.allSettled([
    get("/api/health"),
    get("/ledger"),
    get("/incidents"),
    get("/rules"),
    get("/events?limit=30"),
    get("/report/morning"),
    get("/investigate"),
    get("/api/stats"),
    get("/audits?limit=20"),
  ]);

  const pick = (i, fallback) => {
    const r = results[i];
    if (r.status !== "fulfilled" || r.value?._error) return fallback;
    return r.value;
  };

  const health = pick(0, { storage: "?", unpaidCeilingUsd: "?", infra: {} });
  const ledger = pick(1, { clusters: {}, keyStatus: {}, vendorUsageByKey: {}, appSpendByKey: {} });
  const incidents = pick(2, { incidents: [] });
  const rules = pick(3, { rules: [] });
  const events = pick(4, { events: [] });
  const morning = pick(5, {});
  const investigate = pick(6, {});
  const stats = pick(7, {});
  const audits = pick(8, { audits: [] });

  const clusterCount = Object.keys(ledger.clusters || {}).length;
  const incidentCount = (incidents.incidents || []).length;
  const disabledKeys = Object.values(ledger.keyStatus || {}).filter(
    (s) => s === "disabled"
  ).length;
  const gmVendor = Number(ledger.vendorUsageByKey?.["gm-demo-key"] ?? 0);
  const gmApp = Number(ledger.appSpendByKey?.["gm-demo-key"] ?? 0);
  const ghost = Math.max(0, gmVendor - gmApp);
  const m = health.metrics || {};

  const statsEl = document.getElementById("stats");
  if (statsEl) {
    statsEl.innerHTML = `
    <div class="card"><div class="label">Storage</div><div class="value">${health.storage || "memory"}</div></div>
    <div class="card"><div class="label">Tenant</div><div class="value">${health.infra?.tenantId || "—"}</div></div>
    <div class="card"><div class="label">Unpaid ceiling</div><div class="value">$${health.unpaidCeilingUsd}</div></div>
    <div class="card"><div class="label">Paid ceiling</div><div class="value">$${health.paidCeilingUsd ?? "—"}</div></div>
    <div class="card"><div class="label">Active clusters</div><div class="value">${clusterCount}</div></div>
    <div class="card"><div class="label">Incidents</div><div class="value">${incidentCount}</div></div>
    <div class="card"><div class="label">Disabled keys</div><div class="value">${disabledKeys}</div></div>
    <div class="card"><div class="label">Ghost gap</div><div class="value">$${ghost.toFixed(2)}</div></div>
    <div class="card"><div class="label">Decide ALLOW</div><div class="value">${m.decide_allow ?? 0}</div></div>
    <div class="card"><div class="label">Decide DENY</div><div class="value">${m.decide_deny ?? 0}</div></div>
  `;
  }

  renderCharts(stats || {});
  renderRuleControls(rules.rules || []);

  const setText = (id, obj) => {
    const el = document.getElementById(id);
    if (el) el.textContent = pretty(obj);
  };
  setText("morning", morning);
  setText("investigate", investigate);
  setText("ledger", ledger);
  setText("incidents", incidents);
  setText("rules", rules);
  setText("audits", audits);
  setText("events", events);
  return { ledger, incidents, health };
  } finally {
    refreshInFlight = false;
  }
}

function renderRuleControls(ruleList) {
  const el = document.getElementById("rules-controls");
  if (!el) return;
  el.innerHTML = ruleList
    .map((r) => {
      const next = r.mode === "enforce" ? "shadow" : "enforce";
      const label = r.mode === "enforce" ? "Switch to shadow" : "Switch to enforce";
      return `<div class="rule-row">
        <span class="rule-name">${r.id} · ${r.name}</span>
        <span class="rule-mode ${r.mode}">${r.mode}</span>
        <button type="button" data-rule-id="${r.id}" data-next-mode="${next}" class="secondary btn-rule-mode" ${dashboardAuth.enabled && !dashboardUser ? "disabled" : ""}>${label}</button>
      </div>`;
    })
    .join("");

  el.querySelectorAll(".btn-rule-mode").forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute("data-rule-id");
      const mode = btn.getAttribute("data-next-mode");
      setStatus(`Setting ${id} → ${mode}…`, "warn");
      const res = await post(`/rules/${id}/mode`, {
        mode,
        actor: "dashboard",
      });
      await refresh();
      setStatus(
        res.ok
          ? `Rule ${id} now ${mode}. Shadow = log only; enforce = real block.`
          : `Rule update failed (${res.status}) ${res.data?.error || res.data?.code || ""}`,
        res.ok ? "ok" : "err"
      );
    };
  });
}

const loginForm = document.getElementById("login-form");
if (loginForm) {
  loginForm.onsubmit = async (event) => {
    event.preventDefault();
    const username = document.getElementById("login-user")?.value || "";
    const password = document.getElementById("login-pass")?.value || "";
    const loginStatus = document.getElementById("login-status");
    if (loginStatus) loginStatus.textContent = "Checking login…";
    const res = await post("/auth/login", { username, password });
    await refreshAuth();
    if (res.ok) {
      await refresh();
      setStatus("Logged in. Role checks are active.", "ok");
    } else if (loginStatus) {
      loginStatus.textContent = `Login failed (${res.status}). Check username/password.`;
      loginStatus.className = "status err";
    }
  };
}

const logoutButton = document.getElementById("btn-logout");
if (logoutButton) {
  logoutButton.onclick = async () => {
    await post("/auth/logout", {});
    await refreshAuth();
    setStatus("Logged out.", "warn");
  };
}

const apiKeyInput = document.getElementById("api-key");
if (apiKeyInput) {
  apiKeyInput.value = localStorage.getItem(API_KEY_STORAGE) || "";
  apiKeyInput.addEventListener("change", () => {
    localStorage.setItem(API_KEY_STORAGE, apiKeyInput.value.trim());
  });
}

document.getElementById("btn-refresh").onclick = async () => {
  await refresh();
  setStatus("Refreshed from control plane.", "ok");
};

document.getElementById("btn-reset").onclick = async () => {
  setStatus("Clearing staging state…", "warn");
  const res = await post("/ledger/reset");
  await refresh();
  setStatus(
    res.ok
      ? "Staging cleared. Keys active. Ready for benchmark or red team."
      : `Clear failed (${res.status}) ${res.data?.hint || res.data?.error || ""}`,
    res.ok ? "ok" : "err"
  );
};

document.getElementById("btn-redteam").onclick = async () => {
  setStatus("Red team: enabling key → injecting out-of-band vendor spend → reconcile…", "warn");
  const before = await get("/ledger");
  const vendorBefore = Number(before.vendorUsageByKey?.["gm-demo-key"] ?? 0);
  const incidentsBefore = (await get("/incidents")).incidents?.length || 0;

  if (before.keyStatus?.["gm-demo-key"] === "disabled") {
    await post("/keys/gm-demo-key/enable");
  }

  const leak = await post("/demo/leak-spend", {
    keyId: "gm-demo-key",
    dollars: 25,
  });
  if (!leak.ok) {
    setStatus(
      `Red team blocked: ${leak.data.reason || leak.data?.hint || leak.status}`,
      "err"
    );
    await refresh();
    return;
  }

  const recon = await post("/reconcile", { keyId: "gm-demo-key" });
  const row = recon.data.results?.find((r) => r.keyId === "gm-demo-key");
  await refresh();
  const incidentsAfter = (await get("/incidents")).incidents?.length || 0;

  setStatus(
    `Red team result: vendor $${vendorBefore.toFixed(2)} → $${Number(leak.data.vendorTotal).toFixed(2)}. Ghost $${Number(row?.ghostSpend || 0).toFixed(2)}. Incidents ${incidentsBefore}→${incidentsAfter}. Kill switch: ${row?.keyStatus}.`,
    "ok"
  );
};

document.getElementById("btn-reconcile").onclick = async () => {
  setStatus("Reconciling app ledger vs vendor usage…", "warn");
  const recon = await post("/reconcile", {});
  await refresh();
  if (!recon.ok) {
    setStatus(`Reconcile failed (${recon.status}) ${recon.data?.hint || ""}`, "err");
    return;
  }
  const ghosts = (recon.data.results || []).filter((r) => r.ghostDetected);
  setStatus(
    ghosts.length
      ? `Reconcile: ${ghosts.length} key(s) over threshold.`
      : "Reconcile: no ghost gap above threshold.",
    ghosts.length ? "ok" : "warn"
  );
};

document.getElementById("btn-drill").onclick = async () => {
  setStatus("PDF drill: clears staging, then runs labelled attacks…", "warn");
  const res = await post("/drill/run", {});
  await refresh();
  const blocked = res.data?.dollarsBlockedEstimate;
  setStatus(
    res.ok
      ? `Drill done. About $${blocked} blocked on card-test races. See response in status — open /drill via terminal for full JSON.`
      : `Drill failed (${res.status}) ${res.data?.error || ""}`,
    res.ok ? "ok" : "err"
  );
  if (res.ok) {
    document.getElementById("morning").textContent = pretty(res.data);
  }
};

document.getElementById("btn-billshock").onclick = async () => {
  setStatus("Read-only bill-shock audit…", "warn");
  const data = await get("/audit/bill-shock");
  document.getElementById("morning").textContent = pretty(data);
  setStatus(data.headline || "Bill-shock audit ready.", data.ghostSpendUsd > 0 ? "warn" : "ok");
};

refreshAuth()
  .then(() => refresh())
  .then((data) => {
    const auth = data?.health?.infra?.apiKeys;
    setStatus(
      auth
        ? "API keys ON — paste key in header for red team / reset. Charts refresh every 8s."
        : "Control plane ready. Charts live. Run: npm run benchmark",
      auth ? "warn" : "ok"
    );
  })
  .catch((err) => {
    setStatus(`Dashboard load failed: ${err.message}. Is the server running?`, "err");
  });
setInterval(() => {
  refresh().catch(() => {});
}, 8000);
