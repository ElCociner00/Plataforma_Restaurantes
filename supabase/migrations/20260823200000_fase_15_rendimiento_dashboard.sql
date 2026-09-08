-- ==============================================================================
-- FASE 15: RENDIMIENTO MULTI-INQUILINO DE LOS TABLEROS
-- ==============================================================================
--
-- Problema medido con EXPLAIN (ANALYZE, BUFFERS) sobre v_turnos_pivote:
--
--     -> Seq Scan on cierres_turno_final
--          Rows Removed by Filter: 5150     <-- leia 6.057 para quedarse con 907
--        Buffers: shared hit=957
--
-- Cada vez que un cliente abria su tablero, la base recorria los datos de TODOS
-- los inquilinos y descartaba lo ajeno al final. El coste de tu tablero crecia
-- con los datos de los demas.
--
-- Causa: no habia ningun indice utilizable para (empresa_id, fecha_turno). El
-- unico que tiene esas columnas, ux_cierres_turno_final_identidad, es PARCIAL
-- (WHERE variable <> 'gasto_extra') y la vista no lleva esa condicion, asi que
-- el planificador no podia usarlo.
--
-- Medicion (indice creado en transaccion y revertida, antes de aplicar):
--     una sede, sin indice:  Seq Scan   x2 -> 645 bloques
--     una sede, con indice:  Index Scan x2 ->  83 bloques
--
-- Verificado despues de aplicar, con la cuenta real (dos sedes visibles):
--     Index Scan x2 -> 479 bloques, frente a 957 de la forma anterior.
--
-- La mejora inmediata es de ~2x porque esa cuenta ve las dos unicas empresas
-- con datos de la base: casi todo lo que lee si es suyo. Lo que cambia de
-- fondo es la forma de crecer: con Index Scan el coste depende de las filas
-- del propio inquilino, no del total de la tabla.
--
-- CREATE INDEX es aditivo: no modifica ningun registro y se puede revertir con
-- DROP INDEX.
--
-- Las correcciones de logica de los RPC (unnest sobre SETOF, empresas.nombre,
-- empresas_locales, public.usuarios) NO estan aqui: se corrigieron en su sitio,
-- en las migraciones 20260823170000, 180000 y 190000.
-- ==============================================================================

CREATE INDEX IF NOT EXISTS ix_cierres_turno_final_empresa_fecha
  ON public.cierres_turno_final (empresa_id, fecha_turno);

CREATE INDEX IF NOT EXISTS ix_cierres_turno_final_locales_empresa_fecha
  ON public.cierres_turno_final_locales (empresa_id, fecha_turno);
