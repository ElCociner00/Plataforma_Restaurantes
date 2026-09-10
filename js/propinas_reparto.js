/**
 * MAPA DE MANTENIMIENTO (guía rápida para cambios manuales)
 * Archivo: js/propinas_reparto.js
 *
 * Partes del archivo:
 * 1) Utilidades puras (normalización de personas y eventos).
 * 2) La regla de reparto.
 * 3) API pública: `repartirPropinas`.
 *
 * Índice de funciones/bloques para ubicarte rápido:
 * - `normalizarPersonas` (línea aprox. 60)
 * - `repartirPropinas`   (línea aprox. 95): el reparto completo.
 *
 * Nota: este mapa no altera la lógica; sirve para navegar y parchear sin riesgo funcional.
 */

// La regla de reparto de propinas. UNA sola implementación en el navegador.
// =========================================================================
//
// Es una réplica exacta de lo que hace la Edge Function
// `supabase/functions/consultar-propina-apoyos/index.ts`:
//
//   1. Cada propina se divide A PARTES IGUALES entre quienes estaban presentes
//      en el instante exacto de la factura. Presente = la marca de tiempo cae
//      dentro de su tramo, extremos incluidos.
//   2. Una propina en la que no había NADIE presente no se reparte y tampoco
//      entra en el total repartido. Aquí se devuelve aparte, porque en el
//      simulador es justo lo que se ve al encoger los rangos: dinero que deja
//      de pertenecer a alguien.
//   3. Los centavos se concilian al final: se asigna la parte entera y el
//      residuo va a las fracciones más grandes, de modo que la suma coincida
//      al peso con lo recibido.
//
// POR QUÉ EXISTE ESTE ARCHIVO: el simulador tiene que recalcular al instante
// mientras se mueve un rango delante del cliente, y no puede ir a Loggro por
// cada cambio. Pero un simulador que calcule distinto que producción sería
// peor que no tenerlo: por eso la regla vive aquí sola, y
// tools/test_propinas_reparto.mjs la fija contra casos calculados a mano.
//
// SI CAMBIAS ESTA REGLA, cambia también la Edge Function, y al revés.

/** Convierte a instante (ms) lo que venga: Date, ISO, o número. */
function aInstante(valor) {
  if (valor instanceof Date) return valor.getTime();
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : NaN;
  return Date.parse(String(valor ?? ""));
}

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Coloca el tramo de un apoyo dentro del turno y lo recorta a él. Réplica de
 * ubicarEnTurno() en la Edge Function.
 *
 * REGLA: el responsable está presente en TODO el turno -su tramo ES el
 * turno- y un apoyo solo puede estar dentro de ese rango. Así ningún apoyo
 * termina con más propina que el responsable: en cada propina en la que el
 * apoyo está, el responsable también. En un turno que cruza medianoche, un
 * tramo que empieza antes del inicio del turno es de la madrugada.
 */
export function ubicarEnTurno(turnoInicio, turnoFin, desde, hasta) {
  let d = desde;
  let h = hasta;
  if (h <= d) h += DIA_MS;
  if (d < turnoInicio && d + DIA_MS < turnoFin) {
    d += DIA_MS;
    h += DIA_MS;
  }
  const inicio = Math.max(d, turnoInicio);
  const fin = Math.min(h, turnoFin);
  if (fin < inicio) {
    return { inicio: d, fin: h, recortado: true, fueraDeTurno: true };
  }
  return { inicio, fin, recortado: inicio !== d || fin !== h, fueraDeTurno: false };
}

/**
 * Personas con su tramo. Un fin anterior o igual al inicio se entiende como
 * tramo que cruza medianoche y se corre un día, igual que en la Edge Function.
 * Los apoyos se recortan al tramo del responsable (el turno).
 */
