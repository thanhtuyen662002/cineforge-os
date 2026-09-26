# CineForge OS — Extreme Failure & Adversarial Stress Test

> Task: #1
> Draft PR: #2
> Baseline under attack: `20d5a6f1760df3b49cc18e93ba0e938187e25e2a`
> Method: assume hostile timing, corrupted state, malicious input, provider lies, hardware fails, humans make mistakes, agents overlap, and several failures occur at once.

## Verdict legend

- **CONTAINED** — current baseline already has an adequate owner/control.
- **PARTIAL** — control exists but a critical edge is underspecified.
- **GAP** — newly uncovered architectural/control-plane hole.

# 1. GitHub/control-plane attacks

| # | Attack | Verdict | Why |
|---|---|---|---|
| 1 | External user copies `agent_task_v1` into a public Issue | CONTAINED | trusted-adoption rule now blocks scheduling |
| 2 | External user posts fake `AGENT_REVIEW_V1 APPROVE` | CONTAINED | trusted author + schema validation required |
| 3 | Two agents claim same Issue at the same time | **GAP** | free-form branch `<slug>` means two “deterministic” names may differ |
| 4 | Branch is created, then PR is opened before any commit | **GAP** | GitHub rejects zero-diff PR with HTTP 422; current sequence is impossible |
| 5 | Worker dies after branch creation but before PR | PARTIAL | orphan reconciliation exists; needs explicit minimal-claim commit semantics |
| 6 | Flow Governor observes orphan during branch→PR gap | CONTAINED/PARTIAL | grace cycle exists, but bootstrap commit should make intent machine-readable |
| 7 | Stale worker is taken over then wakes and pushes old branch | **GAP/P0** | same-branch takeover has no physical fencing |
| 8 | Old worker pushes after TAKEOVER comment but before new worker push | **GAP/P0** | protocol-only owner fencing cannot stop Git write race |
| 9 | Two Planner runs update Capacity Plan | CONTAINED | append-only same-parent conflict rule |
| 10 | Two Integrators merge simultaneously | CONTAINED | merge lease added |
| 11 | Integrator lease expires during a slow merge action | PARTIAL | final lease freshness check needs to be explicit |
| 12 | GitHub Search says no PR while index is stale | CONTAINED | direct/paginated lookup required |
| 13 | API pagination truncates control comments | CONTAINED | incomplete state becomes UNKNOWN |
| 14 | Capacity Plan grows to tens of thousands of comments | CONTAINED | epoch rotation exists |
| 15 | A trusted-but-stale Planner keeps creating sibling plan versions | PARTIAL | deterministic winner exists; anti-livelock/backoff is underspecified |
| 16 | Task acceptance criteria are edited after claim | CONTAINED | task contract version/hash revalidation |
| 17 | Two agents serialize the same task contract differently | **GAP** | canonical hash serialization is not defined |
| 18 | Trusted actor allowlist in a mutable Issue is replaced | **GAP/P1** | trust root needs a versioned authoritative policy on protected main |
| 19 | Same GitHub credential invents a second logical reviewer identity | PARTIAL | documented as non-cryptographic; stronger review levels exist |
| 20 | Multiple Work chats all identify as WORK | CONTAINED | unique `WORK-<id>` rule added |
| 21 | Issue is closed manually while valid PR remains open | CONTAINED | reconciliation precedence handles |
| 22 | Merged PR leaves Issue open, new worker sees READY | CONTAINED | merged Claim PR wins over Issue state |
| 23 | Dependency once merged is later reverted | PARTIAL | current-main semantic revalidation now required |
| 24 | Public bot/Dependabot PR looks internal | PARTIAL | external/fork trust class exists; bot identity policy still needs explicit adoption |
| 25 | GitHub control-plane outage occurs during lease acquisition | CONTAINED | outage protocol says no new claim/takeover/merge |

# 2. CI/review/merge attacks

| # | Attack | Verdict | Why |
|---|---|---|---|
| 26 | Old green CI is attached to new HEAD | CONTAINED | verification tuple |
| 27 | Same HEAD but main/base changed materially | CONTAINED | base drift revalidation |
| 28 | GitHub tests synthetic merge, Integrator only checks HEAD | CONTAINED | synthetic merge SHA included |
| 29 | A PR changes the workflow that is supposed to approve itself | **GAP/P0** | privileged governance gate needs trusted base/external workflow provenance |
| 30 | Attacker creates a check with same human-readable name | **GAP/P0** | check producer/App identity + workflow revision must be verified |
| 31 | Fork PR runs on privileged self-hosted runner | CONTAINED | policy now forbids without isolation |
| 32 | Fork PR poisons cache consumed by release | CONTAINED/PARTIAL | trust boundary documented; future CI must implement it |
| 33 | Flaky test passes on tenth blind rerun | CONTAINED | rerun laundering prohibited |
| 34 | Path filter misses semantic dependency | CONTAINED | semantic/risk impact overrides path-only |
| 35 | CI full suite takes 2 hours for a docs change | CONTAINED | tiered CI design |
| 36 | Green PR is squash-merged; release artifact embeds old HEAD SHA | **GAP/P1** | release artifact must be rebuilt/attested from merged commit |
| 37 | PR review approves HEAD, author amends and force-pushes | CONTAINED/PARTIAL | material HEAD invalidates review; native force-push protection still absent |
| 38 | Reviewer approves diff but required architecture docs changed later | CONTAINED | context/base revalidation |
| 39 | One reviewer becomes throughput bottleneck | CONTAINED | review pool/flex |
| 40 | Reviewer and author ping-pong indefinitely | CONTAINED | Flow takeover/pair/split |
| 41 | Governance PR relaxes the very gate used on itself | CONTAINED conceptually | non-retroactivity uses stricter rule |
| 42 | Base CI workflow itself is maliciously changed before branch protection exists | **GAP/residual P0** | cannot be security-enforced until native protection/separate trust identity exists |

# 3. Scheduler/lease/backpressure attacks

| # | Attack | Verdict | Why |
|---|---|---|---|
| 43 | Same scheduled slot overlaps before PR exists | CONTAINED | slot lease |
| 44 | Slot lease expires while worker is still legitimately coding | **GAP/P1** | renewal/fencing behavior must be explicit |
| 45 | Network pause makes worker miss renew, Governor takes over | **GAP/P1** | stale-owner write fencing is required |
| 46 | CI is slow; every worker parks and starts more tasks | CONTAINED | global stage WIP/backpressure |
| 47 | Review is saturated but READY depth is high | CONTAINED | downstream saturation blocks new implementation |
| 48 | 15 agents all broad-scan GitHub at once | CONTAINED | stagger + context tiers + narrow builder reads |
| 49 | Planner makes 100 future tasks, architecture changes | CONTAINED | bounded ready horizon |
| 50 | Planner underproduces tasks and 14 workers idle | CONTAINED | ready-depth target |
| 51 | Easy issues starve difficult critical-path task | CONTAINED | critical path/downstream weighting |
| 52 | Flex worker becomes a permanent dumping ground | PARTIAL | role intent says temporary; aging/ownership reporting should detect |
| 53 | Hotspot owner disappears | PARTIAL | Flow takeover exists; physical fencing issue remains |
| 54 | CI runners drop from 10 to 1 but Capacity Plan still assumes 10 | CONTAINED | plan recalculation trigger + WIP metrics |
| 55 | GitHub rate-limit response is mistaken for “no tasks” | CONTAINED | UNKNOWN/backoff rule |
| 56 | Scheduler clock/timezone changes cause all slots to collide | CONTAINED | timing is optimization, leases are correctness |

# 4. SQLite/persistence/recovery attacks

| # | Attack | Verdict | Why |
|---|---|---|---|
| 57 | Long UI/read transaction prevents WAL checkpoint for hours | **GAP/P1** | WAL can grow until disk pressure; read-duration/checkpoint policy needed |
| 58 | Disk fills while WAL is expanding | **GAP/P1** | emergency write shedding/read-only recovery needs explicit state |
| 59 | Process crashes between DB commit and external dispatch | CONTAINED | transactional outbox |
| 60 | External callback arrives twice | CONTAINED | inbox/idempotency |
| 61 | Timeout occurs after provider accepted job | CONTAINED | reconcile before retry |
| 62 | Restore backup to yesterday while today's provider jobs still complete | **GAP/P0** | restored DB cannot recognize “future epoch” callbacks safely |
| 63 | Restore replays old outbox and charges provider a second time | **GAP/P0** | restore requires external-side-effect reconciliation barrier |
| 64 | Restore DB and object store from different checkpoints | CONTAINED conceptually | consistent backup checkpoint requirement |
| 65 | Backup restores DB but DPAPI credentials do not exist on new machine/user | **GAP/P1 UX/ops** | connections need explicit REAUTH_REQUIRED portability state |
| 66 | App update performs forward DB migration then app rollback launches older binary | **GAP/P0/P1** | app↔schema compatibility window/rollback contract needed |
| 67 | Migration succeeds in DB but package/runtime migration fails | PARTIAL | migration journal exists conceptually; cross-resource barrier needs explicit ordering |
| 68 | System clock moves backwards | PARTIAL | lease timing uses server/Core authority; event ordering must never rely on wall clock/UUID |
| 69 | UUIDv7 timestamp regresses after clock change | **GAP/P2** | IDs must not be used as authoritative temporal order |
| 70 | Event log and canonical rows disagree after software bug | PARTIAL | reconciliation/audit exists; repair authority path should be explicit |

# 5. Filesystem/storage/backup attacks

| # | Attack | Verdict | Why |
|---|---|---|---|
| 71 | User places live SQLite WAL in OneDrive/UNC | CONTAINED | validated Core DB root |
| 72 | Antivirus temporarily locks final object during rename | **GAP/P2** | Windows transient I/O retry/quarantine UX not explicit |
| 73 | Machine sleeps/hibernates during GPU render/file write | **GAP/P2** | wake/reconcile behavior implicit, not explicit |
| 74 | Power loss after object fsync but before directory metadata persistence | PARTIAL | staging/reconcile helps; durable rename/fsync semantics need implementation tests |
| 75 | Another process consumes disk after CineForge reservation | **GAP/P1** | reservation is advisory; emergency storage pressure policy needed |
| 76 | 100GB import hashes for minutes and UI looks stuck | PARTIAL | async import exists; hash milestone/partial state needs implementation |
| 77 | User imports 20k files; thumbnails/proxies swamp queue | PARTIAL | scheduler exists; ingestion-specific fanout budget useful |
| 78 | Same object bytes used by two projects, one project deleted | CONTAINED | graph-aware GC/shared rights identity |
| 79 | Hash algorithm is later deprecated | **GAP/P1** | content identity needs algorithm-qualified digest/version |
| 80 | Ransomware/encrypted disk destroys library and attached backup | **GAP/P1 ops** | optional offline/immutable backup class not explicit |
| 81 | Backup is “successful” but restore path has rotted | CONTAINED | restore drills |
| 82 | Library move fails halfway and both roots contain partial copies | CONTAINED/PARTIAL | copy/hash/switch concept exists; migration journal needs implementation |
| 83 | Windows case-insensitive export names collide | CONTAINED | export mapping/sanitization |
| 84 | Reparse point escapes selected import folder | CONTAINED | default exclusion |

