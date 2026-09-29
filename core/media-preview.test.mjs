import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CoreService } from './core.mjs';

function tempDb() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cineforge-preview-'));
  return { directory, dbPath: path.join(directory, 'cineforge.sqlite'), assetStorePath: path.join(directory, 'asset-store') };
}

function request(method, params = {}, requestId = method) {
  return { request_id: requestId, api_version: '1', method, params };
}

function execute(core, commandType, payload, idempotencyKey) {
  return core.handle(request('command.execute', {
    command_type: commandType, payload, expected_versions: {}, idempotency_key: idempotencyKey,
  }, idempotencyKey));
}

function fixture(directory, name, bytes) {
  const value = path.join(directory, name);
  fs.writeFileSync(value, Buffer.from(bytes));
  return value;
}

function importManaged(core, sourcePath, projectId, mimeType, key) {
  const staged = core._reserveImportStaging({ source_path: sourcePath }, `${key}-stage`);
  const imported = execute(core, 'ImportAsset', {
    __staging_id: staged.id, source_path: sourcePath, project_id: projectId,
    storage_mode: 'COPY', asset_type: 'MEDIA', mime_type: mimeType,
  }, key);
  assert.equal(imported.ok, true, imported.error?.code);
  return imported.result.asset;
}

function allowPreview(core, asset, key) {
  const identityId = asset.rights.identity.id;
  assert.equal(execute(core, 'CreateRightsRecord', {
    rights_identity_id: identityId, right_type: 'SOURCE_USE', status: 'ALLOWED',
  }, `${key}-right`).ok, true);
  assert.equal(execute(core, 'RecordConsent', {
    rights_identity_id: identityId, consent_type: 'SOURCE_USE', granted_by: 'preview-test',
  }, `${key}-consent`).ok, true);
}

test('secure media preview resolves only managed bytes, binds exact scope, and enforces bounded ranges', () => {
  const { directory, dbPath, assetStorePath } = tempDb();
  const core = new CoreService({ dbPath, assetStorePath });
  const project = execute(core, 'CreateProject', { title: 'Preview', code: 'preview' }, 'project');
  const projectId = project.result.id;
  const source = fixture(directory, 'frame.png', [137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4, 5, 6]);
  const asset = importManaged(core, source, projectId, 'image/png', 'asset');
  const sessionId = 'session-a';

  const blocked = core.handle(request('query.media.resolve_preview', {
    project_id: projectId, asset_revision_id: asset.latest_revision.id, session_id: sessionId,
  }, 'blocked'));
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, 'PREVIEW_RIGHTS_BLOCKED');

  allowPreview(core, asset, 'allowed');
  const resolved = core.handle(request('query.media.resolve_preview', {
    project_id: projectId, asset_revision_id: asset.latest_revision.id, session_id: sessionId,
  }, 'resolve'));
  assert.equal(resolved.ok, true, resolved.error?.code);
  assert.match(resolved.result.token, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal(JSON.stringify(resolved.result).includes(assetStorePath), false);
  assert.equal(JSON.stringify(resolved.result).includes('file:'), false);

  const range = core.openMediaPreview({
    project_id: projectId, asset_revision_id: asset.latest_revision.id,
    token: resolved.result.token, session_id: sessionId, range: 'bytes=2-5',
  });
  assert.equal(range.status, 206);
  assert.equal(range.contentRange, 'bytes 2-5/14');
  assert.equal(range.length, 4);
  assert.deepEqual(fs.readFileSync(range.filePath).subarray(range.start, range.end + 1), Buffer.from([78, 71, 13, 10]));

  assert.throws(() => core.openMediaPreview({
    project_id: projectId, asset_revision_id: asset.latest_revision.id,
    token: resolved.result.token, session_id: 'other-session',
  }), (error) => error.code === 'PREVIEW_TOKEN_SCOPE');
  assert.throws(() => core.openMediaPreview({
    project_id: projectId, asset_revision_id: asset.latest_revision.id,
    token: resolved.result.token, session_id: sessionId, purpose: 'TIMELINE_PREVIEW',
  }), (error) => error.code === 'PREVIEW_TOKEN_SCOPE');
  assert.throws(() => core.openMediaPreview({
    project_id: projectId, asset_revision_id: asset.latest_revision.id,
    token: resolved.result.token, session_id: sessionId, range: 'bytes=1-2,3-4',
  }), (error) => error.code === 'PREVIEW_RANGE_INVALID');
  assert.throws(() => core.openMediaPreview({
    project_id: projectId, asset_revision_id: asset.latest_revision.id,
    token: resolved.result.token, session_id: sessionId, range: 'bytes=999-1000',
  }), (error) => error.code === 'PREVIEW_RANGE_NOT_SATISFIABLE');

  core.previewTokens.get(resolved.result.token).expiresAtMs = Date.now() - 1;
  assert.throws(() => core.openMediaPreview({
    project_id: projectId, asset_revision_id: asset.latest_revision.id, token: resolved.result.token,
  }), (error) => error.code === 'PREVIEW_TOKEN_INVALID');
  core.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('preview rechecks rights, content identity, MIME and process epoch on every read', () => {
  const { directory, dbPath, assetStorePath } = tempDb();
  const core = new CoreService({ dbPath, assetStorePath });
  const project = execute(core, 'CreateProject', { title: 'Preview checks', code: 'preview-checks' }, 'project');
  const source = fixture(directory, 'sound.mp3', [1, 2, 3, 4]);
  const asset = importManaged(core, source, project.result.id, 'audio/mpeg', 'asset');
  allowPreview(core, asset, 'allowed');
  const resolved = core.resolveMediaPreview({ project_id: project.result.id, asset_revision_id: asset.latest_revision.id, session_id: 's' });
  fs.appendFileSync(core._previewDescriptor(project.result.id, asset.latest_revision.id).filePath, Buffer.from([9]));
  assert.throws(() => core.openMediaPreview({ project_id: project.result.id, asset_revision_id: asset.latest_revision.id, token: resolved.token, session_id: 's' }), (error) => error.code === 'PREVIEW_NOT_READY' || error.code === 'PREVIEW_CONTENT_CHANGED');
  core.close();

  const reopened = new CoreService({ dbPath, assetStorePath });
  assert.throws(() => reopened.openMediaPreview({ project_id: project.result.id, asset_revision_id: asset.latest_revision.id, token: resolved.token, session_id: 's' }), (error) => error.code === 'PREVIEW_TOKEN_INVALID');
  reopened.close();

  const unsafe = new CoreService({ dbPath: path.join(directory, 'unsafe.sqlite'), assetStorePath: path.join(directory, 'unsafe-store') });
  const unsafeProject = execute(unsafe, 'CreateProject', { title: 'Unsafe', code: 'unsafe' }, 'unsafe-project');
  const html = fixture(directory, 'unsafe.html', [60, 115, 99, 114, 105, 112, 116, 62]);
  const unsafeAsset = importManaged(unsafe, html, unsafeProject.result.id, 'text/html', 'unsafe-asset');
  allowPreview(unsafe, unsafeAsset, 'unsafe-allowed');
  const failed = unsafe.handle(request('query.media.resolve_preview', { project_id: unsafeProject.result.id, asset_revision_id: unsafeAsset.latest_revision.id, session_id: 's' }, 'unsafe-resolve'));
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, 'PREVIEW_MIME_UNSUPPORTED');
  unsafe.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
