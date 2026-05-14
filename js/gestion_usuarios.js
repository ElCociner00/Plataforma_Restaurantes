/**
 * MAPA DE MANTENIMIENTO (guía rápida para cambios manuales)
 * Archivo: js/gestion_usuarios.js
 *
 * Partes del archivo:
 * 1) Imports/constantes de configuración (dependencias y estado base).
 * 2) Utilidades puras y normalizadores (cálculos/formato/validaciones).
 * 3) Lógica principal del módulo (flujo funcional).
 * 4) Eventos/integraciones externas (DOM, API, webhooks, storage).
 *
 * Índice de funciones/bloques para ubicarte rápido:
 * - `normalize` (línea aprox. 7): Bloque funcional del módulo.
 * - `normalizeKey` (línea aprox. 8): Bloque funcional del módulo.
 * - `escapeHtml` (línea aprox. 9): Bloque funcional del módulo.
 * - `setEstado` (línea aprox. 16): Asigna/actualiza estado.
 * - `getActivoDesdeEstado` (línea aprox. 20): Obtiene un valor o recurso.
 * - `buildEmpresaName` (línea aprox. 33): Construye estructuras de datos.
 * - `ensureFilters` (línea aprox. 35): Bloque funcional del módulo.
 * - `hydrateEmpresaFilter` (línea aprox. 52): Trabaja con contexto o datos de empresa.
 * - `cargarEmpresas` (línea aprox. 72): Trabaja con contexto o datos de empresa.
 * - `cargarData` (línea aprox. 81): Bloque funcional del módulo.
 * - `render` (línea aprox. 138): Renderiza/actualiza UI.
 * - `syncEmpleadoEstado` (línea aprox. 195): Sincroniza valores/estado.
 * - `actualizarEstadoUsuario` (línea aprox. 202): Bloque funcional del módulo.
 * - `refreshData` (línea aprox. 221): Bloque funcional del módulo.
 * - `init` (línea aprox. 228): Inicializa/configura comportamiento.
 *
 * Nota: este mapa no altera la lógica; sirve para navegar y parchear sin riesgo funcional.
 */
import { getUserContext } from "./session.js";
import { supabase } from "./supabase.js";

const panel = document.getElementById("gestionUsuariosPanel");
const estado = document.getElementById("gestionUsuariosEstado");
const cambiarContrasenaForm = document.getElementById("cambiarContrasenaForm");
const nuevoPasswordInput = document.getElementById("nuevoPassword");
const cambiarContrasenaEstado = document.getElementById("cambiarContrasenaEstado");

