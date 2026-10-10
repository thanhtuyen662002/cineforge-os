import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { CoreService } from './core.mjs';
import { initializeDatabase, SCHEMA_VERSION } from './schema.mjs';
import { parseMediaProbe, MEDIA_PROBE_LIMITS } from './media-probe.mjs';

function fixture() {
  return { format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '1.001000', size: '128', nb_streams: 1 },
    streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', time_base: '1/30000',
      duration_ts: '30030', duration: '1.001000', r_frame_rate: '30000/1001',
      avg_frame_rate: '30000/1001', nb_frames: '30', width: 1280, height: 720,
      sample_aspect_ratio: '1:1', disposition: { default: 1, attached_pic: 0 } }] };
}
const bytes = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
const parse = (value, options) => parseMediaProbe(bytes(value), options);
function rejection(value, code, outcome = 'UNKNOWN', options) {
  assert.deepEqual(parse(value, options), { ok: false, outcome, code });
}

test('exact NTSC-like timing is normalized without floating-point or PASS authority', () => {
  const input = fixture();
  input.streams[0].avg_frame_rate = '60000/2002';
  const original = structuredClone(input);
  const result = parse(input);
  assert.equal(result.ok, true);
  assert.deepEqual(result.metadata.duration, { num: 1001, den: 1000 });
  assert.deepEqual(result.metadata.streams[0].frame_rate, { num: 30000, den: 1001 });
  assert.equal(result.metadata.streams[0].color_primaries, null);
  assert.equal(result.metadata.streams[0].frame_count, 30);
  assert.equal('outcome' in result, false);
  assert.equal('source_content_hash' in result.metadata, false);
  assert.deepEqual(input, original);
});

test('audio facts and deterministic stream order preserve absent layout as unknown', () => {
  const input = fixture();
  input.format.nb_streams = 2;
  input.streams = [{ index: 9, codec_type: 'audio', codec_name: 'aac', time_base: '1/48000',
    duration_ts: '48048', sample_rate: '48000', channels: 2 }, ...input.streams];
  const result = parse(input);
  assert.equal(result.ok, true);
  assert.deepEqual(result.metadata.streams.map(stream => stream.stream_index), [0, 9]);
  assert.deepEqual(result.metadata.streams[1].duration, { num: 1001, den: 1000 });
  assert.equal(result.metadata.streams[1].channel_layout, null);
});

test('decoded duplicate keys and prototype pollution fail before ordinary JSON parsing loses evidence', () => {
  rejection('{"format":{},"for\\u006dat":{},"streams":[]}', 'PROBE_DUPLICATE_KEY', 'CONFLICT');
  rejection('{"__proto__":{"polluted":true}}', 'PROBE_KEY_BLOCKED');
  rejection('{"constructor":{}}', 'PROBE_KEY_BLOCKED');
  assert.equal({}.polluted, undefined);
});

test('malformed UTF-8, unpaired surrogates, BOM and trailing JSON are rejected', () => {
  assert.equal(parseMediaProbe(Buffer.from([0xc3, 0x28])).code, 'PROBE_UTF8_INVALID');
  rejection('{"format":"\\ud800"}', 'PROBE_UNICODE_INVALID');
  rejection('{"format":"\\udc00"}', 'PROBE_UNICODE_INVALID');
  rejection('\ufeff{}', 'PROBE_JSON_INVALID');
  rejection('{} {}', 'PROBE_JSON_INVALID');
  for (const raw of ['', '{', '[1,]', '{"x":1,}', '{"x":NaN}', '{"x":Infinity}', '{"x":01}']) {
    assert.equal(parse(raw).ok, false);
  }
});

test('unsafe integer, overflow and rounded float lexemes cannot become canonical integers', () => {
  rejection('{"index":9007199254740993}', 'PROBE_NUMERIC_RANGE');
  rejection('{"index":1e309}', 'PROBE_NUMERIC_RANGE');
  for (const number of ['1.0', '1e0', '1.0000000000000001']) {
    rejection(`{"index":${number}}`, 'PROBE_NUMERIC_FORM');
  }
});

