/**
 * Fija la regla de reparto de propinas de js/propinas_reparto.js.
 *
 * Esta regla tiene que calcular EXACTAMENTE igual que la Edge Function
 * supabase/functions/consultar-propina-apoyos/index.ts. Un simulador que
 * reparta distinto que produccion seria peor que no tener simulador: se le
 * estaria demostrando al cliente algo que no es lo que cobra la gente.
 *
 * Los casos estan calculados a mano, no copiados de la salida del codigo.
 */
import { repartirPropinas, compararRepartos, repartirEnPesosEnteros } from "../js/propinas_reparto.js";

const fallos = [];
const assert = (cond, msg) => { if (!cond) fallos.push(msg); };
const casi = (a, b, msg) => assert(Math.abs(a - b) < 0.01, `${msg} (esperaba ${b}, dio ${a})`);

// Turno 18:00 -> 23:00 en Colombia (UTC-5).
const h = (hora, min = 0, seg = 0) => new Date(Date.UTC(2026, 8, 8, hora + 5, min, seg)).toISOString();

const R = "resp-1", A1 = "apoyo-1", A2 = "apoyo-2";

const personas = [
  { id: R,  tipo: "responsable", nombre: "Ana",   inicio: h(18), fin: h(23) },
  { id: A1, tipo: "apoyo",       nombre: "Bruno", inicio: h(19), fin: h(21) },
  { id: A2, tipo: "apoyo",       nombre: "Carla", inicio: h(20), fin: h(23) },
];

const eventos = [
  { factura_id: "F1", ocurrido_en: h(18, 30), monto: 10000 }, // solo Ana
  { factura_id: "F2", ocurrido_en: h(19, 30), monto:  9000 }, // Ana + Bruno
  { factura_id: "F3", ocurrido_en: h(20, 30), monto: 12000 }, // los tres
  { factura_id: "F4", ocurrido_en: h(22, 15), monto:  7000 }, // Ana + Carla
];

// ── 1 · Reparto base ──────────────────────────────────────────────────────
// Ana:   10000 + 4500 + 4000 + 3500 = 22000
// Bruno:         4500 + 4000        =  8500
// Carla:                4000 + 3500 =  7500
const base = repartirPropinas(personas, eventos);
const de = (r, id) => r.detalles.find((d) => d.id === id);

casi(de(base, R).propina_correspondiente, 22000, "Ana en el reparto base");
casi(de(base, A1).propina_correspondiente, 8500, "Bruno en el reparto base");
casi(de(base, A2).propina_correspondiente, 7500, "Carla en el reparto base");
casi(base.total_recibido, 38000, "total recibido");
casi(base.total_repartido, 38000, "total repartido");
casi(base.total_huerfano, 0, "no deberia haber propinas huerfanas");
assert(base.coinciden_totales, "el reparto base deberia cuadrar");
assert(de(base, A1).propinas === 2, "Bruno participo en 2 propinas");

// ── 2 · Mover un rango un minuto: la demostracion del cliente ─────────────
// Bruno entra 19:31 en vez de 19:00 -> la propina de las 19:30 deja de contarle
// y pasa entera a Ana. Ana: 10000 + 9000 + 4000 + 3500 = 26500.
const conBrunoTarde = personas.map((p) => (p.id === A1 ? { ...p, inicio: h(19, 31) } : p));
const movido = repartirPropinas(conBrunoTarde, eventos);

casi(de(movido, A1).propina_correspondiente, 4000, "Bruno tras entrar un minuto tarde");
casi(de(movido, R).propina_correspondiente, 26500, "Ana absorbe lo que Bruno dejo");
casi(movido.total_repartido, 38000, "mover un rango no cambia el total repartido");
assert(de(movido, A1).propinas === 1, "Bruno pasa a participar en 1 sola propina");

const dif = compararRepartos(base, movido);
assert(dif.hay_cambios, "la comparacion deberia detectar el cambio");
const cambioBruno = dif.cambios.find((c) => c.id === A1);
casi(cambioBruno.diferencia, -4500, "a Bruno le baja 4.500");

// ── 3 · Extender un rango: toma todo ──────────────────────────────────────
// Carla desde el inicio del turno -> entra en las cuatro propinas.
// F1 10000/2=5000, F2 9000/3=3000, F3 12000/3=4000, F4 7000/2=3500
const carlaTodoElTurno = personas.map((p) => (p.id === A2 ? { ...p, inicio: h(18) } : p));
const extendido = repartirPropinas(carlaTodoElTurno, eventos);
casi(de(extendido, A2).propina_correspondiente, 15500, "Carla cubriendo todo el turno");
assert(de(extendido, A2).propinas === 4, "Carla participa en las 4 propinas");
casi(extendido.total_repartido, 38000, "el total no cambia al extender");

