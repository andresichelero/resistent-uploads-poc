# Decisions and boundaries

## Reuse the protocol; own the behavior around it

React/TypeScript and tus-js-client implement the browser experience. Fastify owns
application records, download policy and the streaming gateway. tusd owns tus
protocol correctness and multipart S3 persistence. SQLite is sufficient for one
local application process; a broker and a distributed database add no useful
guarantee here. The database stores metadata, never file bodies.

Direct S3 multipart can avoid the backend carrying upload traffic. It also
requires signing, part coordination, URL expiry and completion/cancellation
handling. That alternative is documented rather than implemented as a second
engine. Eight-MiB PATCHes make checkpoints observable in this demonstration;
they are not claimed to be a universally optimal chunk size.

## Durable state and uncertain outcomes

An upload offset belongs to the server. The client reconciles with HEAD after a
network error. A missing response does not mean a failed write. Browser progress
can therefore differ from the confirmed offset. The five-second speed window
resets on resume, suppresses stale estimates and excludes verification time.

Multiple files progress independently. Requests for the same resource are
serialized by tusd. Its S3 locks are process-local, so this setup deliberately
runs one tusd instance. A competing request can interrupt a writer with
`ERR_UPLOAD_INTERRUPTED`; recovery must query its persisted offset. Background
reconciliation does not issue HEAD while this gateway has an active PATCH.

Creation uses a UUID idempotency key bound to name, size and full SHA-256.
Hooks update persistent records, and a periodic reconciler rediscovers completed
uploads and interrupted verification. Cleanup does not erase its record until
remote deletion succeeds. A failed cancellation remains pending and is retried.
TTL is 24 hours after last upload activity, and active gateway requests are not
expired. tusd termination handles its objects and unfinished multipart state.

The S3 backend needs temporary disk space and persists `.info`, optional `.part`,
multipart parts and the completed object. The object is not visible as a complete
file until multipart completion. Named volumes preserve both metadata and data.
SeaweedFS was chosen for local compatibility; MinIO's upstream repository was
archived when this project was researched.

## Three different claims

1. **Transferred:** the server confirms the expected length.
2. **Identical:** SHA-256 and size from the stored object match the selected file.
3. **Scanned:** ClamAV returns a verdict with a recorded engine/signature version.

The browser hashes the whole selected file in a worker before creating/resuming.
This costs a full local read but rejects an unrelated same-name/same-size file.
The server streams the completed object through SHA-256; S3 ETag is not substituted
for a content hash. Downloads receive another browser-side hash check before save.

In basic mode, verified files can download with an explicit `Antivirus not run`
label. Antivirus mode requires a clean verdict; detection, timeout, engine outage,
encrypted content and exceeded scan limits block downloads. Existing adverse
verdicts are retained even when returning to basic mode. Files stay in private
storage rather than being copied between public and quarantine buckets.

ClamAV receives a stream over the private container network. Limits are 100 MiB
input, 200 MiB expanded content, recursion 10, 1,000 entries and 120 seconds.
Heuristic limits/encryption alerts are inconclusive, not malware classifications.
The scanner is not a sandbox. Signature freshness is visible in its VERSION
response; updating signatures requires network access. No files go to external
analysis providers.

## Local security boundary

Only `127.0.0.1:3000` is published. Host/Origin and cross-site checks reduce
browser-to-localhost attacks; storage, raw tus downloads and scanner sockets are
not public. Display names cannot become storage paths. Content is downloaded as
an attachment with `nosniff`, never rendered inline. Container credentials are
explicitly disposable local values, never cloud credentials.

This is not a hostile multi-user service: a process with local access can use
the same API, inspect/delete demo files and access Docker. Public deployment would
need authentication/ownership on every operation, TLS, quotas/rate limits, proper
secret management, monitoring and a reviewed lock strategy before adding replicas.

## AWS S3 configuration path (not executed)

Use a dedicated private bucket; replace the local S3 endpoint on both application
and tusd with AWS settings and supply region/credentials externally. Never commit
them. Keep app and tusd on the same bucket and prefix convention. Grant only the
required Get/Put/Delete/ListParts/AbortMultipart permissions, then run the same
integration tests before claiming compatibility for that deployment.

Configure S3 lifecycle abortion of abandoned multipart uploads as defense in
depth. It does not remove tusd's `.info`/`.part` objects or replace application
retention. Do not expose the demo by changing its bind address alone.
