# CineForge OS — Detailed Domain & Database Schema v1

# 0. Persistence authority rule

CineForge V1 is **event/audit-backed, not pure event-sourced**.

In one Core transaction, a successful canonical command writes:
- normalized authoritative domain rows/revisions;
- the corresponding append-only `domain_events`;
- outbox messages when external dispatch is required.

The normalized domain tables/revision registries are the operational canonical state.
`domain_events` are the immutable causality/audit ledger and support reconciliation/projection rebuilds, but V1 does not require reconstructing every canonical table solely by replaying events.

Derived projections/search/indexes may be rebuilt from canonical domain data plus events/snapshots.

This avoids two competing canonical models while preserving auditability and future replay capabilities.

> Status: implementation baseline derived from `docs/architecture/FINAL_ARCHITECTURE.md`.
> Database V1: SQLite WAL, single authoritative writer inside CineForge Core.
> This document describes canonical data. Search indexes, embeddings, thumbnails, previews and caches are derived data.

# 1. Physical conventions

## 1.1 IDs
- Canonical IDs are UUIDv7 strings.
- IDs never encode business meaning.
- File names, provider IDs and vector IDs are never canonical entity identity.
- External provider IDs live in binding tables only.

## 1.1.1 Canonical hashing and serialization

- Raw media/content SHA-256 is computed over exact bytes.
- Semantic revision/manifest hashes are computed over a versioned canonical serialization.
- Canonical JSON rules: UTF-8, Unicode NFC for normalized semantic strings where policy permits, deterministic key ordering, deterministic array ordering only where the domain declares order-insensitive semantics, stable integer/decimal representation, no NaN/Infinity.
- Film/media time uses rational integer pairs, never float serialization.
- Hash records include/implicitly bind a serialization schema version so a future canonicalization change cannot masquerade as the same hash contract.
- Two semantically different legal/right identities may still reference the same raw-byte hash.

## 1.2 Time
- Database timestamps: signed INTEGER microseconds since Unix epoch UTC.
- API/UI timestamps: RFC3339 UTC plus locale rendering.
- Film/media time never uses wall-clock timestamps; it uses rational frame/sample time.

## 1.2.1 Story/order keys

Story/order keys are logical ordering values, not timestamps.
V1 uses signed INTEGER sparse ranks within an owning sequence/list.
Insertion may use gaps; a Core transaction may renumber a list without changing semantic story time.
Do not use floating-point order keys.

## 1.3 Optimistic concurrency
Mutable aggregate heads contain:
- `row_version INTEGER NOT NULL`
- every command that mutates a mutable head supplies expected row_version;
- mismatch => `STALE_REVISION`, never last-write-wins.

## 1.4 Immutable revisions
Approved/canonical revisions are immutable.
A logical entity and its revisions are distinct concepts:

```text
logical entity
  ├─ revision 1
  ├─ revision 2
  └─ revision 3 (approved)
```

Revision metadata is conceptually shared across domain revisions, but physically it has one authoritative owner: `revision_registry` (defined later in this document).

Typed domain revision tables:
- reuse `revision_registry.id` as their PK/FK;
- store only domain-specific revision fields;
- do not duplicate revision_no/lifecycle/content_hash/approval metadata as a second source of truth.

Legacy phrases below such as “common revision envelope” mean “row exists in revision_registry plus typed domain fields”, not duplicated columns.

No production job resolves “latest”; it pins an explicit revision ID.

## 1.5 JSON usage
JSON is allowed only for:
- provider/tool extension namespace;
- typed command payloads/events with schema_version;
- draft working copies;
- non-query-critical metadata.

Core relationships, identity, rights, timing and lifecycle states stay relational.

## 1.6 Storage objects
Binary payloads are not SQLite blobs.

`storage_objects` is keyed by SHA-256 and points to content-addressed local storage.
Legal/creative identity remains in `assets` / `asset_revisions`.

Same bytes may be referenced by multiple assets with different rights.

## 1.7 SQLite baseline
Writer connection:
- foreign_keys = ON
- journal_mode = WAL
- synchronous = FULL
- busy_timeout configured
- one Core writer queue

Critical immutable/event tables are append-only by application policy and protected by tests/triggers where practical.

# 2. Studio, actors and authority

## studios
- id PK
- name
- default_locale
- created_at_utc_us
- row_version

## actors
Represents human, system or approved agent identity.
- id PK
- studio_id FK
- actor_type: HUMAN | SYSTEM | AGENT
- display_name
- locale
- status: ACTIVE | DISABLED
- created_at_utc_us

## roles
- id PK
- studio_id FK
- code UNIQUE per studio
- display_name_key
- authority_rank

## actor_roles
- actor_id FK
- role_id FK
- project_id nullable
- valid_from_utc_us
- valid_to_utc_us nullable
PK(actor_id, role_id, project_id, valid_from_utc_us)

## permissions
- id PK
- code UNIQUE

## role_permissions
PK(role_id, permission_id)

# 3. Commands, events, projections and drafts

## commands
Authoritative mutation intent.
- id PK
- studio_id FK
- project_id nullable FK
- actor_id FK
- command_type
- schema_version
- scope_type
- scope_id nullable
- payload_json
- expected_versions_json
- reversibility: REVERSIBLE | COMPENSATABLE | IRREVERSIBLE
- status: RECEIVED | VALIDATING | WAITING_DECISION | READY | EXECUTING | SUCCEEDED | FAILED | CANCELLED | PARTIAL | COMPENSATING | SUCCEEDED_WITH_WARNINGS | COMPENSATED | FAILED_COMPENSATION
- correlation_id nullable
- causation_id nullable
- idempotency_key nullable
- estimated_cost_json nullable
- estimated_storage_bytes nullable
- created_at_utc_us
- started_at_utc_us nullable
- finished_at_utc_us nullable
- error_code nullable
- error_details_json nullable

Idempotency uniqueness is scoped, not a free global string collision.

Recommended unique partial key:
- (actor_id, command_type, idempotency_key) when idempotency_key is not null.

System-generated globally unique keys may additionally be indexed for lookup.

## command_impacts
- command_id FK
- entity_type
- entity_id
- impact_type: MUTATE | INVALIDATE | REVIEW | REGENERATE_POSSIBLE | RIGHTS_BLOCK | STORAGE | EXTERNAL_SIDE_EFFECT
- severity
- details_json
PK(command_id, entity_type, entity_id, impact_type)