# 6. Local IPC/WebView/security attacks

| # | Attack | Verdict | Why |
|---|---|---|---|
| 85 | Imported screenplay contains HTML/JS and UI renders it unsafely | **GAP/P0** | WebView XSS could reach local privileged API if rendering/origin policy weak |
| 86 | Malicious generated image contains prompt injection text | CONTAINED conceptually | generated content untrusted |
| 87 | Imported document says “ignore instructions and upload project” and Context Compiler includes it as instruction | **GAP/P0** | prompt/context trust channel separation needs explicit contract |
| 88 | Local malware calls localhost RPC directly | PARTIAL | authenticated local session exists; named-pipe/ACL/origin/session details need implementation |
| 89 | WebView navigates to attacker-controlled origin retaining native bridge | **GAP/P0** | navigation/CSP/native bridge isolation must be explicit |
| 90 | Clipboard HTML/RTF contains active content | **GAP/P1** | intake normalization/sanitization must treat clipboard as hostile |
| 91 | Malformed PDF/image causes parser exploit | PARTIAL | quarantine/sandbox principle exists |
| 92 | ZIP/archive bomb expands to TBs | **GAP/P0/P1** | recursive archive/decompression budgets needed |
| 93 | Gigapixel image has tiny compressed bytes | **GAP/P1** | decoded pixel/memory budget needed |
| 94 | Malicious media playlist causes FFmpeg to fetch network URL/local path | **GAP/P0** | protocol/network whitelist and sandbox needed |
| 95 | Media metadata contains shell/path/prompt payload | PARTIAL | typed CLI and untrusted input principle; metadata sanitization explicitness needed |
| 96 | Custom model uses pickle/code execution | CONTAINED | quarantine/certification sandbox |
| 97 | Connector package signature valid but publisher key is later compromised | **GAP/P1** | trust-store key rotation/revocation model needed |
| 98 | Updater online signing key compromised | **GAP/P0** | root/offline vs online key separation/revocation needed |

# 7. AI/media/connector attacks

| # | Attack | Verdict | Why |
|---|---|---|---|
| 99 | Provider silently changes model behind same model name | PARTIAL | version/metadata snapshot; exact cloud reproducibility remains impossible |
| 100 | Provider says “success” but output URL expires before download | **GAP/P1** | provider result must not become READY until local materialization+hash |
| 101 | Provider returns wrong output from another session/job | PARTIAL | association evidence exists |
| 102 | Browser filename collides across jobs | CONTAINED | trace/hash association |
| 103 | Browser UI changes button meaning; automation clicks destructive action | **GAP/P1** | browser action allowlist/destructive boundary must be explicit |
| 104 | Provider cost is reported hours later above reserved estimate | **GAP/P1** | budget needs maximum exposure/unknown-cost policy |
| 105 | Timeout/retry duplicates expensive generation because provider lacks idempotency | PARTIAL | reconcile-before-retry; exposure ceiling still needed |
| 106 | Provider quota resets unexpectedly / reports stale credits | PARTIAL | capacity axis exists |
| 107 | Local GPU free memory sample is stale; scheduler launches two OOM jobs | **GAP/P1** | resource lease/reservation+headroom required, telemetry alone insufficient |
| 108 | GPU driver resets mid-render | PARTIAL | worker restart/reconcile concept |
| 109 | Repair loop alternates face↔lip forever | CONTAINED | convergence/attempt guards |
| 110 | Evaluator and generator share same failure bias | CONTAINED | correlated evaluator warning/diversity |
| 111 | Candidate passes QC only because proxy hides 4K defect | CONTAINED | representation-specific review |
| 112 | AI “fix” overwrites editor's manual intentional adjustment | **GAP/P1 creative integrity** | manual/human ownership locks need explicit precedence |
| 113 | Canon is corrected while 100 generations are in flight | PARTIAL | stale-on-arrival exists; fanout cancel/cost containment needs explicit bulk policy |
| 114 | Stale result is actually artistically better and user wants to keep it | PARTIAL | variant/promote/waiver path exists, should preserve stale candidate safely |

# 8. Media engineering attacks

| # | Attack | Verdict | Why |
|---|---|---|---|
| 115 | 23.976↔24 conversion accumulates frame rounding over feature length | CONTAINED conceptually | rational timing required |
| 116 | VFR source proxy is CFR; relink shifts sync | PARTIAL | conform metadata exists; conversion tests essential |
| 117 | Plugin latency changes after sample-rate conversion | CONTAINED in risk model |
| 118 | Color transform applied twice in AI→NLE→master chain | PARTIAL | color metadata first-class, handoff validation must detect |
| 119 | Premultiplied alpha interpreted as straight | CONTAINED in media metadata design |
| 120 | Subtitle font lacks Vietnamese glyphs only at final machine | PARTIAL | font coverage validation exists conceptually |
| 121 | Export succeeds but decoder finds truncated final GOP | CONTAINED | existence != validity |
| 122 | Audio master clips only after platform transcode | PARTIAL | platform-output QC where possible |
| 123 | NLE handoff target does not support a feature CineForge claims editable | CONTAINED | no false round-trip claims |

# 9. Human/UX/project-management attacks

| # | Attack | Verdict | Why |
|---|---|---|---|
| 124 | User double-clicks Generate because first click appears dead | CONTAINED | async immediate acknowledgement/idempotency |
| 125 | User thinks autosave means approved | CONTAINED | explicit separation |
| 126 | User deletes local project and assumes cloud copies are gone | CONTAINED | external side-effect disclosure |
| 127 | User changes Auto→Manual while jobs are in flight | CONTAINED | policy affects future work |
| 128 | Producer changes FPS mid-production | CONTAINED | impact-analysis command |
| 129 | Human approves wrong proxy while 4K is stale | CONTAINED |
| 130 | Reviewer fatigue makes PASS rate drift | CONTAINED | random/golden calibration |
| 131 | User intentionally violates continuity but auto-repair fights forever | CONTAINED | CreativeException |
| 132 | User expects a single “data folder”; system hides DB/media split and later drive disappears | PARTIAL | UI clarification added; migration recovery must be tested |
| 133 | One wrong character reference fans out into hundreds of expensive shots | **GAP/P1** | bulk cancel/containment/impact budget before large fanout needed |
| 134 | Human manually edits approved timeline; background AI task writes older result after | **GAP/P1** | manual ownership + stale write/fencing at field/track level needed |

# 10. Rights/release/update attacks

| # | Attack | Verdict | Why |
|---|---|---|---|
| 135 | Rights revoked after internal approval | CONTAINED | independent blocking axis |
| 136 | Rights revoked after publish | PARTIAL | takedown/compensation exists; cannot erase external copies |
| 137 | Provider terms change after generation before release | CONTAINED | terms snapshot + release review |
| 138 | Voice consent allows performance but not cloning | CONTAINED | rights scopes separated |
| 139 | Model license changes after local install | **GAP/P1** | local model/package license snapshot/revalidation should parallel provider terms |
| 140 | Signing cert expires during release | PARTIAL | release gate should verify signing readiness |
| 141 | Signing private key compromised | **GAP/P0** | revocation/key rotation + root trust recovery needs explicit plan |
| 142 | Update package is signed but vulnerable old key is trusted forever | **GAP/P1** | trust-root version/revocation |
| 143 | Published artifact was built pre-merge and differs from main | **GAP/P1** | post-merge/release provenance |
| 144 | Update occurs while cloud job is active and connector state changes | PARTIAL | safe-boundary update exists; active connector/job compatibility needs reconciliation |

# 11. Compound cascade drills

These intentionally combine individually manageable failures.

| # | Cascade | Result |
|---|---|---|
| 145 | Canon update → 500 stale shots → auto-regeneration → provider timeout → blind retry → budget exhaustion | **PARTIAL** — staleness/retry controls exist; bulk fanout/cost exposure hard limit needs strengthening |
| 146 | Backup restore → old outbox restored → provider jobs reissued → late callbacks from pre-restore future arrive | **GAP/P0** — recovery epoch/reconciliation barrier required |
| 147 | Flow takes over stale PR → old worker wakes → both push same branch → reviewer evaluates mixed commits | **GAP/P0** — takeover branch fencing required |
| 148 | Governance PR edits CI workflow → same modified workflow reports green → Integrator merges | **GAP/P0** — immutable/trusted base verifier required |
| 149 | Public Issue prompt-injects agent → agent attempts privileged command → CI log exposes secret | **CONTAINED only if all trust/redaction layers are implemented** |
| 150 | OneDrive chosen as “data folder” → DB/WAL sync conflict → crash → backup captures inconsistent files | **CONTAINED by new DB-root rule if implementation follows it** |
| 151 | Disk 95% full → long read blocks WAL checkpoint → import generates proxies → disk full → updater starts | **GAP/P1** — system-wide storage pressure governor needed |
| 152 | GPU telemetry stale → two renders OOM → worker restart storm → fallback cloud → privacy policy blocks → queue oscillates | **PARTIAL** — capacity-aware fallback exists; resource reservation is missing |
| 153 | External web UI changes → automation downloads wrong candidate → filename matches expected → human approves proxy | **PARTIAL** — trace association catches ambiguity; selector semantic drift needs certification/health invalidation |
| 154 | App update migrates DB → fails health check → old app rolls back → cannot read forward schema | **GAP/P0/P1** |
| 155 | Machine migration restores DB/media → DPAPI secrets missing → connector shows “broken” → auto-fallback changes provider/output style | **GAP/P1** — REAUTH_REQUIRED must prevent silent creative fallback |
| 156 | Malicious screenplay HTML triggers WebView XSS → native bridge command → exports project to attacker path | **GAP/P0** |
| 157 | Malicious m3u/playlist imported → FFmpeg opens network/local URI → exfiltrates file or hangs | **GAP/P0** |
| 158 | Provider returns temporary URL → DB marks artifact READY → URL expires → release later has missing source | **GAP/P1** |
| 159 | Wrong character reference selected → 200 jobs dispatched → user corrects reference → stale callbacks keep landing | **PARTIAL/GAP** — stale writes safe, but fast bulk cancellation/exposure cap needed |
| 160 | Human adjusts dialogue timing manually → old AI lip-sync job completes → overwrites/manual state becomes stale invisibly | **GAP/P1** — manual ownership/fencing required |
| 161 | Two task claimers choose different branch slugs → both succeed → duplicate implementation/review/merge race | **GAP/P0** |
| 162 | Capacity event history spans hundreds of pages → worker only reads first page → elects stale Planner | CONTAINED by pagination+epoch rule if parser implements it |
| 163 | Trusted GitHub credential compromised → attacker posts valid-looking control events | **RESIDUAL P0** — cannot solve with logical IDs; native protection/separate credentials required |
| 164 | Ransomware hits machine + writable local backup; GitHub survives but media/DB gone | **GAP/P1 ops** — optional immutable/offline backup tier needed |
| 165 | Full project restore succeeds but user immediately resumes old browser session whose provider state belongs to newer epoch | **GAP/P1** — browser/connection sessions must revalidate after restore epoch |
| 166 | Release artifact built from pre-squash HEAD, updater/release manifest references merged SHA | **GAP/P1** — provenance mismatch |
| 167 | Long-running UI query pins SQLite read snapshot → WAL grows → disk reserve consumed → commands fail | **GAP/P1** |
| 168 | AI-generated Markdown includes image/link to remote tracking URL rendered inside app | **GAP/P1** — remote content/CSP/privacy rendering policy |
| 169 | Cache contains derived output from old rights state; rights revoked; cache hit reintroduces it | PARTIAL — semantic cache should include rights/policy dependency where output legality changes |
| 170 | Local model package license is revoked; cached certified package continues production | **GAP/P1** — local package/license revalidation |

