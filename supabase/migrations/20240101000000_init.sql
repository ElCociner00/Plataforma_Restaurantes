


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."actualizar_estado_resuelto_automatico"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  UPDATE public.facturas_empresas_inconvenientes i
  SET "Estado_Resuelto" = TRUE
  WHERE 
    i.empresa_id = NEW.empresa_id
    AND i.uuid_factura = NEW.uuid_factura
    AND i."NIT_CC" = NEW."NIT_CC"
    AND i."Prefijo Factura" = NEW."Prefijo Factura"
    AND i."Consecutivo Factura" = NEW."Consecutivo Factura"
    AND i."Fecha Factura" = NEW."Fecha Factura"
    AND i."Proveedor" = NEW."Proveedor"
    AND i."Producto" = NEW."Producto"
    AND i."Subtotal" = NEW."Subtotal"
    AND i."Valor Débito" = NEW."Valor Débito"
    AND i."Valor Crédito" = NEW."Valor Crédito";
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."actualizar_estado_resuelto_automatico"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."actualizar_vista_automaticamente"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    -- Actualizar la vista cuando haya cambios en la tabla
    PERFORM generar_vista_cierres_dinamica();
    RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."actualizar_vista_automaticamente"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."archivar_ciclo_antes_actualizar"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    -- Solo archivar si la fecha_corte cambió (nuevo mes)
    IF OLD.fecha_corte IS DISTINCT FROM NEW.fecha_corte THEN
        INSERT INTO historial_facturacion (
            empresa_id,
            prefijo_factura,
            consecutivo_usado,
            plan,
            valor_plan,
            deuda,
            fecha_corte,
            fecha_suspension,
            periodo
        ) VALUES (
            OLD.empresa_id,
            OLD.prefijo_factura,
            OLD.consecutivo_actual,
            OLD.plan,
            OLD.valor_plan,
            OLD.deuda,
            OLD.fecha_corte,
            OLD.fecha_suspension,
            date_trunc('month', OLD.fecha_corte)::DATE
        );
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."archivar_ciclo_antes_actualizar"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."billing_daily_enforcer"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_today date := (now() at time zone 'America/Bogota')::date;
  v_periodo text := to_char(v_today, 'YYYY-MM');
  v_banner_days integer := 10;
  v_grace_days integer := 5;
  v_past_due integer := 0;
  v_suspended integer := 0;
begin
  update public.billing_cycles
  set
    banner_activo = false,
    dias_restantes_cache = null,
    suspension_aplicada = false,
    updated_at = now()
  where periodo = v_periodo
    and estado = 'paid_verified'
    and (banner_activo = true or suspension_aplicada = true or dias_restantes_cache is not null);

  with c as (
    select
      id,
      empresa_id,
      (fecha_vencimiento - v_today) as dias_restantes
    from public.billing_cycles
    where periodo = v_periodo
      and estado not in ('paid_verified')
      and not (
        manual_override = true
        and (manual_override_until is null or manual_override_until >= now())
      )
  )
  update public.billing_cycles bc
  set
    dias_restantes_cache = c.dias_restantes,
    banner_activo = case when c.dias_restantes <= v_banner_days then true else false end,
    estado = case
      when c.dias_restantes < 0 and c.dias_restantes > -v_grace_days then 'past_due'
      when c.dias_restantes <= -v_grace_days then 'suspended'
      else bc.estado
    end,
    suspension_aplicada = case when c.dias_restantes <= -v_grace_days then true else false end,
    updated_at = now()
  from c
  where bc.id = c.id;

  update public.empresas e
  set
    plan_actual = 'free',
    activa = false,
    activo = false,
    mostrar_anuncio_impago = true
  from public.billing_cycles bc
  where bc.empresa_id = e.id
    and bc.periodo = v_periodo
    and bc.suspension_aplicada = true;

  update public.empresas e
  set mostrar_anuncio_impago = true
  from public.billing_cycles bc
  where bc.empresa_id = e.id
    and bc.periodo = v_periodo
    and bc.banner_activo = true
    and bc.suspension_aplicada = false;

  update public.empresas e
  set mostrar_anuncio_impago = false
  from public.billing_cycles bc
  where bc.empresa_id = e.id
    and bc.periodo = v_periodo
    and bc.banner_activo = false
    and bc.suspension_aplicada = false
    and bc.estado in ('paid_verified', 'pending_payment', 'proof_submitted');

  select count(*) into v_past_due
  from public.billing_cycles
  where periodo = v_periodo and estado = 'past_due';

  select count(*) into v_suspended
  from public.billing_cycles
  where periodo = v_periodo and estado = 'suspended';

  return jsonb_build_object(
    'ok', true,
    'periodo', v_periodo,
    'past_due', v_past_due,
    'suspended', v_suspended
  );
end;
$$;


ALTER FUNCTION "public"."billing_daily_enforcer"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_billing_cycles_for_period"("p_periodo" "text" DEFAULT NULL::"text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_periodo text := coalesce(p_periodo, to_char(now(), 'YYYY-MM'));
  v_month_start date := to_date(v_periodo || '-01', 'YYYY-MM-DD');
  v_venc date := (v_month_start + interval '14 days')::date;
  v_inserted integer;
  v_auth_uid uuid := auth.uid();
begin
  if v_auth_uid is not null then
    if not public.is_super_admin() then
      raise exception 'forbidden';
    end if;
  end if;

  insert into public.billing_cycles (
    empresa_id,
    periodo,
    fecha_emision,
    fecha_vencimiento,
    monto,
    moneda,
    estado,
    banner_activo,
    suspension_aplicada,
    manual_override,
    created_at,
    updated_at
  )
  select
    e.id,
    v_periodo,
    v_month_start,
    v_venc,
    p.valor_plan,
    'COP',
    case when p.valor_plan > 0 then 'pending_payment' else 'paid_verified' end,
    false,
    false,
    false,
    now(),
    now()
  from public.empresas e
  cross join lateral (
    select public.plan_price(lower(coalesce(e.plan_actual, e.plan, 'free'))) as valor_plan
  ) p
  where not exists (
    select 1
    from public.billing_cycles bc
    where bc.empresa_id = e.id and bc.periodo = v_periodo
  );

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;


