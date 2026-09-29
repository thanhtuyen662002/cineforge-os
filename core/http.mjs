import http from 'node:http';
import crypto from 'node:crypto';

function statusFor(response) {
  if (response?.ok === undefined) return 200;
  if (response.ok) return 200;
  const code = response.error?.code;
  if (code === 'NOT_FOUND') return 404;
  if (['SOURCE_NOT_FOUND', 'ASSET_NOT_FOUND', 'ASSET_REVISION_NOT_FOUND', 'IMPORT_SESSION_NOT_FOUND', 'STAGING_NOT_FOUND', 'RIGHTS_IDENTITY_NOT_FOUND', 'BACKUP_NOT_FOUND', 'CHARACTER_NOT_FOUND', 'CHARACTER_REVISION_NOT_FOUND', 'CHARACTER_PACKAGE_NOT_FOUND', 'VISUAL_IDENTITY_PACKAGE_NOT_FOUND', 'VOICE_IDENTITY_PACKAGE_NOT_FOUND', 'PERFORMANCE_BIBLE_NOT_FOUND', 'MEDIA_PROFILE_NOT_FOUND', 'MEDIA_PROFILE_REVISION_NOT_FOUND', 'TIMELINE_NOT_FOUND', 'TIMELINE_REVISION_NOT_FOUND', 'TIMELINE_WORKING_SESSION_NOT_FOUND', 'TIMELINE_TRACK_NOT_FOUND', 'TIMELINE_CLIP_NOT_FOUND', 'REVIEW_SESSION_NOT_FOUND', 'HANDOFF_NOT_FOUND'].includes(code)) return 404;
  if (['STALE_REVISION', 'STALE_DECISION', 'STALE_REVIEW', 'EXPECTED_VERSION_REQUIRED', 'EXPECTED_DECISION_VERSION_REQUIRED', 'BASE_REVISION_VERSION_REQUIRED', 'DUPLICATE_PROJECT_CODE', 'DUPLICATE_SHOT_CODE', 'DUPLICATE_CHARACTER_CODE', 'DUPLICATE_TIMELINE_CODE', 'INVALID_STATE_TRANSITION', 'INVALID_MEDIA_PROFILE_TRANSITION', 'INVALID_TIMELINE_REVISION_TRANSITION', 'ENTITY_SCOPE_MISMATCH', 'HASH_MISMATCH', 'CONTENT_IDENTITY_CONFLICT', 'SOURCE_CHANGED_DURING_HASH', 'SOURCE_CHANGED_DURING_STAGE', 'STAGING_SOURCE_MISMATCH', 'INVALID_DECISION_CHOICE', 'DECISION_NOT_OPEN', 'STAGING_NOT_READY', 'STAGING_MISSING', 'STAGING_IDENTITY_CHANGED', 'STAGING_CONTENT_CHANGED', 'INVALID_STAGING_TRANSITION', 'RIGHTS_IDENTITY_EXISTS', 'RIGHTS_REQUIRED', 'RIGHTS_BLOCKED', 'VOICE_REVISION_RIGHTS_REQUIRED', 'ASSET_NOT_READY', 'TIMELINE_PROFILE_REQUIRED', 'TIMELINE_PROFILE_NOT_APPROVED', 'TIMELINE_ASSET_NOT_READY', 'TIMELINE_RIGHTS_BLOCKED', 'TIMELINE_REVISION_IMMUTABLE', 'REVIEW_SUBJECT_NOT_REVIEWABLE', 'REVIEW_ALREADY_OPEN', 'REVIEW_DECISION_IMMUTABLE', 'REVIEW_NOT_READY', 'REVIEW_REQUIRED_FOR_APPROVAL', 'REVIEW_SNAPSHOT_REQUIRED', 'REVIEW_NOT_SUBMITTED', 'REVIEW_APPROVAL_REQUIRED', 'HANDOFF_REVISION_NOT_APPROVED', 'HANDOFF_SNAPSHOT_REQUIRED', 'TIMELINE_WORKING_SESSION_ALREADY_OPEN', 'TIMELINE_WORKING_SESSION_NOT_EDITABLE', 'TIMELINE_WORKING_BASE_NOT_EDITABLE', 'TIMELINE_WORKING_BASE_HASH_MISMATCH', 'TIMELINE_WORKING_PROFILE_CHANGED', 'TIMELINE_WORKING_DRAFT_CORRUPT', 'TIMELINE_WORKING_HISTORY_CORRUPT', 'TIMELINE_DRAFT_NOT_AUTOSAVED', 'TIMELINE_WORKING_RECOVERY_REQUIRED', 'TIMELINE_WORKING_SESSION_CLOSED', 'TIMELINE_CLOSE_DISPOSITION_REQUIRED', 'TIMELINE_NO_UNDO', 'TIMELINE_NO_REDO', 'TIMELINE_EDIT_OP_ALREADY_EXISTS', 'TIMELINE_WORKING_OP_LIMIT', 'STORAGE_PRESSURE', 'STORAGE_CAPACITY_UNKNOWN', 'BACKUP_ALREADY_EXISTS', 'BACKUP_MEMORY_UNSUPPORTED', 'BACKUP_MANIFEST_TAMPERED', 'BACKUP_MANIFEST_INVALID', 'BACKUP_DATABASE_TAMPERED', 'BACKUP_DATABASE_CORRUPT', 'BACKUP_SCHEMA_MISMATCH', 'BACKUP_INSTALLATION_MISMATCH', 'BACKUP_OBJECT_TAMPERED', 'BACKUP_OBJECT_MISSING', 'BACKUP_OBJECT_CHANGED', 'BACKUP_SIZE_MISMATCH', 'BACKUP_OBJECT_INVALID', 'BACKUP_REPARSE_REJECTED', 'BACKUP_PATH_ESCAPE', 'BACKUP_FILE_UNREADABLE'].includes(code)) return 409;
  if (['SOURCE_HARDLINK_REJECTED', 'SOURCE_REPARSE_REJECTED'].includes(code)) return 400;
  if (response.error?.category === 'CONFLICT') return 409;
  if (response.error?.category === 'AUTH_REQUIRED') return 401;
  if (response.error?.category === 'INTERNAL') return 500;
  return 400;
}

function send(response, body, status = 200) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    // The server is loopback-only and does not use browser credentials. A
    // wildcard keeps the development Vite origin and the packaged same-origin
    // proxy on the same stable API contract.
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, authorization, idempotency-key',
    'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
  });
  response.end(payload);
}

function errorBody(code, messageKey, details = {}, options = {}) {
  return {
    request_id: null,
    ok: false,
    error: {
      code,
      category: options.category ?? 'VALIDATION',
      user_message_key: messageKey,
      user_message_args: options.messageArgs ?? {},
      retryable: Boolean(options.retryable),
      needs_user: Boolean(options.needsUser),
      decision_request_id: options.decisionRequestId ?? null,
      technical_details: details,
    },
    warnings: [],
  };
}

