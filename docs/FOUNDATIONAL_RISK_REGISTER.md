# CineForge OS — Foundational Risk Register

> Status: **Pre-architecture red-team baseline**  
> Purpose: preserve the full set of failure modes discovered before system architecture is designed.  
> Scope: local-first, vendor-neutral, adaptive film-production platform that can use local AI, APIs, CLI tools, MCP servers, web/credit-based tools, traditional software, and humans.  
> Core goal: **make the best film possible without allowing one model, vendor, tool, workflow, or hidden assumption to become a single point of failure.**

---

## 0. Why this document exists

CineForge OS must not be designed around the assumption that AI is correct, deterministic, stable, cheap, legally safe, reproducible, or even available tomorrow.

The system must assume all of the following can happen:

- a model can confidently produce the wrong result;
- an evaluator can confidently approve the wrong result;
- a human can approve the wrong result;
- a provider can silently change a model;
- a local runtime can break after a driver/library update;
- a file can exist but be corrupt;
- a database can say an asset exists when the bytes do not;
- a retry can create a duplicate real-world action;
- an approved asset can later become legally unusable;
- a workflow can optimize its metrics while film quality actually degrades;
- a technically perfect pipeline can faithfully produce the wrong creative specification;
- a small error at the start of the chain can contaminate thousands of downstream assets.

The main architectural objective is therefore not “never fail.”

It is:

> **A failure at one frame, one sample, one asset, one worker, one model, one decision, or one human review must not silently become truth for the rest of the production.**

---

# 1. Root risk classes

The current red-team work has converged on the following root classes.

| ID | Root class | Core danger |
|---|---|---|
| R01 | Specification failure | The system perfectly produces the wrong thing |
| R02 | Epistemic failure | The system cannot reliably know whether something is correct |
| R03 | Evaluation/QC failure | AI/human review misses defects or rejects valid creative choices |
| R04 | Learning failure | Feedback makes the system more confidently wrong |
| R05 | Creative degeneration | Optimization produces technically clean but lifeless films |
| R06 | State/continuity failure | Small state errors propagate through scenes and productions |
| R07 | Media-engineering failure | Tiny timing/color/audio/codec errors destroy final quality |
| R08 | Distributed-systems failure | Retry, concurrency, stale state, partial failure corrupt production |
| R09 | Reproducibility failure | Same “inputs” cannot recreate the same output |
| R10 | Tool/integration failure | Flexibility turns into integration spaghetti or hidden lock-in |
| R11 | Infrastructure/storage failure | Hardware, filesystems, databases, backups, or capacity fail |
| R12 | Security/supply-chain failure | Models, nodes, assets, agents, or credentials become attack paths |
| R13 | Rights/provenance/legal failure | Finished work cannot legally or safely be released |
| R14 | Human/organizational failure | Reviewers, directors, operators, or incentives corrupt decisions |
| R15 | Economic/throughput failure | Quality is achievable but not economically or operationally viable |
| R16 | Emergent/systemic failure | Individually-correct components create globally-wrong behavior |
| R17 | Lifecycle/archival failure | A working studio cannot preserve, migrate, recover, or evolve itself |

These are not independent. The most dangerous failures are usually combinations of several classes.

---

# 2. Fundamental epistemic problem: “Who knows what is true?”

## 2.1 AI cannot be treated as a human observer

An AI does not “watch” a film in the human sense. It receives pixels, waveforms, embeddings, detected objects, frames, text, motion estimates, and other representations.

Therefore:

- a face-identity model may miss performance identity;
- an object detector may miss causal continuity;
- a depth estimator may only provide relative depth;
- a VLM may miss a four-frame hand mutation;
- an ASR model can transcribe correctly while emotional delivery is wrong;
- lip-sync can be mathematically aligned while acting still feels synthetic;
- a quality metric can reward sharpness while the shot is narratively useless.

**No single AI judge can be authoritative.**

## 2.2 “No detected error” must never mean “proven correct”

Required states must include at least:

- PASS
- FAIL
- UNKNOWN
- STALE
- CONFLICT
- OUT_OF_DOMAIN
- CORRUPT
- BLOCKED

A failed/offline evaluator must never default to PASS.

## 2.3 Confidence is not truth

A score such as 0.98 is meaningless unless calibrated for:

- evaluator version;
- failure class;
- production domain;
- quality tier;
- dataset;
- threshold operating point;
- false-positive cost;
- false-negative cost.

Scores from different evaluators cannot simply be averaged.

## 2.4 Correlated evaluators create fake consensus

Three evaluators may share:

- the same backbone;
- the same training distribution;
- the same aesthetic biases;
- the same blind spot.

Majority vote does not guarantee independence.

## 2.5 Epistemic circularity

The most dangerous closed loop is:

1. AI writes spec.
2. AI generates.
3. AI evaluates.
4. AI explains failure.
5. AI labels data.
6. AI trains/evolves evaluator.
7. AI increasingly confirms its own worldview.

Independent anchors are mandatory:

- deterministic rules;
- physical/media measurements;
- multiple model families;
- human judgment;
- external references;
- audience evidence;
- legal/rights evidence.

---

# 3. Specification and creative-intent failure

## 3.1 Verification can be perfect while validation is wrong

The system may implement the Film Bible perfectly while the Film Bible itself is wrong.

Example:

- scene specified as sunset;
- every generated shot correctly preserves sunset;
- story logic actually requires midnight.

The pipeline is “correct” while the film is wrong.

## 3.2 Conflicting authority layers

Potential conflicts:

