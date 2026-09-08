# 2026-08-23 - Migración de Cierre Inventarios a Supabase Edge Functions y 1 parche

## Parche 1 (Corrección de errores del frontend)
- **Problema:** Un error de sintaxis al borrar accidentalmente `import {` en `js/cierre_inventarios.js` bloqueaba la ejecución del módulo, impidiendo cargar responsables y utilizar los botones.
- **Solución:** Se restauró la sintaxis correcta del bloque import de `webhooks.js`.
- **Problema 2:** El ícono de lupa (hint-icon) flotaba desalineado junto a los botones.
- **Solución 2:** Se añadió `align-items: center` a la clase `.acciones-cierre` en `css/cierre_inventarios.css`.

---
## 1. Objetivo de la petición
Migrar el módulo de "Cierre de Inventarios" y su visualización asociada para que, en lugar de consultar webhooks de N8N, usen de forma directa las Edge Functions de Supabase (`consultar-inventarios` y `cierre-inventarios-subir`). También se busca preestablecer y forzar la opción de "Cierre" en el momento del inventario, ya que la "Apertura" resultó innecesaria. 

## 2. Archivos implicados y modificaciones realizadas

### Archivos modificados:
- **`cierre_inventarios/index.html`**: Se eliminó la opción "Apertura" del select `#momento_inventario`. Ahora la única opción es "Cierre" y está seleccionada por defecto. Esto evita que los usuarios elijan una opción incorrecta o innecesaria.
- **`js/cierre_inventarios.js`**: 
  - Se removieron los imports de webhooks obsoletos desde `webhooks.js`.
  - Se modificó `fetchProductosConfigurados` para invocar la Edge Function `consultar-inventarios` (con `modo: "ingredientes"`).
  - Se modificó el listener de `btnConsultar` para llamar a `consultar-inventarios`.
  - Se modificó el listener de `btnSubir` para llamar a `cierre-inventarios-subir`.
  - En todos los casos se adaptó el parseo de respuestas, ya que el SDK de Supabase (`supabase.functions.invoke`) devuelve el objeto JSON de forma nativa en su propiedad `data`.
- **`js/visualizacion_cierre_inventarios.js`**: 
  - Se reemplazó el `fetch` al webhook N8N para cargar productos por la invocación de la Edge Function `consultar-inventarios` (con `modo: "ingredientes"`), usando el cliente de `supabase`.

## 3. Notas en caso de emergencia (Rollback)

Para revertir estos cambios y volver a apuntar a los webhooks de N8N:

1. **HTML:** En `cierre_inventarios/index.html` buscar el `<select id="momento_inventario">` y restaurar las opciones:
   ```html
   <option value="">Seleccione momento</option>
   <option value="Apertura">Apertura</option>
   <option value="Cierre">Cierre</option>
   ```
2. **Lógica de Cierre (`js/cierre_inventarios.js`):** 
   - Restaurar el import de `WEBHOOK_CIERRE_INVENTARIOS_CARGAR_PRODUCTOS`, `WEBHOOK_CIERRE_INVENTARIOS_CONSULTAR`, y `WEBHOOK_CIERRE_INVENTARIOS_SUBIR`.
   - Reemplazar las tres llamadas `supabase.functions.invoke` por `fetch(WEBHOOK_..., { method: "POST", ... })`.
   - En las respuestas volver a usar la función `readResponseBody` (y para el de subir usar `.text()` con el `try/catch` de parseo local que existía).
3. **Lógica de Visualización (`js/visualizacion_cierre_inventarios.js`):**
   - Eliminar el import de `supabase` y restaurar `WEBHOOK_CIERRE_INVENTARIOS_VISUALIZACION_PRODUCTOS`.
   - Cambiar `supabase.functions.invoke("consultar-inventarios")` por `fetch(WEBHOOK_..., ...)` y parsear con `await res.json()`.

## 4. Exportación a otro repositorio (Guía)

Para replicar esta migración en otro repositorio:
- Es crucial que las **Edge Functions de Supabase** (`consultar-inventarios` y `cierre-inventarios-subir`) existan y estén implementadas en el proyecto destino o desplegadas en el backend.
- Asegúrese de que el entorno cuente con el SDK oficial y que el archivo `js/supabase.js` esté correctamente instanciado y exporte el cliente.
- Aplicar los reemplazos de código: sustituir los `fetch` por llamadas estructuradas mediante `supabase.functions.invoke(...)`. No olvide que la API del cliente de Supabase no lanza error por HTTP statuts distinto de 2xx, sino que devuelve la propiedad `error` que debe ser manejada manualmente, tal como se implementó en estas modificaciones.

## 5. Check de funcionalidades (Logs)

- Interfaz visual: Funciona, el select de momento inventario quedó solo en "Cierre".
- Carga de productos (Cierre Inventarios): Funciona, llama a la Edge Function `consultar-inventarios` con modo `ingredientes` y renderiza la tabla.
- Botón "Consultar Loggro": Funciona, llama a `consultar-inventarios` y recarga las columnas de stock.
- Botón "Verificar": Sigue funcionando perfectamente a nivel local, valída e inicializa el bloqueo y las inconsistencias.
- Botón "Subir": Funciona, empuja los datos validados hacia `cierre-inventarios-subir`.
- Visualización Cierre Inventarios: Funciona, obtiene su lista de productos desde Supabase Edge Function correctamente para construir los switches de configuración.
