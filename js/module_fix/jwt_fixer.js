// js/module_fix/jwt_fixer.js
// Reparador de token JWT - Versión CORREGIDA
(function() {
  'use strict';

  const TOKEN_STORAGE_KEY = 'sb-ivgzwgyjyqfunheaesxx-auth-token';

  try {
    const stored = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!stored) return;

    const parsed = JSON.parse(stored);
    
    // Extraer el access_token
    let rawToken = null;
    if (parsed.access_token && typeof parsed.access_token === 'string') {
      rawToken = parsed.access_token;
    } else if (typeof parsed === 'string' && parsed.split('.').length === 3) {
      rawToken = parsed;
    }
    
    if (rawToken) {
      const parts = rawToken.split('.');
      if (parts.length === 3) {
        // 🔥 CAMBIO CRÍTICO: Guardar SOLO el string del token, no un objeto
        localStorage.setItem(TOKEN_STORAGE_KEY, rawToken);
        console.log('✅ [JWT Fixer] Token reparado guardado como string puro (3 partes)');
        
        // Verificar el cambio
        const verify = localStorage.getItem(TOKEN_STORAGE_KEY);
        console.log('📦 Token guardado, primeras 50 chars:', verify.substring(0, 50));
      } else {
        console.warn('⚠️ [JWT Fixer] Token tiene', parts.length, 'partes, se esperaban 3');
      }
    }
  } catch (e) {
    console.error('❌ [JWT Fixer] Error:', e);
  }
})();