function normalizarPersonas(personas) {
  const gente = (Array.isArray(personas) ? personas : [])
    .map((p) => {
      const id = String(p?.id ?? "").trim();
      if (!id) return null;
      const inicio = aInstante(p?.inicio);
      let fin = aInstante(p?.fin);
      if (!Number.isFinite(inicio) || !Number.isFinite(fin)) return null;
      if (fin <= inicio) fin += DIA_MS;
      return {
        id,
        tipo: p?.tipo === "responsable" ? "responsable" : "apoyo",
        nombre: String(p?.nombre ?? id),
        inicio,
        fin,
        recortado: false,
        fueraDeTurno: false,
      };
    })
    .filter(Boolean);

  const responsable = gente.find((p) => p.tipo === "responsable");
  if (!responsable) return gente;

  return gente.map((p) => {
    if (p.tipo === "responsable") return p;
    const tramo = ubicarEnTurno(responsable.inicio, responsable.fin, p.inicio, p.fin);
    return { ...p, ...tramo };
  });
}

/** Eventos de propina ordenados por hora, descartando lo que no sea usable. */
function normalizarEventos(eventos) {
  return (Array.isArray(eventos) ? eventos : [])
    .map((e) => {
      const instante = aInstante(e?.ocurrido_en);
      const monto = Number(e?.monto);
      if (!Number.isFinite(instante) || !Number.isFinite(monto) || monto <= 0) return null;
      return {
        factura_id: String(e?.factura_id ?? ""),
        ocurrido_en: new Date(instante).toISOString(),
        instante,
        monto,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.instante - b.instante);
}

/**
 * Reparte las propinas entre las personas según sus tramos.
 *
 * @param {Array<{id, tipo, nombre, inicio, fin}>} personas
 * @param {Array<{factura_id, ocurrido_en, monto}>} eventos
 * @returns {{
 *   detalles: Array<{id, tipo, nombre, propina_correspondiente, propinas}>,
 *   eventos: Array<{factura_id, ocurrido_en, monto, presentes, reparto, huerfana}>,
 *   total_recibido: number,
 *   total_repartido: number,
 *   total_huerfano: number,
 *   coinciden_totales: boolean
 * }}
 */
export function repartirPropinas(personas, eventos) {
  const gente = normalizarPersonas(personas);
  const lista = normalizarEventos(eventos);

  const acumulado = new Map(gente.map((p) => [p.id, 0]));
  const conteo = new Map(gente.map((p) => [p.id, 0]));

  let totalRepartible = 0;   // solo lo que tenía a alguien presente
  let totalHuerfano = 0;     // propinas sin nadie: no se reparten
  let totalRecibido = 0;

  const detallados = lista.map((evento) => {
    totalRecibido += evento.monto;

    const activas = gente.filter((p) => !p.fueraDeTurno && evento.instante >= p.inicio && evento.instante <= p.fin);

    if (activas.length === 0) {
      totalHuerfano += evento.monto;
      return { ...evento, presentes: [], reparto: [], huerfana: true };
    }

    totalRepartible += evento.monto;
    const porPersona = evento.monto / activas.length;
    activas.forEach((p) => {
      acumulado.set(p.id, acumulado.get(p.id) + porPersona);
      conteo.set(p.id, conteo.get(p.id) + 1);
    });

    return {
      ...evento,
      huerfana: false,
      presentes: activas.map((p) => ({ id: p.id, tipo: p.tipo, nombre: p.nombre })),
      reparto: activas.map((p) => ({
        id: p.id,
        tipo: p.tipo,
        nombre: p.nombre,
        parte: Math.round(porPersona * 100) / 100,
      })),
    };
  });

  // Conciliación por centavos: la parte entera primero y el residuo a las
  // fracciones mayores, para que la suma cuadre al peso con lo repartible.
  const totalCentavos = Math.round(totalRepartible * 100);
  const asignaciones = gente.map((p, indice) => {
    const exactos = acumulado.get(p.id) * 100;
    return { indice, base: Math.floor(exactos), fraccion: exactos - Math.floor(exactos) };
  });

  let residuo = totalCentavos - asignaciones.reduce((suma, item) => suma + item.base, 0);
  [...asignaciones]
    .sort((a, b) => b.fraccion - a.fraccion || a.indice - b.indice)
    .forEach((item) => {
      if (residuo <= 0) return;
      asignaciones[item.indice].base += 1;
      residuo -= 1;
    });

  let totalRepartido = 0;
  const detalles = gente.map((p, indice) => {
    const redondeada = asignaciones[indice].base / 100;
    totalRepartido += redondeada;
    return {
      id: p.id,
      tipo: p.tipo,
      nombre: p.nombre,
      propina_correspondiente: redondeada,
      propinas: conteo.get(p.id),
      periodo: p.fueraDeTurno ? null : {
        inicio: new Date(p.inicio).toISOString(),
        fin: new Date(p.fin).toISOString(),
      },
      recortado: p.recortado,
      fuera_de_turno: p.fueraDeTurno,
    };
  });

  const redondear = (n) => Math.round(n * 100) / 100;

  return {
    detalles,
    eventos: detallados,
    total_recibido: redondear(totalRecibido),
    total_repartido: redondear(totalRepartido),
    total_huerfano: redondear(totalHuerfano),
    // Cuadra cuando todo lo repartible acabó en manos de alguien. Las propinas
    // huerfanas no cuentan aquí: se informan aparte, que es lo honesto.
    coinciden_totales: Math.abs(totalRepartible - totalRepartido) < 0.01,
  };
}

/**
 * Pasa el reparto exacto (con centavos) a pesos enteros sin cambiar el total
 * y sin inventarle plata a nadie.
 *
 * Mayor residuo: cada quien recibe la parte entera de lo suyo, y los pesos que
 * faltan para llegar al total (redondeado) van, de uno en uno, a quienes tienen
 * la fracción más grande. Quien tiene 0 no tiene fracción, así que nunca recibe
 * un peso que no le tocó.
 *
 * Lo que había antes redondeaba a cada uno por su cuenta -la suma podía quedar
 * un peso por encima del total- y luego "rebalanceaba" con floor proporcional
 * echándole todo el sobrante AL ÚLTIMO de la lista. Caso real (VIVA,
 * 2026-09-10): una apoyo que no estuvo en ninguna propina quedó con $2 y a otra
 * se le quitó $1.
 */
export const repartirEnPesosEnteros = (items) => {
  const exactos = items.map((item) => {
    const n = Number(item.propina);
    return Number.isFinite(n) && n > 0 ? n : 0;
  });
  const base = exactos.map((n) => Math.floor(n));
  const objetivo = Math.round(exactos.reduce((acc, n) => acc + n, 0));
  let faltan = objetivo - base.reduce((acc, n) => acc + n, 0);

  exactos
    .map((n, indice) => ({ indice, fraccion: n - Math.floor(n) }))
    .filter((item) => item.fraccion > 0)
    .sort((a, b) => b.fraccion - a.fraccion || a.indice - b.indice)
    .forEach((item) => {
      if (faltan <= 0) return;
      base[item.indice] += 1;
      faltan -= 1;
    });

  return items.map((item, indice) => ({ ...item, propina: base[indice] }));
};

/** Diferencia entre dos repartos, para explicar qué cambió al mover un rango. */
export function compararRepartos(base, simulado) {
  const porId = new Map((base?.detalles || []).map((d) => [d.id, d]));
  const cambios = (simulado?.detalles || []).map((d) => {
    const antes = porId.get(d.id);
    const valorAntes = antes ? antes.propina_correspondiente : 0;
    const propinasAntes = antes ? antes.propinas : 0;
    return {
      id: d.id,
      nombre: d.nombre,
      tipo: d.tipo,
      antes: valorAntes,
      ahora: d.propina_correspondiente,
      diferencia: Math.round((d.propina_correspondiente - valorAntes) * 100) / 100,
      propinas_antes: propinasAntes,
      propinas_ahora: d.propinas,
    };
  });

  return {
    cambios,
    hay_cambios: cambios.some((c) => Math.abs(c.diferencia) >= 0.01 || c.propinas_antes !== c.propinas_ahora),
    huerfano_antes: base?.total_huerfano ?? 0,
    huerfano_ahora: simulado?.total_huerfano ?? 0,
  };
}