async function readBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) throw new Error('request body exceeds 1 MiB');
    chunks.push(chunk);
  }
  if (bytes === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function requestId(request) {
  return request.headers['x-request-id'] ?? crypto.randomUUID();
}

function expectedVersions(body, kind, fallback) {
  if (body.expected_versions ?? body.expectedVersions) return body.expected_versions ?? body.expectedVersions;
  const value = body.expected_version ?? body.expectedVersion ?? body.row_version ?? body.rowVersion ?? fallback;
  return value === undefined || value === null ? {} : { [kind]: value };
}

function readString(source, ...keys) {
  for (const key of keys) {
    if (typeof source?.[key] === 'string' && source[key].length > 0) return source[key];
  }
  return null;
}

// The HTTP surface is the presentation adapter consumed by the desktop shell.
// The underlying command/query JSON envelope remains available over stdio and
// through /v1/commands for advanced clients.
function mapProject(source) {
  const lifecycle = readString(source, 'lifecycle_state') ?? 'ACTIVE';
  const productionItems = Array.isArray(source?.production_items)
    ? source.production_items.map((item) => ({
      id: readString(item, 'id') ?? crypto.randomUUID(),
      title: readString(item, 'title') ?? 'Production item',
      detail: readString(item, 'detail') ?? 'Mới tạo · chưa bắt đầu',
      state: readString(item, 'state') ?? 'todo',
    })) : [];
  const completion = source?.completion && typeof source.completion === 'object'
    ? { done: Number(source.completion.done ?? 0), total: Number(source.completion.total ?? productionItems.length) }
    : { done: 0, total: productionItems.length };
  return {
    id: readString(source, 'id') ?? crypto.randomUUID(),
    name: readString(source, 'title', 'name') ?? 'CineForge project',
    kind: 'Project',
    updatedAt: readString(source, 'updated_at', 'updatedAt') ?? 'Vừa cập nhật',
    stage: lifecycle,
    stageDetail: readString(source, 'code') ?? '',
    cover: 'linear-gradient(145deg, #7664a9 0%, #35446a 56%, #171c2a 100%)',
    accent: '#b9a0ff',
    completion,
    health: readString(source, 'health_state', 'healthState') === 'BLOCKED' || lifecycle === 'TRASHED'
      ? 'blocked'
      : readString(source, 'health_state', 'healthState') === 'AT_RISK' ? 'attention' : 'healthy',
    nextAction: 'Mở dự án',
    nextActionLabel: 'Mở',
    storage: '—',
    productionItems,
  };
}

function mapDecision(source) {
  const value = source && typeof source === 'object' ? source : {};
  const projectId = readString(value, 'project_id', 'projectId');
  const projectName = readString(value, 'project_title', 'project_name', 'projectName') ?? (projectId ? projectId : 'CineForge');
  const title = readString(value, 'title') ?? readString(value, 'title_key') ?? 'Decision request';
  const reason = readString(value, 'reason') ?? readString(value, 'reason_key') ?? '';
  const severity = (readString(value, 'severity') ?? 'NORMAL').toUpperCase();
  const choices = Array.isArray(value.choices) ? value.choices.map((choice) => {
    const item = choice && typeof choice === 'object' ? choice : {};
    return {
      ...item,
      id: readString(item, 'id', 'choice_id') ?? crypto.randomUUID(),
      label_key: readString(item, 'label_key', 'label') ?? 'decision.choice',
      label: readString(item, 'label') ?? readString(item, 'label_key') ?? 'Choose',
      command_template: item.command_template ?? item.commandTemplate ?? {},
      consequence_summary: item.consequence_summary ?? item.consequenceSummary ?? {},
      recommended: Boolean(item.recommended),
    };
  }) : [];
  const recommended = choices.find((choice) => choice.recommended) ?? choices[0];
  const decisionVersion = Number(value.decision_version ?? value.decisionVersion ?? value.row_version ?? 1);
  return {
    ...value,
    id: readString(value, 'id') ?? crypto.randomUUID(),
    project_id: projectId,
    projectId,
    project_title: projectName,
    projectName,
    title,
    detail: readString(value, 'detail') ?? reason,
    reason,
    age: readString(value, 'age') ?? readString(value, 'created_at', 'createdAt') ?? '—',
    priority: severity === 'CRITICAL' || severity === 'HIGH' ? 'high' : 'normal',
    actionLabel: readString(value, 'action_label', 'actionLabel') ?? recommended?.label ?? 'Review',
    decision_version: Number.isSafeInteger(decisionVersion) && decisionVersion > 0 ? decisionVersion : 1,
    decisionVersion: Number.isSafeInteger(decisionVersion) && decisionVersion > 0 ? decisionVersion : 1,
    choices,
  };
}

function mapProductionItem(source, title) {
  return {
    id: readString(source, 'id') ?? readString(source, 'task_id') ?? crypto.randomUUID(),
    title: readString(source, 'title') ?? title,
    detail: 'Mới tạo · chưa bắt đầu',
    state: 'todo',
  };
}

function mapActivity(source, index) {
  const eventType = readString(source, 'event_type', 'eventType') ?? 'CORE_ACTIVITY';
  const normalized = eventType.toUpperCase();
  const state = readString(source, 'state')
    ?? (normalized.includes('BLOCK') ? 'blocked' : normalized.includes('NEEDS_USER') ? 'needs_user' : 'complete');
  const payload = source?.payload && typeof source.payload === 'object' ? source.payload : {};
  return {
    id: readString(source, 'id', 'event_id') ?? `activity-${index}`,
    projectId: readString(source, 'project_id', 'projectId'),
    projectName: readString(source, 'project_name', 'projectName', 'project_id', 'projectId') ?? 'CineForge',
    label: readString(source, 'label', 'title') ?? eventType,
    detail: readString(source, 'detail', 'description') ?? `Core recorded ${eventType.toLowerCase()}`,
    state,
    milestone: readString(source, 'milestone', 'message') ?? readString(payload, 'display_name', 'title'),
    updatedAt: readString(source, 'occurred_at', 'created_at', 'updated_at') ?? 'Vừa cập nhật',
    actionable: Boolean(source?.human_state?.needs_user || source?.needs_user),
  };
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let scaled = bytes / 1024;
  let unit = units[0];
  for (let index = 0; scaled >= 1024 && index < units.length - 1; index += 1) {
    scaled /= 1024;
    unit = units[index + 1];
  }
  return `${scaled.toFixed(scaled >= 10 ? 0 : 1)} ${unit}`;
}

function mapAsset(source) {
  const asset = source?.asset && typeof source.asset === 'object' ? source.asset : source;
  const revision = asset?.latest_revision ?? source?.revision ?? null;
  const storage = revision?.storage_object ?? null;
  return {
    id: readString(asset, 'id') ?? crypto.randomUUID(),
    projectId: readString(asset, 'project_id', 'projectId'),
    name: readString(asset, 'display_name', 'name') ?? 'Imported asset',
    assetType: readString(asset, 'asset_type', 'assetType') ?? 'GENERIC',
    originType: readString(asset, 'origin_type', 'originType') ?? 'IMPORTED',
    state: readString(asset, 'lifecycle_state', 'state') ?? 'ACTIVE',
    availability: readString(revision, 'availability_state', 'availability') ?? 'AVAILABLE',
    readinessState: readString(asset, 'readiness_state', 'readinessState') ?? readString(revision, 'readiness_state', 'readinessState') ?? 'UNKNOWN',
    revisionId: readString(revision, 'id', 'revision_id', 'revisionId'),
    hashAlgorithm: readString(storage, 'hash_algorithm', 'hashAlgorithm'),
    contentHash: readString(storage, 'content_hash', 'contentHash'),
    byteSize: Number(storage?.byte_size ?? 0),
    storageUri: readString(revision?.locations?.[0], 'path_or_uri', 'pathOrUri'),
    provenance: revision?.provenance ?? null,
    importSessionId: readString(source?.import_session, 'id'),
    importItemId: readString(source?.import_item, 'id'),
    warnings: Array.isArray(source?.warnings) ? source.warnings : [],
    rights: source?.rights ?? asset?.rights ?? null,
    latestRevision: revision,
  };
}

function mapAssetList(result) {
  return {
    generatedAt: result?.generated_at ?? new Date().toISOString(),
    assets: Array.isArray(result?.assets) ? result.assets.map((asset) => mapAsset(asset)) : [],
    projectionSeq: Number(result?.projection_seq ?? 0),
  };
}

// Character projections deliberately keep identity, visual, voice and
// performance data separate.  The adapter never exposes provider bindings or
// internal asset paths as part of the canonical character identity.
function mapCharacterRights(source) {
  const value = source && typeof source === 'object' && !Array.isArray(source) ? source : null;
  if (!value) return null;
  const statuses = new Set(['ALLOWED', 'RESTRICTED', 'UNKNOWN', 'REVOKED', 'EXPIRED']);
  const statusCandidate = String(value.status ?? value.state ?? 'UNKNOWN').toUpperCase();
  const status = statuses.has(statusCandidate) ? statusCandidate : 'UNKNOWN';
  const safeItems = (items) => Array.isArray(items) ? items.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const safe = {};
    for (const key of ['code', 'dimension', 'status', 'evidence_id', 'id']) {
      if (typeof item[key] === 'string' && item[key].length > 0) safe[key] = item[key];
    }
    return safe;
  }).filter((item) => item && Object.keys(item).length > 0) : [];
  return {
    status,
    state: status,
    eligible: value.eligible === true,
    rights_identity_id: typeof value.rights_identity_id === 'string' ? value.rights_identity_id : null,
    right_type: typeof value.right_type === 'string' ? value.right_type : null,
    consent_type: typeof value.consent_type === 'string' ? value.consent_type : null,
    right_status: statuses.has(String(value.right_status ?? '').toUpperCase()) ? String(value.right_status).toUpperCase() : 'UNKNOWN',
    consent_status: statuses.has(String(value.consent_status ?? '').toUpperCase()) ? String(value.consent_status).toUpperCase() : 'UNKNOWN',
    blockers: safeItems(value.blockers),
    evidence: safeItems(value.evidence),
    evaluated_at: readString(value, 'evaluated_at', 'evaluatedAt'),
  };
}

function mapRevision(source, kind = 'revision') {
  const value = source && typeof source === 'object' ? source : {};
  const revision = value.revision && typeof value.revision === 'object' ? value.revision : value;
  const result = {
    id: readString(revision, 'id', 'revision_id', 'revisionId'),
    revisionNumber: Number(revision.revision_number ?? revision.revisionNumber ?? revision.version ?? 0) || undefined,
    state: readString(revision, 'state', 'lifecycle_state', 'lifecycleState') ?? 'DRAFT',
    approvalState: readString(revision, 'approval_state', 'approvalState'),
    createdAt: readString(revision, 'created_at', 'createdAt'),
    updatedAt: readString(revision, 'updated_at', 'updatedAt'),
    semanticDescription: readString(revision, 'semantic_description', 'semanticDescription', 'description'),
    readinessState: readString(revision, 'readiness_state', 'readinessState'),
    nextStep: readString(revision, 'next_step', 'nextStep'),
    kind,
  };
  if (kind === 'visual') {
    result.referenceCount = Array.isArray(revision.references ?? revision.visual_identity_references)
      ? (revision.references ?? revision.visual_identity_references).length : Number(revision.reference_count ?? revision.referenceCount ?? 0) || 0;
    result.rightsStatus = readString(revision, 'rights_status', 'rightsStatus');
  }
  if (kind === 'voice') {
    result.canonicalLanguage = readString(revision, 'canonical_language', 'canonicalLanguage', 'language');
    const rights = revision.rights && typeof revision.rights === 'object' && !Array.isArray(revision.rights) ? revision.rights : {};
    result.rightsStatus = readString(revision, 'rights_status', 'rightsStatus') ?? readString(rights, 'status', 'state');
    result.rights = mapCharacterRights(rights);
    result.rightsIdentityId = readString(revision, 'rights_identity_id', 'rightsIdentityId');
    result.bindingState = readString(revision, 'binding_state', 'bindingState');
  }
  if (kind === 'performance') {
    result.behaviorSummary = readString(revision, 'behavior_summary', 'behaviorSummary');
  }
  return Object.fromEntries(Object.entries(result).filter(([, item]) => item !== undefined));
}

function mapCharacter(source) {
  const value = source && typeof source === 'object' ? source : {};
  const identity = value.character && typeof value.character === 'object' ? value.character
    : value.identity && typeof value.identity === 'object' ? value.identity : value;
  const visualRevisions = Array.isArray(value.visual_revisions ?? value.visualIdentityRevisions)
    ? (value.visual_revisions ?? value.visualIdentityRevisions).map((item) => mapRevision(item, 'visual')) : [];
  const voiceRevisions = Array.isArray(value.voice_revisions ?? value.voiceIdentityRevisions)
    ? (value.voice_revisions ?? value.voiceIdentityRevisions).map((item) => mapRevision(item, 'voice')) : [];
  const performanceRevisions = Array.isArray(value.performance_bible_revisions ?? value.performanceBibleRevisions)
    ? (value.performance_bible_revisions ?? value.performanceBibleRevisions).map((item) => mapRevision(item, 'performance')) : [];
  const visual = value.visual_identity_package ?? value.visualIdentityPackage ?? value.visual_identity;
  const voice = value.voice_identity_package ?? value.voiceIdentityPackage ?? value.voice_identity;
  const performance = value.performance_bible_package ?? value.performanceBiblePackage ?? value.performance_bible;
  const visualApproved = Boolean(visual && typeof visual === 'object' && (visual.approved_revision || visual.approvedRevision
    || String(visual.lifecycle_state ?? visual.state ?? '').toUpperCase() === 'APPROVED'));
  const voiceApproved = Boolean(voice && typeof voice === 'object' && (voice.approved_revision || voice.approvedRevision
    || String(voice.lifecycle_state ?? voice.state ?? '').toUpperCase() === 'APPROVED'));
  const performanceApproved = Boolean(performance && typeof performance === 'object' && (performance.approved_revision || performance.approvedRevision
    || String(performance.lifecycle_state ?? performance.state ?? '').toUpperCase() === 'APPROVED'));
  return {
    id: readString(identity, 'id', 'character_id', 'characterId') ?? crypto.randomUUID(),
    projectId: readString(identity, 'project_id', 'projectId'),
    stableCode: readString(identity, 'stable_code', 'stableCode', 'code'),
    displayName: readString(identity, 'display_name', 'displayName', 'name') ?? 'Character',
    lifecycleState: readString(identity, 'lifecycle_state', 'lifecycleState', 'state') ?? 'ACTIVE',
    rowVersion: Number(identity.row_version ?? identity.rowVersion ?? 1) || 1,
    createdAt: readString(identity, 'created_at', 'createdAt'),
    updatedAt: readString(identity, 'updated_at', 'updatedAt'),
    visualIdentityPackage: visual && typeof visual === 'object' ? {
      id: readString(visual, 'id', 'package_id', 'packageId'),
      approvedRevision: visual.approved_revision || visual.approvedRevision || (String(visual.lifecycle_state ?? visual.state ?? '').toUpperCase() === 'APPROVED' ? visual : null)
        ? mapRevision(visual.approved_revision ?? visual.approvedRevision ?? visual, 'visual') : null,
      candidateRevisions: Array.isArray(visual.candidate_revisions ?? visual.candidateRevisions)
        ? (visual.candidate_revisions ?? visual.candidateRevisions).map((item) => mapRevision(item, 'visual'))
        : visualApproved ? [] : visualRevisions.length ? visualRevisions : [mapRevision(visual, 'visual')],
    } : (visualRevisions.length ? { approvedRevision: null, candidateRevisions: visualRevisions } : null),
    voiceIdentityPackage: voice && typeof voice === 'object' ? {
      id: readString(voice, 'id', 'package_id', 'packageId'),
      approvedRevision: voice.approved_revision || voice.approvedRevision || (String(voice.lifecycle_state ?? voice.state ?? '').toUpperCase() === 'APPROVED' ? voice : null)
        ? mapRevision(voice.approved_revision ?? voice.approvedRevision ?? voice, 'voice') : null,
      candidateRevisions: Array.isArray(voice.candidate_revisions ?? voice.candidateRevisions)
        ? (voice.candidate_revisions ?? voice.candidateRevisions).map((item) => mapRevision(item, 'voice'))
        : voiceApproved ? [] : voiceRevisions.length ? voiceRevisions : [mapRevision(voice, 'voice')],
    } : (voiceRevisions.length ? { approvedRevision: null, candidateRevisions: voiceRevisions } : null),
    performanceBible: performance && typeof performance === 'object' ? {
      id: readString(performance, 'id', 'performance_bible_id', 'performanceBibleId'),
      approvedRevision: performance.approved_revision || performance.approvedRevision || (String(performance.lifecycle_state ?? performance.state ?? '').toUpperCase() === 'APPROVED' ? performance : null)
        ? mapRevision(performance.approved_revision ?? performance.approvedRevision ?? performance, 'performance') : null,
      candidateRevisions: Array.isArray(performance.candidate_revisions ?? performance.candidateRevisions)
        ? (performance.candidate_revisions ?? performance.candidateRevisions).map((item) => mapRevision(item, 'performance'))
        : performanceApproved ? [] : performanceRevisions.length ? performanceRevisions : [mapRevision(performance, 'performance')],
    } : (performanceRevisions.length ? { approvedRevision: null, candidateRevisions: performanceRevisions } : null),
    // Costume/prop/continuity and provider-facing usage objects are outside
    // this bounded canon surface. Do not forward arbitrary nested data across
    // the HTTP boundary before their own redaction contracts exist.
    costumeState: null,
    propState: null,
    continuityState: null,
    rights: null,
    usage: null,
    needsYou: Array.isArray(value.needs_you ?? value.needsYou) ? (value.needs_you ?? value.needsYou) : [],
  };
}