## domain_events
Append-only.
- seq INTEGER PRIMARY KEY AUTOINCREMENT
- id UUIDv7 UNIQUE
- aggregate_type
- aggregate_id
- aggregate_version
- event_type
- schema_version
- payload_json
- command_id FK
- actor_id FK
- correlation_id nullable
- causation_id nullable
- created_at_utc_us
UNIQUE(aggregate_type, aggregate_id, aggregate_version)

## aggregate_snapshots
- aggregate_type
- aggregate_id
- aggregate_version
- event_seq
- schema_version
- snapshot_json
- created_at_utc_us
PK(aggregate_type, aggregate_id, aggregate_version)

## outbox_messages
Created in same DB transaction as canonical changes when external work/event dispatch is required.
- id PK
- event_seq FK
- message_type
- destination_type
- payload_json
- status: PENDING | DISPATCHING | SENT | FAILED | DEAD
- attempts
- available_at_utc_us
- last_error nullable

## external_inbox_events
Deduplicates callbacks/webhooks/tool events.
- id PK
- source_type
- source_instance_id
- external_event_id
- payload_hash
- received_at_utc_us
- processed_at_utc_us nullable
- status
UNIQUE(source_type, source_instance_id, external_event_id)

## working_copies
Autosaved, non-canonical draft state.
- id PK
- project_id FK
- entity_type
- entity_id
- base_revision_id nullable
- owner_actor_id FK
- schema_version
- draft_payload_json
- row_version
- autosaved_at_utc_us
- expires_at_utc_us nullable
UNIQUE(entity_type, entity_id, owner_actor_id)

Autosave never creates approval.

# 4. Project and production structure

## projects
- id PK
- studio_id FK
- code
- title
- lifecycle_state: ACTIVE | PAUSED | ARCHIVED | TRASHED
- default_language
- current_media_profile_revision_id nullable
- current_film_bible_revision_id nullable
- privacy_policy_id nullable
- budget_policy_id nullable
- created_by_actor_id
- created_at_utc_us
- row_version
UNIQUE(studio_id, code)

## project_media_profiles
Logical profile.
- id PK
- project_id FK

## project_media_profile_revisions
- common revision envelope
- profile_id FK
- timeline_rate_num
- timeline_rate_den
- width
- height
- pixel_aspect_num
- pixel_aspect_den
- working_color_space
- transfer_function
- hdr_policy
- audio_sample_rate
- audio_channel_layout
- proxy_profile_json
- mastering_targets_json

## sequences
- id PK
- project_id FK
- stable_code
- lifecycle_state
- row_version

## sequence_revisions
- common revision envelope
- sequence_id FK
- title
- intent_text
- order_key

## scenes
- id PK
- project_id FK
- sequence_id FK
- stable_code
- lifecycle_state
- row_version

## scene_revisions
- common revision envelope
- scene_id FK
- title
- intent_text
- location_environment_id nullable
- story_start_key
- story_end_key
- day_time_state
- notes

## shots
- id PK
- project_id FK
- scene_id FK
- stable_code
- lifecycle_state
- row_version

## shot_revisions
- common revision envelope
- shot_id FK
- intent_text
- shot_type
- estimated_duration_num
- estimated_duration_den
- camera_intent_json
- lighting_intent_json
- performance_intent_json
- generation_policy_json

## shot_status_projection
Derived/read model only.
- shot_id PK
- active_spec_revision_id
- continuity_snapshot_id nullable
- production_state
- selected_asset_revision_id nullable
- review_state
- stale_reason_count
- blocking_decision_count
- last_event_seq

# 5. Story, script and causality

## film_bibles
- id PK
- project_id FK

## film_bible_revisions
- common revision envelope
- film_bible_id FK
- original_language
- content_json
- authority_level

## script_documents
- id PK
- project_id FK
- source_asset_revision_id nullable
- title
- original_language

## script_revisions
- common revision envelope
- script_document_id FK
- source_text
- parse_status
- structured_hash

## story_beats
- id PK
- script_revision_id FK
- scene_id nullable
- order_key
- beat_type
- text
- canonical_status

## story_events
- id PK
- project_id FK
- scene_id nullable
- story_order_key
- event_type
- subject_entity_type
- subject_entity_id
- object_entity_type nullable
- object_entity_id nullable
- payload_json
- source_revision_id
- canonical_status

## causality_facts
- id PK
- project_id FK
- fact_type
- subject_entity_type
- subject_entity_id
- valid_from_story_key
- valid_to_story_key nullable
- value_json
- source_event_id nullable
- authority_level

## dialogue_lines
Logical dialogue identity.
- id PK
- project_id FK
- scene_id FK
- stable_code
- character_id FK

## dialogue_line_revisions
- common revision envelope
- dialogue_line_id FK
- original_language
- original_text
- translated_from_revision_id nullable
- performance_intent
- emotion
- intensity
- pace
- pause_directives_json
- pronunciation_directives_json
- target_story_time_json nullable

## dialogue_takes
- id PK
- dialogue_line_revision_id FK
- voice_identity_revision_id FK
- asset_revision_id FK
- language
- provider_binding_id nullable
- performance_context_id nullable
- selected BOOL
- qc_summary_json
- created_at_utc_us

Only one selected take per dialogue line revision/language via partial unique index.

# 6. Character and canon

## characters
- id PK
- project_id FK
- stable_code
- display_name
- lifecycle_state
- row_version

## visual_identity_packages
- id PK
- character_id FK

## visual_identity_revisions
- common revision envelope
- package_id FK
- semantic_description
- anatomy_json
- proportion_json
- palette_json
- marking_json
- forbidden_drift_json

## visual_identity_references
- visual_identity_revision_id FK
- asset_revision_id FK
- reference_role
- priority
PK(visual_identity_revision_id, asset_revision_id, reference_role)

## voice_identity_packages
- id PK
- character_id FK

## voice_identity_revisions
- common revision envelope
- package_id FK
- semantic_description
- canonical_language
- vocal_range_json
- timbre_json
- prosody_json
- emotional_map_json
- pronunciation_lexicon_revision_id nullable
- forbidden_traits_json

## voice_provider_bindings
- id PK
- voice_identity_revision_id FK
- connection_id FK
- provider_voice_id
- provider_model_revision
- language
- binding_state: TESTING | CERTIFIED | DEGRADED | DEPRECATED | REVOKED
- quality_profile_json
- rights_record_id nullable
- created_at_utc_us

## performance_bibles
- id PK
- character_id FK

## performance_bible_revisions
- common revision envelope
- performance_bible_id FK
- posture_json
- gait_json
- gestures_json
- eye_behavior_json
- reaction_timing_json
- speech_rhythm_json
- emotional_baseline_json
- forbidden_drift_json

