import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { createHash } from "node:crypto";
import { totp } from "../security.mjs";
test("Password recovery, temporary administrator and subscription periods", async (t) => {
  mkdirSync("test-data", { recursive: true });
  const data = mkdtempSync(path.resolve("test-data/account-")),
    outbox = path.join(data, "outbox.jsonl"),
    base = "http://127.0.0.1:3103",
    bootstrap = "d".repeat(64),
    temporary = "Temporary-admin-test-only-2026!",
    password = "New-personal-admin-test-only-2026!";
  const child = spawn(process.execPath, ["server.js"], {
    env: {
      ...process.env,
      PORT: "3103",
      DATA_DIR: data,
      PUBLIC_URL: base,
      NODE_ENV: "test",
      STAFF_ADMIN_ACTIVATION: bootstrap,
      MAIL_TEST_OUTBOX: outbox,
    },
    stdio: "pipe",
  });
  let logs = "";
  child.stderr.on("data", (d) => (logs += d));
  async function api(url, body, cookie = "", method = "POST") {
    const r = await fetch(base + "/api" + url, {
      method,
      headers: {
        Origin: base,
        "Content-Type": "application/json",
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
  let owner, admin, db;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(base + "/api/health")).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(ready, logs);
    db = new DatabaseSync(path.join(data, "menu.sqlite"));
    for (const page of ["/esqueci-senha", "/redefinir-senha", "/alterar-senha"])
      assert.equal((await fetch(base + page)).status, 200);
    await t.test(
      "Temporary password forces replacement and preserves MFA gate",
      async () => {
        assert.equal(
          (
            await api("/staff/activate", {
              token: bootstrap,
              password: temporary,
              provisional: true,
            })
          ).status,
          200,
        );
        admin = await api("/staff/login", {
          email: "muaza.alfredo@gmail.com",
          password: temporary,
        });
        assert.equal(admin.data.mustChangePassword, true);
        assert.equal(
          (await api("/staff/mfa/setup", undefined, admin.cookie, "GET"))
            .status,
          403,
        );
        assert.equal(
          (
            await api(
              "/account/password",
              { currentPassword: "wrong", password },
              admin.cookie,
            )
          ).status,
          401,
        );
        assert.equal(
          (
            await api(
              "/account/password",
              { currentPassword: temporary, password: temporary },
              admin.cookie,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await api(
              "/account/password",
              { currentPassword: temporary, password },
              admin.cookie,
            )
          ).status,
          200,
        );
        assert.equal(
          (await api("/me", undefined, admin.cookie, "GET")).status,
          401,
        );
        assert.equal(
          (
            await api("/staff/login", {
              email: "muaza.alfredo@gmail.com",
              password: temporary,
            })
          ).status,
          401,
        );
        admin = await api("/staff/login", {
          email: "muaza.alfredo@gmail.com",
          password,
        });
        assert.equal(admin.data.mustChangePassword, false);
        const setup = await api(
          "/staff/mfa/setup",
          undefined,
          admin.cookie,
          "GET",
        );
        assert.equal(setup.status, 200);
        assert.equal(
          (
            await api(
              "/staff/mfa/enable",
              { confirmationPassword: password, code: totp(setup.data.secret) },
              admin.cookie,
            )
          ).status,
          200,
        );
      },
    );
    await t.test(
      "Monthly prices, three periods and pending requests",
      async () => {
        owner = await api("/register", {
          email: "recovery@example.test",
          password: "Owner-initial-test-only-2026!",
          plan: "profissional",
          billingCycle: "anual",
        });
        const me = await api("/me", undefined, owner.cookie, "GET");
        assert.equal(me.data.plans.essencial.price, 7995);
        assert.equal(me.data.plans.profissional.price, 14995);
        assert.equal(me.data.plans.multiespacos.price, 23995);
        assert.deepEqual(
          Object.values(me.data.billingCycles).map((x) => x.months),
          [3, 6, 12],
        );
        assert.equal(me.data.subscription.requested_cycle, "anual");
        for (const [cycle, m] of [
          ["trimestral", 3],
          ["semestral", 6],
          ["anual", 12],
        ]) {
          const r = await api(
            "/account/subscription-request",
            { plan: "essencial", billingCycle: cycle },
            owner.cookie,
          );
          assert.equal(r.data.total, 7995 * m);
        }
        assert.equal(
          (
            await api(
              "/account/subscription-request",
              { plan: "essencial", billingCycle: "mensal" },
              owner.cookie,
            )
          ).status,
          400,
        );
        const id = me.data.id;
        for (const [cycle, m] of [
          ["trimestral", 3],
          ["semestral", 6],
          ["anual", 12],
        ]) {
          const r = await api(
            "/admin/subscriptions/" + id,
            {
              plan: "profissional",
              billingCycle: cycle,
              status: "active",
              reference: "test-payment",
              confirmationPassword: password,
            },
            admin.cookie,
            "PUT",
          );
          assert.equal(r.status, 200);
          const saved = db
            .prepare("SELECT * FROM subscriptions WHERE user=?")
            .get(id);
          assert.equal(saved.billing_cycle, cycle);
          assert.ok(saved.ends_at > Date.now() + (m * 28 - 1) * 86400000);
          assert.equal(saved.requested_cycle, null);
        }
        assert.equal(
          (
            await api(
              "/admin/subscriptions/" + id,
              {
                plan: "profissional",
                billingCycle: "bad",
                status: "active",
                reference: "test",
                confirmationPassword: password,
              },
              admin.cookie,
              "PUT",
            )
          ).status,
          400,
        );
      },
    );
    await t.test(
      "Angola phone formats, persistent request receipt and repeat submission",
      async () => {
        for (const page of ["/assinatura"])
          assert.equal((await fetch(base + page)).status, 200);
        const payload = {
          name: "100 MISÉRIA",
          slug: "100miseria",
          whatsapp: "+244 936479545",
          address: "Talatona, Luanda",
          description: "PIZZA | BURGER | FAHITA | SANDWICH | CARNES",
          hours: "Terça a Domingo – 8:00 até às 22:00",
          published: true,
        };
        const created = await api("/space", payload, owner.cookie, "PUT");
        assert.equal(created.status, 200);
        let me = await api("/me", undefined, owner.cookie, "GET"),
          space = me.data.spaces.find((s) => s.slug === "100miseria");
        assert.equal(space.whatsapp, "244936479545");
        assert.equal(space.name, "100 MISÉRIA");
        for (const phone of ["936479545", "244936479545", "+244 936 479 545"])
          assert.equal(
            (
              await api(
                "/space",
                { ...payload, id: space.id, whatsapp: phone },
                owner.cookie,
                "PUT",
              )
            ).status,
            200,
          );
        for (const phone of ["93647954", "+351936479545", "9364795455"])
          assert.equal(
            (
              await api(
                "/space",
                { ...payload, id: space.id, whatsapp: phone },
                owner.cookie,
                "PUT",
              )
            ).status,
            400,
          );
        const original = me.data.subscription.ends_at;
        const r = await api(
          "/account/subscription-request",
          { plan: "essencial", billingCycle: "semestral", kind: "change" },
          owner.cookie,
        );
        assert.equal(r.status, 200);
        assert.match(r.data.requestId, /^MO-[A-F0-9]{12}$/);
        const repeated = await api(
          "/account/subscription-request",
          { plan: "essencial", billingCycle: "semestral", kind: "change" },
          owner.cookie,
        );
        assert.equal(repeated.data.requestId, r.data.requestId);
        assert.equal(repeated.data.alreadyRequested, true);
        me = await api("/me", undefined, owner.cookie, "GET");
        assert.equal(me.data.subscription.request_id, r.data.requestId);
        assert.equal(me.data.subscription.ends_at, original);
        assert.equal(me.data.subscription.status, "active");
        const overview = await api(
          "/admin/overview",
          undefined,
          admin.cookie,
          "GET",
        );
        assert.equal(
          overview.data.users.find((u) => u.id === me.data.id).request_id,
          r.data.requestId,
        );
        const renewal = await api(
          "/account/subscription-request",
          { plan: "profissional", billingCycle: "anual", kind: "renew" },
          owner.cookie,
        );
        assert.equal(renewal.status, 200);
        assert.notEqual(renewal.data.requestId, r.data.requestId);
        assert.equal(
          (
            await api(
              "/admin/subscriptions/" + me.data.id,
              {
                plan: "profissional",
                billingCycle: "anual",
                status: "active",
                reference: "renewal-test",
                confirmationPassword: password,
              },
              admin.cookie,
              "PUT",
            )
          ).status,
          200,
        );
        const renewed = await api("/me", undefined, owner.cookie, "GET");
        assert.ok(
          renewed.data.subscription.ends_at > original + 364 * 86400000,
        );
        assert.equal(renewed.data.subscription.request_id, null);
        assert.equal(
          (
            await api(
              "/account/subscription-request",
              { plan: "essencial", billingCycle: "anual", kind: "invalid" },
              owner.cookie,
            )
          ).status,
          400,
        );
      },
    );
    await t.test(
      "Forgot password does not disclose accounts; links are hashed, single use and revoke sessions",
      async () => {
        const known = await api("/password/forgot", {
            email: "recovery@example.test",
          }),
          unknown = await api("/password/forgot", {
            email: "missing@example.test",
          });
        assert.deepEqual(known.data, unknown.data);
        assert.equal(known.data.deliveryAvailable, true);
        const messages = readFileSync(outbox, "utf8")
          .trim()
          .split("\n")
          .map(JSON.parse);
        assert.equal(messages.length, 1);
        const token = messages[0].text.match(
          /redefinir-senha#([a-f0-9]{64})/,
        )[1];
        assert.equal(
          db.prepare("SELECT token FROM password_resets").get().token,
          createHash("sha256").update(token).digest("hex"),
        );
        assert.equal(
          (await api("/password/reset", { token: "wrong", password })).status,
          403,
        );
        assert.equal(
          (await api("/password/reset", { token, password: "short" })).status,
          400,
        );
        assert.equal(
          (
            await api("/password/reset", {
              token,
              password: "Owner-reset-test-only-2026!",
            })
          ).status,
          200,
        );
        assert.equal(
          (await api("/password/reset", { token, password })).status,
          403,
        );
        assert.equal(
          (await api("/me", undefined, owner.cookie, "GET")).status,
          401,
        );
        owner = await api("/login", {
          email: "recovery@example.test",
          password: "Owner-reset-test-only-2026!",
        });
        assert.equal(owner.status, 200);
        assert.equal(
          (
            await api(
              "/admin/password-reset",
              {
                email: "muaza.alfredo@gmail.com",
                confirmationPassword: password,
              },
              owner.cookie,
            )
          ).status,
          403,
        );
      },
    );
    await t.test(
      "Expired and replaced links fail; assisted reset retains two-factor authentication",
      async () => {
        const first = await api(
            "/admin/password-reset",
            { email: "recovery@example.test", confirmationPassword: password },
            admin.cookie,
          ),
          second = await api(
            "/admin/password-reset",
            { email: "recovery@example.test", confirmationPassword: password },
            admin.cookie,
          );
        assert.equal(
          (
            await api("/password/reset", {
              token: first.data.resetUrl.split("#")[1],
              password,
            })
          ).status,
          403,
        );
        db.prepare("UPDATE password_resets SET expires=?").run(Date.now() - 1);
        assert.equal(
          (
            await api("/password/reset", {
              token: second.data.resetUrl.split("#")[1],
              password,
            })
          ).status,
          403,
        );
        const staffReset = await api(
          "/admin/password-reset",
          { email: "muaza.alfredo@gmail.com", confirmationPassword: password },
          admin.cookie,
        );
        assert.equal(
          (
            await api("/password/reset", {
              token: staffReset.data.resetUrl.split("#")[1],
              password: "Changed-admin-test-only-2026!",
            })
          ).status,
          200,
        );
        assert.equal(
          db.prepare("SELECT mfa_enabled FROM users WHERE role='admin'").get()
            .mfa_enabled,
          1,
        );
        assert.equal(
          (
            await api("/staff/login", {
              email: "muaza.alfredo@gmail.com",
              password: "Changed-admin-test-only-2026!",
            })
          ).data.mfaRequired,
          true,
        );
      },
    );
  } finally {
    db?.close();
    child.kill();
    await new Promise((r) => child.once("exit", r));
    rmSync(data, { recursive: true, force: true });
  }
});
