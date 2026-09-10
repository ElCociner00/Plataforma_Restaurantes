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

// ── La ventana de CONSULTA a Loggro tiene que ser la MISMA en las dos Edge
// Functions, y esa ventana es EL TURNO, no el día.
//
// Historia, porque el arreglo pasó por dos versiones equivocadas antes de
// esta y conviene no repetir ninguna:
//   1. consultar-propina-apoyos cortaba en hora_fin y consultar-ventas iba al
//      fin del día. Dos totales distintos para el mismo turno (el 78k → 15k).
//   2. Se igualaron... estirando LAS DOS hasta el fin del día. Con eso, un
//      turno se traía las ventas y las propinas de todos los turnos
//      posteriores de la misma fecha, y como nadie de este turno estaba
//      presente a esas horas salían todas como "sin nadie presente".
//      Reproducido en VIVA el 2026-09-09: un turno de 01:00 a 12:00 traía 43
//      facturas y 1.886.729 del día entero cuando en su ventana solo hubo 10
//      y 444.916; 68.413 de 94.429 de propina quedaban huérfanas.
//   3. La correcta: las dos se acotan al turno.
//
// Estuvo enmascarado porque Loggro solo devuelve facturas que YA EXISTEN al
// consultar, así que quien cierra al terminar su turno no ve las de después.
// El detalle fino de la ventana lo fija tools/test_ventana_turno_loggro.mjs.
//
// Lo que sigue valiendo igual: esa ventana es SOLO para la consulta. Quién
// estuvo PRESENTE sigue siendo el rango literal, con el mismo mecanismo para
// el responsable que para un apoyo. Una versión anterior extendía también la
// presencia del responsable, y eso hacía que el mismo horario escrito para
// responsable y para apoyo se comportara distinto. ─────────────────────────

assert(
  ventas.includes("rangoTurno(fecha, horaInicio, horaFin)"),
  "consultar-ventas ya no se acota al turno: vuelve a arrastrar las ventas de los turnos posteriores del mismo día",
);
assert(
  // Sin el "no usa finDelDia": el comentario del propio arreglo lo cita al
  // explicar qué se quitó. Eso lo comprueba test_ventana_turno_loggro.mjs,
  // que descarta las líneas comentadas antes de mirar.
  edge.includes("let finVentana = finResponsable;"),
  "consultar-propina-apoyos ya no se acota al turno: volverá a marcar como huérfanas las propinas de otros turnos",
);
assert(
  edge.includes("dateEnd: new Date(finConsultaLoggro).toISOString()"),
  "la consulta a Loggro ya no usa la ventana calculada",
);

// ── Red de seguridad: aunque los rangos se escriban mal, la consulta no debe
// pasarse al siguiente turno del mismo día. ────────────────────────────────

assert(
  edge.includes(".from(ctx.t.cierres)") && edge.includes('.eq("fecha_turno", fecha)'),
  "consultar-propina-apoyos ya no consulta los otros turnos del mismo día para acotar la ventana",
);
assert(
  edge.includes("siguienteTurnoInicio") && edge.includes("finVentana = Math.min(finVentana, siguienteTurnoInicio)"),
  "la consulta a Loggro ya no se acota por el inicio del siguiente turno registrado ese día",
);

// ── Filtro propio: no basta con pedirle a Loggro el rango correcto, porque
// su API no siempre lo respeta -si devuelve una factura fuera de rango, sin
// filtrar aquí se cuenta igual y aparece como huérfana de un turno al que ni
// siquiera pertenece-. Esto tiene que valer pase lo que pase con Loggro. ───

