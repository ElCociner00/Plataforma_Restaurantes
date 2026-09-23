-- Contrato del menú aprobado por Rappi y estado de sincronización por tienda.
-- Se conserva intacta la migración inicial del catálogo.

ALTER TABLE public.rappi_menu_categorias
  ADD COLUMN IF NOT EXISTS rappi_category_id text;
CREATE UNIQUE INDEX IF NOT EXISTS rappi_menu_categoria_external_uidx
  ON public.rappi_menu_categorias (empresa_id, rappi_category_id)
  WHERE rappi_category_id IS NOT NULL;

ALTER TABLE public.rappi_menu_productos
  ADD COLUMN IF NOT EXISTS rappi_sku text,
  ADD COLUMN IF NOT EXISTS rappi_image_url text;
CREATE UNIQUE INDEX IF NOT EXISTS rappi_menu_producto_external_sku_uidx
  ON public.rappi_menu_productos (empresa_id, rappi_sku)
  WHERE rappi_sku IS NOT NULL;

ALTER TABLE public.rappi_menu_grupos
  ADD COLUMN IF NOT EXISTS rappi_group_id text;
CREATE UNIQUE INDEX IF NOT EXISTS rappi_menu_grupo_external_uidx
  ON public.rappi_menu_grupos (empresa_id, rappi_group_id)
  WHERE rappi_group_id IS NOT NULL;

ALTER TABLE public.rappi_menu_opciones
  ADD COLUMN IF NOT EXISTS rappi_sku text,
  ADD COLUMN IF NOT EXISTS descripcion text,
  ADD COLUMN IF NOT EXISTS max_limit integer NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX IF NOT EXISTS rappi_menu_opcion_external_sku_uidx
  ON public.rappi_menu_opciones (empresa_id, rappi_sku)
  WHERE rappi_sku IS NOT NULL;
ALTER TABLE public.rappi_menu_opciones
  ADD CONSTRAINT rappi_menu_opciones_max_limit_check CHECK (max_limit >= 1) NOT VALID;

ALTER TABLE public.rappi_menu_producto_grupos
  ADD COLUMN IF NOT EXISTS min_qty integer,
  ADD COLUMN IF NOT EXISTS max_qty integer;
UPDATE public.rappi_menu_producto_grupos enlace
SET min_qty = COALESCE(enlace.min_qty, grupo.min_qty),
    max_qty = COALESCE(enlace.max_qty, grupo.max_qty)
FROM public.rappi_menu_grupos grupo
WHERE enlace.grupo_id = grupo.id
  AND (enlace.min_qty IS NULL OR enlace.max_qty IS NULL);
ALTER TABLE public.rappi_menu_producto_grupos
  ADD CONSTRAINT rappi_menu_producto_grupos_rango_check
  CHECK (min_qty >= 0 AND max_qty >= min_qty) NOT VALID;

CREATE TABLE IF NOT EXISTS public.rappi_menu_estado (
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.rappi_stores(id) ON DELETE CASCADE,
  hash_local text,
  hash_publicado text,
  hash_pendiente text,
  approval_status text NOT NULL DEFAULT 'UNKNOWN'
    CHECK (approval_status IN ('UNKNOWN', 'PENDING', 'APPROVED', 'REJECTED')),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, store_id)
);
ALTER TABLE public.rappi_menu_estado ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rappi_menu_estado FROM anon, authenticated;

