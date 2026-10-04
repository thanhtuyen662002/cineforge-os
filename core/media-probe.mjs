import { TextDecoder } from 'node:util';

// PREPARED only: no producer, process, database, rights or PASS authority.
export const MEDIA_PROBE_SCHEMA_VERSION = 'MEDIA_PROBE_V1';
export const MEDIA_PROBE_PARSER_VERSION = 'MEDIA_PROBE_PARSER_V1';
export const MEDIA_PROBE_LIMITS = Object.freeze({
  maxBytes: 8 * 1024 * 1024, maxDepth: 32, maxNodes: 50_000,
  maxStringBytes: 4096, maxStreams: 256, maxArrayEntries: 1024,
});
const MAX_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);
const ENUMS = Object.freeze({
  video: 'h264 hevc av1 vp8 vp9 mpeg4 mpeg2video prores dnxhd ffv1 rawvideo mjpeg png jpeg2000',
  audio: 'aac mp3 opus vorbis flac alac pcm_s16le pcm_s24le pcm_s32le pcm_f32le pcm_f64le pcm_s16be pcm_s24be pcm_s32be ac3 eac3 dts',
  container: 'mov mp4 m4a 3gp 3g2 mj2 matroska webm avi wav flac mp3 ogg mpegts mpeg nut image2 image2pipe aac ac3 eac3',
  pixel: 'yuv420p yuv422p yuv444p yuv420p10le yuv422p10le yuv444p10le yuv420p12le yuv422p12le yuv444p12le yuva420p yuva422p yuva444p nv12 nv21 p010le rgb24 bgr24 rgba bgra argb abgr gbrp gbrp10le gbrp12le gbrap gray gray16le gray16be pal8',
  sample: 'u8 u8p s16 s16p s32 s32p s64 s64p flt fltp dbl dblp',
  layout: 'mono stereo 2.1 3.0 3.0(back) quad quad(side) 4.0 4.1 5.0 5.0(side) 5.1 5.1(side) 6.1 7.1 7.1(wide) 7.1(wide-side) hexagonal octagonal',
  color_range: 'unknown tv pc',
  color_space: 'unknown rgb bt709 fcc bt470bg smpte170m smpte240m ycgco bt2020nc bt2020c smpte2085 chroma-derived-nc chroma-derived-c ictcp',
  color_transfer: 'unknown bt709 gamma22 gamma28 smpte170m smpte240m linear log log_sqrt iec61966-2-4 bt1361e iec61966-2-1 bt2020-10 bt2020-12 smpte2084 smpte428 arib-std-b67',
  color_primaries: 'unknown bt709 bt470m bt470bg smpte170m smpte240m film bt2020 smpte428 smpte431 smpte432 ebu3213',
});
const DISPOSITIONS = new Set(('default dub original comment lyrics karaoke forced '
  + 'hearing_impaired visual_impaired clean_effects attached_pic timed_thumbnails '
  + 'captions descriptions metadata dependent still_image').split(' '));
const COMMON_FIELDS = ['index', 'codec_type', 'codec_name', 'time_base', 'duration_ts', 'duration', 'disposition'];
const VIDEO_FIELDS = [...COMMON_FIELDS, 'r_frame_rate', 'avg_frame_rate', 'nb_frames',
  'width', 'height', 'pix_fmt', 'sample_aspect_ratio', 'color_range', 'color_space',
  'color_transfer', 'color_primaries'];
const AUDIO_FIELDS = [...COMMON_FIELDS, 'sample_rate', 'channels', 'channel_layout', 'sample_fmt'];

class ProbeError extends Error {
  constructor(code, outcome = 'UNKNOWN') { super(code); this.code = code; this.outcome = outcome; }
}
function fail(code, outcome) { throw new ProbeError(code, outcome); }

function policy(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).some(key => key !== 'limits')) fail('PROBE_POLICY_INVALID');
  const overrides = options.limits ?? {};
  if (typeof overrides !== 'object' || Array.isArray(overrides)) fail('PROBE_POLICY_INVALID');
  const limits = { ...MEDIA_PROBE_LIMITS };
  for (const [key, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(limits, key) || !Number.isSafeInteger(value)
      || value < 1 || value > limits[key]) fail('PROBE_POLICY_INVALID');
    limits[key] = value;
  }
  return limits;
}

