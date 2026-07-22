/**
 * Selector aislado de locales.
 */
import { supabase } from "./supabase.js";
import { getUserContext } from "./session.js";

const ACTIVE_LOCAL_CONTEXT_KEY = "plataforma_active_local_context_v1";

const normalizeId = (value) => String(value || "").trim();

const uniqueIds = (values = []) => [...new Set(values.map(normalizeId).filter(Boolean))];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuidLike = (value) => UUID_PATTERN.test(normalizeId(value));

const isAdminRootContext = (context) => context?.rol === "admin_root" || context?.super_admin === true;

function readStoredLocalSelection() {
  if (typeof localStorage === "undefined") return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(ACTIVE_LOCAL_CONTEXT_KEY) || "null");
    const empresaId = normalizeId(parsed?.empresa_id);
    const grupoId = normalizeId(parsed?.grupo_id);
    if (!empresaId || !grupoId) return null;
    return { empresa_id: empresaId, grupo_id: grupoId };
  } catch (_error) {
    return null;
  }
}

function writeStoredLocalSelection(selection) {
  if (typeof localStorage === "undefined") return;
  if (!selection?.empresa_id || !selection?.grupo_id) {
    localStorage.removeItem(ACTIVE_LOCAL_CONTEXT_KEY);
    return;
  }
  localStorage.setItem(ACTIVE_LOCAL_CONTEXT_KEY, JSON.stringify({
    empresa_id: selection.empresa_id,
    grupo_id: selection.grupo_id,
    updated_at: new Date().toISOString()
  }));
}

function resolvePrincipalEmpresaId(context) {
  const storedSelection = readStoredLocalSelection();
  return normalizeId(context?.empresa_principal_id)
    || normalizeId(storedSelection?.grupo_id)
    || normalizeId(context?.empresa_id);
}

function resolvePrincipalUserId(context) {
  return normalizeId(context?.auth_user_id)
    || normalizeId(context?.user?.auth_user_id)
    || normalizeId(context?.usuario_principal_id)
    || normalizeId(context?.user?.id);
}

async function validateLocalBelongsToUserGroup(localEmpresaId, userPrincipalEmpresaId = null) {
  try {
    let principalEmpresaId = userPrincipalEmpresaId;
    
    if (!principalEmpresaId) {
      const context = await getUserContext();
      if (!context?.empresa_id) {
        console.warn("[local_context_switcher] No hay contexto para validar");
        return false;
      }
      principalEmpresaId = resolvePrincipalEmpresaId(context);
    }
    
    console.log(`[local_context_switcher] 🔒 Validando seguridad: ¿El local ${localEmpresaId} pertenece al grupo ${principalEmpresaId}?`);
    
    const { data, error } = await supabase
      .from("grupos_empresariales")
      .select("empresa_id, grupo_id, activo")
      .eq("empresa_id", localEmpresaId)
      .eq("grupo_id", principalEmpresaId)
      .eq("activo", true)
      .maybeSingle();
    
    if (error) {
      console.error("[local_context_switcher] ❌ Error en validación:", error);
      return false;
    }
    
    const isValid = !!data;
    
    if (isValid) {
      console.log(`[local_context_switcher] ✅ Validación exitosa: ${localEmpresaId} es un local válido del grupo ${principalEmpresaId}`);
    } else {
      console.warn(`[local_context_switcher] ⚠️ Validación fallida: ${localEmpresaId} NO pertenece al grupo ${principalEmpresaId} o no está activo`);
    }
    
    return isValid;
    
  } catch (error) {
    console.error("[local_context_switcher] 💥 Excepción en validación:", error);
    return false;
  }
}

