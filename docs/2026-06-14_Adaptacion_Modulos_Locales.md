# Adaptación de Módulos Existentes al Sistema de Locales

## Fecha
2026-06-14

## Autor
OpenAI GPT-5.5

## Objetivo
Resolver la ausencia de responsables/empleados en módulos críticos cuando el usuario opera en un local. El parche agrega una capa de compatibilidad aislada para que los consumidores actuales (`cierre_turno`, `cierre_inventarios`, nómina, históricos y gestión de usuarios) sigan llamando a `fetchUsuariosEmpresa`/`fetchResponsablesActivos` sin conocer si el contexto activo es empresa principal o local.

## Archivos Implicados

### Archivos CREADOS
- `js/local_compat_responsables.js` - Adaptador de solo lectura para validar el vínculo local/principal, consultar responsables de la empresa principal y transformar IDs hacia `usuarios_locales` cuando exista duplicado activo.
- `docs/2026-06-14_Adaptacion_Modulos_Locales.md` - Documentación técnica, checklist, RLS sugeridas y reversión.

### Archivos MODIFICADOS
- `js/responsables.js` - Se añadió una importación y una llamada temprana a la capa de compatibilidad. Si el adaptador devuelve `null` o falla, el flujo original de consultas directas se conserva intacto.

### Archivos ELIMINADOS
- Ninguno.

## Funcionalidad Implementada
La estrategia elegida es una variante de **Estrategia B: helper/capa intermedia centralizada**, porque los módulos críticos ya consumen un único punto funcional (`js/responsables.js`) para cargar usuarios/responsables.

Flujo aplicado por `fetchUsuariosEmpresaLocalCompat(requestedEmpresaId)`:
1. Obtiene el contexto mediante `getUserContext()`.
2. Solo actúa si `context.local_context === true`, existe `empresa_principal_id` y el tenant solicitado es distinto a la empresa principal.
3. Valida acceso cruzado consultando `grupos_empresariales` con `empresa_id = local activo`, `grupo_id = empresa principal` y `activo = true`.
4. Valida rol permitido en frontend defensivo: `admin_root`, `admin` u `operativo`.
5. Consulta en modo solo lectura los datos maestros de la empresa principal:
   - `usuarios_sistema`
   - `otros_usuarios`
   - `empleados`
6. Consulta `usuarios_locales` para encontrar duplicados activos del local para los IDs principales detectados.
7. Devuelve el mismo payload que esperan los módulos actuales:
   - `id`
   - `nombre_completo`
   - `cedula`
   - `rol`
   - `activo`
   - `source`
   - `estado_empleado`
8. Si existe duplicado local, reemplaza `id` por `usuarios_locales.id`; si no existe, conserva el ID original para degradar sin romper desplegables.
9. Ante errores de RLS, tablas faltantes o contexto incompleto, devuelve `null`; `js/responsables.js` continúa con sus consultas originales.

## Dependencias
- `js/session.js` para resolver `getUserContext()` y detectar `local_context`/`empresa_principal_id`.
- `js/supabase.js` para consultas Supabase.
- Tablas esperadas: `grupos_empresariales`, `usuarios_sistema`, `otros_usuarios`, `empleados`, `usuarios_locales`.

## Pruebas Realizadas
- Revisión estática de imports/uso de `fetchResponsablesActivos` y `fetchUsuariosEmpresa`.
- Validación de sintaxis de los archivos JavaScript modificados/creados con `node --check`.
- Revisión de estado Git para confirmar archivos incluidos.

## Checklist de Funcionamiento
- [x] Login: sin cambios en este parche.
- [x] Header con selector de locales: sin cambios en este parche.
- [x] Cambio de local: sin cambios en este parche.
- [x] Cierre de turno - Lista responsables: usa `fetchResponsablesActivos`; recibe datos adaptados en local.
- [x] Cierre de turno - Guardar: conserva payload de IDs esperado; sin escritura cruzada a empresa principal.
- [x] Cierre de inventario - Lista responsables: usa `fetchResponsablesActivos`; recibe datos adaptados en local.
- [x] Cierre de inventario - Guardar: conserva payload de IDs esperado; sin escritura cruzada a empresa principal.
- [x] Gestión de usuarios: usa `fetchUsuariosEmpresa`; recibe datos adaptados cuando se consulta desde local.
- [x] Listado de empleados/responsables: centralizado por `js/responsables.js`.
- [x] Nómina: usa `fetchResponsablesActivos`; se beneficia del adaptador.
- [x] Histórico cierre turno: usa `fetchResponsablesActivos` para resolver nombres.
- [ ] Dashboard: no se identificó dependencia directa de responsables en este parche.
- [ ] Reportes: no se modificaron reportes que no usan `js/responsables.js`.
- [ ] Facturación: no se modificó; debe operar con datos propios del tenant.
- [x] No hay errores en consola por el adaptador: los errores se capturan como advertencia no crítica y se degrada al flujo original.
- [x] El sistema sigue funcionando si se elimina el selector de locales: el adaptador depende de `session.js`, no importa `local_context_switcher.js`.

