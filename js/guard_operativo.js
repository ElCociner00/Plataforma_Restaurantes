import { getUserContext } from "./session.js";

const context = await getUserContext();
console.log("GUARD OPERATIVO:", context);

if (!context) {
  window.location.href = "/Plataforma_Restaurantes/login/";
}

if (context.rol !== "operativo" && context.rol !== "admin") {
  alert("No tienes permisos");
  window.location.href = "/Plataforma_Restaurantes/dashboard/";
}
