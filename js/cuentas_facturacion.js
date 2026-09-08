/**
 * cuentas_facturacion.js — consola de administración de la plataforma.
 *
 * Contexto: docs/2026-08-25_plan_ciclo_de_vida_cliente.md §3 Fase F
 *
 * Es la vista de Andrés sobre todo el negocio: quién está en prueba, quién no
 * ha activado, quién debe, quién se fue y cuánto entra al mes.
 *
 * Las acciones que ofrece son las que el cliente NO puede hacer por sí mismo:
 *
 *   · Marcar «en implementación»  — congela la ventana de 30 días mientras se
 *     monta el servicio. Es lo que evita que a un cliente acompañado se le
 *     gasten días sin haber usado nada.
 *   · Desbloquear                 — reabre la ventana a quien no activó a tiempo.
 *   · Iniciar o extender prueba   — el respaldo de cuando el cliente no puede.
 *   · Emitir factura              — sin esperar al día 25.
 *
 * Lo que esta pantalla NO hace: bloquear por mora. La columna «Observaciones»
 * cuenta cuántas veces se habría restringido a esa cuenta si el corte por
 * impago estuviera encendido — y ahí se queda.
 */
import { supabase } from "./supabase.js";
import { esSuperAdmin } from "./permisos.core.js";
import { APP_URLS } from "./urls.js";

const listaEl = document.getElementById("listaCuentas");
const metricasEl = document.getElementById("metricasCuentas");
const estadoEl = document.getElementById("estadoCuentas");
const btnRecargar = document.getElementById("btnRecargar");

const setEstado = (m) => { if (estadoEl) estadoEl.textContent = m || ""; };

const fmtMoney = (v) =>
  Number(v || 0).toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

const fmtDate = (v) => {
  if (!v) return "—";
  const [a, m, d] = String(v).split("-").map(Number);
  if (!a || !m || !d) return "—";
  return new Date(a, m - 1, d).toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });
};

const fmtDateTime = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("es-CO");
};

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#39;");

const ETIQUETA_ESTADO = {
  registrada: "Sin activar",
  implementacion: "En implementación",
  prueba: "En prueba",
  activa: "Activa",
  morosa: "Con mora",
  restringida: "Restringida",
  bloqueada_sin_activar: "Bloqueada",
  cancelada: "Dada de baja",
  purgada: "Datos eliminados",
};

/** Semáforo: qué necesita atención hoy. */
function severidad(c) {
  if (["bloqueada_sin_activar", "morosa"].includes(c.estado)) return "cuenta-alerta";
  if (c.estado === "cancelada") return "cuenta-alerta";
  if (c.facturas_abiertas?.some((f) => f.estado === "vencida")) return "cuenta-alerta";
  if (c.estado === "registrada" && (c.dias_para_activar ?? 99) <= 7) return "cuenta-atencion";
  if (c.estado === "registrada" || c.estado === "implementacion") return "cuenta-atencion";
  return "cuenta-ok";
}

function renderMetricas(m) {
  if (!metricasEl || !m) return;
  const tarjeta = (nombre, valor) => `
    <div class="metrica">
      <div class="metrica-valor">${valor}</div>
      <div class="metrica-nombre">${escapeHtml(nombre)}</div>
    </div>`;

  metricasEl.innerHTML = `
    <div class="metricas">
      ${tarjeta("Ingreso mensual", fmtMoney(m.ingreso_recurrente_mensual))}
      ${tarjeta("Clientes activos", m.clientes_activos)}
      ${tarjeta("En prueba", m.en_prueba)}
      ${tarjeta("Sin activar", m.sin_activar)}
      ${tarjeta("Bloqueadas", m.bloqueadas)}
      ${tarjeta("Bajas del mes", m.bajas_del_mes)}
      ${tarjeta("Mora total", fmtMoney(m.mora_total))}
      ${tarjeta("Cobrado este mes", fmtMoney(m.cobrado_del_mes))}
      ${tarjeta("Por conciliar", m.por_conciliar)}
    </div>`;
}

