# 2026-09-08 — Despliegue de actualización local a Firebase Hosting y preparación CI/CD con GitHub y 1 parche

## 1. Objetivo de la petición
Desplegar a producción en Firebase Hosting (`plataforma-restaurantes-8f561.web.app`) las actualizaciones acumuladas en el entorno local (`Plataforma_Restaurantes-main`), incluyendo la integración Rappi DEV, cierres de turno, propinas, nómina y correcciones, y sincronizar con el repositorio de GitHub (`https://github.com/ElCociner00/Plataforma_Restaurantes`) para automatizar el despliegue continuo mediante GitHub Actions.

---

## 2. Archivos implicados y modificaciones

| Archivo / Recurso | Tipo de modificación | Objetivo / Acción |
|---|---|---|
| `Plataforma_Restaurantes-main/` | Despliegue a Firebase Hosting | Se publicaron los 178 archivos que componen el frontend y configuración estática a producción. |
| `Plataforma_Restaurantes-main/firebase.json` | Verificación de reglas | Se confirmó la exclusión de secretos (`.env`), carpetas de soporte (`.chrome-rappi-visual/**`, `supabase/**`, `docs/**`, `tools/**`) y archivos temporales. |
| `.github/workflows/firebase-hosting-merge.yml` | Creación | Workflow de GitHub Actions para publicar en Firebase Hosting en cada merge a `main`. |
| `.github/workflows/firebase-hosting-pull-request.yml` | Creación | Workflow de GitHub Actions para vistas previas en Pull Requests. |
| `supabase/migrations/20260823110000_fase_6_depurar_duplicados.sql` | Modificación (Parche 1) | Protección de aserciones sobre `zz_backup_20260823_cierres_turno_final` y `zz_backup_20260823_cierres_turno_final_locales` usando `to_regclass` y `EXECUTE` dinámico. |
| `supabase/migrations/20260823141000_fase_7b_corregir_lotes_datos_prueba.sql` | Modificación (Parche 1) | Protección de aserción sobre `zz_backup_20260823_cierres_turno_final` usando `to_regclass` y `EXECUTE` dinámico. |
| `docs/2026-09-08_despliegue_firebase_y_sincronizacion_github_y_1_parche.md` | Creación | Registro de cambios y documentación del Parche 1. |

---

## 3. Notas en caso de emergencia para revertir

Si se detecta cualquier anomalía en producción con la nueva versión desplegada:
1. **Rollback instantáneo desde Firebase CLI / Consola**:
   Abrir consola de Firebase Hosting:
   `https://console.firebase.google.com/project/plataforma-restaurantes-8f561/hosting/sites/plataforma-restaurantes-8f561`
   Ir al historial de versiones y hacer clic en los tres puntos de la versión anterior -> **Revertir (Roll back)**.
2. **Reversión local**:
   ```powershell
   git checkout <hash_commit_anterior>
   npx --yes firebase-tools deploy --only hosting --project plataforma-restaurantes-8f561
   ```
3. **Reversión de migraciones**:
   Las modificaciones del Parche 1 solo envuelven en bloques condicionales `IF to_regclass(...) IS NOT NULL` las comprobaciones de tablas de respaldo temporal, por lo que no alteran la estructura de datos ni los esquemas existentes.

---

## 4. Indicaciones para exportar este cambio masivo a otro repositorio (GitHub)

Para sincronizar la versión local con `https://github.com/ElCociner00/Plataforma_Restaurantes`:
1. Los archivos del frontend residen en la raíz del repositorio.
2. La rama `feature/actualizacion-local` fue enviada al repositorio remoto conectada a `main`.
3. Se generó el Pull Request #309.
4. El secreto `FIREBASE_SERVICE_ACCOUNT_PLATAFORMA_RESTAURANTES_8F561` fue registrado en GitHub Actions Secrets.

---

## 5. Check de estado y funcionamiento

- **Despliegue Firebase Hosting**: Funciona perfectamente (178 archivos subidos, HTTP 200 en `https://plataforma-restaurantes-8f561.web.app`).
- **Integración Rappi DEV**: Completa y aislada (webhooks certificados, pruebas aisladas).
- **Cierre de Turno y Propinas**: Funciona con los ajustes de reparto y visualización.
- **Módulo Nómina e Histórico**: Funciona con los últimos parches y vistas renderizadas.
- **Conexión remota a GitHub**: Verificada y con permisos de escritura activos.
- **GitHub Actions CI/CD hacia Firebase**: Configurado (`.github/workflows/firebase-hosting-merge.yml`).
- **Supabase Preview Branch en PR #309**: Corregido con Parche 1 (tablas `zz_backup` condicionadas dinámicamente).

---

## 6. Parche 1 (2026-09-08) — Compatibilidad de Aserciones para Supabase Branching

- **Motivo**: El bot de Supabase en GitHub falló en la fase de migraciones al intentar validar contra `public.zz_backup_20260823_cierres_turno_final` que no existe en bases de datos efímeras de prueba.
- **Acción**: Se envolvieron las aserciones de `20260823110000_fase_6_depurar_duplicados.sql` (líneas 351-376) y `20260823141000_fase_7b_corregir_lotes_datos_prueba.sql` (líneas 133-146) en verificaciones `to_regclass` con ejecución dinámica `EXECUTE ... INTO`.
- **Resultado**: La rama `feature/actualizacion-local` fue actualizada en GitHub con el commit `0789c45`, permitiendo que el pipeline de Supabase en el PR #309 complete sin errores.
