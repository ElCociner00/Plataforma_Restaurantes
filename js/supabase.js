import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_CONFIG } from "./config.js";

// 🔧 FIX: Forzar que el token se extraiga correctamente
const TOKEN_KEY = 'sb-ivgzwgyjyqfunheaesxx-auth-token';

function getCleanToken() {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (!stored) return null;
    try {
        const parsed = JSON.parse(stored);
        return parsed.access_token || null;
    } catch(e) {
        return stored;
    }
}

// Crear cliente con session personalizada
export const supabase = createClient(
    SUPABASE_CONFIG.url,
    SUPABASE_CONFIG.anonKey,
    {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            storage: window.localStorage
        },
        // Forzar headers globales
        global: {
            headers: {
                'apikey': SUPABASE_CONFIG.anonKey
            }
        }
    }
);

// Forzar la sesión inicial con el token limpio
const cleanToken = getCleanToken();
if (cleanToken) {
    supabase.auth.setSession({
        access_token: cleanToken,
        refresh_token: localStorage.getItem(`${TOKEN_KEY}_refresh`) || ''
    }).catch(console.error);
}
