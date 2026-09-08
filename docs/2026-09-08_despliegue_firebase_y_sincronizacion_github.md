# 2026-09-08 — Despliegue de actualización local a Firebase Hosting y preparación CI/CD con GitHub

## 1. Objetivo de la petición
Desplegar a producción en Firebase Hosting (`plataforma-restaurantes-8f561.web.app`) las actualizaciones acumuladas en el entorno local (`Plataforma_Restaurantes-main`), incluyendo la integración Rappi DEV, cierres de turno, propinas, nómina y correcciones, y preparar la sincronización con el repositorio de GitHub (`https://github.com/ElCociner00/Plataforma_Restaurantes`) para automatizar el despliegue continuo mediante GitHub Actions.

---

## 2. Archivos implicados y modificaciones

| Archivo / Recurso | Tipo de modificación | Objetivo / Acción |
|---|---|---|
| `Plataforma_Restaurantes-main/` | Despliegue a Firebase Hosting | Se publicaron los 178 archivos que componen el frontend y configuración estática a producción. |
| `Plataforma_Restaurantes-main/firebase.json` | Verificación de reglas | Se confirmó la exclusión de secretos (`.env`), carpetas de soporte (`.chrome-rappi-visual/**`, `supabase/**`, `docs/**`, `tools/**`) y archivos temporales. |
| `docs/2026-09-08_despliegue_firebase_y_sincronizacion_github.md` | Creación | Documentación técnica del despliegue y guía de sincronización con el repositorio remoto. |

---

## 3. Notas en caso de emergencia para revertir

Si se detecta cualquier anomalía en producción con la nueva versión desplegada:
1. **Rollback instantáneo desde Firebase CLI**:
   Abrir consola de Firebase Hosting:
   `https://console.firebase.google.com/project/plataforma-restaurantes-8f561/hosting/sites/plataforma-restaurantes-8f561`
   Ir al historial de versiones y hacer clic en los tres puntos de la versión anterior (del 28-08-2026) -> **Revertir (Roll back)**. Es inmediato y no requiere tocar código ni volver a desplegar.
2. **Reversión local**:
   Si se requiere volver a desplegar una versión previa desde local:
   ```powershell
   git checkout <hash_commit_anterior>
   npx --yes firebase-tools deploy --only hosting --project plataforma-restaurantes-8f561
   ```

---

## 4. Indicaciones para exportar este cambio masivo a otro repositorio (GitHub)

Para sincronizar la versión local con `https://github.com/ElCociner00/Plataforma_Restaurantes`:
1. El repositorio remoto espera los archivos del frontend en la **raíz**.
2. Crear una rama de sincronización limpia (ej. `feature/actualizacion-completa-local` o actualizar `main`).
3. Copiar la estructura de `Plataforma_Restaurantes-main/` respetando las exclusiones del `.gitignore` (no subir `.chrome-rappi-visual/`, ni credenciales en `.env`, ni flujos n8n con credenciales sensibles).
4. Configurar el workflow de GitHub Actions en `.github/workflows/firebase-hosting-merge.yml`.
5. Asegurar que el secret `FIREBASE_SERVICE_ACCOUNT_PLATAFORMA_RESTAURANTES_8F561` esté configurado en los secrets de GitHub Actions del repositorio.

---

## 5. Check de estado y funcionamiento

- **Despliegue Firebase Hosting**: Funciona perfectamente (178 archivos subidos, HTTP 200 en `https://plataforma-restaurantes-8f561.web.app`).
- **Integración Rappi DEV**: Completa y aislada (webhooks certificados, pruebas aisladas).
- **Cierre de Turno y Propinas**: Funciona con los ajustes de reparto y visualización.
- **Módulo Nómina e Histórico**: Funciona con los últimos parches y vistas renderizadas.
- **Conexión remota a GitHub**: Verificada y con permisos de escritura activos.
- **GitHub Actions CI/CD hacia Firebase**: En fase de configuración.
