/**
 * facturacion.js — pantalla de facturación y ciclo de vida del cliente.
 *
 * Cubre todo lo que el cliente puede hacer con su suscripción:
 *
 *   · Activar su prueba gratuita de 15 días   (el botón es SUYO, no del admin)
 *   · Ver su plan, sus sedes y su vigencia
 *   · Contratar mensual o anual, y pagar en línea con Wompi
 *   · Consultar y descargar su historial de facturas
 *   · Descargar todos sus datos
 *   · Darse de baja, y retomar el plan después
 *
 * Referencias:
 *   docs/2026-08-24_plan_facturacion_multitenant.md
 *   docs/2026-08-25_plan_ciclo_de_vida_cliente.md
 *
 * Dos reglas que no se rompen:
 *
 *   1. Una factura NUNCA se marca pagada desde aquí. La redirección de vuelta
 *      de Wompi es cortesía visual; quien decide es el webhook wompi-eventos.
 *   2. Esta pantalla sigue accesible incluso con la cuenta bloqueada o dada de
 *      baja, porque es desde donde el cliente puede volver.
 *
 * ---------------------------------------------------------------------------
 * QUÉ OFERTA SE MUESTRA, Y POR QUÉ
 * ---------------------------------------------------------------------------
 * Antes había dos botones fijos —"Pagar ahora" y "Pagar el año (−20%)"— que en
 * el caso más común mostraban EL MISMO importe: si la factura pendiente ya era
 * anual, el segundo botón ofrecía el año que el cliente estaba a punto de
 * pagar. Ofrecer un descuento sobre algo que ya lo tiene aplicado no es un
 * problema de CSS, es una oferta que no existe.
 *
 * La regla real está en la base, en factura_a_pagar():
 *
 *   · periodicidad 'anual'  → EMITE una factura anual nueva, aunque haya
 *                             mensuales pendientes. Es una decisión explícita
 *                             del cliente, no un descuido.
 *   · cualquier otra cosa   → devuelve la factura viva más antigua; y solo si
 *                             no hay ninguna, emite una.
 *
 * Y emitir_factura_cuenta() arranca el periodo en cubierto_hasta + 1, y
 * reutiliza la factura viva si ya existe una para ese mismo periodo.
 *
 * Pero "hay una factura emitida" NO significa "el cliente debe dinero". El
 * 2026-08-27 se descubrió por qué: BATUT tenía AX-01004 emitida —anual, periodo
 * 2027-06-01 → 2028-05-31— estando al día y cubierta hasta 2027-05-31. Esa
 * factura no era deuda: era una RESERVA del periodo siguiente, emitida por el
 * botón defectuoso. Tratarla como cobro pendiente escondía el selector de
 * modalidad a un cliente que no debía nada.
 *
 * La distinción que gobierna esta pantalla:
 *
 *   EXIGIBLE       periodo_desde <= hoy, o está vencida, o la vigencia expiró.
 *                  Es deuda. Se paga y punto.
 *   ANTICIPADA     periodo_desde > hoy Y cubierto_hasta >= hoy.
 *                  No es deuda. Es una reserva, y se puede cambiar.
 *
 * De ahí salen cuatro situaciones:
 *
 *   A. FACTURA EXIGIBLE
 *      Un solo CTA, con su importe. Nada más: ofrecer aquí "el año con −20%"
 *      emitiría una segunda factura y dejaría las dos vivas, con dos cobros
 *      solapados.
 *
 *   B. RENOVACIÓN ANTICIPADA
 *      Se puede pagar, pero no corre prisa. Y se puede CAMBIAR de modalidad:
 *      cambiar_modalidad_factura() anula la reserva no pagada y emite la otra
 *      en una sola transacción, así que nunca quedan dos vivas.
 *
 *   C. SIN FACTURA VIVA (al día, o en prueba)
 *      Selector mensual/anual con los dos precios REALES. Lo que se contrate
 *      arranca cuando termine lo ya cubierto.
 *
 *   D. EXENTA, EN IMPLEMENTACIÓN O SIN ACTIVAR
 *      No se cobra nada todavía. No hay bloque de compra.
 *
 * El ahorro del anual NO está escrito en ninguna parte: se calcula restando el
 * precio anual real a doce mensualidades reales. Si algún día el descuento se
 * pone a cero, el distintivo de "mejor opción" desaparece solo.
 */
import { supabase } from "./supabase.js";
import { getSessionConEmpresa } from "./session.js";

const EMISOR = {
  nombre: "AXIOMA",
  descripcion: "Plataforma de gestión para restaurantes",
  contacto: "facturacion@enkrato.com",
};

/** Importe del cobro de prueba interno. Tiene que coincidir con el
 *  MONTO_PRUEBA de supabase/functions/pago-iniciar/index.ts: aquí solo se usa
 *  para comprobar que lo que respondió el servidor es lo que se esperaba. */
const MONTO_PRUEBA = 1000;

/* ── Formato ──────────────────────────────────────────────────────────────── */

const fmtMoney = (v) =>
  Number(v || 0).toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

const fmtDate = (v) => {
  if (!v) return "—";
  // Las fechas llegan como YYYY-MM-DD. Partirlas a mano evita el corrimiento
  // de un día que produce new Date("2026-08-31") al interpretarlo como UTC.
  const [a, m, d] = String(v).split("-").map(Number);
  if (!a || !m || !d) return "—";
  return new Date(a, m - 1, d).toLocaleDateString("es-CO", { day: "2-digit", month: "long", year: "numeric" });
};

/** Fecha corta para tablas y líneas apretadas: "31 may 2027". */
const fmtDateCorta = (v) => {
  if (!v) return "—";
  const [a, m, d] = String(v).split("-").map(Number);
  if (!a || !m || !d) return "—";
  return new Date(a, m - 1, d).toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });
};

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#39;");

const hoyISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const diasEntre = (desde, hasta) => {
  if (!desde || !hasta) return null;
  return Math.round((new Date(`${hasta}T00:00:00`) - new Date(`${desde}T00:00:00`)) / 86400000);
};

const plural = (n, sing, plur) => `${n} ${n === 1 ? sing : plur}`;

/* ── Reglas de negocio del bloque de compra ───────────────────────────────── */

/**
 * Qué modalidad es una factura, deducida de su periodo.
 *
 * No hay columna 'periodicidad' en facturas_suscripcion: el periodo ES el
 * dato. Un mes va de 28 a 31 días; un año, 365. El corte en 300 deja margen de
 * sobra para prorrateos y años bisiestos sin poder confundirse.
 */
function periodicidadDeFactura(factura) {
  if (!factura) return null;
  if (String(factura.numero || "").startsWith("AX-TEST-")) return "prueba";
  const dias = diasEntre(factura.periodo_desde, factura.periodo_hasta);
  if (dias == null) return null;
  return dias >= 300 ? "anual" : "mensual";
}

const ETIQUETA_PERIODICIDAD = {
  mensual: "Mensual",
  anual: "Anual",
  prueba: "Prueba técnica",
};