- Studio Constitution;
- franchise/IP canon;
- Film Bible;
- sequence intent;
- scene notes;
- director notes;
- cinematography notes;
- shot specification;
- last-minute producer instruction.

The system needs explicit precedence and a CONFLICT state.

AI must not silently choose which instruction wins.

## 3.3 Context dilution and truncation

Sending more context is not automatically safer.

Risks:

- critical constraints buried in huge prompts;
- middleware truncates input;
- long Film Bible exceeds useful context;
- summary loses a key constraint;
- old instruction receives more attention than recent correction.

The execution layer should compile the minimum required context and verify critical fields were actually included.

## 3.4 Semantic translation drift

Concepts such as:

- “fear 0.7”;
- “slow dolly”;
- “soft light”;
- “restrained performance”;
- “tense silence”

do not map identically across tools/models.

Adapters must expose uncertainty rather than pretend semantics are exact.

---

# 4. AI visual/video QC failure modes

## 4.1 Identity

Possible failures:

- face shape drift;
- eye spacing drift;
- ear/nose/muzzle drift;
- body proportion drift;
- age drift;
- skin/fur tone drift;
- hair length/style drift;
- costume drift;
- accessories appear/disappear;
- character slowly mutates over many reference generations.

**Reference drift** is especially dangerous: using the previous generated shot as the next canonical reference can accumulate small deviations until the character becomes a different design.

Canonical references must remain independent of generated descendants.

## 4.2 Performance identity

Even with a perfectly preserved face:

- posture can change;
- walking style can change;
- gesture language can change;
- reaction timing can change;
- speech rhythm can change;
- eye behavior can change.

“Same face” does not mean “same character.”

## 4.3 Anatomy and geometry

Potential defects:

- wrong finger count;
- temporary extra/missing limb;
- hand-object intersection;
- hair through shoulder;
- clothing through body;
- object scale drift;
- geometry morphing across frames;
- reflections inconsistent with object;
- shadows inconsistent with light;
- impossible contacts;
- mass/weight feels wrong.

Many may exist for only a few frames.

## 4.4 Temporal artifacts

Sampling one frame per second is insufficient.

Possible micro-errors:

- 2–4-frame hand mutation;
- face morph;
- object flicker;
- segmentation edge shimmer;
- background breathing;
- local texture crawling;
- lighting pulse;
- frame freeze;
- motion discontinuity.

Full-frame cheap temporal analysis plus targeted expensive analysis is needed.

## 4.5 Physical consistency is not solved

A visually plausible shot can still violate:

- inertia;
- gravity;
- wind;
- liquid level;
- reflections;
- shadow direction;
- cloth dynamics;
- hair dynamics;
- object permanence.

There is no reliable universal “physics QC” for arbitrary generated film.

## 4.6 Spatial/geographic continuity

Possible failures:

- doors/windows move;
- room dimensions change;
- east/west position flips;
- character exits one side and enters impossibly;
- screen direction reverses;
- camera crosses the 180-degree line unintentionally;
- eyelines do not match;
- object depth/location changes.

## 4.7 Film grammar failures

Aesthetic-quality models may score frames highly while the film fails on:

- eyeline;
- 180-degree rule;
- screen direction;
- entrance/exit direction;
- shot-reverse-shot logic;
- visual emphasis;
- reaction timing;
- composition continuity.

These are not generic image-quality problems.

---

# 5. Story, causality, and long-range continuity

Shot-level consistency is insufficient.

The system must be able to reason about long-distance state.

Examples:

- character knows information before learning it;
- a gun destroyed in Scene 12 appears in Scene 25;
- injury disappears without treatment;
- costume damage resets;
- weather/time-of-day progression becomes impossible;
- door locked earlier becomes open without an event;
- relationship state resets;
- character motivation contradicts earlier scene;
- map/object inventory becomes impossible.

Required conceptual state categories include:

- physical state;
- possession state;
- location state;
- knowledge state;
- relationship state;
- injury/health state;
- costume state;
- environment state;
- story causality.

Not every micro-detail can be explicitly modeled. The system must distinguish explicit continuity from visually inferred continuity and accept residual risk.

---

# 6. Audio and voice failure modes

## 6.1 Correct transcript, wrong acting

ASR can confirm the words while missing:

- wrong emphasis;
- wrong pause;
- wrong subtext;
- wrong emotion;
- wrong breathing;
- wrong intensity;
- wrong character rhythm.

Voice specification must include more than text.

## 6.2 Voice identity drift

Across lines:

- pitch changes;
- accent changes;
- timbre changes;
- age impression changes;
- pacing changes;
- breath behavior changes.

## 6.3 Lip-sync is cross-modal

Possible failure:

- phoneme timing technically close but visually unnatural;
- audio/video offset introduced by later processing;
- face repair damages lips;
- lip repair damages identity;
- regenerated patch does not match surrounding frames.

## 6.4 Repair-cycle oscillation

Example:

1. Face repair improves identity but damages lip sync.
2. Lip-sync repair improves mouth timing but damages expression.
3. Expression repair damages motion continuity.
4. Motion repair damages face.

A simple “fix → QC → fix” loop can oscillate forever.

The system needs:

- repair-cycle detection;
- convergence guards;
- multi-objective evaluation;
- source-branch repair;
- stop/regenerate decisions.

## 6.5 Acoustic continuity

Same room can accidentally change:

- reverb;
- noise floor;
- microphone perspective;
- spatial placement;
- ambience;
- room tone.

A wide shot should not necessarily sound like a microphone is touching the actor.

