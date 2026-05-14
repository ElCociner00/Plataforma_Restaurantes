import { buildRequestHeaders, getUserContext } from "./session.js";
import { supabase } from "./supabase.js";
import { fetchUsuariosEmpresa } from "./responsables.js";
import { WEBHOOK_REGISTRAR_EMPLEADO, WEBHOOK_REGISTRO_OTROS_USUARIOS } from "./webhooks.js";

// Funciones auxiliares
const normalize = (v) => String(v || "").trim();
const normalizeKey = (v) => normalize(v).toLowerCase();
const escapeHtml = (str) => String(str || "").replace(/[&<>]/g, (m) => ({ 
  '&': '&amp;', 
  '<': '&lt;', 
  '>': '&gt;' 
}[m]));
const getActivoDesdeEstado = (estado) => estado === "activo";

const setEstado = (m) => { 
  const estado = document.getElementById("gestionUsuariosEstado");
  if (estado) estado.textContent = m || ""; 
};

const setEstadoPassword = (m) => { 
  const cambiarContrasenaEstado = document.getElementById("cambiarContrasenaEstado");
  if (cambiarContrasenaEstado) cambiarContrasenaEstado.textContent = m || ""; 
};

const setRegistroEstado = (m) => { 
  const registroInlineEstado = document.getElementById("registroInlineEstado");
  if (registroInlineEstado) registroInlineEstado.textContent = m || ""; 
};

const state = { 
  context: null, 
  rows: [], 
  empresas: [],
  selectedEmpresaId: "" 
};

const buildEmpresaName = (empresa) => {
  return empresa?.nombre_comercial || empresa?.razon_social || "Sin nombre";
};

const renderAlta = () => {
  const tipoRegistroUsuario = document.getElementById("tipoRegistroUsuario");
  const formRegistroEmpleado = document.getElementById("formRegistroEmpleado");
  const formRegistroOtro = document.getElementById("formRegistroOtro");
  
  const t = tipoRegistroUsuario?.value || "";
  if (formRegistroEmpleado) { 
    formRegistroEmpleado.hidden = t !== "empleado"; 
    formRegistroEmpleado.style.display = t === "empleado" ? "block" : "none"; 
  }
  if (formRegistroOtro) { 
    formRegistroOtro.hidden = t !== "otro"; 
    formRegistroOtro.style.display = t === "otro" ? "block" : "none"; 
  }
};

const cargarEmpresas = async () => {
  const { data } = await supabase
    .from("empresas")
    .select("id, nombre_comercial, razon_social")
    .order("nombre_comercial", { ascending: true });

  state.empresas = Array.isArray(data) ? data : [];
};

