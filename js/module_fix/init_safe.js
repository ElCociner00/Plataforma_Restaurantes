// js/module_fix/init_safe.js - Versión SIMPLIFICADA
(function() {
  'use strict';

  const TOKEN_STORAGE_KEY = 'sb-ivgzwgyjyqfunheaesxx-auth-token';
  const TOKEN_RAW_KEY = TOKEN_STORAGE_KEY + '_raw';

  // Solo guardar el token raw, sin modificar el original
  setTimeout(() => {
    try {
      const stored = localStorage.getItem(TOKEN_STORAGE_KEY);
      if (!stored) return;
      
      let parsed;
      try {
        parsed = JSON.parse(stored);
      } catch(e) {
        return;
      }
      
      if (parsed && parsed.access_token) {
        const token = parsed.access_token;
        const parts = token.split('.');
        
        if (parts.length === 3) {
          localStorage.setItem(TOKEN_RAW_KEY, token);
          console.log('✅ [Safe Fix] Token raw guardado');
        } else {
          console.warn('⚠️ [Safe Fix] Token tiene', parts.length, 'partes');
        }
      }
    } catch (e) {
      console.error('❌ [Safe Fix] Error:', e);
    }
  }, 500);
})();
