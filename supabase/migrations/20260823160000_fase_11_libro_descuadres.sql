-- Añadir columnas para gestionar descuadres en la tabla principal
ALTER TABLE "public"."cierres_turno_final"
ADD COLUMN IF NOT EXISTS "cuadre_estado" boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS "cuadre_comentario" text DEFAULT '';

-- Añadir columnas para gestionar descuadres en la tabla de locales
ALTER TABLE "public"."cierres_turno_final_locales"
ADD COLUMN IF NOT EXISTS "cuadre_estado" boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS "cuadre_comentario" text DEFAULT '';
