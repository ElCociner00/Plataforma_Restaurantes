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
// FUNCIÓN MEJORADA CON LOGS PARA DIAGNÓSTICO
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
  console.log("[local_context_switcher] 🔑 Usando cliente Supabase:", supabase ? "✅ Cliente existe" : "❌ Cliente NO existe");

  try {
    const { data, error, status, statusText } = await supabase
      .from("grupos_empresariales")
      .select("*")  // Seleccionar todo para ver qué columnas existen realmente
      .eq("grupo_id", principalEmpresaId)
      .eq("activo", true);

    console.log("[local_context_switcher] 📡 Respuesta de Supabase:");
    console.log("  - Status:", status);
    console.log("  - StatusText:", statusText);
    console.log("  - Error:", error);
    console.log("  - Data:", data);
    console.log("  - ¿Data es array?", Array.isArray(data));
    console.log("  - Cantidad de registros:", data?.length || 0);

    if (error) {
      console.error("[local_context_switcher] ❌ Error detallado al cargar locales:", {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint
      });
      return [];
    }

    if (!data || data.length === 0) {
      console.warn(`[local_context_switcher] ⚠️ No se encontraron locales para grupo_id: ${principalEmpresaId}`);
      
      // Intentar ver si la tabla tiene datos en general
      console.log("[local_context_switcher] 🔍 Verificando si la tabla tiene algún registro...");
      const { count, error: countError } = await supabase
        .from("grupos_empresariales")
        .select("*", { count: 'exact', head: true });
      
      console.log("[local_context_switcher] 📊 Total de registros en grupos_empresariales:", count);
      if (countError) {
        console.error("[local_context_switcher] Error al contar registros:", countError);
      }
      
      return [];
    }

    console.log(`[local_context_switcher] ✅ Se encontraron ${data.length} locales:`);
    data.forEach((local, index) => {
      console.log(`  Local ${index + 1}:`, {
        empresa_id: local.empresa_id,
        grupo_id: local.grupo_id,
        nombre_grupo: local.nombre_grupo
      });
    });
    
    return data;
    
  } catch (error) {
    console.error("[local_context_switcher] 💥 Excepción catastrófica en fetchGroupLocales:", error);
    return [];
  }
}

async function fetchEmpresasByIds(empresaIds) {
  const ids = uniqueIds(empresaIds);
  if (!ids.length) return [];

  console.log("[local_context_switcher] 🔍 Buscando nombres de empresas para IDs:", ids);

  const { data, error } = await supabase
    .from("empresas")
    .select("id, nombre_comercial, razon_social")
    .in("id", ids);

  if (error) {
    console.warn("[local_context_switcher] No se pudieron cargar nombres de empresas/locales:", error);
    return [];
  }

  console.log("[local_context_switcher] ✅ Empresas encontradas:", data?.length || 0);
  return Array.isArray(data) ? data : [];
}

async function fetchUsuariosLocales({ principalUserId, localEmpresaIds }) {
  if (!principalUserId || !localEmpresaIds.length) return [];

  console.log("[local_context_switcher] 🔍 Buscando usuarios locales para usuario principal:", principalUserId);
  console.log("[local_context_switcher] 📍 En empresas:", localEmpresaIds);

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

// ==============================================
// FUNCIÓN DIAGNÓSTICA: Ver estructura de la tabla
// ==============================================
export async function diagnoseDatabaseStructure() {
  console.log("[local_context_switcher] 🩺 INICIANDO DIAGNÓSTICO DE BASE DE DATOS");
  console.log("==================================================");
  
  // 1. Verificar conexión a Supabase
  console.log("1️⃣ Verificando conexión a Supabase...");
  try {
    const { data: healthCheck, error: healthError } = await supabase.from('grupos_empresariales').select('count', { count: 'exact', head: true });
    if (healthError) {
      console.error("❌ Error de conexión:", healthError);
    } else {
      console.log("✅ Conexión a Supabase exitosa");
    }
  } catch (e) {
    console.error("❌ No se pudo conectar a Supabase:", e);
  }
  
  // 2. Obtener contexto actual
  console.log("\n2️⃣ Obteniendo contexto de usuario...");
  const context = await getUserContext();
  console.log("Contexto completo:", context);
  console.log("empresa_id del contexto:", context?.empresa_id);
  console.log("rol:", context?.rol);
  
  // 3. Obtener todas las columnas de grupos_empresariales
  console.log("\n3️⃣ Consultando estructura de grupos_empresariales...");
  const { data: sampleData, error: sampleError } = await supabase
    .from("grupos_empresariales")
    .select("*")
    .limit(1);
  
  if (sampleError) {
    console.error("❌ Error al obtener muestra:", sampleError);
  } else if (sampleData && sampleData.length > 0) {
    console.log("✅ Columnas disponibles en grupos_empresariales:");
    const columns = Object.keys(sampleData[0]);
    columns.forEach(col => console.log(`   - ${col}`));
  } else {
    console.log("⚠️ La tabla grupos_empresariales está vacía o no existe");
  }
  
  // 4. Contar registros totales
  console.log("\n4️⃣ Contando registros...");
  const { count: totalCount, error: countError } = await supabase
    .from("grupos_empresariales")
    .select("*", { count: 'exact', head: true });
  
  if (countError) {
    console.error("❌ Error al contar:", countError);
  } else {
    console.log(`📊 Total de registros en grupos_empresariales: ${totalCount}`);
  }
  
  // 5. Buscar por grupo_id específico
  if (context?.empresa_id) {
    console.log(`\n5️⃣ Buscando registros con grupo_id = ${context.empresa_id}...`);
    const { data: matchingGroups, error: matchError } = await supabase
      .from("grupos_empresariales")
      .select("*")
      .eq("grupo_id", context.empresa_id);
    
    if (matchError) {
      console.error("❌ Error en búsqueda:", matchError);
    } else {
      console.log(`✅ Encontrados ${matchingGroups?.length || 0} registros con ese grupo_id`);
      if (matchingGroups && matchingGroups.length > 0) {
        console.log("Registros:", matchingGroups);
      }
    }
  }
  
  console.log("\n==================================================");
  console.log("🩺 DIAGNÓSTICO COMPLETADO");
}

// ==============================================
// FUNCIÓN MEJORADA hasLocales
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
    
    const empresaIds = locales.map(l => l.empresa_id);
    const empresas = await fetchEmpresasByIds(empresaIds);
    const empresaMap = new Map(empresas.map(e => [e.id, e]));
    
    const formattedLocales = locales.map(local => ({
      id: local.empresa_id,
      grupo_id: local.grupo_id,
      nombre: empresaMap.get(local.empresa_id)?.nombre_comercial || local.nombre_grupo || "Local sin nombre",
      razon_social: local.razon_social_grupo,
      plan: local.plan_grupo,
      activo: local.activo
    }));
    
    console.log(`[local_context_switcher] Lista de locales:`, formattedLocales);
    return formattedLocales;
    
  } catch (error) {
    console.error("[local_context_switcher] Error al obtener lista de locales:", error);
    return [];
  }
}

