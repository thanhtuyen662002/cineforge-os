const TOP_LEVEL_KEYS = new Set(['format', 'streams']);
const FORMAT_KEYS = new Set(['format_name', 'duration', 'size', 'bit_rate', 'nb_streams']);
const STREAM_KEYS = new Set([
  'index', 'codec_type', 'codec_name', 'width', 'height', 'pix_fmt', 'bits_per_raw_sample',
  'r_frame_rate', 'avg_frame_rate', 'time_base', 'duration', 'nb_frames', 'color_primaries',
  'color_transfer', 'color_space', 'sample_rate', 'channels', 'channel_layout',
  'bits_per_sample', 'disposition',
]);
const COMMON_STREAM_KEYS = [
  'index', 'codec_type', 'codec_name', 'time_base', 'duration', 'disposition',
];
const VIDEO_STREAM_KEYS = new Set([
  ...COMMON_STREAM_KEYS, 'width', 'height', 'pix_fmt', 'bits_per_raw_sample',
  'r_frame_rate', 'avg_frame_rate', 'nb_frames', 'color_primaries', 'color_transfer', 'color_space',
]);
const AUDIO_STREAM_KEYS = new Set([
  ...COMMON_STREAM_KEYS, 'sample_rate', 'channels', 'channel_layout', 'bits_per_sample',
]);
const SUBTITLE_STREAM_KEYS = new Set(COMMON_STREAM_KEYS);
const DISPOSITION_KEYS = new Set([
  'default', 'dub', 'original', 'comment', 'lyrics', 'karaoke', 'forced',
  'hearing_impaired', 'visual_impaired', 'clean_effects', 'attached_pic',
  'timed_thumbnails', 'captions', 'descriptions', 'metadata', 'dependent', 'still_image',
]);

export const MEDIA_PROBE_SCHEMA_VERSION = 'MEDIA_PROBE_V1';
export const MEDIA_PROBE_PARSER_POLICY_VERSION = 'MEDIA_PROBE_PARSER_V1';
export const MEDIA_PROBE_LIMITS = Object.freeze({
  maxBytes: 8 * 1024 * 1024,
  maxDepth: 32,
  maxNodes: 50_000,
  maxStringBytes: 4_096,
  maxStreams: 256,
  maxArrayEntries: 1_024,
  maxKeysPerObject: 128,
});

const LIMIT_KEYS = new Set(Object.keys(MEDIA_PROBE_LIMITS));
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_RATE_COMPONENT = 2_147_483_647n;
const MAX_DIMENSION = 32_768;
const MAX_SAMPLE_RATE = 768_000;
const MAX_CHANNELS = 64;
const MAX_FRAMES = 1_000_000_000;
const MAX_DURATION_SECONDS = 7 * 24 * 60 * 60;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.+:-]{0,127}$/;
const FORMAT_NAME = /^[A-Za-z0-9][A-Za-z0-9_,.+-]{0,127}$/;
const LAYOUT_NAME = /^[A-Za-z0-9][A-Za-z0-9_.+()\- ]{0,127}$/;

export class MediaProbeParseError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'MediaProbeParseError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, details = {}) {
  throw new MediaProbeParseError(code, details);
}

function objectLike(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireOnlyKeys(value, allowed, code, scope) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(code, { scope, field: key });
  }
}

function decodeUtf8(input, maxBytes) {
  let bytes;
  if (typeof input === 'string') bytes = Buffer.from(input, 'utf8');
  else if (Buffer.isBuffer(input)) bytes = input;
  else if (input instanceof Uint8Array) bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  else fail('JSON_INPUT_REQUIRED');
  if (bytes.byteLength < 2) fail('JSON_EMPTY');
  if (bytes.byteLength > maxBytes) fail('JSON_TOO_LARGE');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { fail('JSON_INVALID_UTF8'); }
  if (text.charCodeAt(0) === 0xfeff) fail('JSON_BOM_FORBIDDEN');
  return text;
}

