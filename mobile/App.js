import zones from "./zones.json";
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  Image,
  Alert,
  Linking,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import * as SecureStore from "expo-secure-store";
import * as ImagePicker from "expo-image-picker";
import { CameraView, useCameraPermissions } from "expo-camera";
import { StatusBar } from "expo-status-bar";
const API = "https://menuao.online",
  CONTACT = "https://muds.ao/contacto";
const money = (n) => new Intl.NumberFormat("pt-AO").format(n) + " Kz";
const sample = {
  space: {
    name: "Quintal da Vila",
    slug: "demo",
    description: "Menu de demonstração · Não envia pedidos",
    address: "Luanda",
  },
  products: [
    {
      id: 1,
      name: "Frango na brasa",
      description: "Batata frita e salada fresca",
      category: "Na brasa",
      price: 6500,
      available: 1,
    },
    {
      id: 2,
      name: "Calulu da casa",
      description: "Peixe e legumes, acompanhado de funge",
      category: "Da terra",
      price: 5500,
      available: 1,
    },
    {
      id: 3,
      name: "Sumo natural",
      description: "Maracujá fresco",
      category: "Bebidas",
      price: 1800,
      available: 1,
    },
  ],
};
async function api(route, token, method = "GET", body) {
  const r = await fetch(API + "/api" + route, {
    method,
    credentials: "omit",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || "Não foi possível concluir.");
  return data;
}
function Button({ title, onPress, secondary = false, disabled = false }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[s.button, secondary && s.secondary, disabled && s.disabled]}
    >
      <Text style={[s.buttonText, secondary && s.secondaryText]}>{title}</Text>
    </Pressable>
  );
}
function Input({ label, ...props }) {
  return (
    <View style={s.inputGroup}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        style={s.input}
        placeholderTextColor="#6c7d74"
        {...props}
      />
    </View>
  );
}
function Card({ children }) {
  return <View style={s.card}>{children}</View>;
}
function Menu({ menu, onBack }) {
  const [cart, setCart] = useState({}),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState("Todos"),
    [name, setName] = useState(""),
    [notes, setNotes] = useState(""),
    [booking, setBooking] = useState(false),
    [date, setDate] = useState(""),
    [time, setTime] = useState(""),
    [people, setPeople] = useState("2");
  const items = menu.products.filter((p) => cart[p.id]),
    total = items.reduce((n, p) => n + p.price * cart[p.id], 0);
  function send(text) {
    if (menu.space.slug === "demo")
      return Alert.alert("Pré-visualização", text);
    if (!/^244\d{9}$/.test(menu.space.whatsapp))
      return Alert.alert("Contacto indisponível");
    Linking.openURL(
      "https://wa.me/" +
        menu.space.whatsapp +
        "?text=" +
        encodeURIComponent(text),
    ).catch(() => Alert.alert("Não foi possível abrir o WhatsApp"));
  }
  return (
    <>
      <Button title="← Voltar" secondary onPress={onBack} />
      <Text style={s.title}>{menu.space.name}</Text>
      <Text style={s.paragraph}>{menu.space.description}</Text>
      <Text style={s.muted}>
        {menu.space.address} · {menu.space.hours}
      </Text>
      <Button
        title={booking ? "Ver produtos" : "Reservar uma mesa"}
        secondary
        onPress={() => setBooking((v) => !v)}
      />
      {booking ? (
        <Card>
          <Text style={s.subtitle}>Pedir uma reserva</Text>
          <Input
            label="O teu nome"
            value={name}
            onChangeText={setName}
            maxLength={100}
          />
          <Input
            label="Data (AAAA-MM-DD)"
            value={date}
            onChangeText={setDate}
            maxLength={10}
          />
          <Input
            label="Hora (HH:MM)"
            value={time}
            onChangeText={setTime}
            maxLength={5}
          />
          <Input
            label="Pessoas"
            keyboardType="number-pad"
            value={people}
            onChangeText={setPeople}
            maxLength={3}
          />
          <Input
            label="Observações"
            value={notes}
            onChangeText={setNotes}
            multiline
            maxLength={500}
          />
          <Button
            title="Solicitar pelo WhatsApp"
            onPress={() => {
              if (
                !name.trim() ||
                !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
                !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) ||
                new Date(date + "T" + time) <= new Date() ||
                !(Number(people) >= 1 && Number(people) <= 100)
              )
                return Alert.alert(
                  "Revê o nome, data futura, hora e número de pessoas.",
                );
              send(
                `Olá, ${menu.space.name}! Gostaria de reservar uma mesa.\nNome: ${name}\nData: ${date}\nHora: ${time}\nPessoas: ${people}\nObservações: ${notes || "Nenhuma"}\nAguardo confirmação.`,
              );
            }}
          />
          <Text style={s.muted}>
            A reserva depende da confirmação do estabelecimento.
          </Text>
        </Card>
      ) : (
        <>
          <Input
            label="Pesquisar produtos"
            value={query}
            onChangeText={setQuery}
          />
          <ScrollView horizontal contentContainerStyle={s.tabs}>
            {["Todos", ...new Set(menu.products.map((p) => p.category))].map(
              (c) => (
                <Button
                  key={c}
                  title={c}
                  secondary={category !== c}
                  onPress={() => setCategory(c)}
                />
              ),
            )}
          </ScrollView>
          {menu.products
            .filter(
              (p) =>
                (category === "Todos" || category === p.category) &&
                (p.name + " " + p.description)
                  .toLowerCase()
                  .includes(query.toLowerCase()),
            )
            .map((p) => (
              <Card key={p.id}>
                {p.image ? (
                  <Image
                    source={{ uri: API + p.image }}
                    style={s.photo}
                    accessibilityLabel={p.name}
                  />
                ) : null}
                <Text style={s.subtitle}>{p.name}</Text>
                <Text style={s.paragraph}>{p.description}</Text>
                <Text style={s.price}>{money(p.price)}</Text>
                <Button
                  title={p.available ? "Adicionar" : "Esgotado"}
                  disabled={!p.available}
                  onPress={() =>
                    setCart((c) => ({
                      ...c,
                      [p.id]: Math.min((c[p.id] || 0) + 1, 99),
                    }))
                  }
                />
              </Card>
            ))}
          <Card>
            <Text style={s.subtitle}>O teu pedido</Text>
            {items.length ? (
              items.map((p) => (
                <View key={p.id}>
                  <Text style={s.paragraph}>
                    {cart[p.id]} × {p.name} · {money(p.price * cart[p.id])}
                  </Text>
                  <Button
                    title="Retirar uma unidade"
                    secondary
                    onPress={() =>
                      setCart((c) => ({
                        ...c,
                        [p.id]: Math.max(c[p.id] - 1, 0),
                      }))
                    }
                  />
                </View>
              ))
            ) : (
              <Text style={s.paragraph}>Adiciona os teus favoritos.</Text>
            )}
            {items.length ? (
              <>
                <Text style={s.price}>Subtotal: {money(total)}</Text>
                <Input
                  label="O teu nome"
                  value={name}
                  onChangeText={setName}
                  maxLength={100}
                />
                <Input
                  label="Mesa / entrega / observações"
                  value={notes}
                  onChangeText={setNotes}
                  maxLength={500}
                  multiline
                />
                <Button
                  title="Rever e pedir pelo WhatsApp"
                  onPress={() => {
                    if (!name.trim()) return Alert.alert("Indica o teu nome.");
                    const message = `Olá, ${menu.space.name}! Gostaria de fazer um pedido.\n\n${items.map((p) => cart[p.id] + " × " + p.name + " — " + money(p.price * cart[p.id])).join("\n")}\n\nSubtotal: ${money(total)}\nNome: ${name}\nObservações: ${notes || "Nenhuma"}\nAguardo confirmação da disponibilidade, entrega e valor final.`;
                    Alert.alert("Rever pedido", message, [
                      { text: "Voltar", style: "cancel" },
                      {
                        text:
                          menu.space.slug === "demo"
                            ? "Pré-visualizar"
                            : "Abrir WhatsApp",
                        onPress: () => send(message),
                      },
                    ]);
                  }}
                />
                <Text style={s.muted}>
                  O cliente envia a mensagem. O restaurante confirma
                  disponibilidade e valor final.
                </Text>
              </>
            ) : null}
          </Card>
        </>
      )}
    </>
  );
}
function Scanner({ onRead, onCancel }) {
  const [permission, requestPermission] = useCameraPermissions(),
    [locked, setLocked] = useState(false);
  if (!permission?.granted)
    return (
      <Card>
        <Text style={s.subtitle}>Ler o QR do menu</Text>
        <Text style={s.paragraph}>
          A câmara é usada apenas para ler o QR Code.
        </Text>
        <Button title="Permitir câmara" onPress={requestPermission} />
        <Button title="Voltar" secondary onPress={onCancel} />
      </Card>
    );
  return (
    <>
      <CameraView
        style={s.camera}
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={
          locked
            ? undefined
            : (e) => {
                try {
                  const u = new URL(e.data);
                  if (
                    u.protocol !== "https:" ||
                    u.hostname !== "menuao.online" ||
                    !/^\/m\/[a-z0-9-]+$/.test(u.pathname)
                  )
                    throw Error();
                  setLocked(true);
                  onRead(u.pathname.slice(3));
                } catch {
                  setLocked(true);
                  Alert.alert("QR inválido", "Lê um QR Code do Menu Online.", [
                    {
                      text: "Tentar novamente",
                      onPress: () => setLocked(false),
                    },
                  ]);
                }
              }
        }
      />
      <Button title="Cancelar leitura" secondary onPress={onCancel} />
    </>
  );
}
function Owner({ user, token, refresh, onError }) {
  const [selected, setSelected] = useState(user.spaces[0]?.id),
    [products, setProducts] = useState([]),
    [editing, setEditing] = useState(null),
    [image, setImage] = useState(""),
    [draft, setDraft] = useState(null),
    [busy, setBusy] = useState(false);
  const space = user.spaces.find((x) => x.id === selected);
  async function load() {
    if (selected)
      setProducts(
        (await api("/spaces/" + selected + "/products", token)).products,
      );
  }
  useEffect(() => {
    let alive = true;
    if (selected)
      api("/spaces/" + selected + "/products", token)
        .then((d) => {
          if (alive) setProducts(d.products);
        })
        .catch(onError);
    return () => {
      alive = false;
    };
  }, [selected, token]);
  const change = (key, value) => setEditing((d) => ({ ...d, [key]: value }));
  async function choosePhoto() {
    try {
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.8,
      });
      if (r.canceled) return;
      const asset = r.assets[0];
      if (!asset.fileSize || asset.fileSize > 1048576)
        return Alert.alert("Escolhe uma fotografia de até 1 MB.");
      setBusy(true);
      const form = new FormData();
      form.append("image", {
        uri: asset.uri,
        name: asset.fileName || "photo.jpg",
        type: asset.mimeType || "image/jpeg",
      });
      const response = await fetch(API + "/api/uploads", {
        method: "POST",
        credentials: "omit",
        headers: { Authorization: "Bearer " + token },
        body: form,
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      setImage(data.url);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Text style={s.title}>O teu negócio.</Text>
      <Card>
        <Text style={s.subtitle}>
          {user.plans[user.subscription.plan].name}
        </Text>
        <Text style={s.paragraph}>
          {money(user.plans[user.subscription.plan].price)}/mês · Até{" "}
          {user.plans[user.subscription.plan].spaces} espaços
        </Text>
        <Text style={s.muted}>
          Assinatura: {user.subscription.status} ·{" "}
          {user.subscription.ends_at
            ? new Date(user.subscription.ends_at).toLocaleDateString("pt-AO")
            : "Por ativar"}
        </Text>
        <Button
          title="Contactar a Muds"
          secondary
          onPress={() => Linking.openURL(CONTACT)}
        />
      </Card>
      <ScrollView horizontal contentContainerStyle={s.tabs}>
        {user.spaces.map((x) => (
          <Button
            key={x.id}
            title={x.name}
            secondary={selected !== x.id}
            onPress={() => {
              setSelected(x.id);
              setEditing(null);
              setDraft(null);
            }}
          />
        ))}
      </ScrollView>
      <Button
        title="+ Novo estabelecimento"
        disabled={
          user.spaces.length >= user.plans[user.subscription.plan].spaces
        }
        onPress={() =>
          setDraft({
            name: "",
            slug: "",
            whatsapp: "244",
            description: "",
            province: "",
            municipality: "",
            neighborhood: "",
            address: "",
            hours: "",
            published: true,
          })
        }
      />
      {draft ? (
        <Card>
          <Text style={s.subtitle}>Informações do espaço</Text>
          {[
            ["name", "Nome"],
            ["slug", "Endereço do menu"],
            ["whatsapp", "WhatsApp (244 + 9 dígitos)"],
            ["description", "Descrição"],
            ["address", "Morada"],
            ["neighborhood", "Bairro"],
            ["hours", "Horário"],
          ].map(([key, label]) => (
            <Input
              key={key}
              label={label}
              value={draft[key]}
              onChangeText={(v) => setDraft((d) => ({ ...d, [key]: v }))}
              maxLength={key === "description" ? 1000 : 100}
            />
          ))}
          <Text style={s.paragraph}>
            Província: {draft.province || "Seleciona"}
          </Text>
          <ScrollView horizontal>
            {Object.keys(zones).map((p) => (
              <Button
                key={p}
                title={p}
                secondary={draft.province !== p}
                onPress={() =>
                  setDraft((d) => ({ ...d, province: p, municipality: "" }))
                }
              />
            ))}
          </ScrollView>
          <Text style={s.paragraph}>
            Município: {draft.municipality || "Seleciona"}
          </Text>
          <ScrollView horizontal>
            {(zones[draft.province] || []).map((m) => (
              <Button
                key={m}
                title={m}
                secondary={draft.municipality !== m}
                onPress={() => setDraft((d) => ({ ...d, municipality: m }))}
              />
            ))}
          </ScrollView>
          <Button
            title="Guardar e solicitar publicação"
            disabled={busy}
            onPress={async () => {
              setBusy(true);
              try {
                await api("/space", token, "PUT", {
                  ...draft,
                  published: true,
                });
                setDraft(null);
                await refresh();
              } catch (e) {
                onError(e);
              } finally {
                setBusy(false);
              }
            }}
          />
          <Button title="Cancelar" secondary onPress={() => setDraft(null)} />
        </Card>
      ) : null}
      {space ? (
        <>
          <Card>
            <Text style={s.subtitle}>{space.name}</Text>
            <Text style={s.paragraph}>Aprovação: {space.approval}</Text>
            {space.review_note ? (
              <Text style={s.paragraph}>{space.review_note}</Text>
            ) : null}
            <Button
              title="Editar estabelecimento"
              secondary
              onPress={() => setDraft({ ...space })}
            />
            <Button
              title="Ver menu público"
              secondary
              onPress={() => Linking.openURL(API + "/m/" + space.slug)}
            />
            {space.approval === "approved" &&
            user.subscription.status === "active" &&
            user.subscription.ends_at > Date.now() &&
            space.published ? (
              <Image
                style={s.qr}
                source={{ uri: API + "/api/qr/" + space.slug }}
                accessibilityLabel="QR Code do estabelecimento"
              />
            ) : null}
          </Card>
          <Button
            title="+ Adicionar produto"
            onPress={() => {
              setEditing({
                name: "",
                category: "Menu",
                description: "",
                price: "",
                available: true,
              });
              setImage("");
            }}
          />
          {editing ? (
            <Card>
              <Text style={s.subtitle}>Produto</Text>
              <Input
                label="Nome"
                value={editing.name}
                onChangeText={(v) => change("name", v)}
                maxLength={100}
              />
              <Input
                label="Categoria"
                value={editing.category}
                onChangeText={(v) => change("category", v)}
                maxLength={80}
              />
              <Input
                label="Descrição"
                value={editing.description}
                onChangeText={(v) => change("description", v)}
                maxLength={500}
                multiline
              />
              <Input
                label="Preço em Kz"
                keyboardType="number-pad"
                value={String(editing.price)}
                onChangeText={(v) => change("price", v)}
                maxLength={8}
              />
              <Button
                title={
                  editing.available ? "Disponível ✓" : "Marcar como disponível"
                }
                secondary
                onPress={() => change("available", !editing.available)}
              />
              <Button
                title="Escolher fotografia (até 1 MB)"
                secondary
                disabled={busy}
                onPress={choosePhoto}
              />
              {image ? (
                <Image
                  style={s.photo}
                  source={{
                    uri: API + image,
                    headers: { Authorization: "Bearer " + token },
                  }}
                />
              ) : null}
              <Text style={s.muted}>
                As imagens aguardam aprovação da Muds.
              </Text>
              <Button
                title="Guardar produto"
                disabled={busy}
                onPress={async () => {
                  setBusy(true);
                  try {
                    await api("/products", token, "POST", {
                      ...editing,
                      price: Number(editing.price),
                      spaceId: selected,
                      image,
                    });
                    setEditing(null);
                    await load();
                  } catch (e) {
                    onError(e);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
              <Button
                title="Cancelar"
                secondary
                onPress={() => setEditing(null)}
              />
            </Card>
          ) : null}
          {products.map((p) => (
            <Card key={p.id}>
              <Text style={s.subtitle}>{p.name}</Text>
              <Text style={s.paragraph}>
                {money(p.price)} · {p.available ? "Disponível" : "Esgotado"}
              </Text>
              <Button
                title="Editar produto"
                secondary
                onPress={() => {
                  setEditing({ ...p });
                  setImage(p.image);
                }}
              />
              <Button
                title="Eliminar produto"
                secondary
                onPress={() =>
                  Alert.alert("Eliminar produto?", p.name, [
                    { text: "Cancelar", style: "cancel" },
                    {
                      text: "Eliminar",
                      style: "destructive",
                      onPress: async () => {
                        try {
                          await api("/products/" + p.id, token, "DELETE");
                          await load();
                        } catch (e) {
                          onError(e);
                        }
                      },
                    },
                  ])
                }
              />
            </Card>
          ))}
        </>
      ) : null}
      <Button
        title="Gestão completa no site"
        secondary
        onPress={() => Linking.openURL(API + "/painel")}
      />
    </>
  );
}
function Staff({ user, token, onError }) {
  const [data, setData] = useState(null),
    [password, setPassword] = useState("");
  const can = (p) => user.role === "admin" || user.permissions.includes(p);
  async function refresh() {
    setData(await api("/admin/overview", token));
  }
  useEffect(() => {
    refresh().catch(onError);
  }, [token]);
  async function update(route, body) {
    try {
      await api(route, token, "PUT", {
        ...body,
        confirmationPassword: password,
      });
      setPassword("");
      await refresh();
    } catch (e) {
      onError(e);
    }
  }
  return (
    <>
      <Text style={s.title}>Gestão Muds.</Text>
      <Text style={s.paragraph}>
        {user.name} · {user.role === "admin" ? "Administrador" : "Gestor"}
      </Text>
      <Input
        label="Palavra-passe para confirmar operações"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        maxLength={128}
      />
      {!data ? (
        <ActivityIndicator color="#12392d" />
      ) : (
        <>
          {can("spaces.review")
            ? data.spaces.map((space) => (
                <Card key={space.id}>
                  <Text style={s.subtitle}>{space.name}</Text>
                  <Text style={s.paragraph}>
                    {space.email} · {space.whatsapp}
                  </Text>
                  <Text style={s.paragraph}>
                    {space.address} · {space.approval}
                  </Text>
                  <Button
                    title="Aprovar estabelecimento"
                    disabled={!password}
                    onPress={() =>
                      update("/admin/spaces/" + space.id, {
                        approval: "approved",
                      })
                    }
                  />
                  <Button
                    title="Rejeitar"
                    secondary
                    disabled={!password}
                    onPress={() =>
                      update("/admin/spaces/" + space.id, {
                        approval: "rejected",
                      })
                    }
                  />
                </Card>
              ))
            : null}
          {can("media.review")
            ? data.media
                .filter((m) => m.status === "pending")
                .map((m) => (
                  <Card key={m.url}>
                    <Image
                      style={s.photo}
                      source={{
                        uri: API + m.url,
                        headers: { Authorization: "Bearer " + token },
                      }}
                    />
                    <Text style={s.paragraph}>{m.email}</Text>
                    <Button
                      title="Aprovar imagem"
                      disabled={!password}
                      onPress={() =>
                        update("/admin/media", {
                          url: m.url,
                          status: "approved",
                        })
                      }
                    />
                    <Button
                      title="Rejeitar imagem"
                      secondary
                      disabled={!password}
                      onPress={() =>
                        update("/admin/media", {
                          url: m.url,
                          status: "rejected",
                        })
                      }
                    />
                  </Card>
                ))
            : null}
        </>
      )}
      <Button
        title="Assinaturas, utilizadores e auditoria no site"
        secondary
        onPress={() => Linking.openURL(API + "/gestao")}
      />
    </>
  );
}
function AppContent() {
  const [tab, setTab] = useState("menus"),
    [slug, setSlug] = useState(""),
    [menu, setMenu] = useState(null),
    [scanner, setScanner] = useState(false),
    [token, setToken] = useState(null),
    [user, setUser] = useState(null),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [code, setCode] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  function onError(e) {
    setError(e.message || String(e));
  }
  async function refresh(t = token) {
    const u = await api("/me", t);
    setUser(u);
  }
  useEffect(() => {
    let alive = true;
    SecureStore.getItemAsync("menu-session").then(async (t) => {
      if (!t) return;
      try {
        const u = await api("/me", t);
        if (alive) {
          setToken(t);
          setUser(u);
        }
      } catch {
        await SecureStore.deleteItemAsync("menu-session");
      }
    });
    return () => {
      alive = false;
    };
  }, []);
  async function open(slug) {
    setBusy(true);
    setError("");
    try {
      setMenu(await api("/menu/" + encodeURIComponent(slug)));
      setScanner(false);
    } catch (e) {
      onError(e);
      setScanner(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <SafeAreaView style={s.safe}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={s.header}>
          <Text style={s.wordmark}>
            menu<Text style={s.light}>online</Text>
            <Text style={s.ao}> AO</Text>
          </Text>
          <Text style={s.muted}>POR MUDS</Text>
        </View>
        <View style={s.nav}>
          <Button
            title="Menus"
            secondary={tab !== "menus"}
            onPress={() => {
              setTab("menus");
              setError("");
            }}
          />
          <Button
            title="A minha conta"
            secondary={tab !== "account"}
            onPress={() => {
              setTab("account");
              setError("");
            }}
          />
        </View>
        <ScrollView
          style={s.flex}
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
        >
          {error ? (
            <Text accessibilityRole="alert" style={s.error}>
              {error}
            </Text>
          ) : null}
          {busy ? <ActivityIndicator color="#12392d" /> : null}
          {tab === "menus" ? (
            menu ? (
              <Menu menu={menu} onBack={() => setMenu(null)} />
            ) : scanner ? (
              <Scanner onRead={open} onCancel={() => setScanner(false)} />
            ) : (
              <>
                <Text style={s.title}>
                  O teu menu.<Text style={s.limeText}> Sempre à mão.</Text>
                </Text>
                <Text style={s.paragraph}>
                  Descobre o menu, escolhe os teus favoritos e pede pelo
                  WhatsApp.
                </Text>
                <Button title="Ler QR Code" onPress={() => setScanner(true)} />
                <Card>
                  <Input
                    label="Endereço do restaurante (ex.: sabor-luanda)"
                    autoCapitalize="none"
                    autoCorrect={false}
                    value={slug}
                    onChangeText={setSlug}
                    maxLength={60}
                  />
                  <Button
                    title="Abrir menu"
                    disabled={busy || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)}
                    onPress={() => open(slug)}
                  />
                </Card>
                <Button
                  title="Explorar demonstração"
                  secondary
                  onPress={() => setMenu(sample)}
                />
              </>
            )
          ) : user ? (
            <>
              {user.role === "owner" ? (
                <Owner
                  user={user}
                  token={token}
                  refresh={refresh}
                  onError={onError}
                />
              ) : user.mfa_enabled ? (
                <Staff user={user} token={token} onError={onError} />
              ) : (
                <Card>
                  <Text style={s.subtitle}>
                    Ativa a verificação em dois passos
                  </Text>
                  <Text style={s.paragraph}>
                    Conclui a configuração inicial no site e volta a entrar na
                    aplicação.
                  </Text>
                  <Button
                    title="Configurar segurança"
                    onPress={() => Linking.openURL(API + "/gestao")}
                  />
                </Card>
              )}
              <Button
                title="Sair da conta"
                secondary
                onPress={async () => {
                  try {
                    await api("/logout", token, "POST", {});
                  } finally {
                    await SecureStore.deleteItemAsync("menu-session");
                    setToken(null);
                    setUser(null);
                    setPassword("");
                  }
                }}
              />
            </>
          ) : (
            <Card>
              <Text style={s.title}>Bom ver-te de volta.</Text>
              <Input
                label="Email"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                value={email}
                onChangeText={setEmail}
                maxLength={254}
              />
              <Input
                label="Palavra-passe"
                secureTextEntry
                autoComplete="current-password"
                value={password}
                onChangeText={setPassword}
                maxLength={128}
              />
              <Input
                label="Código de autenticação (equipa Muds)"
                value={code}
                onChangeText={setCode}
                maxLength={32}
                autoCapitalize="none"
                autoComplete="one-time-code"
              />
              <Button
                title="Entrar"
                disabled={busy}
                onPress={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const result = await api("/mobile/login", null, "POST", {
                      email,
                      password,
                      code,
                    });
                    if (result.mustChangePassword) {
                      setError(
                        "Substitui a senha provisória no site antes de entrar na aplicação.",
                      );
                      await Linking.openURL(API + "/entrar");
                      return;
                    }
                    await SecureStore.setItemAsync(
                      "menu-session",
                      result.token,
                      {
                        keychainAccessible:
                          SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
                      },
                    );
                    setToken(result.token);
                    setPassword("");
                    setCode("");
                    await refresh(result.token);
                  } catch (e) {
                    onError(e);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
              <Button
                title="Esqueci minha senha"
                secondary
                onPress={() => Linking.openURL(API + "/esqueci-senha")}
              />
              <Button
                title="Criar conta no site"
                secondary
                onPress={() => Linking.openURL(API + "/criar-conta")}
              />
            </Card>
          )}
          <View style={s.footer}>
            <Text style={s.muted}>Desenvolvido e gerido pela equipa Muds.</Text>
            <Button
              title="Contactar a Muds"
              secondary
              onPress={() => Linking.openURL(CONTACT)}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}
const s = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: "#f6f8f3" },
  header: {
    padding: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  wordmark: { fontSize: 27, fontWeight: "800", color: "#12392d" },
  light: { fontWeight: "400" },
  ao: { fontSize: 11 },
  nav: { flexDirection: "row", gap: 12, paddingHorizontal: 20 },
  content: { padding: 20, paddingBottom: 60 },
  title: {
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: -1.3,
    color: "#12392d",
    marginVertical: 16,
  },
  limeText: { color: "#52730a" },
  subtitle: {
    fontSize: 21,
    fontWeight: "700",
    color: "#12392d",
    marginBottom: 10,
  },
  paragraph: {
    fontSize: 16,
    lineHeight: 24,
    color: "#34574a",
    marginBottom: 12,
  },
  muted: { fontSize: 13, lineHeight: 20, color: "#60756b" },
  card: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#dbe4da",
    borderRadius: 18,
    padding: 20,
    marginVertical: 12,
  },
  button: {
    backgroundColor: "#12392d",
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    marginVertical: 6,
  },
  secondary: { backgroundColor: "#e9f0df" },
  buttonText: { fontSize: 15, fontWeight: "700", color: "#d9f86f" },
  secondaryText: { color: "#12392d" },
  disabled: { opacity: 0.45 },
  inputGroup: { marginVertical: 8 },
  label: { fontSize: 14, color: "#12392d", fontWeight: "600", marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: "#c9d6ca",
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    color: "#12392d",
    backgroundColor: "#fff",
  },
  photo: {
    height: 210,
    width: "100%",
    resizeMode: "contain",
    borderRadius: 12,
    marginBottom: 12,
  },
  qr: { width: 200, height: 200, alignSelf: "center", marginTop: 16 },
  price: {
    fontWeight: "800",
    fontSize: 22,
    color: "#12392d",
    marginVertical: 10,
  },
  tabs: { gap: 10, paddingVertical: 8 },
  camera: { height: 360, borderRadius: 16 },
  error: {
    color: "#a02722",
    backgroundColor: "#fcece7",
    padding: 14,
    borderRadius: 10,
    marginVertical: 8,
  },
  footer: { paddingTop: 36, gap: 8 },
});