// JSON.parse alone loses duplicate-key and numeric-lexeme evidence. Inspect
// both before constructing bounded objects. No untrusted property setters.
function decodeJson(bytes, limits) {
  if (!(bytes instanceof Uint8Array)) fail('PROBE_INPUT_INVALID');
  if (bytes.byteLength > limits.maxBytes) fail('PROBE_OUTPUT_LIMIT');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { fail('PROBE_UTF8_INVALID'); }
  let offset = 0;
  let nodes = 0;
  function node() { if (++nodes > limits.maxNodes) fail('PROBE_NODE_LIMIT'); }
  function whitespace() { while (/[\x20\t\r\n]/.test(text[offset] ?? 'x')) offset++; }
  function string() {
    const start = offset++;
    let escaped = false;
    while (offset < text.length) {
      const char = text[offset++];
      if (offset - start > limits.maxStringBytes * 6 + 2) fail('PROBE_STRING_LIMIT');
      if (!escaped && char === '"') {
        let value;
        try { value = JSON.parse(text.slice(start, offset)); }
        catch { fail('PROBE_JSON_INVALID'); }
        for (let i = 0; i < value.length; i++) {
          const point = value.charCodeAt(i);
          if (point >= 0xd800 && point <= 0xdbff) {
            const next = value.charCodeAt(++i);
            if (!(next >= 0xdc00 && next <= 0xdfff)) fail('PROBE_UNICODE_INVALID');
          } else if (point >= 0xdc00 && point <= 0xdfff) fail('PROBE_UNICODE_INVALID');
        }
        if (Buffer.byteLength(value, 'utf8') > limits.maxStringBytes) fail('PROBE_STRING_LIMIT');
        return value;
      }
      if (!escaped && char === '\\') escaped = true;
      else escaped = false;
    }
    fail('PROBE_JSON_INVALID');
  }
  function value(depth) {
    if (depth > limits.maxDepth) fail('PROBE_DEPTH_LIMIT');
    node(); whitespace();
    const char = text[offset];
    if (char === '"') return string();
    if (char === '{') {
      offset++; whitespace();
      const object = Object.create(null);
      const keys = new Set();
      if (text[offset] === '}') { offset++; return object; }
      while (true) {
        if (text[offset] !== '"') fail('PROBE_JSON_INVALID');
        node();
        const key = string();
        if (keys.has(key)) fail('PROBE_DUPLICATE_KEY', 'CONFLICT');
        if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('PROBE_KEY_BLOCKED');
        keys.add(key); whitespace();
        if (text[offset++] !== ':') fail('PROBE_JSON_INVALID');
        object[key] = value(depth + 1); whitespace();
        if (text[offset] === '}') { offset++; return object; }
        if (text[offset++] !== ',') fail('PROBE_JSON_INVALID');
        whitespace();
      }
    }
    if (char === '[') {
      offset++; whitespace();
      const array = [];
      if (text[offset] === ']') { offset++; return array; }
      while (true) {
        if (array.length >= limits.maxArrayEntries) fail('PROBE_ARRAY_LIMIT');
        array.push(value(depth + 1)); whitespace();
        if (text[offset] === ']') { offset++; return array; }
        if (text[offset++] !== ',') fail('PROBE_JSON_INVALID');
        whitespace();
      }
    }
    for (const [token, result] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(token, offset)) { offset += token.length; return result; }
    }
    const number = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
    number.lastIndex = offset;
    const match = number.exec(text);
    if (!match) fail('PROBE_JSON_INVALID');
    const token = match[0];
    if (!Number.isFinite(Number(token))) fail('PROBE_NUMERIC_RANGE');
    if (!/^-?(?:0|[1-9]\d*)$/.test(token)) fail('PROBE_NUMERIC_FORM');
    // Bound before BigInt conversion as well as before safe number conversion.
    if (token.length > 17) fail('PROBE_NUMERIC_RANGE');
    const integer = BigInt(token);
    if (integer > MAX_INTEGER || integer < -MAX_INTEGER) fail('PROBE_NUMERIC_RANGE');
    offset = number.lastIndex;
    return integer === 0n ? 0 : Number(integer);
  }
  const result = value(1); whitespace();
  if (offset !== text.length) fail('PROBE_JSON_INVALID');
  return result;
}

