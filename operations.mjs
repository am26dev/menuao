import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function startOperations({
  app,
  dataDir,
  auth,
  staff,
  admin,
  production,
}) {
  const statusFile = path.join(dataDir, "backup-status.json");
  let running = false;
  function status() {
    try {
      return JSON.parse(readFileSync(statusFile, "utf8"));
    } catch {
      return { ok: false, lastSuccess: null };
    }
  }
  app.get("/api/admin/operations", auth, staff, admin, (req, res) => {
    const backup = status();
    res.json({
      backup: {
        ...backup,
        running,
        stale:
          !backup.lastSuccess ||
          Date.now() - Date.parse(backup.lastSuccess) > 26 * 3600000,
      },
      singleInstanceRequired: true,
      mailConfiguredInEnvironment: !!(
        process.env.SMTP_HOST &&
        process.env.SMTP_USER &&
        process.env.SMTP_PASSWORD &&
        process.env.SMTP_FROM
      ),
    });
  });
  if (!production) return;
  function tick() {
    if (running) return;
    const previous = status();
    if (
      previous.lastSuccess &&
      Date.now() - Date.parse(previous.lastSuccess) < 24 * 3600000
    )
      return;
    running = true;
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL("./scripts/backup-job.mjs", import.meta.url))],
      {
        env: { ...process.env, DATA_DIR: path.resolve(dataDir) },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    child.stderr.on("data", () => {});
    const timeout = setTimeout(() => child.kill(), 15 * 60000);
    timeout.unref();
    child.once("error", () => {
      running = false;
      clearTimeout(timeout);
      console.error("Scheduled backup process could not start");
    });
    child.once("exit", (code) => {
      running = false;
      clearTimeout(timeout);
      console.log(
        code === 0
          ? "Complete application backup verified"
          : "Complete application backup FAILED; check administration operations",
      );
    });
  }
  const first = setTimeout(tick, 10000),
    timer = setInterval(tick, 3600000);
  first.unref();
  timer.unref();
}
