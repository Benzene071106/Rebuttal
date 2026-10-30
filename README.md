# Rebuttal

**An AI agent that defends small online sellers in PayPal disputes.**

A buyer says the package never came. The seller has days to respond. Most small sellers either refund out of fear or send a rushed reply that leaves out the evidence that would have won. Rebuttal investigates each dispute the moment it arrives. It reads the PayPal dispute, the order, the shipment tracker and the buyer's history, plus the shop's own records. Then it recommends one of three moves:

- **Fight**, with an evidence statement written for the PayPal specialist and each fact traced to its source.
- **Partial refund**, with a specific amount, when the seller is partly at fault.
- **Refund**, when the case can't be won and fighting would waste the seller's time.

It runs on **autopilot**: PayPal's dispute webhook starts the investigation, and the seller's own rules decide what happens next. A $28 "never arrived" claim on an untracked letter can be refunded through PayPal before the seller wakes up; a $184 fight waits for the seller, with the evidence written and a **why this decision** breakdown (facts for and against, expected money kept for each option). Guardrails keep autopilot small: a hard dollar limit, no partial-refund offers, and nothing on its own after a failed PayPal lookup.

The inbox works as a triage queue: disputes are ranked by money at risk and days left before PayPal's response deadline, and a savings dashboard shows money protected, hours saved and how many disputes autopilot closed.

