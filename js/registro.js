/**
 * MAPA DE MANTENIMIENTO (guía rápida para cambios manuales)
 * Archivo: js/registro.js
 *
 * Registro self-service de empresa, en una sola vista (registro/index.html).
 *
 * Partes del archivo:
 * 1) Imports y referencias al DOM.
 * 2) Utilidades de UI (pasos, estado, bloqueo del formulario).
 * 3) Arranque: decide qué paso mostrar segun la sesión.
 * 4) Eventos.
 * 5) Alta contra Supabase mediante RPC atómico.
 *
 * Índice de funciones/bloques:
 * - `setStatus`        : mensaje de estado con tono.
 * - `mostrarPaso`      : alterna entre el paso de cuenta y el de empresa.
 * - `traducirError`    : convierte códigos del RPC en lenguaje del usuario.
 * - `arrancar`         : resuelve sesión y contexto al cargar.
 * - `crearEmpresaYUsuario` : llama al RPC de alta.
 *
 * ---------------------------------------------------------------------------
 * MIGRACIÓN n8n → supabase-js (fase 2)
 *
 * Antes esta vista dependía de tres webhooks de n8n:
 *   - crear_codigo_verificacion  → ELIMINADO. Google ya verifica el correo.
 *   - verificar_codigo           → ELIMINADO. Idem.
 *   - registro                   → absorbido por el RPC de abajo.
 * Y registro/usuario.html usaba un cuarto, registro_usuario, también absorbido
 * por el RPC. Esa página quedó unificada aquí.
 *
 * Por qué el orden es Google primero y datos después: `usuarios_sistema.id`
 * debe ser igual a `auth.uid()`, así que hace falta una sesión ANTES de poder
 * dar de alta nada.
 *
 * Por qué un RPC y no dos inserts: dos inserts desde el navegador son dos
 * peticiones HTTP y no comparten transacción. Si la segunda fallaba, la empresa
 * quedaba creada sin dueño y con el NIT bloqueado para siempre. La función
 * registrar_empresa_self_service corre en una sola transacción: o entran las
 * dos filas, o no entra ninguna. De paso resuelve el problema del RETURNING,
 * que RLS bloqueaba desde el cliente, así que ya no hace falta generar el UUID
 * aquí: lo devuelve la base.
 *
 * Requiere supabase/sql/008_rpc_registrar_empresa_self_service.sql
 * ---------------------------------------------------------------------------
 */
import { supabase } from "./supabase.js";
import { signInWithGoogle } from "./auth.js";
import { enforceNumericInput } from "./input_utils.js";
import { APP_URLS } from "./urls.js";

// ============================================================
// 1 · DOM
// ============================================================
const pasoCuenta = document.getElementById("pasoCuenta");
const pasoEmpresa = document.getElementById("pasoEmpresa");
const googleBtn = document.getElementById("googleSignInBtn");
const cambiarCuentaLink = document.getElementById("cambiarCuenta");
const cuentaCorreoEl = document.getElementById("cuentaCorreo");

const form = document.getElementById("registroEmpresa");
const submitBtn = document.getElementById("crearEmpresa");
const status = document.getElementById("status");

const nombreCompletoInput = document.getElementById("nombre_completo");
const nombreComercialInput = document.getElementById("nombre_comercial");
const razonSocialInput = document.getElementById("razon_social");
const nitInput = document.getElementById("nit");
const correoEmpresaInput = document.getElementById("correo_empresa");
const aceptaPoliticasInput = document.getElementById("acepta_politicas");

enforceNumericInput([nitInput]);

const RPC_REGISTRO = "registrar_empresa_self_service";
const DESTINO = APP_URLS.localPreselector || "../contexto_local/";

let usuarioAuth = null;

// ============================================================
// 2 · UI
// ============================================================
const setStatus = (mensaje, tono = "info") => {
  if (!status) return;
  status.textContent = mensaje || "";
  status.dataset.tone = mensaje ? tono : "";
};

const mostrarPaso = (paso) => {
  pasoCuenta?.classList.toggle("is-hidden", paso !== "cuenta");
  pasoEmpresa?.classList.toggle("is-hidden", paso !== "empresa");
};

const setFormBusy = (busy, etiqueta) => {
  if (submitBtn) {
    submitBtn.disabled = busy;
    submitBtn.setAttribute("aria-busy", busy ? "true" : "false");
    if (etiqueta) submitBtn.textContent = etiqueta;
  }
  form?.querySelectorAll("input").forEach((input) => { input.disabled = busy; });
};

/**
 * Traduce el error del RPC al problema real del usuario.
 *
 * Los códigos EK00x los levanta la propia función SQL con `using errcode`, y
 * PostgREST los propaga tal cual en error.code. Distinguirlos permite dar un
 * mensaje accionable en vez de un volcado de Postgres.
 */