// ── 4 · Propina sin nadie presente ────────────────────────────────────────
// Si nadie cubre el instante, esa propina no se reparte y se informa aparte.
const soloTarde = [{ id: R, tipo: "responsable", nombre: "Ana", inicio: h(21), fin: h(23) }];
const huerfanas = repartirPropinas(soloTarde, eventos);
casi(huerfanas.total_recibido, 38000, "lo recibido no cambia");
casi(huerfanas.total_repartido, 7000, "solo se reparte la propina de las 22:15");
casi(huerfanas.total_huerfano, 31000, "el resto queda sin dueno");
assert(huerfanas.eventos.filter((e) => e.huerfana).length === 3, "3 propinas huerfanas");

// ── 5 · Conciliacion de centavos ──────────────────────────────────────────
// 10 entre 3 no da exacto: 3,33 + 3,33 + 3,33 = 9,99. El residuo debe
// asignarse para que la suma sea 10 clavado.
const tres = [
  { id: "a", tipo: "responsable", nombre: "A", inicio: h(18), fin: h(23) },
  { id: "b", tipo: "apoyo", nombre: "B", inicio: h(18), fin: h(23) },
  { id: "c", tipo: "apoyo", nombre: "C", inicio: h(18), fin: h(23) },
];
const centavos = repartirPropinas(tres, [{ factura_id: "X", ocurrido_en: h(19), monto: 10 }]);
casi(centavos.total_repartido, 10, "la conciliacion de centavos debe cuadrar al peso");
assert(centavos.coinciden_totales, "con centavos partidos igual debe cuadrar");
const suma = centavos.detalles.reduce((s, d) => s + d.propina_correspondiente, 0);
casi(suma, 10, "la suma de las partes es el total");

// ── 6 · Turno que cruza medianoche ────────────────────────────────────────
// 20:00 -> 02:00: el fin es "menor" que el inicio y debe correrse un dia.
const nocturno = [{ id: R, tipo: "responsable", nombre: "Ana", inicio: h(20), fin: h(2) }];
const propinaDeMadrugada = [{ factura_id: "N", ocurrido_en: h(25, 30), monto: 5000 }]; // 01:30 del dia siguiente
const noche = repartirPropinas(nocturno, propinaDeMadrugada);
casi(de(noche, R).propina_correspondiente, 5000, "la propina de la 1:30 cuenta en un turno nocturno");
casi(noche.total_huerfano, 0, "no deberia quedar huerfana");

// ── 7 · Bordes exactos: los extremos del tramo cuentan ────────────────────
const bordes = repartirPropinas(
  [{ id: R, tipo: "responsable", nombre: "Ana", inicio: h(18), fin: h(20) }],
  [
    { factura_id: "ini", ocurrido_en: h(18), monto: 1000 },
    { factura_id: "fin", ocurrido_en: h(20), monto: 1000 },
    { factura_id: "fuera", ocurrido_en: h(20, 0, 1), monto: 1000 },
  ],
);
casi(de(bordes, R).propina_correspondiente, 2000, "los instantes exactos de inicio y fin cuentan");
casi(bordes.total_huerfano, 1000, "un segundo despues del fin ya no cuenta");

// ── 8 · Entradas basura no rompen nada ────────────────────────────────────
const sucio = repartirPropinas(
  [...personas, { id: "", tipo: "apoyo", inicio: h(18), fin: h(19) }, null],
  [...eventos, { factura_id: "malo", ocurrido_en: "no-es-fecha", monto: 500 },
               { factura_id: "cero", ocurrido_en: h(19), monto: 0 }],
);
casi(sucio.total_repartido, 38000, "los registros invalidos se descartan sin alterar el reparto");
assert(sucio.detalles.length === 3, "una persona sin id no entra al reparto");