## 6.6 Foley/SFX overload

Automation may fill every available field:

- footstep;
- cloth;
- wind;
- birds;
- props;
- score.

Result: “audio soup.”

Silence is a creative decision and must be representable.

## 6.7 Music continuity

Generating isolated “good songs” is not enough.

Film score requires:

- motif;
- recurrence;
- variation;
- harmonic continuity;
- orchestration development;
- hit points;
- transitions;
- deliberate silence.

A film can contain 20 good cues and still have a bad score.

---

# 7. Media-engineering micro-failures

These are small implementation errors capable of damaging an entire final master.

## 7.1 Frame rate/timebase

Potential inputs:

- 23.976;
- 24;
- 25;
- 29.97;
- 30;
- 60;
- variable frame rate.

Risks:

- dropped/duplicated frames;
- audio drift;
- incorrect shot duration;
- lip-sync mismatch;
- frame-index/timestamp disagreement.

Media time should use rational/frame/sample semantics, not cumulative floating-point seconds.

## 7.2 PTS/DTS/GOP/B-frames

Potential bugs:

- decode order confused with display order;
- stream-copy cut not frame-accurate;
- cut starts on wrong keyframe;
- timeline metadata and actual frames disagree.

## 7.3 Inclusive/exclusive and indexing bugs

Examples:

- frame 10–20 means 10 or 11 frames;
- one tool is zero-based, another one-based;
- VFX starts at frame 1001;
- an off-by-one error breaks motion continuity or lip sync.

## 7.4 Audio sample rate

Possible sources:

- 24kHz TTS;
- 44.1kHz music;
- 48kHz production audio.

Repeated or inconsistent resampling can change timing and quality.

Canonical working format must be explicit.

## 7.5 Audio latency

Denoisers, resamplers, plugins, and buffering can introduce milliseconds of latency.

Even when source audio/video are correct, processing can break sync.

## 7.6 Loudness/dynamics

Clip-by-clip normalization can destroy dramatic range.

Need to distinguish:

- line;
- stem;
- scene;
- program;
- delivery target.

## 7.7 Channel layout

Stereo/5.1/other layouts can be silently mis-mapped.

A center dialogue channel must not become LFE or rear audio.

## 7.8 Phase/downmix

A mix can sound correct in stereo/surround and partially cancel in mono/downmix.

## 7.9 Color management

Potential mixed sources:

- sRGB;
- Rec.709;
- linear;
- Rec.2020;
- PQ/HDR;
- tool-specific transforms.

Errors:

- skin shifts;
- highlights clip;
- black levels change;
- VFX layers do not integrate;
- downstream software guesses wrong metadata.

Color state is first-class production data.

## 7.10 Alpha

Straight vs premultiplied alpha misunderstanding can create black/white halos around composites.

## 7.11 Resolution and display geometry

Width × height is insufficient.

Need awareness of:

- pixel aspect;
- display aspect;
- rotation metadata;
- crop;
- safe area;
- overscan.

## 7.12 Codec/container/pixel format

A file extension does not define its actual content.

Ingest must probe:

- container;
- codec;
- bit depth;
- pixel format;
- frame rate/timebase;
- channel layout;
- audio codec;
- duration;
- metadata.

---

# 8. Asset identity, versioning, cache, and lineage

## 8.1 Filenames are not identity

Never rely on:

- final.png
- final2.png
- FINAL_REAL.png

Production identity must use immutable IDs and content hashes.

## 8.2 Approved assets must be immutable

If OTTO v18 is approved, changing it must create v19.

Never mutate approved v18 bytes.

## 8.3 “Latest” must not be used for deterministic production

A production job must pin exact revisions.

Example:

- character@18;
- environment@12;
- voice@7;
- workflow@21;
- adapter@4.

## 8.4 Cache poisoning/staleness

A cache key that omits one semantic dependency can return an older result while the database believes it is current.

Cache identity should derive from a complete semantic dependency manifest.

Execution-only data such as credentials should not invalidate semantic cache identity.

## 8.5 Perceptual hash vs cryptographic identity

Perceptual hash is useful for similarity search, not authoritative identity.

Two visually similar faces must never be deduplicated as the same legal/production asset.

## 8.6 Lineage cycles

Derived-asset graphs must not create:

A → B → C → A.

Otherwise invalidation, garbage collection, provenance traversal, and rights propagation can loop indefinitely.

Lineage must be a validated DAG where applicable.

## 8.7 Repair-generation decay

Repeatedly repairing already-repaired outputs accumulates:

- compression damage;
- generation artifacts;
- temporal mismatch;
- color/grain drift.

Important repairs should branch from the highest-quality valid ancestor.

---

# 9. Rights, provenance, revocation, and taint

## 9.1 Provenance is not rights

Knowing where an asset came from does not prove permission to use it.

Maintain separate concepts:

- provenance;
- ownership;
- license;
- consent;
- commercial rights;
- territory;
- expiration;
- attribution;
- model/weight rights;
- training rights.

## 9.2 “Free” is not a sufficient category

Separate:

- free monetary cost;
- free compute;
- open source;
- downloadable weights;
- commercial permission;
- derivative permission;
- training permission.

## 9.3 License snapshots

Do not store only a URL.

Licensing terms can change.

Store relevant historical evidence/snapshot/date/basis.

## 9.4 Revocation propagation

If a voice, music cue, likeness, reference, model, or license becomes unusable:

The system must discover all affected:

- source assets;
- derived images;
- video shots;
- composites;
- mixes;
- edits;
- masters;
- published releases.

