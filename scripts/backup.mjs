import { DatabaseSync, backup } from "node:sqlite";
import { createHash, randomBytes } from "node:crypto";
import {
  mkdirSync,
  lstatSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  chmodSync,
  renameSync,
  existsSync,
  openSync,
  readSync,
  closeSync,
  statfsSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function safeFile(root, relative) {
  if (!/^(menu\.sqlite|(?:uploads|receipts)\/[a-zA-Z0-9_.-]+)$/.test(relative))
    throw Error("Unsafe snapshot path");
  for (const dir of [
    root,
    ...(relative.includes("/")
      ? [path.join(root, relative.split("/")[0])]
      : []),
  ]) {
    const stat = lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw Error("Snapshot directory must not be a link");
  }
  const file = path.join(root, relative),
    stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw Error("Snapshot asset must be a regular file");
  return file;
}
function digest(file) {
  const fd = openSync(file, "r"),
    hasher = createHash("sha256"),
    buffer = Buffer.alloc(65536);
  let bytes = 0,
    length;
  try {
    while ((length = readSync(fd, buffer, 0, buffer.length, null))) {
      bytes += length;
      hasher.update(buffer.subarray(0, length));
    }
  } finally {
    closeSync(fd);
  }
  return { bytes, sha256: hasher.digest("hex") };
}
function databaseInfo(root) {
  const db = new DatabaseSync(safeFile(root, "menu.sqlite"), {
    readOnly: true,
  });
  try {
    if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
      throw Error("SQLite integrity check failed");
    if (db.prepare("PRAGMA foreign_key_check").all().length)
      throw Error("Database references are inconsistent");
    const tables = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((r) => r.name),
    );
    const assets = [],
      counts = {};
    if (tables.has("media"))
      for (const { url } of db.prepare("SELECT url FROM media").all()) {
        if (!/^\/uploads\/[a-zA-Z0-9_.-]+$/.test(url))
          throw Error("Invalid media reference");
        assets.push(url.slice(1));
      }
    if (tables.has("payment_proofs"))
      for (const { filename } of db
        .prepare("SELECT filename FROM payment_proofs")
        .all()) {
        if (!/^[a-zA-Z0-9_.-]+$/.test(filename))
          throw Error("Invalid receipt reference");
        assets.push("receipts/" + filename);
      }
    for (const table of [
      "users",
      "spaces",
      "products",
      "media",
      "payment_proofs",
    ])
      counts[table] = tables.has(table)
        ? db.prepare("SELECT COUNT(*) AS n FROM " + table).get().n
        : 0;
    return { assets: [...new Set(assets)].sort(), counts };
  } finally {
    db.close();
  }
}
export function verifySnapshot(snapshot) {
  snapshot = path.resolve(snapshot);
  const manifestPath = path.join(snapshot, "manifest.json");
  if (lstatSync(manifestPath).isSymbolicLink()) throw Error("Invalid manifest");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (
    manifest.format !== "menuao-snapshot-v1" ||
    !Array.isArray(manifest.files) ||
    !manifest.files.length
  )
    throw Error("Invalid snapshot manifest");
  const seen = new Set();
  for (const entry of manifest.files) {
    if (seen.has(entry.path)) throw Error("Duplicate snapshot asset");
    seen.add(entry.path);
    const actual = digest(safeFile(snapshot, entry.path));
    if (actual.bytes !== entry.bytes || actual.sha256 !== entry.sha256)
      throw Error("Snapshot checksum mismatch: " + entry.path);
  }
  const info = databaseInfo(snapshot);
  if (!seen.has("menu.sqlite") || info.assets.some((file) => !seen.has(file)))
    throw Error("Snapshot is missing referenced assets");
  return {
    ok: true,
    createdAt: manifest.createdAt,
    files: seen.size,
    counts: info.counts,
  };
}
export async function createSnapshot(
  dataDir,
  backupDir = path.join(dataDir, "backups"),
) {
  dataDir = path.resolve(dataDir);
  backupDir = path.resolve(backupDir);
  // Assets are immutable: a concurrent deletion fails the snapshot rather than
  // marking a partial backup successful. No lock blocks production writes.
  safeFile(dataDir, "menu.sqlite");
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  if (lstatSync(backupDir).isSymbolicLink())
    throw Error("Backup destination must not be a link");
  const live = databaseInfo(dataDir);
  const expectedBytes = ["menu.sqlite", ...live.assets].reduce(
    (sum, file) => sum + lstatSync(safeFile(dataDir, file)).size,
    0,
  );
  const disk = statfsSync(backupDir);
  if (disk.bavail * disk.bsize < expectedBytes * 1.25 + 512 * 1024 * 1024)
    throw Error("Insufficient free disk space for a safe complete snapshot");
  const id =
    new Date().toISOString().replace(/[:.]/g, "-") +
    "-" +
    randomBytes(4).toString("hex");
  const pending = path.join(backupDir, ".incomplete-" + id),
    complete = path.join(backupDir, "snapshot-" + id);
  mkdirSync(pending, { mode: 0o700 });
  const source = new DatabaseSync(path.join(dataDir, "menu.sqlite"), {
    readOnly: true,
  });
  try {
    await backup(source, path.join(pending, "menu.sqlite"));
  } finally {
    source.close();
  }
  chmodSync(path.join(pending, "menu.sqlite"), 0o600);
  const info = databaseInfo(pending),
    files = ["menu.sqlite", ...info.assets];
  for (const relative of info.assets) {
    const sourceFile = safeFile(dataDir, relative);
    mkdirSync(path.dirname(path.join(pending, relative)), {
      recursive: true,
      mode: 0o700,
    });
    copyFileSync(sourceFile, path.join(pending, relative));
    chmodSync(path.join(pending, relative), 0o600);
  }
  writeFileSync(
    path.join(pending, "manifest.json"),
    JSON.stringify(
      {
        format: "menuao-snapshot-v1",
        createdAt: new Date().toISOString(),
        files: files.map((relative) => ({
          path: relative,
          ...digest(safeFile(pending, relative)),
        })),
        counts: info.counts,
        encryptionKeyIncluded: false,
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600, flag: "wx" },
  );
  const verified = verifySnapshot(pending);
  renameSync(pending, complete);
  return { ...verified, snapshot: complete };
}
export function restoreSnapshot(
  snapshot,
  destination,
  liveDataDir = process.env.DATA_DIR || "./data",
) {
  snapshot = path.resolve(snapshot);
  destination = path.resolve(destination);
  liveDataDir = path.resolve(liveDataDir);
  const within = (candidate, root) =>
    candidate === root || candidate.startsWith(root + path.sep);
  if (
    within(destination, liveDataDir) ||
    within(destination, snapshot) ||
    within(snapshot, destination)
  )
    throw Error(
      "Restore verification requires an isolated directory outside live data and the snapshot",
    );
  const verified = verifySnapshot(snapshot);
  if (existsSync(destination))
    throw Error("Restore destination must not exist");
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  const manifest = JSON.parse(
    readFileSync(path.join(snapshot, "manifest.json"), "utf8"),
  );
  for (const entry of manifest.files) {
    mkdirSync(path.dirname(path.join(destination, entry.path)), {
      recursive: true,
      mode: 0o700,
    });
    copyFileSync(
      safeFile(snapshot, entry.path),
      path.join(destination, entry.path),
    );
    chmodSync(path.join(destination, entry.path), 0o600);
  }
  writeFileSync(
    path.join(destination, "manifest.json"),
    JSON.stringify(manifest),
    { mode: 0o600, flag: "wx" },
  );
  const restored = verifySnapshot(destination);
  if (JSON.stringify(restored.counts) !== JSON.stringify(verified.counts))
    throw Error("Restore count mismatch");
  return { ...restored, destination };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    console.log(
      JSON.stringify(
        await createSnapshot(
          process.env.DATA_DIR || "./data",
          process.env.BACKUP_DIR,
        ),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(
      "Backup failed; incomplete snapshots must not be used:",
      error.message,
    );
    process.exitCode = 1;
  }
}