const normalize = (value) => String(value || "").trim();
const normalizeKey = (value) => normalize(value).toLowerCase();
const escapeHtml = (value) => normalize(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const setEstado = (message) => {
  if (estado) estado.textContent = message || "";
};

const setEstadoPassword = (message) => {
  if (cambiarContrasenaEstado) cambiarContrasenaEstado.textContent = message || "";
};

const getActivoDesdeEstado = (value) => {
  if (typeof value === "boolean") return value;
  if (value == null) return true;
  return normalizeKey(value) !== "inactivo";
};

const state = {
  context: null,
  empresas: [],
  selectedEmpresaId: "",
  rows: []
};

let passwordHelpersLoaded = false;

const ensurePasswordHelpers = async () => {
  if (passwordHelpersLoaded) return;
  await import("./contrasena.js");
  passwordHelpersLoaded = true;
};

const buildEmpresaName = (empresa) => empresa?.nombre_comercial || empresa?.razon_social || empresa?.id || "(Sin nombre)";

const ensureFilters = () => {
  if (!panel) return null;
  let wrapper = document.getElementById("gestionUsuariosFiltros");
  if (wrapper) return wrapper;

  wrapper = document.createElement("div");
  wrapper.id = "gestionUsuariosFiltros";
  wrapper.style.margin = "12px 0";
  wrapper.innerHTML = `
    <label for="gestionUsuariosEmpresaSelect"><strong>Empresa:</strong></label>
    <select id="gestionUsuariosEmpresaSelect" style="margin-left:8px"></select>
  `;

  panel.parentElement?.insertBefore(wrapper, panel);
  return wrapper;
};

const hydrateEmpresaFilter = () => {
  if (state.context?.super_admin !== true) return;
  const wrapper = ensureFilters();
  const select = wrapper?.querySelector("#gestionUsuariosEmpresaSelect");
  if (!select) return;

  const options = [
    '<option value="">Todas las empresas</option>',
    ...state.empresas.map((empresa) => `<option value="${empresa.id}">${escapeHtml(buildEmpresaName(empresa))}</option>`)
  ];

  select.innerHTML = options.join("");
  select.value = state.selectedEmpresaId || "";

  select.onchange = async () => {
    state.selectedEmpresaId = select.value || "";
    await refreshData();
  };
};

const cargarEmpresas = async () => {
  const { data } = await supabase
    .from("empresas")
    .select("id, nombre_comercial, razon_social")
    .order("nombre_comercial", { ascending: true });

  state.empresas = Array.isArray(data) ? data : [];
};

const cargarData = async ({ empresaId = "", superAdmin = false } = {}) => {
  const usuariosQuery = supabase.from("usuarios_sistema").select("id,empresa_id,nombre_completo,email,rol,activo");
  const otrosQuery = supabase.from("otros_usuarios").select("id,empresa_id,nombre_completo,cedula,estado");
  const empleadosQuery = supabase.from("empleados").select("id,empresa_id,nombre_completo,cedula,estado");

  if (!superAdmin || empresaId) {
    usuariosQuery.eq("empresa_id", empresaId);
    otrosQuery.eq("empresa_id", empresaId);
    empleadosQuery.eq("empresa_id", empresaId);
  }

  const [usuariosSistemaRes, otrosUsuariosRes, empleadosRes] = await Promise.all([usuariosQuery, otrosQuery, empleadosQuery]);

  const empleados = Array.isArray(empleadosRes.data) ? empleadosRes.data : [];
  const byEmpleadoId = new Map(empleados.map((item) => [normalize(item.id), item]));
  const byEmpleadoNombre = new Map(empleados.map((item) => [normalizeKey(item.nombre_completo), item]));

  const usuariosSistema = (Array.isArray(usuariosSistemaRes.data) ? usuariosSistemaRes.data : [])
    .filter((item) => normalizeKey(item.rol) !== "admin_root")
    .map((item) => {
      const empleadoMatch = byEmpleadoId.get(normalize(item.id))
        || byEmpleadoNombre.get(normalizeKey(item.nombre_completo));
      return {
        source: "usuarios_sistema",
        id: normalize(item.id),
        empresa_id: normalize(item.empresa_id),
        nombre_persona: normalize(empleadoMatch?.nombre_completo) || normalize(item.nombre_completo) || "Sin nombre",
        usuario: normalize(item.nombre_completo) || "-",
        email: normalize(item.email),
        cedula: normalize(empleadoMatch?.cedula) || "-",
        rol: normalize(item.rol) || "operativo",
        activo: item.activo !== false,
        empleado_id: normalize(empleadoMatch?.id)
      };
    });

  const otrosUsuarios = (Array.isArray(otrosUsuariosRes.data) ? otrosUsuariosRes.data : [])
    .map((item) => {
      const empleadoMatch = byEmpleadoId.get(normalize(item.id))
        || byEmpleadoNombre.get(normalizeKey(item.nombre_completo));
      return {
        source: "otros_usuarios",
        id: normalize(item.id),
        empresa_id: normalize(item.empresa_id),
        nombre_persona: normalize(empleadoMatch?.nombre_completo) || normalize(item.nombre_completo) || "Sin nombre",
        usuario: normalize(item.nombre_completo) || "-",
        email: "",
        cedula: normalize(item.cedula) || normalize(empleadoMatch?.cedula) || "-",
        rol: "revisor",
        activo: getActivoDesdeEstado(item.estado),
        empleado_id: normalize(empleadoMatch?.id)
      };
    });

  return [...usuariosSistema, ...otrosUsuarios]
    .filter((item) => item.id)
    .sort((a, b) => a.nombre_persona.localeCompare(b.nombre_persona, "es"));
};

const render = (rows) => {
  if (!panel) return;
  if (!rows.length) {
    panel.innerHTML = "<p>No hay usuarios para gestionar en el alcance seleccionado.</p>";
    return;
  }

  const showEmpresa = state.context?.super_admin === true;

  panel.innerHTML = `
    <div class="tabla-wrap">
      <table class="usuarios-tabla">
        <thead>
          <tr>
            ${showEmpresa ? "<th>Empresa</th>" : ""}
            <th>Nombre completo</th>
            <th>Usuario</th>
            <th>Identificación</th>
            <th>Rol</th>
            <th>Tipo</th>
            <th>Activo</th>
            <th>Reset contraseña</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => {
            const empresaName = buildEmpresaName(state.empresas.find((item) => item.id === row.empresa_id));
            return `
            <tr>
              ${showEmpresa ? `<td>${escapeHtml(empresaName)}</td>` : ""}
              <td>${escapeHtml(row.nombre_persona)}</td>
              <td>${escapeHtml(row.usuario)}</td>
              <td>${escapeHtml(row.cedula)}</td>
              <td>${escapeHtml(row.rol)}</td>
              <td><span class="badge ${row.source === "usuarios_sistema" ? "empleado" : "otro"}">${row.source === "usuarios_sistema" ? "Empleado" : "Otro usuario"}</span></td>
              <td>
                <label class="switch-cell">
                  <input
                    type="checkbox"
                    data-action="toggle"
                    data-source="${escapeHtml(row.source)}"
                    data-user-id="${escapeHtml(row.id)}"
                    data-empleado-id="${escapeHtml(row.empleado_id)}"
                    ${row.empresa_id ? `data-empresa-id="${escapeHtml(row.empresa_id)}"` : ""}
                    ${row.activo ? "checked" : ""}
                  >
                  <span class="switch-slider"></span>
                </label>
              </td>
              <td>
                <button type="button" data-action="reset" data-user-id="${escapeHtml(row.id)}">Enviar correo</button>
              </td>
            </tr>
          `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
};

const syncEmpleadoEstado = async (empleadoId, activo) => {
  const id = normalize(empleadoId);
  if (!id) return;
  const { error } = await supabase.from("empleados").update({ estado: activo ? "activo" : "inactivo" }).eq("id", id);
  if (error) throw error;
};

const actualizarEstadoUsuario = async ({ source, userId, activo, empleadoId, empresaId }) => {
  if (source === "otros_usuarios") {
    const res1 = await supabase.from("otros_usuarios").update({ estado: activo }).eq("id", userId);
    const usuariosUpdate = supabase.from("usuarios_sistema").update({ activo }).eq("id", userId).neq("rol", "admin_root");
    if (empresaId) usuariosUpdate.eq("empresa_id", empresaId);
    const res2 = await usuariosUpdate;
    if (res1.error) throw res1.error;
    if (res2.error) throw res2.error;
  } else {
    const usuariosUpdate = supabase.from("usuarios_sistema").update({ activo }).eq("id", userId).neq("rol", "admin_root");
    if (empresaId) usuariosUpdate.eq("empresa_id", empresaId);
    const res1 = await usuariosUpdate;
    const res2 = await supabase.from("otros_usuarios").update({ estado: activo }).eq("id", userId);
    if (res1.error) throw res1.error;
    if (res2.error && !String(res2.error.message || "").toLowerCase().includes("0 rows")) throw res2.error;
  }
  await syncEmpleadoEstado(empleadoId, activo);
};

const refreshData = async () => {
  const empresaId = state.context?.super_admin ? state.selectedEmpresaId : state.context?.empresa_id;
  state.rows = await cargarData({ empresaId, superAdmin: state.context?.super_admin === true });
  render(state.rows);
  setEstado(`Usuarios gestionables: ${state.rows.length}`);
};

const init = async () => {
  state.context = await getUserContext().catch(() => null);

  if (!state.context) {
    setEstado("No se pudo validar la sesión.");
    return;
  }

  if (!state.context?.empresa_id && state.context?.super_admin !== true) {
    setEstado("No se pudo validar la empresa actual.");
    return;
  }

  setEstado("Cargando usuarios...");

  if (state.context?.super_admin === true) {
    await cargarEmpresas();
    hydrateEmpresaFilter();
  }

  await refreshData();

  panel?.addEventListener("change", async (event) => {
    const input = event.target.closest('input[data-action="toggle"]');
    if (!input) return;

    input.disabled = true;
    setEstado("Actualizando estado de usuario...");
    try {
      await actualizarEstadoUsuario({
        source: input.dataset.source,
        userId: input.dataset.userId,
        activo: input.checked,
        empleadoId: input.dataset.empleadoId,
        empresaId: input.dataset.empresaId
      });
      await refreshData();
      setEstado("Estado actualizado correctamente.");
    } catch (error) {
      setEstado(`No se pudo actualizar el usuario: ${error.message || "sin detalle"}`);
    } finally {
      input.disabled = false;
    }
  });

  panel?.addEventListener("click", async (event) => {
    const btn = event.target.closest('button[data-action="reset"]');
    if (!btn) return;
    const userId = btn.dataset.userId || "";
    const row = state.rows.find((item) => item.id === userId);
    if (!row) return;
    if (!row.email) {
      setEstado("No se encontró correo para este usuario.");
      return;
    }

    btn.disabled = true;
    setEstado("Enviando correo de recuperación...");
    try {
      await ensurePasswordHelpers();
      await window.sendRecoveryForEmail(row.email);
      setEstado(`Correo enviado a ${row.email}.`);
    } catch (error) {
      setEstado(`No se pudo enviar recuperación: ${error.message || "sin detalle"}`);
    } finally {
      btn.disabled = false;
    }
  });

  cambiarContrasenaForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const newPassword = String(nuevoPasswordInput?.value || "").trim();
    if (!newPassword) {
      setEstadoPassword("Ingresa una contraseña nueva.");
      return;
    }
    setEstadoPassword("Actualizando contraseña...");
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      setEstadoPassword(`No se pudo actualizar: ${error.message || "sin detalle"}`);
      return;
    }
    setEstadoPassword("Contraseña actualizada. Debes iniciar sesión nuevamente.");
    setTimeout(async () => {
      await supabase.auth.signOut();
      window.location.href = "../index.html";
    }, 1200);
  });
};

init();
