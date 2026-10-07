import express from "express";
import nodemailer from "nodemailer";
import { installAccountRoutes } from "./account-routes.mjs";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import {
  mkdirSync,
  readdirSync,
  writeFileSync,
  unlinkSync,
  statSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import multer from "multer";
import sharp from "sharp";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import QRCode from "qrcode";
import {
  newSecret,
  totp,
  verifyTotp,
  encryptSecret,
  decryptSecret,
} from "./security.mjs";

async function start() {
  const app = express(),
    production = process.env.NODE_ENV === "production";
  const dataDir = process.env.DATA_DIR || "./data",
    uploadsDir = path.join(dataDir, "uploads");
  mkdirSync(uploadsDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(dataDir, "menu.sqlite"));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,salt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS spaces(id INTEGER PRIMARY KEY,owner INTEGER REFERENCES users(id),slug TEXT UNIQUE,name TEXT,whatsapp TEXT,description TEXT,address TEXT,hours TEXT,published INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY,space INTEGER REFERENCES spaces(id),name TEXT,category TEXT,description TEXT,price INTEGER,image TEXT,available INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user INTEGER REFERENCES users(id),expires INTEGER);
CREATE TABLE IF NOT EXISTS limits(key TEXT PRIMARY KEY,count INTEGER,expires INTEGER);`);
  // Remove the old one-space restriction without losing IDs or product references.
  if (
    db
      .prepare("SELECT sql FROM sqlite_master WHERE name='spaces'")
      .get()
      .sql.includes("owner INTEGER UNIQUE")
  )
    db.exec(`PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;
CREATE TABLE spaces_v2(id INTEGER PRIMARY KEY,owner INTEGER REFERENCES users(id),slug TEXT UNIQUE,name TEXT,whatsapp TEXT,description TEXT,address TEXT,hours TEXT,published INTEGER DEFAULT 0);
INSERT INTO spaces_v2 SELECT * FROM spaces; DROP TABLE spaces; ALTER TABLE spaces_v2 RENAME TO spaces; COMMIT; PRAGMA foreign_keys=ON;`);
  function column(table, name, definition) {
    if (
      !db
        .prepare("PRAGMA table_info(" + table + ")")
        .all()
        .some((c) => c.name === name)
    )
      db.exec(
        "ALTER TABLE " + table + " ADD COLUMN " + name + " " + definition,
      );
  }
  column("users", "must_change_password", "INTEGER NOT NULL DEFAULT 0");
  column("users", "temporary_expires", "INTEGER");
  column("users", "role", "TEXT NOT NULL DEFAULT 'owner'");
  column("users", "disabled", "INTEGER NOT NULL DEFAULT 0");
  column("users", "activated", "INTEGER NOT NULL DEFAULT 1");
  column("users", "name", "TEXT NOT NULL DEFAULT ''");
  column("users", "permissions", "TEXT NOT NULL DEFAULT '[]'");
  column("users", "mfa_secret", "TEXT NOT NULL DEFAULT ''");
  column("users", "mfa_pending", "TEXT NOT NULL DEFAULT ''");
  column("users", "mfa_enabled", "INTEGER NOT NULL DEFAULT 0");
  column("users", "mfa_last", "INTEGER NOT NULL DEFAULT -1");
  column("users", "recovery", "TEXT NOT NULL DEFAULT '[]'");
  column("spaces", "approval", "TEXT NOT NULL DEFAULT 'pending'");
  column("spaces", "review_note", "TEXT NOT NULL DEFAULT ''");
  db.exec(`CREATE TABLE IF NOT EXISTS subscriptions(user INTEGER PRIMARY KEY REFERENCES users(id),plan TEXT NOT NULL DEFAULT 'essencial',status TEXT NOT NULL DEFAULT 'pending',ends_at INTEGER,reference TEXT NOT NULL DEFAULT '',updated_at INTEGER);
CREATE TABLE IF NOT EXISTS media(url TEXT PRIMARY KEY,owner INTEGER REFERENCES users(id),status TEXT NOT NULL DEFAULT 'pending',bytes INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,actor INTEGER,action TEXT NOT NULL,target TEXT NOT NULL,detail TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS invites(token TEXT PRIMARY KEY,user INTEGER REFERENCES users(id),expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS spaces_owner ON spaces(owner); CREATE INDEX IF NOT EXISTS products_space ON products(space); CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user);
INSERT OR IGNORE INTO subscriptions(user) SELECT id FROM users WHERE role='owner';`);
  column(
    "subscriptions",
    "billing_cycle",
    "TEXT NOT NULL DEFAULT 'trimestral'",
  );
  column("subscriptions", "requested_plan", "TEXT");
  column("subscriptions", "requested_cycle", "TEXT");
  const billingCycles = {
    trimestral: { name: "Trimestral", months: 3 },
    semestral: { name: "Semestral", months: 6 },
    anual: { name: "Anual", months: 12 },
  };
  const plans = {
    essencial: { name: "Essencial", price: 7995, spaces: 2 },
    profissional: { name: "Profissional", price: 14995, spaces: 5 },
    multiespacos: { name: "Multiespaços", price: 23995, spaces: 10 },
  };
  if (
    production &&
    !/^[a-f0-9]{64}$/.test(process.env.MFA_ENCRYPTION_KEY || "")
  )
    throw Error(
      "MFA_ENCRYPTION_KEY must contain 32 random bytes as hexadecimal.",
    );
  const mfaKey = Buffer.from(
    process.env.MFA_ENCRYPTION_KEY || "1".repeat(64),
    "hex",
  );
  const permissions = [
    "spaces.review",
    "subscriptions.manage",
    "media.review",
    "audit.read",
  ];
  // Existing photographs remain private pending moderation; unsafe/oversized legacy files are not served.
  for (const file of readdirSync(uploadsDir)) {
    const match = /^(\d+)-[a-f0-9]{32}\.(jpg|png|webp)$/.exec(file),
      url = "/uploads/" + file;
    if (
      !match ||
      db.prepare("SELECT url FROM media WHERE url=?").get(url) ||
      !db.prepare("SELECT id FROM users WHERE id=?").get(Number(match[1]))
    )
      continue;
    const full = path.join(uploadsDir, file);
    if (statSync(full).size > 1048576) continue;
    try {
      const image = sharp(readFileSync(full), {
          limitInputPixels: 16000000,
          animated: false,
          failOn: "warning",
        }),
        meta = await image.metadata();
      if (!["jpeg", "png", "webp"].includes(meta.format) || meta.pages > 1)
        continue;
      const bytes = await image
        .rotate()
        .resize({
          width: 2000,
          height: 2000,
          fit: "inside",
          withoutEnlargement: true,
        })
        .toFormat(match[2] === "jpg" ? "jpeg" : match[2])
        .toBuffer();
      if (bytes.length > 1048576) continue;
      writeFileSync(full, bytes, { mode: 0o600 });
      db.prepare("INSERT INTO media(url,owner,bytes) VALUES(?,?,?)").run(
        url,
        Number(match[1]),
        bytes.length,
      );
    } catch {}
  }
  const hash = (t) => createHash("sha256").update(t).digest("hex"),
    derive = promisify(scrypt);
  const clean = (v, max = 200) =>
    typeof v === "string" ? v.trim().slice(0, max) : "";
  const emailValid = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  const fail = (res, message, status = 400) =>
    res.status(status).json({ error: message });
  function issueInvite(id) {
    const token = randomBytes(32).toString("hex");
    db.prepare("DELETE FROM invites WHERE user=? OR expires<?").run(
      id,
      Date.now(),
    );
    db.prepare("INSERT INTO invites VALUES(?,?,?)").run(
      hash(token),
      id,
      Date.now() + 48 * 3600000,
    );
    return token;
  }
  // Only a deployment-provided secret can bootstrap the first administrator.
  if (
    process.env.STAFF_ADMIN_ACTIVATION?.length >= 64 &&
    !db.prepare("SELECT id FROM users WHERE role='admin'").get()
  ) {
    const id = Number(
      db
        .prepare(
          "INSERT INTO users(email,name,password,salt,role,activated) VALUES(?,?,?,?, 'admin',0)",
        )
        .run(
          "muaza.alfredo@gmail.com",
          "Alfredo Muanza",
          randomBytes(64).toString("hex"),
          randomBytes(16).toString("hex"),
        ).lastInsertRowid,
    );
    db.prepare("INSERT INTO invites VALUES(?,?,?)").run(
      hash(process.env.STAFF_ADMIN_ACTIVATION),
      id,
      Date.now() + 48 * 3600000,
    );
  }
  if (
    process.env.STAFF_MANAGER_ACTIVATION?.length >= 64 &&
    !db.prepare("SELECT id FROM users WHERE email='gestor'").get()
  ) {
    const id = Number(
      db
        .prepare(
          "INSERT INTO users(email,name,password,salt,role,permissions,activated) VALUES(?,?,?,?, 'manager',?,0)",
        )
        .run(
          "gestor",
          "Gestor da plataforma Muds",
          randomBytes(64).toString("hex"),
          randomBytes(16).toString("hex"),
          JSON.stringify(permissions),
        ).lastInsertRowid,
    );
    db.prepare("INSERT INTO invites VALUES(?,?,?)").run(
      hash(process.env.STAFF_MANAGER_ACTIVATION),
      id,
      Date.now() + 48 * 3600000,
    );
  }
  const audit = (req, action, target, detail = "") =>
    db
      .prepare(
        "INSERT INTO audit(actor,action,target,detail,created_at) VALUES(?,?,?,?,?)",
      )
      .run(
        req.user?.id || null,
        action,
        String(target),
        clean(detail, 1000),
        Date.now(),
      );
  app.disable("x-powered-by");
  app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS || 0));
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "https://images.unsplash.com", "data:"],
          connectSrc: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          upgradeInsecureRequests: production ? [] : null,
        },
      },
      strictTransportSecurity: production
        ? { maxAge: 31536000, includeSubDomains: true }
        : false,
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      crossOriginResourcePolicy: { policy: "same-origin" },
    }),
  );
  app.use((req, res, next) => {
    res.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
  });
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 240,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: {
        error: "Demasiados pedidos. Tenta novamente dentro de um minuto.",
      },
    }),
  );
  app.use(express.json({ limit: "32kb", strict: true }));
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!["GET", "HEAD"].includes(req.method)) {
      const expected =
        process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
      if (req.get("origin") && req.get("origin") !== expected)
        return fail(res, "Origem inválida.", 403);
      if (req.get("sec-fetch-site") === "cross-site")
        return fail(res, "Pedido não autorizado.", 403);
      if (req.get("cookie") && !req.get("origin"))
        return fail(res, "Origem obrigatória.", 403);
    }
    next();
  });
  function cookieToken(req) {
    const raw = req.get("authorization")?.startsWith("Bearer ")
      ? req.get("authorization").slice(7)
      : (req.headers.cookie || "")
          .split(";")
          .map((x) => x.trim())
          .find((x) => x.startsWith("menu_session="))
          ?.slice(13) || "";
    return /^[a-f0-9]{64}$/.test(raw) ? raw : "";
  }
  function auth(req, res, next) {
    const user = db
      .prepare(
        "SELECT u.id,u.email,u.name,u.permissions,u.role,u.mfa_enabled,u.must_change_password,u.temporary_expires FROM sessions s JOIN users u ON s.user=u.id WHERE s.token=? AND s.expires>? AND u.disabled=0 AND u.activated=1",
      )
      .get(hash(cookieToken(req)), Date.now());
    if (!user) return fail(res, "Entra na tua conta para continuar.", 401);
    if (
      user.must_change_password &&
      (user.temporary_expires < Date.now() ||
        !["/api/me", "/api/logout", "/api/account/password"].includes(req.path))
    )
      return fail(
        res,
        "Altera a palavra-passe provisória para continuar.",
        403,
      );
    user.permissions = JSON.parse(user.permissions);
    req.user = user;
    next();
  }
  const owner = (req, res, next) =>
    req.user.role === "owner"
      ? next()
      : fail(res, "Usa a gestão Muds para administrar a plataforma.", 403);
  const staff = (req, res, next) =>
    !["admin", "manager"].includes(req.user.role)
      ? fail(res, "Acesso reservado à equipa Muds.", 403)
      : !req.user.mfa_enabled
        ? fail(
            res,
            "Ativa a autenticação em dois passos para aceder à gestão.",
            403,
          )
        : next();
  const admin = (req, res, next) =>
    req.user.role === "admin"
      ? next()
      : fail(res, "Apenas o administrador pode gerir acessos.", 403);
  const permit = (p) => (req, res, next) =>
    req.user.role === "admin" || req.user.permissions.includes(p)
      ? next()
      : fail(res, "Não tens permissão para esta operação.", 403);
  function session(res, user, mobile = false) {
    const token = randomBytes(32).toString("hex"),
      maxAge = user.role === "owner" ? 86400000 : 3600000;
    db.prepare("DELETE FROM sessions WHERE expires<? OR user=?").run(
      Date.now(),
      user.id,
    );
    db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
      hash(token),
      user.id,
      Date.now() + maxAge,
    );
    if (!mobile)
      res.cookie("menu_session", token, {
        httpOnly: true,
        secure: production,
        sameSite: "strict",
        maxAge,
        path: "/",
      });
    return token;
  }
  function rate(req, res, next) {
    const now = Date.now(),
      keys = [
        `ip:${req.ip}`,
        `account:${hash(clean(req.body?.email || req.user?.email, 254).toLowerCase())}`,
      ];
    db.prepare("DELETE FROM limits WHERE expires<?").run(now);
    for (const key of keys) {
      db.prepare(
        "INSERT INTO limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1",
      ).run(key, now + 15 * 60000);
      if (
        db.prepare("SELECT count FROM limits WHERE key=?").get(key).count > 20
      ) {
        res.set("Retry-After", "900");
        return fail(res, "Muitas tentativas. Aguarda 15 minutos.", 429);
      }
    }
    next();
  }
  async function validPassword(user, p) {
    return (
      typeof p === "string" &&
      p.length <= 128 &&
      timingSafeEqual(
        await derive(p, user?.salt || "dummy-salt", 64),
        Buffer.from(user?.password || "0".repeat(128), "hex"),
      )
    );
  }
  async function reauth(req, res, next) {
    const key = "stepup:" + req.user.id,
      now = Date.now(),
      limit = db.prepare("SELECT * FROM limits WHERE key=?").get(key);
    if (limit && limit.expires > now && limit.count >= 5)
      return fail(
        res,
        "Muitas confirmações inválidas. Aguarda 15 minutos.",
        429,
      );
    const u = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
    if (!(await validPassword(u, req.body?.confirmationPassword))) {
      if (limit?.expires <= now)
        db.prepare("DELETE FROM limits WHERE key=?").run(key);
      db.prepare(
        "INSERT INTO limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1",
      ).run(key, now + 900000);
      return fail(res, "Confirma a tua palavra-passe para esta operação.", 401);
    }
    db.prepare("DELETE FROM limits WHERE key=?").run(key);
    next();
  }
  function subscription(id) {
    return (
      db.prepare("SELECT * FROM subscriptions WHERE user=?").get(id) || {
        plan: "essencial",
        status: "pending",
        ends_at: null,
      }
    );
  }
  function ownedSpace(req, id) {
    return db
      .prepare("SELECT * FROM spaces WHERE owner=? AND id=?")
      .get(req.user.id, Number(id));
  }
  function safeImage(value, user) {
    return typeof value === "string" &&
      db
        .prepare(
          "SELECT url FROM media WHERE url=? AND owner=? AND status!='rejected'",
        )
        .get(value, user)
      ? value
      : "";
  }
  function consumeMfa(user, code) {
    const counter = verifyTotp(
      decryptSecret(user.mfa_secret, mfaKey),
      code,
      user.mfa_last,
    );
    if (counter !== null)
      return !!db
        .prepare("UPDATE users SET mfa_last=? WHERE id=? AND mfa_last<?")
        .run(counter, user.id, counter).changes;
    if (typeof code !== "string") return false;
    const codes = JSON.parse(user.recovery),
      h = hash(code.replace(/[-\s]/g, "").toLowerCase());
    if (!codes.includes(h)) return false;
    db.prepare("UPDATE users SET recovery=? WHERE id=?").run(
      JSON.stringify(codes.filter((x) => x !== h)),
      user.id,
    );
    return true;
  }
  app.get("/api/staff/mfa/setup", auth, (req, res) => {
    if (req.user.role === "owner") return fail(res, "Acesso reservado.", 403);
    const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
    if (user.mfa_enabled)
      return fail(res, "A autenticação em dois passos já está ativa.", 409);
    const secret = user.mfa_pending
      ? decryptSecret(user.mfa_pending, mfaKey)
      : newSecret();
    if (!user.mfa_pending)
      db.prepare("UPDATE users SET mfa_pending=? WHERE id=?").run(
        encryptSecret(secret, mfaKey),
        user.id,
      );
    res.json({
      secret,
      uri:
        "otpauth://totp/" +
        encodeURIComponent("Menu Online Muds:" + user.email) +
        "?secret=" +
        secret +
        "&issuer=Menu%20Online%20Muds&algorithm=SHA1&digits=6&period=30",
    });
  });
  app.post("/api/staff/mfa/enable", auth, rate, reauth, (req, res) => {
    if (req.user.role === "owner") return fail(res, "Acesso reservado.", 403);
    const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
    if (user.mfa_enabled || !user.mfa_pending)
      return fail(res, "Configuração inválida.", 409);
    if (
      verifyTotp(decryptSecret(user.mfa_pending, mfaKey), req.body.code) ===
      null
    )
      return fail(res, "Código de autenticação inválido.", 400);
    const codes = Array.from({ length: 8 }, () =>
      randomBytes(8).toString("hex"),
    );
    db.prepare(
      "UPDATE users SET mfa_secret=mfa_pending,mfa_pending='',mfa_enabled=1,recovery=? WHERE id=?",
    ).run(JSON.stringify(codes.map(hash)), user.id);
    audit(req, "mfa.enabled", user.id);
    res.json({ ok: true, recoveryCodes: codes });
  });
  installAccountRoutes({
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
  });
  app.post("/api/register", rate, async (req, res) => {
    const email = clean(req.body.email, 254).toLowerCase(),
      password = req.body.password;
    if (
      !emailValid(email) ||
      typeof password !== "string" ||
      password.length < 12 ||
      password.length > 128
    )
      return fail(
        res,
        "Usa um email válido e uma palavra-passe de 12 a 128 caracteres.",
      );
    const salt = randomBytes(16).toString("hex"),
      passwordHash = (await derive(password, salt, 64)).toString("hex");
    try {
      db.exec("BEGIN IMMEDIATE");
      const id = Number(
        db
          .prepare("INSERT INTO users(email,password,salt) VALUES(?,?,?)")
          .run(email, passwordHash, salt).lastInsertRowid,
      );
      db.prepare(
        "INSERT INTO subscriptions(user,requested_plan,requested_cycle) VALUES(?,?,?)",
      ).run(
        id,
        plans[req.body.plan] ? req.body.plan : "essencial",
        billingCycles[req.body.billingCycle]
          ? req.body.billingCycle
          : "trimestral",
      );
      db.exec("COMMIT");
      session(res, { id, role: "owner" });
      res.json({ ok: true });
    } catch (e) {
      db.exec("ROLLBACK");
      if (String(e).includes("UNIQUE"))
        return fail(
          res,
          "Não foi possível criar a conta com estes dados.",
          409,
        );
      throw e;
    }
  });
  app.post("/api/login", rate, async (req, res) => {
    const user = db
      .prepare("SELECT * FROM users WHERE email=?")
      .get(clean(req.body.email, 254).toLowerCase());
    if (
      !(await validPassword(user, req.body.password)) ||
      !user ||
      user.disabled ||
      !user.activated ||
      (user.must_change_password && user.temporary_expires < Date.now())
    )
      return fail(res, "Dados de acesso inválidos.", 401);
    if (
      user.role !== "owner" &&
      user.mfa_enabled &&
      !consumeMfa(user, req.body.code)
    )
      return fail(res, "Código de autenticação inválido ou já utilizado.", 401);
    session(res, user);
    audit({ user }, "login", user.id);
    res.json({
      ok: true,
      role: user.role,
      mustChangePassword: !!user.must_change_password,
    });
  });
  app.post("/api/mobile/login", rate, async (req, res) => {
    const user = db
      .prepare("SELECT * FROM users WHERE email=?")
      .get(clean(req.body.email, 254).toLowerCase());
    if (
      !(await validPassword(user, req.body.password)) ||
      !user ||
      user.disabled ||
      !user.activated ||
      (user.must_change_password && user.temporary_expires < Date.now())
    )
      return fail(res, "Dados de acesso inválidos.", 401);
    if (
      user.role !== "owner" &&
      user.mfa_enabled &&
      !consumeMfa(user, req.body.code)
    )
      return fail(res, "Código de autenticação inválido ou já utilizado.", 401);
    const token = session(res, user, true);
    audit({ user }, "mobile.login", user.id);
    res.json({
      token,
      role: user.role,
      mustChangePassword: !!user.must_change_password,
    });
  });
  app.post("/api/staff/activate", rate, async (req, res) => {
    const token = clean(req.body.token, 128),
      invite = db
        .prepare(
          "SELECT i.user FROM invites i JOIN users u ON u.id=i.user WHERE i.token=? AND i.expires>? AND u.activated=0 AND u.disabled=0",
        )
        .get(hash(token), Date.now());
    if (!invite)
      return fail(res, "Convite inválido, expirado ou já utilizado.", 403);
    const password = req.body.password;
    if (
      typeof password !== "string" ||
      password.length < 14 ||
      password.length > 128
    )
      return fail(res, "Usa uma palavra-passe de 14 a 128 caracteres.");
    const salt = randomBytes(16).toString("hex"),
      passwordHash = (await derive(password, salt, 64)).toString("hex");
    db.exec("BEGIN IMMEDIATE");
    try {
      const consumed = db
        .prepare("DELETE FROM invites WHERE token=? AND expires>?")
        .run(hash(token), Date.now());
      if (!consumed.changes) {
        db.exec("ROLLBACK");
        return fail(res, "Convite já utilizado.", 403);
      }
      db.prepare(
        "UPDATE users SET password=?,salt=?,activated=1,must_change_password=?,temporary_expires=? WHERE id=?",
      ).run(
        passwordHash,
        salt,
        req.body.provisional === true ? 1 : 0,
        req.body.provisional === true ? Date.now() + 48 * 3600000 : null,
        invite.user,
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    audit({ user: { id: invite.user } }, "staff.activated", invite.user);
    res.json({ ok: true });
  });
  app.post("/api/logout", auth, (req, res) => {
    db.prepare("DELETE FROM sessions WHERE token=?").run(
      hash(cookieToken(req)),
    );
    res.clearCookie("menu_session", { path: "/" });
    res.json({ ok: true });
  });
  app.get("/api/me", auth, (req, res) =>
    res.json({
      ...req.user,
      spaces: db
        .prepare("SELECT * FROM spaces WHERE owner=? ORDER BY id")
        .all(req.user.id),
      subscription: subscription(req.user.id),
      plans,
      billingCycles,
    }),
  );
  app.get("/api/account/export", auth, owner, (req, res) =>
    res
      .set(
        "Content-Disposition",
        'attachment; filename="menu-online-dados.json"',
      )
      .json({
        exportedAt: new Date().toISOString(),
        email: req.user.email,
        spaces: db
          .prepare("SELECT * FROM spaces WHERE owner=?")
          .all(req.user.id),
        products: db
          .prepare(
            "SELECT p.* FROM products p JOIN spaces s ON p.space=s.id WHERE s.owner=?",
          )
          .all(req.user.id),
        subscription: subscription(req.user.id),
      }),
  );
  app.post("/api/account/delete", auth, owner, rate, async (req, res) => {
    const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
    if (!(await validPassword(user, req.body.password)))
      return fail(res, "Palavra-passe incorreta.", 401);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "DELETE FROM products WHERE space IN (SELECT id FROM spaces WHERE owner=?)",
      ).run(user.id);
      for (const table of ["spaces", "sessions", "media"])
        db.prepare(
          "DELETE FROM " +
            table +
            " WHERE " +
            (table === "sessions" ? "user" : "owner") +
            "=?",
        ).run(user.id);
      db.prepare("DELETE FROM subscriptions WHERE user=?").run(user.id);
      db.prepare("DELETE FROM password_resets WHERE user=?").run(user.id);
      db.prepare("DELETE FROM users WHERE id=?").run(user.id);
      audit(req, "account.deleted", user.id);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    for (const file of readdirSync(uploadsDir).filter((f) =>
      f.startsWith(user.id + "-"),
    ))
      unlinkSync(path.join(uploadsDir, file));
    res.clearCookie("menu_session", { path: "/" });
    res.json({ ok: true });
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 1024 * 1024, files: 1, fields: 0, parts: 1 },
  });
  app.post(
    "/api/uploads",
    auth,
    owner,
    rateLimit({
      windowMs: 60000,
      limit: 10,
      legacyHeaders: false,
      message: {
        error: "Aguarda um minuto antes de carregar mais fotografias.",
      },
    }),
    upload.single("image"),
    async (req, res) => {
      if (!req.file) return fail(res, "Escolhe uma fotografia.");
      let bytes;
      try {
        const image = sharp(req.file.buffer, {
            limitInputPixels: 16000000,
            animated: false,
            failOn: "warning",
          }),
          metadata = await image.metadata();
        if (
          !["jpeg", "png", "webp"].includes(metadata.format) ||
          metadata.pages > 1
        )
          return fail(res, "Usa uma fotografia JPG, PNG ou WebP estática.");
        bytes = await image
          .rotate()
          .resize({
            width: 2000,
            height: 2000,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality: 82 })
          .toBuffer();
      } catch {
        return fail(
          res,
          "A imagem é inválida ou excede os limites de segurança.",
        );
      }
      if (bytes.length > 1024 * 1024)
        return fail(res, "A fotografia deve ter no máximo 1 MB.", 413);
      const used = db
        .prepare(
          "SELECT COALESCE(SUM(bytes),0) AS bytes FROM media WHERE owner=?",
        )
        .get(req.user.id).bytes;
      if (used + bytes.length > 100 * 1024 * 1024)
        return fail(res, "Atingiste o limite de 100 MB por conta.", 413);
      const name =
          req.user.id + "-" + randomBytes(16).toString("hex") + ".webp",
        url = "/uploads/" + name;
      writeFileSync(path.join(uploadsDir, name), bytes, {
        flag: "wx",
        mode: 0o600,
      });
      db.prepare("INSERT INTO media(url,owner,bytes) VALUES(?,?,?)").run(
        url,
        req.user.id,
        bytes.length,
      );
      res.json({ url, status: "pending" });
    },
  );
  app.put("/api/space", auth, owner, (req, res) => {
    const b = req.body,
      slug = clean(b.slug, 60).toLowerCase(),
      name = clean(b.name, 100),
      whatsapp = clean(b.whatsapp, 20).replace(/[\s+()-]/g, "");
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
      slug === "demo" ||
      name.length < 2 ||
      !/^244\d{9}$/.test(whatsapp)
    )
      return fail(
        res,
        "Preenche o nome, endereço do menu e WhatsApp com 244 e 9 dígitos.",
      );
    const existing = b.id ? ownedSpace(req, b.id) : null;
    if (b.id && !existing)
      return fail(res, "Estabelecimento não encontrado.", 404);
    const sub = subscription(req.user.id);
    if (
      !existing &&
      db
        .prepare("SELECT COUNT(*) AS n FROM spaces WHERE owner=?")
        .get(req.user.id).n >= (plans[sub.plan]?.spaces || 2)
    )
      return fail(
        res,
        "Atingiste o limite de estabelecimentos do teu plano.",
        409,
      );
    const values = [
      slug,
      name,
      whatsapp,
      clean(b.description, 1000),
      clean(b.address, 200),
      clean(b.hours, 200),
      b.published === true ? 1 : 0,
    ];
    try {
      if (existing)
        db.prepare(
          "UPDATE spaces SET slug=?,name=?,whatsapp=?,description=?,address=?,hours=?,published=?,approval=CASE WHEN name!=? OR whatsapp!=? OR address!=? THEN 'pending' ELSE approval END WHERE id=? AND owner=?",
        ).run(
          ...values,
          name,
          whatsapp,
          clean(b.address, 200),
          existing.id,
          req.user.id,
        );
      else
        db.prepare(
          "INSERT INTO spaces(slug,name,whatsapp,description,address,hours,published,owner) VALUES(?,?,?,?,?,?,?,?)",
        ).run(...values, req.user.id);
      res.json({ ok: true });
    } catch (e) {
      if (String(e).includes("UNIQUE"))
        return fail(res, "Este endereço já está ocupado.", 409);
      throw e;
    }
  });
  app.get("/api/spaces/:id/products", auth, owner, (req, res) => {
    if (!ownedSpace(req, req.params.id))
      return fail(res, "Estabelecimento não encontrado.", 404);
    res.json({
      products: db
        .prepare("SELECT * FROM products WHERE space=? ORDER BY id DESC")
        .all(Number(req.params.id)),
    });
  });
  app.post("/api/products", auth, owner, (req, res) => {
    const b = req.body,
      space = ownedSpace(req, b.spaceId),
      price = Number(b.price);
    if (!space) return fail(res, "Estabelecimento não encontrado.", 404);
    if (
      !clean(b.name, 100) ||
      !Number.isSafeInteger(price) ||
      price < 0 ||
      price > 10000000
    )
      return fail(res, "Indica um nome e preço válido em Kz.");
    if (b.image && !safeImage(b.image, req.user.id))
      return fail(
        res,
        "Carrega uma fotografia própria de até 1 MB. Links externos não são permitidos.",
      );
    const values = [
      clean(b.name, 100),
      clean(b.category, 80) || "Menu",
      clean(b.description, 500),
      price,
      safeImage(b.image, req.user.id),
      b.available === true ? 1 : 0,
    ];
    if (b.id) {
      if (
        !db
          .prepare(
            "UPDATE products SET name=?,category=?,description=?,price=?,image=?,available=? WHERE id=? AND space=?",
          )
          .run(...values, Number(b.id), space.id).changes
      )
        return fail(res, "Produto não encontrado.", 404);
    } else {
      if (
        db
          .prepare("SELECT COUNT(*) AS n FROM products WHERE space=?")
          .get(space.id).n >= 500
      )
        return fail(res, "Limite de 500 produtos por estabelecimento.", 409);
      db.prepare(
        "INSERT INTO products(name,category,description,price,image,available,space) VALUES(?,?,?,?,?,?,?)",
      ).run(...values, space.id);
    }
    res.json({ ok: true });
  });
  app.delete("/api/products/:id", auth, owner, (req, res) => {
    if (
      !db
        .prepare(
          "DELETE FROM products WHERE id=? AND space IN (SELECT id FROM spaces WHERE owner=?)",
        )
        .run(Number(req.params.id), req.user.id).changes
    )
      return fail(res, "Produto não encontrado.", 404);
    res.json({ ok: true });
  });
  function publicSpace(slug) {
    return db
      .prepare(
        "SELECT s.id,s.slug,s.name,s.whatsapp,s.description,s.address,s.hours FROM spaces s JOIN subscriptions b ON s.owner=b.user JOIN users u ON s.owner=u.id WHERE s.slug=? AND s.published=1 AND s.approval='approved' AND b.status='active' AND b.ends_at>? AND u.disabled=0",
      )
      .get(slug, Date.now());
  }
  app.get("/api/menu/:slug", (req, res) => {
    const s = publicSpace(req.params.slug);
    if (!s) return fail(res, "Este menu não está disponível.", 404);
    res.json({
      space: s,
      products: db
        .prepare(
          "SELECT p.id,p.name,p.category,p.description,p.price,CASE WHEN m.status='approved' THEN p.image ELSE '' END AS image,p.available FROM products p LEFT JOIN media m ON p.image=m.url WHERE p.space=? ORDER BY p.id",
        )
        .all(s.id),
    });
  });
  app.get("/api/qr/:slug", async (req, res) => {
    const s = publicSpace(req.params.slug);
    if (!s)
      return fail(
        res,
        "O espaço precisa de aprovação e assinatura ativa.",
        404,
      );
    res
      .type("png")
      .send(
        await QRCode.toBuffer(
          `${process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`}/m/${s.slug}`,
          { width: 1000, margin: 3, errorCorrectionLevel: "M" },
        ),
      );
  });
  app.get("/api/admin/overview", auth, staff, (req, res) => {
    const all = req.user.role === "admin",
      can = (p) => all || req.user.permissions.includes(p);
    res.json({
      users:
        all || can("subscriptions.manage")
          ? db
              .prepare(
                "SELECT u.id,u.email,u.name,u.role,u.permissions,u.disabled,u.activated,b.plan,b.status,b.ends_at,b.reference,b.billing_cycle,b.requested_plan,b.requested_cycle FROM users u LEFT JOIN subscriptions b ON b.user=u.id ORDER BY u.id DESC LIMIT 1000",
              )
              .all()
          : [],
      spaces: can("spaces.review")
        ? db
            .prepare(
              "SELECT s.*,u.email FROM spaces s JOIN users u ON s.owner=u.id ORDER BY s.id DESC LIMIT 1000",
            )
            .all()
        : [],
      media: can("media.review")
        ? db
            .prepare(
              "SELECT m.*,u.email FROM media m JOIN users u ON m.owner=u.id ORDER BY m.rowid DESC LIMIT 500",
            )
            .all()
        : [],
      audit: can("audit.read")
        ? db
            .prepare(
              "SELECT a.*,u.email FROM audit a LEFT JOIN users u ON a.actor=u.id ORDER BY a.id DESC LIMIT 100",
            )
            .all()
        : [],
      plans,
      billingCycles,
      permissions,
    });
  });
  app.put(
    "/api/admin/spaces/:id",
    auth,
    staff,
    permit("spaces.review"),
    reauth,
    (req, res) => {
      const b = req.body;
      if (!["approved", "rejected", "pending"].includes(b.approval))
        return fail(res, "Estado inválido.");
      if (
        !db
          .prepare("UPDATE spaces SET approval=?,review_note=? WHERE id=?")
          .run(b.approval, clean(b.note, 1000), Number(req.params.id)).changes
      )
        return fail(res, "Espaço não encontrado.", 404);
      audit(req, "space." + b.approval, req.params.id, b.note);
      res.json({ ok: true });
    },
  );
  app.put(
    "/api/admin/subscriptions/:id",
    auth,
    staff,
    permit("subscriptions.manage"),
    reauth,
    (req, res) => {
      const b = req.body,
        cycle =
          b.billingCycle ||
          subscription(Number(req.params.id)).billing_cycle ||
          "trimestral",
        ends =
          b.endsAt === undefined
            ? (() => {
                const d = new Date();
                d.setUTCMonth(
                  d.getUTCMonth() + (billingCycles[cycle]?.months || 0),
                );
                return d.getTime();
              })()
            : Number(b.endsAt),
        id = Number(req.params.id);
      if (
        !plans[b.plan] ||
        !billingCycles[cycle] ||
        !["pending", "active", "suspended", "cancelled"].includes(b.status) ||
        !Number.isSafeInteger(ends) ||
        ends < 0 ||
        ends > Date.now() + 366 * 86400000
      )
        return fail(
          res,
          "Plano, estado ou validade inválidos (máximo um ano).",
        );
      if (
        b.status === "active" &&
        (ends <= Date.now() || !clean(b.reference, 200))
      )
        return fail(
          res,
          "Indica a validade futura e a referência do pagamento verificado.",
        );
      if (
        !db.prepare("SELECT id FROM users WHERE id=? AND role='owner'").get(id)
      )
        return fail(res, "Conta não encontrada.", 404);
      if (
        db.prepare("SELECT COUNT(*) AS n FROM spaces WHERE owner=?").get(id).n >
        plans[b.plan].spaces
      )
        return fail(
          res,
          "A conta tem mais estabelecimentos que o limite deste plano.",
          409,
        );
      db.prepare(
        "INSERT INTO subscriptions(user,plan,status,ends_at,reference,updated_at,billing_cycle) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user) DO UPDATE SET plan=excluded.plan,status=excluded.status,ends_at=excluded.ends_at,reference=excluded.reference,updated_at=excluded.updated_at,billing_cycle=excluded.billing_cycle,requested_plan=NULL,requested_cycle=NULL",
      ).run(
        id,
        b.plan,
        b.status,
        ends,
        clean(b.reference, 200),
        Date.now(),
        cycle,
      );
      audit(
        req,
        "subscription." + b.status,
        id,
        b.plan +
          " " +
          cycle +
          " " +
          plans[b.plan].price * billingCycles[cycle].months +
          " Kz " +
          clean(b.reference, 200),
      );
      res.json({ ok: true });
    },
  );
  app.put(
    "/api/admin/media",
    auth,
    staff,
    permit("media.review"),
    reauth,
    (req, res) => {
      if (!["approved", "rejected", "pending"].includes(req.body.status))
        return fail(res, "Estado inválido.");
      if (
        !db
          .prepare("UPDATE media SET status=? WHERE url=?")
          .run(req.body.status, clean(req.body.url, 200)).changes
      )
        return fail(res, "Imagem não encontrada.", 404);
      audit(req, "media." + req.body.status, req.body.url);
      res.json({ ok: true });
    },
  );
  app.post("/api/admin/users", auth, staff, admin, reauth, async (req, res) => {
    const b = req.body,
      email = clean(b.email, 254).toLowerCase(),
      name = clean(b.name, 100);
    if (
      !emailValid(email) ||
      !name ||
      !["manager", "admin"].includes(b.role) ||
      !Array.isArray(b.permissions) ||
      b.permissions.some((p) => !permissions.includes(p))
    )
      return fail(res, "Preenche nome, email, função e permissões válidas.");
    try {
      const id = Number(
        db
          .prepare(
            "INSERT INTO users(email,name,password,salt,role,permissions,activated) VALUES(?,?,?,?,?,?,0)",
          )
          .run(
            email,
            name,
            randomBytes(64).toString("hex"),
            randomBytes(16).toString("hex"),
            b.role,
            JSON.stringify([...new Set(b.permissions)]),
          ).lastInsertRowid,
      );
      const token = issueInvite(id);
      audit(req, "staff.invited", id, b.role);
      res.json({ ok: true, activationUrl: "/ativar-equipa#" + token });
    } catch (e) {
      if (String(e).includes("UNIQUE"))
        return fail(res, "Este email já está registado.", 409);
      throw e;
    }
  });
  app.put("/api/admin/users/:id", auth, staff, admin, reauth, (req, res) => {
    const target = db
        .prepare("SELECT id,role,email FROM users WHERE id=?")
        .get(Number(req.params.id)),
      b = req.body;
    if (!target) return fail(res, "Conta não encontrada.", 404);
    if (target.id === req.user.id || target.email === "muaza.alfredo@gmail.com")
      return fail(res, "Este acesso não pode ser alterado aqui.", 403);
    if (
      b.permissions !== undefined &&
      (!Array.isArray(b.permissions) ||
        b.permissions.some((p) => !permissions.includes(p)))
    )
      return fail(res, "Permissões inválidas.");
    if (b.permissions !== undefined && target.role !== "manager")
      return fail(res, "As permissões individuais aplicam-se a gestores.", 400);
    if (typeof b.disabled !== "boolean") return fail(res, "Estado inválido.");
    db.prepare(
      "UPDATE users SET disabled=?,permissions=COALESCE(?,permissions) WHERE id=?",
    ).run(
      b.disabled ? 1 : 0,
      b.permissions ? JSON.stringify([...new Set(b.permissions)]) : null,
      target.id,
    );
    db.prepare("DELETE FROM sessions WHERE user=?").run(target.id);
    audit(req, b.disabled ? "user.disabled" : "user.updated", target.id);
    res.json({ ok: true });
  });
  app.post(
    "/api/admin/users/:id/invite",
    auth,
    staff,
    admin,
    reauth,
    (req, res) => {
      const target = db
        .prepare(
          "SELECT id FROM users WHERE id=? AND role IN ('admin','manager') AND activated=0 AND disabled=0",
        )
        .get(Number(req.params.id));
      if (!target)
        return fail(res, "Conta não elegível para novo convite.", 400);
      audit(req, "staff.reinvited", target.id);
      res.json({ activationUrl: "/ativar-equipa#" + issueInvite(target.id) });
    },
  );
  app.get("/api/health", (req, res) => res.json({ ok: true }));
  app.get("/uploads/:file", (req, res) => {
    const url = "/uploads/" + req.params.file;
    if (!/^\d+-[a-f0-9]{32}\.(jpg|png|webp)$/.test(req.params.file))
      return fail(res, "Imagem não encontrada.", 404);
    const media = db.prepare("SELECT * FROM media WHERE url=?").get(url);
    if (!media) return fail(res, "Imagem não encontrada.", 404);
    if (media.status !== "approved") {
      const user = db
        .prepare(
          "SELECT u.id,u.role,u.permissions FROM sessions s JOIN users u ON s.user=u.id WHERE s.token=? AND s.expires>? AND u.disabled=0",
        )
        .get(hash(cookieToken(req)), Date.now());
      if (
        !user ||
        (user.id !== media.owner &&
          user.role !== "admin" &&
          !(
            user.role === "manager" &&
            JSON.parse(user.permissions).includes("media.review")
          ))
      )
        return fail(res, "Imagem não disponível.", 404);
    }
    res.set("Cache-Control", "private, no-store");
    res.sendFile(path.resolve(uploadsDir, req.params.file));
  });
  app.use(
    express.static("public", {
      maxAge: production ? "5m" : 0,
      dotfiles: "deny",
    }),
  );
  app.get(
    [
      "/",
      "/entrar",
      "/criar-conta",
      "/painel",
      "/gestao",
      "/ativar-equipa",
      "/esqueci-senha",
      "/redefinir-senha",
      "/alterar-senha",
      "/demo",
      "/m/:slug",
      "/privacidade",
      "/termos",
    ],
    (req, res) =>
      res
        .set("Cache-Control", "no-store")
        .sendFile(path.resolve("public/index.html")),
  );
  app.use("/api", (req, res) => fail(res, "Recurso não encontrado.", 404));
  app.use((err, req, res, next) => {
    console.error("Request failed:", err.name);
    if (err instanceof multer.MulterError)
      return fail(res, "Usa uma fotografia JPG, PNG ou WebP de até 1 MB.", 413);
    if (err.type === "entity.too.large")
      return fail(res, "Pedido demasiado grande.", 413);
    if (err instanceof SyntaxError) return fail(res, "Pedido inválido.", 400);
    res
      .status(500)
      .json({ error: "Não foi possível concluir. Tenta novamente." });
  });
  const server = app.listen(Number(process.env.PORT || 3000), "0.0.0.0", () =>
    console.log(
      "Menu Online disponível na porta " + (process.env.PORT || 3000),
    ),
  );
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
}
start().catch((error) => {
  console.error("Startup failed:", error.message);
  process.exitCode = 1;
});