ALTER FUNCTION "public"."create_billing_cycles_for_period"("p_periodo" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_empresa_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(
    (
      select us.empresa_id
      from public.usuarios_sistema us
      where us.id = auth.uid()
        and coalesce(us.activo, true) = true
      limit 1
    ),
    (
      select ou.empresa_id
      from public.otros_usuarios ou
      where ou.id = auth.uid()
        and lower(coalesce(ou.estado, 'activo')) <> 'inactivo'
      limit 1
    )
  );
$$;


ALTER FUNCTION "public"."current_empresa_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."empresa_es_solo_lectura"("p_empresa_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  select coalesce(lower(nullif(e.plan_actual, '')), lower(nullif(e.plan, '')), 'free') = 'free'
  from public.empresas e
  where e.id = p_empresa_id
$$;


ALTER FUNCTION "public"."empresa_es_solo_lectura"("p_empresa_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."empresa_puede_operar"("p_empresa_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_empresa record;
begin
  select * into v_empresa
  from public.empresas
  where id = p_empresa_id;

  if v_empresa is null or coalesce(v_empresa.activo, false) = false then
    return false;
  end if;

  return true;
end;
$$;


ALTER FUNCTION "public"."empresa_puede_operar"("p_empresa_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."empresas_create_billing_cycle"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    next_consecutivo BIGINT;
BEGIN
    -- Obtener el máximo consecutivo existente para prefijo AX
    SELECT COALESCE(MAX(consecutivo_actual), 0) + 1 INTO next_consecutivo
    FROM facturacion
    WHERE lower(trim(both from prefijo_factura)) = 'ax';
    
    INSERT INTO facturacion (
        empresa_id,
        prefijo_factura,
        consecutivo_actual,
        plan,
        valor_plan,
        deuda,
        fecha_corte,
        fecha_suspension
    ) VALUES (
        NEW.id,
        'AX',
        next_consecutivo,
        COALESCE(NEW.plan_actual, 'free'),
        0,
        0,
        (date_trunc('month', now())::date + 14),
        (date_trunc('month', now())::date + 24)
    );
    
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."empresas_create_billing_cycle"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_billing_cycle"("p_empresa_id" "uuid", "p_periodo" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_periodo text := coalesce(p_periodo, to_char(now(), 'YYYY-MM'));
  v_month_start date := to_date(v_periodo || '-01', 'YYYY-MM-DD');
  v_venc date := (v_month_start + interval '14 days')::date;
  v_plan text;
  v_monto numeric;
  v_estado text;
  v_exists boolean;
  v_auth_uid uuid := auth.uid();
begin
  if v_auth_uid is not null then
    if not public.is_super_admin() and p_empresa_id <> public.current_empresa_id() then
      raise exception 'forbidden';
    end if;
  end if;

  select lower(coalesce(plan_actual, plan, 'free'))
    into v_plan
  from public.empresas
  where id = p_empresa_id;

  if v_plan is null then
    raise exception 'empresa no encontrada';
  end if;

  v_monto := public.plan_price(v_plan);
  v_estado := case when v_monto > 0 then 'pending_payment' else 'paid_verified' end;

  select exists(
    select 1 from public.billing_cycles
    where empresa_id = p_empresa_id and periodo = v_periodo
  ) into v_exists;

  if v_exists then
    return jsonb_build_object('ok', true, 'created', false, 'empresa_id', p_empresa_id, 'periodo', v_periodo);
  end if;

  insert into public.billing_cycles (
    empresa_id,
    periodo,
    fecha_emision,
    fecha_vencimiento,
    monto,
    moneda,
    estado,
    banner_activo,
    suspension_aplicada,
    manual_override,
    created_at,
    updated_at
  ) values (
    p_empresa_id,
    v_periodo,
    v_month_start,
    v_venc,
    v_monto,
    'COP',
    v_estado,
    false,
    false,
    false,
    now(),
    now()
  );

  return jsonb_build_object('ok', true, 'created', true, 'empresa_id', p_empresa_id, 'periodo', v_periodo);
end;
$$;


ALTER FUNCTION "public"."ensure_billing_cycle"("p_empresa_id" "uuid", "p_periodo" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generar_vista_cierres_dinamica"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    column_defs TEXT;
    select_cols TEXT;
    create_view_sql TEXT;
    col_record RECORD;
    all_columns TEXT[];
BEGIN
    -- Obtener todas las columnas únicas de todos los JSON
    all_columns := ARRAY[
        'id UUID',
        'empresa_id UUID',
        'fecha_turno DATE',
        'responsable_id UUID',
        'comentarios TEXT',
        'created_at TIMESTAMP',
        'propina NUMERIC',
        'domicilios NUMERIC',
        'total NUMERIC',
        'hora_inicio TEXT',
        'hora_fin TEXT',
        'efectivo_apertura NUMERIC'
    ];
    
    -- Agregar columnas del sistema
    FOR col_record IN 
        SELECT DISTINCT 'sistema_' || key as col_name
        FROM cierres_turno, jsonb_object_keys(datos_sistema::jsonb) as key
        WHERE key NOT IN ('idx')  -- Excluir campos no deseados
    LOOP
        all_columns := array_append(all_columns, col_record.col_name || ' NUMERIC');
    END LOOP;
    
    -- Agregar columnas reales
    FOR col_record IN 
        SELECT DISTINCT 'real_' || key as col_name
        FROM cierres_turno, jsonb_object_keys(datos_reales::jsonb) as key
        WHERE key NOT IN ('idx')
    LOOP
        all_columns := array_append(all_columns, col_record.col_name || ' NUMERIC');
    END LOOP;
    
    -- Agregar columnas de diferencias
    FOR col_record IN 
        SELECT DISTINCT 'diff_' || key as col_name
        FROM cierres_turno, jsonb_object_keys(diferencias::jsonb) as key
        WHERE key NOT IN ('idx')
    LOOP
        all_columns := array_append(all_columns, col_record.col_name || ' NUMERIC');
    END LOOP;
    
    -- Construir definición de columnas
    column_defs := array_to_string(all_columns, E',\n    ');
    
    -- Construir SELECT dinámico
    select_cols := '
        id,
        empresa_id,
        fecha_turno,
        responsable_id,
        comentarios,
        created_at,
        propina::NUMERIC,
        domicilios::NUMERIC,
        total::NUMERIC,
        hora_inicio,
        hora_fin,
        efectivo_apertura::NUMERIC';
    
    -- Agregar columnas del sistema
    FOR col_record IN 
        SELECT DISTINCT key, 'sistema_' || key as alias_name
        FROM cierres_turno, jsonb_object_keys(datos_sistema::jsonb) as key
        WHERE key NOT IN ('idx')
    LOOP
        select_cols := select_cols || ',
        (datos_sistema->>''' || col_record.key || ''')::NUMERIC AS ' || col_record.alias_name;
    END LOOP;
    
    -- Agregar columnas reales
    FOR col_record IN 
        SELECT DISTINCT key, 'real_' || key as alias_name
        FROM cierres_turno, jsonb_object_keys(datos_reales::jsonb) as key
        WHERE key NOT IN ('idx')
    LOOP
        select_cols := select_cols || ',
        (datos_reales->>''' || col_record.key || ''')::NUMERIC AS ' || col_record.alias_name;
    END LOOP;
    
    -- Agregar columnas de diferencias
    FOR col_record IN 
        SELECT DISTINCT key, 'diff_' || key as alias_name
        FROM cierres_turno, jsonb_object_keys(diferencias::jsonb) as key
        WHERE key NOT IN ('idx')
    LOOP
        select_cols := select_cols || ',
        (diferencias->>''' || col_record.key || ''')::NUMERIC AS ' || col_record.alias_name;
    END LOOP;
    
    -- Eliminar vista si existe
    DROP VIEW IF EXISTS cierres_turno_vw_dinamica CASCADE;
    
    -- Crear la vista dinámica
    create_view_sql := '
CREATE OR REPLACE VIEW cierres_turno_vw_dinamica AS
SELECT ' || select_cols || '
FROM cierres_turno';
    
    EXECUTE create_view_sql;
    
    RAISE NOTICE 'Vista dinámica creada exitosamente con % columnas', array_length(all_columns, 1);
END;
$$;


ALTER FUNCTION "public"."generar_vista_cierres_dinamica"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_empresas_del_grupo"() RETURNS SETOF "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_empresa_id UUID;
  v_grupo_id UUID;
BEGIN
  v_empresa_id := get_my_empresa_id();
  
  IF v_empresa_id IS NULL THEN
    RETURN;
  END IF;
  
  SELECT grupo_id INTO v_grupo_id
  FROM grupos_empresariales
  WHERE empresa_id = v_empresa_id
  LIMIT 1;
  
  IF v_grupo_id IS NULL THEN
    RETURN NEXT v_empresa_id;
    RETURN;
  END IF;
  
  RETURN QUERY
  SELECT ge.empresa_id 
  FROM grupos_empresariales ge
  WHERE ge.grupo_id = v_grupo_id
  UNION
  SELECT v_empresa_id;
END;
$$;


ALTER FUNCTION "public"."get_empresas_del_grupo"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_context"() RETURNS TABLE("empresa_id" "uuid", "rol" "text", "plan" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT 
    u.empresa_id,
    u.rol,
    COALESCE(e.plan, 'free') as plan
  FROM public.usuarios_sistema u
  LEFT JOIN public.empresas e ON e.id = u.empresa_id
  WHERE u.id = auth.uid()
  LIMIT 1;
$$;


ALTER FUNCTION "public"."get_my_context"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_empresa_id"() RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    empresa_uuid UUID;
BEGIN
    SELECT empresa_id INTO empresa_uuid
    FROM public.usuarios_sistema 
    WHERE id = auth.uid();
    
    RETURN empresa_uuid;
END;
$$;


ALTER FUNCTION "public"."get_my_empresa_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_super_admin"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 
        FROM public.system_users 
        WHERE id = auth.uid()
    );
END;
$$;


ALTER FUNCTION "public"."is_super_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."obtener_estructura_vista"() RETURNS TABLE("column_name" "text", "data_type" "text")
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        a.attname as column_name,
        pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type
    FROM 
        pg_catalog.pg_attribute a
    WHERE 
        a.attnum > 0 
        AND NOT a.attisdropped
        AND a.attrelid = 'cierres_turno_vw_dinamica'::regclass
    ORDER BY a.attnum;
END;
$$;


ALTER FUNCTION "public"."obtener_estructura_vista"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."obtener_historico_inventarios"("p_empresa_id" "uuid", "p_limit" integer DEFAULT 30, "p_offset" integer DEFAULT 0) RETURNS TABLE("fecha_cierre" "date", "total_productos" bigint, "consumo_total" numeric, "stock_total_final" numeric, "productos" json, "total_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    RETURN QUERY
    WITH paginated AS (
        SELECT 
            ci.fecha,
            COUNT(*) as total_productos,
            SUM(ci.stock_gastado) as consumo_total,
            SUM(ci.stock_restante) as stock_total_final,
            json_agg(
                json_build_object(
                    'producto_id', ci.id,
                    'producto_nombre', ci.producto,
                    'stock_inicial', ci.stock_actual,
                    'stock_gastado', ci.stock_gastado,
                    'stock_restante', ci.stock_restante,
                    'hora_inicio', ci.hora_inicio,
                    'hora_fin', ci.hora_fin
                ) ORDER BY ci.producto
            ) as productos,
            COUNT(*) OVER() as total_count
        FROM cierres_inventario ci
        WHERE ci.empresa_id = p_empresa_id
        GROUP BY ci.fecha
        ORDER BY ci.fecha DESC
        LIMIT p_limit OFFSET p_offset
    )
    SELECT * FROM paginated;
END;
$$;


ALTER FUNCTION "public"."obtener_historico_inventarios"("p_empresa_id" "uuid", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."on_payment_attempt_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.billing_cycle_id is not null then
    update public.billing_cycles
    set estado = case
      when estado in ('pending_payment', 'past_due') then 'proof_submitted'
      else estado
    end,
    updated_at = now()
    where id = new.billing_cycle_id;
  end if;

  insert into public.billing_events (empresa_id, billing_cycle_id, tipo_evento, payload_json, actor)
  values (new.empresa_id, new.billing_cycle_id, 'comprobante_enviado', jsonb_build_object('attempt_id', new.id), 'cliente');

  return new;
end;
$$;


ALTER FUNCTION "public"."on_payment_attempt_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."plan_price"("p_plan" "text") RETURNS numeric
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((
    select precio_mensual
    from public.planes
    where lower(id) = lower(coalesce(p_plan, 'free'))
    limit 1
  ), 0::numeric);
$$;


ALTER FUNCTION "public"."plan_price"("p_plan" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."registrar_empresa_self_service"("p_nombre_comercial" "text", "p_razon_social" "text", "p_nit" "text", "p_correo_empresa" "text", "p_nombre_completo" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid        uuid := auth.uid();
  v_empresa_id uuid;
  v_nit        text := btrim(coalesce(p_nit, ''));
begin
  -- Guarda 1 · autenticación
  if v_uid is null then
    raise exception 'Debes iniciar sesión para registrar una empresa.'
      using errcode = 'EK001';
  end if;

  -- Guarda 2 · una identidad por cuenta
  if exists (select 1 from public.usuarios_sistema us where us.id = v_uid) then
    raise exception 'Tu cuenta ya pertenece a una empresa.'
      using errcode = 'EK002';
  end if;

  -- Guarda 3 · datos obligatorios
  if coalesce(btrim(p_nombre_comercial), '') = ''
     or coalesce(btrim(p_razon_social), '')   = ''
     or v_nit                                    = ''
     or coalesce(btrim(p_correo_empresa), '')  = ''
     or coalesce(btrim(p_nombre_completo), '') = '' then
    raise exception 'Faltan datos obligatorios del registro.'
      using errcode = 'EK004';
  end if;

  -- Guarda 4 · NIT libre
  if exists (select 1 from public.empresas e where e.nit = v_nit) then
    raise exception 'Ese NIT ya está registrado.'
      using errcode = 'EK003';
  end if;

  -- Inserta empresa
  insert into public.empresas (
    nombre_comercial, razon_social, nit, correo_empresa, activa, activo
  )
  values (
    btrim(p_nombre_comercial),
    btrim(p_razon_social),
    v_nit,
    btrim(p_correo_empresa),
    true,
    true
  )
  returning id into v_empresa_id;

  -- Inserta usuario administrador raíz
  insert into public.usuarios_sistema (
    id, empresa_id, nombre_completo, rol, activo
  )
  values (
    v_uid,
    v_empresa_id,
    btrim(p_nombre_completo),
    'admin_root',
    true
  );

  return v_empresa_id;
end;
$$;


ALTER FUNCTION "public"."registrar_empresa_self_service"("p_nombre_comercial" "text", "p_razon_social" "text", "p_nit" "text", "p_correo_empresa" "text", "p_nombre_completo" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolver_pago_revision"("p_revision_id" "uuid", "p_aprobar" boolean, "p_revisado_por" "uuid", "p_observaciones" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_revision public.pagos_en_revision%rowtype;
  v_facturacion public.facturacion%rowtype;
begin
  if not public.is_super_admin() then
    raise exception 'Solo super admin puede resolver pagos';
  end if;

  select * into v_revision
  from public.pagos_en_revision
  where id = p_revision_id
  for update;

  if not found then
    raise exception 'Revision no encontrada';
  end if;

  if v_revision.estado <> 'pendiente' then
    return jsonb_build_object('ok', true, 'estado', v_revision.estado, 'message', 'Revision ya procesada');
  end if;

  update public.pagos_en_revision
  set
    estado = case when p_aprobar then 'aprobado' else 'rechazado' end,
    revisado_por = p_revisado_por,
    revisado_at = now(),
    observaciones = coalesce(p_observaciones, observaciones)
  where id = p_revision_id;

  if p_aprobar then
    select * into v_facturacion from public.facturacion where empresa_id = v_revision.empresa_id for update;

    insert into public.facturaciones_pagadas (empresa_id, pago_revision_id, prefijo, consecutivo, monto, fecha_pago)
    values (v_revision.empresa_id, v_revision.id, v_revision.prefijo, v_revision.consecutivo, v_revision.monto, v_revision.fecha_pago);

    update public.facturacion
    set
      deuda = 0,
      consecutivo_actual = greatest(consecutivo_actual, v_revision.consecutivo + 1),
      updated_at = now()
    where empresa_id = v_revision.empresa_id;
  end if;

  return jsonb_build_object('ok', true, 'estado', case when p_aprobar then 'aprobado' else 'rechazado' end);
end;
$$;


ALTER FUNCTION "public"."resolver_pago_revision"("p_revision_id" "uuid", "p_aprobar" boolean, "p_revisado_por" "uuid", "p_observaciones" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_facturacion_from_empresas"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if tg_op = 'INSERT' then
    insert into public.facturacion (empresa_id, plan, valor_plan, deuda, fecha_corte, fecha_suspension)
    values (
      new.id,
      lower(coalesce(new.plan_actual, new.plan, 'free')),
      public.plan_price(coalesce(new.plan_actual, new.plan, 'free')),
      0,
      null,
      null
    )
    on conflict (empresa_id) do update
    set
      plan = excluded.plan,
      valor_plan = excluded.valor_plan,
      updated_at = now();
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if coalesce(lower(new.plan_actual), '') <> coalesce(lower(old.plan_actual), '')
      or coalesce(lower(new.plan), '') <> coalesce(lower(old.plan), '') then
      update public.facturacion
      set
        plan = lower(coalesce(new.plan_actual, new.plan, 'free')),
        valor_plan = public.plan_price(coalesce(new.plan_actual, new.plan, 'free')),
        updated_at = now()
      where empresa_id = new.id;
    end if;
    return new;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."sync_facturacion_from_empresas"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_gastos_costos_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_gastos_costos_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_last_used_credibanco"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    UPDATE public.integracion_credibanco
    SET last_used_at = now()
    WHERE id = NEW.id;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_last_used_credibanco"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."apoyos_turno" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "empresa_id" "uuid" NOT NULL,
    "fecha_turno" "date" NOT NULL,
    "hora_inicio" "text" NOT NULL,
    "hora_fin" "text" NOT NULL,
    "responsable_turno_id" "uuid" NOT NULL,
    "apoyo_responsable_id" "uuid" NOT NULL,
    "propina" numeric DEFAULT 0 NOT NULL,
    "tiempo_texto" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tiempo_minutos" numeric NOT NULL,
    "rango_tiempo" "text" DEFAULT ''::"text" NOT NULL,
    CONSTRAINT "apoyos_turno_propina_check" CHECK (("propina" >= (0)::numeric))
);


ALTER TABLE "public"."apoyos_turno" OWNER TO "postgres";


COMMENT ON TABLE "public"."apoyos_turno" IS 'Registra las personas que apoyaron en un turno específico (colaboradores externos al responsable principal)';



COMMENT ON COLUMN "public"."apoyos_turno"."empresa_id" IS 'Tenant ID para sistema multitenant';



COMMENT ON COLUMN "public"."apoyos_turno"."fecha_turno" IS 'Fecha del turno (relaciona con cierres_turno_final)';



COMMENT ON COLUMN "public"."apoyos_turno"."hora_inicio" IS 'Hora de inicio del turno (relaciona con cierres_turno_final)';



COMMENT ON COLUMN "public"."apoyos_turno"."hora_fin" IS 'Hora de fin del turno (relaciona con cierres_turno_final)';



COMMENT ON COLUMN "public"."apoyos_turno"."responsable_turno_id" IS 'ID del responsable que cerró el turno';



COMMENT ON COLUMN "public"."apoyos_turno"."apoyo_responsable_id" IS 'ID de la persona que brindó el apoyo (puede ser de usuarios_sistema)';



COMMENT ON COLUMN "public"."apoyos_turno"."propina" IS 'Propina en pesos que recibió la persona de apoyo';



COMMENT ON COLUMN "public"."apoyos_turno"."tiempo_texto" IS 'Representación legible del tiempo (ej: 1 hora 30 minutos)';



CREATE TABLE IF NOT EXISTS "public"."apoyos_turno_locales" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "empresa_id" "uuid" NOT NULL,
    "fecha_turno" "date" NOT NULL,
    "hora_inicio" "text" NOT NULL,
    "hora_fin" "text" NOT NULL,
    "responsable_turno_id" "uuid" NOT NULL,
    "apoyo_responsable_id" "uuid" NOT NULL,
    "propina" numeric DEFAULT 0 NOT NULL,
    "tiempo_texto" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tiempo_minutos" numeric NOT NULL,
    "rango_tiempo" "text" DEFAULT ''::"text" NOT NULL,
    CONSTRAINT "apoyos_turno_propina_check" CHECK (("propina" >= (0)::numeric))
);


ALTER TABLE "public"."apoyos_turno_locales" OWNER TO "postgres";


COMMENT ON TABLE "public"."apoyos_turno_locales" IS 'This is a duplicate of apoyos_turno';



COMMENT ON COLUMN "public"."apoyos_turno_locales"."empresa_id" IS 'Tenant ID para sistema multitenant';



COMMENT ON COLUMN "public"."apoyos_turno_locales"."fecha_turno" IS 'Fecha del turno (relaciona con cierres_turno_final)';



COMMENT ON COLUMN "public"."apoyos_turno_locales"."hora_inicio" IS 'Hora de inicio del turno (relaciona con cierres_turno_final)';



COMMENT ON COLUMN "public"."apoyos_turno_locales"."hora_fin" IS 'Hora de fin del turno (relaciona con cierres_turno_final)';



COMMENT ON COLUMN "public"."apoyos_turno_locales"."responsable_turno_id" IS 'ID del responsable que cerró el turno';



COMMENT ON COLUMN "public"."apoyos_turno_locales"."apoyo_responsable_id" IS 'ID de la persona que brindó el apoyo (puede ser de usuarios_sistema)';



COMMENT ON COLUMN "public"."apoyos_turno_locales"."propina" IS 'Propina en pesos que recibió la persona de apoyo';



COMMENT ON COLUMN "public"."apoyos_turno_locales"."tiempo_texto" IS 'Representación legible del tiempo (ej: 1 hora 30 minutos)';



CREATE TABLE IF NOT EXISTS "public"."billing_cycles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "empresa_id" "uuid" NOT NULL,
    "periodo" "text" NOT NULL,
    "fecha_emision" "date" NOT NULL,
    "fecha_vencimiento" "date" NOT NULL,
    "monto" numeric NOT NULL,
    "moneda" "text" DEFAULT 'COP'::"text" NOT NULL,
    "estado" "text" NOT NULL,
    "dias_restantes_cache" integer,
    "banner_activo" boolean DEFAULT false NOT NULL,
    "suspension_aplicada" boolean DEFAULT false NOT NULL,
    "manual_override" boolean DEFAULT false NOT NULL,
    "manual_override_until" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "billing_cycles_estado_check" CHECK (("estado" = ANY (ARRAY['draft'::"text", 'pending_payment'::"text", 'proof_submitted'::"text", 'paid_verified'::"text", 'past_due'::"text", 'suspended'::"text", 'grace_manual'::"text"]))),
    CONSTRAINT "billing_cycles_periodo_format" CHECK (("periodo" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'::"text")),
    CONSTRAINT "billing_cycles_vencimiento_dia_15" CHECK (("date_part"('day'::"text", "fecha_vencimiento") = (15)::double precision))
);


ALTER TABLE "public"."billing_cycles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."billing_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "empresa_id" "uuid" NOT NULL,
    "billing_cycle_id" "uuid",
    "tipo_evento" "text" NOT NULL,
    "payload_json" "jsonb",
    "actor" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."billing_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cierres_inventario" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "empresa_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fecha" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "producto" "text" DEFAULT ''::"text" NOT NULL,
    "hora_inicio" "text" DEFAULT ''::"text" NOT NULL,
    "hora_fin" "text" DEFAULT ''::"text" NOT NULL,
    "stock_actual" numeric DEFAULT '0'::numeric NOT NULL,
    "stock_gastado" numeric DEFAULT '0'::numeric NOT NULL,
    "stock_restante" numeric DEFAULT '0'::numeric NOT NULL,
    "registrado_por" "text" DEFAULT ''::"text" NOT NULL,
    "Inconsistencia" boolean DEFAULT false NOT NULL,
    "Responsable Inconsistencia" "text" DEFAULT 'N/A'::"text" NOT NULL,
    "Cantidad Faltante" numeric DEFAULT '0'::numeric NOT NULL,
    "responsable turno" "text" DEFAULT ''::"text" NOT NULL
);


ALTER TABLE "public"."cierres_inventario" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."cierres_inventario_agrupado" AS
 WITH "turnos_inventario" AS (
         SELECT "cierres_inventario"."empresa_id",
            "cierres_inventario"."fecha",
            "cierres_inventario"."hora_inicio",
            "cierres_inventario"."hora_fin",
            "cierres_inventario"."registrado_por",
            "cierres_inventario"."responsable turno" AS "responsable_turno",
            "min"("cierres_inventario"."created_at") AS "created_at",
            "jsonb_agg"("jsonb_build_object"('producto', "cierres_inventario"."producto", 'stock_actual', "cierres_inventario"."stock_actual", 'stock_gastado', "cierres_inventario"."stock_gastado", 'stock_restante', "cierres_inventario"."stock_restante", 'inconsistencia', "cierres_inventario"."Inconsistencia", 'responsable_inconsistencia', "cierres_inventario"."Responsable Inconsistencia", 'cantidad_faltante', "cierres_inventario"."Cantidad Faltante") ORDER BY "cierres_inventario"."producto") AS "inventario_detalle",
            "sum"("cierres_inventario"."stock_gastado") AS "total_stock_gastado",
            "sum"("cierres_inventario"."stock_actual") AS "total_stock_inicial",
            "sum"("cierres_inventario"."stock_restante") AS "total_stock_restante",
            "count"(*) AS "total_productos_registrados"
           FROM "public"."cierres_inventario"
          GROUP BY "cierres_inventario"."empresa_id", "cierres_inventario"."fecha", "cierres_inventario"."hora_inicio", "cierres_inventario"."hora_fin", "cierres_inventario"."registrado_por", "cierres_inventario"."responsable turno"
        )
 SELECT "md5"("concat"("empresa_id", "fecha", "hora_inicio", "hora_fin", COALESCE("responsable_turno", ''::"text"))) AS "turno_id",
    "empresa_id",
    "fecha",
    "hora_inicio",
    "hora_fin",
    "registrado_por",
    "responsable_turno",
    "created_at",
    "inventario_detalle",
    "total_stock_gastado",
    "total_stock_inicial",
    "total_stock_restante",
    "total_productos_registrados",
    (EXISTS ( SELECT 1
           FROM "jsonb_array_elements"("turnos_inventario"."inventario_detalle") "item"("value")
          WHERE ((("item"."value" ->> 'inconsistencia'::"text"))::boolean = true))) AS "tiene_inconsistencias",
    ( SELECT "count"(*) AS "count"
           FROM "jsonb_array_elements"("turnos_inventario"."inventario_detalle") "item"("value")
          WHERE ((("item"."value" ->> 'inconsistencia'::"text"))::boolean = true)) AS "total_inconsistencias"
   FROM "turnos_inventario";


ALTER VIEW "public"."cierres_inventario_agrupado" OWNER TO "postgres";


COMMENT ON VIEW "public"."cierres_inventario_agrupado" IS 'Vista que agrupa los cierres de inventario por turno, similar a cierres_turno_final. Cada fila representa un turno completo con un array de productos.';



COMMENT ON COLUMN "public"."cierres_inventario_agrupado"."turno_id" IS 'Identificador único del turno basado en empresa, fecha y horario';



COMMENT ON COLUMN "public"."cierres_inventario_agrupado"."inventario_detalle" IS 'Array de objetos con cada producto: {producto, stock_actual, stock_gastado, stock_restante, inconsistencia, responsable_inconsistencia, cantidad_faltante}';



COMMENT ON COLUMN "public"."cierres_inventario_agrupado"."total_stock_gastado" IS 'Suma total de stock_gastado de todos los productos del turno';



COMMENT ON COLUMN "public"."cierres_inventario_agrupado"."tiene_inconsistencias" IS 'True si al menos un producto tiene inconsistencia en el turno';



CREATE TABLE IF NOT EXISTS "public"."cierres_turno_final" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "empresa_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fecha_turno" "date" NOT NULL,
    "responsable_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "comentarios" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "valor" numeric DEFAULT '0'::numeric NOT NULL,
    "hora_inicio" "text" DEFAULT ''::"text" NOT NULL,
    "hora_fin" "text" DEFAULT ''::"text" NOT NULL,
    "variable" "text" DEFAULT ''::"text" NOT NULL,
    "registrado_por" "text" DEFAULT ''::"text" NOT NULL,
    "categoria" "text" DEFAULT ''::"text" NOT NULL,
    "domicilios_global" numeric DEFAULT '0'::numeric NOT NULL,
    "efectivo_apertura" numeric DEFAULT '0'::numeric NOT NULL,
    "propina_global" numeric DEFAULT '0'::numeric NOT NULL,
    "total_global" numeric DEFAULT '0'::numeric NOT NULL,
    "bolsa_global" numeric DEFAULT '0'::numeric NOT NULL,
    "caja_global" numeric DEFAULT '0'::numeric NOT NULL,
    "hora_llegada" "text" DEFAULT ''::"text" NOT NULL
);


ALTER TABLE "public"."cierres_turno_final" OWNER TO "postgres";


COMMENT ON TABLE "public"."cierres_turno_final" IS 'This is a duplicate of cierres_turno_dup';



CREATE TABLE IF NOT EXISTS "public"."cierres_turno_final_locales" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "empresa_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fecha_turno" "date" NOT NULL,
    "responsable_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "comentarios" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "valor" numeric DEFAULT '0'::numeric NOT NULL,
    "hora_inicio" "text" DEFAULT ''::"text" NOT NULL,
    "hora_fin" "text" DEFAULT ''::"text" NOT NULL,
    "variable" "text" DEFAULT ''::"text" NOT NULL,
    "registrado_por" "text" DEFAULT ''::"text" NOT NULL,
    "categoria" "text" DEFAULT ''::"text" NOT NULL,
    "domicilios_global" numeric DEFAULT '0'::numeric NOT NULL,
    "efectivo_apertura" numeric DEFAULT '0'::numeric NOT NULL,
    "propina_global" numeric DEFAULT '0'::numeric NOT NULL,
    "total_global" numeric DEFAULT '0'::numeric NOT NULL,
    "bolsa_global" numeric DEFAULT '0'::numeric NOT NULL,
    "caja_global" numeric DEFAULT '0'::numeric NOT NULL,
    "hora_llegada" "text" DEFAULT ''::"text" NOT NULL
);


ALTER TABLE "public"."cierres_turno_final_locales" OWNER TO "postgres";


COMMENT ON TABLE "public"."cierres_turno_final_locales" IS 'This is a duplicate of cierres_turno_final';



CREATE TABLE IF NOT EXISTS "public"."correos_empresas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "empresa_id" "uuid" NOT NULL,
    "correo" "text" DEFAULT ''::"text" NOT NULL,
    "client_id" "text" DEFAULT ''::"text" NOT NULL,
    "client_secret" "text" DEFAULT ''::"text" NOT NULL,
    "project_id" "text" DEFAULT ''::"text" NOT NULL,
    "auth_url" "text" DEFAULT ''::"text" NOT NULL,
    "token_url" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."correos_empresas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."credenciales_plataforma" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "empresa_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plataforma" "text" DEFAULT ''::"text" NOT NULL,
    "token" "text" DEFAULT ''::"text" NOT NULL,
    "url_plataforma" "text",
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "plataforma_tenant_id" "text" DEFAULT ''::"text" NOT NULL
);


ALTER TABLE "public"."credenciales_plataforma" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dimensiones_concepto" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."dimensiones_concepto" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dimensiones_tiempo" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre" "text" NOT NULL,
    "factor_conversion" numeric(12,4) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."dimensiones_tiempo" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."empleados" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "empresa_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre_completo" "text" DEFAULT ''::"text" NOT NULL,
    "fecha_inicio" "date" NOT NULL,
    "estado" "text" DEFAULT 'activo'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "cedula" "text" NOT NULL,
    "añadido_por" "text" DEFAULT ''::"text" NOT NULL
);


ALTER TABLE "public"."empleados" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."empresa_configuracion_nomina" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "empresa_id" "uuid" NOT NULL,
    "modelo_calculo" "text" DEFAULT 'por_horas'::"text" NOT NULL,
    "comision_porcentaje" numeric(5,2) DEFAULT 0,
    "incluir_propinas_en_devengado" boolean DEFAULT true,
    "incluir_diferencia_caja_positiva" boolean DEFAULT true,
    "incluir_auxilio_transporte" boolean DEFAULT true,
    "deducir_diferencia_caja_negativa" boolean DEFAULT true,
    "deducir_gastos_extra" boolean DEFAULT true,
    "descuentos_fijos" "jsonb" DEFAULT '[]'::"jsonb",
    "ingresos_fijos" "jsonb" DEFAULT '[]'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "modelo_calculo_check" CHECK (("modelo_calculo" = ANY (ARRAY['por_horas'::"text", 'salario_fijo'::"text", 'comision_ventas'::"text", 'mixto'::"text"])))
);


ALTER TABLE "public"."empresa_configuracion_nomina" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."empresas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre_comercial" "text" DEFAULT ''::"text" NOT NULL,
    "razon_social" "text" DEFAULT ''::"text" NOT NULL,
    "nit" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "activa" boolean DEFAULT true NOT NULL,
    "correo_empresa" "text" DEFAULT ''::"text" NOT NULL,
    "plan_actual" "text" DEFAULT 'free'::"text" NOT NULL,
    "mostrar_anuncio_impago" boolean DEFAULT false,
    "deuda_actual" numeric DEFAULT 0,
    "activo" boolean DEFAULT true NOT NULL,
    "plan" "text" DEFAULT 'free'::"text" NOT NULL
);


ALTER TABLE "public"."empresas" OWNER TO "postgres";


COMMENT ON TABLE "public"."empresas" IS 'Aqui irán los datos relacionados con la empresa y su respectivo tenant uúnico';



CREATE TABLE IF NOT EXISTS "public"."facturacion" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "empresa_id" "uuid" NOT NULL,
    "plan" "text" DEFAULT 'free'::"text" NOT NULL,
    "valor_plan" numeric DEFAULT 0 NOT NULL,
    "deuda" numeric DEFAULT 0 NOT NULL,
    "fecha_corte" "date" DEFAULT (("date_trunc"('month'::"text", "now"()))::"date" + 14),
    "fecha_suspension" "date" DEFAULT (("date_trunc"('month'::"text", "now"()))::"date" + 24),
    "prefijo_factura" "text" DEFAULT 'AX'::"text" NOT NULL,
    "consecutivo_actual" bigint DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."facturacion" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."facturaciones_pagadas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "empresa_id" "uuid" NOT NULL,
    "pago_revision_id" "uuid",
    "prefijo" "text" NOT NULL,
    "consecutivo" bigint NOT NULL,
    "monto" numeric NOT NULL,
    "fecha_pago" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."facturaciones_pagadas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."facturas_empresas" (
    "Prefijo Factura" "text" DEFAULT ''::"text" NOT NULL,
    "Consecutivo Factura" "text" DEFAULT ''::"text" NOT NULL,
    "Proveedor" "text" DEFAULT ''::"text" NOT NULL,
    "Dirección" "text" DEFAULT ''::"text" NOT NULL,
    "Télefono" "text" DEFAULT ''::"text" NOT NULL,
    "Correo Empresa" "text" DEFAULT ''::"text" NOT NULL,
    "Producto" "text" DEFAULT ''::"text" NOT NULL,
    "Valor Unitario" "text" DEFAULT ''::"text" NOT NULL,
    "Cantidad" "text" DEFAULT ''::"text" NOT NULL,
    "Subtotal" "text" DEFAULT ''::"text" NOT NULL,
    "Porcentaje INC o IVA" "text" DEFAULT ''::"text" NOT NULL,
    "Código Contable" "text" DEFAULT ''::"text" NOT NULL,
    "Valor Débito" "text" DEFAULT ''::"text" NOT NULL,
    "Valor Crédito" "text" DEFAULT ''::"text" NOT NULL,
    "Estado" "text" DEFAULT 'no_registrado'::"text" NOT NULL,
    "Tipo de Factura" "text" DEFAULT ''::"text" NOT NULL,
    "Fecha Factura" "text" DEFAULT ''::"text" NOT NULL,
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "empresa_id" "uuid" NOT NULL,
    "NIT_CC" "text" DEFAULT ''::"text" NOT NULL,
    "uuid_factura" "text" DEFAULT ''::"text" NOT NULL,
    "Estado_Siigo" boolean DEFAULT false
);