export async function getLocalData(localEmpresaId) {
  try {
    console.log(`[local_context_switcher] 📋 Solicitando datos del local: ${localEmpresaId}`);
    
    const isValid = await validateLocalBelongsToUserGroup(localEmpresaId);
    
    if (!isValid) {
      throw new Error(`Acceso denegado: No tienes permiso para consultar el local ${localEmpresaId}`);
    }
    
    console.log(`[local_context_switcher] 🔍 Consultando datos en tabla empresas para ID: ${localEmpresaId}`);
    
    const { data: empresaData, error: empresaError } = await supabase
      .from("empresas")
      .select("id, nombre_comercial, razon_social, email, telefono, direccion, activo")
      .eq("id", localEmpresaId)
      .eq("activo", true)
      .maybeSingle();
    
    if (empresaError) {
      console.error("[local_context_switcher] ❌ Error al consultar empresas:", empresaError);
      throw new Error(`Error al obtener datos de la empresa: ${empresaError.message}`);
    }
    
    if (!empresaData) {
      throw new Error(`El local ${localEmpresaId} no existe o no está activo`);
    }
    
    const context = await getUserContext();
    const principalEmpresaId = resolvePrincipalEmpresaId(context);
    
    const { data: grupoData, error: grupoError } = await supabase
      .from("grupos_empresariales")
      .select("nombre_grupo, razon_social_grupo, plan_grupo")
      .eq("empresa_id", localEmpresaId)
      .eq("grupo_id", principalEmpresaId)
      .maybeSingle();
    
    if (grupoError) {
      console.warn("[local_context_switcher] No se pudo obtener datos del grupo:", grupoError);
    }
    
    const result = {
      success: true,
      local: {
        id: empresaData.id,
        nombre_comercial: empresaData.nombre_comercial,
        razon_social: empresaData.razon_social,
        email: empresaData.email,
        telefono: empresaData.telefono,
        direccion: empresaData.direccion,
        activo: empresaData.activo
      },
      grupo: grupoData ? {
        nombre: grupoData.nombre_grupo,
        razon_social: grupoData.razon_social_grupo,
        plan: grupoData.plan_grupo
      } : null
    };
    
    console.log(`[local_context_switcher] ✅ Datos del local obtenidos:`, result.local.nombre_comercial);
    return result;
    
  } catch (error) {
    console.error("[local_context_switcher] ❌ Error en getLocalData:", error);
    return {
      success: false,
      error: error.message
    };
  }
}

async function fetchGroupLocales(principalEmpresaId) {
  if (!principalEmpresaId) {
    console.warn("[local_context_switcher] ❌ No hay principalEmpresaId para buscar locales");
    return [];
  }

  console.log("[local_context_switcher] 🔍 Buscando locales en Supabase...");
  console.log("[local_context_switcher] 📊 Tabla: grupos_empresariales");
  console.log("[local_context_switcher] 🎯 Condición: grupo_id =", principalEmpresaId);

  try {
    const { data: groupRelations, error } = await supabase
      .from("grupos_empresariales")
      .select("empresa_id, grupo_id, nombre_grupo, razon_social_grupo, plan_grupo, activo")
      .eq("grupo_id", principalEmpresaId)
      .eq("activo", true);

    if (error) {
      console.error("[local_context_switcher] ❌ Error detallado:", error);
      return [];
    }

    if (!groupRelations || groupRelations.length === 0) {
      console.warn(`[local_context_switcher] ⚠️ No se encontraron relaciones para grupo_id: ${principalEmpresaId}`);
      return [];
    }

    // Los nombres visibles del local NO salen de `grupos_empresariales`: esa tabla
    // solo relaciona `grupo_id` (empresa principal) con `empresa_id` (tenant/local).
    // La identidad comercial real se toma desde `empresas` por `id = empresa_id`.
    const empresaIds = uniqueIds(groupRelations.map((rel) => rel?.empresa_id));
    const empresas = await fetchEmpresasByIds(empresaIds);
    const empresaById = new Map(empresas.map((empresa) => [normalizeId(empresa.id), empresa]));

    const enrichedLocales = groupRelations.map((rel) => {
      const empresa = empresaById.get(normalizeId(rel.empresa_id));
      return {
        empresa_id: rel.empresa_id,
        grupo_id: rel.grupo_id,
        nombre_grupo: rel.nombre_grupo,
        razon_social_grupo: rel.razon_social_grupo,
        plan_grupo: rel.plan_grupo,
        activo: rel.activo,
        local_nombre_comercial: empresa?.nombre_comercial || null,
        local_razon_social: empresa?.razon_social || null,
        local_activo: empresa?.activo !== false,
        local_exists_in_empresas: !!empresa
      };
    });

    console.log(`[local_context_switcher] ✅ Locales del grupo disponibles:`, enrichedLocales.length);
    return enrichedLocales;
    
  } catch (error) {
    console.error("[local_context_switcher] 💥 Excepción catastrófica:", error);
    return [];
  }
}

