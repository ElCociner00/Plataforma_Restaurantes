export async function guardPage(pageKey) {
  const context = await getUserContext();

  if (!context) {
    window.location.href = "/Plataforma_Restaurantes/index.html";
    return;
  }

  // ✅ admin_root entra SIEMPRE
  if (context.rol === "admin_root") return;

  const allowedRoles = PERMISSIONS[pageKey];

  if (!allowedRoles || !allowedRoles.includes(context.rol)) {
    alert("No tienes permisos para acceder a este módulo");
    window.location.href = "/Plataforma_Restaurantes/dashboard/";
  }
}