function renderCicloVida(c) {
  const s = c.suscripcion;
  const filas = [];

  filas.push(["Registrada", fmtDate(c.registrada_en)]);

  if (c.estado === "registrada" && c.activacion_limite) {
    const d = c.dias_para_activar;
    filas.push([
      "Plazo para activar",
      `${fmtDate(c.activacion_limite)}${d != null ? ` · ${d} día${d === 1 ? "" : "s"}` : ""}`,
    ]);
  }
  if (c.estado === "implementacion") {
    filas.push(["Plazo para activar", "congelado — en implementación"]);
  }
  if (c.bloqueada_en) filas.push(["Bloqueada el", fmtDate(c.bloqueada_en)]);
  if (s?.prueba_hasta) {
    filas.push(["Prueba", `${fmtDate(s.prueba_desde)} → ${fmtDate(s.prueba_hasta)}`
      + (s.dias_prueba != null && s.dias_prueba >= 0 ? ` · quedan ${s.dias_prueba}` : " · terminada")]);
  }
  if (s?.cubierto_hasta) {
    filas.push(["Cubierto hasta", `${fmtDate(s.cubierto_hasta)}`
      + (s.dias_restantes != null ? ` · ${s.dias_restantes} días` : "")]);
  }
  if (c.cancelada_en) {
    filas.push(["Baja", `${fmtDate(c.cancelada_en)}${c.motivo_cancelacion ? ` · ${escapeHtml(c.motivo_cancelacion)}` : ""}`]);
    // La purga no está implementada: esta fecha es solo informativa.
    filas.push(["Datos conservados hasta", `${fmtDate(c.purgar_desde)} (sin borrado automático)`]);
  }
  if (c.reactivada_en) filas.push(["Reactivada", fmtDate(c.reactivada_en)]);

  return filas.map(([k, v]) =>
    `<div class="kv-line"><span>${escapeHtml(k)}</span><strong>${v}</strong></div>`).join("");
}

function renderAcciones(c) {
  if (c.tipo !== "cliente") {
    return `<p class="helper-text">Cuenta exenta: no se le emiten facturas ni se le restringe nada.</p>`;
  }

  const id = escapeHtml(c.id);
  const s = c.suscripcion;
  const botones = [];

  if (c.estado === "bloqueada_sin_activar") {
    botones.push(`<button type="button" class="btn-pago" data-accion="desbloquear" data-id="${id}">
      Desbloquear (30 días nuevos)</button>`);
  }

  if (["registrada", "implementacion"].includes(c.estado)) {
    if (c.estado !== "implementacion") {
      botones.push(`<button type="button" class="btn-pago-alt" data-accion="implementacion" data-id="${id}">
        Marcar en implementación</button>`);
    }
    botones.push(`<button type="button" class="btn-pago-alt" data-accion="prueba" data-id="${id}">
      Iniciar prueba por él (15 días)</button>`);
  } else if (!s?.cubierto_hasta || c.estado === "prueba") {
    botones.push(`<button type="button" class="btn-pago-alt" data-accion="prueba" data-id="${id}">
      ${c.estado === "prueba" ? "Extender prueba 15 días" : "Dar 15 días de prueba"}</button>`);
  }

  if (!["cancelada", "purgada", "bloqueada_sin_activar"].includes(c.estado)) {
    botones.push(`<button type="button" class="btn-pago-alt" data-accion="emitir" data-id="${id}" data-periodicidad="mensual">
      Emitir factura mensual</button>`);
    botones.push(`<button type="button" class="btn-pago-alt" data-accion="emitir" data-id="${id}" data-periodicidad="anual">
      Emitir factura anual</button>`);
  }

  if (c.estado === "cancelada") {
    botones.push(`<button type="button" class="btn-pago" data-accion="reactivar" data-id="${id}">
      Reactivar cuenta</button>`);
  }

  return `
    <div class="factura-payment-actions">${botones.join("")}</div>
    <p class="factura-payment-note" data-resultado="${id}" role="status" aria-live="polite"></p>`;
}