-- Una importación reemplaza el catálogo completo dentro de la transacción de
-- esta función. El bloqueo impide que dos importaciones pisen el mismo estado.
CREATE OR REPLACE FUNCTION public.rappi_menu_reemplazar(
  p_empresa_id uuid, p_store_id uuid, p_items jsonb, p_hash text,
  p_descartar_cambios boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_estado public.rappi_menu_estado%ROWTYPE;
  v_item jsonb;
  v_hijo jsonb;
  v_categoria jsonb;
  v_pregunta jsonb;
  v_categoria_id uuid;
  v_producto_id uuid;
  v_grupo_id uuid;
  v_pos integer;
  v_grupo_orden integer;
  v_clave text;
  v_grupos text[];
  v_cantidad integer := 0;
BEGIN
  IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Solo el servicio puede importar menús';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'El menú recibido está vacío o no es una lista';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.rappi_stores s
    JOIN public.rappi_connections c ON c.id = s.connection_id
    WHERE s.id = p_store_id AND s.active AND c.empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'La tienda no pertenece a esta empresa';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_empresa_id::text));
  SELECT * INTO v_estado FROM public.rappi_menu_estado
    WHERE empresa_id = p_empresa_id AND store_id = p_store_id FOR UPDATE;
  IF NOT p_descartar_cambios AND (
    (FOUND AND v_estado.hash_local IS DISTINCT FROM v_estado.hash_publicado)
    OR (NOT FOUND AND EXISTS (
      SELECT 1 FROM public.rappi_menu_productos WHERE empresa_id = p_empresa_id
    ))
  ) THEN
    RETURN jsonb_build_object('estado', 'cambios_locales');
  END IF;

  -- Se conserva la estructura externa: ids, SKU, descripciones y orden.
  DELETE FROM public.rappi_menu_productos WHERE empresa_id = p_empresa_id;
  DELETE FROM public.rappi_menu_grupos WHERE empresa_id = p_empresa_id;
  DELETE FROM public.rappi_menu_categorias WHERE empresa_id = p_empresa_id;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF COALESCE(v_item->>'name', '') = '' OR COALESCE(v_item->>'sku', '') = ''
       OR COALESCE((v_item->>'price')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'El menú de Rappi tiene un producto incompleto';
    END IF;
    v_categoria := COALESCE(v_item->'category', '{}'::jsonb);
    v_clave := COALESCE(NULLIF(v_categoria->>'id', ''), 'SEC-GENERAL');
    SELECT id INTO v_categoria_id FROM public.rappi_menu_categorias
      WHERE empresa_id = p_empresa_id AND rappi_category_id = v_clave;
    IF v_categoria_id IS NULL THEN
      INSERT INTO public.rappi_menu_categorias
        (empresa_id, nombre, orden, rappi_category_id)
      VALUES (p_empresa_id, COALESCE(NULLIF(v_categoria->>'name', ''), 'General'),
        COALESCE((v_categoria->>'sortingPosition')::integer, 1), v_clave)
      RETURNING id INTO v_categoria_id;
    END IF;
    INSERT INTO public.rappi_menu_productos
      (empresa_id, categoria_id, sku, rappi_sku, nombre, descripcion,
       precio, orden, rappi_image_url)
    VALUES (p_empresa_id, v_categoria_id, 'IMP-P-' || gen_random_uuid()::text,
      v_item->>'sku', v_item->>'name', COALESCE(v_item->>'description', ''),
      (v_item->>'price')::numeric,
      COALESCE((v_item->>'sortingPosition')::integer, 1), v_item->>'imageUrl')
    RETURNING id INTO v_producto_id;
    v_cantidad := v_cantidad + 1;
    v_grupos := ARRAY[]::text[];
    v_grupo_orden := 0;
    FOR v_hijo IN SELECT value FROM jsonb_array_elements(COALESCE(v_item->'children', '[]'::jsonb)) LOOP
      v_pregunta := COALESCE(v_hijo->'category', '{}'::jsonb);
      v_clave := COALESCE(NULLIF(v_pregunta->>'id', ''), 'PREGUNTA-' || v_producto_id::text);
      IF NOT (v_clave = ANY(v_grupos)) THEN
        v_grupos := array_append(v_grupos, v_clave);
        v_grupo_orden := v_grupo_orden + 1;
        INSERT INTO public.rappi_menu_grupos
          (empresa_id, nombre, min_qty, max_qty, orden, rappi_group_id)
        VALUES (p_empresa_id, COALESCE(NULLIF(v_pregunta->>'name', ''), 'Opciones'),
          COALESCE((v_pregunta->>'minQty')::integer, 0),
          COALESCE((v_pregunta->>'maxQty')::integer, 1),
          v_grupo_orden, v_clave)
        RETURNING id INTO v_grupo_id;
        INSERT INTO public.rappi_menu_producto_grupos
          (producto_id, grupo_id, orden, min_qty, max_qty)
        VALUES (v_producto_id, v_grupo_id, v_grupo_orden,
          COALESCE((v_pregunta->>'minQty')::integer, 0),
          COALESCE((v_pregunta->>'maxQty')::integer, 1));
      ELSE
        SELECT g.id INTO v_grupo_id FROM public.rappi_menu_grupos g
        JOIN public.rappi_menu_producto_grupos l ON l.grupo_id = g.id
        WHERE l.producto_id = v_producto_id AND g.rappi_group_id = v_clave;
      END IF;
      v_pos := COALESCE((v_hijo->>'sortingPosition')::integer, 1);
      INSERT INTO public.rappi_menu_opciones
        (empresa_id, grupo_id, sku, rappi_sku, nombre, descripcion,
         precio, activo, orden, max_limit)
      VALUES (p_empresa_id, v_grupo_id, 'IMP-O-' || gen_random_uuid()::text,
        v_hijo->>'sku', v_hijo->>'name', v_hijo->>'description',
        COALESCE((v_hijo->>'price')::numeric, 0), true, v_pos,
        COALESCE((v_hijo->>'maxLimit')::integer, 1));
    END LOOP;
  END LOOP;
  INSERT INTO public.rappi_menu_estado
    (empresa_id, store_id, hash_local, hash_publicado, hash_pendiente,
     approval_status, actualizado_en)
  VALUES (p_empresa_id, p_store_id, p_hash, p_hash, NULL, 'UNKNOWN', now())
  ON CONFLICT (empresa_id, store_id) DO UPDATE SET
    hash_local = EXCLUDED.hash_local,
    hash_publicado = EXCLUDED.hash_publicado,
    hash_pendiente = NULL,
    approval_status = EXCLUDED.approval_status,
    actualizado_en = now();
  RETURN jsonb_build_object('estado', 'sincronizado', 'importados', v_cantidad);
END;
$$;
REVOKE ALL ON FUNCTION public.rappi_menu_reemplazar(uuid, uuid, jsonb, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rappi_menu_reemplazar(uuid, uuid, jsonb, text, boolean) TO service_role;
