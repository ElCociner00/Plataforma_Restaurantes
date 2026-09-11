import {
  buildIdempotencyKey,
  effectiveMenuApprovalStatus,
  extractStoreId,
  isInformationalOrderEvent,
  isRappiTesterSample,
  normalizeOperationalStatus,
  parseConnectivity,
  parseDate,
  parseTracking,
  sanitizeEventInformation,
  sanitizeFinancialRecord,
  sanitizeOrder,
} from "./payload.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("Order sanitizer keeps operational data and removes customer PII", () => {
  const result = sanitizeOrder({
    event_time: "2026-08-29T10:00:00Z",
    store_id: "store-1",
    order_detail: {
      order_id: "order-1",
      status: "TAKEN",
      customer: { name: "Sensitive", phone: "3000000000" },
      billing: { document: "123" },
      delivery_address: "Sensitive address",
      items: [{ id: "item-1", name: "Hamburguesa", quantity: 2, price: 15000 }],
      totals: { total_products: 30000, total_order: 30000, unsupported: ["x"] },
    },
  });
  assert(
    result.rappi_order_id === "order-1",
    "Order id should survive normalization",
  );
  assert(
    result.rappi_store_id === "store-1",
    "Store id should survive normalization",
  );
  assert(
    result.operational_status === "IN_PROGRESS",
    "Provider status should be normalized",
  );
  assert(
    Array.isArray(result.items) && result.items.length === 1,
    "Items should remain available",
  );
  const serialized = JSON.stringify(result);
  assert(
    !serialized.includes("Sensitive"),
    "Customer and address PII must not be stored",
  );
  assert(
    !serialized.includes("3000000000") && !serialized.includes("123"),
    "Phone and billing document must be removed",
  );
});

Deno.test("Idempotency is stable and explicit event ids take priority", async () => {
  const payload = {
    event_id: "event-99",
    order_id: "order-1",
    store_id: "store-1",
  };
  const first = await buildIdempotencyKey("NEW_ORDER", payload, "100");
  const second = await buildIdempotencyKey("NEW_ORDER", payload, "200");
  assert(
    first === "NEW_ORDER:EVENT:event-99",
    "Explicit event id must form the key",
  );
  assert(
    first === second,
    "Explicit event id must ignore delivery retry timestamp",
  );
});

Deno.test("Operational and connectivity statuses are normalized", () => {
  assert(
    normalizeOperationalStatus("ORDER_EVENT_CANCEL", "anything") ===
      "CANCELLED",
    "Cancel event should win",
  );
  assert(
    normalizeOperationalStatus("ORDER_OTHER_EVENT", "delivered") ===
      "COMPLETED",
    "Delivered should be completed",
  );
  assert(
    parseConnectivity(
      { store_id: "1", status: "offline" },
      "STORE_CONNECTIVITY",
    ).is_online === false,
    "Offline must normalize to false",
  );
  assert(
    parseConnectivity({ store_id: "1" }, "PING").is_online === true,
    "A valid ping means online",
  );
});

Deno.test("Official Rappi order events reach the delivery states", () => {
  // Nombres de dev-portal "Eventos de Ordenes". Antes close_order quedaba como
  // estado crudo y un pedido entregado nunca aparecía como "Entregado".
  const expected: Record<string, string> = {
    taken_visible_order: "IN_PROGRESS",
    ready_for_pick_up: "READY",
    domiciliary_in_store: "COURIER_AT_STORE",
    hand_to_domiciliary: "IN_DELIVERY",
    arrive: "ARRIVED",
    close_order: "COMPLETED",
  };
  for (const [event, status] of Object.entries(expected)) {
    const normalized = normalizeOperationalStatus("ORDER_OTHER_EVENT", event);
    assert(normalized === status, `${event} debe ser ${status}, fue ${normalized}`);
  }
  for (const event of ["cancel_by_user", "canceled_with_charge", "canceled_by_fraud_automation"]) {
    assert(normalizeOperationalStatus("ORDER_OTHER_EVENT", event) === "CANCELLED", `${event} debe cancelar`);
  }
});

Deno.test("Rappi order states: READY is not ready-for-pickup and TIMEOUT means not accepted", () => {
  assert(normalizeOperationalStatus("NEW_ORDER", "READY") === "RECEIVED", "READY es lista para enviarse a la tienda");
  assert(normalizeOperationalStatus("NEW_ORDER", "SENT") === "RECEIVED", "SENT espera aceptación");
  assert(normalizeOperationalStatus("NEW_ORDER", "READY_FOR_PICKUP") === "READY", "READY_FOR_PICKUP es lista para recoger");
  assert(normalizeOperationalStatus("NEW_ORDER", "TIMEOUT") === "NOT_ACCEPTED", "TIMEOUT es vencida sin aceptar");
  assert(normalizeOperationalStatus("NEW_ORDER", "") === "RECEIVED", "NEW_ORDER sin estado es recibida");
});

