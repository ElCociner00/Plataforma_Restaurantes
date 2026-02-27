import { supabase } from "./supabase.js";
import { getCurrentEmpresaId, getUserContext } from "./session.js";
import { getPermisosEfectivos, tienePermiso } from "./permisos.core.js";

const normalizeModule = (modulo) => String(modulo || "").trim();

const getEmpresaIdFromBackend = async () => getCurrentEmpresaId();

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
  const empresaId = await getEmpresaIdFromBackend();
  if (!empresaId) return {};

  const { data, error } = await supabase
    .from("v_permisos_efectivos")
    .select("usuario_id, modulo, permitido")
    .eq("empresa_id", empresaId);

  if (error) throw error;

  return (data || []).reduce((acc, row) => {
    const userId = String(row.usuario_id);
    if (!acc[userId]) acc[userId] = {};
    acc[userId][normalizeModule(row.modulo)] = row.permitido === true;
    return acc;
  }, {});
};

export const fetchEffectivePermissionsForUser = async (userId) => {
  const empresaId = await getEmpresaIdFromBackend();
  const rows = await getPermisosEfectivos(userId, empresaId);
  return (rows || []).reduce((acc, row) => {
    acc[normalizeModule(row.modulo)] = row.permitido === true;
    return acc;
  }, {});
};

export const getEffectivePermissionForModule = async (moduleKey, userId) => {
  const empresaId = await getEmpresaIdFromBackend();
  const rows = await getPermisosEfectivos(userId, empresaId);
  return tienePermiso(moduleKey, rows);
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
