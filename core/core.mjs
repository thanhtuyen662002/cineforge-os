import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { initializeDatabase, SCHEMA_VERSION } from './schema.mjs';
import { isUuid, nowUtcUs, rfc3339FromUs, uuidv7 } from './ids.mjs';
import { canonicalJson, idempotencyFingerprint } from './canonical.mjs';
import { preflightRendererToolchain } from './renderer-toolchain.mjs';
import { MEDIA_PROBE_SCHEMA_VERSION, MEDIA_PROBE_PARSER_VERSION, decodeBoundedMediaProbeJson } from './media-probe.mjs';
import { verifyMediaProbeAttestation } from './media-probe-attestation.mjs';
import { runNativeProbeBroker, validateProbeBrokerDescriptor, validateProbeBrokerRequest } from './media-probe-broker.mjs';

export const API_VERSION = '1';
export const CORE_VERSION = '0.1.0';

const CORE_OWNERSHIP_HEARTBEAT_INTERVAL_MS = 2_000;
const CORE_OWNERSHIP_STALE_AFTER_MS = 15_000;
const CORE_OWNERSHIP_LOCK_FILE_SUFFIX = '.core.lock';
const CORE_EPOCH_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;

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
const HANDOFF_DELIVERABLE_TYPES = new Set(['TIMELINE_INTERCHANGE']);
const HANDOFF_SESSION_STATES = new Set(['PLANNED', 'PREFLIGHT', 'BUILDING', 'VALIDATING', 'VERIFIED', 'COMPLETED', 'BLOCKED_RIGHTS', 'BLOCKED_MEDIA', 'FAILED', 'CANCELLED']);
const HANDOFF_COMPATIBILITY_STATUSES = new Set(['NATIVE', 'APPROXIMATED', 'UNSUPPORTED', 'UNKNOWN']);
const HANDOFF_TARGET_PROFILE = 'GENERIC_INTERCHANGE';
const HANDOFF_MANIFEST_SCHEMA_VERSION = 1;
const HANDOFF_COMPATIBILITY_PROFILE_VERSION = 'HANDOFF_COMPATIBILITY_V1';
const RELEASE_CANDIDATE_STATES = new Set(['DRAFT', 'CANCELLED']);
const RELEASE_CANDIDATE_SNAPSHOT_SCHEMA_VERSION = 1;
const RELEASE_BUILD_PLAN_STATES = new Set(['PLANNED']);
const RELEASE_BUILD_PLAN_SNAPSHOT_SCHEMA_VERSION = 1;
const TIMELINE_INTERCHANGE_SCHEMA_VERSION = 1;
const TIMELINE_INTERCHANGE_PROFILE = 'GENERIC_INTERCHANGE_V1';
const TIMELINE_INTERCHANGE_MAX_BYTES = 8 * 1024 * 1024;
const TIMELINE_INTERCHANGE_MAX_TRACKS = 64;
const TIMELINE_INTERCHANGE_MAX_CLIPS = 10_000;
const TIMELINE_INTERCHANGE_MAX_MARKERS = 10_000;
const TIMELINE_INTERCHANGE_MAX_ARTIFACTS = 10_000;
const TIMELINE_INTERCHANGE_DOWNLOAD_MAX_RANGE_BYTES = 16 * 1024 * 1024;
const TIMELINE_INTERCHANGE_DOWNLOAD_MAX_FULL_BYTES = 32 * 1024 * 1024;
const TIMELINE_INTERCHANGE_DOWNLOAD_AUDIENCE = 'LOCAL_TIMELINE_INTERCHANGE_DOWNLOAD';
const TIMELINE_INTERCHANGE_MUTATING_COMMANDS = new Set(['BuildTimelineInterchangeExport']);
const EXTERNAL_EDIT_MUTATING_COMMANDS = new Set(['RegisterExternalEdit']);
const MEDIA_PROBE_MUTATING_COMMANDS = new Set(['ProbeMediaAsset', 'CancelMediaProbe', 'RetryMediaProbe']);
const MEDIA_PROBE_BLOCKED_STATES = new Set(['BLOCKED_MEDIA', 'BLOCKED_RIGHTS', 'BLOCKED_TOOLCHAIN']);
const MEDIA_PROBE_NEXT_STEPS = Object.freeze({
  BLOCKED_MEDIA: 'Cần nguồn video/âm thanh managed khả dụng; đăng ký nguồn đúng rồi gửi lệnh kiểm tra mới.',
  BLOCKED_RIGHTS: 'Cần bổ sung quyền và đồng thuận SOURCE_USE cho MEDIA_INSPECTION rồi gửi lệnh kiểm tra mới.',
  BLOCKED_TOOLCHAIN: 'CineForge chưa có bộ thực thi kiểm tra media được chứng nhận; cần bổ sung bộ thực thi trước khi kiểm tra.',
  STALE: 'Nguồn hoặc quyền đã thay đổi; cần gửi lệnh kiểm tra mới cho danh tính hiện tại.',
  UNKNOWN: 'CineForge chưa có bằng chứng kỹ thuật được xác minh cho revision này.',
  CANCELLED: 'Đã hủy yêu cầu chưa chạy; có thể gửi yêu cầu kiểm tra mới.',
});
// Slice 3A is deliberately a single built-in local capability.  It reads a
// registered managed object and records bounded evidence; it never dispatches
// to a provider, network endpoint or shell command.
const LOCAL_PROBE_MUTATING_COMMANDS = new Set([
  'RunManagedAssetIntegrityProbe',
  'CancelManagedAssetIntegrityProbe',
  'RetryManagedAssetIntegrityProbe',
]);
const LOCAL_PROBE_JOB_TYPE = 'STORAGE_OBJECT_INTEGRITY_PROBE';
const LOCAL_PROBE_CAPABILITY = 'STORAGE_OBJECT_INTEGRITY_PROBE';
const LOCAL_PROBE_CONNECTOR_VERSION = 'LOCAL_ASSET_PROBE_V1';
const LOCAL_PROBE_STATES = new Set([
  'QUEUED', 'CLAIMED', 'RUNNING', 'CANCELLATION_REQUESTED',
  'CANCELLED_CONFIRMED', 'CANNOT_CANCEL', 'COMPLETED',
  'COMPLETED_AFTER_CANCEL', 'FAILED_RETRYABLE', 'FAILED_FINAL',
]);
const LOCAL_PROBE_TERMINAL_STATES = new Set([
  'CANCELLED_CONFIRMED', 'CANNOT_CANCEL', 'COMPLETED',
  'COMPLETED_AFTER_CANCEL', 'FAILED_FINAL',
]);
const LOCAL_PROBE_ATTEMPT_STATES = new Set(['CREATED', 'DISPATCHING', 'EXECUTING', 'VERIFYING', 'SUCCEEDED', 'FAILED', 'ABANDONED']);
const LOCAL_PROBE_MAX_ATTEMPTS = 3;
// Integrity probes yield between asynchronous stream chunks so the Core
// event loop remains responsive to health/cancel requests.  Keep the caller
// budget bounded below the multi-gigabyte upload limit; a larger verification
// must be a separately admitted cancellable job rather than a synchronous
// query-side read.
const LOCAL_PROBE_MAX_BYTES = 512 * 1024 * 1024;
const LOCAL_PROBE_DEFAULT_MAX_BYTES = 256 * 1024 * 1024;
const LOCAL_PROBE_CHUNK_BYTES = 1024 * 1024;
const LOCAL_PROBE_TIMEOUT_MS = 2 * 60 * 1000;
// Browser intake is a local-only upload boundary.  Keep the limit explicit so
// a malformed/chunked request cannot consume unbounded disk space while the
// stream is being verified.  Large production media can still be imported by
// the path-based COPY flow, which uses the same durable staging lifecycle.
const DESKTOP_STAGE_MAX_BYTES = 4 * 1024 * 1024 * 1024;
const DESKTOP_STAGE_MAX_FILENAME_BYTES = 500;
const DESKTOP_STAGE_MAX_MIME_BYTES = 200;
const EXTERNAL_EDIT_MAX_BYTES = TIMELINE_INTERCHANGE_MAX_BYTES;
const EXTERNAL_EDIT_MAX_DEPTH = 32;
const EXTERNAL_EDIT_MAX_NODES = 50_000;
const EXTERNAL_EDIT_MAX_KEYS_PER_OBJECT = 2_000;
const EXTERNAL_EDIT_MAX_STRING_BYTES = 128 * 1024;
const EXTERNAL_EDIT_ALLOWED_TOP_LEVEL_KEYS = new Set([
  'manifest_type', 'manifest_schema_version', 'export_profile', 'deliverable_type', 'source', 'artifact_allowlist', 'sanitization',
]);
const EXTERNAL_EDIT_ALLOWED_SOURCE_KEYS = new Set([
  'project_id', 'timeline_id', 'timeline_revision_id', 'revision_number', 'content_hash', 'duration', 'media_profile', 'review', 'tracks', 'markers',
]);
const EXTERNAL_EDIT_ALLOWED_MEDIA_PROFILE_KEYS = new Set([
  'revision_id', 'timeline_rate', 'time_base', 'pixel_aspect', 'width', 'height', 'working_color_space', 'transfer_function', 'hdr_policy', 'audio_sample_rate', 'audio_channel_layout',
]);
const EXTERNAL_EDIT_ALLOWED_REVIEW_KEYS = new Set(['session_id', 'decision', 'dependency_snapshot_hash', 'subject_content_hash']);
const RELEASE_CANDIDATE_EVIDENCE_KEYS = new Set([
  'asset_revision_id', 'asset_count', 'availability_state', 'availability_evidence_state', 'review_state',
  'asset_lifecycle_state', 'storage_class', 'location_state', 'rights_status', 'cue_count', 'track_count',
  'review_count', 'approved_candidate_count', 'clip_count', 'media_profile_revision_id', 'timeline_id',
  'timeline_revision_id', 'content_hash', 'state', 'width', 'height', 'audio_sample_rate', 'id', 'title',
  'severity', 'blocking_scope_type', 'stale', 'locale', 'segment_count', 'asset_state', 'review_session_id',
  'decision', 'count', 'assets', 'cues', 'tracks', 'reviews', 'items', 'projection_error',
]);
const TIMELINE_WORKING_SESSION_STATES = new Set(['OPEN', 'DIRTY', 'AUTOSAVING', 'CHECKPOINTING', 'CLEAN', 'CONFLICT', 'RECOVERY_REQUIRED', 'CLOSED', 'ABANDONED']);
const TIMELINE_WORKING_ACTIVE_STATES = new Set(['OPEN', 'DIRTY', 'AUTOSAVING', 'CHECKPOINTING', 'CLEAN', 'CONFLICT', 'RECOVERY_REQUIRED']);
const TIMELINE_WORKING_EDITABLE_STATES = new Set(['OPEN', 'DIRTY', 'CLEAN']);
const TIMELINE_WORKING_OP_TYPES = new Set(['INSERT_CLIP', 'MOVE_CLIP', 'TRIM_CLIP', 'DELETE_CLIP', 'ADD_MARKER']);
const TIMELINE_WORKING_UNSUPPORTED_OP_TYPES = new Set(['SPLIT_CLIP', 'RETIME_CLIP', 'SET_TRANSFORM', 'SET_GAIN', 'LINK', 'UNLINK', 'ADD_TRANSITION', 'REMOVE_TRANSITION', 'UPDATE_CAPTION']);
const TIMELINE_WORKING_MODES = new Set(['EXCLUSIVE', 'BRANCH_REQUIRED']);
const TIMELINE_WORKING_MUTATING_COMMANDS = new Set([
  'BeginTimelineWorkingSession',
  'ApplyTimelineEditOp',
  'UndoTimelineEditOp',
  'RedoTimelineEditOp',
  'AutosaveTimelineWorkingSession',
  'CheckpointTimelineWorkingSession',
  'CloseTimelineWorkingSession',
]);
const TIMING_METADATA_MUTATING_COMMANDS = new Set([
  'CreateAudioCueRevision', 'TransitionAudioCueRevision',
  'CreateSubtitleTrackRevision', 'TransitionSubtitleTrackRevision',
]);
const RELEASE_CANDIDATE_MUTATING_COMMANDS = new Set(['CreateReleaseCandidateDraft', 'CancelReleaseCandidateDraft']);
const RELEASE_BUILD_PLAN_MUTATING_COMMANDS = new Set(['CreateReleaseBuildPlan']);
const MAX_TIMELINE_WORKING_OPS = 10_000;
const MAX_TIMELINE_WORKING_BATCH = 32;
const MAX_TIMELINE_CLIENT_ID = 200;
const TIMELINE_TRACK_TYPES = new Set(['VIDEO', 'AUDIO', 'CAPTION', 'DATA']);
const MAX_RATIONAL_COMPONENT = 9_000_000_000;
const MAX_TIMELINE_TRACKS = 64;
const MAX_TIMELINE_CLIPS_PER_TRACK = 10_000;
const MAX_TIMELINE_MARKERS = 10_000;
const MAX_TIMELINE_DURATION_TICKS = 9_000_000_000;
const AUDIO_CUE_TYPES = new Set(['DIALOGUE', 'ADR', 'NONVERBAL', 'FOLEY', 'SFX', 'AMBIENCE', 'ROOM_TONE', 'MUSIC', 'SILENCE']);
const AUDIO_CUE_STATES = new Set(['DRAFT', 'CANDIDATE', 'SELECTED', 'APPROVED', 'STALE', 'REJECTED']);
const AUDIO_CUE_TRANSITIONS = Object.freeze({
  DRAFT: new Set(['CANDIDATE', 'REJECTED']),
  CANDIDATE: new Set(['SELECTED', 'REJECTED']),
  SELECTED: new Set(['REJECTED']),
  APPROVED: new Set(['STALE']),
  STALE: new Set(['DRAFT']),
  REJECTED: new Set(),
});
const SUBTITLE_TRACK_STATES = new Set(['DRAFT', 'TIMED', 'REVIEWED', 'APPROVED', 'STALE', 'REJECTED']);
const SUBTITLE_TRACK_TRANSITIONS = Object.freeze({
  DRAFT: new Set(['TIMED', 'REJECTED']),
  TIMED: new Set(['REVIEWED', 'REJECTED']),
  REVIEWED: new Set(['REJECTED']),
  APPROVED: new Set(['STALE']),
  STALE: new Set(['DRAFT']),
  REJECTED: new Set(),
});
const MAX_AUDIO_CUE_TITLE = 200;
const MAX_AUDIO_INTENT = 8_000;
const MAX_SUBTITLE_SEGMENTS = 2_000;
const MAX_SUBTITLE_TEXT = 2_000;
const MAX_SUBTITLE_LOCALE = 32;
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
// Restore activation is intentionally outside the V1 local backup slice.  The
// read-only estimate still needs a deterministic, explicitly labelled timing
// model so the desktop can distinguish a useful byte estimate from observed
// recovery evidence.  This is an IO-only planning rate, never a progress claim.
const BACKUP_RESTORE_ESTIMATE_THROUGHPUT_BYTES_PER_SECOND = 64 * 1024 * 1024;
const BACKUP_RESTORE_ESTIMATE_SCHEMA_VERSION = 1;
const BACKUP_MAX_MANIFEST_OBJECTS = 200_000;
// Storage scrub is intentionally a bounded read-only projection in the V1
// slice.  It proves the registered CAS identity for a finite byte budget; it
// never creates scrub rows, updates verification timestamps, repairs bytes or
// deletes anything.  Larger/full scans belong to the future RunStorageScrub
// command and must be scheduled with an explicit IO budget.
const STORAGE_SCRUB_DEFAULT_MAX_OBJECTS = 100;
const STORAGE_SCRUB_MAX_OBJECTS = 200;
const STORAGE_SCRUB_DEFAULT_MAX_BYTES = 256 * 1024 * 1024;
const STORAGE_SCRUB_MAX_BYTES = 4 * 1024 * 1024 * 1024;
const SHA256_HEX = /^[a-f0-9]{64}$/i;
const MAX_ASSET_METADATA_BYTES = 64 * 1024;
// Media preview is deliberately a narrow inspection capability.  It never
// exposes a storage path or turns the managed CAS into a general file server.
const MEDIA_PREVIEW_PURPOSES = new Set(['LIBRARY_PREVIEW', 'TIMELINE_PREVIEW']);
const MEDIA_PREVIEW_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/flac',
  'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-matroska',
]);
const MEDIA_PREVIEW_DEFAULT_TTL_MS = 60 * 1000;
const MEDIA_PREVIEW_MAX_TTL_MS = 5 * 60 * 1000;
const MEDIA_PREVIEW_MAX_TOKENS = 4096;
const MEDIA_PREVIEW_MAX_FULL_BYTES = 64 * 1024 * 1024;
const MEDIA_PREVIEW_MAX_RANGE_BYTES = 16 * 1024 * 1024;
const MEDIA_PREVIEW_AUDIENCE = 'LOCAL_MEDIA_PREVIEW';
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
      technical_details: publicTechnicalDetails(this.technicalDetails),
    };
  }
}

function json(value) {
  return JSON.stringify(value ?? {});
}

// Error envelopes are persisted in command records and returned across the
// local HTTP boundary. Preserve useful error codes/values while removing
// absolute filesystem paths that can appear in native exception messages.
const ABSOLUTE_PATH_IN_ERROR = /(?:[A-Za-z]:[\\/][^"'<>|;\r\n]*|\\\\[^"'<>|;\r\n]+|(?:file:)?\/\/[^"'<>|;\r\n]+|\/(?:Users|home|tmp|var|private|mnt|opt|etc|workspace|data|srv|run|root)\/[^"'<>|;\r\n]*)/gi;
function publicTechnicalDetails(value) {
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.replace(ABSOLUTE_PATH_IN_ERROR, '[path redacted]');
  if (Array.isArray(value)) return value.map((item) => publicTechnicalDetails(item));
  if (typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value)) result[key] = publicTechnicalDetails(item);
    return result;
  }
  return String(value).replace(ABSOLUTE_PATH_IN_ERROR, '[path redacted]');
}

function parseJson(value, fallback = {}) {
  if (value === null || value === undefined || value === '') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

/**
 * Parse a returned interchange with duplicate-key and resource bounds.  A
 * plain JSON.parse accepts duplicate object keys (last value wins), which
 * would make a signed/hashed document ambiguous.  This small recursive
 * descent parser is intentionally only used for the bounded interchange
 * profile; all values are still required to round-trip through canonicalJson.
 */
function parseStrictCanonicalJson(text, limits = {}) {
  if (typeof text !== 'string') throw new Error('JSON_TEXT_REQUIRED');
  const maxDepth = limits.maxDepth ?? EXTERNAL_EDIT_MAX_DEPTH;
  const maxNodes = limits.maxNodes ?? EXTERNAL_EDIT_MAX_NODES;
  const maxKeys = limits.maxKeys ?? EXTERNAL_EDIT_MAX_KEYS_PER_OBJECT;
  const maxStringBytes = limits.maxStringBytes ?? EXTERNAL_EDIT_MAX_STRING_BYTES;
  if (Buffer.byteLength(text, 'utf8') > (limits.maxBytes ?? EXTERNAL_EDIT_MAX_BYTES)) throw new Error('JSON_TOO_LARGE');
  let valueText;
  try {
    valueText = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(text, 'utf8'));
  } catch { throw new Error('JSON_INVALID_UTF8'); }
  if (valueText !== text) throw new Error('JSON_INVALID_UTF8');
  let index = 0;
  let nodes = 0;
  const fail = (code) => { throw new Error(code); };
  const skip = () => { while (index < text.length && /\s/.test(text[index])) index += 1; };
  const countNode = (depth) => {
    nodes += 1;
    if (nodes > maxNodes) fail('JSON_TOO_MANY_NODES');
    if (depth > maxDepth) fail('JSON_TOO_DEEP');
  };
  const parseString = () => {
    const start = index;
    if (text[index] !== '"') fail('JSON_STRING_EXPECTED');
    index += 1;
    let escaped = false;
    while (index < text.length) {
      const char = text[index];
      if (char === '"' && !escaped) {
        index += 1;
        const raw = text.slice(start, index);
        let parsed;
        try { parsed = JSON.parse(raw); } catch { fail('JSON_STRING_INVALID'); }
        if (Buffer.byteLength(parsed, 'utf8') > maxStringBytes) fail('JSON_STRING_TOO_LARGE');
        return parsed;
      }
      if (char.charCodeAt(0) < 0x20 && !escaped) fail('JSON_CONTROL_CHARACTER');
      if (char === '\\' && !escaped) escaped = true;
      else escaped = false;
      index += 1;
    }
    fail('JSON_STRING_UNTERMINATED');
  };
  const parseNumber = () => {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(index));
    if (!match) fail('JSON_NUMBER_INVALID');
    index += match[0].length;
    const number = Number(match[0]);
    if (!Number.isFinite(number)) fail('JSON_NUMBER_INVALID');
    return number;
  };
  const parseValue = (depth) => {
    skip();
    countNode(depth);
    const char = text[index];
    if (char === '"') return parseString();
    if (char === '{') {
      index += 1;
      const object = {};
      const keys = new Set();
      skip();
      if (text[index] === '}') { index += 1; return object; }
      while (index < text.length) {
        skip();
        if (text[index] !== '"') fail('JSON_OBJECT_KEY_EXPECTED');
        const key = parseString();
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') fail('JSON_UNSAFE_KEY');
        if (keys.has(key)) fail('JSON_DUPLICATE_KEY');
        keys.add(key);
        if (keys.size > maxKeys) fail('JSON_TOO_MANY_KEYS');
        skip();
        if (text[index] !== ':') fail('JSON_COLON_EXPECTED');
        index += 1;
        object[key] = parseValue(depth + 1);
        skip();
        if (text[index] === '}') { index += 1; return object; }
        if (text[index] !== ',') fail('JSON_COMMA_EXPECTED');
        index += 1;
      }
      fail('JSON_OBJECT_UNTERMINATED');
    }
    if (char === '[') {
      index += 1;
      const array = [];
      skip();
      if (text[index] === ']') { index += 1; return array; }
      while (index < text.length) {
        array.push(parseValue(depth + 1));
        skip();
        if (text[index] === ']') { index += 1; return array; }
        if (text[index] !== ',') fail('JSON_COMMA_EXPECTED');
        index += 1;
      }
      fail('JSON_ARRAY_UNTERMINATED');
    }
    if (text.startsWith('true', index)) { index += 4; return true; }
    if (text.startsWith('false', index)) { index += 5; return false; }
    if (text.startsWith('null', index)) { index += 4; return null; }
    if (char === '-' || /\d/.test(char ?? '')) return parseNumber();
    fail('JSON_VALUE_INVALID');
  };
  skip();
  const value = parseValue(0);
  skip();
  if (index !== text.length) fail('JSON_TRAILING_DATA');
  if (canonicalJson(value) !== text) fail('JSON_NOT_CANONICAL');
  return value;
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
  if (numerator <= 0n || denominator <= 0n) {
    throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field: 'duration' });
  }
  let a = numerator;
  let b = denominator;
  while (b !== 0n) {
    const next = a % b;
    a = b;
    b = next;
  }
  const divisor = a || 1n;
  const reducedNumerator = numerator / divisor;
  const reducedDenominator = denominator / divisor;
  if (reducedNumerator > BigInt(MAX_RATIONAL_COMPONENT) || reducedDenominator > BigInt(MAX_RATIONAL_COMPONENT)) {
    throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field: 'duration' });
  }
  return { num: Number(reducedNumerator), den: Number(reducedDenominator) };
}

function rationalAdd(left, right) {
  const numerator = BigInt(left.num) * BigInt(right.den) + BigInt(right.num) * BigInt(left.den);
  const denominator = BigInt(left.den) * BigInt(right.den);
  const gcd = (a, b) => {
    let x = a < 0n ? -a : a;
    let y = b < 0n ? -b : b;
    while (y !== 0n) {
      const next = x % y;
      x = y;
      y = next;
    }
    return x || 1n;
  };
  const divisor = gcd(numerator, denominator);
  const reducedNumerator = numerator / divisor;
  const reducedDenominator = denominator / divisor;
  if (reducedNumerator < 0n || reducedNumerator > BigInt(MAX_RATIONAL_COMPONENT) || reducedDenominator < 1n || reducedDenominator > BigInt(MAX_RATIONAL_COMPONENT)) {
    throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field: 'rational' });
  }
  return { num: Number(reducedNumerator), den: Number(reducedDenominator) };
}

function timelineMarkerSortKey(marker) {
  return canonicalJson({
    markerType: marker.markerType ?? marker.marker_type ?? 'NOTE',
    label: marker.label ?? '',
    payload: marker.payload ?? {},
  });
}

function compareTimelineMarkers(left, right) {
  return rationalCompare(left.time, right.time) || timelineMarkerSortKey(left).localeCompare(timelineMarkerSortKey(right));
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

function publicJobAttempt(row) {
  if (!row) return null;
  const out = rowObject(row);
  for (const field of ['started_at_utc_us', 'finished_at_utc_us', 'created_at_utc_us']) {
    if (out[field] !== undefined && out[field] !== null) out[field.replace('_utc_us', '')] = rfc3339FromUs(out[field]);
    delete out[field];
  }
  // Fencing tokens and raw error details are Core-internal.  Callers receive
  // a bounded error code and a human-readable next step from the job row.
  delete out.fencing_token;
  delete out.error_details_json;
  return out;
}

function publicJobEvidence(row) {
  if (!row) return null;
  const out = rowObject(row);
  if (out.created_at_utc_us !== undefined && out.created_at_utc_us !== null) out.created_at = rfc3339FromUs(out.created_at_utc_us);
  delete out.created_at_utc_us;
  const parsedEvidence = parseJson(out.evidence_json, {});
  // Evidence is a typed, bounded public projection. Never forward internal
  // diagnostics or future connector fields just because they happened to be
  // persisted in the JSON column.
  out.evidence = {};
  if (parsedEvidence && typeof parsedEvidence === 'object' && !Array.isArray(parsedEvidence)) {
    if (typeof parsedEvidence.late_after_cancel === 'boolean') out.evidence.late_after_cancel = parsedEvidence.late_after_cancel;
    if (typeof parsedEvidence.connector_version === 'string' && parsedEvidence.connector_version.length <= 120) {
      out.evidence.connector_version = parsedEvidence.connector_version;
    }
  }
  delete out.evidence_json;
  return out;
}

function publicJob(row, attempt = null, evidence = null, usage = null) {
  if (!row) return null;
  const out = rowObject(row);
  for (const field of ['created_at_utc_us', 'updated_at_utc_us']) {
    if (out[field] !== undefined && out[field] !== null) out[field.replace('_utc_us', '')] = rfc3339FromUs(out[field]);
    delete out[field];
  }
  out.needs_user = Boolean(out.needs_user);
  out.cancelable = ['QUEUED', 'CLAIMED', 'RUNNING'].includes(String(out.state));
  out.retryable = out.state === 'FAILED_RETRYABLE'
    && Number.isSafeInteger(Number(attempt?.attempt_no))
    && Number(attempt.attempt_no) < LOCAL_PROBE_MAX_ATTEMPTS;
  out.latest_attempt = publicJobAttempt(attempt);
  out.evidence = publicJobEvidence(evidence);
  if (usage) out.usage = {
    resource_type: usage.resource_type,
    reserved_amount: Number(usage.reserved_amount),
    actual_amount: usage.actual_amount === null || usage.actual_amount === undefined ? null : Number(usage.actual_amount),
    state: usage.state,
  };
  delete out.command_id;
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

function publicAudioCue(row) {
  if (!row) return null;
  const out = {
    id: row.id,
    project_id: row.project_id,
    timeline_id: row.timeline_id,
    cue_type: row.cue_type,
    title: row.title,
    row_version: Number(row.row_version ?? 1),
  };
  if (row.created_at_utc_us !== undefined) out.created_at = rfc3339FromUs(row.created_at_utc_us);
  if (row.updated_at_utc_us !== undefined) out.updated_at = rfc3339FromUs(row.updated_at_utc_us);
  return out;
}

function publicAudioCueRevision(row, options = {}) {
  if (!row) return null;
  const out = {
    id: row.id,
    audio_cue_id: row.audio_cue_id,
    revision_number: Number(row.revision_number),
    lifecycle_state: options.stale ? 'STALE' : row.lifecycle_state,
    timeline_revision_id: row.timeline_revision_id,
    timeline_content_hash: String(row.timeline_content_hash ?? '').toLowerCase(),
    // Public Issue #29 contract names the pin as a timing dependency. Keep
    // the timeline aliases for existing clients while making the immutable
    // dependency explicit at the API boundary.
    timing_dependency_revision_id: row.timeline_revision_id,
    timing_dependency_content_hash: String(row.timeline_content_hash ?? '').toLowerCase(),
    timing_dependency_hash: String(row.timing_dependency_hash ?? '').toLowerCase(),
    start: { num: Number(row.start_num), den: Number(row.start_den) },
    end: { num: Number(row.end_num), den: Number(row.end_den) },
    intent_text: row.intent_text ?? '',
    selected_asset_revision_id: row.selected_asset_revision_id ?? null,
    asset_snapshot_hash: row.asset_snapshot_hash ?? null,
    row_version: Number(row.row_version ?? 1),
    stale: Boolean(options.stale),
    stale_reason: options.staleReason ?? null,
    next_step: options.nextStep ?? null,
  };
  if (row.created_at_utc_us !== undefined) out.created_at = rfc3339FromUs(row.created_at_utc_us);
  return out;
}

function publicSubtitleTrack(row) {
  if (!row) return null;
  const out = {
    id: row.id,
    project_id: row.project_id,
    timeline_id: row.timeline_id,
    locale: row.locale,
    title: row.title,
    row_version: Number(row.row_version ?? 1),
  };
  if (row.created_at_utc_us !== undefined) out.created_at = rfc3339FromUs(row.created_at_utc_us);
  if (row.updated_at_utc_us !== undefined) out.updated_at = rfc3339FromUs(row.updated_at_utc_us);
  return out;
}

function publicSubtitleSegment(row) {
  if (!row) return null;
  return {
    id: row.id,
    segment_index: Number(row.segment_index),
    start: { num: Number(row.start_num), den: Number(row.start_den) },
    end: { num: Number(row.end_num), den: Number(row.end_den) },
    locale: row.locale,
    text: row.text,
  };
}

function publicSubtitleTrackRevision(row, segments = [], options = {}) {
  if (!row) return null;
  const out = {
    id: row.id,
    subtitle_track_id: row.subtitle_track_id,
    revision_number: Number(row.revision_number),
    lifecycle_state: options.stale ? 'STALE' : row.lifecycle_state,
    timeline_revision_id: row.timeline_revision_id,
    timeline_content_hash: String(row.timeline_content_hash ?? '').toLowerCase(),
    timing_dependency_revision_id: row.timeline_revision_id,
    timing_dependency_content_hash: String(row.timeline_content_hash ?? '').toLowerCase(),
    timing_dependency_hash: String(row.timing_dependency_hash ?? '').toLowerCase(),
    format_profile: row.format_profile,
    segments: segments.map(publicSubtitleSegment).filter(Boolean),
    row_version: Number(row.row_version ?? 1),
    stale: Boolean(options.stale),
    stale_reason: options.staleReason ?? null,
    next_step: options.nextStep ?? null,
  };
  if (row.created_at_utc_us !== undefined) out.created_at = rfc3339FromUs(row.created_at_utc_us);
  return out;
}

function publicTimelineWorkingSession(row, draft = {}, operations = [], historyActions = []) {
  if (!row) return null;
  const out = {
    id: row.id,
    timeline_id: row.timeline_id,
    base_revision_id: row.base_revision_id,
    base_revision_row_version: Number(row.base_revision_row_version),
    base_content_hash: String(row.base_content_hash ?? '').toLowerCase(),
    actor_id: row.actor_id,
    client_instance_id: row.client_instance_id,
    mode: row.mode,
    state: row.state,
    draft_hash: String(row.draft_hash ?? '').toLowerCase(),
    autosaved_hash: String(row.autosaved_hash ?? '').toLowerCase(),
    draft,
    last_acknowledged_op_seq: Number(row.last_acknowledged_op_seq ?? 0),
    history_cursor_seq: Number(row.history_cursor_seq ?? 0),
    next_op_seq: Number(row.next_op_seq ?? 1),
    last_checkpoint_revision_id: row.last_checkpoint_revision_id ?? null,
    next_step: row.next_step ?? null,
    row_version: Number(row.row_version ?? 1),
    last_autosave_at: row.last_autosave_at_utc_us ? rfc3339FromUs(row.last_autosave_at_utc_us) : null,
    created_at: row.created_at_utc_us ? rfc3339FromUs(row.created_at_utc_us) : null,
    updated_at: row.updated_at_utc_us ? rfc3339FromUs(row.updated_at_utc_us) : null,
    closed_at: row.closed_at_utc_us ? rfc3339FromUs(row.closed_at_utc_us) : null,
    operations: operations.map((operation) => ({
      id: operation.id,
      op_seq: Number(operation.op_seq),
      op_type: operation.op_type,
      history_state: operation.history_state,
      result_hash: String(operation.result_hash ?? '').toLowerCase(),
      actor_id: operation.actor_id,
      created_at: operation.created_at_utc_us ? rfc3339FromUs(operation.created_at_utc_us) : null,
    })),
    history_actions: historyActions.map((action) => ({
      id: action.id,
      action_seq: Number(action.action_seq),
      action_type: action.action_type,
      target_op_seq: action.target_op_seq === null || action.target_op_seq === undefined ? null : Number(action.target_op_seq),
      target_op_id: action.target_op_id ?? null,
      before_hash: String(action.before_hash ?? '').toLowerCase(),
      after_hash: String(action.after_hash ?? '').toLowerCase(),
      actor_id: action.actor_id,
      created_at: action.created_at_utc_us ? rfc3339FromUs(action.created_at_utc_us) : null,
    })),
  };
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

function publicExportSession(row) {
  if (!row) return null;
  const out = {};
  for (const field of [
    'id', 'project_id', 'timeline_revision_id', 'deliverable_type', 'target_profile', 'target_editor', 'target_version',
    'state', 'output_manifest_id', 'output_asset_revision_id', 'output_content_hash', 'output_byte_size',
    'validation_snapshot_json', 'command_id', 'review_session_id', 'dependency_snapshot_hash', 'subject_content_hash',
    'media_profile_revision_id', 'next_step',
  ]) if (Object.prototype.hasOwnProperty.call(row, field)) out[field] = row[field];
  for (const field of ['target_profile', 'target_editor', 'target_version', 'next_step']) {
    if (typeof out[field] === 'string') out[field] = safeReleaseCandidateText(out[field]) ?? '';
  }
  // Validation evidence is safe metadata, never raw generated output.  Keep
  // the public projection bounded and avoid exposing stored JSON wholesale.
  if (typeof out.validation_snapshot_json === 'string') {
    const snapshot = parseJson(out.validation_snapshot_json, {});
    out.validation_snapshot = {
      schema_version: Number.isSafeInteger(Number(snapshot.schema_version)) ? Number(snapshot.schema_version) : 0,
      export_profile: typeof snapshot.export_profile === 'string' ? safeReleaseCandidateText(snapshot.export_profile)?.slice(0, 80) ?? '[redacted]' : null,
      artifact_count: Number.isSafeInteger(Number(snapshot.artifact_count)) && Number(snapshot.artifact_count) >= 0 ? Number(snapshot.artifact_count) : 0,
      clip_count: Number.isSafeInteger(Number(snapshot.clip_count)) && Number(snapshot.clip_count) >= 0 ? Number(snapshot.clip_count) : 0,
      document_hash: SHA256_HEX.test(String(snapshot.document_hash ?? '')) ? String(snapshot.document_hash).toLowerCase() : null,
      verified_at: typeof snapshot.verified_at === 'string' ? safeReleaseCandidateText(snapshot.verified_at)?.slice(0, 80) ?? '[redacted]' : null,
      error_code: typeof snapshot.error_code === 'string' ? safeReleaseCandidateText(snapshot.error_code)?.slice(0, 120) ?? '[redacted]' : null,
    };
  }
  // Never let the raw persisted JSON (including a legacy BLOB/tampered value)
  // cross the Core boundary.  Only the bounded allowlist above is public.
  delete out.validation_snapshot_json;
  out.row_version = Number(row.row_version ?? 1);
  if (row.created_at_utc_us !== undefined && row.created_at_utc_us !== null) out.created_at = rfc3339FromUs(row.created_at_utc_us);
  if (row.updated_at_utc_us !== undefined && row.updated_at_utc_us !== null) out.updated_at = rfc3339FromUs(row.updated_at_utc_us);
  return out;
}

function publicHandoffManifest(row, options = {}) {
  if (!row) return null;
  const out = rowObject(row);
  if (out.created_at_utc_us !== undefined && out.created_at_utc_us !== null) out.created_at = rfc3339FromUs(out.created_at_utc_us);
  for (const field of ['target_editor', 'target_version', 'compatibility_profile_version']) {
    if (typeof out[field] === 'string') out[field] = safeReleaseCandidateText(out[field]) ?? '[redacted]';
  }
  out.artifact_allowlist = sanitizePublicMetadata(parseJson(out.artifact_allowlist_json, []));
  out.compatibility_report = sanitizePublicMetadata(parseJson(out.compatibility_report_json, {}));
  out.sanitization_report = sanitizePublicMetadata(parseJson(out.sanitization_report_json, {}));
  out.compatibility = out.compatibility_report;
  out.sanitization = out.sanitization_report;
  out.sanitizationReport = {
    ...out.sanitization_report,
    removedFields: Array.isArray(out.sanitization_report?.removed_fields) ? out.sanitization_report.removed_fields : [],
    nextStep: out.sanitization_report?.next_step ?? null,
  };
  const storedManifest = parseJson(out.manifest_json, {});
  out.manifest = sanitizePublicMetadata(storedManifest);
  out.manifest_hash = String(out.manifest_hash ?? '').toLowerCase();
  const storedCanonical = canonicalJson(storedManifest);
  const publicCanonical = canonicalJson(out.manifest);
  const storedCanonicalHash = crypto.createHash('sha256').update(storedCanonical, 'utf8').digest('hex');
  out.public_manifest_hash = crypto.createHash('sha256').update(publicCanonical, 'utf8').digest('hex');
  out.manifest_hash_verified = storedCanonicalHash === out.manifest_hash && out.public_manifest_hash === out.manifest_hash;
  if (!out.manifest_hash_verified) {
    // Rows written before the public-safe hash contract may contain redacted
    // fields in immutable storage.  Keep the original identity for audit,
    // expose only the safe projection plus its separate digest, and make the
    // required repair explicit instead of returning a misleading hash.
    out.manifest_compatibility = {
      state: 'LEGACY_UNVERIFIED',
      next_step: 'Tạo lại handoff manifest từ revision/review hiện tại để có manifest hash public có thể kiểm chứng.',
    };
  }
  delete out.created_at_utc_us;
  delete out.manifest_json;
  delete out.artifact_allowlist_json;
  delete out.compatibility_report_json;
  delete out.sanitization_report_json;
  if (options.includeManifestJson === true) out.manifest_json = canonicalJson(out.manifest);
  return out;
}

function publicExternalEdit(row, diffs = []) {
  if (!row) return null;
  const out = {};
  for (const field of [
    'id', 'project_id', 'handoff_manifest_id', 'export_session_id', 'timeline_revision_id',
    'returned_asset_revision_id', 'returned_interchange_asset_revision_id', 'lineage_confidence',
    'validation_state', 'source_document_hash', 'source_document_byte_size', 'source_manifest_hash',
    'source_revision_content_hash', 'source_dependency_snapshot_hash', 'source_review_session_id',
    'returned_rights_status', 'contract_diff_count', 'next_step', 'row_version', 'command_id',
  ]) if (Object.prototype.hasOwnProperty.call(row, field)) out[field] = row[field];
  out.validation_snapshot = sanitizePublicMetadata(parseJson(row.validation_snapshot_json, {}));
  out.contract_diffs = diffs.map((diff) => ({
    id: diff.id,
    external_edit_id: diff.external_edit_id,
    project_id: diff.project_id,
    diff_type: diff.diff_type,
    severity: diff.severity,
    before: sanitizePublicMetadata(parseJson(diff.before_json, {})),
    after: sanitizePublicMetadata(parseJson(diff.after_json, {})),
    resolution_state: diff.resolution_state,
    created_by_actor_id: diff.created_by_actor_id,
    created_at: diff.created_at_utc_us ? rfc3339FromUs(diff.created_at_utc_us) : null,
  }));
  if (row.created_at_utc_us !== undefined && row.created_at_utc_us !== null) out.created_at = rfc3339FromUs(row.created_at_utc_us);
  delete out.validation_snapshot_json;
  return out;
}

function safeReleaseCandidateText(value) {
  if (typeof value !== 'string') return undefined;
  const bounded = value.slice(0, 512);
  // Generated labels and human-readable next steps can contain a local path
  // with spaces.  Token-level regexes stop at the first space and leak the
  // remainder (for example `C:\\Users\\Jane Doe\\secret.mov`).  Release
  // projections are metadata only, so conservatively redact the entire bounded
  // value whenever a path/URI signature is present; this is fail-closed and
  // avoids trying to infer where an untrusted path ends.
  const hasWindowsOrUriPath = /(?:[A-Za-z]:[\\/]|\\\\|(?:[A-Za-z][A-Za-z0-9+.-]{1,31}):\/\/)/i.test(bounded);
  const hasAbsolutePosixPath = /(?:^|\s)\/(?=[^/\s])/.test(bounded);
  const hasProtocolRelativePath = /(?:^|\s)\/\/(?=[^/\s])/.test(bounded);
  const hasRelativePath = /(?:^|\s)(?:\.{1,2}[\\/]|[^\s/\\]+[\\/])[^\s]*/.test(bounded);
  if (hasWindowsOrUriPath || hasAbsolutePosixPath || hasProtocolRelativePath || hasRelativePath) return '[redacted]';
  return bounded;
}

function sanitizePublicMetadata(value, depth = 0) {
  if (depth > 12) return '[redacted]';
  if (typeof value === 'string') return safeReleaseCandidateText(value) ?? '[redacted]';
  if (Array.isArray(value)) return value.map((item) => sanitizePublicMetadata(item, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      // Keys can be attacker-controlled in legacy/tampered JSON too.  Drop
      // path/URI-shaped keys rather than exposing them or allowing a special
      // key such as __proto__ to mutate the projection object's prototype.
      const safeKey = safeReleaseCandidateText(key);
      if (!safeKey || safeKey === '[redacted]') continue;
      Object.defineProperty(out, safeKey, {
        configurable: true, enumerable: true, writable: true,
        value: sanitizePublicMetadata(item, depth + 1),
      });
    }
    return out;
  }
  return value;
}

function publicReleaseCandidate(row) {
  if (!row) return null;
  const out = {};
  for (const field of [
    'id', 'project_id', 'timeline_revision_id', 'audio_master_asset_revision_id',
    'media_profile_revision_id', 'review_session_id', 'readiness_digest',
    'rights_snapshot_hash', 'state', 'next_step', 'readiness_snapshot_schema_version',
  ]) if (Object.prototype.hasOwnProperty.call(row, field) && row[field] !== undefined) out[field] = row[field];
  out.state = RELEASE_CANDIDATE_STATES.has(String(out.state ?? '').toUpperCase()) ? String(out.state).toUpperCase() : 'UNKNOWN';
  out.row_version = Number.isSafeInteger(Number(row.row_version)) && Number(row.row_version) >= 1 ? Number(row.row_version) : 0;
  if (out.next_step !== undefined) out.next_step = safeReleaseCandidateText(out.next_step) ?? '';
  if (row.created_at_utc_us !== undefined && row.created_at_utc_us !== null) out.created_at = rfc3339FromUs(row.created_at_utc_us);
  if (row.updated_at_utc_us !== undefined && row.updated_at_utc_us !== null) out.updated_at = rfc3339FromUs(row.updated_at_utc_us);
  if (row.cancelled_at_utc_us !== undefined && row.cancelled_at_utc_us !== null) out.cancelled_at = rfc3339FromUs(row.cancelled_at_utc_us);
  return out;
}

function publicReleaseBuildPlan(row) {
  if (!row) return null;
  const out = {};
  for (const field of [
    'id', 'project_id', 'release_candidate_id', 'timeline_revision_id',
    'media_profile_revision_id', 'review_session_id', 'readiness_digest',
    'rights_snapshot_hash', 'plan_hash', 'state', 'next_step',
    'plan_snapshot_schema_version',
  ]) if (Object.prototype.hasOwnProperty.call(row, field) && row[field] !== undefined) out[field] = row[field];
  out.state = RELEASE_BUILD_PLAN_STATES.has(String(out.state ?? '').toUpperCase()) ? String(out.state).toUpperCase() : 'UNKNOWN';
  for (const field of ['readiness_digest', 'rights_snapshot_hash', 'plan_hash']) {
    if (!SHA256_HEX.test(String(out[field] ?? ''))) out[field] = null;
    else out[field] = String(out[field]).toLowerCase();
  }
  out.row_version = Number.isSafeInteger(Number(row.row_version)) && Number(row.row_version) >= 1 ? Number(row.row_version) : 0;
  if (out.next_step !== undefined) out.next_step = safeReleaseCandidateText(out.next_step) ?? '';
  if (row.created_at_utc_us !== undefined && row.created_at_utc_us !== null) out.created_at = rfc3339FromUs(row.created_at_utc_us);
  if (row.updated_at_utc_us !== undefined && row.updated_at_utc_us !== null) out.updated_at = rfc3339FromUs(row.updated_at_utc_us);
  return out;
}

function safeReleaseCandidateEvidence(value, depth = 0) {
  if (depth > 5) return undefined;
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => safeReleaseCandidateEvidence(item, depth + 1)).filter((item) => item !== undefined);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') return safeReleaseCandidateText(value);
  if (!value || typeof value !== 'object') return undefined;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => RELEASE_CANDIDATE_EVIDENCE_KEYS.has(key))
    .map(([key, item]) => [key, safeReleaseCandidateEvidence(item, depth + 1)])
    .filter(([, item]) => item !== undefined));
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

function processIdentity() {
  let host = 'unknown-host';
  try { host = os.hostname(); } catch { /* keep a bounded fallback */ }
  return `${process.pid}@${host}`;
}

function osUserIdentity() {
  try {
    const user = os.userInfo();
    return `${user.username}@${user.uid}`;
  } catch {
    return 'unknown-user';
  }
}

function processIdFromIdentity(identity) {
  const match = /^(\d+)@/.exec(String(identity ?? ''));
  if (!match) return null;
  const pid = Number(match[1]);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

function isProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    // EPERM means the process exists but this user cannot signal it.  Treat
    // that as alive; self-promotion in the presence of ambiguity is unsafe.
    if (error?.code === 'EPERM') return true;
    return null;
  }
}

function coreOwnershipError(code, messageKey, args = {}, options = {}) {
  return new CoreError(code, 'CONFLICT', messageKey, args, {
    retryable: true,
    needsUser: true,
    ...options,
  });
}

function isCoreOwnershipFailure(error) {
  return ['CORE_ALREADY_OWNED', 'CORE_OWNERSHIP_AMBIGUOUS', 'CORE_OWNERSHIP_REQUIRED', 'CORE_OWNERSHIP_LOST', 'CORE_EPOCH_STALE'].includes(error?.code);
}

export class CoreService {
  #mediaProbeTrustSource = null;
  #mediaProbeRecoveryReady = false;
  #mediaProbeBrokerSource = null;
  #mediaProbeDispatch = null;

  constructor(options = {}) {
    if (options.mediaProbeTrustSource !== undefined && options.mediaProbeTrustSource !== null
      && typeof options.mediaProbeTrustSource !== 'function') throw new TypeError('mediaProbeTrustSource must be a startup callback');
    this.#mediaProbeTrustSource = options.mediaProbeTrustSource ?? null;
    if (options.mediaProbeBrokerSource !== undefined && options.mediaProbeBrokerSource !== null
      && typeof options.mediaProbeBrokerSource !== 'function') throw new TypeError('mediaProbeBrokerSource must be a startup callback');
    this.#mediaProbeBrokerSource = options.mediaProbeBrokerSource ?? null;
    const dbPath = options.dbPath ?? path.join(process.cwd(), '.cineforge', 'cineforge.sqlite');
    if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
    this.dbPath = dbPath;
    this._ownershipEnabled = dbPath !== ':memory:';
    this._closed = false;
    this.db = null;
    this._processLockFd = null;
    this._heartbeatTimer = null;
    this._localProbeTimer = null;
    this._localProbeRunning = false;
    this._localProbeAbortControllers = new Map();
    this.mutationEnabled = !this._ownershipEnabled;
    this.ownershipState = this._ownershipEnabled ? 'STARTING' : 'ACTIVE_OWNER';
    this.instanceId = uuidv7();
    const configuredEpoch = options.instanceEpoch ?? process.env.CINEFORGE_CORE_SESSION ?? null;
    this.instanceEpoch = configuredEpoch === null || configuredEpoch === undefined || String(configuredEpoch).trim() === ''
      ? uuidv7() : String(configuredEpoch).trim();
    if (!CORE_EPOCH_PATTERN.test(this.instanceEpoch)) throw new TypeError('instanceEpoch contains unsupported characters');
    this.fencingToken = crypto.randomBytes(32).toString('hex');
    this.processIdentity = processIdentity();
    this.osUserIdentity = osUserIdentity();
    this.startedAtUtcUs = nowUtcUs();
    const requestedHeartbeat = Number(options.ownershipHeartbeatIntervalMs);
    this.ownershipHeartbeatIntervalMs = Number.isFinite(requestedHeartbeat)
      ? Math.min(Math.max(Math.trunc(requestedHeartbeat), 250), 60_000)
      : CORE_OWNERSHIP_HEARTBEAT_INTERVAL_MS;
    const requestedStaleAfter = Number(options.ownershipStaleAfterMs);
    this.ownershipStaleAfterMs = Number.isFinite(requestedStaleAfter)
      ? Math.min(Math.max(Math.trunc(requestedStaleAfter), this.ownershipHeartbeatIntervalMs * 2), 24 * 60 * 60 * 1000)
      : CORE_OWNERSHIP_STALE_AFTER_MS;
    this.processLockPath = this._ownershipEnabled
      ? path.resolve(options.processLockPath ?? `${path.resolve(dbPath)}${CORE_OWNERSHIP_LOCK_FILE_SUFFIX}`)
      : null;
    this.assetStorePath = path.resolve(options.assetStorePath
      ?? (dbPath === ':memory:' ? path.join(process.cwd(), '.cineforge', 'asset-store') : path.join(path.dirname(path.resolve(dbPath)), 'asset-store')));
    // Renderer toolchain configuration is input-only.  The preflight query
    // returns hashes/version metadata, never these paths.  No default is
    // inferred from PATH or the host installation.
    this.rendererToolchainRoot = options.rendererToolchainRoot ?? null;
    this.rendererToolchainManifest = options.rendererToolchainManifest
      ?? options.rendererToolchainManifestPath
      ?? null;
    this.maxAssetBytes = Number.isSafeInteger(options.maxAssetBytes) && options.maxAssetBytes >= 0
      ? options.maxAssetBytes : 8 * 1024 * 1024 * 1024;
    const requestedPreviewTtl = Number(options.previewTokenTtlMs);
    this.previewTokenTtlMs = Number.isFinite(requestedPreviewTtl)
      ? Math.min(Math.max(Math.trunc(requestedPreviewTtl), 1), MEDIA_PREVIEW_MAX_TTL_MS)
      : MEDIA_PREVIEW_DEFAULT_TTL_MS;
    // This process fence makes every capability stale after a Core restart.
    // The epoch and token map are intentionally memory-only and are never
    // used as media capability credentials.  Core ownership uses a separate
    // durable epoch/fencing token so canonical writes survive a restart safely.
    this.previewEpoch = crypto.randomBytes(32).toString('base64url');
    this.previewTokens = new Map();
    try {
      if (this._ownershipEnabled) this._acquireProcessLock();
      this.db = new DatabaseSync(dbPath);
      initializeDatabase(this.db);
      if (this._ownershipEnabled) this._acquireCoreOwnership();
      this._bootstrap(options);
      this._startOwnershipHeartbeat();
    } catch (error) {
      this._cleanupFailedConstruction();
      throw error;
    }
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    this.#mediaProbeDispatch?.controller.abort();
    this.previewTokens?.clear();
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    if (this._localProbeTimer) {
      clearTimeout(this._localProbeTimer);
      this._localProbeTimer = null;
    }
    for (const controller of this._localProbeAbortControllers?.values() ?? []) {
      try { controller.abort(); } catch { /* preserve the close path */ }
    }
    this._localProbeAbortControllers?.clear();
    this.mutationEnabled = false;
    try { this._releaseCoreOwnership(); } catch { /* retain the primary close path */ }
    try { this.db?.close(); } catch { /* already closed */ }
    this.db = null;
    this._releaseProcessLock();
  }

  _cleanupFailedConstruction() {
    try { this._releaseCoreOwnership(); } catch { /* constructor failure is primary */ }
    try { this.db?.close(); } catch { /* partially initialized */ }
    this.db = null;
    this._releaseProcessLock();
  }

  _acquireProcessLock() {
    fs.mkdirSync(path.dirname(this.processLockPath), { recursive: true });
    const lockMetadata = JSON.stringify({
      pid: process.pid,
      instance_id: this.instanceId,
      instance_epoch: this.instanceEpoch,
      started_at_utc_us: this.startedAtUtcUs,
      db_path: this.dbPath,
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        this._processLockFd = fs.openSync(this.processLockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
        fs.writeFileSync(this._processLockFd, lockMetadata, { encoding: 'utf8' });
        return;
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        let existing;
        try {
          existing = JSON.parse(fs.readFileSync(this.processLockPath, 'utf8'));
        } catch {
          throw coreOwnershipError('CORE_OWNERSHIP_AMBIGUOUS', 'errors.core_ownership_ambiguous', {
            lock_path: this.processLockPath,
          });
        }
        const existingPid = Number(existing?.pid);
        const alive = isProcessAlive(existingPid);
        if (alive !== false) {
          throw coreOwnershipError('CORE_ALREADY_OWNED', 'errors.core_already_owned', {
            instance_epoch: typeof existing?.instance_epoch === 'string' ? existing.instance_epoch : undefined,
          });
        }
        try {
          fs.unlinkSync(this.processLockPath);
        } catch (unlinkError) {
          if (unlinkError?.code !== 'ENOENT') {
            throw coreOwnershipError('CORE_OWNERSHIP_AMBIGUOUS', 'errors.core_ownership_ambiguous', {
              lock_path: this.processLockPath,
            });
          }
        }
      }
    }
    throw coreOwnershipError('CORE_OWNERSHIP_AMBIGUOUS', 'errors.core_ownership_ambiguous', {
      lock_path: this.processLockPath,
    });
  }

  _releaseProcessLock() {
    if (!this._ownershipEnabled || !this.processLockPath) return;
    if (this._processLockFd !== null) {
      try { fs.closeSync(this._processLockFd); } catch { /* already closed */ }
      this._processLockFd = null;
    }
    try {
      const existing = JSON.parse(fs.readFileSync(this.processLockPath, 'utf8'));
      if (existing?.instance_id && existing.instance_id !== this.instanceId) return;
    } catch {
      // If the marker is already gone or damaged, leave it for the next
      // launch to classify as ambiguous instead of deleting another owner.
      return;
    }
    try { fs.unlinkSync(this.processLockPath); } catch { /* already removed */ }
  }

  _acquireCoreOwnership() {
    const now = nowUtcUs();
    this._transaction(() => {
      this.db.prepare(`INSERT INTO core_instances
        (id, instance_epoch, process_identity, os_user_identity, started_at_utc_us,
         last_heartbeat_at_utc_us, state, fencing_token)
        VALUES (?, ?, ?, ?, ?, ?, 'STARTING', ?)`).run(
        this.instanceId, this.instanceEpoch, this.processIdentity, this.osUserIdentity,
        this.startedAtUtcUs, now, this.fencingToken,
      );
      const ownership = this.db.prepare('SELECT * FROM core_instance_ownership WHERE singleton_id = 1').get();
      if (!ownership) {
        throw coreOwnershipError('CORE_OWNERSHIP_AMBIGUOUS', 'errors.core_ownership_ambiguous', {
          reason: 'ownership_row_missing',
        });
      }
      if (ownership.active_core_instance_id) {
        const active = this.db.prepare('SELECT * FROM core_instances WHERE id = ?').get(ownership.active_core_instance_id);
        if (!active) {
          throw coreOwnershipError('CORE_OWNERSHIP_AMBIGUOUS', 'errors.core_ownership_ambiguous', {
            reason: 'active_instance_missing',
          });
        }
        const activeState = String(active.state);
        const activePid = processIdFromIdentity(active.process_identity);
        const activeAlive = isProcessAlive(activePid);
        const heartbeatAgeMs = Math.max(0, (now - Number(active.last_heartbeat_at_utc_us)) / 1000);
        const explicitlyReleased = activeState === 'STOPPED' || activeState === 'STALE_FENCED';
        const processDead = activeAlive === false;
        const heartbeatStale = heartbeatAgeMs > this.ownershipStaleAfterMs;
        if (!explicitlyReleased && activeAlive === true) {
          throw coreOwnershipError('CORE_ALREADY_OWNED', 'errors.core_already_owned', {
            instance_epoch: active.instance_epoch,
            heartbeat_age_ms: Math.round(heartbeatAgeMs),
          });
        }
        if (!explicitlyReleased && activeAlive !== false) {
          throw coreOwnershipError('CORE_OWNERSHIP_AMBIGUOUS', 'errors.core_ownership_ambiguous', {
            reason: heartbeatStale ? 'active_process_identity_unknown_stale' : 'active_process_identity_unknown',
          });
        }
        this.db.prepare(`UPDATE core_instances SET state = 'STALE_FENCED', stopped_at_utc_us = ?
          WHERE id = ? AND state NOT IN ('STOPPED', 'STALE_FENCED')`).run(now, active.id);
      }
      this.db.prepare(`UPDATE core_instance_ownership
        SET active_core_instance_id = ?, active_epoch = ?, fencing_token = ?,
            row_version = row_version + 1, acquired_at_utc_us = ?
        WHERE singleton_id = 1`).run(this.instanceId, this.instanceEpoch, this.fencingToken, now);
      this.db.prepare(`UPDATE core_instances SET state = 'ACTIVE_OWNER', last_heartbeat_at_utc_us = ?
        WHERE id = ? AND fencing_token = ?`).run(now, this.instanceId, this.fencingToken);
    });
    this.ownershipState = 'ACTIVE_OWNER';
    this.mutationEnabled = true;
  }

  _releaseCoreOwnership() {
    if (!this._ownershipEnabled || !this.db) return;
    const now = nowUtcUs();
    this._transaction(() => {
      this.db.prepare(`UPDATE core_instances SET state = 'STOPPED', stopped_at_utc_us = ?, last_heartbeat_at_utc_us = ?
        WHERE id = ? AND fencing_token = ? AND state IN ('STARTING', 'ACTIVE_OWNER', 'DRAINING')`)
        .run(now, now, this.instanceId, this.fencingToken);
      this.db.prepare(`UPDATE core_instance_ownership
        SET active_core_instance_id = NULL, active_epoch = NULL, fencing_token = NULL,
            row_version = row_version + 1
        WHERE singleton_id = 1 AND active_core_instance_id = ? AND active_epoch = ? AND fencing_token = ?`)
        .run(this.instanceId, this.instanceEpoch, this.fencingToken);
    });
    this.ownershipState = 'STOPPED';
  }

  _startOwnershipHeartbeat() {
    if (!this._ownershipEnabled) return;
    this._heartbeatTimer = setInterval(() => {
      if (this._closed || !this.mutationEnabled) return;
      try {
        const now = nowUtcUs();
        const updated = this._transaction(() => this.db.prepare(`UPDATE core_instances
          SET last_heartbeat_at_utc_us = ?
          WHERE id = ? AND instance_epoch = ? AND fencing_token = ? AND state = 'ACTIVE_OWNER'`)
          .run(now, this.instanceId, this.instanceEpoch, this.fencingToken));
        if (updated.changes !== 1) {
          this.mutationEnabled = false;
          this.ownershipState = 'STALE_FENCED';
        }
      } catch {
        // A failed heartbeat must fail closed.  The next mutating command
        // rechecks the durable singleton and returns a typed conflict.
        this.mutationEnabled = false;
        this.ownershipState = 'CONFLICT';
      }
    }, this.ownershipHeartbeatIntervalMs);
    this._heartbeatTimer.unref?.();
  }

  _assertCoreOwner() {
    if (!this._ownershipEnabled) return;
    if (!this.mutationEnabled || !this.db) {
      throw coreOwnershipError('CORE_OWNERSHIP_REQUIRED', 'errors.core_ownership_required', {
        ownership_state: this.ownershipState,
      });
    }
    let row;
    try {
      row = this.db.prepare(`SELECT o.active_core_instance_id, o.active_epoch, o.fencing_token,
          i.state, i.last_heartbeat_at_utc_us
        FROM core_instance_ownership o
        LEFT JOIN core_instances i ON i.id = o.active_core_instance_id
        WHERE o.singleton_id = 1`).get();
    } catch {
      this.mutationEnabled = false;
      this.ownershipState = 'CONFLICT';
      throw coreOwnershipError('CORE_OWNERSHIP_REQUIRED', 'errors.core_ownership_required', {
        ownership_state: this.ownershipState,
      });
    }
    const owned = row
      && row.active_core_instance_id === this.instanceId
      && row.active_epoch === this.instanceEpoch
      && row.fencing_token === this.fencingToken
      && row.state === 'ACTIVE_OWNER';
    if (!owned) {
      this.mutationEnabled = false;
      this.ownershipState = row?.state === 'STALE_FENCED' ? 'STALE_FENCED' : 'CONFLICT';
      throw coreOwnershipError('CORE_OWNERSHIP_LOST', 'errors.core_ownership_lost', {
        ownership_state: this.ownershipState,
      });
    }
  }

  _requestEpoch(request) {
    const value = request?.core_epoch ?? request?.core_ownership_epoch ?? request?.instance_epoch ?? request?.coreInstanceEpoch;
    return value === undefined || value === null ? null : String(value);
  }

  _bootstrap(options) {
    this._assertCoreOwner();
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
    // A crash after generated bytes were registered in CAS but before the
    // command transaction committed leaves a REGISTERED staging row paired
    // with a non-terminal BuildTimelineInterchangeExport command.  Resolve
    // that durable pair explicitly on the next launch; never replay the
    // filesystem side effect or silently adopt it as a successful export.
    try {
      this._recoverInterruptedTimelineExports();
    } catch {
      // Keep Core available for read-only recovery if a damaged command row
      // prevents one recovery pass.  The durable rows remain inspectable.
    }
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
    // A process that stops while a working-session transition is in flight
    // must never look clean on the next launch. The command transaction makes
    // the common path atomic; this fence covers an interrupted legacy image
    // and leaves the durable draft available for an explicit user decision.
    try {
      this.db.prepare(`UPDATE timeline_working_sessions
        SET state = 'RECOVERY_REQUIRED',
            next_step = 'Kiểm tra draft đã lưu rồi chọn autosave, checkpoint hoặc đóng phiên.',
            row_version = row_version + 1,
            updated_at_utc_us = ?
        WHERE state IN ('AUTOSAVING', 'CHECKPOINTING')`).run(nowUtcUs());
    } catch {
      // Older databases are upgraded before this point; keep startup read-only
      // if an interrupted migration cannot expose the recovery marker.
    }
    // Local probe attempts have no external provider ambiguity.  A process
    // fence therefore safely abandons an in-flight attempt and requeues the
    // exact pinned revision on the next launch before the bounded runner is
    // started.  No bytes are adopted or mutated during reconciliation.
    try { this.reconcileMediaProbeAttempts(); } catch { /* keep probe reservation blocked; read/recovery remains available */ }
    try { this._reconcileLocalProbeJobs(); } catch { /* keep read-only Core available */ }
    this._scheduleLocalProbeRunner();
  }

  // Retire logical ownership only. No process stop, retry, cleanup or PASS is
  // inferred from an old epoch, even for a previously requested cancellation.
  reconcileMediaProbeAttempts() {
    if (arguments.length !== 0) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.media_probe_identity_only', {});
    this.#mediaProbeRecoveryReady = false;
    if (this._closed || !this.db) throw new CoreError('PROBE_CORE_CLOSED', 'CONFLICT', 'errors.media_probe_identity_unknown', {});
    const stale = `state IN ('CREATED','DISPATCHING','EXECUTING','PARSING','VERIFYING')
      AND (core_owner_epoch IS NULL OR core_owner_epoch!=?)`;
    const activeJobs = new Set(['QUEUED', 'CLAIMED', 'RUNNING', 'PARSING', 'VERIFYING', 'CANCEL_REQUESTED', 'UNKNOWN', 'FAILED_RETRYABLE']);
    let attempts = 0; let jobs = 0; let batches = 0;
    for (let batch = 0; batch < 10; batch++) {
      const result = this._transaction(() => {
        this._assertCoreOwner();
        const rows = this.db.prepare(`SELECT * FROM media_probe_attempts WHERE ${stale}
          ORDER BY job_id,attempt_no,id LIMIT 100`).all(this.instanceEpoch);
        if (rows.length === 0) return { attempts: 0, jobs: 0 };
        const commandId = uuidv7(); const now = nowUtcUs();
        const scope = { attempt_ids: rows.map(row => row.id), logical_only: true };
        this.db.prepare(`INSERT INTO commands
          (id,studio_id,actor_id,command_type,schema_version,scope_type,payload_json,expected_versions_json,
            reversibility,status,created_at_utc_us,started_at_utc_us)
          VALUES (?,?,?,'PREPARED_RECONCILE_MEDIA_PROBE_V1',1,'SYSTEM',?,'{}','COMPENSATABLE','EXECUTING',?,?)`).run(
          commandId, this.studioId, this.actorId, json(scope), now, now);
        let changedJobs = 0;
        for (const row of rows) {
          const job = this.db.prepare('SELECT * FROM media_probe_jobs WHERE id=?').get(row.job_id);
          if (!job) throw new CoreError('PROBE_RECOVERY_INCONSISTENT', 'CONFLICT', 'errors.media_probe_identity_unknown', {});
          const changed = this.db.prepare(`UPDATE media_probe_attempts SET state='ABANDONED',row_version=row_version+1,
            updated_at_utc_us=? WHERE id=? AND row_version=? AND ${stale}`).run(now, row.id, row.row_version, this.instanceEpoch);
          if (Number(changed.changes) !== 1) throw new CoreError('PROBE_RECOVERY_STALE', 'CONFLICT', 'errors.media_probe_identity_unknown', {});
          this.db.prepare(`INSERT INTO command_impacts(command_id,entity_type,entity_id,impact_type,severity,details_json)
            VALUES (?,'MEDIA_PROBE_ATTEMPT',?,'FENCES','MEDIUM',?)`).run(commandId, row.id, json({ logical_only: true, physical_teardown: 'UNKNOWN' }));
          this._insertEvent({ aggregateType: 'MEDIA_PROBE_ATTEMPT', aggregateId: row.id, aggregateVersion: row.row_version + 1,
            eventType: 'MEDIA_PROBE_ATTEMPT_ABANDONED', payload: { project_id: job.project_id, job_id: job.id, attempt_id: row.id,
              previous_state: row.state, state: 'ABANDONED', logical_only: true, physical_teardown: 'UNKNOWN' } },
          commandId, this.actorId, job.correlation_id, job.command_id);
          const ownsPointer = job.current_attempt_id === row.id;
          const missingPointer = job.current_attempt_id === null
            && (job.state !== 'UNKNOWN' || job.fencing_token !== null || job.needs_user !== 1);
          if (activeJobs.has(job.state) && (ownsPointer || missingPointer)) {
            const updated = this.db.prepare(`UPDATE media_probe_jobs SET state='UNKNOWN',current_attempt_id=NULL,fencing_token=NULL,
              needs_user=1,next_step='CineForge đã khởi động lại; chưa xác nhận kết quả lượt trước. Kiểm tra evidence và runtime trước khi chạy lại.',
              row_version=row_version+1,updated_at_utc_us=? WHERE id=? AND row_version=?`).run(now, job.id, job.row_version);
            if (Number(updated.changes) !== 1) throw new CoreError('PROBE_RECOVERY_STALE', 'CONFLICT', 'errors.media_probe_identity_unknown', {});
            this.db.prepare(`INSERT INTO command_impacts(command_id,entity_type,entity_id,impact_type,severity,details_json)
              VALUES (?,'MEDIA_PROBE_JOB',?,'FENCES','MEDIUM',?)`).run(commandId, job.id, json({ logical_only: true, physical_teardown: 'UNKNOWN' }));
            this._insertEvent({ aggregateType: 'MEDIA_PROBE_JOB', aggregateId: job.id, aggregateVersion: job.row_version + 1,
              eventType: 'MEDIA_PROBE_JOB_RECOVERY_UNKNOWN', payload: { project_id: job.project_id, job_id: job.id, attempt_id: row.id,
                previous_state: job.state, state: 'UNKNOWN', logical_only: true, physical_teardown: 'UNKNOWN' } },
            commandId, this.actorId, job.correlation_id, job.command_id);
            changedJobs++;
          }
        }
        this._assertCoreOwner();
        this._insertAudit({ actionType: 'media_probe.reconcile_attempts', targetType: 'MEDIA_PROBE_RECOVERY', targetId: commandId,
          payload: { ...scope, changed_jobs: changedJobs, physical_teardown: 'UNKNOWN' } }, commandId, this.actorId, 'SUCCEEDED');
        this.db.prepare("UPDATE commands SET status='SUCCEEDED',finished_at_utc_us=?,result_json=? WHERE id=?").run(
          now, json({ reconciled_attempts: rows.length, changed_jobs: changedJobs, logical_only: true, physical_teardown: 'UNKNOWN' }), commandId);
        return { attempts: rows.length, jobs: changedJobs };
      });
      if (result.attempts === 0) break;
      attempts += result.attempts; jobs += result.jobs; batches++;
    }
    this._assertCoreOwner();
    this.#mediaProbeRecoveryReady = !this.db.prepare(`SELECT id FROM media_probe_attempts WHERE ${stale} LIMIT 1`).get(this.instanceEpoch);
    return Object.freeze({ reconciled_attempts: attempts, changed_jobs: jobs, batches, ready: this.#mediaProbeRecoveryReady });
  }

  _jobRow(jobId) {
    const id = requiredString(jobId, 'job_id', 200);
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    if (!row) throw new CoreError('JOB_NOT_FOUND', 'VALIDATION', 'errors.job_not_found', { job_id: id });
    return row;
  }

  _jobProjection(jobId, projectId = null) {
    const job = this._jobRow(jobId);
    if (projectId !== null && projectId !== undefined && job.project_id !== projectId) {
      throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', {
        entity_type: 'JOB', entity_id: job.id, project_id: projectId, actual_project_id: job.project_id,
      }, { needsUser: true });
    }
    const attempt = this.db.prepare('SELECT * FROM job_attempts WHERE job_id = ? ORDER BY attempt_no DESC LIMIT 1').get(job.id);
    const evidence = attempt ? this.db.prepare('SELECT * FROM job_evidence WHERE job_attempt_id = ?').get(attempt.id) : null;
    const usage = attempt ? this.db.prepare('SELECT * FROM job_usage_records WHERE job_attempt_id = ? ORDER BY created_at_utc_us DESC LIMIT 1').get(attempt.id) : null;
    return publicJob(job, attempt, evidence, usage);
  }

  _reconcileLocalProbeJobs() {
    const rows = this.db.prepare(`SELECT j.id, j.state, j.row_version, j.requested_max_bytes,
        a.id AS attempt_id, a.attempt_no, a.state AS attempt_state
      FROM jobs j JOIN job_attempts a ON a.job_id = j.id
      WHERE j.state IN ('CLAIMED', 'RUNNING', 'CANCELLATION_REQUESTED')
        AND a.state IN ('DISPATCHING', 'EXECUTING', 'VERIFYING')`).all();
    if (rows.length === 0) return;
    const commandId = uuidv7();
    const now = nowUtcUs();
    this._transaction(() => {
      this._assertCoreOwner();
      this.db.prepare(`INSERT INTO commands
        (id, studio_id, project_id, actor_id, command_type, schema_version, scope_type, scope_id,
         payload_json, expected_versions_json, reversibility, status, created_at_utc_us, started_at_utc_us)
        VALUES (?, ?, NULL, ?, 'ReconcileLocalProbeJobs', 1, 'SYSTEM', NULL, ?, '{}', 'REVERSIBLE', 'EXECUTING', ?, ?)`)
        .run(commandId, this.studioId, this.actorId, json({ job_ids: rows.map((row) => row.id) }), now, now);
      const eventSeqs = [];
      for (const row of rows) {
        this.db.prepare(`UPDATE job_attempts SET state = 'ABANDONED', finished_at_utc_us = ?, row_version = row_version + 1
          WHERE id = ? AND state IN ('DISPATCHING', 'EXECUTING', 'VERIFYING')`).run(now, row.attempt_id);
        // The abandoned attempt no longer owns its read reservation. Release
        // it before creating a replacement so restart reconciliation cannot
        // double-count the same bounded IO budget.
        this.db.prepare(`UPDATE job_usage_records SET actual_amount = 0, state = 'RELEASED', updated_at_utc_us = ?
          WHERE job_attempt_id = ? AND state = 'RESERVED'`).run(now, row.attempt_id);
        let nextState = row.state;
        if (row.state === 'CLAIMED' || row.state === 'RUNNING') {
          const nextAttemptNo = Number(row.attempt_no) + 1;
          if (Number.isSafeInteger(nextAttemptNo) && nextAttemptNo <= LOCAL_PROBE_MAX_ATTEMPTS) {
            this.db.prepare(`INSERT INTO job_attempts
              (id, job_id, attempt_no, retry_kind, idempotency_key, state, created_at_utc_us)
              VALUES (?, ?, ?, 'EXACT', ?, 'CREATED', ?)`).run(
              uuidv7(), row.id, nextAttemptNo, `local:${row.id}:${nextAttemptNo}:recovery:${commandId}`, now,
            );
            const newAttempt = this.db.prepare('SELECT id FROM job_attempts WHERE job_id = ? AND attempt_no = ?').get(row.id, nextAttemptNo);
            this.db.prepare(`INSERT INTO job_usage_records
              (id, job_attempt_id, resource_type, reserved_amount, state, created_at_utc_us, updated_at_utc_us)
              VALUES (?, ?, 'READ_BYTES', ?, 'RESERVED', ?, ?)`).run(uuidv7(), newAttempt.id, row.requested_max_bytes, now, now);
            nextState = 'QUEUED';
            this.db.prepare(`UPDATE jobs SET state = 'QUEUED', needs_user = 0,
              next_step = 'Đang kiểm tra lại object local sau khi Core khởi động lại.',
              row_version = row_version + 1, updated_at_utc_us = ? WHERE id = ?`).run(now, row.id);
          } else {
            nextState = 'FAILED_RETRYABLE';
            this.db.prepare(`UPDATE jobs SET state = 'FAILED_RETRYABLE', needs_user = 1,
              next_step = 'Đã hết lượt tự động sau khi Core khởi động lại; kiểm tra evidence và lập job mới.',
              row_version = row_version + 1, updated_at_utc_us = ? WHERE id = ?`).run(now, row.id);
          }
        }
        if (row.state === 'CANCELLATION_REQUESTED') {
          nextState = 'CANCELLED_CONFIRMED';
          this.db.prepare(`UPDATE jobs SET state = 'CANCELLED_CONFIRMED', needs_user = 0,
            next_step = 'Job đã huỷ trước khi Core khởi động lại.', row_version = row_version + 1,
            updated_at_utc_us = ? WHERE id = ?`).run(now, row.id);
        }
        const seq = this._insertEvent({
          aggregateType: 'JOB', aggregateId: row.id, aggregateVersion: Number(row.row_version) + 1,
          eventType: 'LOCAL_PROBE_JOB_RECONCILED', payload: { job_id: row.id, previous_state: row.state, state: nextState },
        }, commandId, this.actorId, null, null);
        eventSeqs.push(seq);
      }
      this._insertAudit({ actionType: 'job.reconcile_local_probe', targetType: 'JOB', targetId: rows[0].id, payload: { count: rows.length } }, commandId, this.actorId, 'SUCCEEDED');
      this.db.prepare(`UPDATE commands SET status = 'SUCCEEDED', finished_at_utc_us = ?, result_json = ? WHERE id = ?`)
        .run(nowUtcUs(), json({ count: rows.length, event_seq: eventSeqs }), commandId);
    });
  }

  _scheduleLocalProbeRunner() {
    if (this._closed || this._localProbeTimer) return;
    this._localProbeTimer = setTimeout(() => {
      this._localProbeTimer = null;
      try { this._drainLocalProbeJobs(); } catch { /* a later tick will retry after a transient fence/lock */ }
    }, 0);
    this._localProbeTimer.unref?.();
  }

  _drainLocalProbeJobs() {
    if (this._closed || this._localProbeRunning) return;
    let claimed = null;
    try {
      this._transaction(() => {
        this._assertCoreOwner();
        const row = this.db.prepare(`SELECT j.*, a.id AS attempt_id, a.attempt_no
          FROM jobs j JOIN job_attempts a ON a.job_id = j.id
          WHERE j.state = 'QUEUED' AND a.state = 'CREATED'
          ORDER BY j.priority DESC, j.created_at_utc_us ASC, j.id ASC LIMIT 1`).get();
        if (!row) return;
        const now = nowUtcUs();
        this.db.prepare(`UPDATE jobs SET state = 'RUNNING', needs_user = 0,
          next_step = 'Đang đọc và xác minh object managed local.', row_version = row_version + 1,
          updated_at_utc_us = ? WHERE id = ? AND state = 'QUEUED'`).run(now, row.id);
        this.db.prepare(`UPDATE job_attempts SET state = 'EXECUTING', fencing_token = ?, started_at_utc_us = ?, row_version = row_version + 1
          WHERE id = ? AND state = 'CREATED'`).run(this.fencingToken, now, row.attempt_id);
        claimed = { id: row.id, attemptId: row.attempt_id };
      });
    } catch { return; }
    if (!claimed) return;
    this._localProbeRunning = true;
    Promise.resolve(this._runLocalProbeAttempt(claimed.id, claimed.attemptId)).catch(() => {
      // The durable attempt remains fenced/reconcilable if an unexpected
      // runner exception occurs; never crash the Core event loop.
    }).finally(() => {
      this._localProbeRunning = false;
      if (!this._closed) this._scheduleLocalProbeRunner();
    });
  }

  async _probeManagedObject(jobId, attemptId) {
    const row = this.db.prepare(`SELECT j.*, r.storage_object_id, r.availability_state, so.hash_algorithm,
        so.content_hash, so.byte_size, so.storage_class, l.storage_root, l.relative_path,
        l.location_role, l.state AS location_state,
        (SELECT COUNT(*) FROM storage_object_locations all_primary
          WHERE all_primary.storage_object_id = so.id AND all_primary.location_role = 'PRIMARY') AS primary_location_count
      FROM jobs j JOIN asset_revisions r ON r.id = j.subject_asset_revision_id
      JOIN storage_objects so ON so.id = r.storage_object_id
      LEFT JOIN storage_object_locations l ON l.storage_object_id = so.id AND l.location_role = 'PRIMARY'
      WHERE j.id = ?
      ORDER BY CASE WHEN l.state = 'AVAILABLE' THEN 0 ELSE 1 END, l.created_at_utc_us ASC, l.id ASC
      LIMIT 1`).get(jobId);
    if (!row) return { state: 'UNKNOWN', code: 'JOB_NOT_FOUND', bytesRead: 0 };
    const expectedHash = String(row.subject_content_hash ?? '').toLowerCase();
    const expectedSize = Number(row.byte_size);
    const evidence = { content_hash: expectedHash, expected_byte_size: Number.isSafeInteger(expectedSize) ? expectedSize : 0, bytes_read: 0 };
    if (row.storage_class !== 'LOCAL_MANAGED' || row.hash_algorithm !== 'SHA-256' || !SHA256_HEX.test(expectedHash)) return { ...evidence, state: 'FAIL', code: 'PROBE_METADATA_INVALID' };
    if (String(row.content_hash).toLowerCase() !== expectedHash || !Number.isSafeInteger(expectedSize) || expectedSize < 0) return { ...evidence, state: 'FAIL', code: 'PROBE_CONTENT_IDENTITY_MISMATCH' };
    if (row.availability_state !== 'AVAILABLE' || row.primary_location_count !== 1 || row.location_role !== 'PRIMARY' || row.location_state !== 'AVAILABLE') return { ...evidence, state: 'FAIL', code: 'PROBE_LOCATION_UNAVAILABLE' };
    if (expectedSize > Number(row.requested_max_bytes)) return { ...evidence, state: 'UNKNOWN', code: 'PROBE_IO_BUDGET_EXCEEDED' };
    const expectedRelativePath = this._objectRelativePath('SHA-256', expectedHash).split(path.sep).join('/');
    if (row.storage_root !== 'asset-store' || row.relative_path !== expectedRelativePath) return { ...evidence, state: 'FAIL', code: 'PROBE_LOCATION_INVALID' };
    const target = path.resolve(this.assetStorePath, row.relative_path);
    if (!pathIsWithin(target, this.assetStorePath) || pathKey(target) === pathKey(this.assetStorePath)) return { ...evidence, state: 'FAIL', code: 'PROBE_PATH_ESCAPE' };
    let descriptor;
    let stream;
    let before;
    let controller;
    try {
      this._assertNoReparsePath(target);
      const pathBefore = fs.lstatSync(target);
      if (!pathBefore.isFile() || Number(pathBefore.nlink ?? 1) !== 1) return { ...evidence, state: 'FAIL', code: pathBefore.isSymbolicLink() ? 'PROBE_REPARSE_REJECTED' : 'PROBE_HARDLINK_REJECTED' };
      descriptor = fs.openSync(target, fs.constants.O_RDONLY | Number(fs.constants.O_NOFOLLOW ?? 0));
      before = fs.fstatSync(descriptor);
      if (!before.isFile() || Number(before.nlink ?? 1) !== 1) return { ...evidence, state: 'FAIL', code: 'PROBE_NOT_REGULAR_FILE' };
      if (!this._sameHandleIdentity(this._sourceIdentity(pathBefore), this._sourceIdentity(before))) return { ...evidence, state: 'UNKNOWN', code: 'PROBE_OBJECT_CHANGED' };
      if (!Number.isSafeInteger(Number(before.size)) || Number(before.size) < 0) return { ...evidence, state: 'UNKNOWN', code: 'PROBE_SIZE_UNSAFE' };
      // The registered metadata is bounded, but an external writer can grow
      // the file between registration and this read.  Refuse the probe before
      // consuming any bytes instead of allowing a changed object to exceed
      // the caller's explicit IO budget.
      if (Number(before.size) > Number(row.requested_max_bytes)) return { ...evidence, state: 'UNKNOWN', code: 'PROBE_IO_BUDGET_EXCEEDED', observed_byte_size: Number(before.size) };
      const digest = crypto.createHash('sha256');
      let bytesRead = 0;
      if (Number(before.size) > 0) {
        controller = new AbortController();
        this._localProbeAbortControllers.set(attemptId, controller);
        let timedOut = false;
        const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, LOCAL_PROBE_TIMEOUT_MS);
        try {
          stream = fs.createReadStream(null, {
            fd: descriptor,
            autoClose: false,
            start: 0,
            end: Number(before.size) - 1,
            highWaterMark: LOCAL_PROBE_CHUNK_BYTES,
            signal: controller.signal,
          });
          for await (const chunk of stream) {
            if (this._closed) {
              controller.abort();
              return { ...evidence, state: 'UNKNOWN', code: 'PROBE_CORE_CLOSED', observed_byte_size: Number(before.size), bytesRead };
            }
            bytesRead += chunk.byteLength;
            if (bytesRead > Number(before.size)) return { ...evidence, state: 'UNKNOWN', code: 'PROBE_STREAM_OVERRUN', observed_byte_size: Number(before.size), bytesRead };
            digest.update(chunk);
          }
        } catch (error) {
          if (timedOut || error?.name === 'AbortError' || error?.code === 'ABORT_ERR') {
            const currentState = this.db.prepare('SELECT state FROM jobs WHERE id = ?').get(jobId)?.state;
            const code = currentState === 'CANCELLATION_REQUESTED' ? 'PROBE_CANCELLED' : 'PROBE_TIMEOUT';
            return { ...evidence, state: 'UNKNOWN', code, observed_byte_size: Number(before.size), bytesRead };
          }
          throw error;
        } finally {
          clearTimeout(timeout);
          this._localProbeAbortControllers.delete(attemptId);
          stream = null;
        }
      }
      if (bytesRead !== Number(before.size)) return { ...evidence, state: 'UNKNOWN', code: 'PROBE_SHORT_READ', observed_byte_size: Number(before.size), bytesRead };
      const after = fs.fstatSync(descriptor);
      if (!this._sameSourceIdentity(this._sourceIdentity(before), this._sourceIdentity(after))) return { ...evidence, state: 'UNKNOWN', code: 'PROBE_OBJECT_CHANGED', observed_byte_size: Number(after.size), bytesRead };
      let pathAfter;
      try { pathAfter = fs.lstatSync(target); } catch { return { ...evidence, state: 'UNKNOWN', code: 'PROBE_OBJECT_CHANGED', observed_byte_size: Number(after.size), bytesRead }; }
      if (pathAfter.isSymbolicLink() || !pathAfter.isFile() || Number(pathAfter.nlink ?? 1) !== 1
        || !this._sameHandleIdentity(this._sourceIdentity(after), this._sourceIdentity(pathAfter))) {
        return { ...evidence, state: 'UNKNOWN', code: 'PROBE_OBJECT_CHANGED', observed_byte_size: Number(after.size), bytesRead };
      }
      const observedHash = digest.digest('hex');
      const state = Number(before.size) === expectedSize && observedHash === expectedHash ? 'PASS' : 'FAIL';
      return { ...evidence, state, code: state === 'PASS' ? null : Number(before.size) !== expectedSize ? 'PROBE_BYTE_SIZE_MISMATCH' : 'PROBE_CONTENT_HASH_MISMATCH', observed_hash: observedHash, observed_byte_size: Number(before.size), bytesRead };
    } catch (error) {
      const code = error?.code === 'ENOENT' ? 'PROBE_OBJECT_MISSING' : error?.code === 'ELOOP' ? 'PROBE_REPARSE_REJECTED' : 'PROBE_OBJECT_UNREADABLE';
      return { ...evidence, state: code === 'PROBE_OBJECT_MISSING' || code === 'PROBE_REPARSE_REJECTED' ? 'FAIL' : 'UNKNOWN', code };
    } finally {
      if (stream) { try { stream.destroy(); } catch { /* evidence already captured */ } }
      this._localProbeAbortControllers.delete(attemptId);
      if (descriptor !== undefined) { try { fs.closeSync(descriptor); } catch { /* evidence already captured */ } }
    }
  }

  async _runLocalProbeAttempt(jobId, attemptId) {
    let result;
    try { result = await this._probeManagedObject(jobId, attemptId); } catch (error) {
      result = { state: 'UNKNOWN', code: 'PROBE_INTERNAL_ERROR', bytesRead: 0, error: String(error?.message ?? error).slice(0, 200) };
    }
    if (this._closed) return;
    try {
      this._transaction(() => {
        this._assertCoreOwner();
        const job = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
        const attempt = this.db.prepare('SELECT * FROM job_attempts WHERE id = ? AND job_id = ?').get(attemptId, jobId);
        if (!job || !attempt || ['SUCCEEDED', 'FAILED', 'ABANDONED'].includes(attempt.state)) return;
        const now = nowUtcUs();
        const afterCancel = job.state === 'CANCELLATION_REQUESTED';
        const terminalState = afterCancel ? 'COMPLETED_AFTER_CANCEL' : result.state === 'PASS' ? 'COMPLETED' : result.state === 'FAIL' ? 'FAILED_FINAL' : 'FAILED_RETRYABLE';
        const attemptState = result.state === 'PASS' ? 'SUCCEEDED' : 'FAILED';
        const nextStep = terminalState === 'COMPLETED' || terminalState === 'COMPLETED_AFTER_CANCEL' ? 'Evidence đã ghi nhận; không có bytes nào bị sửa.' : terminalState === 'FAILED_RETRYABLE' ? 'Kiểm tra quyền truy cập hoặc thay đổi file rồi thử lại.' : 'Đối tượng không khớp metadata; giữ nguyên asset và xem evidence.';
        this.db.prepare(`UPDATE job_attempts SET state = ?, finished_at_utc_us = ?, bytes_read = ?, error_code = ?, error_details_json = ?, row_version = row_version + 1 WHERE id = ?`)
          .run(attemptState, now, Number(result.bytesRead ?? result.bytes_read ?? 0), result.code ?? null, json({ code: result.code ?? null }), attemptId);
        this.db.prepare(`INSERT INTO job_evidence
          (id, job_attempt_id, project_id, asset_revision_id, state, code, content_hash, expected_byte_size, observed_hash, observed_byte_size, bytes_read, evidence_json, created_at_utc_us)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(uuidv7(), attemptId, job.project_id, job.subject_asset_revision_id, result.state, result.code ?? null, job.subject_content_hash,
            Number(result.expected_byte_size ?? 0), result.observed_hash ?? null, result.observed_byte_size ?? null, Number(result.bytesRead ?? result.bytes_read ?? 0), json({
              late_after_cancel: afterCancel,
              connector_version: LOCAL_PROBE_CONNECTOR_VERSION,
              ...(result.error ? { error: result.error } : {}),
            }), now);
        this.db.prepare(`UPDATE job_usage_records SET actual_amount = ?, state = ?, updated_at_utc_us = ? WHERE job_attempt_id = ?`)
          .run(Number(result.bytesRead ?? result.bytes_read ?? 0), result.state === 'UNKNOWN' ? 'RELEASED' : 'CONSUMED', now, attemptId);
        this.db.prepare(`UPDATE jobs SET state = ?, needs_user = ?, next_step = ?, row_version = row_version + 1, updated_at_utc_us = ? WHERE id = ?`)
          .run(terminalState, terminalState === 'FAILED_RETRYABLE' ? 1 : 0, nextStep, now, jobId);
        const eventSeq = this._insertEvent({
          aggregateType: 'JOB', aggregateId: jobId, aggregateVersion: Number(job.row_version) + 1,
          eventType: `LOCAL_PROBE_JOB_${terminalState}`,
          payload: {
            job_id: jobId,
            state: terminalState,
            evidence_state: result.state,
            code: result.code ?? null,
            bytes_read: Number(result.bytesRead ?? result.bytes_read ?? 0),
            late_after_cancel: afterCancel,
          },
        }, job.command_id, this.actorId, null, null);
        this._insertAudit({
          actionType: 'job.local_probe.complete', targetType: 'JOB', targetId: jobId,
          payload: { state: terminalState, evidence_state: result.state, code: result.code ?? null, event_seq: eventSeq },
        }, job.command_id, this.actorId, terminalState === 'FAILED_FINAL' || terminalState === 'FAILED_RETRYABLE' ? 'FAILED' : 'SUCCEEDED');
      });
    } catch { /* stale fence or shutdown leaves the attempt for next-start reconciliation */ }
  }

  _recoverInterruptedTimelineExports() {
    const rows = this.db.prepare(`SELECT c.id, c.status, c.payload_json
      FROM commands c
      JOIN staging_objects s ON s.command_id = c.id
      WHERE c.command_type = 'BuildTimelineInterchangeExport'
        AND c.status IN ('RECEIVED', 'VALIDATING', 'WAITING_DECISION', 'READY', 'EXECUTING')
        AND s.state = 'REGISTERED'
      ORDER BY c.created_at_utc_us ASC, c.id ASC`).all();
    for (const command of rows) {
      const payload = parseJson(command.payload_json, {});
      const recoveryError = new CoreError(
        'EXPORT_RECOVERY_REQUIRED', 'CONFLICT', 'errors.export_recovery_required', {},
        { retryable: true, needsUser: true },
      );
      // The export-session fence is idempotent: if the process stopped after
      // this call and before the command update, the next launch sees the
      // recorded recovery marker and does not append a second event.
      this._markTimelineInterchangeExportFailure(payload, recoveryError, command.id);
      this._transaction(() => {
        const current = this.db.prepare('SELECT * FROM commands WHERE id = ?').get(command.id);
        if (!current || TERMINAL_COMMAND_STATES.has(String(current.status))) return;
        const updated = this.db.prepare(`UPDATE commands SET status = 'FAILED', finished_at_utc_us = ?, error_code = ?, error_details_json = ?
          WHERE id = ? AND status IN ('RECEIVED', 'VALIDATING', 'WAITING_DECISION', 'READY', 'EXECUTING')`)
          .run(nowUtcUs(), recoveryError.code, json(recoveryError.toEnvelope()), command.id);
        if (updated.changes !== 1) return;
        this._insertAudit({
          actionType: 'BuildTimelineInterchangeExport', targetType: 'COMMAND', targetId: command.id,
          payload: { error_code: recoveryError.code, recovery: true },
        }, command.id, this.actorId, 'FAILED');
      });
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
      || !Number.isSafeInteger(manifest.schema_version)
      || typeof manifest.database?.byte_size !== 'number'
      || !Number.isSafeInteger(manifest.database.byte_size)
      || manifest.database.byte_size < 0
      || !SHA256_HEX.test(String(manifest.database?.sha256 ?? ''))
      || !Array.isArray(manifest.objects)
      || manifest.objects.length > BACKUP_MAX_MANIFEST_OBJECTS) {
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
    for (const object of manifest.objects) {
      if (!object || typeof object !== 'object' || Array.isArray(object)) {
        throw new CoreError('BACKUP_MANIFEST_INVALID', 'CONFLICT', 'errors.backup_manifest_invalid', {}, { needsUser: true });
      }
      const relative = String(object.relative_path ?? '');
      // External references intentionally have no copied path.  Use the
      // immutable object id for duplicate detection so multiple external
      // objects do not collapse into the same empty-string key.
      const seenKey = object.materialization === 'EXTERNAL_REFERENCE'
        ? `external:${String(object.id ?? '')}` : relative;
      if (!String(object.id ?? '').trim()
        || String(object.id).length > 200
        || typeof object.byte_size !== 'number'
        || !Number.isSafeInteger(object.byte_size)
        || object.byte_size < 0
        || !SHA256_HEX.test(String(object.content_hash ?? ''))
        || (object.materialization === 'COPIED' && !SHA256_HEX.test(String(object.sha256 ?? '')))
        || seen.has(seenKey)) {
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
    const sameDevice = process.platform === 'win32' || String(left.dev) === String(right.dev);
    return sameDevice
      && String(left.ino) === String(right.ino)
      && Number(left.size) === Number(right.size)
      && Number(left.mtime_ms) === Number(right.mtime_ms)
      && Number(left.ctime_ms) === Number(right.ctime_ms)
      && Number(left.mode) === Number(right.mode)
      && Number(left.nlink ?? 1) === Number(right.nlink ?? 1);
  }

  _sameHandleIdentity(left, right) {
    if (!left || !right) return false;
    // lstat/fstat can expose platform-specific timestamp/mode rounding even
    // for the same file handle.  Device/inode, size and link count are the
    // stable identity needed to detect a path swap after opening.
    const sameDevice = process.platform === 'win32' || String(left.dev) === String(right.dev);
    return sameDevice
      && String(left.ino) === String(right.ino)
      && Number(left.size) === Number(right.size)
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

  _useExistingImportStaging(payload) {
    const stagingId = requiredString(payload.staging_id ?? payload.stagingId ?? payload.source_handle ?? payload.sourceHandle, 'staging_id', 200);
    const row = this._stagingRow(stagingId);
    if (!['COMPLETE', 'VERIFIED'].includes(String(row.state))) {
      throw new CoreError('STAGING_NOT_READY', 'CONFLICT', 'errors.staging_not_ready', { staging_id: stagingId, state: row.state }, { needsUser: true });
    }
    if (row.import_item_id) {
      throw new CoreError('STAGING_ALREADY_IMPORTED', 'CONFLICT', 'errors.staging_already_imported', { staging_id: stagingId }, { needsUser: true });
    }
    // Re-read and verify the private bytes before the import command is
    // journaled as executing.  This catches tampering between the upload and
    // the user's explicit Import action without widening the path boundary.
    const verified = this._verifyStagingObject(stagingId);
    if (!SHA256_HEX.test(String(verified.sha256 ?? '')) || !Number.isSafeInteger(Number(verified.expected_size ?? verified.current_size))) {
      throw new CoreError('STAGING_VERIFY_FAILED', 'INTERNAL', 'errors.staging_verify_failed', { staging_id: stagingId }, { needsUser: false });
    }
    return { id: stagingId, sourcePath: path.resolve(String(verified.temp_path)), digest: { content_hash: verified.sha256, byte_size: Number(verified.expected_size ?? verified.current_size) }, owned: false };
  }

  /**
   * Stage bytes received from the local desktop browser boundary.
   *
   * The browser never receives a filesystem path.  Core owns the durable
   * staging row, writes the request stream into a private O_EXCL file, fsyncs
   * it, hashes it, and only then exposes the opaque staging id to the UI.
   * ImportAsset consumes that id through the normal COPY materialization path.
   */
  async stageDesktopAsset({ stream, filename, mimeType, contentLength = null, idempotencyKey }) {
    this._assertCoreOwner();
    if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') {
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_upload_stream', {});
    }
    if (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0 || idempotencyKey.length > 200) {
      throw new CoreError('IDEMPOTENCY_KEY_REQUIRED', 'VALIDATION', 'errors.idempotency_key_required', { command_type: 'StageDesktopAsset' }, { needsUser: true });
    }
    const normalizedName = String(filename ?? '').normalize('NFC').trim();
    if (!normalizedName || normalizedName.includes('\0') || normalizedName.includes('/') || normalizedName.includes('\\')
      || Buffer.byteLength(normalizedName, 'utf8') > DESKTOP_STAGE_MAX_FILENAME_BYTES) {
      throw new CoreError('INVALID_FILENAME', 'VALIDATION', 'errors.invalid_filename', {}, { needsUser: true });
    }
    const normalizedMime = String(mimeType ?? 'application/octet-stream').split(';', 1)[0].trim().toLowerCase();
    if (!normalizedMime || normalizedMime.includes('\0') || Buffer.byteLength(normalizedMime, 'utf8') > DESKTOP_STAGE_MAX_MIME_BYTES) {
      throw new CoreError('INVALID_MIME_TYPE', 'VALIDATION', 'errors.invalid_mime_type', {}, { needsUser: true });
    }
    const expectedSize = contentLength === null || contentLength === undefined || contentLength === ''
      ? null : Number(contentLength);
    if (expectedSize !== null && (!Number.isSafeInteger(expectedSize) || expectedSize < 0 || expectedSize > DESKTOP_STAGE_MAX_BYTES)) {
      throw new CoreError('UPLOAD_TOO_LARGE', 'VALIDATION', 'errors.upload_too_large', { max_bytes: DESKTOP_STAGE_MAX_BYTES }, { needsUser: true });
    }
    const fingerprint = idempotencyFingerprint({ original_name: normalizedName, mime_type: normalizedMime, expected_size: expectedSize }, {});
    const previous = this._findIdempotent('StageDesktopAsset', idempotencyKey);
    if (previous) {
      this._assertIdempotencyBinding(previous, 'StageDesktopAsset', idempotencyKey, fingerprint);
      if (previous.status === 'FAILED') {
        const failure = parseJson(previous.error_details_json, {});
        throw new CoreError(previous.error_code ?? 'COMMAND_FAILED', failure.category ?? 'INTERNAL', failure.user_message_key ?? 'errors.command_failed', failure.user_message_args ?? {}, {
          retryable: failure.retryable, needsUser: failure.needs_user, technicalDetails: failure.technical_details,
        });
      }
      if (previous.status !== 'SUCCEEDED') {
        throw new CoreError('IDEMPOTENCY_IN_PROGRESS', 'CONFLICT', 'errors.idempotency_in_progress', { command_type: 'StageDesktopAsset' }, { retryable: true, needsUser: true });
      }
      const prior = parseJson(previous.result_json, null);
      if (prior && typeof prior === 'object') {
        // A retry must prove that the request body is the same.  Consume and
        // hash the stream even on replay; metadata alone is not a safe
        // idempotency binding for file uploads.
        const priorSize = Number(prior.byte_size);
        const priorHash = String(prior.content_hash ?? '').toLowerCase();
        const retryHash = crypto.createHash('sha256');
        let retrySize = 0;
        for await (const chunk of stream) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          retrySize += buffer.length;
          if (retrySize > DESKTOP_STAGE_MAX_BYTES) {
            throw new CoreError('UPLOAD_TOO_LARGE', 'VALIDATION', 'errors.upload_too_large', { max_bytes: DESKTOP_STAGE_MAX_BYTES }, { needsUser: true });
          }
          retryHash.update(buffer);
        }
        if (!Number.isSafeInteger(priorSize) || retrySize !== priorSize || retryHash.digest('hex') !== priorHash) {
          throw new CoreError('IDEMPOTENCY_KEY_REUSE_CONFLICT', 'CONFLICT', 'errors.idempotency_key_reuse_conflict', { command_type: 'StageDesktopAsset' }, { needsUser: true });
        }
        return { ...prior, idempotent_replay: true, projection_seq: this._projectionSeq() };
      }
      throw new CoreError('IDEMPOTENCY_RESULT_MISSING', 'INTERNAL', 'errors.internal', {}, { needsUser: false });
    }

    const commandId = uuidv7();
    const stagingId = uuidv7();
    const created = nowUtcUs();
    const { root, candidate } = this._stagingPath(stagingId);
    fs.mkdirSync(root, { recursive: true });
    const rootStat = fs.lstatSync(root);
    if (rootStat.isSymbolicLink()) throw new CoreError('STAGING_REPARSE_REJECTED', 'INTERNAL', 'errors.staging_reparse_rejected', {}, { needsUser: false });
    const sourceFingerprint = this._pathFingerprint(candidate);
    const commandPayload = { original_name: normalizedName, mime_type: normalizedMime, expected_size: expectedSize };
    try {
      this._transaction(() => {
        this._assertCoreOwner();
        this.db.prepare(`INSERT INTO commands
          (id, studio_id, actor_id, command_type, schema_version, scope_type, payload_json,
           expected_versions_json, reversibility, status, idempotency_key, idempotency_fingerprint,
           created_at_utc_us)
          VALUES (?, ?, ?, 'StageDesktopAsset', 1, 'SYSTEM', ?, '{}', 'REVERSIBLE', 'EXECUTING', ?, ?, ?)`)
          .run(commandId, this.studioId, this.actorId, json(commandPayload), idempotencyKey, fingerprint, created);
        this.db.prepare(`INSERT INTO staging_objects
          (id, command_id, temp_path, expected_size, current_size, hash_algorithm, source_path_fingerprint,
           source_file_identity_json, reparse_state, state, row_version, created_at_utc_us, updated_at_utc_us)
          VALUES (?, ?, ?, ?, 0, 'SHA-256', ?, ?, 'UNKNOWN', 'WRITING', 1, ?, ?)`)
          .run(stagingId, commandId, candidate, expectedSize, sourceFingerprint,
            json({ kind: 'DESKTOP_UPLOAD', original_name: normalizedName, mime_type: normalizedMime }), created, created);
      });

      let descriptor = null;
      let byteSize = 0;
      const hash = crypto.createHash('sha256');
      try {
        descriptor = fs.openSync(candidate, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
        for await (const chunk of stream) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          byteSize += buffer.length;
          if (byteSize > DESKTOP_STAGE_MAX_BYTES) {
            throw new CoreError('UPLOAD_TOO_LARGE', 'VALIDATION', 'errors.upload_too_large', { max_bytes: DESKTOP_STAGE_MAX_BYTES }, { needsUser: true });
          }
          hash.update(buffer);
          let offset = 0;
          while (offset < buffer.length) offset += fs.writeSync(descriptor, buffer, offset, buffer.length - offset);
        }
        if (expectedSize !== null && byteSize !== expectedSize) {
          throw new CoreError('UPLOAD_SIZE_MISMATCH', 'CONFLICT', 'errors.upload_size_mismatch', { expected_size: expectedSize, actual_size: byteSize }, { needsUser: true });
        }
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        descriptor = null;
        const stat = fs.lstatSync(candidate);
        if (stat.isSymbolicLink() || !stat.isFile() || Number(stat.nlink ?? 1) !== 1) {
          throw new CoreError('STAGING_REPARSE_REJECTED', 'INTERNAL', 'errors.staging_reparse_rejected', {}, { needsUser: false });
        }
        const identity = this._sourceIdentity(stat);
        const contentHash = hash.digest('hex');
        this._transaction(() => {
          this._assertCoreOwner();
          this._setStagingState(stagingId, 'COMPLETE', {
            current_size: byteSize,
            sha256: contentHash,
            os_file_identity_json: json(identity),
          });
          const row = this._stagingRow(stagingId);
          const result = {
            handle: stagingId,
            name: normalizedName,
            mime_type: normalizedMime,
            byte_size: byteSize,
            content_hash: contentHash,
            state: row.state,
            command_id: commandId,
          };
          const eventSeq = this._insertEvent({
            aggregateType: 'STAGING_OBJECT', aggregateId: stagingId, aggregateVersion: 1,
            eventType: 'DESKTOP_ASSET_STAGED',
            payload: { staging_id: stagingId, byte_size: byteSize, content_hash: contentHash, mime_type: normalizedMime },
          }, commandId, this.actorId);
          this._insertAudit({ actionType: 'asset.desktop_stage', targetType: 'STAGING_OBJECT', targetId: stagingId,
            payload: { byte_size: byteSize, content_hash: contentHash, mime_type: normalizedMime } }, commandId, this.actorId, 'SUCCEEDED');
          this.db.prepare(`UPDATE commands SET status = 'SUCCEEDED', finished_at_utc_us = ?, result_json = ? WHERE id = ?`)
            .run(nowUtcUs(), json({ ...result, event_seq: eventSeq }), commandId);
        });
      } finally {
        if (descriptor !== null) { try { fs.closeSync(descriptor); } catch { /* preserve primary error */ } }
      }
      const row = this._stagingRow(stagingId);
      return { handle: stagingId, name: normalizedName, mimeType: normalizedMime, byteSize, contentHash: row.sha256, command_id: commandId, projection_seq: this._projectionSeq() };
    } catch (error) {
      const coreError = error instanceof CoreError ? error : new CoreError('DESKTOP_STAGE_FAILED', 'INTERNAL', 'errors.desktop_stage_failed', {}, { needsUser: false, technicalDetails: { message: String(error?.message ?? error) } });
      try {
        this._transaction(() => {
          const row = this._stagingRow(stagingId);
          if (row.state === 'WRITING') this._setStagingState(stagingId, 'FAILED');
          this._insertAudit({ actionType: 'asset.desktop_stage', targetType: 'STAGING_OBJECT', targetId: stagingId, payload: { error_code: coreError.code } }, commandId, this.actorId, 'FAILED');
          this.db.prepare(`UPDATE commands SET status = 'FAILED', finished_at_utc_us = ?, error_code = ?, error_details_json = ? WHERE id = ?`)
            .run(nowUtcUs(), coreError.code, json(coreError.toEnvelope()), commandId);
        });
      } catch { /* preserve the original staging error and durable evidence */ }
      throw coreError;
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
    if (digest.content_hash !== row.sha256 || digest.byte_size !== Number(row.expected_size ?? row.current_size)) {
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

  _protectManagedObject(target, contentHash) {
    try {
      // Generated CAS bytes are immutable evidence.  The read-only bit closes
      // the normal in-place-write window between preflight materialization and
      // the binding transaction; privileged tampering is still detected by
      // the final hash checks and download verifier.
      fs.chmodSync(target, 0o444);
    } catch {
      throw new CoreError('ASSET_STORE_CORRUPT', 'INTERNAL', 'errors.asset_store_corrupt', { content_hash: contentHash }, { needsUser: false });
    }
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
        if (Number(row.expected_size ?? row.current_size) !== digest.byte_size || (row.sha256 && row.sha256 !== digest.content_hash)) {
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
    if (MEDIA_PROBE_MUTATING_COMMANDS.has(commandType)) {
      const out = {};
      for (const key of ['project_id', 'asset_revision_id', 'job_id', 'content_hash', 'byte_size',
        'toolchain_manifest_hash', 'probe_schema_version', 'parser_policy_version']) {
        const value = payload[key];
        if (key === 'byte_size') { if (Number.isSafeInteger(value) && value >= 0) out[key] = value; }
        else if (typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value)) out[key] = value;
      }
      return out;
    }
    if (LOCAL_PROBE_MUTATING_COMMANDS.has(commandType)) {
      return {
        ...(payload.project_id ?? payload.projectId ? { project_id: String(payload.project_id ?? payload.projectId).slice(0, 200) } : {}),
        ...(payload.asset_revision_id ?? payload.assetRevisionId ? { asset_revision_id: String(payload.asset_revision_id ?? payload.assetRevisionId).slice(0, 200) } : {}),
        ...(payload.job_id ?? payload.jobId ?? payload.id ? { job_id: String(payload.job_id ?? payload.jobId ?? payload.id).slice(0, 200) } : {}),
        ...(payload.content_hash ?? payload.contentHash ? { content_hash: String(payload.content_hash ?? payload.contentHash).slice(0, 128) } : {}),
        ...(payload.max_bytes ?? payload.maxBytes ? { max_bytes: payload.max_bytes ?? payload.maxBytes } : {}),
      };
    }
    if (commandType === 'RegisterExternalEdit') {
      const projectId = payload.project_id ?? payload.projectId;
      const handoffManifestId = payload.handoff_manifest_id ?? payload.handoffManifestId;
      const exportSessionId = payload.export_session_id ?? payload.exportSessionId;
      const returnedAssetRevisionId = payload.returned_asset_revision_id ?? payload.returnedAssetRevisionId;
      const lineageConfidence = payload.lineage_confidence ?? payload.lineageConfidence;
      return {
        project_id: typeof projectId === 'string' ? projectId.slice(0, 200) : null,
        handoff_manifest_id: typeof handoffManifestId === 'string' ? handoffManifestId.slice(0, 200) : null,
        export_session_id: typeof exportSessionId === 'string' ? exportSessionId.slice(0, 200) : null,
        returned_asset_revision_id: typeof returnedAssetRevisionId === 'string' ? returnedAssetRevisionId.slice(0, 200) : null,
        ...(lineageConfidence === undefined ? {} : { lineage_confidence: String(lineageConfidence).slice(0, 32) }),
      };
    }
    if (commandType === 'CreateReleaseCandidateDraft') {
      // Candidate commands are intentionally metadata-only. Do not persist
      // arbitrary caller fields (paths, provider URIs or generated content)
      // in the command journal even though the executor ignores them.
      const projectId = payload.project_id ?? payload.projectId;
      return { project_id: typeof projectId === 'string' ? projectId.slice(0, 200) : null };
    }
    if (commandType === 'CancelReleaseCandidateDraft') {
      const projectId = payload.project_id ?? payload.projectId;
      const candidateId = payload.release_candidate_id ?? payload.releaseCandidateId ?? payload.candidate_id ?? payload.candidateId ?? payload.id;
      return {
        project_id: typeof projectId === 'string' ? projectId.slice(0, 200) : null,
        release_candidate_id: typeof candidateId === 'string' ? candidateId.slice(0, 200) : null,
      };
    }
    if (commandType === 'CreateReleaseBuildPlan') {
      const projectId = payload.project_id ?? payload.projectId;
      const candidateId = payload.release_candidate_id ?? payload.releaseCandidateId ?? payload.candidate_id ?? payload.candidateId;
      return {
        project_id: typeof projectId === 'string' ? projectId.slice(0, 200) : null,
        release_candidate_id: typeof candidateId === 'string' ? candidateId.slice(0, 200) : null,
      };
    }
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

  _replayCommand(previous, commandType, idempotencyKey, fingerprint) {
    this._assertIdempotencyBinding(previous, commandType, idempotencyKey, fingerprint);
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
    return { ...commandResult(previous), idempotent_replay: true, projection_seq: this._projectionSeq() };
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
    if ((TIMELINE_WORKING_MUTATING_COMMANDS.has(commandType) || TIMING_METADATA_MUTATING_COMMANDS.has(commandType) || RELEASE_CANDIDATE_MUTATING_COMMANDS.has(commandType) || RELEASE_BUILD_PLAN_MUTATING_COMMANDS.has(commandType) || TIMELINE_INTERCHANGE_MUTATING_COMMANDS.has(commandType) || EXTERNAL_EDIT_MUTATING_COMMANDS.has(commandType) || LOCAL_PROBE_MUTATING_COMMANDS.has(commandType) || MEDIA_PROBE_MUTATING_COMMANDS.has(commandType))
      && (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0)) {
      throw new CoreError('IDEMPOTENCY_KEY_REQUIRED', 'VALIDATION', 'errors.idempotency_key_required', {
        command_type: commandType,
      }, { needsUser: true });
    }
    const requestFingerprint = idempotencyKey ? idempotencyFingerprint(payload, expectedVersions) : null;
    // Ownership is checked before idempotency replay.  A fenced process must
    // not even read a prior result as though it still had mutation authority.
    this._assertCoreOwner();
    const previous = this._findIdempotent(commandType, idempotencyKey);
    if (previous) return this._replayCommand(previous, commandType, idempotencyKey, requestFingerprint);

    const commandId = uuidv7();
    const created = nowUtcUs();
    const projectId = this._commandProjectId(commandType, payload);
    try {
      this._transaction(() => {
        this._assertCoreOwner();
        this.db.prepare(`INSERT INTO commands
          (id, studio_id, project_id, actor_id, command_type, schema_version, scope_type, scope_id,
           payload_json, expected_versions_json, reversibility, status, idempotency_key,
           idempotency_fingerprint, created_at_utc_us)
          VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 'RECEIVED', ?, ?, ?)`).run(
          commandId, this.studioId, projectId, this.actorId, commandType,
          projectId ? 'PROJECT' : 'SYSTEM', projectId, json(this._commandPayloadForStorage(commandType, payload)),
          json(MEDIA_PROBE_MUTATING_COMMANDS.has(commandType)
            ? this._mediaProbeExpectedForStorage(commandType, payload, expectedVersions)
            : expectedVersions),
          this._reversibility(commandType), idempotencyKey, requestFingerprint, created,
        );
      });
    } catch (error) {
      // Another Core process may have won the idempotency insert between the
      // lookup above and this transaction. Re-read and replay its exact row so
      // retries stay typed/idempotent instead of surfacing raw SQLite errors.
      if (isCoreOwnershipFailure(error)) throw error;
      const raced = this._findIdempotent(commandType, idempotencyKey);
      if (raced) return this._replayCommand(raced, commandType, idempotencyKey, requestFingerprint);
      throw error;
    }

    let stagingReservation = null;
    let backupReservation = null;
    let externalCommandPrepared = false;
    let exportAttemptRowVersion = null;
    try {
      // Staging, VACUUM preparation, and generated-byte materialization are
      // external side effects.  Recheck immediately before any of them.
      this._assertCoreOwner();
      // COPY imports reserve and populate a durable staging row before the
      // canonical command transaction starts.  If the process stops during
      // the file operation, the row and private temp bytes remain available
      // for explicit reconciliation instead of becoming an untracked orphan.
      const importCommand = ['ImportAsset', 'RegisterAsset', 'ImportLocalAsset'].includes(commandType);
      const storageMode = String(payload.storage_mode ?? payload.storageMode ?? 'COPY').trim().toUpperCase();
      if (importCommand && storageMode === 'COPY') {
        const existingStagingId = payload.staging_id ?? payload.stagingId ?? payload.source_handle ?? payload.sourceHandle;
        stagingReservation = existingStagingId
          ? this._useExistingImportStaging(payload)
          : this._reserveImportStaging(payload, commandId);
      }
      if (TIMELINE_INTERCHANGE_MUTATING_COMMANDS.has(commandType)) stagingReservation = this._reserveGeneratedStaging(payload, expectedVersions, commandId);
      if (commandType === 'BuildTimelineInterchangeExport' && stagingReservation?.context) {
        // Materialize and hash the generated bytes before entering the command
        // transaction.  The transaction below only registers the already
        // verified CAS identity and canonical rows; it never holds SQLite
        // writer locks across filesystem I/O.
        exportAttemptRowVersion = Number(stagingReservation.context.session.row_version);
        const preparedMaterialization = this._materializeStagedObject(
          stagingReservation.id, 'SHA-256', stagingReservation.context.documentHash, stagingReservation.context.byteSize,
        );
        this._protectManagedObject(preparedMaterialization.target, stagingReservation.context.documentHash);
        const preparedDigest = this._hashLocalFile(preparedMaterialization.target);
        if (preparedDigest.content_hash !== stagingReservation.context.documentHash || preparedDigest.byte_size !== stagingReservation.context.byteSize) {
          if (preparedMaterialization.created) { try { fs.rmSync(preparedMaterialization.target, { force: true }); } catch { /* preserve primary error */ } }
          throw new CoreError('EXPORT_OBJECT_TAMPERED', 'CONFLICT', 'errors.export_object_tampered', {}, { needsUser: true });
        }
        stagingReservation = {
          ...stagingReservation,
          // Keep the digest beside the materialization as an internal
          // execution proof.  It is never persisted in the command payload;
          // the build path validates its shape and content identity before it
          // registers the CAS location.
          preparedMaterialization: { ...preparedMaterialization, digest: preparedDigest },
          preparedDigest,
        };
      }
      if (commandType === 'CreateBackup') {
        // VACUUM INTO cannot run inside a SQLite transaction.  Mark the
        // command executing first, create and verify the external artifact,
        // then atomically register its immutable manifest below.
        this._transaction(() => {
          this._assertCoreOwner();
          this.db.prepare('UPDATE commands SET status = ?, started_at_utc_us = ? WHERE id = ?')
            .run('EXECUTING', nowUtcUs(), commandId);
        });
        externalCommandPrepared = true;
        backupReservation = this._prepareBackup(payload, commandId);
      }
      const applied = this._transaction(() => {
        // The final canonical transaction is the last fence.  A takeover
        // between staging and commit can therefore never publish an old
        // process's event/outbox mutation.
        this._assertCoreOwner();
        if (!externalCommandPrepared) {
          this.db.prepare('UPDATE commands SET status = ?, started_at_utc_us = ? WHERE id = ?')
            .run('EXECUTING', nowUtcUs(), commandId);
        }
        const executionPayload = stagingReservation
          ? {
            ...payload,
            __staging_id: stagingReservation.id,
            ...(stagingReservation.preparedMaterialization ? { __prepared_materialization: stagingReservation.preparedMaterialization } : {}),
          }
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
      const response = this._commandResponse(commandId, applied);
      if (LOCAL_PROBE_MUTATING_COMMANDS.has(commandType)) this._scheduleLocalProbeRunner();
      return response;
    } catch (error) {
      const coreError = error instanceof CoreError ? error : new CoreError(
        'INTERNAL_ERROR', 'INTERNAL', 'errors.internal', {}, { needsUser: false, technicalDetails: { message: String(error?.message ?? error) } },
      );
      if (isCoreOwnershipFailure(coreError)) throw coreError;
      if (stagingReservation?.id && stagingReservation.owned !== false) {
        try {
          this._transaction(() => {
            const current = this._stagingRow(stagingReservation.id);
            if (['WRITING', 'COMPLETE', 'VERIFIED'].includes(current.state)) this._setStagingState(stagingReservation.id, 'ORPHANED');
          });
        } catch { /* preserve command failure; evidence remains queryable */ }
      }
      if (TIMELINE_INTERCHANGE_MUTATING_COMMANDS.has(commandType)) {
        this._markTimelineInterchangeExportFailure(payload, coreError, commandId, exportAttemptRowVersion);
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
    if (commandType === 'ProbeMediaAsset') {
      if (typeof payload.asset_revision_id !== 'string') return null;
      return this.db.prepare('SELECT a.project_id FROM asset_revisions r JOIN assets a ON a.id=r.asset_id WHERE r.id=?').get(payload.asset_revision_id)?.project_id ?? null;
    }
    if (MEDIA_PROBE_MUTATING_COMMANDS.has(commandType)) {
      if (typeof payload.job_id !== 'string') return null;
      return this.db.prepare('SELECT project_id FROM media_probe_jobs WHERE id=?').get(payload.job_id)?.project_id ?? null;
    }
    const explicitProjectId = payload.project_id ?? payload.projectId;
    // For entity-scoped commands, derive the command's project from the
    // target row.  A caller-supplied project_id is only a scope assertion and
    // is checked by the command implementation; it must never cause the audit
    // record to claim a different project from the entity being mutated.
    const entityType = String(payload.entity_type ?? payload.entityType ?? '').trim().toUpperCase();
    const entityId = payload.entity_id ?? payload.entityId;
    if (commandType === 'RunManagedAssetIntegrityProbe') {
      const revisionId = payload.asset_revision_id ?? payload.assetRevisionId;
      if (revisionId) return this.db.prepare(`SELECT a.project_id FROM asset_revisions r JOIN assets a ON a.id = r.asset_id WHERE r.id = ?`).get(revisionId)?.project_id ?? null;
    }
    if (['CancelManagedAssetIntegrityProbe', 'RetryManagedAssetIntegrityProbe'].includes(commandType)) {
      const jobId = payload.job_id ?? payload.jobId ?? payload.id;
      if (jobId) return this.db.prepare('SELECT project_id FROM jobs WHERE id = ?').get(jobId)?.project_id ?? null;
    }
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
    if (['CreateAudioCueRevision', 'TransitionAudioCueRevision'].includes(commandType)) {
      const cueId = payload.audio_cue_id ?? payload.audioCueId ?? payload.cue_id ?? payload.cueId;
      if (cueId) return this.db.prepare('SELECT project_id FROM audio_cues WHERE id = ?').get(cueId)?.project_id ?? null;
      const cueRevisionId = payload.audio_cue_revision_id ?? payload.audioCueRevisionId;
      if (cueRevisionId) return this.db.prepare(`SELECT c.project_id FROM audio_cue_revisions r
        JOIN audio_cues c ON c.id = r.audio_cue_id WHERE r.id = ?`).get(cueRevisionId)?.project_id ?? null;
      const timelineId = payload.timeline_id ?? payload.timelineId;
      if (timelineId) return this.db.prepare('SELECT project_id FROM timelines WHERE id = ?').get(timelineId)?.project_id ?? null;
    }
    if (['CreateSubtitleTrackRevision', 'TransitionSubtitleTrackRevision'].includes(commandType)) {
      const trackId = payload.subtitle_track_id ?? payload.subtitleTrackId ?? payload.track_id ?? payload.trackId;
      if (trackId) return this.db.prepare('SELECT project_id FROM subtitle_tracks WHERE id = ?').get(trackId)?.project_id ?? null;
      const trackRevisionId = payload.subtitle_track_revision_id ?? payload.subtitleTrackRevisionId;
      if (trackRevisionId) return this.db.prepare(`SELECT t.project_id FROM subtitle_track_revisions r
        JOIN subtitle_tracks t ON t.id = r.subtitle_track_id WHERE r.id = ?`).get(trackRevisionId)?.project_id ?? null;
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
    if (commandType === 'CreateReleaseCandidateDraft') {
      if (typeof explicitProjectId === 'string' && explicitProjectId.trim()) return this.db.prepare('SELECT id FROM projects WHERE id = ?').get(explicitProjectId)?.id ?? null;
      return null;
    }
    if (commandType === 'CreateReleaseBuildPlan') {
      const candidateId = payload.release_candidate_id ?? payload.releaseCandidateId ?? payload.candidate_id ?? payload.candidateId;
      if (typeof candidateId === 'string' && candidateId.trim()) return this.db.prepare('SELECT project_id FROM release_candidates WHERE id = ?').get(candidateId)?.project_id ?? null;
      if (typeof explicitProjectId === 'string' && explicitProjectId.trim()) return this.db.prepare('SELECT id FROM projects WHERE id = ?').get(explicitProjectId)?.id ?? null;
      return null;
    }
    if (commandType === 'BuildTimelineInterchangeExport') {
      const exportSessionId = payload.export_session_id ?? payload.exportSessionId ?? payload.handoff_id ?? payload.handoffId;
      if (typeof exportSessionId === 'string' && exportSessionId.trim()) return this.db.prepare('SELECT project_id FROM export_sessions WHERE id = ?').get(exportSessionId)?.project_id ?? null;
    }
    if (commandType === 'RegisterExternalEdit') {
      const returnedRevisionId = payload.returned_asset_revision_id ?? payload.returnedAssetRevisionId;
      if (typeof returnedRevisionId === 'string' && returnedRevisionId.trim()) {
        return this.db.prepare(`SELECT a.project_id FROM asset_revisions r JOIN assets a ON a.id = r.asset_id WHERE r.id = ?`).get(returnedRevisionId)?.project_id ?? null;
      }
      const handoffId = payload.handoff_manifest_id ?? payload.handoffManifestId;
      if (typeof handoffId === 'string' && handoffId.trim()) {
        return this.db.prepare('SELECT project_id FROM handoff_manifests WHERE id = ?').get(handoffId)?.project_id ?? null;
      }
      if (typeof explicitProjectId === 'string' && explicitProjectId.trim()) return this.db.prepare('SELECT id FROM projects WHERE id = ?').get(explicitProjectId)?.id ?? null;
      return null;
    }
    if (commandType === 'CancelReleaseCandidateDraft') {
      const candidateId = payload.release_candidate_id ?? payload.releaseCandidateId ?? payload.candidate_id ?? payload.candidateId ?? payload.id;
      if (typeof candidateId === 'string' && candidateId.trim()) return this.db.prepare('SELECT project_id FROM release_candidates WHERE id = ?').get(candidateId)?.project_id ?? null;
      return null;
    }
    if (commandType === 'CreateHandoffManifest') {
      const revisionId = payload.timeline_revision_id ?? payload.timelineRevisionId ?? payload.revision_id ?? payload.revisionId;
      if (revisionId) return this.db.prepare(`SELECT t.project_id FROM timeline_revisions r
        JOIN timelines t ON t.id = r.timeline_id WHERE r.id = ?`).get(revisionId)?.project_id ?? null;
    }
    if (['BeginTimelineWorkingSession', 'ApplyTimelineEditOp', 'UndoTimelineEditOp', 'RedoTimelineEditOp',
      'AutosaveTimelineWorkingSession', 'CheckpointTimelineWorkingSession', 'CloseTimelineWorkingSession'].includes(commandType)) {
      const sessionId = payload.working_session_id ?? payload.workingSessionId ?? payload.session_id ?? payload.sessionId;
      if (sessionId) return this.db.prepare(`SELECT t.project_id FROM timeline_working_sessions s
        JOIN timelines t ON t.id = s.timeline_id WHERE s.id = ?`).get(sessionId)?.project_id ?? null;
      const timelineId = payload.timeline_id ?? payload.timelineId;
      if (timelineId) return this.db.prepare('SELECT project_id FROM timelines WHERE id = ?').get(timelineId)?.project_id ?? null;
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
    if (RELEASE_CANDIDATE_MUTATING_COMMANDS.has(commandType)) return 'COMPENSATABLE';
    if (RELEASE_BUILD_PLAN_MUTATING_COMMANDS.has(commandType)) return 'COMPENSATABLE';
    if (TIMELINE_INTERCHANGE_MUTATING_COMMANDS.has(commandType)) return 'COMPENSATABLE';
    if (EXTERNAL_EDIT_MUTATING_COMMANDS.has(commandType)) return 'COMPENSATABLE';
    if (LOCAL_PROBE_MUTATING_COMMANDS.has(commandType)) return 'COMPENSATABLE';
    if (['CreateHandoffManifest', 'BeginTimelineWorkingSession', 'ApplyTimelineEditOp', 'UndoTimelineEditOp', 'RedoTimelineEditOp',
      'AutosaveTimelineWorkingSession', 'CheckpointTimelineWorkingSession', 'CloseTimelineWorkingSession'].includes(commandType)) return 'COMPENSATABLE';
    if (['CreateAudioCueRevision', 'TransitionAudioCueRevision', 'CreateSubtitleTrackRevision', 'TransitionSubtitleTrackRevision'].includes(commandType)) return 'COMPENSATABLE';
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
      case 'CreateAudioCueRevision': return this._createAudioCueRevision(payload, expectedVersions);
      case 'TransitionAudioCueRevision': return this._transitionAudioCueRevision(payload, expectedVersions);
      case 'CreateSubtitleTrackRevision': return this._createSubtitleTrackRevision(payload, expectedVersions);
      case 'TransitionSubtitleTrackRevision': return this._transitionSubtitleTrackRevision(payload, expectedVersions);
      case 'OpenReview': return this._openReview(payload, expectedVersions);
      case 'SubmitReview': return this._submitReview(payload, expectedVersions);
      case 'CreateReleaseCandidateDraft': return this._createReleaseCandidateDraft(payload, commandId);
      case 'CancelReleaseCandidateDraft': return this._cancelReleaseCandidateDraft(payload, expectedVersions);
      case 'CreateReleaseBuildPlan': return this._createReleaseBuildPlan(payload, expectedVersions, commandId);
      case 'BuildTimelineInterchangeExport': return this._buildTimelineInterchangeExport(payload, expectedVersions, commandId);
      case 'CreateHandoffManifest': return this._createHandoffManifest(payload, expectedVersions, commandId);
      case 'RegisterExternalEdit': return this._registerExternalEdit(payload, expectedVersions, commandId);
      case 'BeginTimelineWorkingSession': return this._beginTimelineWorkingSession(payload, expectedVersions);
      case 'ApplyTimelineEditOp': return this._applyTimelineEditOp(payload, expectedVersions);
      case 'UndoTimelineEditOp': return this._undoTimelineEditOp(payload, expectedVersions);
      case 'RedoTimelineEditOp': return this._redoTimelineEditOp(payload, expectedVersions);
      case 'AutosaveTimelineWorkingSession': return this._autosaveTimelineWorkingSession(payload, expectedVersions);
      case 'CheckpointTimelineWorkingSession': return this._checkpointTimelineWorkingSession(payload, expectedVersions, commandId);
      case 'CloseTimelineWorkingSession': return this._closeTimelineWorkingSession(payload, expectedVersions);
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
      case 'RunManagedAssetIntegrityProbe': return this._runManagedAssetIntegrityProbe(payload, commandId);
      case 'ProbeMediaAsset': return this._admitMediaProbe(payload, expectedVersions, commandId);
      case 'CancelMediaProbe': return this._cancelMediaProbe(payload, expectedVersions);
      case 'RetryMediaProbe': return this._retryMediaProbe(payload, expectedVersions);
      case 'CancelManagedAssetIntegrityProbe': return this._cancelManagedAssetIntegrityProbe(payload, expectedVersions);
      case 'RetryManagedAssetIntegrityProbe': return this._retryManagedAssetIntegrityProbe(payload, expectedVersions, commandId);
      case 'AddNote':
      case 'AddTaskNote':
      case 'AddShotNote': return this._addNote(payload, commandType);
      default:
        throw new CoreError('UNSUPPORTED_COMMAND', 'VALIDATION', 'errors.unsupported_command', { command_type: commandType });
    }
  }

  // PREPARED admission only. No process/producer/measurement authority is
  // reachable here, including when renderer preflight verifies an artifact.
  _mediaProbeFields(payload, allowed) {
    if (Object.keys(payload).some(key => !allowed.includes(key))) {
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.media_probe_identity_only', {}, { needsUser: true });
    }
  }

  _mediaProbeId(value, field) {
    if (typeof value !== 'string' || value.length < 1 || value.length > 200 || /[^A-Za-z0-9_-]/.test(value)) {
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field });
    }
    return value;
  }

  _mediaProbeExpectedForStorage(commandType, payload, expected) {
    const kind = commandType === 'ProbeMediaAsset' ? 'ASSET' : 'JOB';
    const id = kind === 'JOB' ? payload.job_id : typeof payload.asset_revision_id === 'string'
      ? this.db.prepare('SELECT asset_id FROM asset_revisions WHERE id=?').get(payload.asset_revision_id)?.asset_id : null;
    const value = expected[kind] ?? expected[kind.toLowerCase()] ?? expected[`${kind}:${id}`] ?? (id ? expected[id] : undefined);
    return Number.isSafeInteger(value) && value >= 1 ? { [kind]: value } : {};
  }

  _mediaProbeVersion(expected, kind, id, actual) {
    const allowed = [kind, kind.toLowerCase(), `${kind}:${id}`, id];
    if (Object.keys(expected).some(key => !allowed.includes(key)) || Object.keys(expected).length > 1) {
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.media_probe_version_invalid', {});
    }
    const value = expected[kind] ?? expected[kind.toLowerCase()] ?? expected[`${kind}:${id}`] ?? expected[id];
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field: 'expected_version' });
    }
    this._expectedVersion(expected, kind, id, actual);
  }

  _mediaProbeSource(projectId, revisionId) {
    this._mediaProbeId(projectId, 'project_id'); this._mediaProbeId(revisionId, 'asset_revision_id');
    const row = this.db.prepare(`SELECT r.id,r.asset_id,r.storage_object_id,r.availability_state,
      a.project_id,a.asset_type,a.lifecycle_state,a.row_version,
      o.content_hash,o.byte_size,o.hash_algorithm,o.storage_class
      FROM asset_revisions r JOIN assets a ON a.id=r.asset_id
      LEFT JOIN storage_objects o ON o.id=r.storage_object_id WHERE r.id=?`).get(revisionId);
    if (!row) throw new CoreError('ASSET_REVISION_NOT_FOUND', 'VALIDATION', 'errors.asset_revision_not_found', {});
    if (row.project_id !== projectId) throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', {}, { needsUser: true });
    if (typeof row.content_hash !== 'string' || !/^[a-f0-9]{64}$/.test(row.content_hash)
      || !Number.isSafeInteger(row.byte_size) || row.byte_size < 0) {
      throw new CoreError('PROBE_MEDIA_IDENTITY_UNKNOWN', 'CONFLICT', 'errors.media_probe_identity_unknown', {}, { needsUser: true });
    }
    return row;
  }

  _mediaProbeRights(assetId) {
    const evaluation = this._rightsForAsset(assetId, { right_type: 'SOURCE_USE', consent_type: 'SOURCE_USE', purpose: 'MEDIA_INSPECTION' });
    const { evaluated_at, ...stable } = evaluation;
    return { eligible: evaluation.eligible === true && evaluation.status === 'ALLOWED',
      generation: crypto.createHash('sha256').update(canonicalJson(stable)).digest('hex') };
  }

  #verifiedMediaProbeAuthority(job) {
    const fail = code => { throw new CoreError(code, 'CONFLICT', 'errors.media_probe_identity_unknown', {}, { needsUser: true }); };
    if (!this.#mediaProbeTrustSource) fail('PROBE_AUTHORITY_UNAVAILABLE');
    const artifact = this._releaseRendererToolchainPreflight();
    const policyFloor = this.db.prepare('SELECT COALESCE(MAX(policy_epoch),1) AS n FROM media_probe_authorizations').get().n;
    let authority;
    try { authority = this.#mediaProbeTrustSource(); } catch { fail('PROBE_AUTHORITY_UNAVAILABLE'); }
    if (!authority || typeof authority !== 'object' || Array.isArray(authority)
      || Object.keys(authority).some(key => !['envelopeBytes', 'trustPolicyBytes', 'trustContext'].includes(key))) fail('PROBE_AUTHORITY_INVALID');
    const clock = authority.trustContext && typeof authority.trustContext === 'object' && !Array.isArray(authority.trustContext)
      ? { ...authority.trustContext } : null;
    const minimumPolicyEpoch = Number.isSafeInteger(clock?.minimumPolicyEpoch) && clock.minimumPolicyEpoch > 0
      ? Math.max(clock.minimumPolicyEpoch, policyFloor) : clock?.minimumPolicyEpoch;
    const proof = verifyMediaProbeAttestation({ envelopeBytes: authority.envelopeBytes, trustPolicyBytes: authority.trustPolicyBytes,
      trustContext: clock && { ...clock, minimumPolicyEpoch }, artifact });
    if (proof.state !== 'ATTESTATION_VERIFIED') fail(proof.code);
    if (proof.manifest_sha256 !== job.toolchain_manifest_hash || proof.ffprobe_sha256 !== job.toolchain_binary_hash
      || proof.toolchain_id !== job.toolchain_id || proof.toolchain_version !== job.toolchain_version
      || proof.probe_schema_version !== job.probe_schema_version || proof.parser_policy_version !== job.parser_policy_version) fail('PROBE_TOOLCHAIN_STALE');
    const packFloor = this.db.prepare(`SELECT COALESCE(MAX(z.certification_epoch),1) AS n FROM media_probe_authorizations z
      JOIN media_probe_jobs j ON j.id=z.job_id WHERE j.toolchain_id=? AND z.key_spki_hash=?`).get(job.toolchain_id, proof.key_spki_sha256).n;
    if (proof.certification_epoch < packFloor) fail('PROBE_ATTESTATION_PACK_ROLLBACK');
    const stamp = clock.nowUtcMs * 1000;
    const from = proof.valid_from_utc_ms * 1000; const until = proof.valid_until_utc_ms * 1000;
    if (![stamp, from, until].every(value => Number.isSafeInteger(value) && value > 0)) fail('PROBE_AUTHORITY_CLOCK_INVALID');
    const pins = { certificate_hash: proof.certificate_sha256, trust_generation: proof.trust_generation,
      key_id: proof.key_id, key_spki_hash: proof.key_spki_sha256, policy_epoch: proof.policy_epoch,
      certification_epoch: proof.certification_epoch, not_before_utc_us: from, expires_at_utc_us: until };
    return { proof, pins, stamp, from, until };
  }

  // Private integration lane: no handle/RPC/HTTP route calls this method.
  // A reservation is not dispatch authority and never executes media.
  prepareMediaProbeAttempt(request) {
    const fail = code => { throw new CoreError(code, 'CONFLICT', 'errors.media_probe_identity_unknown', {}, { needsUser: true }); };
    if (this._closed || !this.db) fail('PROBE_CORE_CLOSED');
    if (!this.#mediaProbeRecoveryReady) fail('PROBE_RECOVERY_REQUIRED');
    if (!request || typeof request !== 'object' || Array.isArray(request)) fail('INVALID_ARGUMENT');
    this._mediaProbeFields(request, ['project_id', 'job_id', 'expected_version', 'idempotency_key']);
    for (const field of ['project_id', 'job_id', 'idempotency_key']) this._mediaProbeId(request[field], field);
    if (!Number.isSafeInteger(request.expected_version) || request.expected_version < 1) fail('EXPECTED_VERSION_REQUIRED');
    const identity = { project_id: request.project_id, job_id: request.job_id, expected_version: request.expected_version };
    const fingerprint = crypto.createHash('sha256').update(canonicalJson(identity)).digest('hex');
    const commandType = 'PREPARED_AUTHORIZE_MEDIA_PROBE_V1';
    return this._transaction(() => {
      this._assertCoreOwner();
      const job = this._mediaProbeJob(identity.job_id, identity.project_id);
      const checkProject = () => {
        const project = this._project(job.project_id);
        this._assertProjectWritable(project);
        if (project.lifecycle_state !== 'ACTIVE') fail('PROJECT_NOT_WRITABLE');
      };
      checkProject();
      const existing = this.db.prepare('SELECT * FROM commands WHERE actor_id=? AND command_type=? AND idempotency_key=?')
        .get(this.actorId, commandType, request.idempotency_key);
      if (existing && (existing.idempotency_fingerprint !== fingerprint || existing.status !== 'SUCCEEDED')) {
        fail('IDEMPOTENCY_KEY_REUSE_CONFLICT');
      }
      if (!existing) {
        this._mediaProbeVersion({ JOB: request.expected_version }, 'JOB', job.id, job.row_version);
        if (job.state !== 'QUEUED' || job.current_attempt_id !== null
          || this.db.prepare('SELECT id FROM media_probe_attempts WHERE job_id=? LIMIT 1').get(job.id)) fail('PROBE_RESERVATION_NOT_AVAILABLE');
        if (job.row_version >= Number.MAX_SAFE_INTEGER) fail('PROBE_JOB_VERSION_LIMIT');
      }
      const checkSource = () => {
        const source = this._mediaProbeSource(job.project_id, job.asset_revision_id);
        const location = this.db.prepare('SELECT * FROM storage_object_locations WHERE id=?').get(job.storage_object_location_id);
        if (!['AUDIO', 'VIDEO'].includes(source.asset_type) || source.lifecycle_state !== 'ACTIVE' || source.availability_state !== 'AVAILABLE'
        || source.storage_class !== 'LOCAL_MANAGED' || source.hash_algorithm !== 'SHA-256'
        || source.content_hash !== job.source_content_hash || source.byte_size !== job.source_byte_size
        || source.byte_size < 1 || source.byte_size > 1073741824 || !location || location.storage_object_id !== source.storage_object_id
        || location.storage_root !== 'asset-store' || location.location_role !== 'PRIMARY' || location.state !== 'AVAILABLE') fail('PROBE_SOURCE_STALE');
        return source;
      };
      const source = checkSource();
      const checkRights = () => {
        const rights = this._mediaProbeRights(source.asset_id);
        if (!rights.eligible) fail('PROBE_RIGHTS_BLOCKED');
        if (rights.generation !== job.rights_generation) fail('PROBE_RIGHTS_STALE');
      };
      checkRights();
      const original = this.db.prepare('SELECT command_type,project_id,status FROM commands WHERE id=?').get(job.command_id);
      if (!original || original.command_type !== 'ProbeMediaAsset' || original.project_id !== job.project_id
        || !['EXECUTING', 'SUCCEEDED'].includes(original.status)) fail('PROBE_COMMAND_SCOPE_INVALID');
      const { pins, stamp, from, until } = this.#verifiedMediaProbeAuthority(job);
      checkSource(); checkRights(); this._assertCoreOwner(); checkProject();
      const currentJob = this._mediaProbeJob(job.id, job.project_id);
      if (['row_version', 'state', 'current_attempt_id', 'fencing_token', 'toolchain_id', 'toolchain_version', 'toolchain_binary_hash']
        .some(field => currentJob[field] !== job[field])) fail('PROBE_RESERVATION_STALE');
      if (existing) {
        const receipt = JSON.parse(existing.result_json);
        const attempt = this.db.prepare('SELECT * FROM media_probe_attempts WHERE id=?').get(receipt.attempt_id);
        const authorization = attempt && this.db.prepare('SELECT * FROM media_probe_authorizations WHERE id=?').get(attempt.authorization_id);
        if (receipt.contract !== 'PREPARED_MEDIA_PROBE_AUTHORIZATION_V1' || receipt.execution_started !== false
          || receipt.job_id !== job.id || !attempt || !authorization || attempt.job_id !== job.id || attempt.state !== 'CREATED'
          || job.state !== 'CLAIMED' || job.row_version !== receipt.job_version
          || job.current_attempt_id !== attempt.id || job.fencing_token !== attempt.fencing_token
          || attempt.core_owner_epoch !== this.instanceEpoch || authorization.core_owner_epoch !== this.instanceEpoch
          || authorization.attempt_id !== attempt.id || authorization.fencing_token !== attempt.fencing_token
          || receipt.authorization_id !== authorization.id || Object.entries(pins).some(([key, value]) => authorization[key] !== value)) fail('PROBE_RESERVATION_STALE');
        return Object.freeze(receipt);
      }
      const commandId = uuidv7(); const attemptId = uuidv7(); const authorizationId = uuidv7();
      const fence = crypto.randomBytes(32).toString('hex');
      this.db.prepare(`INSERT INTO commands
        (id,studio_id,project_id,actor_id,command_type,schema_version,scope_type,scope_id,payload_json,
          expected_versions_json,reversibility,status,idempotency_key,idempotency_fingerprint,created_at_utc_us,started_at_utc_us)
        VALUES (?,?,?,?,?,1,'MEDIA_PROBE_JOB',?, ?,?,'COMPENSATABLE','EXECUTING',?,?,?,?)`).run(
        commandId, this.studioId, job.project_id, this.actorId, commandType, job.id, json(identity),
        json({ JOB: identity.expected_version }), request.idempotency_key, fingerprint, stamp, stamp);
      this.db.prepare(`INSERT INTO media_probe_authorizations
        (id,job_id,attempt_id,fencing_token,core_owner_epoch,certificate_hash,trust_generation,key_id,key_spki_hash,
          policy_epoch,certification_epoch,source_content_hash,source_byte_size,toolchain_manifest_hash,toolchain_binary_hash,
          rights_generation,producer_contract_version,argv_preset_id,sandbox_profile_version,resource_profile_version,
          not_before_utc_us,expires_at_utc_us,created_at_utc_us)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'NATIVE_MEDIA_PROBE_BROKER_V1','MEDIA_PROBE_ARGV_V1',
          'WINDOWS_APPCONTAINER_PROBE_V1','MEDIA_PROBE_RESOURCE_V1',?,?,?)`).run(
        authorizationId, job.id, attemptId, fence, this.instanceEpoch, pins.certificate_hash, pins.trust_generation,
        pins.key_id, pins.key_spki_hash, pins.policy_epoch, pins.certification_epoch, job.source_content_hash, job.source_byte_size,
        job.toolchain_manifest_hash, job.toolchain_binary_hash, job.rights_generation, from, until, stamp);
      this.db.prepare(`INSERT INTO media_probe_attempts
        (id,job_id,attempt_no,retry_kind,idempotency_key,fencing_token,producer_contract_version,argv_preset_id,
          state,authorization_id,core_owner_epoch,created_at_utc_us,updated_at_utc_us)
        VALUES (?,?,1,'INITIAL',?,?,'NATIVE_MEDIA_PROBE_BROKER_V1','MEDIA_PROBE_ARGV_V1','CREATED',?,?,?,?)`).run(
        attemptId, job.id, request.idempotency_key, fence, authorizationId, this.instanceEpoch, stamp, stamp);
      const updated = this.db.prepare(`UPDATE media_probe_jobs SET state='CLAIMED',current_attempt_id=?,fencing_token=?,needs_user=0,
        next_step='Đã lưu quyền kiểm tra; chờ runtime cục bộ.',row_version=row_version+1,updated_at_utc_us=? WHERE id=? AND row_version=?`).run(
        attemptId, fence, stamp, job.id, job.row_version);
      if (Number(updated.changes) !== 1) fail('PROBE_RESERVATION_STALE');
      this.db.prepare(`INSERT INTO command_impacts (command_id,entity_type,entity_id,impact_type,severity,details_json)
        VALUES (?,'MEDIA_PROBE_JOB',?,'MUTATES','LOW',?)`).run(commandId, job.id, json({ execution_started: false }));
      this._insertEvent({ aggregateType: 'MEDIA_PROBE_JOB', aggregateId: job.id, aggregateVersion: job.row_version + 1,
        eventType: 'MEDIA_PROBE_ATTEMPT_AUTHORIZED', payload: { job_id: job.id, attempt_id: attemptId, execution_started: false } },
      commandId, this.actorId, job.correlation_id, job.command_id);
      this._insertAudit({ actionType: 'media_probe.prepare_attempt', targetType: 'MEDIA_PROBE_JOB', targetId: job.id,
        payload: { attempt_id: attemptId, execution_started: false } }, commandId, this.actorId, 'SUCCEEDED');
      const receipt = Object.freeze({ contract: 'PREPARED_MEDIA_PROBE_AUTHORIZATION_V1', state: 'PREPARED', job_id: job.id,
        attempt_id: attemptId, authorization_id: authorizationId, job_version: job.row_version + 1, execution_started: false });
      this.db.prepare("UPDATE commands SET status='SUCCEEDED',finished_at_utc_us=?,result_json=? WHERE id=?").run(stamp, json(receipt), commandId);
      return receipt;
    });
  }

  // PREPARED internal unbound lane; intentionally absent from handle and HTTP.
  async dispatchMediaProbeAttempt(request) {
    const fail = code => { throw new CoreError(code, 'CONFLICT', 'errors.media_probe_identity_unknown', {}, { needsUser: true }); };
    if (this._closed || !this.db) fail('PROBE_CORE_CLOSED');
    if (!this.#mediaProbeRecoveryReady) fail('PROBE_RECOVERY_REQUIRED');
    if (!request || typeof request !== 'object' || Array.isArray(request)) fail('INVALID_ARGUMENT');
    this._mediaProbeFields(request, ['project_id', 'job_id', 'attempt_id', 'expected_version', 'idempotency_key']);
    for (const field of ['project_id', 'job_id', 'attempt_id', 'idempotency_key']) this._mediaProbeId(request[field], field);
    if (!Number.isSafeInteger(request.expected_version) || request.expected_version < 1) fail('EXPECTED_VERSION_REQUIRED');
    if (this.#mediaProbeDispatch) fail('PROBE_DISPATCH_BUSY');
    if (process.platform !== 'win32' || !this._ownershipEnabled) fail('PROBE_BROKER_PLATFORM_UNSUPPORTED');
    const identity = { project_id: request.project_id, job_id: request.job_id, attempt_id: request.attempt_id, expected_version: request.expected_version };
    const hash = value => crypto.createHash('sha256').update(typeof value === 'string' || value instanceof Uint8Array ? value : canonicalJson(value)).digest('hex');
    const fingerprint = hash(identity); const type = 'PREPARED_DISPATCH_MEDIA_PROBE_V1';
    let descriptor; let brokerRequest; let current; let commandId; let started = false;
    const controller = new AbortController();
    const check = (freshAuthority = true, domain = true) => {
      if (this._closed || !this.db) fail('PROBE_CORE_CLOSED');
      this._assertCoreOwner();
      const job = this._mediaProbeJob(request.job_id, request.project_id);
      const attempt = this.db.prepare('SELECT * FROM media_probe_attempts WHERE id=?').get(request.attempt_id);
      const authorization = attempt && this.db.prepare('SELECT * FROM media_probe_authorizations WHERE id=?').get(attempt.authorization_id);
      if (!attempt || !authorization || attempt.job_id !== job.id || job.current_attempt_id !== attempt.id
        || job.fencing_token !== attempt.fencing_token || authorization.fencing_token !== attempt.fencing_token
        || authorization.attempt_id !== attempt.id || authorization.job_id !== job.id
        || attempt.core_owner_epoch !== this.instanceEpoch || authorization.core_owner_epoch !== this.instanceEpoch
        || (current && (job.row_version !== current.jobVersion || attempt.row_version !== current.attemptVersion
          || job.state !== current.jobState || attempt.state !== current.attemptState))) fail('PROBE_DISPATCH_STALE');
      const validateDomain = () => {
        const project = this._project(job.project_id); this._assertProjectWritable(project);
        if (project.lifecycle_state !== 'ACTIVE') fail('PROJECT_NOT_WRITABLE');
        const source = this._mediaProbeSource(job.project_id, job.asset_revision_id);
        const location = this.db.prepare('SELECT * FROM storage_object_locations WHERE id=?').get(job.storage_object_location_id);
        if (!['AUDIO', 'VIDEO'].includes(source.asset_type) || source.lifecycle_state !== 'ACTIVE'
          || source.availability_state !== 'AVAILABLE' || source.storage_class !== 'LOCAL_MANAGED' || source.hash_algorithm !== 'SHA-256'
          || source.content_hash !== job.source_content_hash || source.byte_size !== job.source_byte_size
          || source.byte_size < 1 || source.byte_size > 1073741824 || !location || location.storage_object_id !== source.storage_object_id
          || location.storage_root !== 'asset-store' || location.location_role !== 'PRIMARY' || location.state !== 'AVAILABLE'
          || location.relative_path !== this._objectRelativePath('SHA-256', source.content_hash).split(path.sep).join('/')) fail('PROBE_SOURCE_STALE');
        const rights = this._mediaProbeRights(source.asset_id);
        if (!rights.eligible) fail('PROBE_RIGHTS_BLOCKED');
        if (rights.generation !== job.rights_generation) fail('PROBE_RIGHTS_STALE');
        return location;
      };
      let location = domain ? validateDomain() : null;
      let binaryBytes = null;
      if (freshAuthority) {
        const { pins, proof } = this.#verifiedMediaProbeAuthority(job);
        binaryBytes = proof.ffprobe_byte_size;
        if (Object.entries(pins).some(([field, value]) => authorization[field] !== value)) fail('PROBE_DISPATCH_AUTHORITY_STALE');
        location = validateDomain(); this._assertCoreOwner();
        const j = this._mediaProbeJob(job.id, job.project_id);
        const a = this.db.prepare('SELECT * FROM media_probe_attempts WHERE id=?').get(attempt.id);
        if (['row_version','state','current_attempt_id','fencing_token'].some(field => j[field] !== job[field])
          || ['row_version','state','fencing_token','authorization_id','core_owner_epoch'].some(field => a[field] !== attempt[field])) fail('PROBE_DISPATCH_STALE');
      }
      if (job.row_version >= Number.MAX_SAFE_INTEGER || attempt.row_version >= Number.MAX_SAFE_INTEGER) fail('PROBE_JOB_VERSION_LIMIT');
      return { job, attempt, authorization, location, binaryBytes };
    };
    const journal = (phase, code, result = null) => {
      const { job, attempt } = check(false, phase !== 'UNKNOWN'); const stamp = nowUtcUs();
      const terminal = phase === 'UNKNOWN';
      const aState = terminal ? 'ABANDONED' : phase;
      const jState = terminal ? 'UNKNOWN' : phase === 'EXECUTING' ? 'RUNNING' : 'CLAIMED';
      const metrics = result?.observation;
      this.db.prepare(`UPDATE media_probe_attempts SET state=?,row_version=row_version+1,updated_at_utc_us=?,
        worker_instance_id=COALESCE(worker_instance_id,?),input_envelope_hash=COALESCE(input_envelope_hash,?),
        output_envelope_hash=?,stdout_bytes=?,stderr_bytes=?,cpu_time_ms=?,memory_peak_bytes=? WHERE id=?`).run(
        aState, stamp, descriptor.session_id, hash({ scope: brokerRequest.scope, pins: brokerRequest.pins, budgets: brokerRequest.budgets }),
        metrics ? hash(metrics) : null, metrics?.stdout_bytes ?? null, metrics?.stderr_bytes ?? null,
        metrics?.cpu_time_ms ?? null, metrics?.peak_memory_bytes ?? null, attempt.id);
      const next = terminal ? 'CineForge chưa xác minh metadata. Kiểm tra evidence và runtime trước khi chạy lại.'
        : phase === 'EXECUTING' ? 'CineForge đang đọc thông tin kỹ thuật trong runtime cục bộ.' : 'CineForge đang gửi lượt kiểm tra tới runtime cục bộ.';
      this.db.prepare(`UPDATE media_probe_jobs SET state=?,row_version=row_version+1,updated_at_utc_us=?,needs_user=?,next_step=?,
        current_attempt_id=?,fencing_token=? WHERE id=?`).run(jState, stamp, Number(terminal), next,
        terminal ? null : attempt.id, terminal ? null : attempt.fencing_token, job.id);
      const physical = metrics?.tree_stopped === true ? 'STOPPED' : 'UNKNOWN';
      const payload = { project_id: job.project_id, job_id: job.id, attempt_id: attempt.id, phase, code, physical_tree: physical };
      for (const [entity, id, version] of [['MEDIA_PROBE_ATTEMPT', attempt.id, attempt.row_version + 1], ['MEDIA_PROBE_JOB', job.id, job.row_version + 1]]) {
        this.db.prepare(`INSERT OR IGNORE INTO command_impacts (command_id,entity_type,entity_id,impact_type,severity,details_json)
          VALUES (?,?,?,'MUTATES','MEDIUM',?)`).run(commandId, entity, id, json(payload));
        this._insertEvent({ aggregateType: entity, aggregateId: id, aggregateVersion: version,
          eventType: 'MEDIA_PROBE_DISPATCH_OBSERVED', payload }, commandId, this.actorId, job.correlation_id, job.command_id);
      }
      this._insertAudit({ actionType: 'media_probe.dispatch_' + phase.toLowerCase(), targetType: 'MEDIA_PROBE_JOB', targetId: job.id,
        payload }, commandId, this.actorId, 'SUCCEEDED');
      const receipt = Object.freeze({ contract: 'PREPARED_MEDIA_PROBE_DISPATCH_V1', state: 'UNKNOWN', job_id: job.id,
        attempt_id: attempt.id, job_version: job.row_version + 1, code, execution_started: started, physical_tree: physical });
      if (terminal) this.db.prepare("UPDATE commands SET status='SUCCEEDED_WITH_WARNINGS',finished_at_utc_us=?,result_json=? WHERE id=?").run(stamp, json(receipt), commandId);
      // Update memory only after every SQL/audit operation succeeded.
      return { receipt, cursor: { jobVersion: job.row_version + 1, attemptVersion: attempt.row_version + 1, jobState: jState, attemptState: aState } };
    };
    try {
      const replay = this._transaction(() => {
        this._assertCoreOwner();
        const existing = this.db.prepare('SELECT * FROM commands WHERE actor_id=? AND command_type=? AND idempotency_key=?').get(this.actorId, type, request.idempotency_key);
        if (existing) {
          if (existing.idempotency_fingerprint !== fingerprint || existing.status !== 'SUCCEEDED_WITH_WARNINGS') fail('IDEMPOTENCY_KEY_REUSE_CONFLICT');
          const receipt = JSON.parse(existing.result_json);
          const job = this._mediaProbeJob(request.job_id, request.project_id);
          const attempt = this.db.prepare('SELECT * FROM media_probe_attempts WHERE id=?').get(request.attempt_id);
          if (!attempt || attempt.core_owner_epoch !== this.instanceEpoch || attempt.state !== 'ABANDONED'
            || job.state !== 'UNKNOWN' || job.current_attempt_id !== null || job.fencing_token !== null || job.row_version !== receipt.job_version) fail('PROBE_DISPATCH_STALE');
          return Object.freeze(receipt);
        }
        const { job, attempt, authorization, location, binaryBytes } = check();
        this._mediaProbeVersion({ JOB: request.expected_version }, 'JOB', job.id, job.row_version);
        if (job.state !== 'CLAIMED' || attempt.state !== 'CREATED') fail('PROBE_DISPATCH_STALE');
        if (!this.#mediaProbeBrokerSource) fail('PROBE_BROKER_UNAVAILABLE');
        let supplied; try { supplied = this.#mediaProbeBrokerSource(); } catch { fail('PROBE_BROKER_UNAVAILABLE'); }
        validateProbeBrokerDescriptor(supplied);
        descriptor = Object.freeze({ ...supplied, key: Buffer.from(supplied.key) });
        if (descriptor.core_epoch !== this.instanceEpoch) fail('PROBE_BROKER_SESSION_MISMATCH');
        const manifestPath = this.rendererToolchainManifest ?? path.join(this.rendererToolchainRoot, 'renderer-toolchain.json');
        let fd;
        let bytes;
        try {
          this._assertNoReparsePath(manifestPath);
          fd = fs.openSync(manifestPath, 'r'); const stat = fs.fstatSync(fd);
          if (!stat.isFile() || stat.nlink !== 1 || stat.size < 1 || stat.size > 65536) fail('PROBE_TOOLCHAIN_STALE');
          const buffer = Buffer.alloc(65537); const n = fs.readSync(fd, buffer, 0, buffer.length, 0); bytes = buffer.subarray(0, n);
        } finally { if (fd !== undefined) fs.closeSync(fd); }
        if (hash(bytes) !== job.toolchain_manifest_hash) fail('PROBE_TOOLCHAIN_STALE');
        const manifest = decodeBoundedMediaProbeJson(bytes, { maxBytes: 65536, maxDepth: 8, maxNodes: 256 });
        if (manifest.binaries?.ffprobe?.sha256 !== job.toolchain_binary_hash) fail('PROBE_TOOLCHAIN_STALE');
        const parent = path.join(path.dirname(path.resolve(this.dbPath)), 'media-probe-attempts');
        this._assertNoReparsePath(parent);
        const storage = fs.statfsSync(path.dirname(path.resolve(this.dbPath)), { bigint: true });
        const estimated = BigInt(job.source_byte_size) + BigInt(binaryBytes) + 8388608n + 1048576n + 16777216n;
        if (storage.bavail * storage.bsize < estimated) fail('PROBE_STORAGE_INSUFFICIENT');
        brokerRequest = { scope: { project_id: job.project_id, asset_revision_id: job.asset_revision_id, job_id: job.id,
          attempt_id: attempt.id, fencing_token: attempt.fencing_token }, pins: { source_hash: job.source_content_hash,
          source_bytes: job.source_byte_size, binary_hash: job.toolchain_binary_hash, manifest_hash: job.toolchain_manifest_hash,
          certificate_hash: authorization.certificate_hash, trust_generation: authorization.trust_generation, rights_generation: job.rights_generation },
          input: { source_path: path.join(this.assetStorePath, location.relative_path), binary_path: manifest.binaries.ffprobe.path,
            attempt_root: path.join(parent, attempt.id) },
          budgets: { wall_time_ms: 120000, stdout_limit: 8388608, stderr_limit: 1048576, memory_limit: 536870912 } };
        validateProbeBrokerRequest(brokerRequest);
        check(); // Startup callback and path reads cannot bypass a changed reservation.
        const stamp = nowUtcUs(); commandId = uuidv7();
        this.db.prepare(`INSERT INTO commands (id,studio_id,project_id,actor_id,command_type,schema_version,scope_type,scope_id,
          payload_json,expected_versions_json,reversibility,status,idempotency_key,idempotency_fingerprint,created_at_utc_us,started_at_utc_us)
          VALUES (?,?,?,?,?,1,'MEDIA_PROBE_ATTEMPT',?, ?,?,'COMPENSATABLE','EXECUTING',?,?,?,?)`).run(commandId, this.studioId,
          job.project_id, this.actorId, type, attempt.id, json({ ...identity, estimated_storage_bytes: Number(estimated) }),
          json({ JOB: job.row_version }), request.idempotency_key, fingerprint, stamp, stamp);
        const step = journal('DISPATCHING', 'PROBE_DISPATCH_PREPARED');
        return step.cursor;
      });
      if (replay.contract) return replay;
      current = replay; this.#mediaProbeDispatch = { controller };
      let result = null; let code = 'PROBE_OBSERVATION_UNBOUND';
      try {
        check();
        fs.mkdirSync(path.dirname(brokerRequest.input.attempt_root), { recursive: true });
        result = await runNativeProbeBroker({ descriptor, request: brokerRequest, signal: controller.signal, onStarted: () => {
          started = true;
          check();
          const step = this._transaction(() => journal('EXECUTING', 'PROBE_NATIVE_STARTED')); current = step.cursor;
        } });
        check();
        if (result.observation.code !== 'PROBE_PROCESS_STOPPED') code = result.observation.code;
      } catch (error) {
        code = /^[A-Z][A-Z0-9_]{1,80}$/.test(error?.code ?? '') ? error.code : 'PROBE_BROKER_UNAVAILABLE';
      }
      if (this._closed || !this.db) fail('PROBE_CORE_CLOSED');
      const step = this._transaction(() => journal('UNKNOWN', code, result)); current = step.cursor;
      return step.receipt;
    } finally {
      descriptor?.key.fill(0); controller.abort();
      if (this.#mediaProbeDispatch?.controller === controller) this.#mediaProbeDispatch = null;
    }
  }

  _admitMediaProbe(payload, expected, commandId) {
    this._mediaProbeFields(payload, ['project_id', 'asset_revision_id', 'content_hash', 'byte_size',
      'toolchain_manifest_hash', 'probe_schema_version', 'parser_policy_version']);
    for (const field of ['content_hash', 'toolchain_manifest_hash']) {
      if (typeof payload[field] !== 'string' || !/^[a-f0-9]{64}$/.test(payload[field])) {
        throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field });
      }
    }
    if (!Number.isSafeInteger(payload.byte_size) || payload.byte_size < 0
      || payload.probe_schema_version !== MEDIA_PROBE_SCHEMA_VERSION || payload.parser_policy_version !== MEDIA_PROBE_PARSER_VERSION) {
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.media_probe_identity_invalid', {});
    }
    const source = this._mediaProbeSource(payload.project_id, payload.asset_revision_id);
    this._assertProjectWritable(source.project_id);
    this._mediaProbeVersion(expected, 'ASSET', source.asset_id, source.row_version);
    if (source.content_hash !== payload.content_hash || source.byte_size !== payload.byte_size) {
      throw new CoreError('STALE_REVISION', 'STALE_REVISION', 'errors.stale_revision', {}, { needsUser: true });
    }
    const location = this.db.prepare(`SELECT id FROM storage_object_locations WHERE storage_object_id=?
      AND storage_root='asset-store' AND location_role='PRIMARY' AND state='AVAILABLE'
      ORDER BY created_at_utc_us,id LIMIT 1`).get(source.storage_object_id);
    if (source.storage_class !== 'LOCAL_MANAGED' || source.hash_algorithm !== 'SHA-256' || !location) {
      throw new CoreError('PROBE_MEDIA_NOT_MANAGED', 'CONFLICT', 'errors.media_probe_not_managed', {}, { needsUser: true });
    }
    const rights = this._mediaProbeRights(source.asset_id);
    const state = !['VIDEO', 'AUDIO'].includes(source.asset_type) || source.lifecycle_state !== 'ACTIVE' || source.availability_state !== 'AVAILABLE'
      ? 'BLOCKED_MEDIA' : !rights.eligible ? 'BLOCKED_RIGHTS' : 'BLOCKED_TOOLCHAIN';
    const command = this.db.prepare('SELECT idempotency_key FROM commands WHERE id=?').get(commandId);
    const requestHash = crypto.createHash('sha256').update(canonicalJson({ ...payload,
      asset_row_version: source.row_version, rights_generation: rights.generation, idempotency_key: command.idempotency_key })).digest('hex');
    const jobId = uuidv7(); const now = nowUtcUs();
    this.db.prepare(`INSERT INTO media_probe_jobs
      (id,project_id,asset_revision_id,storage_object_location_id,command_id,source_content_hash,source_byte_size,
      toolchain_manifest_hash,probe_schema_version,parser_policy_version,rights_generation,canonical_request_hash,
      idempotency_key,correlation_id,state,needs_user,next_step,created_at_utc_us,updated_at_utc_us)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`).run(jobId, source.project_id, source.id, location.id,
      commandId, source.content_hash, source.byte_size, payload.toolchain_manifest_hash, MEDIA_PROBE_SCHEMA_VERSION,
      MEDIA_PROBE_PARSER_VERSION, rights.generation, requestHash, command.idempotency_key, commandId, state,
      MEDIA_PROBE_NEXT_STEPS[state], now, now);
    return { projectId: source.project_id, result: { job: this._mediaProbeProjection(jobId, source.project_id) },
      event: { aggregateType: 'MEDIA_PROBE_JOB', aggregateId: jobId, aggregateVersion: 1,
        eventType: 'MEDIA_PROBE_ADMISSION_BLOCKED', payload: { job_id: jobId, state, asset_revision_id: source.id } },
      audit: { actionType: 'media_probe.admit', targetType: 'MEDIA_PROBE_JOB', targetId: jobId,
        payload: { state, asset_revision_id: source.id, execution_started: false } } };
  }

  _mediaProbeJob(jobId, projectId) {
    this._mediaProbeId(jobId, 'job_id'); this._mediaProbeId(projectId, 'project_id');
    const row = this.db.prepare('SELECT * FROM media_probe_jobs WHERE id=?').get(jobId);
    if (!row) throw new CoreError('NOT_FOUND', 'VALIDATION', 'errors.media_probe_not_found', {});
    if (row.project_id !== projectId) throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', {}, { needsUser: true });
    return row;
  }

  _mediaProbeProjection(jobId, projectId) {
    const row = this._mediaProbeJob(jobId, projectId);
    const source = this._mediaProbeSource(projectId, row.asset_revision_id);
    const rights = this._mediaProbeRights(source.asset_id);
    let state = MEDIA_PROBE_BLOCKED_STATES.has(row.state) || row.state === 'CANCELLED' ? row.state : 'UNKNOWN';
    if (state !== 'CANCELLED') {
      const location = this.db.prepare('SELECT storage_object_id,state FROM storage_object_locations WHERE id=?').get(row.storage_object_location_id);
      if (source.content_hash !== row.source_content_hash || source.byte_size !== row.source_byte_size
        || source.storage_class !== 'LOCAL_MANAGED' || !location || location.storage_object_id !== source.storage_object_id || location.state !== 'AVAILABLE') state = 'STALE';
      else if (source.lifecycle_state !== 'ACTIVE' || source.availability_state !== 'AVAILABLE' || !['VIDEO', 'AUDIO'].includes(source.asset_type)) state = 'BLOCKED_MEDIA';
      else if (!rights.eligible) state = 'BLOCKED_RIGHTS';
      else if (rights.generation !== row.rights_generation) state = 'STALE';
    }
    return { id: row.id, project_id: row.project_id, asset_revision_id: row.asset_revision_id,
      content_hash: row.source_content_hash, byte_size: row.source_byte_size,
      toolchain_manifest_hash: row.toolchain_manifest_hash, toolchain_id: null,
      toolchain_version: null, toolchain_binary_hash: null,
      toolchain_verified: false, probe_schema_version: row.probe_schema_version, parser_policy_version: row.parser_policy_version,
      rights_generation: row.rights_generation, state, stored_state: row.state, outcome: 'UNKNOWN',
      evidence_code: state === 'BLOCKED_TOOLCHAIN' ? 'PROBE_EXECUTION_UNAVAILABLE' : `PROBE_${state}`,
      attempt_id: null, execution_started: false, metadata: null, streams: [],
      needs_user: state !== 'CANCELLED', next_step: MEDIA_PROBE_NEXT_STEPS[state],
      next_step_key: `media_probe.next_step.${state.toLowerCase()}`, row_version: row.row_version,
      created_at: rfc3339FromUs(row.created_at_utc_us), updated_at: rfc3339FromUs(row.updated_at_utc_us) };
  }

  _cancelMediaProbe(payload, expected) {
    this._mediaProbeFields(payload, ['project_id', 'job_id']);
    const row = this._mediaProbeJob(payload.job_id, payload.project_id);
    this._assertProjectWritable(row.project_id);
    this._mediaProbeVersion(expected, 'JOB', row.id, row.row_version);
    if (!MEDIA_PROBE_BLOCKED_STATES.has(row.state) || row.current_attempt_id !== null
      || this.db.prepare('SELECT id FROM media_probe_attempts WHERE job_id=? LIMIT 1').get(row.id)) {
      throw new CoreError('PROBE_CANCEL_NOT_AVAILABLE', 'CONFLICT', 'errors.media_probe_cancel_not_available', {}, { needsUser: true });
    }
    this.db.prepare(`UPDATE media_probe_jobs SET state='CANCELLED',needs_user=0,next_step=?,
      row_version=row_version+1,updated_at_utc_us=? WHERE id=? AND row_version=?`).run(MEDIA_PROBE_NEXT_STEPS.CANCELLED, nowUtcUs(), row.id, row.row_version);
    return { projectId: row.project_id, result: { job: this._mediaProbeProjection(row.id, row.project_id) },
      event: { aggregateType: 'MEDIA_PROBE_JOB', aggregateId: row.id, aggregateVersion: row.row_version + 1,
        eventType: 'MEDIA_PROBE_INTENT_CANCELLED', payload: { job_id: row.id, execution_started: false } },
      audit: { actionType: 'media_probe.cancel', targetType: 'MEDIA_PROBE_JOB', targetId: row.id, payload: { execution_started: false } } };
  }

  _retryMediaProbe(payload, expected) {
    this._mediaProbeFields(payload, ['project_id', 'job_id']);
    const row = this._mediaProbeJob(payload.job_id, payload.project_id);
    this._assertProjectWritable(row.project_id);
    this._mediaProbeVersion(expected, 'JOB', row.id, row.row_version);
    throw new CoreError('PROBE_RETRY_NOT_AVAILABLE', 'CONFLICT', 'errors.media_probe_retry_not_available', {}, { needsUser: true });
  }

  _mediaProbeList(params) {
    this._mediaProbeFields(params, ['project_id', 'asset_revision_id', 'limit', 'offset']);
    this._mediaProbeSource(params.project_id, params.asset_revision_id);
    const pageNumber = (value, fallback, min, max) => {
      if (value === undefined) return fallback;
      if (typeof value === 'string' && /^(0|[1-9][0-9]{0,4})$/.test(value)) value = Number(value);
      if (!Number.isSafeInteger(value) || value < min || value > max) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.media_probe_pagination_invalid', {});
      return value;
    };
    const limit = pageNumber(params.limit, 25, 1, 100); const offset = pageNumber(params.offset, 0, 0, 10000);
    const rows = this.db.prepare(`SELECT id FROM media_probe_jobs WHERE project_id=? AND asset_revision_id=?
      ORDER BY created_at_utc_us DESC,id DESC LIMIT ? OFFSET ?`).all(params.project_id, params.asset_revision_id, limit + 1, offset);
    const hasMore = rows.length > limit;
    return { jobs: rows.slice(0, limit).map(row => this._mediaProbeProjection(row.id, params.project_id)),
      page: { limit, offset, has_more: hasMore, next_offset: hasMore && offset + limit <= 10000 ? offset + limit : null },
      projection_seq: this._projectionSeq(), generated_at: new Date().toISOString() };
  }

  _mediaProbeMetadata(params) {
    this._mediaProbeFields(params, ['project_id', 'asset_revision_id']);
    const source = this._mediaProbeSource(params.project_id, params.asset_revision_id);
    const latestIntent = this.db.prepare(`SELECT id FROM media_probe_jobs WHERE project_id=? AND asset_revision_id=?
      ORDER BY created_at_utc_us DESC,id DESC LIMIT 1`).get(source.project_id, source.id);
    const job = latestIntent ? this._mediaProbeProjection(latestIntent.id, source.project_id) : null;
    return { project_id: source.project_id, asset_revision_id: source.id, asset_row_version: source.row_version,
      content_hash: source.content_hash, byte_size: source.byte_size, state: job?.state ?? 'UNKNOWN',
      outcome: 'UNKNOWN', metadata: null, streams: [], job, needs_user: job?.needs_user ?? true,
      next_step: job?.next_step ?? MEDIA_PROBE_NEXT_STEPS.UNKNOWN,
      projection_seq: this._projectionSeq(), generated_at: new Date().toISOString() };
  }

  _runManagedAssetIntegrityProbe(payload, commandId) {
    const projectId = requiredString(payload.project_id ?? payload.projectId, 'project_id', 200);
    const revisionId = requiredString(payload.asset_revision_id ?? payload.assetRevisionId, 'asset_revision_id', 200);
    const contentHash = requiredString(payload.content_hash ?? payload.contentHash, 'content_hash', 128).toLowerCase();
    if (!SHA256_HEX.test(contentHash)) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field: 'content_hash' });
    const requestedMaxBytes = boundedInteger(payload.max_bytes ?? payload.maxBytes ?? LOCAL_PROBE_DEFAULT_MAX_BYTES, 'max_bytes', { min: 1, max: LOCAL_PROBE_MAX_BYTES });
    const revision = this.db.prepare(`SELECT r.id, r.storage_object_id, r.availability_state,
        a.project_id, a.lifecycle_state, so.hash_algorithm, so.content_hash, so.byte_size, so.storage_class
      FROM asset_revisions r JOIN assets a ON a.id = r.asset_id
      JOIN storage_objects so ON so.id = r.storage_object_id WHERE r.id = ?`).get(revisionId);
    if (!revision) throw new CoreError('ASSET_REVISION_NOT_FOUND', 'VALIDATION', 'errors.asset_revision_not_found', { asset_revision_id: revisionId });
    this._assertPayloadProjectScope(payload, revision.project_id, 'ASSET_REVISION', revisionId);
    if (revision.project_id !== projectId) throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', { entity_type: 'ASSET_REVISION', entity_id: revisionId, project_id: projectId, actual_project_id: revision.project_id }, { needsUser: true });
    if (revision.storage_class !== 'LOCAL_MANAGED') throw new CoreError('PROBE_ASSET_NOT_MANAGED', 'CONFLICT', 'errors.probe_asset_not_managed', {}, { needsUser: true });
    if (String(revision.content_hash).toLowerCase() !== contentHash) throw new CoreError('STALE_REVISION', 'STALE_REVISION', 'errors.stale_revision', { entity_type: 'ASSET_REVISION', entity_id: revisionId }, { needsUser: true });
    if (!SHA256_HEX.test(String(revision.content_hash)) || !Number.isSafeInteger(Number(revision.byte_size)) || Number(revision.byte_size) < 0) throw new CoreError('PROBE_ASSET_METADATA_INVALID', 'CONFLICT', 'errors.probe_asset_metadata_invalid', {}, { needsUser: true });
    if (Number(revision.byte_size) > requestedMaxBytes) throw new CoreError('PROBE_IO_BUDGET_TOO_SMALL', 'CONFLICT', 'errors.probe_io_budget_too_small', { required_bytes: Number(revision.byte_size) }, { needsUser: true });
    const manifest = {
      schema_version: 1, semantic_capability: LOCAL_PROBE_CAPABILITY,
      connector_version: LOCAL_PROBE_CONNECTOR_VERSION, project_id: projectId,
      asset_revision_id: revisionId, content_hash: contentHash,
      byte_size: Number(revision.byte_size), max_bytes: requestedMaxBytes,
    };
    const manifestHash = crypto.createHash('sha256').update(canonicalJson(manifest), 'utf8').digest('hex');
    const jobId = uuidv7();
    const attemptId = uuidv7();
    const now = nowUtcUs();
    this.db.prepare(`INSERT INTO jobs
      (id, project_id, job_type, semantic_capability, priority, state, subject_asset_revision_id,
       subject_content_hash, requested_max_bytes, pinned_manifest_hash, connector_version,
       command_id, next_step, created_at_utc_us, updated_at_utc_us)
      VALUES (?, ?, ?, ?, 50, 'QUEUED', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(jobId, projectId, LOCAL_PROBE_JOB_TYPE, LOCAL_PROBE_CAPABILITY, revisionId, contentHash, requestedMaxBytes, manifestHash, LOCAL_PROBE_CONNECTOR_VERSION, commandId,
        'Đang chờ kiểm tra object managed local.', now, now);
    this.db.prepare(`INSERT INTO job_attempts
      (id, job_id, attempt_no, retry_kind, idempotency_key, state, created_at_utc_us)
      VALUES (?, ?, 1, 'INITIAL', ?, 'CREATED', ?)`)
      .run(attemptId, jobId, `local:${jobId}:1`, now);
    this.db.prepare(`INSERT INTO job_usage_records
      (id, job_attempt_id, resource_type, reserved_amount, state, created_at_utc_us, updated_at_utc_us)
      VALUES (?, ?, 'READ_BYTES', ?, 'RESERVED', ?, ?)`)
      .run(uuidv7(), attemptId, requestedMaxBytes, now, now);
    const projection = this._jobProjection(jobId);
    return {
      projectId,
      result: { job: projection },
      event: { aggregateType: 'JOB', aggregateId: jobId, aggregateVersion: 1, eventType: 'LOCAL_PROBE_JOB_QUEUED', payload: { job_id: jobId, asset_revision_id: revisionId, connector_version: LOCAL_PROBE_CONNECTOR_VERSION } },
      audit: { actionType: 'job.local_probe.queue', targetType: 'JOB', targetId: jobId, payload: { asset_revision_id: revisionId, connector_version: LOCAL_PROBE_CONNECTOR_VERSION } },
    };
  }

  _cancelManagedAssetIntegrityProbe(payload, expectedVersions) {
    const jobId = requiredString(payload.job_id ?? payload.jobId ?? payload.id, 'job_id', 200);
    const current = this._jobRow(jobId);
    this._expectedVersion(expectedVersions, 'JOB', jobId, current.row_version);
    const attempt = this.db.prepare('SELECT * FROM job_attempts WHERE job_id = ? ORDER BY attempt_no DESC LIMIT 1').get(jobId);
    if (LOCAL_PROBE_TERMINAL_STATES.has(current.state)) throw new CoreError('JOB_NOT_CANCELLABLE', 'CONFLICT', 'errors.job_not_cancellable', { state: current.state }, { needsUser: true });
    const now = nowUtcUs();
    let nextState = current.state;
    if (current.state === 'QUEUED' || current.state === 'CLAIMED') {
      nextState = 'CANCELLED_CONFIRMED';
      if (attempt) {
        this.db.prepare(`UPDATE job_attempts SET state = 'ABANDONED', finished_at_utc_us = ?, row_version = row_version + 1 WHERE id = ? AND state IN ('CREATED', 'DISPATCHING')`).run(now, attempt.id);
        this.db.prepare(`UPDATE job_usage_records SET actual_amount = 0, state = 'RELEASED', updated_at_utc_us = ? WHERE job_attempt_id = ? AND state = 'RESERVED'`).run(now, attempt.id);
      }
    } else if (current.state === 'RUNNING') {
      nextState = 'CANCELLATION_REQUESTED';
      if (attempt?.id) {
        try { this._localProbeAbortControllers.get(attempt.id)?.abort(); } catch { /* the durable request remains authoritative */ }
      }
    } else if (current.state === 'CANCELLATION_REQUESTED') {
      // A second cancel command with a fresh idempotency key is a harmless,
      // auditable no-op. Advance the optimistic row fence so the command has
      // a unique aggregate version and the UI can observe that the request
      // was already accepted without violating append-only event ordering.
      this.db.prepare(`UPDATE jobs SET row_version = row_version + 1, updated_at_utc_us = ? WHERE id = ?`).run(now, jobId);
      return { projectId: current.project_id, result: { job: this._jobProjection(jobId), cancellation: 'already_requested' }, event: { aggregateType: 'JOB', aggregateId: jobId, aggregateVersion: Number(current.row_version) + 1, eventType: 'LOCAL_PROBE_CANCEL_ALREADY_REQUESTED', payload: { job_id: jobId, state: nextState } }, audit: { actionType: 'job.local_probe.cancel', targetType: 'JOB', targetId: jobId, payload: { state: nextState, already_requested: true } } };
    } else throw new CoreError('JOB_NOT_CANCELLABLE', 'CONFLICT', 'errors.job_not_cancellable', { state: current.state }, { needsUser: true });
    this.db.prepare(`UPDATE jobs SET state = ?, needs_user = 0, next_step = ?, row_version = row_version + 1, updated_at_utc_us = ? WHERE id = ?`)
      .run(nextState, nextState === 'CANCELLATION_REQUESTED' ? 'Đang chờ lượt đọc kết thúc an toàn.' : 'Job đã huỷ; không có bytes nào bị sửa.', now, jobId);
    return {
      projectId: current.project_id,
      result: { job: this._jobProjection(jobId), cancellation: nextState === 'CANCELLATION_REQUESTED' ? 'requested' : 'confirmed' },
      event: { aggregateType: 'JOB', aggregateId: jobId, aggregateVersion: Number(current.row_version) + 1, eventType: nextState === 'CANCELLATION_REQUESTED' ? 'LOCAL_PROBE_CANCEL_REQUESTED' : 'LOCAL_PROBE_CANCELLED', payload: { job_id: jobId, state: nextState } },
      audit: { actionType: 'job.local_probe.cancel', targetType: 'JOB', targetId: jobId, payload: { state: nextState } },
    };
  }

  _retryManagedAssetIntegrityProbe(payload, expectedVersions, commandId) {
    const jobId = requiredString(payload.job_id ?? payload.jobId ?? payload.id, 'job_id', 200);
    const current = this._jobRow(jobId);
    this._expectedVersion(expectedVersions, 'JOB', jobId, current.row_version);
    if (current.state !== 'FAILED_RETRYABLE') throw new CoreError('JOB_NOT_RETRYABLE', 'CONFLICT', 'errors.job_not_retryable', { state: current.state }, { needsUser: true });
    const previousAttempt = this.db.prepare('SELECT * FROM job_attempts WHERE job_id = ? ORDER BY attempt_no DESC LIMIT 1').get(jobId);
    const nextAttemptNo = Number(previousAttempt?.attempt_no ?? 0) + 1;
    if (!Number.isSafeInteger(nextAttemptNo) || nextAttemptNo > LOCAL_PROBE_MAX_ATTEMPTS) throw new CoreError('JOB_RETRY_LIMIT', 'CONFLICT', 'errors.job_retry_limit', { max_attempts: LOCAL_PROBE_MAX_ATTEMPTS }, { needsUser: true });
    const currentRevision = this.db.prepare(`SELECT so.content_hash FROM asset_revisions r JOIN storage_objects so ON so.id = r.storage_object_id WHERE r.id = ?`).get(current.subject_asset_revision_id);
    if (!currentRevision || String(currentRevision.content_hash).toLowerCase() !== String(current.subject_content_hash).toLowerCase()) throw new CoreError('STALE_REVISION', 'STALE_REVISION', 'errors.stale_revision', { entity_type: 'ASSET_REVISION', entity_id: current.subject_asset_revision_id }, { needsUser: true });
    const now = nowUtcUs();
    const attemptId = uuidv7();
    this.db.prepare(`INSERT INTO job_attempts (id, job_id, attempt_no, retry_kind, idempotency_key, state, created_at_utc_us) VALUES (?, ?, ?, 'EXACT', ?, 'CREATED', ?)`)
      .run(attemptId, jobId, nextAttemptNo, `local:${jobId}:${nextAttemptNo}:${commandId}`, now);
    this.db.prepare(`INSERT INTO job_usage_records (id, job_attempt_id, resource_type, reserved_amount, state, created_at_utc_us, updated_at_utc_us) VALUES (?, ?, 'READ_BYTES', ?, 'RESERVED', ?, ?)`)
      .run(uuidv7(), attemptId, Number(current.requested_max_bytes), now, now);
    this.db.prepare(`UPDATE jobs SET state = 'QUEUED', needs_user = 0, next_step = 'Đang chờ thử lại cùng asset revision đã pin.', row_version = row_version + 1, updated_at_utc_us = ? WHERE id = ?`)
      .run(now, jobId);
    return {
      projectId: current.project_id,
      result: { job: this._jobProjection(jobId), retry: { attempt_no: nextAttemptNo, retry_kind: 'EXACT' } },
      event: { aggregateType: 'JOB', aggregateId: jobId, aggregateVersion: Number(current.row_version) + 1, eventType: 'LOCAL_PROBE_RETRY_QUEUED', payload: { job_id: jobId, attempt_no: nextAttemptNo, retry_kind: 'EXACT' } },
      audit: { actionType: 'job.local_probe.retry', targetType: 'JOB', targetId: jobId, payload: { attempt_no: nextAttemptNo, retry_kind: 'EXACT' } },
    };
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
    markers.sort(compareTimelineMarkers);
    return markers;
  }

  _timelineAssetReadiness(assetRevisionId, projectId, options = {}) {
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
    const rights = this._rightsForAsset(row.asset_id, { purpose: options.purpose ?? null });
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

  _timelineWorkingValidateMaterializedClips(draft, projectId) {
    for (const track of draft.tracks ?? []) {
      for (const clip of track.clips ?? []) {
        if (typeof clip.asset_revision_id !== 'string' || clip.asset_revision_id.trim().length === 0) {
          throw new CoreError('TIMELINE_CLIP_ASSET_REQUIRED', 'CONFLICT', 'errors.timeline_clip_asset_required', { track_id: track.id, clip_id: clip.id }, { needsUser: true });
        }
        if (!clip.source_in || !clip.source_out) {
          throw new CoreError('TIMELINE_CLIP_SOURCE_REQUIRED', 'CONFLICT', 'errors.timeline_clip_source_required', { clip_id: clip.id }, { needsUser: true });
        }
        this._timelineAssetReadiness(clip.asset_revision_id, projectId);
      }
    }
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

  _handoffTarget(payload) {
    const targetEditor = enumValue(payload.target_editor ?? payload.targetEditor, 'target_editor', /^[A-Z][A-Z0-9_.-]{0,119}$/);
    const targetVersion = requiredString(payload.target_version ?? payload.targetVersion, 'target_version', 120);
    const targetProfile = enumValue(payload.target_profile ?? payload.targetProfile, 'target_profile', /^[A-Z][A-Z0-9_]{0,63}$/, HANDOFF_TARGET_PROFILE);
    const compatibilityProfileVersion = requiredString(
      payload.compatibility_profile_version ?? payload.compatibilityProfileVersion ?? HANDOFF_COMPATIBILITY_PROFILE_VERSION,
      'compatibility_profile_version', 120,
    );
    for (const [value, field] of [[targetVersion, 'target_version'], [compatibilityProfileVersion, 'compatibility_profile_version']]) {
      if (safeReleaseCandidateText(value) !== value) {
        throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field });
      }
    }
    return { targetEditor, targetVersion, targetProfile, compatibilityProfileVersion };
  }

  _handoffCompatibility(targetEditor, targetVersion) {
    const knownTarget = (targetEditor === 'GENERIC' || targetEditor === 'EDITOR_NEUTRAL')
      && /^(?:1|1\.0)$/.test(targetVersion);
    const entries = knownTarget
      ? [
        { feature: 'timeline_metadata', status: 'NATIVE', detail: 'Editor-neutral timeline metadata is preserved.' },
        { feature: 'rational_timing', status: 'NATIVE', detail: 'Integer rational timing is preserved without floating-point conversion.' },
        { feature: 'pinned_asset_references', status: 'NATIVE', detail: 'Exact asset revision IDs and SHA-256 digests are preserved.' },
        { feature: 'media_bytes', status: 'UNSUPPORTED', detail: 'Media bytes are not rendered or copied by this metadata-only preflight.' },
        { feature: 'editable_project_claim', status: 'UNKNOWN', detail: 'Editability depends on a certified target adapter and is not asserted here.' },
      ]
      : [
        { feature: 'timeline_metadata', status: 'UNKNOWN', detail: 'Target editor/version is not certified by CineForge.' },
        { feature: 'rational_timing', status: 'UNKNOWN', detail: 'Target timing semantics are not verified for this version.' },
        { feature: 'pinned_asset_references', status: 'UNKNOWN', detail: 'Target reference semantics are not verified for this version.' },
        { feature: 'media_bytes', status: 'UNSUPPORTED', detail: 'Media bytes are not rendered or copied by this metadata-only preflight.' },
        { feature: 'editable_project_claim', status: 'UNKNOWN', detail: 'Unknown targets never inherit an editable-project claim.' },
      ];
    const counts = Object.fromEntries([...HANDOFF_COMPATIBILITY_STATUSES].map((status) => [status, entries.filter((entry) => entry.status === status).length]));
    return {
      profile_version: HANDOFF_COMPATIBILITY_PROFILE_VERSION,
      target_editor: targetEditor,
      target_version: targetVersion,
      editable_claim: false,
      entries,
      counts,
      next_step: knownTarget
        ? 'Dùng một adapter/editor đã certify để materialize nội dung; bước này chỉ tạo metadata preflight.'
        : 'Xác minh và certify target editor/version trước khi yêu cầu export có thể chỉnh sửa.',
    };
  }

  _handoffSanitizationReport() {
    return {
      policy: 'EXPLICIT_ALLOWLIST_V1',
      recorded: true,
      removed_fields: [
        'absolute_local_paths',
        'usernames',
        'temporary_or_cache_locations',
        'api_endpoints',
        'credentials_and_secrets',
        'provider_prompts',
        'diagnostics',
        'unrelated_private_project_ids',
        'media_bytes',
      ],
      next_step: 'Chỉ dùng artifact_allowlist và manifest metadata đã được sanitize; không quét thư mục dự án đệ quy.',
    };
  }

  _handoffAssetRows(revision, tracks) {
    const ids = new Set();
    for (const track of tracks) {
      for (const clip of track.clips ?? []) if (clip.asset_revision_id) ids.add(clip.asset_revision_id);
    }
    const artifacts = [];
    for (const assetRevisionId of [...ids].sort()) {
      this._timelineAssetReadiness(assetRevisionId, revision.project_id);
      const row = this.db.prepare(`SELECT r.id, r.asset_id, r.semantic_role, r.rebuildability,
          r.availability_state, r.review_state, r.availability_evidence_state,
          so.hash_algorithm, so.content_hash, so.byte_size
        FROM asset_revisions r JOIN storage_objects so ON so.id = r.storage_object_id
        WHERE r.id = ?`).get(assetRevisionId);
      if (!row || row.hash_algorithm !== 'SHA-256' || !SHA256_HEX.test(String(row.content_hash ?? ''))
        || !Number.isSafeInteger(Number(row.byte_size)) || Number(row.byte_size) < 0) {
        throw new CoreError('TIMELINE_ASSET_NOT_READY', 'CONFLICT', 'errors.timeline_asset_not_ready', { asset_revision_id: assetRevisionId }, { needsUser: true });
      }
      artifacts.push({
        asset_revision_id: row.id,
        asset_id: row.asset_id,
        semantic_role: row.semantic_role,
        rebuildability: row.rebuildability,
        hash_algorithm: row.hash_algorithm,
        content_hash: String(row.content_hash).toLowerCase(),
        byte_size: Number(row.byte_size),
        availability_state: row.availability_state,
        review_state: row.review_state,
        availability_evidence_state: row.availability_evidence_state,
      });
    }
    return artifacts;
  }

  _createHandoffManifest(payload, expectedVersions, commandId) {
    const revisionId = requiredString(payload.timeline_revision_id ?? payload.timelineRevisionId ?? payload.revision_id ?? payload.revisionId, 'timeline_revision_id');
    const revision = this._timelineRevision(revisionId);
    this._assertPayloadProjectScope(payload, revision.project_id, 'TIMELINE_REVISION', revision.id);
    const project = this._project(revision.project_id);
    this._assertProjectWritable(project);
    this._expectedVersion(expectedVersions, 'REVISION', revision.id, revision.row_version);
    if (revision.lifecycle_state !== 'APPROVED') {
      throw new CoreError('HANDOFF_REVISION_NOT_APPROVED', 'CONFLICT', 'errors.handoff_revision_not_approved', { timeline_revision_id: revision.id, state: revision.lifecycle_state }, { needsUser: true });
    }

    const reviewSessionId = requiredString(payload.review_session_id ?? payload.reviewSessionId, 'review_session_id');
    const reviewSession = this._reviewSession(reviewSessionId);
    if (reviewSession.project_id !== revision.project_id || reviewSession.subject_type !== 'TIMELINE_REVISION' || reviewSession.subject_revision_id !== revision.id) {
      throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.review_scope_mismatch', { review_session_id: reviewSession.id, timeline_revision_id: revision.id }, { needsUser: true });
    }
    if (reviewSession.state !== 'SUBMITTED') {
      throw new CoreError('REVIEW_NOT_SUBMITTED', 'CONFLICT', 'errors.review_not_submitted', { review_session_id: reviewSession.id }, { needsUser: true });
    }
    const submittedReview = this.db.prepare('SELECT * FROM human_reviews WHERE review_session_id = ?').get(reviewSession.id);
    if (!submittedReview || submittedReview.decision !== 'APPROVE') {
      throw new CoreError('REVIEW_APPROVAL_REQUIRED', 'CONFLICT', 'errors.review_approval_required', { review_session_id: reviewSession.id }, { needsUser: true });
    }
    const suppliedSnapshot = payload.dependency_snapshot_hash ?? payload.dependencySnapshotHash;
    if (suppliedSnapshot === undefined || suppliedSnapshot === null || String(suppliedSnapshot).trim() === '') {
      throw new CoreError('HANDOFF_SNAPSHOT_REQUIRED', 'CONFLICT', 'errors.handoff_snapshot_required', { review_session_id: reviewSession.id }, { needsUser: true });
    }
    const suppliedSnapshotText = String(suppliedSnapshot).trim();
    if (!SHA256_HEX.test(suppliedSnapshotText)) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_review_snapshot_hash', { review_session_id: reviewSession.id });
    const currentSnapshot = this._reviewSnapshot(revision);
    if (suppliedSnapshotText.toLowerCase() !== String(reviewSession.dependency_snapshot_hash).toLowerCase()
      || currentSnapshot.hash !== reviewSession.dependency_snapshot_hash
      || String(submittedReview.dependency_snapshot_hash).toLowerCase() !== String(reviewSession.dependency_snapshot_hash).toLowerCase()
      || submittedReview.subject_content_hash !== revision.content_hash) {
      throw new CoreError('STALE_REVIEW', 'CONFLICT', 'errors.stale_review', { review_session_id: reviewSession.id }, { needsUser: true, technicalDetails: { expected_snapshot_hash: reviewSession.dependency_snapshot_hash, current_snapshot_hash: currentSnapshot.hash } });
    }
    const profile = this._mediaProfileRevision(revision.media_profile_revision_id);
    if (profile.lifecycle_state !== 'APPROVED') {
      throw new CoreError('MEDIA_PROFILE_NOT_APPROVED', 'CONFLICT', 'errors.media_profile_not_approved', { media_profile_revision_id: profile.id }, { needsUser: true });
    }
    const rawTracks = this.db.prepare('SELECT * FROM timeline_tracks WHERE timeline_revision_id = ? ORDER BY order_index ASC, id ASC').all(revision.id);
    const tracks = rawTracks.map((track) => {
      const rawClips = this.db.prepare('SELECT * FROM timeline_clip_instances WHERE track_id = ? ORDER BY timeline_in_num, timeline_in_den, id').all(track.id);
      return {
        id: track.id,
        track_type: track.track_type,
        order_index: Number(track.order_index),
        name: String(track.name ?? '').slice(0, 500),
        enabled: Boolean(Number(track.enabled)),
        clips: rawClips.map((clip) => ({
          id: clip.id,
          asset_revision_id: clip.asset_revision_id ?? null,
          source_in: clip.source_in_num === null || clip.source_in_num === undefined ? null : { num: Number(clip.source_in_num), den: Number(clip.source_in_den) },
          source_out: clip.source_out_num === null || clip.source_out_num === undefined ? null : { num: Number(clip.source_out_num), den: Number(clip.source_out_den) },
          timeline_in: { num: Number(clip.timeline_in_num), den: Number(clip.timeline_in_den) },
          timeline_out: { num: Number(clip.timeline_out_num), den: Number(clip.timeline_out_den) },
          speed: { num: Number(clip.speed_num), den: Number(clip.speed_den) },
        })),
      };
    });
    const markerRows = this.db.prepare('SELECT id, position_num, position_den, marker_type, label FROM timeline_markers WHERE timeline_revision_id = ? ORDER BY position_num, position_den, id').all(revision.id);
    const markers = markerRows.map((marker) => ({
      id: marker.id,
      time: { num: Number(marker.position_num), den: Number(marker.position_den) },
      marker_type: String(marker.marker_type ?? '').slice(0, 120),
      label: String(marker.label ?? '').slice(0, 500),
    }));
    const artifacts = this._handoffAssetRows(revision, tracks);
    const target = this._handoffTarget(payload);
    const compatibility = this._handoffCompatibility(target.targetEditor, target.targetVersion);
    const sanitization = this._handoffSanitizationReport();
    const exportSessionId = uuidv7();
    const manifestId = uuidv7();
    const mediaProfile = publicMediaProfileRevision(profile);
    // The manifest hash is the identity of the exact public-safe canonical
    // manifest.  Sanitize before canonicalization and persistence so the
    // stored bytes, returned projection, and manifest_hash all describe the
    // same immutable document.  Redacting only in publicHandoffManifest would
    // make the hash unverifiable and could leak a legacy path from storage.
    const manifest = sanitizePublicMetadata({
      manifest_type: 'CINEFORGE_TIMELINE_HANDOFF',
      manifest_schema_version: HANDOFF_MANIFEST_SCHEMA_VERSION,
      deliverable_type: 'TIMELINE_INTERCHANGE',
      target: {
        editor: target.targetEditor,
        version: target.targetVersion,
        profile: target.targetProfile,
        compatibility_profile_version: target.compatibilityProfileVersion,
      },
      source: {
        project_id: project.id,
        timeline_id: revision.timeline_id,
        timeline_revision_id: revision.id,
        revision_number: Number(revision.revision_number),
        lifecycle_state: revision.lifecycle_state,
        content_hash: String(revision.content_hash).toLowerCase(),
        duration: { num: Number(revision.duration_num), den: Number(revision.duration_den) },
        media_profile: {
          revision_id: profile.id,
          lifecycle_state: profile.lifecycle_state,
          timeline_rate: mediaProfile.timeline_rate,
          time_base: mediaProfile.time_base,
          pixel_aspect: mediaProfile.pixel_aspect,
          width: Number(profile.width),
          height: Number(profile.height),
          working_color_space: profile.working_color_space,
          transfer_function: profile.transfer_function,
          hdr_policy: profile.hdr_policy,
          audio_sample_rate: Number(profile.audio_sample_rate),
          audio_channel_layout: profile.audio_channel_layout,
        },
        review: {
          session_id: reviewSession.id,
          state: reviewSession.state,
          decision: submittedReview.decision,
          dependency_snapshot_hash: String(reviewSession.dependency_snapshot_hash).toLowerCase(),
          subject_content_hash: String(reviewSession.subject_content_hash).toLowerCase(),
        },
        tracks,
        markers,
      },
      artifact_allowlist: artifacts,
      compatibility,
      sanitization,
    });
    const manifestJson = canonicalJson(manifest);
    const manifestHash = crypto.createHash('sha256').update(manifestJson, 'utf8').digest('hex');
    const created = nowUtcUs();
    const nextStep = 'Metadata preflight đã tạo; cần adapter/editor được certify để materialize nội dung. Chưa có render, playback hoặc publish.';
    this.db.prepare(`INSERT INTO export_sessions
      (id, project_id, timeline_revision_id, deliverable_type, target_profile, target_editor, target_version,
       state, output_manifest_id, command_id, review_session_id, dependency_snapshot_hash, subject_content_hash,
       media_profile_revision_id, next_step, row_version, created_by_actor_id, created_at_utc_us, updated_at_utc_us)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'PREFLIGHT', NULL, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`).run(
      exportSessionId, project.id, revision.id, 'TIMELINE_INTERCHANGE', target.targetProfile, target.targetEditor, target.targetVersion,
      commandId, reviewSession.id, reviewSession.dependency_snapshot_hash, revision.content_hash, profile.id, nextStep,
      this.actorId, created, created,
    );
    this.db.prepare(`INSERT INTO handoff_manifests
      (id, export_session_id, project_id, target_editor, target_version, compatibility_profile_version, manifest_hash,
       manifest_json, artifact_allowlist_json, compatibility_report_json, sanitization_report_json,
       created_by_actor_id, created_at_utc_us)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      manifestId, exportSessionId, project.id, target.targetEditor, target.targetVersion, target.compatibilityProfileVersion, manifestHash,
      manifestJson, canonicalJson(artifacts), canonicalJson(compatibility), canonicalJson(sanitization), this.actorId, created,
    );
    const updated = nowUtcUs();
    this.db.prepare(`UPDATE export_sessions SET output_manifest_id = ?, updated_at_utc_us = ?, row_version = row_version + 1 WHERE id = ?`)
      .run(manifestId, updated, exportSessionId);
    const sessionRow = this.db.prepare('SELECT * FROM export_sessions WHERE id = ?').get(exportSessionId);
    const manifestRow = this.db.prepare('SELECT * FROM handoff_manifests WHERE id = ?').get(manifestId);
    return {
      projectId: project.id,
      result: {
        export_session: publicExportSession(sessionRow),
        handoff_manifest: publicHandoffManifest(manifestRow),
        manifest_hash: manifestHash,
        compatibility_report: compatibility,
        sanitization_report: sanitization,
        next_step: nextStep,
      },
      event: { aggregateType: 'EXPORT_SESSION', aggregateId: exportSessionId, aggregateVersion: Number(sessionRow.row_version), eventType: 'HANDOFF_MANIFEST_CREATED', payload: { export_session_id: exportSessionId, handoff_manifest_id: manifestId, project_id: project.id, timeline_revision_id: revision.id, manifest_hash: manifestHash, dependency_snapshot_hash: reviewSession.dependency_snapshot_hash, subject_content_hash: revision.content_hash } },
      audit: { actionType: 'handoff.manifest.create', targetType: 'HANDOFF_MANIFEST', targetId: manifestId, payload: { export_session_id: exportSessionId, project_id: project.id, timeline_revision_id: revision.id, review_session_id: reviewSession.id, manifest_hash: manifestHash, dependency_snapshot_hash: reviewSession.dependency_snapshot_hash, subject_content_hash: revision.content_hash, artifact_count: artifacts.length, target_editor: target.targetEditor, target_version: target.targetVersion } },
    };
  }

  _interchangeRational(value, field, { allowZero = false } = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const num = Number(source.num);
    const den = Number(source.den);
    if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || den <= 0 || num < 0 || (!allowZero && num === 0)) {
      throw new CoreError('EXPORT_TIMING_UNSAFE', 'CONFLICT', 'errors.export_timing_unsafe', { field }, { needsUser: true });
    }
    return { num, den };
  }

  _interchangeText(value, field, maxLength = 500) {
    if (typeof value !== 'string') return '';
    return safeReleaseCandidateText(value).slice(0, maxLength);
  }

  _timelineInterchangeContext(payload = {}, expectedVersions = {}) {
    const projectId = requiredString(payload.project_id ?? payload.projectId, 'project_id');
    const project = this._project(projectId);
    const exportSessionId = requiredString(
      payload.export_session_id ?? payload.exportSessionId ?? payload.handoff_id ?? payload.handoffId,
      'export_session_id',
    );
    const row = this.db.prepare(`SELECT e.*, h.id AS handoff_id, h.export_session_id AS handoff_session_id,
        h.project_id AS handoff_project_id, h.target_editor AS handoff_target_editor,
        h.target_version AS handoff_target_version, h.compatibility_profile_version AS handoff_compatibility_profile_version,
        h.manifest_hash AS handoff_manifest_hash, h.manifest_json AS handoff_manifest_json,
        h.artifact_allowlist_json AS handoff_artifact_allowlist_json,
        h.compatibility_report_json AS handoff_compatibility_report_json,
        h.sanitization_report_json AS handoff_sanitization_report_json,
        h.created_by_actor_id AS handoff_created_by_actor_id, h.created_at_utc_us AS handoff_created_at_utc_us
      FROM export_sessions e JOIN handoff_manifests h ON h.export_session_id = e.id
      WHERE e.id = ?`).get(exportSessionId);
    if (!row) throw new CoreError('EXPORT_SESSION_NOT_FOUND', 'VALIDATION', 'errors.export_session_not_found', { export_session_id: exportSessionId });
    if (row.project_id !== project.id) {
      throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', {
        entity_type: 'EXPORT_SESSION', entity_id: row.id, project_id: project.id, actual_project_id: row.project_id,
      }, { needsUser: true });
    }
    this._assertPayloadProjectScope(payload, project.id, 'EXPORT_SESSION', row.id);
    this._assertProjectWritable(project);
    this._expectedVersion(expectedVersions, 'EXPORT_SESSION', row.id, row.row_version);
    if (['COMPLETED', 'VERIFIED'].includes(String(row.state).toUpperCase())) {
      throw new CoreError('EXPORT_ALREADY_COMPLETED', 'CONFLICT', 'errors.export_already_completed', { export_session_id: row.id }, { needsUser: true });
    }
    if (!['PREFLIGHT', 'FAILED', 'BLOCKED_RIGHTS', 'BLOCKED_MEDIA'].includes(String(row.state).toUpperCase())) {
      throw new CoreError('EXPORT_SESSION_NOT_BUILDABLE', 'CONFLICT', 'errors.export_session_not_buildable', { state: row.state }, { needsUser: true });
    }
    if (row.deliverable_type !== 'TIMELINE_INTERCHANGE' || row.target_profile !== HANDOFF_TARGET_PROFILE) {
      throw new CoreError('EXPORT_PROFILE_UNSUPPORTED', 'VALIDATION', 'errors.export_profile_unsupported', { target_profile: row.target_profile }, { needsUser: true });
    }
    const suppliedSnapshot = requiredString(
      payload.dependency_snapshot_hash ?? payload.dependencySnapshotHash,
      'dependency_snapshot_hash', 128,
    ).toLowerCase();
    if (!SHA256_HEX.test(suppliedSnapshot) || suppliedSnapshot !== String(row.dependency_snapshot_hash ?? '').toLowerCase()) {
      throw new CoreError('STALE_REVIEW', 'CONFLICT', 'errors.stale_review', { export_session_id: row.id }, { needsUser: true });
    }

    const revision = this._timelineRevision(row.timeline_revision_id);
    const revisionContentHash = String(revision.content_hash ?? '').toLowerCase();
    const sessionContentHash = String(row.subject_content_hash ?? '').toLowerCase();
    if (!SHA256_HEX.test(revisionContentHash) || !SHA256_HEX.test(sessionContentHash)
      || revision.project_id !== project.id || revision.lifecycle_state !== 'APPROVED'
      || revisionContentHash !== sessionContentHash
      || revision.media_profile_revision_id !== row.media_profile_revision_id) {
      throw new CoreError('EXPORT_SOURCE_STALE', 'CONFLICT', 'errors.export_source_stale', { export_session_id: row.id }, { needsUser: true });
    }
    const profile = this._mediaProfileRevision(revision.media_profile_revision_id);
    if (profile.project_id !== project.id || profile.lifecycle_state !== 'APPROVED') {
      throw new CoreError('MEDIA_PROFILE_NOT_APPROVED', 'CONFLICT', 'errors.media_profile_not_approved', { media_profile_revision_id: profile.id }, { needsUser: true });
    }
    const review = this._reviewSession(row.review_session_id);
    if (review.project_id !== project.id || review.subject_type !== 'TIMELINE_REVISION'
      || review.subject_revision_id !== revision.id || review.state !== 'SUBMITTED') {
      throw new CoreError('REVIEW_NOT_SUBMITTED', 'CONFLICT', 'errors.review_not_submitted', { review_session_id: review.id }, { needsUser: true });
    }
    const humanReview = this.db.prepare('SELECT * FROM human_reviews WHERE review_session_id = ?').get(review.id);
    if (!humanReview || humanReview.decision !== 'APPROVE') {
      throw new CoreError('REVIEW_APPROVAL_REQUIRED', 'CONFLICT', 'errors.review_approval_required', { review_session_id: review.id }, { needsUser: true });
    }
    const currentSnapshot = this._reviewSnapshot(revision);
    if (currentSnapshot.hash !== row.dependency_snapshot_hash
      || currentSnapshot.hash !== review.dependency_snapshot_hash
      || String(review.subject_content_hash ?? '').toLowerCase() !== revisionContentHash
      || !SHA256_HEX.test(String(review.subject_content_hash ?? '').toLowerCase())) {
      throw new CoreError('STALE_REVIEW', 'CONFLICT', 'errors.stale_review', { review_session_id: review.id }, { needsUser: true });
    }
    const projection = currentSnapshot.projection;
    const rawTracks = projection?.revision?.tracks ?? [];
    if (rawTracks.length > TIMELINE_INTERCHANGE_MAX_TRACKS) {
      throw new CoreError('EXPORT_INTERCHANGE_TOO_LARGE', 'CONFLICT', 'errors.export_interchange_too_large', { field: 'tracks' }, { needsUser: true });
    }
    let clipCount = 0;
    for (const track of rawTracks) {
      clipCount += Array.isArray(track?.clips) ? track.clips.length : 0;
      if (clipCount > TIMELINE_INTERCHANGE_MAX_CLIPS) {
        throw new CoreError('EXPORT_INTERCHANGE_TOO_LARGE', 'CONFLICT', 'errors.export_interchange_too_large', { field: 'clips' }, { needsUser: true });
      }
    }
    const markerRows = Array.isArray(projection?.revision?.markers) ? projection.revision.markers : [];
    if (markerRows.length > TIMELINE_INTERCHANGE_MAX_MARKERS) {
      throw new CoreError('EXPORT_INTERCHANGE_TOO_LARGE', 'CONFLICT', 'errors.export_interchange_too_large', { field: 'markers' }, { needsUser: true });
    }
    const artifacts = this._handoffAssetRows(revision, rawTracks)
      .sort((left, right) => String(left.asset_revision_id).localeCompare(String(right.asset_revision_id)));
    if (artifacts.length > TIMELINE_INTERCHANGE_MAX_ARTIFACTS) {
      throw new CoreError('EXPORT_INTERCHANGE_TOO_LARGE', 'CONFLICT', 'errors.export_interchange_too_large', { field: 'artifacts' }, { needsUser: true });
    }
    const profileRationals = {
      timeline_rate: this._interchangeRational({ num: profile.timeline_rate_num, den: profile.timeline_rate_den }, 'timeline_rate'),
      time_base: this._interchangeRational({ num: profile.time_base_num, den: profile.time_base_den }, 'time_base'),
      pixel_aspect: this._interchangeRational({ num: profile.pixel_aspect_num, den: profile.pixel_aspect_den }, 'pixel_aspect'),
    };
    const safeTracks = rawTracks.map((track) => ({
      id: this._interchangeText(track?.id, 'track.id', 160),
      track_type: this._interchangeText(track?.track_type, 'track.track_type', 32),
      order_index: Number.isSafeInteger(Number(track?.order_index)) && Number(track.order_index) >= 0 ? Number(track.order_index) : 0,
      name: this._interchangeText(track?.name, 'track.name', 500),
      enabled: track?.enabled !== false,
      clips: (Array.isArray(track?.clips) ? track.clips : []).map((clip) => ({
        id: this._interchangeText(clip?.id, 'clip.id', 160),
        asset_revision_id: clip?.asset_revision_id ? this._interchangeText(clip.asset_revision_id, 'clip.asset_revision_id', 200) : null,
        source_in: clip?.source_in ? this._interchangeRational(clip.source_in, 'clip.source_in', { allowZero: true }) : null,
        source_out: clip?.source_out ? this._interchangeRational(clip.source_out, 'clip.source_out') : null,
        timeline_in: this._interchangeRational(clip?.timeline_in, 'clip.timeline_in', { allowZero: true }),
        timeline_out: this._interchangeRational(clip?.timeline_out, 'clip.timeline_out'),
        speed: this._interchangeRational(clip?.speed ?? { num: 1, den: 1 }, 'clip.speed'),
      })).sort((left, right) => String(left.id).localeCompare(String(right.id))),
    })).sort((left, right) => (left.order_index - right.order_index) || left.id.localeCompare(right.id));
    const safeMarkers = markerRows.map((marker) => ({
      id: this._interchangeText(marker?.id, 'marker.id', 160),
      time: this._interchangeRational(marker?.time, 'marker.time', { allowZero: true }),
      marker_type: this._interchangeText(marker?.marker_type, 'marker.marker_type', 120),
      label: this._interchangeText(marker?.label, 'marker.label', 500),
    })).sort((left, right) => rationalCompare(left.time, right.time) || left.id.localeCompare(right.id));
    const document = {
      manifest_type: 'CINEFORGE_TIMELINE_INTERCHANGE',
      manifest_schema_version: TIMELINE_INTERCHANGE_SCHEMA_VERSION,
      export_profile: TIMELINE_INTERCHANGE_PROFILE,
      deliverable_type: 'TIMELINE_INTERCHANGE',
      source: {
        project_id: project.id,
        timeline_id: revision.timeline_id,
        timeline_revision_id: revision.id,
        revision_number: Number(revision.revision_number),
        content_hash: String(revision.content_hash).toLowerCase(),
        duration: this._interchangeRational({ num: revision.duration_num, den: revision.duration_den }, 'duration'),
        media_profile: {
          revision_id: profile.id,
          timeline_rate: profileRationals.timeline_rate,
          time_base: profileRationals.time_base,
          pixel_aspect: profileRationals.pixel_aspect,
          width: Number(profile.width),
          height: Number(profile.height),
          working_color_space: this._interchangeText(profile.working_color_space, 'working_color_space', 120),
          transfer_function: this._interchangeText(profile.transfer_function, 'transfer_function', 120),
          hdr_policy: this._interchangeText(profile.hdr_policy, 'hdr_policy', 120),
          audio_sample_rate: Number(profile.audio_sample_rate),
          audio_channel_layout: this._interchangeText(profile.audio_channel_layout, 'audio_channel_layout', 120),
        },
        review: {
          session_id: review.id,
          decision: 'APPROVE',
          dependency_snapshot_hash: String(review.dependency_snapshot_hash).toLowerCase(),
          subject_content_hash: String(review.subject_content_hash).toLowerCase(),
        },
        tracks: safeTracks,
        markers: safeMarkers,
      },
      artifact_allowlist: artifacts.map((artifact) => ({
        asset_revision_id: artifact.asset_revision_id,
        asset_id: artifact.asset_id,
        semantic_role: this._interchangeText(artifact.semantic_role, 'artifact.semantic_role', 120),
        rebuildability: this._interchangeText(artifact.rebuildability, 'artifact.rebuildability', 40),
        hash_algorithm: artifact.hash_algorithm,
        content_hash: String(artifact.content_hash).toLowerCase(),
        byte_size: Number(artifact.byte_size),
      })),
      sanitization: {
        policy: 'EXPLICIT_ALLOWLIST_V1',
        recorded: true,
        removed_fields: ['absolute_local_paths', 'usernames', 'temporary_or_cache_locations', 'api_endpoints', 'credentials_and_secrets', 'provider_prompts', 'diagnostics', 'media_bytes', 'marker_payloads'],
      },
    };
    const documentJson = canonicalJson(document);
    const byteSize = Buffer.byteLength(documentJson, 'utf8');
    if (!Number.isSafeInteger(byteSize) || byteSize <= 0 || byteSize > TIMELINE_INTERCHANGE_MAX_BYTES) {
      throw new CoreError('EXPORT_INTERCHANGE_TOO_LARGE', 'CONFLICT', 'errors.export_interchange_too_large', { field: 'bytes' }, { needsUser: true });
    }
    const documentHash = crypto.createHash('sha256').update(documentJson, 'utf8').digest('hex');
    return {
      project, session: row, revision, profile, review, humanReview, artifacts,
      document, documentJson, documentHash, byteSize, clipCount,
      validationSnapshot: {
        schema_version: TIMELINE_INTERCHANGE_SCHEMA_VERSION,
        export_profile: TIMELINE_INTERCHANGE_PROFILE,
        project_id: project.id,
        timeline_revision_id: revision.id,
        review_session_id: review.id,
        dependency_snapshot_hash: String(review.dependency_snapshot_hash).toLowerCase(),
        subject_content_hash: String(revision.content_hash).toLowerCase(),
        artifact_count: artifacts.length,
        clip_count: clipCount,
        document_hash: documentHash,
      },
    };
  }

  _reserveGeneratedStaging(payload, expectedVersions, commandId) {
    const context = this._timelineInterchangeContext(payload, expectedVersions);
    const stagingId = uuidv7();
    const created = nowUtcUs();
    const { root, candidate } = this._stagingPath(stagingId);
    fs.mkdirSync(root, { recursive: true });
    this._assertNoReparsePath(root);
    this._transaction(() => this.db.prepare(`INSERT INTO staging_objects
      (id, command_id, temp_path, expected_size, current_size, hash_algorithm, source_path_fingerprint,
       source_file_identity_json, reparse_state, state, row_version, created_at_utc_us, updated_at_utc_us)
      VALUES (?, ?, ?, ?, 0, 'SHA-256', NULL, NULL, 'NOT_REPARSE', 'WRITING', 1, ?, ?)`)
      .run(stagingId, commandId, candidate, context.byteSize, created, created));
    let descriptor = null;
    try {
      descriptor = fs.openSync(candidate, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
      const bytes = Buffer.from(context.documentJson, 'utf8');
      let offset = 0;
      while (offset < bytes.length) offset += fs.writeSync(descriptor, bytes, offset, bytes.length - offset);
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = null;
      const stat = fs.lstatSync(candidate);
      if (stat.isSymbolicLink() || !stat.isFile() || Number(stat.nlink ?? 1) !== 1) throw new CoreError('EXPORT_STAGING_REPARSE_REJECTED', 'INTERNAL', 'errors.export_staging_reparse_rejected', {}, { needsUser: false });
      const digest = this._hashLocalFile(candidate);
      if (digest.content_hash !== context.documentHash || digest.byte_size !== context.byteSize) throw new CoreError('EXPORT_STAGING_VERIFY_FAILED', 'INTERNAL', 'errors.export_staging_verify_failed', {}, { needsUser: false });
      this._transaction(() => {
        this._setStagingState(stagingId, 'COMPLETE', { current_size: digest.byte_size, sha256: digest.content_hash, os_file_identity_json: json(this._sourceIdentity(stat)) });
        this._setStagingState(stagingId, 'VERIFIED');
      });
      return { id: stagingId, digest, context };
    } catch (error) {
      if (descriptor !== null) { try { fs.closeSync(descriptor); } catch { /* preserve original error */ } }
      try { this._transaction(() => { const current = this._stagingRow(stagingId); if (!['REGISTERED', 'ORPHANED', 'QUARANTINED'].includes(current.state)) this._setStagingState(stagingId, 'ORPHANED'); }); } catch { /* retain evidence */ }
      throw error;
    }
  }

  _buildTimelineInterchangeExport(payload, expectedVersions, commandId) {
    const context = this._timelineInterchangeContext(payload, expectedVersions);
    const stagingId = requiredString(payload.__staging_id ?? payload.staging_id, 'staging_id');
    const prepared = payload.__prepared_materialization;
    let staged;
    let materialized = null;
    let existingObject = null;
    if (prepared && typeof prepared === 'object' && !Array.isArray(prepared)) {
      // executeCommand has already performed all filesystem work before the
      // outer SQLite transaction.  Only accept the exact content-addressed
      // location and the staging proof that was just registered; callers
      // cannot smuggle an arbitrary path through this internal field.
      staged = this._stagingRow(stagingId);
      const expectedRelativePath = this._objectRelativePath('SHA-256', context.documentHash);
      const expectedTarget = path.resolve(this.assetStorePath, expectedRelativePath);
      const preparedDigest = prepared.digest;
      if (staged.state !== 'REGISTERED'
        || staged.sha256 !== context.documentHash
        || Number(staged.expected_size) !== context.byteSize
        || prepared.relativePath !== expectedRelativePath
        || path.resolve(String(prepared.target ?? '')) !== expectedTarget
        || !preparedDigest
        || preparedDigest.content_hash !== context.documentHash
        || Number(preparedDigest.byte_size) !== context.byteSize) {
        throw new CoreError('EXPORT_STAGING_VERIFY_FAILED', 'INTERNAL', 'errors.export_staging_verify_failed', {}, { needsUser: false });
      }
      materialized = {
        relativePath: expectedRelativePath,
        objectUri: `object://sha-256/${context.documentHash}`,
        target: expectedTarget,
        created: prepared.created === true,
      };
    } else {
      // Kept for direct/internal callers that invoke the command executor
      // without executeCommand's pre-materialization phase.  Normal command
      // execution always takes the prepared branch above, so filesystem I/O
      // is outside the command transaction.
      staged = this._verifyStagingObject(stagingId);
      if (staged.sha256 !== context.documentHash || Number(staged.expected_size) !== context.byteSize) {
        throw new CoreError('EXPORT_STAGING_VERIFY_FAILED', 'INTERNAL', 'errors.export_staging_verify_failed', {}, { needsUser: false });
      }
    }
    try {
      const current = this._exportSessionRow(context.session.id);
      const buildingVersion = Number(current.row_version) + 1;
      this.db.prepare(`UPDATE export_sessions SET state = 'BUILDING', row_version = ?, updated_at_utc_us = ?, next_step = ? WHERE id = ?`)
        .run(buildingVersion, nowUtcUs(), 'Đang materialize interchange JSON vào kho nội dung được quản lý.', current.id);
      const validatingVersion = buildingVersion + 1;
      this.db.prepare(`UPDATE export_sessions SET state = 'VALIDATING', row_version = ?, updated_at_utc_us = ?, next_step = ? WHERE id = ?`)
        .run(validatingVersion, nowUtcUs(), 'Đang kiểm tra lại hash, kích thước và object identity.', current.id);
      if (!materialized) {
        materialized = this._materializeStagedObject(stagingId, 'SHA-256', context.documentHash, context.byteSize);
        this._protectManagedObject(materialized.target, context.documentHash);
        const verified = this._hashLocalFile(materialized.target);
        if (verified.content_hash !== context.documentHash || verified.byte_size !== context.byteSize) throw new CoreError('EXPORT_OBJECT_TAMPERED', 'CONFLICT', 'errors.export_object_tampered', {}, { needsUser: true });
      }
      existingObject = this.db.prepare('SELECT * FROM storage_objects WHERE hash_algorithm = ? AND content_hash = ?').get('SHA-256', context.documentHash);
      if (existingObject && (Number(existingObject.byte_size) !== context.byteSize || existingObject.storage_class !== 'LOCAL_MANAGED')) throw new CoreError('EXPORT_STORAGE_CONFLICT', 'INTERNAL', 'errors.export_storage_conflict', {}, { needsUser: false });
      const storedObject = existingObject ?? { id: uuidv7(), hash_algorithm: 'SHA-256', content_hash: context.documentHash, byte_size: context.byteSize, storage_class: 'LOCAL_MANAGED', verified_at_utc_us: nowUtcUs(), created_at_utc_us: nowUtcUs() };
      if (!existingObject) this.db.prepare(`INSERT INTO storage_objects (id, hash_algorithm, content_hash, byte_size, storage_class, verified_at_utc_us, created_at_utc_us) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(storedObject.id, storedObject.hash_algorithm, storedObject.content_hash, storedObject.byte_size, storedObject.storage_class, storedObject.verified_at_utc_us, storedObject.created_at_utc_us);
      const primary = this.db.prepare(`SELECT id FROM storage_object_locations WHERE storage_object_id = ? AND location_role = 'PRIMARY' AND state = 'AVAILABLE' LIMIT 1`).get(storedObject.id);
      if (!primary) this.db.prepare(`INSERT INTO storage_object_locations (id, storage_object_id, storage_root, relative_path, location_role, state, last_verified_at_utc_us, created_at_utc_us) VALUES (?, ?, 'asset-store', ?, 'PRIMARY', 'AVAILABLE', ?, ?)`).run(uuidv7(), storedObject.id, materialized.relativePath.split(path.sep).join('/'), nowUtcUs(), nowUtcUs());
      const now = nowUtcUs();
      const assetId = uuidv7();
      const revisionId = uuidv7();
      const provenanceId = uuidv7();
      this.db.prepare(`INSERT INTO provenance_records (id, origin_type, source_description, source_path_or_uri, source_path_fingerprint, source_metadata_json, created_by_actor_id, created_at_utc_us) VALUES (?, 'SYSTEM', ?, NULL, NULL, ?, ?, ?)`).run(provenanceId, 'CineForge verified timeline interchange export', json({ generated: true, export_profile: TIMELINE_INTERCHANGE_PROFILE, source_export_session_id: context.session.id, detected_mime: 'application/json' }), this.actorId, now);
      this.db.prepare(`INSERT INTO assets (id, project_id, rights_identity_id, asset_type, display_name, origin_type, lifecycle_state, created_by_actor_id, created_at_utc_us, updated_at_utc_us, row_version) VALUES (?, ?, NULL, 'TIMELINE_INTERCHANGE', ?, 'SYSTEM', 'ACTIVE', ?, ?, ?, 1)`).run(assetId, context.project.id, `${context.project.code} timeline interchange`, this.actorId, now, now);
      this.db.prepare(`INSERT INTO asset_revisions (id, asset_id, revision_number, storage_object_id, provenance_record_id, semantic_role, availability_state, review_state, rebuildability, availability_evidence_state, created_by_actor_id, created_at_utc_us) VALUES (?, ?, 1, ?, ?, 'TIMELINE_INTERCHANGE', 'AVAILABLE', 'UNREVIEWED', 'REBUILDABLE', 'VERIFIED', ?, ?)`).run(revisionId, assetId, storedObject.id, provenanceId, this.actorId, now);
      this.db.prepare(`INSERT INTO asset_locations (id, asset_revision_id, location_type, path_or_uri, path_fingerprint, status, last_verified_at_utc_us, created_at_utc_us) VALUES (?, ?, 'MANAGED_OBJECT', ?, NULL, 'AVAILABLE', ?, ?)`).run(uuidv7(), revisionId, `object://sha-256/${context.documentHash}`, now, now);
      const verifiedVersion = validatingVersion + 1;
      const completedVersion = verifiedVersion + 1;
      const validationSnapshot = { ...context.validationSnapshot, verified_at: new Date().toISOString(), output_content_hash: context.documentHash, output_byte_size: context.byteSize };
      this.db.prepare(`UPDATE export_sessions SET state = 'VERIFIED', row_version = ?, updated_at_utc_us = ?, output_asset_revision_id = ?, output_content_hash = ?, output_byte_size = ?, validation_snapshot_json = ?, next_step = ? WHERE id = ?`).run(verifiedVersion, nowUtcUs(), revisionId, context.documentHash, context.byteSize, json(validationSnapshot), 'Interchange đã được verify; đang hoàn tất binding artifact.', context.session.id);
      this.db.prepare(`UPDATE export_sessions SET state = 'COMPLETED', row_version = ?, updated_at_utc_us = ?, next_step = ? WHERE id = ?`).run(completedVersion, nowUtcUs(), 'Interchange JSON đã sẵn sàng tải xuống; technical master/export là boundary riêng.', context.session.id);
      const sessionRow = this._exportSessionRow(context.session.id);
      const assetRow = this.db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId);
      const revisionRow = this.db.prepare('SELECT * FROM asset_revisions WHERE id = ?').get(revisionId);
      const provenance = this.db.prepare('SELECT * FROM provenance_records WHERE id = ?').get(provenanceId);
      const locations = this.db.prepare('SELECT * FROM asset_locations WHERE asset_revision_id = ?').all(revisionId);
      return {
        projectId: context.project.id,
        result: { export_session: publicExportSession(sessionRow), asset_revision_id: revisionId, output_content_hash: context.documentHash, output_byte_size: context.byteSize, asset: publicAsset(assetRow, revisionRow, storedObject, provenance, locations) },
        event: { aggregateType: 'EXPORT_SESSION', aggregateId: context.session.id, aggregateVersion: completedVersion, eventType: 'TIMELINE_INTERCHANGE_EXPORT_COMPLETED', payload: { export_session_id: context.session.id, project_id: context.project.id, timeline_revision_id: context.revision.id, output_asset_revision_id: revisionId, output_content_hash: context.documentHash, output_byte_size: context.byteSize, state: 'COMPLETED' } },
        audit: { actionType: 'export.timeline_interchange.build', targetType: 'EXPORT_SESSION', targetId: context.session.id, payload: { project_id: context.project.id, output_asset_revision_id: revisionId, output_content_hash: context.documentHash, output_byte_size: context.byteSize, artifact_count: context.artifacts.length, state: 'COMPLETED' } },
      };
    } catch (error) {
      if (materialized?.created && !existingObject) { try { fs.rmSync(materialized.target, { force: true }); } catch { /* preserve primary error */ } }
      throw error;
    }
  }

  _markTimelineInterchangeExportFailure(payload, error, commandId, expectedRowVersion = null) {
    const rawSessionId = payload?.export_session_id ?? payload?.exportSessionId ?? payload?.handoff_id ?? payload?.handoffId;
    if (typeof rawSessionId !== 'string' || rawSessionId.trim().length === 0) return;
    const sessionId = rawSessionId.trim();
    const noMutationCodes = new Set([
      'INVALID_ARGUMENT', 'IDEMPOTENCY_KEY_REQUIRED', 'STALE_REVISION', 'EXPECTED_VERSION_REQUIRED',
      'ENTITY_SCOPE_MISMATCH', 'PROJECT_NOT_FOUND', 'EXPORT_SESSION_NOT_FOUND', 'EXPORT_ALREADY_COMPLETED',
      'EXPORT_SESSION_NOT_BUILDABLE', 'EXPORT_PROJECT_SCOPE',
    ]);
    if (noMutationCodes.has(String(error?.code ?? ''))) return;
    const rightsBlocked = String(error?.code ?? '').startsWith('RIGHTS_')
      || String(error?.code ?? '').includes('RIGHTS_BLOCKED')
      || String(error?.code ?? '') === 'PREVIEW_RIGHTS_BLOCKED';
    const mediaBlocked = rightsBlocked ? false : [
      'STALE_REVIEW', 'EXPORT_SOURCE_STALE', 'MEDIA_PROFILE_NOT_APPROVED', 'REVIEW_NOT_SUBMITTED',
      'REVIEW_APPROVAL_REQUIRED', 'EXPORT_PROFILE_UNSUPPORTED', 'EXPORT_TIMING_UNSAFE',
      'TIMELINE_ASSET_NOT_READY', 'ASSET_REVISION_NOT_FOUND', 'TIMELINE_CLIP_ASSET_REQUIRED',
      'TIMELINE_CLIP_SOURCE_REQUIRED', 'EXPORT_INTERCHANGE_TOO_LARGE', 'EXPORT_OBJECT_TAMPERED',
      'EXPORT_STAGING_VERIFY_FAILED', 'EXPORT_STAGING_REPARSE_REJECTED', 'EXPORT_STORAGE_CONFLICT', 'STAGING_NOT_READY', 'STAGING_MISSING',
      'STAGING_PATH_ESCAPE', 'STAGING_REPARSE_REJECTED', 'STAGING_IDENTITY_CHANGED', 'STAGING_CONTENT_CHANGED',
      'ASSET_STORE_CORRUPT', 'ASSET_STORE_VERIFY_FAILED', 'EXPORT_PATH_ESCAPE',
    ].includes(String(error?.code ?? ''));
    const nextState = rightsBlocked ? 'BLOCKED_RIGHTS' : mediaBlocked ? 'BLOCKED_MEDIA' : 'FAILED';
    const nextStep = rightsBlocked
      ? 'Bổ sung hoặc sửa rights/consent của asset, rồi build lại interchange với snapshot mới.'
      : mediaBlocked
        ? 'Sửa nguồn timeline/review/media và tạo lại build với đúng revision evidence.'
        : 'Kiểm tra lỗi build và retry bằng một idempotency key mới sau khi nguyên nhân đã được xử lý.';
    try {
      this._transaction(() => {
        const row = this.db.prepare('SELECT * FROM export_sessions WHERE id = ?').get(sessionId);
        if (!row || ['COMPLETED', 'VERIFIED', 'CANCELLED'].includes(String(row.state).toUpperCase())) return;
        if (payload.project_id !== undefined && payload.project_id !== null && String(payload.project_id) !== String(row.project_id)) return;
        const currentRowVersion = Number(row.row_version);
        if (expectedRowVersion !== null && expectedRowVersion !== undefined
          && Number.isSafeInteger(Number(expectedRowVersion))
          && currentRowVersion !== Number(expectedRowVersion)) return;
        const currentSnapshot = parseJson(row.validation_snapshot_json, {});
        if (String(row.state).toUpperCase() === 'FAILED' && currentSnapshot.error_code === 'EXPORT_RECOVERY_REQUIRED') return;
        const validationSnapshot = {
          schema_version: TIMELINE_INTERCHANGE_SCHEMA_VERSION,
          ...currentSnapshot,
          error_code: String(error?.code ?? 'INTERNAL_ERROR').slice(0, 120),
          error_category: String(error?.category ?? 'INTERNAL').slice(0, 80),
          needs_user: Boolean(error?.needsUser),
          retryable: Boolean(error?.retryable),
          failed_at: new Date().toISOString(),
        };
        const version = Number(row.row_version) + 1;
        const updated = this.db.prepare(`UPDATE export_sessions SET state = ?, row_version = ?, updated_at_utc_us = ?, validation_snapshot_json = ?, next_step = ?
          WHERE id = ? AND row_version = ? AND state NOT IN ('COMPLETED', 'VERIFIED', 'CANCELLED')`)
          .run(nextState, version, nowUtcUs(), json(validationSnapshot), nextStep, sessionId, currentRowVersion);
        // Do not append an event/audit record if a concurrent retry won the
        // row-version fence after the snapshot read.
        if (updated.changes !== 1) return;
        this._insertEvent({
          aggregateType: 'EXPORT_SESSION', aggregateId: sessionId, aggregateVersion: version,
          eventType: nextState === 'FAILED' ? 'TIMELINE_INTERCHANGE_EXPORT_FAILED' : 'TIMELINE_INTERCHANGE_EXPORT_BLOCKED',
          payload: { export_session_id: sessionId, project_id: row.project_id, state: nextState, error_code: validationSnapshot.error_code, next_step: nextStep },
        }, commandId, this.actorId, null, commandId);
        this._insertAudit({
          actionType: 'export.timeline_interchange.failure', targetType: 'EXPORT_SESSION', targetId: sessionId,
          payload: { project_id: row.project_id, state: nextState, error_code: validationSnapshot.error_code, next_step: nextStep },
        }, commandId, this.actorId, 'FAILED');
      });
    } catch { /* preserve the original command error; failure evidence is best effort */ }
  }

  _exportSessionRow(id) {
    const row = this.db.prepare('SELECT * FROM export_sessions WHERE id = ?').get(requiredString(id, 'export_session_id'));
    if (!row) throw new CoreError('EXPORT_SESSION_NOT_FOUND', 'VALIDATION', 'errors.export_session_not_found', { export_session_id: id });
    return row;
  }

  _exportList(params = {}) {
    const projectId = requiredString(params.project_id ?? params.projectId, 'project_id');
    this._project(projectId);
    const limit = Math.min(Math.max(asInt(params.limit, 100), 1), 200);
    const stateInput = params.state === undefined || params.state === null || params.state === '' ? null : String(params.state).trim().toUpperCase();
    if (stateInput !== null && !HANDOFF_SESSION_STATES.has(stateInput)) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_handoff_state', { state: stateInput });
    const rows = this.db.prepare(`SELECT * FROM export_sessions WHERE project_id = ? AND (? IS NULL OR state = ?) ORDER BY created_at_utc_us DESC, id DESC LIMIT ?`).all(projectId, stateInput, stateInput, limit);
    return { items: rows.map(publicExportSession), projection_seq: this._projectionSeq(), generated_at: new Date().toISOString() };
  }

  _exportGet(id, projectIdValue = null) {
    const row = this._exportSessionRow(id);
    if (projectIdValue !== null && projectIdValue !== undefined) {
      const projectId = requiredString(projectIdValue, 'project_id');
      this._project(projectId);
      if (row.project_id !== projectId) throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', { entity_type: 'EXPORT_SESSION', entity_id: row.id, project_id: projectId, actual_project_id: row.project_id }, { needsUser: true });
    }
    return { export_session: publicExportSession(row), projection_seq: this._projectionSeq(), generated_at: new Date().toISOString() };
  }

  _handoffList(params = {}) {
    const projectId = params.project_id ?? params.projectId ?? null;
    if (projectId) this._project(projectId);
    const stateInput = params.state ?? null;
    const state = stateInput === null || stateInput === '' ? null : String(stateInput).trim().toUpperCase();
    if (state !== null && !HANDOFF_SESSION_STATES.has(state)) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_handoff_state', { state });
    const limit = Math.min(Math.max(asInt(params.limit, 100), 1), 200);
    const rows = this.db.prepare(`SELECT e.*, h.id AS handoff_id, h.export_session_id AS handoff_session_id,
        h.project_id AS handoff_project_id, h.target_editor AS handoff_target_editor, h.target_version AS handoff_target_version,
        h.compatibility_profile_version AS handoff_compatibility_profile_version, h.manifest_hash AS handoff_manifest_hash,
        h.manifest_json AS handoff_manifest_json, h.artifact_allowlist_json AS handoff_artifact_allowlist_json,
        h.compatibility_report_json AS handoff_compatibility_report_json, h.sanitization_report_json AS handoff_sanitization_report_json,
        h.created_by_actor_id AS handoff_created_by_actor_id, h.created_at_utc_us AS handoff_created_at_utc_us
      FROM export_sessions e JOIN handoff_manifests h ON h.export_session_id = e.id
      WHERE (? IS NULL OR e.project_id = ?) AND (? IS NULL OR e.state = ?)
      ORDER BY e.created_at_utc_us DESC, e.id DESC LIMIT ?`).all(projectId, projectId, state, state, limit);
    const items = rows.map((row) => ({
      export_session: publicExportSession(row),
      handoff_manifest: publicHandoffManifest({
        id: row.handoff_id, export_session_id: row.handoff_session_id, project_id: row.handoff_project_id,
        target_editor: row.handoff_target_editor, target_version: row.handoff_target_version, compatibility_profile_version: row.handoff_compatibility_profile_version,
        manifest_hash: row.handoff_manifest_hash, manifest_json: row.handoff_manifest_json,
        artifact_allowlist_json: row.handoff_artifact_allowlist_json, compatibility_report_json: row.handoff_compatibility_report_json,
        sanitization_report_json: row.handoff_sanitization_report_json, created_by_actor_id: row.handoff_created_by_actor_id,
        created_at_utc_us: row.handoff_created_at_utc_us,
      }),
    }));
    return { items, projection_seq: this._projectionSeq(), generated_at: new Date().toISOString() };
  }

  _handoffGet(id, requestedProjectId = null) {
    const value = requiredString(id, 'handoff_id');
    const row = this.db.prepare(`SELECT e.*, h.id AS handoff_id, h.export_session_id AS handoff_session_id,
        h.project_id AS handoff_project_id, h.target_editor AS handoff_target_editor, h.target_version AS handoff_target_version,
        h.compatibility_profile_version AS handoff_compatibility_profile_version, h.manifest_hash AS handoff_manifest_hash,
        h.manifest_json AS handoff_manifest_json, h.artifact_allowlist_json AS handoff_artifact_allowlist_json,
        h.compatibility_report_json AS handoff_compatibility_report_json, h.sanitization_report_json AS handoff_sanitization_report_json,
        h.created_by_actor_id AS handoff_created_by_actor_id, h.created_at_utc_us AS handoff_created_at_utc_us
      FROM export_sessions e JOIN handoff_manifests h ON h.export_session_id = e.id
      WHERE e.id = ? OR h.id = ? LIMIT 1`).get(value, value);
    if (!row) throw new CoreError('HANDOFF_NOT_FOUND', 'VALIDATION', 'errors.handoff_not_found', { handoff_id: value });
    if (requestedProjectId !== null && requestedProjectId !== undefined && requestedProjectId !== row.project_id) {
      throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', { entity_type: 'HANDOFF_MANIFEST', entity_id: value, project_id: requestedProjectId, actual_project_id: row.project_id }, { needsUser: true });
    }
    return {
      export_session: publicExportSession(row),
      handoff_manifest: publicHandoffManifest({
        id: row.handoff_id, export_session_id: row.handoff_session_id, project_id: row.handoff_project_id,
        target_editor: row.handoff_target_editor, target_version: row.handoff_target_version, compatibility_profile_version: row.handoff_compatibility_profile_version,
        manifest_hash: row.handoff_manifest_hash, manifest_json: row.handoff_manifest_json,
        artifact_allowlist_json: row.handoff_artifact_allowlist_json, compatibility_report_json: row.handoff_compatibility_report_json,
        sanitization_report_json: row.handoff_sanitization_report_json, created_by_actor_id: row.handoff_created_by_actor_id,
        created_at_utc_us: row.handoff_created_at_utc_us,
      }),
      projection_seq: this._projectionSeq(),
      generated_at: new Date().toISOString(),
    };
  }

  _timelineWorkingSession(sessionId) {
    const id = requiredString(sessionId, 'working_session_id');
    const row = this.db.prepare('SELECT * FROM timeline_working_sessions WHERE id = ?').get(id);
    if (!row) throw new CoreError('TIMELINE_WORKING_SESSION_NOT_FOUND', 'VALIDATION', 'errors.timeline_working_session_not_found', { working_session_id: id });
    return row;
  }

  _timelineWorkingDraftFromRevision(revision) {
    const trackRows = this.db.prepare('SELECT * FROM timeline_tracks WHERE timeline_revision_id = ? ORDER BY order_index ASC, id ASC').all(revision.id);
    const tracks = trackRows.map((track) => ({
      id: track.id,
      track_type: track.track_type,
      order_index: Number(track.order_index),
      name: track.name,
      enabled: Boolean(Number(track.enabled)),
      clips: this.db.prepare('SELECT * FROM timeline_clip_instances WHERE track_id = ? ORDER BY timeline_in_num, timeline_in_den, id').all(track.id).map((clip) => ({
        id: clip.id,
        asset_revision_id: clip.asset_revision_id,
        source_in: clip.source_in_num === null || clip.source_in_num === undefined ? null : { num: Number(clip.source_in_num), den: Number(clip.source_in_den) },
        source_out: clip.source_out_num === null || clip.source_out_num === undefined ? null : { num: Number(clip.source_out_num), den: Number(clip.source_out_den) },
        timeline_in: { num: Number(clip.timeline_in_num), den: Number(clip.timeline_in_den) },
        timeline_out: { num: Number(clip.timeline_out_num), den: Number(clip.timeline_out_den) },
        speed: { num: Number(clip.speed_num), den: Number(clip.speed_den) },
      })),
    }));
    const markers = this.db.prepare('SELECT * FROM timeline_markers WHERE timeline_revision_id = ? ORDER BY position_num, position_den, id').all(revision.id).map((marker) => ({
      id: marker.id,
      time: { num: Number(marker.position_num), den: Number(marker.position_den) },
      marker_type: marker.marker_type,
      label: marker.label,
      payload: parseJson(marker.payload_json, {}),
    }));
    return {
      schema_version: 1,
      media_profile_revision_id: revision.media_profile_revision_id,
      duration: { num: Number(revision.duration_num), den: Number(revision.duration_den) },
      tracks,
      markers,
    };
  }

  // Revisions created before the working-session schema marker was added used
  // the original stable time-only ordering for equal-time clips and markers.
  // Their immutable content hash must remain usable after the canonical V1
  // ordering became stricter. SQLite rowid preserves the insertion order that
  // the old normalizer received, so reconstruct that legacy byte shape only as
  // a compatibility check; all new drafts continue to use the deterministic
  // schema-versioned hash above.
  _timelineWorkingLegacyHashFromRevision(revision) {
    const trackRows = this.db.prepare('SELECT * FROM timeline_tracks WHERE timeline_revision_id = ? ORDER BY order_index ASC, rowid ASC').all(revision.id);
    const tracks = trackRows.map((track) => {
      const clips = this.db.prepare('SELECT * FROM timeline_clip_instances WHERE track_id = ? ORDER BY rowid ASC').all(track.id).map((clip) => ({
        asset_revision_id: clip.asset_revision_id ?? null,
        source_in: clip.source_in_num === null || clip.source_in_num === undefined ? null : { num: Number(clip.source_in_num), den: Number(clip.source_in_den) },
        source_out: clip.source_out_num === null || clip.source_out_num === undefined ? null : { num: Number(clip.source_out_num), den: Number(clip.source_out_den) },
        timeline_in: { num: Number(clip.timeline_in_num), den: Number(clip.timeline_in_den) },
        timeline_out: { num: Number(clip.timeline_out_num), den: Number(clip.timeline_out_den) },
        speed: { num: Number(clip.speed_num), den: Number(clip.speed_den) },
      })).sort((left, right) => rationalCompare(left.timeline_in, right.timeline_in));
      return {
        track_type: track.track_type,
        order_index: Number(track.order_index),
        name: track.name,
        enabled: Boolean(Number(track.enabled)),
        clips,
      };
    }).sort((left, right) => left.order_index - right.order_index);
    const markers = this.db.prepare('SELECT * FROM timeline_markers WHERE timeline_revision_id = ? ORDER BY rowid ASC').all(revision.id).map((marker) => ({
      time: { num: Number(marker.position_num), den: Number(marker.position_den) },
      markerType: marker.marker_type,
      label: marker.label,
      payload: parseJson(marker.payload_json, {}),
    })).sort((left, right) => rationalCompare(left.time, right.time));
    const content = {
      media_profile_revision_id: revision.media_profile_revision_id,
      duration: { num: Number(revision.duration_num), den: Number(revision.duration_den) },
      tracks,
      markers,
    };
    return crypto.createHash('sha256').update(canonicalJson(content), 'utf8').digest('hex');
  }

  _timelineWorkingCanonicalContent(draft, { includeSchemaVersion = true } = {}) {
    const content = {
      media_profile_revision_id: draft.media_profile_revision_id,
      duration: draft.duration,
      tracks: draft.tracks.map((track) => ({
        track_type: track.track_type,
        order_index: track.order_index,
        name: track.name,
        enabled: Boolean(track.enabled),
        clips: track.clips.map((clip) => ({
          asset_revision_id: clip.asset_revision_id ?? null,
          source_in: clip.source_in ?? null,
          source_out: clip.source_out ?? null,
          timeline_in: clip.timeline_in,
          timeline_out: clip.timeline_out,
          speed: clip.speed,
        })),
      })),
      markers: draft.markers.map((marker) => ({
        time: marker.time,
        markerType: marker.marker_type,
        label: marker.label,
        payload: marker.payload ?? {},
      })),
    };
    if (includeSchemaVersion) content.schema_version = Number(draft.schema_version ?? 1);
    return content;
  }

  _timelineWorkingHash(draft, options = {}) {
    return crypto.createHash('sha256').update(canonicalJson(this._timelineWorkingCanonicalContent(draft, options)), 'utf8').digest('hex');
  }

  _timelineWorkingMatchesBase(session, draftHash, draft) {
    const baseHash = String(session.base_content_hash).toLowerCase();
    if (draftHash.toLowerCase() === baseHash
      || this._timelineWorkingHash(draft, { includeSchemaVersion: false }).toLowerCase() === baseHash) return true;
    // A legacy revision may differ only in equal-time insertion order. Once
    // the session has normalized that snapshot, compare against the current
    // canonical reconstruction as well as the immutable legacy hash.
    try {
      const revision = this._timelineRevision(session.base_revision_id);
      if (this._timelineWorkingLegacyHashFromRevision(revision).toLowerCase() === baseHash) {
        const normalizedBase = this._timelineWorkingNormalizeDraft(this._timelineWorkingDraftFromRevision(revision), revision.project_id, null).draft;
        return this._timelineWorkingHash(normalizedBase).toLowerCase() === draftHash.toLowerCase()
          || this._timelineWorkingHash(normalizedBase, { includeSchemaVersion: false }).toLowerCase() === draftHash.toLowerCase();
      }
    } catch {
      // Preserve the ordinary hash-only decision if the compatibility read is
      // unavailable during recovery or a partially migrated database.
    }
    return false;
  }

  _timelineWorkingNormalizeDraft(rawDraft, projectId, expectedProfileId = null, { checkAssets = false } = {}) {
    if (!rawDraft || typeof rawDraft !== 'object' || Array.isArray(rawDraft)) {
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field: 'draft' });
    }
    const schemaVersion = Number(rawDraft.schema_version ?? rawDraft.schemaVersion ?? 1);
    if (schemaVersion !== 1) throw new CoreError('UNSUPPORTED_TIMELINE_WORKING_SCHEMA', 'VALIDATION', 'errors.unsupported_timeline_working_schema', { schema_version: schemaVersion }, { needsUser: true });
    const profileId = requiredString(rawDraft.media_profile_revision_id ?? rawDraft.mediaProfileRevisionId, 'media_profile_revision_id');
    const profile = this._mediaProfileRevision(profileId);
    if (profile.project_id !== projectId) {
      throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', { entity_type: 'MEDIA_PROFILE_REVISION', entity_id: profileId, project_id: projectId, actual_project_id: profile.project_id }, { needsUser: true });
    }
    if (expectedProfileId && profileId !== expectedProfileId) {
      throw new CoreError('TIMELINE_WORKING_PROFILE_CHANGED', 'CONFLICT', 'errors.timeline_working_profile_changed', { expected_profile_revision_id: expectedProfileId, actual_profile_revision_id: profileId }, { needsUser: true });
    }
    const duration = this._timelineRational(rawDraft, 'duration', { allowZero: false });
    if (duration.num > MAX_TIMELINE_DURATION_TICKS) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field: 'duration' });
    const rawTracks = arrayValue(rawDraft.tracks ?? [], 'tracks');
    if (rawTracks.length > MAX_TIMELINE_TRACKS) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.field_too_large', { field: 'tracks', max_items: MAX_TIMELINE_TRACKS });
    const trackIds = new Set();
    const orderIndexes = new Set();
    const tracks = rawTracks.map((rawTrack, trackIndex) => {
      if (!rawTrack || typeof rawTrack !== 'object' || Array.isArray(rawTrack)) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field: `tracks[${trackIndex}]` });
      const trackType = enumValue(rawTrack.track_type ?? rawTrack.trackType ?? 'VIDEO', 'track_type', /^[A-Z]+$/);
      if (trackType !== 'VIDEO') throw new CoreError('UNSUPPORTED_TIMELINE_TRACK', 'VALIDATION', 'errors.unsupported_timeline_track', { track_type: trackType }, { needsUser: true });
      const trackId = requiredString(rawTrack.id ?? rawTrack.track_id ?? rawTrack.trackId, `tracks[${trackIndex}].id`, 200);
      if (trackIds.has(trackId)) throw new CoreError('DUPLICATE_TIMELINE_TRACK_ID', 'CONFLICT', 'errors.duplicate_timeline_track_id', { track_id: trackId });
      trackIds.add(trackId);
      const orderIndex = boundedInteger(rawTrack.order_index ?? rawTrack.orderIndex ?? trackIndex, 'order_index', { min: 0, max: MAX_TIMELINE_TRACKS - 1 });
      if (orderIndexes.has(orderIndex)) throw new CoreError('DUPLICATE_TIMELINE_TRACK_ORDER', 'CONFLICT', 'errors.duplicate_timeline_track_order', { order_index: orderIndex });
      orderIndexes.add(orderIndex);
      const enabled = nullableBoolean(rawTrack.enabled, 'enabled');
      const rawClips = arrayValue(rawTrack.clips ?? [], `tracks[${trackIndex}].clips`);
      if (rawClips.length > MAX_TIMELINE_CLIPS_PER_TRACK) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.field_too_large', { field: `tracks[${trackIndex}].clips`, max_items: MAX_TIMELINE_CLIPS_PER_TRACK });
      const clipIds = new Set();
      const clips = rawClips.map((rawClip, clipIndex) => {
        const clipId = requiredString(rawClip?.id ?? rawClip?.clip_id ?? rawClip?.clipId, `tracks[${trackIndex}].clips[${clipIndex}].id`, 200);
        if (clipIds.has(clipId)) throw new CoreError('DUPLICATE_TIMELINE_CLIP_ID', 'CONFLICT', 'errors.duplicate_timeline_clip_id', { clip_id: clipId });
        clipIds.add(clipId);
        const normalized = this._timelineClipInput(rawClip, clipIndex);
        if (rationalCompare(normalized.timelineOut, duration) > 0) throw new CoreError('TIMELINE_CLIP_OUT_OF_BOUNDS', 'VALIDATION', 'errors.timeline_clip_out_of_bounds', { field: 'timeline_out' }, { needsUser: true });
        if (checkAssets && normalized.assetRevisionId) this._timelineAssetReadiness(normalized.assetRevisionId, projectId);
        return {
          id: clipId,
          asset_revision_id: normalized.assetRevisionId,
          source_in: normalized.sourceIn,
          source_out: normalized.sourceOut,
          timeline_in: normalized.timelineIn,
          timeline_out: normalized.timelineOut,
          speed: normalized.speed,
        };
      }).sort((left, right) => rationalCompare(left.timeline_in, right.timeline_in) || left.id.localeCompare(right.id));
      for (let index = 1; index < clips.length; index += 1) {
        if (rationalCompare(clips[index - 1].timeline_out, clips[index].timeline_in) > 0) throw new CoreError('TIMELINE_CLIP_OVERLAP', 'CONFLICT', 'errors.timeline_clip_overlap', { track_index: trackIndex, clip_index: index }, { needsUser: true });
      }
      return {
        id: trackId,
        track_type: trackType,
        order_index: orderIndex,
        name: optionalString(rawTrack.name, `tracks[${trackIndex}].name`, 200, `Video ${orderIndex + 1}`),
        enabled: enabled === null ? true : Boolean(enabled),
        clips,
      };
    }).sort((left, right) => left.order_index - right.order_index || left.id.localeCompare(right.id));
    const markerIds = new Set();
    const rawMarkers = arrayValue(rawDraft.markers ?? [], 'markers');
    if (rawMarkers.length > MAX_TIMELINE_MARKERS) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.field_too_large', { field: 'markers', max_items: MAX_TIMELINE_MARKERS });
    const markers = rawMarkers.map((rawMarker, markerIndex) => {
      const markerId = requiredString(rawMarker?.id ?? rawMarker?.marker_id ?? rawMarker?.markerId, `markers[${markerIndex}].id`, 200);
      if (markerIds.has(markerId)) throw new CoreError('DUPLICATE_TIMELINE_MARKER_ID', 'CONFLICT', 'errors.duplicate_timeline_marker_id', { marker_id: markerId });
      markerIds.add(markerId);
      const normalized = this._normalizeTimelineMarkers({ markers: [rawMarker] }, duration)[0];
      return { id: markerId, time: normalized.time, marker_type: normalized.markerType, label: normalized.label, payload: normalized.payload };
    }).sort(compareTimelineMarkers);
    const draft = { schema_version: 1, media_profile_revision_id: profileId, duration, tracks, markers };
    return { draft, contentHash: this._timelineWorkingHash(draft), profile };
  }

  _timelineWorkingPublicProjection(sessionOrId, requestedProjectId = null, requestedTimelineId = null) {
    const session = typeof sessionOrId === 'string' ? this._timelineWorkingSession(sessionOrId) : sessionOrId;
    const timeline = this._timeline(session.timeline_id);
    if (requestedProjectId !== null && requestedProjectId !== undefined && requestedProjectId !== timeline.project_id) {
      throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', { entity_type: 'TIMELINE_WORKING_SESSION', entity_id: session.id, project_id: requestedProjectId, actual_project_id: timeline.project_id }, { needsUser: true });
    }
    if (requestedTimelineId !== null && requestedTimelineId !== undefined && requestedTimelineId !== timeline.id) {
      throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', { entity_type: 'TIMELINE', entity_id: timeline.id, requested_timeline_id: requestedTimelineId }, { needsUser: true });
    }
    let draft = parseJson(session.draft_payload_json, {});
    try { draft = this._timelineWorkingNormalizeDraft(draft, timeline.project_id, null).draft; } catch { /* keep recovery evidence visible */ }
    const operations = this._timelineWorkingOperations(session);
    const historyActions = this.db.prepare('SELECT * FROM timeline_edit_actions WHERE working_session_id = ? ORDER BY action_seq ASC').all(session.id);
    return {
      timeline: publicTimeline(timeline),
      session: publicTimelineWorkingSession(session, draft, operations, historyActions),
      projection_seq: this._projectionSeq(),
      generated_at: new Date().toISOString(),
    };
  }

  _timelineWorkingList(params = {}) {
    const timelineId = requiredString(params.timeline_id ?? params.timelineId, 'timeline_id');
    const timeline = this._timeline(timelineId);
    const requestedProjectId = params.project_id ?? params.projectId;
    if (requestedProjectId !== undefined && requestedProjectId !== null && requestedProjectId !== timeline.project_id) {
      throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', { entity_type: 'TIMELINE', entity_id: timeline.id, project_id: requestedProjectId, actual_project_id: timeline.project_id }, { needsUser: true });
    }
    const includeClosed = Boolean(params.include_closed ?? params.includeClosed);
    const states = includeClosed ? null : ['OPEN', 'DIRTY', 'AUTOSAVING', 'CHECKPOINTING', 'CLEAN', 'CONFLICT', 'RECOVERY_REQUIRED'];
    const rows = states
      ? this.db.prepare(`SELECT * FROM timeline_working_sessions WHERE timeline_id = ? AND state IN (${states.map(() => '?').join(',')}) ORDER BY updated_at_utc_us DESC, id DESC`).all(timeline.id, ...states)
      : this.db.prepare('SELECT * FROM timeline_working_sessions WHERE timeline_id = ? ORDER BY updated_at_utc_us DESC, id DESC').all(timeline.id);
    return {
      timeline: publicTimeline(timeline),
      sessions: rows.map((row) => {
        let draft = parseJson(row.draft_payload_json, {});
        try { draft = this._timelineWorkingNormalizeDraft(draft, timeline.project_id, null).draft; } catch { /* recovery evidence remains visible */ }
        const operations = this._timelineWorkingOperations(row);
        const historyActions = this.db.prepare('SELECT * FROM timeline_edit_actions WHERE working_session_id = ? ORDER BY action_seq ASC').all(row.id);
        return publicTimelineWorkingSession(row, draft, operations, historyActions);
      }),
      projection_seq: this._projectionSeq(),
      generated_at: new Date().toISOString(),
    };
  }

  _timelineWorkingEditHistory(params = {}) {
    const sessionId = requiredString(params.working_session_id ?? params.workingSessionId ?? params.session_id ?? params.sessionId, 'working_session_id');
    const session = this._timelineWorkingSession(sessionId);
    const timeline = this._timeline(session.timeline_id);
    const requestedProjectId = params.project_id ?? params.projectId;
    const requestedTimelineId = params.timeline_id ?? params.timelineId;
    if (requestedProjectId !== undefined && requestedProjectId !== null && requestedProjectId !== timeline.project_id) {
      throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', { entity_type: 'TIMELINE_WORKING_SESSION', entity_id: session.id, project_id: requestedProjectId, actual_project_id: timeline.project_id }, { needsUser: true });
    }
    if (requestedTimelineId !== undefined && requestedTimelineId !== null && requestedTimelineId !== timeline.id) {
      throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', { entity_type: 'TIMELINE', entity_id: timeline.id, requested_timeline_id: requestedTimelineId }, { needsUser: true });
    }
    const afterOpSeq = Math.max(asInt(params.after_op_seq ?? params.afterOpSeq, 0), 0);
    const limit = Math.min(Math.max(asInt(params.limit, 100), 1), 500);
    const operations = this._timelineWorkingOperations(session).filter((operation) => Number(operation.op_seq) > afterOpSeq);
    const pageOperations = operations.slice(0, limit);
    const lastOpSeq = pageOperations.length ? Number(pageOperations.at(-1).op_seq) : afterOpSeq;
    // History is paged by operation sequence. Return only causal actions for
    // that operation window and cap the action fan-out so a long undo/redo
    // session cannot turn one page request into an unbounded response.
    const actions = pageOperations.length
      ? this.db.prepare(`SELECT * FROM timeline_edit_actions
          WHERE working_session_id = ? AND target_op_seq > ? AND target_op_seq <= ?
          ORDER BY action_seq ASC LIMIT ?`).all(session.id, afterOpSeq, lastOpSeq, Math.min(limit * 4, 2_000))
      : [];
    const publicSession = publicTimelineWorkingSession(session, {}, pageOperations, actions);
    const page = publicSession.operations;
    return {
      timeline: publicTimeline(timeline),
      working_session_id: session.id,
      operations: page,
      history_actions: publicSession.history_actions,
      cursor: { after_op_seq: lastOpSeq, has_more: operations.length > page.length },
      projection_seq: this._projectionSeq(),
      generated_at: new Date().toISOString(),
    };
  }

  _timelineWorkingAssertWritable(session, payload, expectedVersions) {
    const timeline = this._timeline(session.timeline_id);
    this._assertPayloadProjectScope(payload, timeline.project_id, 'TIMELINE_WORKING_SESSION', session.id);
    const payloadEntityType = String(payload?.entity_type ?? payload?.entityType ?? '').trim().toUpperCase();
    const suppliedTimelineId = payload?.timeline_id ?? payload?.timelineId
      ?? (payloadEntityType === 'TIMELINE' ? (payload?.entity_id ?? payload?.entityId) : undefined);
    if (suppliedTimelineId !== undefined && suppliedTimelineId !== null && suppliedTimelineId !== timeline.id) {
      throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', {
        entity_type: 'TIMELINE', entity_id: suppliedTimelineId, expected_entity_id: timeline.id,
      }, { needsUser: true });
    }
    const project = this._project(timeline.project_id);
    this._assertProjectWritable(project);
    if (session.actor_id !== this.actorId) throw new CoreError('AUTH_REQUIRED', 'AUTH_REQUIRED', 'errors.timeline_working_session_actor_mismatch', { working_session_id: session.id }, { needsUser: true });
    const clientInstanceId = requiredString(payload.client_instance_id ?? payload.clientInstanceId, 'client_instance_id', MAX_TIMELINE_CLIENT_ID);
    if (clientInstanceId !== session.client_instance_id) {
      throw new CoreError('TIMELINE_WORKING_CLIENT_MISMATCH', 'AUTH_REQUIRED', 'errors.timeline_working_session_client_mismatch', { working_session_id: session.id }, { needsUser: true });
    }
    this._expectedVersion(expectedVersions, 'WORKING_SESSION', session.id, session.row_version);
    if (!TIMELINE_WORKING_SESSION_STATES.has(session.state)) throw new CoreError('INVALID_TIMELINE_WORKING_STATE', 'CONFLICT', 'errors.invalid_timeline_working_state', { state: session.state }, { needsUser: true });
    return { timeline, project };
  }

  _timelineWorkingAssertEditable(session) {
    if (!TIMELINE_WORKING_EDITABLE_STATES.has(session.state)) {
      throw new CoreError('TIMELINE_WORKING_SESSION_NOT_EDITABLE', 'CONFLICT', 'errors.timeline_working_session_not_editable', { state: session.state }, { needsUser: true });
    }
  }

  _beginTimelineWorkingSession(payload, expectedVersions) {
    const timeline = this._timeline(payload.timeline_id ?? payload.timelineId);
    this._assertPayloadProjectScope(payload, timeline.project_id, 'TIMELINE', timeline.id);
    const project = this._project(timeline.project_id);
    this._assertProjectWritable(project);
    if (timeline.lifecycle_state !== 'ACTIVE') throw new CoreError('TIMELINE_NOT_WRITABLE', 'CONFLICT', 'errors.timeline_not_writable', { state: timeline.lifecycle_state }, { needsUser: true });
    this._expectedVersion(expectedVersions, 'TIMELINE', timeline.id, timeline.row_version);
    const baseRevisionId = requiredString(payload.base_revision_id ?? payload.baseRevisionId, 'base_revision_id');
    const baseRevision = this._timelineRevision(baseRevisionId);
    if (baseRevision.timeline_id !== timeline.id || baseRevision.project_id !== project.id) {
      throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', { entity_type: 'TIMELINE_REVISION', entity_id: baseRevision.id, project_id: project.id, actual_project_id: baseRevision.project_id }, { needsUser: true });
    }
    if (!['DRAFT_CHECKPOINT', 'CANDIDATE', 'APPROVED'].includes(baseRevision.lifecycle_state)) {
      throw new CoreError('TIMELINE_WORKING_BASE_NOT_EDITABLE', 'CONFLICT', 'errors.timeline_working_base_not_editable', { state: baseRevision.lifecycle_state }, { needsUser: true });
    }
    const expectedBaseVersion = payload.base_revision_row_version ?? payload.baseRevisionRowVersion;
    if (expectedBaseVersion === undefined || expectedBaseVersion === null) throw new CoreError('BASE_REVISION_VERSION_REQUIRED', 'CONFLICT', 'errors.base_revision_version_required', { base_revision_id: baseRevision.id }, { needsUser: true });
    if (asInt(expectedBaseVersion, -1) !== Number(baseRevision.row_version)) {
      throw new CoreError('STALE_REVISION', 'STALE_REVISION', 'errors.stale_revision', { entity_type: 'TIMELINE_REVISION', entity_id: baseRevision.id, expected: expectedBaseVersion, current: Number(baseRevision.row_version) }, { needsUser: true });
    }
    const suppliedBaseHash = requiredString(payload.base_content_hash ?? payload.baseContentHash, 'base_content_hash', 128).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(suppliedBaseHash) || suppliedBaseHash !== String(baseRevision.content_hash).toLowerCase()) {
      throw new CoreError('TIMELINE_WORKING_BASE_HASH_MISMATCH', 'CONFLICT', 'errors.timeline_working_base_hash_mismatch', { base_revision_id: baseRevision.id }, { needsUser: true });
    }
    const clientInstanceId = requiredString(payload.client_instance_id ?? payload.clientInstanceId, 'client_instance_id', MAX_TIMELINE_CLIENT_ID);
    const mode = String(payload.mode ?? 'EXCLUSIVE').trim().toUpperCase();
    if (!TIMELINE_WORKING_MODES.has(mode) || mode !== 'EXCLUSIVE') throw new CoreError('UNSUPPORTED_TIMELINE_WORKING_MODE', 'VALIDATION', 'errors.unsupported_timeline_working_mode', { mode }, { needsUser: true });
    const active = this.db.prepare(`SELECT * FROM timeline_working_sessions
      WHERE timeline_id = ? AND actor_id = ? AND state IN ('OPEN', 'DIRTY', 'AUTOSAVING', 'CHECKPOINTING', 'CLEAN', 'CONFLICT', 'RECOVERY_REQUIRED')
      ORDER BY updated_at_utc_us DESC, id DESC LIMIT 1`).get(timeline.id, this.actorId);
    if (active) throw new CoreError('TIMELINE_WORKING_SESSION_ALREADY_OPEN', 'CONFLICT', 'errors.timeline_working_session_already_open', { working_session_id: active.id }, { needsUser: true, technicalDetails: { working_session_id: active.id } });
    const normalized = this._timelineWorkingNormalizeDraft(this._timelineWorkingDraftFromRevision(baseRevision), project.id, baseRevision.media_profile_revision_id);
    const legacyContentHash = this._timelineWorkingHash(normalized.draft, { includeSchemaVersion: false });
    const legacyRevisionHash = this._timelineWorkingLegacyHashFromRevision(baseRevision);
    if (normalized.contentHash.toLowerCase() !== String(baseRevision.content_hash).toLowerCase()
      && legacyContentHash.toLowerCase() !== String(baseRevision.content_hash).toLowerCase()
      && legacyRevisionHash.toLowerCase() !== String(baseRevision.content_hash).toLowerCase()) {
      throw new CoreError('TIMELINE_WORKING_BASE_HASH_MISMATCH', 'CONFLICT', 'errors.timeline_working_base_hash_mismatch', { base_revision_id: baseRevision.id }, { needsUser: true });
    }
    const sessionId = uuidv7();
    const created = nowUtcUs();
    this.db.prepare(`INSERT INTO timeline_working_sessions
      (id, timeline_id, base_revision_id, base_revision_row_version, base_content_hash, actor_id, client_instance_id,
       mode, state, draft_payload_json, draft_hash, autosaved_hash, last_acknowledged_op_seq, history_cursor_seq,
       next_op_seq, last_checkpoint_revision_id, next_step, row_version, last_autosave_at_utc_us, created_at_utc_us, updated_at_utc_us)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, 0, 0, 1, NULL, ?, 1, ?, ?, ?)`).run(
      sessionId, timeline.id, baseRevision.id, Number(baseRevision.row_version), String(baseRevision.content_hash).toLowerCase(), this.actorId, clientInstanceId,
      mode, canonicalJson(normalized.draft), normalized.contentHash, normalized.contentHash,
      'Chọn thao tác chỉnh sửa hoặc autosave draft trước khi đóng phiên.', created, created, created,
    );
    const session = this._timelineWorkingSession(sessionId);
    const projection = this._timelineWorkingPublicProjection(session);
    return {
      projectId: project.id,
      result: projection,
      event: { aggregateType: 'TIMELINE_WORKING_SESSION', aggregateId: sessionId, aggregateVersion: 1, eventType: 'TIMELINE_WORKING_SESSION_OPENED', payload: { working_session_id: sessionId, project_id: project.id, timeline_id: timeline.id, base_revision_id: baseRevision.id, base_content_hash: baseRevision.content_hash, client_instance_id: clientInstanceId } },
      audit: { actionType: 'timeline.working_session.begin', targetType: 'TIMELINE_WORKING_SESSION', targetId: sessionId, payload: { project_id: project.id, timeline_id: timeline.id, base_revision_id: baseRevision.id, base_revision_row_version: Number(baseRevision.row_version), client_instance_id: clientInstanceId } },
    };
  }

  _timelineWorkingOperation(draft, operation, projectId) {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field: 'operation' });
    const opType = String(operation.op_type ?? operation.opType ?? operation.type ?? '').trim().toUpperCase();
    if (TIMELINE_WORKING_UNSUPPORTED_OP_TYPES.has(opType)) throw new CoreError('UNSUPPORTED_TIMELINE_EDIT_OPERATION', 'VALIDATION', 'errors.unsupported_timeline_edit_operation', { op_type: opType }, { needsUser: true });
    if (!TIMELINE_WORKING_OP_TYPES.has(opType)) throw new CoreError('INVALID_TIMELINE_EDIT_OPERATION', 'VALIDATION', 'errors.invalid_timeline_edit_operation', { op_type: opType });
    const rawOperationPayload = operation.payload && typeof operation.payload === 'object' && !Array.isArray(operation.payload) ? operation.payload : null;
    const markerFields = new Set(['id', 'marker_id', 'markerId', 'time', 'marker_type', 'markerType', 'type', 'label', 'client_op_id', 'clientOpId']);
    const directMarker = opType === 'ADD_MARKER' && rawOperationPayload !== null
      && Object.keys(operation).some((key) => markerFields.has(key))
      && !Object.keys(rawOperationPayload).some((key) => markerFields.has(key));
    const operationPayload = directMarker ? null : rawOperationPayload;
    const payload = operationPayload ?? operation;
    const allowed = {
      INSERT_CLIP: new Set(['op_type', 'opType', 'type', 'payload', 'track_id', 'trackId', 'track_order_index', 'trackOrderIndex', 'clip', 'client_op_id', 'clientOpId']),
      MOVE_CLIP: new Set(['op_type', 'opType', 'type', 'payload', 'clip_id', 'clipId', 'timeline_in', 'timelineIn', 'client_op_id', 'clientOpId']),
      TRIM_CLIP: new Set(['op_type', 'opType', 'type', 'payload', 'clip_id', 'clipId', 'edge', 'timeline_in', 'timelineIn', 'timeline_out', 'timelineOut', 'source_in', 'sourceIn', 'source_out', 'sourceOut', 'client_op_id', 'clientOpId']),
      DELETE_CLIP: new Set(['op_type', 'opType', 'type', 'payload', 'clip_id', 'clipId', 'client_op_id', 'clientOpId']),
      ADD_MARKER: new Set(['op_type', 'opType', 'type', 'payload', 'id', 'marker_id', 'markerId', 'time', 'marker_type', 'markerType', 'label', 'payload', 'client_op_id', 'clientOpId']),
    }[opType];
    for (const key of Object.keys(operation)) if (!allowed.has(key)) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field: `operation.${key}` });
    if (operation.payload && (typeof operation.payload !== 'object' || Array.isArray(operation.payload))) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field: 'operation.payload' });
    const source = operationPayload ? { ...operationPayload, op_type: opType } : { ...operation, op_type: opType };
    const nestedAllowed = {
      INSERT_CLIP: new Set(['op_type', 'opType', 'type', 'track_id', 'trackId', 'track_order_index', 'trackOrderIndex', 'clip', 'client_op_id', 'clientOpId']),
      MOVE_CLIP: new Set(['op_type', 'opType', 'type', 'clip_id', 'clipId', 'timeline_in', 'timelineIn', 'client_op_id', 'clientOpId']),
      TRIM_CLIP: new Set(['op_type', 'opType', 'type', 'clip_id', 'clipId', 'edge', 'timeline_in', 'timelineIn', 'timeline_out', 'timelineOut', 'source_in', 'sourceIn', 'source_out', 'sourceOut', 'client_op_id', 'clientOpId']),
      DELETE_CLIP: new Set(['op_type', 'opType', 'type', 'clip_id', 'clipId', 'client_op_id', 'clientOpId']),
      ADD_MARKER: new Set(['op_type', 'opType', 'type', 'id', 'marker_id', 'markerId', 'time', 'marker_type', 'markerType', 'label', 'payload', 'client_op_id', 'clientOpId']),
    }[opType];
    for (const key of Object.keys(source)) if (!nestedAllowed.has(key)) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field: `operation.payload.${key}` });
    const next = structuredClone(draft);
    if (opType === 'INSERT_CLIP') {
      const trackId = source.track_id ?? source.trackId;
      const orderIndex = source.track_order_index ?? source.trackOrderIndex;
      if ((trackId === undefined || trackId === null) === (orderIndex === undefined || orderIndex === null)) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.timeline_working_track_target_required');
      const track = trackId !== undefined && trackId !== null
        ? next.tracks.find((candidate) => candidate.id === String(trackId))
        : next.tracks.find((candidate) => Number(candidate.order_index) === asInt(orderIndex, -1));
      if (!track) throw new CoreError('TIMELINE_TRACK_NOT_FOUND', 'VALIDATION', 'errors.timeline_track_not_found', { track_id: trackId ?? orderIndex });
      const rawClip = source.clip;
      if (!rawClip || typeof rawClip !== 'object' || Array.isArray(rawClip)) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.required_field', { field: 'clip' });
      const clipKeys = new Set(['id', 'clip_id', 'clipId', 'asset_revision_id', 'assetRevisionId', 'source_in', 'sourceIn', 'source_out', 'sourceOut', 'timeline_in', 'timelineIn', 'timeline_out', 'timelineOut', 'speed']);
      for (const key of Object.keys(rawClip)) if (!clipKeys.has(key)) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field: `clip.${key}` });
      const clipId = rawClip.id ?? rawClip.clip_id ?? rawClip.clipId ?? uuidv7();
      const assetRevisionId = rawClip.asset_revision_id ?? rawClip.assetRevisionId;
      if (typeof assetRevisionId !== 'string' || assetRevisionId.trim().length === 0) {
        throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.required_field', { field: 'clip.asset_revision_id' });
      }
      const normalized = this._timelineClipInput(rawClip, track.clips.length);
      // Working INSERT_CLIP is deliberately stricter than the legacy
      // checkpoint importer: every new clip must pin one exact, materialized
      // asset revision and a non-empty source interval before it can enter the
      // durable operation ledger.
      this._timelineAssetReadiness(normalized.assetRevisionId, projectId);
      if (next.tracks.some((candidate) => candidate.clips.some((clip) => clip.id === String(clipId)))) throw new CoreError('DUPLICATE_TIMELINE_CLIP_ID', 'CONFLICT', 'errors.duplicate_timeline_clip_id', { clip_id: clipId });
      track.clips.push({ id: String(clipId), asset_revision_id: normalized.assetRevisionId, source_in: normalized.sourceIn, source_out: normalized.sourceOut, timeline_in: normalized.timelineIn, timeline_out: normalized.timelineOut, speed: normalized.speed });
    } else if (opType === 'MOVE_CLIP') {
      const clipId = requiredString(source.clip_id ?? source.clipId, 'clip_id');
      const newIn = this._timelineRational(source, 'timeline_in', { allowZero: true });
      const found = this._timelineWorkingFindClip(next, clipId);
      const duration = rationalSubtract(found.clip.timeline_out, found.clip.timeline_in);
      found.clip.timeline_in = newIn;
      found.clip.timeline_out = rationalAdd(newIn, duration);
    } else if (opType === 'TRIM_CLIP') {
      const clipId = requiredString(source.clip_id ?? source.clipId, 'clip_id');
      const edge = String(source.edge ?? '').trim().toUpperCase();
      if (!['IN', 'OUT'].includes(edge)) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field: 'edge' });
      const timelineField = edge === 'IN' ? 'timeline_in' : 'timeline_out';
      const sourceField = edge === 'IN' ? 'source_in' : 'source_out';
      const timelineCamel = timelineField.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      const sourceCamel = sourceField.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      const otherTimelineField = edge === 'IN' ? 'timeline_out' : 'timeline_in';
      const otherSourceField = edge === 'IN' ? 'source_out' : 'source_in';
      const otherTimelineCamel = otherTimelineField.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      const otherSourceCamel = otherSourceField.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      if (source[otherTimelineField] !== undefined || source[otherTimelineCamel] !== undefined
        || source[`${otherTimelineField}_num`] !== undefined || source[otherSourceField] !== undefined
        || source[otherSourceCamel] !== undefined || source[`${otherSourceField}_num`] !== undefined) {
        throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field: `edge=${edge} trim fields` });
      }
      const found = this._timelineWorkingFindClip(next, clipId);
      const hasTimeline = source[timelineField] !== undefined || source[timelineCamel] !== undefined || source[`${timelineField}_num`] !== undefined;
      const hasSource = source[sourceField] !== undefined || source[sourceCamel] !== undefined || source[`${sourceField}_num`] !== undefined;
      if (!hasTimeline && !hasSource) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.required_field', { field: `${timelineField} or ${sourceField}` });
      if (hasTimeline) found.clip[timelineField] = this._timelineRational(source, timelineField, { allowZero: edge === 'IN' });
      if (hasSource) {
        if (found.clip.source_in === null || found.clip.source_out === null) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.required_field', { field: 'source_in/source_out' });
        found.clip[sourceField] = this._timelineRational(source, sourceField, { allowZero: edge === 'IN' });
      }
    } else if (opType === 'DELETE_CLIP') {
      const clipId = requiredString(source.clip_id ?? source.clipId, 'clip_id');
      const found = this._timelineWorkingFindClip(next, clipId);
      found.track.clips.splice(found.track.clips.indexOf(found.clip), 1);
    } else if (opType === 'ADD_MARKER') {
      const markerId = source.id ?? source.marker_id ?? source.markerId ?? uuidv7();
      if (next.markers.some((marker) => marker.id === String(markerId))) throw new CoreError('DUPLICATE_TIMELINE_MARKER_ID', 'CONFLICT', 'errors.duplicate_timeline_marker_id', { marker_id: markerId });
      const marker = this._normalizeTimelineMarkers({ markers: [{ id: markerId, time: source.time, marker_type: source.marker_type ?? source.markerType, label: source.label, payload: source.payload ?? {} }] }, next.duration)[0];
      next.markers.push({ id: String(markerId), time: marker.time, marker_type: marker.markerType, label: marker.label, payload: marker.payload });
    }
    const normalized = this._timelineWorkingNormalizeDraft(next, projectId, draft.media_profile_revision_id);
    return { opType, draft: normalized.draft, contentHash: normalized.contentHash, clientOpId: source.client_op_id ?? source.clientOpId ?? null };
  }

  _timelineWorkingFindClip(draft, clipId) {
    for (const track of draft.tracks) {
      const clip = track.clips.find((candidate) => candidate.id === clipId);
      if (clip) return { track, clip };
    }
    throw new CoreError('TIMELINE_CLIP_NOT_FOUND', 'VALIDATION', 'errors.timeline_clip_not_found', { clip_id: clipId });
  }

  _timelineWorkingOperations(session) {
    const operations = this.db.prepare('SELECT * FROM timeline_edit_ops WHERE working_session_id = ? ORDER BY op_seq ASC').all(session.id);
    const actions = this.db.prepare('SELECT * FROM timeline_edit_actions WHERE working_session_id = ? ORDER BY action_seq ASC').all(session.id);
    const latestAction = new Map();
    for (const action of actions) if (action.target_op_seq !== null && action.target_op_seq !== undefined) latestAction.set(Number(action.target_op_seq), action.action_type);
    return operations.map((operation) => {
      const action = latestAction.get(Number(operation.op_seq));
      return { ...operation, history_state: action === 'UNDO' ? 'UNDONE' : action === 'DISCARD_REDO_BRANCH' ? 'DISCARDED' : 'ACTIVE' };
    });
  }

  _appendTimelineWorkingHistoryAction(sessionId, actionType, targetOperation, beforeHash, afterHash) {
    const current = this.db.prepare('SELECT COALESCE(MAX(action_seq), 0) AS max_seq FROM timeline_edit_actions WHERE working_session_id = ?').get(sessionId);
    const actionSeq = Number(current.max_seq) + 1;
    this.db.prepare(`INSERT INTO timeline_edit_actions
      (id, working_session_id, action_seq, action_type, target_op_seq, target_op_id, before_hash, after_hash, actor_id, created_at_utc_us)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      uuidv7(), sessionId, actionSeq, actionType, targetOperation?.op_seq ?? null, targetOperation?.id ?? null,
      String(beforeHash).toLowerCase(), String(afterHash).toLowerCase(), this.actorId, nowUtcUs(),
    );
    return actionSeq;
  }

  _applyTimelineEditOp(payload, expectedVersions) {
    const session = this._timelineWorkingSession(payload.working_session_id ?? payload.workingSessionId ?? payload.session_id ?? payload.sessionId);
    const { timeline, project } = this._timelineWorkingAssertWritable(session, payload, expectedVersions);
    this._timelineWorkingAssertEditable(session);
    const operationsValue = payload.operations ?? payload.ops ?? (payload.operation ? [payload.operation] : null);
    if (operationsValue === null) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.required_field', { field: 'operations' });
    const operations = operationsValue;
    if (!Array.isArray(operations) || operations.length < 1 || operations.length > MAX_TIMELINE_WORKING_BATCH) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.timeline_working_batch_invalid', { max_items: MAX_TIMELINE_WORKING_BATCH });
    const currentOpCount = Number(this.db.prepare('SELECT COUNT(*) AS count FROM timeline_edit_ops WHERE working_session_id = ?').get(session.id).count);
    if (currentOpCount + operations.length > MAX_TIMELINE_WORKING_OPS) throw new CoreError('TIMELINE_WORKING_OP_LIMIT', 'CONFLICT', 'errors.timeline_working_op_limit', { max_ops: MAX_TIMELINE_WORKING_OPS }, { needsUser: true });
    let draft = parseJson(session.draft_payload_json, {});
    const normalizedCurrent = this._timelineWorkingNormalizeDraft(draft, project.id);
    if (normalizedCurrent.contentHash.toLowerCase() !== String(session.draft_hash).toLowerCase()) throw new CoreError('TIMELINE_WORKING_DRAFT_CORRUPT', 'CONFLICT', 'errors.timeline_working_draft_corrupt', { working_session_id: session.id }, { needsUser: true });
    draft = normalizedCurrent.draft;
    let cursor = Number(session.history_cursor_seq);
    const maxOp = Number(this.db.prepare('SELECT COALESCE(MAX(op_seq), 0) AS max_seq FROM timeline_edit_ops WHERE working_session_id = ?').get(session.id).max_seq);
    let nextSeq = Math.max(Number(session.next_op_seq), maxOp + 1);
    const accepted = [];
    if (cursor < maxOp) {
      const discarded = this.db.prepare(`SELECT * FROM timeline_edit_ops
        WHERE working_session_id = ? AND op_seq > ? AND history_state != 'DISCARDED' ORDER BY op_seq ASC`).all(session.id, cursor);
      for (const operation of discarded) {
        this._appendTimelineWorkingHistoryAction(session.id, 'DISCARD_REDO_BRANCH', operation, String(operation.result_hash), String(operation.result_hash));
      }
    }
    for (const operation of operations) {
      const before = draft;
      const applied = this._timelineWorkingOperation(before, operation, project.id);
      const opSeq = nextSeq;
      nextSeq += 1;
      const opId = uuidv7();
      const created = nowUtcUs();
      const clientOpId = applied.clientOpId === null || applied.clientOpId === undefined ? null : requiredString(applied.clientOpId, 'client_op_id', 200);
      if (clientOpId && this.db.prepare('SELECT id FROM timeline_edit_ops WHERE working_session_id = ? AND client_op_id = ?').get(session.id, clientOpId)) {
        throw new CoreError('TIMELINE_EDIT_OP_ALREADY_EXISTS', 'CONFLICT', 'errors.timeline_edit_op_already_exists', { client_op_id: clientOpId }, { needsUser: true });
      }
      this.db.prepare(`INSERT INTO timeline_edit_ops
        (id, working_session_id, op_seq, op_type, payload_json, before_payload_json, after_payload_json,
         result_hash, history_state, actor_id, client_op_id, created_at_utc_us)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`).run(
        opId, session.id, opSeq, applied.opType, canonicalJson(operation), canonicalJson(before), canonicalJson(applied.draft), applied.contentHash, this.actorId, clientOpId, created,
      );
      draft = applied.draft;
      cursor = opSeq;
      accepted.push({ id: opId, op_seq: opSeq, op_type: applied.opType, result_hash: applied.contentHash, client_op_id: clientOpId });
    }
    const nextHash = this._timelineWorkingHash(draft);
    const nextVersion = Number(session.row_version) + 1;
    const nextStep = 'Autosave draft trước khi checkpoint hoặc đóng phiên.';
    this.db.prepare(`UPDATE timeline_working_sessions SET state = 'DIRTY', draft_payload_json = ?, draft_hash = ?,
      last_acknowledged_op_seq = ?, history_cursor_seq = ?, next_op_seq = ?, next_step = ?, row_version = ?, updated_at_utc_us = ? WHERE id = ?`).run(
      canonicalJson(draft), nextHash, cursor, cursor, nextSeq, nextStep, nextVersion, nowUtcUs(), session.id,
    );
    const updated = this._timelineWorkingSession(session.id);
    const projection = this._timelineWorkingPublicProjection(updated);
    return {
      projectId: project.id,
      result: {
        ...projection,
        accepted_operations: accepted,
        timeline_row_version: Number(timeline.row_version),
        impact_summary: {
          changed_scope: 'TIMELINE_WORKING_DRAFT',
          operation_types: accepted.map((operation) => operation.op_type),
          dependent_domains: ['SUBTITLES', 'AUDIO', 'LIP_SYNC', 'MUSIC', 'RELEASE_READINESS'],
          dependency_state: 'NOT_RECOMPUTED_UNTIL_CHECKPOINT',
          requires_autosave: true,
        },
      },
      event: { aggregateType: 'TIMELINE_WORKING_SESSION', aggregateId: session.id, aggregateVersion: nextVersion, eventType: 'TIMELINE_EDIT_OPS_APPLIED', payload: { working_session_id: session.id, project_id: project.id, timeline_id: timeline.id, operation_count: accepted.length, last_acknowledged_op_seq: cursor, draft_hash: nextHash } },
      audit: { actionType: 'timeline.working_session.apply_ops', targetType: 'TIMELINE_WORKING_SESSION', targetId: session.id, payload: { project_id: project.id, timeline_id: timeline.id, operation_count: accepted.length, operation_types: accepted.map((operation) => operation.op_type), last_acknowledged_op_seq: cursor, draft_hash: nextHash } },
    };
  }

  _undoTimelineEditOp(payload, expectedVersions) {
    const session = this._timelineWorkingSession(payload.working_session_id ?? payload.workingSessionId ?? payload.session_id ?? payload.sessionId);
    const { timeline, project } = this._timelineWorkingAssertWritable(session, payload, expectedVersions);
    this._timelineWorkingAssertEditable(session);
    const cursor = Number(session.history_cursor_seq);
    if (cursor < 1) throw new CoreError('TIMELINE_NO_UNDO', 'CONFLICT', 'errors.timeline_no_undo', { working_session_id: session.id }, { needsUser: true });
    const operation = this.db.prepare('SELECT * FROM timeline_edit_ops WHERE working_session_id = ? AND op_seq = ?').get(session.id, cursor);
    if (!operation) throw new CoreError('TIMELINE_WORKING_HISTORY_CORRUPT', 'CONFLICT', 'errors.timeline_working_history_corrupt', { working_session_id: session.id, op_seq: cursor }, { needsUser: true });
    const draft = this._timelineWorkingNormalizeDraft(parseJson(operation.before_payload_json, {}), project.id).draft;
    const draftHash = this._timelineWorkingHash(draft);
    const nextCursor = cursor - 1;
    this._appendTimelineWorkingHistoryAction(session.id, 'UNDO', operation, String(session.draft_hash), draftHash);
    const nextVersion = Number(session.row_version) + 1;
    const state = this._timelineWorkingMatchesBase(session, draftHash, draft) ? 'CLEAN' : 'DIRTY';
    const nextStep = state === 'CLEAN' ? 'Có thể chỉnh sửa tiếp hoặc đóng phiên.' : 'Autosave draft sau khi undo trước khi checkpoint.';
    this.db.prepare(`UPDATE timeline_working_sessions SET state = ?, draft_payload_json = ?, draft_hash = ?,
      last_acknowledged_op_seq = ?, history_cursor_seq = ?, next_step = ?, row_version = ?, updated_at_utc_us = ? WHERE id = ?`).run(
      state, canonicalJson(draft), draftHash, nextCursor, nextCursor, nextStep, nextVersion, nowUtcUs(), session.id,
    );
    const updated = this._timelineWorkingSession(session.id);
    return {
      projectId: project.id,
      result: { ...this._timelineWorkingPublicProjection(updated), undone_operation: { id: operation.id, op_seq: Number(operation.op_seq), op_type: operation.op_type } },
      event: { aggregateType: 'TIMELINE_WORKING_SESSION', aggregateId: session.id, aggregateVersion: nextVersion, eventType: 'TIMELINE_EDIT_OP_UNDONE', payload: { working_session_id: session.id, project_id: project.id, timeline_id: timeline.id, op_seq: Number(operation.op_seq), draft_hash: draftHash } },
      audit: { actionType: 'timeline.working_session.undo', targetType: 'TIMELINE_WORKING_SESSION', targetId: session.id, payload: { project_id: project.id, timeline_id: timeline.id, undone_op_seq: Number(operation.op_seq), op_type: operation.op_type, draft_hash: draftHash } },
    };
  }

  _redoTimelineEditOp(payload, expectedVersions) {
    const session = this._timelineWorkingSession(payload.working_session_id ?? payload.workingSessionId ?? payload.session_id ?? payload.sessionId);
    const { timeline, project } = this._timelineWorkingAssertWritable(session, payload, expectedVersions);
    this._timelineWorkingAssertEditable(session);
    const cursor = Number(session.history_cursor_seq);
    const operation = this.db.prepare('SELECT * FROM timeline_edit_ops WHERE working_session_id = ? AND op_seq = ?').get(session.id, cursor + 1);
    if (!operation) throw new CoreError('TIMELINE_NO_REDO', 'CONFLICT', 'errors.timeline_no_redo', { working_session_id: session.id }, { needsUser: true });
    const latestAction = this.db.prepare(`SELECT action_type FROM timeline_edit_actions
      WHERE working_session_id = ? AND target_op_seq = ? ORDER BY action_seq DESC LIMIT 1`).get(session.id, cursor + 1);
    if (!latestAction || latestAction.action_type !== 'UNDO') throw new CoreError('TIMELINE_NO_REDO', 'CONFLICT', 'errors.timeline_no_redo', { working_session_id: session.id }, { needsUser: true });
    const draft = this._timelineWorkingNormalizeDraft(parseJson(operation.after_payload_json, {}), project.id).draft;
    const draftHash = this._timelineWorkingHash(draft);
    this._appendTimelineWorkingHistoryAction(session.id, 'REDO', operation, String(session.draft_hash), draftHash);
    const nextCursor = Number(operation.op_seq);
    const nextVersion = Number(session.row_version) + 1;
    const state = draftHash === String(session.autosaved_hash).toLowerCase() ? 'CLEAN' : 'DIRTY';
    const nextStep = state === 'CLEAN' ? 'Có thể chỉnh sửa tiếp hoặc đóng phiên.' : 'Autosave draft sau khi redo trước khi checkpoint.';
    this.db.prepare(`UPDATE timeline_working_sessions SET state = ?, draft_payload_json = ?, draft_hash = ?,
      last_acknowledged_op_seq = ?, history_cursor_seq = ?, next_step = ?, row_version = ?, updated_at_utc_us = ? WHERE id = ?`).run(
      state, canonicalJson(draft), draftHash, nextCursor, nextCursor, nextStep, nextVersion, nowUtcUs(), session.id,
    );
    const updated = this._timelineWorkingSession(session.id);
    return {
      projectId: project.id,
      result: { ...this._timelineWorkingPublicProjection(updated), redone_operation: { id: operation.id, op_seq: Number(operation.op_seq), op_type: operation.op_type } },
      event: { aggregateType: 'TIMELINE_WORKING_SESSION', aggregateId: session.id, aggregateVersion: nextVersion, eventType: 'TIMELINE_EDIT_OP_REDONE', payload: { working_session_id: session.id, project_id: project.id, timeline_id: timeline.id, op_seq: Number(operation.op_seq), draft_hash: draftHash } },
      audit: { actionType: 'timeline.working_session.redo', targetType: 'TIMELINE_WORKING_SESSION', targetId: session.id, payload: { project_id: project.id, timeline_id: timeline.id, redone_op_seq: Number(operation.op_seq), op_type: operation.op_type, draft_hash: draftHash } },
    };
  }

  _autosaveTimelineWorkingSession(payload, expectedVersions) {
    const session = this._timelineWorkingSession(payload.working_session_id ?? payload.workingSessionId ?? payload.session_id ?? payload.sessionId);
    const { timeline, project } = this._timelineWorkingAssertWritable(session, payload, expectedVersions);
    const recovery = Boolean(payload.recover ?? payload.recovery ?? false);
    if (!TIMELINE_WORKING_EDITABLE_STATES.has(session.state)) {
      if (session.state !== 'RECOVERY_REQUIRED' || !recovery) {
        throw new CoreError('TIMELINE_WORKING_SESSION_NOT_EDITABLE', 'CONFLICT', 'errors.timeline_working_session_not_editable', { state: session.state }, { needsUser: true });
      }
    }
    if (session.state === 'RECOVERY_REQUIRED' && !recovery) throw new CoreError('TIMELINE_WORKING_RECOVERY_REQUIRED', 'CONFLICT', 'errors.timeline_working_recovery_required', { working_session_id: session.id }, { needsUser: true });
    const normalized = this._timelineWorkingNormalizeDraft(parseJson(session.draft_payload_json, {}), project.id);
    if (normalized.contentHash.toLowerCase() !== String(session.draft_hash).toLowerCase()) throw new CoreError('TIMELINE_WORKING_DRAFT_CORRUPT', 'CONFLICT', 'errors.timeline_working_draft_corrupt', { working_session_id: session.id }, { needsUser: true });
    const autosavingVersion = Number(session.row_version) + 1;
    this.db.prepare(`UPDATE timeline_working_sessions SET state = 'AUTOSAVING', next_step = ?, row_version = ?, updated_at_utc_us = ? WHERE id = ?`).run(
      'Đang ghi draft bền vững; chưa tạo hoặc approve canon.', autosavingVersion, nowUtcUs(), session.id,
    );
    const savedAt = nowUtcUs();
    const finalVersion = autosavingVersion + 1;
    this.db.prepare(`UPDATE timeline_working_sessions SET state = 'CLEAN', autosaved_hash = ?, last_autosave_at_utc_us = ?,
      next_step = ?, row_version = ?, updated_at_utc_us = ? WHERE id = ?`).run(
      normalized.contentHash, savedAt, 'Draft đã autosave; có thể checkpoint hoặc đóng phiên.', finalVersion, savedAt, session.id,
    );
    const updated = this._timelineWorkingSession(session.id);
    return {
      projectId: project.id,
      result: this._timelineWorkingPublicProjection(updated),
      event: { aggregateType: 'TIMELINE_WORKING_SESSION', aggregateId: session.id, aggregateVersion: finalVersion, eventType: 'TIMELINE_WORKING_SESSION_AUTOSAVED', payload: { working_session_id: session.id, project_id: project.id, timeline_id: timeline.id, draft_hash: normalized.contentHash, recovered: recovery } },
      audit: { actionType: 'timeline.working_session.autosave', targetType: 'TIMELINE_WORKING_SESSION', targetId: session.id, payload: { project_id: project.id, timeline_id: timeline.id, draft_hash: normalized.contentHash, recovered: recovery } },
    };
  }

  _checkpointTimelineWorkingSession(payload, expectedVersions, commandId) {
    const session = this._timelineWorkingSession(payload.working_session_id ?? payload.workingSessionId ?? payload.session_id ?? payload.sessionId);
    const { timeline, project } = this._timelineWorkingAssertWritable(session, payload, expectedVersions);
    if (!['OPEN', 'DIRTY', 'CLEAN'].includes(session.state)) throw new CoreError('TIMELINE_WORKING_SESSION_NOT_EDITABLE', 'CONFLICT', 'errors.timeline_working_session_not_editable', { state: session.state }, { needsUser: true });
    const baseRevision = this._timelineRevision(session.base_revision_id);
    if (Number(baseRevision.row_version) !== Number(session.base_revision_row_version)
      || String(baseRevision.content_hash).toLowerCase() !== String(session.base_content_hash).toLowerCase()) {
      throw new CoreError('STALE_REVISION', 'STALE_REVISION', 'errors.stale_revision', {
        entity_type: 'TIMELINE_REVISION', entity_id: baseRevision.id,
        expected: session.base_revision_row_version, current: Number(baseRevision.row_version),
      }, { needsUser: true, technicalDetails: { base_revision_id: baseRevision.id, expected_content_hash: session.base_content_hash, current_content_hash: baseRevision.content_hash } });
    }
    const draftNormalized = this._timelineWorkingNormalizeDraft(parseJson(session.draft_payload_json, {}), project.id, null, { checkAssets: true });
    this._timelineWorkingValidateMaterializedClips(draftNormalized.draft, project.id);
    if (draftNormalized.contentHash.toLowerCase() !== String(session.draft_hash).toLowerCase()) throw new CoreError('TIMELINE_WORKING_DRAFT_CORRUPT', 'CONFLICT', 'errors.timeline_working_draft_corrupt', { working_session_id: session.id }, { needsUser: true });
    if (draftNormalized.contentHash.toLowerCase() !== String(session.autosaved_hash).toLowerCase()) throw new CoreError('TIMELINE_DRAFT_NOT_AUTOSAVED', 'CONFLICT', 'errors.timeline_draft_not_autosaved', { working_session_id: session.id }, { needsUser: true });
    const expectedTimelineVersion = payload.expected_timeline_version ?? payload.expectedTimelineVersion ?? expectedVersions.TIMELINE ?? expectedVersions.timeline;
    if (expectedTimelineVersion === undefined || expectedTimelineVersion === null) throw new CoreError('EXPECTED_VERSION_REQUIRED', 'CONFLICT', 'errors.expected_version_required', { entity_type: 'TIMELINE', entity_id: timeline.id }, { needsUser: true });
    const profile = this._mediaProfileRevision(draftNormalized.draft.media_profile_revision_id);
    if (profile.lifecycle_state !== 'APPROVED') throw new CoreError('MEDIA_PROFILE_NOT_APPROVED', 'CONFLICT', 'errors.media_profile_not_approved', { media_profile_revision_id: profile.id }, { needsUser: true });
    const checkpointingVersion = Number(session.row_version) + 1;
    this.db.prepare(`UPDATE timeline_working_sessions SET state = 'CHECKPOINTING', next_step = ?, row_version = ?, updated_at_utc_us = ? WHERE id = ?`).run(
      'Đang kiểm tra pin revision, rights và readiness trước khi tạo checkpoint immutable.', checkpointingVersion, nowUtcUs(), session.id,
    );
    const revisionOperation = this._createTimelineRevision({
      project_id: project.id,
      timeline_id: timeline.id,
      media_profile_revision_id: draftNormalized.draft.media_profile_revision_id,
      duration: draftNormalized.draft.duration,
      tracks: draftNormalized.draft.tracks,
      markers: draftNormalized.draft.markers.map((marker) => ({ time: marker.time, marker_type: marker.marker_type, label: marker.label, payload: marker.payload })),
    }, { TIMELINE: expectedTimelineVersion });
    const checkpointRevisionId = revisionOperation.result?.revision?.id ?? revisionOperation.result?.current_revision?.id;
    if (!checkpointRevisionId) throw new CoreError('TIMELINE_CHECKPOINT_FAILED', 'INTERNAL', 'errors.timeline_checkpoint_failed', {}, { needsUser: false });
    // Preserve the normal timeline revision event/audit inside the same
    // command transaction; the outer operation records the session state.
    this._insertEvent(revisionOperation.event, commandId, this.actorId, null, commandId);
    this._insertAudit(revisionOperation.audit, commandId, this.actorId, 'SUCCEEDED');
    const checkpointRevision = this._timelineRevision(checkpointRevisionId);
    const nextVersion = checkpointingVersion + 1;
    this.db.prepare(`UPDATE timeline_working_sessions SET state = 'CLEAN',
      base_revision_id = ?, base_revision_row_version = ?, base_content_hash = ?,
      last_checkpoint_revision_id = ?, next_step = ?, row_version = ?, updated_at_utc_us = ? WHERE id = ?`).run(
      checkpointRevision.id, Number(checkpointRevision.row_version), String(checkpointRevision.content_hash).toLowerCase(),
      checkpointRevisionId, 'Checkpoint immutable đã tạo; review/approval vẫn là bước riêng.', nextVersion, nowUtcUs(), session.id,
    );
    const updated = this._timelineWorkingSession(session.id);
    const projection = this._timelineWorkingPublicProjection(updated);
    return {
      projectId: project.id,
      result: { ...projection, checkpoint_revision: revisionOperation.result.revision, checkpoint_revision_id: checkpointRevisionId },
      event: { aggregateType: 'TIMELINE_WORKING_SESSION', aggregateId: session.id, aggregateVersion: nextVersion, eventType: 'TIMELINE_WORKING_SESSION_CHECKPOINTED', payload: { working_session_id: session.id, project_id: project.id, timeline_id: timeline.id, checkpoint_revision_id: checkpointRevisionId, content_hash: draftNormalized.contentHash } },
      audit: { actionType: 'timeline.working_session.checkpoint', targetType: 'TIMELINE_WORKING_SESSION', targetId: session.id, payload: { project_id: project.id, timeline_id: timeline.id, checkpoint_revision_id: checkpointRevisionId, content_hash: draftNormalized.contentHash } },
    };
  }

  _closeTimelineWorkingSession(payload, expectedVersions) {
    const session = this._timelineWorkingSession(payload.working_session_id ?? payload.workingSessionId ?? payload.session_id ?? payload.sessionId);
    const timeline = this._timeline(session.timeline_id);
    this._assertPayloadProjectScope(payload, timeline.project_id, 'TIMELINE_WORKING_SESSION', session.id);
    const payloadEntityType = String(payload?.entity_type ?? payload?.entityType ?? '').trim().toUpperCase();
    const suppliedTimelineId = payload?.timeline_id ?? payload?.timelineId
      ?? (payloadEntityType === 'TIMELINE' ? (payload?.entity_id ?? payload?.entityId) : undefined);
    if (suppliedTimelineId !== undefined && suppliedTimelineId !== null && suppliedTimelineId !== timeline.id) {
      throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', {
        entity_type: 'TIMELINE', entity_id: suppliedTimelineId, expected_entity_id: timeline.id,
      }, { needsUser: true });
    }
    if (session.actor_id !== this.actorId) throw new CoreError('AUTH_REQUIRED', 'AUTH_REQUIRED', 'errors.timeline_working_session_actor_mismatch', { working_session_id: session.id }, { needsUser: true });
    const clientInstanceId = requiredString(payload.client_instance_id ?? payload.clientInstanceId, 'client_instance_id', MAX_TIMELINE_CLIENT_ID);
    if (clientInstanceId !== session.client_instance_id) {
      throw new CoreError('TIMELINE_WORKING_CLIENT_MISMATCH', 'AUTH_REQUIRED', 'errors.timeline_working_session_client_mismatch', { working_session_id: session.id }, { needsUser: true });
    }
    this._expectedVersion(expectedVersions, 'WORKING_SESSION', session.id, session.row_version);
    if (['CLOSED', 'ABANDONED'].includes(session.state)) throw new CoreError('TIMELINE_WORKING_SESSION_CLOSED', 'CONFLICT', 'errors.timeline_working_session_closed', { state: session.state }, { needsUser: true });
    const disposition = String(payload.disposition ?? payload.close_mode ?? payload.closeMode ?? '').trim().toUpperCase();
    if (!['SAVE', 'ABANDON'].includes(disposition)) throw new CoreError('TIMELINE_CLOSE_DISPOSITION_REQUIRED', 'CONFLICT', 'errors.timeline_close_disposition_required', {}, { needsUser: true });
    const draftHash = String(session.draft_hash).toLowerCase();
    const autosavedHash = String(session.autosaved_hash).toLowerCase();
    if (disposition === 'SAVE' && (session.state !== 'CLEAN' || draftHash !== autosavedHash)) throw new CoreError('TIMELINE_DRAFT_NOT_AUTOSAVED', 'CONFLICT', 'errors.timeline_draft_not_autosaved', { working_session_id: session.id }, { needsUser: true });
    const state = disposition === 'ABANDON' ? 'ABANDONED' : 'CLOSED';
    const nextStep = disposition === 'ABANDON'
      ? 'Phiên đã đóng nhưng draft vẫn được giữ; mở phiên mới để tiếp tục chỉnh sửa.'
      : 'Phiên đã đóng sau khi draft được autosave.';
    const nextVersion = Number(session.row_version) + 1;
    const closedAt = nowUtcUs();
    this.db.prepare(`UPDATE timeline_working_sessions SET state = ?, next_step = ?, closed_at_utc_us = ?, row_version = ?, updated_at_utc_us = ? WHERE id = ?`).run(
      state, nextStep, closedAt, nextVersion, closedAt, session.id,
    );
    const updated = this._timelineWorkingSession(session.id);
    return {
      projectId: timeline.project_id,
      result: this._timelineWorkingPublicProjection(updated),
      event: { aggregateType: 'TIMELINE_WORKING_SESSION', aggregateId: session.id, aggregateVersion: nextVersion, eventType: `TIMELINE_WORKING_SESSION_${state}`, payload: { working_session_id: session.id, project_id: timeline.project_id, timeline_id: timeline.id, disposition, state } },
      audit: { actionType: 'timeline.working_session.close', targetType: 'TIMELINE_WORKING_SESSION', targetId: session.id, payload: { project_id: timeline.project_id, timeline_id: timeline.id, disposition, state } },
    };
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
      schema_version: 1,
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

  _audioCue(audioCueId) {
    const id = requiredString(audioCueId, 'audio_cue_id');
    const row = this.db.prepare('SELECT * FROM audio_cues WHERE id = ?').get(id);
    if (!row) throw new CoreError('AUDIO_CUE_NOT_FOUND', 'VALIDATION', 'errors.audio_cue_not_found', { audio_cue_id: id });
    return row;
  }

  _audioCueRevision(audioCueRevisionId) {
    const id = requiredString(audioCueRevisionId, 'audio_cue_revision_id');
    const row = this.db.prepare(`SELECT r.*, c.project_id, c.timeline_id, c.cue_type, c.title
      FROM audio_cue_revisions r JOIN audio_cues c ON c.id = r.audio_cue_id WHERE r.id = ?`).get(id);
    if (!row) throw new CoreError('AUDIO_CUE_REVISION_NOT_FOUND', 'VALIDATION', 'errors.audio_cue_revision_not_found', { audio_cue_revision_id: id });
    return row;
  }

  _subtitleTrack(subtitleTrackId) {
    const id = requiredString(subtitleTrackId, 'subtitle_track_id');
    const row = this.db.prepare('SELECT * FROM subtitle_tracks WHERE id = ?').get(id);
    if (!row) throw new CoreError('SUBTITLE_TRACK_NOT_FOUND', 'VALIDATION', 'errors.subtitle_track_not_found', { subtitle_track_id: id });
    return row;
  }

  _subtitleTrackRevision(subtitleTrackRevisionId) {
    const id = requiredString(subtitleTrackRevisionId, 'subtitle_track_revision_id');
    const row = this.db.prepare(`SELECT r.*, t.project_id, t.timeline_id, t.locale, t.title
      FROM subtitle_track_revisions r JOIN subtitle_tracks t ON t.id = r.subtitle_track_id WHERE r.id = ?`).get(id);
    if (!row) throw new CoreError('SUBTITLE_TRACK_REVISION_NOT_FOUND', 'VALIDATION', 'errors.subtitle_track_revision_not_found', { subtitle_track_revision_id: id });
    return row;
  }

  _timingRevision(payload, projectId) {
    const timeline = this._timeline(payload.timeline_id ?? payload.timelineId);
    if (timeline.project_id !== projectId) {
      throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', {
        entity_type: 'TIMELINE', entity_id: timeline.id, project_id: projectId, actual_project_id: timeline.project_id,
      }, { needsUser: true });
    }
    const revision = this._timelineRevision(payload.timing_dependency_revision_id ?? payload.timingDependencyRevisionId
      ?? payload.timeline_revision_id ?? payload.timelineRevisionId);
    if (revision.timeline_id !== timeline.id || revision.project_id !== projectId) {
      throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', {
        entity_type: 'TIMELINE_REVISION', entity_id: revision.id, project_id: projectId, timeline_id: timeline.id,
      }, { needsUser: true });
    }
    const suppliedHash = payload.timing_dependency_content_hash ?? payload.timingDependencyContentHash
      ?? payload.timeline_content_hash ?? payload.timelineContentHash;
    if (typeof suppliedHash !== 'string' || !SHA256_HEX.test(suppliedHash.trim())) {
      throw new CoreError('TIMING_DEPENDENCY_HASH_REQUIRED', 'CONFLICT', 'errors.timing_dependency_hash_required', { timeline_revision_id: revision.id }, { needsUser: true });
    }
    if (suppliedHash.trim().toLowerCase() !== String(revision.content_hash).toLowerCase()) {
      throw new CoreError('TIMING_DEPENDENCY_HASH_MISMATCH', 'CONFLICT', 'errors.timing_dependency_hash_mismatch', { timeline_revision_id: revision.id }, { needsUser: true });
    }
    return { timeline, revision };
  }

  _timingRange(startValue, endValue, revision, fieldPrefix = 'timing') {
    const start = normalizeRational(startValue, `${fieldPrefix}.start`, { allowZero: true });
    const end = normalizeRational(endValue, `${fieldPrefix}.end`, { allowZero: false });
    const duration = { num: Number(revision.duration_num), den: Number(revision.duration_den) };
    if (rationalCompare(start, end) >= 0) {
      throw new CoreError('INVALID_TIME_INTERVAL', 'VALIDATION', 'errors.invalid_time_interval', { field: fieldPrefix });
    }
    if (rationalCompare(end, duration) > 0) {
      throw new CoreError('TIMING_OUT_OF_BOUNDS', 'CONFLICT', 'errors.timing_out_of_bounds', { field: fieldPrefix, timeline_revision_id: revision.id }, { needsUser: true });
    }
    return { start, end };
  }

  _timingDependencyHash(kind, revision, details) {
    return crypto.createHash('sha256').update(canonicalJson({
      kind,
      timeline_revision_id: revision.id,
      timeline_content_hash: revision.content_hash,
      ...details,
    })).digest('hex');
  }

  _timingRevisionStaleness(revision) {
    const latest = this.db.prepare(`SELECT id, content_hash FROM timeline_revisions
      WHERE timeline_id = ? ORDER BY revision_number DESC, id DESC LIMIT 1`).get(revision.timeline_id);
    if (!latest || latest.id !== revision.timeline_revision_id || String(latest.content_hash).toLowerCase() !== String(revision.timeline_content_hash).toLowerCase()) {
      return { stale: true, reason: 'TIMELINE_REVISION_CHANGED', nextStep: 'Tạo revision timing mới trên checkpoint timeline hiện tại.' };
    }
    if (revision.selected_asset_revision_id) {
      try {
        this._audioCueAssetSnapshot(revision.selected_asset_revision_id, revision.project_id, { requireReady: true });
      } catch (error) {
        return {
          stale: true,
          reason: error?.code === 'RIGHTS_BLOCKED' ? 'AUDIO_RIGHTS_CHANGED' : 'AUDIO_MATERIALIZATION_CHANGED',
          nextStep: 'Kiểm tra lại rights/materialization của audio asset hoặc tạo revision timing mới.',
        };
      }
    }
    return { stale: false, reason: null, nextStep: null };
  }

  _timingRevisionStale(revision) {
    return this._timingRevisionStaleness(revision).stale;
  }

  _audioCueAssetSnapshot(assetRevisionId, projectId, { requireReady = false } = {}) {
    if (!assetRevisionId) return { hash: null, readiness: null };
    const revision = this.db.prepare(`SELECT r.id, r.asset_id, r.availability_state, r.review_state,
        r.availability_evidence_state, a.project_id, a.lifecycle_state AS asset_lifecycle_state,
        so.storage_class, sol.state AS location_state
      FROM asset_revisions r JOIN assets a ON a.id = r.asset_id
      LEFT JOIN storage_objects so ON so.id = r.storage_object_id
      LEFT JOIN storage_object_locations sol ON sol.id = (
        SELECT location.id FROM storage_object_locations location
        WHERE location.storage_object_id = r.storage_object_id AND location.location_role = 'PRIMARY'
        ORDER BY CASE WHEN location.state = 'AVAILABLE' THEN 0 ELSE 1 END, location.id ASC LIMIT 1
      ) WHERE r.id = ?`).get(assetRevisionId);
    if (!revision) throw new CoreError('ASSET_REVISION_NOT_FOUND', 'VALIDATION', 'errors.asset_revision_not_found', { asset_revision_id: assetRevisionId });
    if (revision.project_id !== projectId) {
      throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', {
        entity_type: 'ASSET_REVISION', entity_id: assetRevisionId, project_id: projectId, actual_project_id: revision.project_id,
      }, { needsUser: true });
    }
    let readiness = null;
    if (requireReady) readiness = this._timelineAssetReadiness(assetRevisionId, projectId, { purpose: 'TIMELINE_AUDIO' });
    const rights = this._rightsForAsset(revision.asset_id, { purpose: 'TIMELINE_AUDIO' });
    const hash = crypto.createHash('sha256').update(canonicalJson({
      asset_revision_id: revision.id,
      availability_state: revision.availability_state,
      review_state: revision.review_state,
      availability_evidence_state: revision.availability_evidence_state,
      asset_lifecycle_state: revision.asset_lifecycle_state,
      storage_class: revision.storage_class ?? 'UNKNOWN',
      location_state: revision.location_state ?? 'UNKNOWN',
      purpose: 'TIMELINE_AUDIO',
      rights_status: rights.status ?? 'UNKNOWN',
      rights_eligible: Boolean(rights.eligible),
    })).digest('hex');
    return { hash, readiness };
  }

  _audioCueAssetGate(row) {
    if (!row.selected_asset_revision_id) {
      return { state: row.cue_type === 'SILENCE' ? 'NOT_APPLICABLE' : 'UNKNOWN', rights_status: null, materialization_state: null, reason: row.cue_type === 'SILENCE' ? null : 'AUDIO_ASSET_REQUIRED' };
    }
    const asset = this.db.prepare(`SELECT r.id, r.asset_id, r.availability_state, r.review_state,
        r.availability_evidence_state, a.lifecycle_state AS asset_lifecycle_state,
        so.storage_class, sol.state AS location_state
      FROM asset_revisions r JOIN assets a ON a.id = r.asset_id
      LEFT JOIN storage_objects so ON so.id = r.storage_object_id
      LEFT JOIN storage_object_locations sol ON sol.id = (
        SELECT location.id FROM storage_object_locations location
        WHERE location.storage_object_id = r.storage_object_id AND location.location_role = 'PRIMARY'
        ORDER BY CASE WHEN location.state = 'AVAILABLE' THEN 0 ELSE 1 END, location.id ASC LIMIT 1
      ) WHERE r.id = ?`).get(row.selected_asset_revision_id);
    if (!asset) return { state: 'BLOCKED', rights_status: 'UNKNOWN', materialization_state: 'UNKNOWN', reason: 'ASSET_REVISION_NOT_FOUND' };
    let rights;
    try { rights = this._rightsForAsset(asset.asset_id, { purpose: 'TIMELINE_AUDIO' }); } catch { rights = { status: 'UNKNOWN', eligible: false }; }
    const materialized = asset.asset_lifecycle_state !== 'TRASHED'
      && asset.availability_state === 'AVAILABLE'
      && asset.review_state === 'APPROVED'
      && asset.availability_evidence_state === 'VERIFIED'
      && asset.storage_class !== 'EXTERNAL_REFERENCE'
      && asset.location_state === 'AVAILABLE';
    return {
      state: rights.eligible && materialized ? 'READY' : 'BLOCKED',
      rights_status: rights.status ?? 'UNKNOWN',
      materialization_state: materialized ? 'AVAILABLE' : (asset.availability_state ?? 'UNKNOWN'),
      reason: rights.eligible ? (materialized ? null : 'TIMELINE_ASSET_NOT_READY') : 'RIGHTS_BLOCKED',
    };
  }

  _audioCueRevisionProjection(rowOrId) {
    const row = typeof rowOrId === 'string' ? this._audioCueRevision(rowOrId) : rowOrId;
    const staleness = this._timingRevisionStaleness(row);
    const projection = publicAudioCueRevision(row, { stale: staleness.stale, staleReason: staleness.reason, nextStep: staleness.nextStep });
    projection.asset_gate = this._audioCueAssetGate(row);
    return projection;
  }

  _subtitleTrackRevisionProjection(rowOrId) {
    const row = typeof rowOrId === 'string' ? this._subtitleTrackRevision(rowOrId) : rowOrId;
    const segments = this.db.prepare('SELECT * FROM subtitle_track_segments WHERE subtitle_track_revision_id = ? ORDER BY segment_index ASC, id ASC').all(row.id);
    const staleness = this._timingRevisionStaleness(row);
    const nextStep = staleness.stale ? (staleness.reason === 'TIMELINE_REVISION_CHANGED'
      ? 'Tạo revision phụ đề mới trên checkpoint timeline hiện tại.' : staleness.nextStep) : null;
    return publicSubtitleTrackRevision(row, segments, { stale: staleness.stale, staleReason: staleness.reason, nextStep });
  }

  _createAudioCueRevision(payload, expectedVersions = {}) {
    const project = this._project(payload.project_id ?? payload.projectId);
    this._assertProjectWritable(project);
    const { timeline, revision: timelineRevision } = this._timingRevision(payload, project.id);
    const cueType = String(payload.cue_type ?? payload.cueType ?? '').trim().toUpperCase();
    if (!AUDIO_CUE_TYPES.has(cueType)) throw new CoreError('INVALID_AUDIO_CUE_TYPE', 'VALIDATION', 'errors.invalid_audio_cue_type', { cue_type: cueType });
    const title = requiredString(payload.title ?? `${cueType} cue`, 'title', MAX_AUDIO_CUE_TITLE);
    const intentText = optionalString(payload.intent_text ?? payload.intentText, 'intent_text', MAX_AUDIO_INTENT, '');
    const { start, end } = this._timingRange(payload.start ?? payload.start_time ?? payload.startTime, payload.end ?? payload.end_time ?? payload.endTime, timelineRevision, 'audio_cue');
    const selectedAssetRevisionId = payload.selected_asset_revision_id ?? payload.selectedAssetRevisionId ?? null;
    if (cueType !== 'SILENCE' && !selectedAssetRevisionId) {
      throw new CoreError('AUDIO_ASSET_REQUIRED', 'CONFLICT', 'errors.audio_asset_required', { cue_type: cueType }, { needsUser: true });
    }
    const assetSnapshot = this._audioCueAssetSnapshot(selectedAssetRevisionId, project.id, { requireReady: cueType !== 'SILENCE' });
    const cueIdInput = payload.audio_cue_id ?? payload.audioCueId ?? payload.cue_id ?? payload.cueId ?? null;
    let cue = null;
    if (cueIdInput) {
      cue = this._audioCue(cueIdInput);
      if (cue.project_id !== project.id || cue.timeline_id !== timeline.id || cue.cue_type !== cueType) {
        throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', { entity_type: 'AUDIO_CUE', entity_id: cue.id }, { needsUser: true });
      }
      this._expectedVersion(expectedVersions, 'AUDIO_CUE', cue.id, cue.row_version);
    }
    const created = nowUtcUs();
    const audioCueId = cue?.id ?? uuidv7();
    if (!cue) {
      this.db.prepare(`INSERT INTO audio_cues
        (id, project_id, timeline_id, cue_type, title, created_by_actor_id, created_at_utc_us, updated_at_utc_us, row_version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(audioCueId, project.id, timeline.id, cueType, title, this.actorId, created, created);
    } else {
      const nextCueVersion = Number(cue.row_version) + 1;
      this.db.prepare('UPDATE audio_cues SET updated_at_utc_us = ?, row_version = ? WHERE id = ?').run(created, nextCueVersion, cue.id);
    }
    const revisionId = uuidv7();
    const revisionNumber = Number(this.db.prepare('SELECT COALESCE(MAX(revision_number), 0) AS n FROM audio_cue_revisions WHERE audio_cue_id = ?').get(audioCueId).n) + 1;
    const dependencyHash = this._timingDependencyHash('AUDIO_CUE', timelineRevision, { cue_type: cueType, start, end, intent_text: intentText, selected_asset_revision_id: selectedAssetRevisionId });
    this.db.prepare(`INSERT INTO audio_cue_revisions
      (id, audio_cue_id, revision_number, lifecycle_state, timeline_revision_id, timeline_content_hash,
       timing_dependency_hash, start_num, start_den, end_num, end_den, intent_text, selected_asset_revision_id,
       asset_snapshot_hash, created_by_actor_id, created_at_utc_us, row_version)
      VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(
      revisionId, audioCueId, revisionNumber, timelineRevision.id, timelineRevision.content_hash,
      dependencyHash, start.num, start.den, end.num, end.den, intentText, selectedAssetRevisionId,
      assetSnapshot.hash, this.actorId, created,
    );
    const createdCue = this._audioCue(audioCueId);
    const createdRevision = this._audioCueRevision(revisionId);
    return {
      projectId: project.id,
      result: { audio_cue: publicAudioCue(createdCue), revision: this._audioCueRevisionProjection(createdRevision) },
      event: { aggregateType: 'AUDIO_CUE', aggregateId: audioCueId, aggregateVersion: Number(createdCue.row_version), eventType: 'AUDIO_CUE_REVISION_CREATED', payload: { audio_cue_id: audioCueId, audio_cue_revision_id: revisionId, timeline_revision_id: timelineRevision.id, timeline_content_hash: timelineRevision.content_hash } },
      audit: { actionType: 'audio_cue.revision.create', targetType: 'AUDIO_CUE_REVISION', targetId: revisionId, payload: { project_id: project.id, audio_cue_id: audioCueId, timeline_revision_id: timelineRevision.id } },
    };
  }

  _transitionAudioCueRevision(payload, expectedVersions) {
    const revision = this._audioCueRevision(payload.audio_cue_revision_id ?? payload.audioCueRevisionId ?? payload.revision_id ?? payload.revisionId);
    this._assertPayloadProjectScope(payload, revision.project_id, 'AUDIO_CUE_REVISION', revision.id);
    const project = this._project(revision.project_id);
    this._assertProjectWritable(project);
    const timingBinding = this._timingRevision(payload, project.id);
    if (timingBinding.revision.id !== revision.timeline_revision_id) {
      throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', {
        entity_type: 'TIMING_DEPENDENCY', entity_id: revision.id, timeline_revision_id: revision.timeline_revision_id,
      }, { needsUser: true });
    }
    this._expectedVersion(expectedVersions, 'AUDIO_CUE_REVISION', revision.id, revision.row_version);
    if (this._timingRevisionStale(revision)) throw new CoreError('AUDIO_CUE_STALE', 'CONFLICT', 'errors.audio_cue_stale', { audio_cue_revision_id: revision.id }, { needsUser: true });
    const nextState = String(payload.next_state ?? payload.nextState ?? payload.state ?? '').trim().toUpperCase();
    if (nextState === 'APPROVED') throw new CoreError('REVIEW_NOT_SUPPORTED', 'CONFLICT', 'errors.review_not_supported', { subject_type: 'AUDIO_CUE_REVISION', audio_cue_revision_id: revision.id }, { needsUser: true });
    if (!AUDIO_CUE_STATES.has(nextState) || !AUDIO_CUE_TRANSITIONS[revision.lifecycle_state]?.has(nextState)) {
      throw new CoreError('INVALID_STATE_TRANSITION', 'CONFLICT', 'errors.invalid_state_transition', { from: revision.lifecycle_state, to: nextState }, { needsUser: true });
    }
    if (['CANDIDATE', 'SELECTED'].includes(nextState) && revision.cue_type !== 'SILENCE') this._audioCueAssetSnapshot(revision.selected_asset_revision_id, project.id, { requireReady: true });
    const nextVersion = Number(revision.row_version) + 1;
    this.db.prepare('UPDATE audio_cue_revisions SET lifecycle_state = ?, row_version = ? WHERE id = ?').run(nextState, nextVersion, revision.id);
    const next = this._audioCueRevision(revision.id);
    return {
      projectId: project.id,
      result: { audio_cue: publicAudioCue(this._audioCue(revision.audio_cue_id)), revision: this._audioCueRevisionProjection(next) },
      event: { aggregateType: 'AUDIO_CUE', aggregateId: revision.audio_cue_id, aggregateVersion: nextVersion, eventType: `AUDIO_CUE_REVISION_${nextState}`, payload: { audio_cue_id: revision.audio_cue_id, audio_cue_revision_id: revision.id, lifecycle_state: nextState } },
      audit: { actionType: 'audio_cue.revision.transition', targetType: 'AUDIO_CUE_REVISION', targetId: revision.id, payload: { from: revision.lifecycle_state, to: nextState } },
    };
  }

  _createSubtitleTrackRevision(payload, expectedVersions = {}) {
    const project = this._project(payload.project_id ?? payload.projectId);
    this._assertProjectWritable(project);
    const { timeline, revision: timelineRevision } = this._timingRevision(payload, project.id);
    const locale = requiredString(payload.locale ?? payload.language ?? 'vi-VN', 'locale', MAX_SUBTITLE_LOCALE);
    const title = requiredString(payload.title ?? `Subtitles ${locale}`, 'title', MAX_AUDIO_CUE_TITLE);
    const formatProfile = requiredString(payload.format_profile ?? payload.formatProfile ?? 'TEXT', 'format_profile', 120).toUpperCase();
    const segmentsInput = arrayValue(payload.segments, 'segments');
    if (segmentsInput.length > MAX_SUBTITLE_SEGMENTS) throw new CoreError('FIELD_TOO_LARGE', 'VALIDATION', 'errors.field_too_large', { field: 'segments', max_items: MAX_SUBTITLE_SEGMENTS });
    const segments = segmentsInput.map((segment, index) => {
      if (!segment || typeof segment !== 'object' || Array.isArray(segment)) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field: `segments[${index}]` });
      const range = this._timingRange(segment.start ?? segment.start_time ?? segment.startTime, segment.end ?? segment.end_time ?? segment.endTime, timelineRevision, `segments[${index}]`);
      const text = requiredString(segment.text, `segments[${index}].text`, MAX_SUBTITLE_TEXT);
      const segmentLocale = requiredString(segment.locale ?? locale, `segments[${index}].locale`, MAX_SUBTITLE_LOCALE);
      return { id: requiredString(segment.id ?? uuidv7(), `segments[${index}].id`, 200), segmentIndex: index, ...range, locale: segmentLocale, text };
    });
    const byLocale = new Map();
    for (const segment of segments) byLocale.set(segment.locale, [...(byLocale.get(segment.locale) ?? []), segment]);
    for (const localeSegments of byLocale.values()) {
      const sorted = localeSegments.sort((left, right) => rationalCompare(left.start, right.start) || left.segmentIndex - right.segmentIndex);
      for (let index = 1; index < sorted.length; index += 1) {
        if (rationalCompare(sorted[index - 1].end, sorted[index].start) > 0) throw new CoreError('SUBTITLE_SEGMENT_OVERLAP', 'CONFLICT', 'errors.subtitle_segment_overlap', { index }, { needsUser: true });
      }
    }
    const trackIdInput = payload.subtitle_track_id ?? payload.subtitleTrackId ?? payload.track_id ?? payload.trackId ?? null;
    let track = null;
    if (trackIdInput) {
      track = this._subtitleTrack(trackIdInput);
      if (track.project_id !== project.id || track.timeline_id !== timeline.id || track.locale !== locale) throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', { entity_type: 'SUBTITLE_TRACK', entity_id: track.id }, { needsUser: true });
      this._expectedVersion(expectedVersions, 'SUBTITLE_TRACK', track.id, track.row_version);
    }
    const created = nowUtcUs();
    const subtitleTrackId = track?.id ?? uuidv7();
    if (!track) {
      this.db.prepare(`INSERT INTO subtitle_tracks
        (id, project_id, timeline_id, locale, title, created_by_actor_id, created_at_utc_us, updated_at_utc_us, row_version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(subtitleTrackId, project.id, timeline.id, locale, title, this.actorId, created, created);
    } else {
      this.db.prepare('UPDATE subtitle_tracks SET updated_at_utc_us = ?, row_version = ? WHERE id = ?').run(created, Number(track.row_version) + 1, track.id);
    }
    const revisionId = uuidv7();
    const revisionNumber = Number(this.db.prepare('SELECT COALESCE(MAX(revision_number), 0) AS n FROM subtitle_track_revisions WHERE subtitle_track_id = ?').get(subtitleTrackId).n) + 1;
    const dependencyHash = this._timingDependencyHash('SUBTITLE_TRACK', timelineRevision, { locale, format_profile: formatProfile, segments });
    this.db.prepare(`INSERT INTO subtitle_track_revisions
      (id, subtitle_track_id, revision_number, lifecycle_state, timeline_revision_id, timeline_content_hash,
       timing_dependency_hash, format_profile, created_by_actor_id, created_at_utc_us, row_version)
      VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, 1)`).run(
      revisionId, subtitleTrackId, revisionNumber, timelineRevision.id, timelineRevision.content_hash,
      dependencyHash, formatProfile, this.actorId, created,
    );
    const insertSegment = this.db.prepare(`INSERT INTO subtitle_track_segments
      (id, subtitle_track_revision_id, segment_index, start_num, start_den, end_num, end_den, locale, text, created_at_utc_us)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const segment of segments) insertSegment.run(segment.id, revisionId, segment.segmentIndex, segment.start.num, segment.start.den, segment.end.num, segment.end.den, segment.locale, segment.text, created);
    const createdTrack = this._subtitleTrack(subtitleTrackId);
    const createdRevision = this._subtitleTrackRevision(revisionId);
    return {
      projectId: project.id,
      result: { subtitle_track: publicSubtitleTrack(createdTrack), revision: this._subtitleTrackRevisionProjection(createdRevision) },
      event: { aggregateType: 'SUBTITLE_TRACK', aggregateId: subtitleTrackId, aggregateVersion: Number(createdTrack.row_version), eventType: 'SUBTITLE_TRACK_REVISION_CREATED', payload: { subtitle_track_id: subtitleTrackId, subtitle_track_revision_id: revisionId, timeline_revision_id: timelineRevision.id, timeline_content_hash: timelineRevision.content_hash } },
      audit: { actionType: 'subtitle_track.revision.create', targetType: 'SUBTITLE_TRACK_REVISION', targetId: revisionId, payload: { project_id: project.id, subtitle_track_id: subtitleTrackId, timeline_revision_id: timelineRevision.id, segment_count: segments.length } },
    };
  }

  _transitionSubtitleTrackRevision(payload, expectedVersions) {
    const revision = this._subtitleTrackRevision(payload.subtitle_track_revision_id ?? payload.subtitleTrackRevisionId ?? payload.revision_id ?? payload.revisionId);
    this._assertPayloadProjectScope(payload, revision.project_id, 'SUBTITLE_TRACK_REVISION', revision.id);
    const project = this._project(revision.project_id);
    this._assertProjectWritable(project);
    const timingBinding = this._timingRevision(payload, project.id);
    if (timingBinding.revision.id !== revision.timeline_revision_id) {
      throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', {
        entity_type: 'TIMING_DEPENDENCY', entity_id: revision.id, timeline_revision_id: revision.timeline_revision_id,
      }, { needsUser: true });
    }
    this._expectedVersion(expectedVersions, 'SUBTITLE_TRACK_REVISION', revision.id, revision.row_version);
    if (this._timingRevisionStale(revision)) throw new CoreError('SUBTITLE_TRACK_STALE', 'CONFLICT', 'errors.subtitle_track_stale', { subtitle_track_revision_id: revision.id }, { needsUser: true });
    const nextState = String(payload.next_state ?? payload.nextState ?? payload.state ?? '').trim().toUpperCase();
    if (nextState === 'APPROVED') throw new CoreError('REVIEW_NOT_SUPPORTED', 'CONFLICT', 'errors.review_not_supported', { subject_type: 'SUBTITLE_TRACK_REVISION', subtitle_track_revision_id: revision.id }, { needsUser: true });
    if (!SUBTITLE_TRACK_STATES.has(nextState) || !SUBTITLE_TRACK_TRANSITIONS[revision.lifecycle_state]?.has(nextState)) throw new CoreError('INVALID_STATE_TRANSITION', 'CONFLICT', 'errors.invalid_state_transition', { from: revision.lifecycle_state, to: nextState }, { needsUser: true });
    const nextVersion = Number(revision.row_version) + 1;
    this.db.prepare('UPDATE subtitle_track_revisions SET lifecycle_state = ?, row_version = ? WHERE id = ?').run(nextState, nextVersion, revision.id);
    const next = this._subtitleTrackRevision(revision.id);
    return {
      projectId: project.id,
      result: { subtitle_track: publicSubtitleTrack(this._subtitleTrack(revision.subtitle_track_id)), revision: this._subtitleTrackRevisionProjection(next) },
      event: { aggregateType: 'SUBTITLE_TRACK', aggregateId: revision.subtitle_track_id, aggregateVersion: nextVersion, eventType: `SUBTITLE_TRACK_REVISION_${nextState}`, payload: { subtitle_track_id: revision.subtitle_track_id, subtitle_track_revision_id: revision.id, lifecycle_state: nextState } },
      audit: { actionType: 'subtitle_track.revision.transition', targetType: 'SUBTITLE_TRACK_REVISION', targetId: revision.id, payload: { from: revision.lifecycle_state, to: nextState } },
    };
  }

  _audioTiming(params = {}) {
    const timeline = this._timeline(params.timeline_id ?? params.timelineId);
    const projectId = params.project_id ?? params.projectId;
    if (projectId !== undefined && projectId !== null && projectId !== timeline.project_id) throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', { entity_type: 'TIMELINE', entity_id: timeline.id, project_id: projectId, actual_project_id: timeline.project_id }, { needsUser: true });
    const revisionId = params.timing_dependency_revision_id ?? params.timingDependencyRevisionId
      ?? params.timeline_revision_id ?? params.timelineRevisionId;
    const timelineRevision = this._timelineRevision(revisionId);
    if (timelineRevision.timeline_id !== timeline.id) throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', { entity_type: 'TIMELINE_REVISION', entity_id: timelineRevision.id }, { needsUser: true });
    const requestedState = params.state ?? params.lifecycle_state ?? params.lifecycleState;
    if (requestedState !== undefined && requestedState !== null && !AUDIO_CUE_STATES.has(String(requestedState).trim().toUpperCase())) {
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field: 'state' });
    }
    const state = requestedState === undefined || requestedState === null ? null : String(requestedState).trim().toUpperCase();
    const offset = params.cursor === undefined || params.cursor === null || params.cursor === '' ? 0 : boundedInteger(params.cursor, 'cursor', { min: 0, max: 1_000_000 });
    const limit = Math.min(Math.max(asInt(params.limit, 200), 1), 200);
    const rows = this.db.prepare(`SELECT r.*, c.project_id, c.timeline_id, c.cue_type, c.title
      FROM audio_cue_revisions r JOIN audio_cues c ON c.id = r.audio_cue_id
      WHERE c.project_id = ? AND c.timeline_id = ? AND r.timeline_revision_id = ?
      ORDER BY r.created_at_utc_us ASC, r.id ASC`).all(timeline.project_id, timeline.id, timelineRevision.id);
    const filtered = rows.map((row) => ({ audio_cue: publicAudioCue(row), revision: this._audioCueRevisionProjection(row) }))
      .filter((item) => !state || item.revision.lifecycle_state === state);
    const projected = filtered.slice(offset, offset + limit);
    return {
      timeline: publicTimeline(timeline), timeline_revision: publicTimelineRevision(timelineRevision),
      cues: projected,
      next_cursor: offset + projected.length < filtered.length ? String(offset + projected.length) : null,
      projection_seq: this._projectionSeq(), generated_at: new Date().toISOString(),
    };
  }

  _subtitleTiming(params = {}) {
    const timeline = this._timeline(params.timeline_id ?? params.timelineId);
    const projectId = params.project_id ?? params.projectId;
    if (projectId !== undefined && projectId !== null && projectId !== timeline.project_id) throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', { entity_type: 'TIMELINE', entity_id: timeline.id, project_id: projectId, actual_project_id: timeline.project_id }, { needsUser: true });
    const timelineRevision = this._timelineRevision(params.timing_dependency_revision_id ?? params.timingDependencyRevisionId
      ?? params.timeline_revision_id ?? params.timelineRevisionId);
    if (timelineRevision.timeline_id !== timeline.id) throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', { entity_type: 'TIMELINE_REVISION', entity_id: timelineRevision.id }, { needsUser: true });
    const requestedState = params.state ?? params.lifecycle_state ?? params.lifecycleState;
    if (requestedState !== undefined && requestedState !== null && !SUBTITLE_TRACK_STATES.has(String(requestedState).trim().toUpperCase())) {
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field: 'state' });
    }
    const state = requestedState === undefined || requestedState === null ? null : String(requestedState).trim().toUpperCase();
    const requestedLocale = params.locale === undefined || params.locale === null ? null : String(params.locale).trim();
    const offset = params.cursor === undefined || params.cursor === null || params.cursor === '' ? 0 : boundedInteger(params.cursor, 'cursor', { min: 0, max: 1_000_000 });
    const limit = Math.min(Math.max(asInt(params.limit, 200), 1), 200);
    const rows = this.db.prepare(`SELECT r.*, t.project_id, t.timeline_id, t.locale, t.title
      FROM subtitle_track_revisions r JOIN subtitle_tracks t ON t.id = r.subtitle_track_id
      WHERE t.project_id = ? AND t.timeline_id = ? AND r.timeline_revision_id = ?
      ORDER BY r.created_at_utc_us ASC, r.id ASC`).all(timeline.project_id, timeline.id, timelineRevision.id);
    const filtered = rows.map((row) => ({ subtitle_track: publicSubtitleTrack(row), revision: this._subtitleTrackRevisionProjection(row) }))
      .filter((item) => (!state || item.revision.lifecycle_state === state) && (!requestedLocale || item.subtitle_track.locale === requestedLocale));
    const projected = filtered.slice(offset, offset + limit);
    return {
      timeline: publicTimeline(timeline), timeline_revision: publicTimelineRevision(timelineRevision),
      tracks: projected,
      next_cursor: offset + projected.length < filtered.length ? String(offset + projected.length) : null,
      projection_seq: this._projectionSeq(), generated_at: new Date().toISOString(),
    };
  }

  _timingImpact(params = {}) {
    const timeline = this._timeline(params.timeline_id ?? params.timelineId);
    const projectId = params.project_id ?? params.projectId;
    if (projectId !== undefined && projectId !== null && projectId !== timeline.project_id) {
      throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', {
        entity_type: 'TIMELINE', entity_id: timeline.id, project_id: projectId, actual_project_id: timeline.project_id,
      }, { needsUser: true });
    }
    const pinnedRevisionId = params.timing_dependency_revision_id ?? params.timingDependencyRevisionId
      ?? params.timeline_revision_id ?? params.timelineRevisionId;
    if (pinnedRevisionId) {
      const pinned = this._timelineRevision(pinnedRevisionId);
      if (pinned.timeline_id !== timeline.id) {
        throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', {
          entity_type: 'TIMELINE_REVISION', entity_id: pinned.id, timeline_id: timeline.id,
        }, { needsUser: true });
      }
    }
    const audioRows = this.db.prepare(`SELECT r.*, c.project_id, c.timeline_id, c.cue_type, c.title
      FROM audio_cue_revisions r JOIN audio_cues c ON c.id = r.audio_cue_id
      WHERE c.project_id = ? AND c.timeline_id = ?
      ORDER BY r.created_at_utc_us ASC, r.id ASC`).all(timeline.project_id, timeline.id);
    const subtitleRows = this.db.prepare(`SELECT r.*, t.project_id, t.timeline_id, t.locale, t.title
      FROM subtitle_track_revisions r JOIN subtitle_tracks t ON t.id = r.subtitle_track_id
      WHERE t.project_id = ? AND t.timeline_id = ?
      ORDER BY r.created_at_utc_us ASC, r.id ASC`).all(timeline.project_id, timeline.id);
    const audio = audioRows.map((row) => {
      const revision = this._audioCueRevisionProjection(row);
      return {
        audio_cue_id: row.audio_cue_id,
        audio_cue_revision_id: row.id,
        timeline_revision_id: row.timeline_revision_id,
        lifecycle_state: revision.lifecycle_state,
        stale: Boolean(revision.stale),
        next_step: revision.next_step,
      };
    });
    const subtitles = subtitleRows.map((row) => {
      const revision = this._subtitleTrackRevisionProjection(row);
      return {
        subtitle_track_id: row.subtitle_track_id,
        subtitle_track_revision_id: row.id,
        timeline_revision_id: row.timeline_revision_id,
        lifecycle_state: revision.lifecycle_state,
        stale: Boolean(revision.stale),
        next_step: revision.next_step,
      };
    });
    const staleAudio = audio.filter((row) => row.stale).length;
    const staleSubtitles = subtitles.filter((row) => row.stale).length;
    return {
      timeline: publicTimeline(timeline),
      pinned_timeline_revision_id: pinnedRevisionId ?? null,
      audio_cues: audio,
      subtitle_tracks: subtitles,
      counts: {
        audio_cues: audio.length,
        subtitle_tracks: subtitles.length,
        stale_audio_cues: staleAudio,
        stale_subtitle_tracks: staleSubtitles,
        stale_total: staleAudio + staleSubtitles,
      },
      projection_seq: this._projectionSeq(), generated_at: new Date().toISOString(),
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
      const suppliedSourcePath = payload.source_path ?? payload.sourcePath ?? payload.path ?? payload.file_path;
      // Browser intake only has the opaque staging handle.  Resolve its
      // private candidate path inside Core; callers cannot rebind the handle
      // to an arbitrary local path.  Path-based COPY keeps the original
      // source path for provenance and compatibility with CLI imports.
      sourcePath = suppliedSourcePath
        ? this._canonicalSourcePath(suppliedSourcePath)
        : path.resolve(String(staged.temp_path));
      file = {
        hash_algorithm: staged.hash_algorithm ?? 'SHA-256',
        content_hash: staged.sha256,
        byte_size: Number(staged.expected_size ?? staged.current_size),
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
    const suppliedSourcePath = payload.source_path ?? payload.sourcePath ?? payload.path ?? payload.file_path;
    const sourceUri = staged && !suppliedSourcePath
      ? `cineforge://staging/${encodeURIComponent(stagingId)}`
      : pathToFileURL(sourcePath).href;
    const sourceFingerprint = staged && !suppliedSourcePath
      ? staged.source_path_fingerprint
      : this._pathFingerprint(sourcePath);
    if (staged && suppliedSourcePath && staged.source_path_fingerprint !== sourceFingerprint) {
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
        sessionId, project?.id ?? null, this.actorId,
        staged && !suppliedSourcePath ? `cineforge://staging/${encodeURIComponent(stagingId)}` : pathToFileURL(path.dirname(sourcePath)).href,
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
    this._assertCoreOwner();
    const commandId = requiredString(input.command_id ?? input.commandId, 'command_id');
    const current = this.db.prepare('SELECT * FROM commands WHERE id = ?').get(commandId);
    if (!current) throw new CoreError('NOT_FOUND', 'VALIDATION', 'errors.command_not_found', { command_id: commandId });
    if (current.actor_id !== this.actorId) {
      throw new CoreError('AUTH_REQUIRED', 'AUTH_REQUIRED', 'errors.command_actor_mismatch', { command_id: commandId }, { needsUser: true });
    }
    if (terminalStatus(current.status)) return { ...commandResult(current), cancellation: 'already_terminal' };
    this._transaction(() => {
      this._assertCoreOwner();
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
       UNION SELECT id FROM release_candidates WHERE project_id = ?
       UNION SELECT id FROM release_build_plans WHERE project_id = ?
       UNION SELECT id FROM media_probe_jobs WHERE project_id = ?
       UNION SELECT ?)
      ORDER BY seq DESC LIMIT 20`).all(projectId, projectId, projectId, projectId, projectId, projectId, projectId, projectId).map((row) => this._publicActivity(row));
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
    if (aggregateType === 'TIMELINE_WORKING_SESSION') return this.db.prepare(`SELECT t.project_id FROM timeline_working_sessions s JOIN timelines t ON t.id = s.timeline_id WHERE s.id = ?`).get(aggregateId)?.project_id ?? null;
    if (aggregateType === 'EXPORT_SESSION') return this.db.prepare('SELECT project_id FROM export_sessions WHERE id = ?').get(aggregateId)?.project_id ?? null;
    if (aggregateType === 'HANDOFF_MANIFEST') return this.db.prepare('SELECT project_id FROM handoff_manifests WHERE id = ?').get(aggregateId)?.project_id ?? null;
    if (aggregateType === 'RELEASE_CANDIDATE') return this.db.prepare('SELECT project_id FROM release_candidates WHERE id = ?').get(aggregateId)?.project_id ?? null;
    if (aggregateType === 'RELEASE_BUILD_PLAN') return this.db.prepare('SELECT project_id FROM release_build_plans WHERE id = ?').get(aggregateId)?.project_id ?? null;
    if (aggregateType === 'MEDIA_PROBE_JOB') return this.db.prepare('SELECT project_id FROM media_probe_jobs WHERE id = ?').get(aggregateId)?.project_id ?? null;
    return null;
  }

  _publicActivity(row) {
    const event = this._publicEvent(row);
    const projectId = this._eventProjectId(row, event.payload);
    if (projectId) {
      event.project_id = projectId;
      event.project_name = this.db.prepare('SELECT title FROM projects WHERE id = ?').get(projectId)?.title ?? projectId;
    }
    if (event.aggregate_type === 'MEDIA_PROBE_JOB'
      && ['MEDIA_PROBE_ADMISSION_BLOCKED', 'MEDIA_PROBE_INTENT_CANCELLED'].includes(event.event_type)) {
      const current = this.db.prepare('SELECT state FROM media_probe_jobs WHERE id=?').get(event.aggregate_id);
      const needsUser = MEDIA_PROBE_BLOCKED_STATES.has(current?.state);
      const cancelled = event.event_type === 'MEDIA_PROBE_INTENT_CANCELLED';
      event.state = needsUser ? 'blocked' : 'complete';
      event.needs_user = needsUser;
      event.human_state.needs_user = needsUser;
      event.human_state.blocking = needsUser;
      event.label = cancelled ? 'Đã hủy yêu cầu kiểm tra media' : 'Yêu cầu kiểm tra media chưa chạy';
      event.label_en = cancelled ? 'Media inspection request cancelled' : 'Media inspection request not executed';
      event.detail = needsUser ? 'CineForge đã lưu yêu cầu; chưa có kết quả phân tích.' : 'Yêu cầu chưa chạy đã được hủy.';
      event.detail_en = needsUser ? 'CineForge recorded the request; no analysis result is available.' : 'The unexecuted request was cancelled.';
      event.milestone = needsUser ? 'Cần xử lý trước khi phân tích' : 'Đã hủy yêu cầu';
      event.milestone_en = needsUser ? 'Resolve prerequisites before analysis' : 'Request cancelled';
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

  /**
   * Compute the read-only release gate projection from one explicit project
   * snapshot.  This deliberately does not persist a release candidate or
   * resolve a "latest" revision: an approved timeline is usable only when
   * the project has exactly one unambiguous approved revision and every gate
   * binds to that revision's concrete evidence.
   */
  _releaseReadiness(projectIdValue) {
    const projectId = requiredString(projectIdValue, 'project_id');
    const project = this._project(projectId);
    const now = new Date().toISOString();
    const gate = (key, state, reason, nextStep, evidence = {}, blocking = state === 'FAIL' || state === 'UNKNOWN') => ({
      key,
      state,
      blocking: Boolean(blocking),
      reason: reason ?? null,
      next_step: nextStep ?? null,
      evidence,
    });

    const timelineRows = this.db.prepare(`SELECT * FROM timelines
      WHERE project_id = ? AND lifecycle_state != 'TRASHED'
      ORDER BY id ASC`).all(project.id);
    const approvedCandidates = [];
    for (const timeline of timelineRows) {
      const revisions = this.db.prepare(`SELECT * FROM timeline_revisions
        WHERE timeline_id = ? AND lifecycle_state = 'APPROVED'
        ORDER BY id ASC`).all(timeline.id);
      for (const revision of revisions) approvedCandidates.push({ timeline, revision });
    }
    let exact = approvedCandidates.length === 1 ? approvedCandidates[0] : null;
    let timelineProjection = null;
    let timelineProjectionError = null;
    let exactRefs = {
      timeline_id: null,
      timeline_revision_id: null,
      timeline_content_hash: null,
      media_profile_revision_id: null,
      review_session_id: null,
    };
    if (exact) {
      try {
        // Use the canonical revision projection for every downstream hash and
        // scope check.  The candidate query intentionally stays narrow, but
        // review snapshots include the owning project id.
        exact = { ...exact, revision: this._timelineRevision(exact.revision.id) };
        timelineProjection = this._timelineRevisionProjection(exact.revision.id);
      } catch (error) {
        // A readiness projection is a read-side safety check.  A malformed
        // or incomplete dependency must become UNKNOWN instead of turning a
        // dashboard refresh into an HTTP 500.
        timelineProjectionError = error?.code ?? 'TIMELINE_PROJECTION_UNAVAILABLE';
      }
      exactRefs = {
        timeline_id: exact.timeline.id,
        timeline_revision_id: exact.revision.id,
        timeline_content_hash: String(exact.revision.content_hash ?? '').toLowerCase(),
        media_profile_revision_id: exact.revision.media_profile_revision_id,
        review_session_id: null,
      };
    }

    const pictureEvidence = exact ? {
      timeline_id: exact.timeline.id,
      timeline_revision_id: exact.revision.id,
      content_hash: String(exact.revision.content_hash ?? '').toLowerCase(),
      approved_candidate_count: approvedCandidates.length,
      clip_count: (timelineProjection?.revision?.tracks ?? []).reduce((sum, track) => sum + (track.clips?.length ?? 0), 0),
    } : { approved_candidate_count: approvedCandidates.length };
    const pictureClipCount = Number(pictureEvidence.clip_count ?? 0);
    const picture = !exact
      ? gate('PICTURE', 'UNKNOWN', approvedCandidates.length === 0 ? 'NO_APPROVED_TIMELINE' : 'AMBIGUOUS_APPROVED_TIMELINE', approvedCandidates.length === 0
        ? 'Tạo và approve đúng một timeline revision làm nguồn picture cho project.'
        : 'Giữ lại một approved timeline revision rõ ràng trước khi kiểm tra release.', pictureEvidence)
      : timelineProjectionError
        ? gate('PICTURE', 'UNKNOWN', 'TIMELINE_PROJECTION_UNAVAILABLE', 'Sửa dependency của timeline revision rồi refresh readiness.', { ...pictureEvidence, projection_error: timelineProjectionError })
      : pictureClipCount === 0
        ? gate('PICTURE', 'UNKNOWN', 'TIMELINE_HAS_NO_CLIPS', 'Thêm clip vào timeline và tạo checkpoint mới trước khi release.', pictureEvidence)
        : timelineProjection.revision.readiness_state === 'READY'
          ? gate('PICTURE', 'PASS', null, null, pictureEvidence, false)
          : gate('PICTURE', 'UNKNOWN', 'TIMELINE_DEPENDENCY_NOT_READY', timelineProjection.revision.next_step ?? 'Kiểm tra materialization, review và rights của các clip đã pin.', pictureEvidence);

    let profile = null;
    if (exact) {
      try { profile = this._mediaProfileRevision(exact.revision.media_profile_revision_id); } catch { profile = null; }
    }
    const technicalEvidence = exact ? {
      media_profile_revision_id: exact.revision.media_profile_revision_id,
      state: profile?.lifecycle_state ?? 'UNKNOWN',
      width: profile ? Number(profile.width) : null,
      height: profile ? Number(profile.height) : null,
      audio_sample_rate: profile ? Number(profile.audio_sample_rate) : null,
    } : {};
    const technicalMedia = !exact || !profile
      ? gate('TECHNICAL_MEDIA', 'UNKNOWN', 'MEDIA_PROFILE_NOT_FOUND', 'Tạo và approve một media profile revision rồi pin nó vào timeline.', technicalEvidence)
      : profile.lifecycle_state === 'REJECTED'
        ? gate('TECHNICAL_MEDIA', 'FAIL', 'MEDIA_PROFILE_REJECTED', 'Tạo một media profile revision hợp lệ và gửi lại review.', technicalEvidence)
        : profile.lifecycle_state !== 'APPROVED' || !Number.isSafeInteger(Number(profile.width)) || Number(profile.width) <= 0 || !Number.isSafeInteger(Number(profile.height)) || Number(profile.height) <= 0
          ? gate('TECHNICAL_MEDIA', 'UNKNOWN', 'MEDIA_PROFILE_NOT_APPROVED', 'Approve media profile revision chính xác đang được timeline pin.', technicalEvidence)
          : gate('TECHNICAL_MEDIA', 'PASS', null, null, technicalEvidence, false);

    const assetRefs = new Map();
    for (const track of timelineProjection?.revision?.tracks ?? []) {
      for (const clip of track.clips ?? []) {
        if (clip.asset_revision_id) assetRefs.set(clip.asset_revision_id, clip.asset_revision_id);
      }
    }
    const assetEvidence = [];
    const rightsStatuses = [];
    const materializationStates = [];
    for (const assetRevisionId of [...assetRefs.values()].sort()) {
      const asset = this.db.prepare(`SELECT r.id, r.asset_id, r.availability_state, r.review_state,
          r.availability_evidence_state, a.lifecycle_state AS asset_lifecycle_state,
          so.storage_class, sol.state AS location_state
        FROM asset_revisions r JOIN assets a ON a.id = r.asset_id
        LEFT JOIN storage_objects so ON so.id = r.storage_object_id
        LEFT JOIN storage_object_locations sol ON sol.id = (
          SELECT location.id FROM storage_object_locations location
          WHERE location.storage_object_id = r.storage_object_id AND location.location_role = 'PRIMARY'
          ORDER BY CASE WHEN location.state = 'AVAILABLE' THEN 0 ELSE 1 END, location.id ASC LIMIT 1
        ) WHERE r.id = ?`).get(assetRevisionId);
      let rights = { status: 'UNKNOWN', eligible: false };
      if (asset) {
        try { rights = this._rightsForAsset(asset.asset_id, { purpose: 'RELEASE' }); } catch { rights = { status: 'UNKNOWN', eligible: false }; }
      }
      const status = String(rights.status ?? 'UNKNOWN').toUpperCase();
      rightsStatuses.push(status);
      const materialized = Boolean(asset
        && asset.asset_lifecycle_state !== 'TRASHED'
        && asset.availability_state === 'AVAILABLE'
        && asset.review_state === 'APPROVED'
        && asset.availability_evidence_state === 'VERIFIED'
        && asset.storage_class !== 'EXTERNAL_REFERENCE'
        && asset.location_state === 'AVAILABLE');
      const materializationState = !asset ? 'UNKNOWN' : materialized ? 'READY' : String(asset.availability_state ?? 'UNKNOWN').toUpperCase();
      materializationStates.push(materializationState);
      assetEvidence.push({
        asset_revision_id: assetRevisionId,
        availability_state: asset?.availability_state ?? 'UNKNOWN',
        availability_evidence_state: asset?.availability_evidence_state ?? 'UNKNOWN',
        review_state: asset?.review_state ?? 'UNKNOWN',
        asset_lifecycle_state: asset?.asset_lifecycle_state ?? 'UNKNOWN',
        storage_class: asset?.storage_class ?? 'UNKNOWN',
        location_state: asset?.location_state ?? 'UNKNOWN',
        rights_status: status,
      });
    }
    const missingMediaEvidence = { asset_count: assetEvidence.length, assets: assetEvidence.map((item) => ({
      asset_revision_id: item.asset_revision_id,
      availability_state: item.availability_state,
      availability_evidence_state: item.availability_evidence_state,
      review_state: item.review_state,
      location_state: item.location_state,
    })) };
    const missingMedia = exact && timelineProjectionError
      ? gate('MISSING_MEDIA', 'UNKNOWN', 'TIMELINE_PROJECTION_UNAVAILABLE', 'Sửa dependency của timeline revision rồi refresh readiness.', { asset_count: 0, projection_error: timelineProjectionError })
      : assetEvidence.length === 0
      ? gate('MISSING_MEDIA', exact ? 'NOT_APPLICABLE' : 'UNKNOWN', exact ? 'NO_REFERENCED_MEDIA' : 'NO_APPROVED_TIMELINE', exact ? null : 'Approve a timeline before checking referenced media.', missingMediaEvidence, false)
      : assetEvidence.some((item) => ['MISSING', 'CORRUPT', 'QUARANTINED'].includes(String(item.availability_state).toUpperCase()) || item.asset_lifecycle_state === 'TRASHED')
        ? gate('MISSING_MEDIA', 'FAIL', 'MEDIA_MISSING_OR_UNUSABLE', 'Materialize hoặc khôi phục asset revision bị thiếu trước khi release.', missingMediaEvidence)
        : materializationStates.every((state) => state === 'READY')
          ? gate('MISSING_MEDIA', 'PASS', null, null, missingMediaEvidence, false)
          : gate('MISSING_MEDIA', 'UNKNOWN', 'MEDIA_EVIDENCE_INCOMPLETE', 'Verify materialization và review của mọi asset revision đã pin.', missingMediaEvidence);
    const rightsEvidence = { asset_count: assetEvidence.length, assets: assetEvidence.map((item) => ({ asset_revision_id: item.asset_revision_id, rights_status: item.rights_status })) };
    const rights = exact && timelineProjectionError
      ? gate('RIGHTS', 'UNKNOWN', 'TIMELINE_PROJECTION_UNAVAILABLE', 'Sửa dependency của timeline revision rồi refresh readiness.', { asset_count: 0, projection_error: timelineProjectionError })
      : assetEvidence.length === 0
      ? gate('RIGHTS', exact ? 'NOT_APPLICABLE' : 'UNKNOWN', exact ? 'NO_REFERENCED_MEDIA' : 'NO_APPROVED_TIMELINE', exact ? null : 'Approve a timeline trước khi kiểm tra rights cho release.', rightsEvidence, false)
      : rightsStatuses.some((status) => ['REVOKED', 'EXPIRED', 'RESTRICTED'].includes(status))
        ? gate('RIGHTS', 'FAIL', 'RIGHTS_RESTRICTED_OR_REVOKED', 'Bổ sung rights/consent hợp lệ hoặc thay asset bị hạn chế trước khi release.', rightsEvidence)
        : rightsStatuses.every((status) => status === 'ALLOWED')
          ? gate('RIGHTS', 'PASS', null, null, rightsEvidence, false)
          : gate('RIGHTS', 'UNKNOWN', 'RIGHTS_NOT_VERIFIED', 'Ghi nhận rights và consent cho mọi asset trước khi release.', rightsEvidence);

    const audioRows = exact ? this.db.prepare(`SELECT r.*, c.project_id, c.timeline_id, c.cue_type
      FROM audio_cue_revisions r JOIN audio_cues c ON c.id = r.audio_cue_id
      WHERE c.project_id = ? AND c.timeline_id = ? AND r.timeline_revision_id = ?
      ORDER BY r.id ASC`).all(project.id, exact.timeline.id, exact.revision.id) : [];
    const audioItems = audioRows.map((row) => {
      const stale = this._timingRevisionStaleness(row).stale;
      const assetGate = this._audioCueAssetGate(row);
      return { id: row.id, state: String(row.lifecycle_state ?? 'UNKNOWN').toUpperCase(), stale, asset_state: assetGate.state, rights_status: assetGate.rights_status ?? null };
    });
    const audioEvidence = { cue_count: audioItems.length, cues: audioItems };
    const audio = exact && timelineProjectionError
      ? gate('AUDIO', 'UNKNOWN', 'TIMELINE_PROJECTION_UNAVAILABLE', 'Sửa dependency của timeline revision rồi refresh readiness.', { cue_count: 0, projection_error: timelineProjectionError })
      : audioItems.length === 0
      ? gate('AUDIO', exact ? 'NOT_APPLICABLE' : 'UNKNOWN', exact ? 'NO_AUDIO_CUES' : 'NO_APPROVED_TIMELINE', exact ? null : 'Approve a timeline trước khi kiểm tra audio.', audioEvidence, false)
      : audioItems.some((item) => item.stale || item.state === 'REJECTED' || item.asset_state === 'BLOCKED' && ['RESTRICTED', 'REVOKED', 'EXPIRED'].includes(String(item.rights_status ?? '').toUpperCase()))
        ? gate('AUDIO', 'FAIL', 'AUDIO_TIMING_OR_RIGHTS_INVALID', 'Sửa timing/audio rights bị stale hoặc bị chặn rồi tạo revision mới.', audioEvidence)
        : audioItems.every((item) => item.state === 'SELECTED' && (item.asset_state === 'READY' || item.asset_state === 'NOT_APPLICABLE'))
          ? gate('AUDIO', 'PASS', null, null, audioEvidence, false)
          : gate('AUDIO', 'UNKNOWN', 'AUDIO_NOT_SELECTED_OR_NOT_VERIFIED', 'Hoàn tất chọn audio cue và verify asset gate; render/mix vẫn là bước riêng.', audioEvidence);

    const subtitleRows = exact ? this.db.prepare(`SELECT r.*, t.project_id, t.timeline_id, t.locale
      FROM subtitle_track_revisions r JOIN subtitle_tracks t ON t.id = r.subtitle_track_id
      WHERE t.project_id = ? AND t.timeline_id = ? AND r.timeline_revision_id = ?
      ORDER BY r.id ASC`).all(project.id, exact.timeline.id, exact.revision.id) : [];
    const subtitleItems = subtitleRows.map((row) => ({
      id: row.id,
      locale: row.locale,
      state: String(row.lifecycle_state ?? 'UNKNOWN').toUpperCase(),
      stale: this._timingRevisionStaleness(row).stale,
      segment_count: Number(this.db.prepare('SELECT COUNT(*) AS count FROM subtitle_track_segments WHERE subtitle_track_revision_id = ?').get(row.id).count),
    }));
    const localizationEvidence = { track_count: subtitleItems.length, tracks: subtitleItems };
    const localization = exact && timelineProjectionError
      ? gate('LOCALIZATION', 'UNKNOWN', 'TIMELINE_PROJECTION_UNAVAILABLE', 'Sửa dependency của timeline revision rồi refresh readiness.', { track_count: 0, projection_error: timelineProjectionError })
      : subtitleItems.length === 0
      ? gate('LOCALIZATION', exact ? 'NOT_APPLICABLE' : 'UNKNOWN', exact ? 'NO_SUBTITLE_TRACKS' : 'NO_APPROVED_TIMELINE', exact ? null : 'Approve a timeline trước khi kiểm tra localization.', localizationEvidence, false)
      : subtitleItems.some((item) => item.stale || item.state === 'REJECTED' || item.segment_count === 0)
        ? gate('LOCALIZATION', 'FAIL', 'SUBTITLE_EVIDENCE_INVALID', 'Sửa subtitle track bị stale/rỗng/rejected và tạo revision mới.', localizationEvidence)
        : subtitleItems.every((item) => ['REVIEWED', 'APPROVED'].includes(item.state))
          ? gate('LOCALIZATION', 'PASS', null, null, localizationEvidence, false)
          : gate('LOCALIZATION', 'UNKNOWN', 'SUBTITLE_NOT_REVIEWED', 'Review subtitle track cho từng locale trước khi release.', localizationEvidence);

    let qc = gate('QC', 'UNKNOWN', exact ? 'NO_APPROVED_REVIEW' : 'NO_APPROVED_TIMELINE', exact ? 'Mở và submit review APPROVE cho đúng timeline revision.' : 'Approve a timeline trước khi mở review.', {});
    if (exact && !timelineProjectionError) {
      let currentSnapshot;
      try {
        currentSnapshot = this._reviewSnapshot(exact.revision);
      } catch (error) {
        currentSnapshot = null;
        qc = gate('QC', 'UNKNOWN', 'QC_SNAPSHOT_UNAVAILABLE', 'Sửa dependency của timeline revision rồi refresh readiness.', { projection_error: error?.code ?? 'QC_SNAPSHOT_UNAVAILABLE' });
      }
      if (!currentSnapshot) {
        // Keep the fail-closed UNKNOWN result above; no review row may be
        // promoted to PASS without a current dependency snapshot.
      } else {
      const rows = this.db.prepare(`SELECT s.*, h.decision, h.id AS human_review_id
        FROM review_sessions s LEFT JOIN human_reviews h ON h.review_session_id = s.id
        WHERE s.project_id = ? AND s.subject_type = 'TIMELINE_REVISION' AND s.subject_revision_id = ?
        ORDER BY s.id ASC`).all(project.id, exact.revision.id);
      const reviews = rows.map((row) => ({ review_session_id: row.id, state: row.state, decision: row.decision ?? null, stale: row.dependency_snapshot_hash !== currentSnapshot.hash || row.subject_content_hash !== exact.revision.content_hash }));
      const qcEvidence = { review_count: reviews.length, reviews };
      const validApprovals = reviews.filter((row) => row.state === 'SUBMITTED' && row.decision === 'APPROVE' && !row.stale);
      // Return the exact review that actually supports approval.  A stale or
      // superseded review may coexist with the current one and must never be
      // selected merely because it is the only/last row.
      exactRefs.review_session_id = validApprovals.length === 1 ? validApprovals[0].review_session_id : null;
      const rejected = reviews.some((row) => row.state === 'SUBMITTED' && ['REJECT', 'REPAIR', 'ABSTAIN'].includes(String(row.decision ?? '').toUpperCase()) && !row.stale);
      qc = reviews.length === 0
        ? gate('QC', 'UNKNOWN', 'NO_APPROVED_REVIEW', 'Mở và submit review APPROVE cho đúng timeline revision.', qcEvidence)
        : rejected
          ? gate('QC', 'FAIL', 'QC_REJECTED', 'Xử lý quyết định QC và tạo review mới trên evidence hiện tại.', qcEvidence)
          : validApprovals.length === 1
            ? gate('QC', 'PASS', null, null, qcEvidence, false)
            : reviews.some((row) => row.stale)
              ? gate('QC', 'FAIL', 'QC_REVIEW_STALE', 'Mở lại review trên timeline revision hiện tại; review stale không đủ điều kiện.', qcEvidence)
              : gate('QC', 'UNKNOWN', 'QC_NOT_SUBMITTED', 'Submit review APPROVE sau khi đã kiểm tra đúng checkpoint.', qcEvidence);
      }
    }

    const decisions = this._decisions({ project_id: project.id, state: 'OPEN', limit: 200 });
    const decisionEvidence = { count: decisions.length, items: decisions.map((item) => ({ id: item.id, title: item.title, severity: item.severity, blocking_scope_type: item.blocking_scope_type })) };
    const unresolvedDecisions = decisions.length > 0
      ? gate('UNRESOLVED_DECISIONS', 'FAIL', 'OPEN_DECISIONS', 'Xử lý mọi quyết định đang mở trong Needs You trước khi release.', decisionEvidence)
      : gate('UNRESOLVED_DECISIONS', 'PASS', null, null, decisionEvidence, false);

    const gates = [picture, audio, localization, technicalMedia, qc, rights, missingMedia, unresolvedDecisions];
    const blocking = gates.filter((item) => item.blocking);
    const unknownCount = gates.filter((item) => item.state === 'UNKNOWN').length;
    const overallState = blocking.some((item) => item.state === 'FAIL') ? 'BLOCKED' : blocking.length > 0 ? 'NOT_CHECKED' : 'READY';
    const digestEvidence = {
      project_id: project.id,
      exact_source: exactRefs,
      gates: gates.map((item) => ({ key: item.key, state: item.state, blocking: item.blocking, reason: item.reason, evidence: item.evidence })),
    };
    const gateManifestHash = crypto.createHash('sha256').update(canonicalJson(digestEvidence), 'utf8').digest('hex');
    return {
      project_id: project.id,
      project_title: project.title,
      overall_state: overallState,
      policy: { purpose: 'RELEASE', unknown_blocks: true },
      exact_source: exactRefs,
      gates,
      blocking_gate_keys: blocking.map((item) => item.key),
      blocking_count: blocking.length,
      unknown_count: unknownCount,
      gate_manifest_hash: gateManifestHash,
      next_step: overallState === 'READY' ? 'Readiness gates đã pass ở mức metadata hiện có; tạo release candidate/render là bước riêng.' : blocking[0]?.next_step ?? 'Refresh projection sau khi đã xử lý blocker.',
      projection_seq: this._projectionSeq(),
      generated_at: now,
    };
  }

  _releaseCandidateRow(id) {
    const candidateId = requiredString(id, 'release_candidate_id');
    const row = this.db.prepare('SELECT * FROM release_candidates WHERE id = ?').get(candidateId);
    if (!row) throw new CoreError('RELEASE_CANDIDATE_NOT_FOUND', 'VALIDATION', 'errors.release_candidate_not_found', { release_candidate_id: candidateId });
    return row;
  }

  _releaseCandidateSnapshot(readiness) {
    const exactSource = readiness?.exact_source && typeof readiness.exact_source === 'object'
      ? Object.fromEntries(['timeline_id', 'timeline_revision_id', 'timeline_content_hash', 'media_profile_revision_id', 'review_session_id']
        .map((key) => [key, readiness.exact_source[key] ?? null]))
      : {};
    const gates = Array.isArray(readiness?.gates) ? readiness.gates.map((gate) => ({
      key: String(gate?.key ?? '').toUpperCase(),
      state: String(gate?.state ?? 'UNKNOWN').toUpperCase(),
      blocking: gate?.blocking === true,
      reason: safeReleaseCandidateText(gate?.reason) ?? null,
      next_step: safeReleaseCandidateText(gate?.next_step) ?? null,
      evidence: safeReleaseCandidateEvidence(gate?.evidence ?? {}),
    })).filter((gate) => gate.key && gate.state) : [];
    return {
      snapshot_schema_version: RELEASE_CANDIDATE_SNAPSHOT_SCHEMA_VERSION,
      project_id: readiness.project_id,
      exact_source: exactSource,
      policy: { purpose: 'RELEASE', unknown_blocks: true },
      gates,
      gate_manifest_hash: String(readiness.gate_manifest_hash ?? '').toLowerCase(),
    };
  }

  _releaseCandidateSubtitleManifest(readiness) {
    const localization = Array.isArray(readiness?.gates) ? readiness.gates.find((gate) => gate?.key === 'LOCALIZATION') : null;
    const sourceTracks = Array.isArray(localization?.evidence?.tracks) ? localization.evidence.tracks : [];
    const tracks = sourceTracks.slice(0, 200).map((track) => ({
      id: typeof track?.id === 'string' ? track.id : null,
      locale: typeof track?.locale === 'string' ? track.locale.slice(0, 32) : null,
      state: typeof track?.state === 'string' ? track.state.slice(0, 32).toUpperCase() : 'UNKNOWN',
      stale: track?.stale === true,
      segment_count: Number.isSafeInteger(Number(track?.segment_count)) && Number(track.segment_count) >= 0 ? Number(track.segment_count) : 0,
    })).filter((track) => track.id);
    return { schema_version: 1, track_count: sourceTracks.length, truncated: sourceTracks.length > tracks.length, tracks };
  }

  _createReleaseCandidateDraft(payload, commandId) {
    const projectId = requiredString(payload.project_id ?? payload.projectId, 'project_id');
    const project = this._project(projectId);
    this._assertPayloadProjectScope(payload, project.id, 'PROJECT', project.id);
    this._assertProjectWritable(project);
    const readiness = this._releaseReadiness(project.id);
    if (readiness.overall_state !== 'READY') {
      throw new CoreError('RELEASE_READINESS_BLOCKED', 'CONFLICT', 'errors.release_readiness_blocked', {
        project_id: project.id,
        blocking_gate_keys: Array.isArray(readiness.blocking_gate_keys) ? readiness.blocking_gate_keys.slice(0, 8) : [],
      }, {
        needsUser: true,
        technicalDetails: {
          overall_state: readiness.overall_state,
          gate_manifest_hash: readiness.gate_manifest_hash,
          blocking_gate_keys: Array.isArray(readiness.blocking_gate_keys) ? readiness.blocking_gate_keys.slice(0, 8) : [],
        },
      });
    }
    const exact = readiness.exact_source ?? {};
    const timelineRevisionId = requiredString(exact.timeline_revision_id, 'timeline_revision_id');
    const mediaProfileRevisionId = requiredString(exact.media_profile_revision_id, 'media_profile_revision_id');
    const reviewSessionId = requiredString(exact.review_session_id, 'review_session_id');
    const revision = this._timelineRevision(timelineRevisionId);
    if (revision.project_id !== project.id || revision.lifecycle_state !== 'APPROVED' || revision.media_profile_revision_id !== mediaProfileRevisionId) {
      throw new CoreError('RELEASE_READINESS_BLOCKED', 'CONFLICT', 'errors.release_readiness_blocked', { project_id: project.id }, { needsUser: true });
    }
    const profile = this._mediaProfileRevision(mediaProfileRevisionId);
    if (profile.project_id !== project.id || profile.lifecycle_state !== 'APPROVED') {
      throw new CoreError('RELEASE_READINESS_BLOCKED', 'CONFLICT', 'errors.release_readiness_blocked', { project_id: project.id }, { needsUser: true });
    }
    const review = this._reviewSession(reviewSessionId);
    if (review.project_id !== project.id || review.subject_revision_id !== timelineRevisionId || review.state !== 'SUBMITTED') {
      throw new CoreError('RELEASE_READINESS_BLOCKED', 'CONFLICT', 'errors.release_readiness_blocked', { project_id: project.id }, { needsUser: true });
    }
    const humanReview = this.db.prepare('SELECT decision FROM human_reviews WHERE review_session_id = ?').get(reviewSessionId);
    if (humanReview?.decision !== 'APPROVE') {
      throw new CoreError('RELEASE_READINESS_BLOCKED', 'CONFLICT', 'errors.release_readiness_blocked', { project_id: project.id }, { needsUser: true });
    }
    const readinessDigest = String(readiness.gate_manifest_hash ?? '').toLowerCase();
    if (!SHA256_HEX.test(readinessDigest)) {
      throw new CoreError('RELEASE_READINESS_BLOCKED', 'CONFLICT', 'errors.release_readiness_blocked', { project_id: project.id }, { needsUser: true });
    }
    const duplicate = this.db.prepare(`SELECT * FROM release_candidates
      WHERE project_id = ? AND timeline_revision_id = ? AND readiness_digest = ? LIMIT 1`)
      .get(project.id, timelineRevisionId, readinessDigest);
    if (duplicate) {
      throw new CoreError('RELEASE_CANDIDATE_ALREADY_EXISTS', 'CONFLICT', 'errors.release_candidate_already_exists', {
        release_candidate_id: duplicate.id,
      }, { needsUser: true, technicalDetails: { release_candidate_id: duplicate.id, state: duplicate.state } });
    }
    const snapshot = this._releaseCandidateSnapshot(readiness);
    const rightsSnapshotHash = this._releaseRightsSnapshotHash(project.id, readiness);
    const subtitleManifest = this._releaseCandidateSubtitleManifest(readiness);
    const candidateId = uuidv7();
    const created = nowUtcUs();
    const nextStep = 'Draft đã lưu metadata exact; mastering, export và publish cần contract riêng.';
    try {
      this.db.prepare(`INSERT INTO release_candidates
        (id, project_id, timeline_revision_id, audio_master_asset_revision_id, subtitle_manifest_json,
         media_profile_revision_id, review_session_id, readiness_digest, rights_snapshot_hash,
         readiness_snapshot_json, readiness_snapshot_schema_version, state, next_step, row_version,
         command_id, created_by_actor_id, created_at_utc_us, updated_at_utc_us)
        VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, 1, ?, ?, ?, ?)`)
        .run(candidateId, project.id, timelineRevisionId, canonicalJson(subtitleManifest), mediaProfileRevisionId,
          reviewSessionId, readinessDigest, rightsSnapshotHash, canonicalJson(snapshot), RELEASE_CANDIDATE_SNAPSHOT_SCHEMA_VERSION,
          nextStep, commandId, this.actorId, created, created);
    } catch (error) {
      if (String(error?.message ?? error).includes('release_candidates.project_id')
        || String(error?.message ?? error).includes('release_candidates_exact_uq')) {
        const duplicate = this.db.prepare(`SELECT * FROM release_candidates
          WHERE project_id = ? AND timeline_revision_id = ? AND readiness_digest = ? LIMIT 1`)
          .get(project.id, timelineRevisionId, readinessDigest);
        if (duplicate) {
          throw new CoreError('RELEASE_CANDIDATE_ALREADY_EXISTS', 'CONFLICT', 'errors.release_candidate_already_exists', {
            release_candidate_id: duplicate.id,
          }, { needsUser: true, technicalDetails: { release_candidate_id: duplicate.id, state: duplicate.state } });
        }
      }
      throw error;
    }
    const row = this._releaseCandidateRow(candidateId);
    const result = publicReleaseCandidate(row);
    return {
      projectId: project.id,
      result,
      event: {
        aggregateType: 'RELEASE_CANDIDATE', aggregateId: candidateId, aggregateVersion: 1,
        eventType: 'RELEASE_CANDIDATE_DRAFT_CREATED',
        payload: {
          release_candidate_id: candidateId, project_id: project.id, state: 'DRAFT',
          timeline_revision_id: timelineRevisionId, media_profile_revision_id: mediaProfileRevisionId,
          review_session_id: reviewSessionId, readiness_digest: readinessDigest, rights_snapshot_hash: rightsSnapshotHash,
        },
      },
      audit: {
        actionType: 'release.candidate.create', targetType: 'RELEASE_CANDIDATE', targetId: candidateId,
        payload: {
          project_id: project.id, state: 'DRAFT', timeline_revision_id: timelineRevisionId,
          media_profile_revision_id: mediaProfileRevisionId, review_session_id: reviewSessionId,
          readiness_digest: readinessDigest, rights_snapshot_hash: rightsSnapshotHash,
        },
      },
    };
  }

  _cancelReleaseCandidateDraft(payload, expectedVersions) {
    const requestedProjectId = requiredString(payload.project_id ?? payload.projectId, 'project_id');
    const project = this._project(requestedProjectId);
    const candidateId = requiredString(payload.release_candidate_id ?? payload.releaseCandidateId ?? payload.candidate_id ?? payload.candidateId ?? payload.id, 'release_candidate_id');
    const current = this._releaseCandidateRow(candidateId);
    this._assertPayloadProjectScope(payload, current.project_id, 'RELEASE_CANDIDATE', current.id);
    if (project.id !== current.project_id) {
      throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', {
        entity_type: 'RELEASE_CANDIDATE', entity_id: current.id, project_id: project.id, actual_project_id: current.project_id,
      }, { needsUser: true });
    }
    this._assertProjectWritable(project);
    this._expectedVersion(expectedVersions, 'RELEASE_CANDIDATE', current.id, current.row_version);
    if (current.state !== 'DRAFT') {
      throw new CoreError('RELEASE_CANDIDATE_NOT_CANCELLABLE', 'CONFLICT', 'errors.release_candidate_not_cancellable', {
        release_candidate_id: current.id, state: current.state,
      }, { needsUser: true });
    }
    const updated = nowUtcUs();
    const nextVersion = Number(current.row_version) + 1;
    this.db.prepare(`UPDATE release_candidates SET state = 'CANCELLED', row_version = ?, cancelled_at_utc_us = ?,
      updated_at_utc_us = ?, next_step = ? WHERE id = ?`).run(
      nextVersion, updated, updated, 'Draft đã bị huỷ; tạo candidate mới cần readiness digest khác.', current.id,
    );
    const row = this._releaseCandidateRow(current.id);
    const result = publicReleaseCandidate(row);
    return {
      projectId: project.id,
      result,
      event: {
        aggregateType: 'RELEASE_CANDIDATE', aggregateId: current.id, aggregateVersion: nextVersion,
        eventType: 'RELEASE_CANDIDATE_CANCELLED',
        payload: { release_candidate_id: current.id, project_id: project.id, state: 'CANCELLED', row_version: nextVersion },
      },
      audit: {
        actionType: 'release.candidate.cancel', targetType: 'RELEASE_CANDIDATE', targetId: current.id,
        payload: { project_id: project.id, state: 'CANCELLED', row_version: nextVersion },
      },
    };
  }

  _releaseCandidateList(params = {}) {
    const projectId = requiredString(params.project_id ?? params.projectId, 'project_id');
    this._project(projectId);
    const stateInput = params.state ?? null;
    const state = stateInput === null || stateInput === '' ? null : String(stateInput).trim().toUpperCase();
    if (state !== null && !RELEASE_CANDIDATE_STATES.has(state)) {
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_release_candidate_state', { state });
    }
    const limit = Math.min(Math.max(asInt(params.limit, 100), 1), 200);
    const rows = this.db.prepare(`SELECT * FROM release_candidates
      WHERE project_id = ? AND (? IS NULL OR state = ?)
      ORDER BY created_at_utc_us DESC, id DESC LIMIT ?`).all(projectId, state, state, limit);
    return { items: rows.map(publicReleaseCandidate), projection_seq: this._projectionSeq(), generated_at: new Date().toISOString() };
  }

  _releaseCandidateGet(id, requestedProjectId) {
    const projectId = requiredString(requestedProjectId, 'project_id');
    this._project(projectId);
    const row = this._releaseCandidateRow(id);
    if (projectId !== row.project_id) {
      throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', {
        entity_type: 'RELEASE_CANDIDATE', entity_id: row.id, project_id: projectId, actual_project_id: row.project_id,
      }, { needsUser: true });
    }
    return { candidate: publicReleaseCandidate(row), projection_seq: this._projectionSeq(), generated_at: new Date().toISOString() };
  }

  _releaseBuildPlanRow(id) {
    const planId = requiredString(id, 'release_build_plan_id');
    const row = this.db.prepare('SELECT * FROM release_build_plans WHERE id = ?').get(planId);
    if (!row) throw new CoreError('RELEASE_BUILD_PLAN_NOT_FOUND', 'VALIDATION', 'errors.release_build_plan_not_found', { release_build_plan_id: planId });
    return row;
  }

  _releaseRightsSnapshotHash(projectId, readiness) {
    const rightsGate = Array.isArray(readiness?.gates) ? readiness.gates.find((gate) => gate?.key === 'RIGHTS') : null;
    return crypto.createHash('sha256').update(canonicalJson({
      project_id: projectId,
      exact_source: readiness?.exact_source ?? {},
      rights: {
        state: rightsGate?.state ?? 'UNKNOWN',
        blocking: rightsGate?.blocking !== false,
        reason: rightsGate?.reason ?? null,
        evidence: safeReleaseCandidateEvidence(rightsGate?.evidence ?? {}),
      },
    }), 'utf8').digest('hex');
  }

  _releaseBuildPlanSnapshot(project, candidate, readiness, rightsSnapshotHash) {
    const exactSource = readiness?.exact_source && typeof readiness.exact_source === 'object'
      ? Object.fromEntries(['timeline_id', 'timeline_revision_id', 'timeline_content_hash', 'media_profile_revision_id', 'review_session_id']
        .map((key) => [key, readiness.exact_source[key] ?? null]))
      : {};
    const gateKeys = ['PICTURE', 'AUDIO', 'LOCALIZATION', 'TECHNICAL_MEDIA', 'QC', 'RIGHTS', 'MISSING_MEDIA', 'UNRESOLVED_DECISIONS'];
    const gates = gateKeys.map((key) => {
      const gate = Array.isArray(readiness?.gates) ? readiness.gates.find((item) => item?.key === key) : null;
      return {
        key,
        state: String(gate?.state ?? 'UNKNOWN').toUpperCase(),
        blocking: gate?.blocking === true,
        evidence: safeReleaseCandidateEvidence(gate?.evidence ?? {}),
      };
    });
    let subtitleManifest = {};
    try { subtitleManifest = safeReleaseCandidateEvidence(parseJson(candidate.subtitle_manifest_json, {})) ?? {}; } catch { subtitleManifest = {}; }
    return {
      plan_schema_version: RELEASE_BUILD_PLAN_SNAPSHOT_SCHEMA_VERSION,
      plan_type: 'CINEFORGE_RELEASE_BUILD_PLAN',
      plan_profile: 'LOCAL_MASTER_PREFLIGHT_V1',
      project_id: project.id,
      release_candidate_id: candidate.id,
      exact_source: exactSource,
      readiness_digest: String(readiness.gate_manifest_hash ?? '').toLowerCase(),
      rights_snapshot_hash: rightsSnapshotHash,
      gates,
      subtitle_manifest: subtitleManifest,
      output: { state: 'NOT_CREATED', master_asset_revision_id: null },
    };
  }

  _createReleaseBuildPlan(payload, expectedVersions, commandId) {
    const requestedProjectId = requiredString(payload.project_id ?? payload.projectId, 'project_id');
    const project = this._project(requestedProjectId);
    const candidateId = requiredString(payload.release_candidate_id ?? payload.releaseCandidateId ?? payload.candidate_id ?? payload.candidateId, 'release_candidate_id');
    const candidate = this._releaseCandidateRow(candidateId);
    this._assertPayloadProjectScope(payload, candidate.project_id, 'RELEASE_CANDIDATE', candidate.id);
    if (project.id !== candidate.project_id) {
      throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', {
        entity_type: 'RELEASE_CANDIDATE', entity_id: candidate.id, project_id: project.id, actual_project_id: candidate.project_id,
      }, { needsUser: true });
    }
    this._assertProjectWritable(project);
    this._expectedVersion(expectedVersions, 'RELEASE_CANDIDATE', candidate.id, candidate.row_version);
    if (String(candidate.state).toUpperCase() !== 'DRAFT') {
      throw new CoreError('RELEASE_BUILD_PLAN_CANDIDATE_INVALID', 'CONFLICT', 'errors.release_build_plan_candidate_invalid', {
        release_candidate_id: candidate.id, state: candidate.state,
      }, { needsUser: true });
    }
    if (candidate.audio_master_asset_revision_id !== null && candidate.audio_master_asset_revision_id !== undefined) {
      throw new CoreError('RELEASE_BUILD_PLAN_MASTER_ALREADY_BOUND', 'CONFLICT', 'errors.release_build_plan_master_already_bound', {
        release_candidate_id: candidate.id,
      }, { needsUser: true });
    }
    const readiness = this._releaseReadiness(project.id);
    if (readiness.overall_state !== 'READY') {
      throw new CoreError('RELEASE_BUILD_PLAN_STALE', 'CONFLICT', 'errors.release_build_plan_stale', {
        release_candidate_id: candidate.id,
      }, {
        needsUser: true,
        technicalDetails: {
          overall_state: readiness.overall_state,
          current_readiness_digest: readiness.gate_manifest_hash,
          candidate_readiness_digest: candidate.readiness_digest,
          blocking_gate_keys: Array.isArray(readiness.blocking_gate_keys) ? readiness.blocking_gate_keys.slice(0, 8) : [],
        },
      });
    }
    const exact = readiness.exact_source ?? {};
    const exactFields = [
      ['timeline_revision_id', candidate.timeline_revision_id],
      ['media_profile_revision_id', candidate.media_profile_revision_id],
      ['review_session_id', candidate.review_session_id],
    ];
    for (const [field, candidateValue] of exactFields) {
      if (exact[field] !== candidateValue) {
        throw new CoreError('RELEASE_BUILD_PLAN_STALE', 'CONFLICT', 'errors.release_build_plan_stale', {
          release_candidate_id: candidate.id,
        }, { needsUser: true, technicalDetails: { field, candidate_value: candidateValue, current_value: exact[field] ?? null } });
      }
    }
    const readinessDigest = String(readiness.gate_manifest_hash ?? '').toLowerCase();
    const rightsSnapshotHash = this._releaseRightsSnapshotHash(project.id, readiness);
    if (!SHA256_HEX.test(readinessDigest) || readinessDigest !== String(candidate.readiness_digest).toLowerCase() || rightsSnapshotHash !== String(candidate.rights_snapshot_hash).toLowerCase()) {
      throw new CoreError('RELEASE_BUILD_PLAN_STALE', 'CONFLICT', 'errors.release_build_plan_stale', {
        release_candidate_id: candidate.id,
      }, { needsUser: true, technicalDetails: { current_readiness_digest: readinessDigest, candidate_readiness_digest: candidate.readiness_digest, current_rights_snapshot_hash: rightsSnapshotHash, candidate_rights_snapshot_hash: candidate.rights_snapshot_hash } });
    }
    const existing = this.db.prepare('SELECT * FROM release_build_plans WHERE project_id = ? AND release_candidate_id = ? LIMIT 1').get(project.id, candidate.id);
    if (existing) {
      throw new CoreError('RELEASE_BUILD_PLAN_ALREADY_EXISTS', 'CONFLICT', 'errors.release_build_plan_already_exists', {
        release_build_plan_id: existing.id,
      }, { needsUser: true, technicalDetails: { release_build_plan_id: existing.id, plan_hash: existing.plan_hash } });
    }
    const snapshot = this._releaseBuildPlanSnapshot(project, candidate, readiness, rightsSnapshotHash);
    const planHash = crypto.createHash('sha256').update(canonicalJson(snapshot), 'utf8').digest('hex');
    const planId = uuidv7();
    const created = nowUtcUs();
    const nextStep = 'Plan đã pin exact evidence; cần certified local master renderer trước khi tạo master bytes.';
    try {
      this.db.prepare(`INSERT INTO release_build_plans
        (id, project_id, release_candidate_id, timeline_revision_id, media_profile_revision_id, review_session_id,
         readiness_digest, rights_snapshot_hash, plan_hash, plan_snapshot_json, plan_snapshot_schema_version,
         state, next_step, row_version, command_id, created_by_actor_id, created_at_utc_us, updated_at_utc_us)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PLANNED', ?, 1, ?, ?, ?, ?)`)
        .run(planId, project.id, candidate.id, candidate.timeline_revision_id, candidate.media_profile_revision_id,
          candidate.review_session_id, readinessDigest, rightsSnapshotHash, planHash, canonicalJson(snapshot),
          RELEASE_BUILD_PLAN_SNAPSHOT_SCHEMA_VERSION, nextStep, commandId, this.actorId, created, created);
    } catch (error) {
      if (String(error?.message ?? error).includes('release_build_plans_candidate_uq') || String(error?.message ?? error).includes('release_build_plans.project_id')) {
        const duplicate = this.db.prepare('SELECT * FROM release_build_plans WHERE project_id = ? AND release_candidate_id = ? LIMIT 1').get(project.id, candidate.id);
        if (duplicate) throw new CoreError('RELEASE_BUILD_PLAN_ALREADY_EXISTS', 'CONFLICT', 'errors.release_build_plan_already_exists', { release_build_plan_id: duplicate.id }, { needsUser: true });
      }
      throw error;
    }
    const row = this._releaseBuildPlanRow(planId);
    const result = publicReleaseBuildPlan(row);
    return {
      projectId: project.id,
      result,
      event: {
        aggregateType: 'RELEASE_BUILD_PLAN', aggregateId: planId, aggregateVersion: 1,
        eventType: 'RELEASE_BUILD_PLAN_CREATED',
        payload: {
          release_build_plan_id: planId, project_id: project.id, release_candidate_id: candidate.id,
          timeline_revision_id: candidate.timeline_revision_id, media_profile_revision_id: candidate.media_profile_revision_id,
          review_session_id: candidate.review_session_id, readiness_digest: readinessDigest,
          rights_snapshot_hash: rightsSnapshotHash, plan_hash: planHash, state: 'PLANNED',
        },
      },
      audit: {
        actionType: 'release.build_plan.create', targetType: 'RELEASE_BUILD_PLAN', targetId: planId,
        payload: {
          project_id: project.id, release_candidate_id: candidate.id, timeline_revision_id: candidate.timeline_revision_id,
          media_profile_revision_id: candidate.media_profile_revision_id, review_session_id: candidate.review_session_id,
          readiness_digest: readinessDigest, rights_snapshot_hash: rightsSnapshotHash, plan_hash: planHash, state: 'PLANNED',
        },
      },
    };
  }

  _releaseBuildPlanList(params = {}) {
    const projectId = requiredString(params.project_id ?? params.projectId, 'project_id');
    this._project(projectId);
    const limit = Math.min(Math.max(asInt(params.limit, 100), 1), 200);
    const rows = this.db.prepare(`SELECT * FROM release_build_plans
      WHERE project_id = ? ORDER BY created_at_utc_us DESC, id DESC LIMIT ?`).all(projectId, limit);
    return { items: rows.map(publicReleaseBuildPlan), projection_seq: this._projectionSeq(), generated_at: new Date().toISOString() };
  }

  _releaseBuildPlanGet(id, requestedProjectId) {
    const projectId = requiredString(requestedProjectId, 'project_id');
    this._project(projectId);
    const row = this._releaseBuildPlanRow(id);
    if (projectId !== row.project_id) {
      throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', {
        entity_type: 'RELEASE_BUILD_PLAN', entity_id: row.id, project_id: projectId, actual_project_id: row.project_id,
      }, { needsUser: true });
    }
    return { build_plan: publicReleaseBuildPlan(row), projection_seq: this._projectionSeq(), generated_at: new Date().toISOString() };
  }

  _releaseRendererToolchainPreflight(params = {}) {
    // A query is observational and must not become a local-file probing
    // primitive.  Renderer paths are configured at Core startup only; caller
    // supplied path fields are intentionally ignored.
    const root = this.rendererToolchainRoot;
    const configuredManifest = this.rendererToolchainManifest;
    const result = preflightRendererToolchain({
      rendererToolchainRoot: root,
      rendererToolchainManifest: configuredManifest,
      // Production Core accepts only a canonical manifest file.  The pure
      // function keeps object input for bounded unit fixtures/bootstrap tests,
      // but a live query must never accept a caller-constructed manifest.
      allowObjectManifest: false,
    });
    return {
      ...result,
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
    let ownershipRow = null;
    if (this._ownershipEnabled) {
      try {
        ownershipRow = this.db.prepare(`SELECT o.active_core_instance_id, o.active_epoch, o.fencing_token,
            i.state, i.last_heartbeat_at_utc_us
          FROM core_instance_ownership o
          LEFT JOIN core_instances i ON i.id = o.active_core_instance_id
          WHERE o.singleton_id = 1`).get() ?? null;
      } catch {
        ownershipRow = null;
      }
    }
    const ownershipState = ownershipRow?.state ?? this.ownershipState;
    const ownershipActive = !this._ownershipEnabled || (
      this.mutationEnabled
      && ownershipState === 'ACTIVE_OWNER'
      && ownershipRow?.active_core_instance_id === this.instanceId
      && ownershipRow?.active_epoch === this.instanceEpoch
      && ownershipRow?.fencing_token === this.fencingToken
    );
    if (!ownershipActive) degradedReasons.push('CORE_OWNERSHIP_NOT_ACTIVE');
    return {
      core_version: CORE_VERSION,
      api_version: API_VERSION,
      schema_version: SCHEMA_VERSION,
      status: integrity === 'ok' && journalMode === 'WAL' && foreignKeys === 1 && !storagePressure && ownershipActive ? 'READY' : 'DEGRADED',
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
      core_instance_id: this.instanceId,
      instance_epoch: this.instanceEpoch,
      ownership_state: ownershipState,
      mutation_enabled: ownershipActive,
      last_heartbeat_at: ownershipRow?.last_heartbeat_at_utc_us ? rfc3339FromUs(ownershipRow.last_heartbeat_at_utc_us) : null,
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
      case 'query.release.readiness': return this._releaseReadiness(params.project_id ?? params.projectId);
      case 'query.release.candidate.list': return this._releaseCandidateList(params);
      case 'query.release.candidate.get': return this._releaseCandidateGet(
        params.release_candidate_id ?? params.releaseCandidateId ?? params.candidate_id ?? params.candidateId ?? params.id,
        params.project_id ?? params.projectId,
      );
      case 'query.release.build_plan.list': return this._releaseBuildPlanList(params);
      case 'query.release.build_plan.get': return this._releaseBuildPlanGet(
        params.release_build_plan_id ?? params.releaseBuildPlanId ?? params.build_plan_id ?? params.buildPlanId ?? params.id,
        params.project_id ?? params.projectId,
      );
      case 'query.release.renderer.preflight': return this._releaseRendererToolchainPreflight(params);
      case 'query.media_probe.metadata': return this._mediaProbeMetadata(params);
      case 'query.media_probe.list': return this._mediaProbeList(params);
      case 'query.media_probe.get':
        this._mediaProbeFields(params, ['project_id', 'job_id']);
        return { job: this._mediaProbeProjection(params.job_id, params.project_id),
          projection_seq: this._projectionSeq(), generated_at: new Date().toISOString() };
      case 'query.project.activity': return this._activity(params.project_id ?? params.projectId, params);
      case 'query.task.list': return this._tasks(params.project_id ?? params.projectId);
      case 'query.task.get': {
        const task = this._task(params.task_id ?? params.taskId ?? params.id);
        const projectId = params.project_id ?? params.projectId;
        if (projectId !== undefined && projectId !== null && task.project_id !== projectId) {
          throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', {
            entity_type: 'TASK', entity_id: task.id, project_id: projectId, actual_project_id: task.project_id,
          }, { needsUser: true });
        }
        return publicTask(task);
      }
      case 'query.shot.list': return this._shots(params.project_id ?? params.projectId);
      case 'query.shot.get': {
        const shot = this._shot(params.shot_id ?? params.shotId ?? params.id);
        const projectId = params.project_id ?? params.projectId;
        if (projectId !== undefined && projectId !== null && shot.project_id !== projectId) {
          throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', {
            entity_type: 'SHOT', entity_id: shot.id, project_id: projectId, actual_project_id: shot.project_id,
          }, { needsUser: true });
        }
        return publicShot(shot);
      }
      case 'query.notes.list': return this._notes(params.project_id ?? params.projectId, params);
      case 'query.library.assets':
      case 'query.library.assets_page':
      case 'query.asset.list':
      case 'query.project.assets': return this._assets(params);
      case 'query.jobs.list': return this._jobs(params);
      case 'query.jobs.get': return { job: this._jobProjection(params.job_id ?? params.jobId ?? params.id, params.project_id ?? params.projectId ?? null), projection_seq: this._projectionSeq(), generated_at: new Date().toISOString() };
      case 'query.jobs.retry_plan': return this._jobRetryPlan(params.job_id ?? params.jobId ?? params.id, params.project_id ?? params.projectId ?? null);
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
      case 'query.timeline.working_session.list': return this._timelineWorkingList(params);
      case 'query.timeline.working_session': return this._timelineWorkingPublicProjection(
        params.working_session_id ?? params.workingSessionId ?? params.session_id ?? params.sessionId,
        params.project_id ?? params.projectId ?? null,
        params.timeline_id ?? params.timelineId ?? null,
      );
      case 'query.timeline.edit_history': return this._timelineWorkingEditHistory(params);
      case 'query.audio.timing':
      case 'query.timeline.audio_cue_timing': return this._audioTiming(params);
      case 'query.localization.subtitle_timing':
      case 'query.timeline.subtitle_timing': return this._subtitleTiming(params);
      case 'query.timeline.timing_impact': return this._timingImpact(params);
      case 'query.review.list': return this._reviewList(params);
      case 'query.review.get': {
        const session = this._reviewSession(params.review_session_id ?? params.reviewSessionId ?? params.id);
        const requestedProject = params.project_id ?? params.projectId;
        if (requestedProject !== undefined && requestedProject !== null && requestedProject !== session.project_id) {
          throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', { entity_type: 'REVIEW_SESSION', entity_id: session.id, project_id: requestedProject, actual_project_id: session.project_id }, { needsUser: true });
        }
        return this._reviewProjection(session);
      }
      case 'query.handoff.list': return this._handoffList(params);
      case 'query.handoff.get': return this._handoffGet(params.handoff_id ?? params.handoffId ?? params.export_session_id ?? params.exportSessionId ?? params.id, params.project_id ?? params.projectId ?? null);
      case 'query.export.list': return this._exportList(params);
      case 'query.export.get': return this._exportGet(params.export_session_id ?? params.exportSessionId ?? params.handoff_id ?? params.handoffId ?? params.id, params.project_id ?? params.projectId ?? null);
      case 'query.external_edit.list': return this._externalEditList(params);
      case 'query.external_edit.get': return this._externalEditGet(params.external_edit_id ?? params.externalEditId ?? params.id, params.project_id ?? params.projectId ?? null);
      case 'query.export.download': return this.resolveTimelineInterchangeDownload(params);
      case 'query.asset.rights': return this._rightsForAsset(params.asset_id ?? params.assetId, params);
      case 'query.media.resolve_preview': return this.resolveMediaPreview(params);
      case 'query.rights.evaluate': return this._evaluateRights(params.rights_identity_id ?? params.rightsIdentityId ?? params.identity_id ?? params.identityId, params);
      case 'query.rights.identity': return this._rightsIdentityDetails(params.rights_identity_id ?? params.rightsIdentityId ?? params.identity_id ?? params.identityId, params);
      case 'query.import.session': return this._importSession(params.import_session_id ?? params.importSessionId ?? params.id);
      case 'query.import.list': return this._importSessions(params);
      case 'query.command.get': return this.getCommand(params.command_id ?? params.commandId);
      case 'query.audit.list': return this._audit(params);
      case 'query.entity.history': return this._entityHistory(params);
      case 'query.search': return this._search(params);
      case 'query.storage.summary': return this._storageSummary();
      case 'query.storage.scrub_health': return this._storageScrubHealth(params);
      case 'query.backup.list': return this._backups(params);
      case 'query.backup.get': return this._backupDetails(params.backup_id ?? params.backupId ?? params.id);
      case 'query.backup.restore_estimate': return this._backupRestoreEstimate(params.backup_id ?? params.backupId ?? params.id);
      case 'query.recovery.status': return this._recoveryStatus();
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

  _previewPurpose(value) {
    const purpose = String(value ?? 'LIBRARY_PREVIEW').trim().toUpperCase();
    if (!MEDIA_PREVIEW_PURPOSES.has(purpose)) {
      throw new CoreError('PREVIEW_PURPOSE_UNSUPPORTED', 'VALIDATION', 'errors.preview_purpose_unsupported', { purpose });
    }
    return purpose;
  }

  /**
   * Resolve an exact managed CAS object for inspection.  This function is
   * called at capability issuance and again immediately before every stream,
   * so rights, lifecycle, availability evidence, path safety and content
   * identity cannot become stale behind a previously issued URL.
   */
  _previewDescriptor(projectIdValue, revisionIdValue) {
    const projectId = requiredString(projectIdValue, 'project_id');
    const revisionId = requiredString(revisionIdValue, 'asset_revision_id');
    this._project(projectId);
    const revision = this.db.prepare(`SELECT r.*, a.project_id, a.lifecycle_state AS asset_lifecycle_state,
        a.rights_identity_id, so.hash_algorithm, so.content_hash, so.byte_size, so.storage_class,
        so.verified_at_utc_us, p.source_metadata_json
      FROM asset_revisions r
      JOIN assets a ON a.id = r.asset_id
      JOIN storage_objects so ON so.id = r.storage_object_id
      LEFT JOIN provenance_records p ON p.id = r.provenance_record_id
      WHERE r.id = ?`).get(revisionId);
    if (!revision) throw new CoreError('ASSET_REVISION_NOT_FOUND', 'VALIDATION', 'errors.asset_revision_not_found', { asset_revision_id: revisionId });
    if (revision.project_id !== projectId) {
      throw new CoreError('PREVIEW_PROJECT_SCOPE', 'CONFLICT', 'errors.preview_project_scope', { project_id: projectId, asset_revision_id: revisionId }, { needsUser: true });
    }
    if (revision.asset_lifecycle_state !== 'ACTIVE' || revision.lifecycle_state === 'TRASHED') {
      throw new CoreError('PREVIEW_NOT_READY', 'CONFLICT', 'errors.preview_not_ready', { reason: 'ASSET_INACTIVE' }, { needsUser: true });
    }
    // Preview is an inspection aid and may be used before a human content
    // review.  It still requires verified materialization evidence and never
    // treats an UNKNOWN/REFERENCE object as playable.
    if (revision.availability_state !== 'AVAILABLE' || revision.availability_evidence_state !== 'VERIFIED' || revision.review_state === 'REJECTED') {
      throw new CoreError('PREVIEW_NOT_READY', 'CONFLICT', 'errors.preview_not_ready', { reason: 'AVAILABILITY_UNKNOWN' }, { needsUser: true });
    }
    const expectedByteSize = Number(revision.byte_size);
    if (!Number.isSafeInteger(expectedByteSize) || expectedByteSize < 0) {
      throw new CoreError('PREVIEW_NOT_READY', 'CONFLICT', 'errors.preview_not_ready', { reason: 'INVALID_CONTENT_SIZE' }, { needsUser: true });
    }
    if (revision.storage_class !== 'LOCAL_MANAGED') {
      throw new CoreError('PREVIEW_EXTERNAL_REFERENCE', 'CONFLICT', 'errors.preview_external_reference', {}, { needsUser: true });
    }
    let rights;
    try {
      rights = revision.rights_identity_id
        ? this._evaluateRights(revision.rights_identity_id, {
          right_type: DEFAULT_RIGHT_TYPE,
          consent_type: DEFAULT_CONSENT_TYPE,
          purpose: 'MEDIA_PREVIEW',
        })
        : null;
    } catch {
      rights = null;
    }
    if (!rights?.eligible || rights.status !== 'ALLOWED') {
      throw new CoreError('PREVIEW_RIGHTS_BLOCKED', 'CONFLICT', 'errors.preview_rights_blocked', { status: rights?.status ?? 'UNKNOWN' }, { needsUser: true });
    }

    const storageLocation = this.db.prepare(`SELECT * FROM storage_object_locations
      WHERE storage_object_id = ? AND storage_root = 'asset-store' AND location_role = 'PRIMARY' AND state = 'AVAILABLE'
      ORDER BY created_at_utc_us ASC, id ASC LIMIT 1`).get(revision.storage_object_id);
    if (!storageLocation || typeof storageLocation.relative_path !== 'string' || storageLocation.relative_path.trim() === '') {
      throw new CoreError('PREVIEW_NOT_READY', 'CONFLICT', 'errors.preview_not_ready', { reason: 'MANAGED_LOCATION_UNAVAILABLE' }, { needsUser: true });
    }
    const relativePath = storageLocation.relative_path.replaceAll('\\', '/');
    const segments = relativePath.split('/');
    if (path.isAbsolute(relativePath) || segments.some((segment) => segment === '..' || segment === '')) {
      throw new CoreError('PREVIEW_PATH_ESCAPE', 'INTERNAL', 'errors.preview_path_escape', {}, { needsUser: false });
    }
    const absolute = path.resolve(this.assetStorePath, relativePath);
    if (!pathIsWithin(absolute, this.assetStorePath) || pathKey(absolute) === pathKey(this.assetStorePath)) {
      throw new CoreError('PREVIEW_PATH_ESCAPE', 'INTERNAL', 'errors.preview_path_escape', {}, { needsUser: false });
    }
    try {
      this._assertNoReparsePath(absolute);
      const link = fs.lstatSync(absolute);
      if (link.isSymbolicLink() || !link.isFile() || Number(link.nlink ?? 1) !== 1) {
        throw new CoreError('PREVIEW_NOT_READY', 'CONFLICT', 'errors.preview_not_ready', { reason: 'MANAGED_OBJECT_INVALID' }, { needsUser: true });
      }
      if (Number(link.size) !== expectedByteSize) {
        throw new CoreError('PREVIEW_CONTENT_CHANGED', 'CONFLICT', 'errors.preview_content_changed', {}, { retryable: true, needsUser: true });
      }
    } catch (error) {
      if (error instanceof CoreError && error.code.startsWith('PREVIEW_')) throw error;
      if (error?.code === 'ENOENT') throw new CoreError('PREVIEW_NOT_READY', 'CONFLICT', 'errors.preview_not_ready', { reason: 'MANAGED_OBJECT_MISSING' }, { needsUser: true });
      throw new CoreError('PREVIEW_NOT_READY', 'CONFLICT', 'errors.preview_not_ready', { reason: error?.code === 'SOURCE_REPARSE_REJECTED' ? 'MANAGED_OBJECT_REPARSE' : 'MANAGED_OBJECT_UNREADABLE' }, { needsUser: true });
    }
    let digest;
    try {
      digest = this._hashLocalFile(absolute);
    } catch (error) {
      if (error instanceof CoreError && error.code === 'PREVIEW_CONTENT_CHANGED') throw error;
      throw new CoreError('PREVIEW_NOT_READY', 'CONFLICT', 'errors.preview_not_ready', { reason: 'MANAGED_OBJECT_UNREADABLE' }, { needsUser: true });
    }
    if (String(digest.content_hash).toLowerCase() !== String(revision.content_hash).toLowerCase() || Number(digest.byte_size) !== expectedByteSize) {
      throw new CoreError('PREVIEW_CONTENT_CHANGED', 'CONFLICT', 'errors.preview_content_changed', {}, { retryable: true, needsUser: true });
    }
    const metadata = parseJson(revision.source_metadata_json, {});
    const rawMime = typeof metadata?.detected_mime === 'string' ? metadata.detected_mime : '';
    const mimeType = rawMime.split(';', 1)[0].trim().toLowerCase();
    if (!MEDIA_PREVIEW_MIME_TYPES.has(mimeType)) {
      throw new CoreError('PREVIEW_MIME_UNSUPPORTED', 'VALIDATION', 'errors.preview_mime_unsupported', {}, { needsUser: true });
    }
    return {
      projectId,
      revisionId,
      filePath: absolute,
      mimeType,
      byteSize: expectedByteSize,
      contentHash: String(revision.content_hash).toLowerCase(),
      rightsStatus: rights.status,
      readinessState: revision.review_state === 'APPROVED' ? 'READY' : 'INSPECTION_READY',
    };
  }

  _previewRange(value, byteSize) {
    const raw = value === undefined || value === null ? '' : String(value).trim();
    if (!raw) {
      if (byteSize > MEDIA_PREVIEW_MAX_FULL_BYTES) {
        throw new CoreError('PREVIEW_RANGE_REQUIRED', 'CONFLICT', 'errors.preview_range_required', { max_bytes: MEDIA_PREVIEW_MAX_FULL_BYTES, byte_size: byteSize }, { needsUser: true });
      }
      return { status: 200, start: 0, end: Math.max(byteSize - 1, -1), length: byteSize, contentRange: null };
    }
    const match = /^bytes=(\d*)-(\d*)$/.exec(raw);
    if (!match || (match[1] === '' && match[2] === '') || byteSize === 0) {
      throw new CoreError('PREVIEW_RANGE_INVALID', 'VALIDATION', 'errors.preview_range_invalid', {}, { needsUser: true });
    }
    let start;
    let end;
    if (match[1] === '') {
      const suffix = Number(match[2]);
      if (!Number.isSafeInteger(suffix) || suffix <= 0) throw new CoreError('PREVIEW_RANGE_INVALID', 'VALIDATION', 'errors.preview_range_invalid', {}, { needsUser: true });
      start = Math.max(byteSize - suffix, 0);
      end = byteSize - 1;
    } else {
      start = Number(match[1]);
      end = match[2] === '' ? byteSize - 1 : Number(match[2]);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= byteSize) {
        throw new CoreError('PREVIEW_RANGE_NOT_SATISFIABLE', 'CONFLICT', 'errors.preview_range_not_satisfiable', { byte_size: byteSize }, { needsUser: true });
      }
      end = Math.min(end, byteSize - 1);
    }
    const length = end - start + 1;
    if (!Number.isSafeInteger(length) || length > MEDIA_PREVIEW_MAX_RANGE_BYTES) {
      throw new CoreError('PREVIEW_RANGE_TOO_LARGE', 'CONFLICT', 'errors.preview_range_too_large', { max_bytes: MEDIA_PREVIEW_MAX_RANGE_BYTES }, { needsUser: true });
    }
    return { status: 206, start, end, length, contentRange: `bytes ${start}-${end}/${byteSize}` };
  }

  _cleanPreviewTokens(now = Date.now()) {
    for (const [token, record] of this.previewTokens) {
      if (record.expiresAtMs <= now || record.epoch !== this.previewEpoch) this.previewTokens.delete(token);
    }
  }

  resolveMediaPreview(params = {}) {
    const projectId = requiredString(params.project_id ?? params.projectId, 'project_id');
    const revisionId = requiredString(params.asset_revision_id ?? params.assetRevisionId ?? params.revision_id ?? params.revisionId, 'asset_revision_id');
    const sessionId = requiredString(params.session_id ?? params.sessionId, 'session_id', 256);
    const purpose = this._previewPurpose(params.purpose);
    const descriptor = this._previewDescriptor(projectId, revisionId);
    this._cleanPreviewTokens();
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAtMs = Date.now() + this.previewTokenTtlMs;
    this.previewTokens.set(token, {
      epoch: this.previewEpoch,
      audience: MEDIA_PREVIEW_AUDIENCE,
      nonce: crypto.randomBytes(16).toString('base64url'),
      sessionId,
      projectId,
      revisionId,
      purpose,
      expiresAtMs,
      contentHash: descriptor.contentHash,
      byteSize: descriptor.byteSize,
      mimeType: descriptor.mimeType,
    });
    while (this.previewTokens.size > MEDIA_PREVIEW_MAX_TOKENS) {
      const oldest = this.previewTokens.keys().next().value;
      if (oldest === undefined) break;
      this.previewTokens.delete(oldest);
    }
    return {
      project_id: projectId,
      asset_revision_id: revisionId,
      purpose,
      token,
      expires_at: new Date(expiresAtMs).toISOString(),
      mime_type: descriptor.mimeType,
      byte_size: descriptor.byteSize,
      content_hash: descriptor.contentHash,
      readiness_state: descriptor.readinessState,
      rights_status: descriptor.rightsStatus,
      max_range_bytes: MEDIA_PREVIEW_MAX_RANGE_BYTES,
    };
  }

  openMediaPreview(params = {}) {
    const token = requiredString(params.token ?? params.preview_token ?? params.previewToken, 'preview_token', 512);
    this._cleanPreviewTokens();
    const record = this.previewTokens.get(token);
    if (!record) throw new CoreError('PREVIEW_TOKEN_INVALID', 'AUTH_REQUIRED', 'errors.preview_token_invalid', {}, { needsUser: true });
    if (record.expiresAtMs <= Date.now()) {
      this.previewTokens.delete(token);
      throw new CoreError('PREVIEW_TOKEN_EXPIRED', 'AUTH_REQUIRED', 'errors.preview_token_expired', {}, { needsUser: true });
    }
    const projectId = requiredString(params.project_id ?? params.projectId, 'project_id');
    const revisionId = requiredString(params.asset_revision_id ?? params.assetRevisionId ?? params.revision_id ?? params.revisionId, 'asset_revision_id');
    const purpose = this._previewPurpose(params.purpose ?? record.purpose);
    const sessionId = params.session_id ?? params.sessionId;
    if (record.epoch !== this.previewEpoch || record.audience !== MEDIA_PREVIEW_AUDIENCE || record.projectId !== projectId || record.revisionId !== revisionId || record.purpose !== purpose
      || (sessionId !== undefined && sessionId !== null && String(sessionId) !== record.sessionId)) {
      throw new CoreError('PREVIEW_TOKEN_SCOPE', 'AUTH_REQUIRED', 'errors.preview_token_scope', {}, { needsUser: true });
    }
    const descriptor = this._previewDescriptor(projectId, revisionId);
    if (descriptor.contentHash !== record.contentHash || descriptor.byteSize !== record.byteSize || descriptor.mimeType !== record.mimeType) {
      throw new CoreError('PREVIEW_CONTENT_CHANGED', 'CONFLICT', 'errors.preview_content_changed', {}, { retryable: true, needsUser: true });
    }
    const range = this._previewRange(params.range ?? params.range_header ?? params.rangeHeader, descriptor.byteSize);
    return {
      ...descriptor,
      ...range,
      etag: `\"${descriptor.contentHash}\"`,
      expiresAt: new Date(record.expiresAtMs).toISOString(),
    };
  }

  _timelineInterchangeDownloadDescriptor(projectIdValue, exportSessionIdValue, { openFile = false } = {}) {
    const projectId = requiredString(projectIdValue, 'project_id');
    const exportSessionId = requiredString(exportSessionIdValue, 'export_session_id');
    this._project(projectId);
    const session = this._exportSessionRow(exportSessionId);
    if (session.project_id !== projectId) throw new CoreError('EXPORT_PROJECT_SCOPE', 'CONFLICT', 'errors.export_project_scope', { project_id: projectId, export_session_id: exportSessionId }, { needsUser: true });
    const manifestBinding = session.output_manifest_id
      ? this.db.prepare(`SELECT id FROM handoff_manifests
          WHERE id = ? AND export_session_id = ? AND project_id = ?`).get(session.output_manifest_id, session.id, projectId)
      : null;
    if (session.state !== 'COMPLETED' || !manifestBinding || !session.output_asset_revision_id || !SHA256_HEX.test(String(session.output_content_hash ?? ''))) {
      throw new CoreError('EXPORT_NOT_READY', 'CONFLICT', 'errors.export_not_ready', { export_session_id: exportSessionId }, { needsUser: true });
    }
    const revision = this.db.prepare(`SELECT r.*, a.project_id, a.lifecycle_state AS asset_lifecycle_state, a.asset_type, a.origin_type AS asset_origin_type,
        so.hash_algorithm, so.content_hash, so.byte_size, so.storage_class
      FROM asset_revisions r JOIN assets a ON a.id = r.asset_id
      JOIN storage_objects so ON so.id = r.storage_object_id
      WHERE r.id = ?`).get(session.output_asset_revision_id);
    if (!revision || revision.project_id !== projectId || revision.asset_type !== 'TIMELINE_INTERCHANGE'
      || revision.asset_origin_type !== 'SYSTEM' || revision.semantic_role !== 'TIMELINE_INTERCHANGE'
      || revision.rebuildability !== 'REBUILDABLE'
      || revision.asset_lifecycle_state !== 'ACTIVE' || revision.availability_state !== 'AVAILABLE'
      || revision.availability_evidence_state !== 'VERIFIED' || revision.storage_class !== 'LOCAL_MANAGED'
      || String(revision.content_hash).toLowerCase() !== String(session.output_content_hash).toLowerCase()
      || Number(revision.byte_size) !== Number(session.output_byte_size)) {
      throw new CoreError('EXPORT_NOT_READY', 'CONFLICT', 'errors.export_not_ready', { export_session_id: exportSessionId }, { needsUser: true });
    }
    const byteSize = Number(revision.byte_size);
    if (!Number.isSafeInteger(byteSize) || byteSize < 0 || byteSize > TIMELINE_INTERCHANGE_MAX_BYTES) throw new CoreError('EXPORT_NOT_READY', 'CONFLICT', 'errors.export_not_ready', { export_session_id: exportSessionId }, { needsUser: true });
    const location = this.db.prepare(`SELECT * FROM storage_object_locations WHERE storage_object_id = ? AND storage_root = 'asset-store' AND location_role = 'PRIMARY' AND state = 'AVAILABLE' ORDER BY created_at_utc_us ASC, id ASC LIMIT 1`).get(revision.storage_object_id);
    if (!location || typeof location.relative_path !== 'string' || location.relative_path.trim() === '') throw new CoreError('EXPORT_NOT_READY', 'CONFLICT', 'errors.export_not_ready', { export_session_id: exportSessionId }, { needsUser: true });
    const relativePath = location.relative_path.replaceAll('\\', '/');
    const segments = relativePath.split('/');
    if (path.isAbsolute(relativePath) || segments.some((segment) => segment === '..' || segment === '')) throw new CoreError('EXPORT_PATH_ESCAPE', 'INTERNAL', 'errors.export_path_escape', {}, { needsUser: false });
    const absolute = path.resolve(this.assetStorePath, relativePath);
    if (!pathIsWithin(absolute, this.assetStorePath) || pathKey(absolute) === pathKey(this.assetStorePath)) throw new CoreError('EXPORT_PATH_ESCAPE', 'INTERNAL', 'errors.export_path_escape', {}, { needsUser: false });
    try {
      this._assertNoReparsePath(absolute);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink() || !stat.isFile() || Number(stat.nlink ?? 1) !== 1 || Number(stat.size) !== byteSize) throw new CoreError('EXPORT_OBJECT_TAMPERED', 'CONFLICT', 'errors.export_object_tampered', {}, { needsUser: true });
      const digest = this._hashLocalFile(absolute);
      if (digest.content_hash !== String(revision.content_hash).toLowerCase() || digest.byte_size !== byteSize) throw new CoreError('EXPORT_OBJECT_TAMPERED', 'CONFLICT', 'errors.export_object_tampered', {}, { needsUser: true });
    } catch (error) {
      if (error instanceof CoreError) throw error;
      throw new CoreError('EXPORT_NOT_READY', 'CONFLICT', 'errors.export_not_ready', { export_session_id: exportSessionId }, { needsUser: true });
    }
    let fileDescriptor = null;
    if (openFile) {
      try {
        const noFollow = Number(fs.constants.O_NOFOLLOW ?? 0);
        fileDescriptor = fs.openSync(absolute, fs.constants.O_RDONLY | noFollow);
        const openedStat = fs.fstatSync(fileDescriptor);
        if (!openedStat.isFile() || Number(openedStat.nlink ?? 1) !== 1 || Number(openedStat.size) !== byteSize) {
          throw new CoreError('EXPORT_OBJECT_TAMPERED', 'CONFLICT', 'errors.export_object_tampered', {}, { needsUser: true });
        }
        // Hash the already-open descriptor as the final identity proof.  The
        // HTTP layer consumes this same descriptor, so a path swap after this
        // point cannot change the bytes being streamed (TOCTOU-safe).
        const openedIdentity = this._sourceIdentity(openedStat);
        let pathStat;
        try { pathStat = fs.lstatSync(absolute); } catch { pathStat = null; }
        if (!pathStat || pathStat.isSymbolicLink() || !pathStat.isFile()
          || !this._sameHandleIdentity(openedIdentity, this._sourceIdentity(pathStat))) {
          throw new CoreError('EXPORT_OBJECT_TAMPERED', 'CONFLICT', 'errors.export_object_tampered', {}, { needsUser: true });
        }
        const openedDigest = this._hashDescriptor(fileDescriptor, byteSize, path.basename(absolute));
        const afterOpened = fs.fstatSync(fileDescriptor);
        if (!this._sameSourceIdentity(openedIdentity, this._sourceIdentity(afterOpened))
          || openedDigest.content_hash !== String(revision.content_hash).toLowerCase()
          || openedDigest.byte_size !== byteSize) {
          throw new CoreError('EXPORT_OBJECT_TAMPERED', 'CONFLICT', 'errors.export_object_tampered', {}, { needsUser: true });
        }
      } catch (error) {
        if (fileDescriptor !== null) { try { fs.closeSync(fileDescriptor); } catch { /* preserve original error */ } }
        if (error instanceof CoreError) throw error;
        throw new CoreError('EXPORT_NOT_READY', 'CONFLICT', 'errors.export_not_ready', { export_session_id: exportSessionId }, { needsUser: true });
      }
    }
    return { projectId, exportSessionId, filePath: absolute, fileDescriptor, mimeType: 'application/json', byteSize, contentHash: String(revision.content_hash).toLowerCase() };
  }

  _interchangeDownloadRange(value, byteSize) {
    const raw = value === undefined || value === null ? '' : String(value).trim();
    if (!raw) {
      if (byteSize > TIMELINE_INTERCHANGE_DOWNLOAD_MAX_FULL_BYTES) throw new CoreError('EXPORT_DOWNLOAD_RANGE_REQUIRED', 'CONFLICT', 'errors.export_download_range_required', { max_bytes: TIMELINE_INTERCHANGE_DOWNLOAD_MAX_FULL_BYTES }, { needsUser: true });
      return { status: 200, start: 0, end: Math.max(byteSize - 1, -1), length: byteSize, contentRange: null };
    }
    const match = /^bytes=(\d*)-(\d*)$/.exec(raw);
    if (!match || (match[1] === '' && match[2] === '') || byteSize === 0) throw new CoreError('EXPORT_DOWNLOAD_RANGE_INVALID', 'VALIDATION', 'errors.export_download_range_invalid', {}, { needsUser: true });
    let start; let end;
    if (match[1] === '') {
      const suffix = Number(match[2]);
      if (!Number.isSafeInteger(suffix) || suffix <= 0) throw new CoreError('EXPORT_DOWNLOAD_RANGE_INVALID', 'VALIDATION', 'errors.export_download_range_invalid', {}, { needsUser: true });
      start = Math.max(byteSize - suffix, 0); end = byteSize - 1;
    } else {
      start = Number(match[1]); end = match[2] === '' ? byteSize - 1 : Number(match[2]);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= byteSize) throw new CoreError('EXPORT_DOWNLOAD_RANGE_NOT_SATISFIABLE', 'CONFLICT', 'errors.export_download_range_not_satisfiable', { byte_size: byteSize }, { needsUser: true });
      end = Math.min(end, byteSize - 1);
    }
    const length = end - start + 1;
    if (!Number.isSafeInteger(length) || length > TIMELINE_INTERCHANGE_DOWNLOAD_MAX_RANGE_BYTES) throw new CoreError('EXPORT_DOWNLOAD_RANGE_TOO_LARGE', 'CONFLICT', 'errors.export_download_range_too_large', { max_bytes: TIMELINE_INTERCHANGE_DOWNLOAD_MAX_RANGE_BYTES }, { needsUser: true });
    return { status: 206, start, end, length, contentRange: `bytes ${start}-${end}/${byteSize}` };
  }

  resolveTimelineInterchangeDownload(params = {}) {
    const projectId = requiredString(params.project_id ?? params.projectId, 'project_id');
    const exportSessionId = requiredString(params.export_session_id ?? params.exportSessionId ?? params.id, 'export_session_id');
    const rawSessionId = params.session_id ?? params.sessionId;
    if (typeof rawSessionId !== 'string' || rawSessionId.trim().length === 0) {
      throw new CoreError('EXPORT_DOWNLOAD_SESSION_REQUIRED', 'AUTH_REQUIRED', 'errors.export_download_session_required', {}, { needsUser: true });
    }
    const sessionId = requiredString(rawSessionId, 'session_id', 256);
    const descriptor = this._timelineInterchangeDownloadDescriptor(projectId, exportSessionId);
    this._cleanPreviewTokens();
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAtMs = Date.now() + this.previewTokenTtlMs;
    this.previewTokens.set(token, { epoch: this.previewEpoch, audience: TIMELINE_INTERCHANGE_DOWNLOAD_AUDIENCE, nonce: crypto.randomBytes(16).toString('base64url'), sessionId, projectId, exportSessionId, expiresAtMs, contentHash: descriptor.contentHash, byteSize: descriptor.byteSize });
    while (this.previewTokens.size > MEDIA_PREVIEW_MAX_TOKENS) {
      const oldest = this.previewTokens.keys().next().value;
      if (oldest === undefined) break;
      this.previewTokens.delete(oldest);
    }
    return { project_id: projectId, export_session_id: exportSessionId, token, expires_at: new Date(expiresAtMs).toISOString(), mime_type: descriptor.mimeType, byte_size: descriptor.byteSize, content_hash: descriptor.contentHash, max_range_bytes: TIMELINE_INTERCHANGE_DOWNLOAD_MAX_RANGE_BYTES };
  }

  openTimelineInterchangeDownload(params = {}) {
    const token = requiredString(params.token ?? params.download_token ?? params.downloadToken, 'download_token', 512);
    this._cleanPreviewTokens();
    const record = this.previewTokens.get(token);
    if (!record) throw new CoreError('EXPORT_DOWNLOAD_TOKEN_INVALID', 'AUTH_REQUIRED', 'errors.export_download_token_invalid', {}, { needsUser: true });
    if (record.expiresAtMs <= Date.now()) { this.previewTokens.delete(token); throw new CoreError('EXPORT_DOWNLOAD_TOKEN_EXPIRED', 'AUTH_REQUIRED', 'errors.export_download_token_expired', {}, { needsUser: true }); }
    const projectId = requiredString(params.project_id ?? params.projectId, 'project_id');
    const exportSessionId = requiredString(params.export_session_id ?? params.exportSessionId, 'export_session_id');
    const rawSessionId = params.session_id ?? params.sessionId;
    if (typeof rawSessionId !== 'string' || rawSessionId.trim().length === 0) {
      throw new CoreError('EXPORT_DOWNLOAD_SESSION_REQUIRED', 'AUTH_REQUIRED', 'errors.export_download_session_required', {}, { needsUser: true });
    }
    const sessionId = requiredString(rawSessionId, 'session_id', 256);
    if (record.epoch !== this.previewEpoch || record.audience !== TIMELINE_INTERCHANGE_DOWNLOAD_AUDIENCE || record.projectId !== projectId || record.exportSessionId !== exportSessionId || String(sessionId) !== record.sessionId) throw new CoreError('EXPORT_DOWNLOAD_TOKEN_SCOPE', 'AUTH_REQUIRED', 'errors.export_download_token_scope', {}, { needsUser: true });
    const descriptor = this._timelineInterchangeDownloadDescriptor(projectId, exportSessionId, {
      openFile: Boolean(params.open_file ?? params.openFile),
    });
    try {
      if (descriptor.contentHash !== record.contentHash || descriptor.byteSize !== record.byteSize) throw new CoreError('EXPORT_OBJECT_TAMPERED', 'CONFLICT', 'errors.export_object_tampered', {}, { needsUser: true });
      return { ...descriptor, ...this._interchangeDownloadRange(params.range ?? params.range_header ?? params.rangeHeader, descriptor.byteSize), etag: `"${descriptor.contentHash}"`, expiresAt: new Date(record.expiresAtMs).toISOString() };
    } catch (error) {
      if (descriptor.fileDescriptor !== null) { try { fs.closeSync(descriptor.fileDescriptor); } catch { /* preserve original error */ } }
      throw error;
    }
  }

  verifyTimelineInterchangeDownloadHandle(opened = {}) {
    const descriptor = Number(opened.fileDescriptor);
    const expectedHash = String(opened.contentHash ?? '').toLowerCase();
    const expectedSize = Number(opened.byteSize);
    if (!Number.isInteger(descriptor) || descriptor < 0 || !SHA256_HEX.test(expectedHash)
      || !Number.isSafeInteger(expectedSize) || expectedSize < 0) {
      throw new CoreError('EXPORT_OBJECT_TAMPERED', 'CONFLICT', 'errors.export_object_tampered', {}, { needsUser: true });
    }
    let before;
    try { before = fs.fstatSync(descriptor); } catch {
      throw new CoreError('EXPORT_OBJECT_TAMPERED', 'CONFLICT', 'errors.export_object_tampered', {}, { needsUser: true });
    }
    if (!before.isFile() || Number(before.nlink ?? 1) !== 1 || Number(before.size) !== expectedSize) {
      throw new CoreError('EXPORT_OBJECT_TAMPERED', 'CONFLICT', 'errors.export_object_tampered', {}, { needsUser: true });
    }
    const digest = this._hashDescriptor(descriptor, expectedSize, 'cineforge-timeline-interchange.json');
    let after;
    try { after = fs.fstatSync(descriptor); } catch {
      throw new CoreError('EXPORT_OBJECT_TAMPERED', 'CONFLICT', 'errors.export_object_tampered', {}, { needsUser: true });
    }
    if (!this._sameSourceIdentity(this._sourceIdentity(before), this._sourceIdentity(after))
      || digest.content_hash !== expectedHash || digest.byte_size !== expectedSize) {
      throw new CoreError('EXPORT_OBJECT_TAMPERED', 'CONFLICT', 'errors.export_object_tampered', {}, { needsUser: true });
    }
    return { content_hash: digest.content_hash, byte_size: digest.byte_size };
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

  _jobs(params = {}) {
    const projectId = params.project_id ?? params.projectId ?? null;
    if (projectId) this._project(projectId);
    const requestedState = params.state ?? null;
    const state = requestedState === null || requestedState === undefined || requestedState === '' ? null : String(requestedState).trim().toUpperCase();
    if (state !== null && !LOCAL_PROBE_STATES.has(state)) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field: 'state' });
    const limit = boundedInteger(params.limit ?? 100, 'limit', { min: 1, max: 200 });
    const rows = this.db.prepare(`SELECT * FROM jobs
      WHERE (? IS NULL OR project_id = ?) AND (? IS NULL OR state = ?)
      ORDER BY created_at_utc_us DESC, id DESC LIMIT ?`).all(projectId, projectId, state, state, limit);
    return {
      jobs: rows.map((row) => this._jobProjection(row.id)),
      projection_seq: this._projectionSeq(),
      generated_at: new Date().toISOString(),
    };
  }

  _jobRetryPlan(jobId, projectId = null) {
    const job = this._jobRow(jobId);
    if (projectId !== null && projectId !== undefined && job.project_id !== projectId) {
      throw new CoreError('ENTITY_SCOPE_MISMATCH', 'CONFLICT', 'errors.entity_scope_mismatch', { entity_type: 'JOB', entity_id: job.id, project_id: projectId, actual_project_id: job.project_id }, { needsUser: true });
    }
    const attempt = this.db.prepare('SELECT attempt_no FROM job_attempts WHERE job_id = ? ORDER BY attempt_no DESC LIMIT 1').get(job.id);
    const nextAttempt = Number(attempt?.attempt_no ?? 0) + 1;
    const allowed = job.state === 'FAILED_RETRYABLE' && nextAttempt <= LOCAL_PROBE_MAX_ATTEMPTS;
    return {
      job_id: job.id,
      allowed,
      retry_kind: 'EXACT',
      next_attempt_no: nextAttempt,
      max_attempts: LOCAL_PROBE_MAX_ATTEMPTS,
      reason_code: allowed ? null : job.state !== 'FAILED_RETRYABLE' ? 'JOB_STATE_NOT_RETRYABLE' : 'JOB_RETRY_LIMIT',
      next_step: allowed ? 'Có thể thử lại cùng asset revision đã pin.' : 'Giữ evidence hiện tại hoặc tạo một probe mới cho revision cụ thể.',
      projection_seq: this._projectionSeq(),
      generated_at: new Date().toISOString(),
    };
  }

  _externalEditError(code, messageKey = 'errors.external_edit_schema_invalid', args = {}, options = {}) {
    return new CoreError(code, options.category ?? 'CONFLICT', messageKey, args, {
      needsUser: options.needsUser === undefined ? true : options.needsUser,
      retryable: options.retryable,
      technicalDetails: options.technicalDetails,
    });
  }

  _externalEditManagedDocument(revision) {
    const byteSize = Number(revision.byte_size);
    if (revision.storage_class !== 'LOCAL_MANAGED' || revision.availability_state !== 'AVAILABLE'
      || revision.availability_evidence_state !== 'VERIFIED' || !Number.isSafeInteger(byteSize)
      || byteSize <= 0) {
      throw this._externalEditError('EXTERNAL_EDIT_ASSET_NOT_READY', 'errors.external_edit_asset_not_ready', { asset_revision_id: revision.id });
    }
    if (byteSize > EXTERNAL_EDIT_MAX_BYTES) {
      throw this._externalEditError('EXTERNAL_EDIT_TOO_LARGE', 'errors.external_edit_too_large', { max_bytes: EXTERNAL_EDIT_MAX_BYTES });
    }
    const location = this.db.prepare(`SELECT * FROM storage_object_locations
      WHERE storage_object_id = ? AND storage_root = 'asset-store' AND location_role = 'PRIMARY' AND state = 'AVAILABLE'
      ORDER BY created_at_utc_us ASC, id ASC LIMIT 1`).get(revision.storage_object_id);
    if (!location || typeof location.relative_path !== 'string' || location.relative_path.trim() === '') {
      throw this._externalEditError('EXTERNAL_EDIT_ASSET_NOT_READY', 'errors.external_edit_asset_not_ready', { asset_revision_id: revision.id });
    }
    const relativePath = location.relative_path.replaceAll('\\', '/');
    const segments = relativePath.split('/');
    if (path.isAbsolute(relativePath) || segments.some((segment) => segment === '..' || segment === '')) {
      throw this._externalEditError('EXTERNAL_EDIT_PATH_ESCAPE', 'errors.external_edit_path_escape', {}, { category: 'INTERNAL', needsUser: false });
    }
    const absolute = path.resolve(this.assetStorePath, relativePath);
    if (!pathIsWithin(absolute, this.assetStorePath) || pathKey(absolute) === pathKey(this.assetStorePath)) {
      throw this._externalEditError('EXTERNAL_EDIT_PATH_ESCAPE', 'errors.external_edit_path_escape', {}, { category: 'INTERNAL', needsUser: false });
    }
    let stable;
    try {
      stable = this._openStableSource(absolute);
      if (stable.stat.size !== byteSize || Number(stable.stat.nlink ?? 1) !== 1) {
        throw this._externalEditError('EXTERNAL_EDIT_ASSET_CHANGED', 'errors.external_edit_asset_changed', { asset_revision_id: revision.id }, { retryable: true });
      }
      const digest = this._hashDescriptor(stable.descriptor, byteSize, path.basename(absolute));
      const bytes = Buffer.alloc(byteSize);
      let offset = 0;
      while (offset < byteSize) {
        const read = fs.readSync(stable.descriptor, bytes, offset, byteSize - offset, offset);
        if (read <= 0) throw this._externalEditError('EXTERNAL_EDIT_ASSET_CHANGED', 'errors.external_edit_asset_changed', { asset_revision_id: revision.id }, { retryable: true });
        offset += read;
      }
      const after = fs.fstatSync(stable.descriptor);
      if (!this._sameSourceIdentity(stable.identity, this._sourceIdentity(after))) {
        throw this._externalEditError('EXTERNAL_EDIT_ASSET_CHANGED', 'errors.external_edit_asset_changed', { asset_revision_id: revision.id }, { retryable: true });
      }
      if (digest.content_hash !== String(revision.content_hash).toLowerCase() || digest.byte_size !== byteSize) {
        throw this._externalEditError('EXTERNAL_EDIT_ASSET_CHANGED', 'errors.external_edit_asset_changed', { asset_revision_id: revision.id }, { retryable: true });
      }
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch {
        throw this._externalEditError('EXTERNAL_EDIT_INVALID_UTF8', 'errors.external_edit_invalid_utf8', {});
      }
      return { text, contentHash: digest.content_hash, byteSize, absolute };
    } finally {
      if (stable?.descriptor !== undefined && stable?.descriptor !== null) {
        try { fs.closeSync(stable.descriptor); } catch { /* preserve primary validation error */ }
      }
    }
  }

  _externalEditAssertSafeMetadata(value, key = '', depth = 0) {
    if (depth > EXTERNAL_EDIT_MAX_DEPTH) throw this._externalEditError('EXTERNAL_EDIT_SCHEMA_INVALID', 'errors.external_edit_schema_invalid', { reason: 'depth' });
    if (typeof value === 'string') {
      if (Buffer.byteLength(value, 'utf8') > EXTERNAL_EDIT_MAX_STRING_BYTES) throw this._externalEditError('EXTERNAL_EDIT_SCHEMA_INVALID', 'errors.external_edit_schema_invalid', { reason: 'string_size' });
      const suspiciousKey = /(?:^|_)(?:path|uri|url|provider|prompt|secret|credential|token|endpoint|shell|command|binary|file)(?:_|$)/i.test(key);
      const suspiciousValue = /^(?:[A-Za-z]:[\\/]|\\\\|(?:file|https?|s3|gs|ftp|data):|\/\/)/i.test(value.trim());
      if (suspiciousKey || suspiciousValue) throw this._externalEditError('EXTERNAL_EDIT_EXTERNAL_REFERENCE', 'errors.external_edit_external_reference', { field: key || 'document' });
      return;
    }
    if (Array.isArray(value)) {
      if (value.length > EXTERNAL_EDIT_MAX_NODES) throw this._externalEditError('EXTERNAL_EDIT_SCHEMA_INVALID', 'errors.external_edit_schema_invalid', { reason: 'array_size' });
      value.forEach((item) => this._externalEditAssertSafeMetadata(item, key, depth + 1));
      return;
    }
    if (value && typeof value === 'object') {
      for (const [childKey, childValue] of Object.entries(value)) this._externalEditAssertSafeMetadata(childValue, childKey, depth + 1);
    }
  }

  _externalEditValidateDocument(document, binding) {
    if (!document || typeof document !== 'object' || Array.isArray(document)) throw this._externalEditError('EXTERNAL_EDIT_SCHEMA_INVALID');
    const unknownTop = Object.keys(document).filter((key) => !EXTERNAL_EDIT_ALLOWED_TOP_LEVEL_KEYS.has(key));
    if (unknownTop.length) throw this._externalEditError('EXTERNAL_EDIT_SCHEMA_INVALID', 'errors.external_edit_schema_invalid', { reason: `top_level:${unknownTop[0]}` });
    if (document.manifest_type !== 'CINEFORGE_TIMELINE_INTERCHANGE'
      || document.manifest_schema_version !== TIMELINE_INTERCHANGE_SCHEMA_VERSION
      || document.export_profile !== TIMELINE_INTERCHANGE_PROFILE
      || document.deliverable_type !== 'TIMELINE_INTERCHANGE') {
      throw this._externalEditError('EXTERNAL_EDIT_PROFILE_UNSUPPORTED', 'errors.external_edit_profile_unsupported', {});
    }
    const source = document.source;
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw this._externalEditError('EXTERNAL_EDIT_SCHEMA_INVALID');
    const unknownSource = Object.keys(source).filter((key) => !EXTERNAL_EDIT_ALLOWED_SOURCE_KEYS.has(key));
    if (unknownSource.length) throw this._externalEditError('EXTERNAL_EDIT_SCHEMA_INVALID', 'errors.external_edit_schema_invalid', { reason: `source:${unknownSource[0]}` });
    const requiredText = (value, field, max = 512) => {
      if (typeof value !== 'string' || value.trim() === '' || value.length > max) throw this._externalEditError('EXTERNAL_EDIT_SCHEMA_INVALID', 'errors.external_edit_schema_invalid', { reason: field });
      return value;
    };
    if (requiredText(source.project_id, 'source.project_id') !== binding.project.id
      || requiredText(source.timeline_id, 'source.timeline_id') !== binding.revision.timeline_id
      || requiredText(source.timeline_revision_id, 'source.timeline_revision_id') !== binding.revision.id) {
      throw this._externalEditError('EXTERNAL_EDIT_SCOPE_MISMATCH', 'errors.external_edit_scope_mismatch', { reason: 'source_identity' });
    }
    if (!Number.isSafeInteger(source.revision_number) || source.revision_number !== Number(binding.revision.revision_number)) {
      throw this._externalEditError('EXTERNAL_EDIT_SCOPE_MISMATCH', 'errors.external_edit_scope_mismatch', { reason: 'revision_number' });
    }
    if (!SHA256_HEX.test(String(source.content_hash ?? '')) || String(source.content_hash).toLowerCase() !== String(binding.revision.content_hash).toLowerCase()) {
      throw this._externalEditError('EXTERNAL_EDIT_SCOPE_MISMATCH', 'errors.external_edit_scope_mismatch', { reason: 'source_content_hash' });
    }
    this._interchangeRational(source.duration, 'returned.duration', { allowZero: true });
    const profile = source.media_profile;
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw this._externalEditError('EXTERNAL_EDIT_SCHEMA_INVALID', 'errors.external_edit_schema_invalid', { reason: 'media_profile' });
    const unknownProfile = Object.keys(profile).filter((key) => !EXTERNAL_EDIT_ALLOWED_MEDIA_PROFILE_KEYS.has(key));
    if (unknownProfile.length) throw this._externalEditError('EXTERNAL_EDIT_SCHEMA_INVALID', 'errors.external_edit_schema_invalid', { reason: `media_profile:${unknownProfile[0]}` });
    if (requiredText(profile.revision_id, 'media_profile.revision_id') !== binding.session.media_profile_revision_id) {
      throw this._externalEditError('EXTERNAL_EDIT_SCOPE_MISMATCH', 'errors.external_edit_scope_mismatch', { reason: 'media_profile_revision' });
    }
    for (const field of ['timeline_rate', 'time_base', 'pixel_aspect']) this._interchangeRational(profile[field], `returned.media_profile.${field}`, { allowZero: false });
    for (const field of ['width', 'height', 'audio_sample_rate']) {
      if (!Number.isSafeInteger(profile[field]) || profile[field] < 0 || profile[field] > MAX_RATIONAL_COMPONENT) throw this._externalEditError('EXTERNAL_EDIT_SCHEMA_INVALID', 'errors.external_edit_schema_invalid', { reason: `media_profile.${field}` });
    }
    for (const field of ['working_color_space', 'transfer_function', 'hdr_policy', 'audio_channel_layout']) requiredText(profile[field], `media_profile.${field}`, 120);
    const review = source.review;
    if (!review || typeof review !== 'object' || Array.isArray(review)) throw this._externalEditError('EXTERNAL_EDIT_SCHEMA_INVALID', 'errors.external_edit_schema_invalid', { reason: 'review' });
    const unknownReview = Object.keys(review).filter((key) => !EXTERNAL_EDIT_ALLOWED_REVIEW_KEYS.has(key));
    if (unknownReview.length) throw this._externalEditError('EXTERNAL_EDIT_SCHEMA_INVALID', 'errors.external_edit_schema_invalid', { reason: `review:${unknownReview[0]}` });
    if (requiredText(review.session_id, 'review.session_id') !== binding.session.review_session_id
      || review.decision !== 'APPROVE'
      || !SHA256_HEX.test(String(review.dependency_snapshot_hash ?? ''))
      || String(review.dependency_snapshot_hash).toLowerCase() !== String(binding.session.dependency_snapshot_hash).toLowerCase()
      || !SHA256_HEX.test(String(review.subject_content_hash ?? ''))
      || String(review.subject_content_hash).toLowerCase() !== String(binding.session.subject_content_hash).toLowerCase()) {
      throw this._externalEditError('EXTERNAL_EDIT_SCOPE_MISMATCH', 'errors.external_edit_scope_mismatch', { reason: 'review_binding' });
    }
    if (!Array.isArray(source.tracks) || source.tracks.length > TIMELINE_INTERCHANGE_MAX_TRACKS || !Array.isArray(source.markers) || source.markers.length > TIMELINE_INTERCHANGE_MAX_MARKERS) {
      throw this._externalEditError('EXTERNAL_EDIT_SCHEMA_INVALID', 'errors.external_edit_schema_invalid', { reason: 'tracks_or_markers' });
    }
    let clipCount = 0;
    source.tracks.forEach((track, trackIndex) => {
      if (!track || typeof track !== 'object' || Array.isArray(track)) throw this._externalEditError('EXTERNAL_EDIT_SCHEMA_INVALID', 'errors.external_edit_schema_invalid', { reason: `track:${trackIndex}` });
      const allowed = new Set(['id', 'track_type', 'order_index', 'name', 'enabled', 'clips']);
      if (Object.keys(track).some((key) => !allowed.has(key))) throw this._externalEditError('EXTERNAL_EDIT_SCHEMA_INVALID', 'errors.external_edit_schema_invalid', { reason: `track_keys:${trackIndex}` });
      requiredText(track.id, `track.${trackIndex}.id`, 160); requiredText(track.track_type, `track.${trackIndex}.track_type`, 32); requiredText(track.name, `track.${trackIndex}.name`, 500);
      if (!Number.isSafeInteger(track.order_index) || track.order_index < 0 || typeof track.enabled !== 'boolean' || !Array.isArray(track.clips)) throw this._externalEditError('EXTERNAL_EDIT_SCHEMA_INVALID', 'errors.external_edit_schema_invalid', { reason: `track_shape:${trackIndex}` });
      clipCount += track.clips.length;
      if (clipCount > TIMELINE_INTERCHANGE_MAX_CLIPS) throw this._externalEditError('EXTERNAL_EDIT_SCHEMA_INVALID', 'errors.external_edit_schema_invalid', { reason: 'clip_count' });
      track.clips.forEach((clip, clipIndex) => {
        if (!clip || typeof clip !== 'object' || Array.isArray(clip)) throw this._externalEditError('EXTERNAL_EDIT_SCHEMA_INVALID', 'errors.external_edit_schema_invalid', { reason: `clip:${trackIndex}:${clipIndex}` });
        const clipAllowed = new Set(['id', 'asset_revision_id', 'source_in', 'source_out', 'timeline_in', 'timeline_out', 'speed']);
        if (Object.keys(clip).some((key) => !clipAllowed.has(key))) throw this._externalEditError('EXTERNAL_EDIT_SCHEMA_INVALID', 'errors.external_edit_schema_invalid', { reason: `clip_keys:${trackIndex}:${clipIndex}` });
        requiredText(clip.id, `clip.${trackIndex}.${clipIndex}.id`, 160);
        if (clip.asset_revision_id !== null) requiredText(clip.asset_revision_id, `clip.${trackIndex}.${clipIndex}.asset_revision_id`, 200);
        if (clip.source_in !== null) this._interchangeRational(clip.source_in, 'returned.clip.source_in', { allowZero: true });
        if (clip.source_out !== null) this._interchangeRational(clip.source_out, 'returned.clip.source_out', { allowZero: true });
        this._interchangeRational(clip.timeline_in, 'returned.clip.timeline_in', { allowZero: true });
        this._interchangeRational(clip.timeline_out, 'returned.clip.timeline_out', { allowZero: true });
        this._interchangeRational(clip.speed, 'returned.clip.speed', { allowZero: false });
      });
    });
    source.markers.forEach((marker, markerIndex) => {
      if (!marker || typeof marker !== 'object' || Array.isArray(marker)) throw this._externalEditError('EXTERNAL_EDIT_SCHEMA_INVALID', 'errors.external_edit_schema_invalid', { reason: `marker:${markerIndex}` });
      const allowed = new Set(['id', 'time', 'marker_type', 'label']);
      if (Object.keys(marker).some((key) => !allowed.has(key))) throw this._externalEditError('EXTERNAL_EDIT_SCHEMA_INVALID', 'errors.external_edit_schema_invalid', { reason: `marker_keys:${markerIndex}` });
      requiredText(marker.id, `marker.${markerIndex}.id`, 160); requiredText(marker.marker_type, `marker.${markerIndex}.marker_type`, 120); requiredText(marker.label, `marker.${markerIndex}.label`, 500);
      this._interchangeRational(marker.time, 'returned.marker.time', { allowZero: true });
    });
    if (!Array.isArray(document.artifact_allowlist) || document.artifact_allowlist.length > TIMELINE_INTERCHANGE_MAX_ARTIFACTS) throw this._externalEditError('EXTERNAL_EDIT_SCHEMA_INVALID', 'errors.external_edit_schema_invalid', { reason: 'artifact_allowlist' });
    document.artifact_allowlist.forEach((artifact, artifactIndex) => {
      if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) throw this._externalEditError('EXTERNAL_EDIT_SCHEMA_INVALID', 'errors.external_edit_schema_invalid', { reason: `artifact:${artifactIndex}` });
      const allowed = new Set(['asset_revision_id', 'asset_id', 'semantic_role', 'rebuildability', 'hash_algorithm', 'content_hash', 'byte_size']);
      if (Object.keys(artifact).some((key) => !allowed.has(key))) throw this._externalEditError('EXTERNAL_EDIT_SCHEMA_INVALID', 'errors.external_edit_schema_invalid', { reason: `artifact_keys:${artifactIndex}` });
      requiredText(artifact.asset_revision_id, `artifact.${artifactIndex}.asset_revision_id`, 200); requiredText(artifact.asset_id, `artifact.${artifactIndex}.asset_id`, 200); requiredText(artifact.semantic_role, `artifact.${artifactIndex}.semantic_role`, 120); requiredText(artifact.rebuildability, `artifact.${artifactIndex}.rebuildability`, 40);
      if (artifact.hash_algorithm !== 'SHA-256' || !SHA256_HEX.test(String(artifact.content_hash ?? '')) || !Number.isSafeInteger(artifact.byte_size) || artifact.byte_size < 0) throw this._externalEditError('EXTERNAL_EDIT_SCHEMA_INVALID', 'errors.external_edit_schema_invalid', { reason: `artifact_identity:${artifactIndex}` });
    });
    if (document.sanitization !== undefined) {
      if (!document.sanitization || typeof document.sanitization !== 'object' || Array.isArray(document.sanitization)) throw this._externalEditError('EXTERNAL_EDIT_SCHEMA_INVALID', 'errors.external_edit_schema_invalid', { reason: 'sanitization' });
      const allowed = new Set(['policy', 'recorded', 'removed_fields']);
      if (Object.keys(document.sanitization).some((key) => !allowed.has(key)) || document.sanitization.recorded !== true || !Array.isArray(document.sanitization.removed_fields)) throw this._externalEditError('EXTERNAL_EDIT_SCHEMA_INVALID', 'errors.external_edit_schema_invalid', { reason: 'sanitization_shape' });
    }
    this._externalEditAssertSafeMetadata(document);
    return { source, clipCount };
  }

  _registerExternalEdit(payload, expectedVersions, commandId) {
    const projectId = requiredString(payload.project_id ?? payload.projectId, 'project_id');
    const project = this._project(projectId);
    this._assertProjectWritable(project);
    const optionalIdentity = (value, field) => {
      if (value === undefined || value === null || value === '') return null;
      return requiredString(value, field);
    };
    const suppliedHandoffManifestId = optionalIdentity(payload.handoff_manifest_id ?? payload.handoffManifestId, 'handoff_manifest_id');
    const suppliedExportSessionId = optionalIdentity(payload.export_session_id ?? payload.exportSessionId, 'export_session_id');
    if (!suppliedHandoffManifestId && !suppliedExportSessionId) {
      throw this._externalEditError('INVALID_ARGUMENT', 'errors.invalid_field', { field: 'handoff_manifest_id_or_export_session_id' });
    }
    const returnedRevisionId = requiredString(payload.returned_asset_revision_id ?? payload.returnedAssetRevisionId, 'returned_asset_revision_id');
    const joinWhere = suppliedHandoffManifestId && suppliedExportSessionId
      ? 'h.id = ? AND e.id = ?'
      : suppliedHandoffManifestId ? 'h.id = ?' : 'e.id = ?';
    const joinArgument = suppliedHandoffManifestId && suppliedExportSessionId
      ? [suppliedHandoffManifestId, suppliedExportSessionId]
      : [suppliedHandoffManifestId ?? suppliedExportSessionId];
    const joined = this.db.prepare(`SELECT e.*, h.id AS handoff_id, h.manifest_hash, h.manifest_json,
        h.project_id AS handoff_project_id, h.export_session_id AS handoff_export_session_id
      FROM export_sessions e JOIN handoff_manifests h ON h.export_session_id = e.id
      WHERE ${joinWhere}`).get(...joinArgument);
    if (!joined) throw this._externalEditError('EXTERNAL_EDIT_SCOPE_MISMATCH', 'errors.external_edit_scope_mismatch', { reason: 'handoff_or_export' });
    const handoffManifestId = String(joined.handoff_id);
    const exportSessionId = String(joined.id);
    if (joined.project_id !== projectId || joined.handoff_project_id !== projectId) throw this._externalEditError('EXTERNAL_EDIT_SCOPE_MISMATCH', 'errors.external_edit_scope_mismatch', { reason: 'project' });
    this._expectedVersion(expectedVersions, 'EXPORT_SESSION', joined.id, joined.row_version);
    if (joined.state !== 'COMPLETED' || joined.output_manifest_id !== handoffManifestId || !joined.output_asset_revision_id || !SHA256_HEX.test(String(joined.output_content_hash ?? '')) || !Number.isSafeInteger(Number(joined.output_byte_size)) || Number(joined.output_byte_size) <= 0 || Number(joined.output_byte_size) > EXTERNAL_EDIT_MAX_BYTES) {
      throw this._externalEditError('EXTERNAL_EDIT_HANDOFF_NOT_VERIFIED', 'errors.external_edit_handoff_not_verified', { export_session_id: joined.id });
    }
    let manifestDocument;
    try { manifestDocument = parseStrictCanonicalJson(String(joined.manifest_json), { maxBytes: 2 * 1024 * 1024 }); } catch {
      throw this._externalEditError('EXTERNAL_EDIT_HANDOFF_NOT_VERIFIED', 'errors.external_edit_handoff_not_verified', { export_session_id: joined.id });
    }
    const manifestHash = crypto.createHash('sha256').update(canonicalJson(manifestDocument), 'utf8').digest('hex');
    if (manifestHash !== String(joined.manifest_hash).toLowerCase()) throw this._externalEditError('EXTERNAL_EDIT_HANDOFF_NOT_VERIFIED', 'errors.external_edit_handoff_not_verified', { export_session_id: joined.id });
    const revision = this.db.prepare(`SELECT r.*, a.project_id, a.asset_type, a.origin_type, a.lifecycle_state AS asset_lifecycle_state,
        a.rights_identity_id, so.hash_algorithm, so.content_hash, so.byte_size, so.storage_class
      FROM asset_revisions r JOIN assets a ON a.id = r.asset_id
      JOIN storage_objects so ON so.id = r.storage_object_id WHERE r.id = ?`).get(returnedRevisionId);
    if (!revision || revision.project_id !== projectId || revision.asset_type !== 'TIMELINE_INTERCHANGE'
      || !['IMPORTED', 'EXTERNAL_EDIT', 'HANDOFF_RETURN'].includes(revision.origin_type)
      || revision.asset_lifecycle_state !== 'ACTIVE' || revision.semantic_role !== 'TIMELINE_INTERCHANGE'
      || revision.rebuildability !== 'ORIGINAL') {
      throw this._externalEditError('EXTERNAL_EDIT_ASSET_NOT_READY', 'errors.external_edit_asset_not_ready', { asset_revision_id: returnedRevisionId });
    }
    // The asset revision is the immutable bridge to the import/provenance
    // record. Require that row to exist before registration so a hand-crafted
    // or damaged revision cannot look like a returned editor artifact.
    const provenance = this.db.prepare('SELECT id, origin_type FROM provenance_records WHERE id = ?').get(revision.provenance_record_id);
    if (!provenance || !provenance.id || !provenance.origin_type) {
      throw this._externalEditError('EXTERNAL_EDIT_ASSET_NOT_READY', 'errors.external_edit_asset_not_ready', { asset_revision_id: returnedRevisionId });
    }
    const rights = this._rightsForAsset(revision.asset_id, { purpose: 'EXTERNAL_EDIT_REGISTRATION' });
    if (!rights.eligible || rights.status !== 'ALLOWED') {
      throw this._externalEditError('EXTERNAL_EDIT_RIGHTS_BLOCKED', 'errors.external_edit_rights_blocked', { status: rights.status ?? 'UNKNOWN' });
    }
    const materialized = this._externalEditManagedDocument(revision);
    let document;
    try { document = parseStrictCanonicalJson(materialized.text); } catch (error) {
      const code = String(error?.message ?? 'JSON_INVALID');
      const errorCode = code === 'JSON_TOO_LARGE' ? 'EXTERNAL_EDIT_TOO_LARGE' : 'EXTERNAL_EDIT_SCHEMA_INVALID';
      throw this._externalEditError(errorCode, errorCode === 'EXTERNAL_EDIT_TOO_LARGE' ? 'errors.external_edit_too_large' : 'errors.external_edit_schema_invalid', { reason: code });
    }
    const timelineRevision = this._timelineRevision(joined.timeline_revision_id);
    const validated = this._externalEditValidateDocument(document, { project, session: joined, revision: timelineRevision });
    const suppliedConfidence = payload.lineage_confidence ?? payload.lineageConfidence;
    const confidence = suppliedConfidence === undefined || suppliedConfidence === null || suppliedConfidence === ''
      ? (materialized.contentHash === String(joined.output_content_hash).toLowerCase() && materialized.byteSize === Number(joined.output_byte_size) ? 'EXACT' : 'PARTIAL')
      : String(suppliedConfidence).trim().toUpperCase();
    if (!['EXACT', 'PARTIAL', 'FLATTENED', 'UNKNOWN'].includes(confidence)) throw this._externalEditError('EXTERNAL_EDIT_SCHEMA_INVALID', 'errors.external_edit_schema_invalid', { reason: 'lineage_confidence' });
    if (confidence === 'EXACT' && (materialized.contentHash !== String(joined.output_content_hash).toLowerCase() || materialized.byteSize !== Number(joined.output_byte_size))) {
      throw this._externalEditError('EXTERNAL_EDIT_LINEAGE_CLAIM_INVALID', 'errors.external_edit_lineage_claim_invalid', { lineage_confidence: confidence });
    }
    const existing = this.db.prepare(`SELECT * FROM external_edits WHERE project_id = ? AND handoff_manifest_id = ? AND returned_asset_revision_id = ? AND source_document_hash = ?`).get(projectId, handoffManifestId, returnedRevisionId, materialized.contentHash);
    if (existing) throw this._externalEditError('EXTERNAL_EDIT_ALREADY_REGISTERED', 'errors.external_edit_already_registered', { external_edit_id: existing.id }, { category: 'CONFLICT', needsUser: false });
    const diffs = [];
    const profile = this._mediaProfileRevision(joined.media_profile_revision_id);
    const equivalent = (left, right) => canonicalJson(left) === canonicalJson(right);
    const expectedDuration = { num: Number(timelineRevision.duration_num), den: Number(timelineRevision.duration_den) };
    if (!equivalent(document.source.duration, expectedDuration)) diffs.push({ diff_type: 'DURATION', severity: 'WARNING', before: expectedDuration, after: document.source.duration });
    const expectedRates = {
      timeline_rate: { num: Number(profile.timeline_rate_num), den: Number(profile.timeline_rate_den) },
      time_base: { num: Number(profile.time_base_num), den: Number(profile.time_base_den) },
      pixel_aspect: { num: Number(profile.pixel_aspect_num), den: Number(profile.pixel_aspect_den) },
    };
    for (const key of Object.keys(expectedRates)) if (!equivalent(document.source.media_profile[key], expectedRates[key])) diffs.push({ diff_type: key === 'timeline_rate' || key === 'time_base' ? 'FPS_TIMEBASE' : 'MEDIA_PROFILE', severity: 'WARNING', before: expectedRates[key], after: document.source.media_profile[key] });
    const expectedArtifactRows = this._handoffAssetRows(timelineRevision, document.source.tracks ?? []);
    const expectedArtifactHashes = new Map(expectedArtifactRows.map((artifact) => [artifact.asset_revision_id, String(artifact.content_hash).toLowerCase()]));
    for (const artifact of document.artifact_allowlist) if (expectedArtifactHashes.get(artifact.asset_revision_id) !== String(artifact.content_hash).toLowerCase()) diffs.push({ diff_type: 'MEDIA_IDENTITY', severity: 'WARNING', before: { asset_revision_id: artifact.asset_revision_id, content_hash: expectedArtifactHashes.get(artifact.asset_revision_id) ?? null }, after: { asset_revision_id: artifact.asset_revision_id, content_hash: String(artifact.content_hash).toLowerCase() } });
    const validationSnapshot = {
      schema_version: TIMELINE_INTERCHANGE_SCHEMA_VERSION,
      export_profile: TIMELINE_INTERCHANGE_PROFILE,
      source_manifest_hash: String(joined.manifest_hash).toLowerCase(),
      source_timeline_revision_id: timelineRevision.id,
      source_content_hash: String(joined.subject_content_hash).toLowerCase(),
      source_dependency_snapshot_hash: String(joined.dependency_snapshot_hash).toLowerCase(),
      returned_document_hash: materialized.contentHash,
      returned_byte_size: materialized.byteSize,
      returned_provenance_record_id: provenance.id,
      output_document_hash: String(joined.output_content_hash).toLowerCase(),
      output_byte_size: Number(joined.output_byte_size),
      clip_count: validated.clipCount,
      contract_diff_count: diffs.length,
      rights_status: rights.status,
    };
    const externalEditId = uuidv7();
    const created = nowUtcUs();
    this.db.prepare(`INSERT INTO external_edits
      (id, project_id, handoff_manifest_id, export_session_id, timeline_revision_id, returned_asset_revision_id,
       returned_interchange_asset_revision_id, lineage_confidence, validation_state, source_document_hash,
       source_document_byte_size, source_manifest_hash, source_revision_content_hash, source_dependency_snapshot_hash,
       source_review_session_id, returned_rights_status, validation_snapshot_json, contract_diff_count, next_step,
       row_version, command_id, created_by_actor_id, created_at_utc_us)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'REGISTERED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`).run(
      externalEditId, projectId, handoffManifestId, joined.id, timelineRevision.id, returnedRevisionId,
      returnedRevisionId, confidence, materialized.contentHash, materialized.byteSize, String(joined.manifest_hash).toLowerCase(),
      String(joined.subject_content_hash).toLowerCase(), String(joined.dependency_snapshot_hash).toLowerCase(), joined.review_session_id,
      rights.status, json(validationSnapshot), diffs.length, diffs.length ? 'Review contract differences before applying any edit.' : 'Returned interchange is registered for explicit human review.', commandId, this.actorId, created,
    );
    const insertDiff = this.db.prepare(`INSERT INTO external_edit_contract_diffs
      (id, external_edit_id, project_id, diff_type, severity, before_json, after_json, resolution_state, created_by_actor_id, created_at_utc_us)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'UNRESOLVED', ?, ?)`);
    for (const diff of diffs) insertDiff.run(uuidv7(), externalEditId, projectId, diff.diff_type, diff.severity, json(diff.before), json(diff.after), this.actorId, created);
    const row = this.db.prepare('SELECT * FROM external_edits WHERE id = ?').get(externalEditId);
    const publicRow = publicExternalEdit(row, this.db.prepare('SELECT * FROM external_edit_contract_diffs WHERE external_edit_id = ? ORDER BY created_at_utc_us ASC, id ASC').all(externalEditId));
    return {
      projectId,
      result: { external_edit: publicRow, ...publicRow },
      event: { aggregateType: 'EXTERNAL_EDIT', aggregateId: externalEditId, aggregateVersion: 1, eventType: 'EXTERNAL_EDIT_REGISTERED', payload: { external_edit_id: externalEditId, project_id: projectId, handoff_manifest_id: handoffManifestId, export_session_id: joined.id, returned_asset_revision_id: returnedRevisionId, lineage_confidence: confidence, validation_state: 'REGISTERED', source_document_hash: materialized.contentHash, source_document_byte_size: materialized.byteSize, contract_diff_count: diffs.length } },
      audit: { actionType: 'external_edit.register', targetType: 'EXTERNAL_EDIT', targetId: externalEditId, payload: { project_id: projectId, handoff_manifest_id: handoffManifestId, export_session_id: joined.id, returned_asset_revision_id: returnedRevisionId, lineage_confidence: confidence, source_document_hash: materialized.contentHash, source_document_byte_size: materialized.byteSize, contract_diff_count: diffs.length, rights_status: rights.status } },
    };
  }

  _externalEditList(params = {}) {
    const projectId = requiredString(params.project_id ?? params.projectId, 'project_id');
    this._project(projectId);
    const limit = Math.min(Math.max(asInt(params.limit, 100), 1), 200);
    const stateInput = params.validation_state ?? params.validationState ?? null;
    const state = stateInput === null || stateInput === '' ? null : String(stateInput).trim().toUpperCase();
    if (state !== null && !['RECEIVED', 'VALIDATING', 'REGISTERED', 'BLOCKED_SCHEMA', 'BLOCKED_SCOPE', 'BLOCKED_MEDIA', 'BLOCKED_RIGHTS', 'FAILED'].includes(state)) throw this._externalEditError('INVALID_ARGUMENT', 'errors.invalid_field', { field: 'validation_state' });
    const rows = this.db.prepare(`SELECT * FROM external_edits WHERE project_id = ? AND (? IS NULL OR validation_state = ?) ORDER BY created_at_utc_us DESC, id DESC LIMIT ?`).all(projectId, state, state, limit);
    return { items: rows.map((row) => publicExternalEdit(row, this.db.prepare('SELECT * FROM external_edit_contract_diffs WHERE external_edit_id = ? ORDER BY created_at_utc_us ASC, id ASC').all(row.id))), projection_seq: this._projectionSeq(), generated_at: new Date().toISOString() };
  }

  _externalEditGet(id, projectIdValue = null) {
    const externalEditId = requiredString(id, 'external_edit_id');
    const row = this.db.prepare('SELECT * FROM external_edits WHERE id = ?').get(externalEditId);
    if (!row) throw this._externalEditError('EXTERNAL_EDIT_NOT_FOUND', 'errors.external_edit_not_found', { external_edit_id: externalEditId });
    if (projectIdValue !== null && projectIdValue !== undefined && row.project_id !== projectIdValue) throw this._externalEditError('ENTITY_SCOPE_MISMATCH', 'errors.entity_scope_mismatch', { entity_type: 'EXTERNAL_EDIT', entity_id: externalEditId, project_id: projectIdValue, actual_project_id: row.project_id });
    const diffs = this.db.prepare('SELECT * FROM external_edit_contract_diffs WHERE external_edit_id = ? ORDER BY created_at_utc_us ASC, id ASC').all(externalEditId);
    return { external_edit: publicExternalEdit(row, diffs), projection_seq: this._projectionSeq(), generated_at: new Date().toISOString() };
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
       UNION SELECT id FROM timeline_working_sessions WHERE timeline_id IN (SELECT id FROM timelines WHERE project_id = ?)
       UNION SELECT id FROM review_sessions WHERE project_id = ?
        UNION SELECT id FROM export_sessions WHERE project_id = ?
        UNION SELECT id FROM project_media_profiles WHERE project_id = ?
         UNION SELECT id FROM release_candidates WHERE project_id = ?
         UNION SELECT id FROM release_build_plans WHERE project_id = ?
         UNION SELECT id FROM media_probe_jobs WHERE project_id = ?
        ) ORDER BY seq DESC LIMIT ?`).all(
      projectId, projectId, projectId, projectId, projectId,
       projectId, projectId, projectId, projectId, projectId, projectId, projectId, projectId, projectId, projectId, limit,
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

  /**
   * Read-only, bounded integrity evidence for the managed CAS.
   *
   * The database is the object index and the filesystem is only read through
   * a stable descriptor.  Every checked object must match its registered
   * SHA-256 and byte size, have exactly one canonical PRIMARY location, and
   * resolve to the deterministic asset-store path.  A byte or object budget
   * makes this safe to call from Settings while a large library is active.
   * No database row, location state, timestamp, or file is changed here.
   */
  _storageScrubHealth(params = {}) {
    const safeNonNegativeInteger = (value) => {
      const number = typeof value === 'number'
        ? value
        : typeof value === 'bigint' && value <= BigInt(Number.MAX_SAFE_INTEGER)
          ? Number(value)
          : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : Number.NaN;
      return Number.isSafeInteger(number) && number >= 0 ? number : null;
    };
    const requestedLimit = params.limit ?? params.max_objects ?? params.maxObjects ?? STORAGE_SCRUB_DEFAULT_MAX_OBJECTS;
    const maxObjects = boundedInteger(requestedLimit, 'limit', { min: 1, max: STORAGE_SCRUB_MAX_OBJECTS });
    const requestedBytes = params.max_bytes ?? params.maxBytes ?? STORAGE_SCRUB_DEFAULT_MAX_BYTES;
    const maxBytes = boundedInteger(requestedBytes, 'max_bytes', { min: 1, max: STORAGE_SCRUB_MAX_BYTES });
    const afterInput = params.after ?? params.after_content_hash ?? params.afterContentHash ?? null;
    // Preserve whitespace in the opaque lexical key.  A registered object
    // row is allowed to be malformed by the current schema (it only checks
    // length), so trimming here could make a returned cursor impossible to
    // submit and leave pagination stuck on that row.
    const after = afterInput === null || afterInput === undefined || afterInput === '' ? null : String(afterInput).toLowerCase();
    // The cursor is a bounded lexical key, not an integrity claim.  Keeping
    // malformed registered hashes pageable lets a later page surface the
    // remaining rows instead of getting stuck on one corrupt metadata row.
    if (after !== null && (after.length === 0 || after.length > 128 || /[\u0000-\u001f\u007f]/u.test(after))) {
      throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_field', { field: 'after' });
    }

    // A cursor is content-addressed, so pagination remains deterministic even
    // if a caller asks for a smaller page after a previous bounded scan.
    const rows = this.db.prepare(`SELECT so.id, so.hash_algorithm, so.content_hash,
        so.byte_size, so.storage_class, so.verified_at_utc_us,
        (SELECT COUNT(*) FROM storage_object_locations all_locations
          WHERE all_locations.storage_object_id = so.id AND all_locations.location_role = 'PRIMARY') AS primary_location_count,
        (SELECT location.state FROM storage_object_locations location
          WHERE location.storage_object_id = so.id AND location.location_role = 'PRIMARY'
          ORDER BY location.id ASC LIMIT 1) AS location_state,
        (SELECT location.storage_root FROM storage_object_locations location
          WHERE location.storage_object_id = so.id AND location.location_role = 'PRIMARY'
          ORDER BY location.id ASC LIMIT 1) AS location_root,
        (SELECT location.relative_path FROM storage_object_locations location
          WHERE location.storage_object_id = so.id AND location.location_role = 'PRIMARY'
          ORDER BY location.id ASC LIMIT 1) AS relative_path
      FROM storage_objects so
      WHERE so.storage_class = 'LOCAL_MANAGED'
        AND (? IS NULL OR lower(so.content_hash) > ?)
      ORDER BY lower(so.content_hash) ASC, so.id ASC
      LIMIT ?`).all(after, after, maxObjects + 1);
    const managedObjectCountRow = this.db.prepare(`SELECT COUNT(*) AS count
      FROM storage_objects WHERE storage_class = 'LOCAL_MANAGED'`).get();
    const managedObjectCount = safeNonNegativeInteger(managedObjectCountRow?.count) ?? 0;

    const objects = [];
    let checkedBytes = 0;
    let checkedCount = 0;
    let unknownCount = 0;
    let failedCount = 0;
    let budgetExhausted = false;
    let lastCursor = after;
    let blockedObject = null;

    const record = (row, state, code, evidence = {}) => {
      const expectedHash = typeof row.content_hash === 'string' && SHA256_HEX.test(row.content_hash)
        ? row.content_hash.toLowerCase() : null;
      const expectedSize = safeNonNegativeInteger(row.byte_size);
      const item = {
        id: typeof row.id === 'string' ? row.id : String(row.id ?? ''),
        hash_algorithm: typeof row.hash_algorithm === 'string' ? row.hash_algorithm : null,
        content_hash: expectedHash,
        expected_byte_size: expectedSize,
        location_state: typeof row.location_state === 'string' ? row.location_state : null,
        state,
        ...(code ? { code } : {}),
        ...(evidence.observedHash ? { observed_hash: evidence.observedHash } : {}),
        ...(evidence.observedSize !== undefined ? { observed_byte_size: evidence.observedSize } : {}),
        ...(safeNonNegativeInteger(row.verified_at_utc_us) !== null
          ? { registered_verified_at: rfc3339FromUs(safeNonNegativeInteger(row.verified_at_utc_us)) } : {}),
      };
      objects.push(item);
      checkedCount += 1;
      if (state === 'FAIL') failedCount += 1;
      if (state === 'UNKNOWN') unknownCount += 1;
      if (Number.isSafeInteger(evidence.bytesHashed) && evidence.bytesHashed >= 0) checkedBytes += evidence.bytesHashed;
      if (state !== 'UNKNOWN' || code !== 'SCRUB_IO_BUDGET_EXCEEDED') {
        // Advance by the registered lexical key even when the key is not a
        // valid SHA-256.  This keeps malformed rows pageable for diagnostics.
        if (typeof row.content_hash === 'string' && row.content_hash.length > 0) lastCursor = row.content_hash.toLowerCase();
      }
      return item;
    };

    for (const row of rows.slice(0, maxObjects)) {
      const expectedSize = safeNonNegativeInteger(row.byte_size);
      // Metadata failures are deterministic and do not consume filesystem IO.
      if (row.hash_algorithm !== 'SHA-256') {
        record(row, 'FAIL', 'SCRUB_HASH_ALGORITHM_INVALID');
        continue;
      }
      if (typeof row.content_hash !== 'string' || !SHA256_HEX.test(row.content_hash)) {
        record(row, 'FAIL', 'SCRUB_CONTENT_HASH_INVALID');
        continue;
      }
      if (expectedSize === null) {
        record(row, 'FAIL', 'SCRUB_BYTE_SIZE_INVALID');
        continue;
      }
      if (row.verified_at_utc_us !== null && row.verified_at_utc_us !== undefined
        && safeNonNegativeInteger(row.verified_at_utc_us) === null) {
        record(row, 'FAIL', 'SCRUB_VERIFIED_AT_INVALID');
        continue;
      }
      const primaryLocationCount = safeNonNegativeInteger(row.primary_location_count) ?? 0;
      if (primaryLocationCount !== 1) {
        record(row, 'FAIL', primaryLocationCount === 0
          ? 'SCRUB_PRIMARY_LOCATION_MISSING' : 'SCRUB_PRIMARY_LOCATION_AMBIGUOUS');
        continue;
      }
      const expectedRelativePath = this._objectRelativePath('SHA-256', row.content_hash.toLowerCase()).split(path.sep).join('/');
      if (row.location_root !== 'asset-store' || row.location_state !== 'AVAILABLE' || row.relative_path !== expectedRelativePath) {
        record(row, 'FAIL', row.location_state !== 'AVAILABLE' ? 'SCRUB_LOCATION_UNAVAILABLE' : 'SCRUB_LOCATION_INVALID');
        continue;
      }
      const remainingBytes = maxBytes - checkedBytes;
      if (expectedSize > remainingBytes) {
        budgetExhausted = true;
        blockedObject = { id: row.id, content_hash: row.content_hash.toLowerCase(), expected_byte_size: expectedSize };
        record(row, 'UNKNOWN', 'SCRUB_IO_BUDGET_EXCEEDED');
        // Do not advance the cursor over an object whose bytes were not read.
        lastCursor = after;
        break;
      }

      const target = path.resolve(this.assetStorePath, row.relative_path);
      if (!pathIsWithin(target, this.assetStorePath) || pathKey(target) === pathKey(this.assetStorePath)) {
        record(row, 'FAIL', 'SCRUB_PATH_ESCAPE');
        continue;
      }

      let descriptor;
      let observedSize;
      let observedHash;
      try {
        this._assertNoReparsePath(target);
        // O_NOFOLLOW is unavailable on Windows.  Bind the descriptor to the
        // path identity observed before open and again after hashing so a
        // rename/reparse swap cannot be reported as PASS on that platform.
        const pathBefore = fs.lstatSync(target);
        if (pathBefore.isSymbolicLink() || !pathBefore.isFile() || safeNonNegativeInteger(pathBefore.nlink) !== 1) {
          throw new Error('SOURCE_CHANGED_DURING_HASH');
        }
        const noFollow = Number(fs.constants.O_NOFOLLOW ?? 0);
        descriptor = fs.openSync(target, fs.constants.O_RDONLY | noFollow);
        const before = fs.fstatSync(descriptor);
        if (!before.isFile()) {
          record(row, 'FAIL', 'SCRUB_NOT_REGULAR_FILE');
          continue;
        }
        if (safeNonNegativeInteger(before.nlink) !== 1) {
          record(row, 'FAIL', 'SCRUB_HARDLINK_REJECTED');
          continue;
        }
        if (pathBefore.dev !== undefined && !this._sameHandleIdentity(this._sourceIdentity(pathBefore), this._sourceIdentity(before))) {
          throw new Error('SOURCE_CHANGED_DURING_HASH');
        }
        observedSize = safeNonNegativeInteger(before.size);
        if (observedSize === null) {
          record(row, 'UNKNOWN', 'SCRUB_OBJECT_UNREADABLE');
          continue;
        }
        if (observedSize > remainingBytes) {
          budgetExhausted = true;
          blockedObject = { id: row.id, content_hash: row.content_hash.toLowerCase(), expected_byte_size: expectedSize };
          record(row, 'UNKNOWN', 'SCRUB_IO_BUDGET_EXCEEDED', { observedSize });
          lastCursor = after;
          break;
        }
        const digest = crypto.createHash('sha256');
        const buffer = Buffer.allocUnsafe(1024 * 1024);
        let position = 0;
        while (position < observedSize) {
          const read = fs.readSync(descriptor, buffer, 0, Math.min(buffer.length, observedSize - position), position);
          if (read <= 0) throw new Error('SHORT_READ');
          digest.update(buffer.subarray(0, read));
          position += read;
        }
        const afterStat = fs.fstatSync(descriptor);
        if (!this._sameSourceIdentity(this._sourceIdentity(before), this._sourceIdentity(afterStat))) throw new Error('SOURCE_CHANGED_DURING_HASH');
        let pathAfter;
        try { pathAfter = fs.lstatSync(target); } catch { throw new Error('SOURCE_CHANGED_DURING_HASH'); }
        if (pathAfter.isSymbolicLink() || !pathAfter.isFile()
          || !this._sameHandleIdentity(this._sourceIdentity(afterStat), this._sourceIdentity(pathAfter))) {
          throw new Error('SOURCE_CHANGED_DURING_HASH');
        }
        observedHash = digest.digest('hex');
        const state = observedSize === expectedSize && observedHash === row.content_hash.toLowerCase() ? 'PASS' : 'FAIL';
        const code = state === 'PASS' ? null : observedSize !== expectedSize ? 'SCRUB_BYTE_SIZE_MISMATCH' : 'SCRUB_CONTENT_HASH_MISMATCH';
        record(row, state, code, { observedHash, observedSize, bytesHashed: observedSize });
      } catch (error) {
        const code = error?.code === 'ENOENT' ? 'SCRUB_OBJECT_MISSING'
          : error?.code === 'ELOOP' || error?.code === 'SOURCE_REPARSE_REJECTED' ? 'SCRUB_REPARSE_REJECTED'
            : error?.message === 'SOURCE_CHANGED_DURING_HASH' ? 'SCRUB_OBJECT_CHANGED_DURING_SCAN'
              : 'SCRUB_OBJECT_UNREADABLE';
        const state = code === 'SCRUB_OBJECT_MISSING' || code === 'SCRUB_REPARSE_REJECTED' ? 'FAIL' : 'UNKNOWN';
        record(row, state, code, { ...(observedSize !== undefined ? { observedSize } : {}), ...(observedHash ? { observedHash } : {}) });
        if (state === 'UNKNOWN' && code === 'SCRUB_OBJECT_UNREADABLE') {
          // Continue bounded metadata checks for the remaining objects; one
          // transient permission/read error must not make the scan unbounded.
        }
      } finally {
        if (descriptor !== undefined) { try { fs.closeSync(descriptor); } catch { /* preserve evidence */ } }
      }
      if (budgetExhausted) break;
    }

    const hasMoreRows = rows.length > maxObjects;
    const truncated = budgetExhausted || hasMoreRows;
    const complete = !truncated;
    const status = failedCount > 0 ? 'FAIL' : (unknownCount > 0 || truncated ? 'UNKNOWN' : 'PASS');
    const remainingCountRow = this.db.prepare(`SELECT COUNT(*) AS count FROM storage_objects
        WHERE storage_class = 'LOCAL_MANAGED' AND (? IS NULL OR lower(content_hash) > ?)`).get(lastCursor, lastCursor);
    const remainingCount = safeNonNegativeInteger(remainingCountRow?.count) ?? 0;
    return {
      schema_version: 1,
      status,
      read_only: true,
      storage_class: 'LOCAL_MANAGED',
      limits: { max_objects: maxObjects, max_bytes: maxBytes },
      scan: {
        managed_object_count: managedObjectCount,
        checked_count: checkedCount,
        checked_bytes: checkedBytes,
        failed_count: failedCount,
        unknown_count: unknownCount,
        complete,
        truncated,
        truncation_reason: budgetExhausted ? 'MAX_BYTES' : hasMoreRows ? 'MAX_OBJECTS' : null,
        remaining_count: remainingCount,
      },
      objects,
      cursor: {
        requested_after: after,
        next_after: complete ? null : lastCursor,
      },
      ...(blockedObject ? { blocked_object: blockedObject } : {}),
      projection_seq: this._projectionSeq(),
      checked_at: new Date().toISOString(),
      generated_at: new Date().toISOString(),
    };
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

  /**
   * Read-only recovery planning boundary.
   *
   * This deliberately verifies the registered artifact in place, but never
   * copies bytes, opens the snapshot as the live database, mutates backup
   * rows, advances a recovery epoch, or activates a restored installation.
   * The response separates evidence we can prove locally from the recovery
   * controls that are still unavailable in this V1 slice.
   */
  _backupRestoreEstimate(backupId) {
    const row = this._backupRow(backupId);
    const checks = [];
    const addCheck = (id, state, code = null, details = {}) => {
      checks.push({ id, state, ...(code ? { code } : {}), ...(Object.keys(details).length > 0 ? { details } : {}) });
    };
    const safeNonNegativeInteger = (value) => {
      const number = typeof value === 'number' ? value : Number(value);
      return Number.isSafeInteger(number) && number >= 0 ? number : null;
    };

    const recordState = String(row.state ?? '').toUpperCase();
    if (recordState === 'VERIFIED') addCheck('BACKUP_RECORD', 'PASS');
    else if (recordState === 'FAILED' || recordState === 'QUARANTINED') addCheck('BACKUP_RECORD', 'FAIL', 'BACKUP_RECORD_NOT_VERIFIED');
    else addCheck('BACKUP_RECORD', 'UNKNOWN', 'BACKUP_RECORD_STATE_UNKNOWN');

    let verification = null;
    let verificationError = null;
    try {
      verification = this._verifyBackupArtifact({
        root: row.destination_path,
        snapshotPath: row.snapshot_path,
        manifestPath: row.manifest_path,
        manifestSha256: row.manifest_sha256,
        expectedBackupId: row.id,
      });
      addCheck('ARTIFACT_INTEGRITY', 'PASS');
    } catch (error) {
      verificationError = error;
      addCheck('ARTIFACT_INTEGRITY', 'FAIL', error?.code ?? 'BACKUP_VERIFY_FAILED');
    }

    const manifest = verification?.manifest ?? null;
    const currentSchemaVersion = SCHEMA_VERSION;
    const currentInstallationId = this._getMeta('installation_id');
    const currentEventSeq = safeNonNegativeInteger(this._projectionSeq()) ?? 0;
    const manifestSchemaVersion = safeNonNegativeInteger(manifest?.schema_version);
    const eventSeqCheckpoint = safeNonNegativeInteger(manifest?.event_seq_checkpoint);
    const databaseByteSize = safeNonNegativeInteger(manifest?.database?.byte_size);
    const copiedObjectBytes = manifest && Array.isArray(manifest.objects)
      ? manifest.objects.reduce((total, object) => {
        if (object?.materialization !== 'COPIED') return total;
        const size = safeNonNegativeInteger(object.byte_size);
        return size === null || total === null || size > Number.MAX_SAFE_INTEGER - total ? null : total + size;
      }, 0)
      : null;
    const externalObjectCount = manifest && Array.isArray(manifest.objects)
      ? manifest.objects.filter((object) => object?.materialization === 'EXTERNAL_REFERENCE').length
      : null;
    const verifiedByteSize = safeNonNegativeInteger(verification?.byteSize);
    const rowByteSize = safeNonNegativeInteger(row.byte_size);
    const estimatedRestoreBytes = verifiedByteSize ?? rowByteSize;
    const estimatedRestoreDurationMs = estimatedRestoreBytes === null || estimatedRestoreBytes > Math.floor(Number.MAX_SAFE_INTEGER / 1000)
      ? null
      : Math.max(1, Math.ceil((estimatedRestoreBytes * 1000) / BACKUP_RESTORE_ESTIMATE_THROUGHPUT_BYTES_PER_SECOND));

    let installationState = 'UNKNOWN';
    if (manifest && typeof manifest.installation_id === 'string' && typeof currentInstallationId === 'string') {
      installationState = manifest.installation_id === currentInstallationId ? 'PASS' : 'UNKNOWN';
      addCheck('TARGET_INSTALLATION', installationState, installationState === 'UNKNOWN' ? 'BACKUP_INSTALLATION_RECONCILIATION_REQUIRED' : null);
    } else {
      addCheck('TARGET_INSTALLATION', 'UNKNOWN', 'BACKUP_INSTALLATION_UNKNOWN');
    }

    let schemaState = 'UNKNOWN';
    if (manifestSchemaVersion !== null) {
      if (manifestSchemaVersion === currentSchemaVersion) schemaState = 'PASS';
      else if (manifestSchemaVersion < currentSchemaVersion) schemaState = 'UNKNOWN';
      else schemaState = 'FAIL';
      addCheck('TARGET_SCHEMA', schemaState,
        schemaState === 'UNKNOWN' ? 'BACKUP_SCHEMA_MIGRATION_REQUIRED' : schemaState === 'FAIL' ? 'BACKUP_SCHEMA_NEWER_THAN_RUNTIME' : null,
        { backup_schema_version: manifestSchemaVersion, current_schema_version: currentSchemaVersion });
    } else {
      addCheck('TARGET_SCHEMA', 'UNKNOWN', 'BACKUP_SCHEMA_UNKNOWN');
    }

    let checkpointState = 'UNKNOWN';
    let forwardEventCount = null;
    if (eventSeqCheckpoint !== null) {
      if (eventSeqCheckpoint > currentEventSeq) {
        checkpointState = 'FAIL';
        addCheck('EVENT_CHECKPOINT', checkpointState, 'BACKUP_EVENT_CHECKPOINT_AHEAD', {
          backup_event_seq: eventSeqCheckpoint, current_event_seq: currentEventSeq,
        });
      } else {
        forwardEventCount = currentEventSeq - eventSeqCheckpoint;
        checkpointState = 'PASS';
        addCheck('EVENT_CHECKPOINT', checkpointState, null, { forward_event_count: forwardEventCount });
      }
    } else {
      addCheck('EVENT_CHECKPOINT', checkpointState, 'BACKUP_EVENT_CHECKPOINT_UNKNOWN');
    }

    if (externalObjectCount === 0) addCheck('EXTERNAL_REFERENCES', 'PASS');
    else if (externalObjectCount !== null) addCheck('EXTERNAL_REFERENCES', 'UNKNOWN', 'BACKUP_EXTERNAL_REFERENCES_REQUIRE_RECONCILIATION', { count: externalObjectCount });
    else addCheck('EXTERNAL_REFERENCES', 'UNKNOWN', 'BACKUP_EXTERNAL_REFERENCES_UNKNOWN');

    const hasFailure = checks.some((check) => check.state === 'FAIL');
    const hasUnknown = checks.some((check) => check.state === 'UNKNOWN');
    const preflightState = hasFailure ? 'FAIL' : hasUnknown ? 'UNKNOWN' : 'PASS';
    const nextStepCode = preflightState === 'FAIL'
      ? 'REPAIR_OR_RECREATE_BACKUP'
      : preflightState === 'UNKNOWN'
        ? 'RECONCILE_TARGET_AND_FORWARD_POLICY'
        : 'RECOVERY_ACTIVATION_NOT_IMPLEMENTED';
    return {
      backup: publicBackup(row),
      restore_estimate: {
        schema_version: BACKUP_RESTORE_ESTIMATE_SCHEMA_VERSION,
        preflight_state: preflightState,
        restore_allowed: false,
        activation_state: 'NOT_IMPLEMENTED',
        recovery_epoch_state: 'REQUIRED',
        forward_policy_reconciliation_state: 'UNKNOWN',
        next_step_code: nextStepCode,
        checks,
        artifact: {
          format_version: manifest?.format_version ?? null,
          backup_type: manifest?.backup_type ?? null,
          durability_class: manifest?.durability_class ?? row.durability_class ?? null,
          failure_domain: manifest?.failure_domain ?? row.failure_domain ?? null,
          schema_version: manifestSchemaVersion,
          event_seq_checkpoint: eventSeqCheckpoint,
          database_bytes: databaseByteSize,
          copied_object_bytes: copiedObjectBytes,
          copied_object_count: verification?.copiedCount ?? null,
          external_object_count: externalObjectCount,
          object_count: verification?.objectCount ?? null,
          byte_size: verifiedByteSize,
          manifest_sha256: verification?.manifestSha256 ?? null,
          database_sha256: verification?.dbSha256 ?? null,
        },
        target: {
          current_schema_version: currentSchemaVersion,
          current_event_seq: currentEventSeq,
          installation_state: installationState,
          schema_state: schemaState,
          checkpoint_state: checkpointState,
          forward_event_count: forwardEventCount,
        },
        estimated_restore_bytes: estimatedRestoreBytes,
        estimated_restore_duration_ms: estimatedRestoreDurationMs,
        duration_estimate_method: 'THEORETICAL_IO_ONLY_64_MIB_PER_SECOND',
        observed_restore_duration_ms: null,
        verification_error_code: verificationError?.code ?? null,
        generated_at: new Date().toISOString(),
      },
      projection_seq: currentEventSeq,
      generated_at: new Date().toISOString(),
    };
  }

  /**
   * Read-only recovery posture projection.
   *
   * This surface intentionally reports the evidence Core can prove without
   * pretending that the recovery epoch/external-side-effect ledger already
   * exists.  A healthy SQLite/Core process is therefore still UNKNOWN for
   * recovery activation until those controls are present and reconciled.
   * No rows, epochs, dispatch fences, or backup state are changed here.
   */
  _recoveryStatus() {
    const health = this._systemHealth();
    const checks = [];
    const addCheck = (id, state, code = null, details = {}) => {
      checks.push({
        id,
        state,
        ...(code ? { code } : {}),
        ...(Object.keys(details).length > 0 ? { details } : {}),
      });
    };

    addCheck(
      'CORE_OWNERSHIP',
      health.mutation_enabled === true ? 'PASS' : 'FAIL',
      health.mutation_enabled === true ? null : 'CORE_OWNERSHIP_NOT_ACTIVE',
      { state: String(health.ownership_state ?? 'UNKNOWN'), mutation_enabled: health.mutation_enabled === true },
    );
    addCheck(
      'DATABASE_INTEGRITY',
      String(health.integrity_check ?? '').toLowerCase() === 'ok' ? 'PASS' : 'FAIL',
      String(health.integrity_check ?? '').toLowerCase() === 'ok' ? null : 'DATABASE_INTEGRITY_FAILED',
      { result: String(health.integrity_check ?? 'UNKNOWN') },
    );
    addCheck(
      'SQLITE_WAL',
      health.wal_enabled === true ? 'PASS' : 'FAIL',
      health.wal_enabled === true ? null : 'WAL_DISABLED',
      { journal_mode: String(health.journal_mode ?? 'UNKNOWN') },
    );

    const availableBytes = health.backup_available_bytes;
    const estimatedBytes = health.backup_estimated_bytes;
    const storageEvidence = typeof availableBytes === 'number' && Number.isSafeInteger(availableBytes) && availableBytes >= 0
      && typeof estimatedBytes === 'number' && Number.isSafeInteger(estimatedBytes) && estimatedBytes >= 0;
    const storageState = health.storage_pressure === true ? 'FAIL' : storageEvidence ? 'PASS' : 'UNKNOWN';
    addCheck(
      'STORAGE_RESERVE',
      storageState,
      storageState === 'FAIL' ? 'STORAGE_PRESSURE' : storageState === 'UNKNOWN' ? 'STORAGE_CAPACITY_UNKNOWN' : null,
      storageEvidence ? { available_bytes: availableBytes, estimated_bytes: estimatedBytes } : {},
    );

    const latestBackup = this.db.prepare(`SELECT state, completed_at_utc_us
      FROM backups ORDER BY created_at_utc_us DESC, id DESC LIMIT 1`).get() ?? null;
    const latestBackupState = String(latestBackup?.state ?? '').toUpperCase();
    addCheck(
      'LATEST_BACKUP',
      latestBackupState === 'VERIFIED' ? 'PASS' : 'UNKNOWN',
      latestBackupState === 'VERIFIED' ? null : 'BACKUP_NOT_VERIFIED',
      latestBackup ? { state: latestBackupState, completed_at: latestBackup.completed_at_utc_us ? rfc3339FromUs(latestBackup.completed_at_utc_us) : null } : { state: 'MISSING' },
    );

    const eventSeq = Number(this._projectionSeq());
    addCheck(
      'EVENT_PROJECTION',
      Number.isSafeInteger(eventSeq) && eventSeq >= 0 ? 'PASS' : 'UNKNOWN',
      Number.isSafeInteger(eventSeq) && eventSeq >= 0 ? null : 'EVENT_PROJECTION_UNKNOWN',
      Number.isSafeInteger(eventSeq) && eventSeq >= 0 ? { event_seq: eventSeq } : {},
    );

    // These are explicit UNKNOWN controls, rather than inferred PASS values:
    // a Core ownership epoch is not a restore recovery epoch, and no local
    // project snapshot can prove the state of external side effects after it.
    addCheck('RECOVERY_EPOCH', 'UNKNOWN', 'RECOVERY_EPOCH_NOT_INITIALIZED');
    addCheck('EXTERNAL_REALITY_LEDGER', 'UNKNOWN', 'EXTERNAL_REALITY_LEDGER_NOT_IMPLEMENTED');

    const hasFailure = checks.some((check) => check.state === 'FAIL');
    const hasUnknown = checks.some((check) => check.state === 'UNKNOWN');
    const readinessState = hasFailure ? 'BLOCKED' : hasUnknown ? 'UNKNOWN' : 'PASS';
    return {
      schema_version: 1,
      readiness_state: readinessState,
      recovery_state: hasFailure ? 'BLOCKED' : hasUnknown ? 'RECONCILIATION_REQUIRED' : 'READY',
      core_health_state: String(health.status ?? 'UNKNOWN'),
      recovery_epoch_state: 'NOT_INITIALIZED',
      external_reality_state: 'UNKNOWN',
      restore_activation_state: 'NOT_IMPLEMENTED',
      dispatch_policy_state: 'UNKNOWN_REQUIRES_RECOVERY_EPOCH',
      read_only: true,
      next_step_code: hasFailure
        ? 'REPAIR_CORE_HEALTH_BEFORE_RECOVERY'
        : 'RECOVERY_EPOCH_AND_EXTERNAL_RECONCILIATION_REQUIRED',
      checks,
      projection_seq: Number.isSafeInteger(eventSeq) && eventSeq >= 0 ? eventSeq : 0,
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
      const requestEpoch = this._requestEpoch(request);
      if (requestEpoch !== null && requestEpoch !== this.instanceEpoch) {
        throw coreOwnershipError('CORE_EPOCH_STALE', 'errors.core_epoch_stale', {
          expected_epoch: this.instanceEpoch,
          received_epoch: requestEpoch,
        });
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