function mapCharacterList(result) {
  const value = result && typeof result === 'object' ? result : {};
  const rows = Array.isArray(result) ? result : value.characters ?? value.items ?? value.results ?? [];
  return {
    generatedAt: readString(value, 'generated_at', 'generatedAt') ?? new Date().toISOString(),
    projectionSeq: Number(value.projection_seq ?? value.projectionSeq ?? 0),
    characters: Array.isArray(rows) ? rows.map(mapCharacter) : [],
  };
}

function mapCharacterWorkspace(result) {
  const value = result && typeof result === 'object' ? result : {};
  const characterSource = value.character ?? value.identity ?? value;
  return {
    // Workspace responses commonly keep the identity under `character` and
    // revision collections beside it. Merge those read-model pieces before
    // projecting so the UI receives one coherent workspace without exposing
    // storage/provider internals.
    character: mapCharacter({ ...value, ...(characterSource && typeof characterSource === 'object' ? characterSource : {}) }),
    generatedAt: readString(value, 'generated_at', 'generatedAt') ?? new Date().toISOString(),
    projectionSeq: Number(value.projection_seq ?? value.projectionSeq ?? 0),
    // Keep the bounded workspace projection closed over canon metadata. Any
    // future usage/rights summary needs its own allowlist before crossing HTTP.
    usage: null,
    rights: null,
    needsYou: Array.isArray(value.needs_you ?? value.needsYou) ? (value.needs_you ?? value.needsYou) : [],
  };
}

function safeRational(value, numKey = 'num', denKey = 'den') {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const num = source[numKey] ?? source.num ?? source.numerator;
  const den = source[denKey] ?? source.den ?? source.denominator;
  const valid = (item) => (typeof item === 'number' && Number.isSafeInteger(item)) || (typeof item === 'string' && /^-?[0-9]+$/.test(item));
  if (!valid(num) || !valid(den) || String(den) === '0') return null;
  return { num, den };
}

function mapMediaProfileRevision(source) {
  const value = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  const timelineRate = safeRational(value.timeline_rate ?? value.timelineRate) ?? safeRational({
    num: value.timeline_rate_num ?? value.timelineRateNum,
    den: value.timeline_rate_den ?? value.timelineRateDen,
  });
  const timeBase = safeRational(value.time_base ?? value.timeBase) ?? safeRational({
    num: value.time_base_num ?? value.timeBaseNum,
    den: value.time_base_den ?? value.timeBaseDen,
  });
  const pixelAspect = safeRational(value.pixel_aspect ?? value.pixelAspect) ?? safeRational({
    num: value.pixel_aspect_num ?? value.pixelAspectNum,
    den: value.pixel_aspect_den ?? value.pixelAspectDen,
  });
  return {
    id: readString(value, 'id', 'revision_id', 'revisionId'),
    profileId: readString(value, 'profile_id', 'profileId'),
    projectId: readString(value, 'project_id', 'projectId'),
    revisionNumber: Number.isSafeInteger(Number(value.revision_number ?? value.revisionNumber)) ? Number(value.revision_number ?? value.revisionNumber) : undefined,
    state: readString(value, 'lifecycle_state', 'lifecycleState', 'state') ?? 'DRAFT',
    rowVersion: Number.isSafeInteger(Number(value.row_version ?? value.rowVersion)) ? Number(value.row_version ?? value.rowVersion) : 1,
    timelineRate: timelineRate ?? { num: 0, den: 1 },
    timeBase: timeBase ?? { num: 0, den: 1 },
    dropFramePolicy: readString(value, 'drop_frame_policy', 'dropFramePolicy') ?? 'UNKNOWN',
    width: Number.isSafeInteger(Number(value.width)) ? Number(value.width) : 0,
    height: Number.isSafeInteger(Number(value.height)) ? Number(value.height) : 0,
    pixelAspect: pixelAspect ?? { num: 0, den: 1 },
    workingColorSpace: readString(value, 'working_color_space', 'workingColorSpace') ?? 'UNKNOWN',
    transferFunction: readString(value, 'transfer_function', 'transferFunction') ?? 'UNKNOWN',
    hdrPolicy: readString(value, 'hdr_policy', 'hdrPolicy') ?? 'UNKNOWN',
    audioSampleRate: Number.isSafeInteger(Number(value.audio_sample_rate ?? value.audioSampleRate)) ? Number(value.audio_sample_rate ?? value.audioSampleRate) : 0,
    audioChannelLayout: readString(value, 'audio_channel_layout', 'audioChannelLayout') ?? 'UNKNOWN',
    createdAt: readString(value, 'created_at', 'createdAt'),
  };
}

function mapMediaProfileWorkspace(result) {
  const value = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
  const profileValue = value.profile ?? value.media_profile ?? value.mediaProfile ?? value;
  const revisions = Array.isArray(profileValue.revisions ?? value.revisions)
    ? (profileValue.revisions ?? value.revisions).map(mapMediaProfileRevision)
    : [];
  const approved = value.approved_revision ?? value.approvedRevision ?? profileValue.approved_revision ?? profileValue.approvedRevision;
  const candidates = value.candidate_revisions ?? value.candidateRevisions ?? profileValue.candidate_revisions ?? profileValue.candidateRevisions;
  return {
    profile: {
      id: readString(profileValue, 'id', 'profile_id', 'profileId'),
      projectId: readString(profileValue, 'project_id', 'projectId') ?? readString(value, 'project_id', 'projectId'),
    },
    revisions,
    approvedRevision: approved ? mapMediaProfileRevision(approved) : revisions.find((item) => item.state === 'APPROVED') ?? null,
    candidateRevisions: Array.isArray(candidates) ? candidates.map(mapMediaProfileRevision) : revisions.filter((item) => ['DRAFT', 'CANDIDATE'].includes(item.state)),
    projectionSeq: Number(value.projection_seq ?? value.projectionSeq ?? 0),
    generatedAt: readString(value, 'generated_at', 'generatedAt') ?? new Date().toISOString(),
  };
}

function mapTimelineMarker(source, includePayload = false) {
  const value = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  const time = safeRational(value.time ?? value.position) ?? safeRational({ num: value.time_num ?? value.timeNum, den: value.time_den ?? value.timeDen });
  return {
    id: readString(value, 'id', 'marker_id', 'markerId'),
    time: time ?? { num: 0, den: 1 },
    markerType: readString(value, 'marker_type', 'markerType', 'type') ?? 'NOTE',
    label: readString(value, 'label', 'name') ?? '',
    ...(includePayload ? { payload: value.payload && typeof value.payload === 'object' && !Array.isArray(value.payload) ? value.payload : {} } : {}),
  };
}

function mapTimelineClip(source) {
  const value = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  const rational = (nested, prefix) => safeRational(value[nested]) ?? safeRational({ num: value[`${prefix}_num`], den: value[`${prefix}_den`] });
  return {
    id: readString(value, 'id', 'clip_id', 'clipId'),
    assetRevisionId: readString(value, 'asset_revision_id', 'assetRevisionId'),
    timelineIn: rational('timeline_in', 'timeline_in') ?? { num: 0, den: 1 },
    timelineOut: rational('timeline_out', 'timeline_out') ?? { num: 0, den: 1 },
    sourceIn: rational('source_in', 'source_in'),
    sourceOut: rational('source_out', 'source_out'),
    speed: rational('speed', 'speed') ?? { num: 1, den: 1 },
    label: readString(value, 'label', 'name', 'display_name', 'displayName') ?? undefined,
  };
}

function mapTimelineTrack(source) {
  const value = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  return {
    id: readString(value, 'id', 'track_id', 'trackId'),
    trackType: readString(value, 'track_type', 'trackType', 'type') ?? 'VIDEO',
    orderIndex: Number.isSafeInteger(Number(value.order_index ?? value.orderIndex)) ? Number(value.order_index ?? value.orderIndex) : 0,
    name: readString(value, 'name') ?? 'Track',
    enabled: value.enabled !== false,
    clips: Array.isArray(value.clips ?? value.clip_instances ?? value.clipInstances)
      ? (value.clips ?? value.clip_instances ?? value.clipInstances).map(mapTimelineClip)
      : [],
  };
}

function mapTimelineRevision(source) {
  const value = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  const duration = safeRational(value.duration) ?? safeRational({ num: value.duration_num ?? value.durationNum, den: value.duration_den ?? value.durationDen });
  const tracks = Array.isArray(value.tracks ?? value.timeline_tracks ?? value.timelineTracks)
    ? (value.tracks ?? value.timeline_tracks ?? value.timelineTracks).map(mapTimelineTrack)
    : [];
  return {
    id: readString(value, 'id', 'timeline_revision_id', 'timelineRevisionId'),
    timelineId: readString(value, 'timeline_id', 'timelineId'),
    mediaProfileRevisionId: readString(value, 'media_profile_revision_id', 'mediaProfileRevisionId'),
    revisionNumber: Number.isSafeInteger(Number(value.revision_number ?? value.revisionNumber)) ? Number(value.revision_number ?? value.revisionNumber) : undefined,
    state: readString(value, 'lifecycle_state', 'lifecycleState', 'state') ?? 'DRAFT_CHECKPOINT',
    rowVersion: Number.isSafeInteger(Number(value.row_version ?? value.rowVersion)) ? Number(value.row_version ?? value.rowVersion) : 1,
    duration: duration ?? { num: 0, den: 1 },
    editHash: readString(value, 'edit_hash', 'editHash', 'content_hash', 'contentHash'),
    tracks,
    markers: Array.isArray(value.markers ?? value.timeline_markers ?? value.timelineMarkers)
      ? (value.markers ?? value.timeline_markers ?? value.timelineMarkers).map(mapTimelineMarker)
      : [],
    readinessState: readString(value, 'readiness_state', 'readinessState') ?? 'UNKNOWN',
    nextStep: readString(value, 'next_step', 'nextStep'),
    createdAt: readString(value, 'created_at', 'createdAt'),
  };
}

