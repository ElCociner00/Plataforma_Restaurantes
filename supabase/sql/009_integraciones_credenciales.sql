-- ========================================================================================
-- 009_integraciones_credenciales.sql
-- Creación de la tabla segura para credenciales de integraciones de terceros.
-- ========================================================================================

CREATE TABLE IF NOT EXISTS public.integraciones_credenciales (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    empresa_id uuid NOT NULL,
    plataforma text NOT NULL,
    usuario text NOT NULL,
    password text NOT NULL,
    url_api text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- Índice único para evitar credenciales duplicadas para la misma plataforma en una empresa
CREATE UNIQUE INDEX IF NOT EXISTS uq_integraciones_credenciales_empresa_plataforma 
ON public.integraciones_credenciales (empresa_id, plataforma);

-- ========================================================================================
-- Políticas de Seguridad (RLS)
-- ========================================================================================

ALTER TABLE public.integraciones_credenciales ENABLE ROW LEVEL SECURITY;

-- 1. LECTURA (SELECT): 
-- DENEGADA explícitamente. Ningún usuario del frontend puede leer las contraseñas.
-- Únicamente las Edge Functions podrán leer esta tabla usando el Service Role Key.

-- 2. CREACIÓN (INSERT): 
-- Permitido a administradores de la empresa.
CREATE POLICY "Permitir inserción a administradores de la empresa" ON public.integraciones_credenciales
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.usuarios_sistema 
            WHERE id = auth.uid() 
            AND empresa_id = integraciones_credenciales.empresa_id 
            AND rol = 'administrador'
        )
    );

-- 3. ACTUALIZACIÓN (UPDATE): 
-- Permitido a administradores de la empresa.
CREATE POLICY "Permitir actualización a administradores de la empresa" ON public.integraciones_credenciales
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.usuarios_sistema 
            WHERE id = auth.uid() 
            AND empresa_id = integraciones_credenciales.empresa_id 
            AND rol = 'administrador'
        )
    );

-- ========================================================================================
-- Migración Segura (Copia de datos de la tabla antigua)
-- ========================================================================================

INSERT INTO public.integraciones_credenciales (empresa_id, plataforma, usuario, password)
SELECT 
    empresa_id, 
    'loggro' as plataforma, 
    usuario, 
    "contraseña" as password
FROM public.loggro_refrescar_token
ON CONFLICT (empresa_id, plataforma) DO NOTHING;
