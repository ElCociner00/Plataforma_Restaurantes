/**
 * MAPA DE MANTENIMIENTO (guía rápida para cambios manuales)
 * Archivo: js/supabase.js
 *
 * Partes del archivo:
 * 1) Imports/constantes de configuración (dependencias y estado base).
 * 2) Utilidades puras y normalizadores (cálculos/formato/validaciones).
 * 3) Lógica principal del módulo (flujo funcional).
 * 4) Eventos/integraciones externas (DOM, API, webhooks, storage).
 *
 * Índice de funciones/bloques para ubicarte rápido:
 * - Este archivo está orientado a configuración/arranque sin funciones explícitas extensas.
 *
 * Nota: este mapa no altera la lógica; sirve para navegar y parchear sin riesgo funcional.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_CONFIG } from "./config.js";

// Configuración explícita para forzar el almacenamiento de sesión
export const supabase = createClient(
  SUPABASE_CONFIG.url,
  SUPABASE_CONFIG.anonKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: {
        getItem: (key) => {
          const value = localStorage.getItem(key);
          console.log(`🔐 [Storage] getItem: ${key}`, value ? "encontrado" : "no encontrado");
          return value;
        },
        setItem: (key, value) => {
          console.log(`🔐 [Storage] setItem: ${key}`, value ? "guardando..." : "eliminando");
          localStorage.setItem(key, value);
        },
        removeItem: (key) => {
          console.log(`🔐 [Storage] removeItem: ${key}`);
          localStorage.removeItem(key);
        }
      }
    }
  }
);

// Forzar que cualquier sesión existente se restaure al cargar
(async () => {
  const { data } = await supabase.auth.getSession();
  if (data?.session) {
    console.log("✅ Sesión restaurada automáticamente");
  } else {
    console.log("ℹ️ No hay sesión activa al cargar");
  }
})();