Built for the [Build What's Next with PayPal and AI](https://paypalaihackathon.devpost.com/) hackathon.

**Live demo:** https://rebuttal-6j9a.onrender.com _(free instance: if it has been idle, the first load takes about a minute)_

## Try it (no PayPal login needed)

The demo opens on the **Simulator**. Click **Simulate a new dispute**: a simulated buyer files a $28 claim, the simulator delivers the same `CUSTOMER.DISPUTE.CREATED` webhook PayPal would, the agent investigates, and autopilot refunds it within your $30 rule. Watch the **Alerts** feed. Set **Send evidence on its own** to 90% and simulate again to see autopilot fight a signed-delivery case. Open a dispute and the agent starts investigating (a saved real Gemini run, replayed). Approve its recommendation, and a few seconds later the simulator plays PayPal's side: the ruling on a fight, or the buyer accepting an offer. Click **PayPal rules for buyer** during the countdown to see a loss instead. **Reset demo** starts over. In the inbox, search or filter by claim, stage and amount; the pinned totals row tracks money at risk and kept for whatever is shown, and **Export outcomes (CSV)** downloads the ledger with plain-number amounts. The toggle at the top switches to **Live PayPal sandbox**, which shows real disputes filed by sandbox buyers.

Each browser gets its own simulator, kept by a cookie: several judges can try the demo at once without seeing each other's clicks, and **Reset demo** resets only yours. The live sandbox is one shared PayPal account, so on a production server it is view-only (cases, saved investigations and outcomes); set `LIVE_SANDBOX_WRITABLE=1` to approve and rule on live disputes, as local development does by default.

### Simulator vs live sandbox

| Step | Simulator | Live PayPal sandbox |
|---|---|---|
| AI investigation | Real Gemini runs, replayed from `cache/investigations/` so the free tier's rate limit never stalls a demo. **Re-run** calls the model live. | Live Gemini run against the real dispute through the PayPal Agent Toolkit. |
| Fight: evidence + tracking | Works | Works (verified: evidence accepted, tracking added). |
| PayPal's ruling (sandbox `adjudicate`) | Works | Works (verified: a $184 "not received" claim ruled for the seller, hold released). |
| Partial-refund offer | Works | Not possible in our tests: the sandbox opened every buyer dispute as a chargeback, and PayPal allows no offers on chargebacks. The app says so instead of failing silently. |
| Full refund | Works | Works when the seller account has a balance; our India-based sandbox seller had no USD balance, so PayPal returned `INSUFFICIENT_FUNDS`, which the app reports. |

Why both: buyer disputes can only be filed by hand in the sandbox and take minutes to hours to appear, so a judge can't create one on the spot. The simulator returns the same JSON shapes as the sandbox, so the same code paths, UI and agent run in both.

## How it uses PayPal

| PayPal capability | Used for |
|---|---|
| [PayPal Agent Toolkit](https://github.com/paypal/agent-toolkit) (`@paypal/agent-toolkit`) | The agent's read tools: `get_dispute`, `get_order`, `get_shipment_tracking`, `list_transactions`. The toolkit's own schemas and descriptions are passed to the model unchanged. |
| Agent Toolkit: `list_disputes`, `get_dispute` | The dispute inbox. |
| Agent Toolkit: `create_shipment_tracking` | Before fighting, adds the carrier tracking to the PayPal transaction if the seller never uploaded it. |
| Agent Toolkit: `accept_dispute_claim` | Refunds when the seller agrees the case isn't worth fighting. |
| Disputes API: `provide-evidence` | Sends the approved statement with the response attached as a PDF. The live sandbox accepted one evidence per call, so the strongest type goes first. |
| Disputes API: `provide-supporting-info` | Sends the statement while a chargeback is under PayPal review. |
| Orders API: `/v2/checkout/orders/{id}/track` | Adds carrier tracking when the app lacks the older trackers permission. |
| Disputes API: `make-offer` | Sends an approved partial refund. |
| Disputes API (sandbox): `adjudicate` | Simulates PayPal's ruling, so the full lifecycle runs end-to-end in a demo. |
| Webhooks: `CUSTOMER.DISPUTE.*` + `verify-webhook-signature` | Starts autopilot: a new dispute is investigated in the background and the seller's rules applied, so PayPal either already has an answer or an approval is waiting. The simulator sends the same event through the same code. |

## How it uses AI

Google Gemini (`gemini-3.5-flash-lite` on the free tier by default, falling back to `gemini-3.5-flash` if it is overloaded; set `GEMINI_MODEL` / `GEMINI_FALLBACK_MODELS` to change them) runs a function-calling loop in [`src/lib/agent.ts`](src/lib/agent.ts). Claude works too: set `AI_PROVIDER=claude` and `APP_ANTHROPIC_API_KEY`. Both sit behind one small adapter interface in [`src/lib/model`](src/lib/model).

1. It investigates with the read-only PayPal tools and a `get_store_records` tool for the shop's listing text, customer messages and carrier scans.
2. It cross-checks the evidence. For example, it compares the carrier's delivery address with the shipping address on the order, and checks a payer's earlier purchases before an "unauthorized" claim.
3. It submits a structured recommendation through a strict-schema tool. The server validates it, and an invalid one goes back to the model as an error.

4. It lists the facts that decided it, each marked for or against the seller with a weight and its source tool, and hears the response deadline so a refund can beat a fight that can't be ready in time.

The model never moves money. Every write call to PayPal is made by the server, either after a person clicks Approve or when the seller's autopilot rules ([`src/lib/rules.ts`](src/lib/rules.ts)) allow it, and the rules are plain code checked after the model answers, not instructions to the model.

Finished investigations are saved (`cache/investigations/`) and replayed step by step for the same dispute facts, so the hosted demo keeps working when the free tier's per-minute limit is hit. **Re-run** forces a fresh investigation, and falls back to the saved one if the model is rate-limited.

## Run it locally

Requires Node 22+.

```bash
npm install
cp .env.example .env.local   # add GEMINI_API_KEY
npm run dev                  # http://localhost:3000
```

With no PayPal credentials, the app runs against a built-in **PayPal simulator** ([`src/lib/paypal/mock.ts`](src/lib/paypal/mock.ts)). It returns the same JSON shapes as the sandbox and comes with four realistic disputes for a demo pottery-and-leather shop. Click **Simulate a new dispute** to watch autopilot handle a new case.

To use the real PayPal sandbox, set `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` from a sandbox app at developer.paypal.com (Apps & Credentials, Sandbox). `npm run check:live` confirms the Gemini key and the sandbox credentials work, without printing either.

### Seeding the sandbox

Disputes are filed by buyers. To create one in the sandbox:

1. `npm run seed:sandbox create JK-1042` creates a real sandbox order that matches the demo shop's records and prints a checkout link.
2. Open the link and pay as a sandbox **personal** account. Use a US personal account: an India buyer can't pay an India seller.
3. `npm run seed:sandbox capture --wait` captures the payment and adds the carrier tracking.
4. As the same buyer, open Activity at sandbox.paypal.com, pick the payment and report a problem. The dispute appears in Rebuttal once PayPal's API lists it (in our tests, from a few minutes up to a few hours).

Disputes over $11 escalate on day 11 in the sandbox; see PayPal's [dispute testing guide](https://developer.paypal.com/disputes/test-go-live).

### Webhooks

In the sandbox app, add a webhook to `https://<your-host>/api/webhooks/paypal` for the `Customer dispute created / updated / resolved` events. Set `PAYPAL_WEBHOOK_ID` to its ID. New disputes then go through autopilot ([`src/lib/autopilot.ts`](src/lib/autopilot.ts)): investigated in the background, then answered or flagged for approval under the seller's rules.

## Deploy

`render.yaml` is a Render Blueprint for a free web service: `npm ci && npm run build`, `npm start` (binds to `$PORT`), health check `/api/health`, starting on the simulator (`PAYPAL_MODE=mock`). In Render choose **New > Blueprint**, pick this repository and paste `GEMINI_API_KEY`, `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` when asked. Without the PayPal keys the app runs on the simulator only.

## Tests

```bash
npm test
```

The agent-loop tests drive the real loop and the PayPal simulator with a scripted model. They cover parallel tool results, retries after invalid recommendations, and tool errors returned to the model. The autopilot tests cover every rule and guardrail, a webhook dispute refunded end-to-end, one left for approval, and a repeated webhook.

## Project layout

```
src/lib/agent.ts            Agent tool-use loop and recommendation schema
src/lib/model/              Gemini (default) and Claude adapters
src/lib/investigation-cache.ts  Saved investigations for rate-limit-proof demos
src/lib/paypal/sandbox.ts   PayPal sandbox gateway (Agent Toolkit + Disputes REST)
src/lib/paypal/mock.ts      In-memory PayPal simulator for demos and tests
src/lib/actions.ts          Executes the approved decision; maps PayPal outcomes
src/lib/autopilot.ts        Webhook -> investigation -> seller rules -> PayPal action or alert
src/lib/rules.ts            Seller autopilot rules and guardrails
src/lib/demo/scenarios.ts   Demo shop data: listings, messages, carrier scans
src/components/Inbox.tsx    Dispute inbox (AG Grid: search, column filters, live totals row, CSV export)
src/components/EvidenceGrid.tsx  Evidence trail: each fact, its PayPal evidence type and source tool (AG Grid)
src/components/CaseView.tsx Live investigation, recommendation, approval
src/components/WhyPanel.tsx Why this decision: facts for and against, expected money per option
src/components/AutopilotPanel.tsx  Autopilot rules and the alerts feed
```

## License

MIT
