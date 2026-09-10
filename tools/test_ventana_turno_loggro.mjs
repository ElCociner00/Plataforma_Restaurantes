import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Fija que la consulta a Loggro se acote al TURNO y no al DIA.
//
// El turno va de su hora de inicio a su hora de fin. Consultar hasta el fin del
// dia hacia que un turno se trajera las ventas y las propinas de todos los
// turnos posteriores de la misma fecha. Como nadie de este turno estaba
// presente a esas horas, las propinas salian como "sin nadie presente".
//
// Estuvo enmascarado durante meses porque Loggro solo devuelve facturas que YA
// EXISTEN al consultar: quien cierra al terminar su turno no ve las de despues
// porque aun no se han emitido, y "el ahora" hacia de tope de facto. Comprobado
// con BATUT VIVA 2026-09-08 turno 1 (08:53-14:55): lo guardado coincide al peso
// con su ventana real (627.320), pero esa misma consulta repetida hoy devuelve
// el dia entero (1.129.230). El dato historico esta bien; la consulta no. Y
// revienta al cerrar tarde o al reconstruir un dia pasado.

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const leer = (p) => readFile(path.join(raiz, p), "utf8");

const ventas = await leer("supabase/functions/consultar-ventas/index.ts");
const apoyos = await leer("supabase/functions/consultar-propina-apoyos/index.ts");
const gastos = await leer("supabase/functions/consultar-gastos/index.ts");

// El comentario explicativo cita a proposito la expresion vieja; si no se
// quitan las lineas comentadas, la propia explicacion dispara el fallo.
const sinComentarios = (fuente) =>
  fuente
    .split("\n")
    .filter((linea) => !linea.trimStart().startsWith("//") && !linea.trimStart().startsWith("*"))
    .join("\n");

const codigoVentas = sinComentarios(ventas);
const codigoApoyos = sinComentarios(apoyos);
const codigoGastos = sinComentarios(gastos);

const fallos = [];
const assert = (cond, msg) => { if (!cond) fallos.push(msg); };

// ── consultar-ventas ───────────────────────────────────────────────────────
assert(
  /turno\.fin\b/.test(codigoVentas),
  "consultar-ventas ya no lee turno.fin. El formulario lo manda desde siempre "
  + "(buildTurnoPayload en js/cierre_turno.js); si se ignora, el turno vuelve a "
  + "traerse las ventas del resto del dia.",
);

assert(
  /rangoTurno\s*\(\s*fecha\s*,\s*horaInicio\s*,\s*horaFin\s*\)/.test(codigoVentas),
  "consultar-ventas ya no acota con rangoTurno(fecha, horaInicio, horaFin). Ese "
  + "helper es el que resuelve el cruce de medianoche del turno de noche, que "
  + "era la unica razon real para haber usado el fin del dia.",
);