function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('PROBE_SHAPE_INVALID');
  if (Object.keys(value).some(key => !keys.includes(key))) fail('PROBE_FIELD_UNKNOWN');
  return value;
}
function integer(value, min = 1, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('PROBE_NUMERIC_RANGE');
  return value;
}
function unsignedText(value, allowZero = false) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value)) fail('PROBE_NUMERIC_FORM');
  if (value.length > 16) fail('PROBE_NUMERIC_RANGE');
  const result = BigInt(value);
  if (result > MAX_INTEGER || (!allowZero && result === 0n)) fail('PROBE_NUMERIC_RANGE');
  return result;
}
function gcd(a, b) { while (b !== 0n) [a, b] = [b, a % b]; return a; }
function ratio(num, den) {
  if (num <= 0n || den <= 0n) fail('PROBE_RATIONAL_INVALID');
  const common = gcd(num, den);
  return { num: num / common, den: den / common };
}
function rationalText(value, separator = '/') {
  if (typeof value !== 'string') fail('PROBE_RATIONAL_INVALID');
  const parts = value.split(separator);
  if (parts.length !== 2) fail('PROBE_RATIONAL_INVALID');
  return ratio(unsignedText(parts[0]), unsignedText(parts[1]));
}
function decimalTime(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/.test(value)
    || value.length > 26) fail('PROBE_DURATION_INVALID');
  const [whole, fraction = ''] = value.split('.');
  const result = ratio(BigInt(whole + fraction), 10n ** BigInt(fraction.length));
  apiRatio(result);
  return boundedDuration(result);
}
function apiRatio(value) {
  if (value.num > MAX_INTEGER || value.den > MAX_INTEGER) fail('PROBE_NUMERIC_RANGE');
  return { num: Number(value.num), den: Number(value.den) };
}
function greater(a, b) { return a.num * b.den > b.num * a.den; }
function sum(a, b) { return ratio(a.num * b.den + b.num * a.den, a.den * b.den); }
function within(a, b, tolerance) {
  let diff = a.num * b.den - b.num * a.den;
  if (diff < 0n) diff = -diff;
  return diff * tolerance.den <= tolerance.num * a.den * b.den;
}
function boundedDuration(value) {
  if (greater(value, { num: 604800n, den: 1n })) fail('PROBE_DURATION_RANGE');
  return value;
}
function token(value, nullable = false) {
  if (nullable && value === undefined) return null;
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.+,() -]{0,127}$/.test(value)) fail('PROBE_TOKEN_INVALID');
  return value;
}
function enumerated(value, group, nullable = false) {
  const result = token(value, nullable);
  if (result === null) return null;
  if (!ENUMS[group].split(' ').includes(result)) fail('PROBE_TOKEN_UNSUPPORTED');
  return result;
}
function disposition(value) {
  if (value === undefined) return null;
  object(value, [...DISPOSITIONS]);
  for (const [key, flag] of Object.entries(value)) {
    integer(flag, 0, 1);
    if (flag === 1 && ['attached_pic', 'timed_thumbnails', 'still_image', 'metadata'].includes(key)) {
      fail('PROBE_STREAM_UNSAFE');
    }
  }
  return { ...value };
}

