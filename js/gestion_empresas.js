import { supabase } from "./supabase.js";
import { esSuperAdmin } from "./permisos.core.js";
import { getSessionConEmpresa } from "./session.js";
import { resolveEmpresaPlan, normalizeEmpresaActiva } from "./plan.js";
import { WEBHOOKS } from "./webhooks.js";

const bodyEl = document.getElementById("empresasBody");
const statusEl = document.getElementById("estadoAccion");
const btnRecargar = document.getElementById("btnRecargar");
const btnRevisionPagos = document.getElementById("btnRevisionPagos");
const overrideEmpresaSelect = document.getElementById("overrideEmpresaId");
const overrideUntilInput = document.getElementById("overrideUntil");
const overridePauseCheck = document.getElementById("overridePause");
const forceBannerCheck = document.getElementById("forceBanner");
const forceSuspendCheck = document.getElementById("forceSuspend");
const btnApplyOverride = document.getElementById("btnApplyOverride");

const state = {
  empresas: [],
  planes: [],
  empresaActualId: null
};

const setStatus = (message) => {
  if (statusEl) statusEl.textContent = message || "";
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

const getCurrentPeriodo = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return year + "-" + month;
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

const hydrateOverrideSelect = () => {
  if (!overrideEmpresaSelect) return;
  const options = (state.empresas || []).map((empresa) => {
    const nombre = empresa.nombre_comercial || empresa.razon_social || empresa.id;
    return `<option value="${empresa.id}">${escapeHtml(nombre)}</option>`;
  }).join("");
  overrideEmpresaSelect.innerHTML = `<option value="">Selecciona una empresa</option>${options}`;
};

const renderRows = () => {
  if (!bodyEl) return;
  if (!state.empresas.length) {
    bodyEl.innerHTML = '<tr><td colspan="11">No hay empresas registradas.</td></tr>';
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
        <td>${escapeHtml(nombre)}</td>
        <td>${escapeHtml(empresa.nit || "-")}</td>
        <td>${escapeHtml(empresa.correo_empresa || "-")}</td>
        <td><select class="plan-select" data-action="changePlan" data-id="${empresa.id}">${options}</select></td>
        <td>
          <label class="switch-cell"><input type="checkbox" data-action="toggleEstado" data-id="${empresa.id}" ${activa ? "checked" : ""}><span class="switch-slider"></span></label>
          <span class="badge ${activa ? "activo" : "inactivo"}">${estado}</span>
        </td>
        <td><label class="switch-cell"><input type="checkbox" data-action="toggleAnuncio" data-id="${empresa.id}" ${empresa.mostrar_anuncio_impago ? "checked" : ""}><span class="switch-slider"></span></label></td>
        <td>${fmtMoney(empresa.deuda_actual)}</td><td>${fmtDate(empresa.fecha_corte)}</td><td>${fmtDate(empresa.fecha_suspension)}</td>
        <td>${fmtDate(empresa.created_at)}</td>
        <td><code>${empresa.id}</code></td>
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
    setStatus("No se pudieron cargar las empresas.");
    return;
  }

  state.empresas = Array.isArray(data) ? data : [];
  renderRows();
  hydrateOverrideSelect();
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

async function applyManualOverride() {
  const empresaId = String(overrideEmpresaSelect?.value || "");
  if (!empresaId) {
    setStatus("Selecciona una empresa para aplicar la excepción.");
    return;
  }

  const pauseAuto = overridePauseCheck?.checked === true;
  const manualUntil = pauseAuto && overrideUntilInput?.value ? new Date(`${overrideUntilInput.value}T23:59:59`).toISOString() : null;
  const forceBanner = forceBannerCheck?.checked === true;
  const forceSuspend = forceSuspendCheck?.checked === true;
  const periodo = getCurrentPeriod();

  setStatus("Aplicando excepción manual...");

  const { data: cycle, error: cycleError } = await supabase
    .from("billing_cycles")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("periodo", periodo)
    .maybeSingle();

  if (cycleError || !cycle?.id) {
    setStatus("No se encontró billing_cycle del periodo actual para esa empresa.");
    return;
  }

  const cyclePayload = {
    manual_override: pauseAuto,
    manual_override_until: manualUntil,
    banner_activo: forceBanner,
    suspension_aplicada: forceSuspend,
    updated_at: new Date().toISOString()
  };
  if (forceSuspend) cyclePayload.estado = "suspended";

  const { error: updateCycleError } = await supabase
    .from("billing_cycles")
    .update(cyclePayload)
    .eq("id", cycle.id);

  if (updateCycleError) {
    setStatus("No se pudo actualizar el ciclo de facturación.");
    return;
  }

  await updateEmpresa(empresaId, {
    mostrar_anuncio_impago: forceBanner,
    activa: !forceSuspend,
    activo: !forceSuspend
  }).catch(() => {});

  await supabase.from("billing_events").insert({
    empresa_id: empresaId,
    billing_cycle_id: cycle.id,
    tipo_evento: "override_manual_aplicado",
    actor: "superadmin",
    payload_json: { pauseAuto, manualUntil, forceBanner, forceSuspend }
  }).catch(() => {});

  await syncBillingStateWithEmpresa(empresaId, { activa: !forceSuspend, mostrar: forceBanner });
  if (empresaId === state.empresaActualId) window.dispatchEvent(new Event("empresaCambiada"));
  setStatus("Excepción manual aplicada.");
  await loadEmpresas();
}

document.addEventListener("DOMContentLoaded", async () => {
  const allowed = await esSuperAdmin().catch(() => false);
  if (!allowed) {
    window.location.replace("/Plataforma_Restaurantes/dashboard/");
    return;
  }

  const session = await getSessionConEmpresa().catch(() => null);
  state.empresaActualId = session?.empresa?.id || null;
  state.planes = await getPlanes().catch(() => []);
  await loadEmpresas();

  btnRecargar?.addEventListener("click", loadEmpresas);

  btnRevisionPagos?.addEventListener("click", () => {
    window.location.assign("/Plataforma_Restaurantes/facturacion/revision_pagos.html");
  });

  btnApplyOverride?.addEventListener("click", applyManualOverride);

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



function renderOverrideOptions() {
  if (!overrideEmpresaEl) return;
  const options = (state.empresas || []).map((empresa) => {
    const nombre = empresa.nombre_comercial || empresa.razon_social || "(Sin nombre)";
    return `<option value="${empresa.id}">${escapeHtml(nombre)}</option>`;
  }).join("");

  overrideEmpresaEl.innerHTML = `<option value="">Selecciona empresa</option>${options}`;
}

async function applyOverride() {
  if (!overrideEmpresaEl) return;
  const empresaId = overrideEmpresaEl.value;
  if (!empresaId) {
    setStatus("Selecciona una empresa.");
    return;
  }

  const updates = {};
  const manual = overrideManualEl?.checked === true;
  const untilValue = overrideHastaEl?.value || "";

  if (manual && !untilValue) {
    setStatus("Selecciona la fecha limite para pausar automatizacion.");
    return;
  }

  updates.manual_override = manual;
  updates.manual_override_until = manual ? new Date(untilValue + "T00:00:00").toISOString() : null;

  const bannerValue = overrideBannerEl?.value || "none";
  if (bannerValue === "on") updates.banner_activo = true;
  if (bannerValue === "off") updates.banner_activo = false;

  const suspensionValue = overrideSuspensionEl?.value || "none";
  if (suspensionValue === "on") updates.suspension_aplicada = true;
  if (suspensionValue === "off") updates.suspension_aplicada = false;

  if (!Object.keys(updates).length) {
    setStatus("No hay cambios para aplicar.");
    return;
  }

  const periodo = getCurrentPeriodo();
  const { error } = await supabase
    .from("billing_cycles")
    .update(updates)
    .eq("empresa_id", empresaId)
    .eq("periodo", periodo);

  if (error) {
    setStatus("No se pudo aplicar la excepcion.");
    return;
  }

  setStatus("Excepcion aplicada.");
  await loadEmpresas();
}







