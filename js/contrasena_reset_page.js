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

const resolveEmailByCedula = async (cedula) => {
  const { data: otros, error: errOtros } = await supabase
    .from("otros_usuarios")
    .select("correo")
    .eq("cedula", cedula)
    .maybeSingle();
  if (errOtros) throw errOtros;
  if (otros?.correo) return { email: otros.correo, source: "otros_usuarios" };

  const { data: empleado, error: errEmp } = await supabase
    .from("empleados")
    .select("nombre_completo")
    .eq("cedula", cedula)
    .maybeSingle();
  if (errEmp) throw errEmp;
  if (!empleado?.nombre_completo) return null;

  const { data: usuarioSistema, error: errUsr } = await supabase
    .from("usuarios_sistema")
    .select("correo")
    .eq("nombre_completo", empleado.nombre_completo)
    .maybeSingle();
  if (errUsr) throw errUsr;
  if (!usuarioSistema?.correo) return null;
  return { email: usuarioSistema.correo, source: "empleados->usuarios_sistema" };
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
      setHint("");
      setEstado("No encontramos un usuario con esa cédula/NIT. Verifica el dato e intenta de nuevo.");
      return;
    }
    await sendRecoveryForEmail(resolved.email);
    if (recoveryEmail) recoveryEmail.value = resolved.email;
    setHint(`Usuario validado desde ${resolved.source}.`);
    setEstado(`Identidad verificada. Enviamos un nuevo enlace de recuperación a ${maskEmail(resolved.email)}.`);
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
