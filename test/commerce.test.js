import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { readFileSync } from "node:fs";
test("Branding, moderated product photos, private proofs and notification emails", async () => {
  const data = mkdtempSync(path.join(tmpdir(), "menuao-commerce-"));
  const base = "http://127.0.0.1:3107",
    password = "Owner-test-password-2026!";
  const child = spawn(process.execPath, ["server.js"], {
    env: {
      ...process.env,
      PORT: "3107",
      DATA_DIR: data,
      PUBLIC_URL: base,
      NODE_ENV: "test",
      MAIL_TEST_OUTBOX: path.join(data, "outbox"),
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
    const a = await request("/register", "POST", {
      email: "commerce@example.test",
      password,
    });
    const b = await request("/register", "POST", {
      email: "other@example.test",
      password,
    });
    assert.equal(a.status, 200);
    await request("/staff/activate", "POST", {
      token: "a".repeat(64),
      password,
    });
    const admin = await request("/staff/login", "POST", {
      email: "muaza.alfredo@gmail.com",
      password,
    });
    await request(
      "/space",
      "PUT",
      {
        name: "Teste visual",
        slug: "teste-visual",
        whatsapp: "936479545",
        published: true,
      },
      a.cookie,
    );
    const me = (await request("/me", "GET", undefined, a.cookie)).data;
    const id = me.spaces[0].id;
    assert.equal(
      (
        await request(
          "/admin/spaces/" + id,
          "PUT",
          { approval: "approved", confirmationPassword: password },
          admin.cookie,
        )
      ).status,
      409,
    );
    const image = await sharp({
      create: { width: 32, height: 32, channels: 3, background: "#12392d" },
    })
      .png()
      .toBuffer();
    const urls = [];
    for (let i = 0; i < 5; i++) {
      const form = new FormData();
      form.append(
        "image",
        new Blob([image], { type: "image/png" }),
        "fixture.png",
      );
      const r = await fetch(base + "/api/uploads", {
        method: "POST",
        headers: { Origin: base, Cookie: a.cookie },
        body: form,
      });
      assert.equal(r.status, 200);
      urls.push((await r.json()).url);
    }
    assert.equal(
      (
        await request(
          "/spaces/" + id + "/branding",
          "PUT",
          { logo: urls[0], covers: urls.slice(1) },
          b.cookie,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await request(
          "/spaces/" + id + "/branding",
          "PUT",
          { logo: urls[0], covers: [urls[1], urls[1], urls[1], urls[1]] },
          a.cookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await request(
          "/spaces/" + id + "/branding",
          "PUT",
          { logo: urls[0], covers: urls.slice(1) },
          a.cookie,
        )
      ).status,
      200,
    );
    await request(
      "/products",
      "POST",
      {
        spaceId: id,
        name: "Produto com foto",
        category: "Menu",
        price: 100,
        image: urls[1],
        available: true,
      },
      a.cookie,
    );
    assert.equal(
      (
        await request(
          "/admin/spaces/" + id,
          "PUT",
          { approval: "approved", confirmationPassword: password },
          admin.cookie,
        )
      ).status,
      200,
    );
    const subscription = await request(
      "/account/subscription-request",
      "POST",
      { plan: "essencial", billingCycle: "trimestral", kind: "new" },
      a.cookie,
    );
    async function proof(bytes, type, cookie = a.cookie) {
      const f = new FormData();
      f.append("bankKind", "same");
      f.append("proof", new Blob([bytes], { type }), "comprovativo");
      return fetch(base + "/api/account/payment-proof", {
        method: "POST",
        headers: { Origin: base, Cookie: cookie },
        body: f,
      });
    }
    assert.equal(
      (await proof(Buffer.from("<html>bad</html>"), "application/pdf")).status,
      400,
    );
    const upload = await proof(image, "image/png");
    assert.equal(upload.status, 200);
    const pid = (await upload.json()).id;
    assert.equal(
      (await fetch(base + "/api/payment-proofs/" + pid)).status,
      401,
    );
    assert.equal(
      (
        await fetch(base + "/api/payment-proofs/" + pid, {
          headers: { Cookie: b.cookie },
        })
      ).status,
      404,
    );
    const access = await fetch(base + "/api/payment-proofs/" + pid, {
      headers: { Cookie: admin.cookie },
    });
    assert.equal(access.status, 200);
    assert.match(access.headers.get("content-disposition"), /attachment/);
    assert.equal(
      (
        await request(
          "/admin/subscriptions/" + me.id,
          "PUT",
          {
            plan: "essencial",
            status: "active",
            billingCycle: "trimestral",
            reference: "TEST-VERIFIED",
            confirmationPassword: password,
          },
          admin.cookie,
        )
      ).status,
      200,
    );
    const menu = (await request("/menu/teste-visual")).data;
    assert.equal(menu.space.covers.length, 4);
    assert.equal(menu.space.logo, urls[0]);
    assert.equal(menu.products[0].image, urls[1]);
    assert.equal((await fetch(base + urls[1])).status, 200);
    assert.equal(
      (await request("/account/payment", "GET", undefined, a.cookie)).data
        .proofs[0].status,
      "verified",
    );
    const link = await request(
      "/account/password-link",
      "POST",
      { confirmationPassword: password },
      a.cookie,
    );
    assert.equal(link.status, 200);
    const notifications = readFileSync(
      path.join(data, "outbox.notifications"),
      "utf8",
    )
      .trim()
      .split("\n")
      .map((x) => JSON.parse(x));
    assert.ok(
      notifications.some(
        (x) =>
          x.subject.includes("Bem-vindo") && x.to === "commerce@example.test",
      ),
    );
    const reset = notifications.find((x) =>
      x.subject.includes("Confirmar alteração"),
    );
    assert.ok(reset);
    const token = reset.text.match(/redefinir-senha#([a-f0-9]+)/)[1];
    assert.equal(
      (
        await request("/password/reset", "POST", {
          token,
          password: "Updated-owner-test-2026!",
        })
      ).status,
      200,
    );
    assert.equal(
      (await request("/me", "GET", undefined, a.cookie)).status,
      401,
    );
    assert.equal(
      (
        await request("/password/reset", "POST", {
          token,
          password: "Other-owner-test-2026!",
        })
      ).status,
      403,
    );
  } finally {
    child.kill();
    await new Promise((r) => child.once("exit", r));
    rmSync(data, { recursive: true, force: true });
  }
});
