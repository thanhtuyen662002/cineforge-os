import http from 'node:http';
import crypto from 'node:crypto';

function statusFor(response) {
  if (response?.ok === undefined) return 200;
  if (response.ok) return 200;
  const code = response.error?.code;
  if (code === 'NOT_FOUND') return 404;
  if (['SOURCE_NOT_FOUND', 'ASSET_NOT_FOUND', 'IMPORT_SESSION_NOT_FOUND'].includes(code)) return 404;
  if (['STALE_REVISION', 'EXPECTED_VERSION_REQUIRED', 'DUPLICATE_PROJECT_CODE', 'DUPLICATE_SHOT_CODE', 'INVALID_STATE_TRANSITION', 'HASH_MISMATCH', 'CONTENT_IDENTITY_CONFLICT', 'SOURCE_CHANGED_DURING_HASH'].includes(code)) return 409;
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

function errorBody(code, messageKey, details = {}) {
  return {
    request_id: null,
    ok: false,
    error: {
      code,
      category: 'VALIDATION',
      user_message_key: messageKey,
      user_message_args: {},
      retryable: false,
      needs_user: false,
      decision_request_id: null,
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
    health: lifecycle === 'TRASHED' ? 'blocked' : 'healthy',
    nextAction: 'Mở dự án',
    nextActionLabel: 'Mở',
    storage: '—',
    productionItems,
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
  return {
    generatedAt: result.generated_at ?? new Date().toISOString(),
    projects: Array.isArray(result.projects) ? result.projects.map(mapProject) : [],
    decisions: [],
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
        const created = command(core, request, 'ImportAsset', body, {}, request.headers['idempotency-key'] ?? body.idempotency_key);
        result = created.ok ? mapAsset(created.result) : created;
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'projects' && parts.length === 2) {
        result = query(core, request, 'query.project.list', { include_trashed: url.searchParams.get('include_trashed') === 'true' });
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'projects' && parts.length === 2) {
        const created = command(core, request, 'CreateProject', { ...body, title: body.title ?? body.name }, {}, request.headers['idempotency-key'] ?? body.idempotency_key);
        result = created.ok ? mapProject(created.result) : created;
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'assets') {
        const assets = query(core, request, 'query.project.assets', {
          project_id: parts[2], limit: url.searchParams.get('limit') ?? 100,
          include_trashed: url.searchParams.get('include_trashed') === 'true',
        });
        result = assets.ok ? mapAssetList(assets.result) : assets;
      } else if (parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts.length === 3) {
        const projectId = parts[2];
        if (request.method === 'GET') result = query(core, request, 'query.project.get', { project_id: projectId });
        else if (request.method === 'PATCH') result = command(core, request, 'UpdateProjectMetadata', { ...body, project_id: projectId }, expectedVersions(body, 'PROJECT'), request.headers['idempotency-key'] ?? body.idempotency_key);
        else result = errorBody('METHOD_NOT_ALLOWED', 'errors.method_not_allowed');
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'workspace') {
        result = query(core, request, 'query.project.workspace', { project_id: parts[2] });
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'activity') {
        result = query(core, request, 'query.project.activity', { project_id: parts[2], limit: url.searchParams.get('limit') ?? 100 });
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'tasks') {
        const created = command(core, request, 'CreateTask', { ...body, project_id: parts[2] }, {}, request.headers['idempotency-key'] ?? body.idempotency_key);
        result = created.ok ? mapProductionItem(created.result, body.title) : created;
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'production-items') {
        const created = command(core, request, 'CreateTask', { ...body, project_id: parts[2] }, {}, request.headers['idempotency-key'] ?? body.idempotency_key);
        result = created.ok ? mapProductionItem(created.result, body.title) : created;
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'assets') {
        const created = command(core, request, 'ImportAsset', { ...body, project_id: parts[2] }, {}, request.headers['idempotency-key'] ?? body.idempotency_key);
        result = created.ok ? mapAsset(created.result) : created;
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'imports' && parts[2] && parts.length === 3) {
        result = query(core, request, 'query.import.session', { import_session_id: parts[2] });
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'shots') {
        result = command(core, request, 'CreateShot', { ...body, project_id: parts[2] }, {}, request.headers['idempotency-key'] ?? body.idempotency_key);
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'projects' && parts[2] && parts[3] === 'notes') {
        result = command(core, request, 'AddNote', { ...body, project_id: parts[2] }, {}, request.headers['idempotency-key'] ?? body.idempotency_key);
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'events') {
        result = query(core, request, 'events.subscribe', { after_seq: url.searchParams.get('after_seq') ?? 0, limit: url.searchParams.get('limit') ?? 100 });
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'commands' && parts.length === 2) {
        result = command(core, request, body.command_type, body.payload ?? {}, body.expected_versions ?? {}, request.headers['idempotency-key'] ?? body.idempotency_key);
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'commands' && parts[2] && parts[3] === 'cancel') {
        result = core.handle({ request_id: requestId(request), api_version: '1', method: 'command.cancel', params: { command_id: parts[2] } });
      } else if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'decisions' && parts[2] && parts[3] === 'ack') {
        // Decision acknowledgements are intentionally idempotent at this
        // presentation boundary. Decision records will be wired to the full
        // DecisionRequest aggregate in the next product slice.
        result = { ok: true, decision_id: parts[2], status: 'ACKNOWLEDGED' };
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
