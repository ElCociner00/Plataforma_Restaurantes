import { getCurrentEmpresaId } from "./session.js";
import { supabase } from "./supabase.js";

const normalizeText = (value) => String(value || "").trim();

const toResponsableRecord = (row, source) => {
  const id = normalizeText(row?.id);
  if (!id) return null;

  const nombre = normalizeText(row?.nombre_completo) || "Sin nombre";
  const cedula = normalizeText(row?.cedula);
  const rol = normalizeText(row?.rol) || (source === "otros_usuarios" ? "revisor" : "");
  const activo = typeof row?.activo === "boolean"
    ? row.activo
    : (typeof row?.estado === "boolean" ? row.estado : normalizeText(row?.estado).toLowerCase() !== "inactivo");

  return {
    id,
    nombre_completo: nombre,
    cedula,
    rol,
    activo,
    source
  };
};

export async function fetchUsuariosEmpresa(empresaId) {
  const safeEmpresaId = normalizeText(empresaId);
  if (!safeEmpresaId) return [];

  const [usuariosSistemaRes, otrosUsuariosRes, empleadosRes] = await Promise.all([
    supabase
      .from("usuarios_sistema")
      .select("id, nombre_completo, rol, activo, created_at")
      .eq("empresa_id", safeEmpresaId),
    supabase
      .from("otros_usuarios")
      .select("id, nombre_completo, cedula, estado, created_at")
      .eq("empresa_id", safeEmpresaId),
    supabase
      .from("empleados")
      .select("id, nombre_completo, cedula, estado")
      .eq("empresa_id", safeEmpresaId)
  ]);

  const usuariosSistema = Array.isArray(usuariosSistemaRes.data) ? usuariosSistemaRes.data : [];
  const otrosUsuarios = Array.isArray(otrosUsuariosRes.data) ? otrosUsuariosRes.data : [];

  const empleados = Array.isArray(empleadosRes.data) ? empleadosRes.data : [];
  const empleadosById = new Map(empleados.map((item) => [normalizeText(item.id), item]));
  const empleadosByNombre = new Map(empleados.map((item) => [normalizeText(item.nombre_completo).toLowerCase(), item]));

  const normalized = [
    ...usuariosSistema.map((row) => toResponsableRecord(row, "usuarios_sistema")),
    ...otrosUsuarios.map((row) => toResponsableRecord(row, "otros_usuarios"))
  ].filter(Boolean).map((row) => {
    const empleado = empleadosById.get(row.id) || empleadosByNombre.get(normalizeText(row.nombre_completo).toLowerCase());
    return {
      ...row,
      nombre_completo: normalizeText(empleado?.nombre_completo) || row.nombre_completo,
      cedula: row.cedula || normalizeText(empleado?.cedula),
      estado_empleado: normalizeText(empleado?.estado)
    };
  });

  const dedupById = new Map();
  normalized.forEach((row) => {
    if (!dedupById.has(row.id)) dedupById.set(row.id, row);
  });

  return Array.from(dedupById.values()).sort((a, b) => a.nombre_completo.localeCompare(b.nombre_completo, "es"));
}

export async function fetchResponsablesActivos(empresaId) {
  const resolvedEmpresaId = normalizeText(empresaId) || await getCurrentEmpresaId();
  const usuarios = await fetchUsuariosEmpresa(resolvedEmpresaId);
  return usuarios.filter((row) => row.activo !== false);
}
