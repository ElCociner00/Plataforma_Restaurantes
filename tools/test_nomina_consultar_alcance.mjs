import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Fija un hueco de autorización real, confirmado en vivo: resolverContexto()
// valida data.empresa_id/tenant_id (un solo id) para decidir empresaId/esLocal,
// pero nomina-consultar arma por su cuenta un ARRAY aparte -tenant_ids- tal
// cual llega del cuerpo, y lo usaba sin comprobar nada contra lo que esa
// cuenta puede ver. Cualquiera con sesión válida podía pedir la nómina de
// cualquier otra empresa con solo conocer su id.
// Si tocas supabase/functions/nomina-consultar/index.ts, corre este archivo.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fuente = await readFile(path.join(root, "supabase/functions/nomina-consultar/index.ts"), "utf8");
const failures = [];

assert(
  fuente.includes("const tenantIdsSolicitados ="),
  "nomina-consultar ya no separa lo que pide el cliente de lo que de verdad se usa",
);
assert(
  /const tenantIds = ctx\.esSuperadmin\s*\n\s*\?\s*tenantIdsSolicitados\s*\n\s*:\s*tenantIdsSolicitados\.filter\(\(id: string\) => ctx\.empresasVisibles\.includes\(id\)\)/.test(fuente),
  "tenant_ids ya no se filtra contra ctx.empresasVisibles: vuelve a poder pedirse la nómina de cualquier empresa",
);
assert(
  fuente.includes("if (!tenantIds.length) throw errores.fueraDeAlcance();"),
  "nomina-consultar ya no corta la petición cuando ningún tenant_id pedido está al alcance de la cuenta",
);

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log("nomina-consultar OK: tenant_ids se acota a lo que la cuenta puede ver.");

function assert(condition, message) {
  if (!condition) failures.push(message);
}
