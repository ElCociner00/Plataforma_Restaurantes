/**
 * Selector aislado de locales.
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
// NUEVA FUNCIÓN: Validación de seguridad
// Verifica que un local pertenezca legítimamente al grupo del usuario
// ==============================================
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
    
    // Consulta de VALIDACIÓN - esto respeta las RLS existentes
    const { data, error } = await supabase
      .from("grupos_empresariales")
      .select("empresa_id, grupo_id, activo")
      .eq("empresa_id", localEmpresaId)
      .eq("grupo_id", principalEmpresaId)
      .eq("activo", true)
      .maybeSingle();  // .maybeSingle() no da error si no encuentra
    
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

// ==============================================
// NUEVA FUNCIÓN: Obtener datos de un local de forma SEGURA
// Primero valida, luego consulta empresas
// ==============================================
export async function getLocalData(localEmpresaId) {
  try {
    console.log(`[local_context_switcher] 📋 Solicitando datos del local: ${localEmpresaId}`);
    
    // PASO 1: Validar que el usuario tiene acceso a este local
    const isValid = await validateLocalBelongsToUserGroup(localEmpresaId);
    
    if (!isValid) {
      throw new Error(`Acceso denegado: No tienes permiso para consultar el local ${localEmpresaId}`);
    }
    
    // PASO 2: Si es válido, consultar la tabla empresas
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
    
    // PASO 3: También obtener datos del grupo (para contexto)
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

// ==============================================
// FUNCIÓN MEJORADA: fetchGroupLocales (tipificación corregida)
// ==============================================
async function fetchGroupLocales(principalEmpresaId) {
  if (!principalEmpresaId) {
    console.warn("[local_context_switcher] ❌ No hay principalEmpresaId para buscar locales");
    return [];
  }

  console.log("[local_context_switcher] 🔍 Buscando locales en Supabase...");
  console.log("[local_context_switcher] 📊 Tabla: grupos_empresariales");
  console.log("[local_context_switcher] 🎯 Condición: grupo_id =", principalEmpresaId);
  console.log("[local_context_switcher] 🎯 Condición: activo = true");

  try {
    // Obtener la relación de locales del grupo
    const { data: groupRelations, error, status, statusText } = await supabase
      .from("grupos_empresariales")
      .select("empresa_id, grupo_id, nombre_grupo, razon_social_grupo, plan_grupo, activo")
      .eq("grupo_id", principalEmpresaId)
      .eq("activo", true);

    console.log("[local_context_switcher] 📡 Respuesta de Supabase:");
    console.log("  - Status:", status);
    console.log("  - Cantidad de relaciones encontradas:", groupRelations?.length || 0);

    if (error) {
      console.error("[local_context_switcher] ❌ Error detallado:", error);
      return [];
    }

    if (!groupRelations || groupRelations.length === 0) {
      console.warn(`[local_context_switcher] ⚠️ No se encontraron relaciones para grupo_id: ${principalEmpresaId}`);
      return [];
    }

    // Obtener los IDs de los locales (empresa_id)
    const localIds = groupRelations.map(rel => rel.empresa_id);
    console.log(`[local_context_switcher] IDs de locales a consultar:`, localIds);

    // PASO CRÍTICO: Consultar la tabla empresas para cada local
    // Usamos .in() para consultar múltiples IDs a la vez
    const { data: empresasData, error: empresasError } = await supabase
      .from("empresas")
      .select("id, nombre_comercial, razon_social, activo")
      .in("id", localIds)
      .eq("activo", true);

    if (empresasError) {
      console.error("[local_context_switcher] ❌ Error al consultar empresas:", empresasError);
      // Si falla consultar empresas, devolvemos solo las relaciones
      return groupRelations;
    }

    console.log(`[local_context_switcher] ✅ Empresas encontradas:`, empresasData?.length || 0);

    // Crear un mapa de empresas por ID para fácil acceso
    const empresasMap = new Map();
    empresasData?.forEach(empresa => {
      empresasMap.set(empresa.id, empresa);
    });

    // ENRIQUECER los datos del local con información de la tabla empresas
    const enrichedLocales = groupRelations.map(rel => {
      const empresaInfo = empresasMap.get(rel.empresa_id);
      
      return {
        // Datos de la relación (grupo)
        empresa_id: rel.empresa_id,
        grupo_id: rel.grupo_id,
        nombre_grupo: rel.nombre_grupo,
        razon_social_grupo: rel.razon_social_grupo,
        plan_grupo: rel.plan_grupo,
        activo: rel.activo,
        
        // Datos ENRIQUECIDOS de la tabla empresas (NUEVO)
        local_nombre_comercial: empresaInfo?.nombre_comercial || null,
        local_razon_social: empresaInfo?.razon_social || null,
        local_activo: empresaInfo?.activo || false,
        
        // Flag para saber si el local existe en empresas
        local_exists_in_empresas: !!empresaInfo
      };
    });

    console.log(`[local_context_switcher] ✅ Se encontraron ${enrichedLocales.length} locales enriquecidos:`);
    enrichedLocales.forEach((local, index) => {
      console.log(`  Local ${index + 1}:`, {
        id: local.empresa_id,
        nombre: local.local_nombre_comercial || local.nombre_grupo,
        grupo: local.grupo_id
      });
    });
    
    // Filtrar solo locales que existen en empresas (seguridad adicional)
    const validLocales = enrichedLocales.filter(local => local.local_exists_in_empresas);
    
    if (validLocales.length !== enrichedLocales.length) {
      console.warn(`[local_context_switcher] ⚠️ Se filtraron ${enrichedLocales.length - validLocales.length} locales que no existen en empresas`);
    }
    
    return validLocales;
    
  } catch (error) {
    console.error("[local_context_switcher] 💥 Excepción catastrófica:", error);
    return [];
  }
}

// ==============================================
// FUNCIÓN MEJORADA: getLocalesList (usa datos enriquecidos)
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
    
    if (locales.length === 0) {
      return [];
    }
    
    // Ahora locales ya tiene datos enriquecidos de empresas
    const formattedLocales = locales.map(local => ({
      id: local.empresa_id,
      grupo_id: local.grupo_id,
      // PRIORIZAR el nombre de la tabla empresas sobre el del grupo
      nombre: local.local_nombre_comercial || local.nombre_grupo || "Local sin nombre",
      razon_social: local.local_razon_social || local.razon_social_grupo,
      plan: local.plan_grupo,
      activo: local.activo && local.local_activo,
      // Datos adicionales útiles para UI
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
// FUNCIÓN MEJORADA: switchToLocal (con validación)
// ==============================================
export async function switchToLocal(localEmpresaId) {
  try {
    console.log(`[local_context_switcher] 🔄 Intentando cambiar al local: ${localEmpresaId}`);
    
    const context = await getUserContext();
    if (!context?.empresa_id) {
      throw new Error("No hay contexto de usuario");
    }
    
    const principalEmpresaId = resolvePrincipalEmpresaId(context);
    
    // Validación de seguridad ANTES de hacer el cambio
    const isValid = await validateLocalBelongsToUserGroup(localEmpresaId, principalEmpresaId);
    
    if (!isValid) {
      throw new Error(`Acceso denegado: No puedes cambiar al local ${localEmpresaId}`);
    }
    
    // Obtener datos del local para mostrar confirmación
    const localData = await getLocalData(localEmpresaId);
    
    if (!localData.success) {
      throw new Error(localData.error || "No se pudo obtener datos del local");
    }
    
    // Guardar selección en localStorage
    writeStoredLocalSelection({ 
      empresa_id: localEmpresaId, 
      grupo_id: principalEmpresaId 
    });
    
    console.log(`[local_context_switcher] ✅ Cambio exitoso al local:`, {
      id: localEmpresaId,
      nombre: localData.local.nombre_comercial,
      grupo: principalEmpresaId
    });
    
    // Disparar evento
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('localChanged', { 
        detail: { 
          local: localData.local,
          grupo_id: principalEmpresaId,
          previous_local_id: context.empresa_id
        } 
      }));
    }
    
    return {
      success: true,
      local: localData.local,
      grupo: localData.grupo,
      grupo_id: principalEmpresaId
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
// FUNCIÓN MEJORADA: getCurrentLocal (con datos reales)
// ==============================================
export async function getCurrentLocal() {
  const context = await getUserContext();
  if (!context?.empresa_id) return null;
  
  const storedSelection = readStoredLocalSelection();
  const principalEmpresaId = resolvePrincipalEmpresaId(context);
  const currentEmpresaId = context.empresa_id;
  const isLocal = normalizeId(currentEmpresaId) !== normalizeId(principalEmpresaId);
  
  if (isLocal && storedSelection) {
    // Obtener datos REALES del local actual
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
  
  // Si estamos en principal o no se pudo obtener el local
  return {
    id: principalEmpresaId,
    grupo_id: null,
    nombre: "Empresa Principal",
    tipo: "principal",
    is_principal: true
  };
}

// ==============================================
// FUNCIONES EXISTENTES (diagnoseDatabaseStructure, etc.)
// Mantenerlas igual pero con los logs que ya tienen
// ==============================================

// ... (el resto de funciones existentes se mantienen igual)
// - diagnoseDatabaseStructure()
// - hasLocales()
// - listLocalContextsForSwitcher()
// - prepareLocalContextSwitch()
// - initializeLocalContext()
// - etc.

// Exportar las nuevas funciones
export { validateLocalBelongsToUserGroup };
