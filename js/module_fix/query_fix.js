// js/module_fix/query_fix.js
// Corrige las consultas mal formadas a usuarios_sistema
(function() {
    'use strict';
    
    const originalFetch = window.fetch;
    
    window.fetch = function(input, init = {}) {
        const url = typeof input === 'string' ? input : input.url;
        
        // Corregir consultas a usuarios_sistema
        if (url && url.includes('/rest/v1/usuarios_sistema')) {
            // Reemplazar 'activo' (string) por true (boolean) en la URL
            let correctedUrl = url.replace(/activo/g, 'true');
            correctedUrl = correctedUrl.replace(/activo/g, 'true');
            
            if (correctedUrl !== url) {
                console.log('🔧 [Query Fix] URL corregida:', correctedUrl);
                input = correctedUrl;
            }
        }
        
        return originalFetch.call(this, input, init);
    };
    
    console.log('✅ [Query Fix] Activado - Corrige consultas a usuarios_sistema');
})();