function parseStrictJson(input, limits) {
  const text = decodeUtf8(input, limits.maxBytes);
  let index = 0;
  let nodes = 0;
  const skip = () => { while (index < text.length && [' ', '\t', '\r', '\n'].includes(text[index])) index += 1; };
  const count = (depth) => {
    nodes += 1;
    if (nodes > limits.maxNodes) fail('JSON_TOO_MANY_NODES');
    if (depth > limits.maxDepth) fail('JSON_TOO_DEEP');
  };
  const parseString = () => {
    if (text[index] !== '"') fail('JSON_STRING_EXPECTED');
    const start = index;
    index += 1;
    while (index < text.length) {
      const char = text[index];
      if (char === '"') {
        index += 1;
        const raw = text.slice(start, index);
        let value;
        try { value = JSON.parse(raw); } catch { fail('JSON_STRING_INVALID'); }
        if (Buffer.byteLength(value, 'utf8') > limits.maxStringBytes) fail('JSON_STRING_TOO_LARGE');
        return value;
      }
      if (char === '\\') {
        index += 1;
        if (index >= text.length) fail('JSON_STRING_UNTERMINATED');
        index += 1;
        continue;
      }
      if (char.charCodeAt(0) < 0x20) fail('JSON_CONTROL_CHARACTER');
      index += 1;
    }
    fail('JSON_STRING_UNTERMINATED');
  };
  const parseNumber = () => {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(index));
    if (!match) fail('JSON_NUMBER_INVALID');
    index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) fail('JSON_NUMBER_NONFINITE');
    return value;
  };
  const parseValue = (depth) => {
    skip();
    count(depth);
    const char = text[index];
    if (char === '"') return parseString();
    if (char === '{') {
      index += 1;
      const value = Object.create(null);
      const keys = new Set();
      skip();
      if (text[index] === '}') { index += 1; return value; }
      while (index < text.length) {
        skip();
        const key = parseString();
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') fail('JSON_UNSAFE_KEY');
        if (keys.has(key)) fail('JSON_DUPLICATE_KEY', { field: key });
        keys.add(key);
        if (keys.size > limits.maxKeysPerObject) fail('JSON_TOO_MANY_KEYS');
        skip();
        if (text[index] !== ':') fail('JSON_COLON_EXPECTED');
        index += 1;
        value[key] = parseValue(depth + 1);
        skip();
        if (text[index] === '}') { index += 1; return value; }
        if (text[index] !== ',') fail('JSON_COMMA_EXPECTED');
        index += 1;
      }
      fail('JSON_OBJECT_UNTERMINATED');
    }
    if (char === '[') {
      index += 1;
      const value = [];
      skip();
      if (text[index] === ']') { index += 1; return value; }
      while (index < text.length) {
        if (value.length >= limits.maxArrayEntries) fail('JSON_ARRAY_TOO_LARGE');
        value.push(parseValue(depth + 1));
        skip();
        if (text[index] === ']') { index += 1; return value; }
        if (text[index] !== ',') fail('JSON_COMMA_EXPECTED');
        index += 1;
      }
      fail('JSON_ARRAY_UNTERMINATED');
    }
    if (text.startsWith('true', index)) { index += 4; return true; }
    if (text.startsWith('false', index)) { index += 5; return false; }
    if (text.startsWith('null', index)) { index += 4; return null; }
    if (char === '-' || /\d/.test(char ?? '')) return parseNumber();
    fail('JSON_VALUE_INVALID');
  };
  skip();
  const value = parseValue(0);
  skip();
  if (index !== text.length) fail('JSON_TRAILING_DATA');
  return value;
}

function gcd(left, right) {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) { const next = a % b; a = b; b = next; }
  return a || 1n;
}

function normalizedRational(numerator, denominator, field, maxComponent = MAX_SAFE_BIGINT) {
  if (denominator === 0n) fail('RATIONAL_ZERO_DENOMINATOR', { field });
  if (numerator <= 0n || denominator < 0n) fail('RATIONAL_INVALID', { field });
  const divisor = gcd(numerator, denominator);
  const num = numerator / divisor;
  const den = denominator / divisor;
  if (num > maxComponent || den > maxComponent) fail('RATIONAL_OVERFLOW', { field });
  return { num: Number(num), den: Number(den) };
}

function parseRational(value, field, maxComponent = MAX_RATE_COMPONENT) {
  if (typeof value !== 'string' || !/^\d+\/\d+$/.test(value)) fail('RATIONAL_INVALID', { field });
  const [rawNum, rawDen] = value.split('/');
  const numerator = BigInt(rawNum);
  const denominator = BigInt(rawDen);
  if (numerator > maxComponent || denominator > maxComponent) fail('RATIONAL_OVERFLOW', { field });
  return normalizedRational(numerator, denominator, field, maxComponent);
}

function parseDecimalRational(value, field) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,9})?$/.test(value)) fail('DECIMAL_RATIONAL_INVALID', { field });
  const [whole, fraction = ''] = value.split('.');
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(whole) * denominator + BigInt(fraction || '0');
  const rational = normalizedRational(numerator, denominator, field);
  if (BigInt(rational.num) > BigInt(MAX_DURATION_SECONDS) * BigInt(rational.den)) {
    fail('DURATION_OUT_OF_RANGE', { field });
  }
  return rational;
}

