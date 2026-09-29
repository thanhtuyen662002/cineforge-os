import { uuidv7, nowUtcUs } from './ids.mjs';
import { idempotencyFingerprint } from './canonical.mjs';

export const SCHEMA_VERSION = 16;

/**
 * Configure and migrate the single Core writer database.
 *
 * The Core owns this connection.  UI/worker callers use the API boundary and
 * never receive the DatabaseSync instance.
 */
export function initializeDatabase(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at_utc_us INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS studios (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      default_locale TEXT NOT NULL DEFAULT 'vi-VN',
      created_at_utc_us INTEGER NOT NULL,
      row_version INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS actors (
      id TEXT PRIMARY KEY,
      studio_id TEXT NOT NULL REFERENCES studios(id),
      actor_type TEXT NOT NULL CHECK (actor_type IN ('HUMAN', 'SYSTEM', 'AGENT')),
      display_name TEXT NOT NULL,
      locale TEXT NOT NULL DEFAULT 'vi-VN',
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
      created_at_utc_us INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      studio_id TEXT NOT NULL REFERENCES studios(id),
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      lifecycle_state TEXT NOT NULL DEFAULT 'ACTIVE'
        CHECK (lifecycle_state IN ('ACTIVE', 'PAUSED', 'ARCHIVED', 'TRASHED')),
      default_language TEXT NOT NULL DEFAULT 'vi-VN',
      created_by_actor_id TEXT NOT NULL REFERENCES actors(id),
      created_at_utc_us INTEGER NOT NULL,
      updated_at_utc_us INTEGER NOT NULL,
      row_version INTEGER NOT NULL DEFAULT 1,
      UNIQUE(studio_id, code)
    );

    /*
     * A media profile is the explicit technical contract that a timeline
     * pins.  Rate/time-base values are rational integers; no timeline may
     * silently invent a 24/25/30 fps or millisecond default.
     */
    CREATE TABLE IF NOT EXISTS project_media_profiles (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL UNIQUE REFERENCES projects(id),
      created_by_actor_id TEXT NOT NULL REFERENCES actors(id),
      created_at_utc_us INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_media_profile_revisions (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES project_media_profiles(id),
      revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
      lifecycle_state TEXT NOT NULL DEFAULT 'CANDIDATE'
        CHECK (lifecycle_state IN ('DRAFT', 'CANDIDATE', 'APPROVED', 'SUPERSEDED', 'REJECTED')),
      timeline_rate_num INTEGER NOT NULL CHECK (timeline_rate_num > 0),
      timeline_rate_den INTEGER NOT NULL CHECK (timeline_rate_den > 0),
      time_base_num INTEGER NOT NULL CHECK (time_base_num > 0),
      time_base_den INTEGER NOT NULL CHECK (time_base_den > 0),
      width INTEGER NOT NULL CHECK (width > 0),
      height INTEGER NOT NULL CHECK (height > 0),
      pixel_aspect_num INTEGER NOT NULL CHECK (pixel_aspect_num > 0),
      pixel_aspect_den INTEGER NOT NULL CHECK (pixel_aspect_den > 0),
      working_color_space TEXT NOT NULL,
      transfer_function TEXT NOT NULL,
      hdr_policy TEXT NOT NULL,
      audio_sample_rate INTEGER NOT NULL CHECK (audio_sample_rate > 0),
      audio_channel_layout TEXT NOT NULL,
      proxy_profile_json TEXT NOT NULL DEFAULT '{}',
      mastering_targets_json TEXT NOT NULL DEFAULT '{}',
      created_by_actor_id TEXT NOT NULL REFERENCES actors(id),
      created_at_utc_us INTEGER NOT NULL,
      row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
      UNIQUE(profile_id, revision_number)
    );
    CREATE INDEX IF NOT EXISTS project_media_profile_revisions_idx
      ON project_media_profile_revisions(profile_id, revision_number DESC);

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'PLANNED'
        CHECK (status IN ('PLANNED', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED')),
      priority INTEGER NOT NULL DEFAULT 0,
      created_by_actor_id TEXT NOT NULL REFERENCES actors(id),
      created_at_utc_us INTEGER NOT NULL,
      updated_at_utc_us INTEGER NOT NULL,
      row_version INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS shots (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      lifecycle_state TEXT NOT NULL DEFAULT 'ACTIVE'
        CHECK (lifecycle_state IN ('ACTIVE', 'PAUSED', 'ARCHIVED', 'TRASHED')),
      created_by_actor_id TEXT NOT NULL REFERENCES actors(id),
      created_at_utc_us INTEGER NOT NULL,
      updated_at_utc_us INTEGER NOT NULL,
      row_version INTEGER NOT NULL DEFAULT 1,
      UNIQUE(project_id, code)
    );

    /*
     * Rights identity is deliberately separate from bytes and asset identity.
     * One asset can have multiple evidence revisions over time, and identical
     * bytes can be used under different legal/consent scopes.  Evidence rows
     * are append-only; a revocation is a new fact, never an edit to history.
     */
    CREATE TABLE IF NOT EXISTS rights_identities (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id),
      subject_type TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_by_actor_id TEXT NOT NULL REFERENCES actors(id),
      created_at_utc_us INTEGER NOT NULL,
      UNIQUE(subject_type, subject_id)
    );
    CREATE INDEX IF NOT EXISTS rights_identities_project_idx
      ON rights_identities(project_id, created_at_utc_us DESC);

    CREATE TABLE IF NOT EXISTS rights_records (
      id TEXT PRIMARY KEY,
      rights_identity_id TEXT NOT NULL REFERENCES rights_identities(id),
      right_type TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('ALLOWED', 'RESTRICTED', 'UNKNOWN', 'REVOKED', 'EXPIRED')),
      territory_json TEXT NOT NULL DEFAULT '[]',
      purpose_json TEXT NOT NULL DEFAULT '{}',
      valid_from_utc_us INTEGER,
      valid_to_utc_us INTEGER,
      commercial_allowed INTEGER CHECK (commercial_allowed IS NULL OR commercial_allowed IN (0, 1)),
      derivative_allowed INTEGER CHECK (derivative_allowed IS NULL OR derivative_allowed IN (0, 1)),
      training_allowed INTEGER CHECK (training_allowed IS NULL OR training_allowed IN (0, 1)),
      cloning_allowed INTEGER CHECK (cloning_allowed IS NULL OR cloning_allowed IN (0, 1)),
      attribution_required INTEGER CHECK (attribution_required IS NULL OR attribution_required IN (0, 1)),
      evidence_snapshot_id TEXT,
      evidence_summary_json TEXT NOT NULL DEFAULT '{}',
      created_by_actor_id TEXT NOT NULL REFERENCES actors(id),
      created_at_utc_us INTEGER NOT NULL,
      CHECK (valid_to_utc_us IS NULL OR valid_from_utc_us IS NULL OR valid_to_utc_us > valid_from_utc_us)
    );
    CREATE INDEX IF NOT EXISTS rights_records_identity_idx
      ON rights_records(rights_identity_id, right_type, created_at_utc_us DESC);

    CREATE TABLE IF NOT EXISTS consents (
      id TEXT PRIMARY KEY,
      rights_identity_id TEXT NOT NULL REFERENCES rights_identities(id),
      consent_type TEXT NOT NULL,
      granted_by TEXT NOT NULL,
      evidence_asset_revision_id TEXT,
      valid_from_utc_us INTEGER NOT NULL,
      valid_to_utc_us INTEGER,
      created_by_actor_id TEXT NOT NULL REFERENCES actors(id),
      created_at_utc_us INTEGER NOT NULL,
      CHECK (valid_to_utc_us IS NULL OR valid_to_utc_us > valid_from_utc_us)
    );
    CREATE INDEX IF NOT EXISTS consents_identity_idx
      ON consents(rights_identity_id, consent_type, created_at_utc_us DESC);

    CREATE TABLE IF NOT EXISTS revocations (
      id TEXT PRIMARY KEY,
      rights_identity_id TEXT NOT NULL REFERENCES rights_identities(id),
      right_type TEXT,
      consent_type TEXT,
      reason TEXT NOT NULL,
      effective_at_utc_us INTEGER NOT NULL,
      command_id TEXT NOT NULL REFERENCES commands(id),
      created_at_utc_us INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS revocations_identity_idx
      ON revocations(rights_identity_id, effective_at_utc_us DESC);

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      entity_type TEXT NOT NULL CHECK (entity_type IN ('PROJECT', 'TASK', 'SHOT')),
      entity_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_by_actor_id TEXT NOT NULL REFERENCES actors(id),
      created_at_utc_us INTEGER NOT NULL
    );

    /*
     * Canonical human decision inbox.  A DecisionRequest is durable domain
     * state, not a presentation notification: its choices and evidence are
     * immutable, while the request state advances through Core commands with
     * optimistic decision-version checks.  JSON fields carry structured,
     * locale-neutral arguments and evidence references; they are never
     * interpreted as executable commands by this table.
     */
    CREATE TABLE IF NOT EXISTS decision_requests (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id),
      decision_type TEXT NOT NULL,
      title_key TEXT NOT NULL,
      reason_key TEXT NOT NULL,
      reason_args_json TEXT NOT NULL DEFAULT '{}',
      blocking_scope_type TEXT NOT NULL
        CHECK (blocking_scope_type IN ('TASK', 'SHOT', 'SCENE', 'PROJECT', 'RELEASE', 'SYSTEM')),
      blocking_scope_id TEXT,
      affected_entities_json TEXT NOT NULL DEFAULT '[]',
      evidence_json TEXT NOT NULL DEFAULT '[]',
      default_behavior_json TEXT NOT NULL DEFAULT '{}',
      severity TEXT NOT NULL DEFAULT 'NORMAL'
        CHECK (severity IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),
      state TEXT NOT NULL DEFAULT 'OPEN'
        CHECK (state IN ('OPEN', 'RESOLVED', 'DISMISSED', 'EXPIRED', 'OBSOLETE')),
      recommended_choice_id TEXT,
      deadline_at_utc_us INTEGER,
      required_authority TEXT NOT NULL DEFAULT 'LOCAL_ACTOR',
      created_by_event_seq INTEGER NOT NULL,
      created_at_utc_us INTEGER NOT NULL,
      updated_at_utc_us INTEGER NOT NULL,
      row_version INTEGER NOT NULL DEFAULT 1,
      resolved_choice_id TEXT,
      resolved_by_actor_id TEXT REFERENCES actors(id),
      resolved_at_utc_us INTEGER
    );
    CREATE INDEX IF NOT EXISTS decision_requests_project_state_idx
      ON decision_requests(project_id, state, severity, created_at_utc_us DESC);
    CREATE INDEX IF NOT EXISTS decision_requests_scope_idx
      ON decision_requests(blocking_scope_type, blocking_scope_id, state);

    CREATE TABLE IF NOT EXISTS decision_choices (
      id TEXT PRIMARY KEY,
      decision_request_id TEXT NOT NULL REFERENCES decision_requests(id),
      label_key TEXT NOT NULL,
      command_template_json TEXT NOT NULL DEFAULT '{}',
      consequence_summary_json TEXT NOT NULL DEFAULT '{}',
      recommended INTEGER NOT NULL DEFAULT 0 CHECK (recommended IN (0, 1)),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at_utc_us INTEGER NOT NULL,
      UNIQUE(decision_request_id, sort_order)
    );
    CREATE INDEX IF NOT EXISTS decision_choices_request_idx
      ON decision_choices(decision_request_id, sort_order, id);

    /*
     * Asset/intake foundation.  The database records identity, provenance
     * and references only; media bytes live in the content-addressed local
     * object store managed by Core.  Asset revisions, storage objects and
     * provenance records are immutable once registered.  A new import or
     * transform creates a new row instead of replacing approved bytes.
     */
    CREATE TABLE IF NOT EXISTS storage_objects (
      id TEXT PRIMARY KEY,
      hash_algorithm TEXT NOT NULL CHECK (hash_algorithm IN ('SHA-256')),
      content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
      byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
      storage_class TEXT NOT NULL DEFAULT 'LOCAL_MANAGED',
      verified_at_utc_us INTEGER NOT NULL,
      created_at_utc_us INTEGER NOT NULL,
      UNIQUE(hash_algorithm, content_hash)
    );

    /*
     * Durable ingest staging.  Bytes remain outside canonical asset identity
     * until the REGISTERED transition is committed.  Identity/digest fields
     * are immutable evidence; state/current_size are lifecycle fields.
     */
    CREATE TABLE IF NOT EXISTS staging_objects (
      id TEXT PRIMARY KEY,
      command_id TEXT,
      job_attempt_id TEXT,
      import_item_id TEXT,
      temp_path TEXT NOT NULL,
      expected_size INTEGER CHECK (expected_size IS NULL OR expected_size >= 0),
      current_size INTEGER NOT NULL DEFAULT 0 CHECK (current_size >= 0),
      hash_algorithm TEXT CHECK (hash_algorithm IS NULL OR hash_algorithm IN ('SHA-256')),
      sha256 TEXT CHECK (sha256 IS NULL OR length(sha256) = 64),
      source_path_fingerprint TEXT,
      source_file_identity_json TEXT,
      os_file_identity_json TEXT,
      reparse_state TEXT NOT NULL DEFAULT 'UNKNOWN'
        CHECK (reparse_state IN ('UNKNOWN', 'NOT_REPARSE', 'REPARSE_REJECTED')),
      finalization_identity_json TEXT,
      state TEXT NOT NULL DEFAULT 'WRITING'
        CHECK (state IN ('WRITING', 'COMPLETE', 'VERIFIED', 'REGISTERED', 'ORPHANED', 'QUARANTINED', 'FAILED')),
      row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
      created_at_utc_us INTEGER NOT NULL,
      updated_at_utc_us INTEGER NOT NULL,
      UNIQUE(command_id)
    );
    CREATE INDEX IF NOT EXISTS staging_objects_state_idx
      ON staging_objects(state, updated_at_utc_us DESC);
    CREATE INDEX IF NOT EXISTS staging_objects_import_idx
      ON staging_objects(import_item_id, created_at_utc_us DESC);

    CREATE TABLE IF NOT EXISTS storage_object_locations (
      id TEXT PRIMARY KEY,
      storage_object_id TEXT NOT NULL REFERENCES storage_objects(id),
      storage_root TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      location_role TEXT NOT NULL CHECK (location_role IN ('PRIMARY', 'MIRROR', 'BACKUP', 'STAGING_RECOVERED')),
      state TEXT NOT NULL CHECK (state IN ('AVAILABLE', 'MISSING', 'CORRUPT', 'OFFLINE')),
      last_verified_at_utc_us INTEGER,
      created_at_utc_us INTEGER NOT NULL,
      UNIQUE(storage_object_id, storage_root, relative_path)
    );

    CREATE TABLE IF NOT EXISTS provenance_records (
      id TEXT PRIMARY KEY,
      origin_type TEXT NOT NULL,
      source_description TEXT NOT NULL DEFAULT '',
      source_path_or_uri TEXT,
      source_path_fingerprint TEXT,
      source_metadata_json TEXT NOT NULL DEFAULT '{}',
      created_by_actor_id TEXT NOT NULL REFERENCES actors(id),
      created_at_utc_us INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id),
      rights_identity_id TEXT,
      asset_type TEXT NOT NULL,
      display_name TEXT NOT NULL,
      origin_type TEXT NOT NULL CHECK (origin_type IN ('IMPORTED', 'GENERATED', 'RECORDED', 'EXTERNAL_EDIT', 'HANDOFF_RETURN', 'SYSTEM')),
      lifecycle_state TEXT NOT NULL DEFAULT 'ACTIVE'
        CHECK (lifecycle_state IN ('ACTIVE', 'ARCHIVED', 'TRASHED')),
      created_by_actor_id TEXT NOT NULL REFERENCES actors(id),
      created_at_utc_us INTEGER NOT NULL,
      updated_at_utc_us INTEGER NOT NULL,
      row_version INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS assets_project_idx ON assets(project_id, created_at_utc_us DESC);

    CREATE TABLE IF NOT EXISTS asset_revisions (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL REFERENCES assets(id),
      revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
      storage_object_id TEXT NOT NULL REFERENCES storage_objects(id),
      provenance_record_id TEXT NOT NULL REFERENCES provenance_records(id),
      semantic_role TEXT NOT NULL DEFAULT 'UNCLASSIFIED',
      availability_state TEXT NOT NULL CHECK (availability_state IN ('AVAILABLE', 'MISSING', 'CORRUPT', 'QUARANTINED')),
      review_state TEXT NOT NULL DEFAULT 'UNREVIEWED'
        CHECK (review_state IN ('UNREVIEWED', 'CANDIDATE', 'APPROVED', 'REJECTED')),
      rebuildability TEXT NOT NULL DEFAULT 'ORIGINAL'
        CHECK (rebuildability IN ('ORIGINAL', 'CANONICAL', 'REBUILDABLE', 'EPHEMERAL')),
      availability_evidence_state TEXT NOT NULL DEFAULT 'UNKNOWN'
        CHECK (availability_evidence_state IN ('UNKNOWN', 'VERIFIED')),
      created_by_actor_id TEXT NOT NULL REFERENCES actors(id),
      created_at_utc_us INTEGER NOT NULL,
      UNIQUE(asset_id, revision_number)
    );
    CREATE INDEX IF NOT EXISTS asset_revisions_asset_idx ON asset_revisions(asset_id, revision_number DESC);

    CREATE TABLE IF NOT EXISTS asset_locations (
      id TEXT PRIMARY KEY,
      asset_revision_id TEXT NOT NULL REFERENCES asset_revisions(id),
      location_type TEXT NOT NULL CHECK (location_type IN ('MANAGED_OBJECT', 'EXTERNAL_PATH', 'MIRROR', 'EXPORT')),
      path_or_uri TEXT NOT NULL,
      path_fingerprint TEXT,
      status TEXT NOT NULL CHECK (status IN ('AVAILABLE', 'MISSING', 'CORRUPT', 'OFFLINE', 'UNVERIFIED')),
      last_verified_at_utc_us INTEGER,
      created_at_utc_us INTEGER NOT NULL,
      UNIQUE(asset_revision_id, location_type, path_or_uri)
    );
    CREATE INDEX IF NOT EXISTS asset_locations_revision_idx ON asset_locations(asset_revision_id);

    CREATE TABLE IF NOT EXISTS import_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id),
      actor_id TEXT NOT NULL REFERENCES actors(id),
      state TEXT NOT NULL CHECK (state IN ('RECEIVED', 'SCANNING', 'READY', 'COMMITTED', 'FAILED', 'CANCELLED')),
      source_kind TEXT NOT NULL,
      source_root TEXT,
      intent_hint TEXT,
      created_at_utc_us INTEGER NOT NULL,
      updated_at_utc_us INTEGER NOT NULL,
      row_version INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS import_sessions_project_idx ON import_sessions(project_id, created_at_utc_us DESC);

    CREATE TABLE IF NOT EXISTS import_items (
      id TEXT PRIMARY KEY,
      import_session_id TEXT NOT NULL REFERENCES import_sessions(id),
      original_name TEXT NOT NULL,
      detected_mime TEXT,
      byte_size INTEGER,
      source_path_or_uri TEXT NOT NULL,
      source_path_fingerprint TEXT,
      ingest_state TEXT NOT NULL CHECK (ingest_state IN ('RECEIVED', 'HASHED', 'READY', 'COMMITTED', 'FAILED', 'CANCELLED')),
      hash_algorithm TEXT,
      content_hash TEXT,
      decode_status TEXT NOT NULL DEFAULT 'UNKNOWN',
      security_status TEXT NOT NULL DEFAULT 'UNKNOWN',
      resulting_asset_id TEXT REFERENCES assets(id),
      resulting_revision_id TEXT REFERENCES asset_revisions(id),
      error_code TEXT,
      created_at_utc_us INTEGER NOT NULL,
      UNIQUE(import_session_id, source_path_fingerprint)
    );
    CREATE INDEX IF NOT EXISTS import_items_session_idx ON import_items(import_session_id, created_at_utc_us ASC);

    /*
     * Character canon is deliberately split into a stable identity and
     * independent package/revision streams.  No image path, outfit or
     * provider voice identifier belongs on characters.  Revision content is
     * append-only; Core may advance only the lifecycle state and row version.
     */
    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      stable_code TEXT NOT NULL,
      display_name TEXT NOT NULL,
      lifecycle_state TEXT NOT NULL DEFAULT 'ACTIVE'
        CHECK (lifecycle_state IN ('ACTIVE', 'ARCHIVED', 'RETIRED')),
      created_by_actor_id TEXT NOT NULL REFERENCES actors(id),
      created_at_utc_us INTEGER NOT NULL,
      updated_at_utc_us INTEGER NOT NULL,
      row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
      UNIQUE(project_id, stable_code)
    );
    CREATE INDEX IF NOT EXISTS characters_project_idx
      ON characters(project_id, lifecycle_state, created_at_utc_us DESC, id DESC);

    CREATE TABLE IF NOT EXISTS visual_identity_packages (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL UNIQUE REFERENCES characters(id),
      created_by_actor_id TEXT NOT NULL REFERENCES actors(id),
      created_at_utc_us INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS visual_identity_revisions (
      id TEXT PRIMARY KEY,
      package_id TEXT NOT NULL REFERENCES visual_identity_packages(id),
      revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
      lifecycle_state TEXT NOT NULL DEFAULT 'DRAFT'
        CHECK (lifecycle_state IN ('DRAFT', 'CANDIDATE', 'APPROVED', 'SUPERSEDED', 'REJECTED')),
      semantic_description TEXT NOT NULL DEFAULT '',
      anatomy_json TEXT NOT NULL DEFAULT '{}',
      proportion_json TEXT NOT NULL DEFAULT '{}',
      palette_json TEXT NOT NULL DEFAULT '{}',
      marking_json TEXT NOT NULL DEFAULT '{}',
      forbidden_drift_json TEXT NOT NULL DEFAULT '{}',
      created_by_actor_id TEXT NOT NULL REFERENCES actors(id),
      created_at_utc_us INTEGER NOT NULL,
      row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
      UNIQUE(package_id, revision_number)
    );
    CREATE INDEX IF NOT EXISTS visual_identity_revisions_package_idx
      ON visual_identity_revisions(package_id, revision_number DESC);

    CREATE TABLE IF NOT EXISTS visual_identity_references (
      visual_identity_revision_id TEXT NOT NULL REFERENCES visual_identity_revisions(id),
      asset_revision_id TEXT NOT NULL REFERENCES asset_revisions(id),
      reference_role TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0 CHECK (priority >= 0),
      created_at_utc_us INTEGER NOT NULL,
      PRIMARY KEY(visual_identity_revision_id, asset_revision_id, reference_role)
    );
    CREATE INDEX IF NOT EXISTS visual_identity_references_asset_idx
      ON visual_identity_references(asset_revision_id);

    CREATE TABLE IF NOT EXISTS voice_identity_packages (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL UNIQUE REFERENCES characters(id),
      created_by_actor_id TEXT NOT NULL REFERENCES actors(id),
      created_at_utc_us INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS voice_identity_revisions (
      id TEXT PRIMARY KEY,
      package_id TEXT NOT NULL REFERENCES voice_identity_packages(id),
      revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
      lifecycle_state TEXT NOT NULL DEFAULT 'DRAFT'
        CHECK (lifecycle_state IN ('DRAFT', 'CANDIDATE', 'APPROVED', 'SUPERSEDED', 'REJECTED')),
      semantic_description TEXT NOT NULL DEFAULT '',
      canonical_language TEXT NOT NULL DEFAULT 'vi-VN',
      accent_profile_json TEXT NOT NULL DEFAULT '{}',
      vocal_range_json TEXT NOT NULL DEFAULT '{}',
      timbre_json TEXT NOT NULL DEFAULT '{}',
      prosody_json TEXT NOT NULL DEFAULT '{}',
      emotional_map_json TEXT NOT NULL DEFAULT '{}',
      pronunciation_lexicon_json TEXT NOT NULL DEFAULT '{}',
      forbidden_traits_json TEXT NOT NULL DEFAULT '{}',
      rights_identity_id TEXT REFERENCES rights_identities(id),
      created_by_actor_id TEXT NOT NULL REFERENCES actors(id),
      created_at_utc_us INTEGER NOT NULL,
      row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
      UNIQUE(package_id, revision_number)
    );
    CREATE INDEX IF NOT EXISTS voice_identity_revisions_package_idx
      ON voice_identity_revisions(package_id, revision_number DESC);

    CREATE TABLE IF NOT EXISTS performance_bibles (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL UNIQUE REFERENCES characters(id),
      created_by_actor_id TEXT NOT NULL REFERENCES actors(id),
      created_at_utc_us INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS performance_bible_revisions (
      id TEXT PRIMARY KEY,
      performance_bible_id TEXT NOT NULL REFERENCES performance_bibles(id),
      revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
      lifecycle_state TEXT NOT NULL DEFAULT 'DRAFT'
        CHECK (lifecycle_state IN ('DRAFT', 'CANDIDATE', 'APPROVED', 'SUPERSEDED', 'REJECTED')),
      posture_json TEXT NOT NULL DEFAULT '{}',
      gait_json TEXT NOT NULL DEFAULT '{}',
      gestures_json TEXT NOT NULL DEFAULT '{}',
      eye_behavior_json TEXT NOT NULL DEFAULT '{}',
      reaction_timing_json TEXT NOT NULL DEFAULT '{}',
      speech_rhythm_json TEXT NOT NULL DEFAULT '{}',
      emotional_baseline_json TEXT NOT NULL DEFAULT '{}',
      forbidden_drift_json TEXT NOT NULL DEFAULT '{}',
      created_by_actor_id TEXT NOT NULL REFERENCES actors(id),
      created_at_utc_us INTEGER NOT NULL,
      row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
      UNIQUE(performance_bible_id, revision_number)
    );
    CREATE INDEX IF NOT EXISTS performance_bible_revisions_bible_idx
      ON performance_bible_revisions(performance_bible_id, revision_number DESC);

    /*
     * Provider-neutral editorial checkpoint baseline.  Tracks and clips are
     * immutable children of an immutable revision; lifecycle/row_version on
     * the revision are the only mutable fields.  Rational ranges are stored
     * as integer numerator/denominator pairs so floating-point time can never
     * become canonical state.
     */
    CREATE TABLE IF NOT EXISTS timelines (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      scope_type TEXT NOT NULL DEFAULT 'PROJECT' CHECK (scope_type = 'PROJECT'),
      scope_id TEXT NOT NULL,
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      lifecycle_state TEXT NOT NULL DEFAULT 'ACTIVE'
        CHECK (lifecycle_state IN ('ACTIVE', 'ARCHIVED', 'TRASHED')),
      created_by_actor_id TEXT NOT NULL REFERENCES actors(id),
      created_at_utc_us INTEGER NOT NULL,
      updated_at_utc_us INTEGER NOT NULL,
      row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
      UNIQUE(project_id, code),
      UNIQUE(scope_type, scope_id)
    );
    CREATE INDEX IF NOT EXISTS timelines_project_idx
      ON timelines(project_id, lifecycle_state, created_at_utc_us DESC, id DESC);

    CREATE TABLE IF NOT EXISTS timeline_revisions (
      id TEXT PRIMARY KEY,
      timeline_id TEXT NOT NULL REFERENCES timelines(id),
      media_profile_revision_id TEXT NOT NULL REFERENCES project_media_profile_revisions(id),
      revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
      lifecycle_state TEXT NOT NULL DEFAULT 'DRAFT_CHECKPOINT'
        CHECK (lifecycle_state IN ('DRAFT_CHECKPOINT', 'CANDIDATE', 'APPROVED', 'SUPERSEDED')),
      duration_num INTEGER NOT NULL CHECK (duration_num > 0),
      duration_den INTEGER NOT NULL CHECK (duration_den > 0),
      content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
      created_by_actor_id TEXT NOT NULL REFERENCES actors(id),
      created_at_utc_us INTEGER NOT NULL,
      row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
      UNIQUE(timeline_id, revision_number)
    );
    CREATE INDEX IF NOT EXISTS timeline_revisions_timeline_idx
      ON timeline_revisions(timeline_id, revision_number DESC);

    CREATE TABLE IF NOT EXISTS timeline_tracks (
      id TEXT PRIMARY KEY,
      timeline_revision_id TEXT NOT NULL REFERENCES timeline_revisions(id),
      track_type TEXT NOT NULL CHECK (track_type IN ('VIDEO', 'AUDIO', 'CAPTION', 'DATA')),
      order_index INTEGER NOT NULL CHECK (order_index >= 0),
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      created_at_utc_us INTEGER NOT NULL,
      UNIQUE(timeline_revision_id, order_index)
    );
    CREATE INDEX IF NOT EXISTS timeline_tracks_revision_idx
      ON timeline_tracks(timeline_revision_id, order_index ASC, id ASC);

    CREATE TABLE IF NOT EXISTS timeline_clip_instances (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL REFERENCES timeline_tracks(id),
      asset_revision_id TEXT REFERENCES asset_revisions(id),
      source_in_num INTEGER,
      source_in_den INTEGER,
      source_out_num INTEGER,
      source_out_den INTEGER,
      timeline_in_num INTEGER NOT NULL CHECK (timeline_in_num >= 0),
      timeline_in_den INTEGER NOT NULL CHECK (timeline_in_den > 0),
      timeline_out_num INTEGER NOT NULL CHECK (timeline_out_num > 0),
      timeline_out_den INTEGER NOT NULL CHECK (timeline_out_den > 0),
      speed_num INTEGER NOT NULL DEFAULT 1 CHECK (speed_num > 0),
      speed_den INTEGER NOT NULL DEFAULT 1 CHECK (speed_den > 0),
      created_at_utc_us INTEGER NOT NULL,
      CHECK ((asset_revision_id IS NULL AND source_in_num IS NULL AND source_in_den IS NULL AND source_out_num IS NULL AND source_out_den IS NULL)
        OR (asset_revision_id IS NOT NULL AND source_in_num IS NOT NULL AND source_in_den IS NOT NULL AND source_out_num IS NOT NULL AND source_out_den IS NOT NULL)),
      CHECK (source_in_num IS NULL OR source_in_num >= 0),
      CHECK (source_in_den IS NULL OR source_in_den > 0),
      CHECK (source_out_num IS NULL OR source_out_num > 0),
      CHECK (source_out_den IS NULL OR source_out_den > 0)
    );
    CREATE INDEX IF NOT EXISTS timeline_clips_track_idx
      ON timeline_clip_instances(track_id, timeline_in_num, timeline_in_den, id);

    CREATE TABLE IF NOT EXISTS timeline_markers (
      id TEXT PRIMARY KEY,
      timeline_revision_id TEXT NOT NULL REFERENCES timeline_revisions(id),
      position_num INTEGER NOT NULL CHECK (position_num >= 0),
      position_den INTEGER NOT NULL CHECK (position_den > 0),
      marker_type TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at_utc_us INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS timeline_markers_revision_idx
      ON timeline_markers(timeline_revision_id, position_num, position_den, id);

    /*
     * V1 local timeline editing. A working session is mutable draft state
     * pinned to one exact immutable checkpoint. Edit operations retain their
     * before/after snapshots so undo/redo can be causal and deterministic
     * without rewriting canonical revisions. The unique active-session index
     * below keeps this bounded slice single-actor and avoids silent LWW.
     */
    CREATE TABLE IF NOT EXISTS timeline_working_sessions (
      id TEXT PRIMARY KEY,
      timeline_id TEXT NOT NULL REFERENCES timelines(id),
      base_revision_id TEXT NOT NULL REFERENCES timeline_revisions(id),
      base_revision_row_version INTEGER NOT NULL CHECK (base_revision_row_version >= 1),
      base_content_hash TEXT NOT NULL CHECK (length(base_content_hash) = 64),
      actor_id TEXT NOT NULL REFERENCES actors(id),
      client_instance_id TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'EXCLUSIVE'
        CHECK (mode IN ('EXCLUSIVE', 'BRANCH_REQUIRED')),
      state TEXT NOT NULL DEFAULT 'OPEN'
        CHECK (state IN ('OPEN', 'DIRTY', 'AUTOSAVING', 'CHECKPOINTING', 'CLEAN', 'CONFLICT', 'RECOVERY_REQUIRED', 'CLOSED', 'ABANDONED')),
      draft_payload_json TEXT NOT NULL DEFAULT '{}',
      draft_hash TEXT NOT NULL CHECK (length(draft_hash) = 64),
      autosaved_hash TEXT NOT NULL CHECK (length(autosaved_hash) = 64),
      last_acknowledged_op_seq INTEGER NOT NULL DEFAULT 0 CHECK (last_acknowledged_op_seq >= 0),
      history_cursor_seq INTEGER NOT NULL DEFAULT 0 CHECK (history_cursor_seq >= 0),
      next_op_seq INTEGER NOT NULL DEFAULT 1 CHECK (next_op_seq >= 1),
      last_checkpoint_revision_id TEXT REFERENCES timeline_revisions(id),
      next_step TEXT,
      row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
      last_autosave_at_utc_us INTEGER,
      created_at_utc_us INTEGER NOT NULL,
      updated_at_utc_us INTEGER NOT NULL,
      closed_at_utc_us INTEGER
    );
    CREATE INDEX IF NOT EXISTS timeline_working_sessions_timeline_idx
      ON timeline_working_sessions(timeline_id, state, updated_at_utc_us DESC, id DESC);
    CREATE INDEX IF NOT EXISTS timeline_working_sessions_project_idx
      ON timeline_working_sessions(id, timeline_id);
    CREATE UNIQUE INDEX IF NOT EXISTS timeline_working_sessions_active_uq
      ON timeline_working_sessions(timeline_id, actor_id)
      WHERE state IN ('OPEN', 'DIRTY', 'AUTOSAVING', 'CHECKPOINTING', 'CLEAN', 'CONFLICT', 'RECOVERY_REQUIRED');

    CREATE TABLE IF NOT EXISTS timeline_edit_ops (
      id TEXT PRIMARY KEY,
      working_session_id TEXT NOT NULL REFERENCES timeline_working_sessions(id),
      op_seq INTEGER NOT NULL CHECK (op_seq >= 1),
      op_type TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      before_payload_json TEXT NOT NULL DEFAULT '{}',
      after_payload_json TEXT NOT NULL DEFAULT '{}',
      result_hash TEXT NOT NULL CHECK (length(result_hash) = 64),
      history_state TEXT NOT NULL DEFAULT 'ACTIVE'
        CHECK (history_state IN ('ACTIVE', 'UNDONE', 'DISCARDED')),
      actor_id TEXT NOT NULL REFERENCES actors(id),
      client_op_id TEXT,
      created_at_utc_us INTEGER NOT NULL,
      UNIQUE(working_session_id, op_seq)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS timeline_edit_ops_client_uq
      ON timeline_edit_ops(working_session_id, client_op_id)
      WHERE client_op_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS timeline_edit_ops_session_idx
      ON timeline_edit_ops(working_session_id, op_seq ASC);

    /* Undo/redo/discard relations are append-only facts.  The operation row
     * keeps its immutable before/after payload; this separate ledger records
     * every history transition without deleting or rewriting causality. */
    CREATE TABLE IF NOT EXISTS timeline_edit_actions (
      id TEXT PRIMARY KEY,
      working_session_id TEXT NOT NULL REFERENCES timeline_working_sessions(id),
      action_seq INTEGER NOT NULL CHECK (action_seq >= 1),
      action_type TEXT NOT NULL CHECK (action_type IN ('UNDO', 'REDO', 'DISCARD_REDO_BRANCH')),
      target_op_seq INTEGER,
      target_op_id TEXT REFERENCES timeline_edit_ops(id),
      before_hash TEXT NOT NULL CHECK (length(before_hash) = 64),
      after_hash TEXT NOT NULL CHECK (length(after_hash) = 64),
      actor_id TEXT NOT NULL REFERENCES actors(id),
      created_at_utc_us INTEGER NOT NULL,
      UNIQUE(working_session_id, action_seq)
    );
    CREATE INDEX IF NOT EXISTS timeline_edit_actions_session_idx
      ON timeline_edit_actions(working_session_id, action_seq ASC);

    /* Metadata-first audio/subtitle aggregates.  These remain separate from
     * the VIDEO-only timeline snapshot and pin exact timeline content. */
    CREATE TABLE IF NOT EXISTS audio_cues (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      timeline_id TEXT NOT NULL REFERENCES timelines(id),
      cue_type TEXT NOT NULL CHECK (cue_type IN ('DIALOGUE', 'ADR', 'NONVERBAL', 'FOLEY', 'SFX', 'AMBIENCE', 'ROOM_TONE', 'MUSIC', 'SILENCE')),
      title TEXT NOT NULL,
      created_by_actor_id TEXT NOT NULL REFERENCES actors(id),
      created_at_utc_us INTEGER NOT NULL,
      updated_at_utc_us INTEGER NOT NULL,
      row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1)
    );
    CREATE INDEX IF NOT EXISTS audio_cues_project_timeline_idx
      ON audio_cues(project_id, timeline_id, created_at_utc_us DESC, id DESC);

    CREATE TABLE IF NOT EXISTS audio_cue_revisions (
      id TEXT PRIMARY KEY,
      audio_cue_id TEXT NOT NULL REFERENCES audio_cues(id),
      revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
      lifecycle_state TEXT NOT NULL DEFAULT 'DRAFT'
        /* TIMED/REVIEWED remain accepted only for pre-v14 development rows;
         * new Core transitions use DRAFT -> CANDIDATE -> SELECTED. */
        CHECK (lifecycle_state IN ('DRAFT', 'CANDIDATE', 'SELECTED', 'TIMED', 'REVIEWED', 'APPROVED', 'STALE', 'REJECTED')),
      timeline_revision_id TEXT NOT NULL REFERENCES timeline_revisions(id),
      timeline_content_hash TEXT NOT NULL CHECK (length(timeline_content_hash) = 64),
      timing_dependency_hash TEXT NOT NULL CHECK (length(timing_dependency_hash) = 64),
      start_num INTEGER NOT NULL CHECK (start_num >= 0),
      start_den INTEGER NOT NULL CHECK (start_den > 0),
      end_num INTEGER NOT NULL CHECK (end_num > 0),
      end_den INTEGER NOT NULL CHECK (end_den > 0),
      intent_text TEXT NOT NULL DEFAULT '',
      selected_asset_revision_id TEXT REFERENCES asset_revisions(id),
      asset_snapshot_hash TEXT,
      created_by_actor_id TEXT NOT NULL REFERENCES actors(id),
      created_at_utc_us INTEGER NOT NULL,
      row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
      UNIQUE(audio_cue_id, revision_number)
    );
    CREATE INDEX IF NOT EXISTS audio_cue_revisions_timing_idx
      ON audio_cue_revisions(timeline_revision_id, lifecycle_state, start_num, start_den, id);

    CREATE TABLE IF NOT EXISTS subtitle_tracks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      timeline_id TEXT NOT NULL REFERENCES timelines(id),
      locale TEXT NOT NULL,
      title TEXT NOT NULL,
      created_by_actor_id TEXT NOT NULL REFERENCES actors(id),
      created_at_utc_us INTEGER NOT NULL,
      updated_at_utc_us INTEGER NOT NULL,
      row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1)
    );
    CREATE INDEX IF NOT EXISTS subtitle_tracks_project_timeline_idx
      ON subtitle_tracks(project_id, timeline_id, locale, created_at_utc_us DESC, id DESC);

    CREATE TABLE IF NOT EXISTS subtitle_track_revisions (
      id TEXT PRIMARY KEY,
      subtitle_track_id TEXT NOT NULL REFERENCES subtitle_tracks(id),
      revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
      lifecycle_state TEXT NOT NULL DEFAULT 'DRAFT'
        CHECK (lifecycle_state IN ('DRAFT', 'TIMED', 'REVIEWED', 'APPROVED', 'STALE', 'REJECTED')),
      timeline_revision_id TEXT NOT NULL REFERENCES timeline_revisions(id),
      timeline_content_hash TEXT NOT NULL CHECK (length(timeline_content_hash) = 64),
      timing_dependency_hash TEXT NOT NULL CHECK (length(timing_dependency_hash) = 64),
      format_profile TEXT NOT NULL DEFAULT 'TEXT',
      created_by_actor_id TEXT NOT NULL REFERENCES actors(id),
      created_at_utc_us INTEGER NOT NULL,
      row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
      UNIQUE(subtitle_track_id, revision_number)
    );
    CREATE INDEX IF NOT EXISTS subtitle_track_revisions_timing_idx
      ON subtitle_track_revisions(timeline_revision_id, lifecycle_state, revision_number DESC, id DESC);

    CREATE TABLE IF NOT EXISTS subtitle_track_segments (
      id TEXT PRIMARY KEY,
      subtitle_track_revision_id TEXT NOT NULL REFERENCES subtitle_track_revisions(id),
      segment_index INTEGER NOT NULL CHECK (segment_index >= 0),
      start_num INTEGER NOT NULL CHECK (start_num >= 0),
      start_den INTEGER NOT NULL CHECK (start_den > 0),
      end_num INTEGER NOT NULL CHECK (end_num > 0),
      end_den INTEGER NOT NULL CHECK (end_den > 0),
      locale TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at_utc_us INTEGER NOT NULL,
      UNIQUE(subtitle_track_revision_id, segment_index)
    );
    CREATE INDEX IF NOT EXISTS subtitle_track_segments_revision_idx
      ON subtitle_track_segments(subtitle_track_revision_id, segment_index ASC, id ASC);

    /* Compatibility shape for future non-timeline working copies. The V1
     * editor uses timeline_working_sessions as its durable draft source. */
    CREATE TABLE IF NOT EXISTS working_copies (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      base_revision_id TEXT,
      owner_actor_id TEXT NOT NULL REFERENCES actors(id),
      schema_version INTEGER NOT NULL DEFAULT 1,
      draft_payload_json TEXT NOT NULL DEFAULT '{}',
      row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
      autosaved_at_utc_us INTEGER,
      expires_at_utc_us INTEGER,
      UNIQUE(entity_type, entity_id, owner_actor_id)
    );
    CREATE INDEX IF NOT EXISTS working_copies_project_idx
      ON working_copies(project_id, entity_type, entity_id);

    /*
     * Review evidence is a separate immutable aggregate.  A session pins one
     * exact subject/dependency snapshot; the submitted human decision is an
     * append-only fact and can never be rewritten to make a stale approval
     * look current.
     */
    CREATE TABLE IF NOT EXISTS review_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      subject_type TEXT NOT NULL CHECK (subject_type IN ('TIMELINE_REVISION')),
      subject_id TEXT NOT NULL,
      subject_revision_id TEXT NOT NULL REFERENCES timeline_revisions(id),
      representation_asset_revision_id TEXT REFERENCES asset_revisions(id),
      dependency_snapshot_hash TEXT NOT NULL CHECK (length(dependency_snapshot_hash) = 64),
      subject_content_hash TEXT NOT NULL CHECK (length(subject_content_hash) = 64),
      media_profile_revision_id TEXT NOT NULL REFERENCES project_media_profile_revisions(id),
      state TEXT NOT NULL DEFAULT 'OPEN'
        CHECK (state IN ('OPEN', 'IN_PROGRESS', 'SUBMITTED')),
      reviewer_actor_id TEXT NOT NULL REFERENCES actors(id),
      opened_at_utc_us INTEGER NOT NULL,
      submitted_at_utc_us INTEGER,
      row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
      UNIQUE(subject_type, subject_id, id)
    );
    CREATE INDEX IF NOT EXISTS review_sessions_project_state_idx
      ON review_sessions(project_id, state, opened_at_utc_us DESC, id DESC);
    CREATE INDEX IF NOT EXISTS review_sessions_subject_idx
      ON review_sessions(subject_type, subject_id, opened_at_utc_us DESC, id DESC);

    CREATE TABLE IF NOT EXISTS human_reviews (
      id TEXT PRIMARY KEY,
      review_session_id TEXT NOT NULL UNIQUE REFERENCES review_sessions(id),
      decision TEXT NOT NULL CHECK (decision IN ('APPROVE', 'REJECT', 'REPAIR', 'ABSTAIN')),
      notes TEXT NOT NULL DEFAULT '',
      reason_codes_json TEXT NOT NULL DEFAULT '[]',
      dependency_snapshot_hash TEXT NOT NULL CHECK (length(dependency_snapshot_hash) = 64),
      subject_content_hash TEXT NOT NULL CHECK (length(subject_content_hash) = 64),
      reviewer_actor_id TEXT NOT NULL REFERENCES actors(id),
      reviewed_at_utc_us INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS human_reviews_session_idx
      ON human_reviews(review_session_id, reviewed_at_utc_us DESC, id DESC);

    CREATE TRIGGER IF NOT EXISTS project_media_profiles_no_update
      BEFORE UPDATE ON project_media_profiles
      BEGIN SELECT RAISE(ABORT, 'project_media_profiles are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS project_media_profiles_no_delete
      BEFORE DELETE ON project_media_profiles
      BEGIN SELECT RAISE(ABORT, 'project_media_profiles are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS project_media_profile_revisions_no_delete
      BEFORE DELETE ON project_media_profile_revisions
      BEGIN SELECT RAISE(ABORT, 'project_media_profile_revisions are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS project_media_profile_revisions_identity_no_update
      BEFORE UPDATE ON project_media_profile_revisions
      WHEN NEW.id IS NOT OLD.id
        OR NEW.profile_id IS NOT OLD.profile_id
        OR NEW.revision_number IS NOT OLD.revision_number
        OR NEW.timeline_rate_num IS NOT OLD.timeline_rate_num
        OR NEW.timeline_rate_den IS NOT OLD.timeline_rate_den
        OR NEW.time_base_num IS NOT OLD.time_base_num
        OR NEW.time_base_den IS NOT OLD.time_base_den
        OR NEW.width IS NOT OLD.width
        OR NEW.height IS NOT OLD.height
        OR NEW.pixel_aspect_num IS NOT OLD.pixel_aspect_num
        OR NEW.pixel_aspect_den IS NOT OLD.pixel_aspect_den
        OR NEW.working_color_space IS NOT OLD.working_color_space
        OR NEW.transfer_function IS NOT OLD.transfer_function
        OR NEW.hdr_policy IS NOT OLD.hdr_policy
        OR NEW.audio_sample_rate IS NOT OLD.audio_sample_rate
        OR NEW.audio_channel_layout IS NOT OLD.audio_channel_layout
        OR NEW.proxy_profile_json IS NOT OLD.proxy_profile_json
        OR NEW.mastering_targets_json IS NOT OLD.mastering_targets_json
        OR NEW.created_by_actor_id IS NOT OLD.created_by_actor_id
        OR NEW.created_at_utc_us IS NOT OLD.created_at_utc_us
      BEGIN SELECT RAISE(ABORT, 'project_media_profile_revision content is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS timeline_revisions_no_delete
      BEFORE DELETE ON timeline_revisions
      BEGIN SELECT RAISE(ABORT, 'timeline_revisions are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS timeline_revisions_identity_no_update
      BEFORE UPDATE ON timeline_revisions
      WHEN NEW.id IS NOT OLD.id
        OR NEW.timeline_id IS NOT OLD.timeline_id
        OR NEW.media_profile_revision_id IS NOT OLD.media_profile_revision_id
        OR NEW.revision_number IS NOT OLD.revision_number
        OR NEW.duration_num IS NOT OLD.duration_num
        OR NEW.duration_den IS NOT OLD.duration_den
        OR NEW.content_hash IS NOT OLD.content_hash
        OR NEW.created_by_actor_id IS NOT OLD.created_by_actor_id
        OR NEW.created_at_utc_us IS NOT OLD.created_at_utc_us
      BEGIN SELECT RAISE(ABORT, 'timeline_revision content is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS timeline_tracks_no_update
      BEFORE UPDATE ON timeline_tracks
      BEGIN SELECT RAISE(ABORT, 'timeline_tracks are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS timeline_tracks_no_delete
      BEFORE DELETE ON timeline_tracks
      BEGIN SELECT RAISE(ABORT, 'timeline_tracks are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS timeline_clip_instances_no_update
      BEFORE UPDATE ON timeline_clip_instances
      BEGIN SELECT RAISE(ABORT, 'timeline_clip_instances are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS timeline_clip_instances_no_delete
      BEFORE DELETE ON timeline_clip_instances
      BEGIN SELECT RAISE(ABORT, 'timeline_clip_instances are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS timeline_markers_no_update
      BEFORE UPDATE ON timeline_markers
      BEGIN SELECT RAISE(ABORT, 'timeline_markers are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS timeline_markers_no_delete
      BEFORE DELETE ON timeline_markers
      BEGIN SELECT RAISE(ABORT, 'timeline_markers are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS audio_cues_no_delete
      BEFORE DELETE ON audio_cues
      BEGIN SELECT RAISE(ABORT, 'audio_cues are retained for provenance'); END;
    CREATE TRIGGER IF NOT EXISTS audio_cues_identity_no_update
      BEFORE UPDATE ON audio_cues
      WHEN NEW.id IS NOT OLD.id
        OR NEW.project_id IS NOT OLD.project_id
        OR NEW.timeline_id IS NOT OLD.timeline_id
        OR NEW.cue_type IS NOT OLD.cue_type
        OR NEW.title IS NOT OLD.title
        OR NEW.created_by_actor_id IS NOT OLD.created_by_actor_id
        OR NEW.created_at_utc_us IS NOT OLD.created_at_utc_us
      BEGIN SELECT RAISE(ABORT, 'audio_cue identity is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS audio_cue_revisions_no_delete
      BEFORE DELETE ON audio_cue_revisions
      BEGIN SELECT RAISE(ABORT, 'audio_cue_revisions are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS audio_cue_revisions_identity_no_update
      BEFORE UPDATE ON audio_cue_revisions
      WHEN NEW.id IS NOT OLD.id
        OR NEW.audio_cue_id IS NOT OLD.audio_cue_id
        OR NEW.revision_number IS NOT OLD.revision_number
        OR NEW.timeline_revision_id IS NOT OLD.timeline_revision_id
        OR NEW.timeline_content_hash IS NOT OLD.timeline_content_hash
        OR NEW.timing_dependency_hash IS NOT OLD.timing_dependency_hash
        OR NEW.start_num IS NOT OLD.start_num
        OR NEW.start_den IS NOT OLD.start_den
        OR NEW.end_num IS NOT OLD.end_num
        OR NEW.end_den IS NOT OLD.end_den
        OR NEW.intent_text IS NOT OLD.intent_text
        OR NEW.selected_asset_revision_id IS NOT OLD.selected_asset_revision_id
        OR NEW.asset_snapshot_hash IS NOT OLD.asset_snapshot_hash
        OR NEW.created_by_actor_id IS NOT OLD.created_by_actor_id
        OR NEW.created_at_utc_us IS NOT OLD.created_at_utc_us
      BEGIN SELECT RAISE(ABORT, 'audio_cue_revision content is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS subtitle_tracks_no_delete
      BEFORE DELETE ON subtitle_tracks
      BEGIN SELECT RAISE(ABORT, 'subtitle_tracks are retained for provenance'); END;
    CREATE TRIGGER IF NOT EXISTS subtitle_tracks_identity_no_update
      BEFORE UPDATE ON subtitle_tracks
      WHEN NEW.id IS NOT OLD.id
        OR NEW.project_id IS NOT OLD.project_id
        OR NEW.timeline_id IS NOT OLD.timeline_id
        OR NEW.locale IS NOT OLD.locale
        OR NEW.title IS NOT OLD.title
        OR NEW.created_by_actor_id IS NOT OLD.created_by_actor_id
        OR NEW.created_at_utc_us IS NOT OLD.created_at_utc_us
      BEGIN SELECT RAISE(ABORT, 'subtitle_track identity is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS subtitle_track_revisions_no_delete
      BEFORE DELETE ON subtitle_track_revisions
      BEGIN SELECT RAISE(ABORT, 'subtitle_track_revisions are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS subtitle_track_revisions_identity_no_update
      BEFORE UPDATE ON subtitle_track_revisions
      WHEN NEW.id IS NOT OLD.id
        OR NEW.subtitle_track_id IS NOT OLD.subtitle_track_id
        OR NEW.revision_number IS NOT OLD.revision_number
        OR NEW.timeline_revision_id IS NOT OLD.timeline_revision_id
        OR NEW.timeline_content_hash IS NOT OLD.timeline_content_hash
        OR NEW.timing_dependency_hash IS NOT OLD.timing_dependency_hash
        OR NEW.format_profile IS NOT OLD.format_profile
        OR NEW.created_by_actor_id IS NOT OLD.created_by_actor_id
        OR NEW.created_at_utc_us IS NOT OLD.created_at_utc_us
      BEGIN SELECT RAISE(ABORT, 'subtitle_track_revision content is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS subtitle_track_segments_no_update
      BEFORE UPDATE ON subtitle_track_segments
      BEGIN SELECT RAISE(ABORT, 'subtitle_track_segments are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS subtitle_track_segments_no_delete
      BEFORE DELETE ON subtitle_track_segments
      BEGIN SELECT RAISE(ABORT, 'subtitle_track_segments are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS timeline_working_sessions_no_delete
      BEFORE DELETE ON timeline_working_sessions
      BEGIN SELECT RAISE(ABORT, 'timeline_working_sessions are retained for recovery'); END;
    CREATE TRIGGER IF NOT EXISTS timeline_working_sessions_identity_no_update
      BEFORE UPDATE ON timeline_working_sessions
      WHEN NEW.id IS NOT OLD.id
        OR NEW.timeline_id IS NOT OLD.timeline_id
        OR NEW.actor_id IS NOT OLD.actor_id
        OR NEW.client_instance_id IS NOT OLD.client_instance_id
        OR NEW.mode IS NOT OLD.mode
        OR NEW.created_at_utc_us IS NOT OLD.created_at_utc_us
      BEGIN SELECT RAISE(ABORT, 'timeline_working_session identity is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS timeline_edit_ops_no_update_identity
      BEFORE UPDATE ON timeline_edit_ops
      WHEN NEW.id IS NOT OLD.id
        OR NEW.working_session_id IS NOT OLD.working_session_id
        OR NEW.op_seq IS NOT OLD.op_seq
        OR NEW.op_type IS NOT OLD.op_type
        OR NEW.payload_json IS NOT OLD.payload_json
        OR NEW.before_payload_json IS NOT OLD.before_payload_json
        OR NEW.after_payload_json IS NOT OLD.after_payload_json
        OR NEW.result_hash IS NOT OLD.result_hash
         OR NEW.history_state IS NOT OLD.history_state
        OR NEW.actor_id IS NOT OLD.actor_id
        OR NEW.client_op_id IS NOT OLD.client_op_id
        OR NEW.created_at_utc_us IS NOT OLD.created_at_utc_us
      BEGIN SELECT RAISE(ABORT, 'timeline_edit_op content is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS timeline_edit_ops_no_delete
      BEFORE DELETE ON timeline_edit_ops
      BEGIN SELECT RAISE(ABORT, 'timeline_edit_ops are retained for causal history'); END;
    CREATE TRIGGER IF NOT EXISTS timeline_edit_actions_no_update
      BEFORE UPDATE ON timeline_edit_actions
      BEGIN SELECT RAISE(ABORT, 'timeline_edit_actions are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS timeline_edit_actions_no_delete
      BEFORE DELETE ON timeline_edit_actions
      BEGIN SELECT RAISE(ABORT, 'timeline_edit_actions are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS review_sessions_no_delete
      BEFORE DELETE ON review_sessions
      BEGIN SELECT RAISE(ABORT, 'review_sessions are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS review_sessions_identity_no_update
      BEFORE UPDATE ON review_sessions
      WHEN NEW.id IS NOT OLD.id
        OR NEW.project_id IS NOT OLD.project_id
        OR NEW.subject_type IS NOT OLD.subject_type
        OR NEW.subject_id IS NOT OLD.subject_id
        OR NEW.subject_revision_id IS NOT OLD.subject_revision_id
        OR NEW.representation_asset_revision_id IS NOT OLD.representation_asset_revision_id
        OR NEW.dependency_snapshot_hash IS NOT OLD.dependency_snapshot_hash
        OR NEW.subject_content_hash IS NOT OLD.subject_content_hash
        OR NEW.media_profile_revision_id IS NOT OLD.media_profile_revision_id
        OR NEW.reviewer_actor_id IS NOT OLD.reviewer_actor_id
        OR NEW.opened_at_utc_us IS NOT OLD.opened_at_utc_us
      BEGIN SELECT RAISE(ABORT, 'review session identity is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS human_reviews_no_update
      BEFORE UPDATE ON human_reviews
      BEGIN SELECT RAISE(ABORT, 'human_reviews are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS human_reviews_no_delete
      BEFORE DELETE ON human_reviews
      BEGIN SELECT RAISE(ABORT, 'human_reviews are append-only'); END;

    CREATE TRIGGER IF NOT EXISTS storage_objects_no_update
      BEFORE UPDATE ON storage_objects
      BEGIN SELECT RAISE(ABORT, 'storage_objects is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS storage_objects_no_delete
      BEFORE DELETE ON storage_objects
      BEGIN SELECT RAISE(ABORT, 'storage_objects is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS staging_objects_no_delete
      BEFORE DELETE ON staging_objects
      BEGIN SELECT RAISE(ABORT, 'staging_objects are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS rights_identities_no_update
      BEFORE UPDATE ON rights_identities
      BEGIN SELECT RAISE(ABORT, 'rights_identities are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS rights_identities_no_delete
      BEFORE DELETE ON rights_identities
      BEGIN SELECT RAISE(ABORT, 'rights_identities are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS rights_records_no_update
      BEFORE UPDATE ON rights_records
      BEGIN SELECT RAISE(ABORT, 'rights_records are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS rights_records_no_delete
      BEFORE DELETE ON rights_records
      BEGIN SELECT RAISE(ABORT, 'rights_records are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS consents_no_update
      BEFORE UPDATE ON consents
      BEGIN SELECT RAISE(ABORT, 'consents are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS consents_no_delete
      BEFORE DELETE ON consents
      BEGIN SELECT RAISE(ABORT, 'consents are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS revocations_no_update
      BEFORE UPDATE ON revocations
      BEGIN SELECT RAISE(ABORT, 'revocations are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS revocations_no_delete
      BEFORE DELETE ON revocations
      BEGIN SELECT RAISE(ABORT, 'revocations are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS staging_objects_identity_no_update
      BEFORE UPDATE ON staging_objects
      WHEN NEW.id IS NOT OLD.id
        OR NEW.command_id IS NOT OLD.command_id
        OR NEW.job_attempt_id IS NOT OLD.job_attempt_id
        OR (OLD.import_item_id IS NOT NULL AND NEW.import_item_id IS NOT OLD.import_item_id)
        OR NEW.temp_path IS NOT OLD.temp_path
        OR NEW.expected_size IS NOT OLD.expected_size
        OR NEW.hash_algorithm IS NOT OLD.hash_algorithm
        OR (OLD.sha256 IS NOT NULL AND NEW.sha256 IS NOT OLD.sha256)
        OR NEW.source_path_fingerprint IS NOT OLD.source_path_fingerprint
        OR NEW.source_file_identity_json IS NOT OLD.source_file_identity_json
        OR (OLD.os_file_identity_json IS NOT NULL AND NEW.os_file_identity_json IS NOT OLD.os_file_identity_json)
        OR NEW.reparse_state IS NOT OLD.reparse_state
        OR (OLD.finalization_identity_json IS NOT NULL AND NEW.finalization_identity_json IS NOT OLD.finalization_identity_json)
        OR NEW.created_at_utc_us IS NOT OLD.created_at_utc_us
      BEGIN SELECT RAISE(ABORT, 'staging object identity is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS asset_revisions_no_update
      BEFORE UPDATE ON asset_revisions
      BEGIN SELECT RAISE(ABORT, 'asset_revisions is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS asset_revisions_no_delete
      BEFORE DELETE ON asset_revisions
      BEGIN SELECT RAISE(ABORT, 'asset_revisions is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS provenance_records_no_update
      BEFORE UPDATE ON provenance_records
      BEGIN SELECT RAISE(ABORT, 'provenance_records is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS provenance_records_no_delete
      BEFORE DELETE ON provenance_records
      BEGIN SELECT RAISE(ABORT, 'provenance_records is append-only'); END;

    CREATE TRIGGER IF NOT EXISTS visual_identity_packages_no_update
      BEFORE UPDATE ON visual_identity_packages
      BEGIN SELECT RAISE(ABORT, 'visual_identity_packages are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS visual_identity_packages_no_delete
      BEFORE DELETE ON visual_identity_packages
      BEGIN SELECT RAISE(ABORT, 'visual_identity_packages are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS visual_identity_revisions_no_delete
      BEFORE DELETE ON visual_identity_revisions
      BEGIN SELECT RAISE(ABORT, 'visual_identity_revisions are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS visual_identity_revisions_identity_no_update
      BEFORE UPDATE ON visual_identity_revisions
      WHEN NEW.id IS NOT OLD.id
        OR NEW.package_id IS NOT OLD.package_id
        OR NEW.revision_number IS NOT OLD.revision_number
        OR NEW.semantic_description IS NOT OLD.semantic_description
        OR NEW.anatomy_json IS NOT OLD.anatomy_json
        OR NEW.proportion_json IS NOT OLD.proportion_json
        OR NEW.palette_json IS NOT OLD.palette_json
        OR NEW.marking_json IS NOT OLD.marking_json
        OR NEW.forbidden_drift_json IS NOT OLD.forbidden_drift_json
        OR NEW.created_by_actor_id IS NOT OLD.created_by_actor_id
        OR NEW.created_at_utc_us IS NOT OLD.created_at_utc_us
      BEGIN SELECT RAISE(ABORT, 'visual_identity_revision content is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS visual_identity_references_no_update
      BEFORE UPDATE ON visual_identity_references
      BEGIN SELECT RAISE(ABORT, 'visual_identity_references are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS visual_identity_references_no_delete
      BEFORE DELETE ON visual_identity_references
      BEGIN SELECT RAISE(ABORT, 'visual_identity_references are append-only'); END;

    CREATE TRIGGER IF NOT EXISTS voice_identity_packages_no_update
      BEFORE UPDATE ON voice_identity_packages
      BEGIN SELECT RAISE(ABORT, 'voice_identity_packages are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS voice_identity_packages_no_delete
      BEFORE DELETE ON voice_identity_packages
      BEGIN SELECT RAISE(ABORT, 'voice_identity_packages are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS voice_identity_revisions_no_delete
      BEFORE DELETE ON voice_identity_revisions
      BEGIN SELECT RAISE(ABORT, 'voice_identity_revisions are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS voice_identity_revisions_identity_no_update
      BEFORE UPDATE ON voice_identity_revisions
      WHEN NEW.id IS NOT OLD.id
        OR NEW.package_id IS NOT OLD.package_id
        OR NEW.revision_number IS NOT OLD.revision_number
        OR NEW.semantic_description IS NOT OLD.semantic_description
        OR NEW.canonical_language IS NOT OLD.canonical_language
        OR NEW.accent_profile_json IS NOT OLD.accent_profile_json
        OR NEW.vocal_range_json IS NOT OLD.vocal_range_json
        OR NEW.timbre_json IS NOT OLD.timbre_json
        OR NEW.prosody_json IS NOT OLD.prosody_json
        OR NEW.emotional_map_json IS NOT OLD.emotional_map_json
        OR NEW.pronunciation_lexicon_json IS NOT OLD.pronunciation_lexicon_json
        OR NEW.forbidden_traits_json IS NOT OLD.forbidden_traits_json
        OR NEW.rights_identity_id IS NOT OLD.rights_identity_id
        OR NEW.created_by_actor_id IS NOT OLD.created_by_actor_id
        OR NEW.created_at_utc_us IS NOT OLD.created_at_utc_us
      BEGIN SELECT RAISE(ABORT, 'voice_identity_revision content is immutable'); END;

    CREATE TRIGGER IF NOT EXISTS performance_bibles_no_update
      BEFORE UPDATE ON performance_bibles
      BEGIN SELECT RAISE(ABORT, 'performance_bibles are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS performance_bibles_no_delete
      BEFORE DELETE ON performance_bibles
      BEGIN SELECT RAISE(ABORT, 'performance_bibles are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS performance_bible_revisions_no_delete
      BEFORE DELETE ON performance_bible_revisions
      BEGIN SELECT RAISE(ABORT, 'performance_bible_revisions are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS performance_bible_revisions_identity_no_update
      BEFORE UPDATE ON performance_bible_revisions
      WHEN NEW.id IS NOT OLD.id
        OR NEW.performance_bible_id IS NOT OLD.performance_bible_id
        OR NEW.revision_number IS NOT OLD.revision_number
        OR NEW.posture_json IS NOT OLD.posture_json
        OR NEW.gait_json IS NOT OLD.gait_json
        OR NEW.gestures_json IS NOT OLD.gestures_json
        OR NEW.eye_behavior_json IS NOT OLD.eye_behavior_json
        OR NEW.reaction_timing_json IS NOT OLD.reaction_timing_json
        OR NEW.speech_rhythm_json IS NOT OLD.speech_rhythm_json
        OR NEW.emotional_baseline_json IS NOT OLD.emotional_baseline_json
        OR NEW.forbidden_drift_json IS NOT OLD.forbidden_drift_json
        OR NEW.created_by_actor_id IS NOT OLD.created_by_actor_id
        OR NEW.created_at_utc_us IS NOT OLD.created_at_utc_us
      BEGIN SELECT RAISE(ABORT, 'performance_bible_revision content is immutable'); END;

    CREATE TABLE IF NOT EXISTS commands (
      id TEXT PRIMARY KEY,
      studio_id TEXT NOT NULL REFERENCES studios(id),
      project_id TEXT REFERENCES projects(id),
      actor_id TEXT NOT NULL REFERENCES actors(id),
      command_type TEXT NOT NULL,
      schema_version INTEGER NOT NULL DEFAULT 1,
      scope_type TEXT NOT NULL DEFAULT 'SYSTEM',
      scope_id TEXT,
      payload_json TEXT NOT NULL,
      expected_versions_json TEXT NOT NULL DEFAULT '{}',
      reversibility TEXT NOT NULL DEFAULT 'REVERSIBLE'
        CHECK (reversibility IN ('REVERSIBLE', 'COMPENSATABLE', 'IRREVERSIBLE')),
      status TEXT NOT NULL
        CHECK (status IN ('RECEIVED', 'VALIDATING', 'WAITING_DECISION', 'READY',
          'EXECUTING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'PARTIAL',
          'COMPENSATING', 'SUCCEEDED_WITH_WARNINGS', 'COMPENSATED', 'FAILED_COMPENSATION')),
      correlation_id TEXT,
      causation_id TEXT,
      idempotency_key TEXT,
      idempotency_fingerprint TEXT,
      estimated_cost_json TEXT,
      estimated_storage_bytes INTEGER,
      created_at_utc_us INTEGER NOT NULL,
      started_at_utc_us INTEGER,
      finished_at_utc_us INTEGER,
      error_code TEXT,
      error_details_json TEXT,
      result_json TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS commands_idempotency_uq
      ON commands(actor_id, command_type, idempotency_key)
      WHERE idempotency_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS commands_project_idx ON commands(project_id, created_at_utc_us DESC);
    CREATE INDEX IF NOT EXISTS commands_status_idx ON commands(status, created_at_utc_us DESC);

    CREATE TABLE IF NOT EXISTS command_impacts (
      command_id TEXT NOT NULL REFERENCES commands(id),
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      impact_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY(command_id, entity_type, entity_id, impact_type)
    );

    CREATE TABLE IF NOT EXISTS domain_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      aggregate_type TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      aggregate_version INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      schema_version INTEGER NOT NULL DEFAULT 1,
      payload_json TEXT NOT NULL,
      command_id TEXT NOT NULL REFERENCES commands(id),
      actor_id TEXT NOT NULL REFERENCES actors(id),
      correlation_id TEXT,
      causation_id TEXT,
      created_at_utc_us INTEGER NOT NULL,
      UNIQUE(aggregate_type, aggregate_id, aggregate_version)
    );
    CREATE INDEX IF NOT EXISTS domain_events_project_idx
      ON domain_events(aggregate_id, seq DESC);

    CREATE TABLE IF NOT EXISTS audit_records (
      id TEXT PRIMARY KEY,
      command_id TEXT NOT NULL REFERENCES commands(id),
      actor_id TEXT NOT NULL REFERENCES actors(id),
      action_type TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      outcome TEXT NOT NULL CHECK (outcome IN ('SUCCEEDED', 'FAILED', 'CANCELLED')),
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at_utc_us INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS audit_command_idx ON audit_records(command_id);
    CREATE INDEX IF NOT EXISTS audit_target_idx ON audit_records(target_type, target_id, created_at_utc_us DESC);

    CREATE TRIGGER IF NOT EXISTS domain_events_no_update
      BEFORE UPDATE ON domain_events
      BEGIN SELECT RAISE(ABORT, 'domain_events is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS domain_events_no_delete
      BEFORE DELETE ON domain_events
      BEGIN SELECT RAISE(ABORT, 'domain_events is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS audit_records_no_update
      BEFORE UPDATE ON audit_records
      BEGIN SELECT RAISE(ABORT, 'audit_records is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS audit_records_no_delete
      BEFORE DELETE ON audit_records
      BEGIN SELECT RAISE(ABORT, 'audit_records is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS notes_no_update
      BEFORE UPDATE ON notes
      BEGIN SELECT RAISE(ABORT, 'notes are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS notes_no_delete
      BEFORE DELETE ON notes
      BEGIN SELECT RAISE(ABORT, 'notes are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS decision_requests_no_delete
      BEFORE DELETE ON decision_requests
      BEGIN SELECT RAISE(ABORT, 'decision_requests are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS decision_choices_no_update
      BEFORE UPDATE ON decision_choices
      BEGIN SELECT RAISE(ABORT, 'decision_choices are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS decision_choices_no_delete
      BEFORE DELETE ON decision_choices
      BEGIN SELECT RAISE(ABORT, 'decision_choices are append-only'); END;
  `);

  // v12 metadata-only handoff preflight.  The session is the auditable
  // command aggregate; the manifest is immutable, deterministic interchange
  // metadata.  No media bytes or local destination paths are stored here.
  // `output_manifest_id` is intentionally a nullable plain reference so the
  // two rows can be created atomically without a circular foreign key.
  db.exec(`
    CREATE TABLE IF NOT EXISTS export_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      timeline_revision_id TEXT NOT NULL REFERENCES timeline_revisions(id),
      deliverable_type TEXT NOT NULL CHECK (deliverable_type IN ('TIMELINE_INTERCHANGE')),
      target_profile TEXT NOT NULL CHECK (target_profile GLOB '[A-Z0-9_]*'),
      target_editor TEXT NOT NULL CHECK (length(target_editor) BETWEEN 1 AND 120),
      target_version TEXT NOT NULL CHECK (length(target_version) BETWEEN 1 AND 120),
      state TEXT NOT NULL CHECK (state IN ('PLANNED', 'PREFLIGHT', 'BUILDING', 'VALIDATING', 'VERIFIED', 'COMPLETED', 'BLOCKED_RIGHTS', 'BLOCKED_MEDIA', 'FAILED', 'CANCELLED')),
      output_manifest_id TEXT,
      output_asset_revision_id TEXT REFERENCES asset_revisions(id),
      output_content_hash TEXT CHECK (output_content_hash IS NULL OR (length(output_content_hash) = 64 AND output_content_hash NOT GLOB '*[^0-9a-fA-F]*')),
      output_byte_size INTEGER CHECK (output_byte_size IS NULL OR (typeof(output_byte_size) = 'integer' AND output_byte_size >= 0 AND output_byte_size <= 9007199254740991)),
      validation_snapshot_json TEXT NOT NULL DEFAULT '{}',
      command_id TEXT NOT NULL REFERENCES commands(id),
      review_session_id TEXT NOT NULL REFERENCES review_sessions(id),
      dependency_snapshot_hash TEXT NOT NULL CHECK (length(dependency_snapshot_hash) = 64),
      subject_content_hash TEXT NOT NULL CHECK (length(subject_content_hash) = 64),
      media_profile_revision_id TEXT NOT NULL REFERENCES project_media_profile_revisions(id),
      next_step TEXT NOT NULL DEFAULT '',
      row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
      created_by_actor_id TEXT NOT NULL REFERENCES actors(id),
      created_at_utc_us INTEGER NOT NULL,
      updated_at_utc_us INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS export_sessions_project_state_idx
      ON export_sessions(project_id, state, created_at_utc_us DESC, id DESC);
    CREATE INDEX IF NOT EXISTS export_sessions_revision_idx
      ON export_sessions(timeline_revision_id, created_at_utc_us DESC, id DESC);
    CREATE INDEX IF NOT EXISTS export_sessions_command_idx
      ON export_sessions(command_id);
    CREATE INDEX IF NOT EXISTS export_sessions_output_asset_idx
      ON export_sessions(output_asset_revision_id);

    CREATE TABLE IF NOT EXISTS handoff_manifests (
      id TEXT PRIMARY KEY,
      export_session_id TEXT NOT NULL UNIQUE REFERENCES export_sessions(id),
      project_id TEXT NOT NULL REFERENCES projects(id),
      target_editor TEXT NOT NULL CHECK (length(target_editor) BETWEEN 1 AND 120),
      target_version TEXT NOT NULL CHECK (length(target_version) BETWEEN 1 AND 120),
      compatibility_profile_version TEXT NOT NULL CHECK (length(compatibility_profile_version) BETWEEN 1 AND 120),
      manifest_hash TEXT NOT NULL UNIQUE CHECK (length(manifest_hash) = 64),
      manifest_json TEXT NOT NULL,
      artifact_allowlist_json TEXT NOT NULL DEFAULT '[]',
      compatibility_report_json TEXT NOT NULL DEFAULT '{}',
      sanitization_report_json TEXT NOT NULL DEFAULT '{}',
      created_by_actor_id TEXT NOT NULL REFERENCES actors(id),
      created_at_utc_us INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS handoff_manifests_project_idx
      ON handoff_manifests(project_id, created_at_utc_us DESC, id DESC);
    CREATE INDEX IF NOT EXISTS handoff_manifests_session_idx
      ON handoff_manifests(export_session_id);

    CREATE TRIGGER IF NOT EXISTS export_sessions_no_delete
      BEFORE DELETE ON export_sessions
      BEGIN SELECT RAISE(ABORT, 'export_sessions are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS export_sessions_identity_no_update
      BEFORE UPDATE ON export_sessions
      WHEN NEW.id IS NOT OLD.id
        OR NEW.project_id IS NOT OLD.project_id
        OR NEW.timeline_revision_id IS NOT OLD.timeline_revision_id
        OR NEW.deliverable_type IS NOT OLD.deliverable_type
        OR NEW.target_profile IS NOT OLD.target_profile
        OR NEW.target_editor IS NOT OLD.target_editor
        OR NEW.target_version IS NOT OLD.target_version
        OR NEW.command_id IS NOT OLD.command_id
        OR NEW.review_session_id IS NOT OLD.review_session_id
        OR NEW.dependency_snapshot_hash IS NOT OLD.dependency_snapshot_hash
        OR NEW.subject_content_hash IS NOT OLD.subject_content_hash
        OR NEW.media_profile_revision_id IS NOT OLD.media_profile_revision_id
        OR NEW.created_by_actor_id IS NOT OLD.created_by_actor_id
        OR NEW.created_at_utc_us IS NOT OLD.created_at_utc_us
      BEGIN SELECT RAISE(ABORT, 'export_session identity is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS export_sessions_verified_output_no_update
      BEFORE UPDATE ON export_sessions
      WHEN OLD.state IN ('VERIFIED', 'COMPLETED')
        AND (NEW.output_asset_revision_id IS NOT OLD.output_asset_revision_id
          OR NEW.output_content_hash IS NOT OLD.output_content_hash
          OR NEW.output_byte_size IS NOT OLD.output_byte_size
          OR NEW.validation_snapshot_json IS NOT OLD.validation_snapshot_json)
      BEGIN SELECT RAISE(ABORT, 'verified export output binding is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS export_sessions_completed_no_update
      BEFORE UPDATE ON export_sessions
      WHEN OLD.state = 'COMPLETED'
      BEGIN SELECT RAISE(ABORT, 'completed export session is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS export_sessions_verified_no_resurrection
      BEFORE UPDATE ON export_sessions
      WHEN OLD.state = 'VERIFIED' AND NEW.state NOT IN ('VERIFIED', 'COMPLETED')
      BEGIN SELECT RAISE(ABORT, 'verified export session cannot regress'); END;
    CREATE TRIGGER IF NOT EXISTS export_sessions_output_hash_guard
      BEFORE INSERT ON export_sessions
      WHEN NEW.output_content_hash IS NOT NULL
        AND (length(NEW.output_content_hash) <> 64 OR NEW.output_content_hash GLOB '*[^0-9a-fA-F]*')
      BEGIN SELECT RAISE(ABORT, 'invalid export output content hash'); END;
    CREATE TRIGGER IF NOT EXISTS export_sessions_output_size_guard
      BEFORE INSERT ON export_sessions
      WHEN NEW.output_byte_size IS NOT NULL
        AND (typeof(NEW.output_byte_size) <> 'integer' OR NEW.output_byte_size < 0 OR NEW.output_byte_size > 9007199254740991)
      BEGIN SELECT RAISE(ABORT, 'invalid export output byte size'); END;
    CREATE TRIGGER IF NOT EXISTS export_sessions_output_asset_guard
      BEFORE INSERT ON export_sessions
      WHEN NEW.output_asset_revision_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM asset_revisions WHERE id = NEW.output_asset_revision_id)
      BEGIN SELECT RAISE(ABORT, 'missing export output asset revision'); END;
    CREATE TRIGGER IF NOT EXISTS handoff_manifests_no_update
      BEFORE UPDATE ON handoff_manifests
      BEGIN SELECT RAISE(ABORT, 'handoff_manifests are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS handoff_manifests_no_delete
      BEFORE DELETE ON handoff_manifests
      BEGIN SELECT RAISE(ABORT, 'handoff_manifests are append-only'); END;
  `);

  // v15 metadata-only release-candidate drafts.  A candidate binds the exact
  // approved timeline/profile/review and a redacted readiness snapshot.  It
  // contains no master bytes, path, provider reference, or publish intent.
  db.exec(`
    CREATE TABLE IF NOT EXISTS release_candidates (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      timeline_revision_id TEXT NOT NULL REFERENCES timeline_revisions(id),
      audio_master_asset_revision_id TEXT REFERENCES asset_revisions(id),
      subtitle_manifest_json TEXT NOT NULL DEFAULT '{}',
      media_profile_revision_id TEXT NOT NULL REFERENCES project_media_profile_revisions(id),
      review_session_id TEXT REFERENCES review_sessions(id),
      readiness_digest TEXT NOT NULL CHECK (length(readiness_digest) = 64 AND readiness_digest NOT GLOB '*[^0-9a-fA-F]*'),
      rights_snapshot_hash TEXT NOT NULL CHECK (length(rights_snapshot_hash) = 64 AND rights_snapshot_hash NOT GLOB '*[^0-9a-fA-F]*'),
      readiness_snapshot_json TEXT NOT NULL DEFAULT '{}',
      readiness_snapshot_schema_version INTEGER NOT NULL DEFAULT 1 CHECK (readiness_snapshot_schema_version >= 1),
      state TEXT NOT NULL CHECK (state IN ('DRAFT', 'CANCELLED')),
      next_step TEXT NOT NULL DEFAULT '',
      row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
      command_id TEXT NOT NULL REFERENCES commands(id),
      created_by_actor_id TEXT NOT NULL REFERENCES actors(id),
      created_at_utc_us INTEGER NOT NULL,
      updated_at_utc_us INTEGER NOT NULL,
      cancelled_at_utc_us INTEGER
    );
    CREATE INDEX IF NOT EXISTS release_candidates_project_state_idx
      ON release_candidates(project_id, state, created_at_utc_us DESC, id DESC);
    CREATE INDEX IF NOT EXISTS release_candidates_revision_idx
      ON release_candidates(timeline_revision_id, created_at_utc_us DESC, id DESC);
    CREATE INDEX IF NOT EXISTS release_candidates_command_idx
      ON release_candidates(command_id);
    CREATE UNIQUE INDEX IF NOT EXISTS release_candidates_exact_uq
      ON release_candidates(project_id, timeline_revision_id, readiness_digest);
    CREATE TRIGGER IF NOT EXISTS release_candidates_no_delete
      BEFORE DELETE ON release_candidates
      BEGIN SELECT RAISE(ABORT, 'release_candidates are retained for audit'); END;
    CREATE TRIGGER IF NOT EXISTS release_candidates_identity_no_update
      BEFORE UPDATE ON release_candidates
      WHEN NEW.id IS NOT OLD.id
        OR NEW.project_id IS NOT OLD.project_id
        OR NEW.timeline_revision_id IS NOT OLD.timeline_revision_id
        OR NEW.audio_master_asset_revision_id IS NOT OLD.audio_master_asset_revision_id
        OR NEW.subtitle_manifest_json IS NOT OLD.subtitle_manifest_json
        OR NEW.media_profile_revision_id IS NOT OLD.media_profile_revision_id
        OR NEW.review_session_id IS NOT OLD.review_session_id
        OR NEW.readiness_digest IS NOT OLD.readiness_digest
        OR NEW.rights_snapshot_hash IS NOT OLD.rights_snapshot_hash
        OR NEW.readiness_snapshot_json IS NOT OLD.readiness_snapshot_json
        OR NEW.readiness_snapshot_schema_version IS NOT OLD.readiness_snapshot_schema_version
        OR NEW.command_id IS NOT OLD.command_id
        OR NEW.created_by_actor_id IS NOT OLD.created_by_actor_id
        OR NEW.created_at_utc_us IS NOT OLD.created_at_utc_us
      BEGIN SELECT RAISE(ABORT, 'release_candidate identity is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS release_candidates_terminal_no_update
      BEFORE UPDATE ON release_candidates
      WHEN OLD.state = 'CANCELLED' AND NEW.state <> 'CANCELLED'
      BEGIN SELECT RAISE(ABORT, 'cancelled release_candidates are terminal'); END;
  `);

  // v7 backup metadata is created after the command/audit tables so its
  // command references are valid even on a fresh database.  The artifact
  // bytes and object copies live outside SQLite; these rows bind the immutable
  // manifest/digest and the append-only verification measurements.
  db.exec(`
    CREATE TABLE IF NOT EXISTS backups (
      id TEXT PRIMARY KEY,
      backup_type TEXT NOT NULL CHECK (backup_type IN ('FULL_LOCAL')),
      durability_class TEXT NOT NULL CHECK (durability_class IN ('LOCAL_WRITABLE', 'SEPARATE_VOLUME', 'OFFLINE', 'IMMUTABLE_REMOTE')),
      failure_domain TEXT NOT NULL,
      destination_path TEXT NOT NULL,
      destination_fingerprint TEXT NOT NULL,
      manifest_path TEXT NOT NULL,
      snapshot_path TEXT NOT NULL,
      installation_id TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      event_seq_checkpoint INTEGER NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('CREATED', 'VERIFIED', 'FAILED', 'QUARANTINED')),
      db_sha256 TEXT NOT NULL CHECK (length(db_sha256) = 64),
      manifest_sha256 TEXT NOT NULL CHECK (length(manifest_sha256) = 64),
      byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
      object_count INTEGER NOT NULL CHECK (object_count >= 0),
      external_object_count INTEGER NOT NULL DEFAULT 0 CHECK (external_object_count >= 0),
      created_by_actor_id TEXT NOT NULL REFERENCES actors(id),
      command_id TEXT NOT NULL REFERENCES commands(id),
      created_at_utc_us INTEGER NOT NULL,
      completed_at_utc_us INTEGER,
      error_code TEXT,
      row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1)
    );
    CREATE INDEX IF NOT EXISTS backups_state_idx ON backups(state, created_at_utc_us DESC);
    CREATE INDEX IF NOT EXISTS backups_created_idx ON backups(created_at_utc_us DESC, id DESC);

    CREATE TABLE IF NOT EXISTS backup_verifications (
      id TEXT PRIMARY KEY,
      backup_id TEXT NOT NULL REFERENCES backups(id),
      outcome TEXT NOT NULL CHECK (outcome IN ('VERIFIED', 'FAILED')),
      integrity_state TEXT NOT NULL CHECK (integrity_state IN ('PASS', 'FAIL', 'UNKNOWN')),
      manifest_sha256 TEXT,
      object_count INTEGER NOT NULL DEFAULT 0 CHECK (object_count >= 0),
      byte_size INTEGER NOT NULL DEFAULT 0 CHECK (byte_size >= 0),
      details_json TEXT NOT NULL DEFAULT '{}',
      command_id TEXT NOT NULL REFERENCES commands(id),
      actor_id TEXT NOT NULL REFERENCES actors(id),
      created_at_utc_us INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS backup_verifications_backup_idx
      ON backup_verifications(backup_id, created_at_utc_us DESC, id DESC);
    CREATE TRIGGER IF NOT EXISTS backup_verifications_no_update
      BEFORE UPDATE ON backup_verifications
      BEGIN SELECT RAISE(ABORT, 'backup_verifications are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS backup_verifications_no_delete
      BEFORE DELETE ON backup_verifications
      BEGIN SELECT RAISE(ABORT, 'backup_verifications are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS backups_no_delete
      BEFORE DELETE ON backups
      BEGIN SELECT RAISE(ABORT, 'backups are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS backups_identity_no_update
      BEFORE UPDATE ON backups
      WHEN NEW.id IS NOT OLD.id
        OR NEW.backup_type IS NOT OLD.backup_type
        OR NEW.durability_class IS NOT OLD.durability_class
        OR NEW.failure_domain IS NOT OLD.failure_domain
        OR NEW.destination_path IS NOT OLD.destination_path
        OR NEW.destination_fingerprint IS NOT OLD.destination_fingerprint
        OR NEW.manifest_path IS NOT OLD.manifest_path
        OR NEW.snapshot_path IS NOT OLD.snapshot_path
        OR NEW.installation_id IS NOT OLD.installation_id
        OR NEW.schema_version IS NOT OLD.schema_version
        OR NEW.event_seq_checkpoint IS NOT OLD.event_seq_checkpoint
        OR NEW.db_sha256 IS NOT OLD.db_sha256
        OR NEW.manifest_sha256 IS NOT OLD.manifest_sha256
        OR NEW.created_by_actor_id IS NOT OLD.created_by_actor_id
        OR NEW.command_id IS NOT OLD.command_id
        OR NEW.created_at_utc_us IS NOT OLD.created_at_utc_us
      BEGIN SELECT RAISE(ABORT, 'backup identity is immutable'); END;
  `);

  // Recreate the v7 append-only protections on every open so an interrupted
  // upgrade cannot leave a pre-v7 installation with weaker backup history
  // guarantees.  Drops are safe because the tables are created above.
  db.exec(`
    DROP TRIGGER IF EXISTS backup_verifications_no_update;
    DROP TRIGGER IF EXISTS backup_verifications_no_delete;
    DROP TRIGGER IF EXISTS backups_no_delete;
    DROP TRIGGER IF EXISTS backups_identity_no_update;
    CREATE TRIGGER backup_verifications_no_update
      BEFORE UPDATE ON backup_verifications
      BEGIN SELECT RAISE(ABORT, 'backup_verifications are append-only'); END;
    CREATE TRIGGER backup_verifications_no_delete
      BEFORE DELETE ON backup_verifications
      BEGIN SELECT RAISE(ABORT, 'backup_verifications are append-only'); END;
    CREATE TRIGGER backups_no_delete
      BEFORE DELETE ON backups
      BEGIN SELECT RAISE(ABORT, 'backups are append-only'); END;
    CREATE TRIGGER backups_identity_no_update
      BEFORE UPDATE ON backups
      WHEN NEW.id IS NOT OLD.id
        OR NEW.backup_type IS NOT OLD.backup_type
        OR NEW.durability_class IS NOT OLD.durability_class
        OR NEW.failure_domain IS NOT OLD.failure_domain
        OR NEW.destination_path IS NOT OLD.destination_path
        OR NEW.destination_fingerprint IS NOT OLD.destination_fingerprint
        OR NEW.manifest_path IS NOT OLD.manifest_path
        OR NEW.snapshot_path IS NOT OLD.snapshot_path
        OR NEW.installation_id IS NOT OLD.installation_id
        OR NEW.schema_version IS NOT OLD.schema_version
        OR NEW.event_seq_checkpoint IS NOT OLD.event_seq_checkpoint
        OR NEW.db_sha256 IS NOT OLD.db_sha256
        OR NEW.manifest_sha256 IS NOT OLD.manifest_sha256
        OR NEW.created_by_actor_id IS NOT OLD.created_by_actor_id
        OR NEW.command_id IS NOT OLD.command_id
        OR NEW.created_at_utc_us IS NOT OLD.created_at_utc_us
      BEGIN SELECT RAISE(ABORT, 'backup identity is immutable'); END;
  `);

  // v3 adds a durable request binding for idempotency keys.  CREATE TABLE IF
  // NOT EXISTS cannot add columns to an existing installation, so inspect the
  // live table before applying the resumable ALTER TABLE step.  Existing rows
  // are backfilled from their already durable payload/precondition JSON; a
  // malformed legacy row is left NULL and is safely canonicalized on replay by
  // Core rather than guessed during migration.
  const commandColumns = new Set(db.prepare('PRAGMA table_info(commands)').all().map((row) => String(row.name)));
  if (!commandColumns.has('idempotency_fingerprint')) {
    db.exec('ALTER TABLE commands ADD COLUMN idempotency_fingerprint TEXT');
  }
  const legacyCommands = db.prepare(`SELECT id, payload_json, expected_versions_json
    FROM commands WHERE idempotency_key IS NOT NULL AND idempotency_fingerprint IS NULL`).all();
  const setFingerprint = db.prepare('UPDATE commands SET idempotency_fingerprint = ? WHERE id = ?');
  for (const row of legacyCommands) {
    try {
      const payload = JSON.parse(row.payload_json ?? '{}');
      const expectedVersions = JSON.parse(row.expected_versions_json ?? '{}');
      setFingerprint.run(idempotencyFingerprint(payload, expectedVersions), row.id);
    } catch {
      // A pre-v3 malformed record cannot be safely normalized.  Core will
      // derive the same best-effort binding when that key is replayed.
    }
  }

  // v8 character revisions gain an explicit optimistic row version.  The
  // tables are created above for new installations; these guarded additions
  // keep a partially upgraded local database resumable without rewriting any
  // existing canon bytes.
  for (const table of ['visual_identity_revisions', 'voice_identity_revisions', 'performance_bible_revisions']) {
    const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => String(row.name)));
    if (columns.size > 0 && !columns.has('row_version')) db.exec(`ALTER TABLE ${table} ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1`);
  }

  // v5 records whether an asset's storage/availability evidence was actually
  // verified by Core.  The original availability_state vocabulary predates
  // external-reference UNKNOWN semantics, so the additive evidence column is
  // the migration-safe source of truth and public projections derive UNKNOWN
  // for unmaterialized references without rewriting the legacy CHECK.
  const revisionColumns = new Set(db.prepare('PRAGMA table_info(asset_revisions)').all().map((row) => String(row.name)));
  if (!revisionColumns.has('availability_evidence_state')) {
    db.exec(`ALTER TABLE asset_revisions ADD COLUMN availability_evidence_state TEXT NOT NULL DEFAULT 'UNKNOWN'
      CHECK (availability_evidence_state IN ('UNKNOWN', 'VERIFIED'))`);
  }

  const assetColumns = new Set(db.prepare('PRAGMA table_info(assets)').all().map((row) => String(row.name)));
  if (!assetColumns.has('rights_identity_id')) db.exec('ALTER TABLE assets ADD COLUMN rights_identity_id TEXT');

  // Recreate append-only evidence triggers for installations that were opened
  // before the v6 DDL existed.  DROP is safe because these tables are
  // append-only and the triggers have no persisted state.
  db.exec(`
    DROP TRIGGER IF EXISTS rights_identities_no_update;
    DROP TRIGGER IF EXISTS rights_identities_no_delete;
    DROP TRIGGER IF EXISTS rights_records_no_update;
    DROP TRIGGER IF EXISTS rights_records_no_delete;
    DROP TRIGGER IF EXISTS consents_no_update;
    DROP TRIGGER IF EXISTS consents_no_delete;
    DROP TRIGGER IF EXISTS revocations_no_update;
    DROP TRIGGER IF EXISTS revocations_no_delete;
    CREATE TRIGGER rights_identities_no_update BEFORE UPDATE ON rights_identities
      BEGIN SELECT RAISE(ABORT, 'rights_identities are append-only'); END;
    CREATE TRIGGER rights_identities_no_delete BEFORE DELETE ON rights_identities
      BEGIN SELECT RAISE(ABORT, 'rights_identities are append-only'); END;
    CREATE TRIGGER rights_records_no_update BEFORE UPDATE ON rights_records
      BEGIN SELECT RAISE(ABORT, 'rights_records are append-only'); END;
    CREATE TRIGGER rights_records_no_delete BEFORE DELETE ON rights_records
      BEGIN SELECT RAISE(ABORT, 'rights_records are append-only'); END;
    CREATE TRIGGER consents_no_update BEFORE UPDATE ON consents
      BEGIN SELECT RAISE(ABORT, 'consents are append-only'); END;
    CREATE TRIGGER consents_no_delete BEFORE DELETE ON consents
      BEGIN SELECT RAISE(ABORT, 'consents are append-only'); END;
    CREATE TRIGGER revocations_no_update BEFORE UPDATE ON revocations
      BEGIN SELECT RAISE(ABORT, 'revocations are append-only'); END;
    CREATE TRIGGER revocations_no_delete BEFORE DELETE ON revocations
      BEGIN SELECT RAISE(ABORT, 'revocations are append-only'); END;
  `);

  // A developer build may have created an early staging table before v5 was
  // formalized.  Add missing columns idempotently so an interrupted upgrade
  // remains resumable instead of silently dropping staged evidence.
  const stagingColumns = new Set(db.prepare('PRAGMA table_info(staging_objects)').all().map((row) => String(row.name)));
  const stagingAdditions = [
    ['command_id', 'TEXT'], ['job_attempt_id', 'TEXT'], ['import_item_id', 'TEXT'],
    ['expected_size', 'INTEGER'], ['current_size', 'INTEGER NOT NULL DEFAULT 0'],
    ['hash_algorithm', 'TEXT'], ['sha256', 'TEXT'], ['source_path_fingerprint', 'TEXT'],
    ['source_file_identity_json', 'TEXT'], ['os_file_identity_json', 'TEXT'],
    ['reparse_state', "TEXT NOT NULL DEFAULT 'UNKNOWN'"], ['finalization_identity_json', 'TEXT'],
    ['row_version', 'INTEGER NOT NULL DEFAULT 1'], ['updated_at_utc_us', 'INTEGER NOT NULL DEFAULT 0'],
  ];
  for (const [column, definition] of stagingAdditions) {
    if (!stagingColumns.has(column)) db.exec(`ALTER TABLE staging_objects ADD COLUMN ${column} ${definition}`);
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS staging_objects_command_uq ON staging_objects(command_id) WHERE command_id IS NOT NULL');
  db.exec('CREATE INDEX IF NOT EXISTS staging_objects_state_idx ON staging_objects(state, updated_at_utc_us DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS staging_objects_import_idx ON staging_objects(import_item_id, created_at_utc_us DESC)');
  db.exec(`DROP TRIGGER IF EXISTS staging_objects_identity_no_update;
    CREATE TRIGGER staging_objects_identity_no_update
      BEFORE UPDATE ON staging_objects
      WHEN NEW.id IS NOT OLD.id
        OR NEW.command_id IS NOT OLD.command_id
        OR NEW.job_attempt_id IS NOT OLD.job_attempt_id
        OR (OLD.import_item_id IS NOT NULL AND NEW.import_item_id IS NOT OLD.import_item_id)
        OR NEW.temp_path IS NOT OLD.temp_path
        OR NEW.expected_size IS NOT OLD.expected_size
        OR NEW.hash_algorithm IS NOT OLD.hash_algorithm
        OR (OLD.sha256 IS NOT NULL AND NEW.sha256 IS NOT OLD.sha256)
        OR NEW.source_path_fingerprint IS NOT OLD.source_path_fingerprint
        OR NEW.source_file_identity_json IS NOT OLD.source_file_identity_json
        OR (OLD.os_file_identity_json IS NOT NULL AND NEW.os_file_identity_json IS NOT OLD.os_file_identity_json)
        OR NEW.reparse_state IS NOT OLD.reparse_state
        OR (OLD.finalization_identity_json IS NOT NULL AND NEW.finalization_identity_json IS NOT OLD.finalization_identity_json)
        OR NEW.created_at_utc_us IS NOT OLD.created_at_utc_us
      BEGIN SELECT RAISE(ABORT, 'staging object identity is immutable'); END`);

  // Handoff tables were introduced after the first V1 database images. Keep
  // upgrades additive and resumable when a developer or portable install has
  // already created an early version of either table without the target
  // metadata columns. Existing rows receive explicit conservative values;
  // immutable identity and manifest triggers below remain authoritative.
  const exportSessionColumns = new Set(db.prepare('PRAGMA table_info(export_sessions)').all().map((row) => String(row.name)));
  const exportSessionAdditions = [
    ['target_profile', "TEXT NOT NULL DEFAULT 'GENERIC_INTERCHANGE'"],
    ['target_editor', "TEXT NOT NULL DEFAULT 'UNKNOWN_EDITOR'"],
    ['target_version', "TEXT NOT NULL DEFAULT 'UNKNOWN'"],
    ['output_manifest_id', 'TEXT'],
    ['next_step', 'TEXT'],
    ['row_version', 'INTEGER NOT NULL DEFAULT 1'],
  ];
  for (const [column, definition] of exportSessionAdditions) {
    if (!exportSessionColumns.has(column)) db.exec(`ALTER TABLE export_sessions ADD COLUMN ${column} ${definition}`);
  }
  const handoffManifestColumns = new Set(db.prepare('PRAGMA table_info(handoff_manifests)').all().map((row) => String(row.name)));
  const handoffManifestAdditions = [
    ['target_editor', "TEXT NOT NULL DEFAULT 'UNKNOWN_EDITOR'"],
    ['target_version', "TEXT NOT NULL DEFAULT 'UNKNOWN'"],
    ['compatibility_profile_version', "TEXT NOT NULL DEFAULT 'HANDOFF_COMPATIBILITY_V1'"],
    ['manifest_hash', "TEXT NOT NULL DEFAULT ''"],
    ['manifest_json', "TEXT NOT NULL DEFAULT '{}'"],
    ['artifact_allowlist_json', "TEXT NOT NULL DEFAULT '[]'"],
    ['compatibility_report_json', "TEXT NOT NULL DEFAULT '{}'"],
    ['sanitization_report_json', "TEXT NOT NULL DEFAULT '{}'"],
  ];
  for (const [column, definition] of handoffManifestAdditions) {
    if (!handoffManifestColumns.has(column)) db.exec(`ALTER TABLE handoff_manifests ADD COLUMN ${column} ${definition}`);
  }
  db.exec(`
    DROP TRIGGER IF EXISTS export_sessions_no_delete;
    CREATE TRIGGER export_sessions_no_delete BEFORE DELETE ON export_sessions
      BEGIN SELECT RAISE(ABORT, 'export_sessions are append-only'); END;
    DROP TRIGGER IF EXISTS export_sessions_identity_no_update;
    CREATE TRIGGER export_sessions_identity_no_update BEFORE UPDATE ON export_sessions
      WHEN NEW.id IS NOT OLD.id
        OR NEW.project_id IS NOT OLD.project_id
        OR NEW.timeline_revision_id IS NOT OLD.timeline_revision_id
        OR NEW.deliverable_type IS NOT OLD.deliverable_type
        OR NEW.target_profile IS NOT OLD.target_profile
        OR NEW.target_editor IS NOT OLD.target_editor
        OR NEW.target_version IS NOT OLD.target_version
        OR NEW.command_id IS NOT OLD.command_id
        OR NEW.review_session_id IS NOT OLD.review_session_id
        OR NEW.dependency_snapshot_hash IS NOT OLD.dependency_snapshot_hash
        OR NEW.subject_content_hash IS NOT OLD.subject_content_hash
        OR NEW.media_profile_revision_id IS NOT OLD.media_profile_revision_id
        OR NEW.created_by_actor_id IS NOT OLD.created_by_actor_id
        OR NEW.created_at_utc_us IS NOT OLD.created_at_utc_us
      BEGIN SELECT RAISE(ABORT, 'export_session identity is immutable'); END;
    DROP TRIGGER IF EXISTS handoff_manifests_no_update;
    CREATE TRIGGER handoff_manifests_no_update BEFORE UPDATE ON handoff_manifests
      BEGIN SELECT RAISE(ABORT, 'handoff_manifests are append-only'); END;
    DROP TRIGGER IF EXISTS handoff_manifests_no_delete;
    CREATE TRIGGER handoff_manifests_no_delete BEFORE DELETE ON handoff_manifests
      BEGIN SELECT RAISE(ABORT, 'handoff_manifests are append-only'); END;
  `);

  // v15 release-candidate upgrades are additive and deliberately recreate the
  // identity guard on every open.  This keeps a pre-v15/partially-created
  // local database fail-closed even if its original trigger was incomplete.
  const releaseCandidateColumns = new Set(db.prepare('PRAGMA table_info(release_candidates)').all().map((row) => String(row.name)));
  const requiredReleaseCandidateColumns = ['id', 'project_id', 'timeline_revision_id', 'state', 'next_step', 'command_id', 'created_by_actor_id', 'created_at_utc_us'];
  const missingReleaseCandidateColumns = requiredReleaseCandidateColumns.filter((column) => !releaseCandidateColumns.has(column));
  if (missingReleaseCandidateColumns.length > 0) {
    throw new Error(`release_candidates schema is incomplete; missing required columns: ${missingReleaseCandidateColumns.join(', ')}`);
  }
  const releaseCandidateAdditions = [
    ['audio_master_asset_revision_id', 'TEXT'],
    ['subtitle_manifest_json', "TEXT NOT NULL DEFAULT '{}'"],
    ['media_profile_revision_id', "TEXT NOT NULL DEFAULT ''"],
    ['review_session_id', 'TEXT'],
    ['readiness_digest', "TEXT NOT NULL DEFAULT ''"],
    ['rights_snapshot_hash', "TEXT NOT NULL DEFAULT ''"],
    ['readiness_snapshot_json', "TEXT NOT NULL DEFAULT '{}'"],
    ['readiness_snapshot_schema_version', 'INTEGER NOT NULL DEFAULT 1'],
    ['next_step', "TEXT NOT NULL DEFAULT ''"],
    ['row_version', 'INTEGER NOT NULL DEFAULT 1'],
    ['updated_at_utc_us', 'INTEGER NOT NULL DEFAULT 0'],
    ['cancelled_at_utc_us', 'INTEGER'],
  ];
  for (const [column, definition] of releaseCandidateAdditions) {
    if (!releaseCandidateColumns.has(column)) db.exec(`ALTER TABLE release_candidates ADD COLUMN ${column} ${definition}`);
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS release_candidates_project_state_idx
      ON release_candidates(project_id, state, created_at_utc_us DESC, id DESC);
    CREATE INDEX IF NOT EXISTS release_candidates_revision_idx
      ON release_candidates(timeline_revision_id, created_at_utc_us DESC, id DESC);
    CREATE INDEX IF NOT EXISTS release_candidates_command_idx
      ON release_candidates(command_id);
    CREATE UNIQUE INDEX IF NOT EXISTS release_candidates_exact_uq
      ON release_candidates(project_id, timeline_revision_id, readiness_digest);
    DROP TRIGGER IF EXISTS release_candidates_no_delete;
    CREATE TRIGGER release_candidates_no_delete BEFORE DELETE ON release_candidates
      BEGIN SELECT RAISE(ABORT, 'release_candidates are retained for audit'); END;
    DROP TRIGGER IF EXISTS release_candidates_identity_no_update;
    CREATE TRIGGER release_candidates_identity_no_update BEFORE UPDATE ON release_candidates
      WHEN NEW.id IS NOT OLD.id
        OR NEW.project_id IS NOT OLD.project_id
        OR NEW.timeline_revision_id IS NOT OLD.timeline_revision_id
        OR NEW.audio_master_asset_revision_id IS NOT OLD.audio_master_asset_revision_id
        OR NEW.subtitle_manifest_json IS NOT OLD.subtitle_manifest_json
        OR NEW.media_profile_revision_id IS NOT OLD.media_profile_revision_id
        OR NEW.review_session_id IS NOT OLD.review_session_id
        OR NEW.readiness_digest IS NOT OLD.readiness_digest
        OR NEW.rights_snapshot_hash IS NOT OLD.rights_snapshot_hash
        OR NEW.readiness_snapshot_json IS NOT OLD.readiness_snapshot_json
        OR NEW.readiness_snapshot_schema_version IS NOT OLD.readiness_snapshot_schema_version
        OR NEW.command_id IS NOT OLD.command_id
        OR NEW.created_by_actor_id IS NOT OLD.created_by_actor_id
        OR NEW.created_at_utc_us IS NOT OLD.created_at_utc_us
      BEGIN SELECT RAISE(ABORT, 'release_candidate identity is immutable'); END;
    DROP TRIGGER IF EXISTS release_candidates_terminal_no_update;
    CREATE TRIGGER release_candidates_terminal_no_update BEFORE UPDATE ON release_candidates
      WHEN OLD.state = 'CANCELLED' AND NEW.state <> 'CANCELLED'
      BEGIN SELECT RAISE(ABORT, 'cancelled release_candidates are terminal'); END;
  `);

  // v13 local timeline working-session baseline. Additive guards keep a
  // partially upgraded development database resumable while the identity
  // triggers remain authoritative for exact base/session fencing.
  const workingSessionColumns = new Set(db.prepare('PRAGMA table_info(timeline_working_sessions)').all().map((row) => String(row.name)));
  const workingSessionAdditions = [
    ['base_revision_row_version', 'INTEGER NOT NULL DEFAULT 1'],
    ['base_content_hash', "TEXT NOT NULL DEFAULT ''"],
    ['client_instance_id', "TEXT NOT NULL DEFAULT 'legacy-client'"],
    ['mode', "TEXT NOT NULL DEFAULT 'EXCLUSIVE'"],
    ['draft_payload_json', "TEXT NOT NULL DEFAULT '{}'"],
    ['draft_hash', "TEXT NOT NULL DEFAULT ''"],
    ['autosaved_hash', "TEXT NOT NULL DEFAULT ''"],
    ['last_acknowledged_op_seq', 'INTEGER NOT NULL DEFAULT 0'],
    ['history_cursor_seq', 'INTEGER NOT NULL DEFAULT 0'],
    ['next_op_seq', 'INTEGER NOT NULL DEFAULT 1'],
    ['last_checkpoint_revision_id', 'TEXT'],
    ['next_step', 'TEXT'],
    ['row_version', 'INTEGER NOT NULL DEFAULT 1'],
    ['last_autosave_at_utc_us', 'INTEGER'],
    ['updated_at_utc_us', 'INTEGER NOT NULL DEFAULT 0'],
    ['closed_at_utc_us', 'INTEGER'],
  ];
  for (const [column, definition] of workingSessionAdditions) {
    if (!workingSessionColumns.has(column)) db.exec(`ALTER TABLE timeline_working_sessions ADD COLUMN ${column} ${definition}`);
  }
  const editOpColumns = new Set(db.prepare('PRAGMA table_info(timeline_edit_ops)').all().map((row) => String(row.name)));
  const editOpAdditions = [
    ['before_payload_json', "TEXT NOT NULL DEFAULT '{}'"],
    ['after_payload_json', "TEXT NOT NULL DEFAULT '{}'"],
    ['result_hash', "TEXT NOT NULL DEFAULT ''"],
    ['history_state', "TEXT NOT NULL DEFAULT 'ACTIVE'"],
    ['client_op_id', 'TEXT'],
  ];
  for (const [column, definition] of editOpAdditions) {
    if (!editOpColumns.has(column)) db.exec(`ALTER TABLE timeline_edit_ops ADD COLUMN ${column} ${definition}`);
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS timeline_working_sessions_timeline_idx
      ON timeline_working_sessions(timeline_id, state, updated_at_utc_us DESC, id DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS timeline_working_sessions_active_uq
      ON timeline_working_sessions(timeline_id, actor_id)
      WHERE state IN ('OPEN', 'DIRTY', 'AUTOSAVING', 'CHECKPOINTING', 'CLEAN', 'CONFLICT', 'RECOVERY_REQUIRED');
    CREATE UNIQUE INDEX IF NOT EXISTS timeline_edit_ops_client_uq
      ON timeline_edit_ops(working_session_id, client_op_id)
      WHERE client_op_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS timeline_edit_ops_session_idx
      ON timeline_edit_ops(working_session_id, op_seq ASC);
    DROP TRIGGER IF EXISTS timeline_working_sessions_no_delete;
    CREATE TRIGGER timeline_working_sessions_no_delete BEFORE DELETE ON timeline_working_sessions
      BEGIN SELECT RAISE(ABORT, 'timeline_working_sessions are retained for recovery'); END;
    DROP TRIGGER IF EXISTS timeline_working_sessions_identity_no_update;
    CREATE TRIGGER timeline_working_sessions_identity_no_update BEFORE UPDATE ON timeline_working_sessions
      WHEN NEW.id IS NOT OLD.id
        OR NEW.timeline_id IS NOT OLD.timeline_id
        OR NEW.actor_id IS NOT OLD.actor_id
        OR NEW.client_instance_id IS NOT OLD.client_instance_id
        OR NEW.mode IS NOT OLD.mode
        OR NEW.created_at_utc_us IS NOT OLD.created_at_utc_us
      BEGIN SELECT RAISE(ABORT, 'timeline_working_session identity is immutable'); END;
    DROP TRIGGER IF EXISTS timeline_edit_ops_no_update_identity;
    CREATE TRIGGER timeline_edit_ops_no_update_identity BEFORE UPDATE ON timeline_edit_ops
      WHEN NEW.id IS NOT OLD.id
        OR NEW.working_session_id IS NOT OLD.working_session_id
        OR NEW.op_seq IS NOT OLD.op_seq
        OR NEW.op_type IS NOT OLD.op_type
        OR NEW.payload_json IS NOT OLD.payload_json
        OR NEW.before_payload_json IS NOT OLD.before_payload_json
        OR NEW.after_payload_json IS NOT OLD.after_payload_json
        OR NEW.result_hash IS NOT OLD.result_hash
         OR NEW.history_state IS NOT OLD.history_state
        OR NEW.actor_id IS NOT OLD.actor_id
        OR NEW.client_op_id IS NOT OLD.client_op_id
        OR NEW.created_at_utc_us IS NOT OLD.created_at_utc_us
      BEGIN SELECT RAISE(ABORT, 'timeline_edit_op content is immutable'); END;
    DROP TRIGGER IF EXISTS timeline_edit_ops_no_delete;
    CREATE TRIGGER timeline_edit_ops_no_delete BEFORE DELETE ON timeline_edit_ops
      BEGIN SELECT RAISE(ABORT, 'timeline_edit_ops are retained for causal history'); END;
  `);

  // v16 verified local timeline-interchange export evidence.  The handoff
  // manifest reference remains immutable input metadata; generated bytes are
  // bound through a distinct output asset revision and verified digest/size.
  // All additions are nullable/defaulted so a partially upgraded local image
  // can resume without rewriting prior handoff or canonical asset identity.
  const exportOutputColumns = new Set(db.prepare('PRAGMA table_info(export_sessions)').all().map((row) => String(row.name)));
  const exportOutputAdditions = [
    ['output_asset_revision_id', 'TEXT'],
    ['output_content_hash', 'TEXT'],
    ['output_byte_size', 'INTEGER'],
    ['validation_snapshot_json', "TEXT NOT NULL DEFAULT '{}'"],
  ];
  for (const [column, definition] of exportOutputAdditions) {
    if (!exportOutputColumns.has(column)) db.exec(`ALTER TABLE export_sessions ADD COLUMN ${column} ${definition}`);
  }
  // SQLite cannot add a foreign key or CHECK constraint with ALTER TABLE.  Validate
  // legacy rows before installing equivalent write guards so an upgraded image
  // never silently accepts malformed output evidence.
  const invalidExportOutput = db.prepare(`SELECT id, output_asset_revision_id, output_content_hash, output_byte_size
    FROM export_sessions
    WHERE (output_content_hash IS NOT NULL
      AND (length(output_content_hash) <> 64 OR output_content_hash GLOB '*[^0-9a-fA-F]*'))
       OR (output_byte_size IS NOT NULL
         AND (typeof(output_byte_size) <> 'integer' OR output_byte_size < 0 OR output_byte_size > 9007199254740991))
       OR (output_asset_revision_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM asset_revisions WHERE id = export_sessions.output_asset_revision_id))
    LIMIT 1`).get();
  if (invalidExportOutput) {
    throw new Error(`export_sessions output evidence is invalid for ${invalidExportOutput.id}`);
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS export_sessions_output_asset_idx
      ON export_sessions(output_asset_revision_id);
    DROP TRIGGER IF EXISTS export_sessions_no_delete;
    CREATE TRIGGER export_sessions_no_delete BEFORE DELETE ON export_sessions
      BEGIN SELECT RAISE(ABORT, 'export_sessions are append-only'); END;
    DROP TRIGGER IF EXISTS export_sessions_identity_no_update;
    CREATE TRIGGER export_sessions_identity_no_update BEFORE UPDATE ON export_sessions
      WHEN NEW.id IS NOT OLD.id
        OR NEW.project_id IS NOT OLD.project_id
        OR NEW.timeline_revision_id IS NOT OLD.timeline_revision_id
        OR NEW.deliverable_type IS NOT OLD.deliverable_type
        OR NEW.target_profile IS NOT OLD.target_profile
        OR NEW.target_editor IS NOT OLD.target_editor
        OR NEW.target_version IS NOT OLD.target_version
        OR NEW.command_id IS NOT OLD.command_id
        OR NEW.review_session_id IS NOT OLD.review_session_id
        OR NEW.dependency_snapshot_hash IS NOT OLD.dependency_snapshot_hash
        OR NEW.subject_content_hash IS NOT OLD.subject_content_hash
        OR NEW.media_profile_revision_id IS NOT OLD.media_profile_revision_id
        OR NEW.created_by_actor_id IS NOT OLD.created_by_actor_id
        OR NEW.created_at_utc_us IS NOT OLD.created_at_utc_us
      BEGIN SELECT RAISE(ABORT, 'export_session identity is immutable'); END;
    DROP TRIGGER IF EXISTS export_sessions_verified_output_no_update;
    CREATE TRIGGER export_sessions_verified_output_no_update BEFORE UPDATE ON export_sessions
      WHEN OLD.state IN ('VERIFIED', 'COMPLETED')
        AND (NEW.output_asset_revision_id IS NOT OLD.output_asset_revision_id
          OR NEW.output_content_hash IS NOT OLD.output_content_hash
          OR NEW.output_byte_size IS NOT OLD.output_byte_size
          OR NEW.validation_snapshot_json IS NOT OLD.validation_snapshot_json)
      BEGIN SELECT RAISE(ABORT, 'verified export output binding is immutable'); END;
    DROP TRIGGER IF EXISTS export_sessions_completed_no_update;
    CREATE TRIGGER export_sessions_completed_no_update BEFORE UPDATE ON export_sessions
      WHEN OLD.state = 'COMPLETED'
      BEGIN SELECT RAISE(ABORT, 'completed export session is immutable'); END;
    DROP TRIGGER IF EXISTS export_sessions_verified_no_resurrection;
    CREATE TRIGGER export_sessions_verified_no_resurrection BEFORE UPDATE ON export_sessions
      WHEN OLD.state = 'VERIFIED' AND NEW.state NOT IN ('VERIFIED', 'COMPLETED')
      BEGIN SELECT RAISE(ABORT, 'verified export session cannot regress'); END;
    DROP TRIGGER IF EXISTS export_sessions_output_hash_guard;
    CREATE TRIGGER export_sessions_output_hash_guard BEFORE INSERT ON export_sessions
      WHEN NEW.output_content_hash IS NOT NULL
        AND (length(NEW.output_content_hash) <> 64 OR NEW.output_content_hash GLOB '*[^0-9a-fA-F]*')
      BEGIN SELECT RAISE(ABORT, 'invalid export output content hash'); END;
    DROP TRIGGER IF EXISTS export_sessions_output_hash_update_guard;
    CREATE TRIGGER export_sessions_output_hash_update_guard BEFORE UPDATE ON export_sessions
      WHEN NEW.output_content_hash IS NOT NULL
        AND (length(NEW.output_content_hash) <> 64 OR NEW.output_content_hash GLOB '*[^0-9a-fA-F]*')
      BEGIN SELECT RAISE(ABORT, 'invalid export output content hash'); END;
    DROP TRIGGER IF EXISTS export_sessions_output_size_guard;
    CREATE TRIGGER export_sessions_output_size_guard BEFORE INSERT ON export_sessions
      WHEN NEW.output_byte_size IS NOT NULL
        AND (typeof(NEW.output_byte_size) <> 'integer' OR NEW.output_byte_size < 0 OR NEW.output_byte_size > 9007199254740991)
      BEGIN SELECT RAISE(ABORT, 'invalid export output byte size'); END;
    DROP TRIGGER IF EXISTS export_sessions_output_size_update_guard;
    CREATE TRIGGER export_sessions_output_size_update_guard BEFORE UPDATE ON export_sessions
      WHEN NEW.output_byte_size IS NOT NULL
        AND (typeof(NEW.output_byte_size) <> 'integer' OR NEW.output_byte_size < 0 OR NEW.output_byte_size > 9007199254740991)
      BEGIN SELECT RAISE(ABORT, 'invalid export output byte size'); END;
    DROP TRIGGER IF EXISTS export_sessions_output_asset_guard;
    CREATE TRIGGER export_sessions_output_asset_guard BEFORE INSERT ON export_sessions
      WHEN NEW.output_asset_revision_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM asset_revisions WHERE id = NEW.output_asset_revision_id)
      BEGIN SELECT RAISE(ABORT, 'missing export output asset revision'); END;
    DROP TRIGGER IF EXISTS export_sessions_output_asset_update_guard;
    CREATE TRIGGER export_sessions_output_asset_update_guard BEFORE UPDATE ON export_sessions
      WHEN NEW.output_asset_revision_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM asset_revisions WHERE id = NEW.output_asset_revision_id)
      BEGIN SELECT RAISE(ABORT, 'missing export output asset revision'); END;
  `);

  // Keep a durable migration ledger.  The v2-v6 tables/columns above are idempotent so
  // an interrupted upgrade can be resumed safely; recording every historical
  // version for a fresh installation preserves the baseline.
  const migrationVersions = new Set(db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => Number(row.version)));
  for (let version = 1; version <= SCHEMA_VERSION; version += 1) {
    if (!migrationVersions.has(version)) {
      db.prepare('INSERT INTO schema_migrations(version, applied_at_utc_us) VALUES (?, ?)').run(version, nowUtcUs());
    }
  }
  const installation = db.prepare('SELECT value FROM app_meta WHERE key = ?').get('installation_id');
  if (!installation) {
    db.prepare('INSERT INTO app_meta(key, value) VALUES (?, ?)').run('installation_id', uuidv7());
  }
  const generatedAt = db.prepare('SELECT value FROM app_meta WHERE key = ?').get('created_at_utc_us');
  if (!generatedAt) {
    db.prepare('INSERT INTO app_meta(key, value) VALUES (?, ?)').run('created_at_utc_us', String(nowUtcUs()));
  }
}
