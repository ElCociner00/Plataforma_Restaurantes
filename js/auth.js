import { supabase } from "./supabase.js";

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = emailInput.value;
  const password = passwordInput.value;

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    alert("Credenciales incorrectas");
    return;
  }

  window.location.href = "/dashboard/";
});
