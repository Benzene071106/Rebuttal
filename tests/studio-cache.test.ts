import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadStudioTurn, saveStudioTurn, studioKey } from "@/lib/studio-cache";

const turn = (callId: string, thread: string) => ({
  instructions: "Build dashboards.",
  input: [
    { id: "m1", kind: "input", type: "message", role: "user", status: "completed", content: [{ type: "text", text: "Where am I losing money?" }] },
    { id: "x", kind: "output", type: "function_call", callId, name: "rename_thread", arguments: '{"name":"Refunds"}' },
    { type: "function_call_output", callId, status: "completed", output: `{"success":true,"data":{"threadId":"${thread}"}}` },
  ],
  tools: [{ name: "rename_thread", description: "Rename", parameters: { type: "object" } }],
});

describe("saved AG Studio turns", () => {
  it("gives two runs of the same chat the same key, whatever their ids", () => {
    expect(studioKey(turn("st_ab12_1~SIG", "thread-11111111-2222-3333-4444-555555555555"))).toBe(studioKey(turn("st_zz99_7~OTHER", "thread-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")));
  });

  it("keeps the key when the simulator's dates and sums move with the calendar", () => {
    const day1 = turn("c", "t");
    const day2 = turn("c", "t");
    (day1.input[2] as { output: string }).output = '{"success":true,"rows":53,"closed_max":"2026-11-04","kept":4315}';
    (day2.input[2] as { output: string }).output = '{"success":true,"rows":53,"closed_max":"2026-11-06","kept":4290}';
    expect(studioKey(day1)).toBe(studioKey(day2));
  });

  it("gives a different question a different key", () => {
    const other = turn("c", "t");
    (other.input[0] as { content: Array<{ text: string }> }).content[0].text = "Monthly trend";
    expect(studioKey(other)).not.toBe(studioKey(turn("c", "t")));
  });

  it("saves only when recording, and loads what it saved", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-"));
    process.env.STUDIO_CACHE_DIR = dir;
    saveStudioTurn("k1", { output: [] });
    expect(loadStudioTurn("k1")).toBeNull();
    process.env.STUDIO_RECORD = "1";
    saveStudioTurn("k1", { output: [{ type: "message" }] });
    expect(loadStudioTurn("k1")).toEqual({ output: [{ type: "message" }] });
    delete process.env.STUDIO_RECORD;
    delete process.env.STUDIO_CACHE_DIR;
  });
});
