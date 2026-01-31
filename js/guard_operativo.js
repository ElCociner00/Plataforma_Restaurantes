import { getUserContext } from "./session.js";

const context = await getUserContext();

if (!context) {
  window.location.href = "/Plataforma_Restaurantes/login/";
}
