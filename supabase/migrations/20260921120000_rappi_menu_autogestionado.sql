-- Menú de Rappi gestionado desde Enkrato.
--
-- Rappi no tiene "crear un producto": cada envío de menú REEMPLAZA el menú de
-- la tienda, así que el cliente tendría que reenviar el JSON completo por cada
-- cambio. Aquí el menú vive en tablas normales (categorías, productos, grupos
-- de opciones y opciones), el cliente edita de a un producto y Enkrato arma y
-- envía el JSON entero cuando publica.
--
-- Escritura solo por Edge Function (service_role): RLS activo y sin políticas.

CREATE TABLE IF NOT EXISTS public.rappi_menu_categorias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  orden integer NOT NULL DEFAULT 0,
  creado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, nombre)
);

-- Un grupo de opciones es lo que el cliente ve como "Elige tus toppings":
-- min/max deciden si es obligatorio y cuántas opciones admite.
CREATE TABLE IF NOT EXISTS public.rappi_menu_grupos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  min_qty integer NOT NULL DEFAULT 0 CHECK (min_qty >= 0),
  max_qty integer NOT NULL DEFAULT 1 CHECK (max_qty >= 0),
  orden integer NOT NULL DEFAULT 0,
  creado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, nombre)
);

CREATE TABLE IF NOT EXISTS public.rappi_menu_opciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  grupo_id uuid NOT NULL REFERENCES public.rappi_menu_grupos(id) ON DELETE CASCADE,
  sku text NOT NULL,
  nombre text NOT NULL,
  -- Precio que se SUMA al producto. 0 = sin costo.
  precio numeric(12,2) NOT NULL DEFAULT 0 CHECK (precio >= 0),
  activo boolean NOT NULL DEFAULT true,
  orden integer NOT NULL DEFAULT 0,
  creado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, sku)
);

CREATE TABLE IF NOT EXISTS public.rappi_menu_productos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  categoria_id uuid REFERENCES public.rappi_menu_categorias(id) ON DELETE SET NULL,
  sku text NOT NULL,
  nombre text NOT NULL,
  descripcion text NOT NULL DEFAULT '',
  precio numeric(12,2) NOT NULL CHECK (precio > 0),
  -- Ruta dentro del bucket rappi-menu; la URL pública se arma al publicar.
  imagen_path text,
  activo boolean NOT NULL DEFAULT true,
  orden integer NOT NULL DEFAULT 0,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, sku)
);

CREATE TABLE IF NOT EXISTS public.rappi_menu_producto_grupos (
  producto_id uuid NOT NULL REFERENCES public.rappi_menu_productos(id) ON DELETE CASCADE,
  grupo_id uuid NOT NULL REFERENCES public.rappi_menu_grupos(id) ON DELETE CASCADE,
  orden integer NOT NULL DEFAULT 0,
  PRIMARY KEY (producto_id, grupo_id)
);

-- Consecutivo de SKU por empresa: el cliente nunca escribe un SKU.
CREATE TABLE IF NOT EXISTS public.rappi_menu_consecutivos (
  empresa_id uuid PRIMARY KEY REFERENCES public.empresas(id) ON DELETE CASCADE,
  ultimo integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS rappi_menu_productos_empresa_idx
  ON public.rappi_menu_productos (empresa_id, orden, nombre);
CREATE INDEX IF NOT EXISTS rappi_menu_opciones_grupo_idx
  ON public.rappi_menu_opciones (grupo_id, orden);

ALTER TABLE public.rappi_menu_categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rappi_menu_grupos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rappi_menu_opciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rappi_menu_productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rappi_menu_producto_grupos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rappi_menu_consecutivos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rappi_menu_categorias, public.rappi_menu_grupos, public.rappi_menu_opciones,
  public.rappi_menu_productos, public.rappi_menu_producto_grupos, public.rappi_menu_consecutivos
  FROM anon, authenticated;

-- Imágenes de producto: Rappi solo acepta una URL pública en el menú.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('rappi-menu', 'rappi-menu', true, 3145728,
        ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = true, file_size_limit = 3145728,
      allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- Cada empresa escribe solo dentro de su carpeta (primer segmento = empresa_id).
DROP POLICY IF EXISTS rappi_menu_imagenes_escritura ON storage.objects;
CREATE POLICY rappi_menu_imagenes_escritura ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'rappi-menu'
    AND public.app_es_admin()
    AND public.app_puede_ver_empresa(NULLIF((storage.foldername(name))[1], '')::uuid)
  )
  WITH CHECK (
    bucket_id = 'rappi-menu'
    AND public.app_es_admin()
    AND public.app_puede_ver_empresa(NULLIF((storage.foldername(name))[1], '')::uuid)
  );

-- Consecutivo atómico por empresa para los SKU del menú (ENK-P-00001).
CREATE OR REPLACE FUNCTION public.rappi_menu_siguiente_consecutivo(p_empresa_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_siguiente integer;
BEGIN
  INSERT INTO public.rappi_menu_consecutivos (empresa_id, ultimo)
  VALUES (p_empresa_id, 1)
  ON CONFLICT (empresa_id) DO UPDATE
    SET ultimo = public.rappi_menu_consecutivos.ultimo + 1
  RETURNING ultimo INTO v_siguiente;
  RETURN v_siguiente;
END;
$$;

REVOKE ALL ON FUNCTION public.rappi_menu_siguiente_consecutivo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rappi_menu_siguiente_consecutivo(uuid) TO service_role;
