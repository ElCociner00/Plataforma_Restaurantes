import { getUserContext } from "./session.js";

const context = await getUserContext();
console.log("GUARD DASHBOARD:", context);

if (!context) {
  window.location.href = "/Plataforma_Restaurantes/login/";
}
