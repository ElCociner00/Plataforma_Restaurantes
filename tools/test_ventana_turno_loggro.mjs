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

assert(
  /const\s+inicioVentana\s*=\s*Math\.min\(\s*\.\.\.personas\.map/.test(codigoApoyos),
  "consultar-propina-apoyos ya no calcula inicioVentana como el minimo sobre "
  + "TODAS las personas. Un apoyo que entra antes que el responsable perderia "
  + "su primer tramo en silencio.",
);

assert(
  /let\s+finVentana\s*=\s*Math\.max\(\s*\.\.\.personas\.map/.test(codigoApoyos),
  "consultar-propina-apoyos ya no calcula finVentana como el maximo sobre TODAS "
  + "las personas. Un apoyo que sale despues que el responsable perderia su "
  + "ultimo tramo.",
);

// El filtro propio debe usar la ventana, no el rango del responsable.
assert(
  /marca\s*<\s*inicioVentana\s*\|\|\s*marca\s*>\s*finConsultaLoggro/.test(codigoApoyos),
  "El filtro propio de facturas de consultar-propina-apoyos ya no compara contra "
  + "inicioVentana/finConsultaLoggro. Sin el, una factura que Loggro devuelva "
  + "fuera del rango pedido se cuela y aparece como huerfana de este turno.",
);

// La ventana se calcula DESPUES de construir personas: si no, el min/max no
// puede ver a los apoyos.
const posPersonas = codigoApoyos.indexOf("const personas: Persona[]");
const posVentana = codigoApoyos.indexOf("const inicioVentana");
assert(
  posPersonas !== -1 && posVentana !== -1 && posVentana > posPersonas,
  "inicioVentana se calcula antes de construir `personas`: el Math.min/max no "
  + "veria a los apoyos y la ventana volveria a ser solo la del responsable.",
);

if (fallos.length) {
  console.error(fallos.map((f) => `- ${f}`).join("\n"));
  process.exit(1);
}

console.log("Ventana de consulta OK: ventas, gastos y propinas se acotan al turno, no al dia.");