assert(
  edge.includes("if (marca < inicioVentana || marca > finConsultaLoggro) continue;"),
  "consultar-propina-apoyos ya no filtra localmente las facturas fuera de rango: si Loggro devuelve algo fuera de fecha, va a contarse igual",
);
assert(
  between(edge, "const personas: Persona[] = [{", "}];").includes("fin: finResponsable,"),
  "el responsable ya no participa en su franja literal: volvió a cubrir el día completo sin importar lo registrado, distinto de como se trata a un apoyo",
);
assert(
  !simulador.includes("finDelDiaIso") && !simulador.includes("finDia"),
  "el simulador volvió a extender la presencia del responsable hasta fin de día: el mismo horario escrito para responsable y apoyo se comportará distinto",
);
assert(
  between(simulador, "const personas = [{", "}];").includes('fin: horaLocalAIso(fecha, fila.hora_fin, Date.parse(inicioResp)),'),
  "el simulador ya no calcula el fin del responsable igual que el de un apoyo",
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

// ── El filtro propio también debe aplicarse a la evidencia YA ARCHIVADA ────
//
// Un archivo guardado en propinas_turno_eventos ANTES de que existiera el
// filtro (o antes de un cambio futuro en él) queda contaminado para siempre
// si solo se filtra lo que llega fresco de Loggro: cargarEventos() lee el
// archivo primero y, si tiene algo, ya no vuelve a consultar Loggro. Reportado
// en vivo: un turno de mañana con evidencia archivada seguía mostrando
// propinas de la tarde como "Sin nadie presente" pese al filtro de la Edge
// Function, porque ese archivo se guardó con una versión anterior de él.

assert(
  simulador.includes("limiteConsultaSiguienteTurno") && simulador.includes("dentroDelRango"),
  "el simulador ya no calcula su propio límite de turno para filtrar eventos",
);
assert(
  between(simulador, "if (!errorArchivo && Array.isArray(archivados)", "return {").includes("archivados.filter((e) => dentroDelRango(e.ocurrido_en))"),
  "la evidencia archivada ya no se filtra contra el límite del turno: un archivo viejo puede volver a mostrar propinas de otro turno",
);
assert(
  /const eventos = crudos\.filter\(\(e\) => dentroDelRango\(e\.ocurrido_en\)\)/.test(simulador),
  "los eventos recién traídos de Loggro ya no se filtran contra el límite del turno en el propio simulador",
);
assert(
  simulador.includes("const finTurno = Date.parse(responsable.fin);") && simulador.includes("let limite = finTurno;"),
  "el simulador ya no acota al turno del responsable: volvería a discrepar del total que calcula el cierre, "
  + "o a cortar a medianoche un turno de noche",
);

// ── El selector de sede solo debe ofrecer lo que el usuario puede tocar ────
//
// `empresas` tiene lectura pública en RLS (su nombre se usa en varias
// pantallas), así que un select sin filtrar trae TODAS las empresas de TODOS
// los clientes -prueba incluidas-. Reportado en vivo: desde la cuenta de un
// cliente (no superadmin) el selector ofrecía "Prueba Global Nexo 2",
// "Restaurante Prueba", etc. app_empresas_visibles() es la misma función que
// ya usan las políticas RLS de las tablas de turnos: el selector nunca puede
// ofrecer más de lo que luego se puede abrir de verdad.

const cargarSedesBlock = between(simulador, "const cargarSedes = async", "const esAdmin");
assert(
  cargarSedesBlock.includes('supabase.rpc("app_empresas_visibles")'),
  "cargarSedes ya no acota el selector a app_empresas_visibles(): volverá a listar empresas de otros clientes",
);
assert(
  cargarSedesBlock.includes('.in("id", visibles)'),
  "cargarSedes ya no filtra la tabla empresas por las visibles para este usuario",
);

// ── El responsable no puede quedar contado dos veces ────────────────────
//
// Algunos turnos guardan al responsable como su propia fila en
// apoyos_turno(_locales) -así queda anotada su parte cuando trabajó solo-.
// Si esa fila se suma como una persona más, la misma persona queda presente
// dos veces con el mismo id: cada propina se reparte entre "un presente de
// más", y si de verdad había otro apoyo distinto al mismo tiempo, ese otro
// recibe menos de lo que le tocaba. Confirmado en vivo con un turno real:
// responsable + 1 apoyo repartía cada propina ÷3 en vez de ÷2 mientras
// coincidían, y "repartido entre el equipo" salía el doble de lo recibido.

const cargarPersonasBlock = between(simulador, "const cargarPersonas = async", "return personas.filter");
assert(
  cargarPersonasBlock.includes('if (String(a.apoyo_responsable_id) === String(fila.responsable_id)) return;'),
  "cargarPersonas ya no descarta la fila de apoyo que es el propio responsable: vuelve a contarlo dos veces",
);

const registrosBlock = between(edge, "for (const registro of registros)", "const admin = ctx.clienteAdmin();");
assert(
  registrosBlock.includes("apoyoId === responsableId"),
  "consultar-propina-apoyos ya no descarta el registro de apoyo que es el propio responsable: vuelve a contarlo dos veces",
);

// ── "Sin nadie presente" sin turno siguiente registrado: avisar por qué ────
//
// Reportado en vivo con BATUT VIVA: un turno de mañana sin ningún otro turno
// guardado ese día mostraba propinas de la tarde como "Sin nadie presente".
// Ahora esas propinas ya no entran en la vista -la ventana se acota al turno-,
// pero el hecho de que EXISTAN sigue siendo información útil: si quedaron
// fuera y no hay ningún otro turno guardado ese día al que pertenezcan, lo más
// probable es que sea un turno que nunca se cerró. Por eso el aviso se
// dispara con el NÚMERO de descartadas, no con la lista mostrada: si se le
// pasara la lista ya filtrada nunca podría saberlo.

assert(
  simulador.includes("return { limite, siguienteInicio };"),
  "limiteConsultaSiguienteTurno ya no informa si encontró un turno siguiente registrado",
);
assert(
  simulador.includes("const avisoTurnoFaltante"),
  "el simulador ya no explica por qué una propina excluida puede ser un turno sin guardar",
);
assert(
  /descartadas > 0 && limiteInfo\?\.siguienteInicio == null/.test(simulador),
  "avisoTurnoFaltante ya no exige las dos condiciones (hubo descartes Y no hay turno siguiente registrado): "
  + "avisará de un turno faltante donde no lo hay, o dejará de avisar donde sí",
);
assert(
  simulador.includes("avisoTurnoFaltante(descartadas)") && simulador.includes("avisoTurnoFaltante(descartadasLoggro)"),
  "avisoTurnoFaltante ya no se aplica tanto al archivo como a lo recién traído de Loggro",
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
