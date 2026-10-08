import React, { useState, useEffect, useRef } from "react";
import MfaSetup from "./MfaSetup.jsx";
import { createRoot } from "react-dom/client";

const labels = {
  pending: "Pendente",
  approved: "Aprovado",
  rejected: "Rejeitado",
  active: "Ativa",
  suspended: "Suspensa",
  cancelled: "Cancelada",
  owner: "Estabelecimento",
  admin: "Administrador",
  manager: "Gestor",
};
const permissions = {
  "spaces.review": "Aprovar estabelecimentos",
  "subscriptions.manage": "Gerir assinaturas",
  "media.review": "Moderar imagens",
  "audit.read": "Consultar auditoria",
};
const amount = (v) => new Intl.NumberFormat("pt-AO").format(v) + " Kz";
async function api(url, method = "GET", body) {
  const r = await fetch("/api" + url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || "Não foi possível concluir.");
  return data;
}
function Field({ label, ...props }) {
  return (
    <label>
      {label}
      <input {...props} />
    </label>
  );
}
function Shell({ children, user }) {
  return (
    <>
      <header className="header">
        <div className="container nav">
          <a className="brand" href="/">
            <img src="/favicon.svg" width="38" height="38" alt="" />
            menuonline<sup>AO</sup>
          </a>
          <span>{user?.name || user?.email || "Muds"}</span>
          {user ? <a href="/perfil">Perfil e segurança</a> : null}
          {user ? (
            <button
              className="btn small outline"
              onClick={async () => {
                await api("/logout", "POST");
                location.href =
                  user.role === "owner" ? "/entrar" : "/acesso-muds";
              }}
            >
              Sair
            </button>
          ) : (
            <a href="/entrar">Entrar</a>
          )}
        </div>
      </header>
      <main className="container console-main">{children}</main>
      <footer>
        <div className="container footer-bottom">
          <span>Menu Online · Desenvolvido e gerido pela Muds</span>
          <a
            href="https://muds.ao/contacto"
            target="_blank"
            rel="noopener noreferrer"
          >
            Contactar a Muds ↗
          </a>
        </div>
      </footer>
    </>
  );
}

