# CineForge OS — Compound Chaos Test Plan

> Status: executable test specification, not execution evidence. These cases are the minimum high-risk catalog promoted from Issue #1 / Draft PR #2. A case is `SPECIFIED` until a controlled harness records the required evidence; prose in an architecture document never promotes a case to `PASSED`.

## Execution contract

Each case must run against an isolated disposable project/control-plane fixture and record:

- the exact source/build and control-contract revisions;
- injected fault, timing, actor, lease, recovery epoch and resource limits;
- invariant assertions and rejected side effects;
- durable event/audit evidence, including unknown outcomes;
- user-visible state and recovery action;
- cleanup result and whether the fixture was quarantined.

`UNKNOWN` is an observable result, never an implicit pass. A failed assertion freezes the affected scope and creates a linked finding keyed by canonical `CFRT-*` identity.

## Required scenarios

### CT-01 — Concurrent task claim

- **Preconditions:** One trusted Issue, one attempt number, two isolated worker runtimes and no existing winning claim intent.
- **Fault injection:** Append two valid `CLAIM_INTENT_V1` events concurrently and race branch/marker/PR creation, including one delayed GitHub response.
- **Expected invariant:** Exactly one lowest valid trusted intent owns the deterministic branch; the loser performs no substantive write.
- **Expected state:** One active claim; the other is `SUPERSEDED_CONFLICT` or `CLAIM_ASSOCIATION_UNKNOWN` until reconciled.
- **User-visible behavior:** The task shows one owner and a clear waiting/superseded explanation.
- **Forbidden behavior:** Two active Draft PR leases, two writers, guessed attempt reuse, or timeout treated as failure.
- **Evidence required:** Direct Issue/PR/ref reads, comment IDs, claim marker, contract hash, and complete intent ordering.
- **Cleanup/recovery:** Reconcile the winner, quarantine loser artifacts, and release the slot without deleting audit evidence.

### CT-02 — Scheduled slot overlap

- **Preconditions:** One slot/epoch and two scheduled invocations with the same `SLOT_ID`.
- **Fault injection:** Delay the first lease checkpoint so the second invocation attempts `SLOT_LEASE_V1 ACQUIRE` during active mutation.
- **Expected invariant:** Earliest valid lease wins; the loser does no mutating work.
- **Expected state:** One `ACTIVE` lease and one `SUPERSEDED_CONFLICT` event.
- **User-visible behavior:** No duplicate implementation is created; the run is reported as safely skipped or redirected.
- **Forbidden behavior:** Parallel writes under one slot or a new identity minted to bypass the lease.
- **Evidence required:** Capacity-plan epoch, lease event IDs, timestamps, and PR diff showing no loser mutation.
- **Cleanup/recovery:** Append release/renewal for the winner and close the losing run as a no-op.

### CT-03 — Stale owner wakes after takeover

- **Preconditions:** Original owner is fenced and a replacement branch/PR is active.
- **Fault injection:** Wake the old runtime and let it attempt a push, comment, and control mutation after fencing.
- **Expected invariant:** The old writer cannot contaminate the replacement branch or active PR.
- **Expected state:** Old attempt is `FENCED`/`ABANDONED`; replacement remains the only merge path.
- **User-visible behavior:** Work remains available through the replacement owner with no silent loss.
- **Forbidden behavior:** Late commits merged, ownership silently switched, or branch force-pushed.
- **Evidence required:** Branch refs, replacement PR identity, rejected operation receipts, and takeover authorization.
- **Cleanup/recovery:** Preserve the old branch read-only and reconcile any harmless duplicate comments by event ID.

### CT-04 — Planner/Flow/Integrator failover

- **Preconditions:** Active role leases with a known control epoch and a small ready queue.
- **Fault injection:** Kill each role between lease acquisition and checkpoint, then race two eligible failover contenders.
- **Expected invariant:** One valid lease per role/epoch; failover never reopens an old epoch.
- **Expected state:** `EPOCH_DRAINING` or `TAKEOVER` followed by one active role lease.
- **User-visible behavior:** Queue and merge status remain understandable and tasks are not duplicated.
- **Forbidden behavior:** Split-brain planners, conflicting merge decisions, or stale-epoch mutations.
- **Evidence required:** Lease chain, epoch pointer, role event hashes, and reconciled queue snapshot.
- **Cleanup/recovery:** Complete takeover, release the failed lease, and record the new control checkpoint.

### CT-05 — Two merge-ready PRs race