## character_state_intervals
- id PK
- character_id FK
- valid_from_story_key
- valid_to_story_key nullable
- appearance_modifier_json nullable
- emotion_state_json nullable
- injury_state_json nullable
- location_entity_id nullable
- knowledge_state_ref nullable
- relationship_state_ref nullable
- source_event_id nullable

Overlapping intervals of the same state dimension must be validated by Core.

# 7. Costume, props, environment and style

## costumes / costume_revisions
Logical costume + immutable revision.
Revision includes components, materials, palette, fit and canonical references.

## costume_state_intervals
- id PK
- costume_id FK
- character_id nullable FK
- valid_from_story_key
- valid_to_story_key nullable
- dirt_state
- wetness_state
- damage_state_json
- modifier_json

## props / prop_revisions
Revision includes visual identity, dimensions, material and physical properties.

## prop_possession_intervals
- id PK
- prop_id FK
- holder_entity_type
- holder_entity_id
- valid_from_story_key
- valid_to_story_key nullable
- state_revision_id nullable

## prop_state_intervals
- id PK
- prop_id FK
- valid_from_story_key
- valid_to_story_key nullable
- condition
- modification_json
- location_entity_id nullable
- source_event_id nullable

## environments / environment_revisions
Revision includes topology/geography, scale, entrances/exits, landmarks and baseline appearance.

## environment_state_intervals
- environment_id FK
- valid_from_story_key
- valid_to_story_key nullable
- time_of_day
- weather
- lighting_state_json
- damage_state_json
- occupancy_state_json

## style_bibles / style_bible_revisions
Revision includes:
- medium
- stylization
- shape language
- color language
- lighting language
- camera/lens language
- texture/material language
- motion language
- editing language
- audio/music language
- negative constraints

## style_bindings
- id PK
- project_id FK
- scope_type: PROJECT | SEQUENCE | SCENE | SHOT | CHARACTER
- scope_id
- style_bible_revision_id FK
- priority
- effective_from_story_key nullable
- effective_to_story_key nullable

# 8. Continuity and dependency graph

## shot_continuity_snapshots
Immutable materialized state used by generation/QC.
- id PK
- shot_revision_id FK
- story_key
- snapshot_hash
- project_media_profile_revision_id FK
- style_binding_manifest_json
- created_at_utc_us
- created_from_event_seq

## shot_cast_bindings
- continuity_snapshot_id FK
- character_id FK
- visual_identity_revision_id FK
- voice_identity_revision_id nullable FK
- performance_bible_revision_id nullable FK
- costume_revision_id nullable
- costume_state_interval_id nullable
- character_state_interval_id nullable
PK(continuity_snapshot_id, character_id)

## shot_prop_bindings
- continuity_snapshot_id FK
- prop_id FK
- prop_revision_id FK
- prop_state_interval_id nullable
- possession_interval_id nullable
- required_presence BOOL
PK(continuity_snapshot_id, prop_id)

## dependencies
Typed graph edge.
- id PK
- project_id FK
- from_type
- from_id
- to_type
- to_id
- dependency_type: SEMANTIC | VISUAL | TIMING | TECHNICAL | RIGHTS | PROVENANCE | SOFT_REFERENCE
- invalidation_policy: HARD_STALE | REVIEW_REQUIRED | WARNING | NONE
- created_by_event_seq
- active BOOL

Core rejects forbidden lineage cycles where the graph type requires DAG semantics.

## staleness_records
- id PK
- entity_type
- entity_id
- caused_by_event_seq
- dependency_id
- stale_type
- status: OPEN | WAIVED | RESOLVED
- resolved_by_command_id nullable

# 9. Asset and storage schema

## assets
Legal/creative logical asset.
- id PK
- project_id nullable FK
- asset_type
- display_name
- origin_type: IMPORTED | GENERATED | RECORDED | EXTERNAL_EDIT | HANDOFF_RETURN | SYSTEM
- lifecycle_state: ACTIVE | ARCHIVED | TRASHED
- rights_identity_id nullable
- row_version

## asset_revisions
- common revision envelope
- asset_id FK
- storage_object_id FK
- source_binding_id nullable
- technical_metadata_id FK
- provenance_record_id FK
- semantic_role
- availability_state: AVAILABLE | MISSING | CORRUPT | QUARANTINED
- review_state: UNREVIEWED | CANDIDATE | APPROVED | REJECTED
- rebuildability: ORIGINAL | CANONICAL | REBUILDABLE | EPHEMERAL

## storage_objects
Content identity only; location is separate.
- id PK
- sha256 UNIQUE
- byte_size
- storage_class
- verified_at_utc_us
- created_at_utc_us

## storage_object_locations
A content object may exist on multiple managed roots/mirrors.
- id PK
- storage_object_id FK
- storage_root_id FK
- relative_path
- location_role: PRIMARY | MIRROR | BACKUP | STAGING_RECOVERED
- state: AVAILABLE | MISSING | CORRUPT | OFFLINE
- last_verified_at_utc_us
UNIQUE(storage_object_id, storage_root_id, relative_path)

## asset_locations
- id PK
- asset_revision_id FK
- location_type: MANAGED_OBJECT | EXTERNAL_PATH | MIRROR | EXPORT
- path_or_uri
- path_fingerprint nullable
- status
- last_verified_at_utc_us

## technical_metadata
- id PK
- media_kind
- container
- codec
- width
- height
- pixel_format
- bit_depth
- frame_rate_num
- frame_rate_den
- time_base_num
- time_base_den
- frame_count nullable
- duration_num
- duration_den
- color_primaries nullable
- transfer nullable
- matrix nullable
- audio_codec nullable
- sample_rate nullable
- channel_layout nullable
- metadata_json

## provenance_records
- id PK
- origin_type
- source_description
- source_asset_revision_id nullable
- generating_job_attempt_id nullable
- connector_version_id nullable
- model_identifier nullable
- generation_parameters_hash nullable
- created_at_utc_us

## asset_lineage
- parent_asset_revision_id FK
- child_asset_revision_id FK
- relationship_type
- command_id FK
PK(parent_asset_revision_id, child_asset_revision_id, relationship_type)

# 10. Import schema

## import_sessions
- id PK
- project_id nullable
- actor_id FK
- state
- source_kind
- source_root nullable
- intent_hint nullable
- created_at_utc_us
- row_version

## import_items
- id PK
- import_session_id FK
- original_name
- detected_mime
- byte_size nullable
- source_path_or_uri
- ingest_state
- hash_sha256 nullable
- decode_status
- security_status
- resulting_asset_id nullable
- error_code nullable

