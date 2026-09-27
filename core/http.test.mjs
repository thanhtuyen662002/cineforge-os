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
    assert.match(asset.storageUri, /^object:\/\/sha-256\//);
    assert.ok(asset.importSessionId);

    const assets = await fetch(`${base}/v1/projects/${encodeURIComponent(project.id)}/assets`);
    assert.equal(assets.status, 200);
    const assetList = await assets.json();
    assert.equal(assetList.assets.length, 1);
    assert.equal(assetList.assets[0].contentHash, asset.contentHash);
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
    assert.equal(acknowledged.status, 200);
    assert.deepEqual(await acknowledged.json(), { ok: true, decision_id: 'decision-1', status: 'ACKNOWLEDGED' });

    const health = await fetch(`${base}/v1/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).result.status, 'READY');
  } finally {
    await new Promise((resolve) => listener.server.close(resolve));
    core.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
