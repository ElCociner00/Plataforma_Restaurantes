import { supabase } from "./supabase.js";

const form = document.getElementById("resetPasswordForm");
const nuevaContrasena = document.getElementById("nuevaContrasena");
const estado = document.getElementById("estadoReset");

const setEstado = (m) => { if (estado) estado.textContent = m || ""; };

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const nueva = String(nuevaContrasena?.value || "").trim();
  if (!nueva) return setEstado("Ingresa una nueva contraseña.");

  const { error } = await supabase.auth.updateUser({ password: nueva });
  if (error) return setEstado(`No se pudo actualizar: ${error.message || "sin detalle"}`);

  setEstado("Contraseña actualizada. Inicia sesión nuevamente.");
  await supabase.auth.signOut();
  window.location.href = "../index.html";
});
