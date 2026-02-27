import { getUserContext } from "./session.js";
import { PAGE_ENVIRONMENT } from "./permissions.js";
import { getEffectivePermissionForModule } from "./permisosService.js";

const LOGIN_URL = "/Plataforma_Restaurantes/index.html";
const SELECTOR_URL = "/Plataforma_Restaurantes/entorno/";

const getForbiddenRedirect = (context) => {
  const env = localStorage.getItem("app_entorno_activo") || "loggro";
  if (env === "siigo") {
    return "/Plataforma_Restaurantes/siigo/subir_facturas_siigo/";
  }

  if (context?.rol === "operativo") {
    return "/Plataforma_Restaurantes/cierre_turno/";
  }

  return "/Plataforma_Restaurantes/dashboard/";
};

export async function guardPage(pageKey) {
  const context = await getUserContext();

  if (!context) {
    window.location.href = LOGIN_URL;
    return;
  }

  const expectedEnvironment = PAGE_ENVIRONMENT[pageKey];
  const activeEnvironment = localStorage.getItem("app_entorno_activo");

  if (expectedEnvironment && !activeEnvironment) {
    window.location.href = SELECTOR_URL;
    return;
  }

  if (expectedEnvironment && activeEnvironment && expectedEnvironment !== activeEnvironment) {
    alert("Este mÃ³dulo pertenece a otro entorno.");
    window.location.href = SELECTOR_URL;
    return;
  }

  const userId = context.user?.id || context.user?.user_id;
  let allowed = false;

  try {
    allowed = await getEffectivePermissionForModule(pageKey, userId);
  } catch (error) {
    allowed = false;
  }

  if (!allowed) {
    alert("No tienes permisos para acceder a este mÃ³dulo");
    window.location.href = getForbiddenRedirect(context);
  }
}