// ── 9 · El responsable cubre TODO el turno; ningun apoyo puede salirse ─────
// Caso real, BATUT VIVA 2026-09-10. Turno (= responsable) de 01:00 a 12:00.
//   Carolina 02:00-08:00   -> dentro, pero sin propinas en su tramo
//   Daily    09:00-14:00   -> se sale: se recorta a 09:00-12:00
//   Jenny    15:00-12:00PM -> "12 PM" es mediodia y queda antes de las 3 PM:
//                             se leia como 21 horas hasta el dia siguiente y
//                             se llevaba 50.100 contra 13.008 del responsable.
//                             Queda entera fuera del turno: no participa.
// Las 5 propinas del turno (09:15 a 11:45, 26.016) caen con el responsable y
// Daily presentes: 13.008 cada uno. La de las 16:30 no es de este turno: no
// se la lleva nadie.
const d10 = (hora, min = 0, seg = 0) => new Date(Date.UTC(2026, 8, 9, hora + 5, min, seg)).toISOString();
const turnoReal = [
  { id: "seb", tipo: "responsable", nombre: "Sebastian", inicio: d10(1),  fin: d10(12) },
  { id: "car", tipo: "apoyo",       nombre: "Carolina",  inicio: d10(2),  fin: d10(8) },
  { id: "dai", tipo: "apoyo",       nombre: "Daily",     inicio: d10(9),  fin: d10(14) },
  { id: "jen", tipo: "apoyo",       nombre: "Jenny",     inicio: d10(15), fin: d10(12) },
];
const propinasReales = [
  { factura_id: "a", ocurrido_en: d10(9, 15, 33),  monto: 6342 },
  { factura_id: "b", ocurrido_en: d10(10, 15, 43), monto: 9259 },
  { factura_id: "c", ocurrido_en: d10(11, 45, 0),  monto: 3287 },
  { factura_id: "d", ocurrido_en: d10(11, 45, 22), monto: 5740 },
  { factura_id: "e", ocurrido_en: d10(11, 45, 36), monto: 1388 },
  { factura_id: "f", ocurrido_en: d10(16, 30, 22), monto: 8000 },
];
const real = repartirPropinas(turnoReal, propinasReales);
casi(de(real, "seb").propina_correspondiente, 13008, "caso VIVA: el responsable se lleva su parte de las 5 propinas");
casi(de(real, "dai").propina_correspondiente, 13008, "caso VIVA: Daily comparte las 5 (su tramo recortado a 09:00-12:00)");
casi(de(real, "car").propina_correspondiente, 0, "caso VIVA: Carolina no tiene propinas en su tramo");
casi(de(real, "jen").propina_correspondiente, 0, "caso VIVA: Jenny queda fuera del turno y no participa");
assert(de(real, "dai").recortado === true, "caso VIVA: el tramo de Daily se marca como recortado");
assert(de(real, "jen").fuera_de_turno === true && de(real, "jen").periodo === null,
  "caso VIVA: Jenny se marca fuera de turno y sin tramo que dibujar");
assert(de(real, "dai").periodo.fin === d10(12), "caso VIVA: el tramo de Daily termina con el turno");
casi(real.total_huerfano, 8000, "caso VIVA: la propina de las 16:30 no es de nadie del turno");

// ── 10 · Turno de noche: un apoyo de madrugada es del dia siguiente ────────
// Turno 18:00 -> 02:00. Apoyo registrado 01:00 -> 02:00: sobre la fecha del
// turno eso seria la madrugada ANTERIOR; pertenece a la de este turno.
const nocheConApoyo = repartirPropinas(
  [
    { id: R,  tipo: "responsable", nombre: "Ana",   inicio: h(18), fin: h(2) },
    { id: A1, tipo: "apoyo",       nombre: "Bruno", inicio: h(1),  fin: h(2) },
  ],
  [{ factura_id: "M", ocurrido_en: h(25, 30), monto: 6000 }], // 01:30 del dia siguiente
);
casi(de(nocheConApoyo, A1).propina_correspondiente, 3000, "turno de noche: el apoyo de madrugada comparte la propina de las 01:30");
casi(de(nocheConApoyo, R).propina_correspondiente, 3000, "turno de noche: el responsable tambien");

