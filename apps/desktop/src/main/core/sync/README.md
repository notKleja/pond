# `core/sync`

This module syncs remote source lists into one local Library. Cross-device
Library replication is a separate opt-in protocol documented in
[`docs/library-replication.md`](../../../../../../docs/library-replication.md).
It uses separate local Libraries and indexes; a shared `.pond` folder is not a
supported cross-device database.

Top-level sync orchestration: turn "import everything I've saved through an
Account or Watch" into idempotent enqueues into the URL-first ingest pipeline,
safely and incrementally.

`syncAccount(accountId, opts)` is the Account unit of work.
`syncSource(source, opts)` coordinates every Account and Watch for one Source,
and `syncAllSources(opts)` fans out across connected Sources. They accept
`{ trigger: "manual" | "cron", maxItems?, forceFull? }`.

## How a run flows

```
syncAccount(accountId)
  → loadSyncBaseline(account, forceFull)  # full set OR bounded recent window
  → harvestSourceList / harvestTwitterBookmarks  # paced by the governor, early-stops on known ids
  → dedupe vs knownIds → fresh / recovery
  → enqueue(fresh)                        # one chunked, transactional insert path
  → persistWatermark(accountId)           # only AFTER a successful enqueue
```

### Incremental cursor (watermark)

Per-Account state lives under `prefs.sync.accounts[accountId].sync`
(`SourceSyncPrefs`).

- `highWaterMark` — most recent source id we've enqueued (lists are newest-first).
- `lastFullSyncAt` — gates the expensive full-list walk vs the cheap incremental
  walk. A run is **full** on the very first sync (none recorded) or when
  `forceFull` is set; otherwise it's **incremental**.
- `knownCount` — library size at last sync (UI + sanity).
- `runningSince` — set while a run is in flight, cleared when it finishes. A value
  still present at startup means the previous run was interrupted (crash /
  force-quit); `recoverInterruptedSyncs()` clears it and records an honest
  `lastError: "interrupted"` so the UI never shows a stuck spinner. Re-running is
  safe because watermarks are only advanced after a successful enqueue.

Incremental runs load only a bounded **recent window** of known ids
(`RECENT_KNOWN_WINDOW`) instead of the whole library, and the harvesters
**early-stop** once they hit a streak of already-known ids — so a no-op sync is
cheap and a sync with N new items walks roughly N items, not the entire backlog.

**Full re-sync escape hatch:** pass `forceFull: true` (exposed over IPC via
`syncRunNow` / `syncRunAll`) to ignore the watermark and walk the whole remote
list — for drift recovery.

## Account safety (it defers entirely to the governor)

Every platform request is gated by the rate governor (see
[`core/refresh/README.md`](../refresh/README.md) and
[`core/pipeline/rate-governor.ts`](../pipeline/rate-governor.ts)). Harvesters
back off (never escalate) on 429, persist cooldowns across restart, and hard-stop
on challenge/checkpoint. `syncAllSources` runs sources **concurrently**, but real
concurrency is bounded by the shared hidden-window pool and the per-account
governor; sources hit different domains, so parallelism across sources doesn't
raise per-account risk.

### Background cron

`registerSyncCron()` in [`main/index.ts`](../../index.ts) polls every 30m and runs
`syncAllSources({ trigger: "cron" })` when due. It is the highest account-risk
path (unattended), so it is the most conservative: pref-gated
(`prefs.sync.cron`, default every 6h), connected-only, skipped while offline /
storage-guarded / a run is in flight, with jittered start times so many installs
don't hit a platform in lockstep.

## Ingest write path (batched + non-blocking-ish)

Fresh URLs go through `enqueue` (`core/pipeline/enqueue.ts`): rows are
built then committed in **bounded chunks, one transaction per chunk**, yielding to
the event loop between chunks. SQLite is synchronous (`better-sqlite3`) and runs
on the main thread, so a single giant transaction would freeze the UI on a 50k
first sync; bounded chunks keep each blocking burst short while still being
10–100× faster than per-URL writes. (A full out-of-process `utilityProcess` DB is
a future step; the chunked/yielding path is the safe interim.)

The renderer stays in sync via the incremental `syncAction` broadcast model —
each created/updated save emits a `sync_actions` row that the renderer store
applies, so the UI never re-queries the whole library.