Revocation/tombstone must take precedence over late callbacks and stale events.

## 9.5 Binary identity is not legal identity

Two projects can reference identical bytes under different rights.

Content deduplication must not merge their legal state.

## 9.6 Consent withdrawal and trained models

If a person’s data was used to train/fine-tune a model, deleting the original samples may not remove influence from the weights.

Some data therefore must be prohibited from training from the beginning.

## 9.7 Immutability vs deletion requirements

Append-only evidence can conflict with requirements to delete personal data.

Separate:

- immutable audit event;
- sensitive payload;
- references/tombstones;
- cryptographic evidence.

---

# 10. Distributed-systems and workflow failure

## 10.1 Exactly-once is an illusion

Queues/callbacks can deliver more than once.

Every state-changing job must be idempotent.

Track:

- job_id;
- attempt_id;
- idempotency key;
- provider_job_id;
- provider_event_id.

## 10.2 Timeout does not mean provider failure

The provider may have accepted a job before the connection died.

Blind retry can double:

- cost;
- generation;
- callbacks;
- downstream QC.

## 10.3 Stale callbacks

V19 can finish before V18.

A delayed V18 callback must never overwrite newer canonical state.

Use version/fencing checks on writes.

## 10.4 Lease split-brain

Local clocks can drift.

Two workers may both believe they own the same job.

Leases need server-authoritative semantics and preferably fencing tokens.

## 10.5 Retry storms

A provider outage followed by thousands of synchronized retries can overwhelm the recovered provider or local fallback.

Use:

- exponential backoff;
- jitter;
- circuit breaker;
- retry budget.

## 10.6 Poison jobs

One malformed asset can repeatedly crash workers.

Need:

- retry cap;
- quarantine;
- dead-letter queue;
- root-cause classification.

## 10.7 Partial commit / orphan assets

File written but DB not committed, or DB committed while upload incomplete.

Need staged state:

STAGING → HASHED → VERIFIED → REGISTERED → READY.

## 10.8 Long transactions

Never keep a DB transaction open while waiting for a slow external AI/API call.

## 10.9 Deadlocks

Different lock ordering across workers can deadlock.

Lock ordering and retry semantics must be designed deliberately.

## 10.10 Read-replica/index lag

A dashboard/search index can be stale.

Derived indexes must never become production truth.

---

# 11. Approval and human-review failure

## 11.1 What-you-see-is-not-what-you-approve

A human may view V12 while V13 becomes current before the Approve click.

Approval must bind to:

- exact content hash;
- exact asset revision;
- dependency snapshot;
- evaluator policy;
- preferably exact reviewed representation.

Do not approve only a logical “shot ID.”

## 11.2 Proxy vs master

A 720p proxy may hide artifacts visible in 4K.

Creative proxy approval and final technical master approval are distinct.

## 11.3 Anchoring

Showing “AI PASS 97%” before human review biases the reviewer.

Critical review may require blinded human verdict before AI score is revealed.

## 11.4 Reviewer fatigue

After hundreds of clips:

- attention drops;
- accept rate rises;
- labels become noisy.

Use:

- workload limits;
- golden samples;
- calibration;
- blind re-review;
- inter-reviewer agreement.

## 11.5 Humans disagree

Director, VFX supervisor, editor, producer, and Studio Head can legitimately disagree.

Human review is not a single ground-truth scalar.

Store:

- reviewer role;
- context;
- quality target;
- decision;
- reason;
- final authority.

## 11.6 Alert fatigue

Too many low-value warnings train humans to click “Accept.”

Warnings should be ranked by expected harm and confidence.

---

# 12. Learning-system failure

## 12.1 Failure Lake can become a garbage lake

If labels are inconsistent:

- bad hand;
- weird hand;
- anatomy;
- finger issue;
- hand artifact

may describe the same or different failures.

Taxonomy must be versioned, evolvable, and retain free-text/evidence.

## 12.2 Selection bias

If humans only review AI-uncertain cases, the dataset misses cases where AI is confidently wrong.

Randomly audit high-confidence PASS examples.

## 12.3 Feedback poisoning

AI-generated labels should not automatically become training truth.

New evaluators/routing models need:

- golden data;
- shadow mode;
- comparison;
- promotion gate;
- rollback.

## 12.4 Benchmark overfitting

Repeated optimization against a fixed golden set can improve the score without improving real production.

Maintain frozen benchmarks plus rotating unseen evaluation.

## 12.5 Dataset shift

An evaluator validated on photoreal content may be meaningless for:

- anime;
- documentary;
- stop motion;
- stylized animation.

Evaluators need an OUT_OF_DOMAIN state.

## 12.6 Learning monoculture

If early projects are fantasy/sci-fi/animation, the system may treat documentary imperfections as defects.

Historical knowledge must be contextual, not universal.

## 12.7 Self-contamination

Training/fine-tuning repeatedly on Studio outputs can reinforce:

- artifacts;
- stylistic bias;
- generic composition;
- model-specific defects.

## 12.8 Exploration/exploitation trap

Router chooses Workflow A often → more A data → evaluator gets better at A → A scores better → router chooses A more.

Need explicit exploration/diversity budget.

## 12.9 Forgetting must exist

Rules and heuristics can become obsolete.

The learning system needs:

- deprecation;
- supersession;
- expiry;
- historical preservation.

---

# 13. Creative-quality failure

## 13.1 Goodhart’s Law

Optimizing measurable things such as:

- identity similarity;
- smooth motion;
- clean image;
- pass rate;
- low cost;
- high retention

