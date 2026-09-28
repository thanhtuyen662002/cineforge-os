# CineForge OS — Authoritative Section-ID Migration

> This map records the duplicate numeric heading repair performed on the authoritative orchestration documents in Issue #1 / Draft PR #2. The first valid numeric occurrence remains the historical section. Later occurrences received semantic IDs so Context Manifest references resolve to exactly one active owner.

## Migration rules

- The IDs below are active contract identities; the old numeric labels are historical display text only.
- New `path#section-id` references must use the new semantic ID for a migrated section.
- `docs/orchestration/EXTREME_FAILURE_STRESS_TEST_2026-09-26.md` is raw evidence and is intentionally excluded from stable section identity lint. Its repeated wave and `Xnn` labels remain unchanged.
- No hardening-contract IDs were changed by this migration; the existing `Z<old-id>` map remains authoritative in `HARDENING_SECTION_ID_MIGRATION.md`.

## Numeric-to-semantic mappings

| Path | Legacy duplicate occurrence | New active section ID | Replacement title |
| --- | --- | --- | --- |
| `docs/orchestration/CONTEXT_LOADING_PROTOCOL.md` | `11` (second) | `CTX-REGISTRY-PACKS` | Control-registry-driven context packs |
| `docs/orchestration/CONTEXT_LOADING_PROTOCOL.md` | `12` (second) | `CTX-BOUNDED-READING` | Bounded context reading |
| `docs/orchestration/CONTEXT_LOADING_PROTOCOL.md` | `13` (second) | `CTX-MATERIAL-INVALIDATION` | Material invalidation |
| `docs/orchestration/CONTROL_PLANE_TRUST_AND_CONCURRENCY.md` | `23` (second) | `CTRL-MUTATION-OUTCOME` | Ambiguous GitHub mutation outcome |
| `docs/orchestration/CONTROL_PLANE_TRUST_AND_CONCURRENCY.md` | `24` (second) | `CTRL-EVENT-IDEMPOTENCY` | Structured event idempotency |
| `docs/orchestration/CONTROL_PLANE_TRUST_AND_CONCURRENCY.md` | `25` (second) | `CTRL-CLAIM-ELECTION` | Claim-intent election |
| `docs/orchestration/CONTROL_PLANE_TRUST_AND_CONCURRENCY.md` | `26` (second) | `CTRL-MERGE-OUTCOME` | Merge mutation ambiguity |
| `docs/orchestration/CONTROL_PLANE_TRUST_AND_CONCURRENCY.md` | `27` (second) | `CTRL-INSTRUCTION-PROVENANCE` | Development-agent instruction provenance |
| `docs/orchestration/FLOW_METRICS_AND_RECONCILIATION.md` | `15` (second) | `FLOW-CONTEXT-THROUGHPUT` | Context throughput metrics |
| `docs/orchestration/FLOW_METRICS_AND_RECONCILIATION.md` | `15` (third) | `FLOW-ANTI-GAMING` | Anti-gaming / flow-quality signals |
| `docs/orchestration/FLOW_METRICS_AND_RECONCILIATION.md` | `16` (second) | `FLOW-CRITICAL-PATH` | Critical-path derivation |
| `docs/orchestration/GITHUB_METADATA_CONVENTIONS.md` | `14` (second) | `GH-EVIDENCE-SOURCE` | Structured evidence source |
| `docs/orchestration/GOVERNANCE_AND_CI_SECURITY.md` | `27` (second) | `GOV-SUPPLY-CHAIN-GATES` | GitHub Actions/release supply-chain gates |
| `docs/orchestration/GOVERNANCE_AND_CI_SECURITY.md` | `28` (second) | `GOV-RELEASE-SIGNING-SEPARATION` | Release artifact/signing separation |
| `docs/orchestration/GOVERNANCE_AND_CI_SECURITY.md` | `29` (second) | `GOV-INSTALLER-UPDATE` | Installer/update governance |
| `docs/orchestration/GOVERNANCE_AND_CI_SECURITY.md` | `30` (second) | `GOV-RELEASE-HERMETICITY` | Release input hermeticity |
| `docs/orchestration/GOVERNANCE_AND_CI_SECURITY.md` | `31` (second) | `GOV-BOOTSTRAP-STATE` | Bootstrap governance state |
| `docs/orchestration/GOVERNANCE_AND_CI_SECURITY.md` | `32` (second) | `GOV-SEVERITY-CALIBRATION` | Risk severity calibration |
| `docs/orchestration/GOVERNANCE_AND_CI_SECURITY.md` | `33` (second) | `GOV-RISK-PROPORTIONAL-CI` | Risk-proportional CI |
| `docs/orchestration/GOVERNANCE_AND_CI_SECURITY.md` | `34` (second) | `GOV-CANONICAL-CHECKOUT` | Canonical checkout/source gate |
| `docs/orchestration/TASK_AND_LEASE_PROTOCOL.md` | `16` (second) | `TASK-CLAIM-INTENT` | Claim intent and ambiguous branch creation |
| `docs/orchestration/TASK_AND_LEASE_PROTOCOL.md` | `16` (third) | `TASK-PARK-EVIDENCE` | Park-state evidence |
| `docs/orchestration/TASK_AND_LEASE_PROTOCOL.md` | `17` (second) | `TASK-CONTRACT-HASH` | Task-contract hash verification |
| `docs/orchestration/TASK_AND_LEASE_PROTOCOL.md` | `18` (second) | `TASK-COMMIT-ADOPTION` | Commit adoption provenance |

