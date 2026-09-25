# CineForge OS — Risk Register ↔ Architecture Coverage Matrix

> Purpose: prove that the final architecture has an explicit control surface for every root risk class in `FOUNDATIONAL_RISK_REGISTER.md`.
> Status: Architecture review baseline.

| Risk | Coverage | Primary controls | Remaining residual risk |
|---|---|---|---|
| R01 Specification failure | Covered by design | Film Bible precedence, Script candidate review, conflict state, Context Compiler, Action impact preview | Humans can still define wrong goals |
| R02 Epistemic failure | Covered by containment | UNKNOWN/OUT_OF_DOMAIN, multi-source evidence, abstention, human review | Unknown unknowns remain |
| R03 Evaluation/QC | Covered by architecture | Evidence Engine, versioned evaluators, random audits, exact approval binding | Taste/acting/meaning remain partially human |
| R04 Learning failure | Covered by governance | Golden sets, shadow mode, promotion/rollback, no direct production self-training | Dataset bias still requires monitoring |
| R05 Creative degeneration | Covered by policy | Intent-first workflow, diversity/exploration budget, blinded comparison, human authority | Creative quality cannot be formalized completely |
| R06 State/continuity | Covered | Story state, typed dependency graph, character/prop/world timelines, ShotContinuitySnapshot | Inferred micro-continuity remains imperfect |
| R07 Media engineering | Covered | ProjectMediaProfile, technical metadata, rational time, normalization/validation, final QC | Third-party transcoding can still alter output |
| R08 Distributed systems | Covered | commands/events, idempotency, stale-write rejection, fencing/leases, retry budgets, staged assets | External systems may have weak APIs |
| R09 Reproducibility | Covered by provenance | pinned runtime/model/connector revisions, manifests, archived outputs | Cloud exact regeneration cannot be guaranteed |
| R10 Tool/integration | Covered | Capability Fabric, connector lifecycle, extension namespaces, semantic capabilities | Connector maintenance remains ongoing |
| R11 Infrastructure/storage | Covered | graph-aware GC, critical reserve, staged writes, backup/restore, move-library transactions | Hardware failure remains possible |
| R12 Security/supply-chain | Covered | trust zones, quarantine/certification, sandbox, least privilege, secure credential refs | Third-party vulnerabilities remain |
| R13 Rights/legal | Covered | Rights domain, license snapshots, consent, revocation/taint propagation, release revalidation | Law/terms can change |
| R14 Human/org | Covered | actor/authority, DecisionRequest, approval binding, collaboration-ready events | Humans can still make poor decisions |
| R15 Economic/throughput | Covered | Cost Ledger, budget reservation, WIP controls, resource scheduler, approved-result metrics | Provider pricing/capacity can change |
| R16 Emergent/systemic | Covered by monitoring/governance | concentration/oscillation monitors, diversity budget, no single-metric promotion, fan-out controls | Emergent behavior cannot be fully predicted |
| R17 Lifecycle/archive | Covered | schema/version discipline, archive packages, migrations, restore drills, open/interchange outputs | Very long-term ecosystem obsolescence remains |

## Architecture-review conclusion

The previous Foundation documents contained the correct direction but did not fully operationalize:
- user-action semantics;
- canonical timeline/edit state;
- learning governance;
- systemic/emergent-loop containment;
- cost reservation;
- connection lifecycle;
- cancellation/late completion;
- release/publish separation;
- collaboration readiness;
- GC/restore transactionality.

These gaps are incorporated into `FINAL_ARCHITECTURE.md`.

The Risk Register remains a permanent adversarial source, not a historical document to be ignored after architecture is written.
