import { supabase } from "./supabase.js";
import { getUserContext } from "./session.js";

const normalizeModule = (modulo) => String(modulo || "").trim();

const getEmpresaIdFromBackend = async () => {
  const { data, error } = await supabase.rpc("current_empresa_id");
  if (!error && data) return data;

  const context = await getUserContext();
  return context?.empresa_id || null;
};

export const fetchPermissionModules = async () => {
  const { data, error } = await supabase
    .from("roles_permisos_modulo")
    .select("modulo");

  if (error) throw error;

  const modules = (data || [])
    .map((row) => normalizeModule(row.modulo))
    .filter(Boolean);

  return Array.from(new Set(modules));
};

export const fetchEffectivePermissionsMap = async () => {
  const { data, error } = await supabase
    .from("v_permisos_efectivos")
    .select("usuario_id, modulo, permitido");

  if (error) throw error;

  return (data || []).reduce((acc, row) => {
    const userId = String(row.usuario_id);
    if (!acc[userId]) acc[userId] = {};
    acc[userId][normalizeModule(row.modulo)] = row.permitido === true;
    return acc;
  }, {});
};

export const fetchEffectivePermissionsForUser = async (userId) => {
  if (!userId) return {};

  const { data, error } = await supabase
    .from("v_permisos_efectivos")
    .select("modulo, permitido")
    .eq("usuario_id", userId);

  if (error) throw error;

  return (data || []).reduce((acc, row) => {
    acc[normalizeModule(row.modulo)] = row.permitido === true;
    return acc;
  }, {});
};

export const getEffectivePermissionForModule = async (moduleKey, userId) => {
  if (!moduleKey || !userId) return false;

  const { data, error } = await supabase
    .from("v_permisos_efectivos")
    .select("permitido")
    .eq("usuario_id", userId)
    .eq("modulo", moduleKey)
    .maybeSingle();

  if (error) throw error;

  return data?.permitido === true;
};

export const upsertUserPermissionOverride = async ({
  usuarioId,
  modulo,
  permitido,
  updatedBy
}) => {
  const empresaId = await getEmpresaIdFromBackend();
  if (!empresaId) throw new Error("No se pudo resolver la empresa activa.");

  const payload = {
    empresa_id: empresaId,
    usuario_id: usuarioId,
    modulo: normalizeModule(modulo),
    permitido: permitido === true,
    origen: "manual",
    updated_by: updatedBy || null
  };

  const { error } = await supabase
    .from("usuarios_permisos_modulo")
    .upsert(payload, { onConflict: "empresa_id,usuario_id,modulo" });

  if (error) throw error;
};
