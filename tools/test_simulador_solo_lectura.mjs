/**
 * Fija la garantia que hace seguro al simulador: NUNCA escribe sobre un turno.
 *
 * Es una pizarra para demostrarle el reparto al cliente. Si alguna vez pudiera
 * guardar, una demostracion delante del cliente podria alterar un turno cerrado
 * sin que nadie se diera cuenta. Lo unico que puede escribir es archivar la
 * evidencia de propinas que trae de Loggro, que solo anade.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fuente = await readFile(path.join(raiz, "js/simulador_propinas.js"), "utf8");
const html = await readFile(path.join(raiz, "cierre_turno/simulador_propinas.html"), "utf8");
const fallos = [];
const assert = (cond, msg) => { if (!cond) fallos.push(msg); };

// Los RPC permitidos. Cualquier otro seria una escritura inesperada.
const rpcs = [...fuente.matchAll(/\.rpc\(\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
// app_empresas_visibles() es de solo lectura (SETOF uuid, sin efectos
// secundarios): acota el selector de sede a lo que el usuario puede tocar,
// nunca escribe nada.
const permitidos = new Set(["guardar_propinas_turno", "app_es_local", "app_empresas_visibles"]);
rpcs.forEach((nombre) => {
  assert(permitidos.has(nombre), `El simulador llama a un RPC no permitido: ${nombre}`);
});

// Escrituras directas de PostgREST: ninguna.
["insert(", "update(", "upsert(", "delete("].forEach((metodo) => {
  assert(!fuente.includes(`.${metodo}`), `El simulador usa .${metodo} y no deberia escribir nada`);
});

// Las Edge Functions que puede invocar: solo la de consulta.
const invocadas = [...fuente.matchAll(/functions\.invoke\(\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
invocadas.forEach((nombre) => {
  assert(nombre === "consultar-propina-apoyos", `El simulador invoca una funcion inesperada: ${nombre}`);
});

// El reparto sale del modulo unico, no de una copia hecha aqui.
assert(
  fuente.includes('from "./propinas_reparto.js'),
  "El simulador ya no usa js/propinas_reparto.js: podria repartir distinto que produccion",
);
assert(
  !/porPersona\s*=/.test(fuente),
  "El simulador parece calcular el reparto por su cuenta en vez de usar el modulo unico",
);

// La pantalla tiene que decir que no toca el turno.
assert(
  /no toca el turno guardado|no toca el cierre|es una simulaci/i.test(html),
  "La pagina ya no le advierte al usuario que es una simulacion",
);
assert(html.includes('id="btnRestaurar"'), "Falta el boton para volver al reparto real");

if (fallos.length) {
  console.error("FALLOS:");
  fallos.forEach((f) => console.error("  -", f));
  process.exit(1);
}
console.log(`Simulador OK: solo lectura (RPC permitidos: ${rpcs.join(", ") || "ninguno"}).`);
