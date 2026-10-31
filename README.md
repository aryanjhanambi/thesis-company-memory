# Thesis

A market-shock investigation lab. Trace dated business relationships, inspect their evidence, form a hypothesis and test a basket before risking money. The earlier company-memory dashboard remains available from **Company memory**.

## Shock lab: start here

1. **Investigate:** choose an AI-spending, foundry, or server-demand scenario. These are hypothetical scenarios, not live news. Inspect one- or two-hop connections and their original sources.
2. **Replay:** use a cutoff date or a timeline stop. Only relationships published by that date appear. The March 18, 2024 Blackwell announcement supplies five curated relationships across six companies. Announced plans are distinguished from reported manufacturing facts; neither implies a quantified financial exposure.
3. **Backtest:** write a hypothesis, choose a reachable basket, and run the browser engine. The built-in series is explicitly **synthetic**, not real historical prices. Upload your own `date,ticker,close` CSV for a user-data experiment. Include SPY and every basket ticker on at least two aligned dates strictly after the cutoff; use consistently adjusted series. Limit: 700 KB / 10,000 rows. No duplicate observations, future uploaded dates or silently dropped missing days.
4. Inspect the equity curve, SPY comparison, excess return, maximum drawdown, and every simulated fill. Buy-and-hold has equal initial dollar weights and fractional shares, no rebalancing, first-close entry strictly after cutoff, last-close liquidation, and costs on both sides. Cash earns zero. Taxes, market impact and explicit dividend payments are not modeled; corporate-action treatment depends on the supplied prices.
5. **Save experiment** preserves the complete inputs and result in this browser; export JSON for a portable record. Both winning and losing runs can be saved. Storage is capped at ten experiments; exporting is recommended. Local browser storage is not a tamper-proof audit trail or an account-synced database.
6. **Freeze for forward paper tracking** records a hypothesis, basket and timestamp locally, with no editing controls. Later, upload actual prices and use **Mark with uploaded CSV**. Entry is the first observed close after the freeze day (UTC), never a retrospectively chosen entry. At least two later aligned observations are required. Results are hypothetical liquidation marks, not live fills. No automatic market feed, brokerage execution or real money is involved. Twenty frozen hypotheses are retained locally; export to back them up.

### Integration boundaries

- **Neo4j:** Connections → **Load curated graph into Neo4j** idempotently writes `(MarketCompany)-[:EXPOSURE]->(MarketCompany)` with source URL, publication date, relationship ID and evidence note. **Query Neo4j** traverses up to two hops and filters _every_ relationship by cutoff. Without keys, the same small graph runs in-browser and is labelled local. This does not automatically discover or resolve arbitrary company supply chains.
- **Daytona:** choosing sandbox execution sends validated price inputs to the protected Railway API. It uploads the same fixed JavaScript backtest engine, not user code, runs it in a network-blocked sandbox with bounded resources/time, and deletes the sandbox in `finally`, with automatic cleanup as a fallback. No financial API credentials are sent to it. The engine runs without installing dependencies. The earlier report extractor continues to use Python.
- **Nosana:** optional evidence explanations through a Nosana-hosted vLLM/OpenAI-compatible deployment. Set backend-only `NOSANA_INFERENCE_URL` (base including `/v1`), `NOSANA_MODEL`, and optional `NOSANA_INFERENCE_KEY`. **Ask Nosana model** sends only eligible curated evidence and requests cited edge IDs plus counterarguments. Output is labelled model-generated and needs verification. The adapter does not provision GPUs, train models, validate generated citations, or prove that an arbitrarily configured endpoint is hosted by Nosana.

Protected new routes:

| Route                                             | Purpose                                                          |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| `POST /api/shocks/seed`                           | Load the curated graph into configured Neo4j                     |
| `GET /api/shocks/graph?root=MSFT&asOf=2024-03-19` | Retrieve dated exposure paths from Neo4j                         |
| `POST /api/shocks/backtest`                       | Validate input and execute the fixed engine in Daytona           |
| `POST /api/shocks/explain`                        | Explain date-eligible evidence using the configured Nosana model |

Provider errors never silently fall back to demo results. Provider adapters are covered by mocked contract tests, but live GPU/sandbox/database execution still requires keys and has not been verified in this credential-free environment.

### Research limits

The graph is a small date-filtered reconstruction from current official webpages, **not a vintage archival dataset**. Even if edges pass the cutoff, retrospective selection of a shock or basket can still create hindsight bias. Graph reachability is not causation, revenue sensitivity, or a validated alpha signal. Backtesting one selected basket does not establish repeatable profitability. There are no buy/sell recommendations or guaranteed-return claims.

