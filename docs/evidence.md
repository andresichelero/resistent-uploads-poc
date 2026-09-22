# Verification evidence

The result is a tested local experiment, not a throughput benchmark or a claim
of production readiness. GitHub Actions performs a fresh checkout, starts empty
Docker volumes, builds the application and runs both operating modes. See the
[workflow and downloadable logs/reports](https://github.com/andresichelero/resistent-uploads-poc/actions/workflows/ci.yml).

## Checks

| Layer           | Verified scenarios                                                                                                                                                                             |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static/build    | TypeScript, ESLint and production Vite build                                                                                                                                                   |
| Unit/regression | 15 tests: download policy, hashes, scan classification, ETA, records, retention, active transfers and creation/cancellation races                                                              |
| Real storage    | 7 experiments: parallel uploads, offset conflicts, lost response, same-resource contention, process restart, corruption, empty/oversized files, cancellation, origin checks and storage outage |
| Browser         | 3 flows: parallel upload/pause/reload/reselection/download; a failed PATCH during real offline emulation; narrow viewport and keyboard focus                                                   |
| Real ClamAV     | 5 scenarios: clean content, EICAR, encrypted ZIP, offline scanner and retry after recovery                                                                                                     |

Browser emulation explicitly waits for a failed PATCH; a pause or a connectivity
indicator alone is not accepted as evidence of interruption. The integration
proxy drops a response only **after** the upstream finishes accepting the request.
Fixtures contain generated data; the antivirus fixture is the harmless EICAR
test string, never real malware.

## A controlled recovery comparison

The same 16 MiB file loses the response to an accepted 8 MiB PATCH:

| Strategy                                        | Total PATCH body bytes received by the test proxy |
| ----------------------------------------------- | ------------------------------------------------: |
| Query offset and resume                         |                               16,777,216 (16 MiB) |
| Abandon the resource and restart the whole file |                               25,165,824 (24 MiB) |

Resumption avoids sending the already accepted 8 MiB again in this scenario.
This counts HTTP request **bodies**, not headers, TCP retransmission, browser
progress events or S3 traffic. It is not a general claim of 33% savings or higher
throughput. Both completed objects have SHA-256
`723706eb9c3dfd0f42ddef9c04464051b6d8ca4533614201d6bccc666beb9354`.

## Reference artifacts

- [Integration report](evidence/integration.json): exact offsets, digests, durations and measurement boundary.
- [Antivirus report](evidence/antivirus.json): actual verdicts and engine/signature version.
- [Recording timeline](evidence/demo-timeline.json): events from the real 74-second demo.
- [Screenshot](media/workbench.png): application state after reconnection and verification.
- [Video release](https://github.com/andresichelero/resistent-uploads-poc/releases/tag/v1.0.0): MP4 plus machine-readable reports.

The reference capture used the application at `a71f2c4` with the readiness fix
`9763d5c`. The subsequent `4e28a59` adds a regression-tested correction for pending
deletion after a service outage. The release CI tests the complete final tree.
Local measurements were made on Windows with Docker Linux containers; do not
compare their durations with a cloud or production workload.

Pinned services: tusd 2.10.1, SeaweedFS 4.47, ClamAV 1.5.4 and Node 24.14.0
in the application container. The local scanner reported signature database
28131 dated September 22, 2026. Future runs may use newer signatures and have
different timings. Local compatibility does not establish AWS deployment support.

## Reproduce

Follow the README setup, then run `npm run check`, `npm run test:integration`
and `npm run test:e2e`. Switch to the antivirus profile before
`npm run test:antivirus`. Re-record with `npm run demo:record` in basic mode.
The scripts write fresh artifacts without overwriting these committed reference
reports. Tests use disposable files and restart this project's services.
