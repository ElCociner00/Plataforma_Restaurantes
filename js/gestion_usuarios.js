import { buildRequestHeaders, getUserContext } from "./session.js";
import { supabase } from "./supabase.js";
import { fetchUsuariosEmpresa } from "./responsables.js";
import { WEBHOOK_REGISTRAR_EMPLEADO, WEBHOOK_REGISTRO_OTROS_USUARIOS } from "./webhooks.js";

const panel = document.getElementById("gestionUsuariosPanel");
const estado = document.getElementById("gestionUsuariosEstado");
const cambiarContrasenaForm = document.getElementById("cambiarContrasenaForm");
const actualPasswordInput = document.getElementById("actualPassword");
const nuevoPasswordInput = document.getElementById("nuevoPassword");
const cambiarContrasenaEstado = document.getElementById("cambiarContrasenaEstado");
const tipoRegistroUsuario = document.getElementById("tipoRegistroUsuario");
const formRegistroEmpleado = document.getElementById("formRegistroEmpleado");
const formRegistroOtro = document.getElementById("formRegistroOtro");
const registroInlineEstado = document.getElementById("registroInlineEstado");

// Funciones auxiliares faltantes agregadas
const normalizeKey = (v) => String(v || "").trim().toLowerCase();
const escapeHtml = (str) => String(str || "").replace(/[&<>]/g, (m) => ({ 
  '&': '&amp;', 
  '<': '&lt;', 
  '>': '&gt;' 
}[m]));
const getActivoDesdeEstado = (estado) => estado === "activo";

const normalize = (v) => String(v || "").trim();
const setEstado = (m) => { if (estado) estado.textContent = m || ""; };
const setEstadoPassword = (m) => { if (cambiarContrasenaEstado) cambiarContrasenaEstado.textContent = m || ""; };
const setRegistroEstado = (m) => { if (registroInlineEstado) registroInlineEstado.textContent = m || ""; };

const state = { context: null, rows: [], empresas: [], selectedEmpresaId: "" };

const renderAlta = () => {
  const t = tipoRegistroUsuario?.value || "";
  if (formRegistroEmpleado) { formRegistroEmpleado.hidden = t !== "empleado"; formRegistroEmpleado.style.display = t === "empleado" ? "block" : "none"; }
  if (formRegistroOtro) { formRegistroOtro.hidden = t !== "otro"; formRegistroOtro.style.display = t === "otro" ? "block" : "none"; }
};

// Versión original corregida de cargarData (sin duplicación)
const cargarData = async () => {
  const empresaId = state.context?.empresa_id;
  const usuarios = await fetchUsuariosEmpresa(empresaId);
  const { data: sistema } = await supabase.from("usuarios_sistema").select("id,email").eq("empresa_id", empresaId);
  const emailById = new Map((Array.isArray(sistema) ? sistema : []).map((u) => [normalize(u.id), normalize(u.email)]));
  return usuarios.map((u) => ({
    id: normalize(u.id),
    nombre_persona: normalize(u.nombre_completo),
    usuario: normalize(u.nombre_completo),
    cedula: normalize(u.cedula) || "-",
    rol: normalize(u.rol) || "operativo",
    activo: u.activo !== false,
    source: u.source,
    email: emailById.get(normalize(u.id)) || ""
  }));
};

// Función buildEmpresaName corregida
const buildEmpresaName = (empresa) => {
  return empresa?.nombre_comercial || empresa?.razon_social || "Sin nombre";
};

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

const render = (rows) => {
  if (!panel) return;
  panel.innerHTML = rows.length ? `
    <div class="tabla-wrap"><table class="usuarios-tabla"><thead>
    <tr>
      <th>Nombre completo</th><th>Usuario</th><th>Identificación</th><th>Rol</th><th>Tipo</th><th>Activo</th><th>Reset contraseña</th>
    </tr></thead><tbody>
    ${rows.map((r) => `
      <tr>
        <td>${escapeHtml(r.nombre_persona)}</td>
        <td>${escapeHtml(r.usuario)}</td>
        <td>${escapeHtml(r.cedula)}</td>
        <td>${escapeHtml(r.rol)}</td>
        <td>${r.source === "usuarios_sistema" ? "Empleado" : "Otro usuario"}</td>
        <td><input type="checkbox" data-action="toggle" data-source="${r.source}" data-user-id="${r.id}" ${r.activo ? "checked" : ""}></td>
        <td><button type="button" data-action="reset" data-user-id="${r.id}">Enviar correo</button></td>
      </tr>
    `).join("")}
    </tbody></table></div>` : "<p>No hay usuarios para gestionar.</p>";
};

const refreshData = async () => {
  state.rows = await cargarData();
  render(state.rows);
  setEstado(`Usuarios gestionables: ${state.rows.length}`);
};

