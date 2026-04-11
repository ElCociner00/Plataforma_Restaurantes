import { getUserContext } from "./session.js";
import { ENV_LOGGRO, ENV_SIIGO, setActiveEnvironment } from "./environment.js";
import { resolveDefaultRouteForRoleEnv } from "./access_control.local.js";

const btnLoggro = document.getElementById("btnEntornoLoggro");
const btnSiigo = document.getElementById("btnEntornoSiigo");
const status = document.getElementById("status");
const GUARD_REASON_KEY = "app_guard_reason";

const goByRole = async (env) => {
  const context = await getUserContext();
  if (!context) {
    status.textContent = "No se pudo validar la sesión.";
    return;
  }

  setActiveEnvironment(env);
  const rol = String(context?.rol || "").trim().toLowerCase();
  const route = resolveDefaultRouteForRoleEnv(rol, env);
  window.location.href = route;
};

const initRoleUi = async () => {
  const context = await getUserContext().catch(() => null);
  if (!context) return;

  btnSiigo.disabled = false;
  btnSiigo.title = "";

  try {
    const reason = String(sessionStorage.getItem(GUARD_REASON_KEY) || "").trim();
    if (reason && status) {
      status.textContent = reason;
      sessionStorage.removeItem(GUARD_REASON_KEY);
    }
  } catch (_error) {
    // noop
  }
};

btnLoggro?.addEventListener("click", () => goByRole(ENV_LOGGRO));
btnSiigo?.addEventListener("click", () => goByRole(ENV_SIIGO));

initRoleUi();

