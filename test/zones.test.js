import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("Angola territory catalog has all 21 provinces and 326 distinct municipality relationships", () => {
  const zones = JSON.parse(
    readFileSync(new URL("../public/zones.json", import.meta.url)),
  );
  assert.equal(Object.keys(zones).length, 21);
  assert.equal(Object.values(zones).flat().length, 326);
  for (const names of Object.values(zones)) {
    assert.equal(new Set(names).size, names.length);
    assert.ok(names.every((x) => typeof x === "string" && x.length > 1));
  }
  assert.ok(zones.Luanda.includes("Talatona"));
  assert.ok(zones["Icolo e Bengo"].includes("Catete"));
  assert.deepEqual(
    zones,
    JSON.parse(readFileSync(new URL("../mobile/zones.json", import.meta.url))),
  );
});
