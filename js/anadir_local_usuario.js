import { getUserContext } from "./session.js";
import { supabase } from "./supabase.js";
import { APP_URLS } from "./urls.js";

const status = document.getElementById("status");
const form = document.getElementById("registroUsuarioLocal");
const nombreVisibleInput = document.getElementById("nombre_visible");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const correoSugerido = document.getElementById("correoSugerido");

const localNIT = sessionStorage.getItem("local_dependiente_nit");
const localCorreo = sessionStorage.getItem("local_dependiente_correo");
const localEmpresaId = sessionStorage.getItem("local_dependiente_empresa_id");

const setStatus = (message) => {
  if (status) status.innerText = message || "";
};

const canManageLocals = (userContext) => ["admin", "admin_root"].includes(String(userContext?.rol || "").toLowerCase());

let context = null;

const init = async () => {
  context = await getUserContext().catch(() => null);
  if (!context?.empresa_id) {
    setStatus("No se pudo resolver la empresa activa. Vuelve a iniciar sesión antes de continuar.");
    form.style.display = "none";
    return;
  }

  if (!canManageLocals(context)) {
    setStatus("No tienes permisos para preparar usuarios de un nuevo local.");
    form.style.display = "none";
    return;
  }

  if (!localNIT) {
    setStatus("No se encontró el local recién registrado. Vuelve al paso Añadir local.");
    form.style.display = "none";
    return;
  }

  if (localCorreo && correoSugerido) {
    correoSugerido.textContent = `Sugerido: ${localCorreo}`;
    emailInput.value = localCorreo;
  }
};

form?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!canManageLocals(context)) {
    setStatus("No tienes permisos para preparar usuarios de un nuevo local.");
    return;
  }

  const emailValue = emailInput.value.trim();
  if (!emailValue || !emailInput.checkValidity()) {
    setStatus("Ingresa un correo válido.");
    return;
  }

  const payload = {
    nombre_visible: nombreVisibleInput.value.trim(),
    email: emailValue,
    password: passwordInput.value,
    nit: localNIT,
    local_nit: localNIT,
    local_correo: localCorreo,
    local_empresa_id: localEmpresaId,
    empresa_matriz_id: context?.empresa_id || null,
    usuario_solicitante_id: context?.user?.id || context?.user?.user_id || null,
    tipo_registro: "usuarios_local_dependiente"
  };

  setStatus("Preparando usuarios del nuevo local...");

  try {
    // functions.invoke y NO fetch: invoke adjunta la cabecera Authorization con
    // el JWT de la sesión. Con un fetch plano el gateway de Supabase responde
    // 401 antes de que la función llegue a ejecutarse.
    const { data, error } = await supabase.functions.invoke("local-usuarios-duplicar", {
      body: payload
    });

    if (error || !data || data.ok === false) {
      setStatus(data?.message || data?.error || error?.message || "No se pudo preparar usuarios del local.");
      return;
    }

    sessionStorage.removeItem("local_dependiente_nit");
    sessionStorage.removeItem("local_dependiente_correo");
    sessionStorage.removeItem("local_dependiente_empresa_id");

    const duplicados = Number(data?.duplicados || 0);
    alert(duplicados
      ? `Local registrado. Se prepararon ${duplicados} usuario(s) para el nuevo local.`
      : "Local registrado. Los usuarios del local ya estaban preparados.");
    window.location.href = APP_URLS.configuracion;
  } catch (_error) {
    setStatus("Error inesperado preparando usuarios del local. Intenta nuevamente.");
  }
});

init();