- **Preconditions:** Two independently reviewed PRs are merge-ready against the same base and no Merge Queue is active.
- **Fault injection:** Start two Integrator processes and delay one merge response after the other advances `main`.
- **Expected invariant:** Manual merge serialization admits one operation at a time and revalidates the verification tuple.
- **Expected state:** One merged; the other becomes stale-base/needs-revalidation.
- **User-visible behavior:** The second PR clearly asks for rebase/recheck rather than claiming success.
- **Forbidden behavior:** Concurrent merges, stale-head merge, or dependent work unblocked on an unknown result.
- **Evidence required:** `MERGE_LEASE`, operation ID, pre/post main SHA, base/merge-base, and check producer tuple.
- **Cleanup/recovery:** Reconcile the delayed response, refresh the second PR, and release the merge lease.

### CT-06 — GitHub mutation succeeds but response is lost

- **Preconditions:** A stable operation ID is ready for a branch, comment, label, or PR mutation.
- **Fault injection:** Commit the server-side mutation, drop the client response, and return a timeout.
- **Expected invariant:** Client enters `UNKNOWN_OUTCOME`, performs direct reconciliation, and retries only after absence is proven.
- **Expected state:** `CONFIRMED_SUCCESS`, `CONFIRMED_FAILURE`, or `UNKNOWN_OUTCOME` with no dependent mutation while unknown.
- **User-visible behavior:** The UI says reconciliation is in progress instead of claiming failure or success.
- **Forbidden behavior:** Duplicate comments/branches/merges or destructive retry based on timeout alone.
- **Evidence required:** Operation ID, direct server object, idempotency record, and reconciliation decision.
- **Cleanup/recovery:** Mark one logical event, archive duplicates as evidence, and resume only after confirmation.

### CT-07 — Forged public Issue/review/control event

- **Preconditions:** A public repository with a valid trusted control actor and an untrusted actor account.
- **Fault injection:** Submit an Issue/comment/review that mimics `AGENT_STATE`, `TASK_CONTRACT`, or approval syntax.
- **Expected invariant:** Untrusted content is data/inbox evidence and cannot alter task, lease, review, or merge state.
- **Expected state:** Event is `UNTRUSTED`/`REJECTED` or awaiting trusted adoption.
- **User-visible behavior:** No task is scheduled from the forged event; the audit explains why.
- **Forbidden behavior:** Credential disclosure, privileged execution, auto-approval, or branch creation.
- **Evidence required:** Author identity, trust-policy revision, parser result, and no-op control-plane diff.
- **Cleanup/recovery:** Keep the report for triage and require a new trusted Task contract for adoption.

### CT-08 — CI check-name spoof from wrong producer

- **Preconditions:** A required semantic check manifest names a producer App/workflow and exact base/head context.
- **Fault injection:** Publish a successful check with the required display name from an unauthorized workflow or wrong SHA.
- **Expected invariant:** Producer, workflow path/revision, run, runner trust class and verification tuple all match.
- **Expected state:** `GOVERNANCE_ANOMALY`/`BLOCKED`.
- **User-visible behavior:** Merge readiness remains blocked with a concrete provenance reason.
- **Forbidden behavior:** Treating a display-name match as proof or bypassing the required check.
- **Evidence required:** Check-run ID, producer identity, workflow path/revision, head/base/merge SHA and manifest comparison.
- **Cleanup/recovery:** Quarantine the spoofed result, rerun the trusted check, and retain the incident record.

### CT-09 — Governance PR changes its own verifier

- **Preconditions:** A PR modifies governance or CI verifier semantics and the prior verifier is still authoritative.
- **Fault injection:** Alter the workflow/check in the PR so the changed PR reports itself green.
- **Expected invariant:** Bootstrap/two-phase governance verification uses an independent prior/external verifier and does not self-approve.
- **Expected state:** `ASSURANCE_UNAVAILABLE` or `BLOCKED` until independent evidence exists.
- **User-visible behavior:** The PR explains the missing assurance and remains Draft/blocked.
- **Forbidden behavior:** Removing the sole required check, weakening assertions, or accepting the modified verifier as evidence.
- **Evidence required:** Before/after workflow digest, producer identity, external/independent review and negative test result.
- **Cleanup/recovery:** Restore the prior verifier path, prove the new one alongside it, then complete the migration.

### CT-10 — Restore backup plus late provider callback

