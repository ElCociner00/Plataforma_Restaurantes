import { supabase } from "./supabase.js";
import { esSuperAdmin } from "./permisos.core.js";
import { getSessionConEmpresa } from "./session.js";
import { resolveEmpresaPlan, normalizeEmpresaActiva } from "./plan.js";
import { WEBHOOKS } from "./webhooks.js";
import { APP_URLS } from "./urls.js";

const bodyEl = document.getElementById("empresasBody");
const statusEl = document.getElementById("estadoAccion");
const btnRecargar = document.getElementById("btnRecargar");
const btnRevisionPagos = document.getElementById("btnRevisionPagos");

const state = {
  empresas: [],
  planes: [],
  empresaActualId: null
};

const setStatus = (message) => {
  if (statusEl) statusEl.textContent = message || "";
};

const revealDeferredPage = () => {
  if (document?.body?.dataset?.deferReveal === "true") {
    document.body.style.display = "block";
  }
};

const fmtDate = (value) => {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("es-CO");
};

const fmtMoney = (value) => {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "$0";
  return n.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
};

const escapeHtml = (value) => String(value || "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");
const getCurrentPeriod = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

const getPlanes = async () => {
  const { data, error } = await supabase
    .from("planes")
    .select("id, nombre")
    .order("id", { ascending: true });

  if (error || !Array.isArray(data) || !data.length) {
    return [
      { id: "free", nombre: "Free" },
      { id: "pro", nombre: "Pro" }
    ];
  }

  return data;
};

const getPlanOptions = (planActual) => {
  const plan = String(planActual || "").toLowerCase();
  const options = (state.planes || []).map((item) => ({
    value: String(item.id || "").toLowerCase(),
    label: item.nombre || String(item.id || "").toUpperCase()
  }));

  if (plan && !options.some((item) => item.value === plan)) {
    options.push({ value: plan, label: plan.toUpperCase() });
  }

  return options;
};

const renderRows = () => {
  if (!bodyEl) return;
  if (!state.empresas.length) {
    bodyEl.innerHTML = '<tr><td colspan="7">No hay empresas registradas.</td></tr>';
    return;
  }

  bodyEl.innerHTML = state.empresas.map((empresa) => {
    const plan = resolveEmpresaPlan(empresa);
    const activa = normalizeEmpresaActiva(empresa);
    const estado = activa ? "Activo" : "Inactivo";
    const nombre = empresa.nombre_comercial || empresa.razon_social || "(Sin nombre)";
    const options = getPlanOptions(plan)
      .map((item) => `<option value="${item.value}" ${item.value === plan ? "selected" : ""}>${escapeHtml(item.label)}</option>`)
      .join("");

    return `
      <tr>
        <td>
          <strong>${escapeHtml(nombre)}</strong>
          <div class="empresa-meta">${escapeHtml(empresa.nit || "-")} · ${escapeHtml(empresa.correo_empresa || "-")}</div>
          <div class="empresa-id"><code>${empresa.id}</code></div>
        </td>
        <td><select class="plan-select" data-action="changePlan" data-id="${empresa.id}">${options}</select></td>
        <td>
          <label class="switch-cell"><input type="checkbox" data-action="toggleEstado" data-id="${empresa.id}" ${activa ? "checked" : ""}><span class="switch-slider"></span></label>
          <span class="badge ${activa ? "activo" : "inactivo"}">${estado}</span>
        </td>
        <td><label class="switch-cell"><input type="checkbox" data-action="toggleAnuncio" data-id="${empresa.id}" ${empresa.mostrar_anuncio_impago ? "checked" : ""}><span class="switch-slider"></span></label></td>
        <td>${fmtMoney(empresa.deuda_actual)}</td>
        <td>${fmtDate(empresa.fecha_corte)}</td>
        <td>${fmtDate(empresa.created_at)}</td>
      </tr>
    `;
  }).join("");
};

async function loadEmpresas() {
  setStatus("Cargando empresas...");
  const { data, error } = await supabase
    .from("empresas")
    .select("id, nombre_comercial, razon_social, nit, plan, plan_actual, activo, activa, mostrar_anuncio_impago, deuda_actual, created_at, correo_empresa")
    .order("created_at", { ascending: false });

  if (error) {
    setStatus("No se pudieron cargar las empresas (revisar políticas RLS de empresas/billing para superadmin).");
    console.error("Error cargando empresas para superadmin:", error);
    return;
  }

  state.empresas = Array.isArray(data) ? data : [];
  renderRows();
  setStatus(`${state.empresas.length} empresa(s) cargada(s).`);
}

async function updateEmpresa(empresaId, payload) {
  const { error } = await supabase
    .from("empresas")
    .update(payload)
    .eq("id", empresaId);

  if (error) throw error;
}

