import { buildRequestHeaders, getCurrentEmpresaId, getUserContext } from "./session.js";
import { WEBHOOKS } from "./webhooks.js";
import { permisosCacheSet } from "./permisos.core.js";
import { DEFAULT_ROLE_PERMISSIONS, PAGE_ENVIRONMENT } from "./permissions.js";
import { supabase } from "./supabase.js";

// ===============================
// CONFIGURACIÃƒâ€œN
// ===============================
const DEFAULT_PAGES = [
  "dashboard",
  "cierre_turno",
  "historico_cierre_turno",
  "cierre_inventarios",
  "historico_cierre_inventarios",
  "configuracion",
  "subir_facturas_siigo",
  "historico_facturas_siigo"
];

// ===============================
// ELEMENTOS
// ===============================
const tableContainer = document.getElementById("permisosTable");
const status = document.getElementById("status");
const summary = document.getElementById("resumenPermisos");
const bulkButtons = document.querySelectorAll(".bulk-actions button");

let state = { pages: [], empleados: [] };
let userContext = null;

// ===============================
// UTILIDADES
// ===============================
const normalizePages = (pages) =>
  pages.filter((page) => page !== "configuracion" && page !== "permisos");

const formatPageLabel = (page) =>
  page
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const isBlockedPermission = (empleado, page) => empleado.permisos?.[page] === false;

const getRoleDefaults = (role) => ({ ...(DEFAULT_ROLE_PERMISSIONS?.[role] || {}) });

const mergeRoleDefaults = (role, permisosMap) => ({
  ...getRoleDefaults(role),
  ...(permisosMap || {})
});

const renderSummary = () => {
  if (!summary) return;

  if (!state.empleados.length || !state.pages.length) {
    summary.innerHTML = "";
    return;
  }

  const blockedCount = state.empleados.reduce((acc, empleado) => {
    const blockedByUser = state.pages.reduce((accPages, page) => {
      if (isBlockedPermission(empleado, page)) return accPages + 1;
      return accPages;
    }, 0);

    return acc + blockedByUser;
  }, 0);

  summary.innerHTML = `
    <div class="resumen-item">
      <span class="resumen-label">Usuarios cargados</span>
      <strong>${state.empleados.length}</strong>
    </div>
    <div class="resumen-item">
      <span class="resumen-label">MÃƒÂ³dulos configurables</span>
      <strong>${state.pages.length}</strong>
    </div>
    <div class="resumen-item">
      <span class="resumen-label">Bloqueos activos (switch encendido)</span>
      <strong>${blockedCount}</strong>
    </div>
  `;
};

const renderTable = () => {
  if (!state.empleados.length) {
    tableContainer.innerHTML = "<p class=\"empty\">No hay empleados para mostrar.</p>";
    renderSummary();
    return;
  }

  const headers = ["Empleado", "Rol", ...state.pages.map(formatPageLabel)];
  const rows = state.empleados.map((empleado) => {
    const switches = state.pages.map((page) => {
      const isBlocked = isBlockedPermission(empleado, page);
      return `
        <label class="permiso-switch" title="${isBlocked ? "Bloqueado (NO)" : "Permitido (SÃƒÂ)"}">
          <input
            type="checkbox"
            data-empleado-id="${empleado.id}"
            data-page="${page}"
            ${isBlocked ? "checked" : ""}
          >
          <span aria-hidden="true" class="switch-slider"></span>
          <span class="switch-state">${isBlocked ? "NO" : "SÃƒÂ"}</span>
          <span class="sr-only">${isBlocked ? "Bloqueado" : "Permitido"}</span>
        </label>
      `;
    });

    return `
      <tr>
        <td>${empleado.nombre}</td>
        <td>${empleado.rol}</td>
        ${switches.map((item) => `<td>${item}</td>`).join("")}
      </tr>
    `;
  });

  tableContainer.innerHTML = `
    <table>
      <thead>
        <tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${rows.join("")}
      </tbody>
    </table>
  `;

  renderSummary();
};

const setStatus = (message) => {
  status.textContent = message;
};

const persistPermissionChange = async ({ empleadoId, page, value }) => {
  setStatus("Guardando cambios...");

  try {
    const headers = await buildRequestHeaders({ includeTenant: true });
    const response = await fetch(WEBHOOKS.PERMISOS_EXCEPCION.url, {
      method: WEBHOOKS.PERMISOS_EXCEPCION.metodo || "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        usuario_id: empleadoId,
        modulo: page,
        permitido: value,
        actualizado_por: userContext?.user?.id || userContext?.user?.user_id
      })
    });

    if (!response.ok) {
      throw new Error("Webhook error");
    }

    setStatus("Cambios de permisos guardados.");
  } catch (error) {
    setStatus("No se pudo guardar el cambio de permisos.");
    throw error;
  }
};