function renderCuenta(c) {
  const s = c.suscripcion;
  const sedes = c.sedes || [];
  const abiertas = c.facturas_abiertas || [];
  const bitacora = c.bitacora || [];

  const facturasHtml = abiertas.length
    ? `<div class="table-wrap">
         <table class="factura-table">
           <thead><tr><th>Número</th><th>Total</th><th>Corte</th><th>Límite</th><th>Estado</th></tr></thead>
           <tbody>
             ${abiertas.map((f) => `
               <tr>
                 <td>${escapeHtml(f.numero)}</td>
                 <td>${fmtMoney(f.total)}</td>
                 <td>${fmtDate(f.fecha_corte)}</td>
                 <td>${fmtDate(f.fecha_limite_pago)}</td>
                 <td>${f.estado === "vencida"
                       ? `<span class="badge badge-warn">Vencida (${f.dias_vencido} d)</span>`
                       : `<span class="badge">Pendiente</span>`}</td>
               </tr>`).join("")}
           </tbody>
         </table>
       </div>`
    : `<p class="helper-text">Sin facturas abiertas.</p>`;

  return `
    <section class="billing-panel ${severidad(c)}" data-cuenta="${escapeHtml(c.id)}">
      <div class="factura-header">
        <div>
          <h2 class="factura-title">${escapeHtml(c.nombre)}</h2>
          <p class="helper-text">
            NIT ${escapeHtml(c.nit || "—")} ·
            ${escapeHtml(c.correo_facturacion || "sin correo de facturación")}
            ${c.contacto_nombre ? ` · ${escapeHtml(c.contacto_nombre)}` : ""}
          </p>
        </div>
        <div>
          <span class="badge">${escapeHtml(c.tipo)}</span>
          <span class="badge">${escapeHtml(ETIQUETA_ESTADO[c.estado] || c.estado)}</span>
        </div>
      </div>

      <div class="kv-list">
        <div class="kv-line"><span>Sedes</span><strong>${sedes.length}</strong></div>
        <div class="kv-line"><span>Plan</span><strong>${escapeHtml(String(s?.plan_id || "—").toUpperCase())} · ${escapeHtml(s?.periodicidad || "—")}</strong></div>
        <div class="kv-line"><span>Precio</span><strong>${c.precio ? fmtMoney(c.precio.total) : "exenta"}</strong></div>
        ${renderCicloVida(c)}
        <div class="kv-line"><span>Pagado histórico</span><strong>${fmtMoney(c.pagado_total)}</strong></div>
        <div class="kv-line"><span>Observaciones de corte</span><strong>${c.observaciones || 0}</strong></div>
      </div>

      <p class="helper-text">
        Sedes: ${sedes.map((x) =>
          `${escapeHtml(x.nombre)}${x.principal ? " (principal)" : ""}`
          + (x.acceso !== "total" ? ` <em>[${escapeHtml(x.acceso)}]</em>` : "")
        ).join(" · ") || "—"}
      </p>

      ${facturasHtml}
      ${renderAcciones(c)}

      ${bitacora.length ? `
        <details>
          <summary>Últimos movimientos</summary>
          <ul class="customer-list">
            ${bitacora.map((b) => `
              <li>
                <strong>${escapeHtml(b.tipo)}</strong> · ${fmtDateTime(b.cuando)}
                <span class="helper-text">${escapeHtml(b.actor)}</span>
              </li>`).join("")}
          </ul>
        </details>` : ""}
    </section>`;
}

