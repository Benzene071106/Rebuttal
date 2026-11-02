// Turns raw API errors into one plain sentence for the seller. PayPal errors arrive as
// `PayPal POST /path failed (503): {json}` and Gemini errors as `{"error":{...}}`; the
// seller should read what went wrong, not the JSON.

export function plainError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const json = raw.match(/\{[\s\S]*\}\s*$/)?.[0];
  if (!json) return raw;
  let body: any = null;
  try {
    body = JSON.parse(json);
  } catch {
    return raw;
  }
  const prefix = raw.slice(0, raw.length - json.length).trim();
  const status = prefix.match(/\((\d{3})\)/)?.[1] ?? body?.error?.code;
  if (/^PayPal\b/.test(prefix)) {
    const issue = body?.details?.[0]?.description ?? body?.details?.[0]?.issue;
    const what = issue ?? body?.message ?? body?.name ?? "an error";
    return `PayPal returned ${status ? `${status} ` : ""}${body?.name ? `${body.name}: ` : ""}${String(what).replace(/\.$/, "")}.`.replace(/: (\w+): /, ": ");
  }
  const msg = body?.error?.message ?? body?.message;
  if (msg) return `The AI model refused the request${status ? ` (${status})` : ""}: ${String(msg).split("\n")[0].replace(/\.$/, "")}.`;
  return prefix || raw;
}
