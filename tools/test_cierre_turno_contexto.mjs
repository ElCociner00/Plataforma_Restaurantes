import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(root, "js/cierre_turno.js"), "utf8");
const html = await readFile(path.join(root, "cierre_turno/index.html"), "utf8");
const failures = [];

const contextBlock = between(source, "const getContextPayload", "const cargarNombreEmpresa");
assert(contextBlock.includes("empresa_principal_id:"), "El payload pierde la empresa principal");
assert(contextBlock.includes("local_context:"), "El payload pierde el indicador de sede local");

const previousCashBlock = between(
  source,
  "const cargarEfectivoAperturaEsperado",
  "const syncEfectivoRealFromCajaBolsa",
);
assert(
  previousCashBlock.includes("p_empresa_id: contextPayload.empresa_id"),
  "La caja anterior no se consulta para la sede activa",
);

const submitStateBlock = between(
  source,
  "const obtenerEstadoGlobalDiferencias",
  "const construirPayloadEnvio",
);
assert(
  !submitStateBlock.includes("efectivoAperturaDiferencia"),
  "La diferencia de apertura está bloqueando el envío",
);
assert(
  source.includes("no bloquea el cierre"),
  "El formulario no aclara que la observación permite continuar",
);
assert(
  source.includes("Boolean(data?.es_local) !== Boolean(esperabaLocal)"),
  "Falta la guarda que confirma el destino local del cierre",
);
assert(
  html.includes("../js/cierre_turno.js?v=20260908viva1"),
  "El HTML no fuerza la carga del hotfix de Viva",
);

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log(
  "Cierre de turno OK: caja anterior por sede y diferencias no bloqueantes.",
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