ALTER TABLE "public"."facturas_empresas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."facturas_empresas_inconvenientes" (
    "Prefijo Factura" "text" DEFAULT ''::"text" NOT NULL,
    "Consecutivo Factura" "text" DEFAULT ''::"text" NOT NULL,
    "Proveedor" "text" DEFAULT ''::"text" NOT NULL,
    "Dirección" "text" DEFAULT ''::"text" NOT NULL,
    "Télefono" "text" DEFAULT ''::"text" NOT NULL,
    "Correo Empresa" "text" DEFAULT ''::"text" NOT NULL,
    "Producto" "text" DEFAULT ''::"text" NOT NULL,
    "Valor Unitario" "text" DEFAULT ''::"text" NOT NULL,
    "Cantidad" "text" DEFAULT ''::"text" NOT NULL,
    "Subtotal" "text" DEFAULT ''::"text" NOT NULL,
    "Porcentaje INC o IVA" "text" DEFAULT ''::"text" NOT NULL,
    "Código Contable" "text",
    "Valor Débito" "text" DEFAULT ''::"text" NOT NULL,
    "Valor Crédito" "text" DEFAULT ''::"text" NOT NULL,
    "Estado" "text" DEFAULT 'no_registrado'::"text" NOT NULL,
    "Tipo de Factura" "text" DEFAULT ''::"text" NOT NULL,
    "Fecha Factura" "text" DEFAULT ''::"text" NOT NULL,
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "empresa_id" "uuid" NOT NULL,
    "NIT_CC" "text" DEFAULT ''::"text" NOT NULL,
    "uuid_factura" "text" DEFAULT ''::"text" NOT NULL,
    "Estado_Resuelto" boolean DEFAULT false
);


