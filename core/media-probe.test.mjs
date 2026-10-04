import test from 'node:test';
import assert from 'node:assert/strict';
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
