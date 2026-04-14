// js/module_fix/jwt_fixer.js
// Reparador de token JWT: Convierte el objeto de sesión corrupto en un token JWT puro (3 partes).
// Se ejecuta UNA SOLA VEZ al cargar la página y repara el localStorage.
// NO MODIFICA NINGÚN ARCHIVO EXISTENTE.

(function() {
  'use strict';

  const TOKEN_STORAGE_KEY = 'sb-ivgzwgyjyqfunheaesxx-auth-token';

  try {
    const stored = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!stored) return;

    const parsed = JSON.parse(stored);
    
    // Si el objeto tiene un access_token válido, lo extraemos
    if (parsed.access_token && typeof parsed.access_token === 'string') {
      const token = parsed.access_token;
      
      // Verificar que el token tenga 3 partes (formato JWT válido)
      const parts = token.split('.');
      if (parts.length === 3) {
        // Guardar SOLO el token puro, no el objeto completo
        // Mantenemos una copia de respaldo por si acaso
        const backupKey = TOKEN_STORAGE_KEY + '_backup';
        if (!localStorage.getItem(backupKey)) {
          localStorage.setItem(backupKey, stored);
        }
        
        // Reemplazar el objeto corrupto con el token puro
        localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({ access_token: token }));
        console.log('✅ [JWT Fixer] Token JWT reparado: ahora tiene 3 partes.');
      } else {
        console.warn('⚠️ [JWT Fixer] El token extraído no tiene 3 partes:', parts.length);
      }
    }
  } catch (e) {
    console.error('❌ [JWT Fixer] Error al reparar token:', e);
  }
})();