ALTER TABLE "public"."facturas_empresas_inconvenientes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."gastos_costos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "empresa_id" "uuid" NOT NULL,
    "tipo_gasto_id" "text" NOT NULL,
    "tipo_gasto_nombre" "text" NOT NULL,
    "descripcion" "text" DEFAULT ''::"text" NOT NULL,
    "fecha" timestamp with time zone NOT NULL,
    "local_nombre" "text" NOT NULL,
    "pagado_a_nombre" "text" NOT NULL,
    "valor" numeric(15,2) DEFAULT 0 NOT NULL,
    "impuestos" numeric(15,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "gastos_costos_impuestos_check" CHECK (("impuestos" >= (0)::numeric)),
    CONSTRAINT "gastos_costos_valor_check" CHECK (("valor" >= (0)::numeric))
);


ALTER TABLE "public"."gastos_costos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."grupos_empresariales" (
    "empresa_id" "uuid" NOT NULL,
    "grupo_id" "text" NOT NULL,
    "nombre_grupo" "text" NOT NULL,
    "razon_social_grupo" "text" DEFAULT ''::"text" NOT NULL,
    "plan_grupo" "text" DEFAULT 'free'::"text" NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."grupos_empresariales" OWNER TO "postgres";


COMMENT ON TABLE "public"."grupos_empresariales" IS 'Tabla mediadora - Acceso de solo lectura para todos los usuarios';



CREATE TABLE IF NOT EXISTS "public"."historial_facturacion" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "empresa_id" "uuid" NOT NULL,
    "prefijo_factura" "text" NOT NULL,
    "consecutivo_usado" bigint NOT NULL,
    "plan" "text" NOT NULL,
    "valor_plan" numeric DEFAULT 0 NOT NULL,
    "deuda" numeric DEFAULT 0 NOT NULL,
    "fecha_corte" "date" NOT NULL,
    "fecha_suspension" "date" NOT NULL,
    "periodo" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."historial_facturacion" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."historico_nomina" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "totales" "jsonb",
    "detalles" "jsonb",
    "apoyos" "jsonb",
    "ingresos" "jsonb",
    "deducciones" "jsonb",
    "parametros" "jsonb",
    "empresa_id" "uuid",
    "responsable_id" "uuid",
    "fecha" "text" DEFAULT ''::"text" NOT NULL,
    "locales" boolean DEFAULT false,
    "consultado" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "periodo" "text" DEFAULT ''::"text" NOT NULL
);


ALTER TABLE "public"."historico_nomina" OWNER TO "postgres";


COMMENT ON TABLE "public"."historico_nomina" IS 'Tabla de cierres con todos los datos estructurados en JSON';



COMMENT ON COLUMN "public"."historico_nomina"."id" IS 'Identificador único UUID para cada registro';



COMMENT ON COLUMN "public"."historico_nomina"."totales" IS 'JSON con los datos de la tabla totales';



COMMENT ON COLUMN "public"."historico_nomina"."detalles" IS 'JSON con los datos de la tabla detalles';



COMMENT ON COLUMN "public"."historico_nomina"."apoyos" IS 'JSON con los datos de la tabla apoyos';



COMMENT ON COLUMN "public"."historico_nomina"."ingresos" IS 'JSON con los datos de la tabla ingresos';



COMMENT ON COLUMN "public"."historico_nomina"."deducciones" IS 'JSON con los datos de la tabla deducciones';



COMMENT ON COLUMN "public"."historico_nomina"."parametros" IS 'JSON con los datos de la tabla parametros';



COMMENT ON COLUMN "public"."historico_nomina"."empresa_id" IS 'ID UUID de la empresa (referencia a empresas.id)';



COMMENT ON COLUMN "public"."historico_nomina"."responsable_id" IS 'ID UUID del usuario responsable (referencia a usuarios_sistema.id)';



COMMENT ON COLUMN "public"."historico_nomina"."fecha" IS 'Fecha en formato texto (no formato fecha)';



COMMENT ON COLUMN "public"."historico_nomina"."locales" IS 'Indica si es un cierre local (true/false)';



COMMENT ON COLUMN "public"."historico_nomina"."consultado" IS 'JSON con información de locales consultados';



COMMENT ON COLUMN "public"."historico_nomina"."created_at" IS 'Fecha de creación del registro';



COMMENT ON COLUMN "public"."historico_nomina"."updated_at" IS 'Fecha de última actualización del registro';



CREATE TABLE IF NOT EXISTS "public"."integracion_credibanco" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "empresa_id" "uuid" NOT NULL,
    "client_id" "text" NOT NULL,
    "client_secret" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "is_active" boolean DEFAULT true
);


ALTER TABLE "public"."integracion_credibanco" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."integraciones_credenciales" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "empresa_id" "uuid" NOT NULL,
    "plataforma" "text" NOT NULL,
    "usuario" "text" NOT NULL,
    "password" "text" NOT NULL,
    "url_api" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."integraciones_credenciales" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loggro_refrescar_token" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "empresa_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plataforma" "text" DEFAULT ''::"text" NOT NULL,
    "usuario" "text" DEFAULT ''::"text",
    "contraseña" "text" DEFAULT ''::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."loggro_refrescar_token" OWNER TO "postgres";


COMMENT ON TABLE "public"."loggro_refrescar_token" IS 'credenciales_plataforma token loggro';



CREATE TABLE IF NOT EXISTS "public"."metodos_pago" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "empresa_id" "uuid",
    "codigo" "text" NOT NULL,
    "nombre" "text" NOT NULL,
    "tipo" "text" DEFAULT 'qr'::"text" NOT NULL,
    "data_qr_o_url" "text",
    "qr_image_url" "text",
    "instrucciones" "text",
    "activo" boolean DEFAULT true NOT NULL,
    "orden" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "metodos_pago_tipo_check" CHECK (("tipo" = ANY (ARRAY['qr'::"text", 'transferencia'::"text", 'link_pago'::"text", 'otro'::"text"])))
);


ALTER TABLE "public"."metodos_pago" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."otros_usuarios" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "empresa_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre_completo" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "cedula" "text" NOT NULL,
    "añadido_por" "text" DEFAULT ''::"text" NOT NULL,
    "estado" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."otros_usuarios" OWNER TO "postgres";


COMMENT ON TABLE "public"."otros_usuarios" IS 'This is a duplicate of empleados';



CREATE TABLE IF NOT EXISTS "public"."pagos_en_revision" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "empresa_id" "uuid" NOT NULL,
    "facturacion_id" "uuid",
    "prefijo" "text" NOT NULL,
    "consecutivo" bigint NOT NULL,
    "monto" numeric NOT NULL,
    "fecha_pago" timestamp with time zone DEFAULT "now"() NOT NULL,
    "comprobante_nombre" "text",
    "comprobante_mime" "text",
    "comprobante_base64" "text" NOT NULL,
    "estado" "text" DEFAULT 'pendiente'::"text" NOT NULL,
    "observaciones" "text",
    "revisado_por" "uuid",
    "revisado_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "pagos_en_revision_estado_check" CHECK (("estado" = ANY (ARRAY['pendiente'::"text", 'aprobado'::"text", 'rechazado'::"text"])))
);


ALTER TABLE "public"."pagos_en_revision" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."parametros_nomina" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "empresa_id" "uuid" NOT NULL,
    "dimension_tiempo_id" "uuid" NOT NULL,
    "dimension_concepto_id" "uuid" NOT NULL,
    "valor_monetario" numeric(12,2) DEFAULT 0 NOT NULL,
    "es_ingreso" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."parametros_nomina" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payment_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "billing_cycle_id" "uuid" NOT NULL,
    "empresa_id" "uuid" NOT NULL,
    "canal" "text" NOT NULL,
    "referencia_externa" "text",
    "monto_reportado" numeric NOT NULL,
    "fecha_reportada" timestamp with time zone DEFAULT "now"() NOT NULL,
    "comprobante_url" "text",
    "estado" "text" DEFAULT 'pendiente'::"text" NOT NULL,
    "revisado_por" "uuid",
    "observaciones" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "payment_attempts_canal_check" CHECK (("canal" = ANY (ARRAY['mercadopago_link'::"text", 'transferencia'::"text", 'efectivo'::"text", 'otros'::"text"]))),
    CONSTRAINT "payment_attempts_estado_check" CHECK (("estado" = ANY (ARRAY['pendiente'::"text", 'aprobado'::"text", 'rechazado'::"text"])))
);


ALTER TABLE "public"."payment_attempts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."planes" (
    "id" "text" NOT NULL,
    "nombre" "text" NOT NULL,
    "precio_mensual" numeric NOT NULL,
    "descripcion" "text",
    "max_usuarios" integer,
    "incluye_configuracion" boolean DEFAULT false,
    "incluye_api" boolean DEFAULT false
);


ALTER TABLE "public"."planes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."roles_permisos_modulo" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rol" "text" NOT NULL,
    "modulo" "text" NOT NULL,
    "permitido" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."roles_permisos_modulo" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."system_users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre" "text" NOT NULL,
    "correo" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."system_users" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."turnos_agrupados" WITH ("security_invoker"='on') AS
 SELECT "empresa_id",
    "fecha_turno",
    "hora_inicio",
    "hora_fin",
    "dense_rank"() OVER (PARTITION BY "empresa_id", "fecha_turno" ORDER BY "hora_inicio") AS "numero_turno",
        CASE
            WHEN ("hora_inicio" < '12:00'::"text") THEN 'Mañana'::"text"
            WHEN ("hora_inicio" < '18:00'::"text") THEN 'Tarde'::"text"
            ELSE 'Noche'::"text"
        END AS "nombre_turno",
    ((((((("fecha_turno" || ' - T'::"text") || "dense_rank"() OVER (PARTITION BY "empresa_id", "fecha_turno" ORDER BY "hora_inicio")) || ' ('::"text") || "hora_inicio") || '-'::"text") || "hora_fin") || ')'::"text") AS "turno_nombre",
    "responsable_id",
    "registrado_por",
    "max"("comentarios") AS "comentarios",
    "max"("created_at") AS "created_at",
    "max"("domicilios_global") AS "domicilios",
    "max"("efectivo_apertura") AS "efectivo_inicial",
    "max"("propina_global") AS "propinas",
    "max"("total_global") AS "ventas_brutas",
    "max"("bolsa_global") AS "bolsas",
    "max"("caja_global") AS "caja_final",
    "json_agg"("json_build_object"('id', "id", 'variable', "variable", 'categoria', "categoria", 'valor', "valor") ORDER BY "categoria", "variable") FILTER (WHERE ("variable" <> ''::"text")) AS "variables_detalle",
    "sum"(
        CASE
            WHEN ("variable" <> ''::"text") THEN "valor"
            ELSE (0)::numeric
        END) AS "total_variables",
    (("max"("total_global") + "sum"(
        CASE
            WHEN ("variable" <> ''::"text") THEN "valor"
            ELSE (0)::numeric
        END)) - "max"("caja_global")) AS "diferencia_caja"
   FROM "public"."cierres_turno_final"
  GROUP BY "empresa_id", "fecha_turno", "hora_inicio", "hora_fin", "responsable_id", "registrado_por"
  ORDER BY "fecha_turno" DESC, "hora_inicio";


ALTER VIEW "public"."turnos_agrupados" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."turnos_agrupados_locales" WITH ("security_invoker"='on') AS
 SELECT "empresa_id",
    "fecha_turno",
    "hora_inicio",
    "hora_fin",
    "dense_rank"() OVER (PARTITION BY "empresa_id", "fecha_turno" ORDER BY "hora_inicio") AS "numero_turno",
        CASE
            WHEN ("hora_inicio" < '12:00'::"text") THEN 'Mañana'::"text"
            WHEN ("hora_inicio" < '18:00'::"text") THEN 'Tarde'::"text"
            ELSE 'Noche'::"text"
        END AS "nombre_turno",
    ((((((("fecha_turno" || ' - T'::"text") || "dense_rank"() OVER (PARTITION BY "empresa_id", "fecha_turno" ORDER BY "hora_inicio")) || ' ('::"text") || "hora_inicio") || '-'::"text") || "hora_fin") || ')'::"text") AS "turno_nombre",
    "responsable_id",
    "registrado_por",
    "max"("comentarios") AS "comentarios",
    "max"("created_at") AS "created_at",
    "max"("domicilios_global") AS "domicilios",
    "max"("efectivo_apertura") AS "efectivo_inicial",
    "max"("propina_global") AS "propinas",
    "max"("total_global") AS "ventas_brutas",
    "max"("bolsa_global") AS "bolsas",
    "max"("caja_global") AS "caja_final",
    "json_agg"("json_build_object"('id', "id", 'variable', "variable", 'categoria', "categoria", 'valor', "valor") ORDER BY "categoria", "variable") FILTER (WHERE ("variable" <> ''::"text")) AS "variables_detalle",
    "sum"(
        CASE
            WHEN ("variable" <> ''::"text") THEN "valor"
            ELSE (0)::numeric
        END) AS "total_variables",
    (("max"("total_global") + "sum"(
        CASE
            WHEN ("variable" <> ''::"text") THEN "valor"
            ELSE (0)::numeric
        END)) - "max"("caja_global")) AS "diferencia_caja"
   FROM "public"."cierres_turno_final_locales"
  GROUP BY "empresa_id", "fecha_turno", "hora_inicio", "hora_fin", "responsable_id", "registrado_por"
  ORDER BY "fecha_turno" DESC, "hora_inicio";