function decimalInteger(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  let number;
  if (typeof value === 'number') number = value;
  else if (typeof value === 'string' && /^\d+$/.test(value)) number = Number(value);
  else fail('INTEGER_INVALID', { field });
  if (!Number.isSafeInteger(number) || number < min || number > max) fail('INTEGER_INVALID', { field });
  return number;
}

function boundedIdentifier(value, field, pattern = IDENTIFIER) {
  if (typeof value !== 'string' || !pattern.test(value)) fail('STRING_FIELD_INVALID', { field });
  return value;
}

function resolveLimits(overrides = {}) {
  if (!objectLike(overrides)) fail('LIMIT_INVALID', { field: 'limits' });
  requireOnlyKeys(overrides, LIMIT_KEYS, 'LIMIT_UNKNOWN_FIELD', 'limits');
  const limits = { ...MEDIA_PROBE_LIMITS, ...overrides };
  for (const [field, hardMaximum] of Object.entries(MEDIA_PROBE_LIMITS)) {
    const value = limits[field];
    const minimum = field === 'maxDepth' ? 0 : 1;
    if (!Number.isSafeInteger(value) || value < minimum || value > hardMaximum) {
      fail('LIMIT_INVALID', { field });
    }
  }
  return Object.freeze(limits);
}

function parseDisposition(value, streamIndex) {
  if (value === undefined) return Object.freeze({});
  if (!objectLike(value)) fail('DISPOSITION_INVALID', { stream_index: streamIndex });
  requireOnlyKeys(value, DISPOSITION_KEYS, 'DISPOSITION_UNKNOWN_FIELD', `stream:${streamIndex}`);
  const result = {};
  for (const [key, raw] of Object.entries(value)) {
    const bit = decimalInteger(raw, `streams[${streamIndex}].disposition.${key}`, { min: 0, max: 1 });
    result[key] = bit;
  }
  if (result.attached_pic === 1 || result.timed_thumbnails === 1) {
    fail('STREAM_ATTACHMENT_UNSAFE', { stream_index: streamIndex });
  }
  return result;
}

function frameCountConsistent(frameCount, duration, rate) {
  const expectedNumerator = BigInt(duration.num) * BigInt(rate.num);
  const expectedDenominator = BigInt(duration.den) * BigInt(rate.den);
  const actualNumerator = BigInt(frameCount) * expectedDenominator;
  const difference = actualNumerator >= expectedNumerator
    ? actualNumerator - expectedNumerator
    : expectedNumerator - actualNumerator;
  return difference <= expectedDenominator; // at most one frame of rounding uncertainty
}

