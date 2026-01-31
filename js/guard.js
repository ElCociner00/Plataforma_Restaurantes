import { getUserContext } from "./session.js";

const context = await getUserContext();

if (!context || context.rol === "operativo") {
  window.location.href = "/Plataforma_Restaurantes/login/";
}