// ── 11 · Invariante: ningun apoyo por encima del responsable ───────────────
// Pase lo que pase con los tramos escritos -dentro, fuera, cruzando la
// medianoche, al reves-. Generador determinista para que un fallo se repita.
let semilla = 20260910;
const azar = () => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla / 2147483648; };
const hora24 = (n) => h(Math.floor(n), Math.floor((n % 1) * 60));
let violaciones = 0;
let violacionesPesos = 0;
for (let i = 0; i < 400; i += 1) {
  const ini = azar() * 23;
  const dur = 2 + azar() * 12;
  const gente = [{ id: "r", tipo: "responsable", nombre: "R", inicio: hora24(ini), fin: hora24((ini + dur) % 24) }];
  const n = 1 + Math.floor(azar() * 4);
  for (let k = 0; k < n; k += 1) {
    gente.push({ id: `a${k}`, tipo: "apoyo", nombre: `A${k}`, inicio: hora24(azar() * 24), fin: hora24(azar() * 24) });
  }
  // Las propinas caen dentro del turno TAL COMO QUEDO escrito (horas y
  // minutos enteros), no del turno sin redondear: si no, alguna cae unos
  // segundos despues del fin y la prueba culparia al codigo de su propio error.
  const turnoIni = Date.parse(gente[0].inicio);
  let turnoFin = Date.parse(gente[0].fin);
  if (turnoFin <= turnoIni) turnoFin += 24 * 3600000;
  const eventosAzar = Array.from({ length: 12 }, (_, k) => ({
    factura_id: `z${k}`,
    ocurrido_en: new Date(turnoIni + azar() * (turnoFin - turnoIni)).toISOString(),
    monto: 1000 + Math.floor(azar() * 9000),
  }));
  const r = repartirPropinas(gente, eventosAzar);
  const resp = de(r, "r").propina_correspondiente;
  if (r.detalles.some((d) => d.tipo === "apoyo" && d.propina_correspondiente > resp + 0.01)) violaciones += 1;
  if (r.total_huerfano > 0.01) violaciones += 1; // todo lo del turno lo cubre el responsable

  // Y lo mismo despues de pasar a pesos enteros, que es lo que se guarda.
  const enPesos = repartirEnPesosEnteros(r.detalles.map((d) => ({ id: d.id, tipo: d.tipo, propina: d.propina_correspondiente })));
  const respPesos = enPesos.find((d) => d.id === "r").propina;
  const sumaPesos = enPesos.reduce((s, d) => s + d.propina, 0);
  if (enPesos.some((d) => d.tipo === "apoyo" && d.propina > respPesos)) violacionesPesos += 1;
  if (sumaPesos !== Math.round(r.total_repartido)) violacionesPesos += 1;
  if (enPesos.some((d, k) => r.detalles[k].propina_correspondiente === 0 && d.propina !== 0)) violacionesPesos += 1;
  if (enPesos.some((d, k) => Math.abs(d.propina - r.detalles[k].propina_correspondiente) >= 1)) violacionesPesos += 1;
}
assert(violaciones === 0, `invariante: ${violaciones} de 400 turnos al azar dejaron un apoyo por encima del responsable o propinas del turno sin dueno`);
assert(violacionesPesos === 0, `pesos enteros: ${violacionesPesos} fallos en 400 turnos al azar (total alterado, plata a quien tenia 0, `
  + "un apoyo por encima del responsable, o alguien movido un peso o mas de lo suyo)");

// ── 12 · Paso a pesos enteros: caso real ────────────────────────────────────
// VIVA 2026-09-10, turno 09:00-15:00. El motor devuelve con centavos:
// Sebastian 22.164,5 · Daily 14.364 · Carolina 7.800,5 · Jenny 0 = 44.329.
// Antes: cada uno redondeado por su lado (44.330), y el "rebalanceo" le echaba
// el sobrante al ultimo -Jenny, que no estuvo en ninguna propina, quedaba con
// $2 y a Daily le quitaban $1-. Ahora: el peso que falta va a la fraccion mayor
// (empate: el primero, que es el responsable).
const pesos = repartirEnPesosEnteros([
  { id: "seb", tipo: "responsable", propina: 22164.5 },
  { id: "car", tipo: "apoyo", propina: 7800.5 },
  { id: "dai", tipo: "apoyo", propina: 14364 },
  { id: "jen", tipo: "apoyo", propina: 0 },
]);
const p = (id) => pesos.find((x) => x.id === id).propina;
assert(p("seb") === 22165 && p("car") === 7800 && p("dai") === 14364 && p("jen") === 0,
  `pesos enteros, caso real: esperaba 22165/7800/14364/0 y dio ${p("seb")}/${p("car")}/${p("dai")}/${p("jen")}`);
assert(pesos.reduce((s, x) => s + x.propina, 0) === 44329, "pesos enteros, caso real: el total debe seguir siendo 44.329");

if (fallos.length) {
  console.error("FALLOS:");
  fallos.forEach((f) => console.error("  -", f));
  process.exit(1);
}

console.log("Reparto de propinas OK: 12 escenarios, incluidos centavos, medianoche, propinas sin dueno, "
  + "apoyos recortados al turno y 400 turnos al azar sin ningun apoyo por encima del responsable, ni en centavos ni en pesos enteros.");