- **Preconditions:** A backup is restored while an external job was in flight before restore.
- **Fault injection:** Deliver the pre-restore callback after a new recovery epoch is active.
- **Expected invariant:** Recovery epoch and job identity fence late callbacks; no stale result becomes canonical.
- **Expected state:** `RECOVERY_RECONCILIATION` with callback `IGNORED`, `COMPENSATE`, or `NEEDS_HUMAN`.
- **User-visible behavior:** The job is shown as reconciled/unknown with a next step, never silently completed.
- **Forbidden behavior:** Duplicate charge, stale asset promotion, or callback-driven write into restored state.
- **Evidence required:** Recovery epoch, callback signature, job attempt, external receipt and reconciliation decision.
- **Cleanup/recovery:** Reconcile provider reality, preserve the callback receipt, and activate only after the recovery barrier.

### CT-11 — Restore plus restored old outbox

- **Preconditions:** Backup contains pending outbox entries and a forward policy/revocation journal exists.
- **Fault injection:** Restore, replay the old outbox, and concurrently apply a post-backup deletion/revocation event.
- **Expected invariant:** No pre-revocation operation is dispatched after the forward journal wins.
- **Expected state:** Outbox entries become `BLOCKED_BY_NEW_POLICY`, `SUPERSEDED`, or `NEEDS_RECONCILIATION`.
- **User-visible behavior:** The user sees the blocked action and exact reason; no silent resend occurs.
- **Forbidden behavior:** Replaying old authorization, publishing deleted content, or losing the journal.
- **Evidence required:** Backup sequence, recovery epoch, journal order, outbox fence and dispatch ledger.
- **Cleanup/recovery:** Complete journal replay, reconcile external state, and retain blocked records for audit.

### CT-12 — WAL checkpoint starvation plus disk pressure

- **Preconditions:** SQLite WAL mode, long reader, bounded free-space threshold and checkpoint policy.
- **Fault injection:** Hold a long read while writes fill WAL and free space crosses the stop threshold.
- **Expected invariant:** Stop-the-line storage policy prevents corruption and uncontrolled growth; writes fail safely or drain.
- **Expected state:** `READ_ONLY_SAFE`/`STORAGE_PRESSURE` with resumable checkpoint state.
- **User-visible behavior:** Clear storage-pressure guidance; no fake progress or lost committed work.
- **Forbidden behavior:** Delete originals/approved canon, continue unbounded writes, or report a successful checkpoint without evidence.
- **Evidence required:** WAL/frame counts, free-space samples, SQLite integrity result and admission decision.
- **Cleanup/recovery:** End/limit the reader, checkpoint safely, reclaim only graph-approved rebuildable data, and verify integrity.

### CT-13 — Long read/import/updater disk contention

- **Preconditions:** Import, long read and updater each have declared temporary-space reservations.
- **Fault injection:** Start all three near the disk-pressure boundary and vary completion order.
- **Expected invariant:** Admission control honors priority/reservations and prevents aggregate overcommit.
- **Expected state:** One or more operations are queued/paused with explicit `RESOURCE_BLOCKED` state.
- **User-visible behavior:** Each action reports who is waiting and how to recover.
- **Forbidden behavior:** Partial update activation, temp collisions, or eviction of protected assets.
- **Evidence required:** Reservation ledger, temp namespaces, pressure timeline and completion/rollback proof.
- **Cleanup/recovery:** Release reservations transactionally and resume only after a fresh capacity check.

### CT-14 — Second Core/zombie writer

- **Preconditions:** One Core owns the library with an OS-level exclusive primitive and fencing token.
- **Fault injection:** Start a second process and resume a suspended first process after ownership changes.
- **Expected invariant:** Exactly one writer epoch is active; stale writes are rejected at the database and IPC boundary.
- **Expected state:** Second process `CLIENT_OR_BLOCKED`; old process `FENCED`.
- **User-visible behavior:** The second window offers read/connect guidance and never enters a retry storm.
- **Forbidden behavior:** Dual writes, silent last-writer-wins, or mutable archive access.
- **Evidence required:** OS lock, ownership row/version, session epoch, rejected write and audit event.
- **Cleanup/recovery:** Terminate/quarantine the zombie and recheck database integrity before enabling writes.

### CT-15 — SQLite corruption and salvage

