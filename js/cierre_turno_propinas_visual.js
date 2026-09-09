/**
 * MAPA DE MANTENIMIENTO (guía rápida para cambios manuales)
 * Archivo: js/cierre_turno_propinas_visual.js
 *
 * Partes del archivo:
 * 1) Utilidades puras (formato de dinero y hora, normalizadores).
 * 2) Construcción de la línea de tiempo y del desglose.
 * 3) API pública: `renderRepartoPropinas` y `limpiarRepartoPropinas`.
 *
 * Índice de funciones/bloques para ubicarte rápido:
 * - `normalizarEventos` (línea aprox. 90): ordena y valida la traza recibida.
 * - `construirPersonas` (línea aprox. 120): franjas y totales por persona.
 * - `pintarLineaTiempo` (línea aprox. 190): barras por persona + marcas de propina.
 * - `pintarPropinaAPropina` (línea aprox. 250): "X ÷ N presentes = Y c/u".
 * - `pintarPorPersona` (línea aprox. 300): acumulado y porcentaje.
 * - `pintarPorBloques` (línea aprox. 340): subtotales por rango horario.
 * - `renderRepartoPropinas` (línea aprox. 380): punto de entrada.
 *
 * Nota: este mapa no altera la lógica; sirve para navegar y parchear sin riesgo funcional.
 */

// Desglose visual del reparto de propinas.
// ========================================
// Esto NO calcula el reparto. El reparto lo hace la Edge Function
// `consultar-propina-apoyos` y su regla no se toca: cada propina se divide a
// partes iguales entre quienes estaban presentes en el instante de la factura,
// y los centavos se concilian para que la suma cuadre al peso.
//
// Este módulo solo lo enseña. El cliente veía únicamente el total por persona,
// sin poder rastrear de dónde salía, y de ahí la sospecha de que no se
// repartía. Aquí se muestra el camino completo: quién estaba y cuándo, qué
// propina entró a qué hora, entre cuántos se dividió, y cómo se llega al total.
//
// Si estos números no cuadran, el problema está en la Edge Function, no aquí.

const TZ = "America/Bogota";

const formateadorCOP = typeof Intl !== "undefined" && typeof Intl.NumberFormat === "function"
  ? new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })
  : null;

const dinero = (valor) => {
  const n = Number(valor);
  if (!Number.isFinite(n)) return "$0";
  return formateadorCOP ? formateadorCOP.format(n) : `$${Math.round(n)}`;
};

const hora = (iso) => {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return "--:--";
  return fecha.toLocaleTimeString("es-CO", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false
  });
};

const horaConSegundos = (iso) => {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return "--:--:--";
  return fecha.toLocaleTimeString("es-CO", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  });
};

/** Crea un elemento. El texto va por textContent: nunca se interpola HTML. */
const el = (tag, clase, texto) => {
  const nodo = document.createElement(tag);
  if (clase) nodo.className = clase;
  if (texto !== undefined && texto !== null) nodo.textContent = String(texto);
  return nodo;
};

const seccion = (titulo, explicacion) => {
  const bloque = el("section", "propinas-bloque");
  bloque.appendChild(el("h4", "propinas-bloque-titulo", titulo));
  if (explicacion) bloque.appendChild(el("p", "propinas-bloque-nota", explicacion));
  return bloque;
};

// ── Normalización ──────────────────────────────────────────────────────────

const normalizarEventos = (eventos) => (Array.isArray(eventos) ? eventos : [])
  .map((evento) => {
    const instante = Date.parse(evento?.ocurrido_en);
    const monto = Number(evento?.monto);
    if (!Number.isFinite(instante) || !Number.isFinite(monto) || monto <= 0) return null;
    return {
      factura_id: String(evento?.factura_id || ""),
      ocurrido_en: evento.ocurrido_en,
      instante,
      monto,
      presentes: Array.isArray(evento?.presentes) ? evento.presentes : [],
      reparto: Array.isArray(evento?.reparto) ? evento.reparto : []
    };
  })
  .filter(Boolean)
  .sort((a, b) => a.instante - b.instante);

/**
 * Une lo que dice el reparto oficial (`detalles`) con lo observado en la traza.
 * `detalles` manda en el total por persona: es la cifra conciliada que se
 * guarda. La traza sirve para explicarla, no para sustituirla.
 */
