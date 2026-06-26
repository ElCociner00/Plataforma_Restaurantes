import { listAvailableLocalContexts, switchLocalContext } from "./session.js";
import { resolvePostLoginRoute } from "./post_login_route.js";

const statusEl = document.getElementById("localPreselectorStatus");
const listEl = document.getElementById("localPreselectorList");
const continueBtn = document.getElementById("localPreselectorContinue");
const retryBtn = document.getElementById("localPreselectorRetry");

const MAX_ATTEMPTS = 6;
const RETRY_DELAY_MS = 1200;
const PENDING_REDIRECT_KEY = "plataforma_local_context_pending_redirect_v1";
const CONFIRMED_PATH_KEY = "plataforma_local_context_confirmed_path_v1";

const setStatus = (message) => {
  if (statusEl) statusEl.textContent = message || "";
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function consumePendingRedirect() {
  const pending = sessionStorage.getItem(PENDING_REDIRECT_KEY) || "";
  sessionStorage.removeItem(PENDING_REDIRECT_KEY);
  if (!pending) return "";
  try {
    const url = new URL(pending, window.location.origin);
    if (url.origin !== window.location.origin) return "";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch (_error) {
    return "";
  }
}

async function redirectToApp() {
  const pendingTarget = consumePendingRedirect();
  if (pendingTarget) {
    sessionStorage.setItem(CONFIRMED_PATH_KEY, pendingTarget);
    window.location.href = pendingTarget;
    return;
  }

  const target = await resolvePostLoginRoute().catch(() => "../dashboard/");
  window.location.href = target || "../dashboard/";
}

async function chooseContext(empresaId) {
  setStatus("Aplicando contexto seleccionado...");
  try {
    await switchLocalContext(empresaId);
    await redirectToApp();
  } catch (error) {
    console.error("[local_preselector] No se pudo cambiar contexto:", error);
    setStatus(error?.message || "No se pudo aplicar el local seleccionado.");
  }
}

function renderOptions(contexts) {
  if (!listEl) return;
  listEl.innerHTML = "";
  contexts.forEach((context) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `local-option ${context.tipo === "local" ? "local" : "principal"}`;
    button.innerHTML = `<strong>${context.nombre || "Empresa"}</strong><span>${context.tipo === "local" ? "Local asociado" : "Empresa principal"}</span>`;
    button.addEventListener("click", () => chooseContext(context.empresa_id));
    listEl.appendChild(button);
  });
}

async function loadContexts() {
  setStatus("Buscando locales disponibles...");
  if (listEl) listEl.innerHTML = "";

  let contexts = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    contexts = await listAvailableLocalContexts().catch((error) => {
      console.warn("[local_preselector] Intento fallido:", error);
      return [];
    });

    if (contexts.length > 1 || attempt === MAX_ATTEMPTS) break;
    setStatus(`Esperando carga de locales (${attempt}/${MAX_ATTEMPTS})...`);
    await sleep(RETRY_DELAY_MS);
  }

  if (!contexts.length) {
    setStatus("No se encontraron contextos disponibles. Continuando a la página principal...");
    await sleep(700);
    await redirectToApp();
    return;
  }

  renderOptions(contexts);
  const localCount = contexts.filter((item) => item.tipo === "local").length;
  setStatus(localCount ? `Selecciona entre la empresa principal y ${localCount} local(es).` : "No hay locales activos para este usuario; puedes continuar con la empresa principal.");

  if (!localCount) {
    await sleep(900);
    await redirectToApp();
  }
}

continueBtn?.addEventListener("click", async () => {
  const contexts = await listAvailableLocalContexts().catch(() => []);
  const principal = contexts.find((item) => item.tipo === "principal");
  if (principal?.empresa_id) await chooseContext(principal.empresa_id);
  else await redirectToApp();
});
retryBtn?.addEventListener("click", loadContexts);

loadContexts();