- **Preconditions:** Disposable database with verified backup and integrity-check policy.
- **Fault injection:** Corrupt pages/WAL metadata at crash points, then restart.
- **Expected invariant:** Corruption is detected; recovery never guesses or presents unverified state as canonical.
- **Expected state:** `CORRUPT_DETECTED`, `READ_ONLY_SAFE`, or `RECOVERY_REQUIRED`.
- **User-visible behavior:** The app explains restore/salvage choices and preserves originals.
- **Forbidden behavior:** Silent truncation, destructive auto-repair, or claiming success from file existence.
- **Evidence required:** `PRAGMA integrity_check`/backup verification, page/WAL diagnostics and recovery manifest.
- **Cleanup/recovery:** Restore a verified snapshot, replay safe journals, quarantine the damaged file, and rerun checks.

### CT-16 — Migration failure plus binary rollback

- **Preconditions:** Versioned application binary, forward migration, rollback package and compatibility matrix.
- **Fault injection:** Fail migration midway, power off, then boot the previous binary.
- **Expected invariant:** Activation and schema transitions are atomic/compatible; rollback cannot interpret an incomplete schema as valid.
- **Expected state:** `MIGRATION_RECOVERY_REQUIRED` or a verified previous schema/binary pair.
- **User-visible behavior:** Upgrade is paused with recovery steps and data-preservation status.
- **Forbidden behavior:** Mixed-version writes, irreversible migration without backup, or silent downgrade.
- **Evidence required:** Migration journal, schema fingerprint, binary compatibility result and activation marker.
- **Cleanup/recovery:** Resume/roll forward from the journal or restore the compatible pair; never delete the failed evidence.

### CT-17 — Malicious document/XML/SVG/archive/media import

- **Preconditions:** Import runs in a sandbox with parser, decompression, pixel, recursion and time budgets.
- **Fault injection:** Feed zip bombs, XXE, SVG scripts, hostile fonts/PDFs/subtitles and malformed media.
- **Expected invariant:** Inputs remain untrusted; budgets and network/file policy contain the parser.
- **Expected state:** `QUARANTINED`, `REJECTED`, or bounded `NEEDS_REVIEW`.
- **User-visible behavior:** The import identifies the rejected class and safe retry path.
- **Forbidden behavior:** Host execution, network fetch, path escape, or partial trusted registration.
- **Evidence required:** Sandbox profile, parser limits, syscall/network trace, digest and quarantine receipt.
- **Cleanup/recovery:** Tear down the sandbox and temp tree, retain a redacted diagnostic, and rescan only after policy approval.

### CT-18 — SSRF, DNS rebinding and UNC path attack

- **Preconditions:** URL intake has scheme/host/IP/redirect policy and Windows canonical-path checks.
- **Fault injection:** Redirect public URL to loopback/link-local/private IP, change DNS between checks, and supply UNC/device paths.
- **Expected invariant:** Destination is revalidated at connect/open time and disallowed routes never receive credentials or bytes.
- **Expected state:** `POLICY_BLOCKED` with a reason code.
- **User-visible behavior:** User sees a safe network/path explanation and can choose an approved local file.
- **Forbidden behavior:** Credential leakage, internal metadata access, DNS-rebind bypass, or path traversal.
- **Evidence required:** Resolution timeline, final socket/handle identity, redirect chain and policy decision.
- **Cleanup/recovery:** Close sockets/handles, delete quarantined temp data and require a fresh approved URL/path.

### CT-19 — WebView XSS/native bridge attempt

- **Preconditions:** WebView uses isolated origin, allowlisted navigation and authenticated user-scoped IPC tokens.
- **Fault injection:** Inject script/navigation that calls privileged bridge methods, replays a token and opens a hostile origin.
- **Expected invariant:** Untrusted page content cannot invoke privileged native operations or cross project scope.
- **Expected state:** `BRIDGE_DENIED`/`ORIGIN_QUARANTINED`; session may require reauthentication.
- **User-visible behavior:** A concise security error and recovery action are shown; work remains safe.
- **Forbidden behavior:** Shell/file/credential access, silent origin upgrade, or token reuse.
- **Evidence required:** Origin, token scope/epoch, bridge decision, CSP/navigation log and no side-effect receipt.
- **Cleanup/recovery:** Destroy the WebView/session, rotate scoped tokens and clear hostile storage.

### CT-20 — Prompt injection from screenplay/document

