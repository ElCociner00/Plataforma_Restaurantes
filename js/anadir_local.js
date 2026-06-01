import { enforceNumericInput } from "./input_utils.js";
import { getUserContext } from "./session.js";
import { supabase } from "./supabase.js";
import {
  WEBHOOK_CREAR_CODIGO_VERIFICACION,
  WEBHOOK_VERIFICAR_CODIGO,
  WEBHOOK_REGISTRO_LOCAL_DEPENDIENTE
} from "./webhooks.js";
import { APP_URLS } from "./urls.js";

const form = document.getElementById("registroLocal");
const status = document.getElementById("status");
const verificacion = document.getElementById("verificacion");
const continuarBtn = document.getElementById("continuar");
const nombreComercialInput = document.getElementById("nombre_comercial");
const razonSocialInput = document.getElementById("razon_social");
const nitInput = document.getElementById("nit");
const correoEmpresaInput = document.getElementById("correo_empresa");
const codigoInput = document.getElementById("codigo");
const aceptaPoliticasInput = document.getElementById("acepta_politicas");

const setStatus = (message) => {
  if (status) status.innerText = message || "";
};

const parseJsonResponse = async (response) => {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch (_error) { return { ok: response.ok, raw: text }; }
};

const canManageLocals = (userContext) => ["admin", "admin_root"].includes(String(userContext?.rol || "").toLowerCase());

enforceNumericInput([nitInput, codigoInput]);

let context = null;
let datosLocal = null;
let codigoValidado = false;
let empresaMatriz = null;

const init = async () => {
  context = await getUserContext().catch(() => null);
  if (!context?.empresa_id) {
    setStatus("No se pudo resolver la empresa activa. Vuelve a iniciar sesión antes de añadir un local.");
    form?.querySelectorAll("input, button")?.forEach((element) => { element.disabled = true; });
    return;
  }

  if (!canManageLocals(context)) {
    setStatus("No tienes permisos para añadir locales. Solicita acceso a un administrador.");
    form?.querySelectorAll("input, button")?.forEach((element) => { element.disabled = true; });
    return;
  }

  const { data, error } = await supabase
    .from("empresas")
    .select("id,nit,nombre_comercial,razon_social,correo_empresa")
    .eq("id", context.empresa_id)
    .maybeSingle();

  if (error || !data?.nit) {
    setStatus("No se pudo cargar el NIT de la empresa principal. Es necesario para registrar locales con el mismo NIT.");
    form?.querySelectorAll("input, button")?.forEach((element) => { element.disabled = true; });
    return;
  }

  empresaMatriz = data;
  nitInput.value = String(data.nit || "").trim();
  nitInput.readOnly = true;
  nitInput.title = "Los locales usan el mismo NIT de la empresa principal.";
  setStatus("El local se registrará con el mismo NIT de la empresa principal.");
};

form?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!context?.empresa_id) {
    setStatus("No se pudo resolver la empresa activa.");
    return;
  }

  if (!canManageLocals(context)) {
    setStatus("No tienes permisos para añadir locales.");
    return;
  }

  if (!aceptaPoliticasInput?.checked) {
    setStatus("Debes confirmar autorización y aceptar las políticas para continuar.");
    return;
  }

  datosLocal = {
    nombre_comercial: nombreComercialInput.value.trim(),
    razon_social: razonSocialInput.value.trim(),
    nit: String(empresaMatriz?.nit || nitInput.value || "").trim(),
    correo_empresa: correoEmpresaInput.value.trim(),
    empresa_matriz_id: context.empresa_id,
    usuario_solicitante_id: context.user?.id || context.user?.user_id || null,
    tipo_registro: "local_dependiente",
    acepta_politicas: true,
    acepta_politicas_fecha: new Date().toISOString()
  };

  setStatus("Enviando código de verificación del local...");

  try {
    const res = await fetch(WEBHOOK_CREAR_CODIGO_VERIFICACION, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(datosLocal)
    });
    const data = await parseJsonResponse(res);

    if (!res.ok || data.ok === false) {
      setStatus(data.error || `No se pudo enviar el código del local (HTTP ${res.status}).`);
      return;
    }

    setStatus("Código enviado. Revisa el correo administrativo del local.");
    verificacion.style.display = "block";
    form.querySelectorAll("input").forEach((input) => { input.disabled = true; });
  } catch (_error) {
    setStatus("Error de conexión enviando el código. Intenta de nuevo.");
  }
});

document.getElementById("verificarCodigo")?.addEventListener("click", async () => {
  if (!datosLocal?.correo_empresa) {
    setStatus("Primero envía el código de verificación.");
    return;
  }

  setStatus("Verificando código del local...");

  try {
    const res = await fetch(WEBHOOK_VERIFICAR_CODIGO, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo_empresa: datosLocal.correo_empresa,
        codigo: codigoInput.value.trim(),
        empresa_matriz_id: context?.empresa_id || null,
        tipo_registro: "local_dependiente"
      })
    });
    const data = await parseJsonResponse(res);

    if (!res.ok || data.ok === false) {
      setStatus(data.error || "Código inválido o expirado.");
      return;
    }

    codigoValidado = true;
    setStatus("Correo del local verificado correctamente ✅");
    continuarBtn.style.display = "block";
    verificacion.style.display = "none";
  } catch (_error) {
    setStatus("Error verificando el código del local.");
  }
});

continuarBtn?.addEventListener("click", async () => {
  if (!codigoValidado || !datosLocal) {
    setStatus("Debes verificar el correo del local primero.");
    return;
  }

  setStatus("Registrando local dependiente...");

  try {
    const res = await fetch(WEBHOOK_REGISTRO_LOCAL_DEPENDIENTE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(datosLocal)
    });
    const data = await parseJsonResponse(res);

    if (!res.ok || data.ok === false) {
      setStatus(data.error || `No se pudo registrar el local (HTTP ${res.status}).`);
      return;
    }

    sessionStorage.setItem("local_dependiente_nit", datosLocal.nit);
    sessionStorage.setItem("local_dependiente_correo", datosLocal.correo_empresa);
    if (data.local_empresa_id || data.empresa_id) {
      sessionStorage.setItem("local_dependiente_empresa_id", data.local_empresa_id || data.empresa_id);
    }
    window.location.href = APP_URLS.anadirLocalUsuario;
  } catch (_error) {
    setStatus("Error inesperado registrando el local. Intenta nuevamente.");
  }
});

init();
