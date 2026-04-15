// js/module_fix/token_cleaner.js
// Limpia el token UNA SOLA VEZ después del login
(function() {
    const TOKEN_KEY = 'sb-ivgzwgyjyqfunheaesxx-auth-token';
    
    // Verificar si ya se limpió antes
    if (sessionStorage.getItem('token_cleaned')) {
        console.log('✅ [Token Cleaner] Token ya limpiado anteriormente');
        return;
    }
    
    const stored = localStorage.getItem(TOKEN_KEY);
    if (!stored) return;
    
    try {
        // Intentar extraer el token puro
        let cleanToken = null;
        
        if (stored.startsWith('{')) {
            const parsed = JSON.parse(stored);
            cleanToken = parsed.access_token;
        } else if (stored.split('.').length === 3) {
            cleanToken = stored;
        }
        
        if (cleanToken && cleanToken.split('.').length === 3) {
            // Guardar el token limpio
            localStorage.setItem(TOKEN_KEY, cleanToken);
            sessionStorage.setItem('token_cleaned', 'true');
            console.log('✅ [Token Cleaner] Token limpiado correctamente');
        }
    } catch(e) {
        console.error('❌ [Token Cleaner] Error:', e);
    }
})();