can reduce actual filmmaking quality.

## 13.2 Generic-film convergence

AI may repeatedly favor:

- conventional framing;
- familiar lighting;
- polished faces;
- common pacing;
- predictable music.

Result: technically strong but artistically dead.

## 13.3 Style mistaken for defect

Intentional:

- grain;
- darkness;
- blur;
- awkward framing;
- handheld motion;
- silence;
- discontinuity;
- distortion

may be incorrectly “corrected.”

## 13.4 Global quality debt

Each shot may contain only one “acceptable” minor flaw.

Across 300 shots, the film feels cheap.

Shot PASS does not imply Film PASS.

## 13.5 Repeated subtle error

One slightly lifeless eye movement may be tolerable once but unbearable if repeated for 90 minutes.

Need sequence/film-level evaluation.

## 13.6 Engagement optimization poisoning

Feeding click-through/retention directly into learning risks turning cinema into hook/cut optimization.

Business metrics must not directly define artistic truth.

---

# 14. Tool and capability integration failure

## 14.1 Vendor lock-in

No production concept should be defined as:

- VeoPrompt;
- RunwayShot;
- ComfyJob.

The Studio owns canonical intent; adapters compile it to tool-specific forms.

## 14.2 Open-source lock-in

ComfyUI or another open tool can still become a practical lock-in if core logic is stored only as tool-native graphs.

Studio workflow should remain canonical; backend graphs are compiled/execution artifacts.

## 14.3 Lowest-common-denominator abstraction

A generic “generate_video()” can hide advanced capabilities such as:

- trajectory control;
- multi-reference;
- depth;
- first/last frame;
- LoRA;
- 3D control.

Use core contracts plus capability extensions.

## 14.4 Universal schema explosion

Trying to represent every provider feature in one schema can create hundreds of optional fields.

Use stable core + extension namespaces.

## 14.5 Capability semantics can lie

“supports_4k=true” may mean native 4K or 1080p + upscale.

Registry fields need precise semantics.

## 14.6 Stateful-tool contamination

Blender, GUI tools, plugins, and local processes may retain state from a previous job.

Jobs need controlled/reset execution environments where practical.

## 14.7 Web/credit resources are opportunistic

Consumer web UI can change, rate-limit, require login/CAPTCHA, or remove capabilities.

Treat web resources as best-effort capacity, not guaranteed backend capacity.

## 14.8 Model/provider preprocessing

Cloud providers may silently:

- resize references;
- transcode media;
- rewrite prompts;
- normalize audio;
- apply post-processing.

The model may not receive exactly what CineForge sends.

---

# 15. Local runtime and compute failure

## 15.1 Dependency hell

Local stack can fail due to:

- CUDA;
- PyTorch;
- drivers;
- Python;
- attention libraries;
- custom nodes;
- codecs;
- compiler/runtime mismatch.

Local-first removes one dependency class but creates another.

## 15.2 Precision/runtime drift

Same weights under:

- FP32;
- BF16;
- FP16;
- FP8;
- quantization;
- different kernel/runtime

may behave differently.

Benchmark identity should include runtime profile, not only model name.

## 15.3 GPU OOM fallback changes semantics

Fallback may alter:

- precision;
- offload;
- resolution;
- batch;
- temporal settings.

It must be recorded as a new attempt profile, not the “same retry.”

## 15.4 Thermal throttling

Long local runs can slow due to heat.

Schedulers should observe real telemetry rather than assume fixed throughput.

## 15.5 Memory leaks / poisoned processes

Repeated jobs can leave VRAM/resources allocated.

Some failures require worker restart, not job retry.

## 15.6 Model-switch thrashing

Constantly loading/unloading huge models can waste more time than generation.

Routing must account for loaded-model state and batching, while respecting priority.

## 15.7 Resource fragmentation

Different jobs need different VRAM/capabilities.

Naive scheduling can block large jobs while smaller jobs occupy the only compatible GPU.

---

# 16. Filesystem and storage failure

## 16.1 Disk full

A partially-written file may exist and even be partially decodable.

Existence is not validity.

Verify:

- size;
- checksum;
- decoder;
- duration;
- frame count;
- media metadata.

## 16.2 Temp-file collisions

Workers must never share generic names such as output.tmp.

Temporary namespaces must be unique.

## 16.3 Filesystem semantics differ

Windows/Linux/network filesystems differ in:

- case sensitivity;
- path rules;
- atomic rename behavior;
- locks.

## 16.4 Unicode filenames

Visually-identical Unicode strings can have different encodings/normalization.

Human-readable names must not become primary identity.

## 16.5 Small-file explosion

Masks, depth, optical flow, frames, thumbnails, metadata can create millions of small files.

Storage design must account for access patterns, not just capacity.

## 16.6 SSD wear

Heavy temporary generation and cache churn can exhaust consumer SSD endurance.

## 16.7 Archive retention

Not everything should be permanent.

Possible classes:

- approved sources: permanent;
- masters: permanent;
- legally important provenance: long-lived;
- representative failure examples: long-lived;
- trivial failed candidates: TTL;
- cache/temp: short TTL.

Garbage collection must follow references and rights, not “unused in current edit.”

---

# 17. Backup, recovery, and rollback failure

## 17.1 Backup ≠ recoverability

A backup that has never been restored is unproven.

Run restore drills.

## 17.2 Cross-system consistency

DB backup at 02:00 and object storage at 02:20 can restore incompatible state.

Recovery must understand cross-system snapshots/events.

## 17.3 Recovery path rot

