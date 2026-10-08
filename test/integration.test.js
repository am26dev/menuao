import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import { totp } from "../security.mjs";
const base = "http://127.0.0.1:3101",
  password = "Owner-test-password-2026!",
  adminPassword = "Administrator-test-only-2026!",
  bootstrap = "a".repeat(64);
test("Platform security and commercial workflows", async (t) => {
  const testRoot = path.resolve("test-data");
  mkdirSync(testRoot, { recursive: true });
  const data = mkdtempSync(path.join(testRoot, "run-"));
  const server = spawn(process.execPath, ["server.js"], {
    env: {
      ...process.env,
      PORT: "3101",
      DATA_DIR: data,
      STAFF_ADMIN_ACTIVATION: bootstrap,
      PUBLIC_URL: base,
      NODE_ENV: "test",
      TRUST_PROXY_HOPS: "0",
    },
    stdio: "pipe",
  });
  let logs = "";
  server.stderr.on("data", (d) => (logs += d));
  async function request(
    url,
    method = "GET",
    body,
    cookie = "",
    origin = base,
    extra = {},
  ) {
    const r = await fetch(base + "/api" + url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
        ...(origin ? { Origin: origin } : {}),
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: r.status,
      cookie: r.headers.get("set-cookie")?.split(";")[0],
      data: r.headers.get("content-type")?.includes("json")
        ? await r.json()
        : new Uint8Array(await r.arrayBuffer()),
      headers: r.headers,
    };
  }
  let a, b, admin, manager, ownerId, spaceId, productId, photo, managerId;
  const space = {
    name: "Teste Luanda",
    province: "Luanda",
    municipality: "Talatona",
    neighborhood: "Centro",
    slug: "teste-luanda",
    whatsapp: "244923456789",
    address: "Luanda",
    hours: "12–22h",
    description: "Sabores",
    published: true,
  };
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
    await t.test(
      "Authentication, invitations, CSRF and session cookies",
      async () => {
        assert.equal((await request("/me")).status, 401);
        assert.equal((await request("/admin/overview")).status, 401);
        assert.equal(
          (
            await request("/register", "POST", {
              email: "bad",
              password: "short",
            })
          ).status,
          400,
        );
        a = await request("/register", "POST", {
          email: "owner-a@example.test",
          password,
        });
        b = await request("/register", "POST", {
          email: "owner-b@example.test",
          password,
        });
        assert.equal(a.status, 200);
        assert.equal(b.status, 200);
        assert.match(a.headers.get("set-cookie"), /HttpOnly/);
        assert.match(a.headers.get("set-cookie"), /SameSite=Strict/);
        assert.equal(
          (await request("/admin/overview", "GET", undefined, a.cookie)).status,
          403,
        );
        assert.equal(
          (
            await request("/staff/activate", "POST", {
              token: "bad",
              password: adminPassword,
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await request("/staff/activate", "POST", {
              token: bootstrap,
              password: adminPassword,
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await request("/staff/activate", "POST", {
              token: bootstrap,
              password: adminPassword,
            })
          ).status,
          403,
        );
        admin = await request("/staff/login", "POST", {
          email: "muaza.alfredo@gmail.com",
          password: adminPassword,
        });
        assert.equal(admin.status, 200);
        assert.equal(admin.data.role, "admin");
        assert.equal(
          (await request("/admin/overview", "GET", undefined, admin.cookie))
            .status,
          200,
        );
        const adminMfa = (
          await request("/staff/mfa/setup", "GET", undefined, admin.cookie)
        ).data;
        assert.equal(
          (
            await request(
              "/staff/mfa/enable",
              "POST",
              { confirmationPassword: adminPassword, code: "000000" },
              admin.cookie,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              "/staff/mfa/enable",
              "POST",
              {
                confirmationPassword: adminPassword,
                code: totp(adminMfa.secret),
              },
              admin.cookie,
            )
          ).status,
          200,
        );
        assert.equal(
          (
            await request(
              "/space",
              "PUT",
              space,
              a.cookie,
              "https://evil.example",
            )
          ).status,
          403,
        );
        assert.equal(
          (await request("/space", "PUT", space, a.cookie, null)).status,
          403,
        );
        assert.equal(
          (
            await request("/space", "PUT", space, a.cookie, base, {
              "Sec-Fetch-Site": "cross-site",
            })
          ).status,
          403,
        );
        assert.equal(
          (await request("/me", "GET", undefined, "menu_session=%ZZ")).status,
          401,
        );
        assert.equal(
          (await request("/login", "POST", { email: "' OR 1=1 --", password }))
            .status,
          401,
        );
        assert.equal(
          (
            await request("/register", "POST", {
              email: "evil@example.test",
              password,
              role: "admin",
              permissions: ["subscriptions.manage"],
            })
          ).status,
          200,
        );
        const evil = await request("/login", "POST", {
          email: "evil@example.test",
          password,
        });
        assert.equal(
          (await request("/me", "GET", undefined, evil.cookie)).data.role,
          "owner",
        );
      },
    );
    await t.test(
      "Multi-space ownership, plan limits and approval",
      async () => {
        assert.equal(
          (await request("/space", "PUT", space, a.cookie)).status,
          200,
        );
        let me = (await request("/me", "GET", undefined, a.cookie)).data;
        ownerId = me.id;
        spaceId = me.spaces[0].id;
        const fixtureDb = new DatabaseSync(path.join(data, "menu.sqlite"));
        const fixtureImages = Array.from(
          { length: 5 },
          (_, i) => "/uploads/fixture-" + i + ".webp",
        );
        for (const url of fixtureImages)
          fixtureDb
            .prepare("INSERT INTO media(url,owner,bytes) VALUES(?,?,?)")
            .run(url, ownerId, 100);
        fixtureDb
          .prepare("UPDATE spaces SET logo=?,covers=? WHERE id=?")
          .run(
            fixtureImages[0],
            JSON.stringify(fixtureImages.slice(1)),
            spaceId,
          );
        fixtureDb.close();
        assert.equal(
          (
            await request(
              "/space",
              "PUT",
              { ...space, slug: "teste-segundo" },
              a.cookie,
            )
          ).status,
          200,
        );
        assert.equal(
          (
            await request(
              "/space",
              "PUT",
              { ...space, slug: "limite-terceiro" },
              a.cookie,
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await request(
              "/space",
              "PUT",
              { ...space, id: spaceId, name: "Invadido" },
              b.cookie,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await request(
              "/spaces/" + spaceId + "/products",
              "GET",
              undefined,
              b.cookie,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await request(
              "/space",
              "PUT",
              { ...space, whatsapp: "123" },
              a.cookie,
            )
          ).status,
          400,
        );
        assert.equal((await request("/menu/" + space.slug)).status, 404);
        assert.equal((await request("/qr/" + space.slug)).status, 404);
        assert.equal(
          (
            await request(
              "/admin/spaces/" + spaceId,
              "PUT",
              { approval: "approved" },
              admin.cookie,
            )
          ).status,
          401,
        );
        assert.equal(
          (
            await request(
              "/admin/spaces/" + spaceId,
              "PUT",
              { approval: "approved", confirmationPassword: adminPassword },
              admin.cookie,
            )
          ).status,
          200,
        );
        assert.equal((await request("/menu/" + space.slug)).status, 404);
        assert.equal(
          (
            await request(
              "/admin/subscriptions/" + ownerId,
              "PUT",
              {
                plan: "essencial",
                status: "active",
                endsAt: Date.now() + 86400000,
                reference: "TEST-ONLY",
                confirmationPassword: adminPassword,
              },
              admin.cookie,
            )
          ).status,
          200,
        );
        assert.equal((await request("/menu/" + space.slug)).status, 200);
        for (const [plan, limit] of [
          ["profissional", 5],
          ["multiespacos", 10],
        ]) {
          assert.equal(
            (
              await request(
                "/admin/subscriptions/" + ownerId,
                "PUT",
                {
                  plan,
                  status: "active",
                  endsAt: Date.now() + 86400000,
                  reference: "TEST-" + plan,
                  confirmationPassword: adminPassword,
                },
                admin.cookie,
              )
            ).status,
            200,
          );
          let count = (await request("/me", "GET", undefined, a.cookie)).data
            .spaces.length;
          for (let i = count; i < limit; i++)
            assert.equal(
              (
                await request(
                  "/space",
                  "PUT",
                  { ...space, slug: plan + "-" + i },
                  a.cookie,
                )
              ).status,
              200,
            );
          assert.equal(
            (
              await request(
                "/space",
                "PUT",
                { ...space, slug: "too-many-" + plan },
                a.cookie,
              )
            ).status,
            409,
          );
        }
        assert.equal(
          (
            await request(
              "/admin/subscriptions/" + ownerId,
              "PUT",
              {
                plan: "essencial",
                status: "active",
                endsAt: Date.now() + 86400000,
                reference: "DOWNGRADE",
                confirmationPassword: adminPassword,
              },
              admin.cookie,
            )
          ).status,
          409,
        );
      },
    );
    await t.test(
      "Image decoding, 1 MB limit, moderation and product isolation",
      async () => {
        async function upload(bytes, name = "photo.png", cookie = a.cookie) {
          const form = new FormData();
          form.append("image", new Blob([bytes]), name);
          const r = await fetch(base + "/api/uploads", {
            method: "POST",
            headers: { Cookie: cookie, Origin: base },
            body: form,
          });
          return { status: r.status, data: await r.json() };
        }
        assert.equal(
          (await upload('<svg onload="alert(1)"></svg>')).status,
          400,
        );
        assert.equal((await upload(Buffer.alloc(1048577))).status, 413);
        assert.equal(
          (await upload(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).status,
          400,
        );
        const png = await sharp({
          create: {
            width: 100,
            height: 100,
            channels: 3,
            background: "#d9f86f",
          },
        })
          .png()
          .toBuffer();
        const result = await upload(png);
        assert.equal(result.status, 200);
        photo = result.data.url;
        assert.match(photo, /\.webp$/);
        assert.equal((await fetch(base + photo)).status, 404);
        assert.equal(
          (await fetch(base + photo, { headers: { Cookie: a.cookie } })).status,
          200,
        );
        assert.equal(
          (await fetch(base + photo, { headers: { Cookie: b.cookie } })).status,
          404,
        );
        const product = {
          spaceId,
          name: "Prato de teste",
          category: "Pratos",
          price: 5000,
          image: photo,
          available: true,
        };
        assert.equal(
          (
            await request(
              "/products",
              "POST",
              { ...product, image: "https://attacker.example/x.png" },
              a.cookie,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              "/products",
              "POST",
              { ...product, price: -1 },
              a.cookie,
            )
          ).status,
          400,
        );
        assert.equal(
          (await request("/products", "POST", product, b.cookie)).status,
          404,
        );
        assert.equal(
          (await request("/products", "POST", product, a.cookie)).status,
          200,
        );
        productId = (
          await request(
            "/spaces/" + spaceId + "/products",
            "GET",
            undefined,
            a.cookie,
          )
        ).data.products[0].id;
        assert.equal(
          (
            await request(
              "/products/" + productId,
              "DELETE",
              undefined,
              b.cookie,
            )
          ).status,
          404,
        );
        assert.equal(
          (await request("/menu/" + space.slug)).data.products[0].image,
          photo,
        );
        assert.equal(
          (
            await request(
              "/admin/media",
              "PUT",
              {
                url: photo,
                status: "approved",
                confirmationPassword: adminPassword,
              },
              admin.cookie,
            )
          ).status,
          200,
        );
        assert.equal((await fetch(base + photo)).status, 200);
        assert.equal(
          (await request("/menu/" + space.slug)).data.products[0].image,
          photo,
        );
        assert.equal(
          (
            await request(
              "/admin/media",
              "PUT",
              {
                url: photo,
                status: "rejected",
                confirmationPassword: adminPassword,
              },
              admin.cookie,
            )
          ).status,
          200,
        );
        assert.equal((await fetch(base + photo)).status, 404);
      },
    );
    await t.test(
      "Staff invitations, fine-grained permissions and revocation",
      async () => {
        const invite = await request(
          "/admin/users",
          "POST",
          {
            name: "Gestor Teste",
            email: "manager@example.test",
            role: "manager",
            permissions: ["spaces.review"],
            confirmationPassword: adminPassword,
          },
          admin.cookie,
        );
        assert.equal(invite.status, 200);
        const token = invite.data.activationUrl.split("#")[1];
        assert.equal(
          (
            await request("/staff/activate", "POST", {
              token,
              password: adminPassword,
            })
          ).status,
          200,
        );
        manager = await request("/staff/login", "POST", {
          email: "manager@example.test",
          password: adminPassword,
        });
        assert.equal(manager.data.role, "manager");
        const managerMfa = (
          await request("/staff/mfa/setup", "GET", undefined, manager.cookie)
        ).data;
        const mfaEnabled = await request(
          "/staff/mfa/enable",
          "POST",
          {
            confirmationPassword: adminPassword,
            code: totp(managerMfa.secret),
          },
          manager.cookie,
        );
        assert.equal(mfaEnabled.status, 200);
        const recovery = mfaEnabled.data.recoveryCodes[0];
        const overview = await request(
          "/admin/overview",
          "GET",
          undefined,
          manager.cookie,
        );
        assert.equal(overview.status, 200);
        assert.equal(overview.data.users.length, 0);
        assert.equal(overview.data.media.length, 0);
        assert.equal(overview.data.audit.length, 0);
        assert.equal(
          (
            await request(
              "/admin/subscriptions/" + ownerId,
              "PUT",
              { confirmationPassword: adminPassword },
              manager.cookie,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await request(
              "/admin/users",
              "POST",
              { confirmationPassword: adminPassword },
              manager.cookie,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await request(
              "/admin/spaces/" + spaceId,
              "PUT",
              { approval: "approved", confirmationPassword: adminPassword },
              manager.cookie,
            )
          ).status,
          200,
        );
        const full = (
          await request("/admin/overview", "GET", undefined, admin.cookie)
        ).data;
        const managerUser = full.users.find(
          (u) => u.email === "manager@example.test",
        );
        managerId = managerUser.id;
        assert.equal(managerUser.password, undefined);
        assert.ok(full.audit.some((a) => a.action === "space.approved"));
        assert.equal(
          (
            await request(
              "/admin/users/" + managerId,
              "PUT",
              {
                disabled: false,
                permissions: ["media.review"],
                confirmationPassword: adminPassword,
              },
              admin.cookie,
            )
          ).status,
          200,
        );
        assert.equal(
          (await request("/me", "GET", undefined, manager.cookie)).status,
          401,
        );
        manager = await request("/staff/login", "POST", {
          email: "manager@example.test",
          password: adminPassword,
          code: recovery,
        });
        assert.equal(manager.status, 200);
        assert.equal(
          (
            await request("/staff/login", "POST", {
              email: "manager@example.test",
              password: adminPassword,
              code: recovery,
            })
          ).status,
          401,
        );
        assert.equal(
          (
            await request(
              "/admin/spaces/" + spaceId,
              "PUT",
              { approval: "rejected", confirmationPassword: adminPassword },
              manager.cookie,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await request(
              "/admin/users/" + managerId,
              "PUT",
              { disabled: true, confirmationPassword: adminPassword },
              admin.cookie,
            )
          ).status,
          200,
        );
        assert.equal(
          (await request("/me", "GET", undefined, manager.cookie)).status,
          401,
        );
      },
    );
    await t.test(
      "QR, subscription suspension, mobile tokens, export and deletion",
      async () => {
        const qr = await request("/qr/" + space.slug);
        assert.equal(qr.status, 200);
        const png = PNG.sync.read(Buffer.from(qr.data));
        assert.equal(
          jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data,
          base + "/m/" + space.slug,
        );
        assert.equal(
          (
            await request(
              "/admin/subscriptions/" + ownerId,
              "PUT",
              {
                plan: "multiespacos",
                status: "suspended",
                endsAt: Date.now() + 86400000,
                reference: "TEST",
                confirmationPassword: adminPassword,
              },
              admin.cookie,
            )
          ).status,
          200,
        );
        assert.equal((await request("/menu/" + space.slug)).status, 404);
        assert.equal((await request("/qr/" + space.slug)).status, 404);
        const mobile = await request("/mobile/login", "POST", {
          email: "owner-a@example.test",
          password,
        });
        assert.equal(mobile.status, 200);
        assert.match(mobile.data.token, /^[a-f0-9]{64}$/);
        assert.equal(mobile.cookie, undefined);
        assert.equal(
          (await request("/me", "GET", undefined, a.cookie)).status,
          401,
        );
        const headers = { Authorization: "Bearer " + mobile.data.token };
        assert.equal(
          (await request("/me", "GET", undefined, "", null, headers)).status,
          200,
        );
        const exported = await request(
          "/account/export",
          "GET",
          undefined,
          "",
          null,
          headers,
        );
        assert.equal(exported.data.spaces.length, 10);
        assert.equal(exported.data.password, undefined);
        assert.equal(
          (await request("/logout", "POST", {}, "", null, headers)).status,
          200,
        );
        assert.equal(
          (await request("/me", "GET", undefined, "", null, headers)).status,
          401,
        );
        a = await request("/login", "POST", {
          email: "owner-a@example.test",
          password,
        });
        assert.equal(
          (await request("/account/delete", "POST", { password }, a.cookie))
            .status,
          200,
        );
        assert.equal(
          (await request("/me", "GET", undefined, a.cookie)).status,
          401,
        );
        assert.equal((await fetch(base + photo)).status, 404);
      },
    );
    await t.test(
      "Headers, malformed input, path traversal and brute-force limits",
      async () => {
        const page = await fetch(base + "/demo");
        assert.equal(page.status, 200);
        const csp = page.headers.get("content-security-policy");
        assert.ok(csp.includes("frame-ancestors 'none'"));
        assert.ok(csp.includes("object-src 'none'"));
        assert.ok(!csp.includes("unsafe-inline"));
        assert.equal(page.headers.get("x-content-type-options"), "nosniff");
        assert.equal(page.headers.get("x-powered-by"), null);
        assert.equal(
          (
            await fetch(base + "/api/login", {
              method: "POST",
              headers: { "Content-Type": "application/json", Origin: base },
              body: "{bad",
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await fetch(base + "/api/login", {
              method: "POST",
              headers: { "Content-Type": "application/json", Origin: base },
              body: JSON.stringify({ password: "x".repeat(40000) }),
            })
          ).status,
          413,
        );
        for (const url of [
          "/.env",
          "/server.js",
          "/data/menu.sqlite",
          "/uploads/%2e%2e%2fserver.js",
        ])
          assert.equal((await fetch(base + url)).status, 404);
        let blocked = false;
        for (let i = 0; i < 25; i++) {
          const r = await request(
            "/login",
            "POST",
            { email: "brute@example.test", password: "bad" },
            "",
            base,
            { "X-Forwarded-For": "1.2.3." + i },
          );
          if (r.status === 429) {
            blocked = true;
            break;
          }
        }
        assert.ok(
          blocked,
          "Spoofed forwarding headers do not bypass throttling",
        );
      },
    );
  } finally {
    server.kill();
    await new Promise((resolve) => server.once("exit", resolve));
    assert.ok(data.startsWith(testRoot + path.sep));
    rmSync(data, { recursive: true, force: true });
  }
});