- **Preconditions:** Context Compiler separates trusted instructions from imported/generated data and uses typed model tools.
- **Fault injection:** Embed instructions in screenplay text, PDF metadata, subtitle or generated media asking for secrets or mutations.
- **Expected invariant:** Data cannot become control authority; model may quote/classify it but cannot execute arbitrary actions.
- **Expected state:** `UNTRUSTED_CONTENT`/`NEEDS_REVIEW`, with command plan unchanged.
- **User-visible behavior:** The user sees the content as data and any proposed action as a reviewable command.
- **Forbidden behavior:** Shell execution, credential disclosure, rights bypass or direct database mutation.
- **Evidence required:** Context segment trust labels, compiler output, typed tool-call schema and blocked action receipt.
- **Cleanup/recovery:** Remove tainted context from the candidate prompt, preserve source provenance and rerun safely.

### CT-21 — Forged provider callback

- **Preconditions:** Provider callback endpoint requires signature, timestamp/replay fence and connection identity.
- **Fault injection:** Send forged, replayed, cross-account and malformed callbacks with valid-looking payloads.
- **Expected invariant:** Only authenticated, scoped, fresh callbacks can advance the matching attempt.
- **Expected state:** `REJECTED`, `REPLAYED`, or `STALE_CALLBACK`; canonical state unchanged.
- **User-visible behavior:** Job remains pending/unknown with a recoverable explanation.
- **Forbidden behavior:** Fake completion, cross-project asset registration, or duplicate charge.
- **Evidence required:** Signature result, callback digest, attempt/connection scope and idempotency record.
- **Cleanup/recovery:** Quarantine the callback, reconcile provider state through the trusted channel and rotate compromised credentials if needed.

### CT-22 — Expired provider artifact URL

- **Preconditions:** Provider result references a signed/expiring artifact URL and immutable materialization receipt.
- **Fault injection:** Expire the URL, return a different digest, or make the URL redirect to another object.
- **Expected invariant:** Artifact is not READY until bytes, digest, size and provenance are verified.
- **Expected state:** `MATERIALIZATION_FAILED`/`EXPIRED_EXTERNAL_ARTIFACT`.
- **User-visible behavior:** User is told the provider result needs retry/reconciliation, not that a valid asset exists.
- **Forbidden behavior:** Trusting filename/URL, partial registration or silent provider substitution.
- **Evidence required:** URL expiry, response headers, byte digest, manifest and provider receipt.
- **Cleanup/recovery:** Remove unverified bytes and request a fresh provider artifact under the same attempt fence.

### CT-23 — Browser account/workspace drift

- **Preconditions:** Browser connector pins account/workspace identity and observes the starting page/session.
- **Fault injection:** Change account/workspace in another tab or expire the session during a queued action.
- **Expected invariant:** Action is paused/revalidated; it cannot affect a different account or workspace.
- **Expected state:** `ACCOUNT_SCOPE_CHANGED`/`AUTH_REQUIRED`.
- **User-visible behavior:** User is asked to confirm the account/workspace before retry.
- **Forbidden behavior:** Uploading/publishing to the wrong destination or replaying the action automatically.
- **Evidence required:** Initial/current identity, browser profile/session epoch, action plan and blocked receipt.
- **Cleanup/recovery:** Drain the profile, revoke stale action tokens and re-plan against the confirmed destination.

### CT-24 — Browser site semantic change

- **Preconditions:** Connector has a semantic action contract, site fingerprint and safe observation mode.
- **Fault injection:** Change DOM labels/layout/meaning while retaining superficially similar selectors.
- **Expected invariant:** Semantic mismatch blocks the action and never falls back to coordinate/guess-based mutation.
- **Expected state:** `SITE_SEMANTICS_CHANGED`/`NEEDS_HUMAN`.
- **User-visible behavior:** User sees a review/takeover request with the observed change.
- **Forbidden behavior:** Wrong-button click, publication, deletion or credential submission.
- **Evidence required:** Before/after observation, site fingerprint, intended effect and blocked action plan.
- **Cleanup/recovery:** Quarantine the connector revision and require certification or human-assisted completion.

### CT-25 — GPU/resource double reservation

- **Preconditions:** Resource broker tracks GPU/VRAM/CPU/storage reservations transactionally across workers.
- **Fault injection:** Race two reservations and crash one worker after admission but before release.
- **Expected invariant:** Capacity is never oversubscribed; orphaned reservations expire/reconcile safely.
- **Expected state:** One admitted job, one queued/rejected, and an explicit orphan-recovery state if needed.
- **User-visible behavior:** Accurate queue/blocked reason and no unexplained OOM.
- **Forbidden behavior:** Double allocation, silent quality downgrade, or infinite retry storm.
- **Evidence required:** Reservation transaction IDs, capacity snapshots, worker heartbeat and release/expiry proof.
- **Cleanup/recovery:** Reconcile orphan reservations, release only proven leases and rerun admission.