Rollback/disaster scripts are used rarely and therefore are likely to decay.

Chaos exercises are required.

## 17.4 Rollback illusion

Rolling back database state cannot undo:

- API money spent;
- provider receipt of private asset;
- generated derivative;
- email sent;
- public upload;
- leaked asset;
- voice used in training.

Actions must be classified:

- REVERSIBLE;
- COMPENSATABLE;
- IRREVERSIBLE.

Governance increases near irreversible boundaries.

---

# 18. Security and supply-chain failure

## 18.1 Models/custom nodes are executable risk

Downloaded weights/plugins/custom nodes must not automatically receive production access.

Use:

QUARANTINE → HASH → SCAN/REVIEW → SANDBOX → BENCHMARK → CERTIFY → PRODUCTION.

## 18.2 Media ingest is also an attack surface

Malformed:

- image;
- video;
- archive;
- subtitle;
- project file

can attack parsers or cause resource exhaustion.

## 18.3 Generated content is untrusted too

A generated image may contain text resembling instructions.

OCR/VLM downstream agents must not treat generated content as control instructions.

All content is data unless explicitly trusted control data.

## 18.4 CLI/shell injection

AI-generated filename/metadata must never be concatenated into shell strings.

Use typed argument execution, path sandboxing, and allowlisted commands.

## 18.5 Least privilege

A render worker should not have access to:

- GitHub credentials;
- email;
- full database;
- publication credentials;
- unrelated productions.

## 18.6 Agent permissions

Permissions should be capability-based.

Example:

Allowed:
- read shot spec;
- read approved references;
- create candidate.

Not allowed:
- delete master;
- alter rights;
- publish film;
- change security settings.

## 18.7 Insider threat

A legitimate user can intentionally misuse valid permissions.

High-impact release operations may need separation of duties/two-person approval.

## 18.8 Telemetry/crash dumps leak IP

Logs and crash dumps can contain:

- scripts;
- prompts;
- API keys;
- signed URLs;
- paths;
- unreleased assets.

Observability is itself an egress surface.

---

# 19. Metrics and measurement failure

## 19.1 Pass rate can lie

Pass rate may rise because later production contains easier shots.

Metrics must be stratified by shot archetype/complexity.

## 19.2 Simpson’s paradox / mix shift

Aggregate metrics can improve while every meaningful subgroup gets worse.

## 19.3 Benchmark candidate-budget bias

A model allowed 10 attempts has a higher chance of winning than a model allowed 1.

Benchmark candidate budget must be controlled.

## 19.4 Prestige bias

Human or AI evaluators may favor output when told it came from an expensive/famous model.

Blind comparison is preferred.

## 19.5 Evaluation leakage

Evaluator should not receive persuasive generation wording such as “perfect cinematic masterpiece.”

Provide objective intent/spec separately.

## 19.6 Monitoring failure

“No alerts” is not equivalent to “healthy.”

The telemetry pipeline itself can fail.

Monitor monitor-health/heartbeat separately.

---

# 20. Economic and scheduling failure

## 20.1 Cost per generated second is the wrong metric

Use metrics closer to:

- cost per approved shot;
- cost per approved second;
- time per approved shot;
- human minutes per approved shot;
- retry rate;
- repair rate.

## 20.2 Free local compute is not free

Local cost includes:

- GPU depreciation;
- electricity;
- time;
- cooling;
- SSD wear;
- maintenance;
- human operation.

## 20.3 Option value of editable outputs

A slightly more expensive workflow that produces:

- masks;
- depth;
- layers;
- 3D state

may be cheaper over the full production lifecycle than a cheap flat MP4.

## 20.4 Infinite improvement loop

There will always be another possible improvement.

Production needs explicit:

- quality floor;
- quality budget;
- time budget;
- cost budget;
- stopping rules.

## 20.5 Critical-path bottleneck

Adding GPUs does not accelerate a production blocked by:

- screenplay approval;
- character lock;
- director decision;
- legal clearance.

## 20.6 WIP explosion

Generating huge amounts before upstream canon is stable creates massive invalidation waste.

Limit work-in-progress.

## 20.7 Priority inversion/starvation

Hero shot may wait behind hundreds of background jobs.

Priority scheduling needs aging/fairness to avoid starvation.

## 20.8 Fallback cascade

Cloud outage → all jobs fallback local → local overload → failures → route back cloud → oscillation.

Fallback must be capacity-aware and support a DEGRADED MODE.

---

# 21. Scaling and long-term lifecycle failure

## 21.1 Catastrophic success

Architecture may work for:

- one film;
- 10k assets;

and fail at:

- 30 simultaneous productions;
- 100 million assets;
- millions of events;
- huge human review queues.

## 21.2 Schema evolution

Data structures will change.

Store schema versions and migrations.

Do not assume 2026 asset specs can be interpreted by 2031 code without explicit compatibility.

## 21.3 Embedding migration

Embedding model changes invalidate similarity thresholds and comparability.

Version embedding model and rebuild/migrate deliberately.

## 21.4 Archival obsolescence

Preserving bytes is insufficient if future software cannot open:

- codec;
- project format;
- plugin;
- model;
- runtime.

Preserve high-quality open/interchange intermediates where possible.

## 21.5 Containers are not time machines

A container may still depend on:

- GPU architecture;
- driver;
- license server;
- external package;
- unavailable weight.

Archive important rendered intermediates, not only executable environment.

## 21.6 Knowledge death

Code and database can survive while the people who understand architectural rationale leave.

Decision rationale is a durable asset.

---

# 22. Human and organizational failure

