import { getUserContext } from "./session.js";

document.addEventListener("DOMContentLoaded", async () => {
  const context = await getUserContext();

  // 🚫 Si NO hay usuario → fuera
  if (!context) {
    window.location.replace("/Plataforma_Restaurantes/");
    return;
  }

  // (Opcional) Exponer contexto globalmente
  window.USER_CONTEXT = context;
});
