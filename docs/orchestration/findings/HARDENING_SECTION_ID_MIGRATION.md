# CineForge OS — Hardening Section ID Migration

> Generated during Issue #1 / Draft PR #2 cleanup.
> Purpose: preserve auditability after eliminating duplicate section identifiers.

The first occurrence of each legacy section ID remains unchanged.
Only later duplicate occurrences were moved to the `Z<old>` namespace.

| Legacy duplicate | New unique ID | Section title |
|---|---|---|
| HS | ZHS | CI/release artifact provenance |
| HT | ZHT | GitHub Actions trust baseline |
| HU | ZHU | Release identity and anti-rollback |
| HV | ZHV | Signed update manifest closure |
| HW | ZHW | Installer/elevation transaction |
| HX | ZHX | Signing authorization boundary |
| HY | ZHY | Final-byte signature closure |
| HZ | ZHZ | Updater/bootstrapper root of trust |
| IA | ZIA | Hermetic release build |
| IB | ZIB | Packaged-content SBOM and legal closure |
| IC | ZIC | Release artifact privacy/symbol handling |
| ID | ZID | Release trigger and protected environment authority |
| IE | ZIE | Offline install/update revocation policy |
| IF | ZIF | Installer/update lifecycle |
| IG | ZIG | Required supply-chain tests |
| IH | ZIH | Privacy purge closure and completion barrier |
| II | ZII | Forward deletion/revocation journal |
| IJ | ZIJ | Embedding/vector/semantic-index security scope |
| IK | ZIK | Model/session isolation |
| IL | ZIL | Learning/training derivative governance |
| IM | ZIM | Observability privacy plane |
| IN | ZIN | Native notification privacy |
| IO | ZIO | Backup vs ephemeral authentication |
| IP | ZIP | Single Core/library writer ownership |
| IQ | ZIQ | Archive immutability |
| IR | ZIR | Consent/privacy generation epoch |
| IS | ZIS | External exposure ledger |
| IT | ZIT | Most-restrictive dependency privacy |
| IU | ZIU | Temp/cache/project isolation |
| IV | ZIV | Required privacy/isolation tests |
| IW | ZIW | Offline collaboration branch |
| IX | ZIX | Domain merge classes |
| IY | ZIY | Collaboration conflict entity |
| IZ | ZIZ | Sync authority revalidation |
| JA | ZJA | Tombstone/terminal-state dominance |
| JB | ZJB | Authoritative exclusive locks |
| JC | ZJC | Actor/device/session identity |
| JD | ZJD | Offline queue compaction and expiry |
| JE | ZJE | Offline irreversible-action rule |
| JF | ZJF | Collaboration transport as capability |
| JG | ZJG | Notification recipient authorization |
| JH | ZJH | Canonical promotion CAS |
| JI | ZJI | Required collaboration tests |
| JJ | ZJJ | Coordinated retry domains |
| JK | ZJK | Fallback hysteresis |
| JL | ZJL | Shared quota/rate-limit domains |
| JM | ZJM | Project fair-share scheduling |
| JN | ZJN | Mandatory maintenance deadlines |
| JO | ZJO | Cancellation coordinator |
| JP | ZJP | Durable retry/exposure budget |
| JQ | ZJQ | Persistent external breaker state |
| JR | ZJR | Paid dispatch revalidation |
| JS | ZJS | Dead-letter and retry-history lifecycle |
| JT | ZJT | Hierarchical active queue |
| LW | ZLW | Canonical source-tree materialization |

Rules:
- New references MUST use the new unique ID.
- Legacy duplicate IDs are display/history aliases only for the migrated titles above.
- Do not create future section IDs by manual alphabet continuation without doc-lint uniqueness validation.
- New high-volume hardening should prefer semantic stable IDs rather than short sequential letter IDs.