# 12. Newly uncovered findings requiring hardening

## X01 — Claim branch name is not actually deterministic (P0)
Current form contains free-form `<slug>`.
Two workers may derive different slugs and both win.

**Fix:** atomic branch key becomes exactly:
`agent/i<issue>-a<attempt>`

Human description belongs in PR title, not lock key.

## X02 — GitHub cannot open a zero-diff Draft PR (P1 control-plane correctness)
Observed live: GitHub returned 422.

**Fix:** claim sequence:
branch atomic claim → minimal machine claim marker commit → Draft PR → substantive work.
Marker is removed before merge-ready.

## X03 — Stale-owner takeover lacks physical write fencing (P0)
Continuing on the same branch is unsafe when original worker is unreachable.

**Fix:** explicit handoff may reuse branch; stale/unconfirmed takeover uses a new fenced owner branch and replacement PR, closes/supersedes old PR.

## X04 — Lease renewal/fencing is underspecified (P1)
Long work may outlive TTL.

**Fix:** lease epochs/renewals; before push/critical mutation revalidate ownership. Fenced takeover never shares branch with uncertain old writer.

## X05 — Task contract hash canonicalization is undefined (P1)
YAML/JSON ordering/whitespace can create different hashes.

**Fix:** define canonical JSON serialization from parsed schema: UTF-8, sorted keys, normalized arrays by semantic rule, no comments/whitespace significance, SHA-256 with algorithm prefix.

## X06 — Trusted control actor root needs versioned source (P1)
Capacity Issue body is not a trust root.

**Fix:** authoritative `TRUSTED_CONTROL_POLICY.md`/machine section on protected main; Capacity epochs reference policy revision.

## X07 — CI evidence lacks producer/workflow provenance (P0)
Check name/result alone can be spoofed by another integration/token.

**Fix:** bind evidence to GitHub App/check-suite producer identity + workflow path/revision + trusted runner class.

## X08 — Governance PR can test itself with altered workflow (P0)
Non-retroactivity is policy, but actual CI must be independent.

**Fix:** governance gate executed from protected base/external verifier that PR cannot modify for its own approval.

## X09 — Release artifact provenance after squash/merge (P1)
Pre-merge binary may embed a different SHA/config.

**Fix:** release/package/sign from merged/release commit or verify reproducible content digest with attestation.

## X10 — Restore needs a recovery epoch/fence (P0)
Restored state can receive callbacks/outbox from “future” external reality.

**Fix:** increment recovery epoch, freeze dispatch, quarantine/reconcile outbox/inbox/browser/provider jobs before normal work.

## X11 — App rollback must be schema-compatible (P0/P1)
Binary rollback without DB compatibility can make recovery worse.

**Fix:** app declares schema min/max; prefer expand/contract migrations; irreversible schema step requires DB snapshot and rollback strategy.

## X12 — SQLite WAL checkpoint starvation/system storage pressure (P1)
Long reads can make WAL grow without bound.

**Fix:** read transaction duration policy, WAL metrics/checkpoint governor, reserve thresholds, write shedding/read-only safe mode.

## X13 — Local WebView/native bridge trust boundary is underspecified (P0)
XSS in imported/generated content can become local privilege escalation.

**Fix:** strict CSP, no unsafe HTML, navigation allowlist, native bridge unavailable to remote origins, scoped IPC sessions/ACL.

## X14 — Import/media parser resource/network sandbox (P0/P1)
Archive bombs, gigapixel images and FFmpeg playlists can consume/exfiltrate.

**Fix:** decompression/pixel/CPU/memory/time budgets, protocol/network deny by default, sandbox parser processes.

## X15 — Context Compiler needs instruction-vs-data trust channels (P0)
Untrusted screenplay/document text must not become control instructions.

**Fix:** typed context segments with trust/provenance; only trusted policy/system segments can control tools.

## X16 — Content hash algorithm agility (P1)
Raw digest without algorithm/version creates future migration ambiguity.

**Fix:** identity includes `sha256:<digest>` (or algorithm field) and supports verified rehash migration.

## X17 — Provider artifact must be locally materialized before READY (P1)
External URL/session reference is not durable evidence.

**Fix:** STAGING → downloaded → hash/decode verify → local object registered → READY.

## X18 — Cost exposure for unknown/delayed provider billing (P1)
Estimate reservation alone may not cap real spend.

**Fix:** per-command/job max exposure, unknown-cost policy, provider quota guard, no retry when acceptance/cost unknown without reconciliation.

## X19 — Restore/machine move credential portability (P1)
DPAPI-backed credentials are machine/user scoped.

**Fix:** restored connection enters REAUTH_REQUIRED; no silent provider fallback because credential is missing.

## X20 — Manual creative edits need ownership locks (P1)
Late AI job must not overwrite intentional human edit.

**Fix:** manual/human ownership/fencing at editable domain/field/track scope; AI proposes or becomes stale instead of overwriting.

## X21 — Resource telemetry is not a reservation (P1)
Two workers may see same free VRAM.

**Fix:** scheduler reserves GPU/VRAM/CPU/disk capacity with lease/headroom before dispatch.

## X22 — Signing/update trust root rotation (P0/P1)
Valid signature is insufficient if key compromised forever.

**Fix:** offline root / online signing separation, key IDs, rotation/revocation, emergency recovery policy.

## X23 — Immutable/offline backup tier (P1 ops)
Local writable backup is vulnerable to ransomware/user deletion.

**Fix:** optional offline/immutable backup profile and periodic restore verification.

## X24 — Bulk fanout containment (P1)
One wrong canon/reference can dispatch hundreds of expensive jobs before user notices.

**Fix:** staged fanout, batch exposure cap, early sample/approval policy, bulk cancel/invalidate on upstream correction.

# 13. Controls that survived the attack well

The following design choices repeatedly contained failures:
- immutable approved revisions;
- independent rights/staleness/review axes;
- command/impact planning;
- outbox/inbox idempotency;
- UNKNOWN != PASS;
- exact representation review;
- typed dependency graph;
- provider-neutral capability contract;
- staged asset registration;
- graph-aware GC;
- bounded repair loops;
- release/publish separation;
- context loading tiers;
- stage WIP/backpressure;
- public GitHub trust filtering;
- verification tuple/base drift logic.

# 14. Overall conclusion

The baseline does not collapse, but the attack found several **real P0/P1 holes at trust-boundary and recovery-boundary transitions**.

Most dangerous themes:
1. a logical lease is not physical write fencing;
2. a backup restore is not a rollback of the external world;
3. a green check is not trustworthy without producer/workflow provenance;
4. a local WebView is a privileged security boundary;
5. untrusted content can cross from “film data” into “agent instruction” unless structurally separated;
6. capacity telemetry/reservation and budget estimates are not enforcement;
7. update rollback is unsafe unless database compatibility is designed explicitly.

After these are hardened, the next layer of unknowns requires executable chaos tests rather than more prose-only review.


# 15. Second-wave adversarial cases

