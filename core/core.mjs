import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { initializeDatabase, SCHEMA_VERSION } from './schema.mjs';
import { isUuid, nowUtcUs, rfc3339FromUs, uuidv7 } from './ids.mjs';
import { canonicalJson, idempotencyFingerprint } from './canonical.mjs';

export const API_VERSION = '1';
export const CORE_VERSION = '0.1.0';

const TERMINAL_COMMAND_STATES = new Set([
  'SUCCEEDED', 'FAILED', 'CANCELLED', 'PARTIAL', 'SUCCEEDED_WITH_WARNINGS',
  'COMPENSATED', 'FAILED_COMPENSATION',
]);

const PROJECT_STATES = new Set(['ACTIVE', 'PAUSED', 'ARCHIVED', 'TRASHED']);
const TASK_STATES = new Set(['PLANNED', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED']);
const SHOT_STATES = new Set(['ACTIVE', 'PAUSED', 'ARCHIVED', 'TRASHED']);
const CHARACTER_STATES = new Set(['ACTIVE', 'ARCHIVED', 'RETIRED']);
const CHARACTER_REVISION_TYPES = new Set(['VISUAL', 'VOICE', 'PERFORMANCE']);
const CHARACTER_REVISION_STATES = new Set(['DRAFT', 'CANDIDATE', 'APPROVED', 'SUPERSEDED', 'REJECTED']);
const CHARACTER_REVISION_TRANSITIONS = Object.freeze({
  DRAFT: new Set(['CANDIDATE']),
  CANDIDATE: new Set(['APPROVED', 'REJECTED']),
  APPROVED: new Set(['SUPERSEDED']),
  SUPERSEDED: new Set(),
  REJECTED: new Set(),
});
const MEDIA_PROFILE_STATES = new Set(['DRAFT', 'CANDIDATE', 'APPROVED', 'SUPERSEDED', 'REJECTED']);
const MEDIA_PROFILE_TRANSITIONS = Object.freeze({
  DRAFT: new Set(['CANDIDATE']),
  CANDIDATE: new Set(['APPROVED', 'REJECTED']),
  APPROVED: new Set(['SUPERSEDED']),
  SUPERSEDED: new Set(),
  REJECTED: new Set(),
});
const TIMELINE_REVISION_STATES = new Set(['DRAFT_CHECKPOINT', 'CANDIDATE', 'APPROVED', 'SUPERSEDED']);
const TIMELINE_REVISION_TRANSITIONS = Object.freeze({
  DRAFT_CHECKPOINT: new Set(['CANDIDATE']),
  CANDIDATE: new Set(['APPROVED']),
  APPROVED: new Set(['SUPERSEDED']),
  SUPERSEDED: new Set(),
});
const REVIEW_SUBJECT_TYPES = new Set(['TIMELINE_REVISION']);
const REVIEW_STATES = new Set(['OPEN', 'IN_PROGRESS', 'SUBMITTED']);
const REVIEW_DECISIONS = new Set(['APPROVE', 'REJECT', 'REPAIR', 'ABSTAIN']);
const TIMELINE_TRACK_TYPES = new Set(['VIDEO', 'AUDIO', 'CAPTION', 'DATA']);
const MAX_RATIONAL_COMPONENT = 9_000_000_000;
const MAX_TIMELINE_TRACKS = 64;
const MAX_TIMELINE_CLIPS_PER_TRACK = 10_000;
const MAX_TIMELINE_MARKERS = 10_000;
const MAX_TIMELINE_DURATION_TICKS = 9_000_000_000;
const NOTE_ENTITY_TYPES = new Set(['PROJECT', 'TASK', 'SHOT']);
const DECISION_STATES = new Set(['OPEN', 'RESOLVED', 'DISMISSED', 'EXPIRED', 'OBSOLETE']);
const DECISION_SCOPE_TYPES = new Set(['TASK', 'SHOT', 'SCENE', 'PROJECT', 'RELEASE', 'SYSTEM']);
const DECISION_SEVERITIES = new Set(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']);
const ASSET_ORIGIN_TYPES = new Set(['IMPORTED', 'GENERATED', 'RECORDED', 'EXTERNAL_EDIT', 'HANDOFF_RETURN', 'SYSTEM']);
const ASSET_STORAGE_MODES = new Set(['COPY', 'REFERENCE']);
const RIGHTS_STATUSES = new Set(['ALLOWED', 'RESTRICTED', 'UNKNOWN', 'REVOKED', 'EXPIRED']);
const RIGHTS_STATUS_RANK = Object.freeze({ ALLOWED: 0, RESTRICTED: 1, UNKNOWN: 2, EXPIRED: 3, REVOKED: 4 });
const RIGHTS_SUBJECT_TYPES = /^[A-Z][A-Z0-9_.-]{0,63}$/;
const RIGHTS_TYPE = /^[A-Z][A-Z0-9_.-]{0,63}$/;
const DEFAULT_RIGHT_TYPE = 'SOURCE_USE';
const DEFAULT_CONSENT_TYPE = 'SOURCE_USE';
const BACKUP_DURABILITY_CLASSES = new Set(['LOCAL_WRITABLE', 'SEPARATE_VOLUME', 'OFFLINE', 'IMMUTABLE_REMOTE']);
const BACKUP_STATES = new Set(['CREATED', 'VERIFIED', 'FAILED', 'QUARANTINED']);
const BACKUP_FORMAT_VERSION = 1;
const DEFAULT_BACKUP_RESERVE_BYTES = 64 * 1024 * 1024;
const SHA256_HEX = /^[a-f0-9]{64}$/i;
const MAX_ASSET_METADATA_BYTES = 64 * 1024;
const STAGING_STATES = new Set(['WRITING', 'COMPLETE', 'VERIFIED', 'REGISTERED', 'ORPHANED', 'QUARANTINED', 'FAILED']);
const STAGING_TRANSITIONS = Object.freeze({
  WRITING: new Set(['COMPLETE', 'ORPHANED', 'FAILED', 'QUARANTINED']),
  COMPLETE: new Set(['VERIFIED', 'ORPHANED', 'QUARANTINED']),
  VERIFIED: new Set(['REGISTERED', 'ORPHANED', 'QUARANTINED']),
  REGISTERED: new Set(),
  ORPHANED: new Set(['QUARANTINED']),
  QUARANTINED: new Set(),
  FAILED: new Set(),
});

// The V1 schema uses a compact task vocabulary while the authoritative state
// machine calls the active/ready stages out separately.  IN_PROGRESS is the
// persisted equivalent of ACTIVE, and PLANNED is the persisted equivalent of
// READY.  Terminal task states are intentionally absorbing: a correction is a
// new command/record, never a silent resurrection of a completed or cancelled
// task.
const TASK_TRANSITIONS = Object.freeze({
  PLANNED: new Set(['IN_PROGRESS', 'BLOCKED', 'CANCELLED']),
  IN_PROGRESS: new Set(['DONE', 'BLOCKED', 'CANCELLED']),
  BLOCKED: new Set(['PLANNED', 'IN_PROGRESS', 'CANCELLED']),
  DONE: new Set(),
  CANCELLED: new Set(),
});

// Shots use a lifecycle axis rather than the production-task status axis.  A
// shot can be paused or archived, an archive can only be moved to trash, and
// trash can only be restored to ACTIVE.  This keeps destructive transitions
// explicit and prevents an update payload from bypassing the state machine.
const SHOT_TRANSITIONS = Object.freeze({
  ACTIVE: new Set(['PAUSED', 'ARCHIVED', 'TRASHED']),
  PAUSED: new Set(['ACTIVE', 'ARCHIVED', 'TRASHED']),
  ARCHIVED: new Set(['TRASHED']),
  TRASHED: new Set(['ACTIVE']),
});

export class CoreError extends Error {
  constructor(code, category, messageKey, messageArgs = {}, options = {}) {
    super(code);
    this.name = 'CoreError';
    this.code = code;
    this.category = category;
    this.messageKey = messageKey;
    this.messageArgs = messageArgs;
    this.retryable = Boolean(options.retryable);
    this.needsUser = options.needsUser === undefined ? category !== 'INTERNAL' : Boolean(options.needsUser);
    this.decisionRequestId = options.decisionRequestId ?? null;
    this.technicalDetails = options.technicalDetails ?? {};
  }

  toEnvelope() {
    return {
      code: this.code,
      category: this.category,
      user_message_key: this.messageKey,
      user_message_args: this.messageArgs,
      retryable: this.retryable,
      needs_user: this.needsUser,
      decision_request_id: this.decisionRequestId,
      technical_details: this.technicalDetails,
    };
  }
}

function json(value) {
  return JSON.stringify(value ?? {});
}

function parseJson(value, fallback = {}) {
  if (value === null || value === undefined || value === '') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function rowObject(row) {
  return row ? { ...row } : null;
}

function asInt(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : fallback;
}

function boundedInteger(value, field, { min = 0, max = MAX_RATIONAL_COMPONENT } = {}) {
  const number = typeof value === 'number' && Number.isSafeInteger(value)
    ? value
    : typeof value === 'string' && /^\d+$/.test(value.trim())
      ? Number(value.trim())
      : Number.NaN;
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field });
  }
  return number;
}

function rationalValue(value, field, { allowZero = true } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field });
  }
  const numerator = boundedInteger(value.num ?? value.numerator, `${field}.num`, { min: allowZero ? 0 : 1 });
  const denominator = boundedInteger(value.den ?? value.denominator, `${field}.den`, { min: 1 });
  return { num: numerator, den: denominator };
}

function normalizeRational(value, field, options = {}) {
  const rational = rationalValue(value, field, options);
  let numerator = BigInt(rational.num);
  let denominator = BigInt(rational.den);
  const gcd = (left, right) => {
    let a = left < 0n ? -left : left;
    let b = right < 0n ? -right : right;
    while (b !== 0n) {
      const next = a % b;
      a = b;
      b = next;
    }
    return a || 1n;
  };
  const divisor = gcd(numerator, denominator);
  numerator /= divisor;
  denominator /= divisor;
  if (numerator > BigInt(MAX_RATIONAL_COMPONENT) || denominator > BigInt(MAX_RATIONAL_COMPONENT)) {
    throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field });
  }
  return { num: Number(numerator), den: Number(denominator) };
}

function rationalCompare(left, right) {
  const lhs = BigInt(left.num) * BigInt(right.den);
  const rhs = BigInt(right.num) * BigInt(left.den);
  return lhs < rhs ? -1 : lhs > rhs ? 1 : 0;
}

function rationalSubtract(left, right) {
  const numerator = BigInt(left.num) * BigInt(right.den) - BigInt(right.num) * BigInt(left.den);
  const denominator = BigInt(left.den) * BigInt(right.den);
  if (numerator <= 0n || numerator > BigInt(MAX_RATIONAL_COMPONENT) || denominator > BigInt(MAX_RATIONAL_COMPONENT)) {
    throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field: 'duration' });
  }
  return { num: Number(numerator), den: Number(denominator) };
}

function pathKey(value) {
  const resolved = path.resolve(String(value));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function pathIsWithin(candidate, parent) {
  const childKey = pathKey(candidate);
  const parentKey = pathKey(parent);
  return childKey === parentKey || childKey.startsWith(`${parentKey}${path.sep}`);
}

function requiredString(value, field, maxLength = 500) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.required_field', { field });
  }
  const result = value.trim();
  if (result.length > maxLength) {
    throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.field_too_long', { field, max: maxLength });
  }
  return result;
}

function optionalString(value, field, maxLength = 10000, fallback = '') {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field });
  }
  return value;
}

function structuredValue(value, field, fallback, expectedKind, maxBytes = 128 * 1024) {
  if (value === undefined || value === null) return fallback;
  const valid = expectedKind === 'object'
    ? typeof value === 'object' && !Array.isArray(value)
    : expectedKind === 'array'
      ? Array.isArray(value)
      : typeof value === expectedKind;
  if (!valid) {
    throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field });
  }
  let encoded;
  try { encoded = JSON.stringify(value); } catch {
    throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field });
  }
  if (Buffer.byteLength(encoded, 'utf8') > maxBytes) {
    throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.field_too_large', { field, max_bytes: maxBytes });
  }
  return value;
}

function objectValue(value, field, fallback = {}) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field });
  }
  return structuredValue(value, field, fallback, 'object');
}

function arrayValue(value, field, fallback = []) {
  if (value === undefined || value === null) return fallback;
  if (!Array.isArray(value)) {
    throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field });
  }
  return structuredValue(value, field, fallback, 'array');
}

function enumValue(value, field, pattern, fallback = null) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== null) return fallback;
    throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.required_field', { field });
  }
  if (typeof value !== 'string') throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field });
  const normalized = value.trim().toUpperCase();
  if (!pattern.test(normalized)) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field });
  return normalized;
}

function nullableBoolean(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === 0 || value === 1 || value === '0' || value === '1') return Number(value);
  throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field });
}

function rightStatus(value, fallback = 'UNKNOWN') {
  const normalized = enumValue(value, 'status', RIGHTS_TYPE, fallback);
  if (!RIGHTS_STATUSES.has(normalized)) {
    throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_rights_status', { status: normalized });
  }
  return normalized;
}

function normalizeStringArray(value, field, maxItems = 100, maxLength = 100) {
  const array = arrayValue(value, field, []);
  if (array.length > maxItems) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.field_too_large', { field, max_items: maxItems });
  return array.map((item) => requiredString(item, field, maxLength).toUpperCase());
}

function utcUsValue(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) {
    const numeric = Number(value);
    if (Number.isSafeInteger(numeric) && numeric >= 0) return numeric;
  }
  if (typeof value === 'string') {
    const millis = Date.parse(value);
    if (Number.isFinite(millis) && millis >= 0 && Number.isSafeInteger(millis * 1000)) return millis * 1000;
  }
  throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field });
}

function slugify(value) {
  return value.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 52) || 'project';
}

function codeValue(value, title) {
  const code = value === undefined || value === null || value === '' ? slugify(title) : requiredString(value, 'code', 64);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(code)) {
    throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_project_code', { field: 'code' });
  }
  return code;
}

function isoFields(row) {
  if (!row) return null;
  const out = rowObject(row);
  for (const field of ['created_at_utc_us', 'updated_at_utc_us']) {
    if (out[field] !== undefined && out[field] !== null) out[field.replace('_utc_us', '')] = rfc3339FromUs(out[field]);
  }
  return out;
}

function publicProject(row) {
  return isoFields(row);
}

function publicTask(row) {
  return isoFields(row);
}

function publicShot(row) {
  return isoFields(row);
}

function publicNote(row) {
  const out = rowObject(row);
  if (out?.created_at_utc_us !== undefined) out.created_at = rfc3339FromUs(out.created_at_utc_us);
  return out;
}

function publicDecisionChoice(row) {
  if (!row) return null;
  const out = rowObject(row);
  out.command_template = parseJson(out.command_template_json, {});
  out.consequence_summary = parseJson(out.consequence_summary_json, {});
  out.recommended = Boolean(Number(out.recommended));
  if (out.created_at_utc_us !== undefined && out.created_at_utc_us !== null) {
    out.created_at = rfc3339FromUs(out.created_at_utc_us);
  }
  delete out.command_template_json;
  delete out.consequence_summary_json;
  delete out.created_at_utc_us;
  return out;
}

function publicDecision(row, choices = [], projectTitle = null) {
  if (!row) return null;
  const out = rowObject(row);
  out.reason_args = parseJson(out.reason_args_json, {});
  out.affected_entities = parseJson(out.affected_entities_json, []);
  out.evidence = parseJson(out.evidence_json, []);
  out.default_behavior = parseJson(out.default_behavior_json, {});
  out.title = out.title_key;
  out.reason = out.reason_key;
  out.project_title = projectTitle ?? null;
  out.decision_version = Number(out.row_version);
  if (out.created_at_utc_us !== undefined && out.created_at_utc_us !== null) {
    out.created_at = rfc3339FromUs(out.created_at_utc_us);
  }
  if (out.updated_at_utc_us !== undefined && out.updated_at_utc_us !== null) {
    out.updated_at = rfc3339FromUs(out.updated_at_utc_us);
  }
  if (out.deadline_at_utc_us !== undefined && out.deadline_at_utc_us !== null) {
    out.deadline_at = rfc3339FromUs(out.deadline_at_utc_us);
  } else {
    out.deadline_at = null;
  }
  if (out.resolved_at_utc_us !== undefined && out.resolved_at_utc_us !== null) {
    out.resolved_at = rfc3339FromUs(out.resolved_at_utc_us);
  } else {
    out.resolved_at = null;
  }
  out.choices = choices.map(publicDecisionChoice).filter(Boolean);
  delete out.reason_args_json;
  delete out.affected_entities_json;
  delete out.evidence_json;
  delete out.default_behavior_json;
  delete out.created_at_utc_us;
  delete out.updated_at_utc_us;
  delete out.deadline_at_utc_us;
  delete out.resolved_at_utc_us;
  return out;
}

function publicStorageObject(row) {
  if (!row) return null;
  const out = rowObject(row);
  if (out.verified_at_utc_us !== undefined && out.verified_at_utc_us !== null) out.verified_at = rfc3339FromUs(out.verified_at_utc_us);
  if (out.created_at_utc_us !== undefined && out.created_at_utc_us !== null) out.created_at = rfc3339FromUs(out.created_at_utc_us);
  delete out.verified_at_utc_us;
  delete out.created_at_utc_us;
  return out;
}

function publicStagingObject(row) {
  if (!row) return null;
  const out = rowObject(row);
  for (const field of ['created_at_utc_us', 'updated_at_utc_us']) {
    if (out[field] !== undefined && out[field] !== null) out[field.replace('_utc_us', '')] = rfc3339FromUs(out[field]);
    delete out[field];
  }
  // A staging path is an internal resolver detail.  A basename is sufficient
  // for support/reconciliation while avoiding a local path disclosure.
  if (out.temp_path) out.temp_name = path.basename(String(out.temp_path));
  delete out.temp_path;
  out.source_file_identity = parseJson(out.source_file_identity_json, null);
  out.os_file_identity = parseJson(out.os_file_identity_json, null);
  out.finalization_identity = parseJson(out.finalization_identity_json, null);
  delete out.source_file_identity_json;
  delete out.os_file_identity_json;
  delete out.finalization_identity_json;
  return out;
}

function publicProvenance(row) {
  if (!row) return null;
  const out = rowObject(row);
  out.source_metadata = parseJson(out.source_metadata_json);
  if (out.created_at_utc_us !== undefined && out.created_at_utc_us !== null) out.created_at = rfc3339FromUs(out.created_at_utc_us);
  // The absolute source path remains an internal resolver detail.  A stable
  // fingerprint and basename preserve provenance without leaking local paths
  // into dashboard projections or remote logs.
  if (out.source_path_or_uri) {
    try { out.source_name = path.basename(fileURLToPath(out.source_path_or_uri)); } catch { out.source_name = path.basename(String(out.source_path_or_uri)); }
  }
  delete out.source_path_or_uri;
  delete out.source_metadata_json;
  delete out.created_at_utc_us;
  return out;
}

function publicAssetLocation(row) {
  if (!row) return null;
  const out = rowObject(row);
  if (out.last_verified_at_utc_us !== undefined && out.last_verified_at_utc_us !== null) out.last_verified_at = rfc3339FromUs(out.last_verified_at_utc_us);
  if (out.created_at_utc_us !== undefined && out.created_at_utc_us !== null) out.created_at = rfc3339FromUs(out.created_at_utc_us);
  // Managed object URIs are content references.  External absolute paths are
  // intentionally redacted; callers can use the fingerprint for reconciliation.
  if (out.location_type === 'EXTERNAL_PATH') out.path_or_uri = 'file://[redacted]';
  delete out.last_verified_at_utc_us;
  delete out.created_at_utc_us;
  return out;
}

function publicAssetRevision(row, storage, provenance, locations = []) {
  if (!row) return null;
  const out = rowObject(row);
  if (out.created_at_utc_us !== undefined && out.created_at_utc_us !== null) out.created_at = rfc3339FromUs(out.created_at_utc_us);
  delete out.created_at_utc_us;
  out.storage_object = publicStorageObject(storage);
  out.provenance = publicProvenance(provenance);
  out.locations = locations.map(publicAssetLocation);
  // Hash/storage availability is separate from media decode and security
  // evidence.  Until an explicit verifier records that evidence, consumers
  // must keep the revision in UNKNOWN readiness rather than treating a
  // materialized object as a safe/approved input.
  const externalReference = out.storage_object?.storage_class === 'EXTERNAL_REFERENCE'
    || locations.some((location) => location?.location_type === 'EXTERNAL_PATH');
  if (externalReference) {
    // The legacy availability CHECK predates external-link semantics.  The
    // additive evidence state and this projection keep REFERENCE explicitly
    // UNKNOWN until a verifier records current source availability.
    out.availability_state = 'UNKNOWN';
    out.availability_evidence_state = 'UNKNOWN';
  }
  out.readiness_state = !externalReference
    && out.availability_evidence_state === 'VERIFIED'
    && out.review_state === 'APPROVED' ? 'READY' : 'UNKNOWN';
  return out;
}

function publicAsset(row, revision, storage, provenance, locations = []) {
  if (!row) return null;
  const out = rowObject(row);
  for (const field of ['created_at_utc_us', 'updated_at_utc_us']) {
    if (out[field] !== undefined && out[field] !== null) out[field.replace('_utc_us', '')] = rfc3339FromUs(out[field]);
    delete out[field];
  }
  out.latest_revision = publicAssetRevision(revision, storage, provenance, locations);
  return out;
}

function publicCharacter(row) {
  if (!row) return null;
  const out = rowObject(row);
  for (const [source, target] of [
    ['created_at_utc_us', 'created_at'],
    ['updated_at_utc_us', 'updated_at'],
  ]) {
    if (out[source] !== undefined && out[source] !== null) out[target] = rfc3339FromUs(out[source]);
    delete out[source];
  }
  return out;
}

function publicCharacterRevision(row, jsonFields = []) {
  if (!row) return null;
  const out = rowObject(row);
  for (const field of jsonFields) {
    const jsonField = `${field}_json`;
    if (Object.prototype.hasOwnProperty.call(out, jsonField)) {
      out[field] = parseJson(out[jsonField], {});
      delete out[jsonField];
    }
  }
  if (out.created_at_utc_us !== undefined && out.created_at_utc_us !== null) out.created_at = rfc3339FromUs(out.created_at_utc_us);
  delete out.created_at_utc_us;
  out.state = out.lifecycle_state;
  return out;
}

function publicCharacterReference(row) {
  if (!row) return null;
  const out = rowObject(row);
  if (out.created_at_utc_us !== undefined && out.created_at_utc_us !== null) out.created_at = rfc3339FromUs(out.created_at_utc_us);
  delete out.created_at_utc_us;
  return out;
}

function publicMediaProfileRevision(row) {
  if (!row) return null;
  const out = rowObject(row);
  out.timeline_rate = { num: Number(out.timeline_rate_num), den: Number(out.timeline_rate_den) };
  out.time_base = { num: Number(out.time_base_num), den: Number(out.time_base_den) };
  out.pixel_aspect = { num: Number(out.pixel_aspect_num), den: Number(out.pixel_aspect_den) };
  out.proxy_profile = parseJson(out.proxy_profile_json, {});
  out.mastering_targets = parseJson(out.mastering_targets_json, {});
  out.state = out.lifecycle_state;
  if (out.created_at_utc_us !== undefined && out.created_at_utc_us !== null) out.created_at = rfc3339FromUs(out.created_at_utc_us);
  delete out.proxy_profile_json;
  delete out.mastering_targets_json;
  delete out.created_at_utc_us;
  return out;
}

function publicTimeline(row) {
  if (!row) return null;
  const out = rowObject(row);
  for (const [source, target] of [['created_at_utc_us', 'created_at'], ['updated_at_utc_us', 'updated_at']]) {
    if (out[source] !== undefined && out[source] !== null) out[target] = rfc3339FromUs(out[source]);
    delete out[source];
  }
  out.state = out.lifecycle_state;
  return out;
}

function publicTimelineClip(row) {
  if (!row) return null;
  const out = rowObject(row);
  out.timeline_in = { num: Number(out.timeline_in_num), den: Number(out.timeline_in_den) };
  out.timeline_out = { num: Number(out.timeline_out_num), den: Number(out.timeline_out_den) };
  out.speed = { num: Number(out.speed_num), den: Number(out.speed_den) };
  out.source_in = out.source_in_num === null || out.source_in_num === undefined ? null : { num: Number(out.source_in_num), den: Number(out.source_in_den) };
  out.source_out = out.source_out_num === null || out.source_out_num === undefined ? null : { num: Number(out.source_out_num), den: Number(out.source_out_den) };
  if (out.created_at_utc_us !== undefined && out.created_at_utc_us !== null) out.created_at = rfc3339FromUs(out.created_at_utc_us);
  for (const field of ['created_at_utc_us', 'timeline_in_num', 'timeline_in_den', 'timeline_out_num', 'timeline_out_den', 'source_in_num', 'source_in_den', 'source_out_num', 'source_out_den', 'speed_num', 'speed_den']) delete out[field];
  return out;
}

function publicTimelineMarker(row) {
  if (!row) return null;
  const out = rowObject(row);
  out.time = { num: Number(out.position_num), den: Number(out.position_den) };
  out.payload = parseJson(out.payload_json, {});
  if (out.created_at_utc_us !== undefined && out.created_at_utc_us !== null) out.created_at = rfc3339FromUs(out.created_at_utc_us);
  for (const field of ['position_num', 'position_den', 'payload_json', 'created_at_utc_us']) delete out[field];
  return out;
}

function publicTimelineTrack(row, clips = []) {
  if (!row) return null;
  const out = rowObject(row);
  out.enabled = Boolean(Number(out.enabled));
  out.clips = clips.map(publicTimelineClip).filter(Boolean);
  delete out.created_at_utc_us;
  return out;
}

function publicTimelineRevision(row, tracks = [], options = {}) {
  if (!row) return null;
  const out = rowObject(row);
  out.state = out.lifecycle_state;
  out.duration = { num: Number(out.duration_num), den: Number(out.duration_den) };
  out.tracks = tracks;
  out.markers = options.markers ?? [];
  out.readiness_state = options.readinessState ?? 'READY';
  out.next_step = options.nextStep ?? null;
  if (out.created_at_utc_us !== undefined && out.created_at_utc_us !== null) out.created_at = rfc3339FromUs(out.created_at_utc_us);
  for (const field of ['created_at_utc_us', 'duration_num', 'duration_den']) delete out[field];
  return out;
}

function publicHumanReview(row) {
  if (!row) return null;
  const out = rowObject(row);
  out.reason_codes = parseJson(out.reason_codes_json, []);
  if (out.reviewed_at_utc_us !== undefined && out.reviewed_at_utc_us !== null) out.reviewed_at = rfc3339FromUs(out.reviewed_at_utc_us);
  delete out.reason_codes_json;
  delete out.reviewed_at_utc_us;
  return out;
}

function publicReviewSession(row, humanReview = null, options = {}) {
  if (!row) return null;
  const out = rowObject(row);
  if (out.opened_at_utc_us !== undefined && out.opened_at_utc_us !== null) out.opened_at = rfc3339FromUs(out.opened_at_utc_us);
  if (out.submitted_at_utc_us !== undefined && out.submitted_at_utc_us !== null) out.submitted_at = rfc3339FromUs(out.submitted_at_utc_us);
  out.review_state = options.stale ? 'STALE' : out.state;
  out.stale = Boolean(options.stale);
  out.next_step = options.nextStep ?? null;
  out.human_review = publicHumanReview(humanReview);
  delete out.opened_at_utc_us;
  delete out.submitted_at_utc_us;
  return out;
}

function publicRightsIdentity(row) {
  if (!row) return null;
  const out = rowObject(row);
  if (out.created_at_utc_us !== undefined && out.created_at_utc_us !== null) out.created_at = rfc3339FromUs(out.created_at_utc_us);
  delete out.created_at_utc_us;
  return out;
}

function publicRightsRecord(row) {
  if (!row) return null;
  const out = rowObject(row);
  out.territory = parseJson(out.territory_json, []);
  out.purpose = parseJson(out.purpose_json, {});
  const evidenceSummary = parseJson(out.evidence_summary_json, {});
  // Evidence details can contain contracts, private notes, or source paths.
  // Public projections expose only presence, while the immutable row remains
  // available to an authorized local forensic/review workflow.
  out.evidence_summary_present = Boolean(evidenceSummary && typeof evidenceSummary === 'object' && Object.keys(evidenceSummary).length > 0);
  for (const [source, target] of [
    ['valid_from_utc_us', 'valid_from'], ['valid_to_utc_us', 'valid_to'], ['created_at_utc_us', 'created_at'],
  ]) {
    if (out[source] !== undefined && out[source] !== null) out[target] = rfc3339FromUs(out[source]);
    delete out[source];
  }
  for (const field of ['commercial_allowed', 'derivative_allowed', 'training_allowed', 'cloning_allowed', 'attribution_required']) {
    if (out[field] !== null && out[field] !== undefined) out[field] = Boolean(Number(out[field]));
  }
  delete out.territory_json;
  delete out.purpose_json;
  delete out.evidence_summary_json;
  return out;
}

function publicConsent(row) {
  if (!row) return null;
  const out = rowObject(row);
  for (const [source, target] of [
    ['valid_from_utc_us', 'valid_from'], ['valid_to_utc_us', 'valid_to'], ['created_at_utc_us', 'created_at'],
  ]) {
    if (out[source] !== undefined && out[source] !== null) out[target] = rfc3339FromUs(out[source]);
    delete out[source];
  }
  return out;
}

function publicRevocation(row) {
  if (!row) return null;
  const out = rowObject(row);
  for (const [source, target] of [['effective_at_utc_us', 'effective_at'], ['created_at_utc_us', 'created_at']]) {
    if (out[source] !== undefined && out[source] !== null) out[target] = rfc3339FromUs(out[source]);
    delete out[source];
  }
  return out;
}

function publicRightsEvaluation(value) {
  if (!value) return null;
  const out = rowObject(value);
  out.status = out.status ?? out.state ?? 'UNKNOWN';
  out.state = out.status;
  out.eligible = Boolean(out.eligible);
  if (out.evaluated_at_utc_us !== undefined && out.evaluated_at_utc_us !== null) out.evaluated_at = rfc3339FromUs(out.evaluated_at_utc_us);
  delete out.evaluated_at_utc_us;
  out.blockers = Array.isArray(out.blockers) ? out.blockers : [];
  out.evidence = Array.isArray(out.evidence) ? out.evidence : [];
  return out;
}

function publicBackup(row) {
  if (!row) return null;
  const out = rowObject(row);
  for (const [source, target] of [['created_at_utc_us', 'created_at'], ['completed_at_utc_us', 'completed_at']]) {
    if (out[source] !== undefined && out[source] !== null) out[target] = rfc3339FromUs(out[source]);
    delete out[source];
  }
  if (out.destination_path) out.destination_name = path.basename(String(out.destination_path));
  if (out.manifest_path) out.manifest_name = path.basename(String(out.manifest_path));
  if (out.snapshot_path) out.snapshot_name = path.basename(String(out.snapshot_path));
  delete out.destination_path;
  delete out.manifest_path;
  delete out.snapshot_path;
  return out;
}

function publicBackupVerification(row) {
  if (!row) return null;
  const out = rowObject(row);
  out.details = parseJson(out.details_json, {});
  if (out.created_at_utc_us !== undefined && out.created_at_utc_us !== null) out.created_at = rfc3339FromUs(out.created_at_utc_us);
  delete out.details_json;
  delete out.created_at_utc_us;
  return out;
}

function publicImportSession(row) {
  if (!row) return null;
  const out = rowObject(row);
  for (const field of ['created_at_utc_us', 'updated_at_utc_us']) {
    if (out[field] !== undefined && out[field] !== null) out[field.replace('_utc_us', '')] = rfc3339FromUs(out[field]);
    delete out[field];
  }
  if (out.source_root) out.source_root = 'file://[redacted]';
  return out;
}

function publicImportItem(row) {
  if (!row) return null;
  const out = rowObject(row);
  if (out.created_at_utc_us !== undefined && out.created_at_utc_us !== null) out.created_at = rfc3339FromUs(out.created_at_utc_us);
  if (out.source_path_or_uri) {
    try { out.source_name = path.basename(fileURLToPath(out.source_path_or_uri)); } catch { out.source_name = path.basename(String(out.source_path_or_uri)); }
    out.source_path_or_uri = 'file://[redacted]';
  }
  delete out.created_at_utc_us;
  return out;
}

function terminalStatus(status) {
  return TERMINAL_COMMAND_STATES.has(status);
}

function commandResult(row) {
  const out = rowObject(row);
  if (!out) return null;
  out.payload = parseJson(out.payload_json);
  out.expected_versions = parseJson(out.expected_versions_json);
  out.result = parseJson(out.result_json, null);
  out.error_details = parseJson(out.error_details_json, null);
  delete out.payload_json;
  delete out.expected_versions_json;
  delete out.result_json;
  delete out.error_details_json;
  return out;
}

export class CoreService {
  constructor(options = {}) {
    const dbPath = options.dbPath ?? path.join(process.cwd(), '.cineforge', 'cineforge.sqlite');
    if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
    this.dbPath = dbPath;
    this.assetStorePath = path.resolve(options.assetStorePath
      ?? (dbPath === ':memory:' ? path.join(process.cwd(), '.cineforge', 'asset-store') : path.join(path.dirname(path.resolve(dbPath)), 'asset-store')));
    this.maxAssetBytes = Number.isSafeInteger(options.maxAssetBytes) && options.maxAssetBytes >= 0
      ? options.maxAssetBytes : 8 * 1024 * 1024 * 1024;
    this.db = new DatabaseSync(dbPath);
    initializeDatabase(this.db);
    this._bootstrap(options);
  }

  close() {
    this.db.close();
  }

  _bootstrap(options) {
    this._transaction(() => {
      const studio = this.db.prepare('SELECT * FROM studios ORDER BY created_at_utc_us LIMIT 1').get();
      if (!studio) {
        const studioId = uuidv7();
        this.db.prepare('INSERT INTO studios(id, name, default_locale, created_at_utc_us) VALUES (?, ?, ?, ?)')
          .run(studioId, options.studioName ?? 'CineForge Studio', options.locale ?? 'vi-VN', nowUtcUs());
        this._setMeta('studio_id', studioId);
      } else if (!this._getMeta('studio_id')) {
        this._setMeta('studio_id', studio.id);
      }

      const currentStudioId = this._getMeta('studio_id');
      const actor = this.db.prepare('SELECT * FROM actors ORDER BY created_at_utc_us LIMIT 1').get();
      if (!actor) {
        const actorId = options.actorId && isUuid(options.actorId) ? options.actorId : uuidv7();
        this.db.prepare(`INSERT INTO actors
          (id, studio_id, actor_type, display_name, locale, status, created_at_utc_us)
          VALUES (?, ?, 'HUMAN', ?, ?, 'ACTIVE', ?)`)
          .run(actorId, currentStudioId, options.actorName ?? 'Local Creator', options.locale ?? 'vi-VN', nowUtcUs());
        this._setMeta('actor_id', actorId);
      } else if (!this._getMeta('actor_id')) {
        this._setMeta('actor_id', actor.id);
      }
    });
    this.studioId = this._getMeta('studio_id');
    this.actorId = this._getMeta('actor_id');
    // Reconcile only durable, non-terminal staging rows.  This is an
    // auditable system command so startup never silently adopts unknown bytes;
    // missing/changed/reparse paths become ORPHANED or QUARANTINED.
    try {
      const pending = this.db.prepare(`SELECT 1 FROM staging_objects
        WHERE state IN ('WRITING', 'COMPLETE', 'VERIFIED') LIMIT 1`).get();
      if (pending) this.executeCommand({ command_type: 'ReconcileStaging', payload: {} });
    } catch {
      // Core remains available for read-only recovery even if reconciliation
      // itself encounters a damaged staging row.
    }
  }

