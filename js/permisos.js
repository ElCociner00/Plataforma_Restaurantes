import { getUserContext } from "./session.js";
import { WEBHOOK_LISTAR_RESPONSABLES } from "./webhooks.js";

// ===============================
// CONFIGURACIÓN
// ===============================
const DATA_ENDPOINT = "";
const DEFAULT_PAGES = [
  "dashboard",
  "cierre_turno",
  "historico_cierre_turno",
  "cierre_inventarios",
  "configuracion"
];
const getPermissionsStorageKey = (tenantId) => `permisos_por_usuario_${tenantId || "global"}`;

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
      <span class="resumen-label">Módulos configurables</span>
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
        <label class="permiso-switch" title="${isBlocked ? "Bloqueado (NO)" : "Permitido (SÍ)"}">
          <input
            type="checkbox"
            data-empleado-id="${empleado.id}"
            data-page="${page}"
            ${isBlocked ? "checked" : ""}
          >
          <span aria-hidden="true" class="switch-slider"></span>
          <span class="switch-state">${isBlocked ? "NO" : "SÍ"}</span>
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

const persistPermissionChange = ({ empleadoId, page, value }) => {
  const storageKey = getPermissionsStorageKey(userContext?.empresa_id);
  const stored = localStorage.getItem(storageKey);
  const parsed = stored ? JSON.parse(stored) : {};
  parsed[empleadoId] = {
    ...(parsed[empleadoId] || {}),
    [page]: value
  };
  localStorage.setItem(storageKey, JSON.stringify(parsed));

  setStatus("Cambios de permisos guardados.");
};

const handleToggle = (event) => {
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
    switchState.textContent = value ? "SÍ" : "NO";
  }

  persistPermissionChange({ empleadoId, page, value });
  renderSummary();
};

const handleBulkAction = (event) => {
  const button = event.currentTarget;
  const role = button.dataset.role;
  const action = button.dataset.action;
  const value = action === "grant";

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
      persistPermissionChange({ empleadoId, page, value });
    });

    return updatedEmpleado;
  });

  renderTable();
  attachTableHandlers();
  setStatus(`Acción masiva aplicada para rol ${role}.`);
};

const attachTableHandlers = () => {
  tableContainer.querySelectorAll("input[type=\"checkbox\"]").forEach((input) => {
    input.addEventListener("change", handleToggle);
  });
};

const loadPermissions = async () => {
  if (window.PERMISOS_DATA) return window.PERMISOS_DATA;

  if (!DATA_ENDPOINT) {
    const response = await fetch(WEBHOOK_LISTAR_RESPONSABLES, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        empresa_id: userContext?.empresa_id,
        tenant_id: userContext?.empresa_id,
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

    const storageKey = getPermissionsStorageKey(userContext?.empresa_id);
    const stored = localStorage.getItem(storageKey);
    const storedPermissions = stored ? JSON.parse(stored) : {};

    return {
      pages: DEFAULT_PAGES,
      empleados: responsables.map((item) => ({
        id: item.id ?? item.value ?? item,
        nombre: item.nombre ?? item.name ?? item,
        rol: item.rol ?? item.role ?? "",
        permisos: storedPermissions[item.id ?? item.value ?? item] || {}
      }))
    };
  }

  const response = await fetch(DATA_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      empresa_id: userContext?.empresa_id,
      tenant_id: userContext?.empresa_id,
      usuario_id: userContext?.user?.id || userContext?.user?.user_id,
      solicitado_por: userContext?.user?.id || userContext?.user?.user_id,
      timestamp: getTimestamp()
    })
  });

  const data = await response.json();
  const storageKey = getPermissionsStorageKey(userContext?.empresa_id);
  const stored = localStorage.getItem(storageKey);
  const storedPermissions = stored ? JSON.parse(stored) : {};

  return {
    ...data,
    empleados: (data.empleados || []).map((empleado) => ({
      ...empleado,
      permisos: storedPermissions[empleado.id] || empleado.permisos || {}
    }))
  };
};

// ===============================
// INIT
// ===============================
document.addEventListener("DOMContentLoaded", async () => {
  userContext = await getUserContext();

  if (!userContext) {
    setStatus("No se pudo validar la sesión.");
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
    setStatus(err.message || "No se pudo cargar la información.");
  }

  bulkButtons.forEach((button) => {
    button.addEventListener("click", handleBulkAction);
  });
});