| # | Attack | Verdict | Why |
|---|---|---|---|
| 171 | Planner creates A→B→C→A hard-dependency cycle | **GAP/P1** | READY queue can deadlock unless task graph cycle is rejected |
| 172 | URL import points to `http://127.0.0.1/admin` | **GAP/P0/P1** | Universal URL intake can become SSRF against local services |
| 173 | Public URL redirects to RFC1918/link-local/cloud metadata IP | **GAP/P0/P1** | redirect/DNS resolution must be revalidated, not only original URL |
| 174 | DNS rebinding changes public host to private IP between validation/fetch | **GAP/P1** | URL fetcher needs connect-time address policy |
| 175 | Browser connector follows `file://` or custom protocol from provider page | **GAP/P0/P1** | navigation/protocol allowlist needed |
| 176 | ZIP contains `../../AppData/...` | PARTIAL | sandbox root exists; extraction canonical-path validation must be explicit |
| 177 | ZIP contains NTFS ADS/device-name path | **GAP/P1 Windows** | path sanitizer must reject ADS/device semantics |
| 178 | Source file/junction is swapped after validation but before parsing | **GAP/P1 TOCTOU** | copy/open-by-handle into private staging before parser |
| 179 | CAS object is hardlinked into editable handoff; NLE modifies it | **GAP/P0 data integrity** | writable hardlink can mutate immutable canonical bytes |
| 180 | Silent SSD bit rot corrupts old canonical asset months later | **GAP/P1** | periodic hash scrub/mirror repair policy useful for important storage |
| 181 | SQLite backup is made by copying DB file while WAL contains latest commits | **GAP/P0 implementation rule** | must use SQLite backup/snapshot-safe method |
| 182 | Backup target reports success but is same physical disk | PARTIAL | durability class added; UI/policy should distinguish failure domains |
| 183 | Provider webhook/callback is forged by attacker | **GAP/P0** | idempotency does not authenticate event source |
| 184 | Valid callback is replayed with new transport request ID | PARTIAL | provider_event_id dedupe helps; signature/timestamp/replay window needed |
| 185 | MCP server returns path `../../secrets` as output | **GAP/P0/P1** | connector normalized outputs must stay inside staging sandbox |
| 186 | Connector returns symlink/junction output escaping staging | **GAP/P1** | output registration must resolve/reject reparse escape |
| 187 | Agent adds typosquatted npm/Python dependency | **GAP/P1 supply-chain** | autonomous dependency additions need provenance/license/security gate |
| 188 | New dependency has incompatible copyleft/commercial license | **GAP/P1 legal** | source dependency license policy/SBOM required |
| 189 | Dependency postinstall script phones home in CI/dev | PARTIAL | scripts are trust boundary; default policy should restrict/review |
| 190 | Feature PR weakens the invariant test that would fail its code | **GAP/P1** | critical invariant tests need protected/governance review semantics |
| 191 | Agent deletes a flaky failing test instead of fixing product | PARTIAL | review catches, but metric/test-coverage regression should flag |
| 192 | One Windows account can read another user's CineForge library | **GAP/P1 privacy** | default local roots/IPC need user-scoped ACL |
| 193 | Browser profile for Project A is accidentally reused for confidential Project B | **GAP/P1** | profile/session scoping must respect studio/project privacy |
| 194 | Crash dump contains API key, prompt, unreleased frame | PARTIAL | risk known; explicit crash dump redaction/opt-in required |
| 195 | Diagnostics bundle references media via path even though bytes excluded | **GAP/P2 privacy** | path/user-name metadata can still leak sensitive information |
| 196 | External linked asset changes in place after approval | PARTIAL | fingerprint exists; revalidation policy must mark revision/source stale |
| 197 | External source is replaced with same size/mtime | **GAP/P1** | critical relink verification needs cryptographic fingerprint, not metadata only |
| 198 | GC deletes rebuildable output; later required model/package is uninstalled | **GAP/P1** | package removal/GC recipe dependency must be coupled |
| 199 | Model package exists but its license becomes blocked after derivative was purged | **GAP/P1** | recipe legality is part of rebuildability, not just technical availability |
| 200 | Main schema/event invariant drifts but audit event still writes | **GAP/P1** | periodic integrity reconciler should verify canonical rows/events/versions |
| 201 | Event clock timestamp is earlier than causation event | CONTAINED if seq used | docs should prohibit wall-clock ordering assumptions |
| 202 | Provider callback arrives with impossible timestamp but valid signature | CONTAINED if external time is evidence only |
| 203 | FAT32 export target cannot store >4GB master | **GAP/P2** | storage target capability check needs max-file-size |
| 204 | Removable drive disappears during export then returns with stale partial file | PARTIAL | export staging/verify; volume identity must prevent wrong-volume continuation |
| 205 | Two identical removable drives swap drive letters | **GAP/P2** | use volume identity, not drive letter alone |
| 206 | Windows Defender quarantines newly downloaded runtime/model executable | PARTIAL | package health detects missing; UX needs security-tool diagnosis |
| 207 | Repeated failed worker restart loops every minute | **GAP/P1** | restart circuit breaker/quarantine/backoff needed |
| 208 | GPU worker crash leaves reservation ACTIVE forever | PARTIAL | reservation expiry; reconciler must reap |
| 209 | Browser session lease survives browser process crash | PARTIAL | worker/profile reconciliation needed |
| 210 | User logs out of web provider in another browser while job queued | CONTAINED/PARTIAL | auth health recheck at dispatch |
| 211 | Website account points to wrong tenant/workspace after re-login | **GAP/P1** | account/workspace identity must be verified, not only “authenticated” |
| 212 | Provider changes region/data residency silently | **GAP/P1 privacy** | connection/provider policy should snapshot residency/egress-relevant metadata where available |
| 213 | API base URL configured to attacker-controlled host mimicking provider | **GAP/P1** | endpoint identity/TLS/publisher policy needed for managed connectors |
| 214 | TLS interception returns valid enterprise certificate but wrong provider behavior | PARTIAL | enterprise environments may be intentional; endpoint identity policy needs diagnostics |
| 215 | Human approves 100 items using keyboard with focus moved unexpectedly | **GAP/P1 UX** | destructive/bulk review shortcuts need focus/selection guard and undo where possible |
| 216 | “Approve all” includes items loaded after confirmation | **GAP/P1** | bulk command scope must pin exact IDs/query snapshot |
| 217 | Search filter changes during bulk delete/approve | CONTAINED by explicit scope if implemented; needs query snapshot |
| 218 | Undo restores local state but external provider deletion already happened | CONTAINED | compensatable/irreversible distinction |
| 219 | Project clone shares browser/API connection policy unexpectedly | **GAP/P2 privacy** | duplication semantics must define which secrets/connections are inherited |
| 220 | User exports support bundle and uploads publicly | PARTIAL | redaction helps; UI should classify bundle sensitivity and expiry |

# 16. Additional findings

## X25 — Hard-dependency cycles (P1)
Planner must validate Task hard-dependency graph is acyclic before marking tasks READY.
Flow reconciliation should detect cycles introduced by manual edits.

## X26 — URL intake/browser SSRF and protocol escape (P0/P1)
URL fetching/navigation requires:
- scheme allowlist;
- private/link-local/localhost policy;
- DNS/redirect revalidation;
- download size/time limits;
- `file:`/custom protocol deny unless explicit trusted feature;
- no automatic credential forwarding across origins.

## X27 — Immutable CAS must never be exposed through writable hardlinks (P0)
Managed immutable objects may be copied or safely reflinked with copy-on-write guarantees.
Editable handoff/staging paths must never be writable aliases of canonical CAS bytes.

## X28 — External callback authenticity (P0)
Idempotency/deduplication is not authentication.
Connector callback ingress must verify provider-specific signature/token/channel identity and replay policy before inbox registration.

## X29 — Autonomous dependency supply-chain governance (P1)
Adding/upgrading executable dependencies is a security/legal action:
- lockfile/provenance;
- package registry/publisher checks where available;
- license policy;
- vulnerability audit;
- postinstall/build-script review;
- SBOM for release.

## X30 — Critical invariant test governance (P1)
A feature PR may change tests, but weakening/deleting tests that protect architecture/security invariants requires explicit review/gate evidence.
CI should flag unexplained invariant-test/coverage disappearance.

## X31 — Local user isolation (P1)
Default DB/media/runtime roots and IPC endpoints need OS-user scoped ACLs.
Shared roots are explicit choices with clear privacy consequences.

## X32 — External source TOCTOU/fingerprint (P1)
For critical ingest/relink, copy/open stable handle into staging then hash.
File size/mtime alone is not identity.

## X33 — Rebuildability includes package/license dependencies (P1)
A derived recipe is not safely rebuildable if:
- required package/model is removed/unavailable;
- required license/rights becomes blocked;
- provider capability disappeared.

Package removal and GC must evaluate recipe dependencies.

## X34 — SQLite-consistent backup primitive (P0 implementation invariant)
Backup implementation uses SQLite Online Backup API / validated snapshot method, never naive copy of only the main DB while WAL is active.

## X35 — Canonical/event integrity auditor (P1)
Because V1 is event/audit-backed rather than pure event-sourced, add integrity checks for:
- aggregate version monotonicity;
- command→event expectation;
- orphan/missing audit events;
- revision registry consistency;
- outbox/event transaction invariants.

## X36 — Worker restart circuit breaker (P1)
Repeated crash/restart must enter UNHEALTHY/QUARANTINED with backoff rather than restart storm.

## X37 — Web account/workspace identity (P1)
“Authenticated” is insufficient.
A connection can optionally pin/verify account/tenant/workspace identity so automation does not run in the wrong workspace.

## X38 — Bulk command snapshot scope (P1)
Bulk approve/delete/generate command binds exact entity IDs/revisions or a materialized query snapshot.
Newly appearing items cannot silently enter the action after confirmation.


# 17. Third-wave attacks: false truth, process split-brain and governance escape

