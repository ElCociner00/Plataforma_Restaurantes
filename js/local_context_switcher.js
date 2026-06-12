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

async function fetchGroupLocales(principalEmpresaId) {
  if (!principalEmpresaId) return [];

  const { data, error } = await supabase
    .from("grupos_empresariales")
    .select("empresa_id, grupo_id, nombre_grupo, razon_social_grupo, plan_grupo, activo")
    .eq("grupo_id", principalEmpresaId)
    .eq("activo", true);

  if (error) {
    console.warn("[local_context_switcher] No se pudieron cargar locales del grupo:", error);
    return [];
  }

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
// NUEVO CÓDIGO DE INICIALIZACIÓN TARDÍA
// ==============================================

let initialized = false;
let initPromise = null;

/**
 * Inicializa el selector de locales de forma manual o automática
 * Esta función se puede llamar desde fuera si es necesario
 */
export async function initializeLocalContext() {
  // Si ya se inicializó, retornar el resultado guardado
  if (initialized) {
    console.log("[local_context_switcher] Ya estaba inicializado");
    return;
  }

  // Evitar múltiples inicializaciones simultáneas
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
        // Reintentar después de 2 segundos si no hay sesión
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
      
      const storedSelection = readStoredLocalSelection();
      
      if (storedSelection) {
        console.log("[local_context_switcher] Selección guardada encontrada:", storedSelection);
        try {
          const result = await prepareLocalContextSwitch(storedSelection.empresa_id);
          console.log("[local_context_switcher] ✅ Contexto de local restaurado exitosamente:", result);
          
          // Disparar evento personalizado para notificar que el contexto está listo
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('localContextReady', { detail: result }));
          }
          
          initialized = true;
          return result;
        } catch (error) {
          console.warn("[local_context_switcher] ⚠️ No se pudo restaurar selección guardada:", error.message);
          writeStoredLocalSelection(null);
          // Continuar con el contexto principal
        }
      } else {
        console.log("[local_context_switcher] No hay selección guardada, usando contexto principal");
      }
      
      // Disparar evento incluso sin selección guardada
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
      // Reintentar después de 5 segundos si hay error grave
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

// INICIALIZACIÓN AUTOMÁTICA TARDÍA
// Espera a que el DOM esté listo y luego inicia con un retraso
if (typeof window !== 'undefined') {
  // Función para iniciar después de que todo esté cargado
  const startDelayedInitialization = () => {
    console.log("[local_context_switcher] Programando inicialización tardía (3 segundos después de carga completa)...");
    setTimeout(() => {
      console.log("[local_context_switcher] Ejecutando inicialización tardía...");
      initializeLocalContext();
    }, 3000); // 3 segundos de retraso para asegurar que todo esté listo
  };
  
  // Si el documento ya está cargado, iniciar directamente
  if (document.readyState === 'complete') {
    startDelayedInitialization();
  } else {
    // Esperar a que todo el contenido esté cargado
    window.addEventListener('load', startDelayedInitialization);
  }
  
  // También escuchar cambios en la sesión por si el usuario loguea después
  // Esto es útil si el módulo se carga antes del login
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
  }, 1000); // Revisar cada segundo si hay sesión
  
  // Limpiar el intervalo después de 30 segundos para no dejar procesos infinitos
  setTimeout(() => {
    clearInterval(checkSessionInterval);
  }, 30000);
}

// Exportar también la función de verificación de estado
export function isLocalContextInitialized() {
  return initialized;
}
