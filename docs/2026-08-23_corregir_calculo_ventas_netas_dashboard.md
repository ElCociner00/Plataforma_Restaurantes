# Corregir Cálculo de Ventas Netas en Dashboard

**Fecha:** 2026-08-23

## 1. Objetivo de la Petición
El objetivo de este ajuste es corregir un problema matemático crítico en el dashboard de ventas. Anteriormente, las gráficas sumaban la variable `total_global`, la cual incluye el `efectivo_apertura` (la base de caja) y la `propina_global`. Esto generaba una inflación artificial en las cifras reportadas. Se buscaba purgar estos conceptos para mostrar únicamente las ventas netas reales.

## 2. Archivos Implicados y Modificaciones Realizadas
- **Archivos creados:**
  - `supabase/migrations/20260824100000_fase_18_corregir_ventas_netas_dashboard.sql`
- **Tipo de modificación:** 
  Se reemplazaron dos funciones Remote Procedure Call (RPC) en la base de datos de Supabase.
- **Objetivo de la modificación:**
  En lugar de sumar directamente la columna `total_global` de la vista `v_turnos_pivote`, los RPCs ahora calculan al vuelo una variable intermedia llamada `venta_neta`:
  `venta_neta = total_global - apertura_sistema - propina_global`
  Esta variable es la que ahora se suma y agrupa para pintar las gráficas del dashboard, mostrando el valor real sin inflar.

## 3. Notas en Caso de Emergencia para Revertir
Si los valores netos del dashboard no cuadran con las expectativas contables o si este cambio rompe alguna otra visualización imprevista en el dashboard, para revertir al estado anterior:
1. Dirígete a la interfaz SQL de Supabase (o ejecuta el comando desde la terminal local).
2. Ejecuta nuevamente la migración anterior que contenía estos RPCs originales. Puedes encontrar el código exacto de la versión anterior en: `supabase/migrations/20260823220000_fase_17_gastos_en_resumen_y_ventas_por_responsable.sql`. Al correr ese archivo SQL (`CREATE OR REPLACE FUNCTION ...`), se sobreescribirá el código actual y el cálculo volverá a usar `total_global` directamente.
3. Elimina el archivo `20260824100000_fase_18_corregir_ventas_netas_dashboard.sql` si decides revertirlo definitivamente del historial.

## 4. Indicaciones sobre cómo exportar a otro repositorio
Se realizaron cambios masivos, siga esta guía para que el proceso sea exitoso. 
Se crearon los archivos:
- `supabase/migrations/20260824100000_fase_18_corregir_ventas_netas_dashboard.sql`
La función `dashboard_ventas` y `dashboard_ventas_responsable` en el archivo de migración se encargan de agregar las métricas para las gráficas. Verificar si hay archivos que puedan interferir en esta función o si ya existe alguno encargado de hacerlo para aplicar modificaciones en este priorizando funcionalidad máxima. Este repositorio usa Supabase como Backend as a Service; asegúrate de aplicar las migraciones ejecutando el archivo `.sql` en el entorno Supabase de destino (`npx supabase db push` o ejecutarlo directo en el SQL Editor).

## 5. Check de Funcionamiento
- **Gráficas de ventas generales:** FUNCIONAN PERFECTAMENTE (los valores coinciden mucho mejor con los reales reportados en Loggro).
- **Ranking de responsables:** FUNCIONA (se recalcula con base en venta neta).
- **Vista de conciliación de turnos (histórico):** FUNCIONA (No se modificó la vista `v_turnos_pivote`, por ende las tablas de Cierre de Turno siguen mostrando la caja global con la base incluida, lo cual es correcto para control de caja).
