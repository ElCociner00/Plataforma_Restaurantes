/**
 * Selector aislado de locales.
 *
 * Este módulo no modifica login ni el núcleo de sesión. Solo prepara/valida la
 * selección de local que el sistema de sesión existente ya sabe aplicar desde
 * localStorage durante la recarga.
 */
import { supabase } from "./supabase.js";
import { getUserContext } from "./session.js";

const ACTIVE_LOCAL_CONTEXT_KEY = "plataforma_active_local_context_v1";

const normalizeId = (value) => String(value || "").trim();

const uniqueIds = (values = []) => [...new Set(values.map(normalizeId).filter(Boolean))];

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

// ==============================================
// FUNCIÓN MEJORADA: Obtener locales de una empresa principal
// ==============================================
async function fetchGroupLocales(principalEmpresaId) {
  if (!principalEmpresaId) return [];

  console.log("[local_context_switcher] Buscando locales para grupo_id:", principalEmpresaId);

  const { data, error } = await supabase
    .from("grupos_empresariales")
    .select("empresa_id, grupo_id, nombre_grupo, razon_social_grupo, plan_grupo, activo")
    .eq("grupo_id", principalEmpresaId)
    .eq("activo", true);

  if (error) {
    console.warn("[local_context_switcher] Error al cargar locales:", error);
    return [];
  }

  console.log(`[local_context_switcher] Se encontraron ${data?.length || 0} locales para el grupo ${principalEmpresaId}`);
  return Array.isArray(data) ? data : [];
}

async function fetchEmpresasByIds(empresaIds) {
  const ids = uniqueIds(empresaIds);
  if (!ids.length) return [];

  const { data, error } = await supabase
    .from("empresas")
    .select("id, nombre_comercial, razon_social")
    .in("id", ids);

  if (error) {
    console.warn("[local_context_switcher] No se pudieron cargar nombres de empresas/locales:", error);
    return [];
  }

  return Array.isArray(data) ? data : [];
}

async function fetchUsuariosLocales({ principalUserId, localEmpresaIds }) {
  if (!principalUserId || !localEmpresaIds.length) return [];

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

  return Array.isArray(data) ? data : [];
}

// ==============================================
// NUEVA FUNCIÓN: Verificar si una empresa TIENE locales
// ==============================================
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
    
    const locales = await fetchGroupLocales(targetEmpresaId);
    const hasLocalesFlag = locales.length > 0;
    
    console.log(`[local_context_switcher] La empresa ${targetEmpresaId} ${hasLocalesFlag ? 'TIENE' : 'NO TIENE'} locales (${locales.length})`);
    return hasLocalesFlag;
    
  } catch (error) {
    console.error("[local_context_switcher] Error al verificar locales:", error);
    return false;
  }
}

// ==============================================
// NUEVA FUNCIÓN: Obtener lista de locales disponibles
// ==============================================
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
    
    // Obtener nombres comerciales de los locales
    const empresaIds = locales.map(l => l.empresa_id);
    const empresas = await fetchEmpresasByIds(empresaIds);
    const empresaMap = new Map(empresas.map(e => [e.id, e]));
    
    // Formatear lista de locales para UI
    const formattedLocales = locales.map(local => ({
      id: local.empresa_id,           // ID del local (tenant)
      grupo_id: local.grupo_id,       // ID del grupo principal
      nombre: empresaMap.get(local.empresa_id)?.nombre_comercial || local.nombre_grupo || "Local sin nombre",
      razon_social: local.razon_social_grupo,
      plan: local.plan_grupo,
      activo: local.activo
    }));
    
    console.log(`[local_context_switcher] Lista de locales obtenida:`, formattedLocales);
    return formattedLocales;
    
  } catch (error) {
    console.error("[local_context_switcher] Error al obtener lista de locales:", error);
    return [];
  }
}

// ==============================================
// NUEVA FUNCIÓN: Cambiar a un local específico
// ==============================================
export async function switchToLocal(localEmpresaId) {
  try {
    console.log(`[local_context_switcher] Intentando cambiar al local: ${localEmpresaId}`);
    
    const context = await getUserContext();
    if (!context?.empresa_id) {
      throw new Error("No hay contexto de usuario");
    }
    
    const principalEmpresaId = resolvePrincipalEmpresaId(context);
    
    // Verificar que el local pertenezca al grupo principal
    const locales = await fetchGroupLocales(principalEmpresaId);
    const targetLocal = locales.find(l => normalizeId(l.empresa_id) === normalizeId(localEmpresaId));
    
    if (!targetLocal) {
      throw new Error(`El local ${localEmpresaId} no pertenece al grupo ${principalEmpresaId} o no está activo`);
    }
    
    // Guardar selección en localStorage
    writeStoredLocalSelection({ 
      empresa_id: localEmpresaId, 
      grupo_id: principalEmpresaId 
    });
    
    console.log(`[local_context_switcher] ✅ Cambio exitoso al local:`, {
      local_id: localEmpresaId,
      local_nombre: targetLocal.nombre_grupo,
      grupo_id: principalEmpresaId
    });
    
    // Disparar evento para que otros componentes se enteren
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('localChanged', { 
        detail: { 
          local_id: localEmpresaId, 
          grupo_id: principalEmpresaId,
          previous_local_id: context.empresa_id
        } 
      }));
    }
    
    return {
      success: true,
      local_id: localEmpresaId,
      grupo_id: principalEmpresaId,
      local_nombre: targetLocal.nombre_grupo
    };
    
  } catch (error) {
    console.error("[local_context_switcher] ❌ Error al cambiar de local:", error);
    return {
      success: false,
      error: error.message
    };
  }
}

