# CineForge OS — Multi-Agent Development Red-Team

> Purpose: adversarial review of the GitHub operating model.

# Role 1 — Builder

Failure:
“I finished code but CI takes hours, so my scheduled run does nothing.”

Control:
park PR waiting CI; claim independent task; Flow Governor owns CI flow.

# Role 2 — Reviewer

Failure:
“All code waits on one reviewer.”

Control:
review is a capability pool; Flex/builders can rotate into review; Integrator is not sole reviewer.

# Role 3 — Integrator

Failure:
“Ten PRs all modify migrations/config and conflict.”

Control:
hotspot lease + contract-first sequencing; parallelize non-hotspot work.

# Role 4 — Planner

Failure:
“I created 100 issues, then architecture changes and 60 are stale.”

Control:
keep bounded ready horizon; create more work just ahead of capacity, not entire speculative project.

# Role 5 — Flow Governor

Failure:
“Every worker is busy, but none works on the task blocking 12 others.”

Control:
critical-path/downstream-unblock priority overrides local queue order.

# Role 6 — Scheduled slot

Failure:
“Two overlapping invocations of same slot start two tasks.”

Control:
preflight SLOT_ID; atomic branch claim; one active implementation per slot.

# Role 7 — Work chat

Failure:
“Work chat implements and then approves its own PR.”

Control:
logical AGENT_INSTANCE_ID; self-review cannot satisfy independent gate.

# Role 8 — CI engineer

Failure:
“Every PR runs full installer/media/chaos suite for two hours.”

Control:
Tier A fast gate; path-based Tier B; Tier C nightly/release/high-risk.

# Role 9 — QA

Failure:
“Flaky red CI causes agents to rerun until green.”

Control:
flake classification/quarantine/fix; no evidence laundering through repeated reruns.

# Role 10 — Product owner

Failure:
“Agents ask me whenever two libraries or code styles are possible.”

Control:
normal engineering decisions are autonomous; only defined external/destructive/business/legal/architecture boundaries escalate.

# Role 11 — Dependency graph

Failure:
“Frontend waits for backend, backend waits for schema, connector waits for backend.”

Control:
merge interface/schema contract first; mocks/fixtures; independent implementation behind stable contracts.

# Role 12 — Stalled worker

Failure:
“Agent disappears with a Draft PR and nobody touches issue.”

Control:
visible claim; stale takeover by Flow Governor on same branch.

# Role 13 — Merge queue

Failure:
“PR was reviewed green, then author pushed and Integrator merged stale approval.”

Control:
review records the required HEAD + BASE/merge verification context; material context change invalidates review according to risk policy.

# Role 14 — Security

Failure:
“Flow Governor bypasses a security test to increase throughput.”

Control:
Flow authority cannot bypass mandatory correctness/security/rights gate.

# Role 15 — Scale-up to 15 slots

Failure:
“More slots create more conflicts and less throughput.”

Control:
control-plane capacity + hotspot/flex + ready-depth management; role affinity, not uncontrolled task grabbing.

# Role 16 — Scale-down to 5 slots

Failure:
“Specialist roles disappear and tasks become impossible.”

Control:
bundle roles; protocol is capability-based; one slot can serve multiple roles.

# Role 17 — Branch race

Failure:
“Two agents read READY simultaneously and both code it.”

Control:
deterministic next claim branch; only one branch creation succeeds.

# Role 18 — CI red main

Failure:
“Builders keep merging unrelated work on broken main.”

Control:
red main becomes P0 flow incident; Integrator restricts risky merges until root cause isolated.

# Role 19 — External credential

Failure:
“Five slots repeatedly attempt task blocked by missing account.”

Control:
explicit external blocker removes task from ready queue; workers continue other tasks.

# Role 20 — Review feedback loop

Failure:
“Author fixes one comment but introduces another, reviewer and author ping-pong indefinitely.”

Control:
reviewer groups blocking issues; task scope remains bounded; after repeated loop Flow Governor may assign pair-review/takeover/refactor split.

# Role 21 — Epic completion illusion

Failure:
“All task issues merged but end-to-end vertical slice does not work.”

Control:
Epic has integration acceptance/evidence; completion requires vertical verification, not child issue count.

# Role 22 — Documentation drift

Failure:
“Agent builds behavior contradicting architecture docs.”

Control:
AGENTS mandatory read; review checks docs; architecture-changing PR updates docs + tests in same decision.

# Role 23 — Queue gaming

Failure:
“Agents choose easy small issues while critical hard tasks age.”

Control:
priority includes critical path and downstream unblock, not count of closed issues.

# Role 24 — Slot hoarding

Failure:
“One agent owns five parked PRs and forgets them.”

Control:
default max parked ownership; Flow Governor can take over/reassign.

# Role 25 — Integration-test-only failure

Failure:
“PRs individually green but combined main fails.”

Control:
post-merge/merge-queue impacted integration; main-red incident protocol.

# Saturation findings

After these passes, new failure scenarios reduce mainly to:
- claim/lease;
- dependency decomposition;
- CI/review capacity;
- hotspot integration;
- stale evidence;
- control-plane scheduling;
- external/manual boundary;
- critical-path prioritization.