## Validation requirement

`docs/orchestration/doc_lint.py` treats an unresolved duplicate active ID as a merge-blocking error and validates this map's replacement IDs. A raw evidence document is excluded only by its explicit evidence-only path rule; adding another exclusion requires a reviewable migration entry.

## Architecture/design duplicate migrations

The same rule was applied to the later numeric H1 sections in the authoritative architecture and design owner documents. The first occurrence keeps its numeric identity; each later occurrence below has the semantic replacement shown. These rows are generated from the pre-repair PR head and the repaired working tree so reviewers can audit every rename.

| Path | Legacy duplicate | New active section ID | Title |
| --- | --- | --- | --- |
| `docs/architecture/FINAL_ARCHITECTURE.md` | `65` (old line 2108) | `ARCH-RELEASE-INSTALLATION-SUPPLY-CHAIN-ARCHITECTURE` | Release and installation supply-chain architecture |
| `docs/architecture/FINAL_ARCHITECTURE.md` | `66` (old line 2144) | `ARCH-PRIVACY-RESIDUE-LIBRARY-OWNERSHIP-ARCHITECTURE` | Privacy residue and library ownership architecture |
| `docs/architecture/FINAL_ARCHITECTURE.md` | `67` (old line 2170) | `ARCH-COLLABORATION-OFFLINE-ARCHITECTURE-BOUNDARY` | Collaboration/offline architecture boundary |
| `docs/architecture/FINAL_ARCHITECTURE.md` | `68` (old line 2188) | `ARCH-SCHEDULER-STABILITY-FAILURE-DOMAIN-ARCHITECTURE` | Scheduler stability and failure-domain architecture |
| `docs/design/API_CONTRACTS.md` | `61` (old line 2076) | `API-RELEASE-ARTIFACT-PROVENANCE` | Release artifact provenance API |
| `docs/design/API_CONTRACTS.md` | `61` (old line 2554) | `API-LEARNING-FEEDBACK-EVALUATION-INTEGRITY` | Learning feedback and evaluation-integrity API |
| `docs/design/API_CONTRACTS.md` | `62` (old line 2103) | `API-INSTALLER-UPDATE-PLAN` | Installer/update plan API |
| `docs/design/API_CONTRACTS.md` | `62` (old line 2583) | `API-SEALED-HOLDOUT-ACCESS` | Sealed holdout access contract |
| `docs/design/API_CONTRACTS.md` | `63` (old line 2130) | `API-ARTIFACT-PROVENANCE-RESOLUTION` | Artifact provenance resolution |
| `docs/design/API_CONTRACTS.md` | `63` (old line 2596) | `API-ROUTER-MULTI-OBJECTIVE` | Router multi-objective contract |
| `docs/design/API_CONTRACTS.md` | `64` (old line 2141) | `API-OFFLINE-VERIFICATION` | Offline verification API |
| `docs/design/API_CONTRACTS.md` | `64` (old line 2616) | `API-LEARNING-TAINT-INVALIDATION` | Learning-taint invalidation API |
| `docs/design/API_CONTRACTS.md` | `65` (old line 2153) | `API-RELEASE-TRIGGER-AUTHORIZATION` | Release trigger authorization |
| `docs/design/API_CONTRACTS.md` | `65` (old line 2625) | `API-PROMOTION-ROLLBACK-BUNDLE` | Promotion/rollback bundle API |
| `docs/design/API_CONTRACTS.md` | `66` (old line 2165) | `API-PRIVACY-PURGE` | Privacy purge API |
| `docs/design/API_CONTRACTS.md` | `66` (old line 2637) | `API-OUTCOME-LABELING` | Outcome-labeling contract |
| `docs/design/API_CONTRACTS.md` | `67` (old line 2181) | `API-FORWARD-REVOCATION-RECOVERY` | Forward revocation recovery API |
| `docs/design/API_CONTRACTS.md` | `67` (old line 2656) | `API-STRUCTURED-DOCUMENT-PARSING` | Structured document parsing API |
| `docs/design/API_CONTRACTS.md` | `68` (old line 2190) | `API-SEMANTIC-SEARCH-SCOPE` | Semantic search scope API |
| `docs/design/API_CONTRACTS.md` | `68` (old line 2681) | `API-SPREADSHEET-FORMULA-VALUE` | Spreadsheet formula/value contract |
| `docs/design/API_CONTRACTS.md` | `69` (old line 2200) | `API-INFERENCE-SESSION-ISOLATION` | Inference session isolation API |
| `docs/design/API_CONTRACTS.md` | `69` (old line 2694) | `API-OCR-LAYOUT-EVIDENCE` | OCR/layout evidence API |
| `docs/design/API_CONTRACTS.md` | `70` (old line 2209) | `API-LEARNING-DERIVATIVE` | Learning derivative API |
| `docs/design/API_CONTRACTS.md` | `70` (old line 2705) | `API-DOCUMENT-PROTECTION` | Document protection state API |
| `docs/design/API_CONTRACTS.md` | `71` (old line 2222) | `API-CONSENT-TELEMETRY-DISPATCH` | Consent/telemetry dispatch API |
| `docs/design/API_CONTRACTS.md` | `71` (old line 2717) | `API-SEMANTIC-COVERAGE-GATE` | Semantic-coverage gate |
| `docs/design/API_CONTRACTS.md` | `72` (old line 2230) | `API-CORE-OWNERSHIP` | Core ownership API |
| `docs/design/API_CONTRACTS.md` | `72` (old line 2727) | `API-FILM-SPATIAL-CONTINUITY` | Film spatial/continuity API |
| `docs/design/API_CONTRACTS.md` | `73` (old line 2241) | `API-ARCHIVE-READ-ONLY` | Archive read-only API |
| `docs/design/API_CONTRACTS.md` | `73` (old line 2751) | `API-RETIME-INTERPOLATION` | Retime/interpolation API |
| `docs/design/API_CONTRACTS.md` | `74` (old line 2249) | `API-EXTERNAL-EXPOSURE` | External exposure API |
| `docs/design/API_CONTRACTS.md` | `74` (old line 2766) | `API-CONVERSATION-OVERLAP` | Conversation overlap API |
| `docs/design/API_CONTRACTS.md` | `75` (old line 2262) | `API-COLLABORATION-OFFLINE` | Collaboration/offline API |
| `docs/design/API_CONTRACTS.md` | `75` (old line 2780) | `API-MULTILINGUAL-DUBBING-FIT` | Multilingual dubbing-fit API |
| `docs/design/API_CONTRACTS.md` | `76` (old line 2280) | `API-RECONNECT-REBASE` | Reconnect/rebase contract |
| `docs/design/API_CONTRACTS.md` | `76` (old line 2793) | `API-DELIVERABLE-AUDIO-SUBTITLE-VALIDATION` | Deliverable audio/subtitle validation API |
| `docs/design/API_CONTRACTS.md` | `77` (old line 2293) | `API-COLLABORATION-AUTHORITY-REVALIDATION` | Collaboration authority revalidation |
| `docs/design/API_CONTRACTS.md` | `77` (old line 2810) | `API-EDITOR-HANDOFF-CAPABILITY` | Editor handoff capability API |
| `docs/design/API_CONTRACTS.md` | `78` (old line 2305) | `API-CANONICAL-PROMOTION-CAS` | Canonical promotion CAS API |
| `docs/design/API_CONTRACTS.md` | `78` (old line 2825) | `API-ALTERNATE-DELIVERABLE` | Alternate deliverable API |
| `docs/design/API_CONTRACTS.md` | `79` (old line 2315) | `API-OFFLINE-IRREVERSIBLE-ACTION` | Offline irreversible-action API |
| `docs/design/API_CONTRACTS.md` | `79` (old line 2837) | `API-COLLABORATION-AUTHORIZATION` | Collaboration authorization API |
| `docs/design/API_CONTRACTS.md` | `80` (old line 2327) | `API-NOTIFICATION-DELIVERY-AUTHORIZATION` | Notification delivery authorization |
| `docs/design/API_CONTRACTS.md` | `80` (old line 2858) | `API-CAPABILITY-TOKEN-SUBSCRIPTION-REVOCATION` | Capability-token/subscription revocation API |
| `docs/design/API_CONTRACTS.md` | `81` (old line 2336) | `API-SCHEDULER-RETRY-COORDINATION` | Scheduler/retry coordination API |
| `docs/design/API_CONTRACTS.md` | `81` (old line 2870) | `API-COLLABORATIVE-EDIT-MERGE` | Collaborative edit merge contract |
| `docs/design/API_CONTRACTS.md` | `82` (old line 2357) | `API-FALLBACK-ROUTING` | Fallback routing API |
| `docs/design/API_CONTRACTS.md` | `82` (old line 2880) | `API-COLLABORATIVE-UNDO` | Collaborative undo API |
| `docs/design/API_CONTRACTS.md` | `83` (old line 2370) | `API-PAID-DISPATCH-BUDGET-ADDITIONS` | Paid dispatch budget API additions |
| `docs/design/API_CONTRACTS.md` | `83` (old line 2890) | `API-CONCURRENT-APPROVAL-SELECT` | Concurrent approval/select API |
| `docs/design/API_CONTRACTS.md` | `84` (old line 2384) | `API-BROWSER-PROFILE-SESSION` | Browser profile/session API |
| `docs/design/API_CONTRACTS.md` | `84` (old line 2900) | `API-DELEGATION-IMPERSONATION` | Delegation/impersonation API |
| `docs/design/API_CONTRACTS.md` | `85` (old line 2402) | `API-BROWSER-ACTION-EXECUTION` | Browser action execution API |
| `docs/design/API_CONTRACTS.md` | `85` (old line 2914) | `API-CROSS-PROJECT-REUSE` | Cross-project reuse API |
| `docs/design/API_CONTRACTS.md` | `86` (old line 2414) | `API-BROWSER-DOWNLOAD-RECEIPT` | Browser download receipt API |
| `docs/design/API_CONTRACTS.md` | `86` (old line 2932) | `API-PERFORMANCE-WORKING-SET-QUERY` | Performance/working-set query contract |
| `docs/design/API_CONTRACTS.md` | `87` (old line 2428) | `API-BROWSER-AUTH-CHALLENGE` | Browser auth challenge API |
| `docs/design/API_CONTRACTS.md` | `87` (old line 2947) | `API-WRITER-PRESSURE` | Writer-pressure API |
| `docs/design/API_CONTRACTS.md` | `88` (old line 2440) | `API-EVALUATOR-QC` | Evaluator/QC API |
| `docs/design/API_CONTRACTS.md` | `88` (old line 2958) | `API-PROJECTION-REBUILD` | Projection rebuild API |
| `docs/design/API_CONTRACTS.md` | `89` (old line 2463) | `API-OOD-ABSTENTION` | OOD/abstention contract |
| `docs/design/API_CONTRACTS.md` | `89` (old line 2970) | `API-DERIVED-WORK-DEMAND` | Derived-work demand API |
| `docs/design/API_CONTRACTS.md` | `90` (old line 2476) | `API-GOLDEN-BENCHMARK` | Golden/benchmark API |
| `docs/design/API_CONTRACTS.md` | `90` (old line 2984) | `API-SCHEDULER-FAIRNESS` | Scheduler fairness API |
| `docs/design/API_CONTRACTS.md` | `91` (old line 2489) | `API-POST-QC-MUTATION` | Post-QC mutation API |
| `docs/design/API_CONTRACTS.md` | `91` (old line 2994) | `API-BACKUP-RPO-RTO` | Backup RPO/RTO API |
| `docs/design/API_CONTRACTS.md` | `92` (old line 2502) | `API-PROVENANCE` | Provenance API |
| `docs/design/API_CONTRACTS.md` | `92` (old line 3009) | `API-MAINTENANCE-ADMISSION` | Maintenance admission API |
| `docs/design/API_CONTRACTS.md` | `93` (old line 2524) | `API-HANDOFF-IMPORT-PROVENANCE` | Handoff/import provenance API |
| `docs/design/API_CONTRACTS.md` | `93` (old line 3024) | `API-LARGE-FANOUT-INVALIDATION` | Large-fanout invalidation API |
| `docs/design/API_CONTRACTS.md` | `94` (old line 2533) | `API-PUBLICATION-ARTIFACT` | Publication artifact API |
| `docs/design/API_CONTRACTS.md` | `94` (old line 3036) | `API-INCREMENTAL-RELEASE-READINESS` | Incremental release-readiness API |
| `docs/design/API_CONTRACTS.md` | `95` (old line 2542) | `API-SIMILARITY-RISK` | Similarity-risk API |
| `docs/design/API_CONTRACTS.md` | `95` (old line 3043) | `API-CAPABILITY-SEMANTIC-CERTIFICATION` | Capability semantic certification API |
| `docs/design/API_CONTRACTS.md` | `96` (old line 2547) | `API-PROVENANCE-PARSER-NETWORK-POLICY` | Provenance parser network policy |
| `docs/design/API_CONTRACTS.md` | `96` (old line 3059) | `API-MCP-NESTED-CALL-AUTHORIZATION` | MCP/nested-call authorization contract |
| `docs/design/API_CONTRACTS.md` | `97` (old line 3071) | `API-CONNECTOR-RESULT-STREAM-BUDGET` | Connector result/stream budget API |
| `docs/design/API_CONTRACTS.md` | `98` (old line 3082) | `API-CLI-RUNNER-SEMANTIC-SUCCESS` | CLI runner semantic success API |
| `docs/design/API_CONTRACTS.md` | `99` (old line 3094) | `API-COMPLETENESS-RETRY` | API completeness/retry contract |
| `docs/design/API_CONTRACTS.md` | `100` (old line 3105) | `API-BROWSER-ACTION-GUARD` | Browser action guard API |
| `docs/design/API_CONTRACTS.md` | `101` (old line 3116) | `API-CAPABILITY-HEALTH` | Capability health API |
| `docs/design/API_CONTRACTS.md` | `102` (old line 3123) | `API-SUBPROCESSOR-EGRESS-CHAIN` | Subprocessor/egress chain contract |
| `docs/design/API_CONTRACTS.md` | `103` (old line 3133) | `API-EPOCH-QUALIFIED-EVENT-CURSOR` | Epoch-qualified event cursor API |
| `docs/design/API_CONTRACTS.md` | `104` (old line 3157) | `API-CLIENT-CORE-RECOVERY-HANDSHAKE` | Client/Core recovery handshake |
| `docs/design/API_CONTRACTS.md` | `105` (old line 3177) | `API-OFFLINE-PENDING-COMMAND-RECONCILIATION` | Offline pending-command reconciliation API |
| `docs/design/API_CONTRACTS.md` | `106` (old line 3191) | `API-RECOVERY-SPECIFIC-CONFLICT-ERRORS` | Recovery-specific conflict errors |
| `docs/design/SCHEMA.md` | `64` (old line 2962) | `SCHEMA-PRIVACY-PURGE-COORDINATION` | Privacy purge coordination |
| `docs/design/SCHEMA.md` | `65` (old line 2996) | `SCHEMA-SEMANTIC-INDEX-SCOPE` | Semantic index scope |
| `docs/design/SCHEMA.md` | `66` (old line 3016) | `SCHEMA-INFERENCE-SESSION-ISOLATION` | Inference session isolation |
| `docs/design/SCHEMA.md` | `67` (old line 3029) | `SCHEMA-LEARNING-DERIVATIVE-LINEAGE` | Learning derivative lineage |
| `docs/design/SCHEMA.md` | `68` (old line 3047) | `SCHEMA-OBSERVABILITY-PRIVACY-RECORDS` | Observability privacy records |
| `docs/design/SCHEMA.md` | `69` (old line 3068) | `SCHEMA-EXTERNAL-EXPOSURE-LEDGER` | External exposure ledger |
| `docs/design/SCHEMA.md` | `70` (old line 3086) | `SCHEMA-PRIVACY-CONSENT-GENERATIONS` | Privacy/consent generations |
| `docs/design/SCHEMA.md` | `71` (old line 3101) | `SCHEMA-CORE-LIBRARY-WRITER-OWNERSHIP` | Core/library writer ownership |
| `docs/design/SCHEMA.md` | `72` (old line 3115) | `SCHEMA-ARCHIVE-SEALS` | Archive seals |
| `docs/design/SCHEMA.md` | `73` (old line 3128) | `SCHEMA-TEMP-CACHE-SCOPE` | Temp/cache scope |
| `docs/design/SCHEMA.md` | `74` (old line 3142) | `SCHEMA-COLLABORATION-BRANCHES-CONFLICTS` | Collaboration branches and conflicts |
| `docs/design/SCHEMA.md` | `75` (old line 3194) | `SCHEMA-ACTOR-DEVICE-SESSION-AUTHORITY-GENERATIONS` | Actor/device/session authority generations |
| `docs/design/SCHEMA.md` | `76` (old line 3214) | `SCHEMA-EXCLUSIVE-COLLABORATION-LOCKS` | Exclusive collaboration locks |
| `docs/design/SCHEMA.md` | `77` (old line 3231) | `SCHEMA-COLLABORATION-TRANSPORT-BINDINGS` | Collaboration transport bindings |
| `docs/design/SCHEMA.md` | `78` (old line 3247) | `SCHEMA-CANONICAL-PROMOTION-CAS-RECORDS` | Canonical promotion CAS records |
| `docs/design/SCHEMA.md` | `84` (old line 3506) | `SCHEMA-LEARNING-FEEDBACK-PROVENANCE-EVALUATION-CONTEXT` | Learning feedback provenance and evaluation context |
| `docs/design/STATE_MACHINES.md` | `61` (old line 1786) | `STATE-RELEASE-BUILD-SIGNING` | Release build and signing lifecycle |
| `docs/design/STATE_MACHINES.md` | `61` (old line 2312) | `STATE-LEARNING-FEEDBACK-ELIGIBILITY` | Learning feedback eligibility lifecycle |
| `docs/design/STATE_MACHINES.md` | `62` (old line 1812) | `STATE-INSTALLER-TRANSACTION` | Installer transaction lifecycle |
| `docs/design/STATE_MACHINES.md` | `62` (old line 2325) | `STATE-BENCHMARK-HOLDOUT-INTEGRITY` | Benchmark/holdout integrity state |
| `docs/design/STATE_MACHINES.md` | `63` (old line 1841) | `STATE-UPDATE-ANTI-ROLLBACK` | Update anti-rollback state |
| `docs/design/STATE_MACHINES.md` | `63` (old line 2335) | `STATE-PROMOTION-EVIDENCE-VALIDITY` | Promotion evidence validity |
| `docs/design/STATE_MACHINES.md` | `64` (old line 1854) | `STATE-SIGNING-KEY-SERVICE-AUTHORIZATION` | Signing key/service authorization state |
| `docs/design/STATE_MACHINES.md` | `64` (old line 2348) | `STATE-ROUTER-EXPLORATION` | Router exploration lifecycle |
| `docs/design/STATE_MACHINES.md` | `65` (old line 1871) | `STATE-UPDATER-BOOTSTRAPPER` | Updater/bootstrapper state |
| `docs/design/STATE_MACHINES.md` | `65` (old line 2362) | `STATE-GOLDEN-EXAMPLE-DISPUTE` | Golden-example dispute lifecycle |
| `docs/design/STATE_MACHINES.md` | `66` (old line 1886) | `STATE-PRIVACY-PURGE` | Privacy purge lifecycle |
| `docs/design/STATE_MACHINES.md` | `66` (old line 2376) | `STATE-PROJECT-MEMBERSHIP` | Project membership lifecycle |
| `docs/design/STATE_MACHINES.md` | `67` (old line 1906) | `STATE-SEMANTIC-INDEX-ENTRY` | Semantic index entry lifecycle |
| `docs/design/STATE_MACHINES.md` | `67` (old line 2392) | `STATE-COLLABORATIVE-WORKING-COPY` | Collaborative working copy lifecycle |
| `docs/design/STATE_MACHINES.md` | `68` (old line 1916) | `STATE-INFERENCE-SESSION` | Inference session lifecycle |
| `docs/design/STATE_MACHINES.md` | `68` (old line 2408) | `STATE-EVENT-SUBSCRIPTION-AUTHORIZATION` | Event subscription authorization lifecycle |
| `docs/design/STATE_MACHINES.md` | `69` (old line 1930) | `STATE-LEARNING-DERIVATIVE` | Learning derivative lifecycle |
| `docs/design/STATE_MACHINES.md` | `69` (old line 2420) | `STATE-DELEGATION` | Delegation lifecycle |
| `docs/design/STATE_MACHINES.md` | `70` (old line 1940) | `STATE-PRIVACY-GENERATION` | Privacy generation lifecycle |
| `docs/design/STATE_MACHINES.md` | `70` (old line 2429) | `STATE-ANNOTATION-STALENESS-PROJECTION` | Annotation staleness projection |
| `docs/design/STATE_MACHINES.md` | `71` (old line 1954) | `STATE-LIBRARY-WRITER-OWNERSHIP` | Library writer ownership lifecycle |
| `docs/design/STATE_MACHINES.md` | `71` (old line 2441) | `STATE-CAPABILITY-CERTIFICATION` | Capability certification lifecycle |
| `docs/design/STATE_MACHINES.md` | `72` (old line 1967) | `STATE-ARCHIVE` | Archive lifecycle |
| `docs/design/STATE_MACHINES.md` | `72` (old line 2457) | `STATE-CONNECTOR-SEMANTIC-ACTION` | Connector semantic action state |
| `docs/design/STATE_MACHINES.md` | `73` (old line 1978) | `STATE-EXTERNAL-EXPOSURE` | External exposure lifecycle |
| `docs/design/STATE_MACHINES.md` | `73` (old line 2473) | `STATE-BROWSER-GUARDED-ACTION` | Browser guarded-action state |
| `docs/design/STATE_MACHINES.md` | `74` (old line 1992) | `STATE-COLLABORATION-BRANCH` | Collaboration branch lifecycle |
| `docs/design/STATE_MACHINES.md` | `74` (old line 2489) | `STATE-LOCAL-SERVICE-EPOCH` | Local service epoch state |
| `docs/design/STATE_MACHINES.md` | `75` (old line 2010) | `STATE-COLLABORATION-CONFLICT` | Collaboration conflict lifecycle |
| `docs/design/STATE_MACHINES.md` | `75` (old line 2506) | `STATE-CLIENT-SYNCHRONIZATION` | Client synchronization lifecycle |
| `docs/design/STATE_MACHINES.md` | `76` (old line 2020) | `STATE-ACTOR-DEVICE-AUTHORITY` | Actor/device authority state |
| `docs/design/STATE_MACHINES.md` | `76` (old line 2531) | `STATE-EVENT-STREAM-CURSOR` | Event stream cursor lifecycle |
| `docs/design/STATE_MACHINES.md` | `77` (old line 2036) | `STATE-COLLABORATION-LOCK` | Collaboration lock lifecycle |
| `docs/design/STATE_MACHINES.md` | `78` (old line 2047) | `STATE-CANONICAL-PROMOTION-RACE` | Canonical promotion race |
| `docs/design/STATE_MACHINES.md` | `79` (old line 2062) | `STATE-OFFLINE-ACTION-CLASS` | Offline action class |
| `docs/design/STATE_MACHINES.md` | `80` (old line 2074) | `STATE-EXTERNAL-CIRCUIT-BREAKER` | External circuit breaker lifecycle |
| `docs/design/STATE_MACHINES.md` | `81` (old line 2093) | `STATE-RETRY-BUDGET` | Retry budget lifecycle |
| `docs/design/STATE_MACHINES.md` | `82` (old line 2104) | `STATE-MAINTENANCE-DEADLINE` | Maintenance deadline state |
| `docs/design/STATE_MACHINES.md` | `83` (old line 2118) | `STATE-FALLBACK-RAMP` | Fallback ramp state |
| `docs/design/STATE_MACHINES.md` | `84` (old line 2132) | `STATE-BROWSER-PROFILE` | Browser profile lifecycle |
| `docs/design/STATE_MACHINES.md` | `85` (old line 2145) | `STATE-BROWSER-AUTH-SESSION` | Browser auth session lifecycle |
| `docs/design/STATE_MACHINES.md` | `86` (old line 2166) | `STATE-BROWSER-AUTOMATION-EXECUTION` | Browser automation execution |
| `docs/design/STATE_MACHINES.md` | `87` (old line 2187) | `STATE-HUMAN-TAKEOVER` | Human takeover state |
| `docs/design/STATE_MACHINES.md` | `88` (old line 2199) | `STATE-EVALUATION-OOD-COVERAGE` | Evaluation lifecycle with OOD/coverage |
| `docs/design/STATE_MACHINES.md` | `89` (old line 2224) | `STATE-BENCHMARK-EXAMPLE` | Benchmark example lifecycle |
| `docs/design/STATE_MACHINES.md` | `90` (old line 2235) | `STATE-EVALUATION-CACHE` | Evaluation-cache lifecycle |
| `docs/design/STATE_MACHINES.md` | `91` (old line 2247) | `STATE-POST-QC-ARTIFACT` | Post-QC artifact state |
| `docs/design/STATE_MACHINES.md` | `92` (old line 2258) | `STATE-PROVENANCE-EVIDENCE` | Provenance evidence lifecycle |
| `docs/design/STATE_MACHINES.md` | `93` (old line 2277) | `STATE-EMBEDDED-PROVENANCE-PRESERVATION` | Embedded provenance preservation |
| `docs/design/STATE_MACHINES.md` | `94` (old line 2288) | `STATE-PUBLICATION-ARTIFACT-VERIFICATION` | Publication artifact verification |
| `docs/design/STATE_MACHINES.md` | `95` (old line 2300) | `STATE-PROVENANCE-CONFLICT` | Provenance conflict lifecycle |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `61` (old line 1990) | `UI-RELEASE-PROVENANCE` | Release provenance UI |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `61` (old line 2360) | `UI-STRUCTURED-DOCUMENT-IMPORT-PREVIEW` | Structured document import preview |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `62` (old line 2005) | `UI-UPDATE-SECURITY` | Update security UX |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `62` (old line 2381) | `UI-SPREADSHEET-MAPPING-WORKSPACE` | Spreadsheet mapping workspace |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `63` (old line 2016) | `UI-INSTALLER-UNINSTALL-IMPACT-PREVIEW` | Installer/uninstall impact preview |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `63` (old line 2395) | `UI-PDF-DOCX-PPTX-REVIEW-WORKSPACE` | PDF/DOCX/PPTX review workspace |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `64` (old line 2027) | `UI-OFFLINE-INSTALLER-WARNING` | Offline installer warning |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `64` (old line 2409) | `UI-PROTECTED-ENCRYPTED-DOCUMENT` | Protected/encrypted document UX |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `65` (old line 2041) | `UI-PRIVACY-PURGE` | Privacy purge UX |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `65` (old line 2421) | `UI-DOCUMENT-ACTIVE-CONTENT-WARNING` | Document active-content warning |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `66` (old line 2052) | `UI-EXTERNAL-EXPOSURE-VIEW` | External exposure view |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `66` (old line 2428) | `UI-STRUCTURED-IMPORT-CONFIDENCE` | Structured import confidence |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `67` (old line 2066) | `UI-SEMANTIC-SEARCH-PRIVACY` | Semantic search privacy |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `67` (old line 2440) | `UI-FILM-CONTINUITY-DIAGNOSTICS` | Film continuity diagnostics |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `68` (old line 2075) | `UI-MODEL-SESSION-ISOLATION-STATUS` | Model/session isolation status |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `68` (old line 2452) | `UI-LONG-TAKE-IDENTITY-REVIEW` | Long-take identity review |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `69` (old line 2086) | `UI-LEARNING-DERIVATIVE-REVOCATION` | Learning derivative revocation UX |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `69` (old line 2462) | `UI-DIALOGUE-OVERLAP-DUBBING-WORKSPACE` | Dialogue overlap / dubbing workspace |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `70` (old line 2098) | `UI-CORE-OWNERSHIP` | Core ownership UX |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `70` (old line 2480) | `UI-SUBTITLE-ACCESSIBILITY-VALIDATION` | Subtitle/accessibility validation UI |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `71` (old line 2108) | `UI-ARCHIVE-READ-ONLY` | Archive read-only UX |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `71` (old line 2492) | `UI-HANDOFF-CAPABILITY-REPORT` | Handoff capability report |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `72` (old line 2120) | `UI-NOTIFICATION-PRIVACY` | Notification privacy |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `72` (old line 2505) | `UI-EXTERNAL-EDIT-RETURN-RECONCILE` | External edit return reconcile UI |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `73` (old line 2131) | `UI-OFFLINE-COLLABORATION` | Offline collaboration UX |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `73` (old line 2517) | `UI-ALTERNATE-FORMAT-REVIEW` | Alternate-format review |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `74` (old line 2145) | `UI-COLLABORATION-CONFLICT-WORKSPACE` | Collaboration conflict workspace |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `74` (old line 2529) | `UI-LARGE-PROJECT-LOADING` | Large-project loading UX |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `75` (old line 2163) | `UI-PERMISSION-REVOKED-WHILE-OFFLINE` | Permission revoked while offline |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `75` (old line 2542) | `UI-VIRTUALIZED-LIBRARY-TIMELINE` | Virtualized library/timeline |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `76` (old line 2173) | `UI-CONCURRENT-APPROVAL-CONFLICT` | Concurrent approval conflict UX |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `76` (old line 2553) | `UI-BACKGROUND-DERIVED-WORK-CONTROLS` | Background derived-work controls |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `77` (old line 2181) | `UI-COLLABORATION-PRIVACY-INDICATOR` | Collaboration privacy indicator |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `77` (old line 2566) | `UI-BACKUP-HEALTH` | Backup health UX |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `78` (old line 2192) | `UI-BROWSER-CONNECTION-SECURITY` | Browser connection security UX |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `78` (old line 2577) | `UI-PERFORMANCE-PRESSURE` | Performance pressure UX |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `79` (old line 2210) | `UI-BROWSER-AUTH-CHALLENGE` | Browser auth challenge UX |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `79` (old line 2586) | `UI-COLD-ARCHIVE` | Cold archive UX |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `80` (old line 2222) | `UI-HUMAN-TAKEOVER-RESUME` | Human takeover resume UX |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `80` (old line 2597) | `UI-INVALIDATION-FANOUT` | Invalidation fanout UX |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `81` (old line 2235) | `UI-BROWSER-DOWNLOAD-SAFETY` | Browser download safety UX |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `81` (old line 2606) | `UI-CAPABILITY-LEVEL-CONNECTION-DETAIL` | Capability-level connection detail |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `82` (old line 2245) | `UI-BROWSER-DIAGNOSTICS-PRIVACY` | Browser diagnostics privacy |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `82` (old line 2618) | `UI-CONNECTOR-SEMANTIC-RISK-DISPLAY` | Connector semantic-risk display |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `83` (old line 2257) | `UI-QC-UNCERTAINTY` | QC uncertainty UX |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `83` (old line 2631) | `UI-BROWSER-SEMANTIC-DRIFT-WARNING` | Browser semantic drift warning |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `84` (old line 2268) | `UI-HUMAN-REVIEW-ANTI-ANCHORING` | Human review anti-anchoring |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `84` (old line 2643) | `UI-UNCERTAIN-EXTERNAL-ACTION` | Uncertain external action UX |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `85` (old line 2277) | `UI-QC-COVERAGE-VISUALIZATION` | QC coverage visualization |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `86` (old line 2288) | `UI-POST-QC-MUTATION-WARNING` | Post-QC mutation warning |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `87` (old line 2295) | `UI-BENCHMARK-GOLDEN-INTEGRITY` | Benchmark/golden integrity UX |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `88` (old line 2307) | `UI-PROVENANCE-AUTHENTICITY` | Provenance/authenticity UX |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `89` (old line 2326) | `UI-PUBLICATION-PROVENANCE` | Publication provenance UX |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `90` (old line 2336) | `UI-PROVENANCE-PRIVACY-EXPORT` | Provenance privacy export |
| `docs/design/UI_COMPONENT_SYSTEM.md` | `91` (old line 2348) | `UI-PROVENANCE-CONFLICT` | Provenance conflict UX |
