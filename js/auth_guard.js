import { supabase } from "./supabase.js";

// ⛔ Bloqueo inmediato de interacción si no hay sesión
function forceRedirect() {
  window.location.replace("/Plataforma_Restaurantes/");
}

// Escuchamos cualquier intento de interacción
["click", "keydown", "touchstart"].forEach(event => {
  document.addEventListener(event, async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      forceRedirect();
    }
  });
});

document.addEventListener("DOMContentLoaded", async () => {
  const { data } = await supabase.auth.getSession();

  if (!data.session) {
    forceRedirect();
    return;
  }

  // ✅ Sesión válida → mostramos la página
  document.body.style.display = "block";
});
