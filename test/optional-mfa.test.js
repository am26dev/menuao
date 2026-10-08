import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { totp } from "../security.mjs";
test("Optional MFA for establishment accounts", async () => {
  const data = mkdtempSync(path.join(tmpdir(), "menuao-mfa-"));
  const base = "http://127.0.0.1:3106",
    password = "Owner-test-password-2026!";
  const child = spawn(process.execPath, ["server.js"], {
    env: {
      ...process.env,
      PORT: "3106",
      DATA_DIR: data,
      PUBLIC_URL: base,
      NODE_ENV: "test",
      STAFF_ADMIN_ACTIVATION: "a".repeat(64),
    },
    stdio: "ignore",
  });
  async function request(url, method = "GET", body, cookie) {
    const r = await fetch(base + "/api" + url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Origin: base,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: r.status,
      data: await r.json(),
      cookie: r.headers.get("set-cookie")?.split(";")[0],
    };
  }
  try {
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(base + "/api/health")).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 50));
    }
    let b = await request("/register", "POST", {
      email: "owner-b@example.test",
      password,
    });
    assert.equal(
      (
        await request("/staff/login", "POST", {
          email: "owner-b@example.test",
          password,
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await request("/staff/activate", "POST", {
          token: "a".repeat(64),
          password,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request("/login", "POST", {
          email: "muaza.alfredo@gmail.com",
          password,
        })
      ).status,
      401,
    );
    const admin = await request("/staff/login", "POST", {
      email: "muaza.alfredo@gmail.com",
      password,
    });
    assert.equal(admin.data.role, "admin");
    assert.equal(
      (await request("/admin/overview", "GET", undefined, admin.cookie)).status,
      200,
    );
    const setup = await request("/staff/mfa/setup", "GET", undefined, b.cookie);
    assert.equal(setup.status, 200);
    const enabled = await request(
      "/staff/mfa/enable",
      "POST",
      { confirmationPassword: password, code: totp(setup.data.secret) },
      b.cookie,
    );
    assert.equal(enabled.status, 200);
    const challenge = await request("/login", "POST", {
      email: "owner-b@example.test",
      password,
    });
    assert.equal(challenge.data.mfaRequired, true);
    assert.equal(challenge.cookie, undefined);
    assert.equal(
      (
        await request("/login", "POST", {
          email: "owner-b@example.test",
          password,
          code: "wrong",
        })
      ).status,
      401,
    );
    const login = await request("/login", "POST", {
      email: "owner-b@example.test",
      password,
      code: enabled.data.recoveryCodes[0],
    });
    assert.equal(login.data.role, "owner");
    assert.equal(
      (
        await request(
          "/account/mfa/disable",
          "POST",
          {
            confirmationPassword: "wrong",
            code: enabled.data.recoveryCodes[1],
          },
          login.cookie,
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await request(
          "/account/mfa/disable",
          "POST",
          {
            confirmationPassword: password,
            code: enabled.data.recoveryCodes[1],
          },
          login.cookie,
        )
      ).status,
      200,
    );
    assert.equal(
      (await request("/me", "GET", undefined, login.cookie)).status,
      401,
    );
    b = await request("/login", "POST", {
      email: "owner-b@example.test",
      password,
    });
    assert.equal(b.data.role, "owner");
  } finally {
    child.kill();
    await new Promise((r) => child.once("exit", r));
    rmSync(data, { recursive: true, force: true });
  }
});
