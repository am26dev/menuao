import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { DatabaseSync } from "node:sqlite";
import { installAccountRoutes } from "../account-routes.mjs";
import { encryptSecret, decryptSecret } from "../security.mjs";
import { createHash } from "node:crypto";
test("Mail settings verify TLS credentials, encrypt secrets and restore after restart", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT,activated INTEGER,disabled INTEGER); CREATE TABLE limits(key TEXT PRIMARY KEY,count INTEGER,expires INTEGER);",
  );
  let verified = 0,
    reject = false;
  const options = [],
    key = Buffer.alloc(32, 3),
    password = "SMTP-test-only-password!";
  const nodemailer = {
    createTransport(o) {
      options.push(o);
      return {
        async verify() {
          verified++;
          if (reject) throw Error("authentication");
        },
      };
    },
  };
  function create() {
    const app = express();
    app.use(express.json());
    installAccountRoutes({
      app,
      db,
      nodemailer,
      mfaKey: key,
      encryptSecret,
      decryptSecret,
      auth: (req, res, next) => next(),
      owner: (req, res, next) => next(),
      rate: (req, res, next) => next(),
      staff: (req, res, next) => next(),
      admin: (req, res, next) => next(),
      reauth: (req, res, next) => next(),
      fail: (res, error, status = 400) => res.status(status).json({ error }),
      audit: () => {},
      hash: (t) => createHash("sha256").update(t).digest("hex"),
    });
    return app.listen(0, "127.0.0.1");
  }
  let server = create();
  await new Promise((r) => server.once("listening", r));
  let base = "http://127.0.0.1:" + server.address().port;
  const put = async (body) =>
    fetch(base + "/api/admin/mail", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    assert.equal(
      (await put({ username: "someone@other.test", smtpPassword: password }))
        .status,
      400,
    );
    assert.equal(verified, 0);
    assert.equal(
      (await put({ username: "conta@menuao.online", smtpPassword: password }))
        .status,
      200,
    );
    assert.equal(verified, 1);
    assert.equal(options.at(-1).host, "smtp.hostinger.com");
    assert.equal(options.at(-1).secure, true);
    assert.equal(options.at(-1).port, 465);
    const saved = db.prepare("SELECT * FROM mail_settings").get();
    assert.notEqual(saved.password, password);
    assert.equal(decryptSecret(saved.password, key), password);
    const publicSettings = await (await fetch(base + "/api/admin/mail")).json();
    assert.equal(publicSettings.configured, true);
    assert.equal(JSON.stringify(publicSettings).includes(password), false);
    reject = true;
    assert.equal(
      (
        await put({
          username: "other@menuao.online",
          smtpPassword: "wrong-test-password",
        })
      ).status,
      400,
    );
    assert.deepEqual(db.prepare("SELECT * FROM mail_settings").get(), saved);
    await new Promise((r) => server.close(r));
    server = create();
    await new Promise((r) => server.once("listening", r));
    base = "http://127.0.0.1:" + server.address().port;
    assert.equal(options.at(-1).auth.pass, password);
    assert.equal(
      (await (await fetch(base + "/api/admin/mail")).json()).configured,
      true,
    );
  } finally {
    await new Promise((r) => server.close(r));
    db.close();
  }
});