  _getMeta(key) {
    return this.db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key)?.value ?? null;
  }

  _setMeta(key, value) {
    this.db.prepare(`INSERT INTO app_meta(key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, String(value));
  }

  _transaction(callback) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = callback();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* preserve original error */ }
      throw error;
    }
  }

  _projectionSeq() {
    return Number(this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM domain_events').get().seq);
  }

  _project(projectId) {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    if (!row) throw new CoreError('NOT_FOUND', 'VALIDATION', 'errors.project_not_found', { project_id: projectId });
    return row;
  }

  _character(characterId) {
    const id = requiredString(characterId, 'character_id');
    const row = this.db.prepare('SELECT * FROM characters WHERE id = ?').get(id);
    if (!row) throw new CoreError('CHARACTER_NOT_FOUND', 'VALIDATION', 'errors.character_not_found', { character_id: id });
    return row;
  }

  _characterPackage(characterId, kind) {
    const character = this._character(characterId);
    const table = kind === 'VISUAL' ? 'visual_identity_packages'
      : kind === 'VOICE' ? 'voice_identity_packages' : 'performance_bibles';
    const row = this.db.prepare(`SELECT * FROM ${table} WHERE character_id = ?`).get(character.id);
    if (!row) throw new CoreError('CHARACTER_PACKAGE_NOT_FOUND', 'INTERNAL', 'errors.character_package_not_found', { character_id: character.id, package_type: kind }, { needsUser: false });
    return { character, row };
  }

  _characterRevision(kind, revisionId) {
    const id = requiredString(revisionId, 'revision_id');
    if (!CHARACTER_REVISION_TYPES.has(kind)) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field: 'revision_type' });
    const table = kind === 'VISUAL' ? 'visual_identity_revisions'
      : kind === 'VOICE' ? 'voice_identity_revisions' : 'performance_bible_revisions';
    const packageTable = kind === 'VISUAL' ? 'visual_identity_packages'
      : kind === 'VOICE' ? 'voice_identity_packages' : 'performance_bibles';
    const packageColumn = kind === 'PERFORMANCE' ? 'performance_bible_id' : 'package_id';
    const row = this.db.prepare(`SELECT r.*, p.character_id
      FROM ${table} r JOIN ${packageTable} p ON p.id = r.${packageColumn}
      WHERE r.id = ?`).get(id);
    if (!row) throw new CoreError('CHARACTER_REVISION_NOT_FOUND', 'VALIDATION', 'errors.character_revision_not_found', { revision_id: id });
    const character = this._character(row.character_id);
    return { row, character, table, packageTable, packageColumn };
  }

  _assertCharacterProjectScope(payload, character) {
    const supplied = payload?.project_id ?? payload?.projectId;
    if (supplied !== undefined && supplied !== null && supplied !== character.project_id) {
      throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', {
        entity_type: 'CHARACTER', entity_id: character.id, project_id: supplied, actual_project_id: character.project_id,
      }, { needsUser: true });
    }
    if (supplied) this._project(supplied);
  }

  _task(taskId) {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (!row) throw new CoreError('NOT_FOUND', 'VALIDATION', 'errors.task_not_found', { task_id: taskId });
    return row;
  }

  _shot(shotId) {
    const row = this.db.prepare('SELECT * FROM shots WHERE id = ?').get(shotId);
    if (!row) throw new CoreError('NOT_FOUND', 'VALIDATION', 'errors.shot_not_found', { shot_id: shotId });
    return row;
  }

  _mediaProfileRevision(revisionId) {
    const id = requiredString(revisionId, 'media_profile_revision_id');
    const row = this.db.prepare(`SELECT r.*, p.project_id, p.id AS profile_id
      FROM project_media_profile_revisions r
      JOIN project_media_profiles p ON p.id = r.profile_id
      WHERE r.id = ?`).get(id);
    if (!row) throw new CoreError('MEDIA_PROFILE_REVISION_NOT_FOUND', 'VALIDATION', 'errors.media_profile_revision_not_found', { media_profile_revision_id: id });
    return row;
  }

  _timeline(timelineId) {
    const id = requiredString(timelineId, 'timeline_id');
    const row = this.db.prepare('SELECT * FROM timelines WHERE id = ?').get(id);
    if (!row) throw new CoreError('TIMELINE_NOT_FOUND', 'VALIDATION', 'errors.timeline_not_found', { timeline_id: id });
    return row;
  }

  _timelineRevision(revisionId) {
    const id = requiredString(revisionId, 'timeline_revision_id');
    const row = this.db.prepare(`SELECT r.*, t.project_id, t.code AS timeline_code, t.title AS timeline_title,
        t.scope_type, t.scope_id, t.row_version AS timeline_row_version
      FROM timeline_revisions r JOIN timelines t ON t.id = r.timeline_id WHERE r.id = ?`).get(id);
    if (!row) throw new CoreError('TIMELINE_REVISION_NOT_FOUND', 'VALIDATION', 'errors.timeline_revision_not_found', { timeline_revision_id: id });
    return row;
  }

  _assertTimelineProjectScope(payload, projectId, entityType, entityId) {
    this._assertPayloadProjectScope(payload, projectId, entityType, entityId);
    const suppliedProfile = payload?.media_profile_revision_id ?? payload?.mediaProfileRevisionId;
    if (suppliedProfile) {
      const profile = this._mediaProfileRevision(suppliedProfile);
      if (profile.project_id !== projectId) {
        throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', {
          entity_type: 'MEDIA_PROFILE_REVISION', entity_id: suppliedProfile, project_id: projectId, actual_project_id: profile.project_id,
        }, { needsUser: true });
      }
    }
  }

  _decision(decisionRequestId) {
    const id = requiredString(decisionRequestId, 'decision_request_id');
    const row = this.db.prepare('SELECT * FROM decision_requests WHERE id = ?').get(id);
    if (!row) throw new CoreError('NOT_FOUND', 'VALIDATION', 'errors.decision_request_not_found', { decision_request_id: id });
    return row;
  }

  _decisionChoices(decisionRequestId) {
    return this.db.prepare(`SELECT * FROM decision_choices
      WHERE decision_request_id = ? ORDER BY sort_order ASC, id ASC`).all(decisionRequestId);
  }

  _publicDecision(row) {
    if (!row) return null;
    const projectTitle = row.project_id
      ? this.db.prepare('SELECT title FROM projects WHERE id = ?').get(row.project_id)?.title ?? row.project_id
      : null;
    return publicDecision(row, this._decisionChoices(row.id), projectTitle);
  }

  _asset(assetId) {
    const row = this.db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId);
    if (!row) throw new CoreError('NOT_FOUND', 'VALIDATION', 'errors.asset_not_found', { asset_id: assetId });
    return row;
  }

  _rightsIdentity(identityId) {
    const id = requiredString(identityId, 'rights_identity_id');
    const row = this.db.prepare('SELECT * FROM rights_identities WHERE id = ?').get(id);
    if (!row) throw new CoreError('NOT_FOUND', 'VALIDATION', 'errors.rights_identity_not_found', { rights_identity_id: id });
    return row;
  }

  _assertRightsProjectScope(payload, identity) {
    const supplied = payload?.project_id ?? payload?.projectId;
    if (supplied !== undefined && supplied !== null && supplied !== identity.project_id) {
      throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', {
        entity_type: 'RIGHTS_IDENTITY', entity_id: identity.id, project_id: supplied, actual_project_id: identity.project_id,
      }, { needsUser: true });
    }
    if (supplied) this._project(supplied);
  }

  _rightsTerritoryMatches(value, requested) {
    if (!requested) return true;
    const territories = Array.isArray(value) ? value.map((item) => String(item).trim().toUpperCase()) : [];
    if (territories.length === 0 || territories.includes('*') || territories.includes('WORLDWIDE')) return true;
    return territories.includes(String(requested).trim().toUpperCase());
  }

  _rightsPurposeMatches(value, requested) {
    if (!requested) return true;
    const wanted = String(requested).trim().toUpperCase();
    if (Array.isArray(value)) return value.map((item) => String(item).trim().toUpperCase()).includes(wanted);
    if (!value || typeof value !== 'object') return true;
    const list = value.allowed ?? value.allowed_purposes ?? value.purposes ?? value.types;
    if (Array.isArray(list)) return list.map((item) => String(item).trim().toUpperCase()).includes(wanted);
    if (Object.prototype.hasOwnProperty.call(value, wanted)) return Boolean(value[wanted]);
    if (Object.prototype.hasOwnProperty.call(value, requested)) return Boolean(value[requested]);
    return true;
  }

  _rightsActive(row, atUtcUs) {
    return (row.valid_from_utc_us === null || row.valid_from_utc_us === undefined || Number(row.valid_from_utc_us) <= atUtcUs)
      && (row.valid_to_utc_us === null || row.valid_to_utc_us === undefined || Number(row.valid_to_utc_us) > atUtcUs);
  }

  _rightsHistorical(row, atUtcUs) {
    return (row.valid_from_utc_us === null || row.valid_from_utc_us === undefined || Number(row.valid_from_utc_us) <= atUtcUs)
      && row.valid_to_utc_us !== null && row.valid_to_utc_us !== undefined && Number(row.valid_to_utc_us) <= atUtcUs;
  }

  _evaluateRights(identityId, options = {}) {
    const identity = this._rightsIdentity(identityId);
    const atUtcUs = utcUsValue(options.at_utc_us ?? options.atUtcUs ?? options.at, 'at_utc_us') ?? nowUtcUs();
    const rightType = enumValue(options.right_type ?? options.rightType, 'right_type', RIGHTS_TYPE, DEFAULT_RIGHT_TYPE);
    const requireConsent = options.require_consent === undefined && options.requireConsent === undefined
      ? true : Boolean(options.require_consent ?? options.requireConsent);
    const consentType = requireConsent
      ? enumValue(options.consent_type ?? options.consentType, 'consent_type', RIGHTS_TYPE, DEFAULT_CONSENT_TYPE)
      : null;
    const territory = options.territory ?? options.territory_code ?? options.territoryCode ?? null;
    if (territory !== null && (typeof territory !== 'string' || territory.trim().length > 100)) {
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field: 'territory' });
    }
    const purpose = options.purpose ?? options.purpose_type ?? options.purposeType ?? null;
    const records = this.db.prepare(`SELECT * FROM rights_records
      WHERE rights_identity_id = ? AND right_type = ?
      ORDER BY created_at_utc_us DESC, id DESC`).all(identity.id, rightType);
    const consents = consentType ? this.db.prepare(`SELECT * FROM consents
      WHERE rights_identity_id = ? AND consent_type = ?
      ORDER BY created_at_utc_us DESC, id DESC`).all(identity.id, consentType) : [];
    const revocations = this.db.prepare(`SELECT * FROM revocations
      WHERE rights_identity_id = ? AND effective_at_utc_us <= ?
      ORDER BY effective_at_utc_us DESC, created_at_utc_us DESC, id DESC`).all(identity.id, atUtcUs);
    const blockers = [];
    const evidence = [];
    const applicable = (row, dimension) => dimension === 'RIGHT'
      ? (row.consent_type === null || row.consent_type === undefined)
        && (row.right_type === null || row.right_type === rightType)
      : (row.consent_type === null || row.consent_type === undefined || row.consent_type === consentType)
        && (row.right_type === null || row.right_type === rightType);
    const rightRevocation = revocations.find((row) => applicable(row, 'RIGHT'));
    const consentRevocation = consentType ? revocations.find((row) => applicable(row, 'CONSENT')) : null;

    let rightStatus = 'UNKNOWN';
    const activeRecord = records.find((row) => this._rightsActive(row, atUtcUs));
    if (rightRevocation) {
      rightStatus = 'REVOKED';
      blockers.push({ code: 'RIGHTS_REVOKED', dimension: 'RIGHT', status: rightStatus, evidence_id: rightRevocation.id });
    } else if (activeRecord) {
      const activeEvaluations = records.filter((row) => this._rightsActive(row, atUtcUs)).map((row) => {
        const territoryMatches = this._rightsTerritoryMatches(parseJson(row.territory_json, []), territory);
        const purposeMatches = this._rightsPurposeMatches(parseJson(row.purpose_json, {}), purpose);
        const effectiveStatus = row.status === 'ALLOWED' && (!territoryMatches || !purposeMatches) ? 'RESTRICTED' : row.status;
        return { row, territoryMatches, purposeMatches, effectiveStatus };
      });
      rightStatus = activeEvaluations.reduce((worst, current) => RIGHTS_STATUS_RANK[current.effectiveStatus] > RIGHTS_STATUS_RANK[worst] ? current.effectiveStatus : worst, 'ALLOWED');
      for (const current of activeEvaluations) {
        evidence.push({ dimension: 'RIGHT', id: current.row.id, right_type: rightType, status: current.row.status });
        if (current.effectiveStatus !== 'ALLOWED') blockers.push({ code: `RIGHTS_RECORD_${current.effectiveStatus}`, dimension: 'RIGHT', status: current.effectiveStatus, evidence_id: current.row.id });
        if (!current.territoryMatches) blockers.push({ code: 'RIGHTS_TERRITORY_RESTRICTED', dimension: 'RIGHT', status: 'RESTRICTED', territory, evidence_id: current.row.id });
        if (!current.purposeMatches) blockers.push({ code: 'RIGHTS_PURPOSE_RESTRICTED', dimension: 'RIGHT', status: 'RESTRICTED', purpose, evidence_id: current.row.id });
      }
    } else if (records.some((row) => this._rightsHistorical(row, atUtcUs))) {
      rightStatus = 'EXPIRED';
      blockers.push({ code: 'RIGHTS_RECORD_EXPIRED', dimension: 'RIGHT', status: rightStatus });
    } else {
      blockers.push({ code: 'RIGHTS_RECORD_MISSING', dimension: 'RIGHT', status: rightStatus });
    }

    let consentStatus = 'ALLOWED';
    if (consentType) {
      consentStatus = 'UNKNOWN';
      const activeConsent = consents.find((row) => this._rightsActive(row, atUtcUs));
      if (consentRevocation) {
        consentStatus = 'REVOKED';
        blockers.push({ code: 'CONSENT_REVOKED', dimension: 'CONSENT', status: consentStatus, evidence_id: consentRevocation.id });
      } else if (activeConsent) {
        consentStatus = 'ALLOWED';
        evidence.push({ dimension: 'CONSENT', id: activeConsent.id, consent_type: consentType, status: consentStatus });
      } else if (consents.some((row) => this._rightsHistorical(row, atUtcUs))) {
        consentStatus = 'EXPIRED';
        blockers.push({ code: 'CONSENT_EXPIRED', dimension: 'CONSENT', status: consentStatus });
      } else {
        blockers.push({ code: 'CONSENT_MISSING', dimension: 'CONSENT', status: consentStatus });
      }
    }
    const status = [rightStatus, consentStatus].sort((left, right) => RIGHTS_STATUS_RANK[right] - RIGHTS_STATUS_RANK[left])[0];
    const result = {
      status,
      state: status,
      eligible: status === 'ALLOWED',
      rights_identity_id: identity.id,
      identity: publicRightsIdentity(identity),
      right_type: rightType,
      consent_type: consentType,
      territory: territory ?? null,
      purpose: purpose ?? null,
      right_status: rightStatus,
      consent_status: consentStatus,
      blockers,
      evidence,
      evaluated_at_utc_us: atUtcUs,
    };
    return publicRightsEvaluation(result);
  }

  _rightsForAsset(assetId, options = {}) {
    const asset = this._asset(assetId);
    const requestedRightType = enumValue(options.right_type ?? options.rightType, 'right_type', RIGHTS_TYPE, DEFAULT_RIGHT_TYPE);
    const requestedConsentType = enumValue(options.consent_type ?? options.consentType, 'consent_type', RIGHTS_TYPE, DEFAULT_CONSENT_TYPE);
    if (!asset.rights_identity_id) {
      return publicRightsEvaluation({
        status: 'UNKNOWN', state: 'UNKNOWN', eligible: false, rights_identity_id: null, identity: null,
        right_type: requestedRightType,
        consent_type: requestedConsentType,
        blockers: [{ code: 'RIGHTS_IDENTITY_MISSING', dimension: 'IDENTITY', status: 'UNKNOWN' }],
        evidence: [], evaluated_at_utc_us: nowUtcUs(),
      });
    }
    return this._evaluateRights(asset.rights_identity_id, { ...options, right_type: requestedRightType, consent_type: requestedConsentType });
  }

  _rightsIdentityDetails(identityId, options = {}) {
    const identity = this._rightsIdentity(identityId);
    return {
      identity: publicRightsIdentity(identity),
      records: this.db.prepare('SELECT * FROM rights_records WHERE rights_identity_id = ? ORDER BY created_at_utc_us DESC, id DESC').all(identity.id).map(publicRightsRecord),
      consents: this.db.prepare('SELECT * FROM consents WHERE rights_identity_id = ? ORDER BY created_at_utc_us DESC, id DESC').all(identity.id).map(publicConsent),
      revocations: this.db.prepare('SELECT * FROM revocations WHERE rights_identity_id = ? ORDER BY effective_at_utc_us DESC, created_at_utc_us DESC, id DESC').all(identity.id).map(publicRevocation),
      evaluation: this._evaluateRights(identity.id, options),
      projection_seq: this._projectionSeq(),
      generated_at: new Date().toISOString(),
    };
  }

  _createRightsIdentity(payload) {
    const subjectType = enumValue(payload.subject_type ?? payload.subjectType, 'subject_type', RIGHTS_SUBJECT_TYPES);
    const subjectId = requiredString(payload.subject_id ?? payload.subjectId, 'subject_id');
    let projectId = payload.project_id ?? payload.projectId ?? null;
    if (subjectType === 'ASSET') {
      const asset = this._asset(subjectId);
      if (projectId !== null && projectId !== asset.project_id) {
        throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', { entity_type: 'ASSET', entity_id: subjectId, project_id: projectId, actual_project_id: asset.project_id }, { needsUser: true });
      }
      projectId = asset.project_id ?? null;
    } else if (projectId !== null) {
      this._project(projectId);
    }
    const existing = this.db.prepare('SELECT * FROM rights_identities WHERE subject_type = ? AND subject_id = ?').get(subjectType, subjectId);
    if (existing) throw new CoreError('CONFLICT', 'CONFLICT', 'errors.rights_identity_exists', { subject_type: subjectType, subject_id: subjectId }, { needsUser: true });
    const identityId = uuidv7();
    const created = nowUtcUs();
    const notes = optionalString(payload.notes, 'notes', 4000, '');
    this.db.prepare(`INSERT INTO rights_identities
      (id, project_id, subject_type, subject_id, notes, created_by_actor_id, created_at_utc_us)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(identityId, projectId, subjectType, subjectId, notes, this.actorId, created);
    const identity = this.db.prepare('SELECT * FROM rights_identities WHERE id = ?').get(identityId);
    const result = publicRightsIdentity(identity);
    return {
      projectId,
      result,
      event: { aggregateType: 'RIGHTS_IDENTITY', aggregateId: identityId, aggregateVersion: 1, eventType: 'RIGHTS_IDENTITY_CREATED', payload: result },
      audit: { actionType: 'rights.identity.create', targetType: 'RIGHTS_IDENTITY', targetId: identityId, payload: { subject_type: subjectType, subject_id: subjectId, project_id: projectId } },
    };
  }

  _createRightsRecord(payload) {
    const identity = this._rightsIdentity(payload.rights_identity_id ?? payload.rightsIdentityId ?? payload.identity_id ?? payload.identityId);
    this._assertRightsProjectScope(payload, identity);
    const rightType = enumValue(payload.right_type ?? payload.rightType, 'right_type', RIGHTS_TYPE);
    const status = rightStatus(payload.status, 'UNKNOWN');
    const territory = normalizeStringArray(payload.territory ?? payload.territories, 'territory');
    const purpose = structuredValue(payload.purpose ?? {}, 'purpose', {}, 'object');
    const validFrom = utcUsValue(payload.valid_from ?? payload.validFrom ?? payload.valid_from_utc_us, 'valid_from');
    const validTo = utcUsValue(payload.valid_to ?? payload.validTo ?? payload.valid_to_utc_us, 'valid_to');
    if (validFrom !== null && validTo !== null && validTo <= validFrom) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_time_interval', { field: 'valid_to' });
    const recordId = uuidv7();
    const created = nowUtcUs();
    const evidenceSnapshotId = optionalString(payload.evidence_snapshot_id ?? payload.evidenceSnapshotId, 'evidence_snapshot_id', 500, null);
    const evidenceSummary = structuredValue(payload.evidence_summary ?? payload.evidenceSummary ?? {}, 'evidence_summary', {}, 'object');
    this.db.prepare(`INSERT INTO rights_records
      (id, rights_identity_id, right_type, status, territory_json, purpose_json, valid_from_utc_us, valid_to_utc_us,
       commercial_allowed, derivative_allowed, training_allowed, cloning_allowed, attribution_required,
       evidence_snapshot_id, evidence_summary_json, created_by_actor_id, created_at_utc_us)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      recordId, identity.id, rightType, status, json(territory), json(purpose), validFrom, validTo,
      nullableBoolean(payload.commercial_allowed ?? payload.commercialAllowed, 'commercial_allowed'),
      nullableBoolean(payload.derivative_allowed ?? payload.derivativeAllowed, 'derivative_allowed'),
      nullableBoolean(payload.training_allowed ?? payload.trainingAllowed, 'training_allowed'),
      nullableBoolean(payload.cloning_allowed ?? payload.cloningAllowed, 'cloning_allowed'),
      nullableBoolean(payload.attribution_required ?? payload.attributionRequired, 'attribution_required'),
      evidenceSnapshotId, json(evidenceSummary), this.actorId, created,
    );
    const row = this.db.prepare('SELECT * FROM rights_records WHERE id = ?').get(recordId);
    const result = publicRightsRecord(row);
    return {
      projectId: identity.project_id ?? null,
      result: { record: result, evaluation: this._evaluateRights(identity.id, { right_type: rightType, at_utc_us: created }) },
      event: { aggregateType: 'RIGHTS_RECORD', aggregateId: recordId, aggregateVersion: Number(this.db.prepare('SELECT COUNT(*) AS count FROM rights_records WHERE rights_identity_id = ?').get(identity.id).count), eventType: 'RIGHTS_RECORD_RECORDED', payload: { ...result, project_id: identity.project_id ?? null } },
      audit: { actionType: 'rights.record.create', targetType: 'RIGHTS_RECORD', targetId: recordId, payload: { rights_identity_id: identity.id, right_type: rightType, status } },
    };
  }

  _recordConsent(payload) {
    const identity = this._rightsIdentity(payload.rights_identity_id ?? payload.rightsIdentityId ?? payload.identity_id ?? payload.identityId);
    this._assertRightsProjectScope(payload, identity);
    const consentType = enumValue(payload.consent_type ?? payload.consentType, 'consent_type', RIGHTS_TYPE);
    const grantedBy = requiredString(payload.granted_by ?? payload.grantedBy, 'granted_by', 500);
    const validFrom = utcUsValue(payload.valid_from ?? payload.validFrom ?? payload.valid_from_utc_us, 'valid_from') ?? nowUtcUs();
    const validTo = utcUsValue(payload.valid_to ?? payload.validTo ?? payload.valid_to_utc_us, 'valid_to');
    if (validTo !== null && validTo <= validFrom) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_time_interval', { field: 'valid_to' });
    const evidenceRevisionId = optionalString(payload.evidence_asset_revision_id ?? payload.evidenceAssetRevisionId, 'evidence_asset_revision_id', 200, null);
    if (evidenceRevisionId) {
      const revision = this.db.prepare('SELECT asset_id FROM asset_revisions WHERE id = ?').get(evidenceRevisionId);
      if (!revision) throw new CoreError('NOT_FOUND', 'VALIDATION', 'errors.asset_revision_not_found', { asset_revision_id: evidenceRevisionId });
      if (identity.subject_type === 'ASSET' && revision.asset_id !== identity.subject_id) {
        throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.rights_evidence_scope_mismatch', { rights_identity_id: identity.id, asset_revision_id: evidenceRevisionId }, { needsUser: true });
      }
    }
    const consentId = uuidv7();
    const created = nowUtcUs();
    this.db.prepare(`INSERT INTO consents
      (id, rights_identity_id, consent_type, granted_by, evidence_asset_revision_id, valid_from_utc_us, valid_to_utc_us, created_by_actor_id, created_at_utc_us)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      consentId, identity.id, consentType, grantedBy, evidenceRevisionId, validFrom, validTo, this.actorId, created,
    );
    const row = this.db.prepare('SELECT * FROM consents WHERE id = ?').get(consentId);
    const result = publicConsent(row);
    return {
      projectId: identity.project_id ?? null,
      result: { consent: result, evaluation: this._evaluateRights(identity.id, { consent_type: consentType, at_utc_us: created }) },
      event: { aggregateType: 'CONSENT', aggregateId: consentId, aggregateVersion: Number(this.db.prepare('SELECT COUNT(*) AS count FROM consents WHERE rights_identity_id = ?').get(identity.id).count), eventType: 'CONSENT_RECORDED', payload: { ...result, project_id: identity.project_id ?? null } },
      audit: { actionType: 'rights.consent.record', targetType: 'CONSENT', targetId: consentId, payload: { rights_identity_id: identity.id, consent_type: consentType, granted_by: grantedBy } },
    };
  }

  _revokeRights(payload, commandId) {
    const identity = this._rightsIdentity(payload.rights_identity_id ?? payload.rightsIdentityId ?? payload.identity_id ?? payload.identityId);
    this._assertRightsProjectScope(payload, identity);
    const rightType = payload.right_type ?? payload.rightType ? enumValue(payload.right_type ?? payload.rightType, 'right_type', RIGHTS_TYPE) : null;
    const consentType = payload.consent_type ?? payload.consentType ? enumValue(payload.consent_type ?? payload.consentType, 'consent_type', RIGHTS_TYPE) : null;
    const reason = requiredString(payload.reason, 'reason', 4000);
    const effectiveAt = utcUsValue(payload.effective_at ?? payload.effectiveAt ?? payload.effective_at_utc_us, 'effective_at') ?? nowUtcUs();
    const revocationId = uuidv7();
    const created = nowUtcUs();
    this.db.prepare(`INSERT INTO revocations
      (id, rights_identity_id, right_type, consent_type, reason, effective_at_utc_us, command_id, created_at_utc_us)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(revocationId, identity.id, rightType, consentType, reason, effectiveAt, commandId, created);
    const row = this.db.prepare('SELECT * FROM revocations WHERE id = ?').get(revocationId);
    const result = publicRevocation(row);
    return {
      projectId: identity.project_id ?? null,
      result: { revocation: result, evaluation: this._evaluateRights(identity.id, { right_type: rightType ?? DEFAULT_RIGHT_TYPE, consent_type: consentType ?? DEFAULT_CONSENT_TYPE, at_utc_us: effectiveAt }) },
      event: { aggregateType: 'RIGHTS_REVOCATION', aggregateId: revocationId, aggregateVersion: Number(this.db.prepare('SELECT COUNT(*) AS count FROM revocations WHERE rights_identity_id = ?').get(identity.id).count), eventType: 'RIGHTS_REVOKED', payload: { ...result, project_id: identity.project_id ?? null } },
      audit: { actionType: 'rights.revoke', targetType: 'RIGHTS_IDENTITY', targetId: identity.id, payload: { revocation_id: revocationId, right_type: rightType, consent_type: consentType } },
    };
  }

  _backupRow(backupId) {
    const id = requiredString(backupId, 'backup_id');
    const row = this.db.prepare('SELECT * FROM backups WHERE id = ?').get(id);
    if (!row) throw new CoreError('NOT_FOUND', 'VALIDATION', 'errors.backup_not_found', { backup_id: id });
    return row;
  }

  _backupRoot(payload = {}) {
    const defaultRoot = this.dbPath === ':memory:'
      ? path.resolve(process.cwd(), '.cineforge', 'backups')
      : path.join(path.dirname(path.resolve(this.dbPath)), 'backups');
    const requestedDestination = payload.destination_path ?? payload.destinationPath;
    let root;
    if (requestedDestination === undefined || requestedDestination === null || requestedDestination === '') {
      root = path.resolve(defaultRoot);
    } else {
      if (typeof requestedDestination !== 'string' || requestedDestination.trim().length === 0 || requestedDestination.length > 4096 || /[\u0000-\u001f\u007f]/.test(requestedDestination)) {
        throw new CoreError('INVALID_BACKUP_DESTINATION', 'VALIDATION', 'errors.invalid_backup_destination', {}, { needsUser: true });
      }
      root = path.resolve(requestedDestination.trim());
    }
    const assetRoot = path.resolve(this.assetStorePath);
    if (pathIsWithin(root, assetRoot)) {
      throw new CoreError('INVALID_BACKUP_DESTINATION', 'VALIDATION', 'errors.invalid_backup_destination', {}, { needsUser: true });
    }
    if (this.dbPath !== ':memory:' && pathKey(root) === pathKey(this.dbPath)) {
      throw new CoreError('INVALID_BACKUP_DESTINATION', 'VALIDATION', 'errors.invalid_backup_destination', {}, { needsUser: true });
    }
    if (fs.existsSync(root)) {
      let entry;
      try { entry = fs.lstatSync(root); } catch {
        throw new CoreError('INVALID_BACKUP_DESTINATION', 'VALIDATION', 'errors.invalid_backup_destination', {}, { needsUser: true });
      }
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        throw new CoreError('INVALID_BACKUP_DESTINATION', 'VALIDATION', 'errors.invalid_backup_destination', {}, { needsUser: true });
      }
    }
    return root;
  }

  _backupProbePath(root) {
    let probe = root;
    while (!fs.existsSync(probe)) {
      const parent = path.dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
    return probe;
  }

  _availableBytes(root) {
    try {
      const stat = fs.statfsSync(this._backupProbePath(root));
      const available = Number(stat.bavail) * Number(stat.bsize);
      return Number.isSafeInteger(available) && available >= 0 ? available : null;
    } catch {
      return null;
    }
  }

  _backupObjectRows() {
    return this.db.prepare(`SELECT so.id, so.hash_algorithm, so.content_hash, so.byte_size, so.storage_class,
        sol.storage_root, sol.relative_path, sol.state
      FROM storage_objects so
      LEFT JOIN storage_object_locations sol ON sol.id = (
        SELECT sol2.id FROM storage_object_locations sol2
        WHERE sol2.storage_object_id = so.id AND sol2.location_role = 'PRIMARY'
        ORDER BY CASE WHEN sol2.state = 'AVAILABLE' THEN 0 ELSE 1 END, sol2.id ASC LIMIT 1
      )
      ORDER BY so.hash_algorithm ASC, so.content_hash ASC, so.id ASC`).all();
  }

  _hashBackupFile(filePath, expectedSize = null) {
    const absolute = path.resolve(filePath);
    let descriptor;
    let stat;
    try {
      const link = fs.lstatSync(absolute);
      if (link.isSymbolicLink() || !link.isFile()) throw new CoreError('BACKUP_OBJECT_INVALID', 'CONFLICT', 'errors.backup_object_invalid', { file_name: path.basename(absolute) }, { needsUser: true });
      stat = link;
      descriptor = fs.openSync(absolute, fs.constants.O_RDONLY);
      const digest = crypto.createHash('sha256');
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      let total = 0;
      while (true) {
        const read = fs.readSync(descriptor, buffer, 0, buffer.length, total);
        if (read <= 0) break;
        digest.update(buffer.subarray(0, read));
        total += read;
      }
      if (expectedSize !== null && Number(expectedSize) !== total) throw new CoreError('BACKUP_SIZE_MISMATCH', 'CONFLICT', 'errors.backup_size_mismatch', { file_name: path.basename(absolute) }, { needsUser: true });
      if (Number(stat.size) !== total) throw new CoreError('BACKUP_OBJECT_CHANGED', 'CONFLICT', 'errors.backup_object_changed', { file_name: path.basename(absolute) }, { needsUser: true });
      return { sha256: digest.digest('hex'), byte_size: total };
    } catch (error) {
      if (error instanceof CoreError) throw error;
      throw new CoreError('BACKUP_FILE_UNREADABLE', 'CONFLICT', 'errors.backup_file_unreadable', { file_name: path.basename(absolute) }, { needsUser: true, technicalDetails: { message: String(error?.message ?? error) } });
    } finally {
      if (descriptor !== undefined) { try { fs.closeSync(descriptor); } catch { /* preserve primary error */ } }
    }
  }

  _backupDirectoryBytes(root) {
    let total = 0;
    const visit = (current) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const candidate = path.join(current, entry.name);
        if (entry.isSymbolicLink()) throw new CoreError('BACKUP_REPARSE_REJECTED', 'CONFLICT', 'errors.backup_reparse_rejected', { file_name: entry.name }, { needsUser: true });
        if (entry.isDirectory()) visit(candidate);
        else if (entry.isFile()) total += Number(fs.statSync(candidate).size);
      }
    };
    visit(root);
    return total;
  }

  _backupAdmission(payload, root, objectRows) {
    const durabilityClass = enumValue(payload.durability_class ?? payload.durabilityClass, 'durability_class', /^[A-Z_]{3,32}$/, 'LOCAL_WRITABLE');
    if (!BACKUP_DURABILITY_CLASSES.has(durabilityClass)) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field: 'durability_class' });
    if (durabilityClass !== 'LOCAL_WRITABLE') {
      throw new CoreError('DURABILITY_PROFILE_UNAVAILABLE', 'CONFLICT', 'errors.durability_profile_unavailable', { durability_class: durabilityClass }, { needsUser: true });
    }
    const failureDomain = optionalString(payload.failure_domain ?? payload.failureDomain, 'failure_domain', 200, 'LOCAL_MACHINE');
    const addBytes = (sum, value) => {
      const number = Number(value);
      const next = sum + number;
      if (!Number.isSafeInteger(number) || number < 0 || !Number.isSafeInteger(next)) {
        throw new CoreError('STORAGE_CAPACITY_UNKNOWN', 'STORAGE_PRESSURE', 'errors.storage_capacity_unknown', {}, { needsUser: true, retryable: true });
      }
      return next;
    };
    let dbBytes = 0;
    if (this.dbPath !== ':memory:') {
      for (const suffix of ['', '-wal', '-shm']) {
        try { dbBytes = addBytes(dbBytes, fs.statSync(`${this.dbPath}${suffix}`).size); } catch (error) {
          if (error instanceof CoreError) throw error;
          // SQLite sidecars are optional and may disappear between probes.
        }
      }
    }
    const objectBytes = objectRows.reduce((sum, row) => addBytes(sum, row.byte_size ?? 0), 0);
    const manifestEstimate = 16 * 1024 + objectRows.length * 512;
    const reserveInput = payload.reserve_bytes ?? payload.reserveBytes;
    let reserve = DEFAULT_BACKUP_RESERVE_BYTES;
    if (reserveInput !== undefined && reserveInput !== null) {
      const reserveNumber = typeof reserveInput === 'number'
        ? reserveInput
        : (typeof reserveInput === 'string' && /^\d+$/.test(reserveInput.trim()) ? Number(reserveInput) : NaN);
      if (!Number.isSafeInteger(reserveNumber) || reserveNumber < 0) {
        throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field: 'reserve_bytes' });
      }
      reserve = reserveNumber;
    }
    const estimatedBytes = addBytes(addBytes(addBytes(dbBytes, objectBytes), manifestEstimate), reserve);
    const configuredMax = payload.max_backup_bytes ?? payload.maxBackupBytes;
    if (configuredMax !== undefined && configuredMax !== null) {
      const maxBytes = typeof configuredMax === 'number'
        ? configuredMax
        : (typeof configuredMax === 'string' && /^\d+$/.test(configuredMax.trim()) ? Number(configuredMax) : NaN);
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field: 'max_backup_bytes' });
      if (estimatedBytes > maxBytes) throw new CoreError('STORAGE_PRESSURE', 'STORAGE_PRESSURE', 'errors.storage_pressure', { estimated_bytes: estimatedBytes, max_bytes: maxBytes }, { needsUser: true, retryable: true });
    }
    const availableBytes = this._availableBytes(root);
    if (availableBytes === null) {
      throw new CoreError('STORAGE_CAPACITY_UNKNOWN', 'STORAGE_PRESSURE', 'errors.storage_capacity_unknown', {}, { needsUser: true, retryable: true });
    }
    if (availableBytes < estimatedBytes) {
      throw new CoreError('STORAGE_PRESSURE', 'STORAGE_PRESSURE', 'errors.storage_pressure', { estimated_bytes: estimatedBytes, available_bytes: availableBytes }, { needsUser: true, retryable: true });
    }
    return { durabilityClass, failureDomain, dbBytes, objectBytes, estimatedBytes, availableBytes, reserve };
  }

  _writeBackupJson(filePath, value) {
    const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    const descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    try {
      fs.writeFileSync(descriptor, bytes);
      fs.fsyncSync(descriptor);
    } finally {
      try { fs.closeSync(descriptor); } catch { /* preserve primary error */ }
    }
    fs.renameSync(temporary, filePath);
    return bytes;
  }

  _backupSqlLiteral(value) {
    return String(value).replace(/'/g, "''");
  }

  _verifyBackupArtifact(spec) {
    const root = path.resolve(spec.root);
    this._assertNoReparsePath(root);
    const manifestAbsolute = path.resolve(spec.manifestPath);
    const snapshotAbsolute = path.resolve(spec.snapshotPath);
    if (!pathIsWithin(manifestAbsolute, root) || !pathIsWithin(snapshotAbsolute, root)
      || pathKey(manifestAbsolute) === pathKey(root) || pathKey(snapshotAbsolute) === pathKey(root)) {
      throw new CoreError('BACKUP_PATH_ESCAPE', 'CONFLICT', 'errors.backup_path_escape', {}, { needsUser: true });
    }
    let manifestStat;
    try { manifestStat = fs.lstatSync(manifestAbsolute); } catch {
      throw new CoreError('BACKUP_FILE_UNREADABLE', 'CONFLICT', 'errors.backup_file_unreadable', { file_name: 'manifest.json' }, { needsUser: true });
    }
    if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) {
      throw new CoreError('BACKUP_OBJECT_INVALID', 'CONFLICT', 'errors.backup_object_invalid', { file_name: 'manifest.json' }, { needsUser: true });
    }
    const manifestBytes = fs.readFileSync(manifestAbsolute);
    const manifestHash = crypto.createHash('sha256').update(manifestBytes).digest('hex');
    if (spec.manifestSha256 && manifestHash !== String(spec.manifestSha256).toLowerCase()) {
      throw new CoreError('BACKUP_MANIFEST_TAMPERED', 'CONFLICT', 'errors.backup_manifest_tampered', {}, { needsUser: true });
    }
    let manifest;
    try { manifest = JSON.parse(manifestBytes.toString('utf8')); } catch {
      throw new CoreError('BACKUP_MANIFEST_INVALID', 'CONFLICT', 'errors.backup_manifest_invalid', {}, { needsUser: true });
    }
    if (manifest.format_version !== BACKUP_FORMAT_VERSION
      || manifest.backup_type !== 'FULL_LOCAL'
      || (spec.expectedBackupId && String(manifest.backup_id) !== String(spec.expectedBackupId))
      || manifest.database?.file !== 'cineforge.sqlite'
      || !Number.isSafeInteger(Number(manifest.schema_version))
      || !SHA256_HEX.test(String(manifest.database?.sha256 ?? ''))) {
      throw new CoreError('BACKUP_MANIFEST_INVALID', 'CONFLICT', 'errors.backup_manifest_invalid', {}, { needsUser: true });
    }
    const dbHash = this._hashBackupFile(snapshotAbsolute, manifest.database.byte_size);
    if (dbHash.sha256 !== String(manifest.database.sha256).toLowerCase()) throw new CoreError('BACKUP_DATABASE_TAMPERED', 'CONFLICT', 'errors.backup_database_tampered', {}, { needsUser: true });
    let snapshot;
    try {
      snapshot = new DatabaseSync(snapshotAbsolute);
      const integrity = String(snapshot.prepare('PRAGMA integrity_check').get().integrity_check ?? '').toLowerCase();
      if (integrity !== 'ok') throw new CoreError('BACKUP_DATABASE_CORRUPT', 'CONFLICT', 'errors.backup_database_corrupt', { integrity }, { needsUser: true });
      const installation = snapshot.prepare('SELECT value FROM app_meta WHERE key = ?').get('installation_id')?.value;
      if (manifest.installation_id && installation !== manifest.installation_id) throw new CoreError('BACKUP_INSTALLATION_MISMATCH', 'CONFLICT', 'errors.backup_installation_mismatch', {}, { needsUser: true });
      const snapshotSchema = Number(snapshot.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get().version);
      if (snapshotSchema !== Number(manifest.schema_version)) throw new CoreError('BACKUP_SCHEMA_MISMATCH', 'CONFLICT', 'errors.backup_schema_mismatch', {}, { needsUser: true });
    } finally {
      try { snapshot?.close(); } catch { /* preserve primary error */ }
    }
    const seen = new Set();
    let copiedCount = 0;
    let externalCount = 0;
    for (const object of Array.isArray(manifest.objects) ? manifest.objects : []) {
      const relative = String(object.relative_path ?? '');
      // External references intentionally have no copied path.  Use the
      // immutable object id for duplicate detection so multiple external
      // objects do not collapse into the same empty-string key.
      const seenKey = object.materialization === 'EXTERNAL_REFERENCE'
        ? `external:${String(object.id ?? '')}` : relative;
      if (!String(object.id ?? '').trim() || seen.has(seenKey)) {
        throw new CoreError('BACKUP_MANIFEST_INVALID', 'CONFLICT', 'errors.backup_manifest_invalid', {}, { needsUser: true });
      }
      seen.add(seenKey);
      if (object.materialization === 'EXTERNAL_REFERENCE') { externalCount += 1; continue; }
      if (object.materialization !== 'COPIED' || !relative || path.isAbsolute(relative)) throw new CoreError('BACKUP_MANIFEST_INVALID', 'CONFLICT', 'errors.backup_manifest_invalid', {}, { needsUser: true });
      const objectPath = path.resolve(root, relative);
      if (!pathIsWithin(objectPath, root) || pathKey(objectPath) === pathKey(root)) throw new CoreError('BACKUP_PATH_ESCAPE', 'CONFLICT', 'errors.backup_path_escape', {}, { needsUser: true });
      const digest = this._hashBackupFile(objectPath, object.byte_size);
      if (digest.sha256 !== String(object.sha256).toLowerCase() || digest.sha256 !== String(object.content_hash).toLowerCase()) throw new CoreError('BACKUP_OBJECT_TAMPERED', 'CONFLICT', 'errors.backup_object_tampered', { content_hash: object.content_hash }, { needsUser: true });
      copiedCount += 1;
    }
    return { manifest, manifestSha256: manifestHash, dbSha256: dbHash.sha256, copiedCount, externalCount, objectCount: seen.size, byteSize: this._backupDirectoryBytes(root) };
  }

  _prepareBackup(payload, commandId) {
    const root = this._backupRoot(payload);
    const objectRows = this._backupObjectRows();
    const admission = this._backupAdmission(payload, root, objectRows);
    const backupId = uuidv7();
    const finalPath = path.join(root, backupId);
    const partialPath = path.join(root, `.${backupId}.partial`);
    if (fs.existsSync(finalPath) || fs.existsSync(partialPath)) throw new CoreError('BACKUP_ALREADY_EXISTS', 'CONFLICT', 'errors.backup_already_exists', { backup_id: backupId });
    const snapshotPath = path.join(partialPath, 'cineforge.sqlite');
    const manifestPath = path.join(partialPath, 'manifest.json');
    const objectRoot = path.join(partialPath, 'objects');
    const eventSeqCheckpoint = this._projectionSeq();
    const installationId = this._getMeta('installation_id');
    const rootExisted = fs.existsSync(root);
    try {
      fs.mkdirSync(root, { recursive: true });
      this._assertNoReparsePath(root);
      fs.mkdirSync(partialPath, { recursive: false, mode: 0o700 });
      if (this.dbPath !== ':memory:') this.db.exec(`VACUUM INTO '${this._backupSqlLiteral(snapshotPath)}'`);
      else {
        const memoryDump = this.db.prepare('SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type, name').all();
        throw new CoreError('BACKUP_MEMORY_UNSUPPORTED', 'CONFLICT', 'errors.backup_memory_unsupported', { statement_count: memoryDump.length }, { needsUser: true });
      }
      const databaseDigest = this._hashBackupFile(snapshotPath);
      const manifestObjects = [];
      let externalCount = 0;
      fs.mkdirSync(objectRoot, { recursive: true, mode: 0o700 });
      for (const row of objectRows) {
        const base = { id: row.id, hash_algorithm: row.hash_algorithm, content_hash: row.content_hash, byte_size: Number(row.byte_size), storage_class: row.storage_class };
        if (row.storage_class === 'EXTERNAL_REFERENCE') {
          externalCount += 1;
          manifestObjects.push({ ...base, materialization: 'EXTERNAL_REFERENCE', relative_path: null, sha256: null });
          continue;
        }
        if (!row.relative_path || row.state !== 'AVAILABLE') throw new CoreError('BACKUP_OBJECT_MISSING', 'CONFLICT', 'errors.backup_object_missing', { content_hash: row.content_hash }, { needsUser: true });
        const sourcePath = path.resolve(this.assetStorePath, row.relative_path);
        if (!pathIsWithin(sourcePath, this.assetStorePath) || pathKey(sourcePath) === pathKey(this.assetStorePath)) throw new CoreError('BACKUP_PATH_ESCAPE', 'INTERNAL', 'errors.backup_path_escape', {}, { needsUser: false });
        const sourceDigest = this._hashBackupFile(sourcePath, Number(row.byte_size));
        if (sourceDigest.sha256 !== String(row.content_hash).toLowerCase()) throw new CoreError('BACKUP_OBJECT_TAMPERED', 'CONFLICT', 'errors.backup_object_tampered', { content_hash: row.content_hash }, { needsUser: true });
        const relativePath = path.join('objects', String(row.hash_algorithm).toLowerCase(), String(row.content_hash).slice(0, 2), String(row.content_hash)).split(path.sep).join('/');
        const destinationPath = path.resolve(partialPath, relativePath);
        fs.mkdirSync(path.dirname(destinationPath), { recursive: true, mode: 0o700 });
        fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
        const copiedDigest = this._hashBackupFile(destinationPath, Number(row.byte_size));
        if (copiedDigest.sha256 !== sourceDigest.sha256) throw new CoreError('BACKUP_OBJECT_TAMPERED', 'CONFLICT', 'errors.backup_object_tampered', { content_hash: row.content_hash }, { needsUser: true });
        manifestObjects.push({ ...base, materialization: 'COPIED', relative_path: relativePath, sha256: copiedDigest.sha256 });
      }
      const manifest = {
        format_version: BACKUP_FORMAT_VERSION,
        backup_id: backupId,
        backup_type: 'FULL_LOCAL',
        durability_class: admission.durabilityClass,
        failure_domain: admission.failureDomain,
        installation_id: installationId,
        schema_version: SCHEMA_VERSION,
        event_seq_checkpoint: eventSeqCheckpoint,
        command_id: commandId,
        database: { file: 'cineforge.sqlite', sha256: databaseDigest.sha256, byte_size: databaseDigest.byte_size },
        objects: manifestObjects,
        created_at: new Date().toISOString(),
      };
      const manifestBytes = this._writeBackupJson(manifestPath, manifest);
      const manifestSha256 = crypto.createHash('sha256').update(manifestBytes).digest('hex');
      const verification = this._verifyBackupArtifact({ root: partialPath, snapshotPath, manifestPath, manifestSha256, expectedBackupId: backupId });
      if (verification.objectCount !== manifestObjects.length) throw new CoreError('BACKUP_MANIFEST_INVALID', 'CONFLICT', 'errors.backup_manifest_invalid', {}, { needsUser: true });
      fs.renameSync(partialPath, finalPath);
      return {
        id: backupId, root: finalPath, snapshotPath: path.join(finalPath, 'cineforge.sqlite'), manifestPath: path.join(finalPath, 'manifest.json'),
        manifestSha256, dbSha256: databaseDigest.sha256, byteSize: verification.byteSize, objectCount: manifestObjects.length,
        externalObjectCount: externalCount, eventSeqCheckpoint, installationId, schemaVersion: SCHEMA_VERSION,
        durabilityClass: admission.durabilityClass, failureDomain: admission.failureDomain, verification,
      };
    } catch (error) {
      try { fs.rmSync(partialPath, { recursive: true, force: true }); } catch { /* preserve primary error */ }
      try { fs.rmSync(finalPath, { recursive: true, force: true }); } catch { /* preserve primary error */ }
      if (!rootExisted) {
        try {
          if (fs.existsSync(root) && fs.readdirSync(root).length === 0) fs.rmSync(root, { recursive: true, force: true });
        } catch { /* preserve primary error */ }
      }
      throw error;
    }
  }

  _createBackup(payload, commandId) {
    const reservation = payload.__backup_reservation;
    if (!reservation) throw new CoreError('BACKUP_RESERVATION_MISSING', 'INTERNAL', 'errors.backup_reservation_missing', {}, { needsUser: false });
    const created = nowUtcUs();
    this.db.prepare(`INSERT INTO backups
      (id, backup_type, durability_class, failure_domain, destination_path, destination_fingerprint, manifest_path, snapshot_path,
       installation_id, schema_version, event_seq_checkpoint, state, db_sha256, manifest_sha256, byte_size, object_count,
       external_object_count, created_by_actor_id, command_id, created_at_utc_us, completed_at_utc_us, row_version)
      VALUES (?, 'FULL_LOCAL', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'VERIFIED', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(
      reservation.id, reservation.durabilityClass, reservation.failureDomain, reservation.root, this._pathFingerprint(reservation.root),
      reservation.manifestPath, reservation.snapshotPath, reservation.installationId, reservation.schemaVersion, reservation.eventSeqCheckpoint,
      reservation.dbSha256, reservation.manifestSha256, reservation.byteSize, reservation.objectCount, reservation.externalObjectCount,
      this.actorId, commandId, created, created,
    );
    const verificationId = uuidv7();
    this.db.prepare(`INSERT INTO backup_verifications
      (id, backup_id, outcome, integrity_state, manifest_sha256, object_count, byte_size, details_json, command_id, actor_id, created_at_utc_us)
      VALUES (?, ?, 'VERIFIED', 'PASS', ?, ?, ?, ?, ?, ?, ?)`).run(
      verificationId, reservation.id, reservation.manifestSha256, reservation.objectCount, reservation.byteSize,
      json({ db_sha256: reservation.dbSha256, external_object_count: reservation.externalObjectCount }), commandId, this.actorId, created,
    );
    const row = this.db.prepare('SELECT * FROM backups WHERE id = ?').get(reservation.id);
    return {
      projectId: null,
      result: { backup: publicBackup(row), verification: { id: verificationId, outcome: 'VERIFIED', integrity_state: 'PASS', object_count: reservation.objectCount, byte_size: reservation.byteSize } },
      event: { aggregateType: 'BACKUP', aggregateId: reservation.id, aggregateVersion: 1, eventType: 'BACKUP_CREATED', payload: { backup_id: reservation.id, state: 'VERIFIED', schema_version: reservation.schemaVersion, event_seq_checkpoint: reservation.eventSeqCheckpoint, manifest_sha256: reservation.manifestSha256, object_count: reservation.objectCount, external_object_count: reservation.externalObjectCount } },
      audit: { actionType: 'storage.backup.create', targetType: 'BACKUP', targetId: reservation.id, payload: { state: 'VERIFIED', durability_class: reservation.durabilityClass, object_count: reservation.objectCount, byte_size: reservation.byteSize } },
    };
  }

  _verifyBackup(payload, commandId) {
    const current = this._backupRow(payload.backup_id ?? payload.backupId ?? payload.id);
    const started = nowUtcUs();
    let outcome = 'VERIFIED';
    let integrityState = 'PASS';
    let details = {};
    let verification;
    try {
      verification = this._verifyBackupArtifact({ root: current.destination_path, snapshotPath: current.snapshot_path, manifestPath: current.manifest_path, manifestSha256: current.manifest_sha256, expectedBackupId: current.id });
      details = { db_sha256: verification.dbSha256, copied_object_count: verification.copiedCount, external_object_count: verification.externalCount };
    } catch (error) {
      outcome = 'FAILED';
      integrityState = 'FAIL';
      details = { code: error?.code ?? 'BACKUP_VERIFY_FAILED' };
    }
    const updatedAt = nowUtcUs();
    const state = outcome === 'VERIFIED' ? 'VERIFIED' : 'FAILED';
    this.db.prepare(`UPDATE backups SET state = ?, completed_at_utc_us = ?, error_code = ?, row_version = row_version + 1 WHERE id = ?`).run(state, updatedAt, outcome === 'VERIFIED' ? null : details.code, current.id);
    const verificationId = uuidv7();
    this.db.prepare(`INSERT INTO backup_verifications
      (id, backup_id, outcome, integrity_state, manifest_sha256, object_count, byte_size, details_json, command_id, actor_id, created_at_utc_us)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      verificationId, current.id, outcome, integrityState, outcome === 'VERIFIED' ? current.manifest_sha256 : null,
      Number(verification?.objectCount ?? 0), Number(verification?.byteSize ?? 0), json(details), commandId, this.actorId, started,
    );
    const row = this.db.prepare('SELECT * FROM backups WHERE id = ?').get(current.id);
    return {
      projectId: null,
      result: { backup: publicBackup(row), verification: { id: verificationId, outcome, integrity_state: integrityState, details } },
      event: { aggregateType: 'BACKUP', aggregateId: current.id, aggregateVersion: Number(row.row_version), eventType: 'BACKUP_VERIFIED', payload: { backup_id: current.id, outcome, integrity_state: integrityState, details } },
      audit: { actionType: 'storage.backup.verify', targetType: 'BACKUP', targetId: current.id, payload: { outcome, integrity_state: integrityState, details } },
    };
  }

  _canonicalSourcePath(value) {
    const source = requiredString(value, 'source_path', 4096);
    if (/[\u0000-\u001f\u007f]/.test(source)) {
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_source_path', {});
    }
    if (/^file:\/\//i.test(source)) {
      try { return path.resolve(fileURLToPath(source)); } catch {
        throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_source_path', {});
      }
    }
    return path.resolve(source);
  }

  _assertNoReparsePath(absolute) {
    const parsed = path.parse(absolute);
    let current = parsed.root;
    const remainder = absolute.slice(parsed.root.length).split(/[\\/]+/).filter(Boolean);
    for (const segment of remainder) {
      current = path.join(current, segment);
      let entry;
      try { entry = fs.lstatSync(current); } catch (error) {
        if (error?.code === 'ENOENT') break;
        throw new CoreError('SOURCE_UNREADABLE', 'VALIDATION', 'errors.source_unreadable', { source_name: path.basename(absolute) }, { technicalDetails: { message: error.message } });
      }
      if (entry.isSymbolicLink()) {
        throw new CoreError('SOURCE_REPARSE_REJECTED', 'VALIDATION', 'errors.source_reparse_rejected', { source_name: path.basename(absolute) }, { needsUser: true });
      }
    }
  }

  _assetSourcePath(value) {
    const absolute = this._canonicalSourcePath(value);
    this._assertNoReparsePath(absolute);
    let link;
    try { link = fs.lstatSync(absolute); } catch (error) {
      if (error?.code === 'ENOENT') throw new CoreError('SOURCE_NOT_FOUND', 'VALIDATION', 'errors.source_not_found', { source_name: path.basename(absolute) });
      throw new CoreError('SOURCE_UNREADABLE', 'VALIDATION', 'errors.source_unreadable', { source_name: path.basename(absolute) }, { technicalDetails: { message: error.message } });
    }
    if (link.isSymbolicLink()) throw new CoreError('SOURCE_SYMLINK_REJECTED', 'VALIDATION', 'errors.source_symlink_rejected', { source_name: path.basename(absolute) });
    if (!link.isFile()) throw new CoreError('SOURCE_NOT_REGULAR_FILE', 'VALIDATION', 'errors.source_not_regular_file', { source_name: path.basename(absolute) });
    return absolute;
  }

  _sourceIdentity(stat) {
    return {
      dev: String(stat.dev ?? ''),
      ino: String(stat.ino ?? ''),
      size: Number(stat.size),
      mtime_ms: Number(stat.mtimeMs),
      ctime_ms: Number(stat.ctimeMs),
      mode: Number(stat.mode),
      nlink: Number(stat.nlink ?? 1),
    };
  }

  _sameSourceIdentity(left, right) {
    if (!left || !right) return false;
    return String(left.dev) === String(right.dev)
      && String(left.ino) === String(right.ino)
      && Number(left.size) === Number(right.size)
      && Number(left.mtime_ms) === Number(right.mtime_ms)
      && Number(left.ctime_ms) === Number(right.ctime_ms)
      && Number(left.mode) === Number(right.mode)
      && Number(left.nlink ?? 1) === Number(right.nlink ?? 1);
  }

  _openStableSource(absolute) {
    const noFollow = Number(fs.constants.O_NOFOLLOW ?? 0);
    let descriptor;
    try { descriptor = fs.openSync(absolute, fs.constants.O_RDONLY | noFollow); } catch (error) {
      throw new CoreError('SOURCE_UNREADABLE', 'VALIDATION', 'errors.source_unreadable', { source_name: path.basename(absolute) }, { technicalDetails: { message: error.message } });
    }
    try {
      const stat = fs.fstatSync(descriptor);
      if (!stat.isFile()) throw new CoreError('SOURCE_NOT_REGULAR_FILE', 'VALIDATION', 'errors.source_not_regular_file', { source_name: path.basename(absolute) });
      if (stat.size > this.maxAssetBytes) throw new CoreError('SOURCE_TOO_LARGE', 'VALIDATION', 'errors.source_too_large', { max_bytes: this.maxAssetBytes });
      // Multiple hard links permit a second writable name to mutate bytes
      // behind the stable path.  Reject them for ingest; callers can create a
      // private copy explicitly when they need to import such a source.
      if (Number(stat.nlink ?? 1) > 1) {
        throw new CoreError('SOURCE_HARDLINK_REJECTED', 'VALIDATION', 'errors.source_hardlink_rejected', { source_name: path.basename(absolute) }, { needsUser: true });
      }
      return { descriptor, identity: this._sourceIdentity(stat), stat };
    } catch (error) {
      try { fs.closeSync(descriptor); } catch { /* preserve primary error */ }
      throw error;
    }
  }

  _hashDescriptor(descriptor, expectedSize, sourceName) {
    const digest = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    let bytes = 0;
    while (position < expectedSize) {
      const wanted = Math.min(buffer.length, expectedSize - position);
      const read = fs.readSync(descriptor, buffer, 0, wanted, position);
      if (read <= 0) break;
      digest.update(buffer.subarray(0, read));
      position += read;
      bytes += read;
    }
    if (bytes !== expectedSize) {
      throw new CoreError('SOURCE_CHANGED_DURING_HASH', 'CONFLICT', 'errors.source_changed_during_hash', { source_name: sourceName }, { retryable: true, needsUser: true });
    }
    return { hash_algorithm: 'SHA-256', content_hash: digest.digest('hex'), byte_size: bytes };
  }

  _hashLocalFile(absolute) {
    this._assertNoReparsePath(absolute);
    const stable = this._openStableSource(absolute);
    const descriptor = stable.descriptor;
    try {
      const before = stable.stat;
      const hashed = this._hashDescriptor(descriptor, before.size, path.basename(absolute));
      const after = fs.fstatSync(descriptor);
      if (!this._sameSourceIdentity(stable.identity, this._sourceIdentity(after))) {
        throw new CoreError('SOURCE_CHANGED_DURING_HASH', 'CONFLICT', 'errors.source_changed_during_hash', { source_name: path.basename(absolute) }, { retryable: true, needsUser: true });
      }
      return {
        ...hashed,
        mtime_ms: stable.identity.mtime_ms,
        ctime_ms: stable.identity.ctime_ms,
        mode: stable.identity.mode,
        nlink: stable.identity.nlink,
        identity: stable.identity,
      };
    } finally {
      try { fs.closeSync(descriptor); } catch { /* preserve primary error */ }
    }
  }

  _pathFingerprint(absolute) {
    const normalizedPath = path.normalize(absolute);
    const normalized = process.platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath;
    return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
  }

  _mimeForPath(absolute) {
    const extension = path.extname(absolute).toLowerCase();
    const values = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
      '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.webm': 'video/webm',
      '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.flac': 'audio/flac',
      '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json',
    };
    return values[extension] ?? 'application/octet-stream';
  }

  _objectRelativePath(hashAlgorithm, contentHash) {
    return path.join('objects', hashAlgorithm.toLowerCase(), contentHash.slice(0, 2), contentHash);
  }

  _stagingPath(id) {
    const root = path.resolve(this.assetStorePath, 'staging');
    const candidate = path.resolve(root, `${id}.part`);
    if (candidate !== path.join(root, `${id}.part`)) {
      throw new CoreError('STAGING_PATH_ESCAPE', 'INTERNAL', 'errors.staging_path_escape', {}, { needsUser: false });
    }
    return { root, candidate };
  }

  _stagingRow(id) {
    const row = this.db.prepare('SELECT * FROM staging_objects WHERE id = ?').get(id);
    if (!row) throw new CoreError('STAGING_NOT_FOUND', 'VALIDATION', 'errors.staging_not_found', { staging_id: id });
    return row;
  }

  _setStagingState(id, state, patch = {}) {
    if (!STAGING_STATES.has(state)) throw new CoreError('INVALID_STAGING_STATE', 'INTERNAL', 'errors.invalid_staging_state', { state }, { needsUser: false });
    const current = this._stagingRow(id);
    if (current.state !== state && !STAGING_TRANSITIONS[current.state]?.has(state)) {
      throw new CoreError('INVALID_STAGING_TRANSITION', 'CONFLICT', 'errors.invalid_staging_transition', { from: current.state, to: state }, { needsUser: true });
    }
    const allowed = new Set(['current_size', 'sha256', 'os_file_identity_json', 'finalization_identity_json', 'state']);
    for (const key of Object.keys(patch)) if (!allowed.has(key)) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field: key });
    const values = {
      current_size: patch.current_size === undefined ? current.current_size : patch.current_size,
      sha256: patch.sha256 === undefined ? current.sha256 : patch.sha256,
      os_file_identity_json: patch.os_file_identity_json === undefined ? current.os_file_identity_json : patch.os_file_identity_json,
      finalization_identity_json: patch.finalization_identity_json === undefined ? current.finalization_identity_json : patch.finalization_identity_json,
      state,
      row_version: Number(current.row_version) + (current.state === state && Object.keys(patch).length === 0 ? 0 : 1),
      updated_at_utc_us: nowUtcUs(),
    };
    this.db.prepare(`UPDATE staging_objects SET current_size = ?, sha256 = ?, os_file_identity_json = ?,
      finalization_identity_json = ?, state = ?, row_version = ?, updated_at_utc_us = ? WHERE id = ?`).run(
      values.current_size, values.sha256, values.os_file_identity_json, values.finalization_identity_json,
      values.state, values.row_version, values.updated_at_utc_us, id,
    );
    return this._stagingRow(id);
  }

  _reserveImportStaging(payload, commandId) {
    const sourcePath = this._assetSourcePath(payload.source_path ?? payload.sourcePath ?? payload.path ?? payload.file_path);
    const hashAlgorithm = String(payload.hash_algorithm ?? payload.hashAlgorithm ?? 'SHA-256').trim().toUpperCase().replace(/_/g, '-');
    if (hashAlgorithm !== 'SHA-256') {
      throw new CoreError('UNSUPPORTED_HASH_ALGORITHM', 'VALIDATION', 'errors.unsupported_hash_algorithm', { hash_algorithm: hashAlgorithm });
    }
    const stable = this._openStableSource(sourcePath);
    let digest;
    try {
      // Compute and validate the caller-supplied digest before creating the
      // staging directory.  Invalid input therefore leaves no filesystem
      // residue while the descriptor remains the same handle used to copy.
      digest = this._hashDescriptor(stable.descriptor, stable.stat.size, path.basename(sourcePath));
      const suppliedHash = payload.content_hash ?? payload.contentHash;
      if (suppliedHash !== undefined && suppliedHash !== null) {
        if (typeof suppliedHash !== 'string' || !SHA256_HEX.test(suppliedHash)) {
          throw new CoreError('INVALID_CONTENT_HASH', 'VALIDATION', 'errors.invalid_content_hash', {});
        }
        if (suppliedHash.toLowerCase() !== digest.content_hash) {
          throw new CoreError('HASH_MISMATCH', 'CONFLICT', 'errors.hash_mismatch', { expected: suppliedHash.toLowerCase(), actual: digest.content_hash }, { needsUser: true });
        }
      }

      const stagingId = uuidv7();
      const { root, candidate } = this._stagingPath(stagingId);
      fs.mkdirSync(root, { recursive: true });
      const rootStat = fs.lstatSync(root);
      if (rootStat.isSymbolicLink()) throw new CoreError('STAGING_REPARSE_REJECTED', 'INTERNAL', 'errors.staging_reparse_rejected', {}, { needsUser: false });
      const sourceFingerprint = this._pathFingerprint(sourcePath);
      const created = nowUtcUs();
      this._transaction(() => {
        this.db.prepare(`INSERT INTO staging_objects
          (id, command_id, temp_path, expected_size, current_size, hash_algorithm, source_path_fingerprint,
           source_file_identity_json, reparse_state, state, row_version, created_at_utc_us, updated_at_utc_us)
          VALUES (?, ?, ?, ?, 0, ?, ?, ?, 'NOT_REPARSE', 'WRITING', 1, ?, ?)`).run(
          stagingId, commandId, candidate, digest.byte_size, digest.hash_algorithm, sourceFingerprint,
          json(stable.identity), created, created,
        );
      });

      let outputDescriptor;
      try {
        outputDescriptor = fs.openSync(candidate, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
        const buffer = Buffer.allocUnsafe(1024 * 1024);
        let position = 0;
        while (position < stable.stat.size) {
          const wanted = Math.min(buffer.length, stable.stat.size - position);
          const read = fs.readSync(stable.descriptor, buffer, 0, wanted, position);
          if (read <= 0) throw new CoreError('SOURCE_CHANGED_DURING_STAGE', 'CONFLICT', 'errors.source_changed_during_stage', { source_name: path.basename(sourcePath) }, { retryable: true, needsUser: true });
          let written = 0;
          while (written < read) written += fs.writeSync(outputDescriptor, buffer, written, read - written);
          position += read;
        }
        fs.fsyncSync(outputDescriptor);
        fs.closeSync(outputDescriptor);
        outputDescriptor = null;
        const afterSource = fs.fstatSync(stable.descriptor);
        if (!this._sameSourceIdentity(stable.identity, this._sourceIdentity(afterSource))) {
          throw new CoreError('SOURCE_CHANGED_DURING_STAGE', 'CONFLICT', 'errors.source_changed_during_stage', { source_name: path.basename(sourcePath) }, { retryable: true, needsUser: true });
        }
        const stagedStat = fs.lstatSync(candidate);
        if (stagedStat.isSymbolicLink() || !stagedStat.isFile()) throw new CoreError('STAGING_REPARSE_REJECTED', 'INTERNAL', 'errors.staging_reparse_rejected', {}, { needsUser: false });
        const stagedIdentity = this._sourceIdentity(stagedStat);
        // The first pass and the copy pass use the same descriptor.  Hash the
        // staged bytes as a second proof, then bind the resulting identity.
        const stagedHash = this._hashLocalFile(candidate);
        if (stagedHash.content_hash !== digest.content_hash || stagedHash.byte_size !== digest.byte_size) {
          throw new CoreError('STAGING_VERIFY_FAILED', 'INTERNAL', 'errors.staging_verify_failed', { content_hash: digest.content_hash }, { needsUser: false });
        }
        this._transaction(() => this._setStagingState(stagingId, 'COMPLETE', {
          current_size: stagedHash.byte_size, sha256: stagedHash.content_hash, os_file_identity_json: json(stagedIdentity),
        }));
        return { id: stagingId, sourcePath, sourceIdentity: stable.identity, digest };
      } catch (error) {
        if (outputDescriptor !== undefined && outputDescriptor !== null) { try { fs.closeSync(outputDescriptor); } catch { /* preserve */ } }
        this._transaction(() => {
          try { this._setStagingState(stagingId, 'QUARANTINED'); } catch { /* preserve original error */ }
        });
        throw error;
      }
    } finally {
      try { fs.closeSync(stable.descriptor); } catch { /* preserve primary error */ }
    }
  }

  _verifyStagingObject(stagingId) {
    const row = this._stagingRow(stagingId);
    if (!['COMPLETE', 'VERIFIED'].includes(row.state)) {
      throw new CoreError('STAGING_NOT_READY', 'CONFLICT', 'errors.staging_not_ready', { staging_id: stagingId, state: row.state }, { needsUser: true });
    }
    const tempPath = path.resolve(row.temp_path);
    const { root } = this._stagingPath(row.id);
    if (!tempPath.startsWith(`${root}${path.sep}`)) {
      this._setStagingState(row.id, 'QUARANTINED');
      throw new CoreError('STAGING_PATH_ESCAPE', 'INTERNAL', 'errors.staging_path_escape', {}, { needsUser: false });
    }
    let stat;
    try { stat = fs.lstatSync(tempPath); } catch {
      this._setStagingState(row.id, 'QUARANTINED');
      throw new CoreError('STAGING_MISSING', 'CONFLICT', 'errors.staging_missing', { staging_id: row.id }, { needsUser: true });
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
      this._setStagingState(row.id, 'QUARANTINED');
      throw new CoreError('STAGING_REPARSE_REJECTED', 'INTERNAL', 'errors.staging_reparse_rejected', {}, { needsUser: false });
    }
    const identity = this._sourceIdentity(stat);
    const expectedIdentity = parseJson(row.os_file_identity_json, null);
    if (!this._sameSourceIdentity(identity, expectedIdentity)) {
      this._setStagingState(row.id, 'QUARANTINED');
      throw new CoreError('STAGING_IDENTITY_CHANGED', 'CONFLICT', 'errors.staging_identity_changed', { staging_id: row.id }, { needsUser: true });
    }
    const digest = this._hashLocalFile(tempPath);
    if (digest.content_hash !== row.sha256 || digest.byte_size !== Number(row.expected_size)) {
      this._setStagingState(row.id, 'QUARANTINED');
      throw new CoreError('STAGING_CONTENT_CHANGED', 'CONFLICT', 'errors.staging_content_changed', { staging_id: row.id }, { needsUser: true });
    }
    if (row.state === 'COMPLETE') this._setStagingState(row.id, 'VERIFIED');
    return { ...this._stagingRow(row.id), identity, digest };
  }

  _materializeStagedObject(stagingId, hashAlgorithm, contentHash, byteSize) {
    const staged = this._verifyStagingObject(stagingId);
    const relativePath = this._objectRelativePath(hashAlgorithm, contentHash);
    const target = path.resolve(this.assetStorePath, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    this._assertNoReparsePath(path.dirname(target));
    let created = false;
    if (fs.existsSync(target)) {
      const link = fs.lstatSync(target);
      if (link.isSymbolicLink() || !link.isFile() || Number(link.nlink ?? 1) !== 1) throw new CoreError('ASSET_STORE_CORRUPT', 'INTERNAL', 'errors.asset_store_corrupt', { content_hash: contentHash }, { needsUser: false });
      const existing = this._hashLocalFile(target);
      if (existing.content_hash !== contentHash || existing.byte_size !== byteSize) throw new CoreError('ASSET_STORE_CORRUPT', 'INTERNAL', 'errors.asset_store_corrupt', { content_hash: contentHash }, { needsUser: false });
      try { fs.rmSync(staged.temp_path, { force: true }); } catch { /* retain row; reconciliation can quarantine */ }
    } else {
      try {
        // COPYFILE_EXCL closes the check/use race and never overwrites an
        // object another importer won concurrently.
        fs.copyFileSync(staged.temp_path, target, fs.constants.COPYFILE_EXCL);
        const copiedLink = fs.lstatSync(target);
        if (copiedLink.isSymbolicLink() || !copiedLink.isFile() || Number(copiedLink.nlink ?? 1) !== 1) {
          throw new CoreError('ASSET_STORE_CORRUPT', 'INTERNAL', 'errors.asset_store_corrupt', { content_hash: contentHash }, { needsUser: false });
        }
        const copied = this._hashLocalFile(target);
        if (copied.content_hash !== contentHash || copied.byte_size !== byteSize) throw new CoreError('ASSET_STORE_VERIFY_FAILED', 'INTERNAL', 'errors.asset_store_verify_failed', { content_hash: contentHash }, { needsUser: false });
        created = true;
        try { fs.rmSync(staged.temp_path, { force: true }); } catch { /* retain row; registration still has CAS proof */ }
      } catch (error) {
        if (error?.code === 'EEXIST' && fs.existsSync(target)) {
          const existing = this._hashLocalFile(target);
          if (existing.content_hash === contentHash && existing.byte_size === byteSize) {
            try { fs.rmSync(staged.temp_path, { force: true }); } catch { /* preserve evidence */ }
            created = false;
          } else throw new CoreError('ASSET_STORE_CORRUPT', 'INTERNAL', 'errors.asset_store_corrupt', { content_hash: contentHash }, { needsUser: false });
        } else throw error;
      }
    }
    const finalIdentity = (() => { try { return this._sourceIdentity(fs.statSync(target)); } catch { return null; } })();
    this._setStagingState(staged.id, 'REGISTERED', { finalization_identity_json: json(finalIdentity) });
    return { relativePath, objectUri: `object://${hashAlgorithm.toLowerCase()}/${contentHash}`, target, created };
  }

  _reconcileStaging(payload = {}) {
    const requestedId = payload.staging_id ?? payload.stagingId ?? null;
    const rows = requestedId
      ? [this._stagingRow(requestedId)]
      : this.db.prepare(`SELECT * FROM staging_objects
          WHERE state IN ('WRITING', 'COMPLETE', 'VERIFIED')
          ORDER BY updated_at_utc_us ASC, id ASC LIMIT 200`).all();
    const changes = [];
    for (const row of rows) {
      if (!['WRITING', 'COMPLETE', 'VERIFIED'].includes(row.state)) continue;
      let state = 'VERIFIED';
      let reason = 'VERIFIED_CONTENT';
      try {
        const tempPath = path.resolve(row.temp_path);
        const { root } = this._stagingPath(row.id);
        if (!tempPath.startsWith(`${root}${path.sep}`)) throw new CoreError('STAGING_PATH_ESCAPE', 'INTERNAL', 'errors.staging_path_escape', {}, { needsUser: false });
        const stat = fs.lstatSync(tempPath);
        if (stat.isSymbolicLink() || !stat.isFile()) throw new CoreError('STAGING_REPARSE_REJECTED', 'INTERNAL', 'errors.staging_reparse_rejected', {}, { needsUser: false });
        const expectedIdentity = parseJson(row.os_file_identity_json, null);
        if (expectedIdentity && !this._sameSourceIdentity(this._sourceIdentity(stat), expectedIdentity)) {
          throw new CoreError('STAGING_IDENTITY_CHANGED', 'CONFLICT', 'errors.staging_identity_changed', { staging_id: row.id }, { needsUser: true });
        }
        const digest = this._hashLocalFile(tempPath);
        if (Number(row.expected_size) !== digest.byte_size || (row.sha256 && row.sha256 !== digest.content_hash)) {
          throw new CoreError('STAGING_CONTENT_CHANGED', 'CONFLICT', 'errors.staging_content_changed', { staging_id: row.id }, { needsUser: true });
        }
        const evidence = {
          current_size: digest.byte_size, sha256: digest.content_hash, os_file_identity_json: json(this._sourceIdentity(stat)),
        };
        if (row.state === 'WRITING') this._setStagingState(row.id, 'COMPLETE', evidence);
        this._setStagingState(row.id, 'VERIFIED', evidence);
      } catch (error) {
        if (error?.code === 'STAGING_MISSING' || error?.code === 'ENOENT' || error?.code === 'STAGING_PATH_ESCAPE') {
          state = 'ORPHANED';
          reason = 'MISSING_OR_ESCAPED_TEMP';
        } else {
          state = 'QUARANTINED';
          reason = error?.code ?? 'STAGING_VERIFICATION_FAILED';
        }
        try { this._setStagingState(row.id, state); } catch { /* preserve reconciliation evidence */ }
      }
      const current = this._stagingRow(row.id);
      if (current.state !== row.state || state !== 'VERIFIED' || row.state !== 'VERIFIED') {
        changes.push({ id: row.id, previous_state: row.state, state: current.state, reason });
      }
    }
    const result = { items: changes.map((change) => ({ ...change })), checked_count: rows.length, projection_seq: this._projectionSeq(), generated_at: new Date().toISOString() };
    return {
      projectId: null,
      result,
      event: { aggregateType: 'STAGING_RECONCILIATION', aggregateId: uuidv7(), aggregateVersion: 1, eventType: 'STAGING_RECONCILED', payload: result },
      audit: { actionType: 'storage.staging_reconcile', targetType: 'STAGING_OBJECT', targetId: requestedId, payload: result },
    };
  }

  _assertProjectWritable(project) {
    if (project.lifecycle_state === 'TRASHED' || project.lifecycle_state === 'ARCHIVED') {
      throw new CoreError('PROJECT_NOT_WRITABLE', 'CONFLICT', 'errors.project_not_writable', { state: project.lifecycle_state }, { needsUser: true });
    }
  }

  _expectedVersion(expectedVersions, kind, id, current) {
    const expected = expectedVersions ?? {};
    const candidates = [kind, kind.toLowerCase(), `${kind}:${id}`, `${kind.toLowerCase()}:${id}`, id];
    let found;
    for (const key of candidates) {
      if (Object.prototype.hasOwnProperty.call(expected, key)) {
        found = expected[key];
        break;
      }
    }
    if (found === undefined || found === null) {
      throw new CoreError('EXPECTED_VERSION_REQUIRED', 'CONFLICT', 'errors.expected_version_required', { entity_type: kind, entity_id: id }, { needsUser: true });
    }
    if (asInt(found, -1) !== Number(current)) {
      throw new CoreError('STALE_REVISION', 'STALE_REVISION', 'errors.stale_revision', {
        entity_type: kind, entity_id: id, expected: found, current: Number(current),
      }, { needsUser: true });
    }
  }

  _assertPayloadProjectScope(payload, projectId, entityType, entityId) {
    const suppliedProjectId = payload?.project_id ?? payload?.projectId;
    if (suppliedProjectId !== undefined && suppliedProjectId !== null && suppliedProjectId !== projectId) {
      throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', {
        entity_type: entityType, entity_id: entityId, project_id: suppliedProjectId, actual_project_id: projectId,
      }, { needsUser: true });
    }
    const suppliedEntityType = payload?.entity_type ?? payload?.entityType;
    if (suppliedEntityType !== undefined && suppliedEntityType !== null
      && String(suppliedEntityType).toUpperCase() !== entityType) {
      throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', {
        entity_type: suppliedEntityType, entity_id: entityId, expected_entity_type: entityType,
      }, { needsUser: true });
    }
    const suppliedEntityId = payload?.entity_id ?? payload?.entityId;
    if (suppliedEntityId !== undefined && suppliedEntityId !== null && suppliedEntityId !== entityId) {
      throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', {
        entity_type: entityType, entity_id: suppliedEntityId, expected_entity_id: entityId,
      }, { needsUser: true });
    }
  }

  _insertEvent(event, commandId, actorId, correlationId, causationId) {
    const created = nowUtcUs();
    const result = this.db.prepare(`INSERT INTO domain_events
      (id, aggregate_type, aggregate_id, aggregate_version, event_type, schema_version,
       payload_json, command_id, actor_id, correlation_id, causation_id, created_at_utc_us)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      uuidv7(), event.aggregateType, event.aggregateId, event.aggregateVersion,
      event.eventType, event.schemaVersion ?? 1, json(event.payload), commandId, actorId,
      correlationId ?? null, causationId ?? null, created,
    );
    return Number(result.lastInsertRowid);
  }

  _insertAudit(audit, commandId, actorId, outcome) {
    this.db.prepare(`INSERT INTO audit_records
      (id, command_id, actor_id, action_type, target_type, target_id, outcome, payload_json, created_at_utc_us)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      uuidv7(), commandId, actorId, audit.actionType, audit.targetType, audit.targetId ?? null,
      outcome, json(audit.payload), nowUtcUs(),
    );
  }

  _commandPayload(input) {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.payload_object_required', {});
    }
    return input;
  }

  _commandPayloadForStorage(commandType, payload) {
    if (commandType !== 'CreateBackup') return payload;
    const out = { ...payload };
    const destination = out.destination_path ?? out.destinationPath;
    if (destination !== undefined && destination !== null) {
      try { out.destination_name = path.basename(path.resolve(String(destination))); } catch { /* keep the audit record usable */ }
    }
    delete out.destination_path;
    delete out.destinationPath;
    return out;
  }

  _findIdempotent(commandType, key) {
    if (!key) return null;
    return this.db.prepare(`SELECT * FROM commands
      WHERE actor_id = ? AND command_type = ? AND idempotency_key = ?`).get(this.actorId, commandType, key);
  }

  _idempotencyFingerprint(row) {
    if (typeof row?.idempotency_fingerprint === 'string' && /^[a-f0-9]{64}$/i.test(row.idempotency_fingerprint)) {
      return row.idempotency_fingerprint.toLowerCase();
    }
    // Compatibility path for a v2 row that was created before the v3 column
    // existed (or for a legacy row whose migration could not parse JSON).
    return idempotencyFingerprint(parseJson(row?.payload_json, {}), parseJson(row?.expected_versions_json, {}));
  }

  _assertIdempotencyBinding(previous, commandType, idempotencyKey, fingerprint) {
    const previousFingerprint = this._idempotencyFingerprint(previous);
    if (previousFingerprint === fingerprint) return;
    // Do not expose the original payload or expected versions in an error.
    // Their digests are sufficient for diagnostics without turning a conflict
    // response into a data exfiltration channel.
    throw new CoreError(
      'IDEMPOTENCY_KEY_REUSE_CONFLICT',
      'CONFLICT',
      'errors.idempotency_key_reuse_conflict',
      { command_type: commandType },
      {
        needsUser: true,
        technicalDetails: {
          idempotency_key_namespace: `${this.actorId}:${commandType}`,
          existing_fingerprint: previousFingerprint,
          received_fingerprint: fingerprint,
        },
      },
    );
  }

  executeCommand(input = {}) {
    const commandType = requiredString(input.command_type ?? input.commandType, 'command_type', 120);
    const payload = this._commandPayload(input.payload ?? {});
    const expectedVersions = input.expected_versions ?? input.expectedVersions ?? {};
    if (expectedVersions === null || typeof expectedVersions !== 'object' || Array.isArray(expectedVersions)) {
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.expected_versions_object_required', {});
    }
    const idempotencyKey = input.idempotency_key ?? input.idempotencyKey ?? null;
    if (idempotencyKey !== null && (typeof idempotencyKey !== 'string' || idempotencyKey.length > 200)) {
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_idempotency_key', {});
    }
    const requestFingerprint = idempotencyKey ? idempotencyFingerprint(payload, expectedVersions) : null;
    const previous = this._findIdempotent(commandType, idempotencyKey);
    if (previous) {
      this._assertIdempotencyBinding(previous, commandType, idempotencyKey, requestFingerprint);
      if (previous.status === 'FAILED') {
        const failure = parseJson(previous.error_details_json, {});
        throw new CoreError(previous.error_code ?? 'COMMAND_FAILED', failure.category ?? 'INTERNAL', failure.user_message_key ?? 'errors.command_failed', failure.user_message_args ?? {}, {
          retryable: failure.retryable, needsUser: failure.needs_user, technicalDetails: failure.technical_details,
        });
      }
      const priorResult = parseJson(previous.result_json, null);
      if (priorResult && typeof priorResult === 'object') {
        return { ...priorResult, command_id: previous.id, idempotent_replay: true, projection_seq: this._projectionSeq() };
      }
      return { ...commandResult(previous), idempotent_replay: true };
    }

    const commandId = uuidv7();
    const created = nowUtcUs();
    const projectId = this._commandProjectId(commandType, payload);
    this._transaction(() => {
      this.db.prepare(`INSERT INTO commands
        (id, studio_id, project_id, actor_id, command_type, schema_version, scope_type, scope_id,
         payload_json, expected_versions_json, reversibility, status, idempotency_key,
         idempotency_fingerprint, created_at_utc_us)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 'RECEIVED', ?, ?, ?)`).run(
        commandId, this.studioId, projectId, this.actorId, commandType,
        projectId ? 'PROJECT' : 'SYSTEM', projectId, json(this._commandPayloadForStorage(commandType, payload)), json(expectedVersions),
        this._reversibility(commandType), idempotencyKey, requestFingerprint, created,
      );
    });

    let stagingReservation = null;
    let backupReservation = null;
    let externalCommandPrepared = false;
    try {
      // COPY imports reserve and populate a durable staging row before the
      // canonical command transaction starts.  If the process stops during
      // the file operation, the row and private temp bytes remain available
      // for explicit reconciliation instead of becoming an untracked orphan.
      const importCommand = ['ImportAsset', 'RegisterAsset', 'ImportLocalAsset'].includes(commandType);
      const storageMode = String(payload.storage_mode ?? payload.storageMode ?? 'COPY').trim().toUpperCase();
      if (importCommand && storageMode === 'COPY') stagingReservation = this._reserveImportStaging(payload, commandId);
      if (commandType === 'CreateBackup') {
        // VACUUM INTO cannot run inside a SQLite transaction.  Mark the
        // command executing first, create and verify the external artifact,
        // then atomically register its immutable manifest below.
        this._transaction(() => this.db.prepare('UPDATE commands SET status = ?, started_at_utc_us = ? WHERE id = ?')
          .run('EXECUTING', nowUtcUs(), commandId));
        externalCommandPrepared = true;
        backupReservation = this._prepareBackup(payload, commandId);
      }
      const applied = this._transaction(() => {
        if (!externalCommandPrepared) {
          this.db.prepare('UPDATE commands SET status = ?, started_at_utc_us = ? WHERE id = ?')
            .run('EXECUTING', nowUtcUs(), commandId);
        }
        const executionPayload = stagingReservation
          ? { ...payload, __staging_id: stagingReservation.id }
          : backupReservation ? { ...payload, __backup_reservation: backupReservation } : payload;
        const operation = this._applyCommand(commandType, executionPayload, expectedVersions, commandId);
        const eventSeq = this._insertEvent(operation.event, commandId, this.actorId, input.correlation_id ?? null, input.causation_id ?? null);
        this._insertAudit(operation.audit, commandId, this.actorId, 'SUCCEEDED');
        const canonicalKey = commandType.includes('Decision') ? 'decision'
          : commandType.includes('Note') || commandType === 'AddNote' ? 'note'
            : commandType.includes('Task') ? 'task'
              : commandType.includes('Shot') ? 'shot'
              : commandType === 'ReconcileStaging' ? 'staging' : null;
        const result = {
          ...operation.result,
          ...(canonicalKey ? { [canonicalKey]: operation.result } : {}),
          command_id: commandId,
          event_seq: eventSeq,
          status: 'SUCCEEDED',
        };
        this.db.prepare(`UPDATE commands SET project_id = COALESCE(?, project_id), status = 'SUCCEEDED',
          finished_at_utc_us = ?, result_json = ?, error_code = NULL, error_details_json = NULL WHERE id = ?`)
          .run(operation.projectId ?? null, nowUtcUs(), json(result), commandId);
        return result;
      });
      return this._commandResponse(commandId, applied);
    } catch (error) {
      const coreError = error instanceof CoreError ? error : new CoreError(
        'INTERNAL_ERROR', 'INTERNAL', 'errors.internal', {}, { needsUser: false, technicalDetails: { message: String(error?.message ?? error) } },
      );
      if (stagingReservation?.id) {
        try {
          this._transaction(() => {
            const current = this._stagingRow(stagingReservation.id);
            if (['WRITING', 'COMPLETE', 'VERIFIED'].includes(current.state)) this._setStagingState(stagingReservation.id, 'ORPHANED');
          });
        } catch { /* preserve command failure; evidence remains queryable */ }
      }
      if (backupReservation?.root) {
        try { fs.rmSync(backupReservation.root, { recursive: true, force: true }); } catch { /* preserve command failure */ }
      }
      this._transaction(() => {
        this.db.prepare(`UPDATE commands SET status = 'FAILED', finished_at_utc_us = ?, error_code = ?, error_details_json = ? WHERE id = ?`)
          .run(nowUtcUs(), coreError.code, json(coreError.toEnvelope()), commandId);
        this._insertAudit({ actionType: commandType, targetType: 'COMMAND', targetId: commandId, payload: { error_code: coreError.code } }, commandId, this.actorId, 'FAILED');
      });
      throw coreError;
    }
  }

  _commandResponse(commandId, result) {
    return { ...result, command_id: commandId, projection_seq: this._projectionSeq() };
  }

  _commandProjectId(commandType, payload) {
    const explicitProjectId = payload.project_id ?? payload.projectId;
    // For entity-scoped commands, derive the command's project from the
    // target row.  A caller-supplied project_id is only a scope assertion and
    // is checked by the command implementation; it must never cause the audit
    // record to claim a different project from the entity being mutated.
    const entityType = String(payload.entity_type ?? payload.entityType ?? '').trim().toUpperCase();
    const entityId = payload.entity_id ?? payload.entityId;
    if (commandType === 'CreateMediaProfileRevision' || commandType === 'CreateTimeline') {
      if (explicitProjectId) return this.db.prepare('SELECT id FROM projects WHERE id = ?').get(explicitProjectId)?.id ?? null;
    }
    if (commandType === 'TransitionMediaProfileRevision') {
      const mediaRevisionId = payload.revision_id ?? payload.revisionId;
      if (mediaRevisionId) return this.db.prepare(`SELECT p.project_id FROM project_media_profile_revisions r
        JOIN project_media_profiles p ON p.id = r.profile_id WHERE r.id = ?`).get(mediaRevisionId)?.project_id ?? null;
    }
    if (commandType === 'CreateTimelineRevision') {
      const timelineId = payload.timeline_id ?? payload.timelineId;
      if (timelineId) return this.db.prepare('SELECT project_id FROM timelines WHERE id = ?').get(timelineId)?.project_id ?? null;
    }
    if (commandType === 'TransitionTimelineRevision') {
      const timelineRevisionId = payload.timeline_revision_id ?? payload.timelineRevisionId ?? payload.revision_id ?? payload.revisionId;
      if (timelineRevisionId) return this.db.prepare(`SELECT t.project_id FROM timeline_revisions r
        JOIN timelines t ON t.id = r.timeline_id WHERE r.id = ?`).get(timelineRevisionId)?.project_id ?? null;
    }
    if (commandType === 'OpenReview') {
      const subjectId = payload.subject_revision_id ?? payload.subjectRevisionId ?? payload.subject_id ?? payload.subjectId ?? payload.timeline_revision_id ?? payload.timelineRevisionId;
      if (subjectId) return this.db.prepare(`SELECT t.project_id FROM timeline_revisions r
        JOIN timelines t ON t.id = r.timeline_id WHERE r.id = ?`).get(subjectId)?.project_id ?? null;
    }
    if (commandType === 'SubmitReview') {
      const reviewSessionId = payload.review_session_id ?? payload.reviewSessionId ?? payload.id;
      if (reviewSessionId) return this.db.prepare('SELECT project_id FROM review_sessions WHERE id = ?').get(reviewSessionId)?.project_id ?? null;
    }
    const derivesTask = ['UpdateTask', 'AddTaskNote'].includes(commandType) || (commandType === 'AddNote' && entityType === 'TASK');
    const derivesShot = ['UpdateShot', 'AddShotNote'].includes(commandType) || (commandType === 'AddNote' && entityType === 'SHOT');
    if (['ResolveDecisionRequest', 'DismissDecisionRequest', 'ObsoleteDecisionRequest'].includes(commandType)) {
      const decisionId = payload.decision_request_id ?? payload.decisionRequestId;
      if (decisionId) {
        const decision = this.db.prepare('SELECT project_id FROM decision_requests WHERE id = ?').get(decisionId);
        if (decision) return decision.project_id ?? null;
      }
    }
    if (derivesTask) {
      const taskId = commandType === 'AddNote'
        ? entityId
        : payload.task_id ?? payload.taskId ?? (entityType === 'TASK' ? entityId : null);
      if (taskId) {
        const derived = this.db.prepare('SELECT project_id FROM tasks WHERE id = ?').get(taskId)?.project_id;
        if (derived) return derived;
      }
    }
    if (derivesShot) {
      const shotId = commandType === 'AddNote'
        ? entityId
        : payload.shot_id ?? payload.shotId ?? (entityType === 'SHOT' ? entityId : null);
      if (shotId) {
        const derived = this.db.prepare('SELECT project_id FROM shots WHERE id = ?').get(shotId)?.project_id;
        if (derived) return derived;
      }
    }
    if (entityId && entityType === 'PROJECT') {
      const derived = this.db.prepare('SELECT id FROM projects WHERE id = ?').get(entityId)?.id;
      if (derived) return derived;
    }
    if (entityId && entityType === 'TASK') {
      const derived = this.db.prepare('SELECT project_id FROM tasks WHERE id = ?').get(entityId)?.project_id;
      if (derived) return derived;
    }
    if (entityId && entityType === 'SHOT') {
      const derived = this.db.prepare('SELECT project_id FROM shots WHERE id = ?').get(entityId)?.project_id;
      if (derived) return derived;
    }
    const rightsCommands = ['CreateRightsIdentity', 'CreateRightsRecord', 'RecordConsent', 'RevokeRights'];
    if (rightsCommands.includes(commandType)) {
      if (commandType === 'CreateRightsIdentity') {
        const subjectType = String(payload.subject_type ?? payload.subjectType ?? '').trim().toUpperCase();
        const subjectId = payload.subject_id ?? payload.subjectId;
        if (subjectType === 'ASSET' && subjectId) return this.db.prepare('SELECT project_id FROM assets WHERE id = ?').get(subjectId)?.project_id ?? null;
      } else {
        const identityId = payload.rights_identity_id ?? payload.rightsIdentityId ?? payload.identity_id ?? payload.identityId;
        if (identityId) return this.db.prepare('SELECT project_id FROM rights_identities WHERE id = ?').get(identityId)?.project_id ?? null;
      }
    }
    const characterCreateCommands = ['CreateCharacter'];
    if (characterCreateCommands.includes(commandType) && explicitProjectId) return this.db.prepare('SELECT id FROM projects WHERE id = ?').get(explicitProjectId)?.id ?? null;
    const characterId = payload.character_id ?? payload.characterId;
    if (characterId) {
      const characterProject = this.db.prepare('SELECT project_id FROM characters WHERE id = ?').get(characterId)?.project_id;
      if (characterProject) return characterProject;
    }
    const revisionId = payload.revision_id ?? payload.revisionId;
    if (revisionId) {
      const revisionProject = this.db.prepare(`SELECT c.project_id FROM characters c
        JOIN visual_identity_packages vp ON vp.character_id = c.id JOIN visual_identity_revisions vr ON vr.package_id = vp.id WHERE vr.id = ?
        UNION ALL SELECT c.project_id FROM characters c
        JOIN voice_identity_packages vp ON vp.character_id = c.id JOIN voice_identity_revisions vr ON vr.package_id = vp.id WHERE vr.id = ?
        UNION ALL SELECT c.project_id FROM characters c
        JOIN performance_bibles pb ON pb.character_id = c.id JOIN performance_bible_revisions pr ON pr.performance_bible_id = pb.id WHERE pr.id = ?
        LIMIT 1`).get(revisionId, revisionId, revisionId)?.project_id;
      if (revisionProject) return revisionProject;
    }
    if (explicitProjectId) {
      return this.db.prepare('SELECT id FROM projects WHERE id = ?').get(explicitProjectId)?.id ?? null;
    }
    if (commandType === 'CreateProject') return null;
    return null;
  }

  _reversibility(commandType) {
    if (['TrashProject', 'ArchiveProject'].includes(commandType)) return 'COMPENSATABLE';
    if (['ResolveDecisionRequest', 'DismissDecisionRequest', 'ObsoleteDecisionRequest'].includes(commandType)) return 'COMPENSATABLE';
    if (['CreateRightsIdentity', 'CreateRightsRecord', 'RecordConsent', 'RevokeRights'].includes(commandType)) return 'COMPENSATABLE';
    if (['CreateBackup', 'VerifyBackup'].includes(commandType)) return 'COMPENSATABLE';
    if (['CreateCharacter', 'CreateVisualIdentityRevision', 'CreateVoiceIdentityRevision', 'CreatePerformanceBibleRevision', 'TransitionCharacterRevision'].includes(commandType)) return 'COMPENSATABLE';
    if (['CreateMediaProfileRevision', 'TransitionMediaProfileRevision', 'CreateTimeline', 'CreateTimelineRevision', 'TransitionTimelineRevision'].includes(commandType)) return 'COMPENSATABLE';
    if (['OpenReview', 'SubmitReview'].includes(commandType)) return 'COMPENSATABLE';
    return 'REVERSIBLE';
  }

  _applyCommand(commandType, payload, expectedVersions, commandId) {
    switch (commandType) {
      case 'CreateProject': return this._createProject(payload);
      case 'UpdateProjectMetadata': return this._updateProject(payload, expectedVersions);
      case 'PauseProject': return this._changeProjectState(payload, expectedVersions, 'PAUSED');
      case 'ArchiveProject': return this._changeProjectState(payload, expectedVersions, 'ARCHIVED');
      case 'TrashProject': return this._changeProjectState(payload, expectedVersions, 'TRASHED');
      case 'RestoreProject': return this._changeProjectState(payload, expectedVersions, 'ACTIVE');
      case 'CreateTask': return this._createTask(payload);
      case 'UpdateTask': return this._updateTask(payload, expectedVersions);
      case 'CreateShot': return this._createShot(payload);
      case 'UpdateShot': return this._updateShot(payload, expectedVersions);
      case 'CreateCharacter': return this._createCharacter(payload);
      case 'CreateVisualIdentityRevision': return this._createCharacterRevision(payload, 'VISUAL');
      case 'CreateVoiceIdentityRevision': return this._createCharacterRevision(payload, 'VOICE');
      case 'CreatePerformanceBibleRevision': return this._createCharacterRevision(payload, 'PERFORMANCE');
      case 'TransitionCharacterRevision': return this._transitionCharacterRevision(payload, expectedVersions);
      case 'CreateMediaProfileRevision': return this._createMediaProfileRevision(payload);
      case 'TransitionMediaProfileRevision': return this._transitionMediaProfileRevision(payload, expectedVersions);
      case 'CreateTimeline': return this._createTimeline(payload);
      case 'CreateTimelineRevision': return this._createTimelineRevision(payload, expectedVersions);
      case 'TransitionTimelineRevision': return this._transitionTimelineRevision(payload, expectedVersions);
      case 'OpenReview': return this._openReview(payload, expectedVersions);
      case 'SubmitReview': return this._submitReview(payload, expectedVersions);
      case 'CreateDecisionRequest': return this._createDecisionRequest(payload);
      case 'ResolveDecisionRequest': return this._resolveDecisionRequest(payload, expectedVersions);
      case 'DismissDecisionRequest': return this._dismissDecisionRequest(payload, expectedVersions);
      case 'ObsoleteDecisionRequest': return this._obsoleteDecisionRequest(payload, expectedVersions);
      case 'ImportAsset':
      case 'RegisterAsset':
      case 'ImportLocalAsset': return this._importAsset(payload);
      case 'ReconcileStaging': return this._reconcileStaging(payload);
      case 'CreateRightsIdentity': return this._createRightsIdentity(payload);
      case 'CreateRightsRecord': return this._createRightsRecord(payload);
      case 'RecordConsent': return this._recordConsent(payload);
      case 'RevokeRights': return this._revokeRights(payload, commandId);
      case 'CreateBackup': return this._createBackup(payload, commandId);
      case 'VerifyBackup': return this._verifyBackup(payload, commandId);
      case 'AddNote':
      case 'AddTaskNote':
      case 'AddShotNote': return this._addNote(payload, commandType);
      default:
        throw new CoreError('UNSUPPORTED_COMMAND', 'VALIDATION', 'errors.unsupported_command', { command_type: commandType });
    }
  }

  _createProject(payload) {
    const title = requiredString(payload.title, 'title');
    const code = codeValue(payload.code, title);
    const description = optionalString(payload.description, 'description');
    const language = optionalString(payload.default_language ?? payload.defaultLanguage, 'default_language', 20, 'vi-VN');
    const collision = this.db.prepare('SELECT id FROM projects WHERE studio_id = ? AND code = ?').get(this.studioId, code);
    const finalCode = collision ? `${code.slice(0, 54)}-${uuidv7().slice(0, 8)}` : code;
    const projectId = uuidv7();
    const created = nowUtcUs();
    this.db.prepare(`INSERT INTO projects
      (id, studio_id, code, title, description, lifecycle_state, default_language,
       created_by_actor_id, created_at_utc_us, updated_at_utc_us, row_version)
      VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, 1)`).run(
      projectId, this.studioId, finalCode, title, description, language, this.actorId, created, created,
    );
    const project = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    return {
      projectId,
      project: publicProject(project),
      result: publicProject(project),
      projectId: projectId,
      event: { aggregateType: 'PROJECT', aggregateId: projectId, aggregateVersion: 1, eventType: 'PROJECT_CREATED', payload: publicProject(project) },
      audit: { actionType: 'project.create', targetType: 'PROJECT', targetId: projectId, payload: { code: finalCode } },
    };
  }

  _updateProject(payload, expectedVersions) {
    const projectId = payload.project_id ?? payload.projectId;
    const current = this._project(projectId);
    this._assertPayloadProjectScope(payload, current.id, 'PROJECT', projectId);
    this._expectedVersion(expectedVersions, 'PROJECT', projectId, current.row_version);
    this._assertProjectWritable(current);
    const title = payload.title === undefined ? current.title : requiredString(payload.title, 'title');
    const description = payload.description === undefined ? current.description : optionalString(payload.description, 'description');
    const language = payload.default_language === undefined && payload.defaultLanguage === undefined
      ? current.default_language : optionalString(payload.default_language ?? payload.defaultLanguage, 'default_language', 20);
    const code = payload.code === undefined ? current.code : codeValue(payload.code, title);
    const collision = this.db.prepare('SELECT id FROM projects WHERE studio_id = ? AND code = ? AND id != ?').get(this.studioId, code, projectId);
    if (collision) throw new CoreError('DUPLICATE_PROJECT_CODE', 'CONFLICT', 'errors.duplicate_project_code', { code });
    const updated = nowUtcUs();
    const nextVersion = Number(current.row_version) + 1;
    this.db.prepare(`UPDATE projects SET code = ?, title = ?, description = ?, default_language = ?,
      updated_at_utc_us = ?, row_version = ? WHERE id = ?`).run(code, title, description, language, updated, nextVersion, projectId);
    const project = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    return {
      projectId,
      result: publicProject(project),
      event: { aggregateType: 'PROJECT', aggregateId: projectId, aggregateVersion: nextVersion, eventType: 'PROJECT_METADATA_UPDATED', payload: publicProject(project) },
      audit: { actionType: 'project.update_metadata', targetType: 'PROJECT', targetId: projectId, payload: { row_version: nextVersion } },
    };
  }

  _changeProjectState(payload, expectedVersions, state) {
    const projectId = payload.project_id ?? payload.projectId;
    const current = this._project(projectId);
    this._assertPayloadProjectScope(payload, current.id, 'PROJECT', projectId);
    this._expectedVersion(expectedVersions, 'PROJECT', projectId, current.row_version);
    const allowed = {
      ACTIVE: new Set(['PAUSED', 'ARCHIVED', 'TRASHED']),
      PAUSED: new Set(['ACTIVE', 'ARCHIVED', 'TRASHED']),
      ARCHIVED: new Set(['TRASHED']),
      TRASHED: new Set(['ACTIVE']),
    };
    if (!allowed[current.lifecycle_state]?.has(state)) {
      throw new CoreError('INVALID_STATE_TRANSITION', 'CONFLICT', 'errors.invalid_state_transition', { from: current.lifecycle_state, to: state });
    }
    const version = Number(current.row_version) + 1;
    this.db.prepare('UPDATE projects SET lifecycle_state = ?, updated_at_utc_us = ?, row_version = ? WHERE id = ?')
      .run(state, nowUtcUs(), version, projectId);
    const project = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    return {
      projectId,
      result: publicProject(project),
      event: { aggregateType: 'PROJECT', aggregateId: projectId, aggregateVersion: version, eventType: `PROJECT_${state}`, payload: publicProject(project) },
      audit: { actionType: `project.${state.toLowerCase()}`, targetType: 'PROJECT', targetId: projectId, payload: { lifecycle_state: state } },
    };
  }

  _characterProjection(characterId, options = {}) {
    const character = this._character(characterId);
    const visualPackage = this.db.prepare('SELECT * FROM visual_identity_packages WHERE character_id = ?').get(character.id);
    const voicePackage = this.db.prepare('SELECT * FROM voice_identity_packages WHERE character_id = ?').get(character.id);
    const performanceBible = this.db.prepare('SELECT * FROM performance_bibles WHERE character_id = ?').get(character.id);
    const latest = (table, column, packageId) => packageId
      ? this.db.prepare(`SELECT * FROM ${table} WHERE ${column} = ? ORDER BY revision_number DESC LIMIT 1`).get(packageId)
      : null;
    const visual = latest('visual_identity_revisions', 'package_id', visualPackage?.id);
    const voice = latest('voice_identity_revisions', 'package_id', voicePackage?.id);
    const performance = latest('performance_bible_revisions', 'performance_bible_id', performanceBible?.id);
    const visualRefs = visual
      ? this.db.prepare(`SELECT r.*, a.project_id, ar.availability_state, ar.review_state, ar.availability_evidence_state,
          so.storage_class, sol.state AS location_state
        FROM visual_identity_references r
        JOIN asset_revisions ar ON ar.id = r.asset_revision_id
        JOIN assets a ON a.id = ar.asset_id
        JOIN storage_objects so ON so.id = ar.storage_object_id
        LEFT JOIN storage_object_locations sol ON sol.storage_object_id = so.id AND sol.location_role = 'PRIMARY'
        WHERE r.visual_identity_revision_id = ?
        ORDER BY r.priority ASC, r.reference_role ASC, r.asset_revision_id ASC`).all(visual.id)
      : [];
    const visualReady = visualRefs.length === 0 || visualRefs.every((ref) => ref.project_id === character.project_id
      && ref.availability_state === 'AVAILABLE'
      && ref.review_state === 'APPROVED'
      && ref.availability_evidence_state === 'VERIFIED'
      && ref.location_state === 'AVAILABLE'
      && ref.storage_class !== 'EXTERNAL_REFERENCE');
    const visualView = visual ? publicCharacterRevision(visual, ['anatomy', 'proportion', 'palette', 'marking', 'forbidden_drift']) : null;
    if (visualView) {
      visualView.references = visualRefs.map(publicCharacterReference);
      visualView.readiness_state = visualReady ? 'READY' : 'UNKNOWN';
      visualView.next_step = visualReady ? null : 'Kiểm tra asset reference đã materialize và được duyệt trước khi khóa visual identity.';
    }
    const voiceView = voice ? publicCharacterRevision(voice, [
      'accent_profile', 'vocal_range', 'timbre', 'prosody', 'emotional_map', 'pronunciation_lexicon', 'forbidden_traits',
    ]) : null;
    if (voiceView) {
      const rights = voice.rights_identity_id
        ? this._evaluateRights(voice.rights_identity_id, { right_type: DEFAULT_RIGHT_TYPE, consent_type: DEFAULT_CONSENT_TYPE, purpose: 'VOICE_IDENTITY' })
        : publicRightsEvaluation({
          status: 'UNKNOWN', state: 'UNKNOWN', eligible: false, rights_identity_id: null,
          right_type: DEFAULT_RIGHT_TYPE, consent_type: DEFAULT_CONSENT_TYPE,
          blockers: [{ code: 'RIGHTS_IDENTITY_MISSING', dimension: 'IDENTITY', status: 'UNKNOWN' }],
          evidence: [], evaluated_at_utc_us: nowUtcUs(),
        });
      voiceView.rights = rights;
      voiceView.readiness_state = rights.eligible ? 'READY' : 'UNKNOWN';
      voiceView.next_step = rights.eligible ? null : 'Bổ sung quyền và consent ALLOWED trước khi duyệt voice identity.';
    }
    const performanceView = performance ? publicCharacterRevision(performance, [
      'posture', 'gait', 'gestures', 'eye_behavior', 'reaction_timing', 'speech_rhythm', 'emotional_baseline', 'forbidden_drift',
    ]) : null;
    if (performanceView) {
      performanceView.readiness_state = 'READY';
      performanceView.next_step = null;
    }
    const visualRows = visualPackage
      ? this.db.prepare('SELECT * FROM visual_identity_revisions WHERE package_id = ? ORDER BY revision_number DESC').all(visualPackage.id)
      : [];
    const voiceRows = voicePackage
      ? this.db.prepare('SELECT * FROM voice_identity_revisions WHERE package_id = ? ORDER BY revision_number DESC').all(voicePackage.id)
      : [];
    const performanceRows = performanceBible
      ? this.db.prepare('SELECT * FROM performance_bible_revisions WHERE performance_bible_id = ? ORDER BY revision_number DESC').all(performanceBible.id)
      : [];
    const publicPackage = (root, rows, kind) => {
      if (!root) return null;
      const revisions = rows.map((row) => {
        const fields = kind === 'VISUAL'
          ? ['anatomy', 'proportion', 'palette', 'marking', 'forbidden_drift']
          : kind === 'VOICE'
            ? ['accent_profile', 'vocal_range', 'timbre', 'prosody', 'emotional_map', 'pronunciation_lexicon', 'forbidden_traits']
            : ['posture', 'gait', 'gestures', 'eye_behavior', 'reaction_timing', 'speech_rhythm', 'emotional_baseline', 'forbidden_drift'];
        const view = publicCharacterRevision(row, fields);
        if (kind === 'VOICE') view.rights = this._voiceRevisionRights(row);
        return view;
      });
      return {
        id: root.id,
        approved_revision: revisions.find((revision) => revision.lifecycle_state === 'APPROVED') ?? null,
        candidate_revisions: revisions.filter((revision) => ['DRAFT', 'CANDIDATE'].includes(revision.lifecycle_state)),
      };
    };
    return {
      character: publicCharacter(character),
      visual_identity: visualView,
      voice_identity: voiceView,
      performance_bible: performanceView,
      visual_identity_package: publicPackage(visualPackage, visualRows, 'VISUAL'),
      voice_identity_package: publicPackage(voicePackage, voiceRows, 'VOICE'),
      performance_bible_package: publicPackage(performanceBible, performanceRows, 'PERFORMANCE'),
      projection_seq: this._projectionSeq(),
      generated_at: new Date().toISOString(),
      ...options,
    };
  }

  _characterList(params = {}) {
    const projectId = params.project_id ?? params.projectId ?? null;
    if (projectId) this._project(projectId);
    const stateInput = params.lifecycle_state ?? params.lifecycleState ?? null;
    const state = stateInput === null || stateInput === undefined || stateInput === '' ? null : String(stateInput).trim().toUpperCase();
    if (state !== null && !CHARACTER_STATES.has(state)) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_character_state', { state });
    const limit = Math.min(Math.max(asInt(params.limit, 100), 1), 200);
    const rows = this.db.prepare(`SELECT * FROM characters
      WHERE (? IS NULL OR project_id = ?) AND (? IS NULL OR lifecycle_state = ?)
      ORDER BY display_name COLLATE NOCASE ASC, id ASC LIMIT ?`).all(projectId, projectId, state, state, limit);
    return {
      characters: rows.map((row) => {
        const projection = this._characterProjection(row.id);
        return {
          ...projection.character,
          visual_identity_package: projection.visual_identity_package,
          voice_identity_package: projection.voice_identity_package,
          performance_bible_package: projection.performance_bible_package,
          visual_identity: projection.visual_identity ? {
            id: projection.visual_identity.id,
            revision_id: projection.visual_identity.id,
            state: projection.visual_identity.lifecycle_state,
            readiness_state: projection.visual_identity.readiness_state,
          } : null,
          voice_identity: projection.voice_identity ? {
            id: projection.voice_identity.id,
            revision_id: projection.voice_identity.id,
            state: projection.voice_identity.lifecycle_state,
            readiness_state: projection.voice_identity.readiness_state,
            rights_state: projection.voice_identity.rights?.status ?? 'UNKNOWN',
          } : null,
          performance_bible: projection.performance_bible ? {
            id: projection.performance_bible.id,
            revision_id: projection.performance_bible.id,
            state: projection.performance_bible.lifecycle_state,
            readiness_state: projection.performance_bible.readiness_state,
          } : null,
        };
      }),
      projection_seq: this._projectionSeq(),
      generated_at: new Date().toISOString(),
    };
  }

  _createCharacter(payload) {
    const project = this._project(payload.project_id ?? payload.projectId);
    if (payload.entity_type !== undefined || payload.entityType !== undefined || payload.entity_id !== undefined || payload.entityId !== undefined) {
      this._assertPayloadProjectScope(payload, project.id, 'PROJECT', project.id);
    }
    this._assertProjectWritable(project);
    const displayName = requiredString(payload.display_name ?? payload.displayName ?? payload.name, 'display_name');
    // Character codes are identifiers, not display text. Canonicalizing them
    // avoids two visually equivalent identities (e.g. MAYA/maya) in a project.
    const stableCode = codeValue(payload.stable_code ?? payload.stableCode ?? payload.code, displayName).toUpperCase();
    const collision = this.db.prepare('SELECT id FROM characters WHERE project_id = ? AND stable_code = ?').get(project.id, stableCode);
    if (collision) throw new CoreError('DUPLICATE_CHARACTER_CODE', 'CONFLICT', 'errors.duplicate_character_code', { stable_code: stableCode });
    const characterId = uuidv7();
    const visualPackageId = uuidv7();
    const voicePackageId = uuidv7();
    const performanceBibleId = uuidv7();
    const created = nowUtcUs();
    this.db.prepare(`INSERT INTO characters
      (id, project_id, stable_code, display_name, lifecycle_state, created_by_actor_id, created_at_utc_us, updated_at_utc_us, row_version)
      VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?, 1)`).run(characterId, project.id, stableCode, displayName, this.actorId, created, created);
    this.db.prepare(`INSERT INTO visual_identity_packages(id, character_id, created_by_actor_id, created_at_utc_us) VALUES (?, ?, ?, ?)`)
      .run(visualPackageId, characterId, this.actorId, created);
    this.db.prepare(`INSERT INTO voice_identity_packages(id, character_id, created_by_actor_id, created_at_utc_us) VALUES (?, ?, ?, ?)`)
      .run(voicePackageId, characterId, this.actorId, created);
    this.db.prepare(`INSERT INTO performance_bibles(id, character_id, created_by_actor_id, created_at_utc_us) VALUES (?, ?, ?, ?)`)
      .run(performanceBibleId, characterId, this.actorId, created);
    const projection = this._characterProjection(characterId);
    return {
      projectId: project.id,
      result: projection,
      event: { aggregateType: 'CHARACTER', aggregateId: characterId, aggregateVersion: 1, eventType: 'CHARACTER_CREATED', payload: projection.character },
      audit: { actionType: 'character.create', targetType: 'CHARACTER', targetId: characterId, payload: { stable_code: stableCode, project_id: project.id } },
    };
  }

  _revisionInput(payload, kind, character) {
    const semanticDescription = optionalString(payload.semantic_description ?? payload.semanticDescription, 'semantic_description', 8000, '');
    if (kind === 'VISUAL') {
      return {
        semanticDescription,
        anatomy: structuredValue(payload.anatomy ?? {}, 'anatomy', {}, 'object'),
        proportion: structuredValue(payload.proportion ?? payload.proportions ?? {}, 'proportion', {}, 'object'),
        palette: structuredValue(payload.palette ?? {}, 'palette', {}, 'object'),
        marking: structuredValue(payload.marking ?? payload.markings ?? {}, 'marking', {}, 'object'),
        forbiddenDrift: structuredValue(payload.forbidden_drift ?? payload.forbiddenDrift ?? {}, 'forbidden_drift', {}, 'object'),
        references: arrayValue(payload.references ?? [], 'references', []).map((reference, index) => {
          if (!reference || typeof reference !== 'object' || Array.isArray(reference)) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field: `references[${index}]` });
          const assetRevisionId = requiredString(reference.asset_revision_id ?? reference.assetRevisionId, 'asset_revision_id');
          const referenceRole = requiredString(reference.reference_role ?? reference.referenceRole ?? 'CANONICAL', 'reference_role', 100).toUpperCase();
          const priority = asInt(reference.priority, index);
          if (priority < 0 || priority > 100000) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field: 'priority' });
          const asset = this.db.prepare(`SELECT a.project_id, ar.availability_state, ar.review_state, ar.availability_evidence_state,
              so.storage_class, sol.state AS location_state
            FROM asset_revisions ar JOIN assets a ON a.id = ar.asset_id
            JOIN storage_objects so ON so.id = ar.storage_object_id
            LEFT JOIN storage_object_locations sol ON sol.storage_object_id = so.id AND sol.location_role = 'PRIMARY'
            WHERE ar.id = ?`).get(assetRevisionId);
          if (!asset) throw new CoreError('ASSET_REVISION_NOT_FOUND', 'VALIDATION', 'errors.asset_revision_not_found', { asset_revision_id: assetRevisionId });
          if (asset.project_id !== character.project_id) throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', {
            entity_type: 'ASSET_REVISION', entity_id: assetRevisionId, project_id: character.project_id, actual_project_id: asset.project_id,
          }, { needsUser: true });
          if (asset.availability_state !== 'AVAILABLE' || asset.review_state !== 'APPROVED'
            || asset.availability_evidence_state !== 'VERIFIED' || asset.location_state !== 'AVAILABLE'
            || asset.storage_class === 'EXTERNAL_REFERENCE') {
            throw new CoreError('ASSET_NOT_READY', 'CONFLICT', 'errors.character_asset_not_ready', { asset_revision_id: assetRevisionId }, { needsUser: true });
          }
          return { assetRevisionId, referenceRole, priority };
        }),
      };
    }
    if (kind === 'VOICE') {
      const canonicalLanguage = requiredString(payload.canonical_language ?? payload.canonicalLanguage ?? 'vi-VN', 'canonical_language', 35);
      const rightsIdentityId = payload.rights_identity_id ?? payload.rightsIdentityId ?? null;
      if (rightsIdentityId !== null) {
        const identity = this._rightsIdentity(rightsIdentityId);
        if (identity.project_id !== null && identity.project_id !== character.project_id) {
          throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', {
            entity_type: 'RIGHTS_IDENTITY', entity_id: identity.id, project_id: character.project_id, actual_project_id: identity.project_id,
          }, { needsUser: true });
        }
      }
      return {
        semanticDescription,
        canonicalLanguage,
        accentProfile: structuredValue(payload.accent_profile ?? payload.accentProfile ?? {}, 'accent_profile', {}, 'object'),
        vocalRange: structuredValue(payload.vocal_range ?? payload.vocalRange ?? {}, 'vocal_range', {}, 'object'),
        timbre: structuredValue(payload.timbre ?? {}, 'timbre', {}, 'object'),
        prosody: structuredValue(payload.prosody ?? {}, 'prosody', {}, 'object'),
        emotionalMap: structuredValue(payload.emotional_map ?? payload.emotionalMap ?? {}, 'emotional_map', {}, 'object'),
        pronunciationLexicon: structuredValue(payload.pronunciation_lexicon ?? payload.pronunciationLexicon ?? {}, 'pronunciation_lexicon', {}, 'object'),
        forbiddenTraits: structuredValue(payload.forbidden_traits ?? payload.forbiddenTraits ?? {}, 'forbidden_traits', {}, 'object'),
        rightsIdentityId,
      };
    }
    return {
      posture: structuredValue(payload.posture ?? {}, 'posture', {}, 'object'),
      gait: structuredValue(payload.gait ?? {}, 'gait', {}, 'object'),
      gestures: structuredValue(payload.gestures ?? {}, 'gestures', {}, 'object'),
      eyeBehavior: structuredValue(payload.eye_behavior ?? payload.eyeBehavior ?? {}, 'eye_behavior', {}, 'object'),
      reactionTiming: structuredValue(payload.reaction_timing ?? payload.reactionTiming ?? {}, 'reaction_timing', {}, 'object'),
      speechRhythm: structuredValue(payload.speech_rhythm ?? payload.speechRhythm ?? {}, 'speech_rhythm', {}, 'object'),
      emotionalBaseline: structuredValue(payload.emotional_baseline ?? payload.emotionalBaseline ?? {}, 'emotional_baseline', {}, 'object'),
      forbiddenDrift: structuredValue(payload.forbidden_drift ?? payload.forbiddenDrift ?? {}, 'forbidden_drift', {}, 'object'),
    };
  }

  _createCharacterRevision(payload, kind) {
    const character = this._character(payload.character_id ?? payload.characterId);
    this._assertCharacterProjectScope(payload, character);
    this._assertProjectWritable(this._project(character.project_id));
    const packageInfo = this._characterPackage(character.id, kind);
    const input = this._revisionInput(payload, kind, character);
    const table = kind === 'VISUAL' ? 'visual_identity_revisions' : kind === 'VOICE' ? 'voice_identity_revisions' : 'performance_bible_revisions';
    const packageColumn = kind === 'PERFORMANCE' ? 'performance_bible_id' : 'package_id';
    const latest = this.db.prepare(`SELECT COALESCE(MAX(revision_number), 0) AS revision_number FROM ${table} WHERE ${packageColumn} = ?`).get(packageInfo.row.id);
    const revisionNumber = Number(latest.revision_number) + 1;
    const revisionId = uuidv7();
    const created = nowUtcUs();
    if (kind === 'VISUAL') {
      this.db.prepare(`INSERT INTO visual_identity_revisions
        (id, package_id, revision_number, lifecycle_state, semantic_description, anatomy_json, proportion_json, palette_json, marking_json, forbidden_drift_json, created_by_actor_id, created_at_utc_us, row_version)
        VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(
        revisionId, packageInfo.row.id, revisionNumber, input.semanticDescription, json(input.anatomy), json(input.proportion), json(input.palette), json(input.marking), json(input.forbiddenDrift), this.actorId, created,
      );
      const insertRef = this.db.prepare(`INSERT INTO visual_identity_references
        (visual_identity_revision_id, asset_revision_id, reference_role, priority, created_at_utc_us) VALUES (?, ?, ?, ?, ?)`);
      for (const reference of input.references) insertRef.run(revisionId, reference.assetRevisionId, reference.referenceRole, reference.priority, created);
    } else if (kind === 'VOICE') {
      this.db.prepare(`INSERT INTO voice_identity_revisions
        (id, package_id, revision_number, lifecycle_state, semantic_description, canonical_language, accent_profile_json, vocal_range_json, timbre_json, prosody_json, emotional_map_json, pronunciation_lexicon_json, forbidden_traits_json, rights_identity_id, created_by_actor_id, created_at_utc_us, row_version)
        VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(
        revisionId, packageInfo.row.id, revisionNumber, input.semanticDescription, input.canonicalLanguage, json(input.accentProfile), json(input.vocalRange), json(input.timbre), json(input.prosody), json(input.emotionalMap), json(input.pronunciationLexicon), json(input.forbiddenTraits), input.rightsIdentityId, this.actorId, created,
      );
    } else {
      this.db.prepare(`INSERT INTO performance_bible_revisions
        (id, performance_bible_id, revision_number, lifecycle_state, posture_json, gait_json, gestures_json, eye_behavior_json, reaction_timing_json, speech_rhythm_json, emotional_baseline_json, forbidden_drift_json, created_by_actor_id, created_at_utc_us, row_version)
        VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(
        revisionId, packageInfo.row.id, revisionNumber, json(input.posture), json(input.gait), json(input.gestures), json(input.eyeBehavior), json(input.reactionTiming), json(input.speechRhythm), json(input.emotionalBaseline), json(input.forbiddenDrift), this.actorId, created,
      );
    }
    const characterVersion = Number(character.row_version) + 1;
    this.db.prepare('UPDATE characters SET updated_at_utc_us = ?, row_version = ? WHERE id = ?').run(created, characterVersion, character.id);
    const projection = this._characterProjection(character.id);
    const revision = kind === 'VISUAL' ? projection.visual_identity : kind === 'VOICE' ? projection.voice_identity : projection.performance_bible;
    return {
      projectId: character.project_id,
      result: { character: projection.character, revision },
      event: { aggregateType: 'CHARACTER', aggregateId: character.id, aggregateVersion: characterVersion, eventType: `${kind}_IDENTITY_REVISION_CREATED`, payload: { character_id: character.id, revision_id: revisionId, revision_type: kind, revision_number: revisionNumber } },
      audit: { actionType: `character.${kind.toLowerCase()}_revision.create`, targetType: `${kind}_IDENTITY_REVISION`, targetId: revisionId, payload: { character_id: character.id, revision_number: revisionNumber } },
    };
  }

  _voiceRevisionRights(row) {
    if (!row.rights_identity_id) return publicRightsEvaluation({
      status: 'UNKNOWN', state: 'UNKNOWN', eligible: false, rights_identity_id: null,
      right_type: DEFAULT_RIGHT_TYPE, consent_type: DEFAULT_CONSENT_TYPE,
      blockers: [{ code: 'RIGHTS_IDENTITY_MISSING', dimension: 'IDENTITY', status: 'UNKNOWN' }],
      evidence: [], evaluated_at_utc_us: nowUtcUs(),
    });
    return this._evaluateRights(row.rights_identity_id, { right_type: DEFAULT_RIGHT_TYPE, consent_type: DEFAULT_CONSENT_TYPE, purpose: 'VOICE_IDENTITY' });
  }

  _transitionCharacterRevision(payload, expectedVersions) {
    const kind = enumValue(payload.revision_type ?? payload.revisionType, 'revision_type', /^[A-Z]+$/, null);
    if (!CHARACTER_REVISION_TYPES.has(kind)) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field: 'revision_type' });
    const info = this._characterRevision(kind, payload.revision_id ?? payload.revisionId);
    this._assertCharacterProjectScope(payload, info.character);
    this._assertProjectWritable(this._project(info.character.project_id));
    const expected = this._expectedVersion(expectedVersions, 'REVISION', info.row.id, info.row.row_version);
    const nextState = enumValue(payload.next_state ?? payload.nextState ?? payload.state, 'next_state', /^[A-Z]+$/, null);
    if (!CHARACTER_REVISION_STATES.has(nextState) || !CHARACTER_REVISION_TRANSITIONS[info.row.lifecycle_state]?.has(nextState)) {
      throw new CoreError('INVALID_STATE_TRANSITION', 'CONFLICT', 'errors.invalid_state_transition', { from: info.row.lifecycle_state, to: nextState });
    }
    if (nextState === 'APPROVED' && kind === 'VOICE') {
      const rights = this._voiceRevisionRights(info.row);
      if (!rights.eligible) {
        throw new CoreError('RIGHTS_BLOCKED', 'RIGHTS_BLOCKED', 'errors.character_voice_rights_blocked', {
          revision_id: info.row.id, status: rights.status,
        }, { needsUser: true, technicalDetails: { rights } });
      }
    }
    if (nextState === 'APPROVED' && kind === 'VISUAL') {
      const refs = this.db.prepare(`SELECT r.asset_revision_id, a.project_id, ar.availability_state, ar.review_state, ar.availability_evidence_state,
          so.storage_class, sol.state AS location_state
        FROM visual_identity_references r JOIN asset_revisions ar ON ar.id = r.asset_revision_id
        JOIN assets a ON a.id = ar.asset_id JOIN storage_objects so ON so.id = ar.storage_object_id
        LEFT JOIN storage_object_locations sol ON sol.storage_object_id = so.id AND sol.location_role = 'PRIMARY'
        WHERE r.visual_identity_revision_id = ?`).all(info.row.id);
      if (refs.some((ref) => ref.project_id !== info.character.project_id || ref.availability_state !== 'AVAILABLE'
        || ref.review_state !== 'APPROVED' || ref.availability_evidence_state !== 'VERIFIED'
        || ref.location_state !== 'AVAILABLE' || ref.storage_class === 'EXTERNAL_REFERENCE')) {
        throw new CoreError('ASSET_NOT_READY', 'CONFLICT', 'errors.character_asset_not_ready', { revision_id: info.row.id }, { needsUser: true });
      }
    }
    const currentApproved = this.db.prepare(`SELECT id FROM ${info.table} WHERE ${info.packageColumn} = ? AND lifecycle_state = 'APPROVED' AND id != ?`).get(info.row[info.packageColumn], info.row.id);
    const supersededRevisionId = nextState === 'APPROVED' ? currentApproved?.id ?? null : null;
    if (supersededRevisionId) {
      this.db.prepare(`UPDATE ${info.table} SET lifecycle_state = 'SUPERSEDED', row_version = row_version + 1 WHERE id = ?`).run(supersededRevisionId);
    }
    const nextVersion = Number(info.row.row_version) + 1;
    this.db.prepare(`UPDATE ${info.table} SET lifecycle_state = ?, row_version = ? WHERE id = ?`).run(nextState, nextVersion, info.row.id);
    const characterVersion = Number(info.character.row_version) + 1;
    this.db.prepare('UPDATE characters SET updated_at_utc_us = ?, row_version = ? WHERE id = ?').run(nowUtcUs(), characterVersion, info.character.id);
    const projection = this._characterProjection(info.character.id);
    const revision = kind === 'VISUAL' ? projection.visual_identity : kind === 'VOICE' ? projection.voice_identity : projection.performance_bible;
    return {
      projectId: info.character.project_id,
      result: { character: projection.character, revision },
      event: { aggregateType: 'CHARACTER', aggregateId: info.character.id, aggregateVersion: characterVersion, eventType: `${kind}_IDENTITY_REVISION_${nextState}`, payload: { character_id: info.character.id, revision_id: info.row.id, revision_type: kind, lifecycle_state: nextState, superseded_revision_id: supersededRevisionId } },
      audit: { actionType: `character.${kind.toLowerCase()}_revision.transition`, targetType: `${kind}_IDENTITY_REVISION`, targetId: info.row.id, payload: { from: info.row.lifecycle_state, to: nextState, superseded_revision_id: supersededRevisionId } },
    };
  }

  _mediaProfileInput(payload) {
    const source = payload?.profile && typeof payload.profile === 'object' && !Array.isArray(payload.profile)
      ? { ...payload, ...payload.profile }
      : payload;
    const timelineRate = normalizeRational(source.timeline_rate ?? source.timelineRate ?? {
      num: source.timeline_rate_num ?? source.timelineRateNum,
      den: source.timeline_rate_den ?? source.timelineRateDen,
    }, 'timeline_rate', { allowZero: false });
    const timeBase = normalizeRational(source.time_base ?? source.timeBase ?? source.timeline_time_base ?? source.timelineTimeBase ?? {
      num: source.time_base_num ?? source.timeBaseNum ?? source.timeline_time_base_num ?? source.timelineTimeBaseNum,
      den: source.time_base_den ?? source.timeBaseDen ?? source.timeline_time_base_den ?? source.timelineTimeBaseDen,
    }, 'time_base', { allowZero: false });
    const pixelAspect = normalizeRational(source.pixel_aspect ?? source.pixelAspect ?? {
      num: source.pixel_aspect_num ?? source.pixelAspectNum,
      den: source.pixel_aspect_den ?? source.pixelAspectDen,
    }, 'pixel_aspect', { allowZero: false });
    return {
      timelineRate,
      timeBase,
      pixelAspect,
      width: boundedInteger(source.width, 'width', { min: 1, max: 32_000 }),
      height: boundedInteger(source.height, 'height', { min: 1, max: 32_000 }),
      workingColorSpace: requiredString(source.working_color_space ?? source.workingColorSpace, 'working_color_space', 100),
      transferFunction: requiredString(source.transfer_function ?? source.transferFunction, 'transfer_function', 100),
      hdrPolicy: requiredString(source.hdr_policy ?? source.hdrPolicy, 'hdr_policy', 100),
      audioSampleRate: boundedInteger(source.audio_sample_rate ?? source.audioSampleRate, 'audio_sample_rate', { min: 1, max: 768_000 }),
      audioChannelLayout: requiredString(source.audio_channel_layout ?? source.audioChannelLayout, 'audio_channel_layout', 100),
      proxyProfile: structuredValue(source.proxy_profile ?? source.proxyProfile ?? {}, 'proxy_profile', {}, 'object'),
      masteringTargets: structuredValue(source.mastering_targets ?? source.masteringTargets ?? {}, 'mastering_targets', {}, 'object'),
    };
  }

  _mediaProfileProjection(profileId) {
    const profile = this.db.prepare('SELECT * FROM project_media_profiles WHERE id = ?').get(profileId);
    if (!profile) throw new CoreError('MEDIA_PROFILE_NOT_FOUND', 'VALIDATION', 'errors.media_profile_not_found', { profile_id: profileId });
    const revisions = this.db.prepare(`SELECT * FROM project_media_profile_revisions
      WHERE profile_id = ? ORDER BY revision_number DESC`).all(profile.id).map(publicMediaProfileRevision);
    return {
      profile: { id: profile.id, project_id: profile.project_id, revisions },
      approved_revision: revisions.find((revision) => revision.lifecycle_state === 'APPROVED') ?? null,
      candidate_revisions: revisions.filter((revision) => ['DRAFT', 'CANDIDATE'].includes(revision.lifecycle_state)),
      projection_seq: this._projectionSeq(),
      generated_at: new Date().toISOString(),
    };
  }

  _createMediaProfileRevision(payload) {
    const project = this._project(payload.project_id ?? payload.projectId);
    this._assertProjectWritable(project);
    const input = this._mediaProfileInput(payload);
    let profile = this.db.prepare('SELECT * FROM project_media_profiles WHERE project_id = ?').get(project.id);
    if (payload.profile_id ?? payload.profileId) {
      const profileId = requiredString(payload.profile_id ?? payload.profileId, 'profile_id');
      profile = this.db.prepare('SELECT * FROM project_media_profiles WHERE id = ?').get(profileId);
      if (!profile) throw new CoreError('MEDIA_PROFILE_NOT_FOUND', 'VALIDATION', 'errors.media_profile_not_found', { profile_id: profileId });
      if (profile.project_id !== project.id) throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', {
        entity_type: 'MEDIA_PROFILE', entity_id: profile.id, project_id: project.id, actual_project_id: profile.project_id,
      }, { needsUser: true });
    }
    const created = nowUtcUs();
    if (!profile) {
      profile = { id: uuidv7(), project_id: project.id };
      this.db.prepare(`INSERT INTO project_media_profiles(id, project_id, created_by_actor_id, created_at_utc_us)
        VALUES (?, ?, ?, ?)`).run(profile.id, project.id, this.actorId, created);
    }
    const latest = this.db.prepare('SELECT COALESCE(MAX(revision_number), 0) AS revision_number FROM project_media_profile_revisions WHERE profile_id = ?').get(profile.id);
    const revisionId = uuidv7();
    const revisionNumber = Number(latest.revision_number) + 1;
    this.db.prepare(`INSERT INTO project_media_profile_revisions
      (id, profile_id, revision_number, lifecycle_state, timeline_rate_num, timeline_rate_den,
       time_base_num, time_base_den, width, height, pixel_aspect_num, pixel_aspect_den,
       working_color_space, transfer_function, hdr_policy, audio_sample_rate, audio_channel_layout,
       proxy_profile_json, mastering_targets_json, created_by_actor_id, created_at_utc_us, row_version)
      VALUES (?, ?, ?, 'CANDIDATE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(
      revisionId, profile.id, revisionNumber, input.timelineRate.num, input.timelineRate.den,
      input.timeBase.num, input.timeBase.den, input.width, input.height, input.pixelAspect.num, input.pixelAspect.den,
      input.workingColorSpace, input.transferFunction, input.hdrPolicy, input.audioSampleRate, input.audioChannelLayout,
      json(input.proxyProfile), json(input.masteringTargets), this.actorId, created,
    );
    const projection = this._mediaProfileProjection(profile.id);
    const aggregateVersion = Number(this.db.prepare(`SELECT COALESCE(MAX(aggregate_version), 0) + 1 AS version
      FROM domain_events WHERE aggregate_type = 'MEDIA_PROFILE' AND aggregate_id = ?`).get(profile.id).version);
    return {
      projectId: project.id,
      result: projection,
      event: { aggregateType: 'MEDIA_PROFILE', aggregateId: profile.id, aggregateVersion, eventType: 'MEDIA_PROFILE_REVISION_CREATED', payload: { profile_id: profile.id, revision_id: revisionId, revision_number: revisionNumber } },
      audit: { actionType: 'media_profile.revision.create', targetType: 'MEDIA_PROFILE_REVISION', targetId: revisionId, payload: { profile_id: profile.id, project_id: project.id, revision_number: revisionNumber } },
    };
  }

  _transitionMediaProfileRevision(payload, expectedVersions) {
    const info = this._mediaProfileRevision(payload.revision_id ?? payload.revisionId);
    this._assertPayloadProjectScope(payload, info.project_id, 'MEDIA_PROFILE_REVISION', info.id);
    const project = this._project(info.project_id);
    this._assertProjectWritable(project);
    this._expectedVersion(expectedVersions, 'REVISION', info.id, info.row_version);
    const nextState = enumValue(payload.next_state ?? payload.nextState ?? payload.state, 'next_state', /^[A-Z]+$/);
    if (!MEDIA_PROFILE_STATES.has(nextState) || !MEDIA_PROFILE_TRANSITIONS[info.lifecycle_state]?.has(nextState)) {
      throw new CoreError('INVALID_STATE_TRANSITION', 'CONFLICT', 'errors.invalid_state_transition', { from: info.lifecycle_state, to: nextState }, { needsUser: true });
    }
    const currentApproved = nextState === 'APPROVED'
      ? this.db.prepare(`SELECT id FROM project_media_profile_revisions WHERE profile_id = ? AND lifecycle_state = 'APPROVED' AND id != ?`).get(info.profile_id, info.id)
      : null;
    const supersededRevisionId = currentApproved?.id ?? null;
    if (supersededRevisionId) this.db.prepare(`UPDATE project_media_profile_revisions SET lifecycle_state = 'SUPERSEDED', row_version = row_version + 1 WHERE id = ?`).run(supersededRevisionId);
    const nextVersion = Number(info.row_version) + 1;
    this.db.prepare('UPDATE project_media_profile_revisions SET lifecycle_state = ?, row_version = ? WHERE id = ?').run(nextState, nextVersion, info.id);
    const projection = this._mediaProfileProjection(info.profile_id);
    const aggregateVersion = Number(this.db.prepare(`SELECT COALESCE(MAX(aggregate_version), 0) + 1 AS version
      FROM domain_events WHERE aggregate_type = 'MEDIA_PROFILE' AND aggregate_id = ?`).get(info.profile_id).version);
    return {
      projectId: info.project_id,
      result: projection,
      event: { aggregateType: 'MEDIA_PROFILE', aggregateId: info.profile_id, aggregateVersion, eventType: `MEDIA_PROFILE_REVISION_${nextState}`, payload: { profile_id: info.profile_id, revision_id: info.id, lifecycle_state: nextState, superseded_revision_id: supersededRevisionId } },
      audit: { actionType: 'media_profile.revision.transition', targetType: 'MEDIA_PROFILE_REVISION', targetId: info.id, payload: { from: info.lifecycle_state, to: nextState, superseded_revision_id: supersededRevisionId } },
    };
  }

  _mediaProfileWorkspace(projectId) {
    const project = this._project(projectId);
    const profile = this.db.prepare('SELECT id FROM project_media_profiles WHERE project_id = ?').get(project.id);
    if (!profile) {
      return {
        project_id: project.id,
        profile: null,
        approved_revision: null,
        candidate_revisions: [],
        projection_seq: this._projectionSeq(),
        generated_at: new Date().toISOString(),
      };
    }
    return { project_id: project.id, ...this._mediaProfileProjection(profile.id) };
  }

  _timelineRational(payload, field, { required = true, allowZero = true } = {}) {
    const snake = field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    const camel = field.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = payload?.[field] ?? payload?.[camel] ?? payload?.[snake]
      ?? (payload && (payload[`${snake}_num`] !== undefined || payload[`${snake}_den`] !== undefined)
        ? { num: payload[`${snake}_num`], den: payload[`${snake}_den`] } : undefined);
    if (value === undefined || value === null) {
      if (!required) return null;
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.required_field', { field });
    }
    return normalizeRational(value, field, { allowZero });
  }

  _timelineClipInput(payload, index) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field: `tracks.clips[${index}]` });
    }
    const timelineIn = this._timelineRational(payload, 'timeline_in', { allowZero: true });
    const timelineOut = this._timelineRational(payload, 'timeline_out', { allowZero: false });
    if (rationalCompare(timelineOut, timelineIn) <= 0) {
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_time_interval', { field: 'timeline_out' });
    }
    const assetRevisionId = payload.asset_revision_id ?? payload.assetRevisionId ?? null;
    if (assetRevisionId !== null && (typeof assetRevisionId !== 'string' || assetRevisionId.trim().length === 0)) {
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field: 'asset_revision_id' });
    }
    const sourceIn = this._timelineRational(payload, 'source_in', { required: false, allowZero: true });
    const sourceOut = this._timelineRational(payload, 'source_out', { required: false, allowZero: false });
    if ((sourceIn === null) !== (sourceOut === null)) {
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field: 'source_in/source_out' });
    }
    if (assetRevisionId && sourceIn === null) {
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.required_field', { field: 'source_in/source_out' });
    }
    if (!assetRevisionId && sourceIn !== null) {
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field: 'asset_revision_id' });
    }
    if (sourceIn !== null && rationalCompare(sourceOut, sourceIn) <= 0) {
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_time_interval', { field: 'source_out' });
    }
    const speed = this._timelineRational(payload, 'speed', { required: false, allowZero: false }) ?? { num: 1, den: 1 };
    return {
      assetRevisionId: assetRevisionId?.trim() ?? null,
      sourceIn,
      sourceOut,
      timelineIn,
      timelineOut,
      speed,
    };
  }

  _normalizeTimelineTracks(payload) {
    const rawTracks = payload?.tracks === undefined || payload?.tracks === null ? [] : arrayValue(payload.tracks, 'tracks');
    if (rawTracks.length > MAX_TIMELINE_TRACKS) {
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.field_too_large', { field: 'tracks', max_items: MAX_TIMELINE_TRACKS });
    }
    const seenOrder = new Set();
    const tracks = rawTracks.map((rawTrack, trackIndex) => {
      if (!rawTrack || typeof rawTrack !== 'object' || Array.isArray(rawTrack)) {
        throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field: `tracks[${trackIndex}]` });
      }
      const trackType = enumValue(rawTrack.track_type ?? rawTrack.trackType ?? 'VIDEO', 'track_type', /^[A-Z]+$/);
      // Audio/caption/data semantics require their own contracts.  Keeping
      // this checkpoint slice video-only avoids silently inventing provider or
      // mixing behavior while retaining a provider-neutral track boundary.
      if (trackType !== 'VIDEO') {
        throw new CoreError('UNSUPPORTED_TIMELINE_TRACK', 'VALIDATION', 'errors.unsupported_timeline_track', { track_type: trackType }, { needsUser: true });
      }
      const orderIndex = boundedInteger(rawTrack.order_index ?? rawTrack.orderIndex ?? trackIndex, 'order_index', { min: 0, max: MAX_TIMELINE_TRACKS - 1 });
      if (seenOrder.has(orderIndex)) {
        throw new CoreError('DUPLICATE_TIMELINE_TRACK_ORDER', 'CONFLICT', 'errors.duplicate_timeline_track_order', { order_index: orderIndex });
      }
      seenOrder.add(orderIndex);
      const clips = rawTrack.clips === undefined || rawTrack.clips === null ? [] : arrayValue(rawTrack.clips, `tracks[${trackIndex}].clips`);
      if (clips.length > MAX_TIMELINE_CLIPS_PER_TRACK) {
        throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.field_too_large', { field: `tracks[${trackIndex}].clips`, max_items: MAX_TIMELINE_CLIPS_PER_TRACK });
      }
      const normalizedClips = clips.map((clip, clipIndex) => this._timelineClipInput(clip, clipIndex));
      normalizedClips.sort((left, right) => rationalCompare(left.timelineIn, right.timelineIn));
      for (let index = 1; index < normalizedClips.length; index += 1) {
        if (rationalCompare(normalizedClips[index - 1].timelineOut, normalizedClips[index].timelineIn) > 0) {
          throw new CoreError('TIMELINE_CLIP_OVERLAP', 'CONFLICT', 'errors.timeline_clip_overlap', { track_index: trackIndex, clip_index: index }, { needsUser: true });
        }
      }
      const enabled = nullableBoolean(rawTrack.enabled, 'enabled');
      return {
        trackType,
        orderIndex,
        name: optionalString(rawTrack.name, `tracks[${trackIndex}].name`, 200, `Video ${orderIndex + 1}`),
        enabled: enabled === null ? 1 : enabled,
        clips: normalizedClips,
      };
    });
    tracks.sort((left, right) => left.orderIndex - right.orderIndex);
    return tracks;
  }

  _normalizeTimelineMarkers(payload, duration) {
    const rawMarkers = payload?.markers === undefined || payload?.markers === null ? [] : arrayValue(payload.markers, 'markers');
    if (rawMarkers.length > MAX_TIMELINE_MARKERS) {
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.field_too_large', { field: 'markers', max_items: MAX_TIMELINE_MARKERS });
    }
    const markers = rawMarkers.map((rawMarker, markerIndex) => {
      if (!rawMarker || typeof rawMarker !== 'object' || Array.isArray(rawMarker)) {
        throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field: `markers[${markerIndex}]` });
      }
      const time = this._timelineRational(rawMarker, 'time', { allowZero: true });
      if (duration && rationalCompare(time, duration) > 0) {
        throw new CoreError('TIMELINE_MARKER_OUT_OF_BOUNDS', 'VALIDATION', 'errors.timeline_marker_out_of_bounds', { field: 'time' }, { needsUser: true });
      }
      return {
        time,
        markerType: enumValue(rawMarker.marker_type ?? rawMarker.markerType ?? rawMarker.type ?? 'NOTE', 'marker_type', /^[A-Z][A-Z0-9_.-]{0,63}$/),
        label: optionalString(rawMarker.label ?? rawMarker.name, `markers[${markerIndex}].label`, 300, ''),
        payload: structuredValue(rawMarker.payload ?? {}, `markers[${markerIndex}].payload`, {}, 'object', 32 * 1024),
      };
    });
    markers.sort((left, right) => rationalCompare(left.time, right.time));
    return markers;
  }

  _timelineAssetReadiness(assetRevisionId, projectId) {
    const id = requiredString(assetRevisionId, 'asset_revision_id');
    const row = this.db.prepare(`SELECT r.id, r.asset_id, r.availability_state, r.review_state, r.availability_evidence_state,
        a.project_id, a.lifecycle_state AS asset_lifecycle_state,
        so.storage_class, sol.state AS location_state
      FROM asset_revisions r
      JOIN assets a ON a.id = r.asset_id
      LEFT JOIN storage_objects so ON so.id = r.storage_object_id
      LEFT JOIN storage_object_locations sol ON sol.id = (
        SELECT location.id FROM storage_object_locations location
        WHERE location.storage_object_id = r.storage_object_id AND location.location_role = 'PRIMARY'
        ORDER BY CASE WHEN location.state = 'AVAILABLE' THEN 0 ELSE 1 END, location.id ASC LIMIT 1
      )
      WHERE r.id = ?`).get(id);
    if (!row) throw new CoreError('ASSET_REVISION_NOT_FOUND', 'VALIDATION', 'errors.asset_revision_not_found', { asset_revision_id: id });
    if (row.project_id !== projectId) {
      throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', {
        entity_type: 'ASSET_REVISION', entity_id: id, project_id: projectId, actual_project_id: row.project_id,
      }, { needsUser: true });
    }
    const rights = this._rightsForAsset(row.asset_id);
    if (!rights.eligible) {
      throw new CoreError('RIGHTS_BLOCKED', 'RIGHTS_BLOCKED', 'errors.timeline_asset_rights_blocked', { asset_revision_id: id }, {
        needsUser: true,
        technicalDetails: { rights_status: rights.status },
      });
    }
    const ready = row.asset_lifecycle_state !== 'TRASHED'
      && row.availability_state === 'AVAILABLE'
      && row.review_state === 'APPROVED'
      && row.availability_evidence_state === 'VERIFIED'
      && row.storage_class !== 'EXTERNAL_REFERENCE'
      && row.location_state === 'AVAILABLE';
    if (!ready) {
      throw new CoreError('TIMELINE_ASSET_NOT_READY', 'CONFLICT', 'errors.timeline_asset_not_ready', { asset_revision_id: id }, { needsUser: true });
    }
    return { asset_revision_id: id, asset_id: row.asset_id };
  }

  _timelineRevisionReadiness(revision, tracks) {
    const profile = this._mediaProfileRevision(revision.media_profile_revision_id);
    if (profile.lifecycle_state !== 'APPROVED') {
      return { state: 'UNKNOWN', nextStep: 'Duyệt Media Profile revision đang được timeline pin trước khi tiếp tục.' };
    }
    for (const track of tracks) {
      for (const clip of track.clips) {
        if (!clip.asset_revision_id) continue;
        try {
          this._timelineAssetReadiness(clip.asset_revision_id, revision.project_id);
        } catch (error) {
          return { state: 'UNKNOWN', nextStep: error.code === 'RIGHTS_BLOCKED'
            ? 'Bổ sung rights/consent hợp lệ cho asset trước khi approve timeline.'
            : 'Kiểm tra asset revision đã materialize, verify và review APPROVED trước khi approve timeline.' };
        }
      }
    }
    return { state: 'READY', nextStep: null };
  }

  _timelineRevisionProjection(revisionOrId) {
    const revision = typeof revisionOrId === 'string' ? this._timelineRevision(revisionOrId) : revisionOrId;
    const trackRows = this.db.prepare('SELECT * FROM timeline_tracks WHERE timeline_revision_id = ? ORDER BY order_index ASC, id ASC').all(revision.id);
    const tracks = trackRows.map((track) => {
      const clips = this.db.prepare('SELECT * FROM timeline_clip_instances WHERE track_id = ?').all(track.id)
        .sort((left, right) => rationalCompare({ num: Number(left.timeline_in_num), den: Number(left.timeline_in_den) }, { num: Number(right.timeline_in_num), den: Number(right.timeline_in_den) }) || String(left.id).localeCompare(String(right.id)));
      return publicTimelineTrack(track, clips);
    });
    const markerRows = this.db.prepare('SELECT * FROM timeline_markers WHERE timeline_revision_id = ?').all(revision.id)
      .sort((left, right) => rationalCompare({ num: Number(left.position_num), den: Number(left.position_den) }, { num: Number(right.position_num), den: Number(right.position_den) }) || String(left.id).localeCompare(String(right.id)));
    const readiness = this._timelineRevisionReadiness(revision, tracks);
    const revisionView = publicTimelineRevision(revision, tracks, { markers: markerRows.map(publicTimelineMarker).filter(Boolean), readinessState: readiness.state, nextStep: readiness.nextStep });
    const timeline = publicTimeline(this.db.prepare('SELECT * FROM timelines WHERE id = ?').get(revision.timeline_id));
    const mediaProfileRevision = publicMediaProfileRevision(this._mediaProfileRevision(revision.media_profile_revision_id));
    return {
      timeline,
      media_profile_revision: mediaProfileRevision,
      revision: revisionView,
      projection_seq: this._projectionSeq(),
      generated_at: new Date().toISOString(),
    };
  }

  _reviewSession(reviewSessionId) {
    const id = requiredString(reviewSessionId, 'review_session_id');
    const row = this.db.prepare('SELECT * FROM review_sessions WHERE id = ?').get(id);
    if (!row) throw new CoreError('REVIEW_SESSION_NOT_FOUND', 'VALIDATION', 'errors.review_session_not_found', { review_session_id: id });
    return row;
  }

  _reviewSubject(subjectType, subjectId) {
    const normalized = String(subjectType ?? '').trim().toUpperCase();
    if (!REVIEW_SUBJECT_TYPES.has(normalized)) {
      throw new CoreError('INVALID_REVIEW_SUBJECT', 'VALIDATION', 'errors.invalid_review_subject', { subject_type: normalized });
    }
    const revision = this._timelineRevision(subjectId);
    return { subjectType: normalized, revision };
  }

  _reviewSnapshot(revisionOrId) {
    const revision = typeof revisionOrId === 'string' ? this._timelineRevision(revisionOrId) : revisionOrId;
    const projection = this._timelineRevisionProjection(revision);
    const assets = [];
    for (const track of projection.revision.tracks ?? []) {
      for (const clip of track.clips ?? []) {
        if (!clip.asset_revision_id) continue;
        const asset = this.db.prepare(`SELECT r.id, r.asset_id, r.availability_state, r.review_state,
            r.availability_evidence_state, a.lifecycle_state AS asset_lifecycle_state,
            so.storage_class, sol.state AS location_state
          FROM asset_revisions r
          JOIN assets a ON a.id = r.asset_id
          LEFT JOIN storage_objects so ON so.id = r.storage_object_id
          LEFT JOIN storage_object_locations sol ON sol.id = (
            SELECT location.id FROM storage_object_locations location
            WHERE location.storage_object_id = r.storage_object_id AND location.location_role = 'PRIMARY'
            ORDER BY CASE WHEN location.state = 'AVAILABLE' THEN 0 ELSE 1 END, location.id ASC LIMIT 1
          ) WHERE r.id = ?`).get(clip.asset_revision_id);
        const rights = asset ? this._rightsForAsset(asset.asset_id) : { status: 'UNKNOWN', eligible: false };
        assets.push({
          asset_revision_id: clip.asset_revision_id,
          availability_state: asset?.availability_state ?? 'UNKNOWN',
          review_state: asset?.review_state ?? 'UNKNOWN',
          availability_evidence_state: asset?.availability_evidence_state ?? 'UNKNOWN',
          asset_lifecycle_state: asset?.asset_lifecycle_state ?? 'UNKNOWN',
          storage_class: asset?.storage_class ?? 'UNKNOWN',
          location_state: asset?.location_state ?? 'UNKNOWN',
          rights_status: rights.status ?? 'UNKNOWN',
          rights_eligible: Boolean(rights.eligible),
        });
      }
    }
    assets.sort((left, right) => left.asset_revision_id.localeCompare(right.asset_revision_id));
    const snapshot = {
      project_id: revision.project_id,
      timeline_id: revision.timeline_id,
      timeline_revision_id: revision.id,
      subject_content_hash: revision.content_hash,
      media_profile_revision_id: revision.media_profile_revision_id,
      assets,
      readiness_state: projection.revision.readiness_state,
    };
    const hash = crypto.createHash('sha256').update(canonicalJson(snapshot)).digest('hex');
    return { hash, snapshot, projection };
  }

  _reviewProjection(sessionOrId, options = {}) {
    const session = typeof sessionOrId === 'string' ? this._reviewSession(sessionOrId) : sessionOrId;
    const revision = this._timelineRevision(session.subject_revision_id);
    const current = this._reviewSnapshot(revision);
    const stale = current.hash !== session.dependency_snapshot_hash
      || revision.content_hash !== session.subject_content_hash
      || revision.lifecycle_state === 'SUPERSEDED';
    const review = this.db.prepare('SELECT * FROM human_reviews WHERE review_session_id = ?').get(session.id);
    const nextStep = stale
      ? 'Mở một review mới cho checkpoint hiện tại; review cũ không còn đủ điều kiện approve.'
      : session.state === 'SUBMITTED'
        ? review?.decision === 'APPROVE'
          ? 'Có thể approve timeline bằng review này nếu revision vẫn ở CANDIDATE.'
          : 'Review đã gửi; tạo checkpoint mới hoặc xử lý theo quyết định đã ghi.'
        : 'Chọn quyết định và gửi review khi đã kiểm tra checkpoint.';
    return {
      review: publicReviewSession(session, review, { stale, nextStep }),
      subject: current.projection.revision,
      timeline: current.projection.timeline,
      media_profile_revision: current.projection.media_profile_revision,
      snapshot: { hash: session.dependency_snapshot_hash, current_hash: current.hash, stale },
      projection_seq: this._projectionSeq(),
      generated_at: new Date().toISOString(),
      ...options,
    };
  }

  _reviewExpectedVersion(payload, expectedVersions, session) {
    let expected = payload.expected_review_version ?? payload.expectedReviewVersion;
    if (expected === undefined || expected === null) {
      for (const key of ['REVIEW_SESSION', 'REVIEW', 'review_session', 'review', session.id]) {
        if (Object.prototype.hasOwnProperty.call(expectedVersions ?? {}, key)) {
          expected = expectedVersions[key];
          break;
        }
      }
    }
    if (expected === undefined || expected === null) {
      throw new CoreError('EXPECTED_VERSION_REQUIRED', 'CONFLICT', 'errors.expected_review_version_required', { review_session_id: session.id }, { needsUser: true });
    }
    const numeric = Number(expected);
    if (!Number.isSafeInteger(numeric) || numeric < 1) {
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_review_version', { review_session_id: session.id });
    }
    if (numeric !== Number(session.row_version)) {
      throw new CoreError('STALE_REVIEW', 'CONFLICT', 'errors.stale_review', { review_session_id: session.id, expected: numeric, current: Number(session.row_version) }, { needsUser: true });
    }
  }

  _openReview(payload, expectedVersions) {
    const subjectType = String(payload.subject_type ?? payload.subjectType ?? 'TIMELINE_REVISION').trim().toUpperCase();
    const subjectId = payload.subject_revision_id ?? payload.subjectRevisionId ?? payload.subject_id ?? payload.subjectId ?? payload.timeline_revision_id ?? payload.timelineRevisionId;
    const { revision } = this._reviewSubject(subjectType, subjectId);
    this._assertPayloadProjectScope(payload, revision.project_id, 'TIMELINE_REVISION', revision.id);
    const project = this._project(revision.project_id);
    this._assertProjectWritable(project);
    if (!['DRAFT_CHECKPOINT', 'CANDIDATE'].includes(revision.lifecycle_state)) {
      throw new CoreError('REVIEW_SUBJECT_NOT_REVIEWABLE', 'CONFLICT', 'errors.review_subject_not_reviewable', { state: revision.lifecycle_state }, { needsUser: true });
    }
    this._expectedVersion(expectedVersions, 'REVISION', revision.id, revision.row_version);
    const active = this.db.prepare(`SELECT id FROM review_sessions
      WHERE subject_type = ? AND subject_id = ? AND state IN ('OPEN', 'IN_PROGRESS') LIMIT 1`).get(subjectType, revision.id);
    if (active) throw new CoreError('REVIEW_ALREADY_OPEN', 'CONFLICT', 'errors.review_already_open', { review_session_id: active.id }, { needsUser: true });
    const snapshot = this._reviewSnapshot(revision);
    const sessionId = uuidv7();
    const opened = nowUtcUs();
    this.db.prepare(`INSERT INTO review_sessions
      (id, project_id, subject_type, subject_id, subject_revision_id,
       representation_asset_revision_id, dependency_snapshot_hash, subject_content_hash,
       media_profile_revision_id, state, reviewer_actor_id, opened_at_utc_us, row_version)
      VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, 'OPEN', ?, ?, 1)`).run(
      sessionId, project.id, subjectType, revision.id, revision.id, snapshot.hash,
      revision.content_hash, revision.media_profile_revision_id, this.actorId, opened,
    );
    const session = this.db.prepare('SELECT * FROM review_sessions WHERE id = ?').get(sessionId);
    const projection = this._reviewProjection(session);
    return {
      projectId: project.id,
      result: projection,
      event: { aggregateType: 'REVIEW_SESSION', aggregateId: sessionId, aggregateVersion: 1, eventType: 'REVIEW_OPENED', payload: { review_session_id: sessionId, project_id: project.id, subject_type: subjectType, subject_revision_id: revision.id, subject_content_hash: revision.content_hash, dependency_snapshot_hash: snapshot.hash } },
      audit: { actionType: 'review.open', targetType: 'REVIEW_SESSION', targetId: sessionId, payload: { project_id: project.id, subject_type: subjectType, subject_revision_id: revision.id, dependency_snapshot_hash: snapshot.hash } },
    };
  }

  _submitReview(payload, expectedVersions) {
    const session = this._reviewSession(payload.review_session_id ?? payload.reviewSessionId ?? payload.id);
    this._assertPayloadProjectScope(payload, session.project_id, 'REVIEW_SESSION', session.id);
    const project = this._project(session.project_id);
    this._assertProjectWritable(project);
    this._reviewExpectedVersion(payload, expectedVersions, session);
    if (!['OPEN', 'IN_PROGRESS'].includes(session.state)) {
      throw new CoreError('REVIEW_DECISION_IMMUTABLE', 'CONFLICT', 'errors.review_decision_immutable', { review_session_id: session.id }, { needsUser: true });
    }
    const revision = this._timelineRevision(session.subject_revision_id);
    const current = this._reviewSnapshot(revision);
    if (current.hash !== session.dependency_snapshot_hash || revision.content_hash !== session.subject_content_hash) {
      throw new CoreError('STALE_REVIEW', 'CONFLICT', 'errors.stale_review', { review_session_id: session.id }, { needsUser: true, technicalDetails: { expected_snapshot_hash: session.dependency_snapshot_hash, current_snapshot_hash: current.hash } });
    }
    if (revision.lifecycle_state === 'SUPERSEDED' || revision.lifecycle_state === 'APPROVED') {
      throw new CoreError('STALE_REVIEW', 'CONFLICT', 'errors.stale_review', { review_session_id: session.id, state: revision.lifecycle_state }, { needsUser: true });
    }
    const decision = String(payload.decision ?? '').trim().toUpperCase();
    if (!REVIEW_DECISIONS.has(decision)) throw new CoreError('INVALID_REVIEW_DECISION', 'VALIDATION', 'errors.invalid_review_decision', { decision });
    if (decision === 'APPROVE' && current.projection.revision.readiness_state !== 'READY') {
      throw new CoreError('REVIEW_NOT_READY', 'CONFLICT', 'errors.review_not_ready', { review_session_id: session.id }, { needsUser: true, technicalDetails: { next_step: current.projection.revision.next_step } });
    }
    const notes = optionalString(payload.notes, 'notes', 8000, '');
    const reasonCodes = normalizeStringArray(payload.reason_codes ?? payload.reasonCodes ?? [], 'reason_codes', 32, 80);
    const reviewId = uuidv7();
    const reviewed = nowUtcUs();
    this.db.prepare(`INSERT INTO human_reviews
      (id, review_session_id, decision, notes, reason_codes_json, dependency_snapshot_hash,
       subject_content_hash, reviewer_actor_id, reviewed_at_utc_us)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      reviewId, session.id, decision, notes, json(reasonCodes), session.dependency_snapshot_hash,
      session.subject_content_hash, this.actorId, reviewed,
    );
    const nextVersion = Number(session.row_version) + 1;
    this.db.prepare(`UPDATE review_sessions SET state = 'SUBMITTED', submitted_at_utc_us = ?, row_version = ? WHERE id = ?`)
      .run(reviewed, nextVersion, session.id);
    const next = this.db.prepare('SELECT * FROM review_sessions WHERE id = ?').get(session.id);
    const projection = this._reviewProjection(next);
    return {
      projectId: project.id,
      result: projection,
      event: { aggregateType: 'REVIEW_SESSION', aggregateId: session.id, aggregateVersion: nextVersion, eventType: 'REVIEW_SUBMITTED', payload: { review_session_id: session.id, human_review_id: reviewId, project_id: project.id, subject_revision_id: revision.id, decision, dependency_snapshot_hash: session.dependency_snapshot_hash } },
      audit: { actionType: 'review.submit', targetType: 'REVIEW_SESSION', targetId: session.id, payload: { project_id: project.id, human_review_id: reviewId, decision, dependency_snapshot_hash: session.dependency_snapshot_hash } },
    };
  }

  _reviewList(params = {}) {
    const projectId = params.project_id ?? params.projectId ?? null;
    if (projectId) this._project(projectId);
    const stateInput = params.state ?? null;
    const state = stateInput === null || stateInput === '' ? null : String(stateInput).trim().toUpperCase();
    if (state !== null && !REVIEW_STATES.has(state) && state !== 'STALE') throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_review_state', { state });
    const limit = Math.min(Math.max(asInt(params.limit, 100), 1), 200);
    const rows = this.db.prepare(`SELECT * FROM review_sessions
      WHERE (? IS NULL OR project_id = ?) AND (? IS NULL OR state = ?)
      ORDER BY opened_at_utc_us DESC, id DESC LIMIT ?`).all(projectId, projectId, state === 'STALE' ? null : state, state === 'STALE' ? null : state, limit);
    const items = rows.map((row) => this._reviewProjection(row).review)
      .filter((item) => state !== 'STALE' || item.stale);
    return { items, projection_seq: this._projectionSeq(), generated_at: new Date().toISOString() };
  }

  _createTimeline(payload) {
    const project = this._project(payload.project_id ?? payload.projectId);
    this._assertProjectWritable(project);
    const scopeType = enumValue(payload.scope_type ?? payload.scopeType ?? 'PROJECT', 'scope_type', /^[A-Z]+$/);
    if (scopeType !== 'PROJECT') throw new CoreError('UNSUPPORTED_TIMELINE_SCOPE', 'VALIDATION', 'errors.unsupported_timeline_scope', { scope_type: scopeType }, { needsUser: true });
    const scopeId = payload.scope_id ?? payload.scopeId ?? project.id;
    if (scopeId !== project.id) throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', { entity_type: 'PROJECT', entity_id: scopeId, project_id: project.id }, { needsUser: true });
    const profileRevisionId = payload.media_profile_revision_id ?? payload.mediaProfileRevisionId;
    const profileRevision = this._mediaProfileRevision(profileRevisionId);
    if (profileRevision.project_id !== project.id) throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', { entity_type: 'MEDIA_PROFILE_REVISION', entity_id: profileRevision.id, project_id: project.id, actual_project_id: profileRevision.project_id }, { needsUser: true });
    if (profileRevision.lifecycle_state !== 'APPROVED') throw new CoreError('MEDIA_PROFILE_NOT_APPROVED', 'CONFLICT', 'errors.media_profile_not_approved', { media_profile_revision_id: profileRevision.id }, { needsUser: true });
    const code = requiredString(payload.code, 'code', 64).toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(code)) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_timeline_code', {});
    if (this.db.prepare('SELECT id FROM timelines WHERE project_id = ? AND code = ?').get(project.id, code)) {
      throw new CoreError('DUPLICATE_TIMELINE_CODE', 'CONFLICT', 'errors.duplicate_timeline_code', { code }, { needsUser: true });
    }
    const title = requiredString(payload.title, 'title', 300);
    const timelineId = uuidv7();
    const created = nowUtcUs();
    this.db.prepare(`INSERT INTO timelines
      (id, project_id, scope_type, scope_id, code, title, lifecycle_state, created_by_actor_id, created_at_utc_us, updated_at_utc_us, row_version)
      VALUES (?, ?, 'PROJECT', ?, ?, ?, 'ACTIVE', ?, ?, ?, 1)`).run(timelineId, project.id, project.id, code, title, this.actorId, created, created);
    const timeline = publicTimeline(this.db.prepare('SELECT * FROM timelines WHERE id = ?').get(timelineId));
    return {
      projectId: project.id,
      result: { timeline, media_profile_revision: publicMediaProfileRevision(profileRevision) },
      event: { aggregateType: 'TIMELINE', aggregateId: timelineId, aggregateVersion: 1, eventType: 'TIMELINE_CREATED', payload: { timeline_id: timelineId, project_id: project.id, code, media_profile_revision_id: profileRevision.id } },
      audit: { actionType: 'timeline.create', targetType: 'TIMELINE', targetId: timelineId, payload: { project_id: project.id, code, media_profile_revision_id: profileRevision.id } },
    };
  }

  _createTimelineRevision(payload, expectedVersions) {
    const timeline = this._timeline(payload.timeline_id ?? payload.timelineId);
    this._assertPayloadProjectScope(payload, timeline.project_id, 'TIMELINE', timeline.id);
    const project = this._project(timeline.project_id);
    this._assertProjectWritable(project);
    if (timeline.lifecycle_state !== 'ACTIVE') throw new CoreError('TIMELINE_NOT_WRITABLE', 'CONFLICT', 'errors.timeline_not_writable', { state: timeline.lifecycle_state }, { needsUser: true });
    this._expectedVersion(expectedVersions, 'TIMELINE', timeline.id, timeline.row_version);
    const profileRevisionId = payload.media_profile_revision_id ?? payload.mediaProfileRevisionId;
    const profileRevision = this._mediaProfileRevision(profileRevisionId);
    if (profileRevision.project_id !== project.id) throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', { entity_type: 'MEDIA_PROFILE_REVISION', entity_id: profileRevision.id, project_id: project.id, actual_project_id: profileRevision.project_id }, { needsUser: true });
    if (profileRevision.lifecycle_state !== 'APPROVED') throw new CoreError('MEDIA_PROFILE_NOT_APPROVED', 'CONFLICT', 'errors.media_profile_not_approved', { media_profile_revision_id: profileRevision.id }, { needsUser: true });
    const tracks = this._normalizeTimelineTracks(payload);
    const duration = this._timelineRational(payload, 'duration', { allowZero: false });
    if (duration.num > MAX_TIMELINE_DURATION_TICKS) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field: 'duration' });
    const markers = this._normalizeTimelineMarkers(payload, duration);
    for (const track of tracks) {
      for (const clip of track.clips) {
        if (rationalCompare(clip.timelineOut, duration) > 0) throw new CoreError('TIMELINE_CLIP_OUT_OF_BOUNDS', 'VALIDATION', 'errors.timeline_clip_out_of_bounds', { field: 'timeline_out' }, { needsUser: true });
        if (clip.assetRevisionId) this._timelineAssetReadiness(clip.assetRevisionId, project.id);
      }
    }
    const content = {
      media_profile_revision_id: profileRevision.id,
      duration,
      tracks: tracks.map((track) => ({
        track_type: track.trackType,
        order_index: track.orderIndex,
        name: track.name,
        enabled: Boolean(track.enabled),
        clips: track.clips.map((clip) => ({
          asset_revision_id: clip.assetRevisionId,
          source_in: clip.sourceIn,
          source_out: clip.sourceOut,
          timeline_in: clip.timelineIn,
          timeline_out: clip.timelineOut,
          speed: clip.speed,
        })),
      })),
      markers,
    };
    const contentHash = crypto.createHash('sha256').update(canonicalJson(content)).digest('hex');
    const latest = this.db.prepare('SELECT COALESCE(MAX(revision_number), 0) AS revision_number FROM timeline_revisions WHERE timeline_id = ?').get(timeline.id);
    const revisionId = uuidv7();
    const revisionNumber = Number(latest.revision_number) + 1;
    const created = nowUtcUs();
    this.db.prepare(`INSERT INTO timeline_revisions
      (id, timeline_id, media_profile_revision_id, revision_number, lifecycle_state, duration_num, duration_den, content_hash, created_by_actor_id, created_at_utc_us, row_version)
      VALUES (?, ?, ?, ?, 'DRAFT_CHECKPOINT', ?, ?, ?, ?, ?, 1)`).run(
      revisionId, timeline.id, profileRevision.id, revisionNumber, duration.num, duration.den, contentHash, this.actorId, created,
    );
    for (const track of tracks) {
      const trackId = uuidv7();
      this.db.prepare(`INSERT INTO timeline_tracks(id, timeline_revision_id, track_type, order_index, name, enabled, created_at_utc_us)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(trackId, revisionId, track.trackType, track.orderIndex, track.name, track.enabled, created);
      for (const clip of track.clips) {
        this.db.prepare(`INSERT INTO timeline_clip_instances
          (id, track_id, asset_revision_id, source_in_num, source_in_den, source_out_num, source_out_den,
           timeline_in_num, timeline_in_den, timeline_out_num, timeline_out_den, speed_num, speed_den, created_at_utc_us)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          uuidv7(), trackId, clip.assetRevisionId,
          clip.sourceIn?.num ?? null, clip.sourceIn?.den ?? null, clip.sourceOut?.num ?? null, clip.sourceOut?.den ?? null,
          clip.timelineIn.num, clip.timelineIn.den, clip.timelineOut.num, clip.timelineOut.den, clip.speed.num, clip.speed.den, created,
        );
      }
    }
    for (const marker of markers) {
      this.db.prepare(`INSERT INTO timeline_markers
        (id, timeline_revision_id, position_num, position_den, marker_type, label, payload_json, created_at_utc_us)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        uuidv7(), revisionId, marker.time.num, marker.time.den, marker.markerType, marker.label, json(marker.payload), created,
      );
    }
    const timelineVersion = Number(timeline.row_version) + 1;
    this.db.prepare('UPDATE timelines SET updated_at_utc_us = ?, row_version = ? WHERE id = ?').run(nowUtcUs(), timelineVersion, timeline.id);
    const projection = this._timelineRevisionProjection(revisionId);
    return {
      projectId: project.id,
      result: projection,
      event: { aggregateType: 'TIMELINE', aggregateId: timeline.id, aggregateVersion: timelineVersion, eventType: 'TIMELINE_REVISION_CREATED', payload: { timeline_id: timeline.id, timeline_revision_id: revisionId, revision_number: revisionNumber, content_hash: contentHash } },
      audit: { actionType: 'timeline.revision.create', targetType: 'TIMELINE_REVISION', targetId: revisionId, payload: { timeline_id: timeline.id, project_id: project.id, revision_number: revisionNumber, content_hash: contentHash } },
    };
  }

  _transitionTimelineRevision(payload, expectedVersions) {
    const info = this._timelineRevision(payload.timeline_revision_id ?? payload.timelineRevisionId ?? payload.revision_id ?? payload.revisionId);
    this._assertPayloadProjectScope(payload, info.project_id, 'TIMELINE_REVISION', info.id);
    const project = this._project(info.project_id);
    this._assertProjectWritable(project);
    const timeline = this._timeline(info.timeline_id);
    if (timeline.lifecycle_state !== 'ACTIVE') throw new CoreError('TIMELINE_NOT_WRITABLE', 'CONFLICT', 'errors.timeline_not_writable', { state: timeline.lifecycle_state }, { needsUser: true });
    this._expectedVersion(expectedVersions, 'REVISION', info.id, info.row_version);
    const nextState = enumValue(payload.next_state ?? payload.nextState ?? payload.state, 'next_state', /^[A-Z_]+$/);
    if (!TIMELINE_REVISION_STATES.has(nextState) || !TIMELINE_REVISION_TRANSITIONS[info.lifecycle_state]?.has(nextState)) {
      throw new CoreError('INVALID_STATE_TRANSITION', 'CONFLICT', 'errors.invalid_state_transition', { from: info.lifecycle_state, to: nextState }, { needsUser: true });
    }
    const profile = this._mediaProfileRevision(info.media_profile_revision_id);
    if (nextState === 'APPROVED') {
      const reviewSessionId = payload.review_session_id ?? payload.reviewSessionId;
      if (!reviewSessionId) {
        throw new CoreError('REVIEW_REQUIRED_FOR_APPROVAL', 'CONFLICT', 'errors.review_required_for_approval', { timeline_revision_id: info.id }, { needsUser: true });
      }
      const reviewSession = this._reviewSession(reviewSessionId);
      if (reviewSession.project_id !== info.project_id || reviewSession.subject_type !== 'TIMELINE_REVISION' || reviewSession.subject_revision_id !== info.id) {
        throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.review_scope_mismatch', { review_session_id: reviewSession.id, timeline_revision_id: info.id }, { needsUser: true });
      }
      if (reviewSession.state !== 'SUBMITTED') {
        throw new CoreError('REVIEW_NOT_SUBMITTED', 'CONFLICT', 'errors.review_not_submitted', { review_session_id: reviewSession.id }, { needsUser: true });
      }
      const submittedReview = this.db.prepare('SELECT * FROM human_reviews WHERE review_session_id = ?').get(reviewSession.id);
      if (!submittedReview || submittedReview.decision !== 'APPROVE') {
        throw new CoreError('REVIEW_APPROVAL_REQUIRED', 'CONFLICT', 'errors.review_approval_required', { review_session_id: reviewSession.id }, { needsUser: true });
      }
      const currentSnapshot = this._reviewSnapshot(info);
      const suppliedSnapshot = payload.dependency_snapshot_hash ?? payload.dependencySnapshotHash;
      if (suppliedSnapshot === undefined || suppliedSnapshot === null || String(suppliedSnapshot).trim() === '') {
        throw new CoreError('REVIEW_SNAPSHOT_REQUIRED', 'CONFLICT', 'errors.review_snapshot_required', { review_session_id: reviewSession.id }, { needsUser: true });
      }
      const suppliedSnapshotText = String(suppliedSnapshot).trim();
      if (!/^[0-9a-f]{64}$/i.test(suppliedSnapshotText)) {
        throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_review_snapshot_hash', { review_session_id: reviewSession.id });
      }
      if (suppliedSnapshotText.toLowerCase() !== reviewSession.dependency_snapshot_hash.toLowerCase()
        || currentSnapshot.hash !== reviewSession.dependency_snapshot_hash
        || submittedReview.dependency_snapshot_hash !== reviewSession.dependency_snapshot_hash
        || submittedReview.subject_content_hash !== info.content_hash) {
        throw new CoreError('STALE_REVIEW', 'CONFLICT', 'errors.stale_review', { review_session_id: reviewSession.id }, { needsUser: true, technicalDetails: { expected_snapshot_hash: reviewSession.dependency_snapshot_hash, current_snapshot_hash: currentSnapshot.hash } });
      }
      if (profile.lifecycle_state !== 'APPROVED') throw new CoreError('MEDIA_PROFILE_NOT_APPROVED', 'CONFLICT', 'errors.media_profile_not_approved', { media_profile_revision_id: profile.id }, { needsUser: true });
      const tracks = this.db.prepare('SELECT * FROM timeline_tracks WHERE timeline_revision_id = ? ORDER BY order_index ASC, id ASC').all(info.id);
      for (const track of tracks) {
        const clips = this.db.prepare('SELECT * FROM timeline_clip_instances WHERE track_id = ? ORDER BY id ASC').all(track.id);
        for (const clip of clips) if (clip.asset_revision_id) this._timelineAssetReadiness(clip.asset_revision_id, info.project_id);
      }
    }
    const currentApproved = nextState === 'APPROVED'
      ? this.db.prepare(`SELECT id FROM timeline_revisions WHERE timeline_id = ? AND lifecycle_state = 'APPROVED' AND id != ?`).get(info.timeline_id, info.id)
      : null;
    const supersededRevisionId = currentApproved?.id ?? null;
    if (supersededRevisionId) this.db.prepare(`UPDATE timeline_revisions SET lifecycle_state = 'SUPERSEDED', row_version = row_version + 1 WHERE id = ?`).run(supersededRevisionId);
    const nextVersion = Number(info.row_version) + 1;
    this.db.prepare('UPDATE timeline_revisions SET lifecycle_state = ?, row_version = ? WHERE id = ?').run(nextState, nextVersion, info.id);
    const timelineVersion = Number(timeline.row_version) + 1;
    this.db.prepare('UPDATE timelines SET updated_at_utc_us = ?, row_version = ? WHERE id = ?').run(nowUtcUs(), timelineVersion, timeline.id);
    const projection = this._timelineRevisionProjection(info.id);
    return {
      projectId: info.project_id,
      result: { ...projection, superseded_revision_id: supersededRevisionId },
      event: { aggregateType: 'TIMELINE', aggregateId: timeline.id, aggregateVersion: timelineVersion, eventType: `TIMELINE_REVISION_${nextState}`, payload: { timeline_id: timeline.id, timeline_revision_id: info.id, lifecycle_state: nextState, superseded_revision_id: supersededRevisionId } },
      audit: { actionType: 'timeline.revision.transition', targetType: 'TIMELINE_REVISION', targetId: info.id, payload: { timeline_id: timeline.id, from: info.lifecycle_state, to: nextState, superseded_revision_id: supersededRevisionId } },
    };
  }

  _timelineList(params = {}) {
    const projectId = params.project_id ?? params.projectId ?? null;
    if (projectId) this._project(projectId);
    const includeTrashed = Boolean(params.include_trashed ?? params.includeTrashed);
    const limit = Math.min(Math.max(asInt(params.limit, 100), 1), 200);
    const rows = projectId
      ? this.db.prepare(`SELECT * FROM timelines WHERE project_id = ? AND (? = 1 OR lifecycle_state != 'TRASHED') ORDER BY created_at_utc_us DESC, id DESC LIMIT ?`).all(projectId, includeTrashed ? 1 : 0, limit)
      : this.db.prepare(`SELECT * FROM timelines WHERE (? = 1 OR lifecycle_state != 'TRASHED') ORDER BY created_at_utc_us DESC, id DESC LIMIT ?`).all(includeTrashed ? 1 : 0, limit);
    const timelines = rows.map((row) => {
      const revisions = this.db.prepare('SELECT * FROM timeline_revisions WHERE timeline_id = ? ORDER BY revision_number DESC').all(row.id);
      const summaries = revisions.map((revision) => {
        const tracks = this.db.prepare('SELECT * FROM timeline_tracks WHERE timeline_revision_id = ? ORDER BY order_index ASC, id ASC').all(revision.id).map((track) => publicTimelineTrack(track, this.db.prepare('SELECT * FROM timeline_clip_instances WHERE track_id = ? ORDER BY id ASC').all(track.id)));
        const readiness = this._timelineRevisionReadiness(revision, tracks);
        return publicTimelineRevision(revision, [], { readinessState: readiness.state, nextStep: readiness.nextStep });
      });
      return { ...publicTimeline(row), approved_revision: summaries.find((revision) => revision.lifecycle_state === 'APPROVED') ?? null, candidate_revisions: summaries.filter((revision) => ['DRAFT_CHECKPOINT', 'CANDIDATE'].includes(revision.lifecycle_state)) };
    });
    return { timelines, projection_seq: this._projectionSeq(), generated_at: new Date().toISOString() };
  }

  _timelineWorkspace(timelineId, requestedProjectId = null) {
    const timeline = this._timeline(timelineId);
    if (requestedProjectId !== null && requestedProjectId !== undefined && requestedProjectId !== timeline.project_id) {
      throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', { entity_type: 'TIMELINE', entity_id: timeline.id, project_id: requestedProjectId, actual_project_id: timeline.project_id }, { needsUser: true });
    }
    const revisions = this.db.prepare('SELECT * FROM timeline_revisions WHERE timeline_id = ? ORDER BY revision_number DESC').all(timeline.id);
    const projections = revisions.map((revision) => this._timelineRevisionProjection(revision.id));
    const profileRevisionId = revisions[0]?.media_profile_revision_id ?? null;
    return {
      timeline: publicTimeline(timeline),
      media_profile_revision: profileRevisionId ? publicMediaProfileRevision(this._mediaProfileRevision(profileRevisionId)) : null,
      revisions: projections.map((projection) => projection.revision),
      approved_revision: projections.find((projection) => projection.revision.lifecycle_state === 'APPROVED')?.revision ?? null,
      candidate_revisions: projections.filter((projection) => ['DRAFT_CHECKPOINT', 'CANDIDATE'].includes(projection.revision.lifecycle_state)).map((projection) => projection.revision),
      projection_seq: this._projectionSeq(),
      generated_at: new Date().toISOString(),
    };
  }

  _createTask(payload) {
    const project = this._project(payload.project_id ?? payload.projectId);
    this._assertProjectWritable(project);
    const title = requiredString(payload.title, 'title');
    const description = optionalString(payload.description, 'description');
    const status = payload.status ?? 'PLANNED';
    if (!TASK_STATES.has(status)) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_task_status', { status });
    const priority = asInt(payload.priority, 0);
    if (priority < -1000 || priority > 1000) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_priority', {});
    const taskId = uuidv7();
    const created = nowUtcUs();
    this.db.prepare(`INSERT INTO tasks
      (id, project_id, title, description, status, priority, created_by_actor_id, created_at_utc_us, updated_at_utc_us)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(taskId, project.id, title, description, status, priority, this.actorId, created, created);
    const task = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    return {
      projectId: project.id,
      task: publicTask(task),
      result: publicTask(task),
      event: { aggregateType: 'TASK', aggregateId: taskId, aggregateVersion: 1, eventType: 'TASK_CREATED', payload: publicTask(task) },
      audit: { actionType: 'task.create', targetType: 'TASK', targetId: taskId, payload: { project_id: project.id } },
    };
  }

  _updateTask(payload, expectedVersions) {
    const taskId = payload.task_id ?? payload.taskId;
    const current = this._task(taskId);
    this._expectedVersion(expectedVersions, 'TASK', taskId, current.row_version);
    const project = this._project(current.project_id);
    this._assertPayloadProjectScope(payload, project.id, 'TASK', taskId);
    this._assertProjectWritable(project);
    const title = payload.title === undefined ? current.title : requiredString(payload.title, 'title');
    const description = payload.description === undefined ? current.description : optionalString(payload.description, 'description');
    const status = payload.status === undefined ? current.status : payload.status;
    if (!TASK_STATES.has(status)) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_task_status', { status });
    if (status !== current.status && !TASK_TRANSITIONS[current.status]?.has(status)) {
      throw new CoreError('INVALID_STATE_TRANSITION', 'CONFLICT', 'errors.invalid_state_transition', {
        entity_type: 'TASK', entity_id: taskId, from: current.status, to: status,
      }, { needsUser: true });
    }
    const priority = payload.priority === undefined ? current.priority : asInt(payload.priority, NaN);
    if (!Number.isSafeInteger(priority) || priority < -1000 || priority > 1000) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_priority', {});
    const version = Number(current.row_version) + 1;
    this.db.prepare(`UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?,
      updated_at_utc_us = ?, row_version = ? WHERE id = ?`).run(title, description, status, priority, nowUtcUs(), version, taskId);
    const task = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    return {
      projectId: project.id,
      task: publicTask(task),
      result: publicTask(task),
      event: { aggregateType: 'TASK', aggregateId: taskId, aggregateVersion: version, eventType: 'TASK_UPDATED', payload: publicTask(task) },
      audit: { actionType: 'task.update', targetType: 'TASK', targetId: taskId, payload: { row_version: version } },
    };
  }

  _createShot(payload) {
    const project = this._project(payload.project_id ?? payload.projectId);
    this._assertProjectWritable(project);
    const title = requiredString(payload.title, 'title');
    const code = requiredString(payload.code, 'code', 64).toUpperCase();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(code)) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_shot_code', {});
    if (this.db.prepare('SELECT id FROM shots WHERE project_id = ? AND code = ?').get(project.id, code)) {
      throw new CoreError('DUPLICATE_SHOT_CODE', 'CONFLICT', 'errors.duplicate_shot_code', { code });
    }
    const shotId = uuidv7();
    const created = nowUtcUs();
    this.db.prepare(`INSERT INTO shots
      (id, project_id, code, title, lifecycle_state, created_by_actor_id, created_at_utc_us, updated_at_utc_us)
      VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`).run(shotId, project.id, code, title, this.actorId, created, created);
    const shot = this.db.prepare('SELECT * FROM shots WHERE id = ?').get(shotId);
    return {
      projectId: project.id,
      shot: publicShot(shot),
      result: publicShot(shot),
      event: { aggregateType: 'SHOT', aggregateId: shotId, aggregateVersion: 1, eventType: 'SHOT_CREATED', payload: publicShot(shot) },
      audit: { actionType: 'shot.create', targetType: 'SHOT', targetId: shotId, payload: { project_id: project.id, code } },
    };
  }

  _updateShot(payload, expectedVersions) {
    const shotId = payload.shot_id ?? payload.shotId;
    const current = this._shot(shotId);
    this._expectedVersion(expectedVersions, 'SHOT', shotId, current.row_version);
    const project = this._project(current.project_id);
    this._assertPayloadProjectScope(payload, project.id, 'SHOT', shotId);
    this._assertProjectWritable(project);
    const title = payload.title === undefined ? current.title : requiredString(payload.title, 'title');
    const state = payload.lifecycle_state ?? payload.lifecycleState ?? current.lifecycle_state;
    if (!SHOT_STATES.has(state)) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_shot_state', { state });
    if (state !== current.lifecycle_state && !SHOT_TRANSITIONS[current.lifecycle_state]?.has(state)) {
      throw new CoreError('INVALID_STATE_TRANSITION', 'CONFLICT', 'errors.invalid_state_transition', {
        entity_type: 'SHOT', entity_id: shotId, from: current.lifecycle_state, to: state,
      }, { needsUser: true });
    }
    const version = Number(current.row_version) + 1;
    this.db.prepare('UPDATE shots SET title = ?, lifecycle_state = ?, updated_at_utc_us = ?, row_version = ? WHERE id = ?')
      .run(title, state, nowUtcUs(), version, shotId);
    const shot = this.db.prepare('SELECT * FROM shots WHERE id = ?').get(shotId);
    return {
      projectId: project.id,
      shot: publicShot(shot),
      result: publicShot(shot),
      event: { aggregateType: 'SHOT', aggregateId: shotId, aggregateVersion: version, eventType: 'SHOT_UPDATED', payload: publicShot(shot) },
      audit: { actionType: 'shot.update', targetType: 'SHOT', targetId: shotId, payload: { row_version: version } },
    };
  }

  _decisionExpectedVersion(payload, expectedVersions, current) {
    let expected = payload.expected_decision_version ?? payload.expectedDecisionVersion;
    if (expected === undefined || expected === null) {
      for (const key of ['DECISION_REQUEST', 'DECISION', 'decision_request', 'decision', current.id]) {
        if (Object.prototype.hasOwnProperty.call(expectedVersions ?? {}, key)) {
          expected = expectedVersions[key];
          break;
        }
      }
    }
    if (expected === undefined || expected === null) {
      throw new CoreError('EXPECTED_VERSION_REQUIRED', 'CONFLICT', 'errors.expected_decision_version_required', {
        decision_request_id: current.id,
      }, { needsUser: true, decisionRequestId: current.id });
    }
    const numeric = Number(expected);
    if (!Number.isSafeInteger(numeric) || numeric < 1) {
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_decision_version', {
        decision_request_id: current.id,
      });
    }
    if (numeric !== Number(current.row_version)) {
      throw new CoreError('STALE_DECISION', 'CONFLICT', 'errors.stale_decision', {
        decision_request_id: current.id, expected: numeric, current: Number(current.row_version),
      }, { needsUser: true, decisionRequestId: current.id });
    }
  }

  _assertDecisionAuthority(current) {
    const actor = this.db.prepare('SELECT actor_type, status FROM actors WHERE id = ?').get(this.actorId);
    if (!actor || actor.status !== 'ACTIVE') {
      throw new CoreError('AUTH_REQUIRED', 'AUTH_REQUIRED', 'errors.actor_disabled', {}, { needsUser: true, decisionRequestId: current.id });
    }
    const authority = String(current.required_authority ?? 'LOCAL_ACTOR').trim().toUpperCase();
    // V1 has one local human actor and no role/authority registry yet.  Keep
    // the gate explicit: known local authorities are accepted, while a
    // request that requires an unavailable role remains actionable and safe.
    if (!['LOCAL_ACTOR', 'HUMAN', 'ANY'].includes(authority) || actor.actor_type !== 'HUMAN') {
      throw new CoreError('AUTHORITY_REQUIRED', 'AUTH_REQUIRED', 'errors.decision_authority_required', {
        required_authority: current.required_authority,
      }, { needsUser: true, decisionRequestId: current.id });
    }
  }

  _assertDecisionOpen(current) {
    if (current.state === 'OBSOLETE' || current.state === 'EXPIRED') {
      throw new CoreError('STALE_DECISION', 'CONFLICT', 'errors.stale_decision', {
        decision_request_id: current.id, state: current.state,
      }, { needsUser: true, decisionRequestId: current.id });
    }
    if (current.state !== 'OPEN') {
      throw new CoreError('DECISION_NOT_OPEN', 'CONFLICT', 'errors.decision_not_open', {
        decision_request_id: current.id, state: current.state,
      }, { needsUser: true, decisionRequestId: current.id });
    }
  }

  _decisionProject(current, payload) {
    if (!current.project_id) {
      const suppliedProjectId = payload?.project_id ?? payload?.projectId;
      if (suppliedProjectId !== undefined && suppliedProjectId !== null) {
        throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', {
          entity_type: 'DECISION_REQUEST', entity_id: current.id, project_id: suppliedProjectId, actual_project_id: null,
        }, { needsUser: true, decisionRequestId: current.id });
      }
      return null;
    }
    const project = this._project(current.project_id);
    this._assertPayloadProjectScope(payload, project.id, 'DECISION_REQUEST', current.id);
    return project;
  }

  _createDecisionRequest(payload) {
    const decisionType = requiredString(payload.decision_type ?? payload.decisionType ?? 'HUMAN_DECISION', 'decision_type', 120).toUpperCase();
    const titleKey = requiredString(payload.title_key ?? payload.title, 'title_key', 500);
    const reasonKey = requiredString(payload.reason_key ?? payload.reason, 'reason_key', 500);
    const scopeType = String(payload.blocking_scope_type ?? payload.blockingScopeType ?? 'SYSTEM').trim().toUpperCase();
    if (!DECISION_SCOPE_TYPES.has(scopeType)) {
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_decision_scope', { blocking_scope_type: scopeType });
    }
    const scopeId = payload.blocking_scope_id ?? payload.blockingScopeId ?? null;
    if (scopeType !== 'SYSTEM' && (typeof scopeId !== 'string' || scopeId.trim().length === 0)) {
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.decision_scope_id_required', { blocking_scope_type: scopeType });
    }
    const severity = String(payload.severity ?? 'NORMAL').trim().toUpperCase();
    if (!DECISION_SEVERITIES.has(severity)) {
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_decision_severity', { severity });
    }
    const projectIdFromPayload = payload.project_id ?? payload.projectId ?? null;
    let project = projectIdFromPayload ? this._project(projectIdFromPayload) : null;
    if (scopeType === 'PROJECT') {
      if (!project) project = this._project(scopeId);
      if (scopeId !== project.id) {
        throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', {
          entity_type: 'PROJECT', entity_id: scopeId, project_id: project.id,
        }, { needsUser: true });
      }
    }
    if (scopeType === 'TASK') {
      const task = this._task(scopeId);
      if (project && task.project_id !== project.id) {
        throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', {
          entity_type: 'TASK', entity_id: scopeId, project_id: project.id, actual_project_id: task.project_id,
        }, { needsUser: true });
      }
      project = this._project(task.project_id);
    }
    if (scopeType === 'SHOT') {
      const shot = this._shot(scopeId);
      if (project && shot.project_id !== project.id) {
        throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', {
          entity_type: 'SHOT', entity_id: scopeId, project_id: project.id, actual_project_id: shot.project_id,
        }, { needsUser: true });
      }
      project = this._project(shot.project_id);
    }
    if (project) this._assertProjectWritable(project);

    const choicesInput = payload.choices;
    if (!Array.isArray(choicesInput) || choicesInput.length < 1 || choicesInput.length > 32) {
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.decision_choices_required', {});
    }
    const choices = [];
    const choiceIds = new Set();
    const explicitRecommendedId = payload.recommended_choice_id ?? payload.recommendedChoiceId ?? null;
    let recommendedId = explicitRecommendedId;
    for (let index = 0; index < choicesInput.length; index += 1) {
      const input = choicesInput[index];
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_decision_choice', { index });
      }
      const id = requiredString(input.id ?? input.choice_id ?? uuidv7(), 'choice_id', 200);
      if (choiceIds.has(id)) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.duplicate_decision_choice', { choice_id: id });
      choiceIds.add(id);
      const labelKey = requiredString(input.label_key ?? input.label, 'label_key', 500);
      const commandTemplate = objectValue(input.command_template ?? input.commandTemplate, 'command_template', {});
      const consequenceSummary = objectValue(input.consequence_summary ?? input.consequenceSummary, 'consequence_summary', {});
      const recommended = Boolean(input.recommended);
      choices.push({ id, labelKey, commandTemplate, consequenceSummary, recommended, sortOrder: index });
    }
    const recommendedChoices = choices.filter((choice) => choice.recommended);
    if (recommendedChoices.length > 1 && explicitRecommendedId === null) {
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.multiple_recommended_choices', {});
    }
    if (recommendedId === null && recommendedChoices.length === 1) recommendedId = recommendedChoices[0].id;
    if (recommendedId !== null && (!choiceIds.has(recommendedId) || typeof recommendedId !== 'string')) {
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_recommended_choice', { choice_id: recommendedId });
    }
    if (recommendedId !== null) {
      for (const choice of choices) choice.recommended = choice.id === recommendedId;
    }

    const reasonArgs = objectValue(payload.reason_args ?? payload.reasonArgs, 'reason_args', {});
    const affectedEntities = arrayValue(payload.affected_entities ?? payload.affectedEntities, 'affected_entities', []);
    const evidence = arrayValue(payload.evidence, 'evidence', []);
    const defaultBehavior = objectValue(payload.default_behavior ?? payload.defaultBehavior, 'default_behavior', { action: 'DO_NOTHING' });
    const deadline = utcUsValue(payload.deadline_at_utc_us ?? payload.deadlineAtUtcUs ?? payload.deadline_at ?? payload.deadlineAt, 'deadline_at');
    const requiredAuthority = requiredString(payload.required_authority ?? payload.requiredAuthority ?? 'LOCAL_ACTOR', 'required_authority', 120).toUpperCase();
    const projectId = project?.id ?? projectIdFromPayload;
    if (projectId && !project) project = this._project(projectId);
    const decisionId = uuidv7();
    const created = nowUtcUs();
    // Core is the single writer; the next event sequence is deterministic
    // inside this transaction and is recorded as the creation provenance.
    const createdByEventSeq = Number(this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM domain_events').get().seq) + 1;
    this.db.prepare(`INSERT INTO decision_requests
      (id, project_id, decision_type, title_key, reason_key, reason_args_json,
       blocking_scope_type, blocking_scope_id, affected_entities_json, evidence_json,
       default_behavior_json, severity, state, recommended_choice_id,
       deadline_at_utc_us, required_authority, created_by_event_seq,
       created_at_utc_us, updated_at_utc_us, row_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, ?, 1)`).run(
      decisionId, projectId ?? null, decisionType, titleKey, reasonKey, json(reasonArgs),
      scopeType, scopeType === 'SYSTEM' ? null : scopeId, json(affectedEntities), json(evidence),
      json(defaultBehavior), severity, recommendedId, deadline, requiredAuthority,
      createdByEventSeq, created, created,
    );
    const insertChoice = this.db.prepare(`INSERT INTO decision_choices
      (id, decision_request_id, label_key, command_template_json, consequence_summary_json,
       recommended, sort_order, created_at_utc_us)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const choice of choices) {
      insertChoice.run(choice.id, decisionId, choice.labelKey, json(choice.commandTemplate), json(choice.consequenceSummary), choice.recommended ? 1 : 0, choice.sortOrder, created);
    }
    const decision = this.db.prepare('SELECT * FROM decision_requests WHERE id = ?').get(decisionId);
    const publicView = this._publicDecision(decision);
    return {
      projectId: projectId ?? null,
      decision: publicView,
      result: publicView,
      event: { aggregateType: 'DECISION_REQUEST', aggregateId: decisionId, aggregateVersion: 1, eventType: 'DECISION_REQUEST_CREATED', payload: publicView },
      audit: { actionType: 'decision.create', targetType: 'DECISION_REQUEST', targetId: decisionId, payload: { project_id: projectId ?? null, decision_type: decisionType, severity } },
    };
  }

  _resolveDecisionRequest(payload, expectedVersions) {
    const decisionId = payload.decision_request_id ?? payload.decisionRequestId;
    const current = this._decision(decisionId);
    const project = this._decisionProject(current, payload);
    this._assertDecisionOpen(current);
    this._decisionExpectedVersion(payload, expectedVersions, current);
    this._assertDecisionAuthority(current);
    const choiceId = requiredString(payload.choice_id ?? payload.choiceId, 'choice_id', 200);
    const choice = this.db.prepare('SELECT * FROM decision_choices WHERE id = ? AND decision_request_id = ?').get(choiceId, current.id);
    if (!choice) {
      throw new CoreError('INVALID_DECISION_CHOICE', 'CONFLICT', 'errors.invalid_decision_choice', {
        decision_request_id: current.id, choice_id: choiceId,
      }, { needsUser: true, decisionRequestId: current.id });
    }
    const resolvedAt = nowUtcUs();
    const version = Number(current.row_version) + 1;
    this.db.prepare(`UPDATE decision_requests SET state = 'RESOLVED', resolved_choice_id = ?,
      resolved_by_actor_id = ?, resolved_at_utc_us = ?, updated_at_utc_us = ?, row_version = ?
      WHERE id = ?`).run(choiceId, this.actorId, resolvedAt, resolvedAt, version, current.id);
    const updated = this.db.prepare('SELECT * FROM decision_requests WHERE id = ?').get(current.id);
    const publicView = this._publicDecision(updated);
    return {
      projectId: project?.id ?? current.project_id ?? null,
      decision: publicView,
      result: publicView,
      event: { aggregateType: 'DECISION_REQUEST', aggregateId: current.id, aggregateVersion: version, eventType: 'DECISION_REQUEST_RESOLVED', payload: { ...publicView, choice_id: choiceId } },
      audit: { actionType: 'decision.resolve', targetType: 'DECISION_REQUEST', targetId: current.id, payload: { choice_id: choiceId, decision_version: version } },
    };
  }

  _dismissDecisionRequest(payload, expectedVersions) {
    const decisionId = payload.decision_request_id ?? payload.decisionRequestId;
    const current = this._decision(decisionId);
    const project = this._decisionProject(current, payload);
    this._assertDecisionOpen(current);
    this._decisionExpectedVersion(payload, expectedVersions, current);
    this._assertDecisionAuthority(current);
    const resolvedAt = nowUtcUs();
    const version = Number(current.row_version) + 1;
    this.db.prepare(`UPDATE decision_requests SET state = 'DISMISSED', resolved_choice_id = NULL,
      resolved_by_actor_id = ?, resolved_at_utc_us = ?, updated_at_utc_us = ?, row_version = ?
      WHERE id = ?`).run(this.actorId, resolvedAt, resolvedAt, version, current.id);
    const updated = this.db.prepare('SELECT * FROM decision_requests WHERE id = ?').get(current.id);
    const publicView = this._publicDecision(updated);
    return {
      projectId: project?.id ?? current.project_id ?? null,
      decision: publicView,
      result: publicView,
      event: { aggregateType: 'DECISION_REQUEST', aggregateId: current.id, aggregateVersion: version, eventType: 'DECISION_REQUEST_DISMISSED', payload: publicView },
      audit: { actionType: 'decision.dismiss', targetType: 'DECISION_REQUEST', targetId: current.id, payload: { decision_version: version } },
    };
  }

  _obsoleteDecisionRequest(payload, expectedVersions) {
    const decisionId = payload.decision_request_id ?? payload.decisionRequestId;
    const current = this._decision(decisionId);
    const project = this._decisionProject(current, payload);
    this._decisionExpectedVersion(payload, expectedVersions, current);
    this._assertDecisionOpen(current);
    const changedAt = nowUtcUs();
    const version = Number(current.row_version) + 1;
    this.db.prepare(`UPDATE decision_requests SET state = 'OBSOLETE', updated_at_utc_us = ?, row_version = ?
      WHERE id = ?`).run(changedAt, version, current.id);
    const updated = this.db.prepare('SELECT * FROM decision_requests WHERE id = ?').get(current.id);
    const publicView = this._publicDecision(updated);
    return {
      projectId: project?.id ?? current.project_id ?? null,
      decision: publicView,
      result: publicView,
      event: { aggregateType: 'DECISION_REQUEST', aggregateId: current.id, aggregateVersion: version, eventType: 'DECISION_REQUEST_OBSOLETED', payload: publicView },
      audit: { actionType: 'decision.obsolete', targetType: 'DECISION_REQUEST', targetId: current.id, payload: { decision_version: version } },
    };
  }

  _importAsset(payload) {
    const projectId = payload.project_id ?? payload.projectId ?? null;
    const project = projectId ? this._project(projectId) : null;
    if (project) this._assertProjectWritable(project);
    const storageMode = String(payload.storage_mode ?? payload.storageMode ?? 'COPY').trim().toUpperCase();
    if (!ASSET_STORAGE_MODES.has(storageMode)) {
      throw new CoreError('INVALID_STORAGE_MODE', 'VALIDATION', 'errors.invalid_storage_mode', { storage_mode: storageMode });
    }
    const stagingId = payload.__staging_id ?? payload.staging_id ?? payload.stagingId ?? null;
    let sourcePath;
    let staged = null;
    let file;
    if (storageMode === 'COPY') {
      if (!stagingId) throw new CoreError('STAGING_REQUIRED', 'CONFLICT', 'errors.staging_required', {}, { needsUser: true });
      staged = this._stagingRow(stagingId);
      sourcePath = this._canonicalSourcePath(payload.source_path ?? payload.sourcePath ?? payload.path ?? payload.file_path);
      file = {
        hash_algorithm: staged.hash_algorithm ?? 'SHA-256',
        content_hash: staged.sha256,
        byte_size: Number(staged.expected_size),
        ...(parseJson(staged.source_file_identity_json, {}) ?? {}),
      };
      if (!SHA256_HEX.test(String(file.content_hash ?? ''))) {
        throw new CoreError('STAGING_VERIFY_FAILED', 'INTERNAL', 'errors.staging_verify_failed', { staging_id: stagingId }, { needsUser: false });
      }
    } else {
      sourcePath = this._assetSourcePath(payload.source_path ?? payload.sourcePath ?? payload.path ?? payload.file_path);
      file = this._hashLocalFile(sourcePath);
    }
    const hashAlgorithm = String(payload.hash_algorithm ?? payload.hashAlgorithm ?? 'SHA-256').trim().toUpperCase().replace(/_/g, '-');
    if (hashAlgorithm !== 'SHA-256') {
      throw new CoreError('UNSUPPORTED_HASH_ALGORITHM', 'VALIDATION', 'errors.unsupported_hash_algorithm', { hash_algorithm: hashAlgorithm });
    }
    const suppliedHash = payload.content_hash ?? payload.contentHash;
    if (suppliedHash !== undefined && suppliedHash !== null) {
      if (typeof suppliedHash !== 'string' || !SHA256_HEX.test(suppliedHash)) {
        throw new CoreError('INVALID_CONTENT_HASH', 'VALIDATION', 'errors.invalid_content_hash', {});
      }
      if (suppliedHash.toLowerCase() !== String(file.content_hash).toLowerCase()) {
        throw new CoreError('HASH_MISMATCH', 'CONFLICT', 'errors.hash_mismatch', { expected: suppliedHash.toLowerCase(), actual: file.content_hash }, { needsUser: true });
      }
    }
    const assetType = String(payload.asset_type ?? payload.assetType ?? 'GENERIC').trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_.-]{0,63}$/.test(assetType)) {
      throw new CoreError('INVALID_ASSET_TYPE', 'VALIDATION', 'errors.invalid_asset_type', {});
    }
    const originType = String(payload.origin_type ?? payload.originType ?? 'IMPORTED').trim().toUpperCase();
    if (!ASSET_ORIGIN_TYPES.has(originType)) {
      throw new CoreError('INVALID_ORIGIN_TYPE', 'VALIDATION', 'errors.invalid_origin_type', { origin_type: originType });
    }
    const semanticRole = String(payload.semantic_role ?? payload.semanticRole ?? 'UNCLASSIFIED').trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_.-]{0,63}$/.test(semanticRole)) {
      throw new CoreError('INVALID_SEMANTIC_ROLE', 'VALIDATION', 'errors.invalid_semantic_role', {});
    }
    const sourceUri = pathToFileURL(sourcePath).href;
    const sourceFingerprint = this._pathFingerprint(sourcePath);
    if (staged && staged.source_path_fingerprint !== sourceFingerprint) {
      throw new CoreError('STAGING_SOURCE_MISMATCH', 'CONFLICT', 'errors.staging_source_mismatch', {}, { needsUser: true });
    }
    const originalName = requiredString(payload.original_name ?? payload.originalName ?? path.basename(sourcePath), 'original_name', 500);
    const displayName = requiredString(payload.display_name ?? payload.displayName ?? originalName, 'display_name', 500);
    const sourceDescription = optionalString(payload.source_description ?? payload.sourceDescription, 'source_description', 2000, `Imported local file: ${originalName}`);
    const mimeType = optionalString(payload.mime_type ?? payload.mimeType, 'mime_type', 200, this._mimeForPath(sourcePath));
    const sourceMetadata = {
      original_name: originalName,
      detected_mime: mimeType,
      byte_size: file.byte_size,
      mtime_ms: file.mtime_ms,
      ctime_ms: file.ctime_ms,
      mode: file.mode,
      source_file_identity: file.identity ?? parseJson(staged?.source_file_identity_json, null),
      hash_algorithm: hashAlgorithm,
      content_hash: file.content_hash,
    };
    if (Buffer.byteLength(JSON.stringify(sourceMetadata), 'utf8') > MAX_ASSET_METADATA_BYTES) {
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.asset_metadata_too_large', {});
    }

    const now = nowUtcUs();
    const sessionId = uuidv7();
    const itemId = uuidv7();
    const assetId = uuidv7();
    const revisionId = uuidv7();
    const provenanceId = uuidv7();
    const objectId = uuidv7();
    const rightsIdentityId = uuidv7();
    let materialized = null;
    let objectWasExisting = false;
    try {
      if (storageMode === 'COPY') materialized = this._materializeStagedObject(stagingId, hashAlgorithm, file.content_hash, file.byte_size);
      const existingObject = this.db.prepare('SELECT * FROM storage_objects WHERE hash_algorithm = ? AND content_hash = ?').get(hashAlgorithm, file.content_hash);
      objectWasExisting = Boolean(existingObject);
      const storageObject = existingObject ?? {
        id: objectId,
        hash_algorithm: hashAlgorithm,
        content_hash: file.content_hash,
        byte_size: file.byte_size,
        storage_class: storageMode === 'COPY' ? 'LOCAL_MANAGED' : 'EXTERNAL_REFERENCE',
        verified_at_utc_us: now,
        created_at_utc_us: now,
      };
      if (existingObject && Number(existingObject.byte_size) !== file.byte_size) {
        throw new CoreError('CONTENT_IDENTITY_CONFLICT', 'INTERNAL', 'errors.content_identity_conflict', { content_hash: file.content_hash }, { needsUser: false });
      }
      if (!existingObject) {
        this.db.prepare(`INSERT INTO storage_objects
          (id, hash_algorithm, content_hash, byte_size, storage_class, verified_at_utc_us, created_at_utc_us)
          VALUES (?, ?, ?, ?, ?, ?, ?)`).run(storageObject.id, storageObject.hash_algorithm, storageObject.content_hash,
          storageObject.byte_size, storageObject.storage_class, storageObject.verified_at_utc_us, storageObject.created_at_utc_us);
      }
      this.db.prepare(`INSERT INTO provenance_records
        (id, origin_type, source_description, source_path_or_uri, source_path_fingerprint, source_metadata_json, created_by_actor_id, created_at_utc_us)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        provenanceId, originType, sourceDescription, sourceUri, sourceFingerprint, json(sourceMetadata), this.actorId, now,
      );
      this.db.prepare(`INSERT INTO assets
        (id, project_id, rights_identity_id, asset_type, display_name, origin_type, lifecycle_state, created_by_actor_id, created_at_utc_us, updated_at_utc_us, row_version)
        VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, 1)`).run(
        assetId, project?.id ?? null, rightsIdentityId, assetType, displayName, originType, this.actorId, now, now,
      );
      this.db.prepare(`INSERT INTO rights_identities
        (id, project_id, subject_type, subject_id, notes, created_by_actor_id, created_at_utc_us)
        VALUES (?, ?, 'ASSET', ?, ?, ?, ?)`).run(
        rightsIdentityId, project?.id ?? null, assetId, 'Imported asset rights scope', this.actorId, now,
      );
      this.db.prepare(`INSERT INTO asset_revisions
        (id, asset_id, revision_number, storage_object_id, provenance_record_id, semantic_role, availability_state, review_state, rebuildability, availability_evidence_state, created_by_actor_id, created_at_utc_us)
        VALUES (?, ?, 1, ?, ?, ?, 'AVAILABLE', 'UNREVIEWED', 'ORIGINAL', ?, ?, ?)`).run(
        revisionId, assetId, storageObject.id, provenanceId, semanticRole, storageMode === 'COPY' ? 'VERIFIED' : 'UNKNOWN', this.actorId, now,
      );
      const locationType = storageMode === 'COPY' ? 'MANAGED_OBJECT' : 'EXTERNAL_PATH';
      const locationReference = storageMode === 'COPY' ? materialized.objectUri : sourceUri;
      this.db.prepare(`INSERT INTO asset_locations
        (id, asset_revision_id, location_type, path_or_uri, path_fingerprint, status, last_verified_at_utc_us, created_at_utc_us)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        uuidv7(), revisionId, locationType, locationReference, sourceFingerprint,
        storageMode === 'COPY' ? 'AVAILABLE' : 'UNVERIFIED', storageMode === 'COPY' ? now : null, now,
      );
      if (storageMode === 'COPY') {
        const relativePath = materialized.relativePath.split(path.sep).join('/');
        const existingLocation = this.db.prepare(`SELECT id FROM storage_object_locations
          WHERE storage_object_id = ? AND storage_root = ? AND relative_path = ?`).get(storageObject.id, 'asset-store', relativePath);
        if (!existingLocation) {
          this.db.prepare(`INSERT INTO storage_object_locations
            (id, storage_object_id, storage_root, relative_path, location_role, state, last_verified_at_utc_us, created_at_utc_us)
            VALUES (?, ?, 'asset-store', ?, 'PRIMARY', 'AVAILABLE', ?, ?)`).run(
            uuidv7(), storageObject.id, relativePath, now, now,
          );
        }
      }
      this.db.prepare(`INSERT INTO import_sessions
        (id, project_id, actor_id, state, source_kind, source_root, intent_hint, created_at_utc_us, updated_at_utc_us, row_version)
        VALUES (?, ?, ?, 'COMMITTED', 'LOCAL_FILE', ?, ?, ?, ?, 1)`).run(
        sessionId, project?.id ?? null, this.actorId, pathToFileURL(path.dirname(sourcePath)).href,
        optionalString(payload.intent_hint ?? payload.intentHint, 'intent_hint', 500, null), now, now,
      );
      this.db.prepare(`INSERT INTO import_items
        (id, import_session_id, original_name, detected_mime, byte_size, source_path_or_uri, source_path_fingerprint,
         ingest_state, hash_algorithm, content_hash, decode_status, security_status, resulting_asset_id, resulting_revision_id, created_at_utc_us)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'COMMITTED', ?, ?, 'UNKNOWN', 'UNKNOWN', ?, ?, ?)`).run(
        itemId, sessionId, originalName, mimeType, file.byte_size, sourceUri, sourceFingerprint,
        hashAlgorithm, file.content_hash, assetId, revisionId, now,
      );
      if (stagingId) {
        this.db.prepare(`UPDATE staging_objects SET import_item_id = ?, row_version = row_version + 1,
          updated_at_utc_us = ? WHERE id = ? AND import_item_id IS NULL`).run(itemId, nowUtcUs(), stagingId);
      }
      const asset = this.db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId);
      const revision = this.db.prepare('SELECT * FROM asset_revisions WHERE id = ?').get(revisionId);
      const storedObject = this.db.prepare('SELECT * FROM storage_objects WHERE id = ?').get(storageObject.id);
      const provenance = this.db.prepare('SELECT * FROM provenance_records WHERE id = ?').get(provenanceId);
      const locations = this.db.prepare('SELECT * FROM asset_locations WHERE asset_revision_id = ?').all(revisionId);
      const assetView = publicAsset(asset, revision, storedObject, provenance, locations);
      assetView.rights = this._rightsForAsset(assetId);
      const session = this.db.prepare('SELECT * FROM import_sessions WHERE id = ?').get(sessionId);
      const item = this.db.prepare('SELECT * FROM import_items WHERE id = ?').get(itemId);
      const warnings = ['SECURITY_SCAN_PENDING', 'MEDIA_DECODE_PENDING'];
      return {
        projectId: project?.id ?? null,
        result: {
          ...assetView,
          asset: assetView,
          import_session: publicImportSession(session),
          import_item: publicImportItem(item),
          warnings,
        },
        event: {
          aggregateType: 'ASSET_REVISION', aggregateId: revisionId, aggregateVersion: 1,
          eventType: 'ASSET_IMPORTED',
          payload: {
            asset_id: assetId, asset_revision_id: revisionId, project_id: project?.id ?? null,
            display_name: displayName, asset_type: assetType, origin_type: originType,
            hash_algorithm: hashAlgorithm, content_hash: file.content_hash, byte_size: file.byte_size,
            storage_mode: storageMode, storage_uri: storageMode === 'COPY' ? materialized.objectUri : null,
            provenance_id: provenanceId, import_session_id: sessionId, rights_identity_id: rightsIdentityId,
          },
        },
        audit: {
          actionType: 'asset.import', targetType: 'ASSET_REVISION', targetId: revisionId,
          payload: { asset_id: assetId, project_id: project?.id ?? null, hash_algorithm: hashAlgorithm,
            content_hash: file.content_hash, byte_size: file.byte_size, storage_mode: storageMode, warnings },
        },
      };
    } catch (error) {
      // A verified object is safe to leave for a later storage GC pass.  If it
      // was created during this command and the transaction cannot register it,
      // remove it to avoid presenting an untracked object as durable truth.
      if (materialized?.created && !objectWasExisting) {
        try { fs.rmSync(materialized.target, { force: true }); } catch { /* preserve primary error */ }
      }
      throw error;
    }
  }

  _addNote(payload, commandType) {
    const entityType = String(payload.entity_type ?? payload.entityType ?? (commandType === 'AddTaskNote' ? 'TASK' : commandType === 'AddShotNote' ? 'SHOT' : '')).toUpperCase();
    if (!NOTE_ENTITY_TYPES.has(entityType)) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_note_entity_type', { entity_type: entityType });
    const entityId = payload.entity_id ?? payload.entityId
      ?? (commandType === 'AddTaskNote' ? payload.task_id ?? payload.taskId : null)
      ?? (commandType === 'AddShotNote' ? payload.shot_id ?? payload.shotId : null);
    if (commandType === 'AddTaskNote' && entityType !== 'TASK') {
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_note_entity_type', { entity_type: entityType });
    }
    if (commandType === 'AddShotNote' && entityType !== 'SHOT') {
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_note_entity_type', { entity_type: entityType });
    }
    const typedEntityId = commandType === 'AddTaskNote' ? payload.task_id ?? payload.taskId
      : commandType === 'AddShotNote' ? payload.shot_id ?? payload.shotId : null;
    if (typedEntityId !== undefined && typedEntityId !== null && typedEntityId !== entityId) {
      throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', {
        entity_type: entityType, entity_id: entityId, command_target_id: typedEntityId,
      }, { needsUser: true });
    }
    const body = requiredString(payload.body ?? payload.note, 'body', 50000);
    let project;
    if (entityType === 'PROJECT') project = this._project(entityId);
    if (entityType === 'TASK') { const task = this._task(entityId); project = this._project(task.project_id); }
    if (entityType === 'SHOT') { const shot = this._shot(entityId); project = this._project(shot.project_id); }
    this._assertPayloadProjectScope(payload, project.id, entityType, entityId);
    this._assertProjectWritable(project);
    const noteId = uuidv7();
    const created = nowUtcUs();
    this.db.prepare(`INSERT INTO notes(id, project_id, entity_type, entity_id, body, created_by_actor_id, created_at_utc_us)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(noteId, project.id, entityType, entityId, body, this.actorId, created);
    const note = this.db.prepare('SELECT * FROM notes WHERE id = ?').get(noteId);
    return {
      projectId: project.id,
      note: publicNote(note),
      result: publicNote(note),
      event: { aggregateType: 'NOTE', aggregateId: noteId, aggregateVersion: 1, eventType: `${entityType}_NOTE_ADDED`, payload: publicNote(note) },
      audit: { actionType: `${entityType.toLowerCase()}.note_add`, targetType: entityType, targetId: entityId, payload: { note_id: noteId } },
    };
  }

  planCommand(input = {}) {
    const commandType = requiredString(input.command_type ?? input.commandType, 'command_type', 120);
    const payload = this._commandPayload(input.payload ?? {});
    const expected = input.expected_versions ?? input.expectedVersions ?? {};
    let precondition = { ok: true, code: null };
    let target = null;
    try {
      target = this._planTarget(commandType, payload);
      if (target) {
        const expectedValue = target.kind === 'DECISION_REQUEST'
          ? payload.expected_decision_version ?? payload.expectedDecisionVersion ?? this._planExpected(expected, target.kind, target.id)
          : this._planExpected(expected, target.kind, target.id);
        if (expectedValue !== null && Number(expectedValue) !== Number(target.row.row_version)) precondition = { ok: false, code: target.kind === 'DECISION_REQUEST' ? 'STALE_DECISION' : 'STALE_REVISION' };
      }
    } catch (error) {
      if (error instanceof CoreError) precondition = { ok: false, code: error.code, message_key: error.messageKey };
      else throw error;
    }
    return {
      plan_id: uuidv7(),
      command_type: commandType,
      precondition,
      impact_summary: target ? [{ entity_type: target.kind, entity_id: target.id, impact_type: 'MUTATE', severity: 'INFO' }] : [],
      affected_entities: target ? [{ entity_type: target.kind, entity_id: target.id }] : [],
      stale_consequences: target ? ['projection and dependent UI state may become stale'] : [],
      estimated_cost: { currency: 'NONE', amount: 0 },
      estimated_time_ms: 10,
      estimated_storage_bytes: 4096,
      privacy_rights_impact: 'LOCAL_ONLY',
      reversibility: this._reversibility(commandType),
      required_authority: 'LOCAL_ACTOR',
      confirmation_required: ['TrashProject', 'ArchiveProject'].includes(commandType),
      generated_at: new Date().toISOString(),
    };
  }

  _planTarget(commandType, payload) {
    const mappings = {
      UpdateProjectMetadata: ['PROJECT', payload.project_id ?? payload.projectId],
      PauseProject: ['PROJECT', payload.project_id ?? payload.projectId],
      ArchiveProject: ['PROJECT', payload.project_id ?? payload.projectId],
      TrashProject: ['PROJECT', payload.project_id ?? payload.projectId],
      RestoreProject: ['PROJECT', payload.project_id ?? payload.projectId],
      UpdateTask: ['TASK', payload.task_id ?? payload.taskId],
      UpdateShot: ['SHOT', payload.shot_id ?? payload.shotId],
      ResolveDecisionRequest: ['DECISION_REQUEST', payload.decision_request_id ?? payload.decisionRequestId],
      DismissDecisionRequest: ['DECISION_REQUEST', payload.decision_request_id ?? payload.decisionRequestId],
      ObsoleteDecisionRequest: ['DECISION_REQUEST', payload.decision_request_id ?? payload.decisionRequestId],
      TransitionCharacterRevision: ['REVISION', payload.revision_id ?? payload.revisionId],
    };
    const mapping = mappings[commandType];
    if (!mapping?.[1]) return null;
    const row = mapping[0] === 'PROJECT' ? this._project(mapping[1])
      : mapping[0] === 'TASK' ? this._task(mapping[1])
        : mapping[0] === 'SHOT' ? this._shot(mapping[1])
          : mapping[0] === 'REVISION' ? this._characterRevision(String(payload.revision_type ?? payload.revisionType ?? '').trim().toUpperCase(), mapping[1]).row
            : this._decision(mapping[1]);
    return { kind: mapping[0], id: mapping[1], row };
  }

  _planExpected(expected, kind, id) {
    for (const key of [kind, kind.toLowerCase(), `${kind}:${id}`, `${kind.toLowerCase()}:${id}`, id]) {
      if (Object.prototype.hasOwnProperty.call(expected, key)) return expected[key];
    }
    return null;
  }

  cancelCommand(input = {}) {
    const commandId = requiredString(input.command_id ?? input.commandId, 'command_id');
    const current = this.db.prepare('SELECT * FROM commands WHERE id = ?').get(commandId);
    if (!current) throw new CoreError('NOT_FOUND', 'VALIDATION', 'errors.command_not_found', { command_id: commandId });
    if (current.actor_id !== this.actorId) {
      throw new CoreError('AUTH_REQUIRED', 'AUTH_REQUIRED', 'errors.command_actor_mismatch', { command_id: commandId }, { needsUser: true });
    }
    if (terminalStatus(current.status)) return { ...commandResult(current), cancellation: 'already_terminal' };
    this._transaction(() => {
      this.db.prepare(`UPDATE commands SET status = 'CANCELLED', finished_at_utc_us = ?, error_code = ? WHERE id = ?`)
        .run(nowUtcUs(), 'CANCELLED', commandId);
      this._insertAudit({ actionType: 'command.cancel', targetType: 'COMMAND', targetId: commandId, payload: {} }, commandId, this.actorId, 'CANCELLED');
    });
    return { command_id: commandId, status: 'CANCELLED', cancellation: 'confirmed', projection_seq: this._projectionSeq() };
  }

  getCommand(commandId) {
    const row = this.db.prepare('SELECT * FROM commands WHERE id = ?').get(commandId);
    if (!row) throw new CoreError('NOT_FOUND', 'VALIDATION', 'errors.command_not_found', { command_id: commandId });
    return commandResult(row);
  }

  _queryProjects(params = {}) {
    const includeTrashed = Boolean(params.include_trashed ?? params.includeTrashed);
    const limit = Math.min(Math.max(asInt(params.limit, 100), 1), 200);
    const rows = this.db.prepare(`SELECT * FROM projects
      WHERE (? = 1 OR lifecycle_state != 'TRASHED')
      ORDER BY created_at_utc_us DESC, id DESC LIMIT ?`).all(includeTrashed ? 1 : 0, limit);
    return rows.map((row) => {
      const project = publicProject(row);
      const tasks = this.db.prepare(`SELECT id, title, description, status, priority, row_version
        FROM tasks WHERE project_id = ? ORDER BY priority DESC, created_at_utc_us ASC, id ASC`).all(row.id).map(publicTask);
      project.production_items = tasks.map((task) => ({
        id: task.id,
        title: task.title,
        detail: task.description || 'Mới tạo · chưa bắt đầu',
        state: task.status === 'DONE' ? 'done' : task.status === 'IN_PROGRESS' ? 'in_progress' : task.status === 'BLOCKED' ? 'blocked' : task.status === 'CANCELLED' ? 'cancelled' : 'todo',
      }));
      project.completion = {
        done: tasks.filter((task) => task.status === 'DONE').length,
        total: tasks.length,
      };
      const blockedTasks = tasks.filter((task) => task.status === 'BLOCKED').length;
      project.health_state = row.lifecycle_state === 'TRASHED' ? 'BLOCKED' : blockedTasks > 0 ? 'AT_RISK' : 'HEALTHY';
      return project;
    });
  }

  _projectSummary(projectId) {
    const project = this._project(projectId);
    const tasks = Number(this.db.prepare('SELECT COUNT(*) AS count FROM tasks WHERE project_id = ?').get(projectId).count);
    const shots = Number(this.db.prepare('SELECT COUNT(*) AS count FROM shots WHERE project_id = ?').get(projectId).count);
    const notes = Number(this.db.prepare('SELECT COUNT(*) AS count FROM notes WHERE project_id = ?').get(projectId).count);
    const assets = Number(this.db.prepare("SELECT COUNT(*) AS count FROM assets WHERE project_id = ? AND lifecycle_state != 'TRASHED'").get(projectId).count);
    const activity = this.db.prepare(`SELECT * FROM domain_events WHERE aggregate_id IN
      (SELECT id FROM tasks WHERE project_id = ?
       UNION SELECT id FROM shots WHERE project_id = ?
       UNION SELECT id FROM notes WHERE project_id = ?
       UNION SELECT id FROM asset_revisions WHERE asset_id IN (SELECT id FROM assets WHERE project_id = ?)
       UNION SELECT ?)
      ORDER BY seq DESC LIMIT 20`).all(projectId, projectId, projectId, projectId, projectId).map((row) => this._publicActivity(row));
    return { project: publicProject(project), counts: { tasks, shots, notes, assets }, activity, projection_seq: this._projectionSeq(), generated_at: new Date().toISOString() };
  }

  _publicEvent(row) {
    const event = rowObject(row);
    event.payload = parseJson(event.payload_json);
    event.occurred_at = rfc3339FromUs(event.created_at_utc_us);
    event.event_class = `${event.aggregate_type}_ACTIVITY`;
    event.human_state = { message_key: `events.${event.event_type.toLowerCase()}`, args: {}, needs_user: false, blocking: false };
    delete event.payload_json;
    return event;
  }

  _eventProjectId(row, payload = parseJson(row?.payload_json, {})) {
    const fromPayload = payload?.project_id ?? payload?.projectId;
    if (typeof fromPayload === 'string' && fromPayload.length > 0) return fromPayload;
    const aggregateType = String(row?.aggregate_type ?? '').toUpperCase();
    const aggregateId = row?.aggregate_id;
    if (!aggregateId) return null;
    if (aggregateType === 'PROJECT') return aggregateId;
    if (aggregateType === 'TASK') return this.db.prepare('SELECT project_id FROM tasks WHERE id = ?').get(aggregateId)?.project_id ?? null;
    if (aggregateType === 'SHOT') return this.db.prepare('SELECT project_id FROM shots WHERE id = ?').get(aggregateId)?.project_id ?? null;
    if (aggregateType === 'NOTE') return this.db.prepare('SELECT project_id FROM notes WHERE id = ?').get(aggregateId)?.project_id ?? null;
    if (aggregateType === 'DECISION_REQUEST') return this.db.prepare('SELECT project_id FROM decision_requests WHERE id = ?').get(aggregateId)?.project_id ?? null;
    if (aggregateType === 'ASSET_REVISION') return this.db.prepare(`SELECT a.project_id FROM asset_revisions r JOIN assets a ON a.id = r.asset_id WHERE r.id = ?`).get(aggregateId)?.project_id ?? null;
    if (aggregateType === 'RIGHTS_IDENTITY') return this.db.prepare('SELECT project_id FROM rights_identities WHERE id = ?').get(aggregateId)?.project_id ?? null;
    if (aggregateType === 'RIGHTS_RECORD') return this.db.prepare('SELECT ri.project_id FROM rights_records rr JOIN rights_identities ri ON ri.id = rr.rights_identity_id WHERE rr.id = ?').get(aggregateId)?.project_id ?? null;
    if (aggregateType === 'CONSENT') return this.db.prepare('SELECT ri.project_id FROM consents c JOIN rights_identities ri ON ri.id = c.rights_identity_id WHERE c.id = ?').get(aggregateId)?.project_id ?? null;
    if (aggregateType === 'RIGHTS_REVOCATION') return this.db.prepare('SELECT ri.project_id FROM revocations r JOIN rights_identities ri ON ri.id = r.rights_identity_id WHERE r.id = ?').get(aggregateId)?.project_id ?? null;
    if (aggregateType === 'MEDIA_PROFILE') return this.db.prepare('SELECT project_id FROM project_media_profiles WHERE id = ?').get(aggregateId)?.project_id ?? null;
    if (aggregateType === 'TIMELINE') return this.db.prepare('SELECT project_id FROM timelines WHERE id = ?').get(aggregateId)?.project_id ?? null;
    if (aggregateType === 'TIMELINE_REVISION') return this.db.prepare(`SELECT t.project_id FROM timeline_revisions r JOIN timelines t ON t.id = r.timeline_id WHERE r.id = ?`).get(aggregateId)?.project_id ?? null;
    return null;
  }

  _publicActivity(row) {
    const event = this._publicEvent(row);
    const projectId = this._eventProjectId(row, event.payload);
    if (projectId) {
      event.project_id = projectId;
      event.project_name = this.db.prepare('SELECT title FROM projects WHERE id = ?').get(projectId)?.title ?? projectId;
    }
    return event;
  }

  _dashboardActivity(params = {}) {
    const limit = Math.min(Math.max(asInt(params.activity_limit ?? params.activityLimit, 100), 1), 500);
    return this.db.prepare('SELECT * FROM domain_events ORDER BY seq DESC LIMIT ?').all(limit).map((row) => this._publicActivity(row));
  }

  _projectHealth(projectId) {
    const project = this._project(projectId);
    const blockedTasks = Number(this.db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE project_id = ? AND status = 'BLOCKED'").get(projectId).count);
    const openTasks = Number(this.db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE project_id = ? AND status NOT IN ('DONE', 'CANCELLED')").get(projectId).count);
    const state = project.lifecycle_state === 'TRASHED' ? 'BLOCKED' : blockedTasks > 0 ? 'AT_RISK' : 'HEALTHY';
    return {
      project_id: projectId,
      health_state: state,
      freshness: 'FRESH',
      lifecycle_state: project.lifecycle_state,
      blocked_tasks: blockedTasks,
      open_tasks: openTasks,
      projection_seq: this._projectionSeq(),
      generated_at: new Date().toISOString(),
    };
  }

  _systemHealth() {
    const journalMode = String(this.db.prepare('PRAGMA journal_mode').get().journal_mode ?? '').toUpperCase();
    const synchronousValue = Number(this.db.prepare('PRAGMA synchronous').get().synchronous ?? -1);
    const foreignKeys = Number(this.db.prepare('PRAGMA foreign_keys').get().foreign_keys ?? 0);
    const integrity = String(this.db.prepare('PRAGMA integrity_check').get().integrity_check ?? 'unknown');
    const walPath = this.dbPath === ':memory:' ? null : `${this.dbPath}-wal`;
    let dbBytes = 0;
    if (this.dbPath !== ':memory:') {
      for (const suffix of ['', '-wal', '-shm']) {
        try { dbBytes += fs.statSync(`${this.dbPath}${suffix}`).size; } catch { /* optional sidecar */ }
      }
    }
    const objectStoreBytes = Number(this.db.prepare(`SELECT COALESCE(SUM(so.byte_size), 0) AS bytes
      FROM storage_objects so WHERE EXISTS (
        SELECT 1 FROM storage_object_locations sol
        WHERE sol.storage_object_id = so.id AND sol.location_role = 'PRIMARY' AND sol.state = 'AVAILABLE'
      )`).get().bytes);
    const latestBackup = this.db.prepare(`SELECT state, completed_at_utc_us
      FROM backups ORDER BY created_at_utc_us DESC, id DESC LIMIT 1`).get() ?? null;
    let storagePressure = false;
    let backupAvailableBytes = null;
    let backupEstimatedBytes = null;
    try {
      const admission = this._backupAdmission({}, this._backupRoot({}), this._backupObjectRows());
      backupAvailableBytes = admission.availableBytes;
      backupEstimatedBytes = admission.estimatedBytes;
    } catch (error) {
      storagePressure = ['STORAGE_PRESSURE', 'STORAGE_CAPACITY_UNKNOWN'].includes(error?.code)
        || error?.category === 'STORAGE_PRESSURE';
      if (error?.messageArgs?.available_bytes !== undefined) backupAvailableBytes = Number(error.messageArgs.available_bytes);
      if (error?.messageArgs?.estimated_bytes !== undefined) backupEstimatedBytes = Number(error.messageArgs.estimated_bytes);
    }
    const degradedReasons = [];
    if (integrity !== 'ok') degradedReasons.push('INTEGRITY_CHECK_FAILED');
    if (journalMode !== 'WAL') degradedReasons.push('WAL_DISABLED');
    if (storagePressure) degradedReasons.push('STORAGE_PRESSURE');
    return {
      core_version: CORE_VERSION,
      api_version: API_VERSION,
      schema_version: SCHEMA_VERSION,
      status: integrity === 'ok' && journalMode === 'WAL' && foreignKeys === 1 && !storagePressure ? 'READY' : 'DEGRADED',
      freshness: 'FRESH',
      db_path: this.dbPath,
      journal_mode: journalMode,
      synchronous: synchronousValue,
      foreign_keys: foreignKeys === 1,
      integrity_check: integrity,
      wal_enabled: journalMode === 'WAL',
      wal_path: walPath,
      wal_exists: walPath ? fs.existsSync(walPath) : false,
      bytes: dbBytes,
      object_store_bytes: objectStoreBytes,
      object_store_path: this.assetStorePath,
      installation_id: this._getMeta('installation_id'),
      studio_id: this.studioId,
      actor_id: this.actorId,
      backup_state: latestBackup?.state ?? 'MISSING',
      last_backup_at: latestBackup?.completed_at_utc_us ? rfc3339FromUs(latestBackup.completed_at_utc_us) : null,
      storage_pressure: storagePressure,
      backup_available_bytes: backupAvailableBytes,
      backup_estimated_bytes: backupEstimatedBytes,
      projection_seq: this._projectionSeq(),
      generated_at: new Date().toISOString(),
      degraded_reasons: degradedReasons,
    };
  }

  query(method, params = {}) {
    switch (method) {
      case 'query.home':
        return { projects: this._queryProjects(params), needs_you: this._decisions({ ...params, state: 'OPEN' }), activity: this._dashboardActivity(params), system_health: this._systemHealth(), projection_seq: this._projectionSeq(), generated_at: new Date().toISOString() };
      case 'query.project.list':
      case 'query.projects':
        return { projects: this._queryProjects(params), projection_seq: this._projectionSeq(), generated_at: new Date().toISOString() };
      case 'query.project.get':
        return publicProject(this._project(params.project_id ?? params.projectId));
      case 'query.project.summary':
      case 'query.project.workspace':
        return this._workspace(params.project_id ?? params.projectId);
      case 'query.project.health': return this._projectHealth(params.project_id ?? params.projectId);
      case 'query.project.activity': return this._activity(params.project_id ?? params.projectId, params);
      case 'query.task.list': return this._tasks(params.project_id ?? params.projectId);
      case 'query.shot.list': return this._shots(params.project_id ?? params.projectId);
      case 'query.notes.list': return this._notes(params.project_id ?? params.projectId, params);
      case 'query.library.assets':
      case 'query.library.assets_page':
      case 'query.asset.list':
      case 'query.project.assets': return this._assets(params);
      case 'query.character.list': return this._characterList(params);
      case 'query.character.workspace': {
        const projection = this._characterProjection(params.character_id ?? params.characterId);
        const requestedProject = params.project_id ?? params.projectId;
        if (requestedProject !== undefined && requestedProject !== null && requestedProject !== projection.character.project_id) {
          throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', {
            entity_type: 'CHARACTER', entity_id: projection.character.id, project_id: requestedProject, actual_project_id: projection.character.project_id,
          }, { needsUser: true });
        }
        return projection;
      }
      case 'query.media_profile.workspace':
      case 'query.media_profile.get': return this._mediaProfileWorkspace(params.project_id ?? params.projectId);
      case 'query.timeline.list': return this._timelineList(params);
      case 'query.timeline.workspace': return this._timelineWorkspace(params.timeline_id ?? params.timelineId, params.project_id ?? params.projectId ?? null);
      case 'query.review.list': return this._reviewList(params);
      case 'query.review.get': {
        const session = this._reviewSession(params.review_session_id ?? params.reviewSessionId ?? params.id);
        const requestedProject = params.project_id ?? params.projectId;
        if (requestedProject !== undefined && requestedProject !== null && requestedProject !== session.project_id) {
          throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', { entity_type: 'REVIEW_SESSION', entity_id: session.id, project_id: requestedProject, actual_project_id: session.project_id }, { needsUser: true });
        }
        return this._reviewProjection(session);
      }
      case 'query.asset.rights': return this._rightsForAsset(params.asset_id ?? params.assetId, params);
      case 'query.rights.evaluate': return this._evaluateRights(params.rights_identity_id ?? params.rightsIdentityId ?? params.identity_id ?? params.identityId, params);
      case 'query.rights.identity': return this._rightsIdentityDetails(params.rights_identity_id ?? params.rightsIdentityId ?? params.identity_id ?? params.identityId, params);
      case 'query.import.session': return this._importSession(params.import_session_id ?? params.importSessionId ?? params.id);
      case 'query.import.list': return this._importSessions(params);
      case 'query.command.get': return this.getCommand(params.command_id ?? params.commandId);
      case 'query.audit.list': return this._audit(params);
      case 'query.entity.history': return this._entityHistory(params);
      case 'query.search': return this._search(params);
      case 'query.storage.summary': return this._storageSummary();
      case 'query.backup.list': return this._backups(params);
      case 'query.backup.get': return this._backupDetails(params.backup_id ?? params.backupId ?? params.id);
      case 'query.storage.admission': return this._backupAdmissionQuery(params);
      case 'query.storage.staging_orphans': return this._stagingObjects(params);
      case 'query.needs_you.list': return this._needsYou(params);
      case 'query.needs_you.get': return this._publicDecision(this._decision(params.decision_request_id ?? params.decisionRequestId ?? params.id));
      case 'query.decisions.list': return { items: this._decisions(params), projection_seq: this._projectionSeq(), generated_at: new Date().toISOString() };
      case 'query.decisions.get': return this._publicDecision(this._decision(params.decision_request_id ?? params.decisionRequestId ?? params.id));
      case 'query.system.health':
      case 'health': return this._systemHealth();
      default: throw new CoreError('UNSUPPORTED_QUERY', 'VALIDATION', 'errors.unsupported_query', { method });
    }
  }

  _workspace(projectId) {
    const summary = this._projectSummary(projectId);
    return {
      ...summary,
      tasks: this._tasks(projectId),
      shots: this._shots(projectId),
      notes: this._notes(projectId, { limit: 100 }),
      assets: this._assets({ project_id: projectId }).assets,
      characters: this._characterList({ project_id: projectId }).characters,
    };
  }

  _assetDetails(assetId) {
    const asset = this._asset(assetId);
    const revision = this.db.prepare(`SELECT * FROM asset_revisions
      WHERE asset_id = ? ORDER BY revision_number DESC LIMIT 1`).get(asset.id);
    if (!revision) {
      const view = publicAsset(asset, null, null, null, []);
      view.rights = this._rightsForAsset(asset.id);
      return view;
    }
    const storage = this.db.prepare('SELECT * FROM storage_objects WHERE id = ?').get(revision.storage_object_id);
    const provenance = this.db.prepare('SELECT * FROM provenance_records WHERE id = ?').get(revision.provenance_record_id);
    const locations = this.db.prepare('SELECT * FROM asset_locations WHERE asset_revision_id = ? ORDER BY created_at_utc_us ASC').all(revision.id);
    const view = publicAsset(asset, revision, storage, provenance, locations);
    view.rights = this._rightsForAsset(asset.id);
    return view;
  }

  _assets(params = {}) {
    const projectId = params.project_id ?? params.projectId ?? null;
    if (projectId) this._project(projectId);
    const includeTrashed = Boolean(params.include_trashed ?? params.includeTrashed);
    const limit = Math.min(Math.max(asInt(params.limit, 100), 1), 200);
    const rows = projectId
      ? this.db.prepare(`SELECT * FROM assets WHERE project_id = ?
          AND (? = 1 OR lifecycle_state != 'TRASHED')
          ORDER BY created_at_utc_us DESC, id DESC LIMIT ?`).all(projectId, includeTrashed ? 1 : 0, limit)
      : this.db.prepare(`SELECT * FROM assets WHERE (? = 1 OR lifecycle_state != 'TRASHED')
          ORDER BY created_at_utc_us DESC, id DESC LIMIT ?`).all(includeTrashed ? 1 : 0, limit);
    return {
      assets: rows.map((row) => this._assetDetails(row.id)),
      projection_seq: this._projectionSeq(),
      generated_at: new Date().toISOString(),
    };
  }

  _importSession(sessionId) {
    const id = requiredString(sessionId, 'import_session_id');
    const session = this.db.prepare('SELECT * FROM import_sessions WHERE id = ?').get(id);
    if (!session) throw new CoreError('NOT_FOUND', 'VALIDATION', 'errors.import_session_not_found', { import_session_id: id });
    const items = this.db.prepare('SELECT * FROM import_items WHERE import_session_id = ? ORDER BY created_at_utc_us ASC, id ASC').all(id);
    return {
      session: publicImportSession(session),
      items: items.map(publicImportItem),
      projection_seq: this._projectionSeq(),
      generated_at: new Date().toISOString(),
    };
  }

  _importSessions(params = {}) {
    const projectId = params.project_id ?? params.projectId ?? null;
    if (projectId) this._project(projectId);
    const limit = Math.min(Math.max(asInt(params.limit, 100), 1), 200);
    const rows = projectId
      ? this.db.prepare('SELECT * FROM import_sessions WHERE project_id = ? ORDER BY created_at_utc_us DESC, id DESC LIMIT ?').all(projectId, limit)
      : this.db.prepare('SELECT * FROM import_sessions ORDER BY created_at_utc_us DESC, id DESC LIMIT ?').all(limit);
    return {
      sessions: rows.map((row) => publicImportSession(row)),
      projection_seq: this._projectionSeq(),
      generated_at: new Date().toISOString(),
    };
  }

  _tasks(projectId) {
    this._project(projectId);
    return this.db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY priority DESC, created_at_utc_us ASC, id ASC').all(projectId).map(publicTask);
  }

  _shots(projectId) {
    this._project(projectId);
    return this.db.prepare('SELECT * FROM shots WHERE project_id = ? ORDER BY code ASC').all(projectId).map(publicShot);
  }

  _notes(projectId, params = {}) {
    this._project(projectId);
    const limit = Math.min(Math.max(asInt(params.limit, 100), 1), 500);
    return this.db.prepare('SELECT * FROM notes WHERE project_id = ? ORDER BY created_at_utc_us DESC, id DESC LIMIT ?').all(projectId, limit).map(publicNote);
  }

  _decisions(params = {}) {
    const projectId = params.project_id ?? params.projectId ?? null;
    if (projectId) this._project(projectId);
    const stateInput = params.state ?? params.states;
    const state = stateInput === undefined || stateInput === null || stateInput === '' ? 'OPEN' : String(stateInput).trim().toUpperCase();
    if (!DECISION_STATES.has(state)) {
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_decision_state', { state });
    }
    const severity = params.severity === undefined || params.severity === null || params.severity === ''
      ? null : String(params.severity).trim().toUpperCase();
    if (severity !== null && !DECISION_SEVERITIES.has(severity)) {
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_decision_severity', { severity });
    }
    const limit = Math.min(Math.max(asInt(params.limit, 100), 1), 200);
    const rows = this.db.prepare(`SELECT * FROM decision_requests
      WHERE (? IS NULL OR project_id = ?)
        AND state = ?
        AND (? IS NULL OR severity = ?)
      ORDER BY CASE severity
        WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END,
        CASE WHEN deadline_at_utc_us IS NULL THEN 1 ELSE 0 END,
        deadline_at_utc_us ASC, created_at_utc_us DESC, id ASC LIMIT ?`)
      .all(projectId, projectId, state, severity, severity, limit);
    return rows.map((row) => this._publicDecision(row));
  }

  _needsYou(params = {}) {
    const items = this._decisions({ ...params, state: 'OPEN' });
    return { items, projection_seq: this._projectionSeq(), generated_at: new Date().toISOString() };
  }

  _activity(projectId, params = {}) {
    this._project(projectId);
    const limit = Math.min(Math.max(asInt(params.limit, 100), 1), 500);
    const rows = this.db.prepare(`SELECT * FROM domain_events WHERE aggregate_id = ?
      OR aggregate_id IN (
        SELECT id FROM tasks WHERE project_id = ?
        UNION SELECT id FROM shots WHERE project_id = ?
        UNION SELECT id FROM notes WHERE project_id = ?
       UNION SELECT id FROM asset_revisions WHERE asset_id IN (SELECT id FROM assets WHERE project_id = ?)
       UNION SELECT id FROM decision_requests WHERE project_id = ?
       UNION SELECT id FROM characters WHERE project_id = ?
       UNION SELECT id FROM timelines WHERE project_id = ?
       UNION SELECT id FROM review_sessions WHERE project_id = ?
        UNION SELECT id FROM project_media_profiles WHERE project_id = ?
        ) ORDER BY seq DESC LIMIT ?`).all(
      projectId, projectId, projectId, projectId, projectId,
      projectId, projectId, projectId, projectId, projectId, limit,
    );
    return { events: rows.map((row) => this._publicActivity(row)), projection_seq: this._projectionSeq(), generated_at: new Date().toISOString() };
  }

  _audit(params = {}) {
    const limit = Math.min(Math.max(asInt(params.limit, 100), 1), 500);
    const rows = params.project_id || params.projectId
      ? this.db.prepare(`SELECT a.* FROM audit_records a LEFT JOIN commands c ON c.id = a.command_id
        WHERE c.project_id = ? ORDER BY a.created_at_utc_us DESC LIMIT ?`).all(params.project_id ?? params.projectId, limit)
      : this.db.prepare('SELECT * FROM audit_records ORDER BY created_at_utc_us DESC LIMIT ?').all(limit);
    return { records: rows.map((row) => { const out = rowObject(row); out.payload = parseJson(out.payload_json); delete out.payload_json; out.created_at = rfc3339FromUs(out.created_at_utc_us); return out; }), projection_seq: this._projectionSeq(), generated_at: new Date().toISOString() };
  }

  _entityHistory(params) {
    const type = requiredString(params.entity_type ?? params.entityType, 'entity_type', 50).toUpperCase();
    const id = requiredString(params.entity_id ?? params.entityId, 'entity_id');
    const rows = this.db.prepare('SELECT * FROM domain_events WHERE aggregate_type = ? AND aggregate_id = ? ORDER BY seq ASC').all(type, id);
    return { events: rows.map((row) => this._publicEvent(row)), projection_seq: this._projectionSeq(), generated_at: new Date().toISOString() };
  }

  _search(params) {
    const q = requiredString(params.query ?? params.q, 'query', 200).toLowerCase();
    const like = `%${q}%`;
    const projects = this.db.prepare(`SELECT id, 'PROJECT' AS entity_type, code, title, lifecycle_state FROM projects
      WHERE lower(code) LIKE ? OR lower(title) LIKE ? ORDER BY title LIMIT 50`).all(like, like).map(rowObject);
    const tasks = this.db.prepare(`SELECT id, 'TASK' AS entity_type, title, status, project_id FROM tasks
      WHERE lower(title) LIKE ? ORDER BY title LIMIT 50`).all(like).map(rowObject);
    const shots = this.db.prepare(`SELECT id, 'SHOT' AS entity_type, code, title, lifecycle_state, project_id FROM shots
      WHERE lower(code) LIKE ? OR lower(title) LIKE ? ORDER BY code LIMIT 50`).all(like, like).map(rowObject);
    const characters = this.db.prepare(`SELECT id, 'CHARACTER' AS entity_type, stable_code AS code, display_name AS title, lifecycle_state, project_id FROM characters
      WHERE lower(stable_code) LIKE ? OR lower(display_name) LIKE ? ORDER BY display_name LIMIT 50`).all(like, like).map(rowObject);
    const timelines = this.db.prepare(`SELECT id, 'TIMELINE' AS entity_type, code, title, lifecycle_state, project_id FROM timelines
      WHERE lower(code) LIKE ? OR lower(title) LIKE ? ORDER BY title LIMIT 50`).all(like, like).map(rowObject);
    return { exact: [...projects, ...tasks, ...shots, ...characters, ...timelines], semantic: [], projection_seq: this._projectionSeq(), generated_at: new Date().toISOString() };
  }

  _storageSummary() {
    let bytes = 0;
    if (this.dbPath !== ':memory:') {
      for (const suffix of ['', '-wal', '-shm']) {
        try { bytes += fs.statSync(`${this.dbPath}${suffix}`).size; } catch { /* optional sidecar */ }
      }
    }
    const objectStoreBytes = Number(this.db.prepare(`SELECT COALESCE(SUM(so.byte_size), 0) AS bytes
      FROM storage_objects so WHERE EXISTS (
        SELECT 1 FROM storage_object_locations sol
        WHERE sol.storage_object_id = so.id AND sol.location_role = 'PRIMARY' AND sol.state = 'AVAILABLE'
      )`).get().bytes);
    return { db_path: this.dbPath, bytes, object_store_bytes: objectStoreBytes, object_store_path: this.assetStorePath, cache_bytes: 0, projection_seq: this._projectionSeq(), generated_at: new Date().toISOString() };
  }

  _backups(params = {}) {
    const stateInput = params.state ?? params.states ?? null;
    const state = stateInput === null || stateInput === undefined || stateInput === ''
      ? null : String(stateInput).trim().toUpperCase();
    if (state !== null && !BACKUP_STATES.has(state)) {
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_backup_state', { state });
    }
    const durabilityInput = params.durability_class ?? params.durabilityClass ?? null;
    const durabilityClass = durabilityInput === null || durabilityInput === undefined || durabilityInput === ''
      ? null : enumValue(durabilityInput, 'durability_class', /^[A-Z_]{3,32}$/);
    if (durabilityClass !== null && !BACKUP_DURABILITY_CLASSES.has(durabilityClass)) {
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field: 'durability_class' });
    }
    const limit = Math.min(Math.max(asInt(params.limit, 100), 1), 200);
    const rows = this.db.prepare(`SELECT * FROM backups
      WHERE (? IS NULL OR state = ?)
        AND (? IS NULL OR durability_class = ?)
      ORDER BY created_at_utc_us DESC, id DESC LIMIT ?`).all(state, state, durabilityClass, durabilityClass, limit);
    return {
      backups: rows.map(publicBackup),
      projection_seq: this._projectionSeq(),
      generated_at: new Date().toISOString(),
    };
  }

  _backupDetails(backupId) {
    const row = this._backupRow(backupId);
    const verifications = this.db.prepare(`SELECT * FROM backup_verifications
      WHERE backup_id = ? ORDER BY created_at_utc_us DESC, id DESC`).all(row.id);
    return {
      backup: publicBackup(row),
      verifications: verifications.map(publicBackupVerification),
      projection_seq: this._projectionSeq(),
      generated_at: new Date().toISOString(),
    };
  }

  _backupAdmissionQuery(params = {}) {
    const root = this._backupRoot(params);
    const objectRows = this._backupObjectRows();
    const admission = this._backupAdmission(params, root, objectRows);
    return {
      destination_name: path.basename(root),
      durability_class: admission.durabilityClass,
      failure_domain: admission.failureDomain,
      database_bytes: admission.dbBytes,
      object_bytes: admission.objectBytes,
      estimated_bytes: admission.estimatedBytes,
      available_bytes: admission.availableBytes,
      reserve_bytes: admission.reserve,
      object_count: objectRows.length,
      projection_seq: this._projectionSeq(),
      generated_at: new Date().toISOString(),
    };
  }

  _stagingObjects(params = {}) {
    const stateInput = params.state ?? params.states ?? null;
    const state = stateInput === null || stateInput === undefined || stateInput === '' ? null : String(stateInput).trim().toUpperCase();
    if (state !== null && !STAGING_STATES.has(state)) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_staging_state', { state });
    const limit = Math.min(Math.max(asInt(params.limit, 100), 1), 200);
    const rows = this.db.prepare(`SELECT * FROM staging_objects
      WHERE (? IS NULL OR state = ?)
      ORDER BY updated_at_utc_us DESC, id DESC LIMIT ?`).all(state, state, limit);
    return { items: rows.map(publicStagingObject), projection_seq: this._projectionSeq(), generated_at: new Date().toISOString() };
  }

  subscribe(params = {}) {
    const afterSeq = Math.max(asInt(params.after_seq ?? params.afterSeq, 0), 0);
    const limit = Math.min(Math.max(asInt(params.limit, 100), 1), 500);
    const rows = this.db.prepare('SELECT * FROM domain_events WHERE seq > ? ORDER BY seq ASC LIMIT ?').all(afterSeq, limit);
    return { events: rows.map((row) => this._publicEvent(row)), cursor: { event_seq: rows.length ? Number(rows.at(-1).seq) : afterSeq }, projection_seq: this._projectionSeq(), generated_at: new Date().toISOString() };
  }

  handle(request) {
    const requestId = request?.request_id ?? request?.requestId ?? uuidv7();
    try {
      if (!request || typeof request !== 'object' || Array.isArray(request)) throw new CoreError('INVALID_REQUEST', 'VALIDATION', 'errors.invalid_request', {});
      if (request.api_version !== undefined && String(request.api_version) !== API_VERSION) {
        throw new CoreError('API_VERSION_UNSUPPORTED', 'VALIDATION', 'errors.api_version_unsupported', { api_version: request.api_version });
      }
      if (request.actor_id && request.actor_id !== this.actorId) {
        throw new CoreError('AUTH_REQUIRED', 'AUTH_REQUIRED', 'errors.actor_mismatch', {}, { needsUser: true });
      }
      const method = requiredString(request.method, 'method', 160);
      const params = request.params ?? {};
      let result;
      if (method === 'command.execute') result = this.executeCommand(params);
      else if (method === 'command.plan') result = this.planCommand(params);
      else if (method === 'command.cancel') result = this.cancelCommand(params);
      else if (method === 'command.get') result = this.getCommand(params.command_id ?? params.commandId);
      else if (method === 'command.compensate') throw new CoreError('UNSUPPORTED_COMMAND', 'VALIDATION', 'errors.unsupported_command', { command_type: 'command.compensate' });
      else if (method === 'events.subscribe') result = this.subscribe(params);
      else result = this.query(method, params);
      return { request_id: requestId, ok: true, result, projection_seq: this._projectionSeq(), warnings: [] };
    } catch (error) {
      const coreError = error instanceof CoreError ? error : new CoreError('INTERNAL_ERROR', 'INTERNAL', 'errors.internal', {}, { needsUser: false, technicalDetails: { message: String(error?.message ?? error) } });
      return { request_id: requestId, ok: false, error: coreError.toEnvelope(), projection_seq: this._projectionSeq(), warnings: [] };
    }
  }
}