const construirPersonas = (detalles, eventos, resolverNombre) => {
  const porId = new Map();

  (Array.isArray(detalles) ? detalles : []).forEach((detalle) => {
    const id = String(detalle?.id || "");
    if (!id) return;
    porId.set(id, {
      id,
      tipo: detalle?.tipo === "responsable" ? "responsable" : "apoyo",
      nombre: resolverNombre(id),
      total: Number(detalle?.propina_correspondiente) || 0,
      inicio: Date.parse(detalle?.periodo?.inicio),
      fin: Date.parse(detalle?.periodo?.fin),
      propinas: 0
    });
  });

  // Alguien que aparece en la traza pero no en `detalles` es una anomalía:
  // se muestra igualmente en vez de desaparecer sin dejar rastro.
  eventos.forEach((evento) => {
    evento.reparto.forEach((parte) => {
      const id = String(parte?.id || "");
      if (!id) return;
      if (!porId.has(id)) {
        porId.set(id, {
          id,
          tipo: parte?.tipo === "responsable" ? "responsable" : "apoyo",
          nombre: resolverNombre(id),
          total: 0,
          inicio: NaN,
          fin: NaN,
          propinas: 0,
          soloEnTraza: true
        });
      }
      porId.get(id).propinas += 1;
    });
  });

  return [...porId.values()].sort((a, b) => {
    if (a.tipo !== b.tipo) return a.tipo === "responsable" ? -1 : 1;
    return b.total - a.total;
  });
};

// ── Línea de tiempo ────────────────────────────────────────────────────────

const pintarLineaTiempo = (personas, eventos) => {
  const bloque = seccion(
    "1. Quién estaba en el turno, y cuándo entró cada propina",
    "Cada barra es el tramo que cubrió esa persona. Cada punto sobre la barra es una propina recibida a esa hora exacta."
  );

  const marcasTiempo = [
    ...personas.map((p) => p.inicio).filter(Number.isFinite),
    ...personas.map((p) => p.fin).filter(Number.isFinite),
    ...eventos.map((e) => e.instante)
  ];

  if (!marcasTiempo.length) {
    bloque.appendChild(el("p", "propinas-vacio", "No hay franjas horarias que dibujar para este turno."));
    return bloque;
  }

  const desde = Math.min(...marcasTiempo);
  const hasta = Math.max(...marcasTiempo);
  const span = Math.max(hasta - desde, 1);
  const porcentaje = (instante) => ((instante - desde) / span) * 100;

  const escala = el("div", "propinas-escala");
  escala.appendChild(el("span", null, hora(new Date(desde).toISOString())));
  escala.appendChild(el("span", null, hora(new Date(hasta).toISOString())));
  bloque.appendChild(escala);

  personas.forEach((persona) => {
    const fila = el("div", "propinas-fila-tiempo");

    const etiqueta = el("div", "propinas-persona");
    etiqueta.appendChild(el("strong", null, persona.nombre));
    etiqueta.appendChild(el("span", `propinas-rol propinas-rol-${persona.tipo}`,
      persona.tipo === "responsable" ? "Responsable" : "Apoyo"));
    fila.appendChild(etiqueta);

    const carril = el("div", "propinas-carril");
    const tieneFranja = Number.isFinite(persona.inicio) && Number.isFinite(persona.fin);

    if (tieneFranja) {
      const barra = el("div", `propinas-barra propinas-barra-${persona.tipo}`);
      barra.style.left = `${porcentaje(persona.inicio)}%`;
      barra.style.width = `${Math.max(porcentaje(persona.fin) - porcentaje(persona.inicio), 0.5)}%`;
      barra.title = `${persona.nombre}: ${hora(new Date(persona.inicio).toISOString())} a ${hora(new Date(persona.fin).toISOString())}`;
      carril.appendChild(barra);
    } else {
      carril.appendChild(el("span", "propinas-sin-franja", "Sin franja horaria registrada"));
    }

    // Solo se marcan las propinas en las que esta persona participó: así se ve
    // que a cada quien le tocaron las de su tramo y no las de todo el turno.
    eventos.forEach((evento) => {
      const participo = evento.reparto.some((parte) => String(parte?.id || "") === persona.id);
      if (!participo) return;
      const marca = el("span", "propinas-marca");
      marca.style.left = `${porcentaje(evento.instante)}%`;
      const entre = evento.presentes.length || 1;
      marca.title = `${horaConSegundos(evento.ocurrido_en)} · ${dinero(evento.monto)} entre ${entre} = ${dinero(evento.monto / entre)}`;
      carril.appendChild(marca);
    });

    fila.appendChild(carril);
    fila.appendChild(el("div", "propinas-total-persona", dinero(persona.total)));
    bloque.appendChild(fila);
  });

  return bloque;
};