function PasswordChange({ user, required = false }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="panel activation">
      <h2>
        {required ? "Substituir senha provisória" : "Alterar palavra-passe"}
      </h2>
      <p>
        {required
          ? "Define a tua palavra-passe pessoal para continuar. A senha provisória expira em 48 horas."
          : "A alteração termina todas as sessões. Terás de entrar novamente."}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const d = Object.fromEntries(new FormData(e.currentTarget));
          if (d.password !== d.confirm)
            return setError("As palavras-passe não coincidem.");
          setBusy(true);
          setError("");
          try {
            await api("/account/password", "POST", d);
            location.href =
              (user.role === "owner" ? "/entrar" : "/acesso-muds") +
              "?senha=alterada";
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field
          label="Palavra-passe atual"
          type="password"
          name="currentPassword"
          required
          maxLength="128"
          autoComplete="current-password"
        />
        <Field
          label="Nova palavra-passe"
          type="password"
          name="password"
          required
          minLength="14"
          maxLength="128"
          autoComplete="new-password"
        />
        <Field
          label="Confirmar nova palavra-passe"
          type="password"
          name="confirm"
          required
          minLength="14"
          maxLength="128"
          autoComplete="new-password"
        />
        {user.mfa_enabled ? (
          <Field
            label="Código de autenticação ou recuperação"
            name="code"
            required
            maxLength="32"
            autoComplete="one-time-code"
          />
        ) : null}
        <p role="alert" className="form-error">
          {error}
        </p>
        <button className="btn" disabled={busy}>
          {busy ? "A guardar…" : "Guardar nova palavra-passe"}
        </button>
      </form>
    </section>
  );
}
function PasswordRecovery() {
  const reset = location.pathname === "/redefinir-senha";
  const [token] = useState(() => location.hash.slice(1));
  const [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [done, setDone] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (reset) history.replaceState(null, "", "/redefinir-senha");
  }, [reset]);
  return (
    <Shell>
      <section className="panel activation">
        <span className="eyebrow">ACESSO À TUA CONTA</span>
        <h1>{reset ? "Criar nova palavra-passe." : "Esqueci minha senha."}</h1>
        {done ? (
          <>
            <p role="status">{message}</p>
            <a href="/entrar" className="btn">
              Voltar ao login
            </a>
            <p>
              <a
                href="https://muds.ao/contacto"
                target="_blank"
                rel="noopener noreferrer"
              >
                Contactar a Muds
              </a>
            </p>
          </>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const d = Object.fromEntries(new FormData(e.currentTarget));
              if (reset && d.password !== d.confirm)
                return setError("As palavras-passe não coincidem.");
              setBusy(true);
              setError("");
              try {
                const r = await api(
                  reset ? "/password/reset" : "/password/forgot",
                  "POST",
                  reset ? { token, password: d.password } : d,
                );
                setMessage(
                  reset
                    ? "Palavra-passe alterada. Entra novamente com a nova senha."
                    : r.message,
                );
                setDone(true);
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {reset ? (
              <>
                <p>
                  O link é válido por 30 minutos e só pode ser utilizado uma
                  vez.
                </p>
                <Field
                  label="Nova palavra-passe"
                  type="password"
                  name="password"
                  minLength="14"
                  maxLength="128"
                  autoComplete="new-password"
                  required
                />
                <Field
                  label="Confirmar nova palavra-passe"
                  type="password"
                  name="confirm"
                  minLength="14"
                  maxLength="128"
                  autoComplete="new-password"
                  required
                />
              </>
            ) : (
              <>
                <p>
                  Indica o email registado. Receberás um link privado para
                  alterar a palavra-passe.
                </p>
                <Field
                  label="Email"
                  type="email"
                  name="email"
                  autoComplete="email"
                  required
                  maxLength="254"
                />
              </>
            )}
            <p role="alert" className="form-error">
              {error}
            </p>
            <button className="btn" disabled={busy}>
              {busy
                ? "A processar…"
                : reset
                  ? "Guardar nova palavra-passe"
                  : "Enviar link de recuperação"}
            </button>
          </form>
        )}
      </section>
    </Shell>
  );
}
function SubscriptionChoice({ user, refresh }) {
  const sub = user.subscription,
    current = user.plans[sub.plan];
  const [plan, setPlan] = useState(sub.requested_plan || sub.plan),
    [cycle, setCycle] = useState(
      sub.requested_cycle || sub.billing_cycle || "trimestral",
    ),
    [kind, setKind] = useState("new"),
    [editing, setEditing] = useState(
      !sub.request_id && sub.status === "pending",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [receipt, setReceipt] = useState(null);
  const formRef = useRef(null),
    expired = !!sub.ends_at && sub.ends_at <= Date.now();
  const request =
    receipt ||
    (sub.request_id
      ? {
          requestId: sub.request_id,
          plan: sub.requested_plan,
          billingCycle: sub.requested_cycle,
          total:
            user.plans[sub.requested_plan]?.price *
            user.billingCycles[sub.requested_cycle]?.months,
        }
      : null);
  function edit(action) {
    setKind(action);
    setEditing(true);
    setError("");
    if (action === "renew") {
      setPlan(sub.plan);
      setCycle(sub.billing_cycle || "trimestral");
    }
    setTimeout(
      () =>
        formRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        }),
      0,
    );
  }
  return (
    <>
      <div className="console-heading">
        <div>
          <span className="eyebrow">A TUA CONTA</span>
          <h1>A minha assinatura.</h1>
        </div>
        <a className="btn outline" href="/painel">
          Voltar aos estabelecimentos
        </a>
      </div>
      <section className="panel">
        <h2>{current.name}</h2>
        <p>
          Estado:{" "}
          <strong>
            {expired ? "Expirada" : labels[sub.status] || "Pendente"}
          </strong>
        </p>
        <p>
          Validade:{" "}
          <strong>
            {sub.ends_at
              ? new Date(sub.ends_at).toLocaleDateString("pt-AO")
              : "Ainda sem data de ativação"}
          </strong>
        </p>
        <p>
          Período: {user.billingCycles[sub.billing_cycle || "trimestral"].name}{" "}
          · Até {current.spaces} estabelecimentos
        </p>
        <div className="console-actions">
          <button className="btn" onClick={() => edit("change")}>
            Alterar o plano
          </button>
          <button className="btn outline" onClick={() => edit("renew")}>
            Renovar assinatura
          </button>
        </div>
      </section>
      {request ? (
        <section className="panel subscription-receipt" role="status">
          <h2>Solicitação recebida</h2>
          <p>
            Referência: <strong>{request.requestId}</strong> · Aguarda
            confirmação da equipa Muds.
          </p>
          <p>
            {user.plans[request.plan]?.name} ·{" "}
            {user.billingCycles[request.billingCycle]?.name} ·{" "}
            <strong>{amount(request.total)}</strong>
          </p>
          <p>
            O pedido está guardado e visível na gestão Muds. A equipa irá
            confirmar as instruções de pagamento; a assinatura só será ativada
            após verificação. A assinatura atual mantém a sua validade.
          </p>
        </section>
      ) : null}
      {editing ? (
        <section className="panel" ref={formRef}>
          <h2>
            {kind === "renew"
              ? "Renovar assinatura"
              : kind === "change"
                ? "Alterar o plano"
                : "Plano e período de assinatura"}
          </h2>
          <p>
            Seleciona uma das três modalidades. O valor apresentado é o total a
            pagar pelo período.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              setBusy(true);
              setError("");
              try {
                const result = await api(
                  "/account/subscription-request",
                  "POST",
                  { plan, billingCycle: cycle, kind },
                );
                setReceipt({ ...result, plan, billingCycle: cycle });
                setEditing(false);
                await refresh();
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="form-grid">
              <label>
                Plano
                <select value={plan} onChange={(e) => setPlan(e.target.value)}>
                  {Object.entries(user.plans).map(([k, p]) => (
                    <option value={k} key={k}>
                      {p.name} · {amount(p.price)}/mês
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Período
                <select
                  value={cycle}
                  onChange={(e) => setCycle(e.target.value)}
                >
                  {Object.entries(user.billingCycles).map(([k, p]) => (
                    <option value={k} key={k}>
                      {p.name} · {p.months} meses
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="subscription-total">
              Total do período:{" "}
              <strong>
                {amount(
                  user.plans[plan].price * user.billingCycles[cycle].months,
                )}
              </strong>
            </p>
            <p className="form-error" role="alert">
              {error}
            </p>
            <button className="btn" disabled={busy}>
              {busy
                ? "A enviar solicitação…"
                : kind === "renew"
                  ? "Solicitar renovação"
                  : kind === "change"
                    ? "Solicitar alteração"
                    : "Solicitar assinatura"}
            </button>
          </form>
        </section>
      ) : null}
    </>
  );
}
function AngolaPhone({ value = "" }) {
  const [number, setNumber] = useState(() => String(value).replace(/^244/, ""));
  return (
    <label>
      WhatsApp
      <div className="phone-input">
        <span aria-hidden="true">+244</span>
        <input
          aria-label="Número WhatsApp (9 dígitos)"
          name="whatsapp"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="936479545"
          pattern="[0-9]{9}"
          title="Indica os 9 dígitos do número. O indicativo +244 já está incluído."
          required
          value={number}
          onChange={(e) => {
            let n = e.target.value.replace(/[^0-9]/g, "");
            if (n.length > 9 && n.startsWith("244")) n = n.slice(3);
            setNumber(n);
          }}
          maxLength="20"
        />
      </div>
      <small>Indicativo de Angola incluído · 9 dígitos</small>
    </label>
  );
}

function Activation() {
  const [error, setError] = useState(""),
    [done, setDone] = useState(false),
    [busy, setBusy] = useState(false),
    [token] = useState(() => location.hash.slice(1));
  useEffect(() => {
    history.replaceState(null, "", "/ativar-equipa");
  }, []);
  return (
    <Shell>
      <section className="panel activation">
        <span className="eyebrow">EQUIPA MUDS</span>
        <h1>Ativar o teu acesso.</h1>
        {done ? (
          <>
            <p>
              Acesso ativado. Já podes entrar com o teu email e palavra-passe.
            </p>
            <a className="btn" href="/entrar">
              Entrar
            </a>
          </>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              if (data.get("password") !== data.get("confirm"))
                return setError("As palavras-passe não coincidem.");
              setBusy(true);
              try {
                await api("/staff/activate", "POST", {
                  token,
                  password: data.get("password"),
                });
                setDone(true);
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <p>
              O convite é pessoal, expira em 48 horas e só pode ser usado uma
              vez.
            </p>
            <Field
              label="Nova palavra-passe"
              name="password"
              type="password"
              minLength="14"
              maxLength="128"
              autoComplete="new-password"
              required
            />
            <Field
              label="Repetir palavra-passe"
              name="confirm"
              type="password"
              minLength="14"
              maxLength="128"
              autoComplete="new-password"
              required
            />
            <p role="alert" className="form-error">
              {error}
            </p>
            <button className="btn" disabled={busy || !token}>
              Ativar acesso
            </button>
          </form>
        )}
      </section>
    </Shell>
  );
}
function ProductEditor({ spaceId, product, onSaved, onCancel }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [image, setImage] = useState(product?.image || "");
  async function upload(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 1048576) {
      e.target.value = "";
      return setError("A fotografia deve ter no máximo 1 MB.");
    }
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.append("image", file);
      const r = await fetch("/api/uploads", { method: "POST", body }),
        data = await r.json();
      if (!r.ok) throw Error(data.error);
      setImage(data.url);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>{product ? "Editar produto" : "Adicionar produto"}</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const d = Object.fromEntries(new FormData(e.currentTarget));
          setBusy(true);
          try {
            await api("/products", "POST", {
              ...d,
              id: product?.id,
              spaceId,
              price: Number(d.price),
              available: d.available === "on",
              image,
            });
            onSaved();
          } catch (e) {
            setError(e.message);
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <Field
            label="Nome"
            name="name"
            required
            maxLength="100"
            defaultValue={product?.name}
          />
          <Field
            label="Categoria"
            name="category"
            required
            maxLength="80"
            defaultValue={product?.category || "Menu"}
          />
        </div>
        <Field
          label="Preço em Kz"
          name="price"
          type="number"
          min="0"
          max="10000000"
          step="1"
          required
          defaultValue={product?.price}
        />
        <label>
          Descrição
          <textarea
            name="description"
            maxLength="500"
            defaultValue={product?.description}
          />
        </label>
        <label>
          Fotografia · JPG, PNG ou WebP · Máximo 1 MB
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={upload}
          />
        </label>
        {image ? (
          <>
            <img
              src={image}
              className="review-image"
              alt="Fotografia do produto"
            />
            <button
              type="button"
              className="text-button"
              onClick={() => setImage("")}
            >
              Retirar fotografia
            </button>
            <p>
              As novas fotografias aguardam aprovação da Muds antes de
              aparecerem no menu público.
            </p>
          </>
        ) : null}
        <label className="checkbox-label">
          <input
            type="checkbox"
            name="available"
            defaultChecked={product ? !!product.available : true}
          />
          Disponível
        </label>
        <p className="form-error" role="alert">
          {error}
        </p>
        <div className="console-actions">
          <button className="btn" disabled={busy}>
            {busy ? "A guardar…" : "Guardar produto"}
          </button>
          <button className="btn outline" type="button" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </form>
    </section>
  );
}
function SpaceEditor({ space, onSaved, onCancel }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="panel">
      <h2>{space?.id ? "Informações do espaço" : "Novo estabelecimento"}</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const d = Object.fromEntries(new FormData(e.currentTarget));
          setBusy(true);
          try {
            await api("/space", "PUT", {
              ...d,
              id: space?.id,
              published: d.published === "on",
            });
            await onSaved(d.slug);
          } catch (e) {
            setError(e.message);
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <Field
            label="Nome do espaço"
            name="name"
            required
            minLength="2"
            maxLength="100"
            defaultValue={space?.name}
          />
          <AngolaPhone value={space?.whatsapp} />
        </div>
        <Field
          label="Endereço do menu (ex.: sabor-luanda)"
          name="slug"
          required
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          maxLength="60"
          defaultValue={space?.slug}
        />
        <label>
          Descrição
          <textarea
            name="description"
            maxLength="1000"
            defaultValue={space?.description}
          />
        </label>
        <div className="form-grid">
          <Field
            label="Morada"
            name="address"
            maxLength="200"
            defaultValue={space?.address}
          />
          <Field
            label="Horário"
            name="hours"
            maxLength="200"
            defaultValue={space?.hours}
          />
        </div>
        <label className="checkbox-label">
          <input
            name="published"
            type="checkbox"
            defaultChecked={!!space?.published}
          />
          Solicitar publicação do menu
        </label>
        <p>
          O menu fica público após aprovação da Muds e ativação da assinatura.
          Alterar o nome, contacto ou morada exige nova revisão.
        </p>
        <p className="form-error" role="alert">
          {error}
        </p>
        <div className="console-actions">
          <button className="btn" disabled={busy}>
            Guardar espaço
          </button>
          <button className="btn outline" type="button" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </form>
    </section>
  );
}
function Owner({ user, refresh }) {
  const [selected, setSelected] = useState(user.spaces[0]?.id || null),
    [editor, setEditor] = useState(null),
    [products, setProducts] = useState([]),
    [product, setProduct] = useState(null),
    [error, setError] = useState(""),
    [deleteOpen, setDeleteOpen] = useState(false);
  const space = user.spaces.find((s) => s.id === selected),
    sub = user.subscription,
    plan = user.plans[sub.plan],
    active = sub.status === "active" && sub.ends_at > Date.now();
  async function loadProducts() {
    if (selected) {
      try {
        setProducts((await api("/spaces/" + selected + "/products")).products);
      } catch (e) {
        setError(e.message);
      }
    } else setProducts([]);
  }
  useEffect(() => {
    let disposed = false;
    if (selected)
      api("/spaces/" + selected + "/products")
        .then((d) => {
          if (!disposed) setProducts(d.products);
        })
        .catch((e) => {
          if (!disposed) setError(e.message);
        });
    else setProducts([]);
    return () => {
      disposed = true;
    };
  }, [selected]);
  return (
    <>
      <div className="console-heading">
        <div>
          <span className="eyebrow">O TEU NEGÓCIO</span>
          <h1>Os teus estabelecimentos.</h1>
        </div>
        <button
          className="btn"
          disabled={user.spaces.length >= plan.spaces}
          onClick={() => {
            setEditor({});
            setProduct(null);
          }}
        >
          + Novo estabelecimento
        </button>
      </div>
      <section className="subscription-banner">
        <strong>
          {plan.name} · {amount(plan.price)}/mês
        </strong>
        <span>
          {user.spaces.length}/{plan.spaces} estabelecimentos ·{" "}
          {active
            ? "Ativa até " + new Date(sub.ends_at).toLocaleDateString("pt-AO")
            : sub.status === "active"
              ? "Expirada"
              : labels[sub.status] || "Pendente"}
        </span>
        <a href="/assinatura">Gerir assinatura</a>
      </section>
      <p className="form-error" role="alert">
        {error}
      </p>
      <div className="space-tabs">
        {user.spaces.map((s) => (
          <button
            className={"btn small " + (selected === s.id ? "" : "outline")}
            key={s.id}
            onClick={() => {
              setSelected(s.id);
              setEditor(null);
              setProduct(null);
            }}
          >
            {s.name}
          </button>
        ))}
      </div>
      {editor ? (
        <SpaceEditor
          key={editor.id || "new"}
          space={editor}
          onSaved={async (slug) => {
            const updated = await refresh();
            const saved = updated.spaces.find((s) => s.slug === slug);
            if (saved) setSelected(saved.id);
            setEditor(null);
          }}
          onCancel={() => setEditor(null)}
        />
      ) : null}
      {space ? (
        <>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>{space.name}</h2>
                <p>
                  Aprovação: <strong>{labels[space.approval]}</strong> ·{" "}
                  {space.published ? "Publicação solicitada" : "Rascunho"}
                </p>
                {space.review_note ? (
                  <p>Nota da Muds: {space.review_note}</p>
                ) : null}
              </div>
              <button
                className="btn small outline"
                onClick={() => setEditor(space)}
              >
                Editar espaço
              </button>
            </div>
            {space.approval === "approved" && active && space.published ? (
              <div className="qr-console">
                <img
                  src={"/api/qr/" + space.slug}
                  alt={"QR Code de " + space.name}
                  width="160"
                  height="160"
                />
                <div>
                  <a
                    className="btn"
                    href={"/m/" + space.slug}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Abrir menu
                  </a>
                  <a
                    className="btn outline"
                    href={"/api/qr/" + space.slug}
                    download={"menu-" + space.slug + ".png"}
                  >
                    Descarregar QR
                  </a>
                  <p>{location.origin + "/m/" + space.slug}</p>
                </div>
              </div>
            ) : (
              <p>
                O QR ficará disponível após aprovação, assinatura ativa e
                solicitação de publicação.
              </p>
            )}
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>Produtos</h2>
              <button className="btn small" onClick={() => setProduct({})}>
                + Adicionar produto
              </button>
            </div>
            {products.length ? (
              products.map((p) => (
                <article className="management-row" key={p.id}>
                  <div>
                    <strong>{p.name}</strong>
                    <span>
                      {p.category} · {amount(p.price)}
                    </span>
                  </div>
                  <span>{p.available ? "Disponível" : "Esgotado"}</span>
                  <button className="text-button" onClick={() => setProduct(p)}>
                    Editar
                  </button>
                  <button
                    className="text-button danger"
                    onClick={async () => {
                      if (!confirm("Eliminar este produto?")) return;
                      try {
                        await api("/products/" + p.id, "DELETE");
                        await loadProducts();
                      } catch (e) {
                        setError(e.message);
                      }
                    }}
                  >
                    Eliminar
                  </button>
                </article>
              ))
            ) : (
              <p>Adiciona os primeiros produtos do teu menu.</p>
            )}
          </section>
          {product ? (
            <ProductEditor
              key={product.id || "new"}
              spaceId={space.id}
              product={product.id ? product : null}
              onSaved={async () => {
                setProduct(null);
                await loadProducts();
              }}
              onCancel={() => setProduct(null)}
            />
          ) : null}
        </>
      ) : user.spaces.length ? (
        <p>Seleciona um estabelecimento.</p>
      ) : (
        <section className="panel">
          <h2>O primeiro espaço começa aqui.</h2>
          <p>
            Cria o estabelecimento, adiciona os produtos e solicita a publicação
            à Muds.
          </p>
        </section>
      )}
      <section className="account-controls">
        <a href="/api/account/export">Exportar os meus dados</a>
        <button
          className="text-button danger"
          onClick={() => setDeleteOpen((v) => !v)}
        >
          Eliminar conta
        </button>
      </section>
      {deleteOpen ? (
        <section className="panel">
          <h2>Eliminar permanentemente a conta</h2>
          <p>
            Os estabelecimentos, produtos e fotografias serão eliminados.
            Exporta os dados antes de continuar.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api("/account/delete", "POST", {
                  password: new FormData(e.currentTarget).get("password"),
                });
                location.href = "/";
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            <Field
              label="Confirma a palavra-passe"
              name="password"
              type="password"
              required
              maxLength="128"
              autoComplete="current-password"
            />
            <label className="checkbox-label">
              <input type="checkbox" required />
              Compreendo que a eliminação é permanente.
            </label>
            <button className="btn">Eliminar permanentemente</button>
          </form>
        </section>
      ) : null}
    </>
  );
}
function MailSettings() {
  const [settings, setSettings] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api("/admin/mail")
      .then(setSettings)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <section className="panel">
      <h2>Email de recuperação</h2>
      <p>
        Cria primeiro a caixa conta@menuao.online na Hostinger. A ligação usa
        TLS e a palavra-passe fica cifrada; nunca é mostrada novamente.
      </p>
      <p>
        {settings?.configured
          ? "Envio configurado: " + settings.username
          : "Envio ainda não configurado."}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          setBusy(true);
          setError("");
          try {
            await api(
              "/admin/mail",
              "PUT",
              Object.fromEntries(new FormData(form)),
            );
            form.reset();
            setSettings(await api("/admin/mail"));
            setError("Ligação SMTP verificada e guardada.");
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field
          label="Email remetente da Hostinger"
          type="email"
          name="username"
          defaultValue="conta@menuao.online"
          required
          maxLength="254"
        />
        <Field
          label="Palavra-passe da caixa de email"
          type="password"
          name="smtpPassword"
          autoComplete="off"
          required
          maxLength="256"
        />
        <Field
          label="A tua palavra-passe de administrador"
          type="password"
          name="confirmationPassword"
          autoComplete="current-password"
          required
          maxLength="128"
        />
        <p role="status">{error}</p>
        <button className="btn" disabled={busy}>
          {busy ? "A verificar…" : "Verificar e ativar envio"}
        </button>
      </form>
    </section>
  );
}
function Staff({ user }) {
  const confirmationRef = useRef(null);
  const [data, setData] = useState(null),
    [tab, setTab] = useState("spaces"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmation, setConfirmation] = useState(null),
    [invite, setInvite] = useState(""),
    [editing, setEditing] = useState(null);
  useEffect(() => {
    if (confirmation)
      confirmationRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
  }, [confirmation]);
  const can = (p) => user.role === "admin" || user.permissions.includes(p);
  async function refresh() {
    setData(await api("/admin/overview"));
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);
  function confirmAction(url, method, body) {
    setError("");
    setConfirmation({ url, method, body });
  }
  async function execute(e) {
    e.preventDefault();
    const password = new FormData(e.currentTarget).get("password");
    setBusy(true);
    try {
      const r = await api(confirmation.url, confirmation.method, {
        ...confirmation.body,
        confirmationPassword: password,
      });
      setConfirmation(null);
      setEditing(null);
      if (r.activationUrl) setInvite(location.origin + r.activationUrl);
      if (r.resetUrl) setInvite(r.resetUrl);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!data) return <p role="status">{error || "A carregar a gestão…"}</p>;
  return (
    <>
      <div className="console-heading">
        <div>
          <span className="eyebrow">GESTÃO DA PLATAFORMA · MUDS</span>
          <h1>Visão geral.</h1>
          <p>
            {labels[user.role]} · {user.name}
          </p>
        </div>
      </div>
      <div className="console-stats">
        <article>
          <strong>{data.spaces.length}</strong>
          <span>Estabelecimentos visíveis</span>
        </article>
        <article>
          <strong>
            {data.spaces.filter((s) => s.approval === "pending").length}
          </strong>
          <span>A aguardar revisão</span>
        </article>
        <article>
          <strong>
            {
              data.users.filter(
                (u) => u.status === "active" && u.ends_at > Date.now(),
              ).length
            }
          </strong>
          <span>Assinaturas ativas</span>
        </article>
      </div>
      <nav className="space-tabs" aria-label="Gestão Muds">
        {[
          ["spaces", "Estabelecimentos", "spaces.review"],
          ["subscriptions", "Assinaturas", "subscriptions.manage"],
          ["media", "Imagens", "media.review"],
          ["audit", "Auditoria", "audit.read"],
          ...(user.role === "admin"
            ? [["users", "Equipa e acessos", null]]
            : []),
        ]
          .filter((x) => !x[2] || can(x[2]))
          .map(([key, label]) => (
            <button
              key={key}
              className={"btn small " + (tab === key ? "" : "outline")}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
      </nav>
      <p role="alert" className="form-error">
        {error}
      </p>
      {invite ? (
        <section className="panel">
          <h2>Link privado criado</h2>
          <p>
            Entrega este link apenas ao titular após verificar a sua identidade.
            Os links de recuperação expiram em 30 minutos; os convites, em 48
            horas. Ambos são de utilização única.
          </p>
          <input aria-label="Link de ativação" value={invite} readOnly />
          <button
            className="btn small"
            onClick={() =>
              navigator.clipboard
                .writeText(invite)
                .catch(() => setError("Seleciona e copia o link."))
            }
          >
            Copiar convite
          </button>
          <button className="text-button" onClick={() => setInvite("")}>
            Ocultar
          </button>
        </section>
      ) : null}
      {confirmation ? (
        <section className="panel confirmation" ref={confirmationRef}>
          <h2>Confirmar operação</h2>
          <p>
            Para proteger a plataforma, confirma a tua palavra-passe. Esta ação
            ficará registada na auditoria.
          </p>
          <form onSubmit={execute}>
            <Field
              label="A tua palavra-passe"
              type="password"
              name="password"
              required
              maxLength="128"
              autoComplete="current-password"
            />
            <div className="console-actions">
              <button className="btn" disabled={busy}>
                {busy ? "A guardar…" : "Confirmar"}
              </button>
              <button
                type="button"
                className="btn outline"
                disabled={busy}
                onClick={() => setConfirmation(null)}
              >
                Cancelar
              </button>
            </div>
          </form>
        </section>
      ) : null}
      {tab === "spaces" ? (
        <section className="panel">
          <h2>Estabelecimentos</h2>
          {data.spaces.map((s) => (
            <article className="review-card" key={s.id}>
              <h3>
                {s.name} <span className="tag">{labels[s.approval]}</span>
              </h3>
              <p>
                {s.email} · {s.whatsapp}
              </p>
              <p>
                {s.address} · {s.hours}
              </p>
              <p>{s.description}</p>
              <p>
                /{s.slug} · {s.published ? "Publicação solicitada" : "Rascunho"}
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const d = Object.fromEntries(new FormData(e.currentTarget));
                  confirmAction("/admin/spaces/" + s.id, "PUT", d);
                }}
              >
                <label>
                  Decisão
                  <select name="approval" defaultValue={s.approval}>
                    <option value="pending">Pendente</option>
                    <option value="approved">Aprovar</option>
                    <option value="rejected">Rejeitar</option>
                  </select>
                </label>
                <Field
                  label="Nota para o estabelecimento"
                  name="note"
                  maxLength="1000"
                  defaultValue={s.review_note}
                />
                <button className="btn small">Guardar decisão</button>
              </form>
            </article>
          ))}
          {!data.spaces.length ? <p>Sem estabelecimentos para rever.</p> : null}
        </section>
      ) : null}
      {tab === "subscriptions" ? (
        <section className="panel">
          <h2>Assinaturas</h2>
          <p>
            Verifica o pagamento antes de ativar. A referência é um registo
            interno; esta operação não cobra dinheiro.
          </p>
          {data.users
            .filter((u) => u.role === "owner")
            .map((u) => (
              <article key={u.id} className="review-card">
                <h3>{u.email}</h3>
                {u.request_id ? (
                  <p>
                    Solicitação {u.request_id} ·{" "}
                    {u.requested_kind === "renew"
                      ? "Renovação"
                      : u.requested_kind === "change"
                        ? "Alteração de plano"
                        : "Adesão"}{" "}
                    · {new Date(u.requested_at).toLocaleString("pt-AO")}
                  </p>
                ) : null}
                <p>
                  {labels[u.status]} · {u.billing_cycle} ·{" "}
                  {u.requested_plan
                    ? "Pedido: " +
                      data.plans[u.requested_plan]?.name +
                      " / " +
                      u.requested_cycle
                    : ""}{" "}
                  ·{" "}
                  {u.ends_at
                    ? new Date(u.ends_at).toLocaleDateString("pt-AO")
                    : "Sem validade"}
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const d = Object.fromEntries(new FormData(e.currentTarget));
                    confirmAction("/admin/subscriptions/" + u.id, "PUT", {
                      ...d,
                      endsAt: d.end
                        ? new Date(d.end + "T23:59:59Z").getTime()
                        : undefined,
                    });
                  }}
                >
                  <div className="form-grid">
                    <label>
                      Plano
                      <select
                        name="plan"
                        defaultValue={u.requested_plan || u.plan}
                      >
                        {Object.entries(data.plans).map(([key, p]) => (
                          <option key={key} value={key}>
                            {p.name} · {amount(p.price)} · {p.spaces} espaços
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Estado
                      <select name="status" defaultValue={u.status}>
                        {["pending", "active", "suspended", "cancelled"].map(
                          (s) => (
                            <option value={s} key={s}>
                              {labels[s]}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                  </div>
                  <label>
                    Período de assinatura
                    <select
                      name="billingCycle"
                      defaultValue={
                        u.requested_cycle || u.billing_cycle || "trimestral"
                      }
                    >
                      {Object.entries(
                        data.billingCycles || {
                          trimestral: { name: "Trimestral" },
                          semestral: { name: "Semestral" },
                          anual: { name: "Anual" },
                        },
                      ).map(([k, c]) => (
                        <option value={k} key={k}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p>
                    Deixa a validade vazia para calcular pelo período escolhido.
                    Na renovação, o prazo começa no fim da validade atual ou
                    hoje, se já expirou.
                  </p>
                  <Field
                    label="Válida até"
                    type="date"
                    name="end"
                    defaultValue={
                      u.ends_at && !u.request_id
                        ? new Date(u.ends_at).toISOString().slice(0, 10)
                        : ""
                    }
                  />
                  <Field
                    label="Referência de pagamento verificado"
                    name="reference"
                    maxLength="200"
                    defaultValue={u.reference}
                  />
                  <button className="btn small">Atualizar assinatura</button>
                </form>
              </article>
            ))}
          {!data.users.some((u) => u.role === "owner") ? (
            <p>Ainda não existem assinaturas.</p>
          ) : null}
        </section>
      ) : null}
      {tab === "media" ? (
        <section className="panel">
          <h2>Moderação de imagens</h2>
          <div className="media-grid">
            {data.media.map((m) => (
              <article className="review-card" key={m.url}>
                <img
                  src={m.url}
                  alt={"Fotografia enviada por " + m.email}
                  className="review-image"
                />
                <p>
                  {m.email} · {Math.ceil(m.bytes / 1024)} KB
                </p>
                <p>{labels[m.status]}</p>
                <div className="console-actions">
                  <button
                    className="btn small"
                    onClick={() =>
                      confirmAction("/admin/media", "PUT", {
                        url: m.url,
                        status: "approved",
                      })
                    }
                  >
                    Aprovar
                  </button>
                  <button
                    className="btn small outline"
                    onClick={() =>
                      confirmAction("/admin/media", "PUT", {
                        url: m.url,
                        status: "rejected",
                      })
                    }
                  >
                    Rejeitar
                  </button>
                </div>
              </article>
            ))}
          </div>
          {!data.media.length ? <p>Não há imagens para moderar.</p> : null}
        </section>
      ) : null}
      {tab === "audit" ? (
        <section className="panel">
          <h2>Registo de operações</h2>
          <p>
            Últimas 100 operações. As palavras-passe e os convites não são
            registados.
          </p>
          {data.audit.map((a) => (
            <article className="audit-row" key={a.id}>
              <strong>{a.action}</strong>
              <span>
                {a.email || "Conta removida"} ·{" "}
                {new Date(a.created_at).toLocaleString("pt-AO")}
              </span>
              <span>
                Alvo: {a.target} · {a.detail}
              </span>
            </article>
          ))}
        </section>
      ) : null}
      {tab === "users" && user.role === "admin" ? (
        <section className="panel">
          <h2>Equipa e acessos</h2>
          <MailSettings />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              confirmAction("/admin/password-reset", "POST", {
                email: new FormData(e.currentTarget).get("email"),
              });
            }}
          >
            <h3>Recuperação assistida</h3>
            <p>
              Verifica a identidade do titular antes de entregar o link. A
              autenticação de dois fatores mantém-se ativa.
            </p>
            <Field
              label="Email ou utilizador da conta"
              name="email"
              required
              maxLength="254"
            />
            <button className="btn small">Gerar link de recuperação</button>
          </form>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const d = Object.fromEntries(new FormData(e.currentTarget));
              confirmAction("/admin/users", "POST", {
                ...d,
                permissions: new FormData(e.currentTarget).getAll(
                  "permissions",
                ),
              });
            }}
          >
            <div className="form-grid">
              <Field
                label="Nome completo"
                name="name"
                required
                maxLength="100"
              />
              <Field
                label="Email"
                name="email"
                type="email"
                required
                maxLength="254"
              />
            </div>
            <label>
              Função
              <select name="role">
                <option value="manager">
                  Gestor com permissões selecionadas
                </option>
                <option value="admin">Administrador com acesso completo</option>
              </select>
            </label>
            <fieldset>
              <legend>Permissões do gestor</legend>
              {Object.entries(permissions).map(([key, label]) => (
                <label className="checkbox-label" key={key}>
                  <input type="checkbox" name="permissions" value={key} />
                  {label}
                </label>
              ))}
            </fieldset>
            <button className="btn">Criar utilizador e convite</button>
          </form>
          <h3>Utilizadores</h3>
          {data.users.map((u) => (
            <article className="review-card" key={u.id}>
              <strong>{u.name || u.email}</strong>
              <p>
                {u.email} · {labels[u.role]} ·{" "}
                {u.disabled
                  ? "Bloqueado"
                  : u.activated
                    ? "Ativo"
                    : "Por ativar"}
              </p>
              {u.id !== user.id && u.email !== "muaza.alfredo@gmail.com" ? (
                <div className="console-actions">
                  <button
                    className="btn small outline"
                    onClick={() =>
                      confirmAction("/admin/users/" + u.id, "PUT", {
                        disabled: !u.disabled,
                      })
                    }
                  >
                    {u.disabled ? "Reativar acesso" : "Bloquear acesso"}
                  </button>
                  {u.role === "manager" ? (
                    <button
                      className="btn small outline"
                      onClick={() => setEditing(u)}
                    >
                      Editar permissões
                    </button>
                  ) : null}
                  {!u.activated && u.role !== "owner" ? (
                    <button
                      className="btn small outline"
                      onClick={() =>
                        confirmAction(
                          "/admin/users/" + u.id + "/invite",
                          "POST",
                          {},
                        )
                      }
                    >
                      Renovar convite
                    </button>
                  ) : null}
                </div>
              ) : null}
            </article>
          ))}
          {editing ? (
            <form
              key={editing.id}
              className="review-card"
              onSubmit={(e) => {
                e.preventDefault();
                confirmAction("/admin/users/" + editing.id, "PUT", {
                  disabled: !!editing.disabled,
                  permissions: new FormData(e.currentTarget).getAll(
                    "permissions",
                  ),
                });
              }}
            >
              <h3>Permissões de {editing.email}</h3>
              {Object.entries(permissions).map(([key, label]) => (
                <label className="checkbox-label" key={key}>
                  <input
                    type="checkbox"
                    name="permissions"
                    value={key}
                    defaultChecked={JSON.parse(editing.permissions).includes(
                      key,
                    )}
                  />
                  {label}
                </label>
              ))}
              <button className="btn small">Guardar permissões</button>
            </form>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
function ProfileSecurity({ user, refresh }) {
  const [setup, setSetup] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="panel activation">
      <span className="eyebrow">A TUA CONTA</span>
      <h1>Perfil e segurança.</h1>
      <p>{user.name || user.email}</p>
      <p>{user.email}</p>
      <a className="btn outline" href="/alterar-senha">
        Alterar palavra-passe
      </a>
      <h2>Autenticação de dois fatores</h2>
      {user.mfa_enabled ? (
        <>
          <p>Ativa. O código será pedido depois da palavra-passe ao entrar.</p>
          <details>
            <summary>Desativar autenticação de dois fatores</summary>
            <p>
              A conta passará a usar apenas a palavra-passe. Esta ação termina
              todas as sessões.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                try {
                  await api(
                    "/account/mfa/disable",
                    "POST",
                    Object.fromEntries(new FormData(e.currentTarget)),
                  );
                  location.href =
                    user.role === "owner" ? "/entrar" : "/acesso-muds";
                } catch (err) {
                  setError(err.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Field
                label="Palavra-passe atual"
                name="confirmationPassword"
                type="password"
                required
                autoComplete="current-password"
                maxLength="128"
              />
              <Field
                label="Código da aplicação ou recuperação"
                name="code"
                required
                autoComplete="one-time-code"
                maxLength="32"
              />
              <button className="btn outline" disabled={busy}>
                {busy ? "A verificar…" : "Desativar proteção"}
              </button>
              <p role="alert" className="form-error">
                {error}
              </p>
            </form>
          </details>
        </>
      ) : setup ? (
        <MfaSetup
          api={api}
          onComplete={() => {
            setSetup(false);
            refresh();
          }}
        />
      ) : (
        <>
          <p>
            Protege a tua conta com um código da aplicação autenticadora. A
            ativação é opcional.
          </p>
          <button className="btn" onClick={() => setSetup(true)}>
            Configurar autenticação de dois fatores
          </button>
        </>
      )}
      <p>
        <a href={user.role === "owner" ? "/painel" : "/gestao"}>
          Voltar ao painel
        </a>
      </p>
    </section>
  );
}
function Console() {
  const [user, setUser] = useState(null),
    [error, setError] = useState("");
  async function refresh() {
    const u = await api("/me");
    setUser(u);
    return u;
  }
  useEffect(() => {
    refresh()
      .then((u) => {
        if (u.role !== "owner" && location.pathname === "/painel")
          location.replace("/gestao");
      })
      .catch((e) => setError(e.message));
  }, []);
  return (
    <Shell user={user}>
      {user ? (
        location.pathname === "/perfil" && !user.must_change_password ? (
          <ProfileSecurity user={user} refresh={refresh} />
        ) : user.must_change_password ||
          location.pathname === "/alterar-senha" ? (
          <PasswordChange user={user} required={!!user.must_change_password} />
        ) : user.role === "owner" ? (
          location.pathname === "/assinatura" ? (
            <SubscriptionChoice user={user} refresh={refresh} />
          ) : location.pathname === "/gestao" ? (
            <>
              <h1>Gestão reservada à Muds.</h1>
              <a href="/painel" className="btn">
                Ir ao meu painel
              </a>
            </>
          ) : (
            <>
              <Owner user={user} refresh={refresh} />
            </>
          )
        ) : (
          <Staff user={user} />
        )
      ) : error ? (
        <>
          <h1>Entra para continuar.</h1>
          <p>{error}</p>
          <a
            className="btn"
            href={location.pathname === "/gestao" ? "/acesso-muds" : "/entrar"}
          >
            Entrar
          </a>
        </>
      ) : (
        <p role="status">A preparar o painel…</p>
      )}
    </Shell>
  );
}
createRoot(document.getElementById("app")).render(
  ["/esqueci-senha", "/redefinir-senha"].includes(location.pathname) ? (
    <PasswordRecovery />
  ) : location.pathname === "/ativar-equipa" ? (
    <Activation />
  ) : (
    <Console />
  ),
);
