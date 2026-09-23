-- PostgREST expone el rol de la peticion en request.jwt.claims.
-- La variable antigua request.jwt.claim.role no existe en este proyecto.
-- Se usa la funcion ya existente que valida ese rol, sin cambiar la
-- semantica ni los permisos de la importacion transaccional.
DO $patch$
DECLARE
  v_original text;
  v_corregida text;
  v_guardia_antigua constant text :=
    'current_setting(''request.jwt.claim.role'', true) IS DISTINCT FROM ''service_role''';
BEGIN
  v_original := pg_get_functiondef(
    'public.rappi_menu_reemplazar(uuid,uuid,jsonb,text,boolean)'::regprocedure
  );
  IF position(v_guardia_antigua IN v_original) = 0 THEN
    RAISE EXCEPTION 'No se encontro la guardia original de rappi_menu_reemplazar';
  END IF;
  v_corregida := replace(v_original, v_guardia_antigua, 'NOT public.app_es_rol_servicio()');
  EXECUTE v_corregida;
END;
$patch$;
