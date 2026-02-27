import { getUserContext, buildRequestHeaders } from "./session.js";
import { WEBHOOK_LISTAR_RESPONSABLES } from "./webhooks.js";
import {
  fetchEffectivePermissionsMap,
  fetchPermissionModules,
  upsertUserPermissionOverride
} from "./permisosService.js";

// ===============================
// CONFIGURACIÃ“N
// ===============================
const DATA_ENDPOINT = "";
const DEFAULT_PAGES = [
  "dashboard",
  "cierre_turno",
  "historico_cierre_turno",
  "cierre_inventarios",
  "configuracion"
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
const getTimestamp = () => new Date().toISOString();

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
      <span class="resumen-label">MÃ³dulos configurables</span>
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
        <label class="permiso-switch" title="${isBlocked ? "Bloqueado (NO)" : "Permitido (SÃ)"}">
          <input
            type="checkbox"
            data-empleado-id="${empleado.id}"
            data-page="${page}"
            ${isBlocked ? "checked" : ""}
          >
          <span aria-hidden="true" class="switch-slider"></span>
          <span class="switch-state">${isBlocked ? "NO" : "SÃ"}</span>
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
    await upsertUserPermissionOverride({
      usuarioId: empleadoId,
      modulo: page,
      permitido: value,
      updatedBy: userContext?.user?.id || userContext?.user?.user_id
    });

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
    switchState.textContent = value ? "SÃ" : "NO";
  }

  try {
    await persistPermissionChange({ empleadoId, page, value });
  } catch (error) {
    // rollback visual on error
    empleado.permisos[page] = !value;
    target.checked = value;
    if (switchState) {
      switchState.textContent = !value ? "SÃ" : "NO";
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
    setStatus(`AcciÃ³n masiva aplicada para rol ${role}.`);
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
  if (window.PERMISOS_DATA) return window.PERMISOS_DATA;

  const headers = await buildRequestHeaders({ includeTenant: true });
  const baseHeaders = {
    ...headers,
    "Content-Type": "application/json"
  };

  if (!DATA_ENDPOINT) {
    const response = await fetch(WEBHOOK_LISTAR_RESPONSABLES, {
      method: "POST",
      headers: baseHeaders,
      body: JSON.stringify({
        usuario_id: userContext?.user?.id || userContext?.user?.user_id,
        solicitado_por: userContext?.user?.id || userContext?.user?.user_id,
        timestamp: getTimestamp(),
        origen: "permisos"
      })
    });

    const data = await response.json();
    const responsables = Array.isArray(data)
      ? data.flatMap((item) => item.responsables || [])
      : data.responsables || [];

    const [modules, permissionsByUser] = await Promise.all([
      fetchPermissionModules().catch(() => []),
      fetchEffectivePermissionsMap().catch(() => ({}))
    ]);

    return {
      pages: modules.length ? modules : DEFAULT_PAGES,
      empleados: responsables.map((item) => {
        const id = item.id ?? item.value ?? item;
        return {
          id,
          nombre: item.nombre ?? item.name ?? item,
          rol: item.rol ?? item.role ?? "",
          permisos: permissionsByUser[String(id)] || {}
        };
      })
    };
  }

  const response = await fetch(DATA_ENDPOINT, {
    method: "POST",
    headers: baseHeaders,
    body: JSON.stringify({
      usuario_id: userContext?.user?.id || userContext?.user?.user_id,
      solicitado_por: userContext?.user?.id || userContext?.user?.user_id,
      timestamp: getTimestamp()
    })
  });

  const data = await response.json();
  const permissionsByUser = await fetchEffectivePermissionsMap().catch(() => ({}));

  return {
    ...data,
    pages: (data.pages || []).length ? data.pages : DEFAULT_PAGES,
    empleados: (data.empleados || []).map((empleado) => ({
      ...empleado,
      permisos: permissionsByUser[String(empleado.id)] || empleado.permisos || {}
    }))
  };
};

// ===============================
// INIT
// ===============================
document.addEventListener("DOMContentLoaded", async () => {
  userContext = await getUserContext();

  if (!userContext) {
    setStatus("No se pudo validar la sesiÃ³n.");
    return;
  }

  try {
    const data = await loadPermissions();
    state = {
      pages: normalizePages(data.pages || []),
      empleados: data.empleados || []
    };

    renderTable();
    attachTableHandlers();
    setStatus("Permisos cargados correctamente.");
  } catch (err) {
    setStatus(err.message || "No se pudo cargar la informaciÃ³n.");
  }

  bulkButtons.forEach((button) => {
    button.addEventListener("click", handleBulkAction);
  });
});
