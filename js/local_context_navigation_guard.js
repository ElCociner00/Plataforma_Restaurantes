import { listAvailableLocalContexts } from "./session.js";
import { APP_URLS } from "./urls.js";

const PENDING_REDIRECT_KEY = "plataforma_local_context_pending_redirect_v1";
const CONFIRMED_PATH_KEY = "plataforma_local_context_confirmed_path_v1";
const GUARD_DELAY_MS = 350;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function currentRelativeUrl() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function isPreselectorPath() {
  const currentPath = String(window.location.pathname || "");
  const selectorPath = new URL(APP_URLS.localPreselector, window.location.origin).pathname;
  return currentPath === selectorPath || currentPath.startsWith(`${selectorPath.replace(/\/$/, "")}/`);
}

async function shouldForceContextSelection() {
  const contexts = await listAvailableLocalContexts().catch(() => []);
  return Array.isArray(contexts) && contexts.filter((item) => item?.empresa_id).length > 1;
}

async function runGuard() {
  if (isPreselectorPath()) return;

  const currentUrl = currentRelativeUrl();
  const confirmedPath = sessionStorage.getItem(CONFIRMED_PATH_KEY) || "";
  if (confirmedPath === currentUrl) {
    sessionStorage.removeItem(CONFIRMED_PATH_KEY);
    return;
  }

  await sleep(GUARD_DELAY_MS);
  if (!(await shouldForceContextSelection())) return;

  sessionStorage.setItem(PENDING_REDIRECT_KEY, currentUrl);
  window.location.href = APP_URLS.localPreselector;
}

runGuard();