export async function switchToLocal(localEmpresaId) {
  try {
    console.log(`[local_context_switcher] Intentando cambiar al local: ${localEmpresaId}`);
    
    const context = await getUserContext();
    if (!context?.empresa_id) {
      throw new Error("No hay contexto de usuario");
    }
    
    const principalEmpresaId = resolvePrincipalEmpresaId(context);
    const locales = await fetchGroupLocales(principalEmpresaId);
    const targetLocal = locales.find(l => normalizeId(l.empresa_id) === normalizeId(localEmpresaId));
    
    if (!targetLocal) {
      throw new Error(`El local ${localEmpresaId} no pertenece al grupo ${principalEmpresaId} o no está activo`);
    }
    
    writeStoredLocalSelection({ 
      empresa_id: localEmpresaId, 
      grupo_id: principalEmpresaId 
    });
    
    console.log(`[local_context_switcher] ✅ Cambio exitoso al local: ${targetLocal.nombre_grupo}`);
    
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

export async function switchToPrincipal() {
  try {
    console.log(`[local_context_switcher] Cambiando a la empresa principal...`);
    
    const context = await getUserContext();
    if (!context?.empresa_id) {
      throw new Error("No hay contexto de usuario");
    }
    
    const principalEmpresaId = resolvePrincipalEmpresaId(context);
    writeStoredLocalSelection(null);
    
    console.log(`[local_context_switcher] ✅ Cambio a principal: ${principalEmpresaId}`);
    
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

export async function getCurrentLocal() {
  const context = await getUserContext();
  if (!context?.empresa_id) return null;
  
  const storedSelection = readStoredLocalSelection();
  const principalEmpresaId = resolvePrincipalEmpresaId(context);
  const currentEmpresaId = context.empresa_id;
  const isLocal = normalizeId(currentEmpresaId) !== normalizeId(principalEmpresaId);
  
  if (isLocal && storedSelection) {
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
// INICIALIZACIÓN
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
      console.log("[local_context_switcher] 🚀 Iniciando inicialización tardía...");
      
      // Ejecutar diagnóstico automático
      await diagnoseDatabaseStructure();
      
      const context = await getUserContext();
      
      if (!context || !context.empresa_id) {
        console.log("[local_context_switcher] Usuario no logueado aún, reintentando...");
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
          return result;
        } catch (error) {
          console.warn("[local_context_switcher] ⚠️ No se pudo restaurar:", error.message);
          writeStoredLocalSelection(null);
        }
      }
      
      initialized = true;
      console.log("[local_context_switcher] ✅ Inicialización completada");
      
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

if (typeof window !== 'undefined') {
  const startDelayedInitialization = () => {
    console.log("[local_context_switcher] ⏰ Programando inicialización en 3 segundos...");
    setTimeout(() => {
      console.log("[local_context_switcher] ▶️ Ejecutando inicialización...");
      initializeLocalContext();
    }, 3000);
  };
  
  if (document.readyState === 'complete') {
    startDelayedInitialization();
  } else {
    window.addEventListener('load', startDelayedInitialization);
  }
}

export function isLocalContextInitialized() {
  return initialized;
}
