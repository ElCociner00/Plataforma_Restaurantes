import { supabase } from "./supabase.js";

export const sendRecoveryForEmail = async (email) => {
  const cleanEmail = String(email || "").trim();
  if (!cleanEmail) throw new Error("Correo no válido.");

  const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail);
  if (error) throw error;
  return true;
};

window.sendRecoveryForEmail = sendRecoveryForEmail;

