# Architecture

Proposed design. Nothing below `config.py` exists yet; treat module names as
placeholders until the first implementation lands.

## Flow

```
sources ──► ingest ──► data/raw ──► transform ──► data/processed / Postgres
                                                        │
                                                        ▼
                                  reports ◄── evaluate ◄── models
```

## Components (planned)

| Module | Responsibility |
|---|---|
| `config` | Settings from env vars (`.env.example`). **Exists.** |
| `ingest` | One client per source in `DATA_SOURCES.md`; writes raw, immutable snapshots with fetch timestamp. |
| `transform` | Normalise units, timestamps (UTC), station/grid IDs; QC flags; load to Postgres. |
| `models` | Feature building, training, persisted artefacts in `models/`. |
| `evaluate` | Backtests and skill scores against observations. |
| `reports` | Render outputs to `reports/`. |

## Principles

- Raw data is never edited in place; transforms are reproducible from `data/raw`.
- All timestamps stored in UTC.
- Each source client handles its own rate limits and terms of use.
- Postgres (via `docker-compose.yml`) is the system of record for processed data;
  files under `data/` are cache/staging.

## Open decisions

- Target variables and horizon (what is being forecast, where, how far ahead).
- Model family (statistical post-processing of NWP vs. ML vs. ensemble blend).
- Whether Postgres is needed at MVP or Parquet files suffice.
