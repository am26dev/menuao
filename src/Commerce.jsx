import React, { useState, useEffect } from "react";
export function Payment({ api, request }) {
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const load = () =>
    api("/account/payment")
      .then(setData)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  return (
    <section className="panel">
      <h2>Pagamento por transferência bancária</h2>
      {data ? (
        <>
          <p>
            <strong>{data.bank.holder}</strong>
          </p>
          <dl>
            <dt>Banco</dt>
            <dd>{data.bank.bank}</dd>
            <dt>Conta</dt>
            <dd>{data.bank.account}</dd>
            <dt>IBAN</dt>
            <dd style={{ overflowWrap: "anywhere" }}>{data.bank.iban}</dd>
            <dt>NBA</dt>
            <dd>{data.bank.nba}</dd>
            <dt>BIC / SWIFT</dt>
            <dd>{data.bank.swift}</dd>
          </dl>
          <p>
            Mesmo banco (BAI): ativação na hora, após confirmação da receção.
            Bancos diferentes: ativação em até 24 horas após confirmação da
            transferência.
          </p>
          <p>
            Indica a referência da solicitação na transferência. O envio do
            comprovativo não confirma automaticamente o pagamento.
          </p>
          {request ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                const form = e.currentTarget;
                try {
                  const r = await fetch("/api/account/payment-proof", {
                      method: "POST",
                      body: new FormData(form),
                    }),
                    d = await r.json();
                  if (!r.ok) throw Error(d.error);
                  setMessage(
                    "Comprovativo recebido. Aguarda verificação da Muds.",
                  );
                  form.reset();
                  await load();
                } catch (err) {
                  setError(err.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Banco de origem
                <select name="bankKind" required>
                  <option value="same">Mesmo banco — BAI</option>
                  <option value="other">Outro banco</option>
                </select>
              </label>
              <label>
                Enviar comprovativo · Imagem até 1 MB ou PDF até 5 MB
                <input
                  type="file"
                  name="proof"
                  required
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                />
              </label>
              <button className="btn" disabled={busy}>
                {busy ? "A enviar…" : "Enviar comprovativo"}
              </button>
            </form>
          ) : (
            <p>Solicita primeiro a assinatura para anexar o comprovativo.</p>
          )}
          <p role="status">{message}</p>
          {data.proofs.map((p) => (
            <p key={p.id}>
              <a href={"/api/payment-proofs/" + p.id}>
                Descarregar comprovativo
              </a>{" "}
              · {p.request_id} ·{" "}
              {p.status === "pending"
                ? "Em verificação"
                : p.status === "verified"
                  ? "Verificado"
                  : "Recusado"}{" "}
              · {p.bank_kind === "same" ? "BAI" : "Outro banco"}
            </p>
          ))}
        </>
      ) : (
        <p>A carregar coordenadas…</p>
      )}
      <p role="alert" className="form-error">
        {error}
      </p>
    </section>
  );
}
export function PaymentReview({ api, userId }) {
  const [proofs, setProofs] = useState([]),
    [error, setError] = useState("");
  useEffect(() => {
    api("/admin/payment-proofs/" + userId)
      .then((d) => setProofs(d.proofs))
      .catch((e) => setError(e.message));
  }, [userId]);
  return (
    <div>
      <h4>Comprovativos</h4>
      {proofs.length ? (
        proofs.map((p) => (
          <p key={p.id}>
            <a href={"/api/payment-proofs/" + p.id}>Descarregar comprovativo</a>{" "}
            · {p.request_id} ·{" "}
            {p.bank_kind === "same"
              ? "BAI · na hora"
              : "Outro banco · 24 horas"}{" "}
            · {p.status === "verified" ? "Verificado" : "Em verificação"}
          </p>
        ))
      ) : (
        <p>Nenhum comprovativo enviado.</p>
      )}
      <p role="alert">{error}</p>
    </div>
  );
}
export function Branding({ api, space, onSaved }) {
  const [logo, setLogo] = useState(space.logo || ""),
    [covers, setCovers] = useState(() => JSON.parse(space.covers || "[]")),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function upload(e, index) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 1048576) {
      e.target.value = "";
      return setError("Cada imagem deve ter no máximo 1 MB.");
    }
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.append("image", file);
      const r = await fetch("/api/uploads", { method: "POST", body }),
        d = await r.json();
      if (!r.ok) throw Error(d.error);
      if (index === -1) setLogo(d.url);
      else
        setCovers((old) => {
          const c = [...old];
          c[index] = d.url;
          return c;
        });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>Identidade do estabelecimento</h2>
      <p>
        O logotipo e quatro fotografias de capa são obrigatórios para a
        aprovação. Cada imagem: JPG, PNG ou WebP, máximo 1 MB.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await api("/spaces/" + space.id + "/branding", "PUT", {
              logo,
              covers,
            });
            setMessage(
              "Imagens guardadas. Se o espaço já está aprovado, ficam disponíveis no menu.",
            );
            await onSaved();
          } catch (err) {
            setError(err.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="media-grid">
          {[-1, 0, 1, 2, 3].map((i) => (
            <label key={i}>
              {i === -1 ? "Logotipo" : "Capa " + (i + 1)}
              {(i === -1 ? logo : covers[i]) ? (
                <img
                  className="review-image"
                  src={i === -1 ? logo : covers[i]}
                  alt={i === -1 ? "Logotipo" : "Capa " + (i + 1)}
                />
              ) : null}
              <input
                type="file"
                disabled={busy}
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => upload(e, i)}
              />
            </label>
          ))}
        </div>
        <p role="alert" className="form-error">
          {error}
        </p>
        <p role="status">{message}</p>
        <button
          className="btn"
          disabled={busy || !logo || covers.filter(Boolean).length !== 4}
        >
          {busy ? "A guardar…" : "Guardar logotipo e capas"}
        </button>
      </form>
    </section>
  );
}
export function PasswordLink({ api, user }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  return (
    <section className="panel activation">
      <h1>Alterar palavra-passe.</h1>
      <p>
        Enviaremos um link privado para {user.email}. A palavra-passe só muda
        depois de abrires o link e definires a nova senha.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const r = await api(
              "/account/password-link",
              "POST",
              Object.fromEntries(new FormData(e.currentTarget)),
            );
            setMessage(r.message);
          } catch (err) {
            setError(err.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Palavra-passe atual
          <input
            type="password"
            name="confirmationPassword"
            autoComplete="current-password"
            required
            maxLength="128"
          />
        </label>
        <button className="btn" disabled={busy}>
          {busy ? "A enviar…" : "Enviar link para o meu email"}
        </button>
        <p role="alert" className="form-error">
          {error}
        </p>
        <p role="status">{message}</p>
      </form>
    </section>
  );
}
