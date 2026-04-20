import { getUserContext } from "./session.js";
import { getPermisosEfectivos } from "./permisos.core.js";
import { resolveFirstAllowedRoute } from "./access_control.local.js";
import { ENV_LOGGRO } from "./environment.js";
import { APP_URLS } from "./urls.js";

export async function resolvePostLoginRoute() {
  const context = await getUserContext().catch(() => null);
  if (!context) return APP_URLS.dashboard;

  const userId = context?.user?.id || context?.user?.user_id;
  const empresaId = context?.empresa_id || null;
  const permisos = userId ? await getPermisosEfectivos(userId, empresaId).catch(() => []) : [];
  return resolveFirstAllowedRoute(context?.rol, ENV_LOGGRO, permisos);
}