// ── Propina a propina ──────────────────────────────────────────────────────

const pintarPropinaAPropina = (eventos, personasPorId) => {
  const bloque = seccion(
    "2. Cómo se dividió cada propina",
    "Una fila por propina recibida, con la hora exacta y entre quiénes se repartió."
  );

  if (!eventos.length) {
    bloque.appendChild(el("p", "propinas-vacio", "En este turno no se registraron propinas."));
    return bloque;
  }

  const tabla = el("table", "propinas-tabla");
  const thead = el("thead");
  const filaCabecera = el("tr");
  ["Hora exacta", "Propina", "¿Quiénes estaban?", "División", "A cada uno"].forEach((titulo) => {
    filaCabecera.appendChild(el("th", null, titulo));
  });
  thead.appendChild(filaCabecera);
  tabla.appendChild(thead);

  const tbody = el("tbody");
  eventos.forEach((evento) => {
    const fila = el("tr");
    fila.appendChild(el("td", "propinas-celda-hora", horaConSegundos(evento.ocurrido_en)));
    fila.appendChild(el("td", "propinas-celda-monto", dinero(evento.monto)));

    const entre = evento.presentes.length || evento.reparto.length || 1;
    const celdaPersonas = el("td");
    const nombres = (evento.presentes.length ? evento.presentes : evento.reparto)
      .map((p) => personasPorId.get(String(p?.id || ""))?.nombre || String(p?.id || "desconocido"));
    nombres.forEach((nombre) => celdaPersonas.appendChild(el("span", "propinas-chip", nombre)));
    fila.appendChild(celdaPersonas);

    fila.appendChild(el("td", "propinas-celda-division", `${dinero(evento.monto)} ÷ ${entre}`));
    fila.appendChild(el("td", "propinas-celda-parte", dinero(evento.monto / entre)));
    tbody.appendChild(fila);
  });

  tabla.appendChild(tbody);

  const contenedor = el("div", "propinas-tabla-scroll");
  contenedor.appendChild(tabla);
  bloque.appendChild(contenedor);
  return bloque;
};

// ── Acumulado por persona ──────────────────────────────────────────────────

const pintarPorPersona = (personas, totalDia) => {
  const bloque = seccion(
    "3. Cuánto le quedó a cada uno",
    "La suma de todas las partes de cada persona a lo largo del turno."
  );

  const total = Number(totalDia) || personas.reduce((acc, p) => acc + p.total, 0);

  personas.forEach((persona) => {
    const proporcion = total > 0 ? (persona.total / total) * 100 : 0;
    const fila = el("div", "propinas-fila-persona");

    const cabecera = el("div", "propinas-fila-persona-cab");
    cabecera.appendChild(el("strong", null, persona.nombre));
    cabecera.appendChild(el("span", "propinas-cuenta",
      `${persona.propinas} propina${persona.propinas === 1 ? "" : "s"}`));
    cabecera.appendChild(el("span", "propinas-monto", dinero(persona.total)));
    fila.appendChild(cabecera);

    const pista = el("div", "propinas-pista");
    const relleno = el("div", `propinas-relleno propinas-relleno-${persona.tipo}`);
    relleno.style.width = `${Math.max(proporcion, 0)}%`;
    pista.appendChild(relleno);
    fila.appendChild(pista);

    fila.appendChild(el("span", "propinas-porcentaje", `${proporcion.toFixed(1)}% del total`));

    if (persona.soloEnTraza) {
      fila.appendChild(el("span", "propinas-aviso",
        "Aparece en el detalle pero no en el reparto oficial. Revísalo."));
    }

    bloque.appendChild(fila);
  });

  return bloque;
};

// ── Subtotales por bloque horario ──────────────────────────────────────────

