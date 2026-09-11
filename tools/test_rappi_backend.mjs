// Ejecuta las pruebas Deno de supabase/functions/_shared/rappi con Node, para
// poder correrlas en una PC sin Deno instalado. Node 23.6+ entiende TypeScript;
// se usa --experimental-transform-types porque errores.ts declara propiedades
// en el constructor, algo que el modo "solo quitar tipos" no admite.
import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const self = fileURLToPath(import.meta.url);
if (!process.execArgv.includes("--experimental-transform-types")) {
  const child = spawnSync(process.execPath, ["--experimental-transform-types", "--no-warnings", self], { stdio: "inherit" });
  process.exit(child.status ?? 1);
}

const dir = path.resolve(path.dirname(self), "../supabase/functions/_shared/rappi");
const tests = [];
globalThis.Deno = {
  test: (name, fn) => tests.push({ name, fn }),
  env: { get: () => undefined },
};

const files = (await readdir(dir)).filter((file) => file.endsWith("_test.ts")).sort();
for (const file of files) await import(pathToFileURL(path.join(dir, file)).href);

let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FALLA ${name}\n      ${error?.message ?? error}`);
  }
}
console.log(`\n${tests.length - failed} de ${tests.length} pruebas Rappi OK (${files.length} archivos).`);
process.exit(failed ? 1 : 0);
