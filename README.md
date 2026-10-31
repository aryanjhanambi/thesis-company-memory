# Thesis

An investor's second brain for a company. Keep the company's story, your assumptions, and the evidence behind them together. Each new report adds to that memory.

## Run the dashboard

Requires Node.js 22.16+ and npm.

```sh
npm ci
npm run dev
```

Open the printed local URL. `npm run build` produces `dist/`; `npm run preview` serves that build.

Built with React 19, TypeScript, Vite, Tailwind 4, Lucide, and a shadcn-compatible structure. Reusable UI lives in `src/components/ui`; `components.json` maps the `@/components/ui` alias. This keeps generated shadcn components and project imports consistent. Global theme tokens and responsive styles are in `src/index.css`.

The supplied Analytics Bento component lives in `src/components/ui/analytics-bento.tsx`, adapted for financial reporting periods and the research-led visual design. `src/research.css` defines the paper-and-ink theme: serif section headings, monospaced numbers, ruled sections, plain status labels, and an asymmetric reading layout. Decorative rings, gradients, tinted icon tiles, glass effects, and card shadows are removed. Its financial view uses actual quarterly observations rather than invented daily series. Original supplied component credit: vasnev.art.

## What works without any keys

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

| Route                           | Purpose                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `GET /api/health`               | Checks Neo4j connectivity and Daytona configuration                                                          |
| `GET /api/reports/discover?ticker=NVDA` | Finds official filings or company report links without requiring Daytona or Neo4j |
| `POST /api/reports`             | Accepts `companyId`, `companyName`, `title`, `period`, `url`; executes Daytona extraction and saves to Neo4j |
| `GET /api/companies/:id/memory` | Reads reports and associated evidence from Neo4j                                                             |

Neo4j model: `(Company)-[:HAS_REPORT]->(Report)-[:CONTAINS]->(Evidence)-[:ABOUT]->(Topic)`. Evidence carries the exact extracted text and category, and each report retains its source URL and period. Parameterized queries prevent report content from becoming Cypher. The initial backend supports document/evidence/topic memory; automated customer/supplier entity resolution, hosted thesis synchronization, and an LLM reasoning service are future extensions. Nosana is optional and is not integrated in this version.

Live service integration needs working credentials and a separately deployed backend. It has not been exercised against live Daytona or Neo4j in the credential-free demo. API tests inject fake services to verify authentication, validation, and routing; they do not prove external service availability.

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
