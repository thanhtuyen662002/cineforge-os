import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { CoreService } from './core.mjs';

function tempDb() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cineforge-jobs-'));
  return { directory, dbPath: path.join(directory, 'cineforge.sqlite'), assetStorePath: path.join(directory, 'asset-store') };
}

function request(method, params = {}, requestId = method) {
  return { request_id: requestId, api_version: '1', method, params };
}

function execute(core, commandType, payload, expectedVersions = {}, idempotencyKey = undefined) {
  return core.handle(request('command.execute', {
    command_type: commandType,
    payload,
    expected_versions: expectedVersions,
    ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
  }, `${commandType}-${idempotencyKey ?? crypto.randomUUID()}`));
}

function waitFor(ms = 80) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createManagedAsset(core, directory, assetStorePath, suffix = 'asset') {
  const project = execute(core, 'CreateProject', { title: `Job ${suffix}`, code: `job-${suffix}` }, {}, `job-project-${suffix}`);
  assert.equal(project.ok, true);
  const sourcePath = path.join(directory, `${suffix}.txt`);
  const content = `managed bytes ${suffix}\n`;
  fs.writeFileSync(sourcePath, content, 'utf8');
  const contentHash = crypto.createHash('sha256').update(content).digest('hex');
  const imported = execute(core, 'ImportAsset', {
    project_id: project.result.id,
    source_path: sourcePath,
    asset_type: 'DOCUMENT',
    content_hash: contentHash,
  }, {}, `job-import-${suffix}`);
  assert.equal(imported.ok, true);
  const asset = imported.result.asset;
  const revision = asset.latest_revision;
  const objectPath = path.join(assetStorePath, 'objects', 'sha-256', contentHash.slice(0, 2), contentHash);
  assert.equal(fs.existsSync(objectPath), true);
  return { projectId: project.result.id, revisionId: revision.id, contentHash, objectPath, objectSize: Buffer.byteLength(content) };
}

