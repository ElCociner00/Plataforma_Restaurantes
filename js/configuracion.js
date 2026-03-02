import { getUserContext } from "./session.js";
import { supabase } from "./supabase.js";

const panel = document.getElementById("usuariosSistemaPanel");
const estado = document.getElementById("usuariosSistemaEstado");

const setEstado = (msg) => {
  if (estado) estado.textContent = msg;
};

const formatRol = (rol) => {
  const val = String(rol || "").trim().toLowerCase();
  if (!val) return "Sin rol";
  if (val === "admin_root") return "Super admin";
  if (val === "admin") return "Admin";
  if (val === "revisor") return "Revisor";
  return val.charAt(0).toUpperCase() + val.slice(1);
};

const formatAñadidoPor = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "Sin dato";
  return raw;
};

const escapeHtml = (value) => String(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/\"/g, "&quot;")
  .replace(/'/g, "&#039;");

const renderTabla = (rows) => {
  if (!panel) return;
  if (!rows.length) {
    panel.innerHTML = "<p class='usuarios-vacio'>No hay usuarios para esta empresa.</p>";
    return;
  }

  const body = rows.map((row) => {
    const nombre = escapeHtml(row.nombre_completo || "Sin nombre");
    const rol = escapeHtml(formatRol(row.rol));
    const agregado = escapeHtml(formatAñadidoPor(row["añadido_por"]));
    const estadoBtn = row.activo ? "Activo" : "Inactivo";
    const claseBtn = row.activo ? "on" : "off";
    const nextState = row.activo ? "false" : "true";
    return "<tr>"
      + "<td>" + nombre + "</td>"
      + "<td>" + rol + "</td>"
      + "<td>" + agregado + "</td>"
      + "<td><button type='button' class='toggle-usuario " + claseBtn + "' data-user-id='" + row.id + "' data-next-state='" + nextState + "'>" + estadoBtn + "</button></td>"
      + "</tr>";
  }).join("");

  panel.innerHTML = "<div class='usuarios-tabla-wrap'><table class='usuarios-tabla'><thead><tr><th>Nombre</th><th>Rol</th><th>Anadido por</th><th>Estado</th></tr></thead><tbody>" + body + "</tbody></table></div>";
};

const cargarUsuarios = async () => {
  const context = await getUserContext();
  if (!context?.empresa_id) {
    setEstado("No se pudo validar la empresa actual.");
    return;
  }

  setEstado("Cargando usuarios...");

  const { data, error } = await supabase
    .from("usuarios_sistema")
    .select('id,nombre_completo,rol,activo,"añadido_por"')
    .eq("empresa_id", context.empresa_id)
    .order("nombre_completo", { ascending: true });

  if (error) {
    setEstado("Error cargando usuarios: " + (error.message || "sin detalle"));
    panel.innerHTML = "";
    return;
  }

  const rows = Array.isArray(data) ? data : [];
  renderTabla(rows);
  setEstado("Usuarios cargados: " + rows.length + ".");
};

panel?.addEventListener("click", async (event) => {
  const button = event.target.closest(".toggle-usuario");
  if (!button) return;

  const userId = button.dataset.userId;
  const nextState = button.dataset.nextState === "true";
  if (!userId) return;

  button.disabled = true;
  setEstado("Actualizando estado de usuario...");

  const { error } = await supabase
    .from("usuarios_sistema")
    .update({ activo: nextState })
    .eq("id", userId);

  if (error) {
    setEstado("No se pudo actualizar estado: " + (error.message || "sin detalle"));
    button.disabled = false;
    return;
  }

  await cargarUsuarios();
});

cargarUsuarios();
