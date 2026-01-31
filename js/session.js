import { supabase } from "./supabase.js";

export async function getUserContext() {
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  console.log("AUTH USER:", user, authError);

  if (!user) return null;

  const { data, error } = await supabase
    .from("usuarios_sistema")
    .select("rol, empresa_id, activo")
    .eq("id", user.id)
    .single();

  console.log("DB USER:", data, error);

  if (error || !data || data.activo === false) return null;

  return {
    user,
    rol: data.rol,
    empresa_id: data.empresa_id
  };
}
