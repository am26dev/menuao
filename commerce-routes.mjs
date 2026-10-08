import multer from "multer";
import sharp from "sharp";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
export const bankDetails = {
  holder: "MUDS - PRESTAÇÃO DE SERVIÇOS E COMERCIO GERAL, LDA",
  bank: "BAI",
  account: "138646174 10 003",
  nba: "0040 0000 38646174103 30",
  iban: "AO06 0040 0000 3864 6174 1033 0",
  swift: "BAIPAOLU",
  currency: "Kz",
};
export function installCommerceRoutes({
  app,
  db,
  auth,
  owner,
  staff,
  permit,
  fail,
  audit,
  dataDir,
  ownedSpace,
  safeImage,
  rate,
}) {
  const dir = path.join(dataDir, "receipts");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  db.exec(
    "CREATE TABLE IF NOT EXISTS payment_proofs(id TEXT PRIMARY KEY,user INTEGER NOT NULL,request_id TEXT NOT NULL,filename TEXT NOT NULL,type TEXT NOT NULL,bytes INTEGER NOT NULL,bank_kind TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',note TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL)",
  );
  app.get("/api/account/payment", auth, owner, (req, res) =>
    res.json({
      bank: bankDetails,
      proofs: db
        .prepare(
          "SELECT id,request_id,bank_kind,status,note,created_at FROM payment_proofs WHERE user=? ORDER BY created_at DESC LIMIT 50",
        )
        .all(req.user.id),
    }),
  );
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 1, parts: 2 },
  });
  app.post(
    "/api/account/payment-proof",
    auth,
    owner,
    rate,
    upload.single("proof"),
    async (req, res) => {
      const sub = db
        .prepare("SELECT request_id FROM subscriptions WHERE user=?")
        .get(req.user.id);
      if (!sub?.request_id)
        return fail(
          res,
          "Solicita primeiro o plano e período de assinatura.",
          409,
        );
      if (!req.file || !["same", "other"].includes(req.body.bankKind))
        return fail(res, "Anexa o comprovativo e indica o banco de origem.");
      if (
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM payment_proofs WHERE user=? AND created_at>?",
          )
          .get(req.user.id, Date.now() - 86400000).n >= 10
      )
        return fail(res, "Limite de 10 comprovativos por dia.", 429);
      let bytes = req.file.buffer,
        type,
        ext;
      if (
        req.file.mimetype === "application/pdf" &&
        bytes.subarray(0, 5).toString() === "%PDF-"
      ) {
        type = "application/pdf";
        ext = ".pdf";
      } else {
        if (bytes.length > 1048576)
          return fail(res, "Imagens: máximo 1 MB. PDF: máximo 5 MB.", 413);
        try {
          const img = sharp(bytes, {
            limitInputPixels: 16000000,
            animated: false,
            failOn: "warning",
          });
          const m = await img.metadata();
          if (!["jpeg", "png", "webp"].includes(m.format) || m.pages > 1)
            throw Error();
          bytes = await img
            .rotate()
            .resize({
              width: 2000,
              height: 2000,
              fit: "inside",
              withoutEnlargement: true,
            })
            .webp({ quality: 82 })
            .toBuffer();
          if (bytes.length > 1048576) throw Error();
          type = "image/webp";
          ext = ".webp";
        } catch {
          return fail(res, "Comprovativo inválido. Usa PDF, JPG, PNG ou WebP.");
        }
      }
      if (
        db
          .prepare(
            "SELECT COALESCE(SUM(bytes),0) AS n FROM payment_proofs WHERE user=?",
          )
          .get(req.user.id).n +
          bytes.length >
        100 * 1024 * 1024
      )
        return fail(res, "Limite de 100 MB de comprovativos por conta.", 413);
      const id = randomBytes(16).toString("hex"),
        filename = id + ext;
      writeFileSync(path.join(dir, filename), bytes, {
        flag: "wx",
        mode: 0o600,
      });
      db.prepare(
        "INSERT INTO payment_proofs(id,user,request_id,filename,type,bytes,bank_kind,created_at) VALUES(?,?,?,?,?,?,?,?)",
      ).run(
        id,
        req.user.id,
        sub.request_id,
        filename,
        type,
        bytes.length,
        req.body.bankKind,
        Date.now(),
      );
      audit(req, "payment.proof.received", id);
      res.json({ ok: true, id });
    },
  );
  app.get("/api/payment-proofs/:id", auth, (req, res) => {
    const p = db
      .prepare("SELECT * FROM payment_proofs WHERE id=?")
      .get(req.params.id);
    const allowed =
      req.user.role === "admin" ||
      (req.user.role === "manager" &&
        req.user.permissions.includes("subscriptions.manage"));
    if (!p || (p.user !== req.user.id && !allowed))
      return fail(res, "Comprovativo não encontrado.", 404);
    res
      .set({
        "Content-Type": p.type,
        "Content-Disposition":
          'attachment; filename="comprovativo' +
          (p.type === "application/pdf" ? ".pdf" : ".webp") +
          '"',
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      })
      .sendFile(path.resolve(dir, p.filename));
  });
  app.get(
    "/api/admin/payment-proofs/:user",
    auth,
    staff,
    permit("subscriptions.manage"),
    (req, res) =>
      res.json({
        proofs: db
          .prepare(
            "SELECT id,request_id,bank_kind,status,note,created_at FROM payment_proofs WHERE user=? ORDER BY created_at DESC LIMIT 50",
          )
          .all(Number(req.params.user)),
      }),
  );
  app.put("/api/spaces/:id/branding", auth, owner, (req, res) => {
    const s = ownedSpace(req, req.params.id);
    if (!s) return fail(res, "Espaço não encontrado.", 404);
    const { logo, covers } = req.body;
    if (
      typeof logo !== "string" ||
      !safeImage(logo, req.user.id) ||
      !Array.isArray(covers) ||
      covers.length !== 4 ||
      new Set(covers).size !== 4 ||
      covers.some((x) => typeof x !== "string" || !safeImage(x, req.user.id))
    )
      return fail(
        res,
        "Adiciona um logotipo e quatro fotografias de capa diferentes.",
      );
    db.prepare(
      "UPDATE spaces SET logo=?,covers=?,approval='pending' WHERE id=?",
    ).run(logo, JSON.stringify(covers), s.id);
    audit(req, "space.branding.updated", s.id);
    res.json({ ok: true });
  });
}
