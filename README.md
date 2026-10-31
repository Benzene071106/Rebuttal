# Rebuttal

**An AI agent that defends small online sellers in PayPal disputes.**

A buyer says the package never came. The seller has days to respond. Most small sellers either refund out of fear or send a rushed reply that leaves out the evidence that would have won. Rebuttal investigates each dispute the moment it arrives. It reads the PayPal dispute, the order, the shipment tracker and the buyer's history, plus the shop's own records. Then it recommends one of three moves:

- **Fight**, with an evidence statement written for the PayPal specialist and each fact traced to its source.
- **Partial refund**, with a specific amount, when the seller is partly at fault.
- **Refund**, when the case can't be won and fighting would waste the seller's time.

It runs on **autopilot**: PayPal's dispute webhook starts the investigation, and the seller's own rules decide what happens next. A $28 "never arrived" claim on an untracked letter can be refunded through PayPal before the seller wakes up; a $184 fight waits for the seller, with the evidence written and a **why this decision** breakdown (facts for and against, expected money kept for each option). Guardrails keep autopilot small: a hard dollar limit, no partial-refund offers, and nothing on its own after a failed PayPal lookup.

When a partial refund is the right move, the seller can hand it to the **AI negotiator**. The seller sets a ceiling the buyer never sees, and the agent haggles in the PayPal dispute conversation. It opens low, concedes in shrinking steps, explains each offer, and settles inside the ceiling or hands the case back. In the demo, a $96 chipped-mug claim opens at $24. The buyer counters at $48, the agent offers $32, and the buyer accepts, so the seller keeps $64. Code enforces the ceiling, no-backwards and accept rules after the model answers, so the model can't overspend.

The **dispute shield** works before a dispute exists. When an order is paid, the agent checks its dispute risk before the seller ships. It reads the PayPal order (`get_order` from the Agent Toolkit) and the buyer's history, including every dispute Rebuttal has handled for that buyer (**dispute memory**). Then it tells the seller what to do while they still can. In the demo:

- A $236 bag going overnight to a package forwarder under another name, from an unverified first-time account, is flagged **HIGH**. The advice is to ship only to the PayPal address or refund.
- A repeat buyer's $58 prints are **LOW**.
- A new $148 order from the buyer who is disputing a signed-for tote right now is **HIGH**, with the signature evidence quoted back.

**Self-healing PayPal calls.** When a PayPal write fails, the agent reads PayPal's error (status, name, `debug_id`) and recovers on its own when it safely can:

- A PayPal outage (5xx, timeout) is retried with backoff.
- An expired access token is replaced with a fresh PayPal sign-in and the call repeated.
- Anything PayPal refused for a business reason, like a refund with `INSUFFICIENT_FUNDS` (which our live sandbox seller really returned), is not retried. Gemini diagnoses it in plain words and either pauses the case with steps for the seller or proposes another response.

A proposal always waits for the seller's approval. The agent never changes code and never widens the seller's limits. Every incident lands in an AG Grid log with each attempt and the diagnosis. In the simulator, **Simulator tools → Break PayPal's next call** injects an outage, an expired token or insufficient funds, so you can watch it recover.

The app has three pages, so a seller sees what matters first:

- **Disputes** (home): money at risk, what's due within 3 days, money protected and whether autopilot is on, the latest alerts, and the ranked dispute queue with one **Next step** per row. Click a row for the full case.
- **Protect**: the dispute shield on paid orders and a dispute-memory grid of every buyer who has disputed, flagged when they order again.
- **Insights**: savings, linked charts over an outcomes ledger, the self-healing incident log and the full autopilot history.

Autopilot rules live in a drawer (**Autopilot rules**, top right), demo controls in **Simulator tools**, and first-time visitors get a 3-step tour.

The grids and charts are **AG Grid** and **AG Charts** (both Community, free):

- Two charts on Insights, **money by claim type** and **what the agent decided**, are drawn from the rows the outcomes grid is showing. Filter the grid and the charts follow. Click a bar and the grid filters to that claim type.
- Each dispute row expands into a full-width row with the agent's headline, its win estimate and the facts for and against the seller, so the seller can triage without opening the case.
- Cells flash when autopilot or PayPal changes a dispute, and the seller's column order, widths and sort are kept between visits.
- On Protect, the dispute shield is a grid sorted by risk, with a risk badge and score bar in each row and the agent's findings in an expandable detail row.

