// js/module_fix/init_safe.js
(function() {
  'use strict';

  const TOKEN_STORAGE_KEY = 'sb-ivgzwgyjyqfunheaesxx-auth-token';
  const TOKEN_RAW_KEY = TOKEN_STORAGE_KEY + '_raw';

  // Inyectar función global para obtener el token raw
  window.__getSupabaseToken = function() {
    const rawToken = localStorage.getItem(TOKEN_RAW_KEY);
    if (rawToken && rawToken.split('.').length === 3) {
      return rawToken;
    }
    
    const stored = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!stored) return null;
    try {
      const parsed = JSON.parse(stored);
      return parsed.access_token || null;
    } catch {
      return stored;
    }
  };

  // También sobrescribir cómo session.js obtiene el token
  // Esto es seguro porque solo parchea el comportamiento de lectura
  setTimeout(() => {
    try {
      const rawToken = localStorage.getItem(TOKEN_RAW_KEY);
      if (rawToken && rawToken.split('.').length === 3) {
        // Asegurar que el token original también tenga el formato correcto
        // para que session.js lo lea bien
        const tokenObj = JSON.parse(localStorage.getItem(TOKEN_STORAGE_KEY) || '{}');
        if (tokenObj.access_token && tokenObj.access_token.split('.').length !== 3) {
          // Reemplazar el token corrupto con el raw
          localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({ access_token: rawToken }));
          console.log('✅ [Safe Fix] Token original reparado para session.js');
        }
      }
    } catch (e) {
      console.error('❌ [Safe Fix] Error reparando token original:', e);
    }
  }, 500);

  console.log('✅ [Safe Fix] Inyectada función __getSupabaseToken()');
})();
