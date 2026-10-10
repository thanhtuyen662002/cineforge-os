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
    next_step: 'Chờ kiểm thử', created_at_utc_us: stamp, updated_at_utc_us: stamp, ...options.probePins };
  if (options.withRights) job.rights_generation = core._mediaProbeRights(imported.result.asset.id).generation;
  insert(db, 'media_probe_jobs', job);
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
      assert.equal(f.db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v, 23);
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
