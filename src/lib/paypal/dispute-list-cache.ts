// Every open tab polls the dispute list every few seconds, and listing live sandbox
// disputes costs 1 list call + 1 get_dispute per dispute. PayPal's list already carries
// each dispute's update_time, so a dispute is only read again when it changed, and
// concurrent polls share one request.

import type { Dispute } from "../types";

export type ListItem = { dispute_id: string; update_time?: string };
type Store = { byId: Map<string, { update_time: string; dispute: Dispute }>; inflight?: Promise<Dispute[]> };

const g = globalThis as unknown as { __rebuttalDisputeList?: Store };

export function resetDisputeListCache() {
  g.__rebuttalDisputeList = { byId: new Map() };
}

export function cachedDisputeList(list: () => Promise<ListItem[]>, getOne: (id: string) => Promise<Dispute>): Promise<Dispute[]> {
  const store: Store = (g.__rebuttalDisputeList ??= { byId: new Map() });
  if (store.inflight) return store.inflight;
  const run = (async () => {
    const items = await list();
    const out = await Promise.all(
      items.map(async (it) => {
        const hit = store.byId.get(it.dispute_id);
        if (hit && it.update_time && hit.update_time === it.update_time) return hit.dispute;
        const dispute = await getOne(it.dispute_id);
        if (it.update_time) store.byId.set(it.dispute_id, { update_time: it.update_time, dispute });
        return dispute;
      }),
    );
    // Forget disputes PayPal no longer lists.
    const live = new Set(items.map((i) => i.dispute_id));
    for (const id of store.byId.keys()) if (!live.has(id)) store.byId.delete(id);
    return out;
  })();
  store.inflight = run;
  return run.finally(() => {
    if (store.inflight === run) store.inflight = undefined;
  });
}
