
import { supabase } from "./supabase.js";
import { esSuperAdmin } from "./permisos.core.js";
import { getSessionConEmpresa } from "./session.js";
import { resolveEmpresaPlan, normalizeEmpresaActiva } from "./plan.js";
import { WEBHOOKS } from "./webhooks.js";

const bodyEl = document.getElementById("empresasBody");
const statusEl = document.getElementById("estadoAccion");
const btnRecargar = document.getElementById("btnRecargar");
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
const escapeHtml = (value) => String(value || "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

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
    bodyEl.innerHTML = '<tr><td colspan="9">No hay empresas registradas.</td></tr>';
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
        <td>
          <select class="plan-select" data-action="changePlan" data-id="${empresa.id}">${options}</select>
        </td>
        <td>
          <label class="switch-cell"><input type="checkbox" data-action="toggleEstado" data-id="${empresa.id}" ${activa ? "checked" : ""}><span class="switch-slider"></span></label>
          <span class="badge ${activa ? "activo" : "inactivo"}">${estado}</span>
        </td>
        <td>
          <label class="switch-cell"><input type="checkbox" data-action="toggleAnuncio" data-id="${empresa.id}" ${empresa.mostrar_anuncio_impago ? "checked" : ""}><span class="switch-slider"></span></label>
        </td>
        <td>${fmtMoney(empresa.deuda_actual)}</td>
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

  state.empresas = data || [];
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

async function onToggleEstado(input) {
  const empresaId = input?.dataset?.id;
  const activa = input?.checked === true;
  if (!empresaId) return;

  await updateEmpresa(empresaId, { activo: activa, activa });
  if (empresaId === state.empresaActualId) window.dispatchEvent(new Event("empresaCambiada"));
}

async function onToggleAnuncio(input) {
  const empresaId = input?.dataset?.id;
  const mostrar = input?.checked === true;
  if (!empresaId) return;

  await updateEmpresa(empresaId, { mostrar_anuncio_impago: mostrar });
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
    window.location.replace("/Plataforma_Restaurantes/dashboard/");
    return;
  }

  const session = await getSessionConEmpresa().catch(() => null);
  state.empresaActualId = session?.empresa?.id || null;
  state.planes = await getPlanes().catch(() => []);
  await loadEmpresas();

  btnRecargar?.addEventListener("click", loadEmpresas);

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
