import { getUserContext } from "./session.js";
import { esSuperAdmin, getPermisosEfectivos, permisosCacheSet } from "./permisos.core.js";
import { initAuthRouter } from "./router.js";

let permisosHydrated = false;

const hydratePermisosCache = async () => {
  if (permisosHydrated) return;

  const context = await getUserContext();
  const isSuper = await esSuperAdmin().catch(() => false);
  const userId = context?.user?.id || context?.user?.user_id;
  const empresaId = context?.empresa_id;

  if (isSuper && !empresaId) {
    permisosCacheSet([]);
    permisosHydrated = true;
    return;
  }

  if (!userId || !empresaId) return;

  const permisos = await getPermisosEfectivos(userId, empresaId);
  permisosCacheSet(permisos);
  permisosHydrated = true;
};

document.addEventListener("DOMContentLoaded", async () => {
  const hasSession = await initAuthRouter();
  if (!hasSession) return;

  await hydratePermisosCache().catch(() => {});
  document.body.style.display = "block";
});