## 22.1 Shadow workflows

If CineForge is cumbersome, artists will:

- copy files to desktop;
- use external software;
- return final_final.mov.

Provenance then disappears.

External import must be first-class and the system must minimize friction.

## 22.2 Documentation burden

If every action requires manual metadata entry, users will circumvent the system.

Capture provenance automatically where possible.

## 22.3 Authority ambiguity

AI Director, human Director, Producer, and Studio Head can disagree.

Define final decision authority per decision class.

## 22.4 Policy conflict

Security wants restrictions.
Creative wants freedom.
Production wants speed.
Legal wants evidence.
Finance wants cost control.

These goals can deadlock even when each department is individually correct.

## 22.5 Knowledge concentration

If only one or two engineers understand the system, their absence is an operational single point of failure.

---

# 23. Cross-project and memory failure

## 23.1 Cross-project leakage

Global semantic retrieval may accidentally bring:

- private assets;
- unreleased IP;
- references from another project.

Scope retrieval by production/IP/right.

## 23.2 Creative contamination

Global memory can make all films increasingly resemble previous Studio output.

Memory scopes should distinguish:

- global craft knowledge;
- genre knowledge;
- reusable technical knowledge;
- project canon;
- confidential production context.

## 23.3 Training contamination across rights scopes

A project asset may be usable for that production but not allowed as cross-project training data.

Training permissions need explicit scope.

---

# 24. Localization, accessibility, and release failure

## 24.1 Translation preserves meaning but loses character

A terse character may become polite/verbose in another language.

Localization requires personality/style constraints.

## 24.2 Dubbing timing changes semantics

Forcing translation into mouth duration can alter information.

Run semantic verification after timing adaptation.

## 24.3 Subtitle vs dub mismatch

Subtitle and dubbed dialogue can disagree.

## 24.4 Encoding/Unicode/font failures

Potential release defects:

- wrong encoding;
- missing glyph;
- wrong line break;
- font substitution;
- timing overlap.

Fonts also carry licensing dependencies.

## 24.5 Accessibility

Final delivery may require:

- captions;
- audio description;
- readability;
- flashing-light considerations;
- language-specific accessibility.

Accessibility is a pipeline, not a final checkbox.

---

# 25. Publication and irreversible-boundary failure

## 25.1 Published reality can diverge from Studio truth

The internal master might be V12 while the platform serves V11-hotfix.

Published artifact must be its own immutable Release entity.

## 25.2 Platform transcode

A master can pass internal QC but the platform’s encoding introduces:

- banding;
- crushed blacks;
- audio change;
- subtitle change.

Where possible, QC the actual platform-delivered output.

## 25.3 Emergency hotfix

Last-minute fixes often bypass process.

Emergency workflow must remain fast while still recording:

- exact bytes;
- reason;
- approver;
- release relationship.

## 25.4 Public release is irreversible

Once published or leaked, internal rollback cannot erase copies already downloaded.

Release is a dedicated security/governance boundary.

---

# 26. Chaos-test discoveries that require explicit design

The following tests exposed failure modes that ordinary component testing can miss.

| Chaos scenario | Hidden failure |
|---|---|
| reviewer views V12 while V13 becomes current | wrong version approved |
| rights revoked while old callback arrives | revoked asset resurrected |
| face repair + lip repair alternate | infinite repair oscillation |
| canon update invalidates thousands of shots | fan-out rebuild storm |
| cloud outage sends all work local | local overload and router oscillation |
| license expires after approval but before release | technically valid, legally invalid master |
| human approves proxy | 4K-only defect survives |
| provenance graph gains a cycle | GC/invalidation traversal can loop |
| training uses prior Studio outputs | self-contamination |
| DB rollback after API charge/publish | external world cannot be rolled back |
| 5k low-priority jobs fill GPU | hero shot starves |
| evaluator changes mid-production | PASS has inconsistent meaning |
| generated image contains prompt-like text | generated output attacks downstream agent |
| AI warning flood | reviewer learns to ignore warnings |
| metrics improve because shot mix becomes easier | false improvement |

---

# 27. Non-negotiable invariants

These should later become formal architectural/testable invariants.

1. **UNKNOWN must never silently become PASS.**
2. **Approved assets are immutable.**
3. **Production execution never resolves “latest”; it resolves pinned immutable revisions.**
4. **Important artifacts have immutable IDs, cryptographic hashes, dependency manifests, and provenance.**
5. **Approval binds to the exact bytes/revision/dependencies the reviewer actually saw.**
6. **Revocation/tombstone wins over stale/late events.**
7. **Every external callback and job is idempotent/replay-safe.**
8. **State transitions reject stale writes.**
9. **Asset lineage must not contain illegal cycles.**
10. **Semantic cache keys include all semantic dependencies.**
11. **File existence never implies file validity.**
12. **Media timing uses explicit rational/frame/sample semantics.**
13. **Color/audio/timebase/codec/precision are first-class data, not incidental metadata.**
14. **Every evaluator result records evaluator version, threshold/policy, tested dimensions, untested dimensions, and uncertainty.**
15. **High-confidence PASS still receives random human audit.**
16. **Out-of-domain evaluators must be able to abstain.**
17. **Generated content is untrusted data, not instruction.**
18. **No untrusted model/node/plugin receives production privilege automatically.**
19. **AI agents receive least privilege.**
20. **Learning changes are shadow-tested against human-labelled golden data before promotion.**
21. **Repair loops have convergence/attempt limits and can fall back to regeneration.**
22. **Fallback routing is capacity-aware and may choose degraded mode rather than overload.**
23. **Rights are revalidated at release, not only at ingest.**
24. **Irreversible actions require stronger governance than reversible ones.**
25. **Every release has an immutable release manifest.**
26. **Critical source/intermediate assets are archived; reproducibility is never assumed from seed alone.**
27. **Search/index/vector retrieval is never authoritative identity.**
28. **Rollback plans distinguish internal state rollback from external compensating actions.**
29. **The monitoring system itself is monitored.**
30. **No metric is treated as proof of film quality.**