async function cargar() {
  setEstado("Cargando…");

  const [cuentas, metricas] = await Promise.all([
    supabase.rpc("cuentas_backoffice"),
    supabase.rpc("metricas_facturacion"),
  ]);

  if (cuentas.error) {
    setEstado(`No se pudieron cargar las cuentas: ${cuentas.error.message}`);
    return;
  }

  if (!metricas.error) renderMetricas(metricas.data);

  const filas = Array.isArray(cuentas.data) ? cuentas.data : [];
  listaEl.innerHTML = filas.map(renderCuenta).join("")
    || `<section class="billing-panel"><p>No hay cuentas registradas.</p></section>`;

  setEstado(`${filas.length} cuenta(s).`);
}

/** Cada acción, con su confirmación cuando toca y su RPC. */
const ACCIONES = {
  prueba: {
    confirmar: "Se van a activar 15 días de prueba desde hoy.\n\n"
      + "Hazlo solo si el cliente no puede activarla él mismo: a partir de este "
      + "momento empieza a correr su reloj.",
    ejecutar: (id) => supabase.rpc("iniciar_prueba", { p_cuenta_id: id, p_dias: 15 }),
    mensaje: (d) => `Prueba activa hasta ${fmtDate(Array.isArray(d) ? d[0]?.prueba_hasta : d?.prueba_hasta)}.`,
  },
  implementacion: {
    confirmar: "La cuenta pasa a «en implementación».\n\n"
      + "El plazo de 30 días para activar la prueba queda CONGELADO mientras dure "
      + "el montaje. El cliente podrá activarla cuando esté listo.",
    ejecutar: (id) => supabase.rpc("marcar_implementacion", { p_cuenta_id: id, p_nota: null }),
    mensaje: () => "Cuenta en implementación. El plazo quedó congelado.",
  },
  desbloquear: {
    confirmar: "Se reabre la cuenta con un plazo nuevo de 30 días para activar la prueba.",
    ejecutar: (id) => supabase.rpc("desbloquear_cuenta", {
      p_cuenta_id: id, p_dias: 30, p_motivo: "Desbloqueo manual desde el backoffice",
    }),
    mensaje: (d) => `Desbloqueada. Nuevo plazo hasta ${fmtDate(d?.activacion_limite)}.`,
  },
  reactivar: {
    confirmar: "Se reactiva la cuenta con todos sus datos y vuelve a facturarse.",
    ejecutar: (id) => supabase.rpc("reactivar_cuenta", { p_cuenta_id: id }),
    mensaje: (d) => `Cuenta reactivada (${d?.estado || "activa"}).`,
  },
  emitir: {
    confirmar: null,
    ejecutar: (id, boton) => supabase.rpc("emitir_factura_manual", {
      p_cuenta_id: id, p_periodicidad: boton.dataset.periodicidad,
    }),
    mensaje: (d) =>
      `Factura ${d?.numero} por ${fmtMoney(d?.total)}, límite de pago ${fmtDate(d?.fecha_limite_pago)}.`,
  },
};

async function ejecutarAccion(boton) {
  const accion = ACCIONES[boton.dataset.accion];
  if (!accion) return;

  const id = boton.dataset.id;
  const salida = document.querySelector(`[data-resultado="${id}"]`);
  const decir = (t) => { if (salida) salida.textContent = t; };

  if (accion.confirmar && !window.confirm(accion.confirmar)) return;

  const todos = [...document.querySelectorAll("[data-accion]")];
  todos.forEach((b) => { b.disabled = true; });

  try {
    decir("Procesando…");
    const { data, error } = await accion.ejecutar(id, boton);
    if (error) throw error;
    decir(accion.mensaje(data));
    await cargar();
  } catch (error) {
    console.error("[cuentas_facturacion]", error);
    decir(`No se pudo completar: ${error?.message || "error"}`);
  } finally {
    todos.forEach((b) => { b.disabled = false; });
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const permitido = await esSuperAdmin().catch(() => false);
  if (!permitido) {
    window.location.replace(APP_URLS.dashboard);
    return;
  }

  await cargar();
  btnRecargar?.addEventListener("click", cargar);

  listaEl?.addEventListener("click", (evento) => {
    const boton = evento.target.closest("button[data-accion]");
    if (boton) ejecutarAccion(boton);
  });
});
