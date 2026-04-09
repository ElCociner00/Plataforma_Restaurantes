# Implementación paso a paso: Nómina + Apoyos + Totalizados de Cierre

Fecha: 2026-04-08

## Objetivo
1. Mostrar totalizados del cierre de turno en la UI actual (sin romper lo existente).
2. Preparar un nuevo módulo de nómina (borrador funcional) para conectar con n8n + Supabase.
3. Crear SQL multitenant (`empresa_id`) para periodos, movimientos, apoyos, turnos programados y desprendibles.
4. Cargar datos de prueba en una empresa test para validar el flujo de punta a punta.

---

## Parte A — Totalizados en Cierre de Turno (ya agregado)

### Qué hace
- Muestra totales visibles en pantalla:
  - Ingresos sistema
  - Ingresos reales
  - Gastos extras
  - Venta del día sin gastos
  - Venta del día con gastos
  - Diferencia general

### De dónde salen los datos
- **Ingresos sistema/reales**: de los campos financieros del cierre (`efectivo`, `datafono`, `rappi`, `nequi`, `transferencias`, `bono_regalo`).
- **Gastos extras**: del listado de gastos consultados.
- **Totales netos/brutos**: cálculo en frontend con base en esas entradas.

---

## Parte B — Nuevo módulo Nómina (borrador)

### Estado actual
Se creó una página borrador en `/nomina/` con:
- checklist técnico,
- payload de ejemplo,
- estado de empresa detectada por sesión,
- base para luego conectar lectura/escritura real.

### Alcance del borrador
- No modifica lógica vigente de cierre/facturación.
- No depende aún de tablas viejas de nómina (porque no existían).
- Deja listo el armazón para conectar workflows n8n.

---

## Parte C — SQL a ejecutar

### 1) Crear estructura
Ejecuta primero:

- `supabase/sql/004_nomina_core.sql`

Qué crea:
- `nomina_reglas_empresa`
- `nomina_periodos`
- `turnos_programados`
- `turno_apoyos`
- `nomina_movimientos`
- `nomina_desprendibles`
- vista `v_nomina_resumen`
- índices y RLS (service_role)

### 2) Insertar datos de prueba
Ejecuta después:

- `supabase/sql/005_nomina_seed_test.sql`

Antes de ejecutar, reemplaza UUIDs de ejemplo en el CTE `vars`:
- `empresa_id` (empresa test real)
- `admin_user_id`
- `empleado_a`
- `empleado_b`

---

## Parte D — Flujo operativo sugerido con n8n

### Workflow 1: `nomina_generar_movimientos`
**Trigger**: manual (botón) o cron quincenal.

**Pasos**:
1. Recibir `empresa_id`, `periodo_id`.
2. Leer `nomina_reglas_empresa`.
3. Leer cierres de turno del periodo (fuente: webhook/tabla que ya persiste cierres).
4. Leer eventos de inventario/faltantes.
5. Leer `turno_apoyos` aprobados.
6. Calcular movimientos por empleado.
7. Upsert a `nomina_movimientos`.
8. Dejar trazabilidad en `metadata`.

### Workflow 2: `nomina_emitir_desprendibles`
**Trigger**: cierre de periodo aprobado.

**Pasos**:
1. Consultar `v_nomina_resumen` por `empresa_id` + `periodo_id`.
2. Construir detalle por empleado.
3. Generar PDF/HTML.
4. Subir archivo a storage.
5. Guardar/actualizar `nomina_desprendibles`.

---

## Parte E — Payload / JSON recomendado

## 1) Payload para crear/actualizar período
```json
{
  "empresa_id": "<uuid>",
  "fecha_inicio": "2026-04-01",
  "fecha_fin": "2026-04-15",
  "corte": "quincenal",
  "creado_por": "<uuid_usuario>"
}
```

## 2) Payload para registrar apoyo
```json
{
  "empresa_id": "<uuid>",
  "fecha": "2026-04-03",
  "usuario_apoyo_id": "<uuid_usuario>",
  "usuario_beneficiado_id": "<uuid_usuario>",
  "minutos_apoyo": 90,
  "tipo_reconocimiento": "bono_por_hora",
  "valor_reconocimiento": 10500,
  "aprobado": true,
  "aprobado_por": "<uuid_supervisor>",
  "observaciones": "Apoyo por pico de demanda"
}
```

## 3) Payload de cálculo de nómina por empleado
```json
{
  "empresa_id": "<uuid>",
  "periodo_id": "<uuid>",
  "usuario_id": "<uuid>",
  "entradas": {
    "salario_base_proporcional": 950000,
    "horas_extras_valor": 120000,
    "propinas_valor": 180000,
    "bonos_apoyo_valor": 50000
  },
  "descuentos": {
    "inventario_valor": 30000,
    "otros_descuentos_valor": 10000
  },
  "reglas": {
    "porcentaje_descuento_fallas": 100,
    "porcentaje_propina_para_nomina": 100,
    "reconocimiento_apoyo_por_hora": 7000
  },
  "resultado": {
    "total_devengado": 1300000,
    "total_deducciones": 40000,
    "total_neto": 1260000
  },
  "fuentes": {
    "cierres_turno": ["<id_1>", "<id_2>"],
    "cierres_inventario": ["<id_a>"],
    "apoyos_turno": ["<id_x>"]
  }
}
```

---

## Parte F — De dónde vendrá cada dato

- `empresa_id`, `usuario_id`, `rol`: sesión autenticada (frontend ya lo resuelve).
- `propinas`, ventas por canal, diferencias: del cierre de turno (payload existente y resumen).
- `faltantes inventario`: módulo de cierre de inventarios / eventos asociados.
- `apoyos`: nueva tabla `turno_apoyos`.
- `horas extra`: futura tabla `turnos_programados` + hora real trabajada.
- reglas de descuentos/reconocimientos: `nomina_reglas_empresa`.

---

## Parte G — Prueba funcional mínima (empresa test)

1. Ejecutar `004_nomina_core.sql`.
2. Ajustar UUIDs en `005_nomina_seed_test.sql`.
3. Ejecutar `005_nomina_seed_test.sql`.
4. Validar:
   - `select * from nomina_periodos where empresa_id = '<empresa_test>';`
   - `select * from turno_apoyos where empresa_id = '<empresa_test>';`
   - `select * from nomina_movimientos where empresa_id = '<empresa_test>';`
   - `select * from v_nomina_resumen where empresa_id = '<empresa_test>';`
   - `select * from nomina_desprendibles where empresa_id = '<empresa_test>';`

Si esos 5 queries devuelven datos consistentes, el esqueleto ya está listo para el workflow final en n8n.