function normalize(raw, limits) {
  object(raw, ['format', 'streams']);
  const format = object(raw.format, ['format_name', 'duration', 'size', 'nb_streams']);
  if (!Array.isArray(raw.streams) || raw.streams.length === 0) fail('PROBE_STREAMS_MISSING');
  if (raw.streams.length > limits.maxStreams) fail('PROBE_STREAM_LIMIT');
  if (format.nb_streams !== undefined && integer(format.nb_streams) !== raw.streams.length) {
    fail('PROBE_STREAM_COUNT_CONFLICT', 'CONFLICT');
  }
  const containerDuration = decimalTime(format.duration);
  const indices = new Set();
  const streams = raw.streams.map(stream => {
    object(stream, [...new Set([...VIDEO_FIELDS, ...AUDIO_FIELDS])]);
    if (!['video', 'audio'].includes(stream.codec_type)) fail('PROBE_STREAM_UNSUPPORTED');
    object(stream, stream.codec_type === 'video' ? VIDEO_FIELDS : AUDIO_FIELDS);
    const index = integer(stream.index, 0, 2147483647);
    if (indices.has(index)) fail('PROBE_STREAM_INDEX_CONFLICT', 'CONFLICT');
    indices.add(index);
    const timeBase = rationalText(stream.time_base);
    if (greater(timeBase, { num: 1n, den: 1n })) fail('PROBE_TIME_BASE_RANGE');
    const durationTicks = typeof stream.duration_ts === 'number'
      ? BigInt(integer(stream.duration_ts)) : unsignedText(stream.duration_ts);
    const duration = boundedDuration(ratio(durationTicks * timeBase.num, timeBase.den));
    const tolerance = sum(timeBase, { num: 1n, den: 1000000n });
    if (stream.duration !== undefined && !within(duration, decimalTime(stream.duration), tolerance)) {
      fail('PROBE_DURATION_CONFLICT', 'CONFLICT');
    }
    if (greater(duration, containerDuration) && !within(duration, containerDuration, tolerance)) {
      fail('PROBE_DURATION_CONFLICT', 'CONFLICT');
    }
    const output = {
      stream_index: index, stream_kind: stream.codec_type.toUpperCase(),
      codec: enumerated(stream.codec_name, stream.codec_type), time_base: apiRatio(timeBase),
      duration: apiRatio(duration), disposition: disposition(stream.disposition),
    };
    if (stream.codec_type === 'video') {
      const averageRate = rationalText(stream.avg_frame_rate);
      const nominalRate = rationalText(stream.r_frame_rate);
      for (const rate of [averageRate, nominalRate]) {
        if (greater(rate, { num: 1000n, den: 1n })) fail('PROBE_FRAME_RATE_RANGE');
      }
      const count = stream.nb_frames === undefined ? null : unsignedText(stream.nb_frames);
      if (count !== null) {
        const countedDuration = ratio(count * averageRate.den, averageRate.num);
        if (!within(duration, countedDuration, tolerance)) fail('PROBE_FRAME_COUNT_CONFLICT', 'CONFLICT');
      }
      Object.assign(output, {
        width: integer(stream.width, 1, 32768), height: integer(stream.height, 1, 32768),
        frame_rate: apiRatio(averageRate), nominal_frame_rate: apiRatio(nominalRate),
        frame_count: count === null ? null : Number(count),
        pixel_aspect: stream.sample_aspect_ratio === undefined ? null : apiRatio(rationalText(stream.sample_aspect_ratio, ':')),
        pixel_format: enumerated(stream.pix_fmt, 'pixel', true), color_range: enumerated(stream.color_range, 'color_range', true),
        color_space: enumerated(stream.color_space, 'color_space', true), color_transfer: enumerated(stream.color_transfer, 'color_transfer', true),
        color_primaries: enumerated(stream.color_primaries, 'color_primaries', true),
      });
    } else {
      const channels = integer(stream.channels, 1, 64);
      const layout = enumerated(stream.channel_layout, 'layout', true);
      const knownLayouts = { mono: 1, stereo: 2, '2.1': 3, '3.0': 3, '3.0(back)': 3, quad: 4, 'quad(side)': 4, '4.0': 4, '4.1': 5, '5.0': 5, '5.0(side)': 5, '5.1': 6, '5.1(side)': 6, '6.1': 7, '7.1': 8, '7.1(wide)': 8, '7.1(wide-side)': 8, hexagonal: 6, octagonal: 8 };
      if (Object.hasOwn(knownLayouts, layout) && knownLayouts[layout] !== channels) fail('PROBE_CHANNEL_CONFLICT', 'CONFLICT');
      Object.assign(output, { channels, channel_layout: layout,
        sample_rate: integer(Number(unsignedText(stream.sample_rate)), 1, 384000),
        sample_format: enumerated(stream.sample_fmt, 'sample', true) });
    }
    return output;
  }).sort((a, b) => a.stream_index - b.stream_index);
  const container = token(format.format_name);
  for (const name of container.split(',')) enumerated(name, 'container');
  return { container, duration: apiRatio(containerDuration),
    reported_byte_size: format.size === undefined ? null : Number(unsignedText(format.size)), streams };
}

/** Parse bounded producer bytes into typed, still-untrusted media facts. */
export function parseMediaProbe(bytes, options = {}) {
  try {
    const limits = policy(options);
    const metadata = normalize(decodeJson(bytes, limits), limits);
    return { ok: true, probe_schema_version: MEDIA_PROBE_SCHEMA_VERSION,
      parser_policy_version: MEDIA_PROBE_PARSER_VERSION, metadata };
  } catch (error) {
    if (!(error instanceof ProbeError)) throw error;
    return { ok: false, outcome: error.outcome, code: error.code };
  }
}
