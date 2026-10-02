import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MEDIA_PROBE_LIMITS,
  MediaProbeParseError,
  parseMediaProbeJson,
} from './media-probe.mjs';

function fixture() {
  return {
    format: {
      format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
      duration: '10.010000',
      size: '1234567',
      bit_rate: '986667',
      nb_streams: 2,
    },
    streams: [
      {
        index: 0,
        codec_type: 'video',
        codec_name: 'h264',
        width: 1920,
        height: 1080,
        pix_fmt: 'yuv420p',
        bits_per_raw_sample: '8',
        r_frame_rate: '30000/1001',
        avg_frame_rate: '30000/1001',
        time_base: '1/30000',
        duration: '10.010000',
        nb_frames: '300',
        color_primaries: 'bt709',
        color_transfer: 'bt709',
        color_space: 'bt709',
        disposition: { default: 1, forced: 0 },
      },
      {
        index: 1,
        codec_type: 'audio',
        codec_name: 'aac',
        sample_rate: '48000',
        channels: 2,
        channel_layout: 'stereo',
        bits_per_sample: 16,
        time_base: '1/48000',
        duration: '10.010000',
        disposition: { default: 1 },
      },
    ],
  };
}

function json(value) { return JSON.stringify(value); }
function expectCode(fn, code) {
  assert.throws(fn, (error) => error instanceof MediaProbeParseError && error.code === code, code);
}

test('accepts the fixed bounded video/audio profile and preserves exact rationals', () => {
  const parsed = parseMediaProbeJson(Buffer.from(json(fixture()), 'utf8'));
  assert.equal(parsed.schema_version, 'MEDIA_PROBE_V1');
  assert.equal(parsed.parser_policy_version, 'MEDIA_PROBE_PARSER_V1');
  assert.deepEqual(parsed.duration, { num: 1001, den: 100 });
  assert.deepEqual(parsed.streams[0].frame_rate, { num: 30000, den: 1001 });
  assert.deepEqual(parsed.streams[0].time_base, { num: 1, den: 30000 });
  assert.equal(parsed.streams[0].frame_count, 300);
  assert.equal(parsed.streams[1].sample_rate, 48000);
});

test('returns deeply immutable validated metadata so callers cannot mutate evidence after parsing', () => {
  const parsed = parseMediaProbeJson(json(fixture()));
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.duration), true);
  assert.equal(Object.isFrozen(parsed.streams), true);
  assert.equal(Object.isFrozen(parsed.streams[0]), true);
  assert.equal(Object.isFrozen(parsed.streams[0].time_base), true);
  assert.equal(Object.isFrozen(parsed.streams[0].disposition), true);
  assert.throws(() => { parsed.streams[0].width = 1; }, TypeError);
  assert.throws(() => { parsed.streams.push(parsed.streams[0]); }, TypeError);
  assert.equal(parsed.streams[0].width, 1920);
  assert.equal(parsed.streams.length, 2);
});

test('rejects malformed JSON and invalid UTF-8', () => {
  expectCode(() => parseMediaProbeJson('{"format":'), 'JSON_VALUE_INVALID');
  expectCode(() => parseMediaProbeJson(Buffer.from([0x7b, 0xff, 0x7d])), 'JSON_INVALID_UTF8');
});

test('accepts only RFC 8259 JSON whitespace and rejects Unicode whitespace', () => {
  const standard = ` \t\r\n${json(fixture())}\n\r\t `;
  assert.equal(parseMediaProbeJson(standard).streams.length, 2);
  for (const whitespace of ['\u00a0', '\u1680', '\u2003', '\u2028', '\u2029', '\u3000']) {
    expectCode(() => parseMediaProbeJson(`${whitespace}${json(fixture())}`), 'JSON_VALUE_INVALID');
  }
});

test('rejects duplicate and unsafe object keys before schema validation', () => {
  expectCode(() => parseMediaProbeJson('{"format":{},"format":{},"streams":[]}'), 'JSON_DUPLICATE_KEY');
  expectCode(() => parseMediaProbeJson('{"__proto__":{},"format":{},"streams":[]}'), 'JSON_UNSAFE_KEY');
});

test('rejects unknown profile fields instead of accepting ffprobe drift', () => {
  const value = fixture();
  value.unexpected = true;
  expectCode(() => parseMediaProbeJson(json(value)), 'PROBE_UNKNOWN_FIELD');
  delete value.unexpected;
  value.streams[0].profile = 'High';
  expectCode(() => parseMediaProbeJson(json(value)), 'STREAM_UNKNOWN_FIELD');
});

test('rejects fields that belong to a different stream kind', () => {
  const audio = fixture();
  audio.streams[1].width = 1920;
  expectCode(() => parseMediaProbeJson(json(audio)), 'STREAM_KIND_FIELD_INVALID');

  const video = fixture();
  video.streams[0].channels = 2;
  expectCode(() => parseMediaProbeJson(json(video)), 'STREAM_KIND_FIELD_INVALID');

  const subtitle = fixture();
  subtitle.streams = [{
    index: 2,
    codec_type: 'subtitle',
    codec_name: 'subrip',
    time_base: '1/1000',
    duration: '10.010000',
    sample_rate: '48000',
  }];
  subtitle.format.nb_streams = 1;
  expectCode(() => parseMediaProbeJson(json(subtitle)), 'STREAM_KIND_FIELD_INVALID');
});