function mapTimeline(source) {
  const value = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  return {
    id: readString(value, 'id', 'timeline_id', 'timelineId'),
    projectId: readString(value, 'project_id', 'projectId'),
    scopeType: readString(value, 'scope_type', 'scopeType') ?? 'PROJECT',
    scopeId: readString(value, 'scope_id', 'scopeId'),
    code: readString(value, 'code', 'stable_code', 'stableCode'),
    title: readString(value, 'title', 'name') ?? 'Timeline',
    state: readString(value, 'lifecycle_state', 'lifecycleState', 'state') ?? 'ACTIVE',
    rowVersion: Number.isSafeInteger(Number(value.row_version ?? value.rowVersion)) ? Number(value.row_version ?? value.rowVersion) : 1,
    createdAt: readString(value, 'created_at', 'createdAt'),
    updatedAt: readString(value, 'updated_at', 'updatedAt'),
  };
}

function mapTimelineList(result) {
  const value = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
  const rows = Array.isArray(result) ? result : value.timelines ?? value.items ?? value.results ?? [];
  return {
    timelines: Array.isArray(rows) ? rows.map(mapTimeline) : [],
    generatedAt: readString(value, 'generated_at', 'generatedAt') ?? new Date().toISOString(),
    projectionSeq: Number(value.projection_seq ?? value.projectionSeq ?? 0),
  };
}

function mapTimelineWorkspace(result) {
  const value = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
  const timelineValue = value.timeline ?? value;
  const revisionValues = value.revisions ?? value.timeline_revisions ?? value.timelineRevisions;
  const revisions = Array.isArray(revisionValues) ? revisionValues.map(mapTimelineRevision) : [];
  // Core's command projection intentionally returns one immutable `revision`
  // plus the pinned media profile revision. Accept both that compact shape and
  // the expanded workspace shape used by list/query consumers.
  const singleRevision = value.revision ?? value.timeline_revision ?? value.timelineRevision;
  const currentValue = value.current_revision ?? value.currentRevision ?? value.approved_revision ?? value.approvedRevision ?? singleRevision;
  const mappedCurrent = currentValue ? mapTimelineRevision(currentValue) : null;
  const allRevisions = mappedCurrent && !revisions.some((revision) => revision.id && revision.id === mappedCurrent.id)
    ? [mappedCurrent, ...revisions]
    : revisions;
  const profileRevision = value.media_profile_revision ?? value.mediaProfileRevision;
  const profileValue = value.media_profile ?? value.mediaProfile
    ?? (profileRevision ? {
      profile: {
        id: profileRevision.profile_id ?? profileRevision.profileId,
        project_id: profileRevision.project_id ?? profileRevision.projectId,
      },
      revisions: [profileRevision],
      approved_revision: profileRevision.state === 'APPROVED' ? profileRevision : undefined,
      candidate_revisions: ['DRAFT', 'CANDIDATE'].includes(String(profileRevision.state ?? '').toUpperCase()) ? [profileRevision] : [],
    } : null);
  return {
    timeline: mapTimeline(timelineValue),
    mediaProfile: profileValue ? mapMediaProfileWorkspace(profileValue) : null,
    revisions: allRevisions,
    currentRevision: mappedCurrent ?? allRevisions.find((item) => item.state === 'APPROVED') ?? allRevisions[0] ?? null,
    needsYou: Array.isArray(value.needs_you ?? value.needsYou) ? (value.needs_you ?? value.needsYou) : [],
    projectionSeq: Number(value.projection_seq ?? value.projectionSeq ?? 0),
    generatedAt: readString(value, 'generated_at', 'generatedAt') ?? new Date().toISOString(),
  };
}

function mapTimelineWorkingDraft(source) {
  const value = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  const tracks = Array.isArray(value.tracks ?? value.timeline_tracks ?? value.timelineTracks)
    ? (value.tracks ?? value.timeline_tracks ?? value.timelineTracks).map(mapTimelineTrack) : [];
  const markers = Array.isArray(value.markers ?? value.timeline_markers ?? value.timelineMarkers)
    ? (value.markers ?? value.timeline_markers ?? value.timelineMarkers).map((marker) => mapTimelineMarker(marker, true)) : [];
  const duration = safeRational(value.duration) ?? safeRational({ num: value.duration_num ?? value.durationNum, den: value.duration_den ?? value.durationDen });
  return {
    schemaVersion: Number(value.schema_version ?? value.schemaVersion ?? 1),
    mediaProfileRevisionId: readString(value, 'media_profile_revision_id', 'mediaProfileRevisionId'),
    duration: duration ?? { num: 0, den: 1 },
    tracks,
    markers,
  };
}

function mapTimelineWorkingSession(source) {
  const value = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  const operations = Array.isArray(value.operations) ? value.operations.map((operation) => ({
    id: readString(operation, 'id'),
    opSeq: Number(operation.op_seq ?? operation.opSeq ?? 0),
    opType: readString(operation, 'op_type', 'opType') ?? 'UNKNOWN',
    historyState: readString(operation, 'history_state', 'historyState') ?? 'ACTIVE',
    resultHash: readString(operation, 'result_hash', 'resultHash'),
    actorId: readString(operation, 'actor_id', 'actorId'),
    createdAt: readString(operation, 'created_at', 'createdAt'),
  })) : [];
  const historyActions = Array.isArray(value.history_actions ?? value.historyActions) ? (value.history_actions ?? value.historyActions).map((action) => ({
    id: readString(action, 'id'),
    actionSeq: Number(action.action_seq ?? action.actionSeq ?? 0),
    actionType: readString(action, 'action_type', 'actionType') ?? 'UNKNOWN',
    targetOpSeq: action.target_op_seq ?? action.targetOpSeq ?? null,
    targetOpId: readString(action, 'target_op_id', 'targetOpId'),
    beforeHash: readString(action, 'before_hash', 'beforeHash'),
    afterHash: readString(action, 'after_hash', 'afterHash'),
    actorId: readString(action, 'actor_id', 'actorId'),
    createdAt: readString(action, 'created_at', 'createdAt'),
  })) : [];
  return {
    id: readString(value, 'id', 'working_session_id', 'workingSessionId'),
    timelineId: readString(value, 'timeline_id', 'timelineId'),
    baseRevisionId: readString(value, 'base_revision_id', 'baseRevisionId'),
    baseRevisionRowVersion: Number(value.base_revision_row_version ?? value.baseRevisionRowVersion ?? 0),
    baseContentHash: readString(value, 'base_content_hash', 'baseContentHash'),
    actorId: readString(value, 'actor_id', 'actorId'),
    clientInstanceId: readString(value, 'client_instance_id', 'clientInstanceId'),
    mode: readString(value, 'mode') ?? 'EXCLUSIVE',
    state: readString(value, 'state') ?? 'UNKNOWN',
    draftHash: readString(value, 'draft_hash', 'draftHash'),
    autosavedHash: readString(value, 'autosaved_hash', 'autosavedHash'),
    draft: mapTimelineWorkingDraft(value.draft),
    lastAcknowledgedOpSeq: Number(value.last_acknowledged_op_seq ?? value.lastAcknowledgedOpSeq ?? 0),
    historyCursorSeq: Number(value.history_cursor_seq ?? value.historyCursorSeq ?? 0),
    nextOpSeq: Number(value.next_op_seq ?? value.nextOpSeq ?? 1),
    lastCheckpointRevisionId: readString(value, 'last_checkpoint_revision_id', 'lastCheckpointRevisionId'),
    nextStep: readString(value, 'next_step', 'nextStep'),
    rowVersion: Number(value.row_version ?? value.rowVersion ?? 1),
    lastAutosaveAt: readString(value, 'last_autosave_at', 'lastAutosaveAt'),
    createdAt: readString(value, 'created_at', 'createdAt'),
    updatedAt: readString(value, 'updated_at', 'updatedAt'),
    closedAt: readString(value, 'closed_at', 'closedAt'),
    operations,
    historyActions,
  };
}

function mapTimelineWorkingWorkspace(result) {
  const value = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
  const mapOperationRef = (operation) => {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) return null;
    return {
      id: readString(operation, 'id'),
      opSeq: Number(operation.op_seq ?? operation.opSeq ?? 0),
      opType: readString(operation, 'op_type', 'opType') ?? 'UNKNOWN',
    };
  };
  return {
    timeline: value.timeline ? mapTimeline(value.timeline) : null,
    session: value.session ? mapTimelineWorkingSession(value.session) : null,
    checkpointRevision: value.checkpoint_revision || value.checkpointRevision ? mapTimelineRevision(value.checkpoint_revision ?? value.checkpointRevision) : null,
    checkpointRevisionId: readString(value, 'checkpoint_revision_id', 'checkpointRevisionId'),
    acceptedOperations: Array.isArray(value.accepted_operations ?? value.acceptedOperations) ? (value.accepted_operations ?? value.acceptedOperations).map((operation) => ({
      id: readString(operation, 'id'),
      opSeq: Number(operation.op_seq ?? operation.opSeq ?? 0),
      opType: readString(operation, 'op_type', 'opType'),
      resultHash: readString(operation, 'result_hash', 'resultHash'),
      clientOpId: readString(operation, 'client_op_id', 'clientOpId'),
    })) : [],
    timelineRowVersion: Number(value.timeline_row_version ?? value.timelineRowVersion ?? 0),
    impactSummary: value.impact_summary ?? value.impactSummary ?? null,
    undoneOperation: mapOperationRef(value.undone_operation ?? value.undoneOperation),
    redoneOperation: mapOperationRef(value.redone_operation ?? value.redoneOperation),
    projectionSeq: Number(value.projection_seq ?? value.projectionSeq ?? 0),
    generatedAt: readString(value, 'generated_at', 'generatedAt') ?? new Date().toISOString(),
  };
}

function mapTimelineWorkingHistory(result) {
  const value = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
  const mapOperation = (operation) => ({
    id: readString(operation, 'id'),
    opSeq: Number(operation.op_seq ?? operation.opSeq ?? 0),
    opType: readString(operation, 'op_type', 'opType') ?? 'UNKNOWN',
    historyState: readString(operation, 'history_state', 'historyState') ?? 'ACTIVE',
    resultHash: readString(operation, 'result_hash', 'resultHash'),
    actorId: readString(operation, 'actor_id', 'actorId'),
    createdAt: readString(operation, 'created_at', 'createdAt'),
  });
  const mapAction = (action) => ({
    id: readString(action, 'id'),
    actionSeq: Number(action.action_seq ?? action.actionSeq ?? 0),
    actionType: readString(action, 'action_type', 'actionType') ?? 'UNKNOWN',
    targetOpSeq: action.target_op_seq ?? action.targetOpSeq ?? null,
    targetOpId: readString(action, 'target_op_id', 'targetOpId'),
    beforeHash: readString(action, 'before_hash', 'beforeHash'),
    afterHash: readString(action, 'after_hash', 'afterHash'),
    actorId: readString(action, 'actor_id', 'actorId'),
    createdAt: readString(action, 'created_at', 'createdAt'),
  });
  return {
    timeline: value.timeline ? mapTimeline(value.timeline) : null,
    workingSessionId: readString(value, 'working_session_id', 'workingSessionId'),
    operations: Array.isArray(value.operations) ? value.operations.map(mapOperation) : [],
    historyActions: Array.isArray(value.history_actions ?? value.historyActions) ? (value.history_actions ?? value.historyActions).map(mapAction) : [],
    cursor: value.cursor && typeof value.cursor === 'object' ? {
      afterOpSeq: Number(value.cursor.after_op_seq ?? value.cursor.afterOpSeq ?? 0),
      hasMore: Boolean(value.cursor.has_more ?? value.cursor.hasMore),
    } : { afterOpSeq: 0, hasMore: false },
    projectionSeq: Number(value.projection_seq ?? value.projectionSeq ?? 0),
    generatedAt: readString(value, 'generated_at', 'generatedAt') ?? new Date().toISOString(),
  };
}

