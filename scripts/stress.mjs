import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
const root = path.resolve("test-data");
mkdirSync(root, { recursive: true });
const results = [];
async function scenario(name, fn) {
  const data = mkdtempSync(path.join(root, "stress-")),
    base = "http://127.0.0.1:3105";
  const child = spawn(process.execPath, ["server.js"], {
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: "3105",
      DATA_DIR: data,
      PUBLIC_URL: base,
      TRUST_PROXY_HOPS: "0",
      STAFF_ADMIN_ACTIVATION: "",
      STAFF_MANAGER_ACTIVATION: "",
      SMTP_HOST: "",
      SMTP_USER: "",
      SMTP_PASSWORD: "",
      SMTP_FROM: "",
      MAIL_TEST_OUTBOX: "",
    },
    stdio: "pipe",
  });
  let logs = "";
  child.stderr.on("data", (d) => (logs += d));
  async function req(url, body, cookie = "", method = body ? "POST" : "GET") {
    const t = performance.now();
    const r = await fetch(base + "/api" + url, {
      method,
      headers: {
        Origin: base,
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const text = await r.text();
    return {
      status: r.status,
      data: JSON.parse(text),
      cookie: r.headers.get("set-cookie")?.split(";")[0],
      ms: performance.now() - t,
    };
  }
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        if ((await req("/health")).status === 200) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(ready, logs);
    results.push({ name, ...(await fn(req)) });
  } finally {
    child.kill();
    await new Promise((r) => child.once("exit", r));
    assert.ok(data.startsWith(root + path.sep));
    rmSync(data, { recursive: true, force: true });
  }
}
async function burst(n, concurrency, fn) {
  let next = 0;
  const responses = [],
    start = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < n) {
        const i = next++;
        responses.push(await fn(i));
      }
    }),
  );
  const elapsed = performance.now() - start,
    times = responses.map((r) => r.ms).sort((a, b) => a - b),
    statuses = {};
  for (const r of responses) statuses[r.status] = (statuses[r.status] || 0) + 1;
  assert.equal(
    responses.some((r) => r.status >= 500),
    false,
  );
  return {
    requests: n,
    concurrency,
    durationMs: Math.round(elapsed),
    p95Ms: Math.round(times[Math.ceil(times.length * 0.95) - 1]),
    statuses,
    responses,
  };
}
await scenario(
  "Concurrent establishment limit and subscription idempotency",
  async (req) => {
    const owner = await req("/register", {
      email: "stress@example.test",
      password: "Stress-test-only-password-2026!",
    });
    assert.equal(owner.status, 200);
    const spaces = await burst(80, 20, (i) =>
      req(
        "/space",
        {
          name: "100 MISÉRIA " + i,
          slug: "stress-" + i,
          whatsapp: "+244 936479545",
          published: true,
        },
        owner.cookie,
        "PUT",
      ),
    );
    assert.equal(spaces.statuses[200], 2);
    assert.equal(spaces.statuses[409], 78);
    const subs = await burst(80, 20, () =>
      req(
        "/account/subscription-request",
        { plan: "essencial", billingCycle: "trimestral", kind: "new" },
        owner.cookie,
      ),
    );
    assert.equal(subs.statuses[200], 80);
    assert.equal(new Set(subs.responses.map((r) => r.data.requestId)).size, 1);
    const me = await req("/me", undefined, owner.cookie);
    assert.equal(me.data.spaces.length, 2);
    delete spaces.responses;
    delete subs.responses;
    return { spaces, subscriptions: subs };
  },
);
await scenario("Read burst and overload protection", async (req) => {
  const r = await burst(2000, 50, () => req("/health"));
  assert.ok(r.statuses[200] > 0);
  assert.ok(r.statuses[429] > 0);
  delete r.responses;
  return r;
});
await scenario("Concurrent password guessing is limited", async (req) => {
  const r = await burst(80, 10, () =>
    req("/login", {
      email: "unknown@example.test",
      password: "wrong-password",
    }),
  );
  assert.ok(r.statuses[401] > 0);
  assert.ok(r.statuses[429] > 0);
  delete r.responses;
  return r;
});
console.log(
  JSON.stringify(
    {
      environment: "isolated local Node.js process; no production load",
      results,
    },
    null,
    2,
  ),
);
