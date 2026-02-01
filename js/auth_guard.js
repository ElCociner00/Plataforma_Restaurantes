import { supabase } from "./supabase.js";

const LOGIN_URL = "/Plataforma_Restaurantes/";

// 🔒 Redirección dura
function redirectToLogin() {
  window.location.replace(LOGIN_URL);
}

// 🚫 Bloqueo de interacción si NO hay sesión
function protectInteractions() {
  ["click", "keydown", "touchstart"].forEach(event => {
    document.addEventListener(event, async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        redirectToLogin();
      }
    });
  });
}

// ⏳ Esperar a que Supabase confirme el estado real
document.addEventListener("DOMContentLoaded", async () => {
  const { data: listener } = supabase.auth.onAuthStateChange(
    (event, session) => {

      if (!session) {
        redirectToLogin();
        return;
      }

      // ✅ Sesión válida
      document.body.style.display = "block";
      protectInteractions();
    }
  );

  // Limpieza automática si se navega
  window.addEventListener("beforeunload", () => {
    listener.subscription.unsubscribe();
  });
});