// Preserve the command gate's replay evidence while redacting the nested
// working-session projection.  Idempotency is part of the public command
// contract; dropping it at the presentation boundary makes a successful
// retry indistinguishable from a second mutation to packaged clients.
function mapTimelineWorkingCommandResult(result) {
  const mapped = mapTimelineWorkingWorkspace(result);
  if (result && typeof result === 'object' && result.idempotent_replay === true) mapped.idempotent_replay = true;
  return mapped;
}

function mapHumanReview(source) {
  const value = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  return {
    id: readString(value, 'id', 'human_review_id', 'humanReviewId'),
    reviewSessionId: readString(value, 'review_session_id', 'reviewSessionId'),
    decision: readString(value, 'decision') ?? 'ABSTAIN',
    notes: readString(value, 'notes') ?? '',
    reasonCodes: Array.isArray(value.reason_codes ?? value.reasonCodes) ? (value.reason_codes ?? value.reasonCodes) : [],
    dependencySnapshotHash: readString(value, 'dependency_snapshot_hash', 'dependencySnapshotHash'),
    subjectContentHash: readString(value, 'subject_content_hash', 'subjectContentHash'),
    reviewerActorId: readString(value, 'reviewer_actor_id', 'reviewerActorId'),
    reviewedAt: readString(value, 'reviewed_at', 'reviewedAt'),
  };
}

function mapReviewSession(source) {
  const value = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  const humanReview = value.human_review ?? value.humanReview;
  return {
    id: readString(value, 'id', 'review_session_id', 'reviewSessionId'),
    projectId: readString(value, 'project_id', 'projectId'),
    subjectType: readString(value, 'subject_type', 'subjectType') ?? 'TIMELINE_REVISION',
    subjectId: readString(value, 'subject_id', 'subjectId'),
    subjectRevisionId: readString(value, 'subject_revision_id', 'subjectRevisionId'),
    representationAssetRevisionId: readString(value, 'representation_asset_revision_id', 'representationAssetRevisionId'),
    dependencySnapshotHash: readString(value, 'dependency_snapshot_hash', 'dependencySnapshotHash'),
    subjectContentHash: readString(value, 'subject_content_hash', 'subjectContentHash'),
    mediaProfileRevisionId: readString(value, 'media_profile_revision_id', 'mediaProfileRevisionId'),
    state: readString(value, 'review_state', 'reviewState', 'state') ?? 'UNKNOWN',
    stale: Boolean(value.stale),
    reviewerActorId: readString(value, 'reviewer_actor_id', 'reviewerActorId'),
    openedAt: readString(value, 'opened_at', 'openedAt'),
    submittedAt: readString(value, 'submitted_at', 'submittedAt'),
    rowVersion: Number.isSafeInteger(Number(value.row_version ?? value.rowVersion)) ? Number(value.row_version ?? value.rowVersion) : 1,
    nextStep: readString(value, 'next_step', 'nextStep'),
    humanReview: humanReview ? mapHumanReview(humanReview) : null,
  };
}

function mapReviewWorkspace(result) {
  const value = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
  const reviewValue = value.review ?? value.session ?? value.review_session ?? value.reviewSession;
  return {
    review: reviewValue ? mapReviewSession(reviewValue) : null,
    subject: value.subject ? mapTimelineRevision(value.subject) : null,
    timeline: value.timeline ? mapTimeline(value.timeline) : null,
    mediaProfileRevision: value.media_profile_revision ?? value.mediaProfileRevision
      ? mapMediaProfileRevision(value.media_profile_revision ?? value.mediaProfileRevision)
      : null,
    snapshot: value.snapshot && typeof value.snapshot === 'object' ? {
      hash: readString(value.snapshot, 'hash'),
      currentHash: readString(value.snapshot, 'current_hash', 'currentHash'),
      stale: Boolean(value.snapshot.stale),
    } : null,
    projectionSeq: Number(value.projection_seq ?? value.projectionSeq ?? 0),
    generatedAt: readString(value, 'generated_at', 'generatedAt') ?? new Date().toISOString(),
  };
}

function mapReviewList(result) {
  const value = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
  const rows = Array.isArray(result) ? result : value.items ?? value.reviews ?? [];
  return {
    reviews: Array.isArray(rows) ? rows.map(mapReviewSession) : [],
    projectionSeq: Number(value.projection_seq ?? value.projectionSeq ?? 0),
    generatedAt: readString(value, 'generated_at', 'generatedAt') ?? new Date().toISOString(),
  };
}

function mapHandoffCompatibility(source) {
  const value = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  const entries = Array.isArray(value.entries) ? value.entries.map((entry) => ({
    feature: readString(entry, 'feature') ?? 'unknown',
    status: readString(entry, 'status') ?? 'UNKNOWN',
    detail: readString(entry, 'detail') ?? '',
  })) : [];
  return {
    profileVersion: readString(value, 'profile_version', 'profileVersion'),
    targetEditor: readString(value, 'target_editor', 'targetEditor'),
    targetVersion: readString(value, 'target_version', 'targetVersion'),
    editableClaim: value.editable_claim === true || value.editableClaim === true,
    entries,
    counts: value.counts && typeof value.counts === 'object' ? value.counts : {},
    nextStep: readString(value, 'next_step', 'nextStep'),
  };
}

function mapHandoffDocument(source) {
  const value = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  const target = value.target && typeof value.target === 'object' ? value.target : {};
  const sourceValue = value.source && typeof value.source === 'object' ? value.source : {};
  const profile = sourceValue.media_profile ?? sourceValue.mediaProfile;
  const mapRational = (candidate) => safeRational(candidate) ?? undefined;
  const mediaProfile = profile && typeof profile === 'object' ? {
    revisionId: readString(profile, 'revision_id', 'revisionId'),
    lifecycleState: readString(profile, 'lifecycle_state', 'lifecycleState'),
    timelineRate: mapRational(profile.timeline_rate ?? profile.timelineRate),
    timeBase: mapRational(profile.time_base ?? profile.timeBase),
    pixelAspect: mapRational(profile.pixel_aspect ?? profile.pixelAspect),
    width: Number(profile.width),
    height: Number(profile.height),
    workingColorSpace: readString(profile, 'working_color_space', 'workingColorSpace'),
    transferFunction: readString(profile, 'transfer_function', 'transferFunction'),
    hdrPolicy: readString(profile, 'hdr_policy', 'hdrPolicy'),
    audioSampleRate: Number(profile.audio_sample_rate ?? profile.audioSampleRate),
    audioChannelLayout: readString(profile, 'audio_channel_layout', 'audioChannelLayout'),
  } : undefined;
  const tracks = Array.isArray(sourceValue.tracks) ? sourceValue.tracks.map((track) => {
    const row = track && typeof track === 'object' ? track : {};
    const clips = Array.isArray(row.clips) ? row.clips.map((clip) => {
      const item = clip && typeof clip === 'object' ? clip : {};
      return {
        id: readString(item, 'id', 'clip_id', 'clipId'),
        assetRevisionId: readString(item, 'asset_revision_id', 'assetRevisionId'),
        sourceIn: mapRational(item.source_in ?? item.sourceIn),
        sourceOut: mapRational(item.source_out ?? item.sourceOut),
        timelineIn: mapRational(item.timeline_in ?? item.timelineIn),
        timelineOut: mapRational(item.timeline_out ?? item.timelineOut),
        speed: mapRational(item.speed),
      };
    }) : [];
    return {
      id: readString(row, 'id', 'track_id', 'trackId'),
      trackType: readString(row, 'track_type', 'trackType'),
      orderIndex: Number(row.order_index ?? row.orderIndex ?? 0),
      name: readString(row, 'name') ?? '',
      enabled: row.enabled !== false,
      clips,
    };
  }) : [];
  const markers = Array.isArray(sourceValue.markers) ? sourceValue.markers.map((marker) => ({
    id: readString(marker, 'id', 'marker_id', 'markerId'),
    time: mapRational(marker.time),
    markerType: readString(marker, 'marker_type', 'markerType'),
    label: readString(marker, 'label') ?? '',
  })) : [];
  return {
    manifestType: readString(value, 'manifest_type', 'manifestType'),
    manifestSchemaVersion: Number(value.manifest_schema_version ?? value.manifestSchemaVersion ?? 0),
    deliverableType: readString(value, 'deliverable_type', 'deliverableType'),
    target: {
      editor: readString(target, 'editor'),
      version: readString(target, 'version'),
      profile: readString(target, 'profile'),
      compatibilityProfileVersion: readString(target, 'compatibility_profile_version', 'compatibilityProfileVersion'),
    },
    source: {
      projectId: readString(sourceValue, 'project_id', 'projectId'),
      timelineId: readString(sourceValue, 'timeline_id', 'timelineId'),
      timelineRevisionId: readString(sourceValue, 'timeline_revision_id', 'timelineRevisionId'),
      revisionNumber: Number(sourceValue.revision_number ?? sourceValue.revisionNumber ?? 0),
      lifecycleState: readString(sourceValue, 'lifecycle_state', 'lifecycleState'),
      contentHash: readString(sourceValue, 'content_hash', 'contentHash'),
      duration: mapRational(sourceValue.duration),
      mediaProfile,
      review: sourceValue.review && typeof sourceValue.review === 'object' ? {
        sessionId: readString(sourceValue.review, 'session_id', 'sessionId'),
        state: readString(sourceValue.review, 'state'),
        decision: readString(sourceValue.review, 'decision'),
        dependencySnapshotHash: readString(sourceValue.review, 'dependency_snapshot_hash', 'dependencySnapshotHash'),
        subjectContentHash: readString(sourceValue.review, 'subject_content_hash', 'subjectContentHash'),
      } : undefined,
      tracks,
      markers,
    },
  };
}

function mapHandoffManifest(source) {
  const value = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  const manifest = mapHandoffDocument(value.manifest);
  const allowlist = Array.isArray(value.artifact_allowlist ?? value.artifactAllowlist) ? (value.artifact_allowlist ?? value.artifactAllowlist).map((artifact) => ({
    assetRevisionId: readString(artifact, 'asset_revision_id', 'assetRevisionId'),
    assetId: readString(artifact, 'asset_id', 'assetId'),
    semanticRole: readString(artifact, 'semantic_role', 'semanticRole'),
    rebuildability: readString(artifact, 'rebuildability'),
    hashAlgorithm: readString(artifact, 'hash_algorithm', 'hashAlgorithm'),
    contentHash: readString(artifact, 'content_hash', 'contentHash'),
    byteSize: Number(artifact.byte_size ?? artifact.byteSize ?? 0),
    availabilityState: readString(artifact, 'availability_state', 'availabilityState'),
    reviewState: readString(artifact, 'review_state', 'reviewState'),
    availabilityEvidenceState: readString(artifact, 'availability_evidence_state', 'availabilityEvidenceState'),
  })) : [];
  const sanitization = value.sanitization_report ?? value.sanitizationReport ?? {};
  return {
    id: readString(value, 'id', 'handoff_manifest_id', 'handoffManifestId'),
    exportSessionId: readString(value, 'export_session_id', 'exportSessionId'),
    projectId: readString(value, 'project_id', 'projectId'),
    targetEditor: readString(value, 'target_editor', 'targetEditor') ?? readString(manifest.target, 'editor'),
    targetVersion: readString(value, 'target_version', 'targetVersion') ?? readString(manifest.target, 'version'),
    compatibilityProfileVersion: readString(value, 'compatibility_profile_version', 'compatibilityProfileVersion') ?? readString(manifest.target, 'compatibility_profile_version', 'compatibilityProfileVersion'),
    manifestHash: readString(value, 'manifest_hash', 'manifestHash'),
    manifest,
    artifactAllowlist: allowlist,
    compatibility: mapHandoffCompatibility(value.compatibility_report ?? value.compatibilityReport ?? manifest.compatibility),
    sanitizationReport: {
      policy: readString(sanitization, 'policy'),
      recorded: sanitization.recorded === true,
      removedFields: Array.isArray(sanitization.removed_fields ?? sanitization.removedFields) ? (sanitization.removed_fields ?? sanitization.removedFields) : [],
      nextStep: readString(sanitization, 'next_step', 'nextStep'),
    },
    createdAt: readString(value, 'created_at', 'createdAt'),
  };
}

