import { getUserContext } from "./session.js";
import { supabase } from "./supabase.js";

const panel = document.getElementById("gestionUsuariosPanel");
const estado = document.getElementById("gestionUsuariosEstado");

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

const getActivoDesdeEstado = (value) => {
  if (typeof value === "boolean") return value;
  if (value == null) return true;
  return normalizeKey(value) !== "inactivo";
};

const cargarData = async (empresaId) => {
  const [usuariosSistemaRes, otrosUsuariosRes, empleadosRes] = await Promise.all([
    supabase.from("usuarios_sistema").select("id,nombre_completo,rol,activo").eq("empresa_id", empresaId),
    supabase.from("otros_usuarios").select("id,nombre_completo,cedula,estado").eq("empresa_id", empresaId),
    supabase.from("empleados").select("id,nombre_completo,cedula,estado").eq("empresa_id", empresaId)
  ]);

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
        nombre_persona: normalize(empleadoMatch?.nombre_completo) || normalize(item.nombre_completo) || "Sin nombre",
        usuario: normalize(item.nombre_completo) || "-",
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
        nombre_persona: normalize(empleadoMatch?.nombre_completo) || normalize(item.nombre_completo) || "Sin nombre",
        usuario: normalize(item.nombre_completo) || "-",
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
    panel.innerHTML = "<p>No hay usuarios para gestionar en esta empresa.</p>";
    return;
  }

  panel.innerHTML = `
    <div class="tabla-wrap">
      <table class="usuarios-tabla">
        <thead>
          <tr>
            <th>Nombre completo</th>
            <th>Usuario</th>
            <th>Identificación</th>
            <th>Rol</th>
            <th>Tipo</th>
            <th>Activo</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
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
                    ${row.activo ? "checked" : ""}
                  >
                  <span class="switch-slider"></span>
                </label>
              </td>
            </tr>
          `).join("")}
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

const actualizarEstadoUsuario = async ({ source, userId, activo, empleadoId }) => {
  if (source === "otros_usuarios") {
    const res1 = await supabase.from("otros_usuarios").update({ estado: activo }).eq("id", userId);
    const res2 = await supabase.from("usuarios_sistema").update({ activo }).eq("id", userId).neq("rol", "admin_root");
    if (res1.error) throw res1.error;
    if (res2.error) throw res2.error;
  } else {
    const res1 = await supabase.from("usuarios_sistema").update({ activo }).eq("id", userId).neq("rol", "admin_root");
    const res2 = await supabase.from("otros_usuarios").update({ estado: activo }).eq("id", userId);
    if (res1.error) throw res1.error;
    if (res2.error && !String(res2.error.message || "").toLowerCase().includes("0 rows")) throw res2.error;
  }
  await syncEmpleadoEstado(empleadoId, activo);
};

const init = async () => {
  const context = await getUserContext().catch(() => null);
  if (!context?.empresa_id) {
    setEstado("No se pudo validar la empresa actual.");
    return;
  }

  setEstado("Cargando usuarios...");
  const rows = await cargarData(context.empresa_id);
  render(rows);
  setEstado(`Usuarios gestionables: ${rows.length}`);

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
        empleadoId: input.dataset.empleadoId
      });
      const refreshed = await cargarData(context.empresa_id);
      render(refreshed);
      setEstado("Estado actualizado correctamente.");
    } catch (error) {
      setEstado(`No se pudo actualizar el usuario: ${error.message || "sin detalle"}`);
    }
  });
};

init();
