/**
 * Compatibilidad aislada para responsables/empleados en contexto de locales.
 *
 * Este módulo solo realiza lecturas y falla en silencio: si no puede validar que
 * el tenant activo es un local legítimo de la empresa principal, devuelve null
 * para que el consumidor mantenga su comportamiento original.
 */
import { getUserContext } from "./session.js";
import { supabase } from "./supabase.js";

const normalizeText = (value) => String(value || "").trim();

const LOCAL_COMPAT_ROLES = new Set(["admin_root", "admin", "operativo"]);

const isActiveValue = (value) => {
  if (typeof value === "boolean") return value;
  const normalized = normalizeText(value).toLowerCase();
  return !normalized || !["inactivo", "false", "0", "no"].includes(normalized);
};

const toResponsableRecord = (row, source) => {
  const id = normalizeText(row?.id);
  if (!id) return null;

  return {
    id,
    nombre_completo: normalizeText(row?.nombre_completo) || "Sin nombre",
    cedula: normalizeText(row?.cedula),
    rol: normalizeText(row?.rol) || (source === "otros_usuarios" ? "revisor" : ""),
    activo: isActiveValue(row?.activo ?? row?.estado),
    source,
    estado_empleado: normalizeText(row?.estado_empleado || row?.estado)
  };
};

async function resolveLocalAccess(activeEmpresaId, principalEmpresaId) {
  const { data, error } = await supabase
    .from("grupos_empresariales")
    .select("empresa_id, grupo_id, activo")
    .eq("empresa_id", activeEmpresaId)
    .eq("grupo_id", principalEmpresaId)
    .eq("activo", true)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

async function fetchPrincipalRows(principalEmpresaId) {
  const [usuariosSistemaRes, otrosUsuariosRes, empleadosRes] = await Promise.all([
    supabase
      .from("usuarios_sistema")
      .select("id, nombre_completo, rol, activo, created_at")
      .eq("empresa_id", principalEmpresaId),
    supabase
      .from("otros_usuarios")
      .select("id, nombre_completo, cedula, estado, created_at")
      .eq("empresa_id", principalEmpresaId),
    supabase
      .from("empleados")
      .select("id, nombre_completo, cedula, estado")
      .eq("empresa_id", principalEmpresaId)
  ]);

  return {
    usuariosSistema: Array.isArray(usuariosSistemaRes.data) ? usuariosSistemaRes.data : [],
    otrosUsuarios: Array.isArray(otrosUsuariosRes.data) ? otrosUsuariosRes.data : [],
    empleados: Array.isArray(empleadosRes.data) ? empleadosRes.data : []
  };
}

async function fetchLocalUserMap(localEmpresaId, principalRows) {
  const principalIds = [
    ...principalRows.usuariosSistema.map((row) => normalizeText(row?.id)),
    ...principalRows.otrosUsuarios.map((row) => normalizeText(row?.id)),
    ...principalRows.empleados.map((row) => normalizeText(row?.id))
  ].filter(Boolean);

  if (!principalIds.length) return { byPrincipalId: new Map(), byName: new Map() };

  const { data, error } = await supabase
    .from("usuarios_locales")
    .select("id, usuario_principal_id, empresa_id, nombre_completo, rol, activo")
    .eq("empresa_id", localEmpresaId)
    .in("usuario_principal_id", [...new Set(principalIds)])
    .eq("activo", true);

  if (error || !Array.isArray(data)) return { byPrincipalId: new Map(), byName: new Map() };

  return {
    byPrincipalId: new Map(data.map((row) => [normalizeText(row?.usuario_principal_id), row])),
    byName: new Map(data.map((row) => [normalizeText(row?.nombre_completo).toLowerCase(), row]).filter(([name]) => name))
  };
}

function mergeAndTransformRows(principalRows, localUserMap) {
  const empleadosById = new Map(principalRows.empleados.map((item) => [normalizeText(item.id), item]));
  const empleadosByNombre = new Map(principalRows.empleados.map((item) => [normalizeText(item.nombre_completo).toLowerCase(), item]));

  const baseRows = [
    ...principalRows.usuariosSistema.map((row) => toResponsableRecord(row, "usuarios_sistema")),
    ...principalRows.otrosUsuarios.map((row) => toResponsableRecord(row, "otros_usuarios")),
    ...principalRows.empleados.map((row) => toResponsableRecord(row, "empleados"))
  ].filter(Boolean);

  const transformed = baseRows.map((row) => {
    const empleado = empleadosById.get(row.id) || empleadosByNombre.get(normalizeText(row.nombre_completo).toLowerCase());
    const localUser = localUserMap.byPrincipalId.get(row.id) || localUserMap.byName.get(normalizeText(row.nombre_completo).toLowerCase());

    return {
      ...row,
      id: normalizeText(localUser?.id) || row.id,
      nombre_completo: normalizeText(empleado?.nombre_completo) || normalizeText(localUser?.nombre_completo) || row.nombre_completo,
      cedula: row.cedula || normalizeText(empleado?.cedula),
      rol: normalizeText(localUser?.rol) || row.rol,
      activo: localUser ? localUser.activo !== false : row.activo,
      estado_empleado: normalizeText(empleado?.estado) || row.estado_empleado,
      source: row.source
    };
  });

  const dedupById = new Map();
  transformed.forEach((row) => {
    if (!dedupById.has(row.id)) dedupById.set(row.id, row);
  });

  return Array.from(dedupById.values()).sort((a, b) => a.nombre_completo.localeCompare(b.nombre_completo, "es"));
}

export async function fetchUsuariosEmpresaLocalCompat(requestedEmpresaId) {
  try {
    const context = await getUserContext();
    const activeEmpresaId = normalizeText(requestedEmpresaId) || normalizeText(context?.empresa_id);
    const principalEmpresaId = normalizeText(context?.empresa_principal_id);
    const role = normalizeText(context?.rol).toLowerCase();

    if (!context?.local_context || !activeEmpresaId || !principalEmpresaId || activeEmpresaId === principalEmpresaId) return null;
    if (!LOCAL_COMPAT_ROLES.has(role)) return null;

    const access = await resolveLocalAccess(activeEmpresaId, principalEmpresaId);
    if (!access) return null;

    const principalRows = await fetchPrincipalRows(principalEmpresaId);
    const localUserMap = await fetchLocalUserMap(activeEmpresaId, principalRows);
    return mergeAndTransformRows(principalRows, localUserMap);
  } catch (error) {
    console.warn("[local_compat_responsables] Compatibilidad desactivada por error no crítico:", error?.message || error);
    return null;
  }
}