ALTER VIEW "public"."turnos_agrupados_locales" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."usuarios_locales" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "usuario_principal_id" "uuid" NOT NULL,
    "empresa_id" "uuid" NOT NULL,
    "nombre_completo" "text" DEFAULT ''::"text" NOT NULL,
    "rol" "text" DEFAULT ''::"text" NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "añadido_por" "text" DEFAULT ''::"text" NOT NULL
);


ALTER TABLE "public"."usuarios_locales" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."usuarios_permisos_modulo" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "empresa_id" "uuid" NOT NULL,
    "usuario_id" "uuid" NOT NULL,
    "modulo" "text" NOT NULL,
    "permitido" boolean DEFAULT true NOT NULL,
    "origen" "text" DEFAULT 'manual'::"text" NOT NULL,
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."usuarios_permisos_modulo" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."usuarios_sistema" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "empresa_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre_completo" "text" DEFAULT ''::"text" NOT NULL,
    "rol" "text" DEFAULT ''::"text" NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "añadido_por" "text" DEFAULT ''::"text" NOT NULL
);


ALTER TABLE "public"."usuarios_sistema" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_permisos_con_plan" WITH ("security_invoker"='on') AS
 SELECT "us"."id" AS "usuario_id",
    "us"."empresa_id",
    "us"."rol",
    COALESCE("lower"(NULLIF("e"."plan_actual", ''::"text")), "lower"(NULLIF("e"."plan", ''::"text")), 'free'::"text") AS "plan",
    COALESCE("e"."activo", "e"."activa", true) AS "empresa_activa",
    "e"."mostrar_anuncio_impago",
    "rpm"."modulo",
    COALESCE("upm"."permitido", "rpm"."permitido", false) AS "permitido",
    "public"."empresa_es_solo_lectura"("us"."empresa_id") AS "empresa_solo_lectura"
   FROM ((("public"."usuarios_sistema" "us"
     JOIN "public"."empresas" "e" ON (("e"."id" = "us"."empresa_id")))
     LEFT JOIN "public"."roles_permisos_modulo" "rpm" ON (("rpm"."rol" = "us"."rol")))
     LEFT JOIN "public"."usuarios_permisos_modulo" "upm" ON ((("upm"."empresa_id" = "us"."empresa_id") AND ("upm"."usuario_id" = "us"."id") AND ("upm"."modulo" = "rpm"."modulo"))))
  WHERE (COALESCE("us"."activo", true) = true);


ALTER VIEW "public"."v_permisos_con_plan" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_permisos_efectivos" WITH ("security_invoker"='on') AS
 SELECT "us"."id" AS "usuario_id",
    "us"."empresa_id",
    "us"."rol",
    "rpm"."modulo",
    COALESCE("upm"."permitido", "rpm"."permitido", false) AS "permitido",
        CASE
            WHEN ("upm"."id" IS NOT NULL) THEN 'override_usuario'::"text"
            ELSE 'rol_base'::"text"
        END AS "fuente"
   FROM (("public"."usuarios_sistema" "us"
     LEFT JOIN "public"."roles_permisos_modulo" "rpm" ON (("rpm"."rol" = "us"."rol")))
     LEFT JOIN "public"."usuarios_permisos_modulo" "upm" ON ((("upm"."empresa_id" = "us"."empresa_id") AND ("upm"."usuario_id" = "us"."id") AND ("upm"."modulo" = "rpm"."modulo"))))
  WHERE (COALESCE("us"."activo", true) = true);


ALTER VIEW "public"."v_permisos_efectivos" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vista_cierres_inventario" WITH ("security_invoker"='on') AS
 WITH "cierres_agrupados" AS (
         SELECT "cierres_inventario"."empresa_id",
            "cierres_inventario"."fecha",
            "cierres_inventario"."hora_inicio",
            "cierres_inventario"."hora_fin",
            "cierres_inventario"."responsable turno" AS "responsable_id",
            "max"("cierres_inventario"."created_at") AS "created_at",
            "gen_random_uuid"() AS "cierre_uuid",
            "concat"("cierres_inventario"."hora_inicio", ' - ', "cierres_inventario"."hora_fin", ' del ', "to_char"(("cierres_inventario"."fecha")::timestamp with time zone, 'DD/MM/YYYY'::"text")) AS "identidad_cierre",
            "array_agg"("jsonb_build_object"('producto', "cierres_inventario"."producto", 'stock_actual', "cierres_inventario"."stock_actual", 'stock_restante', "cierres_inventario"."stock_restante", 'stock_gastado', "cierres_inventario"."stock_gastado", 'registrado_por', "cierres_inventario"."registrado_por") ORDER BY "cierres_inventario"."producto") AS "array_productos",
            "array_agg"("jsonb_build_object"('producto', "cierres_inventario"."producto", 'responsable_inconsistencia', "cierres_inventario"."Responsable Inconsistencia", 'cantidad_faltante', "cierres_inventario"."Cantidad Faltante", 'stock_actual', "cierres_inventario"."stock_actual", 'stock_restante', "cierres_inventario"."stock_restante") ORDER BY "cierres_inventario"."producto") FILTER (WHERE ("cierres_inventario"."Inconsistencia" = true)) AS "array_inconsistencias",
            "count"(*) AS "total_productos"
           FROM "public"."cierres_inventario"
          GROUP BY "cierres_inventario"."empresa_id", "cierres_inventario"."fecha", "cierres_inventario"."hora_inicio", "cierres_inventario"."hora_fin", "cierres_inventario"."responsable turno"
        )
 SELECT "empresa_id",
    "cierre_uuid",
    "created_at",
    "identidad_cierre",
    "responsable_id",
    "total_productos",
    COALESCE("array_productos", '{}'::"jsonb"[]) AS "array_productos",
    COALESCE("array_inconsistencias", '{}'::"jsonb"[]) AS "array_inconsistencias"
   FROM "cierres_agrupados"
  ORDER BY "fecha" DESC, "hora_inicio" DESC;


ALTER VIEW "public"."vista_cierres_inventario" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vista_facturas_agrupadas" AS
 SELECT "uuid_factura" AS "UUID",
    "max"(("empresa_id")::"text") AS "empresa_id",
    "max"("Tipo de Factura") AS "Tipo de documento",
    "max"("Prefijo Factura") AS "Prefijo",
    "max"("Consecutivo Factura") AS "Consecutivo",
    "max"("Fecha Factura") AS "Fecha Emisión",
    "max"("NIT_CC") AS "NIT Emisor",
    "max"("Proveedor") AS "Nombre Emisor",
    COALESCE("sum"(
        CASE
            WHEN ("Código Contable" = '24080101'::"text") THEN (NULLIF("Valor Débito", ''::"text"))::numeric
            ELSE (0)::numeric
        END), (0)::numeric) AS "IVA",
    COALESCE("sum"(
        CASE
            WHEN ("Código Contable" = '24080102'::"text") THEN (NULLIF("Valor Débito", ''::"text"))::numeric
            ELSE (0)::numeric
        END), (0)::numeric) AS "INC",
    COALESCE("sum"(
        CASE
            WHEN ("Código Contable" <> ALL (ARRAY['24080101'::"text", '24080102'::"text"])) THEN (NULLIF("Valor Crédito", ''::"text"))::numeric
            ELSE (0)::numeric
        END), (0)::numeric) AS "Total",
    "bool_or"("Estado_Siigo") AS "Estado_Siigo"
   FROM "public"."facturas_empresas"
  WHERE (("uuid_factura" IS NOT NULL) AND ("uuid_factura" <> ''::"text"))
  GROUP BY "uuid_factura";


ALTER VIEW "public"."vista_facturas_agrupadas" OWNER TO "postgres";


ALTER TABLE ONLY "public"."otros_usuarios"
    ADD CONSTRAINT "administradores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."apoyos_turno_locales"
    ADD CONSTRAINT "apoyos_turno_locales_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."apoyos_turno"
    ADD CONSTRAINT "apoyos_turno_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."billing_cycles"
    ADD CONSTRAINT "billing_cycles_empresa_periodo_unique" UNIQUE ("empresa_id", "periodo");



ALTER TABLE ONLY "public"."billing_cycles"
    ADD CONSTRAINT "billing_cycles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."billing_events"
    ADD CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cierres_inventario"
    ADD CONSTRAINT "cierres_inventario_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."historico_nomina"
    ADD CONSTRAINT "cierres_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cierres_turno_final_locales"
    ADD CONSTRAINT "cierres_turno_final_locales_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cierres_turno_final"
    ADD CONSTRAINT "cierres_turno_final_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."correos_empresas"
    ADD CONSTRAINT "correos_empresas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."credenciales_plataforma"
    ADD CONSTRAINT "credenciales_plataforma_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dimensiones_concepto"
    ADD CONSTRAINT "dimensiones_concepto_nombre_key" UNIQUE ("nombre");



ALTER TABLE ONLY "public"."dimensiones_concepto"
    ADD CONSTRAINT "dimensiones_concepto_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dimensiones_tiempo"
    ADD CONSTRAINT "dimensiones_tiempo_nombre_key" UNIQUE ("nombre");



ALTER TABLE ONLY "public"."dimensiones_tiempo"
    ADD CONSTRAINT "dimensiones_tiempo_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."empleados"
    ADD CONSTRAINT "empleados_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."empresa_configuracion_nomina"
    ADD CONSTRAINT "empresa_configuracion_nomina_empresa_id_unique" UNIQUE ("empresa_id");



ALTER TABLE ONLY "public"."empresa_configuracion_nomina"
    ADD CONSTRAINT "empresa_configuracion_nomina_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."empresas"
    ADD CONSTRAINT "empresas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."facturacion"
    ADD CONSTRAINT "facturacion_empresa_id_key" UNIQUE ("empresa_id");



ALTER TABLE ONLY "public"."facturacion"
    ADD CONSTRAINT "facturacion_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."facturaciones_pagadas"
    ADD CONSTRAINT "facturaciones_pagadas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."facturas_empresas_inconvenientes"
    ADD CONSTRAINT "facturas_empresas_inconvenientes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."facturas_empresas"
    ADD CONSTRAINT "facturas_empresas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gastos_costos"
    ADD CONSTRAINT "gastos_costos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."grupos_empresariales"
    ADD CONSTRAINT "grupos_empresariales_pkey" PRIMARY KEY ("empresa_id", "grupo_id");



ALTER TABLE ONLY "public"."historial_facturacion"
    ADD CONSTRAINT "historial_facturacion_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."integracion_credibanco"
    ADD CONSTRAINT "integracion_credibanco_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."integraciones_credenciales"
    ADD CONSTRAINT "integraciones_credenciales_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loggro_refrescar_token"
    ADD CONSTRAINT "loggro_refrescar_token_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."metodos_pago"
    ADD CONSTRAINT "metodos_pago_codigo_key" UNIQUE ("codigo");



ALTER TABLE ONLY "public"."metodos_pago"
    ADD CONSTRAINT "metodos_pago_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pagos_en_revision"
    ADD CONSTRAINT "pagos_en_revision_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."parametros_nomina"
    ADD CONSTRAINT "parametros_nomina_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."parametros_nomina"
    ADD CONSTRAINT "parametros_nomina_unique_coordenada" UNIQUE ("empresa_id", "dimension_tiempo_id", "dimension_concepto_id");



ALTER TABLE ONLY "public"."payment_attempts"
    ADD CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."planes"
    ADD CONSTRAINT "planes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."roles_permisos_modulo"
    ADD CONSTRAINT "roles_permisos_modulo_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."roles_permisos_modulo"
    ADD CONSTRAINT "roles_permisos_modulo_rol_modulo_key" UNIQUE ("rol", "modulo");



ALTER TABLE ONLY "public"."system_users"
    ADD CONSTRAINT "system_users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."integracion_credibanco"
    ADD CONSTRAINT "unique_client_id" UNIQUE ("client_id");



ALTER TABLE ONLY "public"."usuarios_locales"
    ADD CONSTRAINT "usuarios_locales_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."usuarios_permisos_modulo"
    ADD CONSTRAINT "usuarios_permisos_modulo_empresa_id_usuario_id_modulo_key" UNIQUE ("empresa_id", "usuario_id", "modulo");



ALTER TABLE ONLY "public"."usuarios_permisos_modulo"
    ADD CONSTRAINT "usuarios_permisos_modulo_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."usuarios_sistema"
    ADD CONSTRAINT "usuarios_sistema_pkey" PRIMARY KEY ("id");



CREATE INDEX "apoyos_turno_locales_apoyo_responsable_id_idx" ON "public"."apoyos_turno_locales" USING "btree" ("apoyo_responsable_id");



CREATE INDEX "apoyos_turno_locales_empresa_id_fecha_turno_hora_inicio_hor_idx" ON "public"."apoyos_turno_locales" USING "btree" ("empresa_id", "fecha_turno", "hora_inicio", "hora_fin");



CREATE INDEX "apoyos_turno_locales_empresa_id_fecha_turno_idx" ON "public"."apoyos_turno_locales" USING "btree" ("empresa_id", "fecha_turno");



CREATE INDEX "apoyos_turno_locales_responsable_turno_id_idx" ON "public"."apoyos_turno_locales" USING "btree" ("responsable_turno_id");



CREATE INDEX "billing_cycles_empresa_periodo_idx" ON "public"."billing_cycles" USING "btree" ("empresa_id", "periodo");



CREATE INDEX "billing_cycles_estado_vencimiento_idx" ON "public"."billing_cycles" USING "btree" ("estado", "fecha_vencimiento");



CREATE INDEX "billing_events_billing_cycle_idx" ON "public"."billing_events" USING "btree" ("billing_cycle_id");



CREATE INDEX "billing_events_empresa_created_idx" ON "public"."billing_events" USING "btree" ("empresa_id", "created_at");



CREATE UNIQUE INDEX "facturacion_prefijo_consecutivo_uidx" ON "public"."facturacion" USING "btree" ("lower"(TRIM(BOTH FROM "prefijo_factura")), "consecutivo_actual");



CREATE UNIQUE INDEX "facturaciones_pagadas_prefijo_consecutivo_uidx" ON "public"."facturaciones_pagadas" USING "btree" ("lower"(TRIM(BOTH FROM "prefijo")), "consecutivo");



CREATE INDEX "idx_apoyos_turno_apoyo_responsable" ON "public"."apoyos_turno" USING "btree" ("apoyo_responsable_id");



CREATE INDEX "idx_apoyos_turno_empresa_fecha" ON "public"."apoyos_turno" USING "btree" ("empresa_id", "fecha_turno");



CREATE INDEX "idx_apoyos_turno_responsable_turno" ON "public"."apoyos_turno" USING "btree" ("responsable_turno_id");



CREATE INDEX "idx_apoyos_turno_turno_compuesto" ON "public"."apoyos_turno" USING "btree" ("empresa_id", "fecha_turno", "hora_inicio", "hora_fin");



