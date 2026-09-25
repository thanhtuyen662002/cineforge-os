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
review records exact head; material head change invalidates review according to risk policy.

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