test('depth, key/value nodes, strings, arrays, streams and bytes have enforced budgets', () => {
  rejection('[[[[]]]]', 'PROBE_DEPTH_LIMIT', 'UNKNOWN', { limits: { maxDepth: 3 } });
  rejection('{"a":1,"b":2}', 'PROBE_NODE_LIMIT', 'UNKNOWN', { limits: { maxNodes: 4 } });
  rejection('"ééé"', 'PROBE_STRING_LIMIT', 'UNKNOWN', { limits: { maxStringBytes: 5 } });
  rejection('[1,2,3]', 'PROBE_ARRAY_LIMIT', 'UNKNOWN', { limits: { maxArrayEntries: 2 } });
  const input = fixture(); input.streams.push({ ...input.streams[0], index: 1 }); input.format.nb_streams = 2;
  rejection(input, 'PROBE_STREAM_LIMIT', 'UNKNOWN', { limits: { maxStreams: 1 } });
  rejection(fixture(), 'PROBE_OUTPUT_LIMIT', 'UNKNOWN', { limits: { maxBytes: 1 } });
  const maximum = Buffer.alloc(MEDIA_PROBE_LIMITS.maxBytes + 1, 0x20);
  assert.equal(parseMediaProbe(maximum).code, 'PROBE_OUTPUT_LIMIT');
});

test('call options can tighten budgets but cannot widen or disable policy', () => {
  for (const options of [{ limits: { maxBytes: MEDIA_PROBE_LIMITS.maxBytes + 1 } },
    { limits: { maxDepth: 0 } }, { limits: { maxNodes: Infinity } },
    { limits: { unknown: 1 } }, { trusted: true }, null]) {
    rejection(fixture(), 'PROBE_POLICY_INVALID', 'UNKNOWN', options);
  }
});

test('unsafe paths, credential fields and arbitrary metadata never reach output or diagnostics', () => {
  for (const mutate of [x => { x.format.filename = 'C:\\private\\secret.mp4'; },
    x => { x.streams[0].tags = { token: 'secret-token' }; },
    x => { x.streams[0].codec_name = '\\\\server\\credentials'; },
    x => { x.streams[0].codec_name = 'https://host/secret-token'; }]) {
    const input = fixture(); mutate(input);
    const result = parse(input);
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), /secret|private|server|host/);
  }
});

test('zero denominators, sentinel rates, unsafe rational components and media domains fail closed', () => {
  for (const [field, value] of [['time_base', '1/0'], ['avg_frame_rate', '0/0'],
    ['r_frame_rate', 'N/A'], ['time_base', '9007199254740992/1'],
    ['avg_frame_rate', '1001/1'], ['width', -1], ['height', 32769],
    ['duration_ts', '9007199254740992'], ['sample_aspect_ratio', '1:0']]) {
    const input = fixture(); input.streams[0][field] = value;
    assert.equal(parse(input).ok, false, field);
  }
  const input = fixture(); input.format.duration = '604801';
  rejection(input, 'PROBE_DURATION_RANGE');
});

test('attachment/data streams and unsafe dispositions cannot be accepted media', () => {
  for (const kind of ['attachment', 'data', 'subtitle', 'unknown']) {
    const input = fixture(); input.streams[0].codec_type = kind;
    rejection(input, 'PROBE_STREAM_UNSUPPORTED');
  }
  for (const flag of ['attached_pic', 'timed_thumbnails', 'still_image', 'metadata']) {
    const input = fixture(); input.streams[0].disposition = { [flag]: 1 };
    rejection(input, 'PROBE_STREAM_UNSAFE');
  }
});

test('contradictory durations, counts, indices and audio layouts return CONFLICT', () => {
  const cases = [
    [x => { x.streams[0].duration = '4'; }, 'PROBE_DURATION_CONFLICT'],
    [x => { x.format.duration = '0.5'; }, 'PROBE_DURATION_CONFLICT'],
    [x => { x.streams[0].nb_frames = '1000'; }, 'PROBE_FRAME_COUNT_CONFLICT'],
    [x => { x.format.nb_streams = 2; }, 'PROBE_STREAM_COUNT_CONFLICT'],
    [x => { x.streams.push({ ...x.streams[0] }); x.format.nb_streams = 2; }, 'PROBE_STREAM_INDEX_CONFLICT'],
  ];
  for (const [mutate, code] of cases) { const input = fixture(); mutate(input); rejection(input, code, 'CONFLICT'); }
  const input = fixture(); input.streams = [{ index: 0, codec_type: 'audio', codec_name: 'aac',
    time_base: '1/48000', duration_ts: '48048', sample_rate: '48000', channels: 2, channel_layout: 'mono' }];
  rejection(input, 'PROBE_CHANNEL_CONFLICT', 'CONFLICT');
  input.streams[0].channel_layout = 'stereo';
  input.streams[0].r_frame_rate = '0/0';
  assert.equal(parse(input).ok, false, 'no undocumented audio 0/0 exception');
});