CREATE INDEX "idx_cierres_created_at" ON "public"."historico_nomina" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_cierres_empresa_fecha" ON "public"."cierres_inventario" USING "btree" ("empresa_id", "fecha" DESC);



CREATE INDEX "idx_cierres_empresa_id" ON "public"."historico_nomina" USING "btree" ("empresa_id");



CREATE INDEX "idx_cierres_fecha" ON "public"."historico_nomina" USING "btree" ("fecha");



CREATE INDEX "idx_cierres_inventario_agrupado_empresa_fecha" ON "public"."cierres_inventario" USING "btree" ("empresa_id", "fecha" DESC);



CREATE INDEX "idx_cierres_locales" ON "public"."historico_nomina" USING "btree" ("locales");



CREATE INDEX "idx_cierres_responsable_id" ON "public"."historico_nomina" USING "btree" ("responsable_id");



CREATE INDEX "idx_empresa_configuracion_empresa_id" ON "public"."empresa_configuracion_nomina" USING "btree" ("empresa_id");



CREATE INDEX "idx_facturacion_empresa" ON "public"."facturacion" USING "btree" ("empresa_id");



CREATE INDEX "idx_gastos_costos_empresa_id" ON "public"."gastos_costos" USING "btree" ("empresa_id");



CREATE INDEX "idx_gastos_costos_fecha" ON "public"."gastos_costos" USING "btree" ("fecha");



CREATE INDEX "idx_gastos_costos_local_nombre" ON "public"."gastos_costos" USING "btree" ("local_nombre");



CREATE INDEX "idx_gastos_costos_pagado_a" ON "public"."gastos_costos" USING "btree" ("pagado_a_nombre");



CREATE INDEX "idx_gastos_costos_tipo_gasto" ON "public"."gastos_costos" USING "btree" ("tipo_gasto_id");



CREATE INDEX "idx_grupos_empresariales_activo" ON "public"."grupos_empresariales" USING "btree" ("activo");



CREATE INDEX "idx_grupos_empresariales_empresa_id" ON "public"."grupos_empresariales" USING "btree" ("empresa_id");



CREATE INDEX "idx_grupos_empresariales_grupo_id" ON "public"."grupos_empresariales" USING "btree" ("grupo_id");



CREATE INDEX "idx_historial_empresa" ON "public"."historial_facturacion" USING "btree" ("empresa_id");



CREATE INDEX "idx_historial_empresa_periodo" ON "public"."historial_facturacion" USING "btree" ("empresa_id", "periodo");



CREATE INDEX "idx_historial_periodo" ON "public"."historial_facturacion" USING "btree" ("periodo");



CREATE INDEX "idx_integracion_credibanco_client_id" ON "public"."integracion_credibanco" USING "btree" ("client_id");



CREATE INDEX "idx_integracion_credibanco_empresa_id" ON "public"."integracion_credibanco" USING "btree" ("empresa_id");



CREATE INDEX "idx_integracion_credibanco_is_active" ON "public"."integracion_credibanco" USING "btree" ("is_active");



CREATE INDEX "idx_pagadas_empresa" ON "public"."facturaciones_pagadas" USING "btree" ("empresa_id");



CREATE INDEX "idx_parametros_concepto" ON "public"."parametros_nomina" USING "btree" ("dimension_concepto_id");



CREATE INDEX "idx_parametros_empresa" ON "public"."parametros_nomina" USING "btree" ("empresa_id");



CREATE INDEX "idx_parametros_tiempo" ON "public"."parametros_nomina" USING "btree" ("dimension_tiempo_id");



CREATE INDEX "idx_parametros_valor" ON "public"."parametros_nomina" USING "btree" ("valor_monetario");



CREATE INDEX "idx_revision_empresa_estado" ON "public"."pagos_en_revision" USING "btree" ("empresa_id", "estado");



CREATE INDEX "idx_upm_empresa_modulo" ON "public"."usuarios_permisos_modulo" USING "btree" ("empresa_id", "modulo");



CREATE INDEX "idx_upm_empresa_usuario" ON "public"."usuarios_permisos_modulo" USING "btree" ("empresa_id", "usuario_id");



CREATE INDEX "idx_usuarios_locales_empresa" ON "public"."usuarios_locales" USING "btree" ("empresa_id");



CREATE INDEX "idx_usuarios_locales_usuario_principal" ON "public"."usuarios_locales" USING "btree" ("usuario_principal_id");



CREATE INDEX "metodos_pago_empresa_idx" ON "public"."metodos_pago" USING "btree" ("empresa_id", "activo", "orden");



CREATE INDEX "payment_attempts_billing_estado_idx" ON "public"."payment_attempts" USING "btree" ("billing_cycle_id", "estado");



CREATE INDEX "payment_attempts_empresa_created_idx" ON "public"."payment_attempts" USING "btree" ("empresa_id", "created_at");



CREATE UNIQUE INDEX "uq_integraciones_credenciales_empresa_plataforma" ON "public"."integraciones_credenciales" USING "btree" ("empresa_id", "plataforma");



CREATE OR REPLACE TRIGGER "tr_metodos_pago_set_updated_at" BEFORE UPDATE ON "public"."metodos_pago" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_empresas_create_billing_cycle" AFTER INSERT ON "public"."empresas" FOR EACH ROW EXECUTE FUNCTION "public"."empresas_create_billing_cycle"();



CREATE OR REPLACE TRIGGER "trg_empresas_sync_facturacion_ins" AFTER INSERT ON "public"."empresas" FOR EACH ROW EXECUTE FUNCTION "public"."sync_facturacion_from_empresas"();



CREATE OR REPLACE TRIGGER "trg_empresas_sync_facturacion_upd" AFTER UPDATE OF "plan", "plan_actual" ON "public"."empresas" FOR EACH ROW EXECUTE FUNCTION "public"."sync_facturacion_from_empresas"();



CREATE OR REPLACE TRIGGER "trg_facturacion_archivar" BEFORE UPDATE ON "public"."facturacion" FOR EACH ROW EXECUTE FUNCTION "public"."archivar_ciclo_antes_actualizar"();



CREATE OR REPLACE TRIGGER "trg_facturacion_updated_at" BEFORE UPDATE ON "public"."facturacion" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_historial_updated_at" BEFORE UPDATE ON "public"."historial_facturacion" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_payment_attempts_after_insert" AFTER INSERT ON "public"."payment_attempts" FOR EACH ROW EXECUTE FUNCTION "public"."on_payment_attempt_insert"();



CREATE OR REPLACE TRIGGER "trigger_actualizar_estado_resuelto" AFTER INSERT OR UPDATE ON "public"."facturas_empresas" FOR EACH ROW EXECUTE FUNCTION "public"."actualizar_estado_resuelto_automatico"();



CREATE OR REPLACE TRIGGER "trigger_apoyos_turno_updated_at" BEFORE UPDATE ON "public"."apoyos_turno" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_cierres_updated_at" BEFORE UPDATE ON "public"."historico_nomina" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_integracion_credibanco_updated_at" BEFORE UPDATE ON "public"."integracion_credibanco" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_parametros_updated_at" BEFORE UPDATE ON "public"."parametros_nomina" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_usuarios_locales_updated_at" BEFORE UPDATE ON "public"."usuarios_locales" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."otros_usuarios"
    ADD CONSTRAINT "administradores_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id");



ALTER TABLE ONLY "public"."apoyos_turno"
    ADD CONSTRAINT "apoyos_turno_apoyo_responsable_fkey" FOREIGN KEY ("apoyo_responsable_id") REFERENCES "public"."usuarios_sistema"("id");



ALTER TABLE ONLY "public"."apoyos_turno"
    ADD CONSTRAINT "apoyos_turno_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."apoyos_turno"
    ADD CONSTRAINT "apoyos_turno_responsable_turno_fkey" FOREIGN KEY ("responsable_turno_id") REFERENCES "public"."usuarios_sistema"("id");



ALTER TABLE ONLY "public"."billing_cycles"
    ADD CONSTRAINT "billing_cycles_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."billing_events"
    ADD CONSTRAINT "billing_events_billing_cycle_id_fkey" FOREIGN KEY ("billing_cycle_id") REFERENCES "public"."billing_cycles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."billing_events"
    ADD CONSTRAINT "billing_events_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."historico_nomina"
    ADD CONSTRAINT "cierres_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cierres_inventario"
    ADD CONSTRAINT "cierres_inventario_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id");



ALTER TABLE ONLY "public"."historico_nomina"
    ADD CONSTRAINT "cierres_responsable_id_fkey" FOREIGN KEY ("responsable_id") REFERENCES "public"."usuarios_sistema"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cierres_turno_final"
    ADD CONSTRAINT "cierres_turno_final_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id");



ALTER TABLE ONLY "public"."cierres_turno_final"
    ADD CONSTRAINT "cierres_turno_final_responsable_id_fkey" FOREIGN KEY ("responsable_id") REFERENCES "public"."usuarios_sistema"("id");



ALTER TABLE ONLY "public"."correos_empresas"
    ADD CONSTRAINT "correos_empresas_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id");



ALTER TABLE ONLY "public"."credenciales_plataforma"
    ADD CONSTRAINT "credenciales_plataforma_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id");



ALTER TABLE ONLY "public"."empleados"
    ADD CONSTRAINT "empleados_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id");



ALTER TABLE ONLY "public"."empresa_configuracion_nomina"
    ADD CONSTRAINT "empresa_configuracion_nomina_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."empresas"
    ADD CONSTRAINT "empresas_plan_fkey" FOREIGN KEY ("plan") REFERENCES "public"."planes"("id");



ALTER TABLE ONLY "public"."facturacion"
    ADD CONSTRAINT "facturacion_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."facturaciones_pagadas"
    ADD CONSTRAINT "facturaciones_pagadas_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."facturaciones_pagadas"
    ADD CONSTRAINT "facturaciones_pagadas_pago_revision_id_fkey" FOREIGN KEY ("pago_revision_id") REFERENCES "public"."pagos_en_revision"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."facturas_empresas"
    ADD CONSTRAINT "facturas_empresas_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id");



ALTER TABLE ONLY "public"."facturas_empresas_inconvenientes"
    ADD CONSTRAINT "facturas_empresas_inconvenientes_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id");



ALTER TABLE ONLY "public"."usuarios_sistema"
    ADD CONSTRAINT "fk_empresa" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."usuarios_locales"
    ADD CONSTRAINT "fk_empresa" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."usuarios_locales"
    ADD CONSTRAINT "fk_usuario_principal" FOREIGN KEY ("usuario_principal_id") REFERENCES "public"."usuarios_sistema"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."gastos_costos"
    ADD CONSTRAINT "gastos_costos_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."grupos_empresariales"
    ADD CONSTRAINT "grupos_empresariales_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."historial_facturacion"
    ADD CONSTRAINT "historial_facturacion_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."integracion_credibanco"
    ADD CONSTRAINT "integracion_credibanco_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."loggro_refrescar_token"
    ADD CONSTRAINT "loggro_refrescar_token_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id");



ALTER TABLE ONLY "public"."metodos_pago"
    ADD CONSTRAINT "metodos_pago_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."otros_usuarios"
    ADD CONSTRAINT "otros_usuarios_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id");



ALTER TABLE ONLY "public"."pagos_en_revision"
    ADD CONSTRAINT "pagos_en_revision_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pagos_en_revision"
    ADD CONSTRAINT "pagos_en_revision_facturacion_id_fkey" FOREIGN KEY ("facturacion_id") REFERENCES "public"."facturacion"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."parametros_nomina"
    ADD CONSTRAINT "parametros_nomina_dim_concepto_id_fkey" FOREIGN KEY ("dimension_concepto_id") REFERENCES "public"."dimensiones_concepto"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."parametros_nomina"
    ADD CONSTRAINT "parametros_nomina_dim_tiempo_id_fkey" FOREIGN KEY ("dimension_tiempo_id") REFERENCES "public"."dimensiones_tiempo"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."parametros_nomina"
    ADD CONSTRAINT "parametros_nomina_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_attempts"
    ADD CONSTRAINT "payment_attempts_billing_cycle_id_fkey" FOREIGN KEY ("billing_cycle_id") REFERENCES "public"."billing_cycles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_attempts"
    ADD CONSTRAINT "payment_attempts_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_attempts"
    ADD CONSTRAINT "payment_attempts_revisado_por_fkey" FOREIGN KEY ("revisado_por") REFERENCES "public"."system_users"("id");



ALTER TABLE ONLY "public"."usuarios_sistema"
    ADD CONSTRAINT "usuarios_sistema_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id");



CREATE POLICY "Cualquiera puede ver conceptos" ON "public"."dimensiones_concepto" FOR SELECT USING (true);



CREATE POLICY "Cualquiera puede ver dimensiones" ON "public"."dimensiones_tiempo" FOR SELECT USING (true);



CREATE POLICY "Empresa actualiza sus parámetros" ON "public"."parametros_nomina" FOR UPDATE USING (("auth"."uid"() = "empresa_id"));



CREATE POLICY "Empresa elimina sus parámetros" ON "public"."parametros_nomina" FOR DELETE USING (("auth"."uid"() = "empresa_id"));



CREATE POLICY "Empresa inserta sus parámetros" ON "public"."parametros_nomina" FOR INSERT WITH CHECK (("auth"."uid"() = "empresa_id"));



CREATE POLICY "Empresa ve sus parámetros" ON "public"."parametros_nomina" FOR SELECT USING (("auth"."uid"() = "empresa_id"));



CREATE POLICY "Permitir actualización a administradores de la empresa" ON "public"."integraciones_credenciales" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios_sistema"
  WHERE (("usuarios_sistema"."id" = "auth"."uid"()) AND ("usuarios_sistema"."empresa_id" = "integraciones_credenciales"."empresa_id") AND ("usuarios_sistema"."rol" = 'administrador'::"text")))));



CREATE POLICY "Permitir inserción a administradores de la empresa" ON "public"."integraciones_credenciales" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."usuarios_sistema"
  WHERE (("usuarios_sistema"."id" = "auth"."uid"()) AND ("usuarios_sistema"."empresa_id" = "integraciones_credenciales"."empresa_id") AND ("usuarios_sistema"."rol" = 'administrador'::"text")))));



CREATE POLICY "Solo admin puede modificar conceptos" ON "public"."dimensiones_concepto" USING (("auth"."role"() = 'admin'::"text"));



CREATE POLICY "Solo admin puede modificar dimensiones" ON "public"."dimensiones_tiempo" USING (("auth"."role"() = 'admin'::"text"));