Remaining validation must come from real concurrent agents working the repository.


# Additional control-plane red-team passes

# Role 26 — Planner unavailable

Failure:
“Primary Planner disappears; no new tasks are created and builders starve.”

Control:
- Capacity Plan is reconstructable from GitHub;
- Flow Governor may assume temporary Planner role;
- ready Issue/PR truth does not depend on Planner memory;
- builders may still claim already READY tasks.

# Role 27 — Capacity Plan stale

Failure:
“Plan says 10 slots but only 5 are active.”

Control:
- Capacity Plan is guidance, not lease/task truth;
- Flow Governor detects persistent idle/stale SLOT_IDs;
- Planner reduces WIP;
- live PR ownership remains unchanged until lease liveness assessment.

# Role 28 — Same GitHub account for all agents

Failure:
“GitHub user identity cannot prove independent review.”

Control:
- logical AGENT_INSTANCE_ID/SLOT_ID recorded in PR claims and review comments;
- independent review policy is evaluated on logical agent identity;
- GitHub account identity alone is insufficient.

Residual limitation:
true human/organization separation is not implied; this is engineering-agent independence.

# Role 29 — GitHub/API rate pressure

Failure:
“15 workers repeatedly scan the entire repository and hit API/rate/latency limits.”

Control:
- stagger slots;
- scope searches to open issues/PRs and current Epic;
- reuse concrete Issue/PR IDs when known;
- avoid refetching unchanged large documents repeatedly within one run;
- control plane performs broad scans; builders perform narrow scans.

# Role 30 — Orphan claim branch

Failure:
“Agent creates claim branch then dies before opening Draft PR.”

Control:
- Flow Governor scans agent/i* branches without matching PR;
- if branch head equals claim base/no meaningful commits, retire/delete when tooling allows or mark orphan;
- if meaningful commits exist, recover by opening/adopting Draft PR;
- other workers must not silently reuse ambiguous branch.

# Role 31 — Work chat and scheduled slot race

Failure:
“Work chat and S07 both see same READY issue.”

Control:
same deterministic claim branch attempt; only one creation succeeds. Loser selects another task.

# Role 32 — Task becomes obsolete mid-implementation

Failure:
“Another merged PR changes architecture so current task is no longer needed.”

Control:
- Flow Governor/Integrator mark PR obsolete;
- preserve useful commits/tests if reusable;
- close without forcing merge;
- Planner updates dependents;
- no sunk-cost merge.

# Role 33 — Upstream contract changes after dependent work started

Failure:
“Dependent PR compiles against old interface.”

Control:
- contract revisions are explicit;
- Integrator requires branch update/compatibility;
- dependent PR may remain parallel if compatibility adapter exists;
- otherwise park only affected work.

# Role 34 — Migration-number collision

Failure:
“Two data agents create same migration sequence.”

Control:
- migration namespace/order treated as HOTSPOT;
- temporary migration owner or timestamp/UUID migration identity;
- Integrator validates ordering before merge.

# Role 35 — Generated file conflict

Failure:
“Multiple PRs regenerate the same derived file.”

Control:
- generated artifacts have one source contract;
- avoid manual edits;
- regeneration is Integrator/hotspot step when necessary;
- independent PRs change sources, not shared generated output where possible.

# Role 36 — Giant PR

Failure:
“PR is correct but too large to review, so reviews become superficial.”

Control:
- Planner/author split by contract/vertical slice;
- reviewer may REQUEST_SPLIT before detailed review;
- scope explosion is a flow defect.

# Role 37 — User manually edits main

Failure:
“Human/user hotfix lands outside active task assumptions.”

Control:
- main is authoritative;
- open PRs must verify base/head compatibility before merge;
- Flow Governor re-evaluates tasks touched by the manual change;
- no agent insists stale plan is correct.

# Role 38 — Integrator unavailable

Failure:
“Everything is green/reviewed but waits for one integrator run.”

Control:
- Integrator is a capability, not one identity;
- Flow Governor or QA-capable control slot may perform merge gate;
- if repo auto-merge becomes available, use it for eligible PRs.

# Role 39 — Review independence illusion

Failure:
“Same Work chat changes prompt and calls itself a different reviewer ID.”

Control:
- AGENT_INSTANCE_ID must be stable runtime identity;
- a single runtime cannot mint a second identity to satisfy its own independent review;
- degraded single-slot mode is explicitly marked, not disguised.

# Role 40 — One-slot degraded mode

Failure:
“Only one worker exists; strict independent review deadlocks all work.”

Control:
- LOW/MEDIUM risk may use DEGRADED_SELF_REVIEW only under explicit repository policy with fresh diff reread + full required CI;
- HIGH risk remains unmerged until a second logical reviewer becomes available unless an approved emergency policy exists;
- degraded mode is visible in PR evidence.

# Role 41 — Critical PR starves behind easy merges

Failure:
“Integrator clears small PRs while critical-path PR ages.”

