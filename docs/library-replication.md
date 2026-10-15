# Mac and Windows Library replication

Pond can replicate one Library between macOS and Windows while keeping a
separate local Library and SQLite index on each computer. This is asynchronous
file exchange, not real-time cloud sync. Pond never opens a Library bundle,
SQLite database, WAL file, or journal from the exchange folder.

Both computers must run a build of this fork that includes the replication
protocol. The Windows runtime and cross-platform filesystem fixtures were
tested during this port. An unsigned macOS artifact can be built and downloaded
from the Package desktop workflow after CI succeeds. It was not exercised on a
physical Mac during the Windows port, so keep verified backups while validating
the first Mac round trip.

## Set up a second computer

1. Back up the source Library, then restore that backup locally on the second
   computer. The two local forks must retain the same `metadata.json` Library
   ID; backup and restore preserve it. Keep the forks on separate computers or
   OS accounts: two forks with the same ID on one account would share
   `userData/indexes/<library-id>.db`. Do not point both apps at one `.pond`
   folder.
2. Create an empty folder in a service that synchronizes ordinary files, such
   as iCloud Drive, OneDrive, Dropbox, or a shared network folder. Let the
   service finish downloading it on both computers.
3. On each computer, open the local fork and go to **Settings → Library → Mac +
   Windows Replication**. Choose the local path to that same exchange folder.
4. Leave Pond running or reopen it later. Pond checks on startup, after local
   edits, and every 30 seconds. Offline edits are published when the exchange
   folder becomes available again.

Pond writes immutable event bundles beneath `pond-replication-v1`. A bundle is
accepted only after its completion marker, manifest, sizes, paths, and SHA-256
checksums validate. Incomplete uploads are ignored until a later pass. Damaged,
unexpected, oversized, symbolic-link, path-traversal, Windows-reserved, and
case-colliding content is rejected. The local state records deterministic
conflict evidence so an overwritten edit can be diagnosed.

The immutable bundles remain in the exchange folder as recovery evidence; Pond
does not garbage-collect them in this version. A single attachment is limited
to 2 GiB, an event to 4 GiB and 10,000 attachments, and a manifest to 1 MiB.
Large first-time forks can therefore use substantial synchronized storage.

## Conflict behavior

Each device maintains a Lamport counter. Pond compares the counter first and a
stable device/event identity second, so clock skew does not decide a conflict.
The winning full entity snapshot or tombstone is applied through the normal
recoverable transaction journal. Replaying or receiving events out of order is
idempotent. A winning deletion stays deleted when an older update arrives.

Replication currently covers Saves, their declared originals and derived
files, trash/deletion state, folder memberships, folders, tags, tag groups,
tag-group memberships, and saved views. Provider credentials, browser cookies,
API keys, application preferences, local caches, source raw JSON, pipeline
tasks/history, previews, backups, transaction journals, and SQLite indexes are
local and never exported. Library-level identity fields in `metadata.json`
(name, icon, and accent) are not replicated after the initial fork.

Within a Save row, Pond deliberately excludes the source Account identity,
remote media URL, raw and slim provider responses, per-file source URLs, local
font-activation state, and pipeline start/completion timestamps. It replicates
the user-visible metadata and deterministic analysis fields, including media
and codec facts, camera/EXIF data, hashes, embeddings and model identifiers,
captions/OCR/transcripts, aesthetic and sensitive-content results, suggested
tags, transforms, ratings, trash state, and every declared Library file.

If Settings reports a rejected bundle, keep both local Libraries intact, allow
the file service to finish, and retry. If it remains rejected, preserve the
exchange folder for diagnosis and restore from a verified Library backup if
necessary. Turning replication off stops publishing and applying events; it
does not delete local data or the immutable exchange history.
