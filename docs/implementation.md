# Implementation contract

Approved scope: local tus/S3 upload recovery, concurrent files, 100 MiB each,
content identity, independent integrity and optional malware checks, transfer
estimates, a reproducible fault suite and public English/PT-BR presentation.

## Delivery sequence

- [x] Bootstrap pinned Compose services, TypeScript tooling and CI.
- [x] Implement streaming gateway, persistent records, reconciliation and cleanup.
- [x] Implement concurrent browser uploads, pause/reselection, hashing and ETA.
- [x] Add optional ClamAV quarantine with fail-closed download policy.
- [x] Exercise transport failures, restart, integrity, scanner and browser flows.
- [x] Prepare concise documentation, measured evidence and the release video.

Publication is tracked in pull request #1 and the v1.0.0 release. Tests and
reference-run provenance are documented in `evidence.md`.

## Boundaries

`server/` owns records, tus gateway, storage and verification. `src/` owns the
browser. `shared/` holds the public record contract. `tests/` and `scripts/`
exercise logic and real services. One tusd process, one app process; all services
except the loopback app remain private. No login, cloud provisioning or
production-readiness claim. Files expire 24 hours after the last upload activity.

## Design

An open transfer workbench: cool paper (#f2f6f9), white workspace (#ffffff),
deep navy (#142a43), ocean blue (#185adb), muted slate (#60758a), and amber
(#9a5b00) for interrupted work. System sans for controls and a large compact
headline; proportional text throughout. A continuous transfer list, rather than
a dashboard of decorative cards. The memorable element is a two-layer progress
track distinguishing network activity from server-confirmed bytes.

## Critical acceptance

Never call a network pause a fault injection. Never call scanner errors clean.
Never accept another file based only on its name/size. Never release raw tus/S3
downloads around quarantine. Never publish bytes-saved or performance numbers
without their measurement boundary and reproducible experiment.