Primary graph source: [NVIDIA's March 18, 2024 Blackwell announcement](https://nvidianews.nvidia.com/news/nvidia-blackwell-platform-arrives-to-power-a-new-era-of-computing/). A later [Microsoft FY24 Q4 earnings call](https://www.microsoft.com/en-us/investor/events/fy-2024/earnings-fy-2024-q4) appears as counterevidence to the hypothetical spending-cut scenario only after its publication date.

## Run the dashboard

Requires Node.js 22.16+ and npm.

```sh
npm ci
npm run dev
```

Open the printed local URL. `npm run build` produces `dist/`; `npm run preview` serves that build.

Built with React 19, TypeScript, Vite, Tailwind 4, Lucide, and a shadcn-compatible structure. Reusable UI lives in `src/components/ui`; `components.json` maps the `@/components/ui` alias. This keeps generated shadcn components and project imports consistent. Global theme tokens and responsive styles are in `src/index.css`.

The supplied Analytics Bento component lives in `src/components/ui/analytics-bento.tsx`, adapted for financial reporting periods and the research-led visual design. `src/research.css` defines the paper-and-ink theme: serif section headings, monospaced numbers, ruled sections, plain status labels, and an asymmetric reading layout. Decorative rings, gradients, tinted icon tiles, glass effects, and card shadows are removed. Its financial view uses actual quarterly observations rather than invented daily series. Original supplied component credit: vasnev.art.

## Company memory: what works without any keys

- Historical NVIDIA FY25 Q1–Q3 financials, with linked investor-relations sources.
- Q2 → Q3 curated changes and thesis assessments, clearly separated from source facts.
- Custom reporting-period comparisons, changes filters, and side-by-side evidence.
- Interactive company relationship graph with source inspection, filters, and zoom.
- Editable thesis assumptions, manual assessments, evidence links, and review markers.
- Report timeline, library, original source links, and extracted topic passages.
- PDF / TXT import, pasted report text, and deterministic passage comparison.
- Evidence search, metric follow-ups, research notes, JSON export, and additional companies.
- Browser persistence, responsive layouts, keyboard focus, Escape-to-close dialogs, reduced motion.

Historical report text is a concise, explicitly labeled paraphrase of public sources. Imported text is preserved. Topic matching and follow-up answers are deterministic, not a hidden LLM call. Unknown questions return matching evidence or say there is insufficient evidence. Only seeded reports have verified structured financial values; uploads do not invent numbers or buy/sell recommendations.

Browser data is local to this browser and device. Export a JSON copy to back it up. Clearing browser storage removes the local workspace. A company graph shown for NVIDIA is the curated Q3 FY25 example, not a claim that Neo4j is connected.

## Automatic report discovery

Use **Find reports** beside the company heading (or **Find online** in Reports). The public Pages build includes a dated index generated from official NVIDIA, Microsoft, and Apple reporting pages/feeds. `npm run discover:reports` regenerates `public/report-index.json`; the deployment workflow runs it before each build. Results are real discovered links, with reporting periods only when the source specifies them. A failed refresh preserves prior links with a visible warning and their original check date. Coverage is limited to these configured issuers in the static index; this is not a universal or continuously refreshed web search.

The initial verified index contains NVIDIA and Microsoft reports. Apple is configured as an official feed source, but its current feed did not return matching reports; the finder reports that limitation instead of supplying guessed links. Shortcut buttons list only companies with results.

**Open report** visits the original source. **Prepare import** fills the existing import form with the discovered URL/title/period and selects the right company. Finding a report does not mean its contents have already been extracted. URL extraction still needs the backend; users can also upload the downloaded document.

With a backend connected, searching a ticker calls `GET /api/reports/discover?ticker=NVDA`. This first tries official SEC submissions (including 10-Q, 10-K, 20-F, and 40-F) and falls back to configured issuer websites when SEC access is unavailable. Discovery does not require Neo4j/Daytona credentials, although backend access still requires `API_TOKEN`. SEC does not permit direct cross-origin API requests from the browser. Source access errors and unsupported tickers are shown instead of fabricated results.

## Live Daytona + Neo4j backend

GitHub Pages serves static files. It cannot hold secrets or run this API. The included Express backend must run on a separate Node/container host.

1. Set the backend environment variables shown in `.env.example`: `API_TOKEN`, `DAYTONA_API_KEY`, `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`, and optionally `NEO4J_DATABASE`.
2. Set `ALLOWED_ORIGIN` to the exact frontend origin, e.g. `https://aryanjhanambi.github.io`. Multiple origins can be comma-separated.
3. Set `REPORT_HOSTS` to the exact public investor-report hostnames the backend may retrieve. Redirects must also stay on allowed hosts. This avoids turning the importer into an unrestricted fetch proxy.
4. Run `npm run server`, or deploy the provided Dockerfile with those environment variables. Use HTTPS for a hosted backend.
5. Open **Connections & settings** in the dashboard. Enter the API URL and the session access token. The token is held in memory, not localStorage. Test the connection.
6. Add a report with its title, period, and source URL, leaving report text empty. The backend creates a Daytona sandbox, downloads/extracts the PDF/HTML/text there, tags evidence passages, and atomically stores the report/evidence/topic graph in Neo4j. The sandbox is deleted in `finally`; automatic stop/delete provides a fallback.
7. Use **Load saved reports from Neo4j** to retrieve persisted reports for the current company. Text and local-file imports intentionally remain browser-local.

Routes (all require `Authorization: Bearer <API_TOKEN>`):

| Route                                   | Purpose                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `GET /api/health`                       | Checks Neo4j connectivity and Daytona configuration                                                          |
| `GET /api/reports/discover?ticker=NVDA` | Finds official filings or company report links without requiring Daytona or Neo4j                            |
| `POST /api/reports`                     | Accepts `companyId`, `companyName`, `title`, `period`, `url`; executes Daytona extraction and saves to Neo4j |
| `GET /api/companies/:id/memory`         | Reads reports and associated evidence from Neo4j                                                             |

Neo4j report-memory model: `(Company)-[:HAS_REPORT]->(Report)-[:CONTAINS]->(Evidence)-[:ABOUT]->(Topic)`. Evidence carries the exact extracted text and category, and each report retains its source URL and period. Parameterized queries prevent report content from becoming Cypher. Automated customer/supplier entity resolution and hosted thesis synchronization remain future extensions. The separate shock lab adds a curated company-exposure graph and an optional Nosana evidence-explanation adapter as described above.

Live service integration needs working credentials and a separately deployed backend. It has not been exercised against live Daytona or Neo4j in the credential-free demo. API tests inject fake services to verify authentication, validation, and routing; they do not prove external service availability.

## Deploy the API on Railway

The repository includes `Dockerfile`, `.dockerignore`, and `railway.json`. This deploys the backend API; the existing GitHub Pages dashboard remains the frontend.

1. In [Railway](https://railway.com/dashboard), create a project from the GitHub repository `aryanjhanambi/thesis-company-memory`, using branch `main` and the repository root. Railway uses the Dockerfile and configuration automatically.
2. Add `API_TOKEN` as a long random secret and `ALLOWED_ORIGIN=https://aryanjhanambi.github.io` in the service Variables tab. These two variables are enough for authenticated live report discovery; discovery does not need Daytona or Neo4j.
3. For report extraction and persistent company memory, also add `DAYTONA_API_KEY`, `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`, and optionally `NEO4J_DATABASE`. Keep all service keys in Railway variables, never in GitHub Pages frontend variables.
4. Deploy and generate a Railway public domain under service Settings → Networking. The process listens on `0.0.0.0` and the injected `PORT`.
5. Verify `https://YOUR-SERVICE.up.railway.app/healthz` returns `{"status":"ok"}`. This public endpoint is process liveness only; authenticated `/api/health` separately checks Neo4j and reports Daytona configuration.
6. On the dashboard, open **Connections & settings**, enter the Railway service URL and your `API_TOKEN`, then test the connection. **Find reports** will now perform live discovery through Railway. URL imports become available when Daytona and Neo4j are configured.

Optionally set GitHub repository Actions variable `VITE_API_URL` to the Railway URL and redeploy Pages to preconfigure the endpoint. Never put `API_TOKEN`, Daytona keys, or Neo4j credentials in a `VITE_` variable; those variables are public browser code. Each browser session supplies its access token through the settings dialog.

`railway.json` configures one replica, an unauthenticated `/healthz` deployment probe, and a bounded restart policy. Live service credentials and authenticated Railway access are required to complete deployment; the repository configuration alone does not create a running Railway service.

## Publish on GitHub Pages

The workflow in `.github/workflows/deploy.yml` installs, tests, builds, and deploys after pushes to `main`. In repository Settings → Pages, select **GitHub Actions** as the publishing source. `base: './'` keeps assets working under the repository subpath. No server secrets belong in the frontend or repository.

Optional: set repository Actions variable `VITE_API_URL` to preconfigure the public backend URL. Each visitor can also configure a URL in the dashboard.

## Verification

```sh
npm test
npm run build
npm audit
```

Tests cover source preservation, passage differences, evidence retrieval, report-origin restrictions, backend authorization, CORS, request validation, and import/memory routes. Browser QA covers the main demo journey and responsive layouts.

## Historical sources

- [NVIDIA Q1 FY25 results](https://investor.nvidia.com/news/press-release-details/2024/NVIDIA-Announces-Financial-Results-for-First-Quarter-Fiscal-2025/default.aspx)
- [NVIDIA Q2 FY25 results](https://investor.nvidia.com/news/press-release-details/2024/NVIDIA-Announces-Financial-Results-for-Second-Quarter-Fiscal-2025/default.aspx)
- [NVIDIA Q3 FY25 results](https://investor.nvidia.com/news/press-release-details/2024/NVIDIA-Announces-Financial-Results-for-Third-Quarter-Fiscal-2025/default.aspx)
- [NVIDIA quarterly revenue by market](https://investor.nvidia.com/files/doc_financials/2025/Q325/Rev_by_Mkt_Qtrly_Trend_Q325.pdf)

FY25 is NVIDIA's fiscal reporting year; the releases above were published in calendar 2024. The demo is historical research, not a live market dashboard.