ALTER TABLE "public"."apoyos_turno" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."apoyos_turno_locales" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "apoyos_turno_locales_delete" ON "public"."apoyos_turno_locales" FOR DELETE USING ("public"."is_super_admin"());



CREATE POLICY "apoyos_turno_locales_insert" ON "public"."apoyos_turno_locales" FOR INSERT WITH CHECK (("public"."is_super_admin"() OR ("empresa_id" = "public"."get_my_empresa_id"()) OR ("empresa_id" IN ( SELECT "public"."get_empresas_del_grupo"() AS "get_empresas_del_grupo"))));



CREATE POLICY "apoyos_turno_locales_select" ON "public"."apoyos_turno_locales" FOR SELECT USING (true);



CREATE POLICY "apoyos_turno_locales_update" ON "public"."apoyos_turno_locales" FOR UPDATE USING (("public"."is_super_admin"() OR ("empresa_id" = "public"."get_my_empresa_id"()) OR ("empresa_id" IN ( SELECT "public"."get_empresas_del_grupo"() AS "get_empresas_del_grupo")))) WITH CHECK (("public"."is_super_admin"() OR ("empresa_id" = "public"."get_my_empresa_id"()) OR ("empresa_id" IN ( SELECT "public"."get_empresas_del_grupo"() AS "get_empresas_del_grupo"))));



ALTER TABLE "public"."billing_cycles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "billing_cycles_insert_delete_superadmin" ON "public"."billing_cycles" USING ("public"."is_super_admin"());



CREATE POLICY "billing_cycles_select" ON "public"."billing_cycles" FOR SELECT USING (("public"."is_super_admin"() OR ("empresa_id" = "public"."get_my_empresa_id"())));



CREATE POLICY "billing_cycles_update" ON "public"."billing_cycles" FOR UPDATE USING ("public"."is_super_admin"());



ALTER TABLE "public"."billing_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "billing_events_all_superadmin" ON "public"."billing_events" USING ("public"."is_super_admin"());



CREATE POLICY "billing_events_select" ON "public"."billing_events" FOR SELECT USING (("public"."is_super_admin"() OR ("empresa_id" = "public"."get_my_empresa_id"())));



ALTER TABLE "public"."cierres_inventario" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cierres_inventario_all_tenant_or_super" ON "public"."cierres_inventario" USING (("public"."is_super_admin"() OR ("empresa_id" = "public"."get_my_empresa_id"()) OR (EXISTS ( SELECT 1
   FROM "public"."grupos_empresariales" "ge"
  WHERE (("ge"."empresa_id" = "ge"."empresa_id") AND ("ge"."empresa_id" = "public"."get_my_empresa_id"()))))));



CREATE POLICY "cierres_inventario_select" ON "public"."cierres_inventario" FOR SELECT USING (("public"."is_super_admin"() OR ("empresa_id" = "public"."get_my_empresa_id"()) OR (EXISTS ( SELECT 1
   FROM "public"."grupos_empresariales" "ge"
  WHERE (("ge"."empresa_id" = "ge"."empresa_id") AND ("ge"."empresa_id" = "public"."get_my_empresa_id"()))))));



ALTER TABLE "public"."cierres_turno_final" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cierres_turno_final_all_tenant_or_super" ON "public"."cierres_turno_final" USING (("public"."is_super_admin"() OR ("empresa_id" = "public"."get_my_empresa_id"()) OR (EXISTS ( SELECT 1
   FROM "public"."grupos_empresariales" "ge"
  WHERE (("ge"."empresa_id" = "ge"."empresa_id") AND ("ge"."empresa_id" = "public"."get_my_empresa_id"()))))));



ALTER TABLE "public"."cierres_turno_final_locales" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cierres_turno_final_locales_delete" ON "public"."cierres_turno_final_locales" FOR DELETE USING ("public"."is_super_admin"());



CREATE POLICY "cierres_turno_final_locales_insert" ON "public"."cierres_turno_final_locales" FOR INSERT WITH CHECK (("public"."is_super_admin"() OR ("empresa_id" = "public"."get_my_empresa_id"()) OR ("empresa_id" IN ( SELECT "public"."get_empresas_del_grupo"() AS "get_empresas_del_grupo"))));



CREATE POLICY "cierres_turno_final_locales_select" ON "public"."cierres_turno_final_locales" FOR SELECT USING (true);



CREATE POLICY "cierres_turno_final_locales_update" ON "public"."cierres_turno_final_locales" FOR UPDATE USING (("public"."is_super_admin"() OR ("empresa_id" = "public"."get_my_empresa_id"()) OR ("empresa_id" IN ( SELECT "public"."get_empresas_del_grupo"() AS "get_empresas_del_grupo")))) WITH CHECK (("public"."is_super_admin"() OR ("empresa_id" = "public"."get_my_empresa_id"()) OR ("empresa_id" IN ( SELECT "public"."get_empresas_del_grupo"() AS "get_empresas_del_grupo"))));



CREATE POLICY "cierres_turno_final_select" ON "public"."cierres_turno_final" FOR SELECT USING (("public"."is_super_admin"() OR ("empresa_id" = "public"."get_my_empresa_id"()) OR (EXISTS ( SELECT 1
   FROM "public"."grupos_empresariales" "ge"
  WHERE (("ge"."empresa_id" = "ge"."empresa_id") AND ("ge"."empresa_id" = "public"."get_my_empresa_id"()))))));



ALTER TABLE "public"."correos_empresas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "correos_empresas_all_tenant_or_super" ON "public"."correos_empresas" USING (("public"."is_super_admin"() OR ("empresa_id" = "public"."get_my_empresa_id"())));



CREATE POLICY "correos_empresas_select" ON "public"."correos_empresas" FOR SELECT USING (("public"."is_super_admin"() OR ("empresa_id" = "public"."get_my_empresa_id"())));



ALTER TABLE "public"."credenciales_plataforma" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "credenciales_plataforma_all_tenant_or_super" ON "public"."credenciales_plataforma" USING (("public"."is_super_admin"() OR ("empresa_id" = "public"."get_my_empresa_id"())));



CREATE POLICY "credenciales_plataforma_select" ON "public"."credenciales_plataforma" FOR SELECT USING (("public"."is_super_admin"() OR ("empresa_id" = "public"."get_my_empresa_id"())));



ALTER TABLE "public"."dimensiones_concepto" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dimensiones_tiempo" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."empleados" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "empleados_insert_update_delete_tenant_or_super" ON "public"."empleados" USING (("public"."is_super_admin"() OR ("empresa_id" = "public"."get_my_empresa_id"())));



CREATE POLICY "empleados_select" ON "public"."empleados" FOR SELECT USING (("public"."is_super_admin"() OR ("empresa_id" = "public"."get_my_empresa_id"())));



ALTER TABLE "public"."empresa_configuracion_nomina" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."empresas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "empresas_delete_superadmin" ON "public"."empresas" FOR DELETE USING ("public"."is_super_admin"());



CREATE POLICY "empresas_insert_superadmin" ON "public"."empresas" FOR INSERT WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "empresas_select_public" ON "public"."empresas" FOR SELECT USING (true);



CREATE POLICY "empresas_update_own" ON "public"."empresas" FOR UPDATE USING (("public"."is_super_admin"() OR ("id" = "public"."get_my_empresa_id"()))) WITH CHECK (("public"."is_super_admin"() OR ("id" = "public"."get_my_empresa_id"())));



ALTER TABLE "public"."facturacion" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "facturacion_all_superadmin" ON "public"."facturacion" USING ("public"."is_super_admin"());



CREATE POLICY "facturacion_select" ON "public"."facturacion" FOR SELECT USING (("public"."is_super_admin"() OR ("empresa_id" = "public"."get_my_empresa_id"())));



ALTER TABLE "public"."facturaciones_pagadas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "facturaciones_pagadas_all_superadmin" ON "public"."facturaciones_pagadas" USING ("public"."is_super_admin"());



CREATE POLICY "facturaciones_pagadas_select" ON "public"."facturaciones_pagadas" FOR SELECT USING (("public"."is_super_admin"() OR ("empresa_id" = "public"."get_my_empresa_id"())));



ALTER TABLE "public"."facturas_empresas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "facturas_empresas_all_tenant_or_super" ON "public"."facturas_empresas" USING (("public"."is_super_admin"() OR ("empresa_id" = "public"."get_my_empresa_id"())));



ALTER TABLE "public"."facturas_empresas_inconvenientes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "facturas_empresas_inconvenientes_all_tenant_or_super" ON "public"."facturas_empresas_inconvenientes" USING (("public"."is_super_admin"() OR ("empresa_id" = "public"."get_my_empresa_id"())));



CREATE POLICY "facturas_empresas_inconvenientes_select" ON "public"."facturas_empresas_inconvenientes" FOR SELECT USING (("public"."is_super_admin"() OR ("empresa_id" = "public"."get_my_empresa_id"())));



CREATE POLICY "facturas_empresas_select" ON "public"."facturas_empresas" FOR SELECT USING (("public"."is_super_admin"() OR ("empresa_id" = "public"."get_my_empresa_id"())));



ALTER TABLE "public"."gastos_costos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."grupos_empresariales" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "grupos_empresariales_all_authenticated" ON "public"."grupos_empresariales" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "grupos_empresariales_select_all" ON "public"."grupos_empresariales" FOR SELECT USING (true);



ALTER TABLE "public"."historial_facturacion" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."historico_nomina" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."integracion_credibanco" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."integraciones_credenciales" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."loggro_refrescar_token" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."metodos_pago" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "metodos_pago_all_superadmin" ON "public"."metodos_pago" USING ("public"."is_super_admin"());



CREATE POLICY "metodos_pago_select" ON "public"."metodos_pago" FOR SELECT USING (true);



ALTER TABLE "public"."otros_usuarios" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "otros_usuarios_insert_update_delete_tenant_or_super" ON "public"."otros_usuarios" USING (("public"."is_super_admin"() OR ("empresa_id" = "public"."get_my_empresa_id"())));



CREATE POLICY "otros_usuarios_select" ON "public"."otros_usuarios" FOR SELECT USING (("public"."is_super_admin"() OR ("id" = "auth"."uid"()) OR ("empresa_id" = "public"."get_my_empresa_id"())));



ALTER TABLE "public"."pagos_en_revision" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pagos_en_revision_all_superadmin" ON "public"."pagos_en_revision" USING ("public"."is_super_admin"());



CREATE POLICY "pagos_en_revision_select" ON "public"."pagos_en_revision" FOR SELECT USING (("public"."is_super_admin"() OR ("empresa_id" = "public"."get_my_empresa_id"())));



ALTER TABLE "public"."parametros_nomina" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "parametros_nomina_all_tenant_or_super" ON "public"."parametros_nomina" USING (("public"."is_super_admin"() OR ("empresa_id" = "public"."get_my_empresa_id"())));



CREATE POLICY "parametros_nomina_select" ON "public"."parametros_nomina" FOR SELECT USING (("public"."is_super_admin"() OR ("empresa_id" = "public"."get_my_empresa_id"())));



ALTER TABLE "public"."payment_attempts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "payment_attempts_insert" ON "public"."payment_attempts" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."billing_cycles" "bc"
  WHERE (("bc"."id" = "payment_attempts"."billing_cycle_id") AND ("bc"."empresa_id" = "public"."get_my_empresa_id"())))));



CREATE POLICY "payment_attempts_select" ON "public"."payment_attempts" FOR SELECT USING (("public"."is_super_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."billing_cycles" "bc"
  WHERE (("bc"."id" = "payment_attempts"."billing_cycle_id") AND ("bc"."empresa_id" = "public"."get_my_empresa_id"()))))));



CREATE POLICY "payment_attempts_update_delete_superadmin" ON "public"."payment_attempts" USING ("public"."is_super_admin"());



ALTER TABLE "public"."planes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "planes_all_superadmin" ON "public"."planes" USING ("public"."is_super_admin"());



CREATE POLICY "planes_select_all" ON "public"."planes" FOR SELECT USING (true);



ALTER TABLE "public"."roles_permisos_modulo" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "roles_permisos_modulo_all_superadmin" ON "public"."roles_permisos_modulo" USING ("public"."is_super_admin"());



CREATE POLICY "roles_permisos_modulo_select" ON "public"."roles_permisos_modulo" FOR SELECT USING (true);



ALTER TABLE "public"."system_users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "system_users_all_superadmin" ON "public"."system_users" USING ("public"."is_super_admin"());



CREATE POLICY "system_users_select" ON "public"."system_users" FOR SELECT USING (("public"."is_super_admin"() OR ("id" = "auth"."uid"())));



ALTER TABLE "public"."usuarios_locales" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "usuarios_locales_delete" ON "public"."usuarios_locales" FOR DELETE USING ("public"."is_super_admin"());



CREATE POLICY "usuarios_locales_insert" ON "public"."usuarios_locales" FOR INSERT WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "usuarios_locales_select" ON "public"."usuarios_locales" FOR SELECT USING (true);



CREATE POLICY "usuarios_locales_update" ON "public"."usuarios_locales" FOR UPDATE USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



ALTER TABLE "public"."usuarios_permisos_modulo" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "usuarios_permisos_modulo_all_tenant_or_super" ON "public"."usuarios_permisos_modulo" USING (("public"."is_super_admin"() OR ("empresa_id" = "public"."get_my_empresa_id"())));



CREATE POLICY "usuarios_permisos_modulo_select" ON "public"."usuarios_permisos_modulo" FOR SELECT USING (("public"."is_super_admin"() OR ("empresa_id" = "public"."get_my_empresa_id"())));



ALTER TABLE "public"."usuarios_sistema" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "usuarios_sistema_insert_delete_superadmin" ON "public"."usuarios_sistema" USING ("public"."is_super_admin"());



CREATE POLICY "usuarios_sistema_select" ON "public"."usuarios_sistema" FOR SELECT USING (("public"."is_super_admin"() OR ("id" = "auth"."uid"()) OR ("empresa_id" = "public"."get_my_empresa_id"())));



CREATE POLICY "usuarios_sistema_update" ON "public"."usuarios_sistema" FOR UPDATE USING ((("id" = "auth"."uid"()) OR "public"."is_super_admin"()));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";





GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";











































































































































































GRANT ALL ON FUNCTION "public"."actualizar_estado_resuelto_automatico"() TO "anon";
GRANT ALL ON FUNCTION "public"."actualizar_estado_resuelto_automatico"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."actualizar_estado_resuelto_automatico"() TO "service_role";



GRANT ALL ON FUNCTION "public"."actualizar_vista_automaticamente"() TO "anon";
GRANT ALL ON FUNCTION "public"."actualizar_vista_automaticamente"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."actualizar_vista_automaticamente"() TO "service_role";



