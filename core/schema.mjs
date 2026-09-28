import { uuidv7, nowUtcUs } from './ids.mjs';
import { idempotencyFingerprint } from './canonical.mjs';

export const SCHEMA_VERSION = 8;

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