export async function getLocalesList(empresaId = null) {
  try {
    let targetEmpresaId = empresaId;
    
    if (!targetEmpresaId) {
      const context = await getUserContext();
      if (!context?.empresa_id) {
        console.warn("[local_context_switcher] No hay contexto para obtener locales");
        return [];
      }
      targetEmpresaId = resolvePrincipalEmpresaId(context);
    }
    
    const locales = await fetchGroupLocales(targetEmpresaId);
    
    if (locales.length === 0) {
      return [];
    }
    
    const formattedLocales = locales.map(local => ({
      id: local.empresa_id,
      grupo_id: local.grupo_id,
      nombre: local.local_nombre_comercial || local.local_razon_social || "Nombre no disponible",
      razon_social: local.local_razon_social || local.local_nombre_comercial || "Razón social no disponible",
      plan: local.plan_grupo,
      activo: local.activo && local.local_activo,
      nombre_grupo: local.nombre_grupo,
      esta_en_empresas: local.local_exists_in_empresas
    }));
    
    console.log(`[local_context_switcher] 📋 Lista final de locales (${formattedLocales.length}):`, formattedLocales);
    return formattedLocales;
    
  } catch (error) {
    console.error("[local_context_switcher] Error al obtener lista de locales:", error);
    return [];
  }
}

// ==============================================
// NUEVA FUNCIÓN: Obtener el usuario local para un tenant específico
// ==============================================
export async function getLocalUserForTenant(principalUserId, targetEmpresaId) {
  try {
    console.log(`[local_context_switcher] 🔍 Buscando usuario local para usuario principal: ${principalUserId} en empresa: ${targetEmpresaId}`);
    
    const { data, error } = await supabase
      .from("usuarios_locales")
      .select("id, usuario_principal_id, empresa_id, nombre_completo, rol, activo")
      .eq("usuario_principal_id", principalUserId)
      .eq("empresa_id", targetEmpresaId)
      .eq("activo", true)
      .maybeSingle();
    
    if (error) {
      console.error("[local_context_switcher] ❌ Error al buscar usuario local:", error);
      return null;
    }
    
    if (data) {
      console.log("[local_context_switcher] ✅ Usuario local encontrado:", {
        id: data.id,
        empresa_id: data.empresa_id,
        rol: data.rol
      });
      return data;
    } else {
      console.log("[local_context_switcher] ℹ️ No hay usuario local para este tenant (posiblemente admin sin duplicado)");
      return null;
    }
  } catch (error) {
    console.error("[local_context_switcher] 💥 Excepción en getLocalUserForTenant:", error);
    return null;
  }
}

export async function switchToLocal(localEmpresaId) {
  try {
    console.log(`[local_context_switcher] 🔄 Intentando cambiar al local: ${localEmpresaId}`);
    
    const context = await getUserContext();
    if (!context?.empresa_id) {
      throw new Error("No hay contexto de usuario");
    }
    
    const principalEmpresaId = resolvePrincipalEmpresaId(context);
    
    const isValid = await validateLocalBelongsToUserGroup(localEmpresaId, principalEmpresaId);
    
    if (!isValid) {
      throw new Error(`Acceso denegado: No puedes cambiar al local ${localEmpresaId}`);
    }
    
    const localData = await getLocalData(localEmpresaId);
    
    if (!localData.success) {
      throw new Error(localData.error || "No se pudo obtener datos del local");
    }
    
    // Determinar el usuario_id según el rol
    const principalUserId = resolvePrincipalUserId(context);
    let usuarioId = principalUserId;
    const esAdmin = isAdminRootContext(context);
    
    const usuarioLocal = await getLocalUserForTenant(principalUserId, localEmpresaId);
    if (usuarioLocal) {
      usuarioId = usuarioLocal.id;
    }
    
    writeStoredLocalSelection({ 
      empresa_id: localEmpresaId, 
      grupo_id: principalEmpresaId,
      usuario_id: usuarioId
    });
    
    console.log(`[local_context_switcher] ✅ Cambio exitoso al local:`, {
      id: localEmpresaId,
      nombre: localData.local.nombre_comercial,
      grupo: principalEmpresaId,
      usuario_id: usuarioId,
      es_admin: esAdmin
    });
    
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('localChanged', { 
        detail: { 
          local: localData.local,
          grupo_id: principalEmpresaId,
          previous_local_id: context.empresa_id,
          usuario_id: usuarioId
        } 
      }));
    }
    
    return {
      success: true,
      local: localData.local,
      grupo: localData.grupo,
      grupo_id: principalEmpresaId,
      usuario_id: usuarioId,
      es_admin: esAdmin
    };
    
  } catch (error) {
    console.error("[local_context_switcher] ❌ Error al cambiar de local:", error);
    return {
      success: false,
      error: error.message
    };
  }
}