The inbox works as a triage queue: disputes are ranked by money at risk and days left before PayPal's response deadline, and a savings dashboard shows money protected, hours saved and how many disputes autopilot closed.

Built for the [Build What's Next with PayPal and AI](https://paypalaihackathon.devpost.com/) hackathon.

**Live demo:** https://rebuttal-6j9a.onrender.com _(free instance: if it has been idle, the first load takes about a minute)_

## Try it (no PayPal login needed)

The demo opens on the **Simulator**. Open **Simulator tools** and click **Simulate a new dispute**: a simulated buyer files a $28 claim, the simulator delivers the same `CUSTOMER.DISPUTE.CREATED` webhook PayPal would, the agent investigates, and autopilot refunds it within your $30 rule. Watch **Latest alerts**. In **Autopilot rules**, set **Send evidence on its own** to 90% and simulate again to see autopilot fight a signed-delivery case. Open a dispute and the agent starts investigating (a saved real Gemini run, replayed). Approve its recommendation, and a few seconds later the simulator plays PayPal's side: the ruling on a fight, or the buyer accepting an offer. Click **PayPal rules for buyer** during the countdown to see a loss instead. Open the $96 mug dispute and click **Let the agent negotiate** to watch the agent haggle with a simulated buyer. On the **Protect** tab, the **Dispute shield** checks three paid orders; click a row to see what the agent found and what to do before shipping. **Simulator tools → Reset demo** starts over. On Disputes, search or filter by claim, stage and amount; the pinned totals row tracks money at risk and kept for whatever is shown. On **Insights**, **Export outcomes (CSV)** downloads the ledger with plain-number amounts. The toggle at the top switches to **Live PayPal sandbox**, which shows real disputes filed by sandbox buyers.

Each browser gets its own simulator, kept by a cookie: several judges can try the demo at once without seeing each other's clicks, and **Reset demo** resets only yours. The live sandbox is one shared PayPal account, so on a production server it is view-only (cases, saved investigations and outcomes); set `LIVE_SANDBOX_WRITABLE=1` to approve and rule on live disputes, as local development does by default.

### Simulator vs live sandbox

| Step | Simulator | Live PayPal sandbox |
|---|---|---|
| AI investigation | Real Gemini runs, replayed from `cache/investigations/` so the free tier's rate limit never stalls a demo. **Re-run** calls the model live. | Live Gemini run against the real dispute through the PayPal Agent Toolkit. |
| Fight: evidence + tracking | Works | Works (verified: evidence accepted, tracking added). |
| PayPal's ruling (sandbox `adjudicate`) | Works | Works (verified: a $184 "not received" claim ruled for the seller, hold released). |
| AI negotiator | Works (simulated buyer with a private minimum) | Code is wired (`make-offer`, `send-message`, webhook resumes the haggle when the buyer answers) but untested live, because the sandbox only gave us chargebacks, where offers aren't allowed. |
| Dispute shield | Works on three paid demo orders | Not wired yet: a live install would collect paid orders from `PAYMENT.CAPTURE.COMPLETED` webhooks. |
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
| Disputes API: `make-offer` | Sends an approved partial refund, and each counter-offer the negotiator makes. |
| Disputes API: `send-message` | The negotiator's messages to the buyer in the dispute conversation. |
| Agent Toolkit: `get_order` (shield) | The dispute shield reads each paid order (shipping address and name, payer account status, shipping option) before the seller ships. |
| Disputes API (sandbox): `adjudicate` | Simulates PayPal's ruling, so the full lifecycle runs end-to-end in a demo. |
| Webhooks: `CUSTOMER.DISPUTE.*` + `verify-webhook-signature` | Starts autopilot: a new dispute is investigated in the background and the seller's rules applied, so PayPal either already has an answer or an approval is waiting. The simulator sends the same event through the same code. |

## How it uses AI

Google Gemini (`gemini-3.5-flash-lite` on the free tier by default, falling back to `gemini-3.5-flash` if it is overloaded; set `GEMINI_MODEL` / `GEMINI_FALLBACK_MODELS` to change them) runs a function-calling loop in [`src/lib/agent.ts`](src/lib/agent.ts). Claude works too: set `AI_PROVIDER=claude` and `APP_ANTHROPIC_API_KEY`. Both sit behind one small adapter interface in [`src/lib/model`](src/lib/model).

1. It investigates with the read-only PayPal tools and a `get_store_records` tool for the shop's listing text, customer messages and carrier scans.
2. It cross-checks the evidence. For example, it compares the carrier's delivery address with the shipping address on the order, and checks a payer's earlier purchases before an "unauthorized" claim.
3. It submits a structured recommendation through a strict-schema tool. The server validates it, and an invalid one goes back to the model as an error.
4. It lists the facts that decided it, each marked for or against the seller with a weight and its source tool, and hears the response deadline so a refund can beat a fight that can't be ready in time.
5. The negotiator ([`src/lib/negotiation.ts`](src/lib/negotiation.ts)) is a second loop with one tool, `negotiation_move` (offer, accept or stop, with the message and its reasoning). It sees the conversation and the ceiling but never reveals it. Code checks every move: it can't go over the ceiling, go backwards, or offer more than the buyer asked. If the model fails, a rule-based fallback keeps the haggle inside the same limits.
6. The dispute shield ([`src/lib/shield.ts`](src/lib/shield.ts)) is a third loop with `get_order`, `get_buyer_history` and a strict `submit_risk` tool. The 0-100 score and the LOW/MEDIUM/HIGH band come from fixed, published weights in code (`RISK_WEIGHTS` in `shield.ts`: forwarder address, recipient mismatch, unverified account, overnight shipping, past disputes, a signed-for parcel the buyer claimed never arrived, and so on), so the same order always gets the same level. Gemini, at temperature 0, only explains the result and suggests up to three steps before shipping. If the model is down, the seller still sees the rule-based check with plain default steps.

The model never moves money. Every write call to PayPal is made by the server, after a person clicks Approve, when the seller's autopilot rules ([`src/lib/rules.ts`](src/lib/rules.ts)) allow it, or inside the ceiling the seller gave the negotiator, and the rules are plain code checked after the model answers, not instructions to the model.

Finished investigations are saved (`cache/investigations/`) and replayed step by step for the same dispute facts, so the hosted demo keeps working when the free tier's per-minute limit is hit. **Re-run** forces a fresh investigation. If every Gemini model fails (rate limit, overload or timeout, after moving down the fallback list), it falls back to the saved one and the case shows a "Using saved analysis" note.

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

The agent-loop tests drive the real loop and the PayPal simulator with a scripted model. They cover parallel tool results, retries after invalid recommendations, and tool errors returned to the model. The autopilot tests cover every rule and guardrail, a webhook dispute refunded end-to-end, one left for approval, and a repeated webhook. The negotiation tests cover the guardrails, a full haggle settled at $32, the rule fallback and a hand-back. The recovery tests cover reading PayPal's errors, healing an outage and an expired token end to end, no retries on a refused refund, the alternative's guardrails and the rule fallback. The shield tests cover dispute memory, the tools the model may call, the score band and failures.

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
src/lib/negotiation.ts      AI negotiator: haggles a partial refund inside the seller's ceiling
src/lib/shield.ts           Dispute shield: risk check on paid orders, with dispute memory
src/lib/recovery.ts         Self-healing PayPal calls: read PayPal's error, retry/refresh, or AI diagnosis
src/lib/demo/scenarios.ts   Demo shop data: listings, messages, carrier scans
src/components/Inbox.tsx    Disputes home: KPIs, latest alerts, ranked queue (AG Grid: search, column filters, live totals row, expandable reasoning rows, cell flash, saved layout, next step)
src/components/Protect.tsx  Protect page: dispute shield and dispute memory grid
src/components/Insights.tsx Insights page: savings, linked charts, outcomes ledger with CSV export, incidents, autopilot history
src/components/TopBar.tsx   Three-tab nav, Simulator tools menu, Autopilot rules drawer
src/components/CasesProvider.tsx  One shared poller for disputes, stats and rules
src/components/InboxCharts.tsx  AG Charts that follow the grid's filters; clicking a bar filters the grid
src/components/EvidenceGrid.tsx  Evidence trail: each fact, its PayPal evidence type and source tool (AG Grid)
src/components/CaseView.tsx Live investigation, recommendation, approval
src/components/WhyPanel.tsx Why this decision: facts for and against, expected money per option
src/components/AutopilotPanel.tsx  Autopilot rules form and the alerts feed
src/components/NegotiationPanel.tsx  Negotiation transcript with the agent's reasoning
src/components/IncidentsPanel.tsx  Self-healing incident log (AG Grid)
src/components/ShieldPanel.tsx  Dispute shield: paid orders and their risk (AG Grid with risk renderers and detail rows)
```

## License

MIT
