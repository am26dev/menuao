import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { totp } from "../security.mjs";

test("Authentication remains valid across concurrent account changes", async (t) => {
  const data = mkdtempSync(path.join(tmpdir(), "menuao-auth-races-")),
    gate = path.join(data, "scrypt-gate"),
    marker = path.join(data, "scrypt-ready"),
    base = "http://127.0.0.1:3108",
    password = "Race-test-password-2026!";
  // Pause completed password checks before their callers resume. This makes
  // the interleavings deterministic without changing production code.
  const preload = `
    import crypto from 'node:crypto';
    import { syncBuiltinESMExports } from 'node:module';
    import { existsSync, appendFileSync, readFileSync, writeFileSync } from 'node:fs';
    const original = crypto.scrypt;
    crypto.scrypt = function (...args) {
      const callback = args.pop(), input = args[0];
      original(...args, (...result) => {
        if (!existsSync(${JSON.stringify(gate)})) return callback(...result);
        const config = JSON.parse(readFileSync(${JSON.stringify(gate)}, 'utf8'));
        if (input !== config.input) return callback(...result);
        if (config.skip > 0) {
          config.skip--;
          writeFileSync(${JSON.stringify(gate)}, JSON.stringify(config));
          return callback(...result);
        }
        appendFileSync(${JSON.stringify(marker)}, 'ready\\n');
        const timer = setInterval(() => {
          if (!existsSync(${JSON.stringify(gate)})) {
            clearInterval(timer);
            callback(...result);
          }
        }, 5);
      });
    };
    syncBuiltinESMExports();
  `;
  const child = spawn(
    process.execPath,
    [
      "--import",
      "data:text/javascript," + encodeURIComponent(preload),
      "server.js",
    ],
    {
      env: {
        ...process.env,
        PORT: "3108",
        DATA_DIR: data,
        PUBLIC_URL: base,
        NODE_ENV: "test",
      },
      stdio: "pipe",
    },
  );
  let logs = "",
    db;
  child.stderr.on("data", (chunk) => (logs += chunk));
  async function api(url, body, cookie) {
    const response = await fetch(base + "/api" + url, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: base,
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  }
  async function waitFor(predicate, description) {
    for (let i = 0; i < 200; i++) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.fail(description + "\n" + logs);
  }
  function pauseChecks(input = password, skip = 0) {
    writeFileSync(marker, "");
    writeFileSync(gate, JSON.stringify({ input, skip }));
  }
  async function checksReady(count) {
    await waitFor(
      () =>
        readFileSync(marker, "utf8").trim().split("\n").filter(Boolean)
          .length >= count,
      "Password checks did not reach the gate",
    );
  }
  function resumeChecks() {
    if (existsSync(gate)) rmSync(gate);
  }
  try {
    await waitFor(async () => {
      try {
        return (await fetch(base + "/api/health")).ok;
      } catch {
        return false;
      }
    }, "Server failed to start");
    db = new DatabaseSync(path.join(data, "menu.sqlite"));
    db.exec("PRAGMA busy_timeout=5000");
    const email = "recovery-race@example.test";
    const registered = await api("/register", { email, password });
    assert.equal(registered.status, 200);
    const setup = await api("/staff/mfa/setup", undefined, registered.cookie);
    const enabled = await api(
      "/staff/mfa/enable",
      { confirmationPassword: password, code: totp(setup.data.secret) },
      registered.cookie,
    );
    assert.equal(enabled.status, 200);

    await t.test(
      "Parallel recovery codes cannot restore a consumed code",
      async () => {
        pauseChecks();
        const codes = enabled.data.recoveryCodes.slice(0, 2);
        const pending = codes.map((code) =>
          api("/login", { email, password, code }),
        );
        await checksReady(2);
        resumeChecks();
        const results = await Promise.all(pending);
        assert.deepEqual(
          results.map((result) => result.status),
          [200, 200],
        );
        const remaining = JSON.parse(
          db.prepare("SELECT recovery FROM users WHERE email=?").get(email)
            .recovery,
        );
        for (const code of codes) {
          const hash = createHash("sha256").update(code).digest("hex");
          assert.ok(!remaining.includes(hash), "A consumed code was restored");
          assert.equal(
            (await api("/login", { email, password, code })).status,
            401,
          );
        }
      },
    );

    await t.test(
      "The same recovery code is accepted only once in parallel",
      async () => {
        pauseChecks();
        const code = enabled.data.recoveryCodes[2];
        const pending = [
          api("/mobile/login", { email, password, code }),
          api("/mobile/login", { email, password, code }),
        ];
        await checksReady(2);
        resumeChecks();
        const results = await Promise.all(pending);
        assert.deepEqual(
          results.map((result) => result.status).sort(),
          [200, 401],
        );
      },
    );

    await t.test(
      "A password reset prevents an in-flight old-password login",
      async () => {
        const email = "password-race@example.test",
          nextPassword = "Replacement-password-2026!",
          token = "b".repeat(64);
        assert.equal((await api("/register", { email, password })).status, 200);
        const user = db
          .prepare("SELECT id FROM users WHERE email=?")
          .get(email);
        db.prepare("INSERT INTO password_resets VALUES(?,?,?)").run(
          createHash("sha256").update(token).digest("hex"),
          user.id,
          Date.now() + 60000,
        );
        pauseChecks();
        const pending = api("/login", { email, password });
        await checksReady(1);
        assert.equal(
          (await api("/password/reset", { token, password: nextPassword }))
            .status,
          200,
        );
        resumeChecks();
        const result = await pending;
        assert.equal(result.status, 401);
        assert.equal(result.cookie, undefined);
        assert.equal(
          db
            .prepare("SELECT COUNT(*) AS n FROM sessions WHERE user=?")
            .get(user.id).n,
          0,
        );
        assert.equal(
          (await api("/login", { email, password: nextPassword })).status,
          200,
        );
      },
    );

    await t.test(
      "A completed reset cannot be overwritten by an in-flight password change",
      async () => {
        const email = "change-race@example.test",
          stalePassword = "Stale-change-password-2026!",
          resetPassword = "Latest-reset-password-2026!",
          token = "c".repeat(64);
        const registered = await api("/register", { email, password });
        assert.equal(registered.status, 200);
        const user = db
          .prepare("SELECT id FROM users WHERE email=?")
          .get(email);
        db.prepare("INSERT INTO password_resets VALUES(?,?,?)").run(
          createHash("sha256").update(token).digest("hex"),
          user.id,
          Date.now() + 60000,
        );
        // Let the new-password comparison finish, then hold its final derivation.
        pauseChecks(stalePassword, 1);
        const pending = api(
          "/account/password",
          { currentPassword: password, password: stalePassword },
          registered.cookie,
        );
        await checksReady(1);
        assert.equal(
          (await api("/password/reset", { token, password: resetPassword }))
            .status,
          200,
        );
        const current = await api("/login", { email, password: resetPassword });
        assert.equal(current.status, 200);
        const before = db
          .prepare("SELECT password,salt FROM users WHERE id=?")
          .get(user.id);
        resumeChecks();
        assert.equal((await pending).status, 401);
        assert.deepEqual(
          db.prepare("SELECT password,salt FROM users WHERE id=?").get(user.id),
          before,
        );
        assert.equal((await api("/me", undefined, current.cookie)).status, 200);
        assert.equal(
          (await api("/login", { email, password: stalePassword })).status,
          401,
        );
        assert.equal(
          db
            .prepare(
              "SELECT COUNT(*) AS n FROM audit WHERE actor=? AND action='password.changed'",
            )
            .get(user.id).n,
          0,
        );
      },
    );

    await t.test(
      "An account disabled during reset keeps its credentials and reset token",
      async () => {
        const email = "disabled-reset-race@example.test",
          replacement = "Disabled-reset-password-2026!",
          token = "d".repeat(64);
        assert.equal((await api("/register", { email, password })).status, 200);
        const user = db.prepare("SELECT * FROM users WHERE email=?").get(email);
        const hash = createHash("sha256").update(token).digest("hex");
        db.prepare("INSERT INTO password_resets VALUES(?,?,?)").run(
          hash,
          user.id,
          Date.now() + 60000,
        );
        pauseChecks(replacement, 1);
        const pending = api("/password/reset", {
          token,
          password: replacement,
        });
        await checksReady(1);
        db.prepare("UPDATE users SET disabled=1 WHERE id=?").run(user.id);
        const sessions = db
          .prepare("SELECT token FROM sessions WHERE user=?")
          .all(user.id);
        resumeChecks();
        assert.equal((await pending).status, 403);
        const current = db
          .prepare("SELECT * FROM users WHERE id=?")
          .get(user.id);
        assert.equal(current.password, user.password);
        assert.equal(current.salt, user.salt);
        assert.ok(
          db
            .prepare("SELECT token FROM password_resets WHERE token=?")
            .get(hash),
        );
        assert.deepEqual(
          db.prepare("SELECT token FROM sessions WHERE user=?").all(user.id),
          sessions,
        );
      },
    );
    await t.test("Logout cancels an in-flight account deletion", async () => {
      db.exec("DELETE FROM limits");
      const email = "logout-race@example.test";
      const registered = await api("/register", { email, password });
      assert.equal(registered.status, 200);
      pauseChecks();
      const pending = api("/account/delete", { password }, registered.cookie);
      await checksReady(1);
      assert.equal((await api("/logout", {}, registered.cookie)).status, 200);
      resumeChecks();
      assert.equal((await pending).status, 401);
      assert.ok(db.prepare("SELECT id FROM users WHERE email=?").get(email));
    });
    await t.test(
      "Deleting an MFA-protected account requires its second factor",
      async () => {
        db.exec("DELETE FROM limits");
        const email = "delete-mfa@example.test";
        const registered = await api("/register", { email, password });
        const setup = await api(
          "/staff/mfa/setup",
          undefined,
          registered.cookie,
        );
        const enabled = await api(
          "/staff/mfa/enable",
          { confirmationPassword: password, code: totp(setup.data.secret) },
          registered.cookie,
        );
        assert.equal(enabled.status, 200);
        assert.equal(
          (await api("/account/delete", { password }, registered.cookie))
            .status,
          401,
        );
        assert.ok(db.prepare("SELECT id FROM users WHERE email=?").get(email));
        assert.equal(
          (
            await api(
              "/account/delete",
              { password, code: enabled.data.recoveryCodes[0] },
              registered.cookie,
            )
          ).status,
          200,
        );
        assert.equal(
          db.prepare("SELECT id FROM users WHERE email=?").get(email),
          undefined,
        );
      },
    );
  } finally {
    resumeChecks();
    db?.close();
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
    rmSync(data, { recursive: true, force: true });
  }
});
