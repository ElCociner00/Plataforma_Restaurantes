// js/module_fix/fetch_override.js
(function() {
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml2Z3p3Z3lqeXFmdW5oZWFlc3h4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4NjAxMDUsImV4cCI6MjA4NTQzNjEwNX0.5Q-MQ7fKfCG9Qo09G_vub3-Rn6FHLJ18sf8eKGndhbI';
    
    const originalFetch = window.fetch;
    
    window.fetch = function(url, options = {}) {
        const urlStr = typeof url === 'string' ? url : url.url;
        
        if (urlStr.includes('supabase.co/rest/v1/')) {
            options.headers = options.headers || {};
            
            // Obtener token del localStorage
            const tokenData = localStorage.getItem('sb-ivgzwgyjyqfunheaesxx-auth-token');
            let token = null;
            
            if (tokenData) {
                try {
                    const parsed = JSON.parse(tokenData);
                    token = parsed.access_token;
                } catch(e) {
                    token = tokenData;
                }
            }
            
            // Forzar headers correctos
            options.headers['apikey'] = SUPABASE_ANON_KEY;
            if (token) {
                options.headers['Authorization'] = `Bearer ${token}`;
            }
            
            console.log('🔧 Fetch interceptado:', urlStr.split('?')[0]);
        }
        
        return originalFetch(url, options);
    };
    
    console.log('✅ Fetch override activado');
})();
