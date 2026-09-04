# Testing

Three tiers, two runners. 103 tests in total: 33 under `bun test`, 70 under Python `unittest`.

```bash
bun run check-types                          # 12 packages
bun run lint                                 # oxlint, silent when clean
bun run format:check                         # oxfmt
bun test tests                               # 33 tests, 3 files
python3 -m unittest discover -s tests -v     # 70 tests, 11 files
```

---

## The trap: ten tests skip silently

`tests/test_idempotency.py` and `tests/test_audit_logging.py` need a real Postgres, five tests each.
Without `POSTGRES_URL` set and reachable, all ten **skip rather than fail**, and `unittest` still
prints `OK (skipped=10)`. A green run does not mean those ten passed.

```bash
python3 -m unittest discover -s tests -v 2>&1 | grep -c skipped   # expect 0
```

Skipping is the correct behaviour, not a bug: the alternative is a test suite that fakes a pass on a
guarantee it never checked. But the skip is easy to miss, and these are the tests covering the
guarantees that matter most, so run them against a database before believing the suite.

```bash
POSTGRES_URL=postgres://user@127.0.0.1:5432/razorpay \
  python3 -m unittest discover -s tests -v
```

They exercise the database-level guarantees directly, including by bypassing the API and writing to
Postgres as a rogue client would: `ON CONFLICT DO NOTHING` on `accounts.customer_ref` and
`transactions.razorpay_event_id`, the compare-and-set that makes a second decision a no-op, and
`merchant_decisions_dismiss_reason_check`. Application code cannot make those true; only the schema
can, which is Principle 3.

---

## What each file covers

### `bun test` (TypeScript and the Node-side contract)

| File                             | Tests | Covers                                                               |
| -------------------------------- | ----- | -------------------------------------------------------------------- |
| `tests/razorpay.test.mjs`        | 24    | Both Razorpay signature schemes, AES-256-GCM crypto, payment mapping |
| `tests/voice_agent.test.mjs`     | 5     | Voice turn scripting and outcome mapping                             |
| `tests/detector_parity.test.mjs` | 4     | The TypeScript fallback engine agrees with the Python detector       |

The parity file is the interesting one. Two implementations of the same algorithm exist on purpose,
so the API degrades instead of failing when the sidecar is down. Parity tests are what stop them
drifting into two different detectors.

### Python `unittest`

| File                          | Tests | Covers                                                        |
| ----------------------------- | ----- | ------------------------------------------------------------- |
| `test_response_parser.py`     | 14    | Transcript to outcome across en/hi/mr, including `unclear`    |
| `test_cluster_scorer.py`      | 13    | Corroboration gating and the benign-only ceiling              |
| `test_conversation_flow.py`   | 10    | Scripts exist and differ per language and signal type         |
| `test_graph_builder.py`       | 7     | Signal edges, and the repetition rule for timing and promo    |
| `test_audit_logging.py`       | 5     | **Needs Postgres.** Every state change leaves an audit record |
| `test_idempotency.py`         | 5     | **Needs Postgres.** DB-level guarantees                       |
| `test_verify_flow.py`         | 4     | End-to-end verification flows B, C and D                      |
| `test_clustering.py`          | 3     | Rings cluster together, look-alikes do not merge in           |
| `test_chargeback_exposure.py` | 3     | Exposure sums only transactions that individually look risky  |
| `test_transaction_risk.py`    | 3     | Per-transaction risk is bounded and heuristic                 |
| `test_simulated_call.py`      | 3     | A call with no transcript reports `reached: false`            |

Tests needing `networkx` skip when it is missing, on the same principle: they do not fake a pass.

---

## What the tests deliberately do not cover

- **Live Razorpay.** No environment this project has run in could reach `api.razorpay.com`. Order
  creation, capture and refund are unit-tested against fixtures and the documented contract, never
  against the live service. The code says so at both call sites.
- **The core assumption.** The tests check that the implementation does what it claims. They cannot
  check that households really do share addresses but not sequential phone blocks, because the same
  conviction wrote the generator and the scorer.
- **Fluent-speaker review** of the Hindi and Marathi scripts.

## Regenerating the measurements

Tests check behaviour. The measured numbers live in `data/*.json` and are regenerated separately;
see [`metrics.md`](metrics.md) for the full table and the commands.
