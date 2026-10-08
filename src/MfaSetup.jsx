import React, { useState, useEffect } from "react";
export default function MfaSetup({ api, onComplete }) {
  const [setup, setSetup] = useState(null),
    [codes, setCodes] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    api("/staff/mfa/setup")
      .then((d) => {
        if (alive) setSetup(d);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [api]);
  return (
    <section className="panel activation">
      <span className="eyebrow">SEGURANÇA DA CONTA</span>
      <h1>Ativa a verificação em dois passos.</h1>
      {codes ? (
        <>
          <p>
            Guarda estes códigos de recuperação num local seguro. Cada código
            substitui o código da aplicação uma única vez. Não serão mostrados
            novamente.
          </p>
          <textarea
            aria-label="Códigos de recuperação"
            readOnly
            rows="8"
            value={codes.join("\n")}
          />
          <button className="btn" onClick={onComplete}>
            Guardei os códigos. Continuar
          </button>
        </>
      ) : setup ? (
        <>
          <p>
            Na tua aplicação autenticadora, adiciona uma conta com esta chave.
            Usa uma aplicação compatível com TOTP, como o autenticador que já
            utilizas.
          </p>
          <label>
            Chave de configuração
            <input readOnly value={setup.secret} />
          </label>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              const data = Object.fromEntries(new FormData(e.currentTarget));
              try {
                const r = await api("/staff/mfa/enable", "POST", data);
                setCodes(r.recoveryCodes);
                setSetup(null);
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Código de 6 dígitos
              <input
                name="code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength="6"
                required
                autoComplete="one-time-code"
              />
            </label>
            <label>
              Confirma a tua palavra-passe
              <input
                name="confirmationPassword"
                type="password"
                maxLength="128"
                required
                autoComplete="current-password"
              />
            </label>
            <button className="btn" disabled={busy}>
              {busy ? "A verificar…" : "Ativar proteção"}
            </button>
          </form>
        </>
      ) : (
        <p>A preparar a configuração…</p>
      )}
      <p className="form-error" role="alert">
        {error}
      </p>
    </section>
  );
}