---

# 28. Required red-team / verification program

Architecture alone cannot eliminate unknown unknowns.

CineForge should eventually include a continuous fault-discovery program:

## 28.1 Fuzzing

Inject:

- missing fields;
- duplicate IDs;
- invalid Unicode;
- NaN/Infinity;
- zero/negative duration;
- extreme FPS;
- malformed media;
- huge metadata;
- invalid paths;
- duplicate callback IDs;
- stale revisions.

## 28.2 Chaos tests

Deliberately:

- kill workers;
- disconnect network;
- fill disks;
- delay callbacks;
- duplicate events;
- corrupt cache entries;
- expire credentials;
- change provider availability;
- crash DB connection;
- pause object storage;
- change evaluator version;
- revoke rights;
- produce stale human approvals.

## 28.3 Recovery drills

Prove:

- DB restore;
- asset restore;
- cross-system reconciliation;
- release rollback/compensation;
- credential/key rotation;
- worker/node rebuild;
- archive recovery.

## 28.4 Random audits

Continuously sample:

- high-confidence PASS;
- old approvals under new evaluator;
- supposedly-unused assets;
- cross-project retrieval;
- published output.

## 28.5 Adversarial review

Attempt:

- prompt injection;
- malicious filename;
- poisoned model;
- hostile custom node;
- malformed image/video/archive;
- rights contamination;
- model identity spoofing;
- provenance stripping.

---

# 29. Highest-risk project killers

If only a few risks are watched at the beginning, prioritize these:

### P0 — Existential

1. **Scope explosion**: building a universal studio for years before completing one real film.
2. **False confidence in AI QC**: wrong outputs become canonical truth.
3. **Learning contamination**: the system trains itself to prefer its own mistakes.
4. **State/version corruption**: a small canonical-state error invalidates thousands of assets.
5. **Vendor/tool coupling**: one disappearing dependency stops production.
6. **Rights debt**: technically finished content cannot legally ship.
7. **Creative degeneration**: technically excellent output is not worth watching.
8. **No containment**: one failure spreads across production rather than stopping locally.
9. **Economic failure**: cost/time/human review per approved result makes production non-viable.
10. **Irreversible-action error**: wrong publication, leak, consent/training misuse, or rights breach cannot truly be rolled back.

### P1 — Severe

- media timebase/color/audio corruption;
- distributed retry/race failures;
- storage/backup unrecoverability;
- security/supply-chain compromise;
- human-review fatigue/anchoring;
- metric gaming;
- common-mode failure of “independent” fallbacks;
- catastrophic scale-up;
- archive/runtime obsolescence.

---

# 30. Architectural philosophy implied by this risk register

This document does **not** prescribe the architecture yet, but it strongly suggests the future system must optimize for:

- containment;
- traceability;
- reversibility;
- explicit uncertainty;
- immutable approved state;
- vendor neutrality;
- capability-based integration;
- deterministic orchestration around nondeterministic AI;
- human authority where taste/meaning dominates;
- automated checks where objective evidence is strong;
- learning from production without allowing self-reinforcing corruption;
- survival when tools/models/providers disappear;
- preservation of creative intent and editability;
- continuous red-team testing.

The desired behavior is:

> If one frame is wrong, the failure should stop at that frame/shot whenever possible.  
> If one worker crashes, it should stop at that job.  
> If one model changes, it should stop at that adapter/provider boundary.  
> If one evaluator becomes wrong, its decisions must be traceable and reversible.  
> If one asset becomes legally invalid, affected descendants must be discoverable.  
> If cloud services disappear, the Studio may degrade in capability but must retain its state, assets, knowledge, and ability to continue production.

---

# 31. Current boundary of known unknowns

After repeated red-team passes, new issues began to collapse into the same underlying mechanisms:

- stale state;
- hidden dependency;
- epistemic circularity;
- correlated failure;
- non-convergent repair;
- irreversible side effect;
- taint/revocation propagation;
- capability/semantic drift;
- lifecycle drift;
- rights drift;
- human bias/fatigue;
- incentive/metric gaming;
- capacity collapse;
- common-mode failure;
- out-of-domain evaluation;
- specification error.

This does **not** mean all future failures are known.

It means further reduction of unknown unknowns should come primarily from **building a minimal prototype and deliberately breaking it**, rather than continuing unlimited conceptual brainstorming.

The next phase should therefore treat this file as the risk baseline and use it to drive:

1. system goals and non-goals;
2. core invariants;
3. trust boundaries;
4. state model;
5. asset/provenance model;
6. capability/tool abstraction;
7. workflow and scheduler design;
8. QC/evidence architecture;
9. human approval model;
10. learning architecture;
11. security model;
12. chaos/fuzz/recovery test plans.

---

## Final principle

> **CineForge OS must never confuse confidence with truth.**

The system must be able to say:

- **I know.**
- **I think.**
- **I do not know.**

A studio that admits uncertainty and contains errors is more trustworthy than a “fully autonomous” studio that silently turns uncertain guesses into canonical production state.
