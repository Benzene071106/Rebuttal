import { describe, expect, it, vi } from "vitest";
import { GET, HEAD } from "../src/app/api/health/route";

describe("/api/health", () => {
  it("answers fast without calling PayPal or Gemini", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network calls allowed"));
    const t = performance.now();
    const res = await GET();
    expect(performance.now() - t).toBeLessThan(50);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    expect((await HEAD()).status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
