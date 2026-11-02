import { describe, expect, it } from "vitest";
import { chunk } from "../src/components/format";
import { BULK_MAX } from "../src/lib/bulk";
import { plainError } from "../src/lib/errors";

describe("bulk approve batching", () => {
  it("splits 39 selected disputes into requests the server accepts", () => {
    const batches = chunk(Array.from({ length: 39 }, (_, i) => `D-${i}`), BULK_MAX);
    expect(batches.map((b) => b.length)).toEqual([25, 14]);
    expect(batches.flat()).toHaveLength(39);
  });
});

describe("plainError", () => {
  it("turns PayPal and Gemini JSON into one sentence", () => {
    expect(plainError(new Error('PayPal POST /v1/x failed (503): {"name":"SERVICE_UNAVAILABLE","message":"Service Unavailable.","debug_id":"abc"}'))).toBe("PayPal returned 503 SERVICE_UNAVAILABLE: Service Unavailable.");
    expect(plainError(new Error('{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}'))).toBe("The AI model refused the request (400): API key not valid. Please pass a valid API key.");
    expect(plainError(new Error("Plain words stay."))).toBe("Plain words stay.");
  });
});
