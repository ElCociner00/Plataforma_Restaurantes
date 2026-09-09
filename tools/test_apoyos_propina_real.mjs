import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Fija el bug reportado por el cliente: al confirmar apoyos, la propina real
// del turno (la que trajo "Consultar Loggro") se pisaba con el total que la
// consulta de apoyos alcanzaba a repartir -que es SOLO la propina que cayó
// en el horario de alguien registrado-, sin avisar que una parte se perdía.
// Si tocas apoyos.js o la Edge Function, corre este archivo.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apoyos = await readFile(path.join(root, "js/apoyos.js"), "utf8");
const edge = await readFile(path.join(root, "supabase/functions/consultar-propina-apoyos/index.ts"), "utf8");
const visual = await readFile(path.join(root, "js/cierre_turno_propinas_visual.js"), "utf8");
const ventas = await readFile(path.join(root, "supabase/functions/consultar-ventas/index.ts"), "utf8");
const simulador = await readFile(path.join(root, "js/simulador_propinas.js"), "utf8");
const failures = [];

// ── La ventana de consulta a Loggro tiene que ser la MISMA en las dos
// Edge Functions. Esta era la causa real, más de fondo que las huérfanas:
// consultar-ventas (el total que ve el usuario primero) consulta hasta el
// fin del día; consultar-propina-apoyos cortaba en hora_fin del turno. Dos
// ventanas de tiempo distintas nunca iban a dar el mismo total, sin importar
// quién estuviera presente. ──────────────────────────────────────────────

assert(
  ventas.includes("const hasta = finDelDia(fecha)"),
  "consultar-ventas cambió su límite de consulta; revisa que siga igual antes de comparar",
);
assert(
  edge.includes("finResponsable = Math.max(finResponsable, finDelDia(fecha).getTime())"),
  "consultar-propina-apoyos ya no extiende al responsable hasta el fin del día: volverá a dar un total distinto al de consultar-ventas",
);
assert(
  edge.includes('import { esFechaValida, finDelDia, instanteLocal } from "../_shared/fechas.ts"'),
  "consultar-propina-apoyos dejó de importar finDelDia",
);
assert(
  simulador.includes("finDelDiaIso") && between(simulador, "const personas = [{", "}];").includes("finDia"),
  "el simulador ya no extiende al responsable hasta el fin del día: su recálculo local divergirá de la Edge Function",
);

// ── js/apoyos.js: la propina real nunca se pisa en silencio ────────────────

const applyBlock = between(apoyos, "const applyDistribucion", "btnConsultarPropina.addEventListener");

assert(
  !applyBlock.includes("asInt(totalDia || totalDistribuida || propinaInput.value || responsableTip)"),
  "applyDistribucion volvió a la formula vieja: totalDia manda sobre la propina real",
);
assert(
  /const propinaRealPrevia\s*=\s*asInt\(propinaInput\.value\)/.test(applyBlock),
  "applyDistribucion ya no guarda la propina real antes de tocar el campo",
);
assert(
  /const totalTurno\s*=\s*propinaRealPrevia\s*\|\|/.test(applyBlock),
  "la propina real (si ya había una) dejó de tener prioridad sobre el total de la Edge Function",
);

// Un hueco de cobertura (propina sin nadie presente) tiene que verse, no
// quedarse silencioso dentro de un total que ya no cuadra.
assert(
  applyBlock.includes("totalHuerfano") && applyBlock.includes("huerfano > 0"),
  "applyDistribucion ya no detecta ni avisa cuando queda propina sin repartir",
);
assert(
  /setStatus\(\s*\n?\s*`⚠/.test(applyBlock) || applyBlock.includes('"⚠'),
  "el aviso de propina sin repartir dejó de ser visible en el status",
);

const totalsBlock = between(apoyos, "const extractWebhookTotals", "const rebalanceIfExceedsTotal");
assert(
  totalsBlock.includes("row?.total_recibido") && totalsBlock.includes("row?.total_huerfano"),
  "extractWebhookTotals ya no lee total_recibido/total_huerfano de la Edge Function",
);

// ── Edge Function: las propinas huérfanas se cuentan y se ven, no desaparecen ──

assert(
  !edge.includes("if (activas.length === 0) continue;"),
  "la Edge Function volvió a descartar en silencio las propinas sin nadie presente",
);
assert(
  edge.includes("totalHuerfano += propina") && edge.includes("huerfana: true"),
  "la Edge Function ya no distingue ni suma las propinas huérfanas",
);
assert(
  edge.includes("total_recibido:") && edge.includes("total_huerfano:"),
  "la respuesta de la Edge Function ya no informa total_recibido/total_huerfano",
);
// Contrato viejo intacto: nada de lo que ya consumía el frontend debe
// desaparecer solo porque se agregó lo nuevo.
assert(
  edge.includes("total_propina_dia:") && edge.includes("total_propina_distribuida:") && edge.includes("coinciden_totales:"),
  "se rompió el contrato de salida existente al agregar los campos nuevos",
);

// ── Visual: el "cuadre" deja de dar bien cuando hay un hueco ────────────────

const cuadreBlock = between(visual, "const pintarCuadre", "export function limpiarRepartoPropinas");
assert(
  cuadreBlock.includes("total_huerfano") && cuadreBlock.includes("huerfano < 0.01"),
  "pintarCuadre ya no exige que no haya propina sin repartir para decir que 'cuadra'",
);

const propinaAPropinaBlock = between(visual, "const pintarPropinaAPropina", "const pintarPorPersona");
assert(
  propinaAPropinaBlock.includes("Sin nadie presente") && propinaAPropinaBlock.includes("No se repartió"),
  "la tabla propina a propina ya no distingue las huérfanas de un reparto real",
);

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log(
  "Propina real OK: no se pisa al confirmar apoyos, y las huérfanas se ven en vez de perderse.",
);

function between(value, start, end) {
  const startIndex = value.indexOf(start);
  const endIndex = value.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) return "";
  return value.slice(startIndex, endIndex);
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}