export async function switchToPrincipal() {
  try {
    console.log(`[local_context_switcher] Cambiando a la empresa principal...`);
    
    const context = await getUserContext();
    if (!context?.empresa_id) {
      throw new Error("No hay contexto de usuario");
    }
    
    const principalEmpresaId = resolvePrincipalEmpresaId(context);
    const principalUserId = resolvePrincipalUserId(context);
    
    writeStoredLocalSelection(null);
    
    console.log(`[local_context_switcher] ✅ Cambio a principal: ${principalEmpresaId}, usuario: ${principalUserId}`);
    
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('localChanged', { 
        detail: { 
          local_id: principalEmpresaId, 
          grupo_id: null,
          is_principal: true,
          usuario_id: principalUserId
        } 
      }));
    }
    
    return {
      success: true,
      local_id: principalEmpresaId,
      is_principal: true,
      usuario_id: principalUserId
    };
    
  } catch (error) {
    console.error("[local_context_switcher] ❌ Error al cambiar a principal:", error);
    return {
      success: false,
      error: error.message
    };
  }
}

export async function getCurrentLocal() {
  const context = await getUserContext();
  if (!context?.empresa_id) return null;
  
  const storedSelection = readStoredLocalSelection();
  const principalEmpresaId = resolvePrincipalEmpresaId(context);
  const currentEmpresaId = context.empresa_id;
  const isLocal = normalizeId(currentEmpresaId) !== normalizeId(principalEmpresaId);
  
  if (isLocal && storedSelection) {
    const localData = await getLocalData(currentEmpresaId);
    
    if (localData.success) {
      return {
        id: currentEmpresaId,
        grupo_id: principalEmpresaId,
        nombre: localData.local.nombre_comercial,
        razon_social: localData.local.razon_social,
        tipo: "local",
        is_principal: false,
        datos_completos: localData.local
      };
    }
  }
  
  return {
    id: principalEmpresaId,
    grupo_id: null,
    nombre: "Empresa Principal",
    tipo: "principal",
    is_principal: true
  };
}

export async function hasLocales(empresaId = null) {
  try {
    let targetEmpresaId = empresaId;
    
    if (!targetEmpresaId) {
      const context = await getUserContext();
      if (!context?.empresa_id) {
        console.warn("[local_context_switcher] No hay contexto para verificar locales");
        return false;
      }
      targetEmpresaId = resolvePrincipalEmpresaId(context);
    }
    
    console.log(`[local_context_switcher] Verificando si ${targetEmpresaId} tiene locales...`);
    const locales = await fetchGroupLocales(targetEmpresaId);
    const hasLocalesFlag = locales.length > 0;
    
    console.log(`[local_context_switcher] Resultado: ${hasLocalesFlag ? '✅ TIENE locales' : '❌ NO TIENE locales'}`);
    return hasLocalesFlag;
    
  } catch (error) {
    console.error("[local_context_switcher] Error al verificar locales:", error);
    return false;
  }
}

