import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CoreService } from './core.mjs';
import { listenCoreHttp } from './http.mjs';

const pause = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));

test('HTTP local asset integrity job routes preserve pins, redaction, and lifecycle', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cineforge-http-jobs-'));
  const core = new CoreService({ dbPath: path.join(directory, 'cineforge.sqlite'), assetStorePath: path.join(directory, 'asset-store') });
  const listener = await listenCoreHttp(core, { host: '127.0.0.1', port: 0 });
  const base = `http://127.0.0.1:${listener.address.port}`;
  try {
    const projectResponse = await fetch(`${base}/v1/projects`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'http-job-project' },
      body: JSON.stringify({ name: 'HTTP job project' }),
    });
    assert.equal(projectResponse.status, 200);
    const project = await projectResponse.json();
    const sourcePath = path.join(directory, 'http-job.txt');
    const content = 'HTTP integrity job bytes\n';
    fs.writeFileSync(sourcePath, content, 'utf8');
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const assetResponse = await fetch(`${base}/v1/projects/${project.id}/assets`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'http-job-asset' },
      body: JSON.stringify({ source_path: sourcePath, asset_type: 'DOCUMENT', content_hash: hash }),
    });
    assert.equal(assetResponse.status, 200);
    const asset = await assetResponse.json();
    assert.match(asset.revisionId, /^[0-9a-f-]{20,}$/i);

    const probeResponse = await fetch(`${base}/v1/projects/${project.id}/assets/${asset.revisionId}/integrity-probe`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'http-job-probe' },
      body: JSON.stringify({ content_hash: hash, max_bytes: Buffer.byteLength(content) }),
    });
    assert.equal(probeResponse.status, 200);
    const queuedEnvelope = await probeResponse.json();
    assert.equal(queuedEnvelope.ok, true);
    assert.equal(queuedEnvelope.result.job.state, 'QUEUED');
    assert.equal(queuedEnvelope.result.job.subject_content_hash, hash);
    assert.equal(Object.hasOwn(queuedEnvelope.result.job, 'relative_path'), false);
    assert.equal(Object.hasOwn(queuedEnvelope.result.job, 'fencing_token'), false);

    const missingKey = await fetch(`${base}/v1/projects/${project.id}/assets/${asset.revisionId}/integrity-probe`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content_hash: hash }),
    });
    assert.equal(missingKey.status, 400);
    assert.equal((await missingKey.json()).error.code, 'IDEMPOTENCY_KEY_REQUIRED');

    await pause();
    const listResponse = await fetch(`${base}/v1/jobs?project_id=${encodeURIComponent(project.id)}`);
    assert.equal(listResponse.status, 200);
    const listed = await listResponse.json();
    assert.equal(listed.ok, true);
    assert.equal(listed.result.jobs.length, 1);
    assert.equal(listed.result.jobs[0].state, 'COMPLETED');
    assert.equal(listed.result.jobs[0].evidence.state, 'PASS');
    assert.equal(listed.result.jobs[0].latest_attempt.state, 'SUCCEEDED');

    const detailResponse = await fetch(`${base}/v1/jobs/${queuedEnvelope.result.job.id}?project_id=${encodeURIComponent(project.id)}`);
    assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json();
    assert.equal(detail.result.job.id, queuedEnvelope.result.job.id);
    const retryPlan = await (await fetch(`${base}/v1/jobs/${queuedEnvelope.result.job.id}/retry-plan`)).json();
    assert.equal(retryPlan.ok, true);
    assert.equal(retryPlan.result.allowed, false);
  } finally {
    await new Promise((resolve) => listener.server.close(resolve));
    core.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
