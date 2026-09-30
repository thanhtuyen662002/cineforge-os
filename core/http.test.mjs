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

    const characterHeaders = { 'content-type': 'application/json', 'idempotency-key': 'http-character' };
    const characterCreate = await fetch(`${base}/v1/projects/${encodeURIComponent(project.id)}/characters`, {
      method: 'POST', headers: characterHeaders,
      body: JSON.stringify({ display_name: 'Maya', stable_code: 'MAYA' }),
    });
    assert.equal(characterCreate.status, 200);
    const character = await characterCreate.json();
    assert.equal(character.displayName, 'Maya');
    assert.equal(character.stableCode, 'MAYA');
    assert.ok(character.visualIdentityPackage);
    assert.deepEqual(character.visualIdentityPackage.candidateRevisions, []);

    const characterReplay = await fetch(`${base}/v1/projects/${encodeURIComponent(project.id)}/characters`, {
      method: 'POST', headers: characterHeaders,
      body: JSON.stringify({ display_name: 'Maya', stable_code: 'MAYA' }),
    });
    assert.equal(characterReplay.status, 200);
    assert.equal((await characterReplay.json()).id, character.id);

    const charactersResponse = await fetch(`${base}/v1/projects/${encodeURIComponent(project.id)}/characters`);
    assert.equal(charactersResponse.status, 200);
    const characters = await charactersResponse.json();
    assert.equal(characters.result.characters.length, 1);
    assert.equal(characters.result.characters[0].id, character.id);

    const characterWorkspaceResponse = await fetch(`${base}/v1/projects/${encodeURIComponent(project.id)}/characters/${encodeURIComponent(character.id)}/workspace`);
    assert.equal(characterWorkspaceResponse.status, 200);
    const characterWorkspace = await characterWorkspaceResponse.json();
    assert.equal(characterWorkspace.result.character.id, character.id);
    assert.ok(characterWorkspace.result.character.voiceIdentityPackage);
    assert.deepEqual(characterWorkspace.result.character.voiceIdentityPackage.candidateRevisions, []);

    const visualRevisionResponse = await fetch(`${base}/v1/characters/${encodeURIComponent(character.id)}/visual-revisions`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'http-character-visual' },
      body: JSON.stringify({ semantic_description: 'Short hair and a red scarf.' }),
    });
    assert.equal(visualRevisionResponse.status, 200);
    const visualRevision = await visualRevisionResponse.json();
    assert.equal(visualRevision.result.character.id, character.id);
    assert.equal(visualRevision.result.revision.state, 'DRAFT');
    assert.equal(visualRevision.result.revision.semantic_description, 'Short hair and a red scarf.');

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
    const healthPayload = await health.json();
    assert.equal(healthPayload.result.status, 'READY');
    assert.equal(Object.hasOwn(healthPayload.result, 'db_path'), false);
    assert.equal(Object.hasOwn(healthPayload.result, 'wal_path'), false);
    assert.equal(Object.hasOwn(healthPayload.result, 'object_store_path'), false);

    const recovery = await fetch(`${base}/v1/recovery/status`);
    assert.equal(recovery.status, 200);
    const recoveryPayload = await recovery.json();
    assert.equal(recoveryPayload.ok, true);
    assert.equal(recoveryPayload.result.read_only, true);
    assert.equal(recoveryPayload.result.recovery_epoch_state, 'NOT_INITIALIZED');
    assert.equal(recoveryPayload.result.readiness_state, 'UNKNOWN');
    assert.ok(recoveryPayload.result.checks.some((check) => check.id === 'EXTERNAL_REALITY_LEDGER' && check.state === 'UNKNOWN'));
  } finally {
    await new Promise((resolve) => listener.server.close(resolve));
    core.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('HTTP storage scrub health exposes bounded read-only CAS evidence', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cineforge-http-scrub-'));
  const dbPath = path.join(directory, 'cineforge.sqlite');
  const sourcePath = path.join(directory, 'source.txt');
  fs.writeFileSync(sourcePath, 'http scrub bytes\n', 'utf8');
  const core = new CoreService({ dbPath });
  const listener = await listenCoreHttp(core, { host: '127.0.0.1', port: 0 });
  const base = `http://127.0.0.1:${listener.address.port}`;
  try {
    const imported = await fetch(`${base}/v1/assets`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'http-scrub-import' },
      body: JSON.stringify({ source_path: sourcePath, asset_type: 'DOCUMENT', storage_mode: 'COPY' }),
    });
    assert.equal(imported.status, 200);

    const healthy = await fetch(`${base}/v1/storage/scrub-health?limit=1&max_bytes=1024`);
    assert.equal(healthy.status, 200);
    const healthyPayload = await healthy.json();
    assert.equal(healthyPayload.ok, true);
    assert.equal(healthyPayload.result.status, 'PASS');
    assert.equal(healthyPayload.result.read_only, true);
    assert.equal(healthyPayload.result.limits.max_objects, 1);
    assert.equal(healthyPayload.result.scan.complete, true);
    assert.equal(healthyPayload.result.objects[0].state, 'PASS');
    assert.equal(Object.hasOwn(healthyPayload.result.objects[0], 'relative_path'), false);

    const bounded = await fetch(`${base}/v1/storage/scrub-health?max_bytes=1`);
    assert.equal(bounded.status, 200);
    const boundedPayload = await bounded.json();
    assert.equal(boundedPayload.result.status, 'UNKNOWN');
    assert.equal(boundedPayload.result.scan.truncated, true);
    assert.equal(boundedPayload.result.scan.truncation_reason, 'MAX_BYTES');

    const invalid = await fetch(`${base}/v1/storage/scrub-health?limit=201`);
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, 'INVALID_ARGUMENT');
  } finally {
    await new Promise((resolve) => listener.server.close(resolve));
    core.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('HTTP character routes preserve identity/package boundaries and command idempotency', async () => {
  const calls = [];
  const core = {
    handle(request) {
      calls.push(request);
      if (request.method === 'query.character.list') return {
        ok: true,
        result: {
          generated_at: '2026-01-01T00:00:00.000Z',
          projection_seq: 12,
          characters: [{
            id: 'character-1', project_id: 'project-1', stable_code: 'MAYA', display_name: 'Maya',
            lifecycle_state: 'ACTIVE', row_version: 2, rights_summary: { provider_id: '/tmp/provider-secret' }, usage: { provider_path: '/tmp/usage-secret' }, costume_state: { path: '/tmp/costume-secret' },
            visual_identity_package: { id: 'visual-package-1', candidate_revisions: [{ id: 'visual-rev-1', revision_number: 1, state: 'DRAFT' }] },
            voice_identity_package: { id: 'voice-package-1', candidate_revisions: [{ id: 'voice-rev-1', revision_number: 1, state: 'DRAFT', canonical_language: 'vi-VN', binding_state: 'TESTING', readiness_state: 'UNKNOWN', next_step: 'Attach rights', rights: { status: 'UNKNOWN', blockers: [{ code: 'RIGHTS_MISSING', dimension: 'RIGHT', path: 'C:/secret', provider_voice_id: 'provider-secret' }] } }] },
          }],
        },
      };
      if (request.method === 'query.character.workspace') return {
        ok: true,
        result: {
          character: { id: 'character-1', project_id: 'project-1', stable_code: 'MAYA', display_name: 'Maya' },
          visual_revisions: [{ id: 'visual-rev-1', state: 'DRAFT' }],
          voice_revisions: [{ id: 'voice-rev-1', state: 'DRAFT', canonical_language: 'vi-VN' }],
          performance_bible_revisions: [{ id: 'performance-rev-1', state: 'DRAFT' }],
          needs_you: [{ id: 'decision-1', needs_user: true }],
        },
      };
      if (request.method === 'command.execute' && request.params.command_type === 'CreateCharacter') return {
        ok: true,
        result: { id: 'character-2', project_id: request.params.payload.project_id, stable_code: 'LINH', display_name: 'Linh', lifecycle_state: 'ACTIVE', row_version: 1 },
      };
      if (request.method === 'command.execute') return {
        ok: true,
        result: { id: `${request.params.command_type.toLowerCase()}-1`, character_id: request.params.payload.character_id, state: 'DRAFT' },
      };
      return { ok: false, error: { code: 'NOT_FOUND', category: 'VALIDATION' } };
    },
  };
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
    const listed = await jsonRequest('/v1/projects/project-1/characters?lifecycle_state=ACTIVE');
    assert.equal(listed.response.status, 200);
    assert.equal(listed.payload.result.characters[0].id, 'character-1');
    assert.equal(listed.payload.result.characters[0].visualIdentityPackage.candidateRevisions[0].id, 'visual-rev-1');
    assert.equal(listed.payload.result.characters[0].voiceIdentityPackage.candidateRevisions[0].canonicalLanguage, 'vi-VN');
    assert.equal(listed.payload.result.characters[0].voiceIdentityPackage.candidateRevisions[0].rightsStatus, 'UNKNOWN');
    assert.equal(listed.payload.result.characters[0].voiceIdentityPackage.candidateRevisions[0].readinessState, 'UNKNOWN');
    assert.equal(listed.payload.result.characters[0].voiceIdentityPackage.candidateRevisions[0].rights.blockers[0].code, 'RIGHTS_MISSING');
    assert.equal(Object.hasOwn(listed.payload.result.characters[0].voiceIdentityPackage.candidateRevisions[0].rights.blockers[0], 'path'), false);
    assert.equal(Object.hasOwn(listed.payload.result.characters[0].voiceIdentityPackage.candidateRevisions[0].rights.blockers[0], 'provider_voice_id'), false);
    assert.equal(listed.payload.result.characters[0].rights, null);
    assert.equal(listed.payload.result.characters[0].usage, null);
    assert.equal(listed.payload.result.characters[0].costumeState, null);

    const workspace = await jsonRequest('/v1/characters/character-1/workspace?project_id=project-1');
    assert.equal(workspace.response.status, 200);
    assert.equal(workspace.payload.result.character.id, 'character-1');
    assert.equal(workspace.payload.result.character.performanceBible.candidateRevisions[0].id, 'performance-rev-1');
    assert.equal(workspace.payload.result.needsYou.length, 1);

    const created = await jsonRequest('/v1/projects/project-1/characters', {
      method: 'POST', headers: { 'idempotency-key': 'http-character-create' },
      body: JSON.stringify({ stable_code: 'LINH', display_name: 'Linh' }),
    });
    assert.equal(created.response.status, 200);
    assert.equal(created.payload.displayName, 'Linh');
    const visual = await jsonRequest('/v1/characters/character-1/visual-revisions', {
      method: 'POST', headers: { 'idempotency-key': 'http-character-visual' }, body: JSON.stringify({ semantic_description: 'Short hair' }),
    });
    assert.equal(visual.response.status, 200);
    assert.equal(visual.payload.result.character_id, 'character-1');
    const voice = await jsonRequest('/v1/characters/character-1/voice-revisions', {
      method: 'POST', headers: { 'idempotency-key': 'http-character-voice' }, body: JSON.stringify({ canonical_language: 'vi-VN' }),
    });
    assert.equal(voice.response.status, 200);
    assert.equal(voice.payload.result.character_id, 'character-1');
    const commands = calls.filter((call) => call.method === 'command.execute');
    const listQuery = calls.find((call) => call.method === 'query.character.list');
    assert.equal(listQuery.params.lifecycle_state, 'ACTIVE');
    const workspaceQuery = calls.find((call) => call.method === 'query.character.workspace');
    assert.equal(workspaceQuery.params.project_id, 'project-1');
    assert.equal(commands[0].params.command_type, 'CreateCharacter');
    assert.equal(commands[0].params.idempotency_key, 'http-character-create');
    assert.equal(commands[1].params.command_type, 'CreateVisualIdentityRevision');
    assert.equal(commands[1].params.payload.character_id, 'character-1');
  } finally {
    await new Promise((resolve) => listener.server.close(resolve));
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

    const restoreEstimate = await jsonRequest(`/v1/backups/${encodeURIComponent(backup.id)}/restore-estimate`);
    assert.equal(restoreEstimate.response.status, 200);
    assert.equal(restoreEstimate.payload.result.restore_estimate.restore_allowed, false);
    assert.equal(restoreEstimate.payload.result.restore_estimate.activation_state, 'NOT_IMPLEMENTED');
    assert.equal(restoreEstimate.payload.result.restore_estimate.artifact.object_count, 1);
    assert.equal(restoreEstimate.payload.result.restore_estimate.target.schema_state, 'PASS');

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

test('HTTP timeline/profile routes use typed commands and redact unsafe fields', async () => {
  const calls = [];
  const core = {
    handle(request) {
      calls.push(request);
      if (request.method === 'query.media_profile.workspace') return {
        ok: true,
        result: {
          profile: {
            id: 'profile-1', project_id: 'project-1', provider_path: 'C:/private/provider',
            revisions: [{
              id: 'profile-rev-1', profile_id: 'profile-1', project_id: 'project-1', revision_number: 1,
              lifecycle_state: 'CANDIDATE', row_version: 2,
              timeline_rate: { num: 24000, den: 1001 }, time_base: { num: 1001, den: 24000 }, pixel_aspect: { num: 1, den: 1 },
              width: 1920, height: 1080, working_color_space: 'REC709', transfer_function: 'SDR', hdr_policy: 'DISABLED',
              audio_sample_rate: 48000, audio_channel_layout: 'STEREO', provider_id: 'secret-provider',
            }],
          },
          projection_seq: 8, generated_at: '2026-01-01T00:00:00.000Z',
        },
      };
      if (request.method === 'query.timeline.list') return {
        ok: true,
        result: { timelines: [{ id: 'timeline-1', project_id: 'project-1', scope_type: 'PROJECT', scope_id: 'project-1', title: 'Picture', row_version: 3, provider_path: 'C:/private' }], projection_seq: 9 },
      };
      if (request.method === 'query.timeline.workspace') return {
        ok: true,
        result: {
          timeline: { id: 'timeline-1', project_id: 'project-1', scope_type: 'PROJECT', title: 'Picture', row_version: 3 },
          media_profile: {
            profile: { id: 'profile-1', project_id: 'project-1' },
            revisions: [{ id: 'profile-rev-1', project_id: 'project-1', lifecycle_state: 'APPROVED', timeline_rate: { num: 24, den: 1 }, time_base: { num: 1, den: 24 }, pixel_aspect: { num: 1, den: 1 }, width: 1920, height: 1080 }],
          },
          revisions: [{
            id: 'timeline-rev-1', timeline_id: 'timeline-1', media_profile_revision_id: 'profile-rev-1', lifecycle_state: 'DRAFT_CHECKPOINT',
            duration: { num: 48, den: 1 }, edit_hash: 'hash-1',
            tracks: [{ id: 'track-1', track_type: 'VIDEO', order_index: 0, name: 'Picture', clips: [{
              id: 'clip-1', asset_revision_id: 'asset-rev-1', timeline_in: { num: 0, den: 1 }, timeline_out: { num: 48, den: 1 },
              source_in: { num: 10, den: 1 }, source_out: { num: 58, den: 1 }, speed: { num: 1, den: 1 }, provider_path: 'C:/private',
            }] }],
            markers: [{ id: 'marker-1', time: { num: 12, den: 1 }, marker_type: 'NOTE', label: 'Beat', payload: { provider_path: 'C:/private' } }],
          }],
          needs_you: [], projection_seq: 10,
        },
      };
      if (request.method === 'command.execute') {
        const type = request.params.command_type;
        if (type === 'CreateTimeline') return { ok: true, result: { id: 'timeline-2', project_id: 'project-1', scope_type: 'PROJECT', title: 'New timeline', row_version: 1 } };
        if (type === 'CreateTimelineRevision' || type === 'TransitionTimelineRevision') return { ok: true, result: {
          timeline: { id: 'timeline-1', project_id: 'project-1', title: 'Picture', row_version: 4 },
          revision: { id: 'timeline-rev-1', timeline_id: 'timeline-1', media_profile_revision_id: 'profile-rev-1', lifecycle_state: type === 'TransitionTimelineRevision' ? 'CANDIDATE' : 'DRAFT_CHECKPOINT', row_version: 2, duration: { num: 48, den: 1 }, content_hash: 'c'.repeat(64), tracks: [], markers: [] },
          media_profile_revision: { id: 'profile-rev-1', profile_id: 'profile-1', project_id: 'project-1', lifecycle_state: 'APPROVED', row_version: 2, timeline_rate: { num: 24, den: 1 }, time_base: { num: 1, den: 24 }, pixel_aspect: { num: 1, den: 1 } },
        } };
        if (type === 'CreateMediaProfileRevision' || type === 'TransitionMediaProfileRevision') return { ok: true, result: { profile: { id: 'profile-1', project_id: 'project-1', revisions: [{ id: 'profile-rev-2', project_id: 'project-1', lifecycle_state: 'CANDIDATE', timeline_rate: { num: 24, den: 1 }, time_base: { num: 1, den: 24 }, pixel_aspect: { num: 1, den: 1 } }] } } };
      }
      return { ok: false, error: { code: 'NOT_FOUND', category: 'VALIDATION' } };
    },
  };
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
    const profile = await jsonRequest('/v1/projects/project-1/media-profile');
    assert.equal(profile.response.status, 200);
    assert.equal(profile.payload.result.profile.id, 'profile-1');
    assert.equal(profile.payload.result.revisions[0].timelineRate.num, 24000);
    assert.equal(Object.hasOwn(profile.payload.result.revisions[0], 'providerId'), false);
    assert.equal(Object.hasOwn(profile.payload.result.profile, 'provider_path'), false);

    const createdProfile = await jsonRequest('/v1/projects/project-1/media-profile', {
      method: 'POST', headers: { 'idempotency-key': 'profile-create' },
      body: JSON.stringify({ timeline_rate: { num: 24, den: 1 }, time_base: { num: 1, den: 24 }, pixel_aspect: { num: 1, den: 1 }, width: 1920, height: 1080, working_color_space: 'REC709', transfer_function: 'SDR', hdr_policy: 'DISABLED', audio_sample_rate: 48000, audio_channel_layout: 'STEREO' }),
    });
    assert.equal(createdProfile.response.status, 200);
    assert.equal(createdProfile.payload.result.revisions[0].id, 'profile-rev-2');

    const transitionedProfile = await jsonRequest('/v1/projects/project-1/media-profile/revisions/profile-rev-1/transition', {
      method: 'POST', headers: { 'idempotency-key': 'profile-transition' }, body: JSON.stringify({ next_state: 'APPROVED', expected_version: 2 }),
    });
    assert.equal(transitionedProfile.response.status, 200);

    const timelines = await jsonRequest('/v1/projects/project-1/timelines');
    assert.equal(timelines.response.status, 200);
    assert.equal(timelines.payload.result.timelines[0].id, 'timeline-1');
    assert.equal(Object.hasOwn(timelines.payload.result.timelines[0], 'provider_path'), false);

    const workspace = await jsonRequest('/v1/projects/project-1/timelines/timeline-1/workspace');
    assert.equal(workspace.response.status, 200);
    assert.equal(workspace.payload.result.currentRevision.id, 'timeline-rev-1');
    assert.equal(workspace.payload.result.currentRevision.tracks[0].clips[0].assetRevisionId, 'asset-rev-1');
    assert.equal(Object.hasOwn(workspace.payload.result.currentRevision.tracks[0].clips[0], 'provider_path'), false);
    assert.equal(Object.hasOwn(workspace.payload.result.currentRevision.markers[0], 'payload'), false);

    const timeline = await jsonRequest('/v1/projects/project-1/timelines', {
      method: 'POST', headers: { 'idempotency-key': 'timeline-create' }, body: JSON.stringify({ title: 'New timeline', scope_type: 'PROJECT', media_profile_revision_id: 'profile-rev-1' }),
    });
    assert.equal(timeline.response.status, 200);
    assert.equal(timeline.payload.result.id, 'timeline-2');

    const revision = await jsonRequest('/v1/projects/project-1/timelines/timeline-1/revisions', {
      method: 'POST', headers: { 'idempotency-key': 'timeline-revision' }, body: JSON.stringify({ media_profile_revision_id: 'profile-rev-1', snapshot: { duration: { num: 48, den: 1 }, tracks: [], clips: [], markers: [] }, expected_version: 3 }),
    });
    assert.equal(revision.response.status, 200);
    assert.equal(revision.payload.result.currentRevision.id, 'timeline-rev-1');
    assert.equal(revision.payload.result.currentRevision.editHash, 'c'.repeat(64));
    assert.equal(revision.payload.result.mediaProfile.approvedRevision.id, 'profile-rev-1');

    const transitioned = await jsonRequest('/v1/projects/project-1/timelines/timeline-1/revisions/timeline-rev-1/transition', {
      method: 'POST', headers: { 'idempotency-key': 'timeline-transition' }, body: JSON.stringify({ next_state: 'CANDIDATE', expected_version: 1 }),
    });
    assert.equal(transitioned.response.status, 200);

    const queries = calls.filter((call) => call.method.startsWith('query.'));
    assert.equal(queries.find((call) => call.method === 'query.media_profile.workspace').params.project_id, 'project-1');
    assert.equal(queries.find((call) => call.method === 'query.timeline.list').params.project_id, 'project-1');
    assert.equal(queries.find((call) => call.method === 'query.timeline.workspace').params.timeline_id, 'timeline-1');
    const commands = calls.filter((call) => call.method === 'command.execute');
    assert.deepEqual(commands.map((call) => call.params.command_type), ['CreateMediaProfileRevision', 'TransitionMediaProfileRevision', 'CreateTimeline', 'CreateTimelineRevision', 'TransitionTimelineRevision']);
    assert.equal(commands[0].params.payload.project_id, 'project-1');
    assert.equal(commands[0].params.idempotency_key, 'profile-create');
    assert.equal(commands[1].params.payload.revision_id, 'profile-rev-1');
    assert.equal(commands[2].params.payload.project_id, 'project-1');
    assert.equal(commands[2].params.payload.media_profile_revision_id, 'profile-rev-1');
    assert.equal(commands[3].params.payload.timeline_id, 'timeline-1');
    assert.deepEqual(commands[3].params.payload.duration, { num: 48, den: 1 });
    assert.deepEqual(commands[3].params.payload.tracks, []);
    assert.equal(commands[3].params.payload.snapshot, undefined);
    assert.equal(commands[4].params.payload.revision_id, 'timeline-rev-1');
  } finally {
    await new Promise((resolve) => listener.server.close(resolve));
  }
});

test('HTTP review routes expose exact timeline evidence and typed approval commands', async () => {
  const calls = [];
  const subject = {
    id: 'timeline-rev-1', timeline_id: 'timeline-1', lifecycle_state: 'CANDIDATE', row_version: 2,
    duration: { num: 24, den: 1 }, content_hash: 'a'.repeat(64), tracks: [], markers: [],
  };
  const session = {
    id: 'review-1', project_id: 'project-1', subject_type: 'TIMELINE_REVISION', subject_id: 'timeline-rev-1',
    subject_revision_id: 'timeline-rev-1', dependency_snapshot_hash: 'b'.repeat(64), subject_content_hash: 'a'.repeat(64),
    media_profile_revision_id: 'profile-rev-1', state: 'OPEN', stale: false, row_version: 1,
    next_step: 'Chọn quyết định', provider_path: 'C:/private',
  };
  const workspace = (submitted = false) => ({
    review: {
      ...session,
      state: submitted ? 'SUBMITTED' : 'OPEN',
      review_state: submitted ? 'SUBMITTED' : 'OPEN',
      row_version: submitted ? 2 : 1,
      human_review: submitted ? {
        id: 'human-review-1', review_session_id: 'review-1', decision: 'APPROVE', notes: 'OK',
        reason_codes: [], dependency_snapshot_hash: 'b'.repeat(64), subject_content_hash: 'a'.repeat(64),
      } : null,
    },
    subject: { ...subject, provider_path: 'C:/private' },
    timeline: { id: 'timeline-1', project_id: 'project-1', title: 'Main', row_version: 3 },
    media_profile_revision: { id: 'profile-rev-1', project_id: 'project-1', lifecycle_state: 'APPROVED', provider_id: 'secret' },
    snapshot: { hash: 'b'.repeat(64), current_hash: 'b'.repeat(64), stale: false },
    projection_seq: 12,
  });
  const core = {
    handle(request) {
      calls.push(request);
      if (request.method === 'query.review.list') return { ok: true, result: { items: [session], projection_seq: 11 } };
      if (request.method === 'query.review.get') return { ok: true, result: workspace(false) };
      if (request.method === 'command.execute' && request.params.command_type === 'OpenReview') return { ok: true, result: workspace(false) };
      if (request.method === 'command.execute' && request.params.command_type === 'SubmitReview') return { ok: true, result: workspace(true) };
      return { ok: false, error: { code: 'NOT_FOUND', category: 'VALIDATION' } };
    },
  };
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
    const listed = await jsonRequest('/v1/projects/project-1/reviews?state=OPEN');
    assert.equal(listed.response.status, 200);
    assert.equal(listed.payload.result.reviews[0].id, 'review-1');
    assert.equal(listed.payload.result.reviews[0].state, 'OPEN');
    assert.equal(Object.hasOwn(listed.payload.result.reviews[0], 'provider_path'), false);

    const details = await jsonRequest('/v1/projects/project-1/reviews/review-1');
    assert.equal(details.response.status, 200);
    assert.equal(details.payload.result.review.id, 'review-1');
    assert.equal(details.payload.result.subject.id, 'timeline-rev-1');
    assert.equal(Object.hasOwn(details.payload.result.subject, 'provider_path'), false);
    assert.equal(Object.hasOwn(details.payload.result.mediaProfileRevision, 'providerId'), false);

    const opened = await jsonRequest('/v1/projects/project-1/reviews', {
      method: 'POST', headers: { 'idempotency-key': 'review-open' },
      body: JSON.stringify({ subject_type: 'TIMELINE_REVISION', subject_revision_id: 'timeline-rev-1', expected_version: 2 }),
    });
    assert.equal(opened.response.status, 200);
    assert.equal(opened.payload.result.review.state, 'OPEN');

    const submitted = await jsonRequest('/v1/projects/project-1/reviews/review-1/submit', {
      method: 'POST', headers: { 'idempotency-key': 'review-submit' },
      body: JSON.stringify({ decision: 'APPROVE', notes: 'OK', expected_version: 1 }),
    });
    assert.equal(submitted.response.status, 200);
    assert.equal(submitted.payload.result.review.state, 'SUBMITTED');
    assert.equal(submitted.payload.result.review.humanReview.decision, 'APPROVE');

    const queries = calls.filter((call) => call.method.startsWith('query.'));
    assert.equal(queries[0].method, 'query.review.list');
    assert.equal(queries[0].params.project_id, 'project-1');
    assert.equal(queries[1].params.review_session_id, 'review-1');
    const commands = calls.filter((call) => call.method === 'command.execute');
    assert.deepEqual(commands.map((call) => call.params.command_type), ['OpenReview', 'SubmitReview']);
    assert.equal(commands[0].params.payload.project_id, 'project-1');
    assert.equal(commands[0].params.expected_versions.REVISION, 2);
    assert.equal(commands[1].params.payload.review_session_id, 'review-1');
    assert.equal(commands[1].params.expected_versions.REVIEW_SESSION, 1);
  } finally {
    await new Promise((resolve) => listener.server.close(resolve));
  }
});

test('HTTP handoff routes preserve exact hashes and conservative compatibility', async () => {
  const calls = [];
  const handoff = {
    id: 'handoff-1', export_session_id: 'export-1', project_id: 'project-1', target_editor: 'UNKNOWN_EDITOR', target_version: '9',
    compatibility_profile_version: 'HANDOFF_COMPATIBILITY_V1', manifest_hash: 'c'.repeat(64),
    manifest: {
      manifest_type: 'CINEFORGE_TIMELINE_HANDOFF', manifest_schema_version: 1,
      source: { project_id: 'project-1', timeline_revision_id: 'revision-1', content_hash: 'a'.repeat(64), provider_path: 'C:/secret' },
      target: { editor: 'UNKNOWN_EDITOR', version: '9' },
    },
    artifact_allowlist: [{ asset_revision_id: 'asset-revision-1', content_hash: 'd'.repeat(64), storage_uri: 'object://private' }],
    compatibility_report: { editable_claim: false, entries: [{ feature: 'editable_project_claim', status: 'UNKNOWN', detail: 'Unknown target' }] },
    sanitization_report: { policy: 'EXPLICIT_ALLOWLIST_V1', recorded: true, removed_fields: ['absolute_local_paths'] },
  };
  const session = {
    id: 'export-1', project_id: 'project-1', timeline_revision_id: 'revision-1', deliverable_type: 'TIMELINE_INTERCHANGE',
    target_profile: 'GENERIC_INTERCHANGE', target_editor: 'UNKNOWN_EDITOR', target_version: '9', state: 'PREFLIGHT',
    output_manifest_id: 'handoff-1', review_session_id: 'review-1', dependency_snapshot_hash: 'b'.repeat(64),
    subject_content_hash: 'a'.repeat(64), media_profile_revision_id: 'profile-1', row_version: 2,
    next_step: 'Use a certified adapter', provider_path: 'C:/secret',
  };
  const core = {
    handle(request) {
      calls.push(request);
      if (request.method === 'query.handoff.list') return { ok: true, result: { items: [{ export_session: session, handoff_manifest: handoff }], projection_seq: 4 } };
      if (request.method === 'query.handoff.get') return { ok: true, result: { export_session: session, handoff_manifest: handoff, projection_seq: 4 } };
      if (request.method === 'command.execute' && request.params.command_type === 'CreateHandoffManifest') return { ok: true, result: { export_session: session, handoff_manifest: handoff, manifest_hash: handoff.manifest_hash } };
      return { ok: false, error: { code: 'NOT_FOUND', category: 'VALIDATION' } };
    },
  };
  const listener = await listenCoreHttp(core, { host: '127.0.0.1', port: 0 });
  const base = `http://127.0.0.1:${listener.address.port}`;
  const jsonRequest = async (pathName, options = {}) => {
    const response = await fetch(`${base}${pathName}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers ?? {}) } });
    return { response, payload: await response.json() };
  };
  try {
    const listed = await jsonRequest('/v1/projects/project-1/handoffs?state=PREFLIGHT');
    assert.equal(listed.response.status, 200);
    assert.equal(listed.payload.result.items[0].exportSession.state, 'PREFLIGHT');
    assert.equal(listed.payload.result.items[0].handoffManifest.manifestHash, 'c'.repeat(64));
    assert.equal(listed.payload.result.items[0].handoffManifest.compatibility.editableClaim, false);
    assert.equal(Object.hasOwn(listed.payload.result.items[0].exportSession, 'providerPath'), false);
    assert.equal(Object.hasOwn(listed.payload.result.items[0].handoffManifest.manifest.source, 'provider_path'), false);
    assert.equal(Object.hasOwn(listed.payload.result.items[0].handoffManifest.artifactAllowlist[0], 'storage_uri'), false);

    const details = await jsonRequest('/v1/projects/project-1/handoffs/export-1');
    assert.equal(details.response.status, 200);
    assert.equal(details.payload.result.exportSession.dependencySnapshotHash, 'b'.repeat(64));

    const created = await jsonRequest('/v1/projects/project-1/handoffs', {
      method: 'POST', headers: { 'idempotency-key': 'handoff-create' },
      body: JSON.stringify({ timeline_revision_id: 'revision-1', review_session_id: 'review-1', dependency_snapshot_hash: 'b'.repeat(64), target_editor: 'UNKNOWN_EDITOR', target_version: '9', expected_version: 3 }),
    });
    assert.equal(created.response.status, 200);
    assert.equal(created.payload.result.handoffManifest.manifestHash, 'c'.repeat(64));
    const command = calls.find((call) => call.method === 'command.execute');
    assert.equal(command.params.command_type, 'CreateHandoffManifest');
    assert.equal(command.params.payload.project_id, 'project-1');
    assert.equal(command.params.expected_versions.REVISION, 3);
  } finally {
    await new Promise((resolve) => listener.server.close(resolve));
  }
});

test('HTTP external-edit routes preserve lineage, rights state and optimistic export version', async () => {
  const calls = [];
  const externalEdit = {
    id: 'external-edit-1', project_id: 'project-1', handoff_manifest_id: 'handoff-1', export_session_id: 'export-1',
    timeline_revision_id: 'revision-1', returned_asset_revision_id: 'returned-revision-1',
    returned_interchange_asset_revision_id: 'returned-revision-1', lineage_confidence: 'PARTIAL', validation_state: 'REGISTERED',
    source_document_hash: 'a'.repeat(64), source_document_byte_size: 2048, source_manifest_hash: 'b'.repeat(64),
    source_revision_content_hash: 'c'.repeat(64), source_dependency_snapshot_hash: 'd'.repeat(64), source_review_session_id: 'review-1',
    returned_rights_status: 'ALLOWED', validation_snapshot: { returned_document_hash: 'a'.repeat(64), local_path: 'C:/secret' },
    contract_diff_count: 1, contract_diffs: [{ id: 'diff-1', diff_type: 'DURATION', severity: 'WARNING', before: { num: 24, den: 1 }, after: { num: 25, den: 1 }, resolution_state: 'UNRESOLVED' }],
    next_step: 'Review contract differences', row_version: 1, command_id: 'command-1', created_at: '2026-09-30T00:00:00.000Z',
  };
  const core = {
    handle(request) {
      calls.push(request);
      if (request.method === 'query.external_edit.list') return { ok: true, result: { items: [externalEdit], projection_seq: 7 } };
      if (request.method === 'query.external_edit.get') return { ok: true, result: { external_edit: externalEdit, projection_seq: 7 } };
      if (request.method === 'command.execute' && request.params.command_type === 'RegisterExternalEdit') return { ok: true, result: { external_edit: externalEdit } };
      return { ok: false, error: { code: 'NOT_FOUND', category: 'VALIDATION' } };
    },
  };
  const listener = await listenCoreHttp(core, { host: '127.0.0.1', port: 0 });
  const base = `http://127.0.0.1:${listener.address.port}`;
  const jsonRequest = async (pathName, options = {}) => {
    const response = await fetch(`${base}${pathName}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers ?? {}) } });
    return { response, payload: await response.json() };
  };
  try {
    const listed = await jsonRequest('/v1/projects/project-1/external-edits?validation_state=REGISTERED');
    assert.equal(listed.response.status, 200);
    assert.equal(listed.payload.result.items[0].lineageConfidence, 'PARTIAL');
    assert.equal(listed.payload.result.items[0].contractDiffs[0].diffType, 'DURATION');
    assert.equal(listed.payload.result.items[0].contractDiffCount, 1);
    const detail = await jsonRequest('/v1/projects/project-1/external-edits/external-edit-1');
    assert.equal(detail.response.status, 200);
    assert.equal(detail.payload.result.externalEdit.returnedRightsStatus, 'ALLOWED');
    const created = await jsonRequest('/v1/projects/project-1/external-edits', {
      method: 'POST', headers: { 'idempotency-key': 'external-edit-register' },
      body: JSON.stringify({ handoff_manifest_id: 'handoff-1', export_session_id: 'export-1', returned_asset_revision_id: 'returned-revision-1', expected_version: 4, lineage_confidence: 'PARTIAL' }),
    });
    assert.equal(created.response.status, 200);
    assert.equal(created.payload.result.externalEdit.id, 'external-edit-1');
    const command = calls.find((call) => call.method === 'command.execute');
    assert.equal(command.params.command_type, 'RegisterExternalEdit');
    assert.equal(command.params.payload.project_id, 'project-1');
    assert.equal(command.params.expected_versions.EXPORT_SESSION, 4);
  } finally {
    await new Promise((resolve) => listener.server.close(resolve));
  }
});

test('HTTP Core epoch fencing rejects stale proxy traffic before mutation', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cineforge-http-epoch-'));
  const core = new CoreService({ dbPath: path.join(directory, 'cineforge.sqlite') });
  const listener = await listenCoreHttp(core, { host: '127.0.0.1', port: 0 });
  const base = `http://127.0.0.1:${listener.address.port}`;
  try {
    const healthResponse = await fetch(`${base}/v1/health`);
    const health = await healthResponse.json();
    assert.equal(health.ok, true);
    const epoch = health.result.instance_epoch;
    const stale = await fetch(`${base}/v1/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'stale-epoch-http', 'x-cineforge-core-epoch': 'old-epoch' },
      body: JSON.stringify({ name: 'Không được tạo' }),
    });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).error.code, 'CORE_EPOCH_STALE');

    const current = await fetch(`${base}/v1/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'current-epoch-http', 'x-cineforge-core-epoch': epoch },
      body: JSON.stringify({ name: 'Được tạo' }),
    });
    assert.equal(current.status, 200);
    assert.equal((await current.json()).name, 'Được tạo');
  } finally {
    await new Promise((resolve) => listener.server.close(resolve));
    core.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