test('rejects byte, depth, node, string and array resource bombs', () => {
  expectCode(() => parseMediaProbeJson(json(fixture()), { limits: { maxBytes: 16 } }), 'JSON_TOO_LARGE');
  const deep = '{"a":'.repeat(5) + '1' + '}'.repeat(5);
  expectCode(() => parseMediaProbeJson(deep, { limits: { maxDepth: 2 } }), 'JSON_TOO_DEEP');
  expectCode(() => parseMediaProbeJson('[1,2,3]', { limits: { maxNodes: 2 } }), 'JSON_TOO_MANY_NODES');
  expectCode(() => parseMediaProbeJson(JSON.stringify('x'.repeat(20)), { limits: { maxStringBytes: 8 } }), 'JSON_STRING_TOO_LARGE');
  expectCode(() => parseMediaProbeJson('[1,2,3]', { limits: { maxArrayEntries: 2 } }), 'JSON_ARRAY_TOO_LARGE');
});

test('rejects non-finite JSON numbers', () => {
  expectCode(() => parseMediaProbeJson('{"format":{"format_name":"mp4","duration":"1","size":1e9999},"streams":[{}]}'), 'JSON_NUMBER_NONFINITE');
});

test('rejects zero, negative and overflowing rational components before reduction', () => {
  for (const rate of ['30000/0', '0/1001', '2147483648/1', '4294967294/2', '2/4294967294']) {
    const value = fixture();
    value.streams[0].avg_frame_rate = rate;
    const code = rate === '30000/0' ? 'RATIONAL_ZERO_DENOMINATOR'
      : rate === '0/1001' ? 'RATIONAL_INVALID'
        : 'RATIONAL_OVERFLOW';
    expectCode(() => parseMediaProbeJson(json(value)), code);
  }
  const value = fixture();
  value.streams[0].time_base = '-1/90000';
  expectCode(() => parseMediaProbeJson(json(value)), 'RATIONAL_INVALID');
});

test('rejects invalid dimensions, sample rates and channel counts', () => {
  const badWidth = fixture(); badWidth.streams[0].width = -1;
  expectCode(() => parseMediaProbeJson(json(badWidth)), 'INTEGER_INVALID');
  const badRate = fixture(); badRate.streams[1].sample_rate = '999999999';
  expectCode(() => parseMediaProbeJson(json(badRate)), 'INTEGER_INVALID');
  const badChannels = fixture(); badChannels.streams[1].channels = 0;
  expectCode(() => parseMediaProbeJson(json(badChannels)), 'INTEGER_INVALID');
});

test('rejects unsafe data/attachment streams and attached-picture dispositions', () => {
  for (const kind of ['attachment', 'data']) {
    const value = fixture();
    value.streams[0].codec_type = kind;
    expectCode(() => parseMediaProbeJson(json(value)), 'STREAM_KIND_UNSAFE');
  }
  const picture = fixture(); picture.streams[0].disposition.attached_pic = 1;
  expectCode(() => parseMediaProbeJson(json(picture)), 'STREAM_ATTACHMENT_UNSAFE');
});

test('rejects duplicate stream indexes and declared stream-count conflicts', () => {
  const duplicate = fixture(); duplicate.streams[1].index = 0;
  expectCode(() => parseMediaProbeJson(json(duplicate)), 'STREAM_INDEX_DUPLICATE');
  const count = fixture(); count.format.nb_streams = 1;
  expectCode(() => parseMediaProbeJson(json(count)), 'STREAM_COUNT_CONFLICT');
});

test('rejects contradictory frame-count and duration evidence', () => {
  const value = fixture();
  value.streams[0].nb_frames = '900';
  expectCode(() => parseMediaProbeJson(json(value)), 'FRAME_DURATION_CONFLICT');
});

test('enforces stream policy limit independently of the JSON array budget', () => {
  const value = fixture();
  value.streams = [value.streams[0], value.streams[1], { ...value.streams[1], index: 2 }];
  value.format.nb_streams = 3;
  expectCode(() => parseMediaProbeJson(json(value), { limits: { maxStreams: 2 } }), 'STREAM_COUNT_EXCEEDED');
});

test('does not allow callers to widen repository hard resource budgets or add limit fields', () => {
  for (const [field, hardMaximum] of Object.entries(MEDIA_PROBE_LIMITS)) {
    expectCode(() => parseMediaProbeJson(json(fixture()), { limits: { [field]: hardMaximum + 1 } }), 'LIMIT_INVALID');
  }
  expectCode(() => parseMediaProbeJson(json(fixture()), { limits: { maxEverything: 1 } }), 'LIMIT_UNKNOWN_FIELD');
});