## import_semantic_candidates
- id PK
- import_item_id FK
- semantic_role
- confidence nullable
- proposed_binding_type nullable
- proposed_binding_id nullable
- status: PROPOSED | ACCEPTED | REJECTED

# 11. Canonical timeline/edit schema

## timelines
- id PK
- project_id FK
- scope_type: PROJECT | SEQUENCE | SCENE
- scope_id
- row_version

## timeline_revisions
- common revision envelope
- timeline_id FK
- media_profile_revision_id FK
- duration_num
- duration_den
- edit_hash

## timeline_tracks
- id PK
- timeline_revision_id FK
- track_type: VIDEO | AUDIO | CAPTION | DATA
- order_index
- name
- enabled

## clip_instances
- id PK
- track_id FK
- asset_revision_id FK
- source_in_num
- source_in_den
- source_out_num
- source_out_den
- timeline_in_num
- timeline_in_den
- timeline_out_num
- timeline_out_den
- speed_num
- speed_den
- transform_json nullable
- gain_db nullable
- pan_json nullable
- effect_chain_ref nullable
- linked_group_id nullable

## timeline_transitions
- id PK
- track_id FK
- left_clip_id FK
- right_clip_id FK
- transition_type
- duration_num
- duration_den
- parameters_json

## timeline_markers
- id PK
- timeline_revision_id FK
- time_num
- time_den
- marker_type
- label
- payload_json

## caption_segments
- id PK
- timeline_revision_id FK
- language
- start_num
- start_den
- end_num
- end_den
- text
- dialogue_line_revision_id nullable

## timeline_working_sessions
Mutable draft editing state; never canonical.
- id PK
- timeline_id FK
- base_revision_id FK
- actor_id FK
- state
- row_version
- last_autosave_at_utc_us

## timeline_edit_ops
- id PK
- working_session_id FK
- op_seq
- op_type
- payload_json
- actor_id FK
- created_at_utc_us
UNIQUE(working_session_id, op_seq)

# 12. Production workflow, generation and jobs

## workflows / workflow_revisions
Semantic workflow definitions. Provider-specific implementation belongs in capability binding.

## production_strategies / production_strategy_revisions
Describe direct generation, I2V, 3D-first, hybrid, manual etc.

## generation_sessions
- id PK
- project_id FK
- target_type
- target_id
- target_revision_id
- continuity_snapshot_id nullable
- strategy_revision_id
- candidate_target_count
- candidate_budget_json
- estimated_cost_json
- state
- selected_candidate_asset_revision_id nullable
- command_id FK

## jobs
- id PK
- project_id nullable
- job_type
- semantic_capability
- priority
- state
- generation_session_id nullable
- pinned_manifest_hash
- connection_id nullable
- connector_version_id nullable
- created_at_utc_us
- row_version

## job_attempts
- id PK
- job_id FK
- attempt_no
- retry_kind
- idempotency_key
- fencing_token nullable
- state
- provider_job_id nullable
- provider_event_id nullable
- started_at_utc_us nullable
- finished_at_utc_us nullable
- cost_reservation_id nullable
- actual_usage_json nullable
- error_code nullable
- error_details_json nullable
UNIQUE(job_id, attempt_no)

## job_artifacts
- job_attempt_id FK
- asset_revision_id FK
- role: OUTPUT | PREVIEW | LOG | MASK | DEPTH | AUXILIARY
PK(job_attempt_id, asset_revision_id, role)

## leases
- resource_type
- resource_id
- owner_worker_id
- fencing_token
- acquired_at_utc_us
- heartbeat_at_utc_us
- expires_at_utc_us
PRIMARY KEY(resource_type, resource_id)

# 13. Connections and capability fabric

## connections
- id PK
- studio_id FK
- display_name
- connector_type
- lifecycle_state
- auth_state
- policy_state
- current_connector_version_id nullable
- row_version

## connector_versions
- id PK
- connection_id nullable
- connector_family
- semantic_version
- binary_hash nullable
- schema_fingerprint
- manifest_json
- status: INSTALLED | CERTIFIED | DEPRECATED | QUARANTINED
- installed_at_utc_us

## capabilities
Global semantic capability registry.
- id PK
- code UNIQUE
- schema_version
- input_schema_json
- output_schema_json

## connection_capabilities
- connection_id FK
- connector_version_id FK
- capability_id FK
- capability_extension_json
- enabled
- quality_profile_json
- limits_json
- rights_policy_json
PK(connection_id, connector_version_id, capability_id)

## connection_permissions
- connection_id FK
- permission_code
- scope_type
- scope_id nullable
- allowed
- granted_by_actor_id
- granted_at_utc_us
PK(connection_id, permission_code, scope_type, scope_id)

## connection_health_samples
- id PK
- connection_id FK
- connector_version_id FK
- health_state
- auth_state
- availability_state
- capacity_state
- latency_ms nullable
- details_json
- sampled_at_utc_us

## browser_profiles
- id PK
- connection_id FK
- secure_profile_ref
- lifecycle_state
- concurrency_limit
- last_verified_at_utc_us

## browser_interaction_sessions
- id PK
- job_attempt_id FK
- browser_profile_id FK
- state
- interaction_trace_hash
- human_takeover_required
- started_at_utc_us
- finished_at_utc_us nullable

# 14. Decisions, review and evidence

## decision_requests
- id PK
- project_id nullable
- decision_type
- title_key
- reason_key
- reason_args_json
- blocking_scope_type
- blocking_scope_id nullable
- severity
- state: OPEN | RESOLVED | DISMISSED | EXPIRED | OBSOLETE
- recommended_choice_id nullable
- deadline_at_utc_us nullable
- required_authority
- created_by_event_seq
- resolved_by_actor_id nullable
- resolved_at_utc_us nullable

## decision_choices
- id PK
- decision_request_id FK
- label_key
- command_template_json
- consequence_summary_json
- recommended BOOL

## review_sessions
- id PK
- project_id FK
- subject_type
- subject_id
- subject_revision_id
- representation_asset_revision_id
- dependency_snapshot_hash
- policy_revision_id
- state
- reviewer_actor_id
- started_at_utc_us
- submitted_at_utc_us nullable

## human_reviews
- id PK
- review_session_id FK
- decision: APPROVE | REJECT | REPAIR | ABSTAIN
- notes
- reason_codes_json
- reviewed_at_utc_us

## evaluations
- id PK
- subject_type
- subject_id
- subject_revision_id
- evaluator_id
- evaluator_version
- policy_revision_id
- domain_profile
- result: PASS | FAIL | UNKNOWN | OUT_OF_DOMAIN | CONFLICT
- confidence nullable
- tested_dimensions_json
- untested_dimensions_json
- created_at_utc_us

