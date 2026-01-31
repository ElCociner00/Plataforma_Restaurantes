import { supabase } from "./supabase.js";

export async function getUserContext() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("usuarios_sistema")
    .select("rol, empresa_id, activo")
    .eq("id", user.id)
    .single();

  if (error || !data || !data.activo) return null;

  return {
    user,
    rol: data.rol,
    empresa_id: data.empresa_id
  };
}