const ensurePasswordHelpers = async () => import("./contrasena.js");

// Función init ORIGINAL (sin cambios en la estructura)
const init = async () => {
  state.context = await getUserContext().catch(() => null);
  if (!state.context?.empresa_id) return setEstado("No se pudo validar la empresa actual.");

  // Cargar empresas para super admin si existe la funcionalidad
  if (state.context?.super_admin && typeof cargarEmpresas === 'function') {
    await cargarEmpresas();
    hydrateEmpresaFilter();
  }

  await refreshData();

  panel?.addEventListener("click", async (event) => {
    const resetBtn = event.target.closest('button[data-action="reset"]');
    if (resetBtn) {
      const row = state.rows.find((r) => r.id === (resetBtn.dataset.userId || ""));
      if (!row?.email) return setEstado("No se encontró correo para este usuario.");
      try {
        await ensurePasswordHelpers();
        await window.sendRecoveryForEmail(row.email);
        setEstado(`Correo enviado a ${row.email}.`);
      } catch (error) {
        setEstado(`No se pudo enviar recuperación: ${error.message || "sin detalle"}`);
      }
      return;
    }
  });

  document.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-toggle-pass]");
    if (!b) return;
    const input = document.getElementById(b.dataset.togglePass || "");
    if (input) input.type = input.type === "password" ? "text" : "password";
  });

  tipoRegistroUsuario?.addEventListener("change", renderAlta);
  renderAlta();

  cambiarContrasenaForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const currentPassword = normalize(actualPasswordInput?.value);
    const newPassword = normalize(nuevoPasswordInput?.value);
    if (!currentPassword || !newPassword) return setEstadoPassword("Completa contraseña actual y nueva.");

    const email = state.context?.user?.email;
    if (!email) return setEstadoPassword("No se encontró usuario autenticado.");

    setEstadoPassword("Validando contraseña actual...");
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
    if (authError) return setEstadoPassword("La contraseña actual es incorrecta.");

    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return setEstadoPassword(`No se pudo actualizar: ${error.message || "sin detalle"}`);

    setEstadoPassword("Contraseña actualizada. Debes iniciar sesión nuevamente.");
    await supabase.auth.signOut();
    window.location.href = "../index.html";
  });

  formRegistroEmpleado?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const c = state.context;
    const emp_nombre = document.getElementById("emp_nombre");
    const emp_cedula = document.getElementById("emp_cedula");
    const emp_fecha_ingreso = document.getElementById("emp_fecha_ingreso");
    const emp_email = document.getElementById("emp_email");
    const emp_password = document.getElementById("emp_password");
    
    const payload = { 
      nombre: emp_nombre?.value.trim() || "", 
      cedula: emp_cedula?.value.trim() || "", 
      fecha_ingreso: emp_fecha_ingreso?.value || "", 
      email: emp_email?.value.trim() || "", 
      password: emp_password?.value || "", 
      empresa_id: c.empresa_id, 
      tenant_id: c.empresa_id, 
      usuario_id: c.user?.id || c.user?.user_id, 
      registrado_por: c.user?.id || c.user?.user_id, 
      timestamp: new Date().toISOString() 
    };
    const headers = await buildRequestHeaders({ includeTenant: true });
    const res = await fetch(WEBHOOK_REGISTRAR_EMPLEADO, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(payload) });
    setRegistroEstado(res.ok ? "Empleado registrado correctamente." : "Error registrando empleado.");
    if (res.ok) { formRegistroEmpleado.reset(); await refreshData(); }
  });

  formRegistroOtro?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const c = state.context;
    const otro_nombre = document.getElementById("otro_nombre");
    const otro_cedula = document.getElementById("otro_cedula");
    const otro_email = document.getElementById("otro_email");
    const otro_password = document.getElementById("otro_password");
    const otro_rol = document.getElementById("otro_rol");
    
    const payload = { 
      nombre: otro_nombre?.value.trim() || "", 
      cedula: otro_cedula?.value.trim() || "", 
      email: otro_email?.value.trim() || "", 
      password: otro_password?.value || "", 
      rol: otro_rol?.value || "", 
      empresa_id: c.empresa_id, 
      tenant_id: c.empresa_id, 
      usuario_id: c.user?.id || c.user?.user_id, 
      registrado_por: c.user?.id || c.user?.user_id, 
      timestamp: new Date().toISOString() 
    };
    const headers = await buildRequestHeaders({ includeTenant: true });
    const res = await fetch(WEBHOOK_REGISTRO_OTROS_USUARIOS, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(payload) });
    setRegistroEstado(res.ok ? "Usuario registrado correctamente." : "Error registrando usuario.");
    if (res.ok) { formRegistroOtro.reset(); await refreshData(); }
  });
};

init();
