-- ============================================================================
-- FACTURACIÓN · FASE 4 (b) — Programar el ciclo diario
--
-- Llama a la Edge Function cron-facturacion todos los días a las 09:10 de
-- Colombia (14:10 UTC), diez minutos después del enforcer para no solaparse.
--
-- El secreto NO se escribe aquí: se reutiliza el CRON_SECRET que ya lleva la
-- tarea de Loggro, leyéndolo de cron.job en tiempo de ejecución. Así este
-- archivo puede vivir en el repositorio sin filtrar nada.
-- ============================================================================

begin;

do $$
declare
  v_secreto text;
  v_url     text := 'https://tgkvcvnwwnrlyhbqmhaf.supabase.co/functions/v1/cron-facturacion';
begin
  -- Extraer el CRON_SECRET del comando de la tarea que ya existe.
  select (regexp_match(command, '''x-cron-secret''\s*,\s*''([^'']+)'''))[1]
  into v_secreto
  from cron.job
  where jobname = 'refrescar-token-loggro'
  limit 1;

  if v_secreto is null then
    raise exception 'No se pudo leer CRON_SECRET de la tarea refrescar-token-loggro. '
                    'Programa la tarea a mano con el secreto correcto.';
  end if;

  perform cron.unschedule('facturacion-ciclo-diario')
  where exists (select 1 from cron.job where jobname = 'facturacion-ciclo-diario');

  perform cron.schedule(
    'facturacion-ciclo-diario',
    '10 14 * * *',
    format(
      $cmd$SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',%L),
        body := '{}'::jsonb
      );$cmd$,
      v_url, v_secreto
    )
  );
end $$;

commit;
