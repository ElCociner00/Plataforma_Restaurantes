import { getUserContext } from "./session.js";
import { ENV_LOGGRO, ENV_SIIGO, setActiveEnvironment } from "./environment.js";
import { getPermisosEfectivos, tienePermiso } from "./permisos.core.js";

const btnLoggro = document.getElementById("btnEntornoLoggro");
const btnSiigo = document.getElementById("btnEntornoSiigo");
const status = document.getElementById("status");

const LOGGRO_ROUTE_BY_MODULE = [
  ["dashboard", "/Plataforma_Restaurantes/dashboard/"],
  ["cierre_turno", "/Plataforma_Restaurantes/cierre_turno/"],
  ["historico_cierre_turno", "/Plataforma_Restaurantes/cierre_turno/historico_cierre_turno.html"],
  ["cierre_inventarios", "/Plataforma_Restaurantes/cierre_inventarios/"],
  ["historico_cierre_inventarios", "/Plataforma_Restaurantes/cierre_inventarios/historico_cierre_inventarios.html"]
];

const SIIGO_ROUTE_BY_MODULE = [
  ["dashboard_siigo", "/Plataforma_Restaurantes/siigo/dashboard_siigo/"],
  ["subir_facturas_siigo", "/Plataforma_Restaurantes/siigo/subir_facturas_siigo/"],
  ["nomina", "/Plataforma_Restaurantes/nomina/"]
];

const resolveRouteByPermisos = async (env, context) => {
  const userId = context?.user?.id || context?.user?.user_id;
  const empresaId = context?.empresa_id;
  if (!userId || !empresaId) {
    return "";
  }

  const permisos = await getPermisosEfectivos(userId, empresaId).catch(() => []);
  const routes = env === ENV_SIIGO ? SIIGO_ROUTE_BY_MODULE : LOGGRO_ROUTE_BY_MODULE;
  const route = routes.find(([modulo]) => tienePermiso(modulo, permisos))?.[1];

  if (route) return route;
  return "";
};

const goByRole = async (env) => {
  const context = await getUserContext();
  if (!context) {
    status.textContent = "No se pudo validar la sesión.";
    return;
  }

  setActiveEnvironment(env);
  const route = await resolveRouteByPermisos(env, context);
  if (!route) {
    status.textContent = "No tienes modulos habilitados en ese entorno.";
    return;
  }
  window.location.href = route;
};

const initRoleUi = async () => {
  const context = await getUserContext().catch(() => null);
  if (!context) return;

  const routeSiigo = await resolveRouteByPermisos(ENV_SIIGO, context).catch(() => "");
  const hasSiigoAccess = !!routeSiigo;
  btnSiigo.disabled = !hasSiigoAccess;
  btnSiigo.title = hasSiigoAccess ? "" : "No tienes módulos habilitados en Siigo";
};

btnLoggro?.addEventListener("click", () => goByRole(ENV_LOGGRO));
btnSiigo?.addEventListener("click", () => goByRole(ENV_SIIGO));

initRoleUi();




