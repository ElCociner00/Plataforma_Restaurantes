-- Escribir en una sede local: misma regla que para leerla.
--
-- SINTOMA: cerrar un turno en un local fallaba SIEMPRE con
--   42501 new row violates row-level security policy for table
--        "cierres_turno_final_locales"
-- mientras que consultar Loggro y ver los datos de esa misma sede funcionaba
-- sin problema. Con eso, ninguna empresa que tenga locales podia cerrar turno
-- en ellos: la operacion diaria del local quedaba detenida.
--
-- Reproducido en produccion el 2026-09-09 con BATUT VIVA desde la cuenta
-- gerenciabatut@gmail.com (admin_root de BATUT LE MERIDIEM) en contexto VIVA:
-- "Consultar Loggro" OK, "Consultar gastos" OK, "Confirmar apoyo" OK, y el
-- envio final reventando con el 42501 de arriba.
--
-- CAUSA: las tablas `_locales` quedaron con dos generaciones de politicas
-- mezcladas. El SELECT ya usaba app_puede_ver_empresa(), pero INSERT y UPDATE
-- seguian con la expresion vieja:
--
--   is_super_admin()
--   OR empresa_id = get_my_empresa_id()
--   OR empresa_id IN (SELECT get_empresas_del_grupo())
--
-- y get_empresas_del_grupo() solo contempla la rama "soy un local":
--
--   SELECT grupo_id INTO v_grupo_id FROM grupos_empresariales
--    WHERE empresa_id = v_empresa_id;          -- la madre NUNCA esta aqui
--   IF v_grupo_id IS NULL THEN
--     RETURN NEXT v_empresa_id; RETURN;        -- y sale devolviendose solo a si misma
--   END IF;
--
-- Una empresa madre solo aparece en grupos_empresariales como grupo_id, nunca
-- como empresa_id. Asi que para cualquier usuario de la madre esa funcion
-- devuelve unicamente la madre y jamas sus locales: podia leer el local pero no
-- escribir en el. Y como el modo normal de trabajo es entrar con la cuenta de
-- la madre y cambiar de contexto al local, el bloqueo alcanzaba a todas las
-- parejas madre->local (BATUT LE MERIDIEM -> BATUT VIVA,
-- Restaurante Prueba -> Prueba Global Nexo 2).
--
-- Los turnos de local que si existen en la base se guardaron por caminos que
-- no pasaban por esta politica: service_role (n8n, cargas administrativas) o
-- cuentas que ademas son superadmin. Por eso el fallo no se veia en los datos
-- historicos y solo aparece ahora, al cerrar desde la cuenta del cliente.
--
-- ARREGLO: alinear INSERT y UPDATE con la misma regla del SELECT.
-- app_empresas_visibles(), que es lo que hay detras de app_puede_ver_empresa(),
-- si tiene las dos ramas ("soy un local" y "soy la madre"), y es exactamente la
-- misma expresion que ya usan:
--   · el SELECT de estas mismas tablas,
--   · las tablas base equivalentes (cierres_turno_final / apoyos_turno, que son
--     FOR ALL con app_puede_ver_empresa),
--   · y la comprobacion que el propio subir_cierre_turno hace antes de insertar.
-- No amplia el alcance respecto de lo que ya se podia leer ni de lo que el RPC
-- ya validaba: solo deja de negar lo que el resto del sistema da por permitido.
--
-- subir_cierre_turno sigue siendo SECURITY INVOKER a proposito ("el RLS del
-- usuario sigue aplicando: es la red de seguridad"): el arreglo va en la
-- politica, no en quitarle la red al RPC.
--
-- VERIFICADO end-to-end tras aplicarlo, en produccion y con la sesion real del
-- cliente: consultar ventas -> consultar gastos -> 3 apoyos con rangos
-- distintos -> confirmar apoyo -> subir cierre -> leerlo de vuelta en la
-- auditoria de propinas -> borrar el cierre de prueba.

-- ── cierres_turno_final_locales ────────────────────────────────────────────
drop policy if exists cierres_turno_final_locales_insert on public.cierres_turno_final_locales;
create policy cierres_turno_final_locales_insert
  on public.cierres_turno_final_locales
  for insert
  with check (public.app_puede_ver_empresa(empresa_id));

drop policy if exists cierres_turno_final_locales_update on public.cierres_turno_final_locales;
create policy cierres_turno_final_locales_update
  on public.cierres_turno_final_locales
  for update
  using (public.app_puede_ver_empresa(empresa_id))
  with check (public.app_puede_ver_empresa(empresa_id));

-- ── apoyos_turno_locales ───────────────────────────────────────────────────
drop policy if exists apoyos_turno_locales_insert on public.apoyos_turno_locales;
create policy apoyos_turno_locales_insert
  on public.apoyos_turno_locales
  for insert
  with check (public.app_puede_ver_empresa(empresa_id));

drop policy if exists apoyos_turno_locales_update on public.apoyos_turno_locales;
create policy apoyos_turno_locales_update
  on public.apoyos_turno_locales
  for update
  using (public.app_puede_ver_empresa(empresa_id))
  with check (public.app_puede_ver_empresa(empresa_id));
