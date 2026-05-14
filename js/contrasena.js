import { supabase } from "./supabase.js";

export const sendRecoveryForEmail = async (email) => {
  const cleanEmail = String(email || "").trim();
  if (!cleanEmail) throw new Error("Correo no válido.");
  const redirectTo = `${window.location.origin}/configuracion/gestion_usuarios.html`;
  const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, { redirectTo });
  if (error) throw error;
  return true;
};

window.sendRecoveryForEmail = sendRecoveryForEmail;