test('local managed integrity probe is durable, pinned, audited, and idempotent', async () => {
  const { directory, dbPath, assetStorePath } = tempDb();
  const core = new CoreService({ dbPath, assetStorePath });
  try {
    const asset = createManagedAsset(core, directory, assetStorePath, 'pass');
    const queued = execute(core, 'RunManagedAssetIntegrityProbe', {
      project_id: asset.projectId,
      asset_revision_id: asset.revisionId,
      content_hash: asset.contentHash,
      max_bytes: asset.objectSize,
    }, {}, 'probe-pass');
    assert.equal(queued.ok, true);
    assert.equal(queued.result.job.state, 'QUEUED');
    assert.equal(queued.result.job.semantic_capability, 'STORAGE_OBJECT_INTEGRITY_PROBE');
    assert.equal(queued.result.job.connector_version, 'LOCAL_ASSET_PROBE_V1');
    assert.match(queued.result.job.pinned_manifest_hash, /^[a-f0-9]{64}$/);
    assert.equal(Object.hasOwn(queued.result.job, 'storage_root'), false);
    assert.equal(Object.hasOwn(queued.result.job, 'fencing_token'), false);

    const replay = execute(core, 'RunManagedAssetIntegrityProbe', {
      project_id: asset.projectId,
      asset_revision_id: asset.revisionId,
      content_hash: asset.contentHash,
      max_bytes: asset.objectSize,
    }, {}, 'probe-pass');
    assert.equal(replay.ok, true);
    assert.equal(replay.result.idempotent_replay, true);
    assert.equal(replay.result.job.id, queued.result.job.id);

    await waitFor();
    const completed = core.handle(request('query.jobs.get', { job_id: queued.result.job.id }, 'probe-get'));
    assert.equal(completed.ok, true);
    assert.equal(completed.result.job.state, 'COMPLETED');
    assert.equal(completed.result.job.evidence.state, 'PASS');
    assert.equal(completed.result.job.latest_attempt.state, 'SUCCEEDED');
    assert.equal(completed.result.job.evidence.bytes_read, asset.objectSize);
    assert.equal(completed.result.job.usage.state, 'CONSUMED');
    assert.equal(core.db.prepare("SELECT COUNT(*) AS n FROM domain_events WHERE aggregate_type = 'JOB' AND aggregate_id = ?").get(queued.result.job.id).n, 2);
    assert.equal(core.db.prepare("SELECT COUNT(*) AS n FROM audit_records WHERE target_type = 'JOB' AND target_id = ?").get(queued.result.job.id).n, 2);

    const listed = core.handle(request('query.jobs.list', { project_id: asset.projectId }, 'probe-list'));
    assert.equal(listed.ok, true);
    assert.equal(listed.result.jobs.length, 1);
    assert.equal(listed.result.jobs[0].id, queued.result.job.id);
  } finally {
    core.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('local integrity probe preserves FAIL evidence and supports exact bounded retry', async () => {
  const { directory, dbPath, assetStorePath } = tempDb();
  const core = new CoreService({ dbPath, assetStorePath });
  try {
    const asset = createManagedAsset(core, directory, assetStorePath, 'tamper');
    const queued = execute(core, 'RunManagedAssetIntegrityProbe', {
      project_id: asset.projectId, asset_revision_id: asset.revisionId, content_hash: asset.contentHash,
    }, {}, 'probe-tamper');
    assert.equal(queued.ok, true);
    await waitFor();
    assert.equal(core.handle(request('query.jobs.get', { job_id: queued.result.job.id })).result.job.state, 'COMPLETED');

    // Make the managed object differ from its pinned identity. The probe must
    // record evidence and leave the object untouched; the CAS import's read
    // bit is relaxed only for this controlled tamper fixture.
    fs.chmodSync(asset.objectPath, 0o644);
    fs.writeFileSync(asset.objectPath, 'tampered managed bytes', 'utf8');
    const second = execute(core, 'RunManagedAssetIntegrityProbe', {
      project_id: asset.projectId, asset_revision_id: asset.revisionId, content_hash: asset.contentHash,
    }, {}, 'probe-tamper-second');
    assert.equal(second.ok, true);
    await waitFor();
    const failed = core.handle(request('query.jobs.get', { job_id: second.result.job.id }));
    assert.equal(failed.result.job.state, 'FAILED_FINAL');
    assert.equal(failed.result.job.evidence.state, 'FAIL');
    assert.equal(failed.result.job.evidence.code, 'PROBE_BYTE_SIZE_MISMATCH');
    assert.equal(core.db.prepare('SELECT state FROM storage_object_locations WHERE relative_path LIKE ?').get(`%${asset.contentHash}`).state, 'AVAILABLE');
    assert.equal(core.db.prepare('SELECT COUNT(*) AS n FROM job_attempts WHERE job_id = ?').get(second.result.job.id).n, 1);
    const retryPlan = core.handle(request('query.jobs.retry_plan', { job_id: second.result.job.id }));
    assert.equal(retryPlan.ok, true);
    assert.equal(retryPlan.result.allowed, false);
    assert.equal(retryPlan.result.reason_code, 'JOB_STATE_NOT_RETRYABLE');
  } finally {
    core.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('queued local probe cancellation releases its read reservation', () => {
  const { directory, dbPath, assetStorePath } = tempDb();
  const core = new CoreService({ dbPath, assetStorePath });
  try {
    const asset = createManagedAsset(core, directory, assetStorePath, 'cancel');
    core._localProbeRunning = true;
    const queued = execute(core, 'RunManagedAssetIntegrityProbe', {
      project_id: asset.projectId, asset_revision_id: asset.revisionId, content_hash: asset.contentHash,
    }, {}, 'probe-cancel');
    const cancelled = execute(core, 'CancelManagedAssetIntegrityProbe', { job_id: queued.result.job.id }, { JOB: 1 }, 'probe-cancel-command');
    assert.equal(cancelled.ok, true);
    assert.equal(cancelled.result.job.state, 'CANCELLED_CONFIRMED');
    const usage = core.db.prepare('SELECT state, actual_amount FROM job_usage_records WHERE job_attempt_id = (SELECT id FROM job_attempts WHERE job_id = ?)').get(queued.result.job.id);
    assert.equal(usage.state, 'RELEASED');
    assert.equal(usage.actual_amount, 0);
    core._localProbeRunning = false;
  } finally {
    core.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('running local probe aborts its bounded stream and records cancellation evidence', async () => {
  const { directory, dbPath, assetStorePath } = tempDb();
  const core = new CoreService({ dbPath, assetStorePath });
  const originalCreateReadStream = fs.createReadStream;
  try {
    const asset = createManagedAsset(core, directory, assetStorePath, 'cancel-stream');
    fs.createReadStream = (_path, options = {}) => {
      const size = Number(options.end ?? 0) - Number(options.start ?? 0) + 1;
      const first = Math.max(1, Math.floor(size / 2));
      let rejectDelay;
      let delayTimer;
      const stream = Readable.from((async function* () {
        yield Buffer.alloc(first, 0x61);
        await new Promise((resolve, reject) => {
          rejectDelay = reject;
          delayTimer = setTimeout(resolve, 10_000);
        });
        yield Buffer.alloc(size - first, 0x62);
      })());
      options.signal?.addEventListener('abort', () => {
        const error = Object.assign(new Error('aborted by test cancellation'), { name: 'AbortError', code: 'ABORT_ERR' });
        if (delayTimer) clearTimeout(delayTimer);
        rejectDelay?.(error);
        stream.destroy(error);
      }, { once: true });
      return stream;
    };
    const queued = execute(core, 'RunManagedAssetIntegrityProbe', {
      project_id: asset.projectId, asset_revision_id: asset.revisionId, content_hash: asset.contentHash,
    }, {}, 'probe-cancel-stream');
    assert.equal(queued.ok, true);
    let running;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      running = core.handle(request('query.jobs.get', { job_id: queued.result.job.id }, `probe-cancel-stream-get-${attempt}`));
      if (running.result?.job?.state === 'RUNNING') break;
      await waitFor(10);
    }
    assert.equal(running.result.job.state, 'RUNNING');
    const cancelled = execute(core, 'CancelManagedAssetIntegrityProbe', { job_id: queued.result.job.id }, { JOB: running.result.job.row_version }, 'probe-cancel-stream-command');
    assert.equal(cancelled.ok, true);
    assert.equal(cancelled.result.job.state, 'CANCELLATION_REQUESTED');
    let completed;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      completed = core.handle(request('query.jobs.get', { job_id: queued.result.job.id }, `probe-cancel-stream-final-${attempt}`));
      if (completed.result?.job?.state === 'COMPLETED_AFTER_CANCEL') break;
      await waitFor(10);
    }
    assert.equal(completed.result.job.state, 'COMPLETED_AFTER_CANCEL');
    assert.equal(completed.result.job.evidence.state, 'UNKNOWN');
    assert.equal(completed.result.job.evidence.code, 'PROBE_CANCELLED');
    assert.ok(completed.result.job.evidence.bytes_read < asset.objectSize);
    assert.equal(completed.result.job.usage.state, 'RELEASED');
    assert.equal(fs.readFileSync(asset.objectPath).toString('utf8'), `managed bytes cancel-stream\n`);
  } finally {
    fs.createReadStream = originalCreateReadStream;
    core.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('running local probe cancellation remains append-only when the request is repeated', () => {
  const { directory, dbPath, assetStorePath } = tempDb();
  const core = new CoreService({ dbPath, assetStorePath });
  try {
    const asset = createManagedAsset(core, directory, assetStorePath, 'cancel-repeat');
    core._localProbeRunning = true;
    const queued = execute(core, 'RunManagedAssetIntegrityProbe', {
      project_id: asset.projectId, asset_revision_id: asset.revisionId, content_hash: asset.contentHash,
    }, {}, 'probe-cancel-repeat');
    core.db.prepare("UPDATE jobs SET state = 'RUNNING' WHERE id = ?").run(queued.result.job.id);
    core.db.prepare("UPDATE job_attempts SET state = 'EXECUTING' WHERE job_id = ?").run(queued.result.job.id);
    const requested = execute(core, 'CancelManagedAssetIntegrityProbe', { job_id: queued.result.job.id }, { JOB: 1 }, 'probe-cancel-repeat-1');
    assert.equal(requested.ok, true);
    assert.equal(requested.result.job.state, 'CANCELLATION_REQUESTED');
    const repeated = execute(core, 'CancelManagedAssetIntegrityProbe', { job_id: queued.result.job.id }, { JOB: 2 }, 'probe-cancel-repeat-2');
    assert.equal(repeated.ok, true);
    assert.equal(repeated.result.cancellation, 'already_requested');
    assert.equal(repeated.result.job.state, 'CANCELLATION_REQUESTED');
    assert.equal(core.db.prepare("SELECT COUNT(*) AS n FROM domain_events WHERE aggregate_type = 'JOB' AND aggregate_id = ?").get(queued.result.job.id).n, 3);
  } finally {
    core._localProbeRunning = false;
    core.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('restart reconciliation creates a fresh fenced attempt and does not strand a job', async () => {
  const { directory, dbPath, assetStorePath } = tempDb();
  const first = new CoreService({ dbPath, assetStorePath });
  let jobId;
  try {
    const asset = createManagedAsset(first, directory, assetStorePath, 'restart');
    const queued = execute(first, 'RunManagedAssetIntegrityProbe', {
      project_id: asset.projectId, asset_revision_id: asset.revisionId, content_hash: asset.contentHash,
    }, {}, 'probe-restart');
    jobId = queued.result.job.id;
    first._localProbeRunning = true;
    first.db.prepare("UPDATE jobs SET state = 'RUNNING' WHERE id = ?").run(jobId);
    first.db.prepare("UPDATE job_attempts SET state = 'EXECUTING' WHERE job_id = ?").run(jobId);
  } finally {
    first.close();
  }
  const second = new CoreService({ dbPath, assetStorePath });
  try {
    const reconciled = second.db.prepare('SELECT state FROM jobs WHERE id = ?').get(jobId);
    assert.equal(reconciled.state, 'QUEUED');
    assert.equal(second.db.prepare('SELECT COUNT(*) AS n FROM job_attempts WHERE job_id = ?').get(jobId).n, 2);
    const usageStates = second.db.prepare(`SELECT state, actual_amount FROM job_usage_records
      WHERE job_attempt_id IN (SELECT id FROM job_attempts WHERE job_id = ?) ORDER BY created_at_utc_us ASC`).all(jobId);
    assert.deepEqual(usageStates.map((row) => row.state), ['RELEASED', 'RESERVED']);
    assert.equal(usageStates[0].actual_amount, 0);
    await waitFor();
    const completed = second.handle(request('query.jobs.get', { job_id: jobId }));
    assert.equal(completed.result.job.state, 'COMPLETED');
    assert.equal(completed.result.job.latest_attempt.attempt_no, 2);
  } finally {
    second.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('local integrity probe rejects ambiguous multiple-primary storage locations', async () => {
  const { directory, dbPath, assetStorePath } = tempDb();
  const core = new CoreService({ dbPath, assetStorePath });
  try {
    const asset = createManagedAsset(core, directory, assetStorePath, 'multiple-primary');
    const storageObject = core.db.prepare(`SELECT storage_object_id FROM asset_revisions WHERE id = ?`).get(asset.revisionId);
    core.db.prepare(`INSERT INTO storage_object_locations
      (id, storage_object_id, storage_root, relative_path, location_role, state, created_at_utc_us)
      VALUES (?, ?, 'asset-store', ?, 'PRIMARY', 'AVAILABLE', ?)`)
      .run(crypto.randomUUID(), storageObject.storage_object_id, `objects/sha-256/${asset.contentHash.slice(0, 2)}/${asset.contentHash}.duplicate`, Date.now() * 1000);
    const queued = execute(core, 'RunManagedAssetIntegrityProbe', {
      project_id: asset.projectId, asset_revision_id: asset.revisionId, content_hash: asset.contentHash,
    }, {}, 'probe-multiple-primary');
    assert.equal(queued.ok, true);
    await waitFor();
    const result = core.handle(request('query.jobs.get', { job_id: queued.result.job.id }));
    assert.equal(result.result.job.state, 'FAILED_FINAL');
    assert.equal(result.result.job.evidence.code, 'PROBE_LOCATION_UNAVAILABLE');
  } finally {
    core.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('local integrity probe fails closed before reading a file that exceeds its pinned IO budget', async () => {
  const { directory, dbPath, assetStorePath } = tempDb();
  const core = new CoreService({ dbPath, assetStorePath });
  try {
    const asset = createManagedAsset(core, directory, assetStorePath, 'budget-growth');
    // Hold the bounded runner long enough to model a file growing after the
    // command pins the registered size and max_bytes.
    core._localProbeRunning = true;
    const queued = execute(core, 'RunManagedAssetIntegrityProbe', {
      project_id: asset.projectId, asset_revision_id: asset.revisionId, content_hash: asset.contentHash,
      max_bytes: asset.objectSize,
    }, {}, 'probe-budget-growth');
    assert.equal(queued.ok, true);
    fs.chmodSync(asset.objectPath, 0o644);
    fs.appendFileSync(asset.objectPath, Buffer.alloc(asset.objectSize + 1, 0x61));
    core._localProbeRunning = false;
    core._scheduleLocalProbeRunner();
    await waitFor();
    const result = core.handle(request('query.jobs.get', { job_id: queued.result.job.id }));
    assert.equal(result.result.job.state, 'FAILED_RETRYABLE');
    assert.equal(result.result.job.evidence.state, 'UNKNOWN');
    assert.equal(result.result.job.evidence.code, 'PROBE_IO_BUDGET_EXCEEDED');
    assert.equal(result.result.job.evidence.bytes_read, 0);
    assert.equal(result.result.job.usage.state, 'RELEASED');
  } finally {
    core._localProbeRunning = false;
    core.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
