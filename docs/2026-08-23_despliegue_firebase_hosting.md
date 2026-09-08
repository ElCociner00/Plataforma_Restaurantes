# 2026-08-23 _ Despliegue en Firebase Hosting

## Objetivo
Configurar y desplegar por primera vez todo el repositorio `Plataforma_Restaurantes-main` a Firebase Hosting como parte de la migración del frontend de la plataforma, permitiendo el uso de la aplicación en la nube.

## Archivos Implicados / Creados
- **`firebase.json` (NUEVO):** Se creó para indicar que el directorio público a desplegar es la raíz del repositorio (`.`) y para ignorar archivos innecesarios como `node_modules` o el mismo `firebase.json`.
- **Backend:** Se da por sentada la existencia y funcionamiento de la Edge Function en Supabase (`nomina-consultar`) para los cálculos lógicos.
- **Frontend desplegado:** 376 archivos de la raíz del proyecto.

## Particularidades del Repositorio y Hosting
- El proyecto Firebase asignado e integrado fue `plataforma-restaurantes-8f561`.
- La URL en vivo de producción es: `https://plataforma-restaurantes-8f561.web.app`.
- **Para exportar/desplegar en otro entorno:**
  - Verifica tener `firebase-tools` instalado (`npm install -g firebase-tools`).
  - Ejecuta `firebase login` con la cuenta que administra el proyecto de Firebase.
  - Ejecuta `firebase deploy --only hosting` en la raíz de este directorio para subir actualizaciones visuales futuras. Si se cambia de proyecto, se debe usar `firebase deploy --project [NUEVO_ID] --only hosting`.

## Notas de Reversión (Emergencia)
Si el despliegue genera problemas críticos o se subió una versión defectuosa:
1. Entrar a la Consola de Firebase -> Hosting (`https://console.firebase.google.com/project/plataforma-restaurantes-8f561/hosting/sites`).
2. En el historial de versiones ("Release History"), ubicar la versión inmediatamente anterior a la subida con errores.
3. Hacer clic en los 3 puntos a la derecha de esa versión y seleccionar "Roll back" (Revertir). Esto restaurará los archivos a ese punto de inmediato sin necesidad de tocar código.

## Estado de Modificaciones (Check)
- [x] Despliegue de archivos: funciona perfectamente (376 archivos subidos a la URL de hosting).
- [x] Conexiones: La UI de la URL ahora deberá conectarse directamente con la Edge Function previamente desplegada en Supabase.