### CT-26 — Worker crash loop

- **Preconditions:** Worker restart budget, backoff and poison-job quarantine are configured.
- **Fault injection:** Crash the worker at deterministic checkpoints for the same job until the restart budget is exhausted.
- **Expected invariant:** Retry/backoff is bounded and the job becomes actionable rather than consuming all capacity.
- **Expected state:** `POISONED`/`QUARANTINED`/`NEEDS_HUMAN` with durable crash evidence.
- **User-visible behavior:** User gets a useful failure explanation and retry/diagnostic option.
- **Forbidden behavior:** Tight crash loop, duplicate external side effects or false completion.
- **Evidence required:** Attempt history, backoff, crash artifact class, idempotency key and resource usage.
- **Cleanup/recovery:** Quarantine the job/runtime, collect redacted diagnostics and allow a fresh certified retry only.

### CT-27 — Wrong character reference causes huge fanout

- **Preconditions:** Character identity, revision pins, fanout estimate and batch cost/storage guards exist.
- **Fault injection:** Substitute a similarly named/wrong revision in a multi-shot generation request.
- **Expected invariant:** Identity/revision mismatch is detected before dispatch; fanout remains bounded and reversible.
- **Expected state:** `PLAN_BLOCKED`/`NEEDS_CONFIRMATION` with impact analysis.
- **User-visible behavior:** User sees affected shots, cost/storage estimate and correction action.
- **Forbidden behavior:** Silent mass generation, mutation of approved shots or unbounded spend.
- **Evidence required:** Pinned revision IDs, dependency graph, impact snapshot and dispatch-batch fence.
- **Cleanup/recovery:** Cancel unstarted work, compensate any external jobs, and restore the prior plan.

### CT-28 — Manual human edit versus late AI result

- **Preconditions:** Manual control lock and candidate-result revision fence are active.
- **Fault injection:** User edits/approves an entity while a stale AI result arrives after the edit.
- **Expected invariant:** Human lock/current revision wins; late result remains a candidate and never auto-promotes.
- **Expected state:** `MANUAL_LOCKED` plus `STALE_CANDIDATE`/`REJECTED`.
- **User-visible behavior:** User keeps their edit and can inspect the late result separately.
- **Forbidden behavior:** Overwrite, hidden merge or approval-state downgrade.
- **Evidence required:** Lock owner/epoch, candidate revision, arrival order and rejected promotion record.
- **Cleanup/recovery:** Retain candidate lineage, release lock only explicitly and recalculate dependent work.

### CT-29 — Rights revocation after cache/index generation

- **Preconditions:** Derived cache/index entries carry authorization scope and rights/privacy generation.
- **Fault injection:** Revoke rights after generation but before read, export or training use.
- **Expected invariant:** Read-path and use-time fences invalidate or block stale derivatives.
- **Expected state:** `STALE`/`PURGE_PENDING`/`BLOCKED_BY_POLICY`.
- **User-visible behavior:** User sees the rights change and available purge/review action.
- **Forbidden behavior:** Serving, exporting or training on revoked data from cache/index.
- **Evidence required:** Rights generation transition, cache key/scope, invalidation receipt and access decision.
- **Cleanup/recovery:** Purge/quarantine affected derivatives, preserve required rights evidence and rebuild only if allowed.

### CT-30 — Deletion plus backup restore

- **Preconditions:** Deletion/tombstone journal, backup and retention/legal-hold policy are configured.
- **Fault injection:** Delete/purge an asset, then restore a backup captured before deletion.
- **Expected invariant:** Forward deletion/tombstone and rights obligations dominate restored stale rows/bytes.
- **Expected state:** `RESTORE_RECONCILIATION` with targets `PURGE_PENDING`/`TOMBSTONED`.
- **User-visible behavior:** UI separates local deletion, retained evidence and any external exposure.
- **Forbidden behavior:** Resurrecting deleted content, erasing legal evidence or claiming global erasure without proof.
- **Evidence required:** Backup ID, deletion event sequence, retention classification and purge barrier.
- **Cleanup/recovery:** Replay forward journal, scrub derived stores and record residual external reality.

### CT-31 — Package/signing key revocation