const traducirError = (error) => {
  const code = String(error?.code || "");
  const msg = String(error?.message || "");

  switch (code) {
    case "EK001":
      return "Tu sesión expiró. Vuelve a identificarte con Google.";
    case "EK002":
      return "Tu cuenta ya pertenece a una empresa. Inicia sesión en lugar de registrarte.";
    case "EK003":
      return "Ese NIT ya está registrado. Si es tu empresa, pide acceso al administrador.";
    case "EK004":
      return "Faltan datos obligatorios. Revisa el formulario.";
    case "EK005":
      return "Debes aceptar los términos y condiciones para continuar.";
  }

  // El RPC no existe todavía en la base.
  if (code === "PGRST202" || /Could not find the function/i.test(msg)) {
    return "El registro no está disponible: falta instalar la función en la base de datos.";
  }
  if (code === "42501" || /permission denied/i.test(msg)) {
    return "Tu cuenta no tiene permiso para registrar empresas.";
  }
  if (code === "23505") {
    return "Ya existe un registro con esos datos.";
  }

  return msg || "Error inesperado. Inténtalo de nuevo.";
};

// ============================================================
// 3 · ARRANQUE
// ============================================================
async function arrancar() {
  const { data } = await supabase.auth.getSession();
  const session = data?.session;

  if (!session) {
    mostrarPaso("cuenta");
    return;
  }

  usuarioAuth = session.user;

  // ¿Ya tiene usuario en la plataforma? Entonces no está registrándose:
  // se le manda al flujo normal en vez de dejarle crear otra empresa.
  const { data: existente } = await supabase
    .from("usuarios_sistema")
    .select("id, empresa_id")
    .eq("id", usuarioAuth.id)
    .maybeSingle();

  if (existente) {
    setStatus("Tu cuenta ya está registrada. Entrando...");
    window.location.href = DESTINO;
    return;
  }

  if (cuentaCorreoEl) cuentaCorreoEl.textContent = usuarioAuth.email || "tu cuenta";

  // Prellenado con lo que Google ya sabe. Ambos campos siguen siendo editables:
  // el correo de facturación de la empresa no tiene por qué ser el personal.
  if (correoEmpresaInput && !correoEmpresaInput.value) {
    correoEmpresaInput.value = usuarioAuth.email || "";
  }
  if (nombreCompletoInput && !nombreCompletoInput.value) {
    nombreCompletoInput.value = usuarioAuth.user_metadata?.full_name || "";
  }

  mostrarPaso("empresa");
}

supabase.auth.onAuthStateChange((event, session) => {
  if (event === "SIGNED_IN" && session) arrancar();
});

arrancar().catch((error) => {
  console.error("[registro] No se pudo iniciar el registro:", error);
  setStatus("No se pudo cargar el registro. Recarga la página.", "error");
});

// ============================================================
// 4 · EVENTOS
// ============================================================
googleBtn?.addEventListener("click", async () => {
  setStatus("");
  googleBtn.disabled = true;
  const label = googleBtn.querySelector(".google-btn-label");
  if (label) label.textContent = "Redirigiendo a Google...";

  try {
    await signInWithGoogle();
  } catch (error) {
    console.error("[registro] Error al iniciar sesión con Google:", error);
    googleBtn.disabled = false;
    if (label) label.textContent = "Continuar con Google";
    setStatus(`No se pudo abrir Google: ${error?.message || "sin detalle"}`, "error");
  }
});

cambiarCuentaLink?.addEventListener("click", async (event) => {
  event.preventDefault();
  await supabase.auth.signOut().catch(() => {});
  usuarioAuth = null;
  setStatus("");
  mostrarPaso("cuenta");
});

form?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!usuarioAuth) {
    setStatus("Tu sesión expiró. Vuelve a identificarte con Google.", "error");
    mostrarPaso("cuenta");
    return;
  }

  if (!aceptaPoliticasInput?.checked) {
    setStatus("Debes aceptar las políticas para continuar.", "error");
    return;
  }

  await crearEmpresaYUsuario();
});

// ============================================================
// 5 · ALTA
// ============================================================
async function crearEmpresaYUsuario() {
  setFormBusy(true, "Creando empresa...");
  setStatus("Creando tu empresa...");

  // Una sola llamada, una sola transacción. Si algo falla dentro de la función,
  // Postgres revierte los dos inserts y no queda rastro: el NIT sigue libre y
  // el usuario puede reintentar sin arrastrar basura de un intento anterior.
  const { data: empresaId, error } = await supabase.rpc(RPC_REGISTRO, {
    p_nombre_comercial: nombreComercialInput.value.trim(),
    p_razon_social: razonSocialInput.value.trim(),
    p_nit: nitInput.value.trim(),
    p_correo_empresa: correoEmpresaInput.value.trim(),
    p_nombre_completo: nombreCompletoInput.value.trim(),
    // La casilla ya es `required` en el formulario, pero el RPC es un endpoint
    // público: quien llame con la anon key se salta el HTML. Por eso la
    // aceptación viaja explícita y el servidor la exige.
    p_acepta_terminos: Boolean(aceptaPoliticasInput?.checked)
  });

  if (error) {
    console.error("[registro] Error en el alta de empresa:", error);
    setFormBusy(false, "Crear empresa");
    setStatus(traducirError(error), "error");

    // EK001 y EK002 son problemas de sesión, no del formulario: reintentar
    // con los mismos datos no arregla nada.
    if (error.code === "EK001") mostrarPaso("cuenta");
    if (error.code === "EK002") setTimeout(() => { window.location.href = DESTINO; }, 2500);
    return;
  }

  console.info("[registro] Empresa creada:", empresaId);
  setStatus("Empresa creada. Entrando...");
  window.location.href = DESTINO;
}