## evidence
- id PK
- evaluation_id FK
- evidence_type
- start_time_json nullable
- end_time_json nullable
- region_json nullable
- asset_revision_id nullable
- value_json
- severity

# 15. Rights and legal identity

## rights_identities
Legal identity scope distinct from content hash.
- id PK
- project_id nullable
- subject_type
- subject_id
- notes

## rights_records
- id PK
- rights_identity_id FK
- right_type
- status: ALLOWED | RESTRICTED | UNKNOWN | REVOKED | EXPIRED
- territory_json
- valid_from_utc_us nullable
- valid_to_utc_us nullable
- commercial_allowed nullable
- derivative_allowed nullable
- training_allowed nullable
- cloning_allowed nullable
- attribution_required nullable
- evidence_snapshot_id nullable

## license_snapshots
- id PK
- source_uri nullable
- captured_at_utc_us
- content_hash
- storage_object_id nullable
- summary_json

## consents
- id PK
- rights_identity_id FK
- consent_type
- granted_by
- evidence_asset_revision_id nullable
- valid_from_utc_us
- valid_to_utc_us nullable
- revoked_at_utc_us nullable

## revocations
- id PK
- rights_identity_id FK
- reason
- effective_at_utc_us
- command_id FK
- created_at_utc_us

# 16. Cost and resource schema

## budgets
- id PK
- project_id nullable
- scope_type
- scope_id nullable
- currency
- hard_limit_minor_units nullable
- soft_limit_minor_units nullable
- credit_provider nullable
- credit_limit nullable
- period_type nullable

## cost_reservations
- id PK
- budget_id FK
- job_id nullable
- command_id FK
- estimated_money_minor_units nullable
- estimated_credits nullable
- state: RESERVED | PARTIALLY_USED | RELEASED | RECONCILED
- created_at_utc_us

## usage_records
- id PK
- reservation_id nullable
- connection_id nullable
- job_attempt_id nullable
- money_minor_units nullable
- credits_used nullable
- gpu_milliseconds nullable
- cpu_milliseconds nullable
- storage_bytes_added nullable
- human_review_milliseconds nullable
- usage_state: ESTIMATED | ACTUAL | UNKNOWN
- recorded_at_utc_us

# 17. Delivery, handoff and publication

## export_sessions
- id PK
- project_id FK
- timeline_revision_id nullable
- deliverable_type
- target_profile
- state
- output_manifest_id nullable
- command_id FK

## handoff_manifests
- id PK
- project_id FK
- target_editor
- compatibility_profile_version
- reference_render_asset_revision_id nullable
- timeline_interchange_asset_revision_id nullable
- manifest_json
- created_at_utc_us

## external_edits
- id PK
- project_id FK
- handoff_manifest_id nullable
- returned_asset_revision_id
- returned_interchange_asset_revision_id nullable
- lineage_confidence: EXACT | PARTIAL | FLATTENED | UNKNOWN
- imported_at_utc_us

## release_candidates
- id PK
- project_id FK
- timeline_revision_id FK
- audio_master_asset_revision_id
- subtitle_manifest_json
- media_profile_revision_id FK
- rights_snapshot_hash
- state
- row_version

## release_manifests
Immutable.
- id PK
- release_candidate_id FK
- manifest_hash UNIQUE
- master_asset_revision_id FK
- qc_snapshot_hash
- rights_snapshot_hash
- created_by_actor_id
- created_at_utc_us

## publications
- id PK
- release_manifest_id FK
- connection_id FK
- target_account_ref
- target_platform
- state
- external_publication_id nullable
- delivered_asset_hash nullable
- command_id FK
- created_at_utc_us

# 18. Storage lifecycle, trash, backup and update

## trash_entries
- id PK
- entity_type
- entity_id
- trashed_by_actor_id
- trashed_at_utc_us
- purge_after_utc_us nullable
- estimated_reclaimable_bytes

## storage_gc_runs
- id PK
- mode: DRY_RUN | EXECUTE
- policy_revision
- state
- planned_reclaim_bytes
- actual_reclaim_bytes nullable
- created_by_actor_id
- started_at_utc_us
- finished_at_utc_us nullable

## storage_gc_candidates
- gc_run_id FK
- storage_object_id FK
- reason
- safe_to_delete
- blocking_reason nullable
PK(gc_run_id, storage_object_id)

## backups
- id PK
- backup_type
- scope_type
- scope_id nullable
- state
- event_seq_checkpoint
- object_manifest_hash
- destination
- verification_state
- created_at_utc_us

## schema_migrations
- version PK
- migration_name
- migration_sha256
- applied_at_utc_us
- app_version

## update_history
- id PK
- update_plane: CORE_UI | CONNECTOR | RUNTIME | MODEL | POLICY
- target_id nullable
- from_version
- to_version
- state
- rollback_available
- started_at_utc_us
- finished_at_utc_us nullable

# 19. Learning governance

## failure_examples
- id PK
- project_id nullable
- subject_revision_id
- taxonomy_version
- reason_codes_json
- free_text
- evidence_refs_json
- human_label_status
- training_permission_state

## golden_examples
- id PK
- domain_profile
- subject_revision_id
- expected_outcome_json
- provenance_json
- rights_scope_json
- active

## benchmark_runs
- id PK
- candidate_component_type
- candidate_component_version
- benchmark_suite_version
- state
- metrics_json
- started_at_utc_us
- finished_at_utc_us nullable

## promotion_records
- id PK
- state: CANDIDATE | OFFLINE_BENCHMARK | GOLDEN_VALIDATION | CROSS_DOMAIN_VALIDATION | SHADOW | HUMAN_REVIEW | PROMOTED | REJECTED | OUT_OF_DOMAIN | ROLLED_BACK | DEPRECATED
- component_type
- from_version
- to_version
- benchmark_run_id FK
- shadow_result_json
- human_approval_review_id nullable
- promoted_at_utc_us nullable
- rolled_back_at_utc_us nullable

# 20. Critical indexes

At minimum:
- domain_events(aggregate_type, aggregate_id, aggregate_version)
- domain_events(created_at_utc_us)
- commands(project_id, status, created_at_utc_us)
- decision_requests(project_id, state, severity)
- jobs(project_id, state, priority, created_at_utc_us)
- job_attempts(job_id, attempt_no)
- assets(project_id, asset_type, lifecycle_state)
- asset_revisions(asset_id, revision_no)
- dependencies(from_type, from_id, active)
- dependencies(to_type, to_id, active)
- staleness_records(entity_type, entity_id, status)
- dialogue_lines(scene_id, character_id)
- scenes(sequence_id, stable_code)
- shots(scene_id, stable_code)
- clip_instances(track_id, timeline_in_num, timeline_in_den)
- connection_health_samples(connection_id, sampled_at_utc_us DESC)
- usage_records(job_attempt_id)
- rights_records(rights_identity_id, status)
- trash_entries(purge_after_utc_us)

