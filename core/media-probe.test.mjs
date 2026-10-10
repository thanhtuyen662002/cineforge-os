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
import { canonicalJson } from './canonical.mjs';
import { preflightRendererToolchain } from './renderer-toolchain.mjs';

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

function command(core, command_type, payload, idempotency_key, expected_versions = {}) {
  return core.handle({ request_id: idempotency_key, api_version: '1', method: 'command.execute',
    params: { command_type, payload, expected_versions, idempotency_key } });
}
function insert(db, table, row) {
  const names = Object.keys(row);
  assert.ok([table, ...names].every(name => /^[a-z][a-z0-9_]*$/.test(name)));
  db.prepare(`INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...Object.values(row));
}

// These are privileged Kernel/SQL fixtures. They do not certify a real
// producer, parser binding, command authorization, sandbox or rights decision.
function persistenceFixture(Core = CoreService, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cineforge-probe-db-'));
  const core = new Core({ dbPath: path.join(directory, 'core.sqlite'), assetStorePath: path.join(directory, 'store'), ...options.coreOptions });
  const db = core.db;
  const project = command(core, 'CreateProject', { code: 'probe-schema', title: 'Kiểm thử persistence' }, 'schema-project');
  assert.equal(project.ok, true);
  const sourcePath = path.join(directory, 'source.txt');
  const sourceBytes = options.sourceBytes ?? Buffer.from('privileged relational fixture, not certified media');
  fs.writeFileSync(sourcePath, sourceBytes);
  const contentHash = crypto.createHash('sha256').update(sourceBytes).digest('hex');
  const imported = command(core, 'ImportAsset', { project_id: project.result.id, source_path: sourcePath,
    asset_type: options.assetType ?? 'DOCUMENT', content_hash: contentHash }, 'schema-import');
  assert.equal(imported.ok, true);
  const revision = imported.result.asset.latest_revision;
  if (options.withRights) {
    const rightsId = db.prepare('SELECT rights_identity_id FROM assets WHERE id=?').get(imported.result.asset.id).rights_identity_id;
    assert.equal(command(core, 'CreateRightsRecord', { rights_identity_id: rightsId, right_type: 'SOURCE_USE', status: 'ALLOWED',
      purpose: { allowed: ['MEDIA_INSPECTION'] } }, 'schema-rights').ok, true);
    assert.equal(command(core, 'RecordConsent', { rights_identity_id: rightsId, consent_type: 'SOURCE_USE', granted_by: 'fixture-owner' }, 'schema-consent').ok, true);
  }
  const location = db.prepare('SELECT l.id,l.storage_object_id FROM storage_object_locations l JOIN asset_revisions r ON r.storage_object_id=l.storage_object_id WHERE r.id=?').get(revision.id);
  const cmd = db.prepare("SELECT * FROM commands WHERE project_id=? AND command_type='ImportAsset'").get(project.result.id);
  if (options.seedQueuedJob !== false) insert(db, 'commands', { ...cmd, id: 'probe-command', command_type: 'ProbeMediaAsset', status: 'EXECUTING',
    payload_json: JSON.stringify({ asset_revision_id: revision.id }), idempotency_key: 'probe-command-fixture' });
  const stamp = Date.now() * 1000;
  const job = { id: 'probe-job', project_id: project.result.id, asset_revision_id: revision.id,
    storage_object_location_id: location.id, command_id: 'probe-command', source_content_hash: contentHash,
    source_byte_size: sourceBytes.byteLength, toolchain_manifest_hash: 'a'.repeat(64),
    toolchain_id: 'fixture-inspect', toolchain_version: '1', toolchain_binary_hash: 'b'.repeat(64),
    probe_schema_version: 'MEDIA_PROBE_V1', parser_policy_version: 'MEDIA_PROBE_PARSER_V1',
    rights_generation: 'c'.repeat(64), canonical_request_hash: 'd'.repeat(64),
    idempotency_key: 'schema-job', correlation_id: 'schema-correlation', state: 'QUEUED',
    next_step: 'Chờ kiểm thử', created_at_utc_us: stamp, updated_at_utc_us: stamp, ...options.probePins };
  if (options.withRights) job.rights_generation = core._mediaProbeRights(imported.result.asset.id).generation;
  if (options.seedQueuedJob !== false) insert(db, 'media_probe_jobs', job);
  return { core, db, job, stamp, location, directory, close() {
    core.close();
    assert.ok(path.resolve(directory).startsWith(path.join(os.tmpdir(), 'cineforge-probe-db-')));
    fs.rmSync(directory, { recursive: true, force: true });
  } };
}
function authorization(f, overrides = {}) {
  return { id: 'authorization-1', job_id: f.job.id, attempt_id: 'attempt-1', fencing_token: '1'.repeat(64),
    core_owner_epoch: 'fixture-core-epoch', certificate_hash: '2'.repeat(64), trust_generation: '3'.repeat(64),
    key_id: 'fixture-key', key_spki_hash: '4'.repeat(64), policy_epoch: 1, certification_epoch: 1,
    source_content_hash: f.job.source_content_hash, source_byte_size: f.job.source_byte_size,
    toolchain_manifest_hash: f.job.toolchain_manifest_hash, toolchain_binary_hash: f.job.toolchain_binary_hash,
    rights_generation: f.job.rights_generation, producer_contract_version: 'NATIVE_MEDIA_PROBE_BROKER_V1',
    argv_preset_id: 'MEDIA_PROBE_ARGV_V1', sandbox_profile_version: 'WINDOWS_APPCONTAINER_PROBE_V1',
    resource_profile_version: 'MEDIA_PROBE_RESOURCE_V1', not_before_utc_us: f.stamp,
    expires_at_utc_us: f.stamp + 1000000, created_at_utc_us: f.stamp, ...overrides };
}
function verifying(f) {
  const current = f.db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v >= 23;
  const fence = current ? '1'.repeat(64) : 'fence-1';
  if (current) insert(f.db, 'media_probe_authorizations', authorization(f));
  insert(f.db, 'media_probe_attempts', { id: 'attempt-1', job_id: f.job.id, attempt_no: 1, retry_kind: 'INITIAL',
    idempotency_key: 'attempt-1', fencing_token: fence, state: 'VERIFYING', created_at_utc_us: f.stamp, updated_at_utc_us: f.stamp,
    ...(current ? { authorization_id: 'authorization-1', core_owner_epoch: 'fixture-core-epoch',
      producer_contract_version: 'NATIVE_MEDIA_PROBE_BROKER_V1', argv_preset_id: 'MEDIA_PROBE_ARGV_V1' } : {}) });
  f.db.prepare("UPDATE media_probe_jobs SET state='VERIFYING',current_attempt_id='attempt-1',fencing_token=?,row_version=row_version+1 WHERE id=?").run(fence, f.job.id);
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
    created_at_utc_us: f.stamp,
    ...(f.db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v >= 23 ? { validated_at_utc_us: f.stamp } : {}), ...overrides };
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
      assert.equal(f.db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v, SCHEMA_VERSION);
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

test('authorization reservation rejects altered scope, unsafe digests, epochs and execution profiles', () => {
  const f = persistenceFixture();
  try {
    initializeDatabase(f.db);
    for (const field of ['source_content_hash', 'toolchain_manifest_hash', 'toolchain_binary_hash', 'rights_generation']) {
      assert.throws(() => insert(f.db, 'media_probe_authorizations', authorization(f, { [field]: '0'.repeat(64) })), /scope/);
    }
    for (const field of ['certificate_hash', 'trust_generation', 'key_spki_hash', 'fencing_token']) {
      for (const value of ['a'.repeat(64) + '\0suffix', 'A'.repeat(64), 'é'.repeat(64), null]) {
        assert.throws(() => insert(f.db, 'media_probe_authorizations', authorization(f, { [field]: value })), /constraint/i);
      }
    }
    for (const overrides of [{ source_byte_size: f.job.source_byte_size + 1 }, { source_byte_size: 1073741825 },
      { policy_epoch: 0 }, { certification_epoch: 1.5 }, { policy_epoch: 9007199254740992 }, { core_owner_epoch: '' },
      { producer_contract_version: 'SHELL' }, { argv_preset_id: 'ARBITRARY' }, { sandbox_profile_version: 'NONE' },
      { resource_profile_version: 'UNBOUNDED' }, { not_before_utc_us: f.stamp + 1 }, { expires_at_utc_us: f.stamp },
      { created_at_utc_us: f.stamp + 1000000 }, { job_id: 'missing' }, { id: null }]) {
      assert.throws(() => insert(f.db, 'media_probe_authorizations', authorization(f, overrides)), /scope|constraint/i);
    }
    insert(f.db, 'media_probe_authorizations', authorization(f));
    assert.throws(() => insert(f.db, 'media_probe_authorizations', authorization(f, { id: 'reservation-replay' })), /UNIQUE/);
    assert.throws(() => f.db.prepare('UPDATE media_probe_authorizations SET certification_epoch=2').run(), /append-only/);
    assert.throws(() => f.db.prepare('DELETE FROM media_probe_authorizations').run(), /append-only/);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM media_probe_authorizations').get().n, 1);
  } finally { f.close(); }
});

test('a native attempt resolves its reserved identity and cannot change authorization, owner or profile', () => {
  const f = persistenceFixture();
  try {
    insert(f.db, 'media_probe_authorizations', authorization(f));
    const row = { id: 'attempt-1', job_id: f.job.id, attempt_no: 1, retry_kind: 'INITIAL', idempotency_key: 'attempt-1',
      fencing_token: '1'.repeat(64), authorization_id: 'authorization-1', core_owner_epoch: 'fixture-core-epoch',
      producer_contract_version: 'NATIVE_MEDIA_PROBE_BROKER_V1', argv_preset_id: 'MEDIA_PROBE_ARGV_V1',
      state: 'CREATED', created_at_utc_us: f.stamp, updated_at_utc_us: f.stamp };
    for (const overrides of [{ id: 'wrong-attempt' }, { authorization_id: null }, { authorization_id: 'missing' },
      { core_owner_epoch: null }, { core_owner_epoch: 'new-owner' }, { fencing_token: '0'.repeat(64) },
      { producer_contract_version: 'other' }, { argv_preset_id: 'other' }]) {
      assert.throws(() => insert(f.db, 'media_probe_attempts', { ...row, ...overrides }), /authorization/);
    }
    insert(f.db, 'media_probe_attempts', row);
    for (const [field, value] of [['authorization_id', null], ['core_owner_epoch', 'new-owner'],
      ['producer_contract_version', 'other'], ['argv_preset_id', 'other'], ['fencing_token', '0'.repeat(64)]]) {
      assert.throws(() => f.db.prepare(`UPDATE media_probe_attempts SET ${field}=?,row_version=row_version+1`).run(value), /authorization|fence/);
    }
    assert.equal(f.db.prepare('SELECT core_owner_epoch FROM media_probe_attempts').get().core_owner_epoch, row.core_owner_epoch);
  } finally { f.close(); }
});

test('PASS requires an in-window Core observation and enforces bounded new stderr facts', () => {
  const f = persistenceFixture();
  try {
    verifying(f);
    for (const validated_at_utc_us of [null, f.stamp - 1, f.stamp + 1000000, 9007199254740992, f.stamp + 0.5]) {
      assert.throws(() => insert(f.db, 'media_probe_evidence', proof(f, { validated_at_utc_us })), /authorization|constraint/i);
    }
    for (const outcome of ['PASS', 'UNKNOWN']) {
      assert.throws(() => insert(f.db, 'media_probe_evidence', proof(f, { outcome, stderr_bytes: 1048577 })), /limit|authorization/);
    }
    assert.throws(() => f.db.prepare('UPDATE media_probe_attempts SET stderr_bytes=1048577,row_version=row_version+1').run(), /limit/);
    insert(f.db, 'media_probe_evidence', proof(f, { validated_at_utc_us: f.stamp + 999999, stderr_bytes: 1048576 }));
    f.db.prepare("UPDATE media_probe_attempts SET state='SUCCEEDED',row_version=row_version+1").run();
    insert(f.db, 'technical_metadata', measurement(f)); insert(f.db, 'technical_metadata_streams', stream());
    f.db.prepare("UPDATE media_probe_jobs SET state='COMPLETED',row_version=row_version+1").run();
    assert.equal(f.db.prepare('SELECT state FROM media_probe_jobs').get().state, 'COMPLETED');
  } finally { f.close(); }
});

test('schema 23 preserves actual v22 history without inventing authorization or validation time', async () => {
  const sourceCommit = '57d66d6b06b06fb72c944efa6cb16088fcf426d7';
  const modules = fs.mkdtempSync(path.join(os.tmpdir(), 'cineforge-schema-v22-'));
  const modulePath = name => path.join(modules, name);
  for (const name of ['schema.mjs', 'core.mjs']) {
    const old = execFileSync('git', ['show', `${sourceCommit}:core/${name}`], { encoding: 'utf8', windowsHide: true });
    fs.writeFileSync(modulePath(name), old.replace(/from (['"])(\.\/[^'"]+)\1/g, (_, quote, specifier) => {
      const target = specifier === './schema.mjs' ? pathToFileURL(modulePath('schema.mjs')) : new URL(specifier, import.meta.url);
      return 'from ' + JSON.stringify(target.href);
    }));
  }
  let f;
  try {
    const old = await import(pathToFileURL(modulePath('core.mjs')).href);
    for (const historicalState of ['VERIFYING', 'COMPLETED']) {
      f = persistenceFixture(old.CoreService);
      assert.equal(f.db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v, 22);
      accepted(f); insert(f.db, 'technical_metadata_streams', stream());
      // v22 allowed a larger diagnostic; it must survive without granting new authority.
      const diagnostic = { ...f.db.prepare('SELECT * FROM media_probe_attempts').get(), id: 'legacy-diagnostic', attempt_no: 2,
        idempotency_key: 'legacy-diagnostic', state: 'CREATED', stderr_bytes: 2097152 };
      insert(f.db, 'media_probe_attempts', diagnostic);
      if (historicalState === 'COMPLETED') f.db.prepare("UPDATE media_probe_jobs SET state='COMPLETED',row_version=row_version+1").run();
      const tables = ['media_probe_jobs', 'media_probe_attempts', 'media_probe_evidence', 'technical_metadata', 'technical_metadata_streams'];
      const before = Object.fromEntries(tables.map(table => [table, f.db.prepare(`SELECT * FROM ${table}`).all()]));
      const genericJobsSql = f.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='jobs'").get().sql;
      initializeDatabase(f.db); initializeDatabase(f.db);
      assert.equal(f.db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v, SCHEMA_VERSION);
      for (const table of tables) {
        const rows = f.db.prepare(`SELECT * FROM ${table}`).all();
        assert.equal(rows.length, before[table].length);
        for (let i = 0; i < rows.length; i++) for (const [key, value] of Object.entries(before[table][i])) {
          assert.equal(rows[i][key], value, `${table}.${key}`);
        }
      }
      assert.equal(f.db.prepare('SELECT count(*) AS n FROM media_probe_authorizations').get().n, 0);
      const attempt = f.db.prepare("SELECT * FROM media_probe_attempts WHERE id='attempt-1'").get();
      assert.equal(attempt.authorization_id, null); assert.equal(attempt.core_owner_epoch, null);
      assert.equal(f.db.prepare('SELECT validated_at_utc_us FROM media_probe_evidence').get().validated_at_utc_us, null);
      assert.equal(f.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='jobs'").get().sql, genericJobsSql);
      assert.throws(() => insert(f.db, 'media_probe_evidence', proof(f, { id: 'new-legacy-pass' })), /authorization/);
      assert.throws(() => insert(f.db, 'technical_metadata', measurement(f, { id: 'new-legacy-metadata' })), /authorization/);
      assert.throws(() => f.db.prepare("UPDATE media_probe_jobs SET state='COMPLETED',row_version=row_version+1").run(), /authorization/);
      assert.throws(() => f.db.prepare("UPDATE media_probe_attempts SET authorization_id='fabricated',row_version=row_version+1").run(), /authorization/);
      assert.throws(() => f.db.prepare('UPDATE media_probe_evidence SET validated_at_utc_us=?').run(f.stamp), /append-only/);
      // An unchanged legacy diagnostic can be checkpointed; no enlarged observation can be added.
      f.db.prepare("UPDATE media_probe_attempts SET stderr_bytes=stderr_bytes,row_version=row_version+1 WHERE id='legacy-diagnostic'").run();
      assert.throws(() => f.db.prepare("UPDATE media_probe_attempts SET stderr_bytes=2097153,row_version=row_version+1 WHERE id='legacy-diagnostic'").run(), /limit/);
      assert.throws(() => insert(f.db, 'media_probe_attempts', { ...diagnostic, id: 'legacy-overflow', attempt_no: 3,
        idempotency_key: 'legacy-overflow', state: 'CREATED' }), /limit/);
      f.close(); f = null;
    }
  } finally {
    f?.close();
    assert.ok(path.resolve(modules).startsWith(path.join(os.tmpdir(), 'cineforge-schema-v22-')));
    fs.rmSync(modules, { recursive: true, force: true });
  }
});

// Actual signature/preflight and owned Core writes, with an ephemeral fixture
// authority and a privileged queued-job seed. Never a real ffprobe certificate.
function reservationFixture(t, changes = () => {}) {
  const toolRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cineforge-probe-authority-'));
  const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const encode = value => Buffer.from(canonicalJson(value));
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const publicDer = publicKey.export({ format: 'der', type: 'spki' });
  const binary = Buffer.from('INERT FIXTURE; NO NATIVE EXECUTION');
  const manifest = { manifest_type: 'CINEFORGE_RENDERER_TOOLCHAIN', manifest_schema_version: 1,
    toolchain_id: 'fixture-inspect', toolchain_version: '1.0.0', network: false, binaries: {} };
  for (const name of ['ffmpeg', 'ffprobe']) {
    const binaryPath = path.join(toolRoot, process.platform === 'win32' ? name + '.exe' : name);
    fs.writeFileSync(binaryPath, binary);
    manifest.binaries[name] = { path: binaryPath, sha256: digest(binary), version: '1.0.0', size: binary.length };
  }
  const manifestPath = path.join(toolRoot, 'renderer-toolchain.json'); fs.writeFileSync(manifestPath, encode(manifest));
  const artifact = preflightRendererToolchain({ root: toolRoot, manifestPath, allowObjectManifest: false });
  assert.equal(artifact.state, 'READY');
  const now = Date.now();
  const control = { now, loads: 0, revoked: false, invalidSignature: false, throwOnLoad: false,
    statement: { capability: 'PROBE_MEDIA_ASSET_V1', platform: 'win32-x64', toolchain_id: manifest.toolchain_id,
      toolchain_version: manifest.toolchain_version, manifest_sha256: artifact.manifest_sha256,
      ffprobe_sha256: digest(binary), ffprobe_byte_size: binary.length, ffprobe_version: '1.0.0',
      probe_schema_version: 'MEDIA_PROBE_V1', parser_policy_version: 'MEDIA_PROBE_PARSER_V1',
      native_contract: 'NATIVE_MEDIA_PROBE_V1', argv_profile_version: 'MEDIA_PROBE_ARGV_V1',
      sandbox_profile_version: 'WINDOWS_APPCONTAINER_PROBE_V1', resource_profile_version: 'MEDIA_PROBE_RESOURCE_V1',
      certification_epoch: 5, license_snapshot_sha256: digest('fixture license'), runtime_evidence_sha256: digest('fixture runtime'),
      not_before_utc_ms: now - 1000, expires_at_utc_ms: now + 60000 },
    policy: { policy_version: 'MEDIA_PROBE_TRUST_V1', policy_epoch: 8, not_before_utc_ms: now - 10000, expires_at_utc_ms: now + 120000,
      keys: [{ key_id: 'fixture-key', purpose: 'PROBE_MEDIA_ASSET_V1', public_key_spki_base64: publicDer.toString('base64'),
        public_key_spki_sha256: digest(publicDer), state: 'ACTIVE', toolchain_ids: ['fixture-inspect'], minimum_pack_epoch: 1,
        not_before_utc_ms: now - 10000, expires_at_utc_ms: now + 120000 }], revoked_pack_hashes: [] },
    context: { minimumPolicyEpoch: 1, timeHealth: 'TRUSTED', trustFreshness: 'FRESH' } };
  const loader = () => {
    control.loads++;
    if (control.throwOnLoad) throw new Error('private-fixture-authority-secret');
    control.onLoad?.();
    const statement = structuredClone(control.statement);
    const envelope = { envelope_version: 'MEDIA_PROBE_ATTESTATION_V1', statement, signature: { algorithm: 'ED25519',
      key_id: 'fixture-key', signature_hex: crypto.sign(null, Buffer.from('CINEFORGE_MEDIA_PROBE_ATTESTATION_V1\0' + canonicalJson(statement)), privateKey).toString('hex') } };
    if (control.invalidSignature) envelope.signature.signature_hex = '0'.repeat(128);
    const envelopeBytes = encode(envelope);
    const policy = structuredClone(control.policy);
    if (control.revoked) policy.revoked_pack_hashes = [digest(envelopeBytes)];
    const trustPolicyBytes = encode(policy);
    return { envelopeBytes, trustPolicyBytes, trustContext: { ...control.context, policySha256: digest(trustPolicyBytes), nowUtcMs: control.now } };
  };
  const sourceBytes = Buffer.alloc(76); sourceBytes.write('RIFF'); sourceBytes.writeUInt32LE(68, 4); sourceBytes.write('WAVE', 8);
  sourceBytes.write('fmt ', 12); sourceBytes.writeUInt32LE(16, 16); sourceBytes.writeUInt16LE(1, 20); sourceBytes.writeUInt16LE(1, 22);
  sourceBytes.writeUInt32LE(8000, 24); sourceBytes.writeUInt32LE(16000, 28); sourceBytes.writeUInt16LE(2, 32); sourceBytes.writeUInt16LE(16, 34);
  sourceBytes.write('data', 36); sourceBytes.writeUInt32LE(32, 40);
  const options = { assetType: 'AUDIO', sourceBytes, withRights: true,
    coreOptions: { rendererToolchainRoot: toolRoot, rendererToolchainManifest: manifestPath, mediaProbeTrustSource: loader },
    probePins: { toolchain_id: manifest.toolchain_id, toolchain_version: manifest.toolchain_version,
      toolchain_manifest_hash: artifact.manifest_sha256, toolchain_binary_hash: digest(binary) } };
  changes(control, options);
  let f;
  t.after(() => {
    f?.close();
    assert.ok(path.resolve(toolRoot).startsWith(path.join(os.tmpdir(), 'cineforge-probe-authority-')));
    fs.rmSync(toolRoot, { recursive: true, force: true });
  });
  f = persistenceFixture(CoreService, options);
  return { ...f, control, options, toolRoot, manifest,
    request: { project_id: f.job.project_id, job_id: f.job.id, expected_version: 1, idempotency_key: 'reserve-1' } };
}

test('schema 24 upgrades actual v23 journals without backfill and rejects underspecified private admission owners', async t => {
  const modules = fs.mkdtempSync(path.join(os.tmpdir(),'cineforge-schema-v23-admission-'));
  let f;
  try {
    for(const name of ['core.mjs','schema.mjs']) {
      const historical=execFileSync('git',['show',`ea2c959de8160cb38769904f7fd16ee3f47ef771:core/${name}`],{encoding:'utf8',windowsHide:true});
      fs.writeFileSync(path.join(modules,name),historical.replace(/from (['"])(\.\/[^'"]+)\1/g,(_m,_q,specifier)=>
        'from '+JSON.stringify((specifier==='./schema.mjs'?pathToFileURL(path.join(modules,'schema.mjs')):new URL(specifier,import.meta.url)).href)));
    }
    const old=await import(pathToFileURL(path.join(modules,'core.mjs')).href);f=persistenceFixture(old.CoreService);
    assert.equal(f.db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v,23);
    accepted(f);insert(f.db,'technical_metadata_streams',stream());
    f.db.prepare("UPDATE media_probe_jobs SET state='COMPLETED',row_version=row_version+1").run();
    const tables=['media_probe_jobs','media_probe_attempts','media_probe_authorizations','media_probe_evidence',
      'technical_metadata','technical_metadata_streams','commands','audit_records','domain_events'];
    const before=Object.fromEntries(tables.map(table=>[table,f.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
    initializeDatabase(f.db);initializeDatabase(f.db);
    assert.equal(f.db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v,24);
    for(const table of tables)assert.deepEqual(f.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),before[table],table);
    const original=f.db.prepare("SELECT * FROM commands WHERE id='probe-command'").get();
    insert(f.db,'commands',{...original,id:'underspecified-private-owner',command_type:'PREPARED_ADMIT_MEDIA_PROBE_V1',
      idempotency_key:'private-owner-invalid',scope_type:'ASSET_REVISION',scope_id:f.job.asset_revision_id});
    assert.throws(()=>insert(f.db,'media_probe_jobs',{...f.job,id:'invalid-private-owned-job',command_id:'underspecified-private-owner',
      idempotency_key:'invalid-private-owned-job'}),/source\/command scope mismatch/);
    assert.equal(f.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  }finally{f?.close();assert.ok(path.resolve(modules).startsWith(path.join(os.tmpdir(),'cineforge-schema-v23-admission-')));fs.rmSync(modules,{recursive:true,force:true});}
});

function admissionFixture(t, change = () => {}) {
  const f = reservationFixture(t,(control,options)=>{options.seedQueuedJob=false;change(control,options);});
  const source = f.core._mediaProbeSource(f.job.project_id,f.job.asset_revision_id);
  return {...f,admissionRequest:{project_id:source.project_id,asset_revision_id:source.id,content_hash:source.content_hash,
    byte_size:source.byte_size,toolchain_manifest_hash:f.job.toolchain_manifest_hash,probe_schema_version:'MEDIA_PROBE_V1',
    parser_policy_version:'MEDIA_PROBE_PARSER_V1',expected_version:source.row_version,idempotency_key:'admit-1'}};
}

function workflowFixture(t) {
  const f=admissionFixture(t,(_c,o)=>{o.coreOptions.mediaProbeBrokerSource=()=>null;});
  const admitted=f.core.prepareMediaProbeAdmission(f.admissionRequest);
  return {...f,workflowRequest:{project_id:admitted.project_id,job_id:admitted.job_id,expected_version:1,idempotency_key:'workflow-test'}};
}

test('Core workflow owns dispatch prerequisite failures, exposes UNKNOWN and replays without authority or native callbacks', async t=>{
  const f=workflowFixture(t);
  await assert.rejects(f.core.runMediaProbeJob(f.workflowRequest));
  const root=f.db.prepare("SELECT * FROM commands WHERE command_type='PREPARED_RUN_MEDIA_PROBE_V1'").get();
  assert.equal(root.status,'PARTIAL');const receipt=JSON.parse(root.result_json);
  assert.equal(receipt.state,'UNKNOWN');assert.equal(receipt.needs_user,true);assert.equal(receipt.physical_tree,'UNKNOWN');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM media_probe_attempts').get().n,1);
  assert.equal(f.db.prepare('SELECT state FROM media_probe_jobs WHERE id=?').get(receipt.job_id).state,'CLAIMED');
  const projected=f.core.handle({api_version:'1',request_id:'workflow-query',method:'query.media_probe.list',params:{project_id:f.workflowRequest.project_id,asset_revision_id:f.admissionRequest.asset_revision_id}});
  assert.equal(projected.ok,true);assert.equal(projected.result.jobs[0].state,'UNKNOWN');assert.equal(projected.result.jobs[0].needs_user,true);
  const before=reservationSnapshot(f);const loads=f.control.loads;f.control.throwOnLoad=true;
  assert.deepEqual(await f.core.runMediaProbeJob(f.workflowRequest),receipt);
  assert.deepEqual(reservationSnapshot(f),before);assert.equal(f.control.loads,loads);
  await assert.rejects(f.core.runMediaProbeJob({...f.workflowRequest,expected_version:2}),{code:'IDEMPOTENCY_KEY_REUSE_CONFLICT'});
  const secret={...receipt,path:'private-source'};f.db.prepare('UPDATE commands SET result_json=? WHERE id=?').run(JSON.stringify(secret),root.id);
  await assert.rejects(f.core.runMediaProbeJob(f.workflowRequest),{code:'PROBE_WORKFLOW_INCONSISTENT'});
});

test('Core workflow records pre-reservation failure without blocking explicit independent work or retrying native execution',async t=>{
  const f=workflowFixture(t);f.control.revoked=true;
  await assert.rejects(f.core.runMediaProbeJob(f.workflowRequest));
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM media_probe_attempts').get().n,0);
  assert.equal(f.db.prepare('SELECT state FROM media_probe_jobs').get().state,'QUEUED');
  const receipt=JSON.parse(f.db.prepare("SELECT result_json FROM commands WHERE command_type='PREPARED_RUN_MEDIA_PROBE_V1'").get().result_json);
  const loads=f.control.loads;assert.deepEqual(await f.core.runMediaProbeJob(f.workflowRequest),receipt);assert.equal(f.control.loads,loads);
  f.control.revoked=false;
  await assert.rejects(f.core.runMediaProbeJob({...f.workflowRequest,idempotency_key:'explicit-new-workflow'}));
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM commands WHERE command_type='PREPARED_RUN_MEDIA_PROBE_V1'").get().n,2);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM media_probe_attempts').get().n,1);
});

test('Core workflow recovery rejects a retargeted deterministic child without inventing parent completion',async t=>{
  const f=workflowFixture(t);
  f.db.exec("CREATE TRIGGER workflow_reserved_fail BEFORE INSERT ON audit_records WHEN NEW.action_type IN ('media_probe.workflow_reserved','media_probe.workflow_failed') BEGIN SELECT RAISE(ABORT,'reserved fail'); END;");
  await assert.rejects(f.core.runMediaProbeJob(f.workflowRequest));f.db.exec('DROP TRIGGER workflow_reserved_fail');
  const parent=f.db.prepare("SELECT * FROM commands WHERE command_type='PREPARED_RUN_MEDIA_PROBE_V1'").get();
  f.db.prepare("UPDATE commands SET payload_json=json_set(payload_json,'$.job_id','other-job') WHERE command_type='PREPARED_AUTHORIZE_MEDIA_PROBE_V1'").run();
  f.core.close();
  const reopened=new CoreService({dbPath:path.join(f.directory,'core.sqlite'),assetStorePath:path.join(f.directory,'store')});
  try{
    assert.deepEqual(reopened.db.prepare('SELECT * FROM commands WHERE id=?').get(parent.id),parent);
    assert.throws(()=>reopened.reconcileMediaProbeWorkflows(),{code:'PROBE_WORKFLOW_INCONSISTENT'});
    assert.equal(reopened.db.prepare("SELECT COUNT(*) AS n FROM commands WHERE command_type='PREPARED_RECONCILE_MEDIA_PROBE_WORKFLOWS_V1'").get().n,0);
    await assert.rejects(reopened.runMediaProbeJob({...f.workflowRequest,idempotency_key:'other-root'}),{code:'PROBE_RECOVERY_REQUIRED'});
  }finally{reopened.close();}
});

test('Core workflow validates identity and scope before any new command and has no RPC route',async t=>{
  const f=workflowFixture(t);const before=reservationSnapshot(f);
  for(const patch of [{path:'bad'},{job_id:'unknown-job'},{project_id:'other-project'},{expected_version:2},{expected_version:0},{idempotency_key:'bad:key'}])
    await assert.rejects(f.core.runMediaProbeJob({...f.workflowRequest,...patch}));
  assert.deepEqual(reservationSnapshot(f),before);
  assert.equal(f.core.handle({api_version:'1',request_id:'no-private-workflow',method:'runMediaProbeJob',params:f.workflowRequest}).ok,false);
  f.db.exec("CREATE TRIGGER workflow_start_fail BEFORE INSERT ON audit_records WHEN NEW.action_type='media_probe.workflow_started' BEGIN SELECT RAISE(ABORT,'start fail'); END;");
  await assert.rejects(f.core.runMediaProbeJob(f.workflowRequest),/start fail/);assert.deepEqual(reservationSnapshot(f),before);
});

test('Core workflow survives interrupted reservation journaling without redispatch or authorizations being rewritten',async t=>{
  const f=workflowFixture(t);
  f.db.exec("CREATE TRIGGER workflow_reserved_fail BEFORE INSERT ON audit_records WHEN NEW.action_type IN ('media_probe.workflow_reserved','media_probe.workflow_failed') BEGIN SELECT RAISE(ABORT,'reserved fail'); END;");
  await assert.rejects(f.core.runMediaProbeJob(f.workflowRequest),/reserved fail/);
  const parent=f.db.prepare("SELECT * FROM commands WHERE command_type='PREPARED_RUN_MEDIA_PROBE_V1'").get();assert.equal(parent.status,'EXECUTING');
  const authorization=f.db.prepare('SELECT * FROM media_probe_authorizations').get();
  f.db.exec('DROP TRIGGER workflow_reserved_fail');f.core.close();
  const reopened=new CoreService({dbPath:path.join(f.directory,'core.sqlite'),assetStorePath:path.join(f.directory,'store')});
  try {
    const c=reopened.db.prepare('SELECT * FROM commands WHERE id=?').get(parent.id);assert.equal(c.status,'PARTIAL');
    const receipt=JSON.parse(c.result_json);assert.equal(receipt.contract,'PREPARED_MEDIA_PROBE_WORKFLOW_RECOVERY_V1');
    assert.equal(receipt.state,'UNKNOWN');assert.equal(receipt.logical_only,true);assert.equal(receipt.execution_started,false);
    assert.deepEqual(reopened.db.prepare('SELECT * FROM media_probe_authorizations').get(),authorization);
    assert.equal(reopened.db.prepare('SELECT state FROM media_probe_attempts').get().state,'ABANDONED');
    assert.equal(reopened.db.prepare('SELECT state FROM media_probe_jobs').get().state,'UNKNOWN');
    assert.equal(reopened.db.prepare("SELECT COUNT(*) AS n FROM commands WHERE command_type='PREPARED_DISPATCH_MEDIA_PROBE_V1'").get().n,0);
    assert.deepEqual(await reopened.runMediaProbeJob(f.workflowRequest),receipt);
    assert.deepEqual(reopened.reconcileMediaProbeWorkflows(),{recovered_workflows:0,batches:0,ready:true});
  }finally{reopened.close();}
});

test('Core workflow recovery rejects damaged private identity without generic backfill or partial batch audit',async t=>{
  const f=workflowFixture(t);f.control.revoked=true;
  f.db.exec("CREATE TRIGGER workflow_failed_fail BEFORE INSERT ON audit_records WHEN NEW.action_type='media_probe.workflow_failed' BEGIN SELECT RAISE(ABORT,'failed journal'); END;");
  await assert.rejects(f.core.runMediaProbeJob(f.workflowRequest));f.db.exec('DROP TRIGGER workflow_failed_fail');
  const parent=f.db.prepare("SELECT * FROM commands WHERE command_type='PREPARED_RUN_MEDIA_PROBE_V1'").get();
  f.db.prepare('UPDATE commands SET idempotency_fingerprint=NULL WHERE id=?').run(parent.id);
  const damaged=f.db.prepare('SELECT * FROM commands WHERE id=?').get(parent.id);f.core.close();
  const reopened=new CoreService({dbPath:path.join(f.directory,'core.sqlite'),assetStorePath:path.join(f.directory,'store')});
  try{
    assert.deepEqual(reopened.db.prepare('SELECT * FROM commands WHERE id=?').get(parent.id),damaged);
    assert.throws(()=>reopened.reconcileMediaProbeWorkflows(),{code:'PROBE_WORKFLOW_INCONSISTENT'});
    assert.equal(reopened.db.prepare("SELECT COUNT(*) AS n FROM commands WHERE command_type='PREPARED_RECONCILE_MEDIA_PROBE_WORKFLOWS_V1'").get().n,0);
    assert.equal(reopened.db.prepare('SELECT COUNT(*) AS n FROM media_probe_attempts').get().n,0);
    await assert.rejects(reopened.runMediaProbeJob({...f.workflowRequest,idempotency_key:'other'}),{code:'PROBE_RECOVERY_REQUIRED'});
  }finally{reopened.close();}
});

test('Core workflow recovery is bounded to 1000 parents and atomically rolls back a failing batch',async t=>{
  const f=workflowFixture(t);f.control.revoked=true;
  f.db.exec("CREATE TRIGGER workflow_failed_fail BEFORE INSERT ON audit_records WHEN NEW.action_type='media_probe.workflow_failed' BEGIN SELECT RAISE(ABORT,'failed journal'); END;");
  await assert.rejects(f.core.runMediaProbeJob(f.workflowRequest));f.db.exec('DROP TRIGGER workflow_failed_fail');
  const parent=f.db.prepare("SELECT * FROM commands WHERE command_type='PREPARED_RUN_MEDIA_PROBE_V1'").get();
  f.core._transaction(()=>{
    for(let i=0;i<1000;i++){
      const id='workflow-backlog-'+String(i).padStart(4,'0');insert(f.db,'commands',{...parent,id,idempotency_key:id});
      f.core._insertAudit({actionType:'media_probe.workflow_started',targetType:'MEDIA_PROBE_JOB',targetId:f.workflowRequest.job_id,
        payload:{core_owner_epoch:f.core.instanceEpoch,job_version:1}},id,f.core.actorId,'SUCCEEDED');
    }
  });
  f.db.exec("CREATE TRIGGER workflow_recovery_fail BEFORE INSERT ON audit_records WHEN NEW.action_type='media_probe.workflow_recovered' BEGIN SELECT RAISE(ABORT,'recovery fail'); END;");
  f.core.close();
  const reopened=new CoreService({dbPath:path.join(f.directory,'core.sqlite'),assetStorePath:path.join(f.directory,'store')});
  try{
    assert.throws(()=>reopened.reconcileMediaProbeWorkflows(),/recovery fail/);
    assert.equal(reopened.db.prepare("SELECT COUNT(*) AS n FROM commands WHERE command_type='PREPARED_RUN_MEDIA_PROBE_V1' AND status='EXECUTING'").get().n,1001);
    reopened.db.exec('DROP TRIGGER workflow_recovery_fail');
    assert.deepEqual(reopened.reconcileMediaProbeWorkflows(),{recovered_workflows:1000,batches:10,ready:false});
    assert.deepEqual(reopened.reconcileMediaProbeWorkflows(),{recovered_workflows:1,batches:1,ready:true});
    assert.equal(reopened.db.prepare('SELECT COUNT(*) AS n FROM media_probe_attempts').get().n,0);
  }finally{reopened.close();}
});

test('Core admission creates one audited exact queue intent without SQL job seed then reserves fresh authority', t => {
  const f = admissionFixture(t); assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM media_probe_jobs').get().n,0);
  const receipt = f.core.prepareMediaProbeAdmission(f.admissionRequest);
  assert.equal(receipt.contract,'PREPARED_MEDIA_PROBE_ADMISSION_V1');assert.equal(receipt.state,'QUEUED');
  assert.equal(receipt.execution_started,false);assert.equal(receipt.execution_available,false);
  assert.ok(receipt.estimated_storage_bytes > f.admissionRequest.byte_size);assert.equal(receipt.job_version,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM media_probe_attempts').get().n,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM media_probe_authorizations').get().n,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM media_probe_evidence').get().n,0);
  const job = f.db.prepare('SELECT * FROM media_probe_jobs WHERE id=?').get(receipt.job_id);
  const owner = f.db.prepare('SELECT * FROM commands WHERE id=?').get(job.command_id);
  assert.equal(owner.command_type,'PREPARED_ADMIT_MEDIA_PROBE_V1');assert.equal(owner.status,'SUCCEEDED');
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM audit_records WHERE command_id=? AND action_type='media_probe.admit_prepared'").get(owner.id).n,1);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM domain_events WHERE command_id=? AND event_type='MEDIA_PROBE_PREPARED_ADMITTED'").get(owner.id).n,1);
  const before = reservationSnapshot(f); const loads = f.control.loads; f.control.throwOnLoad=true;
  assert.deepEqual(f.core.prepareMediaProbeAdmission(f.admissionRequest),receipt);
  assert.deepEqual(reservationSnapshot(f),before);assert.equal(f.control.loads,loads);
  f.control.throwOnLoad=false;
  assert.throws(()=>f.core.prepareMediaProbeAdmission({...f.admissionRequest,idempotency_key:'admit-duplicate'}),{code:'PROBE_JOB_ALREADY_ACTIVE'});
  assert.deepEqual(reservationSnapshot(f),before);
  assert.throws(()=>f.core.prepareMediaProbeAdmission({...f.admissionRequest,expected_version:f.admissionRequest.expected_version+1}),{code:'IDEMPOTENCY_KEY_REUSE_CONFLICT'});
  const reserved = f.core.prepareMediaProbeAttempt({project_id:job.project_id,job_id:job.id,expected_version:1,idempotency_key:'reserve-admitted'});
  assert.equal(reserved.contract,'PREPARED_MEDIA_PROBE_AUTHORIZATION_V1');assert.equal(reserved.execution_started,false);
});

for (const [name,changeRequest,setup] of [
  ['stale asset version',r=>({...r,expected_version:r.expected_version+1})],
  ['changed source hash',r=>({...r,content_hash:'0'.repeat(64)})],
  ['changed source size',r=>({...r,byte_size:r.byte_size+1})],
  ['changed manifest pin',r=>({...r,toolchain_manifest_hash:'0'.repeat(64)})],
  ['unknown rights',r=>r,(c,o)=>{o.withRights=false;}],
  ['invalid signature',r=>r,c=>{c.invalidSignature=true;}],
  ['expired trust',r=>r,c=>{c.now+=300000;}],
  ['caller verdict',r=>({...r,state:'PASS'})],
  ['caller path',r=>({...r,source_path:'C:/untrusted.wav'})],
]) {
  test(`Core prepared admission rejects ${name} atomically`, t => {
    const f = admissionFixture(t,setup); const before = reservationSnapshot(f);
    assert.throws(()=>f.core.prepareMediaProbeAdmission(changeRequest(f.admissionRequest)));
    assert.deepEqual(reservationSnapshot(f),before);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM media_probe_jobs').get().n,0);
  });
}

test('Core prepared admission rechecks domain after trust callback and preserves audit atomicity and storage gate', t => {
  const f = admissionFixture(t); const before = reservationSnapshot(f);
  f.control.onLoad=()=>f.db.prepare("UPDATE storage_object_locations SET state='MISSING' WHERE id=?").run(f.location.id);
  assert.throws(()=>f.core.prepareMediaProbeAdmission(f.admissionRequest),{code:'PROBE_SOURCE_STALE'});
  assert.deepEqual(reservationSnapshot(f),before);f.control.onLoad=undefined;
  const originalStatfs=fs.statfsSync;
  try { fs.statfsSync=()=>({bavail:0n,bsize:1n});
    assert.throws(()=>f.core.prepareMediaProbeAdmission(f.admissionRequest),{code:'PROBE_STORAGE_INSUFFICIENT'});
  } finally {fs.statfsSync=originalStatfs;}
  assert.deepEqual(reservationSnapshot(f),before);
  f.db.exec("CREATE TRIGGER fixture_admission_audit BEFORE INSERT ON audit_records WHEN NEW.action_type='media_probe.admit_prepared' BEGIN SELECT RAISE(ABORT,'owned admission audit failure'); END;");
  assert.throws(()=>f.core.prepareMediaProbeAdmission(f.admissionRequest));assert.deepEqual(reservationSnapshot(f),before);
  f.db.exec('DROP TRIGGER fixture_admission_audit');
  assert.equal(f.core.handle({api_version:'1',request_id:'no-private-admission-rpc',method:'prepareMediaProbeAdmission',params:f.admissionRequest}).ok,false);
  const {expected_version,idempotency_key,...payload}=f.admissionRequest;
  const blocked=command(f.core,'ProbeMediaAsset',payload,'public-still-blocked',{ASSET:expected_version});
  assert.equal(blocked.ok,true);assert.equal(blocked.result.job.state,'BLOCKED_TOOLCHAIN');
  const originalJob=f.db.prepare('SELECT * FROM media_probe_jobs WHERE id=?').get(blocked.result.job.id);
  assert.equal(f.core.prepareMediaProbeAdmission(f.admissionRequest).state,'QUEUED');
  assert.deepEqual(f.db.prepare('SELECT * FROM media_probe_jobs WHERE id=?').get(originalJob.id),originalJob);
});

for(const mode of ['changed bytes','hardlink alias']) {
  test(`Core prepared admission rejects actual managed source ${mode}`,t=>{
    const f=admissionFixture(t);const file=path.join(f.core.assetStorePath,f.core._objectRelativePath('SHA-256',f.admissionRequest.content_hash));
    if(mode==='changed bytes'){fs.chmodSync(file,0o600);fs.writeFileSync(file,Buffer.alloc(f.admissionRequest.byte_size,1));}
    else fs.linkSync(file,path.join(f.directory,'owned-source-alias.wav'));
    const before=reservationSnapshot(f);
    assert.throws(()=>f.core.prepareMediaProbeAdmission(f.admissionRequest),{code:'PROBE_SOURCE_STALE'});
    assert.deepEqual(reservationSnapshot(f),before);
  });
}

test('private admission rejects unsafe replay receipt and preserves missing fingerprint on restart',t=>{
  const f=admissionFixture(t);const receipt=f.core.prepareMediaProbeAdmission(f.admissionRequest);
  const owner=f.db.prepare('SELECT command_id FROM media_probe_jobs WHERE id=?').get(receipt.job_id).command_id;
  f.db.prepare('UPDATE commands SET result_json=? WHERE id=?').run(JSON.stringify({...receipt,source_path:'C:/private/source.wav'}),owner);
  const before=reservationSnapshot(f);const loads=f.control.loads;
  assert.throws(()=>f.core.prepareMediaProbeAdmission(f.admissionRequest),{code:'PROBE_ADMISSION_STALE'});
  assert.deepEqual(reservationSnapshot(f),before);assert.equal(f.control.loads,loads);
  f.db.prepare('UPDATE commands SET result_json=?,idempotency_fingerprint=NULL WHERE id=?').run(JSON.stringify(receipt),owner);
  const damaged=f.db.prepare('SELECT * FROM commands WHERE id=?').get(owner);f.core.close();
  const reopened=new CoreService({dbPath:path.join(f.directory,'core.sqlite'),assetStorePath:path.join(f.directory,'store')});
  try {
    assert.deepEqual(reopened.db.prepare('SELECT * FROM commands WHERE id=?').get(owner),damaged);
    assert.throws(()=>reopened.prepareMediaProbeAdmission(f.admissionRequest),{code:'IDEMPOTENCY_KEY_REUSE_CONFLICT'});
    assert.equal(reopened.db.prepare('SELECT COUNT(*) AS n FROM media_probe_jobs').get().n,1);
  }finally{reopened.close();}
});

function dispatchFixture(t, change = () => {}) {
  const descriptor = { pipe_name: 'CineForge.MediaProbe.' + 'a'.repeat(64), broker_process_id: process.pid,
    installation_id: crypto.randomUUID(), library_id: crypto.randomUUID(), core_epoch: crypto.randomUUID(),
    session_id: crypto.randomUUID(), key: Buffer.alloc(32, 11) };
  const f = reservationFixture(t, (c, o) => {
    o.probePins.id = crypto.randomUUID();
    o.coreOptions.instanceEpoch = descriptor.core_epoch;
    o.coreOptions.mediaProbeBrokerSource = () => descriptor;
    change(c, o, descriptor);
  });
  const receipt = f.core.prepareMediaProbeAttempt(f.request);
  return { ...f, descriptor, dispatchRequest: { project_id: f.job.project_id, job_id: f.job.id,
    attempt_id: receipt.attempt_id, expected_version: receipt.job_version, idempotency_key: 'dispatch-fixture' } };
}

// Privileged interruption images for journal/retention tests. These do not
// fabricate native execution or canonical measurement PASS.
function interruptedDispatch(f, { phase = 'VERIFYING', stageState = null } = {}) {
  const identity = { project_id: f.dispatchRequest.project_id, job_id: f.dispatchRequest.job_id,
    attempt_id: f.dispatchRequest.attempt_id, expected_version: f.dispatchRequest.expected_version };
  const original = f.db.prepare('SELECT * FROM commands LIMIT 1').get(); const id = crypto.randomUUID();
  insert(f.db, 'commands', { ...original, id, project_id: f.job.project_id, actor_id: f.core.actorId,
    command_type: 'PREPARED_DISPATCH_MEDIA_PROBE_V1', schema_version: 1, scope_type: 'MEDIA_PROBE_ATTEMPT', scope_id: identity.attempt_id,
    payload_json: canonicalJson(identity), expected_versions_json: JSON.stringify({ JOB: identity.expected_version }),
    reversibility: 'COMPENSATABLE', status: 'EXECUTING', idempotency_key: f.dispatchRequest.idempotency_key,
    idempotency_fingerprint: crypto.createHash('sha256').update(canonicalJson(identity)).digest('hex'),
    finished_at_utc_us: null, result_json: null, error_code: null, error_details_json: null });
  f.db.prepare('UPDATE media_probe_attempts SET state=?,row_version=row_version+1 WHERE id=?').run(phase, identity.attempt_id);
  f.db.prepare('UPDATE media_probe_jobs SET state=?,row_version=row_version+1,current_attempt_id=?,fencing_token=? WHERE id=?')
    .run(phase === 'ABANDONED' ? 'UNKNOWN' : phase === 'EXECUTING' ? 'RUNNING' : phase === 'DISPATCHING' ? 'CLAIMED' : phase,
      phase === 'ABANDONED' ? null : identity.attempt_id,
      phase === 'ABANDONED' ? null : f.db.prepare('SELECT fencing_token FROM media_probe_attempts WHERE id=?').get(identity.attempt_id).fencing_token, f.job.id);
  let rawPath = null;
  if (stageState) {
    rawPath = path.join(f.directory, 'owned-partial-raw.json'); fs.writeFileSync(rawPath, '{');
    insert(f.db, 'staging_objects', { id: crypto.randomUUID(), command_id: id, job_attempt_id: identity.attempt_id,
      temp_path: rawPath, current_size: 1, state: stageState, created_at_utc_us: Date.now() * 1000, updated_at_utc_us: Date.now() * 1000 });
  }
  return { id, rawPath };
}

for (const [phase, stageState] of [['DISPATCHING', null], ['PARSING', 'WRITING'], ['VERIFYING', 'VERIFIED'], ['ABANDONED', 'REGISTERED']]) {
  test(`dispatch command recovery retires ${phase} image and retains ${stageState ?? 'absent'} raw custody`, async t => {
    const f = dispatchFixture(t); const image = interruptedDispatch(f, { phase, stageState });
    const stage = f.db.prepare('SELECT * FROM staging_objects WHERE command_id=?').get(image.id);
    const authorizations = f.db.prepare('SELECT * FROM media_probe_authorizations').all(); const loads = f.control.loads;
    const original = f.db.prepare('SELECT * FROM commands WHERE id=?').get(image.id); f.core.close();
    const recovered = new CoreService({ dbPath: path.join(f.directory, 'core.sqlite'), assetStorePath: path.join(f.directory, 'store'),
      mediaProbeTrustSource: () => { throw new Error('Recovery must not load trust'); } });
    try {
      const command = recovered.db.prepare('SELECT * FROM commands WHERE id=?').get(image.id);
      assert.equal(command.status, 'PARTIAL'); assert.equal(command.error_code, 'PROBE_DISPATCH_RECOVERED');
      for (const field of ['actor_id','project_id','scope_id','payload_json','idempotency_key','idempotency_fingerprint']) assert.equal(command[field], original[field]);
      const receipt = JSON.parse(command.result_json);
      assert.equal(receipt.contract, 'PREPARED_MEDIA_PROBE_COMMAND_RECOVERY_V1'); assert.equal(receipt.outcome, 'UNKNOWN');
      assert.equal(receipt.physical_tree, 'UNKNOWN'); assert.equal(receipt.binding_pin_state, 'UNKNOWN');
      assert.equal(receipt.historical_technical_metadata_id, null); assert.equal(receipt.historical_evidence_id, null);
      assert.equal(receipt.retained_staging?.state ?? null, stageState);
      assert.equal(JSON.stringify(receipt).includes(f.directory), false);
      assert.deepEqual(recovered.db.prepare('SELECT * FROM staging_objects WHERE command_id=?').get(image.id), stage);
      if (image.rawPath) assert.equal(fs.readFileSync(image.rawPath, 'utf8'), '{');
      assert.deepEqual(recovered.db.prepare('SELECT * FROM media_probe_authorizations').all(), authorizations); assert.equal(f.control.loads, loads);
      assert.equal(recovered.db.prepare('SELECT state FROM media_probe_attempts WHERE id=?').get(f.dispatchRequest.attempt_id).state, 'ABANDONED');
      assert.equal(recovered.db.prepare('SELECT state FROM media_probe_jobs WHERE id=?').get(f.job.id).state, 'UNKNOWN');
      assert.equal(recovered.db.prepare('SELECT COUNT(*) AS n FROM technical_metadata').get().n, 0);
      assert.equal(recovered.db.prepare('SELECT COUNT(*) AS n FROM media_probe_evidence').get().n, 0);
      const audit = recovered.db.prepare("SELECT * FROM audit_records WHERE action_type='media_probe.recover_dispatch' AND target_id=?").get(image.id);
      assert.equal(recovered.db.prepare('SELECT command_type FROM commands WHERE id=?').get(audit.command_id).command_type, 'PREPARED_RECONCILE_MEDIA_PROBE_COMMANDS_V1');
      const changes = recovered.db.prepare('SELECT total_changes() AS n').get().n;
      assert.deepEqual(recovered.reconcileMediaProbeDispatchCommands(), { recovered_commands: 0, changed_jobs: 0, retained_staging: 0, batches: 0, ready: true });
      assert.deepEqual(await recovered.dispatchMediaProbeAttempt(f.dispatchRequest), receipt);
      assert.equal(recovered.db.prepare('SELECT total_changes() AS n').get().n, changes);
      if (stage) assert.equal(recovered._stagingObjects().items.some(item => item.id === stage.id), false);
    } finally { recovered.close(); }
  });
}

test('dispatch command recovery leaves current owner work unchanged and rejects public scope', t => {
  const f = dispatchFixture(t); interruptedDispatch(f, { phase: 'VERIFYING', stageState: 'WRITING' });
  const before = reservationSnapshot(f);
  assert.deepEqual(f.core.reconcileMediaProbeDispatchCommands(), { recovered_commands: 0, changed_jobs: 0, retained_staging: 0, batches: 0, ready: true });
  assert.deepEqual(reservationSnapshot(f), before);
  assert.throws(() => f.core.reconcileMediaProbeDispatchCommands({ scope: '*' }), { code: 'INVALID_ARGUMENT' });
  assert.equal(f.core.handle({ api_version: '1', request_id: 'no-command-recovery-rpc', method: 'reconcileMediaProbeDispatchCommands', params: {} }).ok, false);
});

test('dispatch command recovery rolls back journal and custody on final audit failure then resumes idempotently', t => {
  const f = dispatchFixture(t); const image = interruptedDispatch(f, { phase: 'ABANDONED', stageState: 'WRITING' });
  f.db.exec("CREATE TRIGGER fixture_dispatch_recovery_audit BEFORE INSERT ON audit_records WHEN NEW.action_type='media_probe.reconcile_dispatch_commands' BEGIN SELECT RAISE(ABORT,'owned recovery audit failure'); END;");
  const stage = f.db.prepare('SELECT * FROM staging_objects WHERE command_id=?').get(image.id); f.core.close();
  const recovered = new CoreService({ dbPath: path.join(f.directory, 'core.sqlite'), assetStorePath: path.join(f.directory, 'store') });
  try {
    assert.equal(recovered.db.prepare('SELECT status FROM commands WHERE id=?').get(image.id).status, 'EXECUTING');
    assert.equal(recovered.db.prepare("SELECT COUNT(*) AS n FROM commands WHERE command_type='PREPARED_RECONCILE_MEDIA_PROBE_COMMANDS_V1'").get().n, 0);
    assert.deepEqual(recovered.db.prepare('SELECT * FROM staging_objects WHERE command_id=?').get(image.id), stage);
    assert.throws(() => recovered.prepareMediaProbeAttempt(f.request), { code: 'PROBE_RECOVERY_REQUIRED' });
    recovered.db.exec('DROP TRIGGER fixture_dispatch_recovery_audit');
    assert.deepEqual(recovered.reconcileMediaProbeDispatchCommands(), { recovered_commands: 1, changed_jobs: 0, retained_staging: 1, batches: 1, ready: true });
    assert.equal(fs.readFileSync(image.rawPath, 'utf8'), '{');
  } finally { recovered.close(); }
});

test('dispatch command recovery rejects missing or contradictory scope and keeps admission fenced', t => {
  const f = dispatchFixture(t); const image = interruptedDispatch(f, { phase: 'ABANDONED' });
  f.db.prepare("UPDATE commands SET scope_id='missing-owned-attempt' WHERE id=?").run(image.id);
  assert.throws(() => f.core.reconcileMediaProbeDispatchCommands(), { code: 'PROBE_RECOVERY_INCONSISTENT' });
  assert.equal(f.db.prepare('SELECT status FROM commands WHERE id=?').get(image.id).status, 'EXECUTING');
  assert.throws(() => f.core.prepareMediaProbeAttempt(f.request), { code: 'PROBE_RECOVERY_REQUIRED' });
  f.db.prepare('UPDATE commands SET scope_id=? WHERE id=?').run(f.dispatchRequest.attempt_id, image.id);
  const payload = JSON.parse(f.db.prepare('SELECT payload_json FROM commands WHERE id=?').get(image.id).payload_json); payload.project_id = 'wrong-project';
  f.db.prepare('UPDATE commands SET payload_json=? WHERE id=?').run(JSON.stringify(payload), image.id);
  assert.equal(f.core.reconcileMediaProbeDispatchCommands().recovered_commands, 0); // same current owner is never taken over
  f.core.close();
  const recovered = new CoreService({ dbPath: path.join(f.directory, 'core.sqlite'), assetStorePath: path.join(f.directory, 'store') });
  try {
    assert.throws(() => recovered.reconcileMediaProbeDispatchCommands(), { code: 'PROBE_RECOVERY_INCONSISTENT' });
    assert.throws(() => recovered.prepareMediaProbeAttempt(f.request), { code: 'PROBE_RECOVERY_REQUIRED' });
  } finally { recovered.close(); }
});

test('private probe authorization missing fingerprint is not rewritten by generic legacy backfill', t => {
  const f = dispatchFixture(t);
  f.db.prepare("UPDATE commands SET idempotency_fingerprint=NULL WHERE command_type='PREPARED_AUTHORIZE_MEDIA_PROBE_V1'").run();
  const command = f.db.prepare("SELECT * FROM commands WHERE command_type='PREPARED_AUTHORIZE_MEDIA_PROBE_V1'").get();
  assert.ok(command); f.core.close();
  const recovered = new CoreService({ dbPath: path.join(f.directory, 'core.sqlite'), assetStorePath: path.join(f.directory, 'store') });
  try {
    assert.deepEqual(recovered.db.prepare('SELECT * FROM commands WHERE id=?').get(command.id), command);
    assert.equal(recovered.db.prepare('SELECT COUNT(*) AS n FROM media_probe_authorizations').get().n, 1);
  } finally { recovered.close(); }
});

for (const [name, corrupt] of [
  ['changed fingerprint', row => ({ idempotency_fingerprint: '0'.repeat(64) })],
  ['missing fingerprint', row => ({ idempotency_fingerprint: null })],
  ['changed expected version', row => ({ expected_versions_json: JSON.stringify({ JOB: JSON.parse(row.payload_json).expected_version + 1 }) })],
  ['extra expected scope', row => ({ expected_versions_json: JSON.stringify({ JOB: JSON.parse(row.payload_json).expected_version, ASSET: 1 }) })],
  ['duplicate expected key', row => ({ expected_versions_json: `{"JOB":${JSON.parse(row.payload_json).expected_version},"JOB":${JSON.parse(row.payload_json).expected_version}}` })],
  ['null expected scope', row => ({ expected_versions_json: 'null' })],
  ['null payload', row => ({ payload_json: 'null' })],
  ['array payload', row => ({ payload_json: '[]' })],
  ['negative storage estimate', row => ({ payload_json: canonicalJson({ ...JSON.parse(row.payload_json), estimated_storage_bytes: -1 }) })],
]) {
  test(`dispatch command recovery blocks ${name} without changing command or raw custody`, t => {
    const f = dispatchFixture(t); const image = interruptedDispatch(f, { phase: 'ABANDONED', stageState: 'WRITING' });
    const original = f.db.prepare('SELECT * FROM commands WHERE id=?').get(image.id);
    const change = corrupt(original); const fields = Object.keys(change);
    f.db.prepare(`UPDATE commands SET ${fields.map(field => `${field}=?`).join(',')} WHERE id=?`).run(...Object.values(change), image.id);
    const damaged = f.db.prepare('SELECT * FROM commands WHERE id=?').get(image.id);
    const stage = f.db.prepare('SELECT * FROM staging_objects WHERE command_id=?').get(image.id);
    const raw = fs.readFileSync(stage.temp_path); const authorizations = f.db.prepare('SELECT * FROM media_probe_authorizations').all();
    f.core.close();
    const recovered = new CoreService({ dbPath: path.join(f.directory, 'core.sqlite'), assetStorePath: path.join(f.directory, 'store') });
    try {
      assert.throws(() => recovered.reconcileMediaProbeDispatchCommands(), { code: 'PROBE_RECOVERY_INCONSISTENT' });
      assert.throws(() => recovered.prepareMediaProbeAttempt(f.request), { code: 'PROBE_RECOVERY_REQUIRED' });
      assert.deepEqual(recovered.db.prepare('SELECT * FROM commands WHERE id=?').get(image.id), damaged);
      assert.deepEqual(recovered.db.prepare('SELECT * FROM staging_objects WHERE command_id=?').get(image.id), stage);
      assert.deepEqual(fs.readFileSync(stage.temp_path), raw);
      assert.deepEqual(recovered.db.prepare('SELECT * FROM media_probe_authorizations').all(), authorizations);
      assert.equal(recovered.db.prepare("SELECT COUNT(*) AS n FROM commands WHERE command_type='PREPARED_RECONCILE_MEDIA_PROBE_COMMANDS_V1'").get().n, 0);
      assert.equal(recovered.db.prepare("SELECT COUNT(*) AS n FROM audit_records WHERE action_type='media_probe.recover_dispatch'").get().n, 0);
      assert.equal(recovered.db.prepare('SELECT COUNT(*) AS n FROM technical_metadata').get().n, 0);
    } finally { recovered.close(); }
  });
}

test('dispatch command recovery rolls back a valid earlier row when later identity conflicts and resumes with original versions', async t => {
  const f = dispatchFixture(t); const image = interruptedDispatch(f, { phase: 'ABANDONED', stageState: 'WRITING' });
  const original = f.db.prepare('SELECT * FROM commands WHERE id=?').get(image.id);
  const secondId = crypto.randomUUID();
  insert(f.db, 'commands', { ...original, id: secondId, idempotency_key: 'owned-later-conflict',
    created_at_utc_us: original.created_at_utc_us + 1, idempotency_fingerprint: '0'.repeat(64) });
  const commands = f.db.prepare("SELECT * FROM commands WHERE command_type='PREPARED_DISPATCH_MEDIA_PROBE_V1' ORDER BY id").all();
  const stage = f.db.prepare('SELECT * FROM staging_objects WHERE command_id=?').get(image.id);
  const raw = fs.readFileSync(stage.temp_path); f.core.close();
  const recovered = new CoreService({ dbPath: path.join(f.directory, 'core.sqlite'), assetStorePath: path.join(f.directory, 'store') });
  try {
    assert.throws(() => recovered.reconcileMediaProbeDispatchCommands(), { code: 'PROBE_RECOVERY_INCONSISTENT' });
    assert.throws(() => recovered.prepareMediaProbeAttempt(f.request), { code: 'PROBE_RECOVERY_REQUIRED' });
    assert.deepEqual(recovered.db.prepare("SELECT * FROM commands WHERE command_type='PREPARED_DISPATCH_MEDIA_PROBE_V1' ORDER BY id").all(), commands);
    assert.equal(recovered.db.prepare("SELECT COUNT(*) AS n FROM audit_records WHERE action_type='media_probe.recover_dispatch'").get().n, 0);
    assert.deepEqual(recovered.db.prepare('SELECT * FROM staging_objects WHERE command_id=?').get(image.id), stage);
    assert.deepEqual(fs.readFileSync(stage.temp_path), raw);
    assert.notEqual(recovered.db.prepare('SELECT row_version FROM media_probe_jobs WHERE id=?').get(f.job.id).row_version, JSON.parse(original.payload_json).expected_version);
    // Explicit owned corruption-fixture repair; production recovery never repairs identity.
    recovered.db.prepare('UPDATE commands SET idempotency_fingerprint=? WHERE id=?').run(original.idempotency_fingerprint, secondId);
    assert.deepEqual(recovered.reconcileMediaProbeDispatchCommands(), { recovered_commands: 2, changed_jobs: 0, retained_staging: 1, batches: 1, ready: true });
    const beforeReplay = reservationSnapshot({ ...f, core: recovered, db: recovered.db });
    if (process.platform === 'win32') {
      assert.equal((await recovered.dispatchMediaProbeAttempt(f.dispatchRequest)).contract, 'PREPARED_MEDIA_PROBE_COMMAND_RECOVERY_V1');
      assert.deepEqual(reservationSnapshot({ ...f, core: recovered, db: recovered.db }), beforeReplay);
    }
    assert.deepEqual(recovered.db.prepare('SELECT * FROM staging_objects WHERE command_id=?').get(image.id), stage);
    assert.deepEqual(fs.readFileSync(stage.temp_path), raw);
  } finally { recovered.close(); }
});

test('dispatch command recovery bounds backlog scope and keeps readiness false until the remainder is recovered', t => {
  const f = dispatchFixture(t); const image = interruptedDispatch(f, { phase: 'ABANDONED' });
  const original = f.db.prepare('SELECT * FROM commands WHERE id=?').get(image.id);
  // Legacy interrupted command images, never native work or automatic retries.
  f.db.exec('BEGIN');
  try {
    for (let i=0;i<1000;i++) insert(f.db,'commands',{...original,id:crypto.randomUUID(),idempotency_key:`owned-backlog-${i}`});
    f.db.exec('COMMIT');
  } catch(error){f.db.exec('ROLLBACK');throw error;}
  const authorizations=f.db.prepare('SELECT * FROM media_probe_authorizations').all();f.core.close();
  const recovered=new CoreService({dbPath:path.join(f.directory,'core.sqlite'),assetStorePath:path.join(f.directory,'store')});
  try {
    const batches=recovered.db.prepare("SELECT * FROM commands WHERE command_type='PREPARED_RECONCILE_MEDIA_PROBE_COMMANDS_V1'").all();
    assert.equal(batches.length,10);
    for(const command of batches){assert.equal(JSON.parse(command.payload_json).command_ids.length,100);assert.equal(command.status,'SUCCEEDED');}
    assert.equal(recovered.db.prepare("SELECT COUNT(*) AS n FROM commands WHERE command_type='PREPARED_DISPATCH_MEDIA_PROBE_V1' AND status='EXECUTING'").get().n,1);
    assert.throws(()=>recovered.prepareMediaProbeAttempt(f.request),{code:'PROBE_RECOVERY_REQUIRED'});
    assert.deepEqual(recovered.reconcileMediaProbeDispatchCommands(),{recovered_commands:1,changed_jobs:0,retained_staging:0,batches:1,ready:true});
    assert.deepEqual(recovered.db.prepare('SELECT * FROM media_probe_authorizations').all(),authorizations);
    assert.equal(recovered.db.prepare('SELECT COUNT(*) AS n FROM media_probe_attempts').get().n,1);
    assert.equal(recovered.db.prepare('SELECT COUNT(*) AS n FROM media_probe_evidence').get().n,0);
  } finally{recovered.close();}
});

test('private Core dispatcher rejects injected fields and stale identities before journaling', { skip: process.platform !== 'win32' }, async t => {
  const f = dispatchFixture(t); const before = reservationSnapshot(f);
  for (const field of ['descriptor', 'argv', 'source_path', 'signal', 'producer', 'trustContext']) {
    await assert.rejects(f.core.dispatchMediaProbeAttempt({ ...f.dispatchRequest, [field]: 'private-secret' }), { code: 'INVALID_ARGUMENT' });
  }
  await assert.rejects(f.core.dispatchMediaProbeAttempt({ ...f.dispatchRequest, expected_version: 1 }), { code: 'STALE_REVISION' });
  await assert.rejects(f.core.dispatchMediaProbeAttempt({ ...f.dispatchRequest, attempt_id: crypto.randomUUID() }), { code: 'PROBE_DISPATCH_STALE' });
  const response = f.core.handle({ api_version: '1', request_id: 'no-dispatch-rpc', method: 'dispatchMediaProbeAttempt', params: f.dispatchRequest });
  assert.equal(response.ok, false); assert.deepEqual(reservationSnapshot(f), before);
});

test('private Core dispatcher requires a current startup broker descriptor', { skip: process.platform !== 'win32' }, async t => {
  const f = dispatchFixture(t); const before = reservationSnapshot(f);
  f.descriptor.core_epoch = crypto.randomUUID();
  await assert.rejects(f.core.dispatchMediaProbeAttempt(f.dispatchRequest), { code: 'PROBE_BROKER_SESSION_MISMATCH' });
  f.descriptor.core_epoch = f.core.instanceEpoch; f.descriptor.key = Buffer.alloc(31);
  await assert.rejects(f.core.dispatchMediaProbeAttempt(f.dispatchRequest), { code: 'PROBE_BROKER_DESCRIPTOR_INVALID' });
  assert.deepEqual(reservationSnapshot(f), before);
});

test('private Core dispatcher rechecks signed authority and exact managed location', { skip: process.platform !== 'win32' }, async t => {
  const f = dispatchFixture(t); f.control.revoked = true;
  let before = reservationSnapshot(f);
  await assert.rejects(f.core.dispatchMediaProbeAttempt(f.dispatchRequest), { code: 'PROBE_ATTESTATION_REVOKED' });
  assert.deepEqual(reservationSnapshot(f), before);
  f.control.revoked = false;
  f.db.prepare("UPDATE storage_object_locations SET relative_path='escape/fixture' WHERE id=?").run(f.location.id);
  before = reservationSnapshot(f);
  await assert.rejects(f.core.dispatchMediaProbeAttempt(f.dispatchRequest), { code: 'PROBE_SOURCE_STALE' });
  assert.deepEqual(reservationSnapshot(f), before);
});

test('private Core dispatcher journals transport failure as UNKNOWN and never redispatches replay', { skip: process.platform !== 'win32' }, async t => {
  const f = dispatchFixture(t);
  const receipt = await f.core.dispatchMediaProbeAttempt(f.dispatchRequest);
  assert.equal(receipt.state, 'UNKNOWN'); assert.equal(receipt.execution_started, false); assert.equal(receipt.physical_tree, 'UNKNOWN');
  assert.equal(f.db.prepare('SELECT state FROM media_probe_attempts WHERE id=?').get(receipt.attempt_id).state, 'ABANDONED');
  const job = f.db.prepare('SELECT * FROM media_probe_jobs WHERE id=?').get(f.job.id);
  assert.equal(job.state, 'UNKNOWN'); assert.equal(job.current_attempt_id, null); assert.equal(job.fencing_token, null); assert.equal(job.needs_user, 1);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM media_probe_evidence').get().n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM technical_metadata').get().n, 0);
  const before = reservationSnapshot(f);
  assert.deepEqual(await f.core.dispatchMediaProbeAttempt(f.dispatchRequest), receipt);
  assert.deepEqual(reservationSnapshot(f), before);
  await assert.rejects(f.core.dispatchMediaProbeAttempt({ ...f.dispatchRequest, expected_version: 7 }), { code: 'IDEMPOTENCY_KEY_REUSE_CONFLICT' });
  const command = f.db.prepare("SELECT payload_json,result_json FROM commands WHERE command_type='PREPARED_DISPATCH_MEDIA_PROBE_V1'").get();
  assert.equal(JSON.stringify(command).includes(f.directory), false); assert.equal(JSON.stringify(command).includes(f.descriptor.pipe_name), false);
});

test('private Core dispatcher rolls back a failed initial audit without consuming the reservation', { skip: process.platform !== 'win32' }, async t => {
  const f = dispatchFixture(t);
  f.db.exec("CREATE TRIGGER fixture_dispatch_audit_failure BEFORE INSERT ON audit_records WHEN NEW.action_type='media_probe.dispatch_dispatching' BEGIN SELECT RAISE(ABORT,'fixture dispatch audit failure'); END;");
  const before = reservationSnapshot(f);
  await assert.rejects(f.core.dispatchMediaProbeAttempt(f.dispatchRequest), /fixture dispatch audit failure/);
  assert.deepEqual(reservationSnapshot(f), before);
});

test('private Core dispatcher estimates binary and source copy storage before consuming reservation', { skip: process.platform !== 'win32' }, async t => {
  const f = dispatchFixture(t); const before = reservationSnapshot(f);
  const statfs = fs.statfsSync;
  // Enough for the source/output allowance alone, but not the verified binary.
  const base = BigInt(f.job.source_byte_size) + 8388608n + 1048576n + 16777216n;
  fs.statfsSync = () => ({ bavail: base, bsize: 1n });
  try {
    await assert.rejects(f.core.dispatchMediaProbeAttempt(f.dispatchRequest), { code: 'PROBE_STORAGE_INSUFFICIENT' });
  } finally { fs.statfsSync = statfs; }
  assert.deepEqual(reservationSnapshot(f), before);
});
const reservationTables = ['media_probe_authorizations', 'media_probe_attempts', 'media_probe_evidence', 'technical_metadata',
  'commands', 'command_impacts', 'domain_events', 'audit_records', 'media_probe_jobs'];
function reservationSnapshot(f) {
  return Object.fromEntries(reservationTables.map(table => [table, f.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}
function reservationRejected(f, code, request = f.request) {
  const before = reservationSnapshot(f);
  assert.throws(() => f.core.prepareMediaProbeAttempt(request), error => error.code === code, code);
  assert.deepEqual(reservationSnapshot(f), before, 'A failed reservation must leave every row unchanged');
}

test('Core reserves exact certificate/owner/fence atomically with audit and redacted idempotent receipt', t => {
  const f = reservationFixture(t);
  const before = reservationSnapshot(f);
  const receipt = f.core.prepareMediaProbeAttempt(f.request);
  assert.equal(receipt.contract, 'PREPARED_MEDIA_PROBE_AUTHORIZATION_V1');
  assert.equal(receipt.execution_started, false); assert.equal(receipt.state, 'PREPARED'); assert.equal(receipt.job_version, 2);
  const authorization = f.db.prepare('SELECT * FROM media_probe_authorizations').get();
  const attempt = f.db.prepare('SELECT * FROM media_probe_attempts').get();
  const job = f.db.prepare('SELECT * FROM media_probe_jobs').get();
  assert.equal(authorization.attempt_id, attempt.id); assert.equal(attempt.id, receipt.attempt_id);
  assert.equal(authorization.core_owner_epoch, f.core.instanceEpoch); assert.equal(attempt.core_owner_epoch, f.core.instanceEpoch);
  assert.match(authorization.fencing_token, /^[0-9a-f]{64}$/); assert.equal(attempt.fencing_token, authorization.fencing_token);
  assert.equal(job.fencing_token, attempt.fencing_token); assert.equal(job.current_attempt_id, attempt.id);
  assert.equal(attempt.state, 'CREATED'); assert.equal(attempt.output_envelope_hash, null); assert.equal(attempt.stdout_bytes, null);
  assert.equal(attempt.worker_instance_id, null); assert.equal(job.state, 'CLAIMED');
  assert.equal(authorization.source_content_hash, f.job.source_content_hash);
  assert.equal(authorization.toolchain_binary_hash, f.job.toolchain_binary_hash); assert.equal(authorization.policy_epoch, 8);
  const after = reservationSnapshot(f);
  for (const table of ['commands', 'command_impacts', 'domain_events', 'audit_records']) assert.equal(after[table].length, before[table].length + 1, table);
  assert.equal(after.media_probe_evidence.length, 0); assert.equal(after.technical_metadata.length, 0);
  const journal = f.db.prepare("SELECT * FROM commands WHERE command_type='PREPARED_AUTHORIZE_MEDIA_PROBE_V1'").get();
  assert.equal(journal.status, 'SUCCEEDED'); assert.equal(journal.schema_version, 1);
  assert.deepEqual(JSON.parse(journal.result_json), receipt);
  const projected = JSON.stringify({ receipt, command: journal, event: after.domain_events.at(-1), audit: after.audit_records.at(-1) });
  for (const privateValue of [f.toolRoot, 'signature_hex', 'public_key_spki_base64', authorization.fencing_token, f.core.instanceEpoch]) {
    assert.ok(!projected.includes(privateValue), privateValue);
  }
  assert.equal(Object.hasOwn(f.core, 'mediaProbeTrustSource'), false);
  assert.deepEqual(f.core.prepareMediaProbeAttempt(f.request), receipt);
  assert.deepEqual(reservationSnapshot(f), after); assert.equal(f.control.loads, 2);
  const view = f.core._mediaProbeProjection(job.id, job.project_id);
  assert.equal(view.outcome, 'UNKNOWN'); assert.equal(view.metadata, null); assert.equal(view.execution_started, false);
  reservationRejected(f, 'IDEMPOTENCY_KEY_REUSE_CONFLICT', { ...f.request, expected_version: 2 });
});

for (const [name, change, code] of [
  ['missing startup authority', (_c, o) => { o.coreOptions.mediaProbeTrustSource = null; }, 'PROBE_AUTHORITY_UNAVAILABLE'],
  ['private loader error', c => { c.throwOnLoad = true; }, 'PROBE_AUTHORITY_UNAVAILABLE'],
  ['bad signed envelope', c => { c.invalidSignature = true; }, 'PROBE_ATTESTATION_SIGNATURE_REJECTED'],
  ['revoked pack', c => { c.revoked = true; }, 'PROBE_ATTESTATION_REVOKED'],
  ['expired pack', c => { c.now = c.statement.expires_at_utc_ms; }, 'PROBE_ATTESTATION_WINDOW_REJECTED'],
  ['untrusted clock', c => { c.context.timeHealth = 'UNKNOWN'; }, 'PROBE_ATTESTATION_TIME_UNTRUSTED'],
  ['stale revocation context', c => { c.context.trustFreshness = 'STALE'; }, 'PROBE_ATTESTATION_TRUST_STALE'],
  ['missing external epoch floor', c => { delete c.context.minimumPolicyEpoch; }, 'PROBE_TRUST_CONTEXT_INVALID'],
  ['string epoch floor', c => { c.context.minimumPolicyEpoch = '1'; }, 'PROBE_TRUST_CONTEXT_INVALID'],
  ['unsafe microsecond conversion', c => { c.statement.expires_at_utc_ms = Number.MAX_SAFE_INTEGER;
    c.policy.expires_at_utc_ms = Number.MAX_SAFE_INTEGER; c.policy.keys[0].expires_at_utc_ms = Number.MAX_SAFE_INTEGER; }, 'PROBE_AUTHORITY_CLOCK_INVALID'],
  ['mismatched job binary', (_c, o) => { o.probePins.toolchain_binary_hash = '0'.repeat(64); }, 'PROBE_TOOLCHAIN_STALE'],
]) test(`Core reservation rejects ${name} without mutation`, t => {
  const f = reservationFixture(t, change); reservationRejected(f, code);
});

test('Core reservation refuses request authority/path injection and cannot be invoked through handle', t => {
  const f = reservationFixture(t);
  for (const field of ['trustContext', 'artifact', 'argv', 'source_path', 'fencing_token']) {
    reservationRejected(f, 'INVALID_ARGUMENT', { ...f.request, [field]: 'private-fixture-secret' });
  }
  reservationRejected(f, 'INVALID_ARGUMENT', { ...f.request, idempotency_key: 'reserve-1\n' });
  const before = reservationSnapshot(f);
  const response = f.core.handle({ api_version: '1', request_id: 'forbidden', method: 'prepareMediaProbeAttempt', params: f.request });
  assert.equal(response.ok, false); assert.deepEqual(reservationSnapshot(f), before); assert.equal(f.control.loads, 0);
  const blocked = f.core.handle({ api_version: '1', request_id: 'public-blocked', method: 'command.execute', params: {
    command_type: 'ProbeMediaAsset', expected_versions: { ASSET: 1 }, idempotency_key: 'public-blocked', payload: {
    project_id: f.job.project_id, asset_revision_id: f.job.asset_revision_id,
    content_hash: f.job.source_content_hash, byte_size: f.job.source_byte_size, toolchain_manifest_hash: f.job.toolchain_manifest_hash,
    probe_schema_version: f.job.probe_schema_version, parser_policy_version: f.job.parser_policy_version } } });
  assert.equal(blocked.ok, true); assert.equal(blocked.result.job.state, 'BLOCKED_TOOLCHAIN');
  reservationRejected(f, 'PROBE_RESERVATION_NOT_AVAILABLE', { ...f.request, job_id: blocked.result.job.id, idempotency_key: 'blocked-reservation' });
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM media_probe_authorizations').get().n, 0);
  assert.equal(f.control.loads, 0);
});

test('Core reservation rejects stale version, scope, source location and consent', t => {
  const f = reservationFixture(t);
  reservationRejected(f, 'STALE_REVISION', { ...f.request, expected_version: 2 });
  const other = command(f.core, 'CreateProject', { code: 'other-reservation', title: 'Khác' }, 'other-reservation');
  assert.equal(other.ok, true);
  reservationRejected(f, 'ENTITY_SCOPE_MISMATCH', { ...f.request, project_id: other.result.id });
  f.db.prepare("UPDATE storage_object_locations SET state='MISSING' WHERE id=?").run(f.location.id);
  reservationRejected(f, 'PROBE_SOURCE_STALE');
  f.db.prepare("UPDATE storage_object_locations SET state='AVAILABLE' WHERE id=?").run(f.location.id);
  const rightsId = f.db.prepare('SELECT rights_identity_id FROM assets WHERE id=?').get(f.core._mediaProbeSource(f.job.project_id, f.job.asset_revision_id).asset_id).rights_identity_id;
  assert.equal(command(f.core, 'RevokeRights', { rights_identity_id: rightsId, right_type: 'SOURCE_USE', reason: 'fixture revoked' }, 'revoke-reservation').ok, true);
  reservationRejected(f, 'PROBE_RIGHTS_BLOCKED');
});

test('Core reservation rolls back all journals if final audit fails', t => {
  const f = reservationFixture(t);
  f.db.exec("CREATE TRIGGER fixture_audit_failure BEFORE INSERT ON audit_records WHEN NEW.action_type='media_probe.prepare_attempt' BEGIN SELECT RAISE(ABORT,'fixture injected audit failure'); END;");
  const before = reservationSnapshot(f);
  assert.throws(() => f.core.prepareMediaProbeAttempt(f.request), /fixture injected audit failure/);
  assert.deepEqual(reservationSnapshot(f), before);
});

test('Core reservation observes current allowed rights generation and active project', t => {
  const f = reservationFixture(t);
  const source = f.core._mediaProbeSource(f.job.project_id, f.job.asset_revision_id);
  const rightsId = f.db.prepare('SELECT rights_identity_id FROM assets WHERE id=?').get(source.asset_id).rights_identity_id;
  assert.equal(command(f.core, 'RecordConsent', { rights_identity_id: rightsId, consent_type: 'SOURCE_USE', granted_by: 'second-fixture-owner' }, 'extra-consent').ok, true);
  assert.equal(f.core._mediaProbeRights(source.asset_id).eligible, true);
  reservationRejected(f, 'PROBE_RIGHTS_STALE');
  f.db.prepare("UPDATE projects SET lifecycle_state='PAUSED',row_version=row_version+1 WHERE id=?").run(f.job.project_id);
  reservationRejected(f, 'PROJECT_NOT_WRITABLE');
});

test('Core reservation rechecks startup artifact bytes and fences a changed job version on replay', t => {
  const f = reservationFixture(t);
  const file = f.manifest.binaries.ffprobe.path;
  const bytes = fs.readFileSync(file);
  fs.writeFileSync(file, Buffer.alloc(bytes.length, 120));
  reservationRejected(f, 'PROBE_ATTESTATION_ARTIFACT_MISMATCH');
  fs.writeFileSync(file, bytes);
  f.core.prepareMediaProbeAttempt(f.request);
  f.db.prepare('UPDATE media_probe_jobs SET row_version=row_version+1 WHERE id=?').run(f.job.id);
  reservationRejected(f, 'PROBE_RESERVATION_STALE');
});

test('Core reservation replay rechecks expiry, revocation and advanced attempt', t => {
  const f = reservationFixture(t);
  const receipt = f.core.prepareMediaProbeAttempt(f.request);
  f.control.now = f.control.statement.expires_at_utc_ms;
  reservationRejected(f, 'PROBE_ATTESTATION_WINDOW_REJECTED');
  f.control.now = Date.now(); f.control.revoked = true;
  reservationRejected(f, 'PROBE_ATTESTATION_REVOKED');
  f.control.revoked = false;
  f.db.prepare("UPDATE media_probe_attempts SET state='DISPATCHING',row_version=row_version+1 WHERE id=?").run(receipt.attempt_id);
  reservationRejected(f, 'PROBE_RESERVATION_STALE');
});

test('Core reservation history prevents policy and same-key pack epoch rollback', t => {
  const f = reservationFixture(t);
  f.core.prepareMediaProbeAttempt(f.request);
  const second = { ...f.job, id: 'probe-job-second', idempotency_key: 'probe-second', canonical_request_hash: '7'.repeat(64) };
  insert(f.db, 'media_probe_jobs', second);
  const request = { ...f.request, job_id: second.id, idempotency_key: 'reserve-second' };
  f.control.policy.policy_epoch = 7;
  reservationRejected(f, 'PROBE_TRUST_POLICY_ROLLBACK', request);
  f.control.policy.policy_epoch = 8; f.control.statement.certification_epoch = 4;
  reservationRejected(f, 'PROBE_ATTESTATION_PACK_ROLLBACK', request);
  f.control.statement.certification_epoch = 5;
  const receipt = f.core.prepareMediaProbeAttempt(request);
  assert.notEqual(receipt.attempt_id, f.db.prepare("SELECT current_attempt_id FROM media_probe_jobs WHERE id='probe-job'").get().current_attempt_id);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM media_probe_authorizations').get().n, 2);
});

test('a restarted Core cannot replay an old prepared reservation', t => {
  const f = reservationFixture(t);
  const oldEpoch = f.core.instanceEpoch;
  f.core.prepareMediaProbeAttempt(f.request); f.core.close();
  const reopened = new CoreService({ dbPath: path.join(f.directory, 'core.sqlite'), assetStorePath: path.join(f.directory, 'store'), ...f.options.coreOptions });
  try {
    assert.notEqual(reopened.instanceEpoch, oldEpoch);
    reservationRejected({ ...f, core: reopened, db: reopened.db }, 'PROBE_RESERVATION_STALE');
  } finally { reopened.close(); }
});

test('lost Core ownership prevents reservation and a post-proof race rolls back', t => {
  const f = reservationFixture(t);
  f.control.onLoad = () => f.db.prepare("UPDATE media_probe_jobs SET state='CANCEL_REQUESTED',row_version=row_version+1 WHERE id=?").run(f.job.id);
  reservationRejected(f, 'PROBE_RESERVATION_STALE');
  f.control.onLoad = undefined;
  f.db.prepare("UPDATE core_instance_ownership SET active_epoch='fixture-lost-owner' WHERE singleton_id=1").run();
  reservationRejected(f, 'CORE_OWNERSHIP_LOST');
});

for (const phase of ['CREATED', 'DISPATCHING', 'EXECUTING', 'PARSING', 'VERIFYING']) {
  test(`startup retires the foreign ${phase} attempt with UNKNOWN and immutable history`, t => {
    const f = reservationFixture(t);
    const receipt = f.core.prepareMediaProbeAttempt(f.request);
    f.db.prepare('UPDATE media_probe_attempts SET state=?,row_version=row_version+1 WHERE id=?').run(phase, receipt.attempt_id);
    const jobState = phase === 'EXECUTING' ? 'RUNNING' : ['PARSING', 'VERIFYING'].includes(phase) ? phase : 'CLAIMED';
    f.db.prepare('UPDATE media_probe_jobs SET state=?,row_version=row_version+1 WHERE id=?').run(jobState, f.job.id);
    // Privileged historical fixture only; retirement must not relabel it.
    if (phase === 'VERIFYING') insert(f.db, 'media_probe_evidence', proof(f, { attempt_id: receipt.attempt_id,
      validated_at_utc_us: f.control.now * 1000 }));
    const original = f.db.prepare('SELECT * FROM media_probe_attempts').get();
    const history = f.db.prepare('SELECT * FROM media_probe_authorizations').all();
    const evidence = f.db.prepare('SELECT * FROM media_probe_evidence').all();
    const bytes = fs.readFileSync(path.join(f.directory, 'source.txt'));
    const loads = f.control.loads;
    f.core.close();
    const reopened = new CoreService({ dbPath: path.join(f.directory, 'core.sqlite'), assetStorePath: path.join(f.directory, 'store'), ...f.options.coreOptions });
    try {
      const next = reopened.db.prepare('SELECT * FROM media_probe_attempts').get();
      assert.equal(next.state, 'ABANDONED'); assert.equal(next.row_version, original.row_version + 1);
      for (const field of ['id', 'job_id', 'attempt_no', 'core_owner_epoch', 'authorization_id', 'fencing_token',
        'producer_contract_version', 'argv_preset_id', 'stdout_bytes', 'stderr_bytes', 'cpu_time_ms', 'memory_peak_bytes']) {
        assert.equal(next[field], original[field], field);
      }
      const job = reopened.db.prepare('SELECT * FROM media_probe_jobs').get();
      assert.equal(job.state, 'UNKNOWN'); assert.equal(job.needs_user, 1);
      assert.equal(job.current_attempt_id, null); assert.equal(job.fencing_token, null); assert.ok(job.next_step.includes('chưa xác nhận'));
      assert.deepEqual(reopened.db.prepare('SELECT * FROM media_probe_authorizations').all(), history);
      assert.deepEqual(reopened.db.prepare('SELECT * FROM media_probe_evidence').all(), evidence);
      assert.ok(fs.readFileSync(path.join(f.directory, 'source.txt')).equals(bytes)); assert.equal(f.control.loads, loads);
      assert.equal(reopened.db.prepare('SELECT count(*) AS n FROM technical_metadata').get().n, 0);
      const cmd = reopened.db.prepare("SELECT * FROM commands WHERE command_type='PREPARED_RECONCILE_MEDIA_PROBE_V1'").get();
      assert.equal(cmd.status, 'SUCCEEDED'); assert.equal(cmd.schema_version, 1);
      assert.deepEqual(JSON.parse(cmd.payload_json), { attempt_ids: [receipt.attempt_id], logical_only: true });
      assert.equal(JSON.parse(cmd.result_json).physical_teardown, 'UNKNOWN');
      const audit = reopened.db.prepare("SELECT * FROM audit_records WHERE action_type='media_probe.reconcile_attempts'").get();
      assert.equal(audit.command_id, cmd.id);
      const events = reopened.db.prepare('SELECT * FROM domain_events WHERE command_id=? ORDER BY seq').all(cmd.id);
      assert.deepEqual(events.map(e => e.event_type), ['MEDIA_PROBE_ATTEMPT_ABANDONED', 'MEDIA_PROBE_JOB_RECOVERY_UNKNOWN']);
      for (const event of events) assert.equal(JSON.parse(event.payload_json).project_id, f.job.project_id);
      const recovered = { ...f, core: reopened, db: reopened.db };
      const after = reservationSnapshot(recovered);
      assert.deepEqual(reopened.reconcileMediaProbeAttempts(), { reconciled_attempts: 0, changed_jobs: 0, batches: 0, ready: true });
      assert.deepEqual(reservationSnapshot(recovered), after);
      assert.throws(() => insert(reopened.db, 'media_probe_evidence', proof(recovered, { id: 'stale-pass', attempt_id: receipt.attempt_id,
        validated_at_utc_us: f.control.now * 1000 })), /pins|proof|authorization/);
      reservationRejected(recovered, 'PROBE_RESERVATION_STALE');
    } finally { reopened.close(); }
  });
}

test('startup does not confirm a pending physical cancellation or retry it', t => {
  const f = reservationFixture(t);
  const receipt = f.core.prepareMediaProbeAttempt(f.request);
  f.db.prepare("UPDATE media_probe_attempts SET state='EXECUTING',row_version=row_version+1 WHERE id=?").run(receipt.attempt_id);
  f.db.prepare("UPDATE media_probe_jobs SET state='CANCEL_REQUESTED',row_version=row_version+1 WHERE id=?").run(f.job.id);
  f.core.close();
  const reopened = new CoreService({ dbPath: path.join(f.directory, 'core.sqlite'), assetStorePath: path.join(f.directory, 'store') });
  try {
    assert.equal(reopened.db.prepare('SELECT state FROM media_probe_jobs').get().state, 'UNKNOWN');
    assert.equal(reopened.db.prepare('SELECT state FROM media_probe_attempts').get().state, 'ABANDONED');
    assert.equal(reopened.db.prepare('SELECT count(*) AS n FROM media_probe_attempts').get().n, 1);
    assert.equal(reopened.db.prepare('SELECT count(*) AS n FROM media_probe_evidence').get().n, 0);
  } finally { reopened.close(); }
});

test('reconciliation keeps current-owner work and completed measurement unchanged while retiring noncurrent legacy work', () => {
  const f = persistenceFixture();
  try {
    accepted(f); insert(f.db, 'technical_metadata_streams', stream());
    f.db.prepare("UPDATE media_probe_jobs SET state='COMPLETED',row_version=row_version+1").run();
    const tables = ['media_probe_jobs', 'technical_metadata', 'technical_metadata_streams', 'media_probe_evidence', 'media_probe_authorizations'];
    const before = Object.fromEntries(tables.map(table => [table, f.db.prepare(`SELECT * FROM ${table}`).all()]));
    insert(f.db, 'media_probe_attempts', { id: 'legacy-noncurrent', job_id: f.job.id, attempt_no: 2, retry_kind: 'RESTART',
      idempotency_key: 'legacy-noncurrent', state: 'CREATED', created_at_utc_us: f.stamp, updated_at_utc_us: f.stamp });
    assert.deepEqual(f.core.reconcileMediaProbeAttempts(), { reconciled_attempts: 1, changed_jobs: 0, batches: 1, ready: true });
    for (const table of tables) assert.deepEqual(f.db.prepare(`SELECT * FROM ${table}`).all(), before[table], table);
    assert.equal(f.db.prepare("SELECT state FROM media_probe_attempts WHERE id='attempt-1'").get().state, 'SUCCEEDED');
    assert.equal(f.db.prepare("SELECT state FROM media_probe_attempts WHERE id='legacy-noncurrent'").get().state, 'ABANDONED');
  } finally { f.close(); }
});

test('recovery audit failure rolls back the entire batch and blocks reservation until internal recovery succeeds', t => {
  const f = reservationFixture(t);
  const receipt = f.core.prepareMediaProbeAttempt(f.request);
  f.db.exec("CREATE TRIGGER fixture_recovery_audit_failure BEFORE INSERT ON audit_records WHEN NEW.action_type='media_probe.reconcile_attempts' BEGIN SELECT RAISE(ABORT,'fixture recovery audit failure'); END;");
  const before = reservationSnapshot(f);
  f.core.close();
  const reopened = new CoreService({ dbPath: path.join(f.directory, 'core.sqlite'), assetStorePath: path.join(f.directory, 'store'), ...f.options.coreOptions });
  try {
    const recovered = { ...f, core: reopened, db: reopened.db };
    assert.deepEqual(reservationSnapshot(recovered), before);
    reservationRejected(recovered, 'PROBE_RECOVERY_REQUIRED');
    reopened.db.exec('DROP TRIGGER fixture_recovery_audit_failure');
    assert.deepEqual(reopened.reconcileMediaProbeAttempts(), { reconciled_attempts: 1, changed_jobs: 1, batches: 1, ready: true });
    assert.equal(reopened.db.prepare('SELECT state FROM media_probe_attempts WHERE id=?').get(receipt.attempt_id).state, 'ABANDONED');
    reservationRejected(recovered, 'PROBE_RESERVATION_STALE');
  } finally { reopened.close(); }
});

test('recovery bounds each command and invocation, blocks backlog admission and resumes without touching live work', t => {
  const f = reservationFixture(t);
  const live = f.core.prepareMediaProbeAttempt(f.request);
  for (let j = 0; j < 11; j++) {
    const id = `backlog-job-${j}`;
    insert(f.db, 'media_probe_jobs', { ...f.job, id, idempotency_key: id,
      canonical_request_hash: crypto.createHash('sha256').update(id).digest('hex') });
    for (let n = 1; n <= (j === 10 ? 10 : 100); n++) {
      insert(f.db, 'media_probe_attempts', { id: `backlog-${j}-${n}`, job_id: id, attempt_no: n, retry_kind: 'RESTART',
        idempotency_key: `backlog-${j}-${n}`, state: 'CREATED', created_at_utc_us: f.stamp, updated_at_utc_us: f.stamp });
    }
  }
  const first = f.core.reconcileMediaProbeAttempts();
  assert.deepEqual(first, { reconciled_attempts: 1000, changed_jobs: 11, batches: 10, ready: false });
  reservationRejected(f, 'PROBE_RECOVERY_REQUIRED');
  assert.equal(f.db.prepare('SELECT state FROM media_probe_attempts WHERE id=?').get(live.attempt_id).state, 'CREATED');
  const commands = f.db.prepare("SELECT payload_json,result_json FROM commands WHERE command_type='PREPARED_RECONCILE_MEDIA_PROBE_V1'").all();
  assert.equal(commands.length, 10);
  const retired = new Set();
  for (const command of commands) {
    const scope = JSON.parse(command.payload_json); assert.equal(scope.attempt_ids.length, 100);
    assert.equal(scope.logical_only, true); assert.equal(JSON.parse(command.result_json).physical_teardown, 'UNKNOWN');
    for (const id of scope.attempt_ids) { assert.ok(!retired.has(id)); retired.add(id); }
  }
  assert.equal(retired.size, 1000);
  const last = f.core.reconcileMediaProbeAttempts();
  assert.deepEqual(last, { reconciled_attempts: 10, changed_jobs: 0, batches: 1, ready: true });
  assert.deepEqual(f.core.prepareMediaProbeAttempt(f.request), live);
  const before = reservationSnapshot(f);
  const response = f.core.handle({ api_version: '1', request_id: 'recovery-rpc', method: 'reconcileMediaProbeAttempts', params: {} });
  assert.equal(response.ok, false); assert.deepEqual(reservationSnapshot(f), before);
  assert.throws(() => f.core.reconcileMediaProbeAttempts({ scope: '*' }), e => e.code === 'INVALID_ARGUMENT');
  assert.deepEqual(reservationSnapshot(f), before);
});

test('Core cannot reuse a configured epoch to adopt an old reservation', t => {
  const f = reservationFixture(t, (_control, options) => { options.coreOptions.instanceEpoch = 'fixture-unique-session'; });
  f.core.prepareMediaProbeAttempt(f.request); f.core.close();
  const db = new DatabaseSync(path.join(f.directory, 'core.sqlite'), { readOnly: true });
  try {
    const before = reservationSnapshot({ ...f, db });
    assert.throws(() => new CoreService({ dbPath: path.join(f.directory, 'core.sqlite'), assetStorePath: path.join(f.directory, 'store'),
      ...f.options.coreOptions }), /UNIQUE constraint failed: core_instances.instance_epoch/);
    assert.deepEqual(reservationSnapshot({ ...f, db }), before);
  } finally { db.close(); }
});
