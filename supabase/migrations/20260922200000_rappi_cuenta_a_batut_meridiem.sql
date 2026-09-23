-- Transferencia controlada de la cuenta Rappi DEV a Batut Le Meridiem.
-- Ejecutar solamente después del respaldo y del inventario previo.
DO $$
DECLARE
  v_origen uuid := 'b76d89f6-43ea-4a2f-a21b-b159f7d7b162';
  v_destino uuid := 'f37f6983-9d59-40c8-b0c1-5949b45743c6';
  v_tabla record;
  v_restantes bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.empresas WHERE id = v_origen)
     OR NOT EXISTS (SELECT 1 FROM public.empresas WHERE id = v_destino) THEN
    RAISE EXCEPTION 'No se encontraron las empresas esperadas';
  END IF;
  IF (SELECT count(*) FROM public.rappi_connections
      WHERE empresa_id = v_origen AND environment = 'DEV') <> 1 THEN
    RAISE EXCEPTION 'La conexión DEV de origen no coincide con el plan';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rappi_connections
      WHERE empresa_id = v_origen AND environment <> 'DEV') THEN
    RAISE EXCEPTION 'El origen tiene otra conexión Rappi que requiere revisión';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rappi_connections
      WHERE empresa_id = v_destino AND environment = 'DEV') THEN
    RAISE EXCEPTION 'El destino ya tiene una conexión Rappi DEV';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.rappi_stores s
    JOIN public.rappi_connections c ON c.id = s.connection_id
    WHERE c.empresa_id = v_origen AND s.rappi_store_id = '900170987'
  ) THEN
    RAISE EXCEPTION 'La tienda Rappi esperada no pertenece al origen';
  END IF;

  -- Las credenciales y tokens se conservan por connection_id; se actualizan
  -- todas las columnas empresa_id de las tablas Rappi existentes.
  FOR v_tabla IN
    SELECT t.table_name
    FROM information_schema.tables t
    JOIN information_schema.columns c
      ON c.table_schema = t.table_schema AND c.table_name = t.table_name
    WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      AND t.table_name LIKE 'rappi\_%' ESCAPE '\'
      AND c.column_name = 'empresa_id'
    ORDER BY t.table_name
  LOOP
    EXECUTE format('UPDATE public.%I SET empresa_id = $1 WHERE empresa_id = $2', v_tabla.table_name)
      USING v_destino, v_origen;
  END LOOP;
  UPDATE public.rappi_stores SET enkrato_empresa_id = v_destino
    WHERE enkrato_empresa_id = v_origen;

  FOR v_tabla IN
    SELECT t.table_name
    FROM information_schema.tables t
    JOIN information_schema.columns c
      ON c.table_schema = t.table_schema AND c.table_name = t.table_name
    WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      AND t.table_name LIKE 'rappi\_%' ESCAPE '\'
      AND c.column_name = 'empresa_id'
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE empresa_id = $1', v_tabla.table_name)
      INTO v_restantes USING v_origen;
    IF v_restantes <> 0 THEN
      RAISE EXCEPTION 'Quedaron % filas de origen en %', v_restantes, v_tabla.table_name;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.rappi_stores WHERE enkrato_empresa_id = v_origen) THEN
    RAISE EXCEPTION 'Quedaron tiendas mapeadas a la empresa anterior';
  END IF;
END;
$$;