const handleToggle = async (event) => {
  const target = event.target;
  if (!target.matches("input[type=\"checkbox\"]")) return;

  const empleadoId = target.dataset.empleadoId;
  const page = target.dataset.page;
  const value = !target.checked;

  const empleado = state.empleados.find((item) => String(item.id) === String(empleadoId));
  if (!empleado) return;

  empleado.permisos = {
    ...empleado.permisos,
    [page]: value
  };

  const switchState = target.parentElement.querySelector(".switch-state");
  if (switchState) {
    switchState.textContent = value ? "SÃƒÂ" : "NO";
  }

  try {
    await persistPermissionChange({ empleadoId, page, value });
  } catch (error) {
    // rollback visual on error
    empleado.permisos[page] = !value;
    target.checked = value;
    if (switchState) {
      switchState.textContent = !value ? "SÃƒÂ" : "NO";
    }
  }

  renderSummary();
};

const handleBulkAction = async (event) => {
  const button = event.currentTarget;
  const role = button.dataset.role;
  const action = button.dataset.action;
  const value = action === "grant";

  const updates = [];

  state.empleados = state.empleados.map((empleado) => {
    if (empleado.rol !== role) return empleado;

    const permisosActualizados = state.pages.reduce((acc, page) => {
      acc[page] = value;
      return acc;
    }, {});

    const updatedEmpleado = {
      ...empleado,
      permisos: {
        ...empleado.permisos,
        ...permisosActualizados
      }
    };

    const empleadoId = updatedEmpleado.id;
    state.pages.forEach((page) => {
      updates.push({ empleadoId, page, value });
    });

    return updatedEmpleado;
  });

  renderTable();
  attachTableHandlers();

  try {
    for (const update of updates) {
      await persistPermissionChange(update);
    }
    setStatus(`AcciÃƒÂ³n masiva aplicada para rol ${role}.`);
  } catch (error) {
    setStatus("No se pudieron aplicar todos los cambios masivos.");
  }
};

const attachTableHandlers = () => {
  tableContainer.querySelectorAll("input[type=\"checkbox\"]").forEach((input) => {
    input.addEventListener("change", handleToggle);
  });
};

const loadPermissions = async () => {
  const empresaId = await getCurrentEmpresaId();
  if (!empresaId) {
    return { pages: DEFAULT_PAGES, empleados: [] };
  }

  const { data: empleadosData, error: empleadosError } = await supabase
    .from("usuarios_sistema")
    .select("id, nombre_completo, rol")
    .eq("empresa_id", empresaId)
    .eq("activo", true);

  if (empleadosError) {
    throw empleadosError;
  }

  const empleados = empleadosData || [];
  const userIds = empleados.map((item) => item.id).filter(Boolean);
  const pagesSet = new Set([
    ...DEFAULT_PAGES,
    ...Object.keys(PAGE_ENVIRONMENT || {})
  ]);

  let permisosRows = [];

  if (userIds.length) {
    const { data: permisosData, error: permisosError } = await supabase
      .from("v_permisos_efectivos")
      .select("usuario_id, modulo, permitido")
      .eq("empresa_id", empresaId)
      .in("usuario_id", userIds);

    if (permisosError) throw permisosError;
    permisosRows = permisosData || [];
  }

  const permissionsByUser = permisosRows.reduce((acc, row) => {
    const userKey = String(row.usuario_id);
    if (!acc[userKey]) acc[userKey] = {};
    acc[userKey][row.modulo] = row.permitido === true;
    pagesSet.add(row.modulo);
    return acc;
  }, {});

  return {
    pages: Array.from(pagesSet),
    empleados: empleados.map((item) => {
      const id = item.id ?? item.value ?? item;
      const role = item.rol ?? item.role ?? "";
      const permisos = mergeRoleDefaults(role, permissionsByUser[String(id)] || {});
      return {
        id,
        nombre: item.nombre_completo ?? item.nombre ?? item.name ?? item,
        rol: role,
        permisos
      };
    })
  };
};

// ===============================
// INIT
// ===============================
document.addEventListener("DOMContentLoaded", async () => {
  userContext = await getUserContext();

  if (!userContext) {
    setStatus("No se pudo validar la sesiÃƒÂ³n.");
    return;
  }

  try {
    const data = await loadPermissions();
    state = {
      pages: normalizePages(data.pages || []),
      empleados: data.empleados || []
    };

    const currentUserId = userContext?.user?.id || userContext?.user?.user_id;
    const currentUser = state.empleados.find((empleado) => String(empleado.id) === String(currentUserId));
    if (currentUser?.permisos) {
      const cacheRows = Object.entries(currentUser.permisos).map(([modulo, permitido]) => ({
        modulo,
        permitido: permitido === true
      }));
      permisosCacheSet(cacheRows);
    }

    renderTable();
    attachTableHandlers();
    setStatus("Permisos cargados correctamente.");
  } catch (err) {
    setStatus(err.message || "No se pudo cargar la informaciÃƒÂ³n.");
  }

  bulkButtons.forEach((button) => {
    button.addEventListener("click", handleBulkAction);
  });
});