export async function listLocalContextsForSwitcher() {
  const context = await getUserContext();
  if (!context?.empresa_id) return [];

  const principalEmpresaId = resolvePrincipalEmpresaId(context);
  const principalUserId = resolvePrincipalUserId(context);
  if (!principalEmpresaId || !principalUserId) return [];

  const { data: principalEmpresa, error: principalError } = await supabase
    .from("empresas")
    .select("id, nombre_comercial, razon_social")
    .eq("id", principalEmpresaId)
    .maybeSingle();

  const nombrePrincipal = principalEmpresa?.nombre_comercial || principalEmpresa?.razon_social || "Empresa principal";

  const locales = [{
    empresa_id: principalEmpresaId,
    usuario_id: principalUserId,
    nombre: nombrePrincipal,
    tipo: "principal",
    activo: normalizeId(context.empresa_id) === principalEmpresaId && context.local_context !== true
  }];

  const grupos = await fetchGroupLocales(principalEmpresaId);
  const localEmpresaIds = uniqueIds(grupos.map((grupo) => grupo?.empresa_id));
  const adminRoot = isAdminRootContext(context);
  const usuariosLocales = await fetchUsuariosLocales({ principalUserId, localEmpresaIds });

  const visibleLocalIds = adminRoot
    ? localEmpresaIds
    : uniqueIds(usuariosLocales.map((usuarioLocal) => usuarioLocal?.empresa_id));
  
  const empresas = await fetchEmpresasByIds([...visibleLocalIds]);
  const empresaById = new Map(empresas.map((empresa) => [normalizeId(empresa.id), empresa]));
  const grupoByEmpresaId = new Map(grupos.map((grupo) => [grupo.empresa_id, grupo]));

  const labelForEmpresa = (empresaId, fallback) => {
    const empresa = empresaById.get(normalizeId(empresaId));
    const label = String(empresa?.nombre_comercial || empresa?.razon_social || fallback || "Nombre no disponible").trim();
    return isUuidLike(label) ? "Nombre no disponible" : label;
  };

  const usuarioLocalByEmpresaId = new Map(usuariosLocales.map((usuarioLocal) => [usuarioLocal.empresa_id, usuarioLocal]));
  const rowsForMenu = adminRoot
    ? grupos.map((grupo) => {
        const usuarioLocal = usuarioLocalByEmpresaId.get(grupo.empresa_id);
        return {
          empresa_id: grupo.empresa_id,
          id: usuarioLocal?.id || principalUserId,
          rol: usuarioLocal?.rol || context.rol,
          grupo
        };
      })
    : usuariosLocales.map((usuarioLocal) => ({
        ...usuarioLocal,
        grupo: grupoByEmpresaId.get(usuarioLocal.empresa_id)
      }));

  rowsForMenu.forEach((row) => {
    const grupo = row.grupo || grupoByEmpresaId.get(row.empresa_id);
    locales.push({
      empresa_id: row.empresa_id,
      usuario_id: row.id,
      nombre: labelForEmpresa(row.empresa_id, grupo?.local_nombre_comercial || grupo?.local_razon_social || ""),
      tipo: "local",
      rol: row.rol || "",
      activo: normalizeId(context.empresa_id) === normalizeId(row.empresa_id),
      grupo_id: principalEmpresaId
    });
  });

  console.log("[local_context_switcher] listLocalContextsForSwitcher resultado:", locales);
  return locales;
}

async function fetchUsuariosLocales({ principalUserId, localEmpresaIds }) {
  if (!principalUserId || !localEmpresaIds.length) return [];

  console.log("[local_context_switcher] 🔍 Buscando usuarios locales para usuario principal:", principalUserId);

  const { data, error } = await supabase
    .from("usuarios_locales")
    .select("id, usuario_principal_id, empresa_id, nombre_completo, rol, activo")
    .eq("usuario_principal_id", principalUserId)
    .in("empresa_id", localEmpresaIds)
    .eq("activo", true);

  if (error) {
    console.warn("[local_context_switcher] No se pudieron cargar usuarios locales:", error);
    return [];
  }

  console.log("[local_context_switcher] ✅ Usuarios locales encontrados:", data?.length || 0);
  return Array.isArray(data) ? data : [];
}

async function fetchEmpresasByIds(empresaIds) {
  const ids = uniqueIds(empresaIds);
  if (!ids.length) return [];

  try {
    const { data, error } = await supabase
      .from("empresas")
      .select("id, nombre_comercial, razon_social, activo")
      .in("id", ids);

    if (error) {
      console.warn("[local_context_switcher] No se pudieron cargar nombres desde empresas; usando nombres de grupo.", error?.message || error);
      return [];
    }

    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.warn("[local_context_switcher] Error cargando nombres desde empresas; usando nombres de grupo.", error?.message || error);
    return [];
  }
}

export async function prepareLocalContextSwitch(empresaId) {
  const context = await getUserContext();
  if (!context?.empresa_id) throw new Error("No se pudo resolver el contexto actual.");

  const targetEmpresaId = normalizeId(empresaId);
  const principalEmpresaId = resolvePrincipalEmpresaId(context);
  const principalUserId = resolvePrincipalUserId(context);
  if (!targetEmpresaId) throw new Error("Local inválido.");
  if (!principalEmpresaId || !principalUserId) throw new Error("No se pudo resolver la empresa o usuario principal.");

  if (targetEmpresaId === principalEmpresaId) {
    writeStoredLocalSelection(null);
    return { 
      empresa_id: principalEmpresaId, 
      usuario_id: principalUserId, 
      tipo: "principal",
      necesitaRecarga: true
    };
  }

  const grupos = await fetchGroupLocales(principalEmpresaId);
  const grupo = grupos.find((row) => normalizeId(row?.empresa_id) === targetEmpresaId);
  if (!grupo) throw new Error("El local seleccionado no está activo o no pertenece a esta empresa principal.");

  let usuarioId = principalUserId;
  const esAdmin = isAdminRootContext(context);
  
  const usuarioLocal = await getLocalUserForTenant(principalUserId, targetEmpresaId);
  if (usuarioLocal) {
    usuarioId = usuarioLocal.id;
  }

  writeStoredLocalSelection({ empresa_id: targetEmpresaId, grupo_id: principalEmpresaId });

  return { 
    empresa_id: targetEmpresaId, 
    usuario_id: usuarioId, 
    tipo: "local",
    es_admin: esAdmin,
    necesitaRecarga: true
  };
}

