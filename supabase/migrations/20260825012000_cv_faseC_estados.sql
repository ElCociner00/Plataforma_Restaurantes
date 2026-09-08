-- ============================================================================
-- CICLO DE VIDA · FASE C (a) — Estados y niveles de acceso
--
-- Contexto: docs/2026-08-25_plan_ciclo_de_vida_cliente.md §2
--
-- La máquina de estados completa:
--
--   registrada ──30 días sin activar──► bloqueada_sin_activar
--       │  │                                    │ un admin desbloquea
--       │  └──(admin marca montaje)──► implementacion  (reloj PARADO)
--       │                                       │
--       └──── el cliente pulsa "Activar" ◄──────┘
--                        ▼
--                     prueba (15 días)
--                        ▼
--                     activa ◄────paga──── morosa
--                        │                   ▲
--                        │  factura vencida  │
--                        └───────────────────┘
--                        │
--                        └── el cliente pide la baja ──► cancelada
--                                                            │ 90 días
--                                                            ▼
--                                                        purgada
--
-- REGLA CLAVE (§2.4): se restringe a quien NUNCA empezó y a quien decidió
-- irse. NO se restringe a un cliente que está operando y debe dinero: eso
-- sigue en modo observación, esperando autorización explícita.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Estados nuevos
-- ----------------------------------------------------------------------------
alter table public.cuentas       drop constraint if exists cuentas_estado_check;
alter table public.suscripciones drop constraint if exists suscripciones_estado_check;

alter table public.cuentas
  add constraint cuentas_estado_check check (estado in (
    'registrada', 'implementacion', 'prueba', 'activa', 'morosa',
    'restringida', 'bloqueada_sin_activar', 'cancelada', 'purgada'
  ));

alter table public.suscripciones
  add constraint suscripciones_estado_check check (estado in (
    'registrada', 'implementacion', 'prueba', 'activa', 'morosa',
    'restringida', 'bloqueada_sin_activar', 'cancelada', 'purgada'
  ));

-- ----------------------------------------------------------------------------
-- 2. Campos del ciclo de vida
-- ----------------------------------------------------------------------------
alter table public.cuentas
  add column if not exists registrada_en       date,
  -- Fecha límite para que el cliente pulse "Activar mi prueba". Se pone a NULL
  -- mientras la cuenta está en implementación: ese es el "reloj parado".
  add column if not exists activacion_limite   date,
  add column if not exists cancelada_en        date,
  add column if not exists motivo_cancelacion  text,
  -- Cuándo tocaría borrar los datos. Se calcula al cancelar (cancelada + 90),
  -- pero HOY NO HAY NINGÚN PROCESO QUE BORRE: la purga está pendiente a
  -- petición de Andrés. Esta columna solo lleva la cuenta atrás.
  add column if not exists purgar_desde        date,
  add column if not exists reactivada_en       date,
  add column if not exists bloqueada_en        date;

comment on column public.cuentas.activacion_limite is
  'Hasta cuándo puede el cliente activar su prueba. NULL = reloj parado (cuenta en implementación).';
comment on column public.cuentas.purgar_desde is
  'Fecha a partir de la cual los datos serían borrables. Informativa: la purga no está implementada todavía.';

update public.cuentas
set registrada_en = coalesce(registrada_en, created_at::date)
where registrada_en is null;

