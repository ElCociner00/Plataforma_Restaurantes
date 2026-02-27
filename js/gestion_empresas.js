import { supabase } from "./supabase.js";
import { esSuperAdmin } from "./permisos.core.js";
import { getSessionConEmpresa } from "./session.js";
import { WEBHOOKS } from "./webhooks.js";

const bodyEl = document.getElementById("empresasBody");
const statusEl = document.getElementById("estadoAccion");
const btnRecargar = document.getElementById("btnRecargar");

const setStatus = (message) => {
  if (statusEl) statusEl.textContent = message || "";
};

const fmtDate = (value) => {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("es-CO");
};

const renderRows = (rows) => {
  if (!bodyEl) return;
  if (!rows.length) {
    bodyEl.innerHTML = "<tr><td colspan=\"6\">No hay empresas registradas.</td></tr>";
    return;
  }

  bodyEl.innerHTML = rows.map((empresa) => {
    const estado = empresa.activa ? "Activo" : "Inactivo";
    const plan = String(empresa.plan_actual || "free").toUpperCase();
    const nombre = empresa.nombre_comercial || empresa.razon_social || "(Sin nombre)";
    return `
      <tr>
        <td>${nombre}</td>
        <td>${empresa.nit || "-"}</td>
        <td>${plan}</td>
        <td><span class="badge ${empresa.activa ? "activo" : "inactivo"}">${estado}</span></td>
        <td>${fmtDate(empresa.created_at)}</td>
        <td>
          <div class="acciones">
            <button data-action="toggleEstado" data-id="${empresa.id}">${empresa.activa ? "Desactivar" : "Activar"}</button>
            <button data-action="togglePlan" data-id="${empresa.id}">Cambiar Plan</button>
            <button data-action="toggleAnuncio" data-id="${empresa.id}">${empresa.mostrar_anuncio_impago ? "Quitar Anuncio" : "Activar Anuncio"}</button>
            <button data-action="verDetalle" data-id="${empresa.id}">Ver Detalles</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
};

async function loadEmpresas() {
  setStatus("Cargando empresas...");
  const { data, error } = await supabase
    .from("empresas")
    .select("id, nombre_comercial, razon_social, nit, plan_actual, activa, created_at, correo_empresa")
    .order("created_at", { ascending: false });

  if (error) {
    renderRows([]);
    setStatus("No se pudieron cargar las empresas.");
    throw error;
  }

  renderRows(data || []);
  setStatus(`${(data || []).length} empresa(s) cargada(s).`);
  return data || [];
}

async function toggleEstado(empresaId, empresas) {
  const empresa = empresas.find((item) => String(item.id) === String(empresaId));
  if (!empresa) return;

  const { error } = await supabase
    .from("empresas")
    .update({ activa: !empresa.activa })
    .eq("id", empresaId);

  if (error) throw error;
}

async function togglePlan(empresaId, empresas) {
  const empresa = empresas.find((item) => String(item.id) === String(empresaId));
  if (!empresa) return;

  const currentPlan = String(empresa.plan_actual || "free").toLowerCase();
  const nextPlan = currentPlan === "pro" ? "free" : "pro";

  const { error } = await supabase
    .from("empresas")
    .update({ plan_actual: nextPlan })
    .eq("id", empresaId);

  if (error) throw error;
}

async function toggleAnuncio(empresaId, empresas, empresaActualId) {
  const empresa = empresas.find((item) => String(item.id) === String(empresaId));
  if (!empresa) return;

  const activar = !empresa.mostrar_anuncio_impago;
  const { error } = await supabase
    .from("empresas")
    .update({ mostrar_anuncio_impago: activar })
    .eq("id", empresaId);

  if (error) throw error;

  if (WEBHOOKS?.NOTIFICACION_IMAGO?.url) {
    fetch(WEBHOOKS.NOTIFICACION_IMAGO.url, {
      method: WEBHOOKS.NOTIFICACION_IMAGO.metodo || "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        empresa_id: empresaId,
        mostrar_anuncio_impago: activar,
        fecha: new Date().toISOString()
      })
    }).catch(() => {});
  }

  if (String(empresaActualId || "") === String(empresaId)) {
    window.dispatchEvent(new Event("empresaCambiada"));
  }
}

function verDetalle(empresaId, empresas) {
  const empresa = empresas.find((item) => String(item.id) === String(empresaId));
  if (!empresa) return;
  const nombre = empresa.nombre_comercial || empresa.razon_social || "(Sin nombre)";
  const detalle = [
    `Empresa: ${nombre}`,
    `NIT: ${empresa.nit || "-"}`,
    `Plan: ${String(empresa.plan_actual || "free").toUpperCase()}`,
    `Estado: ${empresa.activa ? "Activo" : "Inactivo"}`,
    `Correo: ${empresa.correo_empresa || "-"}`,
    `Registro: ${fmtDate(empresa.created_at)}`,
    `ID: ${empresa.id}`
  ].join("\n");
  alert(detalle);
}

document.addEventListener("DOMContentLoaded", async () => {
  const allowed = await esSuperAdmin().catch(() => false);
  if (!allowed) {
    window.location.replace("/Plataforma_Restaurantes/dashboard/");
    return;
  }

  const session = await getSessionConEmpresa().catch(() => null);
  const empresaActualId = session?.empresa?.id || null;
  let empresas = await loadEmpresas().catch(() => []);

  if (btnRecargar) {
    btnRecargar.addEventListener("click", async () => {
      empresas = await loadEmpresas().catch(() => empresas);
    });
  }

  if (bodyEl) {
    bodyEl.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;

      const action = button.dataset.action;
      const empresaId = button.dataset.id;
      if (!empresaId) return;

      try {
        if (action === "toggleEstado") {
          await toggleEstado(empresaId, empresas);
          setStatus("Estado actualizado.");
        } else if (action === "togglePlan") {
          await togglePlan(empresaId, empresas);
          setStatus("Plan actualizado.");
        } else if (action === "toggleAnuncio") {
          await toggleAnuncio(empresaId, empresas, empresaActualId);
          setStatus("Anuncio de impago actualizado.");
        } else if (action === "verDetalle") {
          verDetalle(empresaId, empresas);
          return;
        }
        empresas = await loadEmpresas().catch(() => empresas);
      } catch (_error) {
        setStatus("No se pudo ejecutar la accion.");
      }
    });
  }
});
