# 2026-08-23 - Adición de botones de selección masiva en configuraciones de visualización

## 1. Objetivo de la petición
El objetivo principal es mejorar la experiencia de usuario (UX) en los módulos de configuración de visualización. Anteriormente, si un usuario quería ver solo 2 opciones, tenía que desactivar manualmente todas las demás. Ahora, con los botones "Activar todas" y "Desactivar todas", los usuarios pueden gestionar la visibilidad de los elementos (columnas, filas, productos, gastos extras) de forma masiva y rápida.

## 2. Archivos implicados y modificaciones realizadas

### Archivos creados:
- **`js/bulk_actions.js`**: Se creó este nuevo archivo para centralizar la lógica de selección masiva (`initBulkActions`). Su objetivo explícito es buscar los contenedores `.bulk-actions`, vincular los botones "Activar todas" y "Desactivar todas" a los checkboxes del panel destino (`data-target`), cambiar su estado de manera masiva y emitir el evento `change` para que el sistema existente de guardado en localStorage o base de datos capture el cambio.

### Archivos modificados:
- **`css/main.css`**: Se añadieron las clases `.bulk-actions` y su respectivo estilizado para los botones. Su objetivo es mantener el diseño alineado a la plataforma y presentarlos alineados a la derecha sobre cada panel, de forma sutil.
- **`configuracion/visualizacion_cierre_turno.html`** y **`js/visualizacion_cierre_turno.js`**: Se añadió el contenedor `.bulk-actions` antes de los paneles (principal y de extras) y se importó/ejecutó `initBulkActions()`.
- **`configuracion/visualizacion_cierre_inventarios.html`** y **`js/visualizacion_cierre_inventarios.js`**: Se añadió el contenedor para seleccionar todos los productos de inventario.
- **`configuracion/visualizacion_cierre_inventarios_historico.html`** y **`js/visualizacion_cierre_inventarios_historico.js`**: Se añadieron botones para cada panel (Columnas generales, detalle, productos y filas) y se ejecutó la lógica.
- **`configuracion/visualizacion_cierre_turno_historico.html`** y **`js/visualizacion_cierre_turno_historico.js`**: Se añadieron botones en cada sección del panel del histórico de turno.

## 3. Notas en caso de emergencia (Rollback)

Si se necesita revertir este cambio y volver al estado anterior, realizar lo siguiente:

1. **Borrar archivo:** Eliminar completamente `js/bulk_actions.js`.
2. **Revertir HTML:** En los 4 archivos `visualizacion_*.html` ubicados en `configuracion/`, buscar y borrar todos los bloques HTML idénticos a este:
   ```html
   <div class="bulk-actions" data-target="[nombre_del_panel]">
     <button type="button" class="btn-bulk-activar">Activar todas</button>
     <button type="button" class="btn-bulk-desactivar">Desactivar todas</button>
   </div>
   ```
   *En `visualizacion_cierre_turno.html` también debes remover el `id="panel-main"` del panel de métodos de pago.*
3. **Revertir JS:** En los 4 archivos `.js` correspondientes en la carpeta `js/`:
   - Borrar el import superior: `import { initBulkActions } from "./bulk_actions.js";` (o `../js/bulk_actions.js`).
   - Borrar la ejecución al final del archivo: `initBulkActions();`.
4. **Revertir CSS:** Abrir `css/main.css` e ir a las líneas finales y eliminar el bloque delimitado por el comentario `/* ========================= BULK ACTIONS (VISUALIZACIONES) ========================= */`.

## 4. Exportación a otro repositorio (Guía)

Para aplicar este parche de selección masiva a otro repositorio o entorno, siga estos pasos:
- **Copiar el núcleo:** Llevar el archivo `js/bulk_actions.js` al nuevo entorno.
- **Llevar estilos:** Copiar el bloque `.bulk-actions` del `main.css`.
- **Particularidad:** La función `initBulkActions()` depende enteramente del DOM, y funciona a partir de un contenedor con la clase `.bulk-actions` que apunte al `id` del panel vía `data-target="IdDelPanel"`. Cualquier panel del nuevo repositorio que aloje `<input type="checkbox">` puede adoptar esta funcionalidad solo pegando el bloque de botones HTML antes del panel e inicializando la función. El evento que emite (`change`) es nativo, por lo que integrará bien siempre y cuando el repositorio escuche el cambio a nivel de DOM.

## 5. Check de funcionalidades (Logs)

- Visualización cierre turno: Funciona perfectamente, botones operan en estáticos y extras dinámicos.
- Visualización cierre inventarios: Funciona perfectamente, selecciona/deselecciona productos generados.
- Visualización histórico cierre inventarios: Funciona perfectamente en sus 4 categorías.
- Visualización histórico cierre turno: Funciona perfectamente en sus 3 categorías.
- Rendimiento general y guardado: Funciona, el disparo del evento `change` activa correctamente el hook de guardado preexistente de cada módulo en LocalStorage.