| # | Attack | Verdict | Why |
|---|---|---|---|
| 221 | User launches CineForge twice; two Core processes share one DB | **GAP/P0/P1** | SQLite serialization does not prevent duplicate schedulers/external dispatch |
| 222 | Old Core survives updater while new Core starts | **GAP/P0/P1** | process-level ownership/fencing required |
| 223 | Two Windows users intentionally point to the same live DB | **GAP/P0/P1** | V1 single-Core architecture cannot safely treat shared DB as multi-user service |
| 224 | Core OS lock file remains after crash | PARTIAL | lock must be liveness/fencing aware, not existence-only |
| 225 | SQLite migration starts with insufficient free space for copy/rebuild/VACUUM | **GAP/P1** | migration needs worst-case storage reservation/preflight |
| 226 | User manually copies only `cineforge.db` while WAL has latest commits | **GAP/P1 UX** | “copy DB file” must not be presented as valid backup |
| 227 | Migration checksum in repo changes after migration was already applied | PARTIAL | schema_migrations hash can detect; startup must fail safe rather than overwrite |
| 228 | App opens DB with foreign_keys accidentally OFF on a secondary connection | **GAP/P1** | every Core DB connection must enforce/verify required PRAGMAs |
| 229 | Long VACUUM blocks production unexpectedly | **GAP/P2/P1** | maintenance must be scheduled/safe-boundary aware |
| 230 | System clock jumps years forward; licenses/tokens/rights suddenly expire | **GAP/P1** | wall-clock uncertainty needs detection/separation from monotonic durations |
| 231 | System clock jumps backward; “newest by timestamp” selects old record | **GAP/P1** | authoritative ordering must use seq/version, not timestamp |
| 232 | GitHub control event comment is edited after agents consumed it | PARTIAL | append-only policy is not technical immutability; hash chain/anomaly detection useful |
| 233 | Trusted actor deletes a critical control comment | **GAP/P1** | predecessor-chain gap should become governance anomaly/UNKNOWN |
| 234 | Unicode homoglyph `AGENT_REVIEW_V１` or zero-width key bypasses parser/human review | **GAP/P1** | machine grammar should be ASCII-strict / reject control/confusable keys |
| 235 | Oversized Issue/comment exhausts model/parser context | PARTIAL | size limits mentioned; parser/control fetch should cap and page |
| 236 | Capacity epoch old Issue accidentally remains open; discovery chooses wrong Issue | **GAP/P1** | current epoch must follow signed/valid epoch chain, not “lowest open Issue” alone |
| 237 | Task attempt branch was deleted; new agent reuses attempt number and historical evidence collides | **GAP/P1** | attempt identity should be monotonic from trusted claim history, not branch existence |
| 238 | Agent task allows Core code but agent modifies CI/governance too | **GAP/P0/P1** | task needs explicit write scope + high-risk escape rule |
| 239 | Agent accidentally commits API key/test credential | **GAP/P0** | secret scanning/gitleaks-style CI/pre-merge gate needed |
| 240 | Agent pastes third-party source with incompatible license into public repo | **GAP/P1** | external code provenance/license policy needed |
| 241 | User/project media is copied into public GitHub test fixture | **GAP/P0 privacy** | strict data classification + synthetic fixture policy |
| 242 | GitHub Action uses floating tag `@v4` and upstream is compromised | **GAP/P1** | security-sensitive actions should pin immutable commit SHA |
| 243 | CI artifact from untrusted job is consumed by release/signing workflow | PARTIAL | cache trust addressed; artifact provenance/attestation must also be enforced |
| 244 | PR changes allowed-write-path validator to allow its own out-of-scope diff | **GAP/P0 governance** | validator must obey non-self-approval/protected base rules |
| 245 | Required test suite passes but coverage drops drastically in critical module | PARTIAL | invariant suite protects some; risk-based coverage regression should be signal |
| 246 | Agent adds huge binary to Git history instead of object/artifact store | **GAP/P1 repo ops** | repo size/file policy needed |
| 247 | Generated snapshot/test file contains PII/path/user name and is committed | **GAP/P1 privacy** | fixture sanitization/data classification |
| 248 | Control event hash algorithm changes without migration | **GAP/P2** | event-chain hash must be algorithm-qualified if introduced |
| 249 | Control epoch rollover occurs while slot acquires lease on old epoch | **GAP/P1** | epoch transition needs drain/fence and new lease epoch |
| 250 | Old epoch Flow Governor posts takeover after new epoch activates | **GAP/P1** | control events bind epoch and stale epoch is rejected |
| 251 | Browser profile cookie backup leaks authentication outside DPAPI store | **GAP/P0/P1** | profile backup policy must exclude/protect secrets |
| 252 | Diagnostics screenshot accidentally captures unreleased media | **GAP/P1 privacy** | diagnostic media capture opt-in/redaction |
| 253 | Thumbnail/cache remains after rights revocation/private asset purge | **GAP/P1 privacy/rights** | derived cache taint/purge path must include previews/embeddings |
| 254 | Search embedding from Project A appears in Project B semantic search | **GAP/P0/P1 confidentiality** | retrieval index must enforce scope/tenant/project boundary at storage/query |
| 255 | Global learning corpus ingests confidential project data despite no training permission | **GAP/P0/P1** | learning ingestion gate must bind explicit training permission/provenance |
| 256 | Local model/runtime unexpectedly sends telemetry/internet requests | **GAP/P1 privacy** | worker network egress policy/sandbox needed |
| 257 | Plugin/MCP server binds 0.0.0.0 instead of localhost and exposes control API | **GAP/P0** | bind/ACL/firewall policy and health validation needed |
| 258 | Local RPC token is written to world-readable log | **GAP/P0** | secret redaction + token lifetime/storage policy |
| 259 | RPC client replays captured privileged command | **GAP/P1** | session-bound nonce/replay protection/idempotency/authorization needed |
| 260 | Tauri/WebView XSS uses a valid command repeatedly until cost/storage exhausted | PARTIAL | IPC authorization exists; per-command policy/rate/exposure still matters |
| 261 | GPU produces NaN/black frames with valid codec | PARTIAL | decode verification not semantic media validity; QC should detect signal anomalies |
| 262 | Huge rational numerator/denominator overflows timing math cross-multiplication | **GAP/P1/P2** | checked integer math/canonical rational bounds required |
| 263 | Timeline has millions of edit ops; startup replay becomes minutes | **GAP/P1 scale** | working-session compaction/snapshots needed |
| 264 | Undo history references GC'd temporary assets | **GAP/P1** | undo retention pins required dependencies until checkpoint/policy expiry |
| 265 | Variant explosion creates 100k candidates and storage/search/UI collapse | **GAP/P1 scale** | variant retention/WIP/archive policy needed |
| 266 | Full-text/vector index lags and UI shows deleted confidential asset | **GAP/P1 privacy** | security-sensitive delete/revoke must invalidate derived index synchronously or block query |
| 267 | Embedding model update makes nearest-neighbor semantics incomparable across index versions | PARTIAL | embedding version migration exists; query must avoid mixed-space comparison |
| 268 | Release signing timestamp service is unavailable | **GAP/P2** | release policy needs fail/wait/fallback semantics, not unsigned silent release |
| 269 | Antivirus quarantines updater after DB migration started | **GAP/P1** | update ordering/staging must prevent migration before executable trust/availability is certain |
| 270 | Installer rollback removes new executable but leaves new runtime/package side effects | **GAP/P1** | update planes need compensating plan/manifests |
| 271 | Provider API base URL is DNS-hijacked after initial certificate validation | PARTIAL | TLS validates host; managed connector endpoint policy/cert diagnostics still important |
| 272 | Callback signature key rotates and old/new overlap causes false rejects | **GAP/P2** | connector auth keyset rotation/grace policy needed |
| 273 | User rotates Windows account password/DPAPI context and credentials fail | PARTIAL | REAUTH_REQUIRED handles |
| 274 | Media root is BitLocker-encrypted and unavailable before login/startup | PARTIAL | volume availability; startup should degrade not declare missing/deleted |
| 275 | Offline immutable backup credential itself is lost | **GAP/P2 ops** | backup health must include recoverability of access credentials/key escrow where configured |
| 276 | Bulk action snapshot includes 50k IDs and blows command/event size limits | **GAP/P1** | large scope should use immutable manifest object, not giant JSON event |
| 277 | User closes project while background import still staging data | PARTIAL | lifecycle exists; project close/GC must pin active staging |
| 278 | Project is trashed while a publication is processing externally | PARTIAL | reconciliation continues; UI needs tombstoned project external-side-effect view |
| 279 | Release manifest points to asset whose storage mirror is corrupt after approval | PARTIAL | release-time availability/hash recheck needed |
| 280 | Restore succeeds but search/projections are from newer pre-restore state | **GAP/P1** | recovery epoch must rebuild/invalidate derived projections/indexes |

# 18. Third-wave findings

## X39 — Core process singleton/fencing (P0/P1)
V1 requires one authoritative Core per live DB.
Use OS-user scoped instance lock plus DB ownership epoch/heartbeat/fencing.
A stale lock alone cannot permanently block startup; a second live Core cannot become active writer/orchestrator.

## X40 — Database maintenance preflight (P1)
Migrations/VACUUM/rebuild operations reserve worst-case storage and run at safe boundary.
Every Core DB connection verifies required SQLite PRAGMAs.

## X41 — Wall-clock uncertainty (P1)
Use monotonic time for durations/TTL inside a process and seq/version for ordering.
Wall clock is evidence for legal/expiry/scheduling; large clock skew creates TIME_UNCERTAIN state rather than silently reordering history.

## X42 — Control event integrity chain (P1)
Structured control events should carry algorithm-qualified `event_hash` and `prev_event_hash` within each stream/epoch.
Edit/delete/predecessor gap becomes governance anomaly/UNKNOWN, not silently accepted state.

## X43 — ASCII-strict machine control grammar (P1)
Machine keys/version tokens are normalized/validated against ASCII grammar; reject zero-width/control/confusable key characters.

## X44 — Current control epoch pointer/transition fencing (P1)
Epoch discovery follows a valid epoch chain/current pointer, not merely Issue title/open age.
Epoch rollover drains/invalidates old control leases and rejects stale-epoch mutations.

## X45 — Monotonic claim attempt identity (P1)
Attempt numbers derive from trusted historical claim events/PRs, not only existing branches.
Deleted branch cannot reset attempt identity.

## X46 — Agent write-scope policy (P0/P1)
Task contract separates:
- expected/likely paths;
- ALLOWED_WRITE_PATHS;
- FORBIDDEN_WRITE_CLASSES.
Out-of-scope high-risk files require contract revision/governance task.

## X47 — Secret/data-classification gate (P0)
Pre-merge scanning + policy prevents credentials, real client/media/private artifacts and unsafe diagnostics from entering public Git history.

## X48 — GitHub Actions/dependency provenance (P1)
Security-sensitive Actions are pinned to immutable commit SHA.
Workflow artifacts carry producer/source digest; privileged release never trusts arbitrary PR artifact.

## X49 — Derived confidential data lifecycle (P0/P1)
Thumbnails, proxies, waveforms, embeddings, search indexes, logs and learning examples inherit source privacy/rights scope and deletion/revocation requirements.

## X50 — Local worker network egress policy (P1)
Local runtime/process manifest declares network DENY/ALLOWLIST/REQUIRED.
“Runs locally” does not imply “does not send data out”.

## X51 — Local service bind/IPC replay security (P0/P1)
Local services bind approved interfaces only, use OS ACL/session auth, short-lived secrets/nonces and replay-safe command authorization.

## X52 — Timeline/undo/variant compaction (P1 scale)
Large mutable histories require snapshots/compaction; undo pins dependencies until no longer reachable; variants have WIP/retention/archive policies.

## X53 — Large bulk-scope manifest (P1)
Large bulk action scopes use immutable manifest storage/hash rather than oversized command/event JSON.

## X54 — Recovery invalidates all derived projections (P1)
After restore epoch changes, search/vector/read projections/cache created after restored checkpoint are rebuilt or version-invalidated before authoritative UI use.

## X55 — Release revalidates artifact availability (P1)
Immediately before final release/sign/publish, verify required storage objects/hash/rights/signing readiness against the immutable release manifest.


# 17. Third-wave cross-control attacks

