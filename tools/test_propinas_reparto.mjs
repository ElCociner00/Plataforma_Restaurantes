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
import { repartirPropinas, compararRepartos } from "../js/propinas_reparto.js";

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

if (fallos.length) {
  console.error("FALLOS:");
  fallos.forEach((f) => console.error("  -", f));
  process.exit(1);
}

console.log("Reparto de propinas OK: 8 escenarios, incluidos centavos, medianoche y propinas sin dueno.");
