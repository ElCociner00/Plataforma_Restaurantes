import { supabase } from "./supabase.js";
import { sendRecoveryForEmail } from "./contrasena.js";

const form = document.getElementById("resetPasswordForm");
const nuevaContrasena = document.getElementById("nuevaContrasena");
const toggleNuevaContrasena = document.getElementById("toggleNuevaContrasena");
const estado = document.getElementById("estadoReset");
const recoveryEmail = document.getElementById("recoveryEmail");
const cedulaRecovery = document.getElementById("cedulaRecovery");
const verificarCedulaBtn = document.getElementById("verificarCedulaBtn");
const identityHint = document.getElementById("identityHint");
const identityBlock = document.getElementById("identityBlock");

const setEstado = (m) => { if (estado) estado.textContent = m || ""; };
const setHint = (m) => { if (identityHint) identityHint.textContent = m || ""; };

const getRecoveryParams = () => {
  const hash = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search || "");
  return {
    access_token: hash.get("access_token") || query.get("access_token"),
    refresh_token: hash.get("refresh_token") || query.get("refresh_token"),
    token_hash: hash.get("token_hash") || query.get("token_hash"),
    type: hash.get("type") || query.get("type"),
    code: hash.get("code") || query.get("code")
  };
};

const hasRecoveryTokens = () => {
  const params = getRecoveryParams();
  return Boolean(params.access_token || params.token_hash || params.code);
};

const maskEmail = (email) => {
  const [name, domain] = String(email || "").split("@");
  if (!name || !domain) return "correo no disponible";
  return `${name.slice(0, 2)}***@${domain}`;
};

const normalizeLookupText = (value) => String(value || "").trim();

const firstRowByCedula = async (tableName, cedula) => {
  const { data, error } = await supabase
    .from(tableName)
    .select("id,nombre_completo,cedula")
    .eq("cedula", cedula)
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) ? data[0] || null : null;
};

const firstUsuarioSistemaBy = async ({ id, nombreCompleto }) => {
  const cleanId = normalizeLookupText(id);
  const cleanNombre = normalizeLookupText(nombreCompleto);

  if (cleanId) {
    const { data, error } = await supabase
      .from("usuarios_sistema")
      .select("id,nombre_completo,correo")
      .eq("id", cleanId)
      .limit(1);
    if (!error) {
      const row = Array.isArray(data) ? data[0] || null : null;
      if (row?.correo) return row;
    }
  }

  if (!cleanNombre) return null;
  const { data, error } = await supabase
    .from("usuarios_sistema")
    .select("id,nombre_completo,correo")
    .eq("nombre_completo", cleanNombre)
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) ? data[0] || null : null;
};

const resolveEmailByCedula = async (cedula) => {
  const pasos = [];

  pasos.push("Buscando coincidencia en otros_usuarios.cedula...");
  const otroUsuario = await firstRowByCedula("otros_usuarios", cedula);
  if (otroUsuario) {
    pasos.push("Coincidencia encontrada en otros_usuarios; resolviendo correo en usuarios_sistema...");
    const usuarioSistema = await firstUsuarioSistemaBy({
      id: otroUsuario.id,
      nombreCompleto: otroUsuario.nombre_completo
    });
    if (usuarioSistema?.correo) {
      return {
        email: usuarioSistema.correo,
        source: "otros_usuarios->usuarios_sistema",
        userId: usuarioSistema.id,
        pasos
      };
    }
    pasos.push("otros_usuarios no tenía usuario_sistema con correo; continuando fallback a empleados...");
  } else {
    pasos.push("Sin coincidencia en otros_usuarios; continuando fallback a empleados...");
  }

  const empleado = await firstRowByCedula("empleados", cedula);
  if (!empleado?.nombre_completo) {
    return { email: null, source: null, pasos: [...pasos, "Sin coincidencia en empleados.cedula."] };
  }

  pasos.push("Coincidencia encontrada en empleados; buscando usuarios_sistema por nombre_completo...");
  const usuarioSistema = await firstUsuarioSistemaBy({ nombreCompleto: empleado.nombre_completo });
  if (!usuarioSistema?.correo) {
    return { email: null, source: "empleados", pasos: [...pasos, "No se encontró correo en usuarios_sistema para ese empleado."] };
  }

  return {
    email: usuarioSistema.correo,
    source: "empleados->usuarios_sistema",
    userId: usuarioSistema.id,
    pasos
  };
};