async function syncBillingStateWithEmpresa(empresaId, { activa = null, mostrar = null } = {}) {
  if (!empresaId) return;

  const { data: empresa } = await supabase
    .from("empresas")
    .select("id, deuda_actual, mostrar_anuncio_impago, activo, activa")
    .eq("id", empresaId)
    .maybeSingle();

  const deudaActual = Number(empresa?.deuda_actual || 0);
  const empresaActiva = typeof activa === "boolean" ? activa : normalizeEmpresaActiva(empresa);
  const bannersActivos = typeof mostrar === "boolean" ? mostrar : empresa?.mostrar_anuncio_impago === true;
  const periodo = getCurrentPeriod();

  const { data: cycles } = await supabase
    .from("billing_cycles")
    .select("id, periodo")
    .eq("empresa_id", empresaId)
    .order("periodo", { ascending: false })
    .order("fecha_vencimiento", { ascending: false })
    .limit(3);

  const targetIds = new Set();
  (Array.isArray(cycles) ? cycles : []).forEach((cycle) => {
    if (!cycle?.id) return;
    if (cycle.periodo === periodo || targetIds.size === 0) targetIds.add(cycle.id);
  });

  if (!targetIds.size) return;

  const cycleUpdate = { updated_at: new Date().toISOString() };

  if (!bannersActivos) {
    cycleUpdate.banner_activo = false;
  }

  if (empresaActiva && deudaActual <= 0) {
    cycleUpdate.banner_activo = false;
    cycleUpdate.suspension_aplicada = false;
    cycleUpdate.estado = "paid_verified";
  } else if (empresaActiva === false) {
    cycleUpdate.suspension_aplicada = true;
    cycleUpdate.estado = "suspended";
  }

  await supabase
    .from("billing_cycles")
    .update(cycleUpdate)
    .in("id", Array.from(targetIds));
}

async function onToggleEstado(input) {
  const empresaId = input?.dataset?.id;
  const activa = input?.checked === true;
  if (!empresaId) return;

  await updateEmpresa(empresaId, { activo: activa, activa });
  await syncBillingStateWithEmpresa(empresaId, { activa });
  if (empresaId === state.empresaActualId) window.dispatchEvent(new Event("empresaCambiada"));
}

async function onToggleAnuncio(input) {
  const empresaId = input?.dataset?.id;
  const mostrar = input?.checked === true;
  if (!empresaId) return;

  await updateEmpresa(empresaId, { mostrar_anuncio_impago: mostrar });
  await syncBillingStateWithEmpresa(empresaId, { mostrar });
  if (empresaId === state.empresaActualId) window.dispatchEvent(new Event("empresaCambiada"));

  if (WEBHOOKS?.NOTIFICACION_IMAGO?.url) {
    fetch(WEBHOOKS.NOTIFICACION_IMAGO.url, {
      method: WEBHOOKS.NOTIFICACION_IMAGO.metodo || "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ empresa_id: empresaId, mostrar_anuncio_impago: mostrar, fecha: new Date().toISOString() })
    }).catch(() => {});
  }
}

async function onChangePlan(select) {
  const empresaId = select?.dataset?.id;
  const plan = String(select?.value || "free").toLowerCase();
  if (!empresaId) return;

  await updateEmpresa(empresaId, { plan, plan_actual: plan });
  if (empresaId === state.empresaActualId) window.dispatchEvent(new Event("empresaCambiada"));
}

document.addEventListener("DOMContentLoaded", async () => {
  const allowed = await esSuperAdmin().catch(() => false);
  if (!allowed) {
    window.location.replace(APP_URLS.dashboard);
    return;
  }

  revealDeferredPage();

  const session = await getSessionConEmpresa().catch(() => null);
  state.empresaActualId = session?.empresa?.id || null;
  state.planes = await getPlanes().catch(() => []);
  await loadEmpresas();

  btnRecargar?.addEventListener("click", loadEmpresas);

  btnRevisionPagos?.addEventListener("click", () => {
    window.location.assign(APP_URLS.revisionPagos);
  });


  bodyEl?.addEventListener("change", async (event) => {
    const el = event.target;
    const action = el?.dataset?.action;
    if (!action) return;

    try {
      if (action === "toggleEstado") await onToggleEstado(el);
      if (action === "toggleAnuncio") await onToggleAnuncio(el);
      if (action === "changePlan") await onChangePlan(el);
      await loadEmpresas();
      setStatus("Cambios aplicados.");
    } catch (_error) {
      setStatus("No se pudo aplicar el cambio.");
      await loadEmpresas();
    }
  });
});