// ==============================================
// NUEVA FUNCIÓN: Volver a la empresa principal
// ==============================================
export async function switchToPrincipal() {
  try {
    console.log(`[local_context_switcher] Cambiando a la empresa principal...`);
    
    const context = await getUserContext();
    if (!context?.empresa_id) {
      throw new Error("No hay contexto de usuario");
    }
    
    const principalEmpresaId = resolvePrincipalEmpresaId(context);
    
    // Limpiar selección guardada
    writeStoredLocalSelection(null);
    
    console.log(`[local_context_switcher] ✅ Cambio exitoso a empresa principal: ${principalEmpresaId}`);
    
    // Disparar evento
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('localChanged', { 
        detail: { 
          local_id: principalEmpresaId, 
          grupo_id: null,
          is_principal: true
        } 
      }));
    }
    
    return {
      success: true,
      local_id: principalEmpresaId,
      is_principal: true
    };
    
  } catch (error) {
    console.error("[local_context_switcher] ❌ Error al cambiar a principal:", error);
    return {
      success: false,
      error: error.message
    };
  }
}

// ==============================================
// NUEVA FUNCIÓN: Obtener el local actualmente activo
// ==============================================
export async function getCurrentLocal() {
  const context = await getUserContext();
  if (!context?.empresa_id) return null;
  
  const storedSelection = readStoredLocalSelection();
  const principalEmpresaId = resolvePrincipalEmpresaId(context);
  const currentEmpresaId = context.empresa_id;
  
  // Si el ID actual es diferente al principal, estamos en un local
  const isLocal = normalizeId(currentEmpresaId) !== normalizeId(principalEmpresaId);
  
  if (isLocal && storedSelection) {
    // Intentar obtener nombre del local
    const locales = await fetchGroupLocales(principalEmpresaId);
    const currentLocal = locales.find(l => normalizeId(l.empresa_id) === normalizeId(currentEmpresaId));
    
    return {
      id: currentEmpresaId,
      grupo_id: principalEmpresaId,
      nombre: currentLocal?.nombre_grupo || "Local",
      tipo: "local",
      is_principal: false
    };
  }
  
  return {
    id: principalEmpresaId,
    grupo_id: null,
    nombre: "Empresa Principal",
    tipo: "principal",
    is_principal: true
  };
}

// ==============================================
// FUNCIONES EXISTENTES (listLocalContextsForSwitcher, prepareLocalContextSwitch)
// ==============================================

