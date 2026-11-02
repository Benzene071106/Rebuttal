import { beforeEach, describe, expect, it } from "vitest";
import { cachedDisputeList, resetDisputeListCache, type ListItem } from "../src/lib/paypal/dispute-list-cache";
import type { Dispute } from "../src/lib/types";

describe("live sandbox dispute list cache", () => {
  beforeEach(() => resetDisputeListCache());

  it("re-reads only disputes whose update_time changed, and shares concurrent polls", async () => {
    let items: ListItem[] = [{ dispute_id: "A", update_time: "1" }, { dispute_id: "B", update_time: "1" }];
    let lists = 0;
    const gets: string[] = [];
    const list = async () => (lists++, items);
    const getOne = async (id: string) => (gets.push(id), { dispute_id: id } as Dispute);

    await Promise.all(Array.from({ length: 15 }, () => cachedDisputeList(list, getOne)));
    expect(lists).toBe(1);
    expect(gets).toEqual(["A", "B"]);

    await cachedDisputeList(list, getOne); // nothing changed
    expect(gets).toEqual(["A", "B"]);

    items = [{ dispute_id: "A", update_time: "2" }, { dispute_id: "B", update_time: "1" }];
    const out = await cachedDisputeList(list, getOne);
    expect(gets).toEqual(["A", "B", "A"]);
    expect(out.map((d) => d.dispute_id)).toEqual(["A", "B"]);
  });
});