/**
 * El ahorro del pago anual, calculado — nunca escrito a mano.
 *
 * Devuelve null si no hay ahorro real: sin descuento configurado, el anual deja
 * de presentarse como la mejor opción por sí solo, sin tocar este archivo.
 */
function calcularAhorroAnual(totalMensual, totalAnual) {
  const mes = Number(totalMensual || 0);
  const anio = Number(totalAnual || 0);
  if (!(mes > 0) || !(anio > 0)) return null;

  const docePagos = mes * 12;
  const ahorro = docePagos - anio;
  if (ahorro <= 0) return null;

  return {
    docePagos,
    ahorro,
    pct: Math.round((ahorro / docePagos) * 100),
    equivalenteMes: Math.round(anio / 12),
  };
}

/** La factura viva que toca pagar, si la hay. */
function facturaPendiente(facturacion) {
  const facturas = Array.isArray(facturacion?.facturas) ? facturacion.facturas : [];
  return facturas.find((f) => f.estado === "emitida" || f.estado === "vencida") || null;
}

/**
 * ¿Es deuda o es una reserva?
 *
 * Réplica exacta del candado de cambiar_modalidad_factura() en la base: solo
 * son cambiables las facturas 'emitida' cuyo periodo aún no ha empezado. Si
 * esta función y aquel candado se separaran, la pantalla ofrecería un botón
 * que el servidor rechaza.
 */
function clasificarFactura(factura, suscripcion) {
  if (!factura) return null;
  const hoy = hoyISO();

  // Una vencida es deuda por definición, empiece cuando empiece.
  if (factura.estado !== "emitida") return "exigible";

  // Si el periodo ya arrancó, se está usando el servicio: hay que pagarlo.
  if (!factura.periodo_desde || factura.periodo_desde <= hoy) return "exigible";

  // Periodo futuro pero sin vigencia cubierta: el servicio se corta antes de
  // que empiece esa factura. Tratarla como reserva dejaría un hueco sin pagar.
  const cubierto = suscripcion?.cubierto_hasta && suscripcion.cubierto_hasta >= hoy;
  const enPrueba = suscripcion?.prueba_hasta && suscripcion.prueba_hasta >= hoy;
  if (!cubierto && !enPrueba) return "exigible";

  return "anticipada";
}

/* ── Datos ────────────────────────────────────────────────────────────────── */

const estado = {
  facturacion: null,
  acceso: null,
  empresaId: null,
  /** Modalidad elegida en el selector. Solo se usa cuando NO hay pendiente. */
  ciclo: "anual",
  esSuperadmin: false,
  /** El aviso de vuelta de Wompi se programa una sola vez, no en cada repintado. */
  retornoProgramado: false,
};

async function cargarTodo(empresaId) {
  const [fact, acc] = await Promise.all([
    supabase.rpc("estado_facturacion_empresa", { p_empresa_id: empresaId || null }),
    supabase.rpc("acceso_de_empresa", { p_empresa_id: empresaId || null }),
  ]);
  if (fact.error) throw fact.error;
  if (acc.error) throw acc.error;
  estado.facturacion = fact.data;
  estado.acceso = acc.data;
}

/* ── Bloques ──────────────────────────────────────────────────────────────── */

/**
 * El cartel de activación. Es la pieza que faltaba del alta: hasta ahora el
 * reloj de la prueba lo arrancaba un administrador, y eso hacía que el cliente
 * dependiera de nosotros para empezar.
 */
function renderActivacion() {
  const s = estado.facturacion?.suscripcion;
  const cuenta = estado.facturacion?.cuenta;
  if (!s || cuenta?.tipo !== "cliente") return "";

  const hoy = hoyISO();
  const limite = estado.acceso?.activacion_limite;

  // Ya usó su prueba o ya paga: no hay nada que activar.
  if (s.prueba_hasta || s.cubierto_hasta) return "";

  if (s.estado === "implementacion") {
    return `
      <section class="fx-card fx-card--aviso">
        <h2 class="fx-card-title">Estamos montando tu servicio</h2>
        <p>
          Tu cuenta está en implementación. <strong>Todavía no corre ningún reloj</strong>:
          tus 15 días de prueba empezarán el día que tú los actives, cuando el
          montaje esté listo.
        </p>
        <p class="fx-muted">Te avisaremos en cuanto puedas empezar.</p>
      </section>`;
  }

  if (s.estado !== "registrada") return "";

  const restantes = limite ? diasEntre(hoy, limite) : null;
  const urge = restantes != null && restantes <= 7;

  return `
    <section class="fx-card fx-activacion${urge ? " fx-activacion--urgente" : ""}">
      <span class="fx-eyebrow">Empieza aquí</span>
      <h2 class="fx-card-title">Activa tu prueba gratuita de 15 días</h2>
      <p>
        El reloj arranca en el momento en que pulses el botón, no antes.
        No te pedimos tarjeta.
      </p>
      ${limite ? `
        <p class="${urge ? "fx-alerta" : "fx-muted"}">
          Tienes hasta el <strong>${fmtDate(limite)}</strong> para activarla${
            restantes != null ? ` — te ${restantes === 1 ? "queda" : "quedan"} ${plural(restantes, "día", "días")}` : ""
          }.
        </p>` : ""}
      <div class="fx-acciones">
        <button type="button" class="fx-btn fx-btn--primario" data-accion="activar">
          Activar mi prueba
        </button>
      </div>
      <p class="fx-muted">
        Al terminar: ${fmtMoney(estado.facturacion?.precio_mensual?.total)} al mes,
        con la primera factura prorrateada hasta fin de mes.
      </p>
      <p id="estadoActivacion" class="fx-estado" role="status" aria-live="polite"></p>
    </section>`;
}

/** Aviso cuando la cuenta está limitada: explica por qué y cómo salir. */
function renderAvisoAcceso() {
  const a = estado.acceso;
  if (!a || a.nivel === "total") return "";

  const esCancelada = a.motivo === "cuenta_cancelada";

  return `
    <section class="fx-card fx-card--alerta">
      <h2 class="fx-card-title">${esCancelada ? "Tu servicio está dado de baja" : "Tu cuenta está en pausa"}</h2>
      <p>${escapeHtml(a.mensaje || "")}</p>
      ${esCancelada ? `
        <div class="fx-acciones">
          <button type="button" class="fx-btn fx-btn--primario" data-accion="reactivar">Retomar mi plan</button>
        </div>
        <p class="fx-muted">Recuperas toda tu información tal y como la dejaste.</p>
      ` : `
        <p class="fx-muted">
          Escríbenos a ${escapeHtml(EMISOR.contacto)} y reabrimos tu cuenta enseguida.
        </p>`}
      <p id="estadoAcceso" class="fx-estado" role="status" aria-live="polite"></p>
    </section>`;
}