Control:
merge/review priority uses critical-path/unblock value, not FIFO alone.

# Role 42 — CI false freshness

Failure:
“Old green run on previous commit is shown next to current head.”

Control:
verification tuple is part of every merge/review record; no approximate check matching.

# Role 43 — Scheduled clock/timezone drift

Failure:
“Slot schedules collide after timezone/DST/config changes.”

Control:
- SLOT_ID safety is independent of time;
- staggering is performance optimization, not correctness;
- Capacity Plan records schedule cycle/offsets explicitly.

# Role 44 — Queue overproduction

Failure:
“Planner creates enough issues for 15 slots but capacity drops to 5; task specs rot.”

Control:
bounded ready horizon; Planned/blocked Epics can remain coarse until approaching execution.

# Role 45 — Queue underproduction

Failure:
“Planner only creates one next task; 14 slots idle.”

Control:
ready-depth target scales with builder capacity; Planner cycle precedes builders in stagger plan.

# Role 46 — Control-plane busy with reporting

Failure:
“Planner/Flow spends all cycles writing status summaries rather than unblocking work.”

Control:
- status is derived from GitHub;
- control roles update only actionable metadata;
- no mandatory verbose report per cycle;
- bottleneck action takes precedence over prose.

# Updated saturation conclusion

New cases still reduce to:
- GitHub-derived task/lease truth;
- capability-based control roles;
- current verification-context evidence;
- bounded queue;
- deterministic claim;
- hotspot ownership;
- takeover/recovery;
- critical-path prioritization.

No additional coordination primitive is currently required. Real multi-agent execution is the next source of evidence.


# Additional red-team cases from deep audit

# Role 47 — Public issue prompt injection
Failure:
“External user creates an Issue using the exact Task template and instructs agents to run commands/upload secrets.”

Control:
trusted-author/adoption gate; external Issue is untrusted inbox data, never READY by format alone.

# Role 48 — Fake structured review comment
Failure:
“External commenter posts AGENT_REVIEW_V1 APPROVE.”

Control:
structured events accepted only from trusted GitHub author + registered logical identity + valid schema.

# Role 49 — Two Integrators merge concurrently
Failure:
“Both validate against main M0; A merges then B merges using evidence from M0.”

Control:
single active Integrator/merge lease, refresh main and verification context per merge; Merge Queue may replace lease.

# Role 50 — Same scheduled slot overlaps before PR exists
Failure:
“Run 2 sees no PR because Run 1 only created branch and starts different task.”

Control:
SLOT_LEASE_V1 acquired/re-read before mutating work.

# Role 51 — Capacity Plan lost update
Failure:
“Two control agents read version 8 and both replace Issue body with version 9.”

Control:
append-only CAPACITY_PLAN_V2 chain; same-parent conflict resolved by GitHub comment ordering.

# Role 52 — Task acceptance changes after claim
Failure:
“Planner edits Issue while worker builds old contract.”

Control:
contract_version/hash; material revision event; owner/reviewer ACK/revalidate.

# Role 53 — Orphan branch mistaken for dead worker
Failure:
“Flow scans during tiny branch→Draft-PR gap and reclaims.”

Control:
ORPHAN_OBSERVED grace/reconciliation cycle before recovery.

# Role 54 — No-wait WIP explosion
Failure:
“Every long CI causes workers to open another PR until CI/review queues explode.”

Control:
stage WIP/backpressure limits; saturated downstream redirects workers to review/CI/unblock work.

# Role 55 — Path-filter blind spot
Failure:
“Core contract change touches one file, expensive integration tests are skipped because path map misses semantic consumers.”

Control:
CI tier derives from diff + risk/domain/contract impact; unknown impact fails broader.

# Role 56 — Fork code on privileged self-hosted runner
Failure:
“Public PR executes attacker code on persistent machine holding credentials/cache.”

Control:
untrusted fork isolation; ephemeral/sandboxed runner; privileged release runners never execute arbitrary PR code.

# Role 57 — CI cache poisoning
Failure:
“Untrusted branch populates cache restored by privileged release.”

Control:
cache trust boundary/provenance and clean rebuild for security-critical artifacts.

# Role 58 — Multiple Work chats share WORK identity
Failure:
“Two chats accidentally count as same slot/reviewer or suppress each other.”

Control:
unique stable WORK-<id> identities.

# Role 59 — SQLite DB placed in synced/network folder
Failure:
“User chooses OneDrive/UNC as data location; WAL locking/sync behavior corrupts or destabilizes Core DB.”

Control:
validated supported Core database root; media/backups may use separate roots.

# Role 60 — Technically automatable website but automation not permitted
Failure:
“Connector says healthy and browser automation starts despite provider policy/terms uncertainty.”

Control:
automation permission axis; UNKNOWN never implies ALLOWED; assisted/manual fallback.

# Updated saturation note

The remaining high-value tests are now empirical:
- true concurrent GitHub comment/branch races;
- CI base/merge semantics;
- GitHub rate/partial failure;
- runner isolation;
- Windows filesystem/storage behavior;
- live 5/10/15-slot throughput/backpressure.
