-- Un mismo nombre de grupo puede describir opciones diferentes por producto.
-- Se conserva la migración inicial intacta: esta corrección es aditiva y es
-- segura tanto si el catálogo ya existe como si aún está vacío.
ALTER TABLE public.rappi_menu_grupos
  DROP CONSTRAINT IF EXISTS rappi_menu_grupos_empresa_id_nombre_key;