function insigniaEstado() {
  const { suscripcion: s, cuenta, al_dia: alDia } = estado.facturacion;
  const hoy = hoyISO();

  if (cuenta?.tipo !== "cliente") {
    return { clase: "fx-badge fx-badge--ok", texto: "Cuenta exenta", detalle: "Esta cuenta no genera cobros." };
  }
  if (!s) return { clase: "fx-badge", texto: "Sin suscripción", detalle: "" };

  if (s.estado === "cancelada") {
    return { clase: "fx-badge fx-badge--warn", texto: "Dada de baja", detalle: "" };
  }
  if (s.estado === "implementacion") {
    return { clase: "fx-badge", texto: "En implementación", detalle: "" };
  }
  if (s.estado === "registrada") {
    return { clase: "fx-badge", texto: "Sin activar", detalle: "" };
  }
  if (s.prueba_hasta && s.prueba_hasta >= hoy) {
    const restan = diasEntre(hoy, s.prueba_hasta);
    return {
      clase: "fx-badge fx-badge--ok",
      texto: `Prueba · ${plural(restan, "día", "días")}`,
      detalle: `Tu prueba gratuita termina el ${fmtDate(s.prueba_hasta)}.`,
    };
  }
  if (s.cubierto_hasta && s.cubierto_hasta >= hoy) {
    return {
      clase: "fx-badge fx-badge--ok",
      texto: "Al día",
      detalle: `Tu servicio está cubierto hasta el ${fmtDate(s.cubierto_hasta)}.`,
    };
  }
  if (alDia) return { clase: "fx-badge fx-badge--ok", texto: "Al día", detalle: "No tienes cobros vencidos." };

  return {
    clase: "fx-badge fx-badge--warn",
    texto: "Pago pendiente",
    detalle: "Tienes una factura vencida. Puedes pagarla aquí mismo.",
  };
}

/**
 * Cabecera de cuenta: quién eres, cómo estás y las cuatro cifras que resumen
 * tu suscripción. Deliberadamente ligera — el peso visual es del bloque de
 * compra que viene debajo.
 */
function renderCabecera() {
  const e = estado.facturacion;
  const badge = insigniaEstado();
  const sedes = Array.isArray(e.sedes) ? e.sedes : [];
  const s = e.suscripcion;

  const datos = [
    { etiqueta: "Plan", valor: String(s?.plan_id || "—").toUpperCase() },
    { etiqueta: "Sedes activas", valor: String(sedes.length) },
    { etiqueta: "Cubierto hasta", valor: s?.cubierto_hasta ? fmtDateCorta(s.cubierto_hasta) : "—" },
    { etiqueta: "Renovación", valor: s?.renovacion_automatica ? "Automática" : "Manual" },
  ];

  return `
    <section class="fx-card fx-cuenta">
      <div class="fx-cuenta-top">
        <div class="fx-cuenta-id">
          <h2 class="fx-cuenta-nombre">${escapeHtml(e.cuenta?.nombre || "Tu cuenta")}</h2>
          <p class="fx-muted">NIT ${escapeHtml(e.cuenta?.nit || "—")}</p>
        </div>
        <span class="${badge.clase}">${escapeHtml(badge.texto)}</span>
      </div>

      ${badge.detalle ? `<p class="fx-cuenta-detalle">${escapeHtml(badge.detalle)}</p>` : ""}

      <dl class="fx-cifras">
        ${datos.map((d) => `
          <div class="fx-cifra">
            <dt>${escapeHtml(d.etiqueta)}</dt>
            <dd>${escapeHtml(d.valor)}</dd>
          </div>`).join("")}
      </dl>

      ${sedes.length ? `
        <ul class="fx-sedes">
          ${sedes.map((x) => `
            <li>
              <span class="fx-sede-punto" aria-hidden="true"></span>
              ${escapeHtml(x.nombre)}${x.principal ? ' <span class="fx-sede-tag">principal</span>' : ""}
            </li>`).join("")}
        </ul>` : ""}
    </section>`;
}

/**
 * CASO B — renovación anticipada. No es deuda: es una reserva del periodo
 * siguiente, y el cliente puede cambiarla de modalidad o pagarla ya.
 */
function renderRenovacionAnticipada(factura) {
  const e = estado.facturacion;
  const s = e.suscripcion;
  const modalidad = periodicidadDeFactura(factura);
  const otra = modalidad === "anual" ? "mensual" : "anual";
  const mensual = e.precio_mensual || {};
  const anual = e.precio_anual || {};
  const precioOtra = otra === "anual" ? anual : mensual;
  const ahorro = calcularAhorroAnual(mensual.total, anual.total);

  return `
    <section class="fx-card fx-compra fx-compra--reserva">
      <div class="fx-compra-head">
        <div>
          <span class="fx-eyebrow">Renovación reservada</span>
          <h2 class="fx-card-title">Factura ${escapeHtml(factura.numero)}</h2>
        </div>
        ${modalidad ? `<span class="fx-badge fx-badge--modalidad">${ETIQUETA_PERIODICIDAD[modalidad] || ""}</span>` : ""}
      </div>

      <p class="fx-compra-sub">
        Tu servicio está cubierto hasta el <strong>${fmtDate(s?.cubierto_hasta)}</strong>.
        Esto es lo que se cobrará después: <strong>no vence hasta el
        ${fmtDate(factura.fecha_limite_pago)}</strong>, así que no hay prisa.
      </p>

      <div class="fx-precio-bloque">
        <p class="fx-precio">
          ${fmtMoney(factura.total)}
          <span class="fx-precio-ciclo">${modalidad === "anual" ? "/ año" : "/ mes"}</span>
        </p>
        <p class="fx-precio-nota">
          Cubre del ${fmtDateCorta(factura.periodo_desde)} al ${fmtDateCorta(factura.periodo_hasta)}.
        </p>
      </div>

      <div class="fx-cambio">
        <p class="fx-cambio-titulo">¿Prefieres la otra modalidad?</p>
        <div class="fx-selector" role="group" aria-label="Modalidad reservada">
          <button type="button" class="fx-selector-op${modalidad === "mensual" ? " is-activo" : ""}"
                  ${modalidad === "mensual" ? "disabled aria-pressed=\"true\"" : 'data-modalidad="mensual" aria-pressed="false"'}>
            Mensual
            <span class="fx-selector-precio">${fmtMoney(mensual.total)}</span>
          </button>
          <button type="button" class="fx-selector-op${modalidad === "anual" ? " is-activo" : ""}"
                  ${modalidad === "anual" ? "disabled aria-pressed=\"true\"" : 'data-modalidad="anual" aria-pressed="false"'}>
            Anual
            <span class="fx-selector-precio">${fmtMoney(anual.total)}</span>
            ${ahorro ? `<span class="fx-selector-tag">−${ahorro.pct}%</span>` : ""}
          </button>
        </div>
        <p class="fx-muted">
          Cambiar a ${otra} sustituye esta factura por una de
          ${fmtMoney(precioOtra.total)}. No se te cobra nada al cambiar
          ${otra === "anual" && ahorro ? `, y el anual ahorra ${fmtMoney(ahorro.ahorro)} al año` : ""}.
        </p>
        <p id="estadoModalidad" class="fx-estado" role="status" aria-live="polite"></p>
      </div>

      <div class="fx-acciones fx-acciones--principal">
        <button type="button" class="fx-btn fx-btn--primario fx-btn--grande"
                data-pago="pendiente" data-total="${Number(factura.total)}">
          Pagar ahora ${fmtMoney(factura.total)}
        </button>
      </div>

      ${renderConfianza()}
      <p id="estadoPago" class="fx-estado" role="status" aria-live="polite"></p>
    </section>`;
}

