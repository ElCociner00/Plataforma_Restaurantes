import { getUserContext } from "./session.js";

// ===============================
// CONFIGURACIÓN
// ===============================
const DATA_ENDPOINT = "";
const UPDATE_ENDPOINT = "";

// ===============================
// ELEMENTOS
// ===============================
const tableContainer = document.getElementById("permisosTable");
const status = document.getElementById("status");
const bulkButtons = document.querySelectorAll(".bulk-actions button");

let state = { pages: [], empleados: [] };
let userContext = null;
const getTimestamp = () => new Date().toISOString();

// ===============================
// UTILIDADES
// ===============================
const normalizePages = (pages) =>
  pages.filter((page) => page !== "configuracion" && page !== "permisos");

const renderTable = () => {
  if (!state.empleados.length) {
    tableContainer.innerHTML = "<p class=\"empty\">No hay empleados para mostrar.</p>";
    return;
  }

  const headers = ["Empleado", "Rol", ...state.pages];
  const rows = state.empleados.map((empleado) => {
    const switches = state.pages.map((page) => {
      const isChecked = Boolean(empleado.permisos?.[page]);
      return `
        <label class="permiso-switch">
          <input
            type="checkbox"
            data-empleado-id="${empleado.id}"
            data-page="${page}"
            ${isChecked ? "checked" : ""}
          >
          <span>${isChecked ? "Sí" : "No"}</span>
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
};

const setStatus = (message) => {
  status.textContent = message;
};

const persistPermissionChange = async ({ empleadoId, page, value }) => {
  if (!UPDATE_ENDPOINT) {
    setStatus("Configura UPDATE_ENDPOINT para guardar cambios.");
    return;
  }

  try {
    await fetch(UPDATE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        empleado_id: empleadoId,
        page,
        allowed: value,
        empresa_id: userContext?.empresa_id,
        tenant_id: userContext?.empresa_id,
        usuario_id: userContext?.user?.id || userContext?.user?.user_id,
        actualizado_por: userContext?.user?.id || userContext?.user?.user_id,
        timestamp: getTimestamp()
      })
    });
  } catch (err) {
    setStatus("Error al guardar el permiso.");
  }
};

const handleToggle = (event) => {
  const target = event.target;
  if (!target.matches("input[type=\"checkbox\"]")) return;

  const empleadoId = target.dataset.empleadoId;
  const page = target.dataset.page;
  const value = target.checked;

  const empleado = state.empleados.find((item) => String(item.id) === String(empleadoId));
  if (!empleado) return;

  empleado.permisos = {
    ...empleado.permisos,
    [page]: value
  };

  target.nextElementSibling.textContent = value ? "Sí" : "No";
  persistPermissionChange({ empleadoId, page, value });
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

    return {
      ...empleado,
      permisos: {
        ...empleado.permisos,
        ...permisosActualizados
      }
    };
  });

  renderTable();
  attachTableHandlers();
};

const attachTableHandlers = () => {
  tableContainer.querySelectorAll("input[type=\"checkbox\"]").forEach((input) => {
    input.addEventListener("change", handleToggle);
  });
};

const loadPermissions = async () => {
  if (window.PERMISOS_DATA) return window.PERMISOS_DATA;

  if (!DATA_ENDPOINT) {
    throw new Error("Configura DATA_ENDPOINT para cargar permisos.");
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

  return response.json();
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
    setStatus("");
  } catch (err) {
    setStatus(err.message || "No se pudo cargar la información.");
  }

  bulkButtons.forEach((button) => {
    button.addEventListener("click", handleBulkAction);
  });
});