// finDelDia solo puede sobrevivir como respaldo para llamadas sin hora_fin.
const usosFinDelDiaVentas = [...codigoVentas.matchAll(/finDelDia\s*\(/g)].length;
assert(
  usosFinDelDiaVentas <= 1,
  `consultar-ventas usa finDelDia() ${usosFinDelDiaVentas} veces. Solo se admite `
  + "una, la del respaldo para llamadas que no manden hora_fin.",
);

// ── consultar-gastos (modo turno) ──────────────────────────────────────────
// Mismo patron y misma consecuencia: un turno cerrado tarde se apuntaba los
// gastos de los turnos posteriores de esa fecha.
assert(
  /rangoTurno\s*\(\s*fecha\s*,\s*horaInicio\s*,\s*horaFin\s*\)/.test(codigoGastos),
  "consultar-gastos (modo turno) ya no se acota con rangoTurno(fecha, horaInicio, horaFin): "
  + "vuelve a traerse los gastos del resto del dia como si fueran de este turno.",
);
assert(
  /texto\(turno\.fin\)/.test(codigoGastos),
  "consultar-gastos ya no lee turno.fin, que buildTurnoPayload() le manda desde siempre.",
);

// ── consultar-propina-apoyos ───────────────────────────────────────────────
assert(
  !/finDelDia/.test(codigoApoyos),
  "consultar-propina-apoyos volvio a estirar la ventana hasta finDelDia(). Eso "
  + "es exactamente lo que hacia que un turno viera las propinas de los turnos "
  + "posteriores y las marcara como huerfanas suyas.",
);

// La ventana es EL TURNO (el tramo del responsable), no la cobertura de todas
// las personas. Una version anterior la estiraba del primero en entrar al
// ultimo en salir, y bastaba un apoyo con un tramo mal escrito -"de 3:00 PM a
// 12:00 PM", leido como 21 horas hasta el dia siguiente- para arrastrar horas
// de otro turno. Ahora ningun apoyo puede quedar fuera del turno.
assert(
  /const\s+inicioVentana\s*=\s*inicioResponsable\s*;/.test(codigoApoyos),
  "consultar-propina-apoyos ya no empieza la ventana en el inicio del turno.",
);
assert(
  /let\s+finVentana\s*=\s*finResponsable\s*;/.test(codigoApoyos),
  "consultar-propina-apoyos ya no termina la ventana en el fin del turno: un apoyo "
  + "mal escrito podria volver a estirarla.",
);
assert(
  !/Math\.(min|max)\(\s*\.\.\.personas\.map/.test(codigoApoyos),
  "consultar-propina-apoyos volvio a calcular la ventana sobre la cobertura de "
  + "todas las personas.",
);

// Todo apoyo pasa por ubicarEnTurno: se recorta al turno.
assert(
  /ubicarEnTurno\(\s*\n?\s*inicioResponsable\s*,\s*\n?\s*finResponsable/.test(codigoApoyos),
  "consultar-propina-apoyos ya no recorta el tramo de cada apoyo al turno "
  + "(ubicarEnTurno). Un apoyo podria volver a tener mas propina que el responsable.",
);
assert(
  /!p\.fueraDeTurno\s*&&\s*marca\s*>=\s*p\.inicio/.test(codigoApoyos),
  "Un apoyo entero fuera del turno vuelve a poder participar del reparto.",
);

// El filtro propio debe usar la ventana, no el rango del responsable.
assert(
  /marca\s*<\s*inicioVentana\s*\|\|\s*marca\s*>\s*finConsultaLoggro/.test(codigoApoyos),
  "El filtro propio de facturas de consultar-propina-apoyos ya no compara contra "
  + "inicioVentana/finConsultaLoggro. Sin el, una factura que Loggro devuelva "
  + "fuera del rango pedido se cuela y aparece como huerfana de este turno.",
);

// ── Misma regla de recorte en la Edge Function y en el simulador ───────────
// Se compara el cuerpo de ubicarEnTurno() en los dos lados, sin tipos ni
// espacios: si alguien cambia uno sin el otro, la auditoria dejaria de
// mostrar lo mismo que cobra la gente.
const reparto = await leer("js/propinas_reparto.js");
// Del primer statement al ultimo return: eso es la regla, sin la firma (que
// en TypeScript lleva tipos y en el navegador no).
const cuerpoDe = (fuente) => {
  const codigo = sinComentarios(fuente);
  const i = codigo.indexOf("function ubicarEnTurno(");
  if (i === -1) return null;
  const desde = codigo.indexOf("let d = desde;", i);
  const hasta = codigo.indexOf("fueraDeTurno: false };", desde);
  return desde === -1 || hasta === -1 ? null : codigo.slice(desde, hasta).replace(/\s+/g, "");
};
const cuerpoEdge = cuerpoDe(apoyos);
const cuerpoNav = cuerpoDe(reparto);
assert(cuerpoEdge && cuerpoNav && cuerpoEdge === cuerpoNav,
  "ubicarEnTurno() ya no es identica en consultar-propina-apoyos y en js/propinas_reparto.js: "
  + "el simulador recortaria los apoyos distinto que produccion.");

// ── El formulario no deja confirmar un apoyo fuera del turno ───────────────
const cierre = sinComentarios(await leer("js/cierre_turno.js"));
const validar = cierre.slice(cierre.indexOf("const validateApoyoRows"), cierre.indexOf("const horaAMinutos"));
assert(
  /ubicarApoyoEnTurno\(/.test(validar) && /if\s*\(\s*!tramo\.dentro\s*\)/.test(validar),
  "validateApoyoRows ya no rechaza un apoyo cuyo horario se sale del turno.",
);
// Cierre y auditoria muestran los mismos pesos enteros que se guardan. Antes la
// auditoria redondeaba a cada persona por su cuenta: 7.801 en pantalla contra
// 7.800 guardados.
const simuladorJs = sinComentarios(await leer("js/simulador_propinas.js"));
assert(
  /const simulado = enPesos\(repartirPropinas\(/.test(simuladorJs)
    && /estado\.repartoReal = enPesos\(repartirPropinas\(/.test(simuladorJs),
  "La auditoria vuelve a mostrar el reparto con centavos redondeados por persona, distinto de lo guardado.",
);
assert(
  /repartirEnPesosEnteros\(items\)/.test(sinComentarios(await leer("js/apoyos.js"))),
  "Confirmar apoyo ya no pasa el reparto a pesos con repartirEnPesosEnteros.",
);

// Confirmar apoyo (js/apoyos.js) no puede pisar ese motivo con uno generico:
// pasaba, y la persona veia "Completa los datos de apoyos" sin saber que el
// problema era el horario de uno de ellos.
const apoyosJs = sinComentarios(await leer("js/apoyos.js"));
assert(
  /if\s*\(\s*!validateApoyoRows\(\)\s*\)\s*return\s*;/.test(apoyosJs),
  "js/apoyos.js vuelve a reemplazar el motivo de validateApoyoRows por un mensaje generico.",
);
assert(
  /12:00 PM es mediodía/.test(cierre),
  "El aviso ya no aclara que 12:00 PM es mediodía: es justo la confusion que produjo el caso real.",
);

if (fallos.length) {
  console.error(fallos.map((f) => `- ${f}`).join("\n"));
  process.exit(1);
}

console.log("Ventana de consulta OK: ventas, gastos y propinas se acotan al turno, no al dia.");
