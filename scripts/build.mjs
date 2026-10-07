import { build } from "esbuild";
import { writeFile } from "node:fs/promises";
const result = await build({
  entryPoints: ["src/console.jsx"],
  bundle: true,
  minify: true,
  format: "esm",
  write: false,
  define: { "process.env.NODE_ENV": '"production"' },
});
await writeFile("public/console.js", result.outputFiles[0].contents);
console.log("React console built.");