export async function listLocalContextsForSwitcher() {
  const context = await getUserContext();
  if (!context?.empresa_id) return [];

  const principalEmpresaId = resolvePrincipalEmpresaId(context);
  const principalUserId = resolvePrincipalUserId(context);
  if (!principalEmpresaId || !principalUserId) return [];

  const grupos = await fetchGroupLocales(principalEmpresaId);
  const localEmpresaIds = uniqueIds(grupos.map((grupo) => grupo?.empresa_id));
  const adminRoot = isAdminRootContext(context);
  const usuariosLocales = adminRoot
    ? []
    : await fetchUsuariosLocales({ principalUserId, localEmpresaIds });

  const visibleLocalIds = adminRoot
    ? localEmpresaIds
    : uniqueIds(usuariosLocales.map((usuarioLocal) => usuarioLocal?.empresa_id));
  const empresas = await fetchEmpresasByIds([principalEmpresaId, ...visibleLocalIds]);
  const empresaById = new Map(empresas.map((empresa) => [empresa.id, empresa]));
  const grupoByEmpresaId = new Map(grupos.map((grupo) => [grupo.empresa_id, grupo]));

  const labelForEmpresa = (empresaId, fallback) => {
    const empresa = empresaById.get(empresaId);
    return String(empresa?.nombre_comercial || empresa?.razon_social || fallback || empresaId).trim();
  };

  const locales = [{
    empresa_id: principalEmpresaId,
    usuario_id: principalUserId,
    nombre: labelForEmpresa(principalEmpresaId, "Empresa principal"),
    tipo: "principal",
    activo: normalizeId(context.empresa_id) === principalEmpresaId && context.local_context !== true
  }];

  const rowsForMenu = adminRoot
    ? grupos.map((grupo) => ({
        empresa_id: grupo.empresa_id,
        id: principalUserId,
        rol: context.rol,
        grupo
      }))
    : usuariosLocales.map((usuarioLocal) => ({
        ...usuarioLocal,
        grupo: grupoByEmpresaId.get(usuarioLocal.empresa_id)
      }));

  rowsForMenu.forEach((row) => {
    const grupo = row.grupo || grupoByEmpresaId.get(row.empresa_id);
    locales.push({
      empresa_id: row.empresa_id,
      usuario_id: row.id,
      nombre: labelForEmpresa(row.empresa_id, grupo?.nombre_grupo || "Local"),
      tipo: "local",
      rol: row.rol || "",
      activo: normalizeId(context.empresa_id) === normalizeId(row.empresa_id),
      grupo_id: principalEmpresaId
    });
  });

  return locales;
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
    return { empresa_id: principalEmpresaId, usuario_id: principalUserId, tipo: "principal" };
  }

  const grupos = await fetchGroupLocales(principalEmpresaId);
  const grupo = grupos.find((row) => normalizeId(row?.empresa_id) === targetEmpresaId);
  if (!grupo) throw new Error("El local seleccionado no está activo o no pertenece a esta empresa principal.");

  let usuarioId = principalUserId;
  if (!isAdminRootContext(context)) {
    const usuariosLocales = await fetchUsuariosLocales({ principalUserId, localEmpresaIds: [targetEmpresaId] });
    const usuarioLocal = usuariosLocales.find((row) => normalizeId(row?.empresa_id) === targetEmpresaId);
    if (!usuarioLocal) throw new Error("Tu usuario no tiene duplicado activo para ese local.");
    usuarioId = usuarioLocal.id;
  }

  writeStoredLocalSelection({ empresa_id: targetEmpresaId, grupo_id: principalEmpresaId });
  return { empresa_id: targetEmpresaId, usuario_id: usuarioId, tipo: "local" };
}

// ==============================================
// INICIALIZACIÓN TARDÍA (ya existente)
// ==============================================

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
      console.log("[local_context_switcher] Iniciando inicialización tardía...");
      
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
      
      // Verificar si tiene locales
      const tieneLocales = await hasLocales();
      console.log(`[local_context_switcher] ¿La empresa tiene locales? ${tieneLocales ? 'SÍ' : 'NO'}`);
      
      if (tieneLocales) {
        const localesList = await getLocalesList();
        console.log(`[local_context_switcher] Locales disponibles:`, localesList);
      }
      
      const storedSelection = readStoredLocalSelection();
      
      if (storedSelection) {
        console.log("[local_context_switcher] Selección guardada encontrada:", storedSelection);
        try {
          const result = await prepareLocalContextSwitch(storedSelection.empresa_id);
          console.log("[local_context_switcher] ✅ Contexto de local restaurado exitosamente:", result);
          
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('localContextReady', { detail: result }));
          }
          
          initialized = true;
          return result;
        } catch (error) {
          console.warn("[local_context_switcher] ⚠️ No se pudo restaurar selección guardada:", error.message);
          writeStoredLocalSelection(null);
        }
      } else {
        console.log("[local_context_switcher] No hay selección guardada, usando contexto principal");
      }
      
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('localContextReady', { 
          detail: { empresa_id: context.empresa_id, tipo: "principal" }
        }));
      }
      
      initialized = true;
      console.log("[local_context_switcher] ✅ Inicialización completada (contexto principal)");
      
    } catch (error) {
      console.error("[local_context_switcher] ❌ Error en inicialización:", error);
      initPromise = null;
      setTimeout(() => {
        if (!initialized) {
          console.log("[local_context_switcher] Reintentando inicialización...");
          initializeLocalContext();
        }
      }, 5000);
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

if (typeof window !== 'undefined') {
  const startDelayedInitialization = () => {
    console.log("[local_context_switcher] Programando inicialización tardía (3 segundos después de carga completa)...");
    setTimeout(() => {
      console.log("[local_context_switcher] Ejecutando inicialización tardía...");
      initializeLocalContext();
    }, 3000);
  };
  
  if (document.readyState === 'complete') {
    startDelayedInitialization();
  } else {
    window.addEventListener('load', startDelayedInitialization);
  }
  
  const checkSessionInterval = setInterval(async () => {
    if (!initialized) {
      const context = await getUserContext();
      if (context?.empresa_id) {
        console.log("[local_context_switcher] Sesión detectada, iniciando inicialización...");
        clearInterval(checkSessionInterval);
        initializeLocalContext();
      }
    } else {
      clearInterval(checkSessionInterval);
    }
  }, 1000);
  
  setTimeout(() => {
    clearInterval(checkSessionInterval);
  }, 30000);
}

export function isLocalContextInitialized() {
  return initialized;
}
