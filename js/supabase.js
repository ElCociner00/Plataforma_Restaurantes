// js/supabase.js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_CONFIG } from "./config.js";

// Configuración estándar sin modificaciones
export const supabase = createClient(
  SUPABASE_CONFIG.url,
  SUPABASE_CONFIG.anonKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: window.localStorage
    }
  }
);
