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
  db.exec(
    "CREATE TABLE IF NOT EXISTS email_jobs(id INTEGER PRIMARY KEY,recipient TEXT NOT NULL,subject TEXT NOT NULL,text TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL,created_at INTEGER NOT NULL,expires INTEGER)",
  );
  if (
    !db
      .prepare("PRAGMA table_info(email_jobs)")
      .all()
      .some((c) => c.name === "expires")
  )
    db.exec("ALTER TABLE email_jobs ADD COLUMN expires INTEGER");
  let sending = false;
  async function flushMail() {
    if (sending || (!mail && !testOutbox)) return;
    sending = true;
    db.prepare(
      "UPDATE email_jobs SET status='expired',text='' WHERE status='pending' AND expires IS NOT NULL AND expires<=?",
    ).run(Date.now());
    try {
      for (const job of db
        .prepare(
          "SELECT * FROM email_jobs WHERE status='pending' AND next_at<=? AND attempts<8 ORDER BY id LIMIT 20",
        )
        .all(Date.now())) {
        try {
          const message = {
            from: smtpFrom,
            to: job.recipient,
            subject: job.subject,
            text: decryptSecret(job.text, mfaKey),
          };
          if (testOutbox)
            appendFileSync(
              testOutbox + ".notifications",
              JSON.stringify(message) + "\n",
              { mode: 0o600 },
            );
          else await mail.sendMail(message);
          db.prepare(
            "UPDATE email_jobs SET status='sent',text='',attempts=attempts+1 WHERE id=?",
          ).run(job.id);
        } catch {
          db.prepare(
            "UPDATE email_jobs SET attempts=attempts+1,next_at=? WHERE id=?",
          ).run(
            Date.now() + Math.min(3600000, 60000 * 2 ** job.attempts),
            job.id,
          );
        }
      }
    } finally {
      sending = false;
    }
  }
  const mailTimer = setInterval(() => {
    try {
      void flushMail().catch(() => {});
    } catch {}
  }, 30000);
  mailTimer.unref();
  function notify(email, subject, text, expires = null) {
    if (!email) return;
    db.prepare(
      "INSERT INTO email_jobs(recipient,subject,text,next_at,created_at,expires) VALUES(?,?,?,?,?,?)",
    ).run(
      email,
      "Menu Online — " + subject,
      encryptSecret(
        text +
          "\n\nEquipa Muds — Menu Online\nSe não reconheces esta ação, contacta a Muds em https://muds.ao/contacto.",
        mfaKey,
      ),
      Date.now(),
      Date.now(),
      expires,
    );
    void flushMail().catch(() => {});
  }
  app.use((req, res, next) => {
    res.on("finish", () => {
      if (
        !["POST", "PUT", "DELETE"].includes(req.method) ||
        res.statusCode >= 400
      )
        return;
      const actions = {
        "/api/register":
          "Bem-vindo ao Menu Online! A tua conta foi criada. Entra em " +
          origin +
          "/painel para configurar o teu estabelecimento.",
        "/api/account/delete": "A tua conta foi eliminada da plataforma.",
        "/api/space":
          "As informações do teu estabelecimento foram atualizadas.",
        "/api/products": "Um produto foi guardado na tua conta.",
        "/api/account/subscription-request":
          "O teu pedido de assinatura foi registado. Consulta " +
          origin +
          "/assinatura.",
        "/api/account/payment-proof":
          "O teu comprovativo foi recebido e aguarda verificação.",
        "/api/account/mfa/disable":
          "A autenticação de dois fatores foi desativada.",
        "/api/staff/mfa/enable": "A autenticação de dois fatores foi ativada.",
        "/api/account/password": "A tua palavra-passe foi alterada.",
      };
      const text =
        actions[req.path] ||
        (/^\/api\/spaces\/\d+\/branding$/.test(req.path)
          ? "O logotipo e as capas do teu estabelecimento foram atualizados."
          : null) ||
        (req.method === "DELETE" && req.path.startsWith("/api/products/")
          ? "Um produto foi eliminado da tua conta."
          : null);
      if (
        !text &&
        !/^\/api\/admin\/(spaces|subscriptions)\/\d+$/.test(req.path) &&
        req.path !== "/api/admin/media"
      )
        return;
      let email =
        req.user?.email ||
        (req.path === "/api/register"
          ? String(req.body.email || "")
              .trim()
              .toLowerCase()
          : null);
      let details = text;
      if (/^\/api\/admin\/subscriptions\/\d+$/.test(req.path)) {
        email = db
          .prepare("SELECT email FROM users WHERE id=?")
          .get(Number(req.params.id))?.email;
        details =
          "O estado da tua assinatura foi atualizado pela Muds para: " +
          req.body.status +
          ". Consulta " +
          origin +
          "/assinatura.";
      }
      if (/^\/api\/admin\/spaces\/\d+$/.test(req.path)) {
        email = db
          .prepare(
            "SELECT u.email FROM users u JOIN spaces s ON s.owner=u.id WHERE s.id=?",
          )
          .get(Number(req.params.id))?.email;
        details =
          "A revisão do teu estabelecimento foi atualizada: " +
          req.body.approval +
          ". Consulta o painel.";
      }
      if (req.path === "/api/admin/media") {
        email = db
          .prepare(
            "SELECT u.email FROM users u JOIN media m ON m.owner=u.id WHERE m.url=?",
          )
          .get(req.body.url)?.email;
        details =
          "Uma fotografia da tua conta foi revista pela Muds: " +
          req.body.status +
          ".";
      }
      notify(
        email,
        req.path === "/api/register" ? "Bem-vindo" : "Confirmação de alteração",
        details,
      );
    });
    next();
  });
  app.post("/api/account/password-link", auth, rate, reauth, (req, res) => {
    if (!mail && !testOutbox)
      return fail(
        res,
        "O email de envio ainda não está configurado pela Muds. A palavra-passe não foi alterada.",
        503,
      );
    const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
    const reset = issue(user);
    notify(
      user.email,
      "Confirmar alteração de palavra-passe",
      "Para definir a nova palavra-passe, abre este link privado, válido por 30 minutos e uma única utilização:\n" +
        reset.url +
        "\nSe não pediste esta alteração, ignora o link.",
      Date.now() + 30 * 60000,
    );
    res.json({
      ok: true,
      message:
        "Pedido registado. O link está a ser enviado para o teu email. Verifica também o spam.",
    });
  });
  app.get("/api/admin/mail", auth, staff, admin, (req, res) =>
    res.json({
      configured: !!mail,
      pending: db
        .prepare("SELECT COUNT(*) AS n FROM email_jobs WHERE status='pending'")
        .get().n,
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
    void flushMail().catch(() => {});
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
      notify(
        row.email,
        "Palavra-passe alterada",
        "A tua palavra-passe foi redefinida e todas as sessões anteriores foram terminadas.",
      );
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
    if (u.mfa_enabled && !consumeMfa(u, req.body.code))
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
    const { plan, billingCycle } = req.body,
      kind = req.body.kind || "new";
    if (
      !plans[plan] ||
      !billingCycles[billingCycle] ||
      !["new", "change", "renew"].includes(kind)
    )
      return fail(res, "Escolhe um plano, período e tipo de pedido válidos.");
    const prior = db
      .prepare("SELECT * FROM subscriptions WHERE user=?")
      .get(req.user.id);
    if (
      prior?.request_id &&
      prior.requested_plan === plan &&
      prior.requested_cycle === billingCycle &&
      prior.requested_kind === kind
    )
      return res.json({
        ok: true,
        requestId: prior.request_id,
        total: plans[plan].price * billingCycles[billingCycle].months,
        alreadyRequested: true,
      });
    const requestId = "MO-" + randomBytes(6).toString("hex").toUpperCase();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "INSERT INTO subscriptions(user,requested_plan,requested_cycle,requested_kind,requested_at,request_id) VALUES(?,?,?,?,?,?) ON CONFLICT(user) DO UPDATE SET requested_plan=excluded.requested_plan,requested_cycle=excluded.requested_cycle,requested_kind=excluded.requested_kind,requested_at=excluded.requested_at,request_id=excluded.request_id",
      ).run(req.user.id, plan, billingCycle, kind, Date.now(), requestId);
      audit(
        req,
        "subscription.requested",
        req.user.id,
        requestId + " " + kind + " " + plan + " " + billingCycle,
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    res.json({
      ok: true,
      requestId,
      total: plans[plan].price * billingCycles[billingCycle].months,
    });
  });
}