# 21. Constraints and triggers required by tests

Tests must prove:
1. Approved immutable revision cannot be updated in-place.
2. Duplicate domain aggregate version is rejected.
3. Duplicate external callback is harmless.
4. Duplicate idempotency key cannot execute a second side effect.
5. Selected dialogue take uniqueness holds.
6. Release manifest cannot mutate.
7. Storage object cannot be purged while any protected reference exists.
8. Asset lineage cycle creation is rejected.
9. Stale row_version mutation is rejected.
10. Production jobs cannot contain unresolved “latest”.
11. Timeline revision references immutable exact asset revisions.
12. Rights revocation cannot be hidden by later stale callback.
13. External linked source content change is detected.
14. Autosave working copy cannot become approved without explicit command.
15. Deleting a connection does not delete historical provenance.

# 22. Schema rule for future modules

A new feature may add tables only after answering:
- What is the logical identity?
- What is mutable?
- What becomes an immutable revision?
- What are independent state axes?
- What dependency edges does it create?
- What rights/provenance data applies?
- What command mutates it?
- What event records the mutation?
- Can it be undone?
- What survives connector/provider disappearance?
- How is it archived/restored?

If these questions are unanswered, the schema is not implementation-ready.


# 23. Global entity and revision registries

Polymorphic dependency/audit references need referential integrity beyond free-form type/id pairs.

## entity_registry
Every logical domain entity registers exactly once.
- id PK
- entity_type
- studio_id FK
- project_id nullable FK
- created_at_utc_us
- archived_at_utc_us nullable
UNIQUE(id, entity_type)

Domain logical tables reuse the same ID and FK to entity_registry.

`entity_registry` is identity metadata only. Mutable aggregate concurrency is owned by the typed logical table's `row_version`; do not maintain a second row_version in the registry.

## revision_registry
Every immutable canonical/checkpoint revision registers here.
- id PK
- entity_id FK entity_registry
- revision_type
- revision_no
- parent_revision_id nullable FK revision_registry
- lifecycle_state
- content_hash
- schema_version
- created_by_actor_id
- created_at_utc_us
- approved_by_actor_id nullable
- approved_at_utc_us nullable
- supersedes_revision_id nullable FK revision_registry
UNIQUE(entity_id, revision_no)

Typed revision tables reuse revision_registry.id as PK/FK.

This registry makes dependency, review, rights and lineage references validate target existence while keeping typed domain tables.

## projection_checkpoints
- projection_name PK
- last_event_seq
- projection_schema_version
- rebuilt_at_utc_us
- health_state
- error_details_json nullable

# 24. Production planning and critical path

## production_tasks
- id PK FK entity_registry
- project_id FK
- task_type
- subject_entity_id nullable FK entity_registry
- title
- workflow_stage
- priority
- state: PLANNED | READY | ACTIVE | WAITING | BLOCKED | DONE | CANCELLED
- assigned_actor_id nullable
- due_at_utc_us nullable
- estimated_work_ms nullable
- actual_work_ms nullable
- row_version

## production_task_dependencies
- predecessor_task_id FK
- successor_task_id FK
- dependency_kind: FINISH_START | START_START | FINISH_FINISH | RESOURCE | APPROVAL
- lag_ms
PK(predecessor_task_id, successor_task_id, dependency_kind)

Cycles that make planning invalid are rejected unless explicitly supported as soft coordination edges.

## milestones
- id PK FK entity_registry
- project_id FK
- title
- target_at_utc_us nullable
- state
- completion_rule_json

## milestone_tasks
PK(milestone_id, production_task_id)

## wip_policies
- id PK
- project_id FK
- scope_type
- scope_id nullable
- max_active_items
- overflow_behavior
- priority_policy_json

Critical-path and bottleneck are projections derived from tasks/dependencies/resources, not manually edited percentages.

# 25. Policy hierarchy, control mode and creative exceptions

## policies
- id PK FK entity_registry
- studio_id FK
- policy_type

## policy_revisions
- id PK FK revision_registry
- policy_id FK
- policy_json
- explanation_json

## policy_bindings
- id PK
- policy_revision_id FK
- scope_type: STUDIO | PROJECT | SEQUENCE | SCENE | SHOT | TASK | ASSET
- scope_id
- priority
- effective_from_story_key nullable
- effective_to_story_key nullable

Effective policy is resolved with explicit precedence and returned with source binding.

Control modes are represented as policy values:
- AUTO
- GUIDED
- ADVANCED
- EXPERT

## creative_exceptions
First-class intentional deviation, not merely a generic warning dismissal.
- id PK FK entity_registry
- project_id FK
- exception_type
- scope_type
- scope_id
- reason
- authority_actor_id FK
- valid_from_story_key nullable
- valid_to_story_key nullable
- expires_at_utc_us nullable
- related_evidence_id nullable
- state: PROPOSED | ACTIVE | EXPIRED | REVOKED | REJECTED

Examples:
- intentional continuity break;
- deliberate color shift;
- stylized anatomy;
- subtitle/dub semantic divergence.

# 26. Audio scene, dialogue, ADR and mixing domain

## conversation_sessions
- id PK FK entity_registry
- scene_id FK
- title
- acoustic_space_profile_id nullable
- story_start_key
- story_end_key

## performance_contexts
- id PK
- conversation_session_id FK
- character_id nullable
- context_json
- previous_context_id nullable

## audio_cues
- id PK FK entity_registry
- project_id FK
- scene_id nullable
- cue_type: DIALOGUE | ADR | NONVERBAL | FOLEY | SFX | AMBIENCE | ROOM_TONE | MUSIC | SILENCE
- start_target_json nullable
- end_target_json nullable
- intent_text
- source_dialogue_line_id nullable
- character_id nullable
- state

## audio_cue_revisions
- id PK FK revision_registry
- audio_cue_id FK
- parameters_json
- selected_asset_revision_id nullable
- timing_dependency_revision_id nullable

## adr_links
- original_dialogue_take_id FK
- replacement_dialogue_take_id FK
- reason
- approved_by_actor_id nullable
PK(original_dialogue_take_id, replacement_dialogue_take_id)

## acoustic_space_profiles
- id PK FK entity_registry
- environment_id nullable
- name
- profile_json

