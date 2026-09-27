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