const ensureFilters = () => {
  const panel = document.getElementById("gestionUsuariosPanel");
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

const cargarData = async () => {
  const empresaId = state.context?.super_admin ? state.selectedEmpresaId : state.context?.empresa_id;
  const superAdmin = state.context?.super_admin === true;

  const usuariosQuery = supabase.from("usuarios_sistema").select("id,empresa_id,nombre_completo,email,rol,activo");
  const otrosQuery = supabase.from("otros_usuarios").select("id,empresa_id,nombre_completo,cedula,estado");
  const empleadosQuery = supabase.from("empleados").select("id,empresa_id,nombre_completo,cedula,estado");

  if (!superAdmin || empresaId) {
    if (empresaId) {
      usuariosQuery.eq("empresa_id", empresaId);
      otrosQuery.eq("empresa_id", empresaId);
      empleadosQuery.eq("empresa_id", empresaId);
    }
  }

  const [usuariosSistemaRes, otrosUsuariosRes, empleadosRes] = await Promise.all([
    usuariosQuery, 
    otrosQuery, 
    empleadosQuery
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
  const panel = document.getElementById("gestionUsuariosPanel");
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

const init = async () => {
  // Obtener contexto del usuario
  state.context = await getUserContext().catch(() => null);
  if (!state.context?.empresa_id && !state.context?.super_admin) {
    setEstado("No se pudo validar la empresa actual.");
    return;
  }

  // Cargar empresas para super admin
  if (state.context?.super_admin) {
    await cargarEmpresas();
    hydrateEmpresaFilter();
  }

  await refreshData();

  // Event listener para reset de contraseña y toggle de activo
  const panel = document.getElementById("gestionUsuariosPanel");
  panel?.addEventListener("click", async (event) => {
    // Reset contraseña
    const resetBtn = event.target.closest('button[data-action="reset"]');
    if (resetBtn) {
      const row = state.rows.find((r) => r.id === (resetBtn.dataset.userId || ""));
      if (!row?.email) {
        setEstado("No se encontró correo para este usuario.");
        return;
      }
      try {
        await ensurePasswordHelpers();
        await window.sendRecoveryForEmail(row.email);
        setEstado(`Correo enviado a ${row.email}.`);
      } catch (error) {
        setEstado(`No se pudo enviar recuperación: ${error.message || "sin detalle"}`);
      }
      return;
    }

    // Toggle activo/inactivo
    const toggleCheckbox = event.target.closest('input[data-action="toggle"]');
    if (toggleCheckbox && toggleCheckbox.type === "checkbox") {
      // Implementar lógica de toggle
      const userId = toggleCheckbox.dataset.userId;
      const source = toggleCheckbox.dataset.source;
      const isActive = toggleCheckbox.checked;
      
      const table = source === "usuarios_sistema" ? "usuarios_sistema" : "otros_usuarios";
      const updateField = source === "usuarios_sistema" ? "activo" : "estado";
      const updateValue = source === "usuarios_sistema" ? isActive : (isActive ? "activo" : "inactivo");
      
      const { error } = await supabase
        .from(table)
        .update({ [updateField]: updateValue })
        .eq("id", userId);
      
      if (error) {
        setEstado(`Error al actualizar: ${error.message}`);
        toggleCheckbox.checked = !isActive;
      } else {
        setEstado(`Usuario ${isActive ? "activado" : "desactivado"} correctamente.`);
        await refreshData();
      }
    }
  });

  // Toggle mostrar/ocultar contraseña
  document.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-toggle-pass]");
    if (!b) return;
    const input = document.getElementById(b.dataset.togglePass || "");
    if (input) input.type = input.type === "password" ? "text" : "password";
  });

  // Cambiar tipo de registro
  const tipoRegistroUsuario = document.getElementById("tipoRegistroUsuario");
  tipoRegistroUsuario?.addEventListener("change", renderAlta);
  renderAlta();

  // Cambiar contraseña
  const cambiarContrasenaForm = document.getElementById("cambiarContrasenaForm");
  const actualPasswordInput = document.getElementById("actualPassword");
  const nuevoPasswordInput = document.getElementById("nuevoPassword");
  
  cambiarContrasenaForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const currentPassword = normalize(actualPasswordInput?.value);
    const newPassword = normalize(nuevoPasswordInput?.value);
    
    if (!currentPassword || !newPassword) {
      setEstadoPassword("Completa contraseña actual y nueva.");
      return;
    }

    const email = state.context?.user?.email;
    if (!email) {
      setEstadoPassword("No se encontró usuario autenticado.");
      return;
    }

    setEstadoPassword("Validando contraseña actual...");
    const { error: authError } = await supabase.auth.signInWithPassword({ 
      email, 
      password: currentPassword 
    });
    
    if (authError) {
      setEstadoPassword("La contraseña actual es incorrecta.");
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

  // Registrar empleado
  const formRegistroEmpleado = document.getElementById("formRegistroEmpleado");
  formRegistroEmpleado?.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    const emp_nombre = document.getElementById("emp_nombre");
    const emp_cedula = document.getElementById("emp_cedula");
    const emp_fecha_ingreso = document.getElementById("emp_fecha_ingreso");
    const emp_email = document.getElementById("emp_email");
    const emp_password = document.getElementById("emp_password");
    
    if (!emp_nombre?.value || !emp_email?.value || !emp_password?.value) {
      setRegistroEstado("Complete todos los campos requeridos.");
      return;
    }
    
    const payload = {
      nombre: emp_nombre.value.trim(),
      cedula: emp_cedula?.value.trim() || "",
      fecha_ingreso: emp_fecha_ingreso?.value || "",
      email: emp_email.value.trim(),
      password: emp_password.value,
      empresa_id: state.context.empresa_id,
      tenant_id: state.context.empresa_id,
      usuario_id: state.context.user?.id || state.context.user?.user_id,
      registrado_por: state.context.user?.id || state.context.user?.user_id,
      timestamp: new Date().toISOString()
    };
    
    const headers = await buildRequestHeaders({ includeTenant: true });
    const res = await fetch(WEBHOOK_REGISTRAR_EMPLEADO, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(payload)
    });
    
    setRegistroEstado(res.ok ? "Empleado registrado correctamente." : "Error registrando empleado.");
    if (res.ok) {
      formRegistroEmpleado.reset();
      await refreshData();
    }
  });

  // Registrar otro usuario
  const formRegistroOtro = document.getElementById("formRegistroOtro");
  formRegistroOtro?.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    const otro_nombre = document.getElementById("otro_nombre");
    const otro_cedula = document.getElementById("otro_cedula");
    const otro_email = document.getElementById("otro_email");
    const otro_password = document.getElementById("otro_password");
    const otro_rol = document.getElementById("otro_rol");
    
    if (!otro_nombre?.value || !otro_email?.value || !otro_password?.value) {
      setRegistroEstado("Complete todos los campos requeridos.");
      return;
    }
    
    const payload = {
      nombre: otro_nombre.value.trim(),
      cedula: otro_cedula?.value.trim() || "",
      email: otro_email.value.trim(),
      password: otro_password.value,
      rol: otro_rol?.value || "revisor",
      empresa_id: state.context.empresa_id,
      tenant_id: state.context.empresa_id,
      usuario_id: state.context.user?.id || state.context.user?.user_id,
      registrado_por: state.context.user?.id || state.context.user?.user_id,
      timestamp: new Date().toISOString()
    };
    
    const headers = await buildRequestHeaders({ includeTenant: true });
    const res = await fetch(WEBHOOK_REGISTRO_OTROS_USUARIOS, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(payload)
    });
    
    setRegistroEstado(res.ok ? "Usuario registrado correctamente." : "Error registrando usuario.");
    if (res.ok) {
      formRegistroOtro.reset();
      await refreshData();
    }
  });
};

// Inicializar la aplicación
init();