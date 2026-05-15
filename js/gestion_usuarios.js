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

const normalize = (v) => String(v || "").trim();
const setEstado = (m) => { if (estado) estado.textContent = m || ""; };
const setEstadoPassword = (m) => { if (cambiarContrasenaEstado) cambiarContrasenaEstado.textContent = m || ""; };
const setRegistroEstado = (m) => { if (registroInlineEstado) registroInlineEstado.textContent = m || ""; };

const state = { context: null, rows: [] };

const SUPABASE_AUTH_ADMIN_URL = "https://ivgzwgyjyqfunheaesxx.supabase.co/auth/v1/admin/users";
const SUPABASE_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml2Z3p3Z3lqeXFmdW5oZWFlc3h4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTg2MDEwNSwiZXhwIjoyMDg1NDM2MTA1fQ.9z5NrjmIiPoopEAxDb47ic6eTYDfP-iWL63ObZQnNIs";

const fetchAuthEmailsById = async () => {
  const res = await fetch(SUPABASE_AUTH_ADMIN_URL, {
    method: "GET",
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json"
    }
  });
  const data = await res.json().catch(() => ({}));
  const users = Array.isArray(data?.users) ? data.users : [];
  return new Map(users.map((u) => [normalize(u.id), normalize(u.email)]));
};


const renderAlta = () => {
  const t = tipoRegistroUsuario?.value || "";
  if (formRegistroEmpleado) { formRegistroEmpleado.hidden = t !== "empleado"; formRegistroEmpleado.style.display = t === "empleado" ? "block" : "none"; }
  if (formRegistroOtro) { formRegistroOtro.hidden = t !== "otro"; formRegistroOtro.style.display = t === "otro" ? "block" : "none"; }
};

const cargarData = async () => {
  const empresaId = state.context?.empresa_id;
  const usuarios = await fetchUsuariosEmpresa(empresaId);
  const emailById = await fetchAuthEmailsById().catch(() => new Map());
  return usuarios.filter((u) => normalize(u.rol).toLowerCase() !== "admin_root").map((u) => ({
    id: normalize(u.id),
    nombre_persona: normalize(u.nombre_completo),
    cedula: normalize(u.cedula) || "-",
    rol: normalize(u.rol) || "operativo",
    activo: u.activo !== false,
    source: u.source,
    email: emailById.get(normalize(u.id)) || ""
  }));
};

const render = (rows) => {
  if (!panel) return;
  panel.innerHTML = rows.length ? `
    <div class="tabla-wrap"><table class="usuarios-tabla"><thead><tr>
    <th>Nombre completo</th><th>Identificación</th><th>Rol</th><th>Tipo</th><th>Activo</th><th>Reset contraseña</th>
    </tr></thead><tbody>
    ${rows.map((r) => `<tr>
      <td>${r.nombre_persona}</td><td>${r.cedula}</td><td>${r.rol}</td>
      <td>${r.source === "usuarios_sistema" ? "Empleado" : "Otro usuario"}</td>
      <td><label class="switch-cell"><input type="checkbox" data-action="toggle" data-source="${r.source}" data-user-id="${r.id}" ${r.activo ? "checked" : ""}><span class="switch-slider"></span></label></td>
      <td><button type="button" data-action="reset" data-user-id="${r.id}">Enviar correo</button></td>
    </tr>`).join("")}
    </tbody></table></div>` : "<p>No hay usuarios para gestionar.</p>";
};

const refreshData = async () => {
  state.rows = await cargarData();
  render(state.rows);
  setEstado(`Usuarios gestionables: ${state.rows.length}`);
};

const ensurePasswordHelpers = async () => import("./contrasena.js");

const init = async () => {
  state.context = await getUserContext().catch(() => null);
  if (!state.context?.empresa_id) return setEstado("No se pudo validar la empresa actual.");

  await refreshData();


  panel?.addEventListener("change", async (event) => {
    const input = event.target.closest('input[data-action="toggle"]');
    if (!input) return;
    const userId = input.dataset.userId || "";
    const source = input.dataset.source || "";
    const activo = input.checked;
    const table = source === "otros_usuarios" ? "otros_usuarios" : "usuarios_sistema";
    const field = source === "otros_usuarios" ? "estado" : "activo";
    const { error } = await supabase.from(table).update({ [field]: activo }).eq("id", userId);
    if (error) { setEstado(`No se pudo actualizar el usuario: ${error.message || "sin detalle"}`); await refreshData(); return; }
    setEstado("Estado actualizado correctamente.");
  });

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
    const payload = { nombre: emp_nombre.value.trim(), cedula: emp_cedula.value.trim(), fecha_ingreso: emp_fecha_ingreso.value, email: emp_email.value.trim(), password: emp_password.value, empresa_id: c.empresa_id, tenant_id: c.empresa_id, usuario_id: c.user?.id || c.user?.user_id, registrado_por: c.user?.id || c.user?.user_id, timestamp: new Date().toISOString() };
    const headers = await buildRequestHeaders({ includeTenant: true });
    const res = await fetch(WEBHOOK_REGISTRAR_EMPLEADO, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(payload) });
    setRegistroEstado(res.ok ? "Empleado registrado correctamente." : "Error registrando empleado.");
    if (res.ok) { formRegistroEmpleado.reset(); await refreshData(); }
  });

  formRegistroOtro?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const c = state.context;
    const payload = { nombre: otro_nombre.value.trim(), cedula: otro_cedula.value.trim(), email: otro_email.value.trim(), password: otro_password.value, rol: otro_rol.value, empresa_id: c.empresa_id, tenant_id: c.empresa_id, usuario_id: c.user?.id || c.user?.user_id, registrado_por: c.user?.id || c.user?.user_id, timestamp: new Date().toISOString() };
    const headers = await buildRequestHeaders({ includeTenant: true });
    const res = await fetch(WEBHOOK_REGISTRO_OTROS_USUARIOS, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(payload) });
    setRegistroEstado(res.ok ? "Usuario registrado correctamente." : "Error registrando usuario.");
    if (res.ok) { formRegistroOtro.reset(); await refreshData(); }
  });
};

init();
