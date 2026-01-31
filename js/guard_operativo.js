import { getUserContext } from "./session.js";

const context = await getUserContext();

if (!context) {
  window.location.href = "/Plataforma_Restaurantes/login/";
}

if (context.rol !== "operativo" && context.rol !== "admin") {
  alert("No tienes permisos para este módulo");
  window.location.href = "/Plataforma_Restaurantes/dashboard/";
}
