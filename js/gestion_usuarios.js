import { getUserContext } from "./session.js";
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

const fetchAuthEmailsById = async (empresaId) => {
  const { data, error } = await supabase.functions.invoke("usuarios-admin", {
    body: { action: "listar_emails", empresa_id: empresaId }
  });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.message || "No se pudieron consultar los correos.");
  const users = Array.isArray(data?.usuarios) ? data.usuarios : [];
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
  const emailById = await fetchAuthEmailsById(empresaId).catch(() => new Map());
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

  const rol = String(state.context?.rol || "").toLowerCase();
  const isAdmin = ["admin_root", "admin", "administrador", "master"].includes(rol);
  if (!isAdmin) {
    alert("Acceso denegado: No tienes permisos para gestionar usuarios.");
    window.location.href = "../dashboard/";
    return;
  }

  await refreshData();


  panel?.addEventListener("change", async (event) => {
    const input = event.target.closest('input[data-action="toggle"]');
    if (!input) return;
    const userId = normalize(input.dataset.userId || "");
    const source = normalize(input.dataset.source || "");
    const activo = input.checked;
    const empresaId = state.context?.empresa_id;

    const candidates = source === "otros_usuarios"
      ? [{ table: "otros_usuarios", field: "estado" }, { table: "usuarios_sistema", field: "activo" }]
      : [{ table: "usuarios_sistema", field: "activo" }, { table: "otros_usuarios", field: "estado" }];

    let updated = false;
    let lastError = null;

    for (const candidate of candidates) {
      const query = supabase
        .from(candidate.table)
        .update({ [candidate.field]: activo })
        .eq("id", userId)
        .eq("empresa_id", empresaId)
        .select("id");

      const { data, error } = await query;
      if (error) {
        lastError = error;
        continue;
      }
      if (Array.isArray(data) && data.length > 0) {
        updated = true;
        break;
      }
    }

    if (!updated) {
      setEstado(`No se pudo actualizar el usuario en Supabase${lastError ? `: ${lastError.message || "sin detalle"}` : ". Verifica políticas RLS y empresa_id."}`);
      input.checked = !activo;
      await refreshData();
      return;
    }

    setEstado(`Estado actualizado correctamente en Supabase (${activo ? "activo" : "inactivo"}).`);
    await refreshData();
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
    const payload = { 
      nombre: emp_nombre.value.trim(), 
      cedula: emp_cedula.value.trim(), 
      fecha_ingreso: emp_fecha_ingreso.value, 
      email: emp_email.value.trim(), 
      password: emp_password.value, 
      empresa_id: c.empresa_id, 
      usuario_principal_id: c.empresa_principal_id, // Para soporte de locales
      rol: "operativo" 
    };
    setRegistroEstado("Registrando empleado...");
    const { data, error } = await supabase.functions.invoke("registro-empleados", { body: payload });
    if (error || !data || !data.ok) {
      setRegistroEstado(data?.message || error?.message || "Error registrando empleado.");
    } else {
      setRegistroEstado(data?.message || "Empleado registrado correctamente.");
      formRegistroEmpleado.reset(); 
      await refreshData(); 
    }
  });

  formRegistroOtro?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const c = state.context;
    const payload = { 
      nombre: otro_nombre.value.trim(), 
      cedula: otro_cedula.value.trim(), 
      email: otro_email.value.trim(), 
      password: otro_password.value, 
      rol: otro_rol.value, 
      empresa_id: c.empresa_id, 
      usuario_principal_id: c.empresa_principal_id // Para soporte de locales
    };
    setRegistroEstado("Registrando usuario...");
    const { data, error } = await supabase.functions.invoke("registro-empleados", { body: payload });
    if (error || !data || !data.ok) {
      setRegistroEstado(data?.message || error?.message || "Error registrando usuario.");
    } else {
      setRegistroEstado(data?.message || "Usuario registrado correctamente.");
      formRegistroOtro.reset(); 
      await refreshData(); 
    }
  });
};

init();
