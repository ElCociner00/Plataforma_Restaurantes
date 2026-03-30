-- Vista agrupada de facturas con aislamiento por empresa.
-- Ejecutar en Supabase SQL Editor para exponer empresa_id y permitir filtros por tenant.

create or replace view public.vista_facturas_agrupadas as
select
  empresa_id,
  uuid_factura as "UUID",
  max("Tipo de Factura") as "Tipo de documento",
  max("Prefijo Factura") as "Prefijo",
  max("Consecutivo Factura") as "Consecutivo",
  max("Fecha Factura") as "Fecha Emisión",
  max("NIT_CC") as "NIT Emisor",
  max("Proveedor") as "Nombre Emisor",
  coalesce(
    sum(
      case
        when "Código Contable" = '24080101'::text then nullif("Valor Débito", ''::text)::numeric
        else 0::numeric
      end
    ),
    0::numeric
  ) as "IVA",
  coalesce(
    sum(
      case
        when "Código Contable" = '24080102'::text then nullif("Valor Débito", ''::text)::numeric
        else 0::numeric
      end
    ),
    0::numeric
  ) as "INC",
  coalesce(
    sum(
      case
        when "Código Contable" <> all (array['24080101'::text, '24080102'::text]) then nullif("Valor Crédito", ''::text)::numeric
        else 0::numeric
      end
    ),
    0::numeric
  ) as "Total",
  bool_or("Estado_Siigo") as "Estado_Siigo"
from
  public.facturas_empresas
where
  uuid_factura is not null
  and uuid_factura <> ''::text
group by
  empresa_id,
  uuid_factura;
