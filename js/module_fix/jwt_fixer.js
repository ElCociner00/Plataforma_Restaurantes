// js/module_fix/jwt_fixer.js
// Reparador de token JWT - Versión COMPATIBLE (objeto + string)
(function() {
  'use strict';

  const TOKEN_STORAGE_KEY = 'sb-ivgzwgyjyqfunheaesxx-auth-token';

  try {
    const stored = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!stored) return;

    let parsed;
    try {
      parsed = JSON.parse(stored);
    } catch(e) {
      // Si ya es string, no hacer nada
      return;
    }
    
    // Si es objeto con access_token
    if (parsed && parsed.access_token && typeof parsed.access_token === 'string') {
      const token = parsed.access_token;
      const parts = token.split('.');
      
      if (parts.length === 3) {
        // 🔥 Guardar en DOS formatos para compatibilidad
        // Formato 1: objeto (para supabase.js/auth.js)
        // Formato 2: string (para módulos)
        localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({ access_token: token }));
        localStorage.setItem(TOKEN_STORAGE_KEY + '_raw', token);
        
        console.log('✅ [JWT Fixer] Token reparado (formato objeto + raw)');
        console.log('📦 Token raw (primeros 50 chars):', token.substring(0, 50));
      }
    }
  } catch (e) {
    console.error('❌ [JWT Fixer] Error:', e);
  }
})();