## room_tone_assets
- acoustic_space_profile_id FK
- asset_revision_id FK
- priority
PK(acoustic_space_profile_id, asset_revision_id)

## mix_buses
- id PK FK entity_registry
- project_id FK
- parent_bus_id nullable
- bus_type: DIALOGUE | MUSIC | SFX | FOLEY | AMBIENCE | MASTER | CUSTOM
- name
- channel_layout
- processing_chain_ref nullable

## stem_assignments
- audio_cue_id FK
- mix_bus_id FK
- gain_db
- pan_json nullable
PK(audio_cue_id, mix_bus_id)

# 27. Music continuity and spotting

## music_themes
- id PK FK entity_registry
- project_id FK
- name
- semantic_identity_json
- rights_identity_id nullable

## music_theme_revisions
- id PK FK revision_registry
- music_theme_id FK
- motif_description
- harmony_language_json
- instrumentation_json
- reference_asset_revisions_json

## music_cues
- id PK FK entity_registry
- project_id FK
- scene_id nullable
- theme_id nullable
- cue_role
- timing_start_json
- timing_end_json
- intent_text
- silence_allowed BOOL
- state

## music_cue_revisions
- id PK FK revision_registry
- music_cue_id FK
- theme_revision_id nullable
- spotting_json
- selected_asset_revision_id nullable
- transition_intent_json

## spotting_events
- id PK
- music_cue_id FK
- time_json
- event_type
- narrative_reason
- story_event_id nullable

# 28. Localization, dubbing and accessibility

## localization_packages
- id PK FK entity_registry
- project_id FK
- locale
- source_locale
- state

## translation_units
- id PK FK entity_registry
- localization_package_id FK
- source_entity_id FK entity_registry
- source_revision_id nullable FK revision_registry
- source_text
- translated_text
- semantic_notes
- state: DRAFT | REVIEWED | APPROVED | STALE
- row_version

## subtitle_tracks
- id PK FK entity_registry
- localization_package_id FK
- timeline_id FK

## subtitle_track_revisions
- id PK FK revision_registry
- subtitle_track_id FK
- format_profile
- font_asset_revision_id nullable
- style_json
- accessibility_mode

## dubbing_tracks
- id PK FK entity_registry
- localization_package_id FK
- timeline_id FK
- language
- state

## dubbing_line_bindings
- dubbing_track_id FK
- dialogue_line_revision_id FK
- localized_translation_unit_id FK
- dialogue_take_id nullable
- timing_policy
PK(dubbing_track_id, dialogue_line_revision_id)

## accessibility_tracks
- id PK FK entity_registry
- project_id FK
- track_type: SDH | AUDIO_DESCRIPTION | TRANSCRIPT | OTHER
- locale
- asset_revision_id nullable
- state

# 29. VFX, compositing and 3D-derived artifacts

## compositions
- id PK FK entity_registry
- project_id FK
- shot_id FK
- row_version

## composition_revisions
- id PK FK revision_registry
- composition_id FK
- width
- height
- working_color_space
- coordinate_system_json nullable
- unit_system nullable
- camera_metadata_json nullable

## composition_layers
- id PK
- composition_revision_id FK
- order_index
- layer_type
- source_asset_revision_id FK
- blend_mode
- transform_json
- mask_asset_revision_id nullable
- depth_asset_revision_id nullable
- alpha_mode nullable
- effect_chain_ref nullable

## render_pass_bindings
- composition_revision_id FK
- pass_role: BEAUTY | ALPHA | DEPTH | NORMAL | MOTION | MASK | MATTE | OTHER
- asset_revision_id FK
- coordinate_metadata_json nullable
PK(composition_revision_id, pass_role, asset_revision_id)

# 30. Worker and resource inventory

## workers
- id PK
- worker_type: CORE | LOCAL_AI | CLI | BROWSER | MCP_PROXY | MEDIA | QC
- host_id
- lifecycle_state
- process_instance_id nullable
- started_at_utc_us
- last_heartbeat_at_utc_us
- connector_version_id nullable

## worker_capabilities
- worker_id FK
- capability_id FK
- limits_json
PK(worker_id, capability_id)

## resource_inventory
- id PK
- host_id
- resource_type: GPU | CPU | RAM | DISK | NETWORK
- resource_key
- static_profile_json

## resource_samples
- id PK
- resource_inventory_id FK
- sampled_at_utc_us
- utilization_json
- health_state
- temperature_c nullable
- free_capacity_json nullable

Scheduler never assumes installed == available.

# 31. Runtime/model/package provisioning

## packages
- id PK
- package_family
- package_type: CORE | CONNECTOR | RUNTIME | MODEL | TOOL | POLICY | BENCHMARK
- version
- manifest_hash
- publisher
- signature_record_id nullable
- schema_version
UNIQUE(package_family, version)

## package_dependencies
- package_id FK
- dependency_family
- version_range
- optional BOOL
PK(package_id, dependency_family)

## package_installations
- id PK
- package_id FK
- storage_root_id FK
- state: DISCOVERED | DOWNLOADING | SIGNATURE_VERIFY | VERIFIED | STAGED | INSTALLING | HEALTH_CHECK | ACTIVE | DRAINING | REMOVAL_CHECK | FAILED_DOWNLOAD | FAILED_SIGNATURE | INCOMPATIBLE | FAILED_INSTALL | FAILED_HEALTH | QUARANTINED | REMOVED
- installed_path
- installed_at_utc_us nullable
- last_verified_at_utc_us nullable

## package_pins
- id PK
- project_id nullable
- scope_type
- scope_id
- package_family
- package_id FK
- reason

## package_signatures
- id PK
- package_id nullable
- signer_identity
- signature_type
- signature_hash
- verified_at_utc_us
- verification_result

## certification_records
- id PK
- package_id nullable
- connector_version_id nullable
- benchmark_profile
- security_review_state
- compatibility_json
- certified_at_utc_us
- expires_at_utc_us nullable

# 32. Storage roots, staging and rebuild recipes

## storage_roots
- id PK
- root_type: OBJECTS | PROJECTS | MODELS | CACHE | TEMP | BACKUP | EXPORT
- root_path
- volume_id
- state
- reserve_bytes
- row_version

## storage_volumes
- id PK
- volume_identity
- filesystem_type
- capacity_bytes
- last_free_bytes
- health_state
- last_checked_at_utc_us

## staging_objects
- id PK
- job_attempt_id nullable
- import_item_id nullable
- temp_path
- expected_size nullable
- current_size
- sha256 nullable
- state: WRITING | COMPLETE | VERIFIED | REGISTERED | ORPHANED | QUARANTINED | FAILED
- created_at_utc_us

