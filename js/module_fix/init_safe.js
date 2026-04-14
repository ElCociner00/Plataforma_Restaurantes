// js/module_fix/init_safe.js
// Versión SEGURA - Solo modifica el token si existe, no interfiere con el login
(function() {
  'use strict';

  const TOKEN_STORAGE_KEY = 'sb-ivgzwgyjyqfunheaesxx-auth-token';
  
  // Esperar 1 segundo después del login para no interferir
  setTimeout(() => {
    try {
      const stored = localStorage.getItem(TOKEN_STORAGE_KEY);
      if (!stored) {
        console.log('🔍 [Safe Fix] No hay token aún (posiblemente no logueado)');
        return;
      }
      
      let parsed;
      try {
        parsed = JSON.parse(stored);
      } catch(e) {
        console.log('🔍 [Safe Fix] Token ya es string, no modificar');
        return;
      }
      
      if (parsed && parsed.access_token) {
        const token = parsed.access_token;
        const parts = token.split('.');
        
        if (parts.length === 3) {
          // SOLO guardar raw, NO tocar el original
          localStorage.setItem(TOKEN_STORAGE_KEY + '_raw', token);
          console.log('✅ [Safe Fix] Token raw guardado (original intacto)');
        }
      }
    } catch (e) {
      console.error('❌ [Safe Fix] Error:', e);
    }
  }, 1000);
})();
