import { getUserContext } from "./session.js";

const context = await getUserContext();

if (!context) {
  alert("Usuario no autorizado");
  return;
}

if (context.rol === "operativo") {
  window.location.href = "/Plataforma_Restaurantes/cierre_turno/";
} else {
  window.location.href = "/Plataforma_Restaurantes/dashboard/";
}