let initialized = false;
let initPromise = null;

export async function initializeLocalContext() {
  if (initialized) {
    console.log("[local_context_switcher] Ya estaba inicializado");
    return;
  }

  if (initPromise) {
    console.log("[local_context_switcher] Esperando inicialización en curso...");
    return initPromise;
  }

  initPromise = (async () => {
    try {
      console.log("[local_context_switcher] 🚀 Iniciando inicialización...");
      
      const context = await getUserContext();
      
      if (!context || !context.empresa_id) {
        console.log("[local_context_switcher] Usuario no logueado aún, reintentando en 2 segundos...");
        setTimeout(() => {
          initPromise = null;
          initializeLocalContext();
        }, 2000);
        return;
      }
      
      console.log("[local_context_switcher] Contexto encontrado:", {
        empresa_id: context.empresa_id,
        rol: context.rol
      });
      
      const tieneLocales = await hasLocales();
      console.log(`[local_context_switcher] ¿La empresa tiene locales? ${tieneLocales ? 'SÍ' : 'NO'}`);
      
      if (tieneLocales) {
        const localesList = await getLocalesList();
        console.log(`[local_context_switcher] Locales disponibles:`, localesList);
      }
      
      const storedSelection = readStoredLocalSelection();
      
      if (storedSelection) {
        console.log("[local_context_switcher] Selección guardada:", storedSelection);
        try {
          const result = await prepareLocalContextSwitch(storedSelection.empresa_id);
          console.log("[local_context_switcher] ✅ Contexto restaurado:", result);
          
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('localContextReady', { detail: result }));
          }
          
          initialized = true;
          
          if (typeof window !== 'undefined') {
            console.log("[local_context_switcher] 📢 Disparando evento localContextReady");
            window.dispatchEvent(new CustomEvent('localContextReady'));
          }
          
          return result;
        } catch (error) {
          console.warn("[local_context_switcher] ⚠️ No se pudo restaurar:", error.message);
          writeStoredLocalSelection(null);
        }
      }
      
      initialized = true;
      console.log("[local_context_switcher] ✅ Inicialización completada");
      
      if (typeof window !== 'undefined') {
        console.log("[local_context_switcher] 📢 Disparando evento localContextReady");
        window.dispatchEvent(new CustomEvent('localContextReady'));
      }
      
    } catch (error) {
      console.error("[local_context_switcher] ❌ Error:", error);
      initPromise = null;
      setTimeout(() => {
        if (!initialized) {
          initializeLocalContext();
        }
      }, 5000);
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

export { validateLocalBelongsToUserGroup };
export function isLocalContextInitialized() {
  return initialized;
}

// ==============================================
// AUTO-INICIALIZACIÓN ROBUSTA
// ==============================================
if (typeof window !== 'undefined') {
  let initAttempts = 0;
  const MAX_ATTEMPTS = 10;
  const INIT_DELAY_MS = 3000;
  
  const attemptInitialization = () => {
    initAttempts++;
    console.log(`[local_context_switcher] 🔄 Intento de inicialización #${initAttempts}...`);
    
    initializeLocalContext().then(() => {
      console.log("[local_context_switcher] ✅ Auto-inicialización exitosa");
    }).catch((err) => {
      console.warn(`[local_context_switcher] ⚠️ Intento #${initAttempts} falló:`, err?.message || err);
      
      if (initAttempts < MAX_ATTEMPTS) {
        setTimeout(attemptInitialization, INIT_DELAY_MS);
      } else {
        console.error("[local_context_switcher] ❌ No se pudo inicializar después de", MAX_ATTEMPTS, "intentos");
      }
    });
  };
  
  attemptInitialization();
}