test('bounded deterministic corruptions never throw, leak or manufacture parser success', () => {
  const valid = bytes(fixture());
  for (let i = 0; i < valid.length; i += 7) {
    const mutated = Buffer.from(valid); mutated[i] = 0xff;
    const result = parseMediaProbe(mutated);
    assert.deepEqual(result, { ok: false, outcome: 'UNKNOWN', code: 'PROBE_UTF8_INVALID' });
  }
  for (let i = 0; i < valid.length; i += 11) assert.equal(parseMediaProbe(valid.subarray(0, i)).ok, false);
});


test('integer duration ticks emitted by ffprobe are accepted without float coercion', () => {
  const input = fixture(); input.streams[0].duration_ts = 30030;
  assert.deepEqual(parse(input).metadata.duration, { num: 1001, den: 1000 });
});

test('credential-shaped safe ASCII tokens and unknown enums remain redacted', () => {
  for (const mutate of [x => { x.streams[0].codec_name = 'sk-live-secret-token'; },
    x => { x.streams[0].color_space = 'secret-token'; },
    x => { x.format.format_name = 'private-container'; }]) {
    const input = fixture(); mutate(input);
    rejection(input, 'PROBE_TOKEN_UNSUPPORTED');
  }
});


test('coarse clock ticks and a one-frame count contradiction cannot hide timing conflicts', () => {
  const coarse = fixture(); coarse.streams[0].time_base = '604800/1'; coarse.streams[0].duration_ts = '1';
  rejection(coarse, 'PROBE_TIME_BASE_RANGE');
  const wrongCount = fixture(); wrongCount.streams[0].nb_frames = '31';
  rejection(wrongCount, 'PROBE_FRAME_COUNT_CONFLICT', 'CONFLICT');
  const enormousFrame = fixture(); enormousFrame.streams[0].avg_frame_rate = '1/1000000000000';
  enormousFrame.streams[0].nb_frames = '1';
  rejection(enormousFrame, 'PROBE_FRAME_COUNT_CONFLICT', 'CONFLICT');
});

