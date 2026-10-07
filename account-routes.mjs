import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";
import { rateLimit } from "express-rate-limit";
export function installAccountRoutes({
  app,
  db,
  auth,
  owner,
  staff,
  admin,
  reauth,
  rate,
  fail,
  hash,
  derive,
  validPassword,
  consumeMfa,
  audit,
  plans,
  billingCycles,
  nodemailer,
  encryptSecret,
  decryptSecret,
  mfaKey,
}) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS password_resets(token TEXT PRIMARY KEY,user INTEGER NOT NULL REFERENCES users(id),expires INTEGER NOT NULL)",
  );
  const origin = process.env.PUBLIC_URL || "http://localhost:3000";
  db.exec(
    "CREATE TABLE IF NOT EXISTS mail_settings(id INTEGER PRIMARY KEY CHECK(id=1),username TEXT NOT NULL,password TEXT NOT NULL)",
  );
  const saved = db.prepare("SELECT * FROM mail_settings WHERE id=1").get();
  let smtpFrom = saved?.username || process.env.SMTP_FROM;
  let mail = saved
    ? nodemailer.createTransport({
        host: "smtp.hostinger.com",
        port: 465,
        secure: true,
        auth: {
          user: saved.username,
          pass: decryptSecret(saved.password, mfaKey),
        },
        connectionTimeout: 8000,
        greetingTimeout: 8000,
        socketTimeout: 10000,
        disableFileAccess: true,
        disableUrlAccess: true,
      })
    : process.env.SMTP_HOST &&
        process.env.SMTP_USER &&
        process.env.SMTP_PASSWORD &&
        process.env.SMTP_FROM
      ? nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT || 465),
          secure: Number(process.env.SMTP_PORT || 465) === 465,
          requireTLS: true,
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD,
          },
          connectionTimeout: 8000,
          greetingTimeout: 8000,
          socketTimeout: 10000,
          disableFileAccess: true,
          disableUrlAccess: true,
        })
      : null;
  const testOutbox =
    process.env.NODE_ENV === "test" && process.env.MAIL_TEST_OUTBOX;
  app.get("/api/admin/mail", auth, staff, admin, (req, res) =>
    res.json({
      configured: !!mail,
      username: smtpFrom || "",
      host: "smtp.hostinger.com",
      port: 465,
    }),
  );
  app.put("/api/admin/mail", auth, staff, admin, reauth, async (req, res) => {
    const username =
        typeof req.body.username === "string"
          ? req.body.username.trim().toLowerCase()
          : "",
      password = req.body.smtpPassword;
    if (
      !/^[a-z0-9._+-]+@menuao\.online$/.test(username) ||
      typeof password !== "string" ||
      password.length < 8 ||
      password.length > 256
    )
      return fail(
        res,
        "Usa uma caixa @menuao.online válida e a respetiva palavra-passe.",
      );
    const transport = nodemailer.createTransport({
      host: "smtp.hostinger.com",
      port: 465,
      secure: true,
      auth: { user: username, pass: password },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 10000,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    try {
      await transport.verify();
    } catch {
      return fail(
        res,
        "Não foi possível autenticar no email da Hostinger. Verifica a caixa e a palavra-passe.",
        400,
      );
    }
    db.prepare(
      "INSERT INTO mail_settings VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,password=excluded.password",
    ).run(username, encryptSecret(password, mfaKey));
    mail = transport;
    smtpFrom = username;
    audit(req, "mail.configured", username);
    res.json({ ok: true });
  });
  function issue(user) {
    const token = randomBytes(32).toString("hex");
    db.prepare("DELETE FROM password_resets WHERE user=? OR expires<?").run(
      user.id,
      Date.now(),
    );
    db.prepare("INSERT INTO password_resets VALUES(?,?,?)").run(
      hash(token),
      user.id,
      Date.now() + 30 * 60000,
    );
    return { token, url: origin + "/redefinir-senha#" + token };
  }
  const resetRate = rateLimit({
    windowMs: 3600000,
    limit: 5,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      error: "Muitas solicitações. Tenta novamente dentro de uma hora.",
    },
  });
  app.post("/api/password/forgot", resetRate, async (req, res) => {
    const email =
      typeof req.body.email === "string"
        ? req.body.email.trim().toLowerCase().slice(0, 254)
        : "";
    const user = db
      .prepare(
        "SELECT * FROM users WHERE email=? AND disabled=0 AND activated=1",
      )
      .get(email);
    const key = "reset-request:" + hash(email),
      prior = db.prepare("SELECT * FROM limits WHERE key=?").get(key);
    if (
      user &&
      (!prior || prior.expires < Date.now()) &&
      (mail || testOutbox)
    ) {
      db.prepare("INSERT OR REPLACE INTO limits VALUES(?,1,?)").run(
        key,
        Date.now() + 60000,
      );
      const reset = issue(user);
      const message = {
        from: smtpFrom,
        to: user.email,
        subject: "Menu Online — alterar palavra-passe",
        text:
          "Recebemos um pedido para alterar a tua palavra-passe. Abre este link, válido por 30 minutos e para uma única utilização:\n\n" +
          reset.url +
          "\n\nSe não fizeste este pedido, ignora esta mensagem. A autenticação em dois fatores mantém-se ativa.\nEquipa Muds — Menu Online",
      };
      if (testOutbox)
        appendFileSync(testOutbox, JSON.stringify(message) + "\n", {
          mode: 0o600,
        });
      else
        mail
          .sendMail(message)
          .then(() => audit({ user }, "password.reset.sent", user.id))
          .catch(() => {
            db.prepare("DELETE FROM password_resets WHERE token=?").run(
              hash(reset.token),
            );
            audit({ user }, "password.reset.delivery_failed", user.id);
          });
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
    res.json({
      ok: true,
      deliveryAvailable: !!(mail || testOutbox),
      message:
        mail || testOutbox
          ? "Se existir uma conta elegível, enviaremos um link para o email registado. Verifica também o spam."
          : "O envio automático ainda está a ser configurado. Contacta a Muds para recuperação assistida.",
    });
  });
  app.post("/api/password/reset", rate, async (req, res) => {
    const token =
      typeof req.body.token === "string" ? req.body.token.slice(0, 128) : "";
    const row = db
      .prepare(
        "SELECT u.* FROM password_resets r JOIN users u ON u.id=r.user WHERE r.token=? AND r.expires>? AND u.disabled=0 AND u.activated=1",
      )
      .get(hash(token), Date.now());
    if (!row) return fail(res, "Link inválido, expirado ou já utilizado.", 403);
    const p = req.body.password;
    if (typeof p !== "string" || p.length < 14 || p.length > 128)
      return fail(res, "Usa uma palavra-passe de 14 a 128 caracteres.");
    if (await validPassword(row, p))
      return fail(res, "Escolhe uma palavra-passe diferente da anterior.");
    const salt = randomBytes(16).toString("hex"),
      password = (await derive(p, salt, 64)).toString("hex");
    db.exec("BEGIN IMMEDIATE");
    try {
      const consumed = db
        .prepare("DELETE FROM password_resets WHERE token=? AND expires>?")
        .run(hash(token), Date.now());
      if (!consumed.changes) {
        db.exec("ROLLBACK");
        return fail(res, "Link inválido, expirado ou já utilizado.", 403);
      }
      db.prepare(
        "UPDATE users SET password=?,salt=?,must_change_password=0,temporary_expires=NULL WHERE id=?",
      ).run(password, salt, row.id);
      db.prepare("DELETE FROM password_resets WHERE user=?").run(row.id);
      db.prepare("DELETE FROM sessions WHERE user=?").run(row.id);
      audit({ user: row }, "password.reset.completed", row.id);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    res.clearCookie("menu_session", { path: "/" });
    res.json({ ok: true });
  });
  app.post("/api/account/password", auth, rate, async (req, res) => {
    const u = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id),
      p = req.body.password;
    if (!(await validPassword(u, req.body.currentPassword)))
      return fail(res, "Palavra-passe atual incorreta.", 401);
    if (typeof p !== "string" || p.length < 14 || p.length > 128)
      return fail(res, "Usa uma palavra-passe de 14 a 128 caracteres.");
    if (await validPassword(u, p))
      return fail(res, "Escolhe uma palavra-passe diferente da anterior.");
    if (u.role !== "owner" && u.mfa_enabled && !consumeMfa(u, req.body.code))
      return fail(res, "Código de autenticação inválido ou já utilizado.", 401);
    const salt = randomBytes(16).toString("hex"),
      password = (await derive(p, salt, 64)).toString("hex");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "UPDATE users SET password=?,salt=?,must_change_password=0,temporary_expires=NULL WHERE id=?",
      ).run(password, salt, u.id);
      db.prepare("DELETE FROM sessions WHERE user=?").run(u.id);
      db.prepare("DELETE FROM password_resets WHERE user=?").run(u.id);
      audit(req, "password.changed", u.id);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    res.clearCookie("menu_session", { path: "/" });
    res.json({ ok: true });
  });
  app.post(
    "/api/admin/password-reset",
    auth,
    staff,
    admin,
    reauth,
    (req, res) => {
      const u = db
        .prepare(
          "SELECT * FROM users WHERE email=? AND disabled=0 AND activated=1",
        )
        .get(
          String(req.body.email || "")
            .trim()
            .toLowerCase(),
        );
      if (!u) return fail(res, "Conta ativa não encontrada.", 404);
      const reset = issue(u);
      audit(req, "password.reset.assisted", u.id);
      res.json({ resetUrl: reset.url });
    },
  );
  app.post("/api/account/subscription-request", auth, owner, (req, res) => {
    const { plan, billingCycle } = req.body;
    if (!plans[plan] || !billingCycles[billingCycle])
      return fail(res, "Escolhe um plano e um período válidos.");
    db.prepare(
      "UPDATE subscriptions SET requested_plan=?,requested_cycle=? WHERE user=?",
    ).run(plan, billingCycle, req.user.id);
    audit(
      req,
      "subscription.requested",
      req.user.id,
      plan + " " + billingCycle,
    );
    res.json({
      ok: true,
      total: plans[plan].price * billingCycles[billingCycle].months,
    });
  });
}