/**
 * CASO A — factura exigible. Es deuda y es lo único que se puede hacer.
 */
function renderFacturaPendiente(pendiente) {
  const modalidad = periodicidadDeFactura(pendiente);
  const vencida = pendiente.fecha_limite_pago < hoyISO();
  const dias = diasEntre(hoyISO(), pendiente.fecha_limite_pago);

  // Qué se le dice al cliente sobre la otra modalidad. Ninguna de las dos ramas
  // pinta un botón: el periodo de esta factura ya empezó, así que cambiarla
  // dejaría sin cubrir los días ya consumidos.
  const notaModalidad = modalidad === "anual"
    ? `Esta factura ya cubre <strong>un año completo</strong> con el descuento aplicado.
       No hay nada más que contratar hasta el ${fmtDate(pendiente.periodo_hasta)}.`
    : `¿Prefieres el plan anual? Paga esta factura: al renovar podrás elegir
       anual, y te lo recordaremos antes del ${fmtDate(pendiente.periodo_hasta)}.`;

  return `
    <section class="fx-card fx-compra fx-compra--factura${vencida ? " fx-compra--vencida" : ""}">
      <div class="fx-compra-head">
        <div>
          <span class="fx-eyebrow">${vencida ? "Pago vencido" : "Pago pendiente"}</span>
          <h2 class="fx-card-title">Factura ${escapeHtml(pendiente.numero)}</h2>
        </div>
        ${modalidad ? `<span class="fx-badge fx-badge--modalidad">${ETIQUETA_PERIODICIDAD[modalidad] || ""}</span>` : ""}
      </div>

      <div class="fx-precio-bloque">
        <p class="fx-precio">${fmtMoney(pendiente.total)}</p>
        <p class="fx-precio-nota">
          ${modalidad === "anual" ? "por 12 meses de servicio" : "por el periodo facturado"}
        </p>
      </div>

      <dl class="fx-detalle-factura">
        <div><dt>Periodo</dt><dd>${fmtDateCorta(pendiente.periodo_desde)} — ${fmtDateCorta(pendiente.periodo_hasta)}</dd></div>
        <div><dt>Fecha de corte</dt><dd>${fmtDateCorta(pendiente.fecha_corte)}</dd></div>
        <div><dt>Límite de pago</dt><dd>${fmtDateCorta(pendiente.fecha_limite_pago)}</dd></div>
      </dl>

      ${vencida
        ? `<p class="fx-alerta">Esta factura pasó su fecha límite el ${fmtDate(pendiente.fecha_limite_pago)}.</p>`
        : (dias != null && dias >= 0 && dias <= 15
            ? `<p class="fx-muted">Te ${dias === 1 ? "queda" : "quedan"} ${plural(dias, "día", "días")} para pagarla.</p>`
            : "")}

      <div class="fx-acciones fx-acciones--principal">
        <button type="button" class="fx-btn fx-btn--primario fx-btn--grande"
                data-pago="pendiente" data-total="${Number(pendiente.total)}">
          Pagar ${fmtMoney(pendiente.total)}
        </button>
      </div>

      <p class="fx-nota-modalidad">${notaModalidad}</p>

      ${renderConfianza()}

      ${pendiente.total_en_letras
        ? `<p class="fx-letras">${escapeHtml(pendiente.total_en_letras)}</p>` : ""}

      <p id="estadoPago" class="fx-estado" role="status" aria-live="polite"></p>
    </section>`;
}

/**
 * CASO B — sin factura viva. Aquí sí caben las dos modalidades, porque lo que
 * se contrate arranca cuando termine lo ya cubierto y no solapa con nada.
 */
function renderOferta() {
  const e = estado.facturacion;
  const s = e.suscripcion;
  const mensual = e.precio_mensual || {};
  const anual = e.precio_anual || {};
  const ahorro = calcularAhorroAnual(mensual.total, anual.total);

  const enPrueba = s?.prueba_hasta && s.prueba_hasta >= hoyISO();
  const cubierto = s?.cubierto_hasta && s.cubierto_hasta >= hoyISO();

  // Desde cuándo correría lo que contrate. Réplica de la regla de
  // emitir_factura_cuenta(): cubierto_hasta + 1, o fin de prueba + 1.
  const arranque = cubierto ? s.cubierto_hasta : (enPrueba ? s.prueba_hasta : null);

  const encabezado = cubierto
    ? { titulo: "Adelanta tu renovación", sub: `Tu servicio está cubierto hasta el ${fmtDate(s.cubierto_hasta)}. Lo que pagues ahora empieza al día siguiente.` }
    : enPrueba
      ? { titulo: "Elige tu plan", sub: `Tu prueba termina el ${fmtDate(s.prueba_hasta)}. Contrata ahora y no se te interrumpe el servicio.` }
      : { titulo: "Elige tu plan", sub: "Sin permanencia. Puedes cambiar de modalidad o darte de baja cuando quieras." };

  const ciclo = estado.ciclo === "mensual" ? "mensual" : "anual";
  const elegido = ciclo === "mensual" ? mensual : anual;

  return `
    <section class="fx-card fx-compra fx-compra--oferta">
      <div class="fx-compra-head">
        <div>
          <span class="fx-eyebrow">Tu suscripción</span>
          <h2 class="fx-card-title">${escapeHtml(encabezado.titulo)}</h2>
        </div>
      </div>
      <p class="fx-compra-sub">${encabezado.sub}</p>

      <div class="fx-selector" role="group" aria-label="Modalidad de pago">
        <button type="button" class="fx-selector-op${ciclo === "mensual" ? " is-activo" : ""}"
                data-ciclo="mensual" aria-pressed="${ciclo === "mensual"}">
          Mensual
        </button>
        <button type="button" class="fx-selector-op${ciclo === "anual" ? " is-activo" : ""}"
                data-ciclo="anual" aria-pressed="${ciclo === "anual"}">
          Anual
          ${ahorro ? `<span class="fx-selector-tag">−${ahorro.pct}%</span>` : ""}
        </button>
      </div>

      <div class="fx-precio-bloque">
        <p class="fx-precio">
          ${fmtMoney(elegido.total)}
          <span class="fx-precio-ciclo">${ciclo === "mensual" ? "/ mes" : "/ año"}</span>
        </p>
        ${ciclo === "anual" && ahorro ? `
          <p class="fx-precio-nota">
            Equivale a <strong>${fmtMoney(ahorro.equivalenteMes)} al mes</strong>.
            Pagando mes a mes serían ${fmtMoney(ahorro.docePagos)} al año.
          </p>
          <p class="fx-ahorro">Ahorras ${fmtMoney(ahorro.ahorro)} al año</p>
        ` : `
          <p class="fx-precio-nota">
            Se factura cada mes.${ahorro ? ` El plan anual sale a ${fmtMoney(ahorro.equivalenteMes)} al mes.` : ""}
          </p>`}
        ${arranque ? `<p class="fx-muted">Empieza el ${fmtDate(sumarUnDia(arranque))}.</p>` : ""}
      </div>

      <div class="fx-acciones fx-acciones--principal">
        <button type="button" class="fx-btn fx-btn--primario fx-btn--grande"
                data-pago="${ciclo}" data-total="${Number(elegido.total || 0)}">
          ${ciclo === "mensual" ? `Contratar mensual — ${fmtMoney(mensual.total)}` : `Contratar anual — ${fmtMoney(anual.total)}`}
        </button>
      </div>

      ${renderIncluye()}
      ${renderConfianza()}

      <p id="estadoPago" class="fx-estado" role="status" aria-live="polite"></p>
    </section>`;
}

