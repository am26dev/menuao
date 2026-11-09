// Only starts its own disposable loopback server. It cannot target production.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
import path from "node:path";
const parent = path.resolve("test-data");
mkdirSync(parent, { recursive: true });
const data = mkdtempSync(path.join(parent, "capacity-"));
const base = "http://127.0.0.1:3111";
let child;
async function start() {
  child = spawn(process.execPath, ["server.js"], {
    env: {
      ...process.env,
      PORT: "3111",
      PUBLIC_URL: base,
      DATA_DIR: data,
      NODE_ENV: "test",
      TRUST_PROXY_HOPS: "0",
      STAFF_ADMIN_ACTIVATION: "",
      STAFF_MANAGER_ACTIVATION: "",
      SMTP_HOST: "",
      SMTP_PASSWORD: "",
      SMTP_USER: "",
      SMTP_FROM: "",
      MAIL_TEST_OUTBOX: "",
    },
    stdio: "pipe",
  });
  let logs = "";
  child.stderr.on("data", (chunk) => {
    logs += chunk;
  });
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) return;
    } catch {}
    if (child.exitCode !== null) throw Error("Test server exited: " + logs);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw Error("Local test server did not start: " + logs);
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const done = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await done;
  child = null;
}
const results = [];
try {
  await start();
  await stop();
  const db = new DatabaseSync(path.join(data, "menu.sqlite"));
  db.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
  const user = db.prepare(
      "INSERT INTO users(id,email,password,salt) VALUES(?,?,?,?)",
    ),
    sub = db.prepare(
      "INSERT INTO subscriptions(user,status,ends_at) VALUES(?,'active',?)",
    ),
    venue = db.prepare(
      "INSERT INTO spaces(id,owner,slug,name,description,published,approval,province,municipality,neighborhood) VALUES(?,?,?,?,?,1,'approved','Luanda','Talatona','Centro')",
    ),
    product = db.prepare(
      "INSERT INTO products(space,name,category,price,available) VALUES(?,?,'Pratos',2500,1)",
    );
  for (let i = 1; i <= 1000; i++) {
    user.run(i, `load-${i}@example.test`, "0".repeat(128), "synthetic-salt");
    sub.run(i, Date.now() + 31536000000);
    venue.run(
      i,
      i,
      "local-" + i,
      i === 100 ? "Local 100%_literal" : "Local " + i,
      "Menu de teste",
    );
    for (let p = 0; p < 20; p++) product.run(i, "Prato " + p);
  }
  db.exec("COMMIT");
  db.close();
  for (const concurrency of [1, 5, 10]) {
    await start();
    const search = await (
      await fetch(
        base + "/api/directory?q=" + encodeURIComponent("100%_literal"),
      )
    ).json();
    assert.equal(
      search.total,
      1,
      "Directory search must escape % and _ literally",
    );
    const escaped = await (
      await fetch(base + "/api/directory?q=" + encodeURIComponent("\\"))
    ).json();
    assert.equal(
      escaped.total,
      0,
      "Directory search must escape backslash literally",
    );
    const menu = await (await fetch(base + "/api/menu/local-500")).json();
    assert.equal(menu.products.length, 20);
    const paths = [
      "/api/health",
      "/api/directory?page=20",
      "/api/menu/local-500",
      "/m/local-500",
      "/",
      "/api/directory?q=Local",
    ];
    let next = 0;
    const timings = [],
      statuses = {},
      started = performance.now();
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (next < 180) {
          const index = next++,
            before = performance.now();
          const response = await fetch(base + paths[index % paths.length], {
            signal: AbortSignal.timeout(10000),
          });
          await response.arrayBuffer();
          timings.push(performance.now() - before);
          statuses[response.status] = (statuses[response.status] || 0) + 1;
        }
      }),
    );
    const durationMs = performance.now() - started;
    timings.sort((a, b) => a - b);
    const result = {
      concurrency,
      requests: 180,
      durationMs: Math.round(durationMs),
      p50Ms: Math.round(timings[Math.ceil(timings.length * 0.5) - 1]),
      p95Ms: Math.round(timings[Math.ceil(timings.length * 0.95) - 1]),
      requestsPerSecond: Math.round(180000 / durationMs),
      statuses,
    };
    results.push(result);
    assert.equal(
      statuses[200],
      180,
      "All normal-capacity requests must succeed",
    );
    await stop();
  }
  console.log(
    JSON.stringify(
      {
        environment: "Isolated local Node.js process; no production load",
        node: process.version,
        fixture: { establishments: 1000, products: 20000 },
        passed: true,
        results,
        limitations:
          "Local results do not establish Hostinger capacity, internet latency, DDoS resilience or a service-level guarantee. Image storage and write-heavy workloads require separate sizing.",
      },
      null,
      2,
    ),
  );
} finally {
  await stop();
  assert.ok(data.startsWith(parent + path.sep));
  rmSync(data, { recursive: true, force: true });
}