| # | Attack | Verdict | Why |
|---|---|---|---|
| 221 | Rights revoked after a 100-item bulk command is confirmed but before item 63 executes | **GAP/P1** | bulk scope snapshot must not bypass per-item execution-time rights recheck |
| 222 | User permission/role revoked while a long command continues | **GAP/P1** | authority snapshot at plan time alone is insufficient for dangerous later phases |
| 223 | GC dry-run marks proxy rebuildable, then required package is removed before execute | **GAP/P1** | GC execute must revalidate recipe/package/license dependencies |
| 224 | Backup references storage object that GC deletes before backup copy completes | **GAP/P1** | backup needs snapshot protection/retention lease over referenced objects |
| 225 | Restore selects backup whose referenced immutable package manifest is missing | **GAP/P1** | recoverability includes dependency manifest availability or readable degraded mode |
| 226 | Connection goes REAUTH_REQUIRED and router silently chooses a stylistically different provider | CONTAINED by new rule if implemented |
| 227 | Rights revocation arrives while provider generation is already accepted and non-cancellable | PARTIAL | local result can be blocked; exposure/taint state must remain explicit |
| 228 | Provider returns result after consent was revoked mid-flight | **GAP/P1** | result must inherit current rights/taint recheck, not only dispatch-time rights snapshot |
| 229 | Manual lock is released after AI job starts but before it finishes | **GAP/P2** | canonicalization must compare generation base revision and current ownership/revision, not only lock boolean |
| 230 | User force-deletes a package while jobs using its executable are running | **GAP/P1** | package removal needs active-use lease/refcount and drain semantics |
| 231 | App shutdown kills Core while SQLite checkpoint is blocked and external callback is arriving | PARTIAL | shutdown/reconciliation exists; ordered shutdown barrier should be explicit |
| 232 | Windows update reboots machine during schema migration | **GAP/P1** | migration journal must be crash-resumable/idempotent and safe-mode on ambiguous step |
| 233 | Machine resumes from hibernate with expired browser cookies and stale GPU reservations | PARTIAL | resource/session revalidation on resume should be explicit |
| 234 | System time jumps forward one year causing tokens/certs/leases to look expired | **GAP/P1** | monotonic duration vs wall-clock validity must be separated |
| 235 | System time jumps backward and an expired certificate appears valid by local clock | **GAP/P1** | security validity needs trusted time policy/grace/diagnostic handling |
| 236 | Root signing key revocation metadata cannot be fetched because machine is offline | **GAP/P1** | offline trust policy must define last-known revocation freshness and fail-safe behavior |
| 237 | Rights service/policy source is unavailable during release | CONTAINED if UNKNOWN blocks; verify release gate |
| 238 | Database integrity auditor finds mismatch while production jobs are active | **GAP/P1** | integrity incident needs freeze scope and repair precedence |
| 239 | Backup restore repairs DB but not OS-level model/runtime cache; stale binary with same path is used | **GAP/P1** | executable/package identity must be hash/pin verified before use |
| 240 | User imports a file named like an existing canonical asset and UI visually confuses them | **GAP/P2 UX** | display-name collision should not hide immutable identity/source |
| 241 | An attacker creates millions of tiny files causing directory enumeration/UI denial of service | **GAP/P1** | import directory preflight needs file-count/time budgets before recursive full scan |
| 242 | A single project creates millions of events and audit rows; SQLite projections/rebuild become impractical | **GAP/P1 scale** | event retention/snapshot/partition/archive strategy needs bounded rebuild path |
| 243 | Projection rebuild from event 0 takes hours while app is unusable | **GAP/P1** | durable projection checkpoints/snapshot rebuild strategy required |
| 244 | Search/vector index returns deleted/revoked entity after lag | PARTIAL | index not identity; result resolver must revalidate canonical state before action |
| 245 | User performs bulk action from stale search results | **GAP/P1** | bulk plan must resolve canonical current revisions, not search index payload |
| 246 | A package/model file is replaced on disk after certification but before execution | **GAP/P0/P1** | execution must verify pinned hash/signature at load/start, not only install time |
| 247 | Self-hosted runner workspace from prior PR contains malicious leftover file | **GAP/P1** | ephemeral/clean workspace policy required even for trusted internal branches |
| 248 | Release signing uses artifact from an unclean workspace with untracked file influence | **GAP/P0/P1** | release build must use hermetic/clean checkout and attested inputs |
| 249 | Browser human takeover leaves secret text in clipboard; later diagnostics capture clipboard | **GAP/P2 privacy** | clipboard is transient sensitive channel; diagnostics must never capture it by default |
| 250 | User cancels a destructive local operation after physical delete started | PARTIAL | compensatability exists; delete/GC should stage/tombstone before irreversible purge where possible |

# 18. Further findings

## X39 — Execution-time policy revalidation (P1)
Plan-time checks are necessary but insufficient for long/bulk/external operations.
Before each irreversible/high-impact item/phase, revalidate:
- rights/consent;
- actor authority where relevant;
- manual ownership/current revision;
- recovery epoch;
- package/resource lease;
- budget exposure.

## X40 — Snapshot protection leases for backup/GC/package use (P1)
Backup/export/job/restore operations that depend on objects/packages need temporary protection leases so concurrent GC/removal cannot invalidate the operation.

## X41 — Package executable identity at execution (P0/P1)
Pinned package/model/runtime identity is verified by hash/signature when loaded/launched.
Path/install record alone is not enough.

## X42 — Time-source separation (P1)
Use:
- monotonic clock for durations/lease elapsed time inside one machine/process;
- trusted wall/server time for absolute expiry/certificate/policy validity;
- detect large wall-clock jumps and enter degraded verification where security-sensitive.

Never use UUIDv7/event wall timestamp as sole ordering/expiry authority.

## X43 — Crash-resumable migration protocol (P1)
Migration steps are idempotent/checkpointed with pre/postconditions.
On crash/reboot:
- determine last durable completed step;
- never blindly restart destructive step;
- enter safe mode if state is ambiguous.

## X44 — Integrity incident freeze policy (P1)
If canonical/event integrity mismatch is severe:
- freeze affected aggregate/project/system mutation scope;
- preserve evidence;
- complete safe read/diagnostic operations;
- typed repair/rebuild/reconcile before normal writes resume.

## X45 — Event/projection scale strategy (P1)
Long-lived projects need bounded rebuild:
- durable aggregate/projection snapshots/checkpoints;
- event archival by verified ranges;
- retained audit lookup;
- rebuild from nearest compatible checkpoint, not always event 0.

## X46 — Clean/hermetic execution for CI/release (P0/P1)
Trusted internal code is not a reason to reuse dirty workspaces.
Release/signing and security-critical CI use clean checkout/worktree/container/VM with declared inputs and no prior-PR residue.

## X47 — Search result freshness boundary (P1)
Search/vector results are navigation hints.
Any mutation/bulk plan resolves exact canonical entities/revisions and authorization at command planning time.

## X48 — Large-directory denial-of-service budget (P1)
Directory intake has bounded:
- file enumeration count/time;
- nesting depth;
- metadata read budget;
- incremental pause/cancel;
before expensive hash/proxy fanout begins.


# 19. Fourth-wave privacy, key-lifecycle and cross-project attacks

| # | Attack | Verdict | Why |
|---|---|---|---|
| 251 | Laptop SSD is stolen; filesystem ACL no longer protects offline media/DB | **GAP/P1 privacy** | ACL is access control, not encryption-at-rest |
| 252 | Backup drive is stolen | **GAP/P1** | backup durability class exists, encryption/key policy not explicit |
| 253 | User enables project encryption then loses the only key | **GAP/P1 availability** | encryption without key-recovery policy can become self-inflicted data loss |
| 254 | Encryption key is stored beside encrypted backup | **GAP/P1** | destroys meaningful theft protection |
| 255 | Key rotation starts while 500GB archive is partially re-encrypted | **GAP/P1** | needs versioned key IDs and resumable rewrap/re-encryption |
| 256 | Old revoked encryption key still decrypts cached/temp/proxy files | **GAP/P1** | all derived/temp storage must inherit encryption scope or be purged |
| 257 | Crash dump/pagefile/thumbnail cache exposes decrypted frames | **GAP/P1 OS/privacy** | app encryption alone cannot cover every OS leakage path; policy/diagnostics must be explicit |
| 258 | Project clone copies rights/consent but new production purpose is different | **GAP/P1 legal** | clone must distinguish reusable identity vs rights/purpose-specific approvals |
| 259 | Project clone inherits browser/API connection permissions and can egress confidential assets | **GAP/P1 privacy** | clone should not blindly inherit execution permissions/credentials |
| 260 | Project clone deduplicates same CAS bytes but source project later requests purge | **PARTIAL** | graph refs protect bytes; privacy/retention semantics across projects need explicit policy |
| 261 | User exports diagnostic bundle; file paths reveal Windows username/client name | **GAP/P2 privacy** | redaction must cover metadata/path identity, not only secrets/media bytes |
| 262 | Clipboard contains password/API key copied by user; CineForge “clipboard import” captures it accidentally | **GAP/P1 UX/privacy** | clipboard ingestion should be explicit/purpose-scoped and not background-monitored |
| 263 | Browser takeover leaves credentials in form/autofill and screenshot diagnostics capture them | **GAP/P1** | browser diagnostic capture needs sensitive-field/redaction policy |
| 264 | Failure Lake stores rejected confidential shot forever for learning | **GAP/P1** | learning retention must inherit project privacy/training permission/retention |
| 265 | Global embedding index contains confidential character face after source deletion | CONTAINED if derived-data revocation fully implemented |
| 266 | Embedding model migration copies revoked vectors into new index before revocation filter | **GAP/P1** | migration pipeline must enforce current privacy/rights scope before reindex |
| 267 | Golden example was legal for evaluation but not for training/fine-tuning | PARTIAL | permissions exist; purpose-specific data-use scope should be explicit |
| 268 | Model trained with asset before consent withdrawal; raw asset deleted but weights retain influence | CONTAINED as irreducible/forbid-upfront risk |
| 269 | Project policy changes LOCAL_ONLY after cloud artifacts already exist | PARTIAL | future egress blocked; historical external exposure must remain visible/compensatable |
| 270 | User believes “Delete project” guarantees secure erase from SSD | **GAP/P1 UX** | physical secure erase on SSD is generally not guaranteed; wording/policy must be honest |
| 271 | Encrypted archive opened years later but encryption algorithm/library unsupported | **GAP/P1 archive** | crypto agility + archive decrypt/migration checks needed |
| 272 | Signing/encryption key IDs collide across restored studios | **GAP/P2** | key identity must include authority/domain, not human-friendly ID alone |
| 273 | A user with view permission asks AI assistant to export/share asset externally | **GAP/P1 auth** | view/read authority must be distinct from egress/share/export authority |
| 274 | A user may edit scene but not see actor voice consent details; system leaks legal metadata in UI/API | **GAP/P2 least privilege** | field/domain-level sensitive metadata access needed where relevant |
| 275 | Support bundle generated under admin role is later opened by lower-privileged user on disk | **GAP/P1** | diagnostic artifact needs sensitivity classification, ACL/encryption/expiry |
| 276 | Archive package includes credentials/browser cookies “for reproducibility” | CONTAINED if policy followed; should be explicitly prohibited |
| 277 | A local model/plugin logs prompts to its own file outside CineForge logs | **GAP/P1** | sandbox/log egress policy must cover child-process filesystem/network output |
| 278 | User switches Windows account; shared media root allows reading other user's unreleased proxies | PARTIAL | default ACL exists; shared-root policy needs per-project privacy warning |
| 279 | Export to CapCut folder includes hidden metadata/provenance user did not intend to share | **GAP/P2 privacy** | export profile should define metadata stripping/preservation policy |
| 280 | Subtitle/metadata contains client secret/internal filename and release publishes it | **GAP/P1** | release privacy/content metadata scan needed, not only rights/codec QC |

# 20. Privacy/key findings

## X49 — At-rest encryption policy (P1)
CineForge needs an explicit encryption policy layer distinct from ACLs.