if (recoveryEmail) recoveryEmail.value = String(new URLSearchParams(window.location.search || "").get("email") || "").trim();
setEstado("Ingresa tu nueva contraseña. Si el enlace falla, verifica tu cédula/NIT para solicitar uno nuevo.");

verificarCedulaBtn?.addEventListener("click", async () => {
  const cedula = String(cedulaRecovery?.value || "").trim();
  if (!cedula) {
    setEstado("Ingresa tu cédula o NIT antes de verificar.");
    return;
  }

  setHint("Verificando identidad...");
  try {
    const resolved = await resolveEmailByCedula(cedula);
    if (!resolved?.email) {
      setHint((resolved?.pasos || []).join(" → "));
      setEstado("No encontramos un usuario con esa cédula/NIT o no tiene correo asociado en usuarios_sistema. Verifica el dato e intenta de nuevo.");
      return;
    }
    setHint((resolved.pasos || []).join(" → "));
    await sendRecoveryForEmail(resolved.email);
    if (recoveryEmail) recoveryEmail.value = resolved.email;
    setHint(`Usuario validado desde ${resolved.source}. Abre el nuevo enlace para cargar el token de recuperación.`);
    setEstado(`Identidad verificada. Enviamos un nuevo enlace de recuperación a ${maskEmail(resolved.email)} para que puedas cambiar la contraseña con un token válido.`);
  } catch (error) {
    setHint("");
    setEstado(`No fue posible verificar la identidad (${error.message || "sin detalle"}).`);
  }
});

const ensureRecoverySession = async () => {
  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData?.session) return;

  const { access_token, refresh_token, token_hash, type, code } = getRecoveryParams();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return;
  }

  if (access_token && refresh_token) {
    const { error } = await supabase.auth.setSession({ access_token, refresh_token });
    if (error) throw error;
    return;
  }

  if (token_hash && type === "recovery") {
    const { error } = await supabase.auth.verifyOtp({ token_hash, type: "recovery" });
    if (error) throw error;
    return;
  }

  throw new Error("Missing recovery tokens");
};

const toggleIdentityByToken = () => {
  const hideIdentity = hasRecoveryTokens();
  if (identityBlock) identityBlock.style.display = hideIdentity ? "none" : "block";
};

toggleIdentityByToken();

toggleNuevaContrasena?.addEventListener("click", () => {
  if (!nuevaContrasena) return;
  const showing = nuevaContrasena.type === "text";
  nuevaContrasena.type = showing ? "password" : "text";
  toggleNuevaContrasena.textContent = showing ? "👁️" : "🙈";
  toggleNuevaContrasena.setAttribute("aria-label", showing ? "Mostrar contraseña" : "Ocultar contraseña");
});

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const nueva = String(nuevaContrasena?.value || "").trim();
  if (!nueva) return setEstado("Ingresa una nueva contraseña.");
  if (nueva.length < 8) return setEstado("La nueva contraseña debe tener al menos 8 caracteres.");

  try {
    await ensureRecoverySession();
  } catch (error) {
    return setEstado("Enlace inválido o expirado. Usa 'Verificar' para solicitar uno nuevo.");
  }

  const { error } = await supabase.auth.updateUser({ password: nueva });
  if (error) return setEstado(`No se pudo actualizar: ${error.message || "sin detalle"}`);

  setEstado("Contraseña actualizada. Inicia sesión con tu nueva contraseña.");
  setTimeout(() => {
    window.location.href = "../index.html";
  }, 1200);
});
