# Site performance

## Rendering and data freshness

- `/` is prerendered from the committed detector, hold-verification, threshold and model-comparison
  reports via `web/next/src/lib/landing-reports.ts`. These are the same reports bundled by the API.
  Rendering the page no longer requires `/api/metrics`, `/api/evidence`, or the five live funnel queries.
- `/connect` is prerendered too. Connection and onboarding actions still run in the browser.
- `@/reports/*` resolves to the root `data/` directory. `turbo.json` includes `data/*.json` in its
  global dependencies so changing an evaluation report invalidates cached builds. Rebuild and deploy
  the web app when publishing regenerated reports.
  Both Docker builders explicitly copy `data/` because `turbo prune` omits root report files.
- CSS-only animated report charts render on the server. They keep their existing CSS animations,
  reduced-motion behavior and accessible labels, without shipping chart code or hydrating chart props.
  Interactive graphs, charts and controls remain client components.
- The hero shrinks to mobile widths and grouped model charts scroll within their own frame,
  keeping long labels aligned without creating page-wide horizontal overflow.
  The comparison table contains its visually hidden cell labels within its scroll frame too.
- Developer tools have a separate lazy-loaded chunk and are only rendered outside production.

Live queue, payment, analytics and metrics pages still read current API data. No shared cache was
added for decisions, credentials, payments, roles or sessions. Existing `router.refresh()` calls
after mutations remain in place.

## Database work

| Path                                  | Before                                          | After                                            |
| ------------------------------------- | ----------------------------------------------- | ------------------------------------------------ |
| Global demo banner                    | Status plus full analytics request              | One status request                               |
| Data-existence check                  | Analytics counts and distributions              | `SELECT id FROM transactions LIMIT 1`            |
| Nonempty analytics                    | 13 queries across 3 sequential stages           | 9 queries across 2 sequential stages             |
| Analytics risk and size distributions | Transfer every cluster score and membership row | Aggregate buckets and size histogram in Postgres |
| Queue member counts                   | Transfer every membership on the page           | Group counts in Postgres                         |
| Ring detail                           | Cluster, then members, then detail queries      | Cluster and members in parallel, then details    |

`GET /api/razorpay/status` adds the boolean `data.hasData`. Connection creation responses are
unchanged. Deploy the API before the web app so the banner can read the new field. The status
request is aborted when the banner unmounts, preventing obsolete requests from updating its state.

Analytics still counts an account or transaction only once when it belongs to multiple clusters.
The final risk bucket includes a score of 1, null exposure still totals to zero, and memberless
clusters remain absent from the size histogram, matching the previous behavior.

## Verification

Production web build and API/web TypeScript checks pass. The existing 7 Bun tests and 28 Node tests
pass. Two opt-in Postgres integration tests cover empty data, bucket boundaries, overlapping ring
membership, payment amounts, status and decision counts, banner status, queue member counts and
ring detail. They call GET handlers directly and do not start payment pollers or external actions.
Chromium interaction checks pass at 390px and 1440px: hero tabs, language and theme controls,
mobile navigation, back navigation and the CSV panel. The final mobile document width is 390px,
with charts and tables scrolling locally. Report charts and headline values also render with
JavaScript disabled. Lint reports only two existing unused-variable warnings in the detector.

Run them against a disposable local database in PowerShell:

```powershell
docker run -d --rm --name razorpay-performance-test -e POSTGRES_PASSWORD=performance-test -e POSTGRES_DB=razorpay_perf_test -p 127.0.0.1:55432:5432 postgres:16-alpine
docker exec razorpay-performance-test pg_isready -U postgres
# Wait for "accepting connections" before running the tests.
$env:TEST_POSTGRES_URL='postgres://postgres:performance-test@127.0.0.1:55432/razorpay_perf_test'
bun run test:performance
docker stop razorpay-performance-test
```

The tests reset fixtures in that database. They refuse remote hosts and database names other than
`razorpay_perf_test`, and skip without `TEST_POSTGRES_URL`. On Windows with Bun 1.3.2, the existing
POSIX `bun run test` wrapper does not run its tests; use `bun test tests` and `node --test tests/*.mjs`
directly for the existing suites.

Local Chromium checks against production builds downloaded 524,894 bytes of JavaScript before
and approximately 518 KB afterward. The banner's analytics request disappeared and no JavaScript errors
were reported. These are local measurements, not a production speed claim: the configured API
was unreachable in the baseline run, so page timing would compare against its error fallback.
