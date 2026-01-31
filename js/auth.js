import { supabase } from "./supabase.js";

const form = document.getElementById("loginForm");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = document.getElementById("emailInput").value;
  const password = document.getElementById("passwordInput").value;

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  console.log("LOGIN DATA:", data);
  console.log("LOGIN ERROR:", error);

  if (error) {
    alert("Credenciales incorrectas");
    return;
  }

  // Redirección inicial (luego el rol decide)
  window.location.href = "/Plataforma_Restaurantes/dashboard/";
});