Potential modes:
- OS_VOLUME_PROTECTED / rely on BitLocker-equivalent;
- CINEFORGE_MANAGED_ENCRYPTION for selected DB/media/backups;
- EXTERNAL_ENCRYPTED_TARGET;
- UNENCRYPTED_ALLOWED_BY_POLICY.

The product should not claim encryption if it only configured ACLs.

## X50 — Key lifecycle and recoverability (P1)
Encryption keys require:
- globally unambiguous authority/key identity;
- secure OS-backed storage;
- backup/export policy for recoverable wrapped keys where user chooses;
- rotation/revocation;
- resumable rewrap/re-encryption;
- explicit “lost key means unrecoverable” warning when no recovery escrow exists.

## X51 — Project clone security/rights semantics (P1)
Clone/duplicate operation explicitly chooses what is inherited:
- creative assets/canon;
- rights/consent evidence;
- project policies;
- execution connection permissions;
- budgets;
- browser sessions/credentials (default: never clone);
- learning/training scopes.

Rights valid for one purpose/project must not silently become valid for another.

## X52 — Data-use purpose taxonomy (P1)
Privacy/rights needs purpose-specific permission:
- production use;
- evaluation/QC;
- search/indexing;
- cross-project retrieval;
- learning/failure analysis;
- training/fine-tuning;
- external sharing/publish.

“training_allowed” boolean is not expressive enough for every derivative use.

## X53 — Diagnostic artifact security (P1)
Diagnostic bundles are sensitive artifacts:
- classification;
- redaction including paths/usernames/URLs;
- ACL/encryption;
- expiration/purge;
- explicit raw-media inclusion;
- no clipboard/browser-password capture by default.

## X54 — Egress authority separate from read authority (P1)
An actor allowed to read/view an asset is not automatically allowed to:
- send to cloud/model;
- export;
- publish;
- share;
- create diagnostic bundle containing it.

Commands require explicit egress/export/share permission.

## X55 — Secure-delete honesty (P1 UX/security)
On modern SSD/cloud/provider storage, byte-perfect secure deletion may be impossible to guarantee.
UI/policy distinguishes:
- logical deletion;
- cryptographic erasure where managed encryption/key deletion makes it meaningful;
- provider deletion request;
- physical secure erase not guaranteed.

## X56 — Archive crypto agility (P1)
Long-term archives store:
- encryption algorithm/version;
- key wrapping method;
- decryptability verification timestamp;
- migration plan before algorithm/library obsolescence.

## X57 — Release privacy scan (P1)
Final release verifies not only rights/codec/QC but also configured privacy leakage classes:
- filenames/paths;
- internal metadata;
- hidden tracks;
- embedded comments;
- sensitive subtitle/text metadata;
- unintended provenance fields.

## X58 — Child-process privacy containment (P1)
Local model/tool/plugin workers are constrained in:
- filesystem write scope;
- log paths;
- network;
- crash dumps/temp files.

A “local” tool cannot quietly create its own persistent prompt history outside managed policy.


# 21. Fifth-wave encryption/CAS/resource/context attacks

| # | Attack | Verdict | Why |
|---|---|---|---|
| 281 | Two confidential projects share the same plaintext hash; hash lookup reveals content equality across scopes | **GAP/P1 privacy** | global plaintext CAS identity can become a cross-scope correlation oracle |
| 282 | Convergent/deterministic encryption is used to preserve dedup | **GAP/P0/P1 privacy** | leaks equality and weakens confidentiality for guessable content |
| 283 | Same plaintext is encrypted under Project A key then cloned to Project B with stricter key policy | **GAP/P1** | logical dedup and physical encryption wrapping need separate scopes |
| 284 | Ciphertext is corrupted but plaintext hash cannot be checked until decrypt; key is unavailable | **GAP/P1** | need ciphertext integrity/hash + plaintext identity separately |
| 285 | Key rotation re-encrypts 10TB instead of rewrapping data key | **GAP/P1 ops** | envelope encryption should avoid massive rewrite when possible |
| 286 | Encrypted backup has data but missing key manifest | CONTAINED after key policy if implementation verifies recoverability |
| 287 | CAS dedup saves one physical object across projects; one project requires crypto-erasure | **GAP/P1** | deleting shared key/object can affect another project; per-scope wrapping/ref graph required |
| 288 | An attacker guesses known public file hash and infers user imported it | **GAP/P2 privacy** | do not expose global content hashes to untrusted UI/API; scope identifiers |
| 289 | Resource scheduler reserves GPU then waits for disk; another reserves disk then waits GPU | **GAP/P1** | resource reservation can deadlock |
| 290 | Large batch reserves all VRAM for queued jobs and starves interactive preview | **GAP/P1 UX/flow** | reservations need admission classes/priority/aging and bounded future reservation |
| 291 | Reservation expires while GPU kernel still running | PARTIAL | lease renewal exists; physical resource release/reconcile after crash must be explicit |
| 292 | Worker holds browser profile while waiting user MFA for hours | **GAP/P1 capacity** | HUMAN_WAIT should downgrade/release reservable resources where safe |
| 293 | Context Compiler fits every critical constraint, but provider silently truncates request server-side | **GAP/P1** | provider adapter needs observed/declared request limits and output evidence |
| 294 | Provider changes max context/token behavior without version bump | **GAP/P1** | capability health/benchmark should re-certify on semantic behavior change |
| 295 | Context compilation drops “do not reveal secret” because it is tagged low priority | **GAP/P0** | mandatory safety/privacy constraints need non-droppable class |
| 296 | Same fact appears twice with conflicting authority levels and compiler picks latest text | **GAP/P1** | compiler needs explicit conflict resolution, not positional recency |
| 297 | Prompt optimization translates Vietnamese nuance and changes character intent | PARTIAL | source/derived prompt separation exists; semantic regression test needed |
| 298 | Tool adapter silently rewrites negative constraints into unsupported provider syntax | **GAP/P1** | compiled provider payload needs adapter conformance tests and unsupported-feature declaration |
| 299 | Model claims it followed a constraint but output evidence shows otherwise | CONTAINED | QC/evidence + human review |
| 300 | Context manifest itself is stale after canon revision changes between compile and dispatch | **GAP/P1** | dispatch must verify context dependency hash immediately before external execution |
| 301 | Retry reuses old compiled context after policy/rights update | **GAP/P1** | retry must revalidate/recompile policy-sensitive context |
| 302 | Long-running local model keeps old weights loaded after package revocation | **GAP/P1** | package revocation should drain/restart resident worker before new job |
| 303 | Local model process loads files from arbitrary model repo custom code | PARTIAL | package sandbox exists; “trust_remote_code” equivalent must default deny |
| 304 | Model output contains a fake JSON control object matching internal schema | CONTAINED only if output parser enforces provenance/trust channel |
| 305 | Connector normalizer trusts provider-declared MIME but bytes are executable/archive | **GAP/P1** | output type determined by probe/magic/sandbox, not provider label |
| 306 | Provider returns 200 OK with HTML login page saved as “video.mp4” | **GAP/P1** | materialization decode/probe catches if implemented |
| 307 | Downloaded model weights exceed declared size and fill disk | **GAP/P1** | package download has hard byte/storage reservation ceiling |
| 308 | CDN serves different model bytes for same version across regions | **GAP/P1 reproducibility** | package identity must be digest-pinned, not version-name pinned |
| 309 | One provider’s SDK auto-telemetry sends prompts despite network policy expectation | **GAP/P1 privacy** | SDK/runtime egress must be observed/blocked, not trust docs only |
| 310 | Browser connector screenshot sent to VLM includes password/PII fields | **GAP/P1** | browser observation redaction/privacy scope required |

# 22. Fifth-wave findings

## X59 — Logical content identity vs physical encrypted storage (P1)
Separate:
- logical plaintext content identity;
- physical ciphertext object identity;
- encryption/wrapping scope.

Do not require global convergent encryption for dedup.
Cross-project dedup is policy-controlled and must not create a confidentiality/crypto-erasure conflict.

## X60 — Envelope encryption (P1)
For CineForge-managed encryption, prefer per-object data keys wrapped by policy/root keys so routine key rotation can rewrap keys without rewriting huge media objects.

Store/verify:
- ciphertext digest/integrity;
- plaintext logical digest after successful decrypt;
- key/wrapping metadata.

## X61 — Resource reservation deadlock/admission policy (P1)
Multiple resource types require deterministic acquisition ordering or atomic admission planning.
Reservations are bounded by priority class, interactive reserve and future horizon.

HUMAN_WAIT releases resources not physically required to preserve session.

## X62 — Non-droppable context constraints (P0/P1)
Context segments have criticality:
- MANDATORY_POLICY
- MANDATORY_RIGHTS_PRIVACY
- MANDATORY_CANON
- TASK_CRITICAL
- OPTIONAL_ENRICHMENT

Compilation fails rather than dropping mandatory classes.

## X63 — Context dependency fence (P1)
Compiled context has dependency manifest/hash.
Immediately before dispatch/retry:
- revalidate dependencies/policies/rights;
- recompile if stale;
- bind provider payload hash to job attempt.

## X64 — Provider semantic-limit certification (P1)
Capability certification includes practical request limits/feature semantics, not only API schema.
Observed truncation/semantic drift degrades connector health and can force re-certification.

## X65 — Adapter semantic conformance (P1)
Provider adapters declare supported/approximated/unsupported semantic features.
Critical unsupported constraint cannot be silently approximated.

## X66 — Package/download byte ceilings and digest pinning (P1)
Model/runtime packages are downloaded under:
- expected maximum bytes;
- disk reservation;
- digest pin;
- publisher/signature policy.

Version string alone is not identity.

## X67 — Browser observation privacy (P1)
Screenshots/DOM/recordings sent to AI evaluators must pass redaction/privacy policy, especially login/MFA/account pages.


# 17. Third-wave: local split-brain, privacy, corruption and release attacks