function parseStream(stream, position) {
  if (!objectLike(stream)) fail('STREAM_INVALID', { position });
  requireOnlyKeys(stream, STREAM_KEYS, 'STREAM_UNKNOWN_FIELD', `stream:${position}`);
  const index = decimalInteger(stream.index, `streams[${position}].index`, { min: 0, max: 65_535 });
  const kind = boundedIdentifier(stream.codec_type, `streams[${position}].codec_type`);
  if (kind === 'attachment' || kind === 'data') fail('STREAM_KIND_UNSAFE', { stream_index: index, kind });
  if (!['video', 'audio', 'subtitle'].includes(kind)) fail('STREAM_KIND_UNSUPPORTED', { stream_index: index, kind });
  const kindKeys = kind === 'video' ? VIDEO_STREAM_KEYS : kind === 'audio' ? AUDIO_STREAM_KEYS : SUBTITLE_STREAM_KEYS;
  requireOnlyKeys(stream, kindKeys, 'STREAM_KIND_FIELD_INVALID', `stream:${position}:${kind}`);
  const codec = boundedIdentifier(stream.codec_name, `streams[${position}].codec_name`);
  const disposition = parseDisposition(stream.disposition, index);
  const timeBase = parseRational(stream.time_base, `streams[${position}].time_base`);
  const duration = stream.duration === undefined ? null : parseDecimalRational(stream.duration, `streams[${position}].duration`);
  const base = { index, kind, codec, time_base: timeBase, duration, disposition };

  if (kind === 'video') {
    const width = decimalInteger(stream.width, `streams[${position}].width`, { min: 1, max: MAX_DIMENSION });
    const height = decimalInteger(stream.height, `streams[${position}].height`, { min: 1, max: MAX_DIMENSION });
    const pixelFormat = boundedIdentifier(stream.pix_fmt, `streams[${position}].pix_fmt`);
    const frameRate = parseRational(stream.avg_frame_rate, `streams[${position}].avg_frame_rate`);
    const nominalFrameRate = parseRational(stream.r_frame_rate, `streams[${position}].r_frame_rate`);
    const frameCount = stream.nb_frames === undefined
      ? null
      : decimalInteger(stream.nb_frames, `streams[${position}].nb_frames`, { min: 1, max: MAX_FRAMES });
    if (frameCount !== null && duration !== null && !frameCountConsistent(frameCount, duration, frameRate)) {
      fail('FRAME_DURATION_CONFLICT', { stream_index: index });
    }
    const bitDepth = stream.bits_per_raw_sample === undefined
      ? null
      : decimalInteger(stream.bits_per_raw_sample, `streams[${position}].bits_per_raw_sample`, { min: 1, max: 64 });
    return {
      ...base, width, height, pixel_format: pixelFormat, bit_depth: bitDepth,
      frame_rate: frameRate, nominal_frame_rate: nominalFrameRate, frame_count: frameCount,
      color_primaries: stream.color_primaries === undefined ? null : boundedIdentifier(stream.color_primaries, `streams[${position}].color_primaries`),
      transfer: stream.color_transfer === undefined ? null : boundedIdentifier(stream.color_transfer, `streams[${position}].color_transfer`),
      matrix: stream.color_space === undefined ? null : boundedIdentifier(stream.color_space, `streams[${position}].color_space`),
    };
  }

  if (kind === 'audio') {
    const sampleRate = decimalInteger(stream.sample_rate, `streams[${position}].sample_rate`, { min: 1, max: MAX_SAMPLE_RATE });
    const channels = decimalInteger(stream.channels, `streams[${position}].channels`, { min: 1, max: MAX_CHANNELS });
    const channelLayout = stream.channel_layout === undefined ? null : boundedIdentifier(stream.channel_layout, `streams[${position}].channel_layout`, LAYOUT_NAME);
    const bitDepth = stream.bits_per_sample === undefined
      ? null
      : decimalInteger(stream.bits_per_sample, `streams[${position}].bits_per_sample`, { min: 1, max: 64 });
    return { ...base, sample_rate: sampleRate, channels, channel_layout: channelLayout, bit_depth: bitDepth };
  }

  return base;
}

/**
 * Parse only the fixed ffprobe JSON profile used by ProbeMediaAsset.
 *
 * The process runner is expected to constrain ffprobe with an explicit
 * `-show_entries` allowlist that matches the schema below. This parser does not
 * accept best-effort extra fields: any profile drift is a typed parse failure
 * and cannot create verified technical metadata.
 */
export function parseMediaProbeJson(input, options = {}) {
  const limits = resolveLimits(options.limits ?? {});
  const value = parseStrictJson(input, limits);
  if (!objectLike(value)) fail('PROBE_ROOT_INVALID');
  requireOnlyKeys(value, TOP_LEVEL_KEYS, 'PROBE_UNKNOWN_FIELD', 'root');
  if (!objectLike(value.format)) fail('FORMAT_MISSING');
  if (!Array.isArray(value.streams) || value.streams.length < 1) fail('STREAMS_INVALID');
  if (value.streams.length > limits.maxStreams) fail('STREAM_COUNT_EXCEEDED');
  requireOnlyKeys(value.format, FORMAT_KEYS, 'FORMAT_UNKNOWN_FIELD', 'format');

  const container = boundedIdentifier(value.format.format_name, 'format.format_name', FORMAT_NAME);
  const duration = parseDecimalRational(value.format.duration, 'format.duration');
  const byteSize = decimalInteger(value.format.size, 'format.size', { min: 1 });
  const bitRate = value.format.bit_rate === undefined ? null : decimalInteger(value.format.bit_rate, 'format.bit_rate', { min: 1 });
  const declaredStreamCount = value.format.nb_streams === undefined
    ? value.streams.length
    : decimalInteger(value.format.nb_streams, 'format.nb_streams', { min: 1, max: limits.maxStreams });
  if (declaredStreamCount !== value.streams.length) fail('STREAM_COUNT_CONFLICT');

  const streams = value.streams.map((stream, position) => parseStream(stream, position));
  const indexes = new Set();
  for (const stream of streams) {
    if (indexes.has(stream.index)) fail('STREAM_INDEX_DUPLICATE', { stream_index: stream.index });
    indexes.add(stream.index);
  }

  return {
    schema_version: MEDIA_PROBE_SCHEMA_VERSION,
    parser_policy_version: MEDIA_PROBE_PARSER_POLICY_VERSION,
    container,
    duration,
    byte_size: byteSize,
    bit_rate: bitRate,
    streams,
  };
}