-- ----------------------------------------------------------------------------
-- 3. acceso_de_empresa() — el único sitio que decide qué puede hacer alguien
--
-- Sustituye a la mezcla actual de empresas.activa, empresas.activo, plan,
-- plan_actual y mostrar_anuncio_impago, que se contradicen entre sí.
--
-- Devuelve nivel + motivo + mensaje, para que la interfaz pueda EXPLICAR en
-- vez de limitarse a negar.
-- ----------------------------------------------------------------------------
create or replace function public.acceso_de_empresa(p_empresa_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_empresa_id uuid := coalesce(p_empresa_id, public.current_empresa_id());
  v_cuenta     public.cuentas%rowtype;
  v_sus        public.suscripciones%rowtype;
  v_hoy        date := (now() at time zone 'America/Bogota')::date;
  v_cuenta_id  uuid;
begin
  v_cuenta_id := public.cuenta_de_empresa(v_empresa_id);

  -- Sin cuenta asignada: beneficio de la duda. Es lo que protege a las
  -- empresas creadas antes de que existiera este modelo.
  if v_cuenta_id is null then
    return jsonb_build_object('nivel', 'total', 'motivo', 'sin_cuenta');
  end if;

  select * into v_cuenta from public.cuentas where id = v_cuenta_id;
  select * into v_sus
  from public.suscripciones
  where cuenta_id = v_cuenta_id and estado <> 'purgada'
  order by case when estado = 'cancelada' then 1 else 0 end
  limit 1;

  -- Internas y cortesías nunca se restringen.
  if v_cuenta.tipo in ('interna', 'cortesia') then
    return jsonb_build_object('nivel', 'total', 'motivo', 'cuenta_exenta',
                              'cuenta_id', v_cuenta_id);
  end if;

  -- ── Cancelada: conserva facturación para poder volver ────────────────────
  if v_cuenta.estado in ('cancelada', 'purgada') then
    return jsonb_build_object(
      'nivel', 'solo_facturacion',
      'motivo', 'cuenta_cancelada',
      'estado', v_cuenta.estado,
      'cuenta_id', v_cuenta_id,
      'fecha', v_cuenta.purgar_desde,
      'mensaje', case
        when v_cuenta.estado = 'purgada'
          then 'Tu cuenta fue dada de baja y sus datos ya se eliminaron. Puedes contratar de nuevo cuando quieras.'
        else 'Diste de baja el servicio el ' || to_char(v_cuenta.cancelada_en, 'DD/MM/YYYY') ||
             '. Puedes retomar tu plan en cualquier momento desde esta pantalla.'
      end
    );
  end if;

  -- ── Bloqueada por no activar en 30 días ──────────────────────────────────
  if v_cuenta.estado = 'bloqueada_sin_activar' then
    return jsonb_build_object(
      'nivel', 'solo_facturacion',
      'motivo', 'no_activada',
      'estado', v_cuenta.estado,
      'cuenta_id', v_cuenta_id,
      'fecha', v_cuenta.bloqueada_en,
      'mensaje', 'No activaste tu prueba dentro del plazo de 30 días. '
              || 'Escríbenos y reabrimos tu cuenta enseguida.'
    );
  end if;

  -- ── Registrada pero fuera de plazo ───────────────────────────────────────
  -- Red de seguridad por si el proceso diario no llegó a correr: el resultado
  -- no puede depender de que un cron se haya ejecutado.
  if v_cuenta.estado = 'registrada'
     and v_cuenta.activacion_limite is not null
     and v_cuenta.activacion_limite < v_hoy then
    return jsonb_build_object(
      'nivel', 'solo_facturacion',
      'motivo', 'no_activada',
      'estado', v_cuenta.estado,
      'cuenta_id', v_cuenta_id,
      'fecha', v_cuenta.activacion_limite,
      'mensaje', 'El plazo para activar tu prueba venció el '
              || to_char(v_cuenta.activacion_limite, 'DD/MM/YYYY')
              || '. Escríbenos y reabrimos tu cuenta.'
    );
  end if;

  -- ── Todo lo demás tiene acceso completo ──────────────────────────────────
  -- Incluido `morosa`: una factura vencida NO restringe. Encender eso es la
  -- Fase 6 del plan de facturación y sigue esperando autorización.
  return jsonb_build_object(
    'nivel', 'total',
    'motivo', 'ok',
    'estado', coalesce(v_sus.estado, v_cuenta.estado),
    'cuenta_id', v_cuenta_id,
    'activacion_limite', v_cuenta.activacion_limite,
    'prueba_hasta', v_sus.prueba_hasta,
    'cubierto_hasta', v_sus.cubierto_hasta
  );
end;
$$;

comment on function public.acceso_de_empresa(uuid) is
  'Único punto que decide el nivel de acceso: total | solo_facturacion | solo_lectura. La mora NO restringe.';

grant execute on function public.acceso_de_empresa(uuid) to authenticated, service_role;

commit;
