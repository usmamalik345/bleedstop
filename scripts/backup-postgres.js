import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const outDir = path.resolve("backups");
fs.mkdirSync(outDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outFile = path.join(outDir, `bleedstop-${stamp}.sql`);

const result = spawnSync(
  "docker",
  ["compose", "exec", "-T", "postgres", "pg_dump", "-U", "bleedstop", "bleedstop"],
  { encoding: "utf8" }
);

if (result.status !== 0) {
  console.error(result.stderr || result.stdout || "pg_dump failed");
  console.error("Tip: start Postgres first with `npm run db:up`.");
  process.exit(result.status || 1);
}

fs.writeFileSync(outFile, result.stdout);
console.log(`Backup written: ${outFile}`);
console.log("Restore example:");
console.log(`  docker compose exec -T postgres psql -U bleedstop bleedstop < ${outFile}`);
