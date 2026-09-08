export const RAPPI_EVENTS_V1 = [
  "NEW_ORDER",
  "ORDER_EVENT_CANCEL",
  "ORDER_OTHER_EVENT",
  "MENU_APPROVED",
  "MENU_REJECTED",
  "PING",
  "STORE_CONNECTIVITY",
  "ORDER_RT_TRACKING",
] as const;

export type RappiEventV1 = typeof RAPPI_EVENTS_V1[number];
export type RappiScope = "OPERATIONAL" | "FINANCIAL";

export const isRappiEventV1 = (value: string): value is RappiEventV1 =>
  (RAPPI_EVENTS_V1 as readonly string[]).includes(value);

export type RappiConnection = {
  id: string;
  empresa_id: string;
  environment: "DEV" | "PROD";
  status: string;
  operational_base_url: string;
  orders_base_url: string;
  financial_base_url: string;
  operational_enabled: boolean;
  financial_enabled: boolean;
};