function mapHandoffSession(source) {
  const value = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  return {
    id: readString(value, 'id', 'export_session_id', 'exportSessionId'),
    projectId: readString(value, 'project_id', 'projectId'),
    timelineRevisionId: readString(value, 'timeline_revision_id', 'timelineRevisionId'),
    deliverableType: readString(value, 'deliverable_type', 'deliverableType') ?? 'TIMELINE_INTERCHANGE',
    targetProfile: readString(value, 'target_profile', 'targetProfile'),
    targetEditor: readString(value, 'target_editor', 'targetEditor'),
    targetVersion: readString(value, 'target_version', 'targetVersion'),
    state: readString(value, 'state') ?? 'UNKNOWN',
    outputManifestId: readString(value, 'output_manifest_id', 'outputManifestId'),
    commandId: readString(value, 'command_id', 'commandId'),
    reviewSessionId: readString(value, 'review_session_id', 'reviewSessionId'),
    dependencySnapshotHash: readString(value, 'dependency_snapshot_hash', 'dependencySnapshotHash'),
    subjectContentHash: readString(value, 'subject_content_hash', 'subjectContentHash'),
    mediaProfileRevisionId: readString(value, 'media_profile_revision_id', 'mediaProfileRevisionId'),
    nextStep: readString(value, 'next_step', 'nextStep'),
    rowVersion: Number.isSafeInteger(Number(value.row_version ?? value.rowVersion)) ? Number(value.row_version ?? value.rowVersion) : 1,
    createdAt: readString(value, 'created_at', 'createdAt'),
    updatedAt: readString(value, 'updated_at', 'updatedAt'),
  };
}

function mapHandoffWorkspace(result) {
  const value = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
  const sessionValue = value.export_session ?? value.exportSession ?? value.session;
  const manifestValue = value.handoff_manifest ?? value.handoffManifest ?? value.manifest;
  return {
    exportSession: sessionValue ? mapHandoffSession(sessionValue) : null,
    handoffManifest: manifestValue ? mapHandoffManifest(manifestValue) : null,
    manifestHash: readString(value, 'manifest_hash', 'manifestHash') ?? (manifestValue ? readString(manifestValue, 'manifest_hash', 'manifestHash') : undefined),
    compatibilityReport: mapHandoffCompatibility(value.compatibility_report ?? value.compatibilityReport ?? manifestValue?.compatibility_report ?? manifestValue?.compatibilityReport),
    sanitizationReport: manifestValue ? mapHandoffManifest(manifestValue).sanitizationReport : undefined,
    nextStep: readString(value, 'next_step', 'nextStep') ?? (sessionValue ? readString(sessionValue, 'next_step', 'nextStep') : undefined),
    projectionSeq: Number(value.projection_seq ?? value.projectionSeq ?? 0),
    generatedAt: readString(value, 'generated_at', 'generatedAt') ?? new Date().toISOString(),
  };
}

function mapHandoffList(result) {
  const value = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
  const rows = Array.isArray(result) ? result : value.items ?? value.handoffs ?? [];
  return {
    items: Array.isArray(rows) ? rows.map((item) => ({
      exportSession: mapHandoffSession(item.export_session ?? item.exportSession ?? item.session),
      handoffManifest: mapHandoffManifest(item.handoff_manifest ?? item.handoffManifest ?? item.manifest),
    })) : [],
    projectionSeq: Number(value.projection_seq ?? value.projectionSeq ?? 0),
    generatedAt: readString(value, 'generated_at', 'generatedAt') ?? new Date().toISOString(),
  };
}

function mapDashboard(result) {
  const health = result?.system_health ?? result?.systemHealth ?? {};
  const backupState = String(health.backup_state ?? health.backupState ?? '').toUpperCase();
  const storagePressure = Boolean(health.storage_pressure ?? health.storagePressure);
  const needsYou = Array.isArray(result?.needs_you)
    ? result.needs_you
    : Array.isArray(result?.needs_you?.items) ? result.needs_you.items : [];
  return {
    generatedAt: result.generated_at ?? new Date().toISOString(),
    projects: Array.isArray(result.projects) ? result.projects.map(mapProject) : [],
    decisions: needsYou.map(mapDecision),
    activity: Array.isArray(result.activity) ? result.activity.map(mapActivity) : [],
    system: {
      connected: String(health.status ?? 'READY').toUpperCase() === 'READY',
      offline: false,
      storageUsed: formatBytes(Number(health.bytes ?? 0) + Number(health.object_store_bytes ?? health.objectStoreBytes ?? 0)),
      storageTotal: '—',
      storageAttention: String(health.status ?? 'READY').toUpperCase() !== 'READY' || storagePressure || backupState === 'FAILED' || backupState === 'QUARANTINED',
      backupState: readString(health, 'backup_state', 'backupState') ?? undefined,
      backupAt: readString(health, 'last_backup_at', 'lastBackupAt') ?? undefined,
      storagePressure,
    },
  };
}

function command(core, request, commandType, payload, expected, idempotencyKey) {
  return core.handle({
    request_id: requestId(request),
    api_version: '1',
    method: 'command.execute',
    params: {
      command_type: commandType,
      payload,
      expected_versions: expected,
      ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
    },
  });
}

function query(core, request, method, params) {
  return core.handle({ request_id: requestId(request), api_version: '1', method, params });
}