function command(core, command_type, payload, idempotency_key) {
  return core.handle({ request_id: idempotency_key, api_version: '1', method: 'command.execute',
    params: { command_type, payload, expected_versions: {}, idempotency_key } });
}
function insert(db, table, row) {
  const names = Object.keys(row);
  assert.ok([table, ...names].every(name => /^[a-z][a-z0-9_]*$/.test(name)));
  db.prepare(`INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...Object.values(row));
}

// These are privileged Kernel/SQL fixtures. They do not certify a real
// producer, parser binding, command authorization, sandbox or rights decision.
function persistenceFixture(Core = CoreService) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cineforge-probe-db-'));
  const core = new Core({ dbPath: path.join(directory, 'core.sqlite'), assetStorePath: path.join(directory, 'store') });
  const db = core.db;
  const project = command(core, 'CreateProject', { code: 'probe-schema', title: 'Kiểm thử persistence' }, 'schema-project');
  assert.equal(project.ok, true);
  const sourcePath = path.join(directory, 'source.txt');
  const sourceBytes = Buffer.from('privileged relational fixture, not certified media');
  fs.writeFileSync(sourcePath, sourceBytes);
  const contentHash = crypto.createHash('sha256').update(sourceBytes).digest('hex');
  const imported = command(core, 'ImportAsset', { project_id: project.result.id, source_path: sourcePath,
    asset_type: 'DOCUMENT', content_hash: contentHash }, 'schema-import');
  assert.equal(imported.ok, true);
  const revision = imported.result.asset.latest_revision;
  const location = db.prepare('SELECT l.id,l.storage_object_id FROM storage_object_locations l JOIN asset_revisions r ON r.storage_object_id=l.storage_object_id WHERE r.id=?').get(revision.id);
  const cmd = db.prepare("SELECT * FROM commands WHERE project_id=? AND command_type='ImportAsset'").get(project.result.id);
  insert(db, 'commands', { ...cmd, id: 'probe-command', command_type: 'ProbeMediaAsset', status: 'EXECUTING',
    payload_json: JSON.stringify({ asset_revision_id: revision.id }), idempotency_key: 'probe-command-fixture' });
  const stamp = Date.now() * 1000;
  const job = { id: 'probe-job', project_id: project.result.id, asset_revision_id: revision.id,
    storage_object_location_id: location.id, command_id: 'probe-command', source_content_hash: contentHash,
    source_byte_size: sourceBytes.byteLength, toolchain_manifest_hash: 'a'.repeat(64),
    toolchain_id: 'fixture-inspect', toolchain_version: '1', toolchain_binary_hash: 'b'.repeat(64),
    probe_schema_version: 'MEDIA_PROBE_V1', parser_policy_version: 'MEDIA_PROBE_PARSER_V1',
    rights_generation: 'c'.repeat(64), canonical_request_hash: 'd'.repeat(64),
    idempotency_key: 'schema-job', correlation_id: 'schema-correlation', state: 'QUEUED',
    next_step: 'Chờ kiểm thử', created_at_utc_us: stamp, updated_at_utc_us: stamp };
  insert(db, 'media_probe_jobs', job);
  return { core, db, job, stamp, location, directory, close() {
    core.close();
    assert.ok(path.resolve(directory).startsWith(path.join(os.tmpdir(), 'cineforge-probe-db-')));
    fs.rmSync(directory, { recursive: true, force: true });
  } };
}
function verifying(f) {
  insert(f.db, 'media_probe_attempts', { id: 'attempt-1', job_id: f.job.id, attempt_no: 1, retry_kind: 'INITIAL',
    idempotency_key: 'attempt-1', fencing_token: 'fence-1', state: 'VERIFYING', created_at_utc_us: f.stamp, updated_at_utc_us: f.stamp });
  f.db.prepare("UPDATE media_probe_jobs SET state='VERIFYING',current_attempt_id='attempt-1',fencing_token='fence-1',row_version=row_version+1 WHERE id=?").run(f.job.id);
}
function proof(f, overrides = {}) {
  return { id: 'evidence-1', attempt_id: 'attempt-1', outcome: 'PASS', evidence_code: 'PROBE_VALIDATED',
    source_content_hash: f.job.source_content_hash, source_byte_size: f.job.source_byte_size,
    toolchain_manifest_hash: f.job.toolchain_manifest_hash, toolchain_binary_hash: f.job.toolchain_binary_hash,
    probe_schema_version: f.job.probe_schema_version,
    parser_policy_version: f.job.parser_policy_version, observed_source_hash: f.job.source_content_hash,
    observed_source_byte_size: f.job.source_byte_size, stdout_bytes: f.job.source_byte_size, stderr_bytes: 0,
    cpu_time_ms: 1, memory_peak_bytes: 1024, process_tree_state: 'STOPPED', exit_code: 0,
    cancel_outcome: 'NOT_REQUESTED', timeout_outcome: 'NONE', validation_snapshot_hash: 'e'.repeat(64),
    created_at_utc_us: f.stamp, ...overrides };
}
function measurement(f, overrides = {}) {
  return { id: 'metadata-1', project_id: f.job.project_id, source_asset_revision_id: f.job.asset_revision_id,
    source_content_hash: f.job.source_content_hash, source_byte_size: f.job.source_byte_size,
    toolchain_id: f.job.toolchain_id, toolchain_version: f.job.toolchain_version, toolchain_manifest_hash: f.job.toolchain_manifest_hash,
    toolchain_binary_hash: f.job.toolchain_binary_hash,
    probe_schema_version: f.job.probe_schema_version, parser_policy_version: f.job.parser_policy_version,
    probe_job_id: f.job.id, probe_attempt_id: 'attempt-1', raw_evidence_object_id: f.location.storage_object_id,
    raw_evidence_hash: f.job.source_content_hash, raw_evidence_byte_size: f.job.source_byte_size,
    evidence_state: 'PASS', normalized_metadata_hash: 'f'.repeat(64), created_at_utc_us: f.stamp,
    media_kind: 'VIDEO', container: 'mp4', codec: 'h264', width: 1280, height: 720,
    duration_num: 1, duration_den: 1, metadata_json: '{}', stream_count: 1, ...overrides };
}
function accepted(f, count = 1) {
  verifying(f); insert(f.db, 'media_probe_evidence', proof(f));
  f.db.prepare("UPDATE media_probe_attempts SET state='SUCCEEDED',row_version=row_version+1 WHERE id='attempt-1'").run();
  insert(f.db, 'technical_metadata', measurement(f, { stream_count: count }));
}
function stream(index = 0, overrides = {}) {
  return { id: `stream-${index}`, technical_metadata_id: 'metadata-1', stream_index: index,
    stream_kind: 'VIDEO', codec: 'h264', width: 1280, height: 720, frame_rate_num: 30, frame_rate_den: 1,
    time_base_num: 1, time_base_den: 30, duration_num: 1, duration_den: 1,
    disposition_json: '{"default":1}', normalized_metadata_hash: 'f'.repeat(64), ...overrides };
}

test('probe migrations upgrade the actual v20 initializer and preserve unbound legacy facts without approval', async () => {
  const original = execFileSync('git', ['show', '78bdc508b28466b77a66b58757da5d3614fec87d:core/schema.mjs'], { encoding: 'utf8', windowsHide: true });
  const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cineforge-schema-v20-'));
  const fixturePath = path.join(fixtureDirectory, 'schema.mjs');
  const fixtureSource = original.replace(/from (['"])(\.\/[^'"]+)\1/g,
    (_, quote, specifier) => 'from ' + JSON.stringify(new URL(specifier, import.meta.url).href));
  fs.writeFileSync(fixturePath, fixtureSource);
  const old = await import(pathToFileURL(fixturePath).href);
  const db = new DatabaseSync(':memory:');
  try {
    old.initializeDatabase(db);
    assert.equal(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v, 20);
    const integritySql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='jobs'").get().sql;
    db.exec(`CREATE TABLE technical_metadata (id TEXT PRIMARY KEY,media_kind TEXT,container TEXT,codec TEXT,
      width INTEGER,height INTEGER,pixel_format TEXT,bit_depth INTEGER,frame_rate_num INTEGER,frame_rate_den INTEGER,
      time_base_num INTEGER,time_base_den INTEGER,frame_count INTEGER,duration_num INTEGER,duration_den INTEGER,
      color_primaries TEXT,transfer TEXT,matrix TEXT,audio_codec TEXT,sample_rate INTEGER,channel_layout TEXT,metadata_json TEXT);
      INSERT INTO technical_metadata(id,media_kind,codec,width,height,duration_num,duration_den,metadata_json)
      VALUES('legacy','VIDEO','h264',1280,720,1,1,'{"legacy_hint":"opaque unbound data"}');`);
    const before = db.prepare('SELECT * FROM technical_metadata').get();
    initializeDatabase(db); initializeDatabase(db);
    assert.equal(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v, SCHEMA_VERSION);
    const after = db.prepare('SELECT * FROM technical_metadata').get();
    for (const [key, value] of Object.entries(before)) assert.equal(after[key], value, key);
    for (const key of ['source_content_hash', 'probe_job_id', 'evidence_state', 'stream_count']) assert.equal(after[key], null);
    assert.equal(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='jobs'").get().sql, integritySql);
    assert.throws(() => db.prepare("UPDATE technical_metadata SET width=1 WHERE id='legacy'").run(), /append-only/);
  } finally { db.close(); fs.rmSync(fixtureDirectory, { recursive: true, force: true }); }
});

test('future versions, incompatible layouts and forbidden alias fail before schema writes', () => {
  for (const [ddl, code] of [
    ['CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at_utc_us INTEGER); INSERT INTO schema_migrations VALUES(999,1);', 'DATABASE_SCHEMA_VERSION_UNSUPPORTED'],
    ['CREATE TABLE technical_metadata(id TEXT PRIMARY KEY,unknown_column TEXT);', 'TECHNICAL_METADATA_LAYOUT_UNSUPPORTED'],
    ['CREATE TABLE asset_technical_metadata(id TEXT PRIMARY KEY);', 'AMBIGUOUS_TECHNICAL_METADATA_TABLE'],
  ]) {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(ddl);
      const before = db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all();
      assert.throws(() => initializeDatabase(db), new RegExp(code));
      assert.deepEqual(db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all(), before);
    } finally { db.close(); }
  }
});

test('probe jobs enforce source/command scope, immutable pins, version and bounded identity', () => {
  const f = persistenceFixture();
  try {
    const other = command(f.core, 'CreateProject', { code: 'other', title: 'Khác' }, 'other-project');
    assert.equal(other.ok, true);
    assert.throws(() => insert(f.db, 'media_probe_jobs', { ...f.job, id: 'cross-job', project_id: other.result.id, idempotency_key: 'cross' }), /scope mismatch/);
    assert.throws(() => f.db.prepare('UPDATE media_probe_jobs SET source_content_hash=?,row_version=row_version+1').run('0'.repeat(64)), /immutable identity/);
    assert.throws(() => f.db.prepare("UPDATE media_probe_jobs SET state='PARSING'").run(), /row version/);
    assert.throws(() => insert(f.db, 'media_probe_jobs', { ...f.job, id: 'overflow', source_byte_size: 1.5 }), /constraint|scope/i);
    assert.throws(() => f.db.prepare("UPDATE media_probe_jobs SET state='COMPLETED',row_version=row_version+1").run(), /missing metadata/);
    verifying(f);
    assert.throws(() => insert(f.db, 'media_probe_attempts', { id: 'duplicate', job_id: f.job.id, attempt_no: 1, retry_kind: 'RETRY',
      idempotency_key: 'duplicate', state: 'CREATED', created_at_utc_us: f.stamp, updated_at_utc_us: f.stamp }), /UNIQUE/);
    assert.throws(() => f.db.prepare("UPDATE media_probe_attempts SET fencing_token='other',row_version=row_version+1").run(), /fence/);
  } finally { f.close(); }
});

test('PASS evidence requires exact pins, stopped tree, uncancelled zero exit and observed source', () => {
  const f = persistenceFixture();
  try {
    verifying(f);
    for (const overrides of [{ process_tree_state: 'UNKNOWN' }, { process_tree_state: 'SURVIVED' },
      { exit_code: null }, { exit_code: 1 }, { cancel_outcome: 'REQUESTED' }, { timeout_outcome: 'TRIGGERED' },
      { observed_source_hash: null }, { observed_source_byte_size: null }, { observed_source_hash: '0'.repeat(64) },
      { toolchain_manifest_hash: '0'.repeat(64) }, { stdout_bytes: 0 }]) {
      assert.throws(() => insert(f.db, 'media_probe_evidence', proof(f, overrides)), /constraint|pins/i);
    }
    insert(f.db, 'media_probe_evidence', proof(f, { outcome: 'UNKNOWN', process_tree_state: 'UNKNOWN', exit_code: null }));
    assert.throws(() => f.db.prepare("UPDATE media_probe_evidence SET outcome='PASS'").run(), /append-only/);
    assert.throws(() => insert(f.db, 'technical_metadata', measurement(f)), /proof/);
  } finally { f.close(); }
});

test('exact relational proof binds once and completion freezes the stream inventory', () => {
  const f = persistenceFixture();
  try {
    accepted(f, 2);
    assert.throws(() => insert(f.db, 'technical_metadata', measurement(f, { id: 'duplicate-metadata' })), /UNIQUE/);
    insert(f.db, 'technical_metadata_streams', stream());
    assert.throws(() => f.db.prepare("UPDATE media_probe_jobs SET state='COMPLETED',row_version=row_version+1").run(), /missing metadata/);
    insert(f.db, 'technical_metadata_streams', stream(1));
    f.db.prepare("UPDATE media_probe_jobs SET state='COMPLETED',row_version=row_version+1").run();
    assert.throws(() => insert(f.db, 'technical_metadata_streams', stream(2)), /closed|stale/);
    for (const table of ['technical_metadata', 'technical_metadata_streams', 'media_probe_evidence']) {
      assert.throws(() => f.db.prepare(`UPDATE ${table} SET id=id`).run(), /append-only/);
      assert.throws(() => f.db.prepare(`DELETE FROM ${table}`).run(), /append-only/);
    }
    assert.throws(() => f.db.prepare("UPDATE media_probe_attempts SET state='VERIFYING',row_version=row_version+1").run(), /terminal/);
  } finally { f.close(); }
});

test('cancelled, abandoned and relocated-source attempts cannot bind canonical metadata', () => {
  for (const kind of ['cancelled', 'abandoned', 'relocated']) {
    const f = persistenceFixture();
    try {
      verifying(f); insert(f.db, 'media_probe_evidence', proof(f));
      if (kind === 'abandoned') {
        f.db.prepare("UPDATE media_probe_attempts SET state='ABANDONED',row_version=row_version+1").run();
      } else {
        f.db.prepare("UPDATE media_probe_attempts SET state='SUCCEEDED',row_version=row_version+1").run();
        if (kind === 'cancelled') f.db.prepare("UPDATE media_probe_jobs SET state='CANCELLED',row_version=row_version+1").run();
        else f.db.prepare("UPDATE storage_object_locations SET state='MISSING' WHERE id=?").run(f.location.id);
      }
      assert.throws(() => insert(f.db, 'technical_metadata', measurement(f)), /proof/);
    } finally { f.close(); }
  }
});

test('typed stream guards reject unsafe disposition, partial rationals, excess inventory and non-media facts', () => {
  const f = persistenceFixture();
  try {
    accepted(f, 256);
    for (const overrides of [{ stream_kind: 'DATA' }, { width: -1 }, { duration_den: 0 },
      { time_base_num: 31 }, { pixel_aspect_num: 1, pixel_aspect_den: null },
      { disposition_json: '{"default":1,"default":1}' }, { disposition_json: '{"attached_pic":1}' },
      { disposition_json: '{"secret":"credentials"}' }]) {
      assert.throws(() => insert(f.db, 'technical_metadata_streams', stream(0, overrides)), /constraint|disposition/i);
    }
    f.db.exec('BEGIN');
    for (let i = 0; i < 256; i++) insert(f.db, 'technical_metadata_streams', stream(i));
    f.db.exec('COMMIT');
    assert.throws(() => insert(f.db, 'technical_metadata_streams', stream(256)), /stream limit/);
  } finally { f.close(); }
});


test('canonical measurement rejects unsafe scalars and raw extension data before any row binds', () => {
  const f = persistenceFixture();
  try {
    verifying(f); insert(f.db, 'media_probe_evidence', proof(f));
    f.db.prepare("UPDATE media_probe_attempts SET state='SUCCEEDED',row_version=row_version+1").run();
    for (const overrides of [{ width: 1.5 }, { height: 40000 }, { duration_num: 1.5 }, { duration_den: 0 },
      { duration_num: 604801 }, { bit_depth: 1.5 }, { sample_rate: 384001 },
      { frame_rate_num: 1001, frame_rate_den: 1 }, { time_base_num: 2, time_base_den: 1 },
      { metadata_json: '{"secret":"credentials"}' }, { raw_evidence_hash: '0'.repeat(64) }]) {
      assert.throws(() => insert(f.db, 'technical_metadata', measurement(f, overrides)), /shape|proof|constraint/i);
    }
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM technical_metadata').get().n, 0);
  } finally { f.close(); }
});


test('digest guards reject NUL suffixes after repeated schema initialization', () => {
  const f = persistenceFixture();
  try {
    f.db.exec('DROP TRIGGER media_probe_jobs_hash_bytes_insert');
    initializeDatabase(f.db);
    const bad = 'a'.repeat(64) + String.fromCharCode(0) + 'hidden-suffix';
    assert.throws(() => insert(f.db, 'media_probe_jobs', { ...f.job, id: 'nul-job', idempotency_key: 'nul-job',
      canonical_request_hash: '0'.repeat(64), rights_generation: bad }), /digest|constraint/i);
    verifying(f);
    assert.throws(() => f.db.prepare('UPDATE media_probe_attempts SET input_envelope_hash=?,row_version=row_version+1').run(bad), /digest|constraint/i);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM media_probe_jobs').get().n, 1);
  } finally { f.close(); }
});

test('schema 22 upgrades real v21 PASS history without fabricating binary observations', async () => {
  const sourceCommit = '95b126334c1c82a56bf8641e598183840463e7fe';
  const modules = fs.mkdtempSync(path.join(os.tmpdir(), 'cineforge-schema-v21-'));
  const modulePath = name => path.join(modules, name);
  for (const name of ['schema.mjs', 'core.mjs']) {
    const old = execFileSync('git', ['show', `${sourceCommit}:core/${name}`], { encoding: 'utf8', windowsHide: true });
    const remapped = old.replace(/from (['"])(\.\/[^'"]+)\1/g, (_, quote, specifier) => {
      const target = specifier === './schema.mjs' ? pathToFileURL(modulePath('schema.mjs')) : new URL(specifier, import.meta.url);
      return 'from ' + JSON.stringify(target.href);
    });
    fs.writeFileSync(modulePath(name), remapped);
  }
  let f;
  try {
    const old = await import(pathToFileURL(modulePath('core.mjs')).href);
    for (const historicalState of ['VERIFYING', 'COMPLETED']) {
      f = persistenceFixture(old.CoreService);
      assert.equal(f.db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v, 21);
      verifying(f);
      const oldProof = proof(f); delete oldProof.toolchain_binary_hash;
      insert(f.db, 'media_probe_evidence', oldProof);
      f.db.prepare("UPDATE media_probe_attempts SET state='SUCCEEDED',row_version=row_version+1").run();
      const oldMeasurement = measurement(f); delete oldMeasurement.toolchain_binary_hash;
      insert(f.db, 'technical_metadata', oldMeasurement); insert(f.db, 'technical_metadata_streams', stream());
      if (historicalState === 'COMPLETED') f.db.prepare("UPDATE media_probe_jobs SET state='COMPLETED',row_version=row_version+1").run();
      const before = Object.fromEntries(['media_probe_jobs', 'media_probe_attempts', 'media_probe_evidence', 'technical_metadata',
        'technical_metadata_streams'].map(table => [table, f.db.prepare(`SELECT * FROM ${table}`).all()]));
      const integritySql = f.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='jobs'").get().sql;
      initializeDatabase(f.db); initializeDatabase(f.db);
      assert.equal(f.db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v, 22);
      for (const [table, rows] of Object.entries(before)) {
        const after = f.db.prepare(`SELECT * FROM ${table}`).all();
        assert.equal(after.length, rows.length);
        for (let i = 0; i < rows.length; i++) for (const [key, value] of Object.entries(rows[i])) assert.equal(after[i][key], value, `${table}.${key}`);
        if (table === 'media_probe_evidence' || table === 'technical_metadata') assert.equal(after[0].toolchain_binary_hash, null);
      }
      assert.equal(f.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='jobs'").get().sql, integritySql);
      assert.throws(() => f.db.prepare("UPDATE media_probe_jobs SET state='COMPLETED',row_version=row_version+1").run(), /binary pin/);
      assert.throws(() => f.db.prepare('UPDATE technical_metadata SET toolchain_binary_hash=?').run(f.job.toolchain_binary_hash), /append-only/);
      assert.throws(() => f.db.prepare('UPDATE media_probe_evidence SET toolchain_binary_hash=?').run(f.job.toolchain_binary_hash), /append-only/);
      f.close(); f = null;
    }
  } finally {
    f?.close();
    assert.ok(path.resolve(modules).startsWith(path.join(os.tmpdir(), 'cineforge-schema-v21-')));
    fs.rmSync(modules, { recursive: true, force: true });
  }
});

test('new evidence and canonical metadata require the exact persisted binary pin', () => {
  const f = persistenceFixture();
  try {
    verifying(f);
    const invalid = [null, '0'.repeat(64), 'B'.repeat(64), 'b'.repeat(63), 'b'.repeat(64) + '\0suffix', 'é'.repeat(64)];
    for (const toolchain_binary_hash of invalid) {
      assert.throws(() => insert(f.db, 'media_probe_evidence', proof(f, { toolchain_binary_hash })), /pins|digest|constraint/i);
    }
    // No verified executable was observed for this diagnostic; null is honest.
    insert(f.db, 'media_probe_evidence', proof(f, { id: 'unknown-proof', outcome: 'UNKNOWN', toolchain_binary_hash: null }));
    insert(f.db, 'media_probe_evidence', proof(f));
    f.db.prepare("UPDATE media_probe_attempts SET state='SUCCEEDED',row_version=row_version+1").run();
    for (const toolchain_binary_hash of invalid) {
      assert.throws(() => insert(f.db, 'technical_metadata', measurement(f, { toolchain_binary_hash })), /pin|digest|constraint/i);
    }
    insert(f.db, 'technical_metadata', measurement(f)); insert(f.db, 'technical_metadata_streams', stream());
    f.db.prepare("UPDATE media_probe_jobs SET state='COMPLETED',row_version=row_version+1").run();
    assert.equal(f.db.prepare('SELECT toolchain_binary_hash FROM technical_metadata').get().toolchain_binary_hash, f.job.toolchain_binary_hash);
    assert.equal(f.db.prepare('SELECT state FROM media_probe_jobs').get().state, 'COMPLETED');
  } finally { f.close(); }
});
