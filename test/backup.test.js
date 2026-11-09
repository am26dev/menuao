import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import {
  createSnapshot,
  verifySnapshot,
  restoreSnapshot,
} from "../scripts/backup.mjs";

test("Complete backups restore accounts, products, images and private receipts and reject corruption", async () => {
  const parent = path.resolve("test-data");
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(path.join(parent, "backup-")),
    data = path.join(root, "live");
  mkdirSync(path.join(data, "uploads"), { recursive: true });
  mkdirSync(path.join(data, "receipts"));
  const db = new DatabaseSync(path.join(data, "menu.sqlite"));
  try {
    db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT); CREATE TABLE spaces(id INTEGER,owner INTEGER REFERENCES users(id)); CREATE TABLE products(id INTEGER,space INTEGER,name TEXT); CREATE TABLE media(url TEXT); CREATE TABLE payment_proofs(filename TEXT); INSERT INTO users VALUES(1,'synthetic@example.test'); INSERT INTO spaces VALUES(1,1); INSERT INTO products VALUES(1,1,'Restored menu'); INSERT INTO media VALUES('/uploads/1-image.webp'); INSERT INTO payment_proofs VALUES('proof.pdf');",
    );
    writeFileSync(
      path.join(data, "uploads/1-image.webp"),
      Buffer.from([1, 2, 3, 4]),
    );
    writeFileSync(path.join(data, "receipts/proof.pdf"), "%PDF-synthetic");
    const snapshot = await createSnapshot(data);
    assert.deepEqual(snapshot.counts, {
      users: 1,
      spaces: 1,
      products: 1,
      media: 1,
      payment_proofs: 1,
    });
    assert.equal(snapshot.files, 3);
    const destination = path.join(root, "restored");
    assert.equal(
      restoreSnapshot(snapshot.snapshot, destination, data).ok,
      true,
    );
    assert.deepEqual(
      readFileSync(path.join(destination, "uploads/1-image.webp")),
      Buffer.from([1, 2, 3, 4]),
    );
    assert.equal(
      readFileSync(path.join(destination, "receipts/proof.pdf"), "utf8"),
      "%PDF-synthetic",
    );
    const restored = new DatabaseSync(path.join(destination, "menu.sqlite"), {
      readOnly: true,
    });
    assert.equal(
      restored.prepare("SELECT email FROM users").get().email,
      "synthetic@example.test",
    );
    assert.equal(
      restored.prepare("SELECT name FROM products").get().name,
      "Restored menu",
    );
    restored.close();
    assert.throws(
      () => restoreSnapshot(snapshot.snapshot, data, data),
      /isolated/,
    );
    assert.throws(
      () => restoreSnapshot(snapshot.snapshot, destination, data),
      /must not exist/,
    );
    const job = spawnSync(process.execPath, ["scripts/backup-job.mjs"], {
      env: { ...process.env, DATA_DIR: data },
      encoding: "utf8",
    });
    assert.equal(job.status, 0, job.stderr);
    const successfulStatus = JSON.parse(
      readFileSync(path.join(data, "backup-status.json"), "utf8"),
    );
    assert.equal(successfulStatus.ok, true);
    assert.equal(successfulStatus.files, 3);
    writeFileSync(
      path.join(snapshot.snapshot, "receipts/proof.pdf"),
      "corrupted",
    );
    assert.throws(() => verifySnapshot(snapshot.snapshot), /checksum/);
    db.exec("INSERT INTO media VALUES('/uploads/missing.webp')");
    await assert.rejects(createSnapshot(data));
    assert.equal(
      readdirSync(path.join(data, "backups")).filter((name) =>
        name.startsWith("snapshot-"),
      ).length,
      2,
    );
    const failedJob = spawnSync(process.execPath, ["scripts/backup-job.mjs"], {
      env: { ...process.env, DATA_DIR: data },
      encoding: "utf8",
    });
    assert.equal(failedJob.status, 1);
    const failedStatus = JSON.parse(
      readFileSync(path.join(data, "backup-status.json"), "utf8"),
    );
    assert.equal(failedStatus.ok, false);
    assert.equal(failedStatus.lastSuccess, successfulStatus.lastSuccess);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users").get().n, 1);
  } finally {
    db.close();
    assert.ok(root.startsWith(parent + path.sep));
    rmSync(root, { recursive: true, force: true });
  }
});
