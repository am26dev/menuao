import { createSnapshot } from "./backup.mjs";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
const dataDir = path.resolve(process.env.DATA_DIR || "./data"),
  file = path.join(dataDir, "backup-status.json");
let previous = {};
try {
  previous = JSON.parse(readFileSync(file, "utf8"));
} catch {}
let result;
try {
  const snapshot = await createSnapshot(dataDir, process.env.BACKUP_DIR);
  result = {
    ok: true,
    lastSuccess: new Date().toISOString(),
    lastAttempt: new Date().toISOString(),
    files: snapshot.files,
    counts: snapshot.counts,
    snapshot: path.basename(snapshot.snapshot),
  };
} catch {
  result = {
    ...previous,
    ok: false,
    lastAttempt: new Date().toISOString(),
    error:
      "A complete snapshot could not be verified. Check free disk, data references and backup permissions.",
  };
  process.exitCode = 1;
}
writeFileSync(file + ".tmp", JSON.stringify(result), { mode: 0o600 });
renameSync(file + ".tmp", file);
