import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_CONFIG } from "./config.js";

// Configuración para mantener sesión y permitir envío de cookies en peticiones REST.
export const supabase = createClient(
  SUPABASE_CONFIG.url,
  SUPABASE_CONFIG.anonKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    },
    global: {
      fetch: (url, options = {}) => fetch(url, {
        ...options,
        credentials: "include"
      })
    }
  }
);
