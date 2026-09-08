import { record, text } from "./payload.ts";

function candidates(value: unknown): Record<string, unknown>[] {
  const root = record(value);
  const wrapped = ["data", "results", "items", "entries", "webhooks"]
    .map((key) => root[key])
    .find(Array.isArray);
  return Array.isArray(value)
    ? value.map(record)
    : Array.isArray(wrapped) ? wrapped.map(record) : [root];
}

export function remoteWebhookConfigured(value: unknown, eventType: string): boolean {
  return candidates(value).some((candidate) => {
    const event = text(candidate.event).toUpperCase();
    if (event && event !== eventType) return false;
    const configurations = Array.isArray(candidate.data)
      ? (candidate.data as unknown[]).map(record)
      : [candidate];
    return configurations.some((configuration) =>
      Array.isArray(configuration.stores) && configuration.stores.length > 0
    );
  });
}

export function remoteWebhookStoreIds(value: unknown, eventType: string): Set<string> {
  const storeIds = new Set<string>();
  for (const candidate of candidates(value)) {
    const candidateEvent = text(candidate.event).toUpperCase();
    if (candidateEvent && candidateEvent !== eventType) continue;
    const stores = Array.isArray(candidate.stores) ? candidate.stores : [];
    for (const store of stores) {
      const item = record(store);
      const storeId = text(item.store_id ?? item.storeId ?? store);
      if (storeId) storeIds.add(storeId);
    }
  }
  return storeIds;
}

export function remoteWebhookMatches(value: unknown, eventType: string, url: string, storeIds: string[]): boolean {
  const expectedStores = new Set(storeIds.map(String));
  if (!expectedStores.size) return false;
  const configuredStores = new Set<string>();
  for (const candidate of candidates(value)) {
    const candidateEvent = text(candidate.event).toUpperCase();
    if (candidateEvent && candidateEvent !== eventType) continue;
    const configurations = Array.isArray(candidate.stores)
      ? (candidate.stores as unknown[]).map(record)
      : Array.isArray(candidate.data) ? (candidate.data as unknown[]).map(record) : [candidate];
    for (const configuration of configurations) {
      const configuredUrl = text(configuration.url ?? configuration.remote_url);
      const state = text(configuration.state).toUpperCase();
      const storeId = text(configuration.store_id ?? configuration.storeId);
      if (configuredUrl === url && (!state || state === "ENABLE") && storeId) configuredStores.add(storeId);
    }
  }
  return [...expectedStores].every((storeId) => configuredStores.has(storeId));
}
