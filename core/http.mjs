import http from 'node:http';
import crypto from 'node:crypto';

function statusFor(response) {
  if (response?.ok === undefined) return 200;
  if (response.ok) return 200;
  const code = response.error?.code;
  if (code === 'NOT_FOUND') return 404;
  if (['SOURCE_NOT_FOUND', 'ASSET_NOT_FOUND', 'IMPORT_SESSION_NOT_FOUND'].includes(code)) return 404;
  if (['STALE_REVISION', 'STALE_DECISION', 'EXPECTED_VERSION_REQUIRED', 'EXPECTED_DECISION_VERSION_REQUIRED', 'DUPLICATE_PROJECT_CODE', 'DUPLICATE_SHOT_CODE', 'INVALID_STATE_TRANSITION', 'ENTITY_SCOPE_MISMATCH', 'HASH_MISMATCH', 'CONTENT_IDENTITY_CONFLICT', 'SOURCE_CHANGED_DURING_HASH', 'INVALID_DECISION_CHOICE', 'DECISION_NOT_OPEN'].includes(code)) return 409;
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

function mapDashboard(result) {
  const health = result?.system_health ?? result?.systemHealth ?? {};
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
      storageAttention: String(health.status ?? 'READY').toUpperCase() !== 'READY',
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
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'assets' && parts.length === 2) {
        const created = command(core, request, 'ImportAsset', body, {}, commandKey(request, body));
        result = created.ok ? mapAsset(created.result) : created;
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
          result = { ok: true, decision_id: parts[2], status: 'ACKNOWLEDGED' };
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