/** Un día más, en ISO. Para decir desde cuándo corre lo que se contrata. */
function sumarUnDia(iso) {
  const [a, m, d] = String(iso).split("-").map(Number);
  const fecha = new Date(a, m - 1, d + 1);
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}-${String(fecha.getDate()).padStart(2, "0")}`;
}

/**
 * Qué incluye el plan.
 *
 * Todo lo que se lista aquí existe y es verificable en el código: las sedes
 * salen de calcular_monto_cuenta(), los medios de pago de la integración con
 * Wompi, la descarga de exportar-datos y la baja de solicitar_baja(). No hay
 * ninguna promesa de adorno.
 */
function renderIncluye() {
  const e = estado.facturacion;
  const mensual = e.precio_mensual || {};
  const sedes = Number(mensual.sedes || 0);
  const adicionales = Number(mensual.adicionales || 0);

  const puntos = [
    sedes > 0
      ? `${plural(sedes, "sede activa", "sedes activas")}${adicionales > 0 ? ` (${plural(adicionales, "local adicional facturado", "locales adicionales facturados")})` : " incluidas en el plan"}`
      : "Tu sede principal incluida",
    "Cierre de turno, inventarios, compras y nómina",
    "Tarjeta de crédito o débito, PSE, Nequi y Bancolombia",
    "Tu factura se marca pagada sola en cuanto el banco confirma",
    "Descarga de todos tus datos cuando quieras",
    "Sin permanencia: puedes darte de baja en cualquier momento",
  ];

  return `
    <ul class="fx-incluye">
      ${puntos.map((p) => `
        <li><i class="ph ph-check-circle" aria-hidden="true"></i>${escapeHtml(p)}</li>`).join("")}
    </ul>`;
}

/** La línea de confianza que acompaña a todo CTA de pago. */
function renderConfianza() {
  return `
    <p class="fx-confianza">
      <i class="ph ph-shield-check" aria-hidden="true"></i>
      Pago seguro con <strong>Wompi</strong> (Bancolombia). No guardamos los datos de tu tarjeta.
    </p>`;
}

/** Reparte entre los cuatro casos. */
function renderCompra() {
  const e = estado.facturacion;
  const s = e.suscripcion;

  // CASO D: exenta, en montaje o sin activar. Nada que cobrar todavía.
  if (e.cuenta?.tipo !== "cliente") return "";
  if (!s || ["implementacion", "registrada"].includes(s.estado)) return "";

  const pendiente = facturaPendiente(e);
  if (!pendiente) return renderOferta();                       // CASO C

  return clasificarFactura(pendiente, s) === "anticipada"
    ? renderRenovacionAnticipada(pendiente)                    // CASO B
    : renderFacturaPendiente(pendiente);                       // CASO A
}

/**
 * El desglose del cálculo. Va colapsado a propósito: es información de
 * respaldo, y antes competía en peso visual con el precio.
 */
function renderCalculo() {
  const e = estado.facturacion;
  if (e.cuenta?.tipo !== "cliente") return "";

  const mensual = e.precio_mensual || {};
  const anual = e.precio_anual || {};
  const ahorro = calcularAhorroAnual(mensual.total, anual.total);
  const detalle = Array.isArray(mensual.detalle) ? mensual.detalle : [];
  if (!detalle.length) return "";

  return `
    <details class="fx-card fx-desglose">
      <summary>
        <span>Cómo se calcula tu plan</span>
        <span class="fx-desglose-resumen">
          ${fmtMoney(mensual.total)}/mes · ${fmtMoney(anual.total)}/año${ahorro ? ` (−${ahorro.pct}%)` : ""}
        </span>
      </summary>
      <div class="fx-tabla-scroll">
        <table class="fx-tabla">
          <thead><tr><th>Concepto</th><th>Cant.</th><th>Valor</th><th>Total</th></tr></thead>
          <tbody>
            ${detalle.map((d) => `
              <tr>
                <td>${escapeHtml(d.concepto)}</td>
                <td>${escapeHtml(d.cantidad ?? "")}</td>
                <td>${d.valor_unitario == null ? "—" : fmtMoney(d.valor_unitario)}</td>
                <td>${fmtMoney(d.total)}</td>
              </tr>`).join("")}
          </tbody>
          <tfoot>
            <tr><th colspan="3">Total mensual</th><td>${fmtMoney(mensual.total)}</td></tr>
            <tr><th colspan="3">Total anual${ahorro ? ` (−${ahorro.pct}%)` : ""}</th><td>${fmtMoney(anual.total)}</td></tr>
          </tfoot>
        </table>
      </div>
    </details>`;
}

function renderHistorial() {
  const facturas = Array.isArray(estado.facturacion.facturas) ? estado.facturacion.facturas : [];
  if (!facturas.length) return "";

  const etiqueta = { emitida: "Pendiente", pagada: "Pagada", vencida: "Vencida", anulada: "Anulada" };
  const clase = { pagada: "fx-badge--ok", vencida: "fx-badge--warn", anulada: "fx-badge--mudo" };

  return `
    <details class="fx-card fx-desglose">
      <summary>
        <span>Historial de facturas</span>
        <span class="fx-desglose-resumen">${plural(facturas.length, "factura", "facturas")}</span>
      </summary>
      <div class="fx-tabla-scroll">
        <table class="fx-tabla">
          <thead><tr><th>Número</th><th>Periodo</th><th>Corte</th><th>Total</th><th>Estado</th></tr></thead>
          <tbody>
            ${facturas.map((f) => `
              <tr>
                <td>${escapeHtml(f.numero)}</td>
                <td>${fmtDateCorta(f.periodo_desde)} — ${fmtDateCorta(f.periodo_hasta)}</td>
                <td>${fmtDateCorta(f.fecha_corte)}</td>
                <td>${fmtMoney(f.total)}</td>
                <td><span class="fx-badge ${clase[f.estado] || ""}">${escapeHtml(etiqueta[f.estado] || f.estado)}</span></td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </details>`;
}

/** Descarga de datos y baja. Ambas viven juntas a propósito: quien se plantea
 *  irse debe encontrar el botón de llevarse su información al lado. */
function renderGestion() {
  const e = estado.facturacion;
  const s = e.suscripcion;
  if (e.cuenta?.tipo !== "cliente") return "";

  const cancelada = s?.estado === "cancelada";

  return `
    <section class="fx-card fx-gestion">
      <h2 class="fx-card-title fx-card-title--sm">Tus datos y tu suscripción</h2>
      <p class="fx-muted">
        Puedes descargar toda tu información cuando quieras, la conserves o no
        con nosotros.
      </p>
      <div class="fx-acciones">
        <button type="button" class="fx-btn fx-btn--suave" data-accion="exportar">Descargar mis datos</button>
        ${cancelada ? "" : `<button type="button" class="fx-btn fx-btn--texto" data-accion="baja">Dar de baja el servicio</button>`}
      </div>
      <p id="estadoGestion" class="fx-estado" role="status" aria-live="polite"></p>
    </section>`;
}

/**
 * Herramienta interna: cobro de prueba de $1.000.
 *
 * Solo se pinta para superadministradores de plataforma. Y esconderlo NO es la
 * protección: la de verdad está en pago-iniciar, que exige superadmin Y el
 * interruptor PAGO_PRUEBA_ACTIVA=1 en los secretos del servidor. Si un cliente
 * fabricara la llamada a mano, recibiría un 403.
 */
function renderPruebaPago() {
  if (!estado.esSuperadmin) return "";

  return `
    <section class="fx-card fx-interno">
      <span class="fx-eyebrow fx-eyebrow--interno">Solo plataforma</span>
      <h2 class="fx-card-title fx-card-title--sm">Cobro de prueba — $ 1.000</h2>
      <p class="fx-muted">
        Emite una factura simbólica contra la cuenta <strong>banco de pruebas</strong>
        y abre el checkout real de Wompi. Sirve para verificar el circuito
        completo — checkout, pago, webhook, vigencia — sin tocar el precio
        comercial ni a ningún cliente.
      </p>
      <div class="fx-acciones">
        <button type="button" class="fx-btn fx-btn--suave" data-accion="prueba-pago">
          Iniciar cobro de prueba
        </button>
      </div>
      <p class="fx-muted">
        Requiere <code>PAGO_PRUEBA_ACTIVA=1</code> en los secretos de Supabase.
        Sin ese interruptor la llamada devuelve 403, también para ti.
      </p>
      <p id="estadoPrueba" class="fx-estado" role="status" aria-live="polite"></p>
    </section>`;
}

function renderPie() {
  return `
    <footer class="fx-pie">
      <p><strong>${escapeHtml(EMISOR.nombre)}</strong> — ${escapeHtml(EMISOR.descripcion)}</p>
      <p>Dudas sobre tu factura: <a href="mailto:${escapeHtml(EMISOR.contacto)}">${escapeHtml(EMISOR.contacto)}</a></p>
      <p class="fx-muted">
        Este documento es el detalle de tu suscripción, no una factura electrónica
        de venta con validez ante la DIAN.
        <a href="../legal/terminos.html" target="_blank" rel="noopener noreferrer">Términos y condiciones</a>.
      </p>
    </footer>`;
}

/**
 * Aviso de vuelta desde Wompi.
 *
 * Wompi redirige con ?id=<transacción>. Deliberadamente NO consultamos esa
 * transacción para dar el pago por bueno: quien decide es el webhook.
 */
function renderRetornoPago() {
  const id = new URLSearchParams(window.location.search).get("id");
  if (!id) return "";

  // El temporizador se arma una sola vez. Antes se rearmaba en cada repintado,
  // y con el selector de modalidad eso serían varias recargas encadenadas.
  if (!estado.retornoProgramado) {
    estado.retornoProgramado = true;
    window.setTimeout(() => {
      const limpia = new URL(window.location.href);
      limpia.search = "";
      window.location.replace(limpia.toString());
    }, 6000);
  }

  return `
    <section class="fx-card fx-card--aviso">
      <h2 class="fx-card-title">Estamos confirmando tu pago…</h2>
      <p>
        Wompi nos está enviando la confirmación. Esta página se actualizará sola
        en unos segundos. No hace falta que pagues otra vez.
      </p>
      <p class="fx-muted">Referencia de la transacción: ${escapeHtml(id)}</p>
    </section>`;
}

/* ── Acciones ─────────────────────────────────────────────────────────────── */

const decirEn = (id, texto) => {
  const el = document.getElementById(id);
  if (el) el.textContent = texto;
};

/**
 * Saca el mensaje útil de un error de supabase.functions.invoke().
 *
 * invoke() NO lanza con el cuerpo de la respuesta. Lanza un FunctionsHttpError
 * cuyo `.message` es siempre el mismo texto genérico —"Edge Function returned a
 * non-2xx status code"— y deja la Response entera en `.context`. El mensaje que
 * la función escribió con cuidado ({ ok:false, codigo, message }) se queda ahí
 * dentro y nunca llega al usuario si no se lee a mano.
 *
 * Eso es lo que hacía que un 403 perfectamente explicado ("el cobro de prueba
 * está apagado") se viera en pantalla como una cadena en inglés sin pistas.
 */
async function mensajeDeError(error, porDefecto) {
  const respuesta = error?.context;

  if (respuesta && typeof respuesta.json === "function") {
    try {
      const cuerpo = await respuesta.json();
      if (cuerpo?.message) return String(cuerpo.message);
    } catch (_error) {
      // Cuerpo vacío, no-JSON, o ya consumido. Se cae al genérico de abajo.
    }
  }

  // Un fallo de red o de sesión sí trae un mensaje propio que vale la pena
  // enseñar; el de la Edge Function no dice nada y se sustituye.
  const propio = String(error?.message || "");
  if (propio && !propio.includes("non-2xx")) return propio;

  return porDefecto;
}

const bloquearBotones = (bloquear) => {
  document.querySelectorAll("[data-pago], [data-accion]")
    .forEach((b) => { b.disabled = bloquear; });
};

async function activarPrueba() {
  const ok = window.confirm(
    "Vas a activar tus 15 días de prueba gratuita.\n\n" +
    "El tiempo empieza a contar desde este momento, así que actívala cuando " +
    "estés listo para empezar a usar la plataforma.",
  );
  if (!ok) return;

  bloquearBotones(true);
  decirEn("estadoActivacion", "Activando…");
  try {
    const { data, error } = await supabase.rpc("activar_prueba_cliente", { p_dias: 15 });
    if (error) throw error;
    decirEn("estadoActivacion", `Listo. Tu prueba va hasta el ${fmtDate(data?.prueba_hasta)}.`);
    await refrescar();
  } catch (error) {
    console.error("[facturacion] activar_prueba_cliente", error);
    decirEn("estadoActivacion", error?.message || "No se pudo activar la prueba.");
    bloquearBotones(false);
  }
}

/**
 * Inicia el cobro.
 *
 * @param eleccion  "pendiente" → paga la factura viva tal cual está;
 *                  "mensual" / "anual" → contrata esa modalidad.
 *
 * "pendiente" viaja como 'mensual' porque es lo que factura_a_pagar() entiende
 * por "dame la factura viva más antigua, no emitas una anual nueva". El nombre
 * del parámetro en la base es engañoso para este caso; el que se manda desde
 * aquí no lo es.
 */
async function pagar(eleccion, totalEsperado) {
  const periodicidad = eleccion === "anual" ? "anual" : "mensual";

  bloquearBotones(true);
  decirEn("estadoPago", "Preparando tu pago…");
  try {
    const { data, error } = await supabase.functions.invoke("pago-iniciar", {
      body: { periodicidad },
    });
    if (error) throw error;
    if (!data?.ok || !data.url_pago) {
      decirEn("estadoPago", data?.message || "No se pudo iniciar el pago.");
      bloquearBotones(false);
      return;
    }

    // El botón decía un importe; el servidor decide cuál se cobra de verdad.
    // Si no coinciden —porque el estado cambió entre el repintado y el clic, o
    // porque el despliegue del servidor no es el que espera esta pantalla— NO
    // se redirige: se recarga el estado y que el cliente vuelva a decidir.
    // Nadie debe llegar a Wompi con un importe que no vio.
    const cobrado = Number(data.factura?.total ?? NaN);
    if (totalEsperado != null && Number.isFinite(cobrado) && cobrado !== Number(totalEsperado)) {
      console.warn("[facturacion] importe distinto al ofrecido:", { totalEsperado, cobrado });
      decirEn("estadoPago",
        `El importe pendiente cambió a ${fmtMoney(cobrado)}. Revisa el detalle antes de pagar.`);
      await refrescar();
      return;
    }

    decirEn("estadoPago", "Te llevamos a Wompi…");
    window.location.href = data.url_pago;
  } catch (error) {
    console.error("[facturacion] pago-iniciar", error);
    decirEn("estadoPago",
      await mensajeDeError(error, "No se pudo iniciar el pago. Inténtalo de nuevo."));
    bloquearBotones(false);
  }
}

/**
 * Cambia la modalidad de una renovación anticipada.
 *
 * No cobra nada: anula la reserva no pagada y emite la otra. Todo el trabajo y
 * todos los candados están en cambiar_modalidad_factura(); aquí solo se pide y
 * se refresca.
 */
async function cambiarModalidad(periodicidad) {
  const e = estado.facturacion;
  const factura = facturaPendiente(e);
  const destino = periodicidad === "anual" ? e.precio_anual : e.precio_mensual;

  const ok = window.confirm(
    `Vas a cambiar tu renovación a ${periodicidad}.\n\n` +
    `• Se anula la factura ${factura?.numero} de ${fmtMoney(factura?.total)}.\n` +
    `• Se emite una nueva de ${fmtMoney(destino?.total)}.\n` +
    "• No se te cobra nada ahora: solo cambia lo que pagarás al renovar.\n\n" +
    "¿Confirmas?",
  );
  if (!ok) return;

  bloquearBotones(true);
  decirEn("estadoModalidad", "Cambiando tu modalidad…");
  try {
    const { data, error } = await supabase.rpc("cambiar_modalidad_factura", {
      p_periodicidad: periodicidad,
      p_empresa_id: estado.empresaId || null,
    });
    if (error) throw error;
    const nueva = Array.isArray(data) ? data[0] : data;
    decirEn("estadoModalidad",
      `Listo. Tu renovación ahora es ${periodicidad}: factura ${nueva?.numero} por ${fmtMoney(nueva?.total)}.`);
    await refrescar();
  } catch (error) {
    console.error("[facturacion] cambiar_modalidad_factura", error);
    decirEn("estadoModalidad", error?.message || "No se pudo cambiar la modalidad.");
    bloquearBotones(false);
  }
}

/** Cobro de prueba de $1.000. Solo superadmin, y solo si el servidor lo permite. */
async function pagarPrueba() {
  const ok = window.confirm(
    "Cobro de PRUEBA de $1.000.\n\n" +
    "Se emite una factura simbólica de la cuenta banco de pruebas y se abre el " +
    "checkout de Wompi. No afecta a ningún cliente ni al precio comercial.\n\n" +
    "¿Continuar?",
  );
  if (!ok) return;

  bloquearBotones(true);
  decirEn("estadoPrueba", "Preparando el cobro de prueba…");
  try {
    // La bandera va DENTRO de periodicidad, no en un campo aparte. Un
    // despliegue viejo de pago-iniciar rechaza un valor que no conoce; un
    // campo suelto lo ignoraría y caería al cobro real. Ver la cabecera de
    // supabase/functions/pago-iniciar/index.ts.
    const { data, error } = await supabase.functions.invoke("pago-iniciar", {
      body: { periodicidad: "prueba" },
    });
    if (error) throw error;
    if (!data?.ok || !data.url_pago) {
      decirEn("estadoPrueba", data?.message || "El cobro de prueba no está habilitado.");
      bloquearBotones(false);
      return;
    }

    // Tres cinturones antes de abrir nada. Cualquiera que falle significa que
    // el servidor NO entendió que esto era una prueba, y entonces lo que hay
    // al otro lado es un cobro real.
    const total = Number(data.factura?.total ?? NaN);
    if (data.prueba !== true || total !== MONTO_PRUEBA) {
      console.error("[facturacion] la respuesta no es un cobro de prueba:", data);
      decirEn("estadoPrueba",
        `Cancelado: el servidor respondió con ${fmtMoney(total)} y no con ${fmtMoney(MONTO_PRUEBA)}. ` +
        "Despliega pago-iniciar antes de volver a intentarlo.");
      bloquearBotones(false);
      return;
    }

    decirEn("estadoPrueba",
      `Factura ${data.factura?.numero} · ${fmtMoney(total)} · ` +
      `${data.sandbox ? "sandbox" : "producción"}. Abriendo Wompi…`);
    window.location.href = data.url_pago;
  } catch (error) {
    console.error("[facturacion] pago-iniciar (prueba)", error);
    decirEn("estadoPrueba",
      await mensajeDeError(error, "No se pudo iniciar el cobro de prueba."));
    bloquearBotones(false);
  }
}

async function exportarDatos() {
  bloquearBotones(true);
  decirEn("estadoGestion", "Preparando tu descarga… puede tardar un momento.");
  try {
    const { data, error } = await supabase.functions.invoke("exportar-datos", { body: {} });
    if (error) throw error;

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `axioma-datos-${hoyISO()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    const filas = data?.resumen?.total_registros ?? 0;
    decirEn("estadoGestion", `Descarga lista: ${filas} registros.`);
  } catch (error) {
    console.error("[facturacion] exportar-datos", error);
    decirEn("estadoGestion",
      await mensajeDeError(error, "No se pudo generar la descarga. Inténtalo de nuevo."));
  } finally {
    bloquearBotones(false);
  }
}

async function darDeBaja() {
  const s = estado.facturacion?.suscripcion;
  const cubierto = s?.cubierto_hasta ? fmtDate(s.cubierto_hasta) : null;

  const aviso =
    "Vas a dar de baja tu servicio de AXIOMA.\n\n" +
    (cubierto ? `• Conservas el servicio hasta el ${cubierto}, que ya está pagado.\n` : "") +
    "• No hay reembolsos de periodos ya pagados.\n" +
    "• Las facturas pendientes siguen debiéndose.\n" +
    "• Conservas el acceso a esta pantalla para retomar el plan cuando quieras.\n" +
    "• Tus datos se conservan al menos 90 días.\n\n" +
    "Te recomendamos descargar tus datos antes de continuar.\n\n" +
    "¿Confirmas la baja?";

  if (!window.confirm(aviso)) return;

  const motivo = window.prompt(
    "¿Nos cuentas por qué te vas? (precio, no lo uso, me cambio, otro)", "",
  );
  if (motivo === null) return;

  bloquearBotones(true);
  decirEn("estadoGestion", "Tramitando la baja…");
  try {
    const { data, error } = await supabase.rpc("solicitar_baja", {
      p_motivo: String(motivo || "").slice(0, 80),
      p_comentario: "",
    });
    if (error) throw error;
    decirEn("estadoGestion",
      `Baja registrada. Tus datos se conservan hasta el ${fmtDate(data?.purgar_desde)}.`);
    await refrescar();
  } catch (error) {
    console.error("[facturacion] solicitar_baja", error);
    decirEn("estadoGestion", error?.message || "No se pudo tramitar la baja.");
    bloquearBotones(false);
  }
}

async function reactivar() {
  bloquearBotones(true);
  decirEn("estadoAcceso", "Reactivando tu cuenta…");
  try {
    const { data, error } = await supabase.rpc("reactivar_cuenta", {});
    if (error) throw error;
    decirEn("estadoAcceso", `Listo. Tu cuenta vuelve a estar ${data?.estado || "activa"}.`);
    await refrescar();
  } catch (error) {
    console.error("[facturacion] reactivar_cuenta", error);
    decirEn("estadoAcceso", error?.message || "No se pudo reactivar la cuenta.");
    bloquearBotones(false);
  }
}

/* ── Arranque ─────────────────────────────────────────────────────────────── */

function pintar() {
  const raiz = document.getElementById("factura-contenido");
  if (!raiz) return;

  // Sin datos no se pinta nada. Pasa si un refresco vuelve vacío —una llamada
  // que falla sin lanzar, por ejemplo—: antes reventaba a mitad del render y
  // dejaba la pantalla en blanco, sin explicación y sin forma de reintentar.
  if (!estado.facturacion?.ok) {
    raiz.innerHTML = `
      <section class="fx-card fx-card--alerta">
        <h2 class="fx-card-title">No pudimos cargar tu facturación</h2>
        <p>Vuelve a intentarlo en un momento. Si sigue igual, escríbenos a ${escapeHtml(EMISOR.contacto)}.</p>
      </section>`;
    return;
  }

  // Compra y cuenta van envueltas juntas: en escritorio son las dos columnas
  // de la parte alta de la página, y la compra es la ancha. Lo demás cae
  // debajo a ancho completo.
  raiz.innerHTML = [
    renderRetornoPago(),
    renderAvisoAcceso(),
    renderActivacion(),
    `<div class="fx-principal">${renderCompra()}${renderCabecera()}</div>`,
    renderCalculo(),
    renderHistorial(),
    renderGestion(),
    renderPruebaPago(),
    renderPie(),
  ].join("");

  // El importe viaja con el botón para poder comprobar, antes de redirigir,
  // que el servidor va a cobrar exactamente lo que el cliente vio.
  raiz.querySelectorAll("[data-pago]").forEach((b) =>
    b.addEventListener("click", () => {
      const total = b.dataset.total != null ? Number(b.dataset.total) : null;
      pagar(b.dataset.pago, Number.isFinite(total) ? total : null);
    }));

  // data-ciclo NO cobra ni emite nada: solo cambia qué modalidad se está
  // mirando en la oferta. data-modalidad SÍ toca la base. Son dos atributos
  // distintos justamente para que no puedan confundirse al leer el código.
  raiz.querySelectorAll("[data-ciclo]").forEach((b) =>
    b.addEventListener("click", () => {
      estado.ciclo = b.dataset.ciclo === "mensual" ? "mensual" : "anual";
      pintar();
    }));

  raiz.querySelectorAll("[data-modalidad]").forEach((b) =>
    b.addEventListener("click", () => cambiarModalidad(b.dataset.modalidad)));

  raiz.querySelectorAll("[data-accion]").forEach((b) =>
    b.addEventListener("click", () => {
      const acciones = {
        activar: activarPrueba,
        exportar: exportarDatos,
        baja: darDeBaja,
        reactivar,
        "prueba-pago": pagarPrueba,
      };
      acciones[b.dataset.accion]?.();
    }));
}

async function refrescar() {
  await cargarTodo(estado.empresaId);
  pintar();
}

async function iniciar() {
  const raiz = document.getElementById("factura-contenido");
  if (!raiz) return;

  raiz.innerHTML = `
    <section class="fx-card fx-cargando" aria-busy="true">
      <p>Cargando tu facturación…</p>
    </section>`;

  try {
    const sesion = await getSessionConEmpresa();
    estado.empresaId = sesion?.usuarioSistema?.empresa_id || sesion?.empresa?.id || null;

    await cargarTodo(estado.empresaId);

    // Solo decide si se PINTA la herramienta interna. El permiso de verdad lo
    // comprueba pago-iniciar en el servidor.
    try {
      const { data: esSuper } = await supabase.rpc("is_super_admin");
      estado.esSuperadmin = Boolean(esSuper);
    } catch (_error) {
      estado.esSuperadmin = false;
    }

    if (!estado.facturacion?.ok) {
      raiz.innerHTML = `
        <section class="fx-card fx-card--aviso">
          <h2 class="fx-card-title">Tu empresa todavía no tiene cuenta de facturación</h2>
          <p>Escríbenos a ${escapeHtml(EMISOR.contacto)} y la activamos.</p>
        </section>`;
      return;
    }

    // El selector arranca en la modalidad que ya tiene contratada, si la hay.
    const suya = String(estado.facturacion?.suscripcion?.periodicidad || "").toLowerCase();
    if (suya === "mensual" || suya === "anual") estado.ciclo = suya;

    pintar();
  } catch (error) {
    console.error("[facturacion] No se pudo cargar el estado:", error);
    raiz.innerHTML = `
      <section class="fx-card fx-card--alerta">
        <h2 class="fx-card-title">No pudimos cargar tu facturación</h2>
        <p>Vuelve a intentarlo en un momento. Si sigue igual, escríbenos a ${escapeHtml(EMISOR.contacto)}.</p>
      </section>`;
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", iniciar);
} else {
  iniciar();
}