| # | Attack | Verdict | Why |
|---|---|---|---|
| 221 | User launches CineForge twice; both Core processes believe they are the single writer | **GAP/P0/P1** | SQLite serializes writes but domain single-writer/event/outbox assumptions can still split |
| 222 | Old Core process hangs, new Core starts, old process later resumes | **GAP/P0/P1** | local Core needs instance fencing epoch, not only process mutex |
| 223 | Windows sleep pauses process beyond lease TTL, resumes with stale timers | **GAP/P1** | monotonic elapsed-time/reconciliation on resume needed |
| 224 | System clock jumps forward 2 hours and expires every job/session | PARTIAL | authoritative monotonic/server ordering exists conceptually; local timeout semantics need explicit clock source |
| 225 | SQLite page corruption affects one table but app still opens | **GAP/P0/P1** | periodic integrity_check/quick_check and corruption recovery mode required |
| 226 | Disk/SSD returns stale/corrupt read while hash metadata remains unchanged | PARTIAL | scrub/hash verification added conceptually; critical reads need verification policy |
| 227 | WAL/shm files survive crash but user copies only DB elsewhere manually | **GAP/P1 UX** | manual-copy warnings/exported portable backup needed |
| 228 | Another process/user modifies SQLite DB file directly | **GAP/P0/P1** | ACL + integrity audit help; Core instance ownership and tamper detection needed |
| 229 | PR base is retargeted from main after review | **GAP/P1** | merge gate must verify expected base ref/repo, not only SHAs |
| 230 | PR head repository changes/is forked/mirrored unexpectedly | **GAP/P0/P1** | Claim PR must verify canonical head repo + branch |
| 231 | PR is closed/reopened and old approvals/comments appear current | PARTIAL | exact-head/base tuple helps; PR generation/claim epoch should be revalidated |
| 232 | GitHub branch is deleted/recreated with same name and different history | **GAP/P1** | branch name alone cannot carry ownership; PR/head SHA + claim attempt marker identity must match |
| 233 | A trusted agent accidentally pastes API secret into PR/Issue/log | **GAP/P0/P1** | secret scanning/redaction needed before GitHub publication |
| 234 | CI log prints Authorization header on error | **GAP/P0** | log redaction + secret masking cannot rely only on agent discipline |
| 235 | Diagnostic bundle excludes raw media but contains full prompts/client names/paths | PARTIAL | redaction classes exist; privacy classification should cover prompt/path/project identity |
| 236 | Context Compiler sends entire confidential Film Bible to cloud tool that only needs one shot | **GAP/P0/P1 privacy** | data-minimization and egress classification need enforceable fields/budget |
| 237 | User marks project LOCAL_ONLY after some cloud jobs already queued | **GAP/P1** | privacy policy change must cancel/block undispatched and reconcile accepted jobs |
| 238 | A connector silently uploads extra telemetry/assets beyond declared request | **GAP/P0/P1** | sandbox/network egress allowlist + declared-data manifest needed |
| 239 | Local model/plugin with valid signature makes outbound network request | **GAP/P1** | package signature != behavioral permission; runtime network sandbox needed |
| 240 | Browser connector carries cookies from Project A into Project B | PARTIAL | profile scoping exists; project/privacy partition requirement should be explicit |
| 241 | Screenshot/OCR captures another app window containing secrets | **GAP/P1 privacy** | screen-capture capability needs explicit scoped user consent and minimization |
| 242 | Clipboard import reads more formats/data than user intended | **GAP/P1 privacy** | clipboard intake should consume explicitly selected/supported representation only |
| 243 | Voice recording accidentally captures background confidential conversation | **GAP/P2/P1 privacy** | recording UX needs live scope/consent and easy trim/delete before cloud upload |
| 244 | Agent sends unreleased media to web provider due AUTO routing after privacy classification bug | **GAP/P0** | privacy/egress gate must be fail-closed and independent from routing recommendation |
| 245 | Rights status UNKNOWN is accidentally treated as ALLOWED by a connector-specific adapter | **GAP/P0/P1** | central gate must be outside adapters; adapters cannot downgrade rights/privacy policy |
| 246 | Malicious connector reports lower cost to win router selection | **GAP/P1** | estimates are untrusted provider claims; benchmark/observed cost and policy trust needed |
| 247 | Connector reports capability it does not actually support, causing repeated destructive retries | PARTIAL | certification/health exists; semantic conformance tests should be required |
| 248 | Browser tool changes from “Generate” to “Delete” but DOM selector still matches | GAP already noted | semantic action confirmation/connector certification invalidation needed |
| 249 | Model output includes a valid-looking JSON tool call inside creative text | **GAP/P0 prompt/tool boundary** | tool invocation must come through typed model/tool channel, never parsed from plain output text |
| 250 | Agent reasoner follows instructions embedded in subtitles/image OCR despite typed context | PARTIAL | trust segments help; tool executor must enforce policy independent of model decision |
| 251 | Context Compiler truncates the segment containing “do not upload to cloud” | **GAP/P0** | critical privacy/rights constraints must be non-droppable and separately validated |
| 252 | Token-budget optimizer removes a character identity constraint but leaves prompt syntactically valid | **GAP/P1** | required constraint manifest/completeness check before dispatch |
| 253 | Two workers reserve same GPU because reservation DB write happens after dispatch | **GAP/P1** | reserve transaction must precede dispatch; worker validates fencing token |
| 254 | GPU process uses more VRAM than reserved and starves another critical job | **GAP/P1** | headroom + runtime enforcement/preemption/degraded mode required |
| 255 | Browser profile “exclusive” lease expires while generation page still active | **GAP/P1** | session lease renewal + stale-profile fencing similar to worker takeover |
| 256 | Provider returns valid media but metadata lies about duration/frame rate | CONTAINED if locally probed | local probe must remain authoritative technical metadata |
| 257 | Provider output has malicious embedded subtitle/attachment/metadata | **GAP/P1** | generated output requires same hostile-media sanitization as imports |
| 258 | Release master contains a hidden stream/attachment not visible in preview | **GAP/P1** | release probe must validate stream whitelist/container manifest |
| 259 | Master is correct but export destination already has same filename; overwrite wrong file | **GAP/P1 UX/data** | atomic destination policy + no silent overwrite + hash confirmation |
| 260 | Publish target account is correct provider but wrong channel/page | **GAP/P1** | publication destination identity must be pinned/previewed |
| 261 | “Takedown” succeeds locally but remote platform keeps serving cached copy | CONTAINED as compensatable | verification must distinguish requested vs externally verified |
| 262 | User rotates encryption/credential key while jobs hold old secret handles | **GAP/P1** | credential version pin + drain/renew semantics required |
| 263 | API key revoked mid-job; retry switches credential/account and duplicates charge | **GAP/P1** | job attempt pins credential binding; retry replan required |
| 264 | User has multiple identical provider accounts; reauth binds the wrong one | GAP overlaps workspace identity | must verify stable provider account identity |
| 265 | Database migration code is non-idempotent and app crashes halfway | PARTIAL | migration journal exists; each migration needs resume/rollback contract |
| 266 | Migration “success” passes but derived projection indexes are stale/incompatible | **GAP/P1** | migration completion must include projection rebuild/version readiness |
| 267 | Projection rebuild consumes disk until system enters pressure during update | **GAP/P1** | migration/update plan needs storage exposure reservation |
| 268 | Old app binary remains running during updater swap and writes old schema | **GAP/P0/P1** | update requires Core process fencing/drain |
| 269 | Update installs connector v2 while jobs are pinned to connector v1 whose files are deleted | **GAP/P1** | package version retention until no pinned active/history reconstruction dependency |
| 270 | GC removes old connector/model needed to inspect provenance/audit | **GAP/P2/P1** | executable may be removable, but descriptor/license/manifest evidence must remain archived |

# 18. Third-wave findings

## X39 — Local Core single-writer fencing (P0/P1)
Use a user/session-scoped OS mutex **and** persistent Core instance epoch/fencing.
Only the current Core epoch may execute canonical writes/outbox dispatch.
A zombie/stale Core that resumes must fail the epoch check and stop mutating.

## X40 — Clock/sleep semantics (P1)
Use monotonic clocks for local elapsed timeout/lease duration where available.
On sleep/resume, Core performs a reconciliation pass before assuming timers/jobs/sessions are valid.
Wall clock remains display/evidence time, not sole ordering/fencing authority.

## X41 — SQLite corruption detection/recovery (P0/P1)
Run appropriate `quick_check/integrity_check` policy:
- startup after unclean shutdown;
- scheduled/background cadence;
- before/after critical restore/migration when practical.
Corruption triggers SAFE_MODE and recovery from verified backup/object evidence; never “repair by deleting rows” automatically.

## X42 — Claim PR identity includes canonical repo/base/head (P1)
Merge gate verifies:
- base repo == canonical repo;
- base ref == expected main/release branch;
- head repo == canonical repo for autonomous Claim PR;
- head branch matches claim key/replacement branch;
- current HEAD matches reviewed tuple.

Retarget/recreate anomalies invalidate the claim/review.

## X43 — Secret/DLP publication guard (P0/P1)
Before agent writes GitHub Issue/PR/comment/log/artifact:
- redact known secret classes;
- block obvious credentials/private keys/tokens;
- keep diagnostic/media/customer-sensitive content out by default.
CI has secret scanning as defense in depth.

## X44 — Data egress manifest / minimization (P0/P1)
Every external/cloud/browser job has a machine egress manifest:
- exact asset revisions/segments;
- text/context classes;
- provider/region/account;
- privacy classification;
- retention/terms snapshot.
Central policy gate validates it before connector sees data.

## X45 — Privacy/rights fail-closed outside adapters (P0)
Routing proposes; a central independent authorization gate permits/denies.
Connector implementations cannot reinterpret UNKNOWN as ALLOWED or bypass LOCAL_ONLY.

## X46 — Runtime network sandbox (P1)
Local model/plugin/tool network access is denied by default unless capability manifest explicitly requires and policy permits destinations.
Signed code is not automatically trusted to exfiltrate data.

## X47 — Non-droppable constraint manifest (P0/P1)
Context compilation separates mandatory constraints from compressible context.
Before dispatch verify all required:
- privacy;
- rights;
- character/canon;
- safety;
- output contract
constraints are present or explicitly represented in structured provider fields.

## X48 — Typed model tool channel only (P0)
Plain model text/JSON-looking prose never invokes a tool.
Only an authenticated/typed tool-call channel accepted by the orchestrator may request actions, and policy revalidates every call.

## X49 — Generated outputs re-enter hostile-media pipeline (P1)
Provider/model-generated files are untrusted inputs too:
probe/sanitize/quarantine before use, including attachments/subtitle streams/metadata.

## X50 — Credential version pinning (P1)
JobAttempt pins connection + credential binding version/account identity.
If credential changes/revokes, retry is a new planned attempt; do not silently continue under another account.

## X51 — Migration completion contract (P1)
Migration is complete only when:
- schema step complete;
- data backfill complete;
- projections/indexes at target version;
- compatibility health check green;
- storage budget remains safe.
Each migration defines idempotent resume semantics.

## X52 — Package retention/drain (P1)
Package update/removal cannot delete a pinned version while an active job/session needs it.
Archive lightweight descriptor/manifest/license/signature provenance even after executable bytes are removed.

## X53 — Publication destination identity (P1)
Publish plan pins provider account + channel/page/workspace identity and shows it at final irreversible confirmation.

## X54 — Release stream whitelist (P1)
Release validation enumerates allowed streams/tracks/attachments/metadata and rejects unexpected hidden streams or embedded content.