GRANT ALL ON FUNCTION "public"."archivar_ciclo_antes_actualizar"() TO "anon";
GRANT ALL ON FUNCTION "public"."archivar_ciclo_antes_actualizar"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."archivar_ciclo_antes_actualizar"() TO "service_role";



GRANT ALL ON FUNCTION "public"."billing_daily_enforcer"() TO "anon";
GRANT ALL ON FUNCTION "public"."billing_daily_enforcer"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."billing_daily_enforcer"() TO "service_role";



GRANT ALL ON FUNCTION "public"."create_billing_cycles_for_period"("p_periodo" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."create_billing_cycles_for_period"("p_periodo" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_billing_cycles_for_period"("p_periodo" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."current_empresa_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_empresa_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_empresa_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."empresa_es_solo_lectura"("p_empresa_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."empresa_es_solo_lectura"("p_empresa_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."empresa_es_solo_lectura"("p_empresa_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."empresa_puede_operar"("p_empresa_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."empresa_puede_operar"("p_empresa_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."empresa_puede_operar"("p_empresa_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."empresas_create_billing_cycle"() TO "anon";
GRANT ALL ON FUNCTION "public"."empresas_create_billing_cycle"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."empresas_create_billing_cycle"() TO "service_role";



GRANT ALL ON FUNCTION "public"."ensure_billing_cycle"("p_empresa_id" "uuid", "p_periodo" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_billing_cycle"("p_empresa_id" "uuid", "p_periodo" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_billing_cycle"("p_empresa_id" "uuid", "p_periodo" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."generar_vista_cierres_dinamica"() TO "anon";
GRANT ALL ON FUNCTION "public"."generar_vista_cierres_dinamica"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generar_vista_cierres_dinamica"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_empresas_del_grupo"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_empresas_del_grupo"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_empresas_del_grupo"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_my_context"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_context"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_context"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_my_empresa_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_empresa_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_empresa_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."obtener_estructura_vista"() TO "anon";
GRANT ALL ON FUNCTION "public"."obtener_estructura_vista"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."obtener_estructura_vista"() TO "service_role";



GRANT ALL ON FUNCTION "public"."obtener_historico_inventarios"("p_empresa_id" "uuid", "p_limit" integer, "p_offset" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."obtener_historico_inventarios"("p_empresa_id" "uuid", "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."obtener_historico_inventarios"("p_empresa_id" "uuid", "p_limit" integer, "p_offset" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."on_payment_attempt_insert"() TO "anon";
GRANT ALL ON FUNCTION "public"."on_payment_attempt_insert"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."on_payment_attempt_insert"() TO "service_role";



GRANT ALL ON FUNCTION "public"."plan_price"("p_plan" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."plan_price"("p_plan" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."plan_price"("p_plan" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."registrar_empresa_self_service"("p_nombre_comercial" "text", "p_razon_social" "text", "p_nit" "text", "p_correo_empresa" "text", "p_nombre_completo" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."registrar_empresa_self_service"("p_nombre_comercial" "text", "p_razon_social" "text", "p_nit" "text", "p_correo_empresa" "text", "p_nombre_completo" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_empresa_self_service"("p_nombre_comercial" "text", "p_razon_social" "text", "p_nit" "text", "p_correo_empresa" "text", "p_nombre_completo" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."resolver_pago_revision"("p_revision_id" "uuid", "p_aprobar" boolean, "p_revisado_por" "uuid", "p_observaciones" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."resolver_pago_revision"("p_revision_id" "uuid", "p_aprobar" boolean, "p_revisado_por" "uuid", "p_observaciones" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolver_pago_revision"("p_revision_id" "uuid", "p_aprobar" boolean, "p_revisado_por" "uuid", "p_observaciones" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_facturacion_from_empresas"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_facturacion_from_empresas"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_facturacion_from_empresas"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_gastos_costos_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_gastos_costos_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_gastos_costos_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_last_used_credibanco"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_last_used_credibanco"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_last_used_credibanco"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";
























GRANT ALL ON TABLE "public"."apoyos_turno" TO "anon";
GRANT ALL ON TABLE "public"."apoyos_turno" TO "authenticated";
GRANT ALL ON TABLE "public"."apoyos_turno" TO "service_role";



GRANT ALL ON TABLE "public"."apoyos_turno_locales" TO "anon";
GRANT ALL ON TABLE "public"."apoyos_turno_locales" TO "authenticated";
GRANT ALL ON TABLE "public"."apoyos_turno_locales" TO "service_role";



GRANT ALL ON TABLE "public"."billing_cycles" TO "anon";
GRANT ALL ON TABLE "public"."billing_cycles" TO "authenticated";
GRANT ALL ON TABLE "public"."billing_cycles" TO "service_role";



GRANT ALL ON TABLE "public"."billing_events" TO "anon";
GRANT ALL ON TABLE "public"."billing_events" TO "authenticated";
GRANT ALL ON TABLE "public"."billing_events" TO "service_role";



GRANT ALL ON TABLE "public"."cierres_inventario" TO "anon";
GRANT ALL ON TABLE "public"."cierres_inventario" TO "authenticated";
GRANT ALL ON TABLE "public"."cierres_inventario" TO "service_role";



GRANT ALL ON TABLE "public"."cierres_inventario_agrupado" TO "anon";
GRANT ALL ON TABLE "public"."cierres_inventario_agrupado" TO "authenticated";
GRANT ALL ON TABLE "public"."cierres_inventario_agrupado" TO "service_role";



GRANT ALL ON TABLE "public"."cierres_turno_final" TO "anon";
GRANT ALL ON TABLE "public"."cierres_turno_final" TO "authenticated";
GRANT ALL ON TABLE "public"."cierres_turno_final" TO "service_role";



GRANT ALL ON TABLE "public"."cierres_turno_final_locales" TO "anon";
GRANT ALL ON TABLE "public"."cierres_turno_final_locales" TO "authenticated";
GRANT ALL ON TABLE "public"."cierres_turno_final_locales" TO "service_role";



GRANT ALL ON TABLE "public"."correos_empresas" TO "anon";
GRANT ALL ON TABLE "public"."correos_empresas" TO "authenticated";
GRANT ALL ON TABLE "public"."correos_empresas" TO "service_role";



GRANT ALL ON TABLE "public"."credenciales_plataforma" TO "anon";
GRANT ALL ON TABLE "public"."credenciales_plataforma" TO "authenticated";
GRANT ALL ON TABLE "public"."credenciales_plataforma" TO "service_role";



GRANT ALL ON TABLE "public"."dimensiones_concepto" TO "anon";
GRANT ALL ON TABLE "public"."dimensiones_concepto" TO "authenticated";
GRANT ALL ON TABLE "public"."dimensiones_concepto" TO "service_role";



GRANT ALL ON TABLE "public"."dimensiones_tiempo" TO "anon";
GRANT ALL ON TABLE "public"."dimensiones_tiempo" TO "authenticated";
GRANT ALL ON TABLE "public"."dimensiones_tiempo" TO "service_role";



GRANT ALL ON TABLE "public"."empleados" TO "anon";
GRANT ALL ON TABLE "public"."empleados" TO "authenticated";
GRANT ALL ON TABLE "public"."empleados" TO "service_role";



GRANT ALL ON TABLE "public"."empresa_configuracion_nomina" TO "anon";
GRANT ALL ON TABLE "public"."empresa_configuracion_nomina" TO "authenticated";
GRANT ALL ON TABLE "public"."empresa_configuracion_nomina" TO "service_role";



GRANT ALL ON TABLE "public"."empresas" TO "anon";
GRANT ALL ON TABLE "public"."empresas" TO "authenticated";
GRANT ALL ON TABLE "public"."empresas" TO "service_role";



GRANT ALL ON TABLE "public"."facturacion" TO "anon";
GRANT ALL ON TABLE "public"."facturacion" TO "authenticated";
GRANT ALL ON TABLE "public"."facturacion" TO "service_role";



GRANT ALL ON TABLE "public"."facturaciones_pagadas" TO "anon";
GRANT ALL ON TABLE "public"."facturaciones_pagadas" TO "authenticated";
GRANT ALL ON TABLE "public"."facturaciones_pagadas" TO "service_role";



GRANT ALL ON TABLE "public"."facturas_empresas" TO "anon";
GRANT ALL ON TABLE "public"."facturas_empresas" TO "authenticated";
GRANT ALL ON TABLE "public"."facturas_empresas" TO "service_role";



GRANT ALL ON TABLE "public"."facturas_empresas_inconvenientes" TO "anon";
GRANT ALL ON TABLE "public"."facturas_empresas_inconvenientes" TO "authenticated";
GRANT ALL ON TABLE "public"."facturas_empresas_inconvenientes" TO "service_role";



GRANT ALL ON TABLE "public"."gastos_costos" TO "anon";
GRANT ALL ON TABLE "public"."gastos_costos" TO "authenticated";
GRANT ALL ON TABLE "public"."gastos_costos" TO "service_role";



GRANT ALL ON TABLE "public"."grupos_empresariales" TO "anon";
GRANT ALL ON TABLE "public"."grupos_empresariales" TO "authenticated";
GRANT ALL ON TABLE "public"."grupos_empresariales" TO "service_role";



GRANT ALL ON TABLE "public"."historial_facturacion" TO "anon";
GRANT ALL ON TABLE "public"."historial_facturacion" TO "authenticated";
GRANT ALL ON TABLE "public"."historial_facturacion" TO "service_role";



GRANT ALL ON TABLE "public"."historico_nomina" TO "anon";
GRANT ALL ON TABLE "public"."historico_nomina" TO "authenticated";
GRANT ALL ON TABLE "public"."historico_nomina" TO "service_role";



GRANT ALL ON TABLE "public"."integracion_credibanco" TO "anon";
GRANT ALL ON TABLE "public"."integracion_credibanco" TO "authenticated";
GRANT ALL ON TABLE "public"."integracion_credibanco" TO "service_role";



GRANT ALL ON TABLE "public"."integraciones_credenciales" TO "anon";
GRANT ALL ON TABLE "public"."integraciones_credenciales" TO "authenticated";
GRANT ALL ON TABLE "public"."integraciones_credenciales" TO "service_role";



GRANT ALL ON TABLE "public"."loggro_refrescar_token" TO "anon";
GRANT ALL ON TABLE "public"."loggro_refrescar_token" TO "authenticated";
GRANT ALL ON TABLE "public"."loggro_refrescar_token" TO "service_role";



GRANT ALL ON TABLE "public"."metodos_pago" TO "anon";
GRANT ALL ON TABLE "public"."metodos_pago" TO "authenticated";
GRANT ALL ON TABLE "public"."metodos_pago" TO "service_role";



GRANT ALL ON TABLE "public"."otros_usuarios" TO "anon";
GRANT ALL ON TABLE "public"."otros_usuarios" TO "authenticated";
GRANT ALL ON TABLE "public"."otros_usuarios" TO "service_role";



GRANT ALL ON TABLE "public"."pagos_en_revision" TO "anon";
GRANT ALL ON TABLE "public"."pagos_en_revision" TO "authenticated";
GRANT ALL ON TABLE "public"."pagos_en_revision" TO "service_role";



GRANT ALL ON TABLE "public"."parametros_nomina" TO "anon";
GRANT ALL ON TABLE "public"."parametros_nomina" TO "authenticated";
GRANT ALL ON TABLE "public"."parametros_nomina" TO "service_role";



GRANT ALL ON TABLE "public"."payment_attempts" TO "anon";
GRANT ALL ON TABLE "public"."payment_attempts" TO "authenticated";
GRANT ALL ON TABLE "public"."payment_attempts" TO "service_role";



GRANT ALL ON TABLE "public"."planes" TO "anon";
GRANT ALL ON TABLE "public"."planes" TO "authenticated";
GRANT ALL ON TABLE "public"."planes" TO "service_role";



GRANT ALL ON TABLE "public"."roles_permisos_modulo" TO "anon";
GRANT ALL ON TABLE "public"."roles_permisos_modulo" TO "authenticated";
GRANT ALL ON TABLE "public"."roles_permisos_modulo" TO "service_role";



GRANT ALL ON TABLE "public"."system_users" TO "anon";
GRANT ALL ON TABLE "public"."system_users" TO "authenticated";
GRANT ALL ON TABLE "public"."system_users" TO "service_role";



GRANT ALL ON TABLE "public"."turnos_agrupados" TO "anon";
GRANT ALL ON TABLE "public"."turnos_agrupados" TO "authenticated";
GRANT ALL ON TABLE "public"."turnos_agrupados" TO "service_role";



GRANT ALL ON TABLE "public"."turnos_agrupados_locales" TO "anon";
GRANT ALL ON TABLE "public"."turnos_agrupados_locales" TO "authenticated";
GRANT ALL ON TABLE "public"."turnos_agrupados_locales" TO "service_role";



GRANT ALL ON TABLE "public"."usuarios_locales" TO "anon";
GRANT ALL ON TABLE "public"."usuarios_locales" TO "authenticated";
GRANT ALL ON TABLE "public"."usuarios_locales" TO "service_role";



GRANT ALL ON TABLE "public"."usuarios_permisos_modulo" TO "anon";
GRANT ALL ON TABLE "public"."usuarios_permisos_modulo" TO "authenticated";
GRANT ALL ON TABLE "public"."usuarios_permisos_modulo" TO "service_role";



GRANT ALL ON TABLE "public"."usuarios_sistema" TO "anon";
GRANT ALL ON TABLE "public"."usuarios_sistema" TO "authenticated";
GRANT ALL ON TABLE "public"."usuarios_sistema" TO "service_role";



GRANT ALL ON TABLE "public"."v_permisos_con_plan" TO "anon";
GRANT ALL ON TABLE "public"."v_permisos_con_plan" TO "authenticated";
GRANT ALL ON TABLE "public"."v_permisos_con_plan" TO "service_role";



GRANT ALL ON TABLE "public"."v_permisos_efectivos" TO "anon";
GRANT ALL ON TABLE "public"."v_permisos_efectivos" TO "authenticated";
GRANT ALL ON TABLE "public"."v_permisos_efectivos" TO "service_role";



GRANT ALL ON TABLE "public"."vista_cierres_inventario" TO "anon";
GRANT ALL ON TABLE "public"."vista_cierres_inventario" TO "authenticated";
GRANT ALL ON TABLE "public"."vista_cierres_inventario" TO "service_role";



GRANT ALL ON TABLE "public"."vista_facturas_agrupadas" TO "anon";
GRANT ALL ON TABLE "public"."vista_facturas_agrupadas" TO "authenticated";
GRANT ALL ON TABLE "public"."vista_facturas_agrupadas" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































