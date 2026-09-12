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
  previousCashBlock.includes('.eq("empresa_id", contextPayload.empresa_id)'),
  "La caja anterior no queda filtrada por la sede activa",
);
// La tabla ya no se escribe a mano en el bloque: la elige `tablaSegunSede` a
// partir de la sede que resolvio `app_es_local()`. Se comprueba el mecanismo y
// que el mapa de tablas siga incluyendo la de sedes.
assert(
  previousCashBlock.includes("tablaSegunSede(CIERRE_TABLES, esLocal)")
    && source.includes('local: "cierres_turno_final_locales"'),
  "La caja anterior no distingue la tabla de sedes locales",
);
assert(
  source.includes('const resolverEmpresaEsLocal = async (empresaId)'),
  "La caja anterior no valida si la empresa activa es una sede local",
);
assert(
  !previousCashBlock.includes('rpc("efectivo_apertura_esperado"'),
  "La caja anterior todavia acepta el fallback ambiguo del RPC",
);
assert(
  previousCashBlock.includes("fechaAnterior") && !previousCashBlock.includes("fecha_turno.lt."),
  "La caja anterior todavía puede saltar a una fecha antigua en vez del día anterior",
);
// 2026-09-12: en un día de tres turnos, quien cerraba el turno 2 veía la caja
// del último turno de AYER rotulada como suya. Pasaba porque las dos opciones
// -turno previo de hoy y cierre de ayer- iban en un mismo OR: si el turno 1 de
// hoy aún no estaba subido, la de ayer ganaba en silencio. El turno previo del
// mismo día tiene que consultarse aparte y primero, y lo de ayer sólo puede
// aparecer marcado como respaldo.
assert(
  previousCashBlock.includes('.eq("fecha_turno", fecha.value).lt("numero_turno", numeroTurno)'),
  "El turno previo del mismo día ya no se consulta por separado",
);
assert(
  !previousCashBlock.includes("and(fecha_turno.eq."),
  "La caja anterior volvió al OR que dejaba ganar al cierre de ayer",
);
assert(
  previousCashBlock.includes("esRespaldo = numeroTurno > 1")
    && previousCashBlock.includes("NO es la caja que te entregaron"),
  "La caja de respaldo no queda advertida como tal",
);
assert(
  source.includes("if (aperturaEsRespaldo)")
    && source.includes("No se puede comparar: falta subir el turno anterior de hoy."),
  "La diferencia sigue dando veredicto sobre una caja de respaldo",
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
const buttonStateBlock = between(
  source,
  "const refreshEstadoBotonSubir",
  "const aplicarBloqueoConstancia",
);
assert(
  !buttonStateBlock.includes("solo_lectura"),
  "La lectura de plan sigue deshabilitando el boton antes de enviar",
);
assert(
  buttonStateBlock.includes("!consultaCompletada"),
  "El envío no queda disponible inmediatamente después de consultar",
);
assert(
  !between(source, 'btnEnviar.addEventListener("click"', 'btnConfirmarEnvio.addEventListener("click"').includes("solo_lectura"),
  "El boton de envio sigue bloqueado en el cliente por la politica de plan",
);
assert(
  source.includes("Boolean(data?.es_local) !== Boolean(esperabaLocal)"),
  "Falta la guarda que confirma el destino local del cierre",
);
const payloadBlock = between(
  source,
  "const construirPayloadEnvio",
  'btnEnviar.addEventListener("click"',
);
assert(
  payloadBlock.includes("esLocalContexto = await resolverEmpresaEsLocal(contextPayload.empresa_id)"),
  "El payload no resuelve el tipo real de la sede antes de guardar",
);
assert(
  payloadBlock.includes("es_local_contexto: esLocalContexto"),
  "El payload sigue infiriendo incorrectamente si la empresa es local",
);
// Lo que importa es que el HTML fuerce una carga fresca del modulo, no un token
// concreto: fijar el literal obligaba a tocar el test en cada bump legitimo del
// cachebuster, que es justo lo que hay que hacer al cambiar el JS.
assert(
  /\.\.\/js\/cierre_turno\.js\?v=[0-9a-z]+/.test(html),
  "El HTML carga cierre_turno.js sin cachebuster: los cambios no llegarian al navegador",
);
// La constancia se entrega en PDF y el modulo depende del global window.jspdf.
assert(
  html.includes("jspdf.umd.min.js"),
  "El HTML no carga jsPDF: la constancia en PDF no se podria generar",
);

// ── La constancia nunca sale sin fila confirmada ──────────────────────────
// Los tres se sostienen entre si: la firma obliga a pasar la fila, el cuerpo
// corta si no trae id, y el unico llamador pasa la fila que devolvio la
// relectura. Si alguien afloja cualquiera de los tres, esto falla.
assert(
  source.includes("const descargarResumen = (filaConfirmada, {"),
  "descargarResumen ya no exige la fila confirmada como primer argumento",
);
assert(
  source.includes('const idConfirmado = String(filaConfirmada?.id || "").trim()')
    && source.includes("if (!idConfirmado) {"),
  "descargarResumen no corta cuando la fila confirmada no trae id",
);
assert(
  source.includes("descargarResumen(filaConfirmada, { bloquearDespues: false })"),
  "el envio ya no pasa la fila releida de la base a la constancia",
);
assert(
  source.includes("const filaConfirmada = await confirmarCierreGuardado({"),
  "el envio ya no relee el cierre en la base antes de la constancia",
);

// El fallo tiene que verse, no quedarse en la linea de estado.
assert(
  source.includes("mostrarFalloEnvio(motivo)") && html.includes('id="falloEnvio"'),
  "un fallo de envio ya no muestra el aviso bloqueante",
);

// La sede va explicita al comprobar si el turno ya existe. Sin esto, el RPC
// cae a la empresa del usuario y responde por la sede equivocada: es el aviso
// "Este turno ya fue subido" que costo quince dias de turnos de VIVA.
assert(
  between(source, "turno_existente", "if (error || !data?.ok)")
    .includes("p_empresa_id: contextoTurno.empresa_id"),
  "turno_existente vuelve a consultarse sin la sede explicita",
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