Deno.test("Rappi local times without zone are read as Colombia time", () => {
  // Formatos reales recibidos del sandbox el 2026-09-10.
  assert(parseDate("2026-09-10 20:43:54") === "2026-09-11T01:43:54.000Z", "NEW_ORDER created_at");
  assert(parseDate("2026-09-10T20:44:03") === "2026-09-11T01:44:03.000Z", "ORDER_OTHER_EVENT event_time");
  assert(parseDate("2020-05-28T12:31:12.501Z") === "2020-05-28T12:31:12.501Z", "GET events trae UTC explícito");
});

Deno.test("Courier replacement is informational, not a state change", () => {
  assert(isInformationalOrderEvent("replace_storekeeper"), "replace_storekeeper no mueve el estado");
  assert(!isInformationalOrderEvent("close_order"), "close_order sí mueve el estado");
});

Deno.test("Event information keeps the courier name and drops contact data", () => {
  const info = sanitizeEventInformation({
    courier_data: {
      id: 729365,
      phone: "3118012176",
      full_name: "Daletzi Karina Olmedo Plata",
      profile_pic: "https://example.com/pic.png",
    },
    eta_to_store: 147,
    storekeeper_name: "Daletzi Karina Olmedo Plata",
    customer_phone: "3000000000",
  });
  const serialized = JSON.stringify(info);
  assert(serialized.includes("Daletzi Karina Olmedo Plata"), "El nombre del repartidor se conserva");
  assert(!serialized.includes("3118012176") && !serialized.includes("3000000000"), "Los teléfonos se descartan");
  assert(!serialized.includes("example.com"), "La foto se descarta");
  assert(info.eta_to_store === 147, "La ETA a tienda se conserva");
});

Deno.test("Official STORE_CONNECTIVITY payload resolves store and enabled flag", () => {
  const payload = {
    external_store_id: "999",
    enabled: false,
    message: "The Store is not enabled to operate",
  };
  assert(
    extractStoreId(payload) === "999",
    "external_store_id must identify the store",
  );
  const connectivity = parseConnectivity(payload, "STORE_CONNECTIVITY");
  assert(
    connectivity.is_online === false,
    "enabled=false must normalize to offline",
  );
  assert(
    connectivity.normalized_status === "OFFLINE",
    "Connectivity status must be OFFLINE",
  );
});

Deno.test("Official ORDER_RT_TRACKING payload keeps millis and Colombia-local timestamp", () => {
  const tracking = parseTracking({
    lat: 4.711,
    lng: -74.0721,
    eta_in_millis: 330000,
    eta_type: "PICKUP",
    order_id: 1234,
    store_id: 900170987,
    courier_id: 5678,
    created_at: "13/10/2023 12:00:20",
  });
  assert(tracking.eta === "330000", "eta_in_millis must be preserved");
  assert(
    tracking.latitude === 4.711 && tracking.longitude === -74.0721,
    "Coordinates must normalize",
  );
  assert(
    tracking.tracked_at === "2023-10-13T17:00:20.000Z",
    "Local timestamp must convert from UTC-5",
  );
});

Deno.test("Integration Manager samples are identified without hiding real payloads", () => {
  assert(
    isRappiTesterSample({ order_id: "SAMPLE-ORDER-0001" }),
    "Tester orders must be recognized",
  );
  assert(
    isRappiTesterSample({ menu_id: "SAMPLE-MENU-0001" }),
    "Tester menus must be recognized",
  );
  assert(
    !isRappiTesterSample({ order_id: "ENKRATO-DEV-1788125848688" }),
    "Controlled Enkrato tests must still exercise persistence",
  );
  assert(
    !isRappiTesterSample({ order_id: "real-order-123" }),
    "Real orders must not be suppressed",
  );
});

Deno.test("Tester menu events do not override the latest real menu status", () => {
  const events = [
    {
      event_type: "MENU_REJECTED",
      raw_payload: { store_id: "1", menu_id: "SAMPLE-MENU-0001" },
    },
    {
      event_type: "MENU_APPROVED",
      raw_payload: { store_id: "1", menu_id: "real-menu-42" },
    },
  ];
  assert(
    effectiveMenuApprovalStatus("1", "REJECTED", events) === "APPROVED",
    "A real provider event must win after samples are skipped",
  );
  assert(
    effectiveMenuApprovalStatus("2", "PENDING", events) === "PENDING",
    "Stores without tester events keep their persisted status",
  );
  assert(
    effectiveMenuApprovalStatus("1", "REJECTED", [events[0]]) === null,
    "A sample-only history must not display a business rejection",
  );
});

Deno.test("Financial sanitizer removes banking and customer PII", () => {
  const sanitized = sanitizeFinancialRecord({
    order_id: "order-1",
    payment_id: "payment-1",
    amount: 25000,
    customer: { name: "Sensitive" },
    bank_account: { account_number: "000123", holder_name: "Sensitive" },
    contact_email: "sensitive@example.com",
    billing: { total_order: 25000 },
  });
  const serialized = JSON.stringify(sanitized);
  assert(
    serialized.includes("order-1") && serialized.includes("25000"),
    "Financial evidence should remain",
  );
  assert(
    !serialized.includes("Sensitive") && !serialized.includes("000123") &&
      !serialized.includes("example.com"),
    "Financial PII must be removed",
  );
});
