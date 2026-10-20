import fs from "fs";

const file = ".env";
const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";

const findings = [];
const checks = [
  [/sk_live_[A-Za-z0-9]+/g, "Stripe live secret key"],
  [/sk-[A-Za-z0-9_-]{20,}/g, "OpenAI-style API key"],
  [/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/g, "Slack webhook"],
  [/DASHBOARD_USERS=.*(change-this|password|admin123|changeme)/i, "Weak dashboard password placeholder"],
];

for (const [regex, label] of checks) {
  const matches = text.match(regex);
  if (matches) findings.push({ label, count: matches.length });
}

if (!text.includes("DASHBOARD_SESSION_SECRET=")) {
  findings.push({ label: "Missing DASHBOARD_SESSION_SECRET", count: 1 });
}

if (!text.includes("DASHBOARD_USERS=")) {
  findings.push({ label: "Missing DASHBOARD_USERS (dashboard writes are open)", count: 1 });
}

if (findings.length) {
  console.log("Secret safety findings:");
  for (const f of findings) console.log(`- ${f.label} (${f.count})`);
  console.log("\nBefore sharing: rotate real keys and set dashboard users/session secret.");
  process.exitCode = 1;
} else {
  console.log("No obvious secret safety findings.");
}
