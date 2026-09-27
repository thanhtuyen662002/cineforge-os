import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initializeDatabase, SCHEMA_VERSION } from './schema.mjs';
import { isUuid, nowUtcUs, rfc3339FromUs, uuidv7 } from './ids.mjs';

export const API_VERSION = '1';
export const CORE_VERSION = '0.1.0';

const TERMINAL_COMMAND_STATES = new Set([
  'SUCCEEDED', 'FAILED', 'CANCELLED', 'PARTIAL', 'SUCCEEDED_WITH_WARNINGS',
  'COMPENSATED', 'FAILED_COMPENSATION',
]);

const PROJECT_STATES = new Set(['ACTIVE', 'PAUSED', 'ARCHIVED', 'TRASHED']);
const TASK_STATES = new Set(['PLANNED', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED']);
const SHOT_STATES = new Set(['ACTIVE', 'PAUSED', 'ARCHIVED', 'TRASHED']);
const NOTE_ENTITY_TYPES = new Set(['PROJECT', 'TASK', 'SHOT']);

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

  _findIdempotent(commandType, key) {
    if (!key) return null;
    return this.db.prepare(`SELECT * FROM commands
      WHERE actor_id = ? AND command_type = ? AND idempotency_key = ?`).get(this.actorId, commandType, key);
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
    const previous = this._findIdempotent(commandType, idempotencyKey);
    if (previous) {
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
         payload_json, expected_versions_json, reversibility, status, idempotency_key, created_at_utc_us)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 'RECEIVED', ?, ?)`).run(
        commandId, this.studioId, projectId, this.actorId, commandType,
        projectId ? 'PROJECT' : 'SYSTEM', projectId, json(payload), json(expectedVersions),
        this._reversibility(commandType), idempotencyKey, created,
      );
    });

    try {
      const applied = this._transaction(() => {
        this.db.prepare('UPDATE commands SET status = ?, started_at_utc_us = ? WHERE id = ?')
          .run('EXECUTING', nowUtcUs(), commandId);
        const operation = this._applyCommand(commandType, payload, expectedVersions, commandId);
        const eventSeq = this._insertEvent(operation.event, commandId, this.actorId, input.correlation_id ?? null, input.causation_id ?? null);
        this._insertAudit(operation.audit, commandId, this.actorId, 'SUCCEEDED');
        const result = { ...operation.result, command_id: commandId, event_seq: eventSeq, status: 'SUCCEEDED' };
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
    if (explicitProjectId) {
      return this.db.prepare('SELECT id FROM projects WHERE id = ?').get(explicitProjectId)?.id ?? null;
    }
    for (const key of ['task_id', 'taskId']) {
      if (payload[key]) return this.db.prepare('SELECT project_id FROM tasks WHERE id = ?').get(payload[key])?.project_id ?? null;
    }
    for (const key of ['shot_id', 'shotId']) {
      if (payload[key]) return this.db.prepare('SELECT project_id FROM shots WHERE id = ?').get(payload[key])?.project_id ?? null;
    }
    if (commandType === 'CreateProject') return null;
    return null;
  }

  _reversibility(commandType) {
    if (['TrashProject', 'ArchiveProject'].includes(commandType)) return 'COMPENSATABLE';
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
    this._assertProjectWritable(project);
    const title = payload.title === undefined ? current.title : requiredString(payload.title, 'title');
    const description = payload.description === undefined ? current.description : optionalString(payload.description, 'description');
    const status = payload.status === undefined ? current.status : payload.status;
    if (!TASK_STATES.has(status)) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_task_status', { status });
    const priority = payload.priority === undefined ? current.priority : asInt(payload.priority, NaN);
    if (!Number.isSafeInteger(priority) || priority < -1000 || priority > 1000) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_priority', {});
    const version = Number(current.row_version) + 1;
    this.db.prepare(`UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?,
      updated_at_utc_us = ?, row_version = ? WHERE id = ?`).run(title, description, status, priority, nowUtcUs(), version, taskId);
    const task = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    return {
      projectId: project.id,
      result: publicTask(task),
      event: { aggregateType: 'TASK', aggregateId: taskId, aggregateVersion: version, eventType: 'TASK_UPDATED', payload: publicTask(task) },
      audit: { actionType: 'task.update', targetType: 'TASK', targetId: taskId, payload: { row_version: version } },
    };
  }

  _createShot(payload) {
    const project = this._project(payload.project_id ?? payload.projectId);
    this._assertProjectWritable(project);
    const title = requiredString(payload.title, 'title');
    const code = requiredString(payload.code, 'code', 64);
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
    this._assertProjectWritable(project);
    const title = payload.title === undefined ? current.title : requiredString(payload.title, 'title');
    const state = payload.lifecycle_state ?? payload.lifecycleState ?? current.lifecycle_state;
    if (!SHOT_STATES.has(state)) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_shot_state', { state });
    const version = Number(current.row_version) + 1;
    this.db.prepare('UPDATE shots SET title = ?, lifecycle_state = ?, updated_at_utc_us = ?, row_version = ? WHERE id = ?')
      .run(title, state, nowUtcUs(), version, shotId);
    const shot = this.db.prepare('SELECT * FROM shots WHERE id = ?').get(shotId);
    return {
      projectId: project.id,
      result: publicShot(shot),
      event: { aggregateType: 'SHOT', aggregateId: shotId, aggregateVersion: version, eventType: 'SHOT_UPDATED', payload: publicShot(shot) },
      audit: { actionType: 'shot.update', targetType: 'SHOT', targetId: shotId, payload: { row_version: version } },
    };
  }

  _addNote(payload, commandType) {
    const entityType = String(payload.entity_type ?? payload.entityType ?? (commandType === 'AddTaskNote' ? 'TASK' : commandType === 'AddShotNote' ? 'SHOT' : '')).toUpperCase();
    if (!NOTE_ENTITY_TYPES.has(entityType)) throw new CoreError('INVALID_ARGUMENT', 'VALIDATION', 'errors.invalid_note_entity_type', { entity_type: entityType });
    const entityId = payload.entity_id ?? payload.entityId
      ?? (commandType === 'AddTaskNote' ? payload.task_id ?? payload.taskId : null)
      ?? (commandType === 'AddShotNote' ? payload.shot_id ?? payload.shotId : null);
    const body = requiredString(payload.body ?? payload.note, 'body', 50000);
    let project;
    if (entityType === 'PROJECT') project = this._project(entityId);
    if (entityType === 'TASK') { const task = this._task(entityId); project = this._project(task.project_id); }
    if (entityType === 'SHOT') { const shot = this._shot(entityId); project = this._project(shot.project_id); }
    this._assertProjectWritable(project);
    const noteId = uuidv7();
    const created = nowUtcUs();
    this.db.prepare(`INSERT INTO notes(id, project_id, entity_type, entity_id, body, created_by_actor_id, created_at_utc_us)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(noteId, project.id, entityType, entityId, body, this.actorId, created);
    const note = this.db.prepare('SELECT * FROM notes WHERE id = ?').get(noteId);
    return {
      projectId: project.id,
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
        const expectedValue = this._planExpected(expected, target.kind, target.id);
        if (expectedValue !== null && Number(expectedValue) !== Number(target.row.row_version)) precondition = { ok: false, code: 'STALE_REVISION' };
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
    };
    const mapping = mappings[commandType];
    if (!mapping?.[1]) return null;
    const row = mapping[0] === 'PROJECT' ? this._project(mapping[1]) : mapping[0] === 'TASK' ? this._task(mapping[1]) : this._shot(mapping[1]);
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
        state: task.status === 'DONE' ? 'done' : task.status === 'IN_PROGRESS' ? 'in_progress' : 'todo',
      }));
      project.completion = {
        done: tasks.filter((task) => task.status === 'DONE').length,
        total: tasks.length,
      };
      return project;
    });
  }

  _projectSummary(projectId) {
    const project = this._project(projectId);
    const tasks = Number(this.db.prepare('SELECT COUNT(*) AS count FROM tasks WHERE project_id = ?').get(projectId).count);
    const shots = Number(this.db.prepare('SELECT COUNT(*) AS count FROM shots WHERE project_id = ?').get(projectId).count);
    const notes = Number(this.db.prepare('SELECT COUNT(*) AS count FROM notes WHERE project_id = ?').get(projectId).count);
    const activity = this.db.prepare(`SELECT * FROM domain_events WHERE aggregate_id IN
      (SELECT id FROM tasks WHERE project_id = ? UNION SELECT id FROM shots WHERE project_id = ? UNION SELECT ?)
      ORDER BY seq DESC LIMIT 20`).all(projectId, projectId, projectId).map((row) => this._publicEvent(row));
    return { project: publicProject(project), counts: { tasks, shots, notes }, activity, projection_seq: this._projectionSeq(), generated_at: new Date().toISOString() };
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
    return {
      core_version: CORE_VERSION,
      api_version: API_VERSION,
      schema_version: SCHEMA_VERSION,
      status: integrity === 'ok' && journalMode === 'WAL' && foreignKeys === 1 ? 'READY' : 'DEGRADED',
      freshness: 'FRESH',
      db_path: this.dbPath,
      journal_mode: journalMode,
      synchronous: synchronousValue,
      foreign_keys: foreignKeys === 1,
      integrity_check: integrity,
      wal_enabled: journalMode === 'WAL',
      wal_path: walPath,
      wal_exists: walPath ? fs.existsSync(walPath) : false,
      installation_id: this._getMeta('installation_id'),
      studio_id: this.studioId,
      actor_id: this.actorId,
      projection_seq: this._projectionSeq(),
      generated_at: new Date().toISOString(),
      degraded_reasons: integrity !== 'ok' ? ['INTEGRITY_CHECK_FAILED'] : journalMode !== 'WAL' ? ['WAL_DISABLED'] : [],
    };
  }

  query(method, params = {}) {
    switch (method) {
      case 'query.home':
        return { projects: this._queryProjects(params), needs_you: [], system_health: this._systemHealth(), projection_seq: this._projectionSeq(), generated_at: new Date().toISOString() };
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
      case 'query.command.get': return this.getCommand(params.command_id ?? params.commandId);
      case 'query.audit.list': return this._audit(params);
      case 'query.entity.history': return this._entityHistory(params);
      case 'query.search': return this._search(params);
      case 'query.storage.summary': return this._storageSummary();
      case 'query.needs_you.list': return { items: [], projection_seq: this._projectionSeq(), generated_at: new Date().toISOString() };
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

  _activity(projectId, params = {}) {
    this._project(projectId);
    const limit = Math.min(Math.max(asInt(params.limit, 100), 1), 500);
    const rows = this.db.prepare(`SELECT * FROM domain_events WHERE aggregate_id = ?
      OR aggregate_id IN (SELECT id FROM tasks WHERE project_id = ? UNION SELECT id FROM shots WHERE project_id = ? UNION SELECT id FROM notes WHERE project_id = ?)
      ORDER BY seq DESC LIMIT ?`).all(projectId, projectId, projectId, projectId, limit);
    return { events: rows.map((row) => this._publicEvent(row)), projection_seq: this._projectionSeq(), generated_at: new Date().toISOString() };
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
    return { exact: [...projects, ...tasks, ...shots], semantic: [], projection_seq: this._projectionSeq(), generated_at: new Date().toISOString() };
  }

  _storageSummary() {
    let bytes = 0;
    if (this.dbPath !== ':memory:') {
      for (const suffix of ['', '-wal', '-shm']) {
        try { bytes += fs.statSync(`${this.dbPath}${suffix}`).size; } catch { /* optional sidecar */ }
      }
    }
    return { db_path: this.dbPath, bytes, object_store_bytes: 0, cache_bytes: 0, projection_seq: this._projectionSeq(), generated_at: new Date().toISOString() };
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