const pintarPorBloques = (eventos) => {
  const bloque = seccion(
    "4. Propinas por franja de la noche",
    "El mismo dinero agrupado por hora, para ver en qué momentos entró."
  );

  if (!eventos.length) {
    bloque.appendChild(el("p", "propinas-vacio", "Sin propinas que agrupar."));
    return bloque;
  }

  const porHora = new Map();
  eventos.forEach((evento) => {
    const etiqueta = hora(evento.ocurrido_en).slice(0, 2) + ":00";
    if (!porHora.has(etiqueta)) porHora.set(etiqueta, { total: 0, cantidad: 0 });
    const acumulado = porHora.get(etiqueta);
    acumulado.total += evento.monto;
    acumulado.cantidad += 1;
  });

  const entradas = [...porHora.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const mayor = Math.max(...entradas.map(([, v]) => v.total), 1);

  entradas.forEach(([etiqueta, valores]) => {
    const fila = el("div", "propinas-fila-bloque");
    fila.appendChild(el("span", "propinas-bloque-hora", etiqueta));

    const pista = el("div", "propinas-pista");
    const relleno = el("div", "propinas-relleno propinas-relleno-bloque");
    relleno.style.width = `${(valores.total / mayor) * 100}%`;
    pista.appendChild(relleno);
    fila.appendChild(pista);

    fila.appendChild(el("span", "propinas-monto", dinero(valores.total)));
    fila.appendChild(el("span", "propinas-cuenta",
      `${valores.cantidad} propina${valores.cantidad === 1 ? "" : "s"}`));
    bloque.appendChild(fila);
  });

  return bloque;
};

// ── Cuadre ─────────────────────────────────────────────────────────────────

const pintarCuadre = (respuesta, eventos) => {
  const recibido = Number(respuesta?.total_propina_dia) || 0;
  const repartido = Number(respuesta?.total_propina_distribuida) || 0;
  const sumaTraza = eventos.reduce((acc, evento) => acc + evento.monto, 0);
  const cuadra = respuesta?.coinciden_totales === true || Math.abs(recibido - repartido) < 0.01;

  const bloque = el("div", `propinas-cuadre ${cuadra ? "propinas-cuadre-ok" : "propinas-cuadre-alerta"}`);

  const tarjeta = (titulo, valor) => {
    const t = el("div", "propinas-tarjeta");
    t.appendChild(el("span", "propinas-tarjeta-titulo", titulo));
    t.appendChild(el("strong", "propinas-tarjeta-valor", valor));
    return t;
  };

  bloque.appendChild(tarjeta("Propinas recibidas en el turno", dinero(recibido)));
  bloque.appendChild(tarjeta("Repartido entre el equipo", dinero(repartido)));
  bloque.appendChild(tarjeta(`Suma del detalle (${eventos.length})`, dinero(sumaTraza)));
  bloque.appendChild(el("p", "propinas-veredicto", cuadra
    ? "Todo lo recibido quedó repartido: las cifras cuadran."
    : `Atención: se recibieron ${dinero(recibido)} y se repartieron ${dinero(repartido)}. Revísalo antes de cerrar.`));

  return bloque;
};

// ── API pública ────────────────────────────────────────────────────────────

export function limpiarRepartoPropinas(contenedor) {
  if (!contenedor) return;
  contenedor.innerHTML = "";
  contenedor.classList.add("is-hidden");
}

/**
 * Pinta el desglose completo del reparto.
 *
 * @param {HTMLElement} contenedor  donde se dibuja.
 * @param {object} respuesta        salida de `consultar-propina-apoyos`.
 * @param {(id: string) => string} resolverNombre  id de persona -> nombre legible.
 */
export function renderRepartoPropinas(contenedor, respuesta, resolverNombre = (id) => id) {
  if (!contenedor) return;

  if (!respuesta) {
    limpiarRepartoPropinas(contenedor);
    return;
  }

  const eventos = normalizarEventos(respuesta?.eventos);
  const personas = construirPersonas(respuesta?.detalles, eventos, resolverNombre);
  const personasPorId = new Map(personas.map((p) => [p.id, p]));

  contenedor.innerHTML = "";
  contenedor.classList.remove("is-hidden");

  contenedor.appendChild(pintarCuadre(respuesta, eventos));

  if (!eventos.length) {
    // Sin traza no se puede explicar el reparto propina a propina. Decirlo, en
    // vez de mostrar secciones vacías que parecerían un reparto en cero.
    contenedor.appendChild(el("p", "propinas-vacio",
      "No se recibió el detalle propina a propina para este turno. Los totales de arriba siguen siendo válidos."));
    contenedor.appendChild(pintarPorPersona(personas, respuesta?.total_propina_dia));
    return;
  }

  contenedor.appendChild(pintarLineaTiempo(personas, eventos));
  contenedor.appendChild(pintarPropinaAPropina(eventos, personasPorId));
  contenedor.appendChild(pintarPorPersona(personas, respuesta?.total_propina_dia));
  contenedor.appendChild(pintarPorBloques(eventos));
}
