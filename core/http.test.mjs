import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CoreService } from './core.mjs';
import { listenCoreHttp } from './http.mjs';

test('HTTP presentation adapter exposes dashboard, project and production-item flows', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cineforge-http-'));
  const core = new CoreService({ dbPath: path.join(directory, 'cineforge.sqlite') });
  const listener = await listenCoreHttp(core, { host: '127.0.0.1', port: 0 });
  const base = `http://127.0.0.1:${listener.address.port}`;
  try {
    const initial = await fetch(`${base}/v1/dashboard`);
    assert.equal(initial.status, 200);
    const dashboard = await initial.json();
    assert.ok(Array.isArray(dashboard.projects));
    assert.ok(Array.isArray(dashboard.decisions));

    const create = await fetch(`${base}/v1/projects`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'http-project' },
      body: JSON.stringify({ name: 'HTTP project' }),
    });
    assert.equal(create.status, 200);
    const project = await create.json();
    assert.equal(project.name, 'HTTP project');

    const itemResponse = await fetch(`${base}/v1/projects/${encodeURIComponent(project.id)}/production-items`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'First shot' }),
    });
    assert.equal(itemResponse.status, 200);
    const item = await itemResponse.json();
    assert.equal(item.title, 'First shot');
    assert.equal(item.state, 'todo');
    const refreshed = await (await fetch(`${base}/v1/dashboard`)).json();
    assert.equal(refreshed.projects[0].productionItems[0].title, 'First shot');
    assert.equal(refreshed.projects[0].completion.total, 1);

    const sourcePath = path.join(directory, 'reference.txt');
    fs.writeFileSync(sourcePath, 'HTTP asset bytes\n', 'utf8');
    const assetResponse = await fetch(`${base}/v1/projects/${encodeURIComponent(project.id)}/assets`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'http-asset' },
      body: JSON.stringify({ source_path: sourcePath, asset_type: 'DOCUMENT', semantic_role: 'SOURCE_REFERENCE' }),
    });
    assert.equal(assetResponse.status, 200);
    const asset = await assetResponse.json();
    assert.equal(asset.name, 'reference.txt');
    assert.equal(asset.assetType, 'DOCUMENT');
    assert.equal(asset.availability, 'AVAILABLE');
    assert.equal(asset.readinessState, 'UNKNOWN');
    assert.match(asset.storageUri, /^object:\/\/sha-256\//);
    assert.ok(asset.importSessionId);

    const assets = await fetch(`${base}/v1/projects/${encodeURIComponent(project.id)}/assets`);
    assert.equal(assets.status, 200);
    const assetList = await assets.json();
    assert.equal(assetList.assets.length, 1);
    assert.equal(assetList.assets[0].contentHash, asset.contentHash);
    assert.equal(assetList.assets[0].readinessState, 'UNKNOWN');
    const globalAssetResponse = await fetch(`${base}/v1/assets`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'http-global-asset' },
      body: JSON.stringify({ source_path: sourcePath, storage_mode: 'REFERENCE', asset_type: 'DOCUMENT' }),
    });
    assert.equal(globalAssetResponse.status, 200);
    const globalAsset = await globalAssetResponse.json();
    assert.equal(globalAsset.projectId, null);
    const allAssets = await (await fetch(`${base}/v1/assets`)).json();
    assert.equal(allAssets.assets.length, 2);
    const dashboardAfterAsset = await (await fetch(`${base}/v1/dashboard`)).json();
    assert.ok(dashboardAfterAsset.activity.length >= 2);
    assert.ok(dashboardAfterAsset.activity.some((item) => item.projectId === project.id));
    assert.notEqual(dashboardAfterAsset.system.storageUsed, '—');
    const importSession = await fetch(`${base}/v1/imports/${encodeURIComponent(asset.importSessionId)}`);
    assert.equal(importSession.status, 200);
    const importDetails = await importSession.json();
    assert.equal(importDetails.result.session.state, 'COMMITTED');
    assert.equal(importDetails.result.items[0].source_path_or_uri, 'file://[redacted]');

    const acknowledged = await fetch(`${base}/v1/decisions/decision-1/ack`, { method: 'POST' });
    assert.equal(acknowledged.status, 404);
    assert.equal((await acknowledged.json()).error.code, 'NOT_FOUND');

    const health = await fetch(`${base}/v1/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).result.status, 'READY');
  } finally {
    await new Promise((resolve) => listener.server.close(resolve));
    core.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('HTTP intake exposes durable staging evidence and keeps REFERENCE availability UNKNOWN', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cineforge-http-staging-'));
  const core = new CoreService({ dbPath: path.join(directory, 'cineforge.sqlite'), assetStorePath: path.join(directory, 'asset-store') });
  const listener = await listenCoreHttp(core, { host: '127.0.0.1', port: 0 });
  const base = `http://127.0.0.1:${listener.address.port}`;
  const jsonRequest = async (pathName, options = {}) => {
    const response = await fetch(`${base}${pathName}`, {
      ...options,
      headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    });
    return { response, payload: await response.json() };
  };
  try {
    const sourcePath = path.join(directory, 'staged-http.txt');
    fs.writeFileSync(sourcePath, 'http durable staging', 'utf8');
    const copied = await jsonRequest('/v1/assets', {
      method: 'POST', headers: { 'idempotency-key': 'http-staging-copy' },
      body: JSON.stringify({ source_path: sourcePath, asset_type: 'DOCUMENT', storage_mode: 'COPY' }),
    });
    assert.equal(copied.response.status, 200);
    assert.equal(copied.payload.readinessState, 'UNKNOWN');
    const listed = await jsonRequest('/v1/storage/staging?state=REGISTERED');
    assert.equal(listed.response.status, 200);
    assert.equal(listed.payload.ok, true);
    assert.equal(listed.payload.result.items.length, 1);
    const staging = listed.payload.result.items[0];
    assert.equal(staging.state, 'REGISTERED');
    assert.equal(Object.hasOwn(staging, 'temp_path'), false);
    const reconciled = await jsonRequest('/v1/storage/staging/reconcile', {
      method: 'POST', headers: { 'idempotency-key': 'http-staging-reconcile' },
      body: JSON.stringify({ staging_id: staging.id }),
    });
    assert.equal(reconciled.response.status, 200);
    assert.equal(reconciled.payload.ok, true);
    assert.equal(reconciled.payload.result.staging.checked_count, 1);

    const referenced = await jsonRequest('/v1/assets', {
      method: 'POST', headers: { 'idempotency-key': 'http-staging-reference' },
      body: JSON.stringify({ source_path: sourcePath, asset_type: 'DOCUMENT', storage_mode: 'REFERENCE' }),
    });
    assert.equal(referenced.response.status, 200);
    assert.equal(referenced.payload.availability, 'UNKNOWN');
    assert.equal(referenced.payload.readinessState, 'UNKNOWN');
    assert.equal(referenced.payload.latestRevision.availability_state, 'UNKNOWN');
    assert.equal(referenced.payload.latestRevision.availability_evidence_state, 'UNKNOWN');
  } finally {
    await new Promise((resolve) => listener.server.close(resolve));
    core.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('HTTP rights routes expose UNKNOWN, ALLOWED and REVOKED states with auditable commands', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cineforge-http-rights-'));
  const core = new CoreService({ dbPath: path.join(directory, 'cineforge.sqlite'), assetStorePath: path.join(directory, 'asset-store') });
  const listener = await listenCoreHttp(core, { host: '127.0.0.1', port: 0 });
  const base = `http://127.0.0.1:${listener.address.port}`;
  const jsonRequest = async (pathName, options = {}) => {
    const response = await fetch(`${base}${pathName}`, {
      ...options,
      headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    });
    return { response, payload: await response.json() };
  };
  try {
    const sourcePath = path.join(directory, 'rights-http.txt');
    fs.writeFileSync(sourcePath, 'rights route bytes', 'utf8');
    const imported = await jsonRequest('/v1/assets', {
      method: 'POST', headers: { 'idempotency-key': 'http-rights-import' },
      body: JSON.stringify({ source_path: sourcePath, storage_mode: 'REFERENCE', asset_type: 'DOCUMENT' }),
    });
    assert.equal(imported.response.status, 200);
    assert.equal(imported.payload.rights.status, 'UNKNOWN');
    const assetId = imported.payload.id;
    const identityId = imported.payload.rights.rights_identity_id;
    assert.ok(identityId);

    const unknown = await jsonRequest(`/v1/assets/${assetId}/rights?territory=VN`);
    assert.equal(unknown.response.status, 200);
    assert.equal(unknown.payload.result.status, 'UNKNOWN');
    const record = await jsonRequest('/v1/commands', {
      method: 'POST', headers: { 'idempotency-key': 'http-rights-record' },
      body: JSON.stringify({ command_type: 'CreateRightsRecord', payload: {
        rights_identity_id: identityId, right_type: 'SOURCE_USE', status: 'ALLOWED', territory: ['VN'],
      } }),
    });
    assert.equal(record.response.status, 200);
    const consent = await jsonRequest('/v1/commands', {
      method: 'POST', headers: { 'idempotency-key': 'http-rights-consent' },
      body: JSON.stringify({ command_type: 'RecordConsent', payload: {
        rights_identity_id: identityId, consent_type: 'SOURCE_USE', granted_by: 'rights-holder',
      } }),
    });
    assert.equal(consent.response.status, 200);
    const allowed = await jsonRequest(`/v1/assets/${assetId}/rights?territory=VN`);
    assert.equal(allowed.payload.result.status, 'ALLOWED');
    const evaluated = await jsonRequest(`/v1/rights/evaluate?rights_identity_id=${identityId}&territory=VN`);
    assert.equal(evaluated.response.status, 200);
    assert.equal(evaluated.payload.result.eligible, true);
    const revoked = await jsonRequest('/v1/commands', {
      method: 'POST', headers: { 'idempotency-key': 'http-rights-revoke' },
      body: JSON.stringify({ command_type: 'RevokeRights', payload: {
        rights_identity_id: identityId, right_type: 'SOURCE_USE', reason: 'Withdrawn by holder',
      } }),
    });
    assert.equal(revoked.response.status, 200);
    const after = await jsonRequest(`/v1/assets/${assetId}/rights?territory=VN`);
    assert.equal(after.payload.result.status, 'REVOKED');
  } finally {
    await new Promise((resolve) => listener.server.close(resolve));
    core.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('HTTP task, shot and note routes preserve scope, optimistic concurrency and state machines', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cineforge-http-crud-'));
  const dbPath = path.join(directory, 'cineforge.sqlite');
  const core = new CoreService({ dbPath });
  let listener = await listenCoreHttp(core, { host: '127.0.0.1', port: 0 });
  const base = () => `http://127.0.0.1:${listener.address.port}`;
  const jsonRequest = async (pathName, options = {}) => {
    const response = await fetch(`${base()}${pathName}`, {
      ...options,
      headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    });
    return { response, payload: await response.json() };
  };
  try {
    const firstProject = await jsonRequest('/v1/projects', { method: 'POST', body: JSON.stringify({ title: 'Scope A' }) });
    const secondProject = await jsonRequest('/v1/projects', { method: 'POST', body: JSON.stringify({ title: 'Scope B' }) });
    assert.equal(firstProject.response.status, 200);
    assert.equal(secondProject.response.status, 200);
    const projectId = firstProject.payload.id;
    const otherProjectId = secondProject.payload.id;

    const createdTask = await jsonRequest(`/v1/projects/${projectId}/tasks`, {
      method: 'POST', headers: { 'idempotency-key': 'crud-task' }, body: JSON.stringify({ title: 'Plan scene' }),
    });
    assert.equal(createdTask.response.status, 200);
    const taskId = createdTask.payload.result.id;

    const taskList = await jsonRequest(`/v1/projects/${projectId}/tasks`);
    assert.equal(taskList.response.status, 200);
    assert.equal(taskList.payload.ok, true);
    assert.equal(taskList.payload.result.length, 1);
    assert.equal(taskList.payload.result[0].id, taskId);
    assert.equal(taskList.payload.result[0].row_version, 1);
    const taskRead = await jsonRequest(`/v1/projects/${projectId}/tasks/${taskId}`);
    assert.equal(taskRead.response.status, 200);
    assert.equal(taskRead.payload.result.id, taskId);

    const updatedTask = await jsonRequest(`/v1/projects/${projectId}/tasks/${taskId}`, {
      method: 'PATCH', body: JSON.stringify({ title: 'Plan scene v2', row_version: 1 }),
    });
    assert.equal(updatedTask.response.status, 200);
    assert.equal(updatedTask.payload.result.title, 'Plan scene v2');
    assert.equal(updatedTask.payload.result.row_version, 2);

    const staleTask = await jsonRequest(`/v1/projects/${projectId}/tasks/${taskId}`, {
      method: 'PATCH', body: JSON.stringify({ title: 'stale write', row_version: 1 }),
    });
    assert.equal(staleTask.response.status, 409);
    assert.equal(staleTask.payload.error.code, 'STALE_REVISION');

    const progressTask = await jsonRequest(`/v1/projects/${projectId}/tasks/${taskId}`, {
      method: 'PATCH', body: JSON.stringify({ status: 'IN_PROGRESS', row_version: 2 }),
    });
    assert.equal(progressTask.response.status, 200);
    const doneTask = await jsonRequest(`/v1/projects/${projectId}/tasks/${taskId}`, {
      method: 'PATCH', body: JSON.stringify({ status: 'DONE', row_version: 3 }),
    });
    assert.equal(doneTask.response.status, 200);
    const resurrectTask = await jsonRequest(`/v1/projects/${projectId}/tasks/${taskId}`, {
      method: 'PATCH', body: JSON.stringify({ status: 'IN_PROGRESS', row_version: 4 }),
    });
    assert.equal(resurrectTask.response.status, 409);
    assert.equal(resurrectTask.payload.error.code, 'INVALID_STATE_TRANSITION');

    const createdShot = await jsonRequest(`/v1/projects/${projectId}/shots`, {
      method: 'POST', headers: { 'idempotency-key': 'crud-shot' }, body: JSON.stringify({ code: 'SH010', title: 'Door opens' }),
    });
    assert.equal(createdShot.response.status, 200);
    const shotId = createdShot.payload.result.id;
    const replayShot = await jsonRequest(`/v1/projects/${projectId}/shots`, {
      method: 'POST', headers: { 'idempotency-key': 'crud-shot' }, body: JSON.stringify({ code: 'SH010', title: 'Door opens' }),
    });
    assert.equal(replayShot.response.status, 200);
    assert.equal(replayShot.payload.result.id, shotId);
    assert.equal(replayShot.payload.result.idempotent_replay, true);
    const conflictingShotReplay = await jsonRequest(`/v1/projects/${projectId}/shots`, {
      method: 'POST', headers: { 'idempotency-key': 'crud-shot' }, body: JSON.stringify({ code: 'SH010', title: 'Different title' }),
    });
    assert.equal(conflictingShotReplay.response.status, 409);
    assert.equal(conflictingShotReplay.payload.error.code, 'IDEMPOTENCY_KEY_REUSE_CONFLICT');
    assert.equal(conflictingShotReplay.payload.error.category, 'CONFLICT');

    const shotList = await jsonRequest(`/v1/projects/${projectId}/shots`);
    assert.equal(shotList.payload.result[0].row_version, 1);
    const shotRead = await jsonRequest(`/v1/projects/${projectId}/shots/${shotId}`);
    assert.equal(shotRead.response.status, 200);
    assert.equal(shotRead.payload.result.id, shotId);
    const archivedShot = await jsonRequest(`/v1/projects/${projectId}/shots/${shotId}`, {
      method: 'PATCH', body: JSON.stringify({ lifecycle_state: 'ARCHIVED', row_version: 1 }),
    });
    assert.equal(archivedShot.response.status, 200);
    const resurrectShot = await jsonRequest(`/v1/projects/${projectId}/shots/${shotId}`, {
      method: 'PATCH', body: JSON.stringify({ lifecycle_state: 'ACTIVE', row_version: 2 }),
    });
    assert.equal(resurrectShot.response.status, 409);
    assert.equal(resurrectShot.payload.error.code, 'INVALID_STATE_TRANSITION');

    const projectNote = await jsonRequest(`/v1/projects/${projectId}/notes`, {
      method: 'POST', body: JSON.stringify({ body: 'Project direction' }),
    });
    assert.equal(projectNote.response.status, 200);
    assert.equal(projectNote.payload.result.entity_type, 'PROJECT');
    assert.equal(projectNote.payload.result.entity_id, projectId);

    const taskNote = await jsonRequest(`/v1/projects/${projectId}/tasks/${taskId}/notes`, {
      method: 'POST', body: JSON.stringify({ body: 'Task direction' }),
    });
    assert.equal(taskNote.response.status, 200);
    assert.equal(taskNote.payload.result.entity_type, 'TASK');
    assert.equal(taskNote.payload.result.note.entity_type, 'TASK');
    assert.equal(taskNote.payload.result.note.entity_id, taskId);
    const taskNotes = await jsonRequest(`/v1/projects/${projectId}/tasks/${taskId}/notes`);
    assert.equal(taskNotes.response.status, 200);
    assert.equal(taskNotes.payload.result.length, 1);
    assert.equal(taskNotes.payload.result[0].body, 'Task direction');

    const otherTask = await jsonRequest(`/v1/projects/${otherProjectId}/tasks`, {
      method: 'POST', body: JSON.stringify({ title: 'Private task' }),
    });
    const otherTaskId = otherTask.payload.result.id;
    const crossScopeNote = await jsonRequest(`/v1/projects/${projectId}/tasks/${otherTaskId}/notes`, {
      method: 'POST', body: JSON.stringify({ body: 'Must be rejected' }),
    });
    assert.equal(crossScopeNote.response.status, 409);
    assert.equal(crossScopeNote.payload.error.code, 'ENTITY_SCOPE_MISMATCH');

    const crossScopeGenericNote = await jsonRequest(`/v1/projects/${projectId}/notes`, {
      method: 'POST', body: JSON.stringify({ entity_type: 'TASK', entity_id: otherTaskId, body: 'Must also be rejected' }),
    });
    assert.equal(crossScopeGenericNote.response.status, 409);
    assert.equal(crossScopeGenericNote.payload.error.code, 'ENTITY_SCOPE_MISMATCH');

    const crossScopeCommand = await jsonRequest('/v1/commands', {
      method: 'POST', headers: { 'idempotency-key': 'cross-scope-command' }, body: JSON.stringify({
        command_type: 'UpdateTask',
        payload: { task_id: taskId, project_id: otherProjectId, title: 'Must be rejected' },
        expected_versions: { TASK: 4 },
      }),
    });
    assert.equal(crossScopeCommand.response.status, 409);
    assert.equal(crossScopeCommand.payload.error.code, 'ENTITY_SCOPE_MISMATCH');

    await new Promise((resolve) => listener.server.close(resolve));
    core.close();
    const reopened = new CoreService({ dbPath });
    listener = await listenCoreHttp(reopened, { host: '127.0.0.1', port: 0 });
    const afterRestart = await jsonRequest(`/v1/projects/${projectId}/tasks`);
    assert.equal(afterRestart.response.status, 200);
    assert.equal(afterRestart.payload.result[0].status, 'DONE');
    const notesAfterRestart = await jsonRequest(`/v1/projects/${projectId}/notes`);
    assert.equal(notesAfterRestart.response.status, 200);
    assert.equal(notesAfterRestart.payload.result.length, 2);
    await new Promise((resolve) => listener.server.close(resolve));
    reopened.close();
  } finally {
    // The restart path closes its own Core/listener.  Keep cleanup defensive
    // so a failed assertion cannot leave an open listener or SQLite handle.
    if (listener?.server?.listening) await new Promise((resolve) => listener.server.close(resolve));
    try { core.close(); } catch { /* already closed after restart */ }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('HTTP DecisionRequest routes expose canonical choices and stale-safe resolution', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cineforge-http-decisions-'));
  const core = new CoreService({ dbPath: path.join(directory, 'cineforge.sqlite') });
  const listener = await listenCoreHttp(core, { host: '127.0.0.1', port: 0 });
  const base = `http://127.0.0.1:${listener.address.port}`;
  const jsonRequest = async (pathName, options = {}) => {
    const response = await fetch(`${base}${pathName}`, {
      ...options,
      headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    });
    return { response, payload: await response.json() };
  };
  try {
    const project = await jsonRequest('/v1/projects', { method: 'POST', headers: { 'idempotency-key': 'decision-http-project' }, body: JSON.stringify({ title: 'Decision HTTP' }) });
    assert.equal(project.response.status, 200);
    const projectId = project.payload.id;
    const created = await jsonRequest('/v1/commands', {
      method: 'POST', headers: { 'idempotency-key': 'decision-http-create' },
      body: JSON.stringify({ command_type: 'CreateDecisionRequest', payload: {
        project_id: projectId, decision_type: 'RIGHTS_REVIEW', title_key: 'rights.title', reason_key: 'rights.reason',
        blocking_scope_type: 'PROJECT', blocking_scope_id: projectId, severity: 'HIGH',
        choices: [{ id: 'allow', label_key: 'rights.allow', recommended: true }, { id: 'hold', label_key: 'rights.hold' }],
      } }),
    });
    assert.equal(created.response.status, 200);
    const decision = created.payload.result.decision ?? created.payload.result;
    assert.equal(decision.state, 'OPEN');
    assert.equal(decision.decision_version, 1);
    assert.equal(decision.choices.length, 2);

    const dashboard = await (await fetch(`${base}/v1/dashboard`)).json();
    assert.equal(dashboard.decisions.length, 1);
    assert.equal(dashboard.decisions[0].id, decision.id);
    const list = await jsonRequest('/v1/decisions');
    assert.equal(list.response.status, 200);
    assert.equal(list.payload.result.items.length, 1);
    const detail = await jsonRequest(`/v1/decisions/${encodeURIComponent(decision.id)}`);
    assert.equal(detail.response.status, 200);
    assert.equal(detail.payload.result.id, decision.id);

    const stale = await jsonRequest(`/v1/decisions/${encodeURIComponent(decision.id)}/resolve`, {
      method: 'POST', headers: { 'idempotency-key': 'decision-http-stale' },
      body: JSON.stringify({ choice_id: 'allow', expected_decision_version: 2 }),
    });
    assert.equal(stale.response.status, 409);
    assert.equal(stale.payload.error.code, 'STALE_DECISION');

    const resolved = await jsonRequest(`/v1/decisions/${encodeURIComponent(decision.id)}/resolve`, {
      method: 'POST', headers: { 'idempotency-key': 'decision-http-resolve' },
      body: JSON.stringify({ choice_id: 'allow', expected_decision_version: 1 }),
    });
    assert.equal(resolved.response.status, 200);
    assert.equal((resolved.payload.result.decision ?? resolved.payload.result).state, 'RESOLVED');
    const replay = await jsonRequest(`/v1/decisions/${encodeURIComponent(decision.id)}/resolve`, {
      method: 'POST', headers: { 'idempotency-key': 'decision-http-resolve' },
      body: JSON.stringify({ choice_id: 'allow', expected_decision_version: 1 }),
    });
    assert.equal(replay.response.status, 200);
    assert.equal(replay.payload.result.idempotent_replay, true);
    const empty = await jsonRequest('/v1/decisions');
    assert.equal(empty.payload.result.items.length, 0);
  } finally {
    await new Promise((resolve) => listener.server.close(resolve));
    core.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('HTTP DecisionRequest routes expose canonical Needs You state and stale-safe resolution', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cineforge-http-decisions-'));
  const dbPath = path.join(directory, 'cineforge.sqlite');
  const core = new CoreService({ dbPath });
  let listener = await listenCoreHttp(core, { host: '127.0.0.1', port: 0 });
  const base = () => `http://127.0.0.1:${listener.address.port}`;
  const jsonRequest = async (pathName, options = {}) => {
    const response = await fetch(`${base()}${pathName}`, {
      ...options,
      headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    });
    return { response, payload: await response.json() };
  };
  try {
    const projectResponse = await jsonRequest('/v1/projects', {
      method: 'POST', headers: { 'idempotency-key': 'decision-http-project' }, body: JSON.stringify({ title: 'Decision HTTP' }),
    });
    const projectId = projectResponse.payload.id;
    const created = await jsonRequest('/v1/commands', {
      method: 'POST', headers: { 'idempotency-key': 'decision-http-create' }, body: JSON.stringify({
        command_type: 'CreateDecisionRequest',
        payload: {
          project_id: projectId,
          decision_type: 'CREATIVE_REVIEW',
          title_key: 'decisions.creative.title',
          reason_key: 'decisions.creative.reason',
          blocking_scope_type: 'PROJECT',
          blocking_scope_id: projectId,
          severity: 'CRITICAL',
          choices: [
            { id: 'accept', label_key: 'decisions.choice.accept', recommended: true },
            { id: 'wait', label_key: 'decisions.choice.wait' },
          ],
        },
      }),
    });
    assert.equal(created.response.status, 200);
    assert.equal(created.payload.result.state, 'OPEN');
    const decisionId = created.payload.result.id;

    const dashboard = await jsonRequest('/v1/dashboard');
    assert.equal(dashboard.response.status, 200);
    assert.equal(dashboard.payload.decisions.length, 1);
    assert.equal(dashboard.payload.decisions[0].projectId, projectId);
    assert.equal(dashboard.payload.decisions[0].priority, 'high');
    assert.equal(dashboard.payload.decisions[0].choices[0].id, 'accept');

    const listed = await jsonRequest('/v1/decisions?project_id=' + encodeURIComponent(projectId));
    assert.equal(listed.response.status, 200);
    assert.equal(listed.payload.ok, true);
    assert.equal(listed.payload.result.items.length, 1);
    assert.equal(listed.payload.result.items[0].id, decisionId);
    assert.equal(listed.payload.result.items[0].decisionVersion, 1);

    const found = await jsonRequest(`/v1/decisions/${decisionId}`);
    assert.equal(found.response.status, 200);
    assert.equal(found.payload.result.reason, 'decisions.creative.reason');

    const invalidChoice = await jsonRequest(`/v1/decisions/${decisionId}/resolve`, {
      method: 'POST', headers: { 'idempotency-key': 'decision-http-invalid' },
      body: JSON.stringify({ choice_id: 'missing', expected_decision_version: 1 }),
    });
    assert.equal(invalidChoice.response.status, 409);
    assert.equal(invalidChoice.payload.error.code, 'INVALID_DECISION_CHOICE');

    const stale = await jsonRequest(`/v1/decisions/${decisionId}/resolve`, {
      method: 'POST', headers: { 'idempotency-key': 'decision-http-stale' },
      body: JSON.stringify({ choice_id: 'accept', expected_decision_version: 2 }),
    });
    assert.equal(stale.response.status, 409);
    assert.equal(stale.payload.error.code, 'STALE_DECISION');

    const resolved = await jsonRequest(`/v1/decisions/${decisionId}/resolve`, {
      method: 'POST', headers: { 'idempotency-key': 'decision-http-resolve' },
      body: JSON.stringify({ choice_id: 'accept', expected_decision_version: 1 }),
    });
    assert.equal(resolved.response.status, 200);
    assert.equal(resolved.payload.result.state, 'RESOLVED');
    assert.equal(resolved.payload.result.resolved_choice_id, 'accept');
    const replay = await jsonRequest(`/v1/decisions/${decisionId}/resolve`, {
      method: 'POST', headers: { 'idempotency-key': 'decision-http-resolve' },
      body: JSON.stringify({ choice_id: 'accept', expected_decision_version: 1 }),
    });
    assert.equal(replay.response.status, 200);
    assert.equal(replay.payload.result.idempotent_replay, true);
    const open = await jsonRequest('/v1/decisions');
    assert.equal(open.payload.result.items.length, 0);
    const resolvedList = await jsonRequest('/v1/decisions?state=RESOLVED');
    assert.equal(resolvedList.payload.result.items.length, 1);

    const second = await jsonRequest('/v1/commands', {
      method: 'POST', headers: { 'idempotency-key': 'decision-http-second' }, body: JSON.stringify({
        command_type: 'CreateDecisionRequest',
        payload: {
          project_id: projectId, decision_type: 'WAIT', title_key: 'decisions.wait.title', reason_key: 'decisions.wait.reason',
          blocking_scope_type: 'PROJECT', blocking_scope_id: projectId,
          choices: [{ id: 'dismiss', label_key: 'decisions.choice.dismiss' }],
        },
      }),
    });
    const secondId = second.payload.result.id;
    const dismissed = await jsonRequest(`/v1/decisions/${secondId}/dismiss`, {
      method: 'POST', headers: { 'idempotency-key': 'decision-http-dismiss' }, body: JSON.stringify({ expected_decision_version: 1 }),
    });
    assert.equal(dismissed.response.status, 200);
    assert.equal(dismissed.payload.result.state, 'DISMISSED');

    await new Promise((resolve) => listener.server.close(resolve));
    core.close();
    const reopened = new CoreService({ dbPath });
    listener = await listenCoreHttp(reopened, { host: '127.0.0.1', port: 0 });
    const afterRestart = await jsonRequest('/v1/decisions?state=RESOLVED');
    assert.equal(afterRestart.response.status, 200);
    assert.equal(afterRestart.payload.result.items[0].state, 'RESOLVED');
    await new Promise((resolve) => listener.server.close(resolve));
    reopened.close();
  } finally {
    if (listener?.server?.listening) await new Promise((resolve) => listener.server.close(resolve));
    try { core.close(); } catch { /* already closed after restart */ }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('HTTP local backup routes expose redacted metadata, admission and verification', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cineforge-http-backup-'));
  const dbPath = path.join(directory, 'cineforge.sqlite');
  const assetStorePath = path.join(directory, 'asset-store');
  const destination = path.join(directory, 'backup-destination');
  const sourcePath = path.join(directory, 'source.txt');
  fs.writeFileSync(sourcePath, 'backup route bytes\n', 'utf8');
  const core = new CoreService({ dbPath, assetStorePath });
  let listener = await listenCoreHttp(core, { host: '127.0.0.1', port: 0 });
  let base = `http://127.0.0.1:${listener.address.port}`;
  const jsonRequest = async (pathName, options = {}) => {
    const response = await fetch(`${base}${pathName}`, {
      ...options,
      headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    });
    return { response, payload: await response.json() };
  };
  try {
    const imported = await jsonRequest('/v1/assets', {
      method: 'POST', headers: { 'idempotency-key': 'http-backup-asset' },
      body: JSON.stringify({ source_path: sourcePath, storage_mode: 'COPY', asset_type: 'DOCUMENT' }),
    });
    assert.equal(imported.response.status, 200);

    const admission = await jsonRequest(`/v1/storage/admission?destination_path=${encodeURIComponent(destination)}&reserve_bytes=0`);
    assert.equal(admission.response.status, 200);
    assert.equal(admission.payload.result.destination_name, path.basename(destination));
    assert.equal(admission.payload.result.durability_class, 'LOCAL_WRITABLE');
    assert.ok(Number(admission.payload.result.estimated_bytes) > 0);

    const created = await jsonRequest('/v1/backups', {
      method: 'POST', headers: { 'idempotency-key': 'http-backup-create' },
      body: JSON.stringify({ destination_path: destination, reserve_bytes: 0 }),
    });
    assert.equal(created.response.status, 200);
    assert.equal(created.payload.ok, true);
    const backup = created.payload.result.backup;
    assert.equal(backup.state, 'VERIFIED');
    assert.equal(Object.hasOwn(backup, 'destination_path'), false);
    assert.equal(Object.hasOwn(backup, 'manifest_path'), false);
    assert.equal(Object.hasOwn(backup, 'snapshot_path'), false);
    assert.equal(backup.destination_name, backup.id);
    assert.equal(backup.manifest_name, 'manifest.json');
    assert.equal(backup.snapshot_name, 'cineforge.sqlite');

    const dashboardWithBackup = await fetch(`${base}/v1/dashboard`);
    assert.equal(dashboardWithBackup.status, 200);
    const dashboardHealth = (await dashboardWithBackup.json()).system;
    assert.equal(dashboardHealth.backupState, 'VERIFIED');
    assert.equal(dashboardHealth.storagePressure, false);
    assert.equal(dashboardHealth.storageAttention, false);

    const replay = await jsonRequest('/v1/backups', {
      method: 'POST', headers: { 'idempotency-key': 'http-backup-create' },
      body: JSON.stringify({ destination_path: destination, reserve_bytes: 0 }),
    });
    assert.equal(replay.response.status, 200);
    assert.equal(replay.payload.result.idempotent_replay, true);
    assert.equal(replay.payload.result.backup.id, backup.id);

    const listed = await jsonRequest('/v1/backups');
    assert.equal(listed.response.status, 200);
    assert.equal(listed.payload.result.backups.length, 1);
    assert.equal(listed.payload.result.backups[0].id, backup.id);

    const detail = await jsonRequest(`/v1/backups/${encodeURIComponent(backup.id)}`);
    assert.equal(detail.response.status, 200);
    assert.equal(detail.payload.result.backup.id, backup.id);
    assert.equal(detail.payload.result.verifications.length, 1);
    assert.equal(detail.payload.result.verifications[0].outcome, 'VERIFIED');

    const verified = await jsonRequest(`/v1/backups/${encodeURIComponent(backup.id)}/verify`, {
      method: 'POST', headers: { 'idempotency-key': 'http-backup-verify' }, body: '{}',
    });
    assert.equal(verified.response.status, 200);
    assert.equal(verified.payload.result.verification.outcome, 'VERIFIED');

    const pressure = await jsonRequest('/v1/backups', {
      method: 'POST', headers: { 'idempotency-key': 'http-backup-pressure' },
      body: JSON.stringify({ destination_path: path.join(directory, 'rejected'), max_backup_bytes: 1 }),
    });
    assert.equal(pressure.response.status, 409);
    assert.equal(pressure.payload.error.code, 'STORAGE_PRESSURE');
    assert.equal(fs.existsSync(path.join(directory, 'rejected')), false);

    const missing = await jsonRequest('/v1/backups/missing-backup');
    assert.equal(missing.response.status, 404);
    assert.equal(missing.payload.error.code, 'NOT_FOUND');
  } finally {
    if (listener?.server?.listening) await new Promise((resolve) => listener.server.close(resolve));
    try { core.close(); } catch { /* preserve cleanup */ }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
