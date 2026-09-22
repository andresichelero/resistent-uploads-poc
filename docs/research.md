# Research and attribution

Research conducted for this project in September 2026. Primary documentation
governs behavior; issues and social posts suggest failure scenarios, not guarantees.
No repository's popularity is presented as evidence of hiring outcomes.

## Primary technical sources

- [tus 1.0 specification](https://tus.io/protocols/resumable-upload): offsets, conflicts and extensions.
- [tus-js-client API](https://github.com/tus/tus-js-client/blob/main/docs/api.md): retries, abort and progress callbacks.
- [tusd S3 backend](https://tus.github.io/tusd/storage-backends/aws-s3/): multipart state, auxiliary objects and temporary disk.
- [tusd locks](https://tus.github.io/tusd/advanced-topics/locks/): process-local locking and interrupted requests.
- [tusd hooks](https://tus.github.io/tusd/advanced-topics/hooks/): event semantics and application integration.
- [AWS multipart](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html): part completion and cancellation costs.
- [AWS integrity](https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity-upload.html): full/composite checksums and ETag limitations.
- [Uppy Golden Retriever](https://uppy.io/docs/golden-retriever/): browser file persistence and reselection limits.
- [MDN navigator.onLine](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/onLine): connectivity hints are not proof of reachability.
- [hash-wasm](https://github.com/Daninet/hash-wasm): incremental hashes and worker support.
- [ClamAV scanning](https://docs.clamav.net/manual/Usage/Scanning.html) and [stream protocol](https://docs.clamav.net/manual/Usage/ClamdProtocol.html): daemon isolation and scan limits.
- [ClamAV configuration](https://github.com/Cisco-Talos/clamav/blob/main/etc/clamd.conf.sample): encrypted/limit alerts.
- [EICAR fixture](https://www.eicar.org/download-anti-malware-testfile/): harmless antivirus integration test.
- [OWASP file upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html): private storage, size limits and gated access.
- [SeaweedFS](https://github.com/seaweedfs/seaweedfs) and [archived MinIO](https://github.com/minio/minio): local storage selection.

## Examples studied, not copied

| Project                                                                       | Context                   | Lesson                                                             |
| ----------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------ |
| [tus demo](https://tus.io/demo)                                               | Official demo             | Make reload/reselection and HTTP activity observable.              |
| [tusd](https://github.com/tus/tusd)                                           | Protocol implementation   | Reuse protocol correctness rather than reinventing it.             |
| [Demitroi/tusd-example](https://github.com/Demitroi/tusd-example)             | Personal integration demo | Uppy+tusd+S3 alone is not an original differentiator.              |
| [NestJS demo](https://github.com/tumainimosha/nestjs-resumable-upload-demo)   | Archived learning project | State purpose clearly; don't inherit old dependencies.             |
| [Spring demo](https://github.com/tomdesair/tus-java-server-spring-demo)       | Library integration demo  | Explain module boundaries and production limits.                   |
| [use-tus](https://github.com/kqito/use-tus)                                   | React library             | Clear control/state API without unnecessary abstraction.           |
| [multipart-upload-js-demo](https://github.com/Tonel/multipart-upload-js-demo) | S3 tutorial demo          | Avoid leaving a boilerplate README without evidence.               |
| [Uppy](https://github.com/transloadit/uppy)                                   | Upload toolkit            | Mature UX reference; separate dependency features from authorship. |

## Public discussions

- [Uppy #5961](https://github.com/transloadit/uppy/issues/5961): historical refresh/resume failure. Motivated end-to-end validation beyond restored metadata.
- [Uppy #5927](https://github.com/transloadit/uppy/issues/5927): historical completion/cleanup issue; completion events alone are not success evidence.
- [Progress regression discussion](https://community.transloadit.com/t/multipart-upload-progress-jumps-backward-on-resume-awss3/17736): hiding rollback distorts progress and ETA.
- [ETA discussion](https://community.transloadit.com/t/upload-remaining-time-in-status-bar-is-fluctuating-while-uploading/15977): user reports motivated rate-window tests.
- [ClamAV #1408](https://github.com/Cisco-Talos/clamav/issues/1408): historical integration report; unscannable must remain distinct from clean.
- [HN discussion](https://news.ycombinator.com/item?id=18512455): historical protocol discussion, indexed text accessible; direct access rate-limited.
- [Reddit discussion](https://www.reddit.com/r/SaaS/comments/1nglsiy): author anecdote about resumable uploads; indexed text accessible, direct access timed out.
- [LinkedIn upload post](https://www.linkedin.com/posts/mallikcheripally_javascript-javascriptdeveloper-frontenddeveloper-activity-7247455349945819136-AZZ0): illustrative discussion, not a technical authority or validated benchmark.

No sufficiently relevant, verifiable X post or GitHub Discussions thread was
obtained. GitHub issues and the official community forum supplied better evidence.
The interface, wording, test harness and generated fixtures were created for this
project; dependencies and concepts retain their upstream attribution.
