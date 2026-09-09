-- Reconstrucción manual: BATUT VIVA · 2026-09-08 · jornada 1 (mañana).
--
-- Este turno nunca llegó a la base. El formulario le decía al operario "Este
-- turno ya fue subido" —porque consultaba la sede equivocada— así que lo daba
-- por hecho y no lo subía. Ver 20260909005543_turno_existente_sin_fallback_silencioso.
--
-- Origen de los datos: cuatro capturas de pantalla (cuadre de caja de Loggro y
-- el formulario), reconstruidas en
-- turnos_pendientes/_reconstruido/VIVA_2026-09-08_turno1.xlsx y verificadas
-- por Santiago antes de aplicar esto.
--
-- Los cuatro cuadres de Loggro reconcilian exactos con estos valores:
--   suma de medios de pago            = 627.320
--   apertura + efectivo - gastos      = 148.300  (caja final)
--   inicial + ventas                  = 778.300
--   inicial + ventas + propinas + dom = 813.820
--
-- Decisiones tomadas con Santiago, para que queden por escrito:
--
--   · Columna "real" = columna "sistema". Las capturas solo traían los valores
--     de Loggro; el responsable confirmó que el turno cuadró, así que las
--     diferencias quedan en cero. Queda dicho en `comentarios`.
--
--   · propina_global = 35.520, el total del turno. Sebastián confirmó que no
--     tuvo apoyos, así que la propina entera le corresponde. Por eso tampoco
--     se inserta nada en apoyos_turno_locales.
--
--   · El gasto de 53.200 va como categoría 'general', no 'insumos' ni
--     'domicilios_operativos'. Santiago no pudo confirmar el desglose (no tiene
--     acceso al Loggro de VIVA) y sospechaba domicilios, pero el propio cuadre
--     de Loggro reporta Domicilios = $0. Meterlo en domicilios_* contradiría
--     ese cero y ensuciaría domicilios_global. 'general' es el cajón honesto
--     para un total sin desglosar.
--
--   · total_global = 627.320, la suma de los seis medios 'sistema' de esta
--     misma fila. Es lo que calcula `totalSistema` en js/cierre_turno.js. En
--     turnos reales ese campo a veces trae además los gastos, pero como no se
--     puede saber cuál de los dos criterios se usó ese día, se deja el valor
--     internamente consistente con las variables que sí se guardan aquí.
--
--   · registrado_por lleva una marca de texto, no un uuid, para que el
--     histórico muestre a las claras que este turno no lo capturó una persona
--     en el formulario. La pantalla ya sabe mostrar texto plano.
--
-- Idempotente: si el turno ya existe, no hace nada.

DO $$
DECLARE
  v_empresa      uuid := '5b5f990a-146f-4623-adfc-78459d11a4a3';  -- BATUT VIVA
  v_responsable  uuid := 'f60aaa09-9ad0-4fbd-b28a-b6e401711312';  -- SEBASTIAN PERTUZ (usuarios_locales.id)
  v_fecha        date := '2026-09-08';
  v_numero       smallint := 1;
  v_insertadas   integer := 0;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.cierres_turno_final_locales
    WHERE empresa_id = v_empresa AND fecha_turno = v_fecha AND numero_turno = v_numero
  ) THEN
    RAISE NOTICE 'El turno ya existe: no se toca nada.';
    RETURN;
  END IF;

  INSERT INTO public.cierres_turno_final_locales (
    empresa_id, fecha_turno, numero_turno, responsable_id,
    variable, categoria, valor,
    hora_llegada, hora_inicio, hora_fin,
    efectivo_apertura, bolsa_global, caja_global,
    domicilios_global, propina_global, total_global,
    registrado_por, comentarios
  )
  SELECT
    v_empresa, v_fecha, v_numero, v_responsable,
    d.variable, d.categoria, d.valor,
    '08:30 AM', '08:53', '14:55',
    186500, 0, 148300,
    0, 35520, 627320,
    'RECONSTRUCCION MANUAL 2026-09-09',
    'Turno reconstruido a partir de imagenes: no quedo guardado por el fallo del aviso "Este turno ya fue subido", '
    'que consultaba la sede equivocada. Los valores "real" se igualan a "sistema" porque el responsable confirmo '
    'que el turno cuadro. El gasto de 53.200 va como general: es un total sin desglose y Loggro reporta domicilios en 0.'
  FROM (VALUES
    ('efectivo',          'sistema', 15000),
    ('efectivo',          'real',    15000),
    ('datafono',          'sistema', 367170),
    ('datafono',          'real',    367170),
    ('rappi',             'sistema', 141900),
    ('rappi',             'real',    141900),
    ('transferencias',    'sistema', 103250),
    ('transferencias',    'real',    103250),
    ('nequi',             'sistema', 0),
    ('nequi',             'real',    0),
    ('bono_regalo',       'sistema', 0),
    ('bono_regalo',       'real',    0),
    ('efectivo_apertura', 'sistema', 186500),
    ('efectivo_apertura', 'real',    186500),
    ('gasto_extra',       'general', 53200)
  ) AS d(variable, categoria, valor);

  GET DIAGNOSTICS v_insertadas = ROW_COUNT;

  IF v_insertadas <> 15 THEN
    RAISE EXCEPTION 'Se esperaban 15 filas y entraron %', v_insertadas;
  END IF;

  RAISE NOTICE 'Turno reconstruido: % filas.', v_insertadas;
END $$;