- **Preconditions:** Signed package/update, trust-root rotation policy and revocation source are available.
- **Fault injection:** Revoke the signing key between verification and activation, including offline stale revocation data.
- **Expected invariant:** Activation/signing blocks under the configured freshness policy; no anti-rollback bypass.
- **Expected state:** `REVOKED`, `UNKNOWN_REVOCATION_FRESHNESS`, or `POLICY_BLOCKED`.
- **User-visible behavior:** User sees signature versus revocation freshness separately.
- **Forbidden behavior:** Silent unsigned fallback, downgrade or activation of a revoked package.
- **Evidence required:** Manifest digest, key generation, revocation proof/freshness and activation decision.
- **Cleanup/recovery:** Keep prior known-good binary, rotate trust metadata and retry only after policy permits.

### CT-32 — CI artifact poisoning

- **Preconditions:** Build attestation, artifact digest, SBOM and producer/runner provenance are required.
- **Fault injection:** Replace an artifact/cache object after a green build or attach it under a reused display name.
- **Expected invariant:** Consumer rejects a digest/provenance mismatch and never signs/promotes the poisoned bytes.
- **Expected state:** `ARTIFACT_QUARANTINED`/`PROVENANCE_MISMATCH`.
- **User-visible behavior:** Release remains blocked with the exact chain-of-custody failure.
- **Forbidden behavior:** Trusting filename/cache, signing the wrong bytes or deleting evidence.
- **Evidence required:** Build/run/job/matrix identity, digest, attestation, cache source and consumer verification.
- **Cleanup/recovery:** Quarantine the artifact/cache, rerun from a clean trusted source and rotate affected credentials if necessary.

### CT-33 — Dirty or stale release workspace

- **Preconditions:** Release checkout/source-tree gate verifies exact commit/tree, generated files, submodules/LFS and clean state.
- **Fault injection:** Add untracked files, mutate generated output, use stale checkout or case-fold collision before release.
- **Expected invariant:** Release fails closed until the source closure is clean and exact.
- **Expected state:** `SOURCE_CLOSURE_INCOMPLETE`/`RELEASE_BLOCKED`.
- **User-visible behavior:** Operator gets a remediation list, not a misleading release success.
- **Forbidden behavior:** Packaging local residue, undeclared alternate objects or stale configuration.
- **Evidence required:** Commit/tree digest, status, manifests, generated diff and collision scan.
- **Cleanup/recovery:** Discard/quarantine only the disposable workspace, recreate from the exact source and reverify.

### CT-34 — Wrong artifact handed to signer

- **Preconditions:** Signing request binds immutable release manifest and artifact digest.
- **Fault injection:** Present a different file with the expected filename or reorder signing inputs after approval.
- **Expected invariant:** Signer rejects any digest/manifest/producer mismatch and records the request identity.
- **Expected state:** `SIGNING_BLOCKED`/`DIGEST_MISMATCH`.
- **User-visible behavior:** Release owner sees the exact artifact mismatch and no publication occurs.
- **Forbidden behavior:** Filename-based signing, “latest successful” selection or post-sign mutation.
- **Evidence required:** Request digest, manifest hash, final-byte hash, signer authorization and response.
- **Cleanup/recovery:** Rebuild/re-attest the intended artifact, invalidate the bad request and retain the rejected bytes quarantined.

### CT-35 — Windows case-fold/Unicode source collision

- **Preconditions:** Supported target filesystem collision and normalization scan is enabled.
- **Fault injection:** Supply paths differing only by case, normalization form, reserved device name or trailing-dot semantics.
- **Expected invariant:** Source/package/build identity remains unambiguous and release fails before materialization.
- **Expected state:** `SOURCE_COLLISION`/`IMPORT_REJECTED`.
- **User-visible behavior:** User sees conflicting paths and a safe rename/remediation path.
- **Forbidden behavior:** Silent overwrite, wrong-file build or authorization bypass through path aliases.
- **Evidence required:** Canonical path map, Unicode normalization/case-fold result and rejected manifest.
- **Cleanup/recovery:** Quarantine conflicting entries and rerun from a canonicalized clean tree.

### CT-36 — Toolchain/PATH shadowing