function commandKey(request, body = {}) {
  const header = request.headers['idempotency-key'];
  if (typeof header === 'string' && header.length > 0) return header;
  const value = body.idempotency_key ?? body.idempotencyKey;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function scopeError(entityType, entityId, projectId) {
  return errorBody(
    'ENTITY_SCOPE_MISMATCH',
    'errors.entity_scope_mismatch',
    { entity_type: entityType, entity_id: entityId, project_id: projectId },
    { category: 'CONFLICT', needsUser: true },
  );
}

function listProjectEntities(core, request, queryMethod, projectId, entityType, entityId = null) {
  const response = query(core, request, queryMethod, { project_id: projectId });
  if (!response.ok || !entityId) return response;
  const rows = Array.isArray(response.result) ? response.result : [];
  return rows.some((row) => row?.id === entityId) ? response : scopeError(entityType, entityId, projectId);
}

function filteredNotes(response, entityType, entityId) {
  if (!response.ok || !entityType || !entityId) return response;
  const notes = Array.isArray(response.result)
    ? response.result.filter((note) => String(note?.entity_type ?? '').toUpperCase() === entityType && note?.entity_id === entityId)
    : [];
  return { ...response, result: notes };
}

function noteCommandPayload(projectId, body, defaultType = 'PROJECT', defaultId = projectId) {
  const entityType = String(body.entity_type ?? body.entityType ?? defaultType).trim().toUpperCase();
  const entityId = body.entity_id ?? body.entityId ?? defaultId;
  return { ...body, project_id: projectId, entity_type: entityType, entity_id: entityId };
}

export function createCoreHttpServer(core, options = {}) {
  const token = options.token ?? process.env.CINEFORGE_CORE_TOKEN ?? null;
  const host = options.host ?? '127.0.0.1';
  const port = Number(options.port ?? 43217);
  const server = http.createServer(async (request, response) => {
    if (request.method === 'OPTIONS') { send(response, {}, 204); return; }
    if (!['127.0.0.1', '::1', 'localhost'].includes(request.headers.host?.split(':')[0])) {
      send(response, errorBody('LOCAL_ONLY', 'errors.local_only'), 403); return;
    }
    if (token) {
      const authorization = request.headers.authorization ?? '';
      if (authorization !== `Bearer ${token}`) {
        send(response, errorBody('AUTH_REQUIRED', 'errors.auth_required'), 401); return;
      }
    }
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
      const parts = url.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
      let result;
      let body = {};
      if (request.method === 'POST' || request.method === 'PATCH') body = await readBody(request);

      if (request.method === 'GET' && url.pathname === '/v1/health') {
        result = query(core, request, 'query.system.health', {});
      } else if (request.method === 'GET' && url.pathname === '/v1/dashboard') {
        const dashboard = query(core, request, 'query.home', {});
        result = dashboard.ok ? mapDashboard(dashboard.result) : dashboard;
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'assets' && parts.length === 2) {
        const assets = query(core, request, 'query.library.assets', {
          limit: url.searchParams.get('limit') ?? 100,
          include_trashed: url.searchParams.get('include_trashed') === 'true',
        });
        result = assets.ok ? mapAssetList(assets.result) : assets;
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'assets' && parts[2] && parts[3] === 'rights' && parts.length === 4) {
        const rights = query(core, request, 'query.asset.rights', {
          asset_id: parts[2], right_type: url.searchParams.get('right_type') ?? undefined,
          consent_type: url.searchParams.get('consent_type') ?? undefined,
          territory: url.searchParams.get('territory') ?? undefined,
          purpose: url.searchParams.get('purpose') ?? undefined,
        });
        result = rights;
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'assets' && parts.length === 2) {
        const created = command(core, request, 'ImportAsset', body, {}, commandKey(request, body));
        result = created.ok ? mapAsset(created.result) : created;
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'rights' && parts[2] === 'evaluate' && parts.length === 3) {
        result = query(core, request, 'query.rights.evaluate', {
          rights_identity_id: url.searchParams.get('rights_identity_id') ?? url.searchParams.get('identity_id'),
          right_type: url.searchParams.get('right_type') ?? undefined,
          consent_type: url.searchParams.get('consent_type') ?? undefined,
          territory: url.searchParams.get('territory') ?? undefined,
          purpose: url.searchParams.get('purpose') ?? undefined,
        });
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'rights' && parts[2] && parts[3] === 'identity' && parts.length === 4) {
        result = query(core, request, 'query.rights.identity', { rights_identity_id: parts[2] });
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'backups' && parts.length === 2) {
        result = query(core, request, 'query.backup.list', {
          state: url.searchParams.get('state') ?? undefined,
          durability_class: url.searchParams.get('durability_class') ?? url.searchParams.get('durabilityClass') ?? undefined,
          limit: url.searchParams.get('limit') ?? 100,
        });
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'backups' && parts[2] && parts.length === 3) {
        result = query(core, request, 'query.backup.get', { backup_id: parts[2] });
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'backups' && parts.length === 2) {
        result = command(core, request, 'CreateBackup', body, {}, commandKey(request, body));
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'backups' && parts[2] && parts[3] === 'verify' && parts.length === 4) {
        result = command(core, request, 'VerifyBackup', { ...body, backup_id: parts[2] }, {}, commandKey(request, body));
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'storage' && parts[2] === 'admission' && parts.length === 3) {
        result = query(core, request, 'query.storage.admission', {
          destination_path: url.searchParams.get('destination_path') ?? url.searchParams.get('destinationPath') ?? undefined,
          durability_class: url.searchParams.get('durability_class') ?? url.searchParams.get('durabilityClass') ?? undefined,
          max_backup_bytes: url.searchParams.get('max_backup_bytes') ?? url.searchParams.get('maxBackupBytes') ?? undefined,
          reserve_bytes: url.searchParams.get('reserve_bytes') ?? url.searchParams.get('reserveBytes') ?? undefined,
        });
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'storage' && parts[2] === 'staging' && parts.length === 3) {
        result = query(core, request, 'query.storage.staging_orphans', {
          state: url.searchParams.get('state') ?? undefined,
          limit: url.searchParams.get('limit') ?? 100,
        });
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'storage' && parts[2] === 'staging' && parts[3] === 'reconcile' && parts.length === 4) {
        result = command(core, request, 'ReconcileStaging', body, {}, commandKey(request, body));
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'characters' && parts.length === 2) {
        const listed = query(core, request, 'query.character.list', {
          project_id: url.searchParams.get('project_id') ?? url.searchParams.get('projectId') ?? undefined,
          lifecycle_state: url.searchParams.get('lifecycle_state') ?? url.searchParams.get('lifecycleState') ?? undefined,
          limit: url.searchParams.get('limit') ?? 100,
        });
        result = listed.ok ? { ...listed, result: mapCharacterList(listed.result) } : listed;
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'characters' && parts[2] && parts[3] === 'workspace' && parts.length === 4) {
        const workspace = query(core, request, 'query.character.workspace', {
          character_id: parts[2],
          project_id: url.searchParams.get('project_id') ?? url.searchParams.get('projectId') ?? undefined,
        });
        result = workspace.ok ? { ...workspace, result: mapCharacterWorkspace(workspace.result) } : workspace;
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'characters' && parts.length === 2) {
        const created = command(core, request, 'CreateCharacter', body, {}, commandKey(request, body));
        result = created.ok ? mapCharacter(created.result) : created;
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'characters' && parts[2] && parts[3] === 'visual-revisions' && parts.length === 4) {
        result = command(core, request, 'CreateVisualIdentityRevision', { ...body, character_id: parts[2] }, expectedVersions(body, 'CHARACTER'), commandKey(request, body));
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'characters' && parts[2] && parts[3] === 'voice-revisions' && parts.length === 4) {
        result = command(core, request, 'CreateVoiceIdentityRevision', { ...body, character_id: parts[2] }, expectedVersions(body, 'CHARACTER'), commandKey(request, body));
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'characters' && parts[2] && parts[3] === 'performance-bibles' && parts.length === 4) {
        result = command(core, request, 'CreatePerformanceBibleRevision', { ...body, character_id: parts[2] }, expectedVersions(body, 'CHARACTER'), commandKey(request, body));
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'characters' && parts.length === 4) {
        const listed = query(core, request, 'query.character.list', {
          project_id: parts[2],
          lifecycle_state: url.searchParams.get('lifecycle_state') ?? url.searchParams.get('lifecycleState') ?? undefined,
          limit: url.searchParams.get('limit') ?? 100,
        });
        result = listed.ok ? { ...listed, result: mapCharacterList(listed.result) } : listed;
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'characters' && parts[4] && parts[5] === 'workspace' && parts.length === 6) {
        const workspace = query(core, request, 'query.character.workspace', { character_id: parts[4], project_id: parts[2] });
        result = workspace.ok ? { ...workspace, result: mapCharacterWorkspace(workspace.result) } : workspace;
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'characters' && parts.length === 4) {
        const created = command(core, request, 'CreateCharacter', { ...body, project_id: parts[2] }, {}, commandKey(request, body));
        result = created.ok ? mapCharacter(created.result) : created;
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'characters' && parts[4] && parts[5] === 'visual-revisions' && parts.length === 6) {
        result = command(core, request, 'CreateVisualIdentityRevision', { ...body, project_id: parts[2], character_id: parts[4] }, expectedVersions(body, 'CHARACTER'), commandKey(request, body));
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'characters' && parts[4] && parts[5] === 'voice-revisions' && parts.length === 6) {
        result = command(core, request, 'CreateVoiceIdentityRevision', { ...body, project_id: parts[2], character_id: parts[4] }, expectedVersions(body, 'CHARACTER'), commandKey(request, body));
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'characters' && parts[4] && parts[5] === 'performance-bibles' && parts.length === 6) {
        result = command(core, request, 'CreatePerformanceBibleRevision', { ...body, project_id: parts[2], character_id: parts[4] }, expectedVersions(body, 'CHARACTER'), commandKey(request, body));
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'media-profile' && parts.length === 4) {
        const workspace = query(core, request, 'query.media_profile.workspace', { project_id: parts[2] });
        result = workspace.ok ? { ...workspace, result: mapMediaProfileWorkspace(workspace.result) } : workspace;
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'media-profile' && parts.length === 4) {
        const created = command(core, request, 'CreateMediaProfileRevision', { ...body, project_id: parts[2] }, expectedVersions(body, 'PROJECT'), commandKey(request, body));
        result = created.ok ? { ...created, result: mapMediaProfileWorkspace(created.result) } : created;
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'media-profile' && parts[4] === 'revisions' && parts[5] && parts[6] === 'transition' && parts.length === 7) {
        const transitioned = command(core, request, 'TransitionMediaProfileRevision', {
          ...body, project_id: parts[2], revision_id: parts[5],
        }, expectedVersions(body, 'REVISION'), commandKey(request, body));
        result = transitioned.ok ? { ...transitioned, result: mapMediaProfileWorkspace(transitioned.result) } : transitioned;
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'timelines' && parts.length === 4) {
        const listed = query(core, request, 'query.timeline.list', { project_id: parts[2], limit: url.searchParams.get('limit') ?? 100 });
        result = listed.ok ? { ...listed, result: mapTimelineList(listed.result) } : listed;
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'timelines' && parts.length === 4) {
        const created = command(core, request, 'CreateTimeline', { ...body, project_id: parts[2] }, expectedVersions(body, 'PROJECT'), commandKey(request, body));
        result = created.ok ? { ...created, result: mapTimeline(created.result?.timeline ?? created.result) } : created;
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'timelines' && parts[4] && parts[5] === 'workspace' && parts.length === 6) {
        const workspace = query(core, request, 'query.timeline.workspace', { project_id: parts[2], timeline_id: parts[4] });
        result = workspace.ok ? { ...workspace, result: mapTimelineWorkspace(workspace.result) } : workspace;
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'timelines' && parts[4] && parts[5] === 'working-sessions' && parts.length === 6) {
        const listed = query(core, request, 'query.timeline.working_session.list', {
          project_id: parts[2], timeline_id: parts[4], include_closed: url.searchParams.get('include_closed') === 'true',
        });
        result = listed.ok ? { ...listed, result: { ...listed.result, sessions: (listed.result.sessions ?? []).map(mapTimelineWorkingSession) } } : listed;
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'timelines' && parts[4] && parts[5] === 'working-sessions' && parts[6] && parts.length === 7) {
        const found = query(core, request, 'query.timeline.working_session', {
          project_id: parts[2], timeline_id: parts[4], working_session_id: parts[6],
        });
        result = found.ok ? { ...found, result: mapTimelineWorkingWorkspace(found.result) } : found;
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'timelines' && parts[4] && parts[5] === 'working-sessions' && parts[6] && parts[7] === 'history' && parts.length === 8) {
        const history = query(core, request, 'query.timeline.edit_history', {
          project_id: parts[2], timeline_id: parts[4], working_session_id: parts[6],
          after_op_seq: url.searchParams.get('after_op_seq') ?? 0, limit: url.searchParams.get('limit') ?? 100,
        });
        result = history.ok ? { ...history, result: mapTimelineWorkingHistory(history.result) } : history;
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'timelines' && parts[4] && parts[5] === 'working-sessions' && parts.length === 6) {
        const opened = command(core, request, 'BeginTimelineWorkingSession', {
          ...body, project_id: parts[2], timeline_id: parts[4],
        }, expectedVersions(body, 'TIMELINE', body.expected_timeline_version ?? body.expectedTimelineVersion), commandKey(request, body));
        result = opened.ok ? { ...opened, result: mapTimelineWorkingCommandResult(opened.result) } : opened;
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'timelines' && parts[4] && parts[5] === 'working-sessions' && parts[6] && parts[7] === 'ops' && parts.length === 8) {
        const applied = command(core, request, 'ApplyTimelineEditOp', {
          ...body, project_id: parts[2], timeline_id: parts[4], working_session_id: parts[6],
        }, expectedVersions(body, 'WORKING_SESSION'), commandKey(request, body));
        result = applied.ok ? { ...applied, result: mapTimelineWorkingCommandResult(applied.result) } : applied;
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'timelines' && parts[4] && parts[5] === 'working-sessions' && parts[6] && ['undo', 'redo', 'autosave', 'checkpoint', 'close'].includes(parts[7]) && parts.length === 8) {
        const commandType = {
          undo: 'UndoTimelineEditOp', redo: 'RedoTimelineEditOp', autosave: 'AutosaveTimelineWorkingSession',
          checkpoint: 'CheckpointTimelineWorkingSession', close: 'CloseTimelineWorkingSession',
        }[parts[7]];
        const expected = expectedVersions(body, 'WORKING_SESSION');
        if (parts[7] === 'checkpoint' && !(body.expected_versions ?? body.expectedVersions) && (body.expected_timeline_version ?? body.expectedTimelineVersion) !== undefined) {
          expected.TIMELINE = body.expected_timeline_version ?? body.expectedTimelineVersion;
        }
        const changed = command(core, request, commandType, {
          ...body, project_id: parts[2], timeline_id: parts[4], working_session_id: parts[6],
        }, expected, commandKey(request, body));
        result = changed.ok ? { ...changed, result: mapTimelineWorkingCommandResult(changed.result) } : changed;
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'timelines' && parts[4] && parts[5] === 'revisions' && parts.length === 6) {
        // Older desktop clients wrapped the immutable snapshot under
        // `snapshot`; flatten it at the HTTP boundary so Core always receives
        // the explicit duration/tracks contract.
        const snapshot = body.snapshot && typeof body.snapshot === 'object' && !Array.isArray(body.snapshot) ? body.snapshot : {};
        const { snapshot: _ignoredSnapshot, ...bodyWithoutSnapshot } = body;
        const created = command(core, request, 'CreateTimelineRevision', {
          ...bodyWithoutSnapshot, ...snapshot, project_id: parts[2], timeline_id: parts[4],
        }, expectedVersions(body, 'TIMELINE'), commandKey(request, body));
        result = created.ok ? { ...created, result: mapTimelineWorkspace(created.result) } : created;
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'timelines' && parts[4] && parts[5] === 'revisions' && parts[6] && parts[7] === 'transition' && parts.length === 8) {
        const transitioned = command(core, request, 'TransitionTimelineRevision', {
          ...body, project_id: parts[2], timeline_id: parts[4], revision_id: parts[6],
        }, expectedVersions(body, 'REVISION'), commandKey(request, body));
        result = transitioned.ok ? { ...transitioned, result: mapTimelineWorkspace(transitioned.result) } : transitioned;
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'reviews' && parts.length === 4) {
        const listed = query(core, request, 'query.review.list', {
          project_id: parts[2],
          state: url.searchParams.get('state') ?? undefined,
          limit: url.searchParams.get('limit') ?? 100,
        });
        result = listed.ok ? { ...listed, result: mapReviewList(listed.result) } : listed;
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'reviews' && parts[4] && parts.length === 5) {
        const review = query(core, request, 'query.review.get', { project_id: parts[2], review_session_id: parts[4] });
        result = review.ok ? { ...review, result: mapReviewWorkspace(review.result) } : review;
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'reviews' && parts.length === 4) {
        const opened = command(core, request, 'OpenReview', { ...body, project_id: parts[2] }, expectedVersions(body, 'REVISION'), commandKey(request, body));
        result = opened.ok ? { ...opened, result: mapReviewWorkspace(opened.result) } : opened;
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'reviews' && parts[4] && parts[5] === 'submit' && parts.length === 6) {
        const submitted = command(core, request, 'SubmitReview', {
          ...body, project_id: parts[2], review_session_id: parts[4],
        }, expectedVersions(body, 'REVIEW_SESSION'), commandKey(request, body));
        result = submitted.ok ? { ...submitted, result: mapReviewWorkspace(submitted.result) } : submitted;
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'handoffs' && parts.length === 4) {
        const listed = query(core, request, 'query.handoff.list', {
          project_id: parts[2],
          state: url.searchParams.get('state') ?? undefined,
          limit: url.searchParams.get('limit') ?? 100,
        });
        result = listed.ok ? { ...listed, result: mapHandoffList(listed.result) } : listed;
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'handoffs' && parts[4] && parts.length === 5) {
        const found = query(core, request, 'query.handoff.get', { project_id: parts[2], handoff_id: parts[4] });
        result = found.ok ? { ...found, result: mapHandoffWorkspace(found.result) } : found;
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'handoffs' && parts.length === 4) {
        const created = command(core, request, 'CreateHandoffManifest', { ...body, project_id: parts[2] }, expectedVersions(body, 'REVISION'), commandKey(request, body));
        result = created.ok ? { ...created, result: mapHandoffWorkspace(created.result) } : created;
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'projects' && parts.length === 2) {
        result = query(core, request, 'query.project.list', { include_trashed: url.searchParams.get('include_trashed') === 'true' });
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'projects' && parts.length === 2) {
        const created = command(core, request, 'CreateProject', { ...body, title: body.title ?? body.name }, {}, commandKey(request, body));
        result = created.ok ? mapProject(created.result) : created;
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'assets' && parts.length === 4) {
        const assets = query(core, request, 'query.project.assets', {
          project_id: parts[2], limit: url.searchParams.get('limit') ?? 100,
          include_trashed: url.searchParams.get('include_trashed') === 'true',
        });
        result = assets.ok ? mapAssetList(assets.result) : assets;
      } else if (parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts.length === 3) {
        const projectId = parts[2];
        if (request.method === 'GET') result = query(core, request, 'query.project.get', { project_id: projectId });
        else if (request.method === 'PATCH') result = command(core, request, 'UpdateProjectMetadata', { ...body, project_id: projectId }, expectedVersions(body, 'PROJECT'), commandKey(request, body));
        else result = errorBody('METHOD_NOT_ALLOWED', 'errors.method_not_allowed');
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'workspace') {
        result = query(core, request, 'query.project.workspace', { project_id: parts[2] });
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'activity') {
        result = query(core, request, 'query.project.activity', { project_id: parts[2], limit: url.searchParams.get('limit') ?? 100 });

      // First-class project task routes.  The legacy production-items route
      // below remains a compact UI projection; these routes expose the
      // canonical task row, including status and row_version.
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'tasks' && parts.length === 4) {
        result = query(core, request, 'query.task.list', { project_id: parts[2] });
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'tasks' && parts[4] && parts.length === 5) {
        const scoped = listProjectEntities(core, request, 'query.task.list', parts[2], 'TASK', parts[4]);
        result = scoped.ok ? { ...scoped, result: scoped.result.find((task) => task.id === parts[4]) } : scoped;
      } else if (request.method === 'PATCH' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'tasks' && parts[4] && parts.length === 5) {
        // Mutating nested routes always reach Core's command gate.  Scope
        // mismatches are rejected there and receive a Command/Audit record;
        // a read-side preflight would otherwise create an unaudited intent.
        result = command(core, request, 'UpdateTask', { ...body, project_id: parts[2], task_id: parts[4] }, expectedVersions(body, 'TASK'), commandKey(request, body));
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'tasks' && parts.length === 4) {
        const created = command(core, request, 'CreateTask', { ...body, project_id: parts[2] }, {}, commandKey(request, body));
        result = created;

      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'tasks' && parts[4] && parts[5] === 'notes' && parts.length === 6) {
        const scoped = listProjectEntities(core, request, 'query.task.list', parts[2], 'TASK', parts[4]);
        result = scoped.ok
          ? filteredNotes(query(core, request, 'query.notes.list', { project_id: parts[2] }), 'TASK', parts[4])
          : scoped;
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'tasks' && parts[4] && parts[5] === 'notes' && parts.length === 6) {
        const payload = noteCommandPayload(parts[2], body, 'TASK', parts[4]);
        result = command(core, request, 'AddTaskNote', { ...payload, task_id: parts[4] }, {}, commandKey(request, body));
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'production-items' && parts.length === 4) {
        const tasks = query(core, request, 'query.task.list', { project_id: parts[2] });
        result = tasks.ok ? { ...tasks, result: tasks.result.map((task) => mapProductionItem(task, task.title)) } : tasks;
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'production-items' && parts.length === 4) {
        const created = command(core, request, 'CreateTask', { ...body, project_id: parts[2] }, {}, commandKey(request, body));
        result = created.ok ? mapProductionItem(created.result, body.title) : created;

      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'assets' && parts.length === 4) {
        const created = command(core, request, 'ImportAsset', { ...body, project_id: parts[2] }, {}, commandKey(request, body));
        result = created.ok ? mapAsset(created.result) : created;
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'imports' && parts[2] && parts.length === 3) {
        result = query(core, request, 'query.import.session', { import_session_id: parts[2] });

      // First-class shot routes mirror the task routes and enforce the nested
      // project scope before a mutating command reaches Core.
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'shots' && parts.length === 4) {
        result = query(core, request, 'query.shot.list', { project_id: parts[2] });
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'shots' && parts[4] && parts.length === 5) {
        const scoped = listProjectEntities(core, request, 'query.shot.list', parts[2], 'SHOT', parts[4]);
        result = scoped.ok ? { ...scoped, result: scoped.result.find((shot) => shot.id === parts[4]) } : scoped;
      } else if (request.method === 'PATCH' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'shots' && parts[4] && parts.length === 5) {
        result = command(core, request, 'UpdateShot', { ...body, project_id: parts[2], shot_id: parts[4] }, expectedVersions(body, 'SHOT'), commandKey(request, body));
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'shots' && parts.length === 4) {
        result = command(core, request, 'CreateShot', { ...body, project_id: parts[2] }, {}, commandKey(request, body));

      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'shots' && parts[4] && parts[5] === 'notes' && parts.length === 6) {
        const scoped = listProjectEntities(core, request, 'query.shot.list', parts[2], 'SHOT', parts[4]);
        result = scoped.ok
          ? filteredNotes(query(core, request, 'query.notes.list', { project_id: parts[2] }), 'SHOT', parts[4])
          : scoped;
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'shots' && parts[4] && parts[5] === 'notes' && parts.length === 6) {
        const payload = noteCommandPayload(parts[2], body, 'SHOT', parts[4]);
        result = command(core, request, 'AddShotNote', { ...payload, shot_id: parts[4] }, {}, commandKey(request, body));
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'notes' && parts.length === 4) {
        result = query(core, request, 'query.notes.list', { project_id: parts[2], limit: url.searchParams.get('limit') ?? 100 });
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'notes' && parts.length === 4) {
        const payload = noteCommandPayload(parts[2], body);
        // Let the command gate perform target/project validation so every
        // mutating intent is represented in the append-only audit trail.
        result = command(core, request, 'AddNote', payload, {}, commandKey(request, body));
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'events') {
        result = query(core, request, 'events.subscribe', { after_seq: url.searchParams.get('after_seq') ?? 0, limit: url.searchParams.get('limit') ?? 100 });
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'commands' && parts.length === 2) {
        result = command(core, request, body.command_type, body.payload ?? {}, body.expected_versions ?? {}, commandKey(request, body));
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'commands' && parts[2] && parts[3] === 'cancel') {
        result = core.handle({ request_id: requestId(request), api_version: '1', method: 'command.cancel', params: { command_id: parts[2] } });
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'decisions' && parts.length === 2) {
        const listed = query(core, request, 'query.decisions.list', {
          project_id: url.searchParams.get('project_id') ?? undefined,
          state: url.searchParams.get('state') ?? 'OPEN',
          severity: url.searchParams.get('severity') ?? undefined,
          limit: url.searchParams.get('limit') ?? 100,
        });
        result = listed.ok ? { ...listed, result: { ...listed.result, items: listed.result.items.map(mapDecision) } } : listed;
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'decisions' && parts[2] && parts.length === 3) {
        const found = query(core, request, 'query.needs_you.get', { decision_request_id: parts[2] });
        result = found.ok ? { ...found, result: mapDecision(found.result) } : found;
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'decisions' && parts[2] && parts[3] === 'resolve' && parts.length === 4) {
        const decisionId = parts[2];
        const expected = body.expected_versions ?? body.expectedVersions ?? (body.expected_decision_version ?? body.expectedDecisionVersion ?? body.decision_version ?? body.decisionVersion
          ? { DECISION_REQUEST: body.expected_decision_version ?? body.expectedDecisionVersion ?? body.decision_version ?? body.decisionVersion } : {});
        result = command(core, request, 'ResolveDecisionRequest', {
          ...body, decision_request_id: decisionId, expected_decision_version: body.expected_decision_version ?? body.expectedDecisionVersion ?? body.decision_version ?? body.decisionVersion,
        }, expected, commandKey(request, body));
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'decisions' && parts[2] && parts[3] === 'dismiss' && parts.length === 4) {
        const decisionId = parts[2];
        const expected = body.expected_versions ?? body.expectedVersions ?? (body.expected_decision_version ?? body.expectedDecisionVersion ?? body.decision_version ?? body.decisionVersion
          ? { DECISION_REQUEST: body.expected_decision_version ?? body.expectedDecisionVersion ?? body.decision_version ?? body.decisionVersion } : {});
        result = command(core, request, 'DismissDecisionRequest', {
          ...body, decision_request_id: decisionId, expected_decision_version: body.expected_decision_version ?? body.expectedDecisionVersion ?? body.decision_version ?? body.decisionVersion,
        }, expected, commandKey(request, body));
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'decisions' && parts[2] && parts[3] === 'ack') {
        // Legacy presentation clients may still send /ack. Keep the route
        // stable while directing known records through the canonical dismiss
        // command; unknown IDs retain the old idempotent acknowledgement
        // response until those clients migrate to /dismiss.
        const found = query(core, request, 'query.needs_you.get', { decision_request_id: parts[2] });
        if (found.ok) {
          const currentVersion = Number(found.result.decision_version ?? found.result.row_version ?? 1);
          result = command(core, request, 'DismissDecisionRequest', {
            ...body, decision_request_id: parts[2], expected_decision_version: body.expected_decision_version ?? currentVersion,
          }, { DECISION_REQUEST: body.expected_decision_version ?? currentVersion }, commandKey(request, body));
        } else {
          result = errorBody('NOT_FOUND', 'errors.decision_request_not_found', { decision_request_id: parts[2] }, { category: 'VALIDATION', needsUser: true });
        }
      } else {
        result = errorBody('NOT_FOUND', 'errors.route_not_found', { path: url.pathname });
      }
      send(response, result, statusFor(result));
    } catch (error) {
      send(response, errorBody('INVALID_REQUEST', 'errors.invalid_request', { message: error.message }), 400);
    }
  });
  return { server, host, port, token };
}

export function listenCoreHttp(core, options = {}) {
  const instance = createCoreHttpServer(core, options);
  return new Promise((resolve, reject) => {
    instance.server.once('error', reject);
    instance.server.listen(instance.port, instance.host, () => resolve({ ...instance, address: instance.server.address() }));
  });
}
