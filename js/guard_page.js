// /js/guard_page.js
import { getUserContext } from "./session.js";
import { PERMISSIONS } from "./permissions.js";

export async function guardPage(pageKey) {
  const context = await getUserContext();

  // No logueado → login
  if (!context) {
    window.location.href = "/Plataforma_Restaurantes/login/";
    return;
  }

  const allowedRoles = PERMISSIONS[pageKey];

  // Página no definida o rol no permitido
  if (!allowedRoles || !allowedRoles.includes(context.rol)) {
    alert("No tienes permisos para acceder a este módulo");
    window.location.href = "/Plataforma_Restaurantes/dashboard/";
  }
}