- **Preconditions:** Managed toolchain identity, registry/mirror allowlist and environment fingerprint are recorded.
- **Fault injection:** Prepend a malicious executable or change PATH/registry/tool mirror during a build.
- **Expected invariant:** Unexpected executable/toolchain identity blocks the build and invalidates provenance.
- **Expected state:** `TOOLCHAIN_MISMATCH`/`BUILD_BLOCKED`.
- **User-visible behavior:** Build owner receives the mismatched binary/path evidence.
- **Forbidden behavior:** Ambient developer tool use, unsigned download or silently different output.
- **Evidence required:** Resolved executable path/hash, environment fingerprint, registry and lockfile evidence.
- **Cleanup/recovery:** Restore managed environment, invalidate contaminated outputs and rebuild hermetically.

### CT-37 — Dependency registry confusion/typosquat

- **Preconditions:** Dependency lock, source registry policy, integrity hashes and postinstall classification are enforced.
- **Fault injection:** Redirect a package name to a look-alike registry/package or inject a postinstall executable.
- **Expected invariant:** Resolver rejects source/registry/integrity drift and release cannot consume the package.
- **Expected state:** `DEPENDENCY_BLOCKED`/`SUPPLY_CHAIN_INCIDENT`.
- **User-visible behavior:** The build explains the dependency mismatch and remediation.
- **Forbidden behavior:** Fallback to an untrusted registry, silent lock rewrite or execution of unreviewed install hooks.
- **Evidence required:** Registry URL, package metadata, lock diff, digest/SBOM and install-script result.
- **Cleanup/recovery:** Quarantine package/cache, rotate credentials if exposed and regenerate from the approved lock.

### CT-38 — Offline actor reconnects after access revocation

- **Preconditions:** Offline branch, authority/membership epoch and current Core authorization checks exist.
- **Fault injection:** Revoke actor/project access while offline, then reconnect with queued edits and an irreversible command.
- **Expected invariant:** Stale branch is preserved for inspection/export but cannot mutate canonical state or perform irreversible work.
- **Expected state:** `AUTHORITY_REVOKED`/`IMPORT_AS_BRANCH_REQUIRED`.
- **User-visible behavior:** User keeps local work and gets clear options to request access, export or discard.
- **Forbidden behavior:** Replay under old authority, silent data loss or auto-merge.
- **Evidence required:** Old/current authority generations, branch base, queued command class and rejection reason.
- **Cleanup/recovery:** Seal the branch, purge only policy-allowed secrets/derivatives and require fresh authorization for merge.

### CT-39 — Publication unknown outcome

- **Preconditions:** Publication action has destination identity, idempotency key, external receipt ledger and postcondition verifier.
- **Fault injection:** Send the publish request, let the platform accept it, then drop the response or make verification temporarily unavailable.
- **Expected invariant:** Local state is `UNKNOWN_EXTERNAL_OUTCOME`; no duplicate publish/takedown is issued without reconciliation.
- **Expected state:** `PUBLISHING` → `UNKNOWN`/`DELIVERED`/`COMPENSATION_REQUIRED` after proof.
- **User-visible behavior:** User sees “result đang được xác minh” with a retry/reconcile action.
- **Forbidden behavior:** Claiming failure and publishing twice, or claiming success without destination evidence.
- **Evidence required:** Destination identity, request ID, external lookup/postcondition and compensation ledger.
- **Cleanup/recovery:** Reconcile public reality, record the exact URL/version, and perform only policy-approved compensation.

### CT-40 — Duplicate deployment/split-brain residual

- **Preconditions:** Deployment/library lineage IDs, activation fence, independent-fork detection and compensation policy exist.
- **Fault injection:** Partition connectivity so two deployment instances activate the same logical release concurrently.
- **Expected invariant:** At most one canonical active instance is selected; any residual split-brain is explicit and fenced.
- **Expected state:** One `ACTIVE`, other `FORKED`/`QUARANTINED`/`COMPENSATION_REQUIRED`; residual risk remains visible.
- **User-visible behavior:** Operator sees which instance is canonical and what external cleanup is still required.
- **Forbidden behavior:** Silent last-writer-wins, cross-instance data merge, or false claim that external effects were rolled back.
- **Evidence required:** Library/deployment identity, activation epoch, heartbeat partition, external effects and compensation ledger.
- **Cleanup/recovery:** Fence the noncanonical instance, reconcile external reality, and retain an explicit residual finding if compensation is incomplete.

## Promotion rule

Implementations may reference a `CT-*` case from a canonical finding's `required_chaos_tests`. A passing design review only proves that the case is specified. Promotion to `VERIFIED` additionally requires machine-readable assertion results, independent QA/security review, and evidence bound to the exact source and control revisions.
