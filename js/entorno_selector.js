import { getUserContext } from "./session.js";
import { ENV_LOGGRO, ENV_SIIGO, setActiveEnvironment } from "./environment.js";
import { getPermisosEfectivos } from "./permisos.core.js";
import { resolveFirstAllowedRoute } from "./access_control.local.js";

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
  const userId = context?.user?.id || context?.user?.user_id;
  const empresaId = context?.empresa_id || null;
  const permisos = userId ? await getPermisosEfectivos(userId, empresaId).catch(() => []) : [];
  const route = resolveFirstAllowedRoute(rol, env, permisos);
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
