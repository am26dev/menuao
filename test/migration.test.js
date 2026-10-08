import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { scryptSync, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
test("Upgrade preserves legacy account, menu and products and supports a second space", async () => {
  const root = path.resolve("test-data");
  mkdirSync(root, { recursive: true });
  const data = mkdtempSync(path.join(root, "migration-")),
    db = new DatabaseSync(path.join(data, "menu.sqlite")),
    token = "b".repeat(64),
    salt = "legacy-salt";
  db.exec(
    `CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,salt TEXT NOT NULL);CREATE TABLE spaces(id INTEGER PRIMARY KEY,owner INTEGER UNIQUE REFERENCES users(id),slug TEXT UNIQUE,name TEXT,whatsapp TEXT,description TEXT,address TEXT,hours TEXT,published INTEGER DEFAULT 0);CREATE TABLE products(id INTEGER PRIMARY KEY,space INTEGER REFERENCES spaces(id),name TEXT,category TEXT,description TEXT,price INTEGER,image TEXT,available INTEGER DEFAULT 1);CREATE TABLE sessions(token TEXT PRIMARY KEY,user INTEGER REFERENCES users(id),expires INTEGER);`,
  );
  db.prepare("INSERT INTO users VALUES(1,?,?,?)").run(
    "legacy@example.test",
    scryptSync("legacy-password-2026", salt, 64).toString("hex"),
    salt,
  );
  db.prepare("INSERT INTO spaces VALUES(7,1,?,?,?,?,?,?,1)").run(
    "legacy-menu",
    "Espaço existente",
    "244923456789",
    "Descrição",
    "Luanda",
    "12–22",
  );
  db.prepare("INSERT INTO products VALUES(9,7,?,?,?,?,?,1)").run(
    "Prato existente",
    "Pratos",
    "Receita",
    7500,
    "",
  );
  db.prepare("INSERT INTO sessions VALUES(?,1,?)").run(
    createHash("sha256").update(token).digest("hex"),
    Date.now() + 60000,
  );
  db.close();
  const server = spawn(
    process.execPath,
    ["--input-type=commonjs", "-e", "require('./server.js')"],
    {
      env: {
        ...process.env,
        PORT: "3102",
        DATA_DIR: data,
        PUBLIC_URL: "http://127.0.0.1:3102",
        NODE_ENV: "test",
        STAFF_ADMIN_ACTIVATION: "",
        STAFF_MANAGER_ACTIVATION: "",
      },
      stdio: "pipe",
    },
  );
  let logs = "";
  server.stderr.on("data", (d) => (logs += d));
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch("http://127.0.0.1:3102/api/health")).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(ready, logs);
    const headers = {
      Cookie: "menu_session=" + token,
      Origin: "http://127.0.0.1:3102",
      "Content-Type": "application/json",
    };
    const me = await (
      await fetch("http://127.0.0.1:3102/api/me", { headers })
    ).json();
    assert.equal(me.spaces[0].id, 7);
    assert.equal(me.spaces[0].name, "Espaço existente");
    assert.equal(me.spaces[0].approval, "pending");
    const products = await (
      await fetch("http://127.0.0.1:3102/api/spaces/7/products", { headers })
    ).json();
    assert.equal(products.products[0].id, 9);
    assert.equal(products.products[0].price, 7500);
    assert.equal(
      (
        await fetch("http://127.0.0.1:3102/api/space", {
          method: "PUT",
          headers,
          body: JSON.stringify({
            name: "Segundo espaço",
            province: "Luanda",
            municipality: "Talatona",
            neighborhood: "Centro",
            slug: "segundo-legacy",
            whatsapp: "244923456789",
          }),
        })
      ).status,
      200,
    );
    const after = await (
      await fetch("http://127.0.0.1:3102/api/me", { headers })
    ).json();
    assert.equal(after.spaces.length, 2);
    const check = new DatabaseSync(path.join(data, "menu.sqlite"));
    assert.deepEqual(check.prepare("PRAGMA foreign_key_check").all(), []);
    check.close();
  } finally {
    server.kill();
    await new Promise((r) => server.once("exit", r));
    assert.ok(data.startsWith(root + path.sep));
    rmSync(data, { recursive: true, force: true });
  }
});