## derived_recipes
Proves rebuildability rather than using a label only.
- id PK
- output_asset_revision_id FK
- recipe_type
- recipe_version
- input_manifest_hash
- executable_dependency_manifest_hash
- parameters_hash
- reproducibility_level: EXACT | BEST_EFFORT | NOT_GUARANTEED

A GC candidate marked rebuildable must have a valid recipe or policy-approved regeneration path.

# 33. Provider terms, privacy and execution policy

## provider_terms_snapshots
- id PK
- connection_id FK
- connector_version_id nullable
- review_state: CURRENT | SUPERSEDED | UNKNOWN | REQUIRES_REVIEW
- captured_at_utc_us
- terms_hash
- storage_object_id nullable
- structured_summary_json
- effective_from_utc_us nullable

## execution_terms_bindings
- job_attempt_id FK
- provider_terms_snapshot_id FK
PK(job_attempt_id, provider_terms_snapshot_id)

## privacy_policies
- id PK FK entity_registry
- studio_id FK

## privacy_policy_revisions
- id PK FK revision_registry
- privacy_policy_id FK
- egress_rules_json
- provider_allowlist_json
- sensitive_classes_json

# 34. Notifications, diagnostics and support

## notifications
- id PK
- actor_id FK
- project_id nullable
- notification_type
- severity
- title_key
- body_key
- args_json
- decision_request_id nullable
- created_at_utc_us
- read_at_utc_us nullable
- dismissed_at_utc_us nullable

## notification_deliveries
- id PK
- notification_id FK
- channel: IN_APP | WINDOWS
- state
- attempted_at_utc_us
- delivered_at_utc_us nullable
- error_code nullable

## health_nodes
Represents Core/DB/worker/connection/storage/monitor components.
- id PK
- node_type
- node_key
- parent_node_id nullable
- health_state
- last_heartbeat_at_utc_us
- freshness_threshold_ms
- details_json

## diagnostic_bundles
- id PK
- actor_id FK
- project_id nullable
- created_at_utc_us
- manifest_hash
- storage_object_id FK
- redaction_policy_version
- included_classes_json
- excluded_sensitive_classes_json

Diagnostic bundles never include credentials and do not include raw unreleased media unless explicitly selected.

# 35. Technical-media additions for editorial conform

Extend technical_metadata with:
- source_start_timecode_num/den or frame count equivalent
- source_timecode_rate_num/den
- drop_frame BOOL nullable
- reel_name nullable
- camera_media_id nullable
- recording_start_utc_us nullable
- rotation_degrees nullable
- field_order nullable
- variable_frame_rate BOOL
- audio_start_sample nullable

Handoff manifests include:
- stable media UUID;
- source/reel identifiers;
- handles;
- conform map;
- proxy-to-original mapping;
- timeline start timecode.

# 36. Schema saturation rule

After multi-role red-team, a new implementation should first attempt to map to these existing ownership domains:
- command/action;
- entity/revision;
- dependency/staleness;
- policy/rights;
- job/resource;
- asset/storage;
- review/evidence;
- timeline/story/canon;
- deliverable/release.

If a new problem cannot be expressed without abusing one of those domains, create an architecture decision before adding an ad-hoc field/table.


# 37. Creative variant / branch domain

Revision parentage allows branching, but user-facing A/B experimentation needs an explicit comparison/promote domain.

## variant_groups
- id PK FK entity_registry
- project_id FK
- subject_entity_id FK entity_registry
- base_revision_id FK revision_registry
- variant_type: CHARACTER | SCENE | SHOT | TIMELINE | STYLE | AUDIO | OTHER
- title
- state: OPEN | COMPARING | RESOLVED | ARCHIVED
- promoted_revision_id nullable FK revision_registry
- created_by_actor_id
- created_at_utc_us
- row_version

## variant_candidates
- id PK
- variant_group_id FK
- revision_id FK revision_registry
- label
- candidate_state: ACTIVE | REJECTED | PROMOTED | ARCHIVED
- created_at_utc_us
UNIQUE(variant_group_id, revision_id)

Rules:
- creating a variant never mutates the base revision;
- multiple candidates may share the same base parent;
- only one candidate may be PROMOTED per resolved group;
- promotion is an explicit command and may create downstream staleness/impact;
- losing candidates remain inspectable unless retention policy explicitly archives/purges their rebuildable artifacts.


# 38. Storage root capability constraints

Extend `storage_roots` with capability metadata:
- path_kind: LOCAL_FIXED | LOCAL_REMOVABLE | NETWORK_UNC | SYNCED_FOLDER | OTHER
- db_supported BOOL
- atomic_rename_supported nullable
- locking_profile
- case_sensitivity_profile
- long_path_supported nullable
- availability_state

The active SQLite Core DB root is not a generic `storage_roots` choice.
It has a separately validated `core_database_location` record/config with:
- normalized_path
- volume_id
- filesystem_type
- supported_profile_version
- validation_state
- last_validated_at_utc_us

Policy:
- production SQLite WAL requires a profile explicitly marked db_supported;
- V1 defaults to supported local fixed storage;
- network/sync/removable paths are rejected or require a future explicit tested profile.

## Export path mappings

For handoff/export, record:
- logical_name
- emitted_relative_path
- sanitization_reason nullable
- collision_suffix nullable

This keeps human-readable naming reversible/auditable across Windows path restrictions.

# 39. Web automation permission

Extend connection/provider policy with:
- automation_permission: ALLOWED | ASSISTED_ONLY | MANUAL_ONLY | UNKNOWN | BLOCKED
- automation_permission_source
- provider_terms_snapshot_id nullable
- reviewed_at_utc_us nullable

An UNKNOWN permission cannot be interpreted as ALLOWED.


# 40. Slice-driven migration rule

This document is a target domain catalog, not an instruction to create every table in the first migration.

Implementation rule:
- create only schema required by the current approved vertical slice plus foundational registries/contracts it actually exercises;
- do not create dozens of unused placeholder tables merely to “match the document”;
- each migration has executable use/tests in the same or immediately dependent slice;
- future tables remain documented design until their feature slice begins;
- foundational naming/identity/revision conventions must remain compatible with later additions.

This avoids big-bang schema work becoming the first delivery bottleneck.


# Extreme hardening extension

For adversarially discovered schema additions (recovery epochs, Core fencing, egress manifests, resource reservations, callback authenticity, SBOM, integrity auditing, bulk snapshots, signing/package retention and release stream manifests), use `docs/design/EXTREME_HARDENING_CONTRACTS.md` as the single detailed implementation owner.
