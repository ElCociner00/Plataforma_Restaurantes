import { supabase } from "./supabase.js";
import { getUserContext } from "./session.js";

const form = document.getElementById("loginForm");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = emailInput.value;
  const password = passwordInput.value;

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    alert("Credenciales incorrectas");
    return;
  }

  const context = await getUserContext();

  if (!context) {
    alert("Usuario sin contexto");
    return;
  }

  if (context.rol === "operativo") {
    window.location.href = "/Plataforma_Restaurantes/cierre_turno/";
  } else {
    window.location.href = "/Plataforma_Restaurantes/dashboard/";
  }
});
