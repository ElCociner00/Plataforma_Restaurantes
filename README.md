# Plataforma Facturas
Este es un proyecto personal.

## Nota sobre cierre de turno (agrupación de datos)

Al usar **Subir cierre** en `cierre_turno`, el payload incluye tres objetos agrupados con todos los valores de las columnas:

- `sistemas`: valores de la columna **Sistema** (`*_sistema`)
- `reales`: valores de la columna **Real** (`*_real`)
- `diferencias`: valores de la columna **Diferencias** (`*_diferencia`)

Además, `propina` y `domicilios` se envían como campos independientes (solo visualización).

Ejemplo de estructura enviada:

```json
{
  "sistemas": {
    "efectivo_sistema": 0,
    "datafono_sistema": 0,
    "rappi_sistema": 0,
    "nequi_sistema": 0,
    "transferencias_sistema": 0,
    "bono_regalo_sistema": 0
  },
  "reales": {
    "efectivo_real": 0,
    "datafono_real": 0,
    "rappi_real": 0,
    "nequi_real": 0,
    "transferencias_real": 0,
    "bono_regalo_real": 0
  },
  "diferencias": {
    "efectivo_diferencia": 0,
    "datafono_diferencia": 0,
    "rappi_diferencia": 0,
    "nequi_diferencia": 0,
    "transferencias_diferencia": 0,
    "bono_de_regalo_diferencia": 0
  },
  "propina": 0,
  "domicilios": 0
}
```
