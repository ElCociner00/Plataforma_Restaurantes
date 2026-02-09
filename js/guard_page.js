import { getUserContext } from "./session.js";
import { PERMISSIONS } from "./permissions.js";

const LOGIN_URL = "/Plataforma_Restaurantes/index.html";

export async function guardPage(pageKey) {
  const context = await getUserContext();

  if (!context) {
    window.location.href = LOGIN_URL;
    return;
  }

  // ✅ admin_root entra SIEMPRE
  if (context.rol === "admin_root") return;

  const storageKey = `permisos_por_usuario_${context.empresa_id || "global"}`;
  const stored = localStorage.getItem(storageKey);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      const userId = context.user?.id || context.user?.user_id;
      const userPermissions = parsed?.[userId];
      if (userPermissions && Object.prototype.hasOwnProperty.call(userPermissions, pageKey)) {
        if (!userPermissions[pageKey]) {
          alert("No tienes permisos para acceder a este módulo");
          window.location.href = "/Plataforma_Restaurantes/dashboard/";
          return;
        }
        return;
      }
    } catch (error) {
      // fallback to role-based guard
    }
  }

  const allowedRoles = PERMISSIONS[pageKey];

  if (!allowedRoles || !allowedRoles.includes(context.rol)) {
    alert("No tienes permisos para acceder a este módulo");
    window.location.href = "/Plataforma_Restaurantes/dashboard/";
  }
}