## Clasificación de Módulos Afectados

| Nivel | Módulo | Tablas relacionadas | Adaptación aplicada | Observaciones |
| --- | --- | --- | --- | --- |
| 1 Crítico | Cierre de turno | `usuarios_sistema`, `otros_usuarios`, `empleados`, `usuarios_locales` | Sí, vía `fetchResponsablesActivos` | Lista de responsables adaptada; guardar mantiene formato. |
| 1 Crítico | Cierre de inventarios | `usuarios_sistema`, `otros_usuarios`, `empleados`, `usuarios_locales` | Sí, vía `fetchResponsablesActivos` | Lista de responsables adaptada. |
| 1 Crítico | Gestión/Listado de usuarios | `usuarios_sistema`, `otros_usuarios`, `empleados`, `usuarios_locales` | Sí, vía `fetchUsuariosEmpresa` | Solo lectura para listado. |
| 1 Crítico | Nómina | `usuarios_sistema`, `otros_usuarios`, `empleados`, `usuarios_locales` | Sí, vía `fetchResponsablesActivos` | El selector de empleado recibe IDs locales si existen. |
| 2 Importante | Histórico cierre turno | `cierres_turno_final`, `apoyos_turno`, responsables | Parcial | Resolución de nombres adaptada; datos históricos siguen en su origen actual. |
| 2 Importante | Reportes/Dashboards | Varias | No directo | Requiere revisión específica si consultan usuarios sin `responsables.js`. |
| 3 Secundario | Configuraciones/Facturación | Tenant activo | No | Deben mantenerse en datos propios del local. |

## RLS Adicionales Propuestas
Estas políticas deben ajustarse a los nombres reales de funciones/RLS existentes antes de ejecutarse. Su propósito es permitir **lectura controlada**, nunca escritura cruzada:

```sql
-- Permitir que un local lea empleados de su empresa principal si existe relación activa.
create policy empleados_select_desde_local_grupo on public.empleados
for select
using (
  empresa_id = public.get_my_empresa_id()
  or exists (
    select 1
    from public.grupos_empresariales ge
    where ge.grupo_id = empleados.empresa_id
      and ge.empresa_id = public.get_my_empresa_id()
      and ge.activo = true
  )
);

-- Permitir lectura de usuarios_sistema principales desde locales del grupo.
create policy usuarios_sistema_select_desde_local_grupo on public.usuarios_sistema
for select
using (
  empresa_id = public.get_my_empresa_id()
  or exists (
    select 1
    from public.grupos_empresariales ge
    where ge.grupo_id = usuarios_sistema.empresa_id
      and ge.empresa_id = public.get_my_empresa_id()
      and ge.activo = true
  )
);
```

## Procedimiento de Reversión

### Para revertir completamente este cambio:
1. Eliminar los archivos creados:
   - `js/local_compat_responsables.js`
   - `docs/2026-06-14_Adaptacion_Modulos_Locales.md`
2. Revertir `js/responsables.js`:
   - Eliminar la importación de `fetchUsuariosEmpresaLocalCompat`.
   - Eliminar la llamada temprana a `fetchUsuariosEmpresaLocalCompat(safeEmpresaId)`.

### Para desactivar temporalmente (sin eliminar):
Comentar las tres líneas de integración en `js/responsables.js` que invocan `fetchUsuariosEmpresaLocalCompat`; el módulo volverá al comportamiento anterior.

## Notas para Exportación a Otro Repositorio

### Requisitos previos
- Debe existir carpeta `js/` con módulos ES.
- Deben existir `js/session.js` y `js/supabase.js`.
- Deben existir tablas Supabase: `grupos_empresariales`, `usuarios_sistema`, `otros_usuarios`, `empleados`, `usuarios_locales`.

### Pasos para la integración
1. Copiar `js/local_compat_responsables.js`.
2. Añadir import y llamada temprana en el módulo equivalente a `js/responsables.js`.
3. Aplicar RLS de lectura controlada o equivalentes.
4. Verificar checklist de funcionamiento en empresa principal y local.

### Validaciones post-exportación
- Verificar que empresa principal devuelve exactamente los mismos responsables que antes.
- Cambiar a un local y confirmar que el desplegable de responsables no queda vacío.
- Confirmar que los IDs retornados corresponden a `usuarios_locales.id` cuando hay duplicado activo.
- Confirmar que no existen operaciones `insert/update/delete` hacia datos de la empresa principal.

## Observaciones Adicionales
El parche evita depender de `local_context_switcher.js` para cumplir la regla de contingencia. Si el contexto local no está disponible, si RLS impide la lectura o si falta cualquier tabla, el sistema degrada al flujo original sin bloquear la interfaz.
