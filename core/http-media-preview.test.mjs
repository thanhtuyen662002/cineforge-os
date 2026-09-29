import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CoreService } from './core.mjs';
import { listenCoreHttp } from './http.mjs';

function execute(core, type, payload, key) {
  return core.handle({ request_id: key, api_version: '1', method: 'command.execute', params: {
    command_type: type, payload, expected_versions: {}, idempotency_key: key,
  }});
}

test('HTTP media preview returns opaque capability JSON and streams HEAD/206 without buffering', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cineforge-http-preview-'));
  const dbPath = path.join(directory, 'cineforge.sqlite');
  const store = path.join(directory, 'asset-store');
  const sourcePath = path.join(directory, 'still.webp');
  fs.writeFileSync(sourcePath, Buffer.from([82, 73, 70, 70, 10, 0, 0, 0, 87, 69, 66, 80, 1, 2, 3, 4]));
  const core = new CoreService({ dbPath, assetStorePath: store });
  const project = execute(core, 'CreateProject', { title: 'HTTP preview', code: 'http-preview' }, 'project');
  const staged = core._reserveImportStaging({ source_path: sourcePath }, 'stage');
  const imported = execute(core, 'ImportAsset', {
    __staging_id: staged.id, source_path: sourcePath, project_id: project.result.id,
    storage_mode: 'COPY', asset_type: 'MEDIA', mime_type: 'image/webp',
  }, 'import');
  assert.equal(imported.ok, true, imported.error?.code);
  const asset = imported.result.asset;
  const rightsIdentityId = asset.rights.identity.id;
  assert.equal(execute(core, 'CreateRightsRecord', { rights_identity_id: rightsIdentityId, right_type: 'SOURCE_USE', status: 'ALLOWED' }, 'rights').ok, true);
  assert.equal(execute(core, 'RecordConsent', { rights_identity_id: rightsIdentityId, consent_type: 'SOURCE_USE', granted_by: 'test' }, 'consent').ok, true);
  const listener = await listenCoreHttp(core, { host: '127.0.0.1', port: 0, token: 'core-capability' });
  const base = `http://127.0.0.1:${listener.address.port}`;
  const endpoint = `/v1/projects/${project.result.id}/assets/${asset.latest_revision.id}/preview`;
  const sessionHeaders = { Authorization: 'Bearer core-capability', 'X-CineForge-Session': 'browser-session' };
  try {
    let response = await fetch(`${base}${endpoint}?purpose=LIBRARY_PREVIEW`, { headers: sessionHeaders });
    assert.equal(response.status, 200);
    const envelope = await response.json();
    assert.equal(envelope.ok, true);
    assert.match(envelope.result.preview_url, /token=/);
    assert.equal(JSON.stringify(envelope).includes(store), false);
    assert.equal(JSON.stringify(envelope).includes('file:'), false);

    const previewUrl = `${base}${envelope.result.preview_url}`;
    response = await fetch(previewUrl, { headers: { Authorization: 'Bearer core-capability', Range: 'bytes=1-4' } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 1-4/16');
    assert.equal(response.headers.get('accept-ranges'), 'bytes');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([73, 70, 70, 10]));

    response = await fetch(previewUrl, { method: 'HEAD', headers: { Authorization: 'Bearer core-capability' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-length'), '16');
    assert.equal(await response.text(), '');

    response = await fetch(previewUrl, { headers: { Authorization: 'Bearer core-capability', Range: 'bytes=999-1000' } });
    assert.equal(response.status, 416);
    const rangeError = await response.json();
    assert.equal(rangeError.error.code, 'PREVIEW_RANGE_NOT_SATISFIABLE');

    response = await fetch(`${base}${endpoint}?purpose=LIBRARY_PREVIEW`, { headers: { Authorization: 'Bearer wrong', 'X-CineForge-Session': 'browser-session' } });
    assert.equal(response.status, 401);
  } finally {
    await new Promise((resolve) => listener.server.close(resolve));
    core.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
