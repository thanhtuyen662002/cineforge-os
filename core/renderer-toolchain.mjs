import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson } from './canonical.mjs';

/**
 * The renderer is deliberately not implemented in this module.  This is a
 * read-only, fail-closed boundary which proves that a future renderer may use
 * two exact local binaries.  In particular, this module never searches PATH,
 * starts a child process, makes a network request, or returns a filesystem
 * path to a caller.
 */

export const RENDERER_TOOLCHAIN_MANIFEST_TYPE = 'CINEFORGE_RENDERER_TOOLCHAIN';
export const RENDERER_TOOLCHAIN_MANIFEST_SCHEMA_VERSION = 1;
// This is deliberately a preflight capability, not a claim that a master
// renderer is executable.  A later typed connector may depend on this
// evidence only after it adds its own argv, sandbox, output, QC and recovery
// contracts.
export const RENDERER_TOOLCHAIN_CAPABILITY = 'LOCAL_RENDERER_TOOLCHAIN_PREFLIGHT';
export const DEFAULT_RENDERER_TOOLCHAIN_MANIFEST_NAME = 'renderer-toolchain.json';

const SHA256_HEX = /^[0-9a-f]{64}$/i;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_MANIFEST_BYTES = 256 * 1024;
// Preflight hashes synchronously inside a read-only Core query.  Keep the
// bound large enough for a packaged static media tool while preventing an
// untrusted manifest from turning a refresh into an unbounded multi-gigabyte
// read. A future large-pack installer must move verification into a bounded
// cancellable job before raising this limit.
const MAX_BINARY_BYTES = 512 * 1024 * 1024;
const HASH_CHUNK_BYTES = 1024 * 1024;
const BINARY_KEYS = new Set(['path', 'sha256', 'version', 'size']);
const MANIFEST_KEYS = new Set([
  'manifest_type', 'manifest_schema_version', 'toolchain_id', 'toolchain_version',
  'network', 'binaries',
]);
const BINARY_NAMES = Object.freeze(['ffmpeg', 'ffprobe']);

function objectLike(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function ownKeys(value) {
  return Object.keys(value);
}

function hasOnlyKeys(value, allowed) {
  return ownKeys(value).every((key) => allowed.has(key));
}

function isAbsolutePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) return false;
  // path.isAbsolute is platform-specific.  Accept a Windows drive path when
  // the module is exercised by a Linux-side test runner, while still rejecting
  // bare executable names and all relative paths.
  return path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value);
}

function isNetworkPath(value) {
  // UNC paths, URL-like paths and device namespaces are external/network
  // boundaries for this local-only capability.  Drive-letter paths remain
  // allowed, including `C:/...` and `C:\\...`.
  return /^(?:\\\\|\/\/)/.test(value)
    || /^(?:\\\\\?\\|\\\\\.\\|\\?\\)/.test(value)
    || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value);
}

function comparablePath(value) {
  let normalized = String(value).replace(/\\/g, '/');
  // win32.normalize handles drive paths even when tests run on another host.
  if (/^[A-Za-z]:\//.test(normalized)) normalized = path.win32.normalize(normalized).replace(/\\/g, '/');
  else normalized = path.normalize(normalized).replace(/\\/g, '/');
  normalized = normalized.replace(/\/+$/, '') || '/';
  return normalized.toLowerCase();
}

function isWithin(root, candidate) {
  const base = comparablePath(root);
  const target = comparablePath(candidate);
  return target === base || target.startsWith(`${base}/`);
}

function fileName(value) {
  return String(value).replace(/\\/g, '/').split('/').pop() ?? '';
}

function expectedBinaryName(name) {
  return process.platform === 'win32' ? `${name}.exe` : name;
}

function readUtf8Bounded(filePath, maxBytes, expectedIdentity = null, expectedStat = null) {
  let stat;
  let pathIdentity;
  try { stat = fs.statSync(filePath); } catch { return { ok: false, code: 'MANIFEST_MISSING' }; }
  if (!stat.isFile()) return { ok: false, code: 'MANIFEST_NOT_FILE' };
  if (stat.size < 1 || stat.size > maxBytes) return { ok: false, code: 'MANIFEST_SIZE_INVALID' };
  try { pathIdentity = stableFileIdentity(fs.statSync(filePath, { bigint: true })); } catch { return { ok: false, code: 'MANIFEST_UNREADABLE' }; }
  if (!sameStableFileIdentity(expectedIdentity, pathIdentity)
    || (expectedStat && Number(expectedStat.size) !== Number(stat.size))) {
    return { ok: false, code: 'MANIFEST_CHANGED_BEFORE_READ' };
  }
  let fd;
  let bytes;
  try {
    fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_BINARY ?? 0));
    const opened = fs.fstatSync(fd);
    const openedIdentity = stableFileIdentity(fs.fstatSync(fd, { bigint: true }));
    if (!opened.isFile() || opened.size !== stat.size || !sameStableFileIdentity(pathIdentity, openedIdentity)) {
      return { ok: false, code: 'MANIFEST_CHANGED_BEFORE_READ' };
    }
    bytes = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < bytes.byteLength) {
      const count = fs.readSync(fd, bytes, offset, bytes.byteLength - offset, offset);
      if (count <= 0) return { ok: false, code: 'MANIFEST_READ_TRUNCATED' };
      offset += count;
    }
    const finished = fs.fstatSync(fd);
    const finishedIdentity = stableFileIdentity(fs.fstatSync(fd, { bigint: true }));
    let pathAfter;
    try { pathAfter = fs.lstatSync(filePath); } catch { return { ok: false, code: 'MANIFEST_CHANGED_DURING_READ' }; }
    if (!finished.isFile() || finished.size !== stat.size || !sameStableFileIdentity(openedIdentity, finishedIdentity)
      || pathAfter.isSymbolicLink() || !pathAfter.isFile()
      || !sameStableFileIdentity(finishedIdentity, stableFileIdentity(fs.statSync(filePath, { bigint: true })))) {
      return { ok: false, code: 'MANIFEST_CHANGED_DURING_READ' };
    }
  } catch { return { ok: false, code: 'MANIFEST_UNREADABLE' }; }
  finally { if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* preserve primary result */ } } }
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return { ok: false, code: 'MANIFEST_UTF8_INVALID' }; }
  if (text.length === 0 || text.charCodeAt(0) === 0xfeff) return { ok: false, code: 'MANIFEST_ENCODING_INVALID' };
  let value;
  try { value = JSON.parse(text); } catch { return { ok: false, code: 'MANIFEST_JSON_INVALID' }; }
  if (!objectLike(value)) return { ok: false, code: 'MANIFEST_ROOT_INVALID' };
  // Canonical text prevents duplicate keys and makes the manifest digest
  // deterministic.  The release plan can therefore bind this exact document.
  let canonical;
  try { canonical = canonicalJson(value); } catch { return { ok: false, code: 'MANIFEST_JSON_INVALID' }; }
  if (canonical !== text) return { ok: false, code: 'MANIFEST_NOT_CANONICAL' };
  return {
    ok: true,
    value,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    byteSize: bytes.byteLength,
  };
}

function readObjectManifest(value) {
  if (!objectLike(value)) return { ok: false, code: 'MANIFEST_ROOT_INVALID' };
  let canonical;
  try { canonical = canonicalJson(value); } catch { return { ok: false, code: 'MANIFEST_JSON_INVALID' }; }
  const bytes = Buffer.from(canonical, 'utf8');
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_MANIFEST_BYTES) return { ok: false, code: 'MANIFEST_SIZE_INVALID' };
  return {
    ok: true,
    value,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    byteSize: bytes.byteLength,
  };
}

function inspectPath(target, expectedType) {
  if (!isAbsolutePath(target)) return { ok: false, code: 'PATH_NOT_ABSOLUTE' };
  if (isNetworkPath(target)) return { ok: false, code: 'NETWORK_PATH_REJECTED' };
  const absolute = path.resolve(target);
  let stat;
  let lstat;
  let identityStat;
  try {
    lstat = fs.lstatSync(absolute);
    stat = fs.statSync(absolute);
    identityStat = fs.statSync(absolute, { bigint: true });
  } catch (error) {
    return {
      ok: false,
      code: expectedType === 'directory' ? 'ROOT_MISSING' : expectedType === 'manifest' ? 'MANIFEST_MISSING' : 'BINARY_MISSING',
    };
  }
  // lstat catches ordinary symlinks and Windows junctions/reparse points on
  // the supported host.  The ancestor walk below applies the same fence to
  // every component, rather than trusting a leaf that happens to be regular.
  if (lstat.isSymbolicLink()) return { ok: false, code: 'REPARSE_POINT_REJECTED' };
  // Walk existing ancestors so a junction/reparse point cannot hide above a
  // regular-looking leaf.  Do not compare the textual realpath with the
  // requested path: Windows 8.3 short names (for example VOTHAN~1) are a
  // normal alias and are not a reparse point.
  let cursor = absolute;
  while (true) {
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) return { ok: false, code: 'REPARSE_POINT_REJECTED' };
    } catch (error) {
      if (error?.code !== 'ENOENT') return { ok: false, code: 'PATH_UNRESOLVABLE' };
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  if (expectedType === 'directory' && !stat.isDirectory()) return { ok: false, code: 'ROOT_NOT_DIRECTORY' };
  if (expectedType === 'file' && !stat.isFile()) return { ok: false, code: 'BINARY_NOT_FILE' };
  // A hardlink gives another writable name for the same executable.  The
  // renderer pack is an immutable trust input, so refuse aliases instead of
  // allowing a second path to mutate the bytes after this preflight.
  if (expectedType === 'file' && Number(stat.nlink ?? 1) !== 1) return { ok: false, code: 'BINARY_HARDLINK_REJECTED' };
  return { ok: true, absolute, stat, fileIdentity: stableFileIdentity(identityStat) };
}

function hashFile(absolute, stat, fileIdentity = null) {
  if (!Number.isSafeInteger(stat.size) || stat.size < 1 || stat.size > MAX_BINARY_BYTES) {
    return { ok: false, code: 'BINARY_SIZE_INVALID' };
  }
  let fd;
  try { fd = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_BINARY ?? 0)); } catch { return { ok: false, code: 'BINARY_UNREADABLE' }; }
  const digest = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
  let total = 0;
  try {
    const opened = fs.fstatSync(fd);
    const openedIdentity = stableFileIdentity(fs.fstatSync(fd, { bigint: true }));
    if (!opened.isFile() || opened.size !== stat.size || !sameStableFileIdentity(fileIdentity, openedIdentity)) {
      return { ok: false, code: 'BINARY_CHANGED_BEFORE_HASH' };
    }
    while (total < stat.size) {
      const remaining = stat.size - total;
      const count = fs.readSync(fd, buffer, 0, Math.min(buffer.length, remaining), total);
      if (!count) return { ok: false, code: 'BINARY_READ_TRUNCATED' };
      digest.update(buffer.subarray(0, count));
      total += count;
    }
    const finished = fs.fstatSync(fd);
    const finishedIdentity = stableFileIdentity(fs.fstatSync(fd, { bigint: true }));
    if (!finished.isFile() || finished.size !== stat.size || !sameStableFileIdentity(openedIdentity, finishedIdentity)) {
      return { ok: false, code: 'BINARY_CHANGED_DURING_HASH' };
    }
  } catch { return { ok: false, code: 'BINARY_READ_FAILED' }; }
  finally { try { fs.closeSync(fd); } catch { /* preserve primary result */ } }
  if (total !== stat.size) return { ok: false, code: 'BINARY_SIZE_CHANGED' };
  return { ok: true, sha256: digest.digest('hex'), byteSize: total };
}

function stableFileIdentity(stat) {
  if (stat && typeof stat === 'object' && 'fileIdentity' in stat) return stat.fileIdentity;
  if (stat?.dev === undefined || stat?.ino === undefined) return null;
  const rawDev = String(stat.dev);
  const rawIno = String(stat.ino);
  // Node exposes the volume/file-index pair on supported Windows versions and
  // dev/ino on POSIX.  Refuse to certify a file if the host cannot provide a
  // stable identity: size/mtime alone cannot fence a path replacement.
  if (!/^\d+$/.test(rawDev) || !/^\d+$/.test(rawIno) || rawIno === '0') return null;
  // On Windows Node currently reports `dev=0` for a path stat but exposes the
  // volume serial in `fstat` after opening the same file.  The file index
  // (`ino`) is still stable across those two APIs.  Preserve the volume when
  // both sides expose it, and use the file index as the cross-API fallback.
  return { dev: rawDev === '0' ? null : rawDev, ino: rawIno };
}

function sameStableFileIdentity(left, right) {
  const leftIdentity = left && typeof left === 'object' && 'ino' in left ? left : stableFileIdentity(left);
  const rightIdentity = right && typeof right === 'object' && 'ino' in right ? right : stableFileIdentity(right);
  if (leftIdentity === null || rightIdentity === null || leftIdentity.ino !== rightIdentity.ino) return false;
  return leftIdentity.dev === null || rightIdentity.dev === null || leftIdentity.dev === rightIdentity.dev;
}

function blocked(reasonCode, options = {}) {
  const state = {
    capability: RENDERER_TOOLCHAIN_CAPABILITY,
    state: 'BLOCKED',
    overall_state: 'BLOCKED',
    verification_state: options.unknown === true ? 'UNKNOWN' : 'FAIL',
    execution_state: 'DISABLED',
    toolchain_id: null,
    toolchain_version: null,
    manifest_schema_version: null,
    manifest_sha256: null,
    manifest_byte_size: null,
    network_policy: 'DISABLED_REQUIRED',
    shell_execution: 'NOT_USED',
    checks: [{ id: 'TOOLCHAIN', state: options.unknown === true ? 'UNKNOWN' : 'FAIL', code: reasonCode }],
    reason_codes: [reasonCode],
    binaries: options.binaries ?? {
      ffmpeg: { state: 'UNKNOWN', sha256: null, byte_size: null, version: null },
      ffprobe: { state: 'UNKNOWN', sha256: null, byte_size: null, version: null },
    },
    next_step: options.nextStep ?? 'Cài đặt và chứng thực đúng local renderer toolchain manifest trước khi render.',
  };
  if (Array.isArray(options.checks)) state.checks = options.checks;
  if (Array.isArray(options.reasonCodes)) state.reason_codes = options.reasonCodes;
  if (options.toolchain) {
    state.toolchain_id = options.toolchain.id ?? null;
    state.toolchain_version = options.toolchain.version ?? null;
    state.manifest_schema_version = options.toolchain.schemaVersion ?? null;
    state.manifest_sha256 = options.toolchain.manifestSha256 ?? null;
    state.manifest_byte_size = options.toolchain.manifestByteSize ?? null;
  }
  return state;
}

function validateManifest(manifest) {
  if (!hasOnlyKeys(manifest, MANIFEST_KEYS)) return { ok: false, code: 'MANIFEST_UNKNOWN_FIELD' };
  if (manifest.manifest_type !== RENDERER_TOOLCHAIN_MANIFEST_TYPE) return { ok: false, code: 'MANIFEST_TYPE_UNSUPPORTED' };
  if (manifest.manifest_schema_version !== RENDERER_TOOLCHAIN_MANIFEST_SCHEMA_VERSION) return { ok: false, code: 'MANIFEST_SCHEMA_UNSUPPORTED' };
  if (typeof manifest.toolchain_id !== 'string' || !IDENTIFIER_PATTERN.test(manifest.toolchain_id)) return { ok: false, code: 'TOOLCHAIN_ID_INVALID' };
  if (typeof manifest.toolchain_version !== 'string' || !VERSION_PATTERN.test(manifest.toolchain_version)) return { ok: false, code: 'TOOLCHAIN_VERSION_INVALID' };
  if (manifest.network !== false) return { ok: false, code: 'NETWORK_POLICY_NOT_DISABLED' };
  if (!objectLike(manifest.binaries) || !hasOnlyKeys(manifest.binaries, new Set(BINARY_NAMES))) return { ok: false, code: 'BINARY_SET_INVALID' };
  const binaries = {};
  for (const name of BINARY_NAMES) {
    const binary = manifest.binaries[name];
    if (!objectLike(binary) || !hasOnlyKeys(binary, BINARY_KEYS)) return { ok: false, code: 'BINARY_METADATA_INVALID', binary: name };
    if (typeof binary.path !== 'string' || !isAbsolutePath(binary.path) || isNetworkPath(binary.path)) return { ok: false, code: 'BINARY_PATH_INVALID', binary: name };
    if (fileName(binary.path).toLowerCase() !== expectedBinaryName(name).toLowerCase()) return { ok: false, code: 'BINARY_NAME_INVALID', binary: name };
    if (typeof binary.sha256 !== 'string' || !SHA256_HEX.test(binary.sha256)) return { ok: false, code: 'BINARY_DIGEST_INVALID', binary: name };
    if (typeof binary.version !== 'string' || !VERSION_PATTERN.test(binary.version) || binary.version !== manifest.toolchain_version) return { ok: false, code: 'BINARY_VERSION_INVALID', binary: name };
    if (binary.size !== undefined && (!Number.isSafeInteger(binary.size) || binary.size < 1 || binary.size > MAX_BINARY_BYTES)) return { ok: false, code: 'BINARY_SIZE_INVALID', binary: name };
    binaries[name] = { ...binary, sha256: binary.sha256.toLowerCase() };
  }
  return { ok: true, manifest: { ...manifest, binaries } };
}

/**
 * Verify a pinned local renderer manifest.  `root` and `manifestPath` are
 * intentionally input-only; no returned property contains a filesystem path.
 * A manifest object is accepted for in-process tests/bootstrap, but binary
 * paths inside it must still be absolute and regular local files.
 */
export function preflightRendererToolchain(options = {}) {
  const requestedRoot = options.rendererToolchainRoot ?? options.root ?? null;
  const requestedManifest = options.rendererToolchainManifest ?? options.manifest ?? null;
  const requestedManifestPath = options.rendererToolchainManifestPath ?? options.manifestPath
    ?? (typeof requestedManifest === 'string' ? requestedManifest : null);
  const manifestObject = objectLike(requestedManifest) ? requestedManifest : null;

  if (manifestObject && options.allowObjectManifest === false) {
    return blocked('MANIFEST_FILE_REQUIRED');
  }

  if (requestedRoot === null && requestedManifestPath === null && manifestObject === null) {
    return blocked('NO_CERTIFIED_TOOLCHAIN', { unknown: true });
  }
  let root = null;
  if (requestedRoot !== null && requestedRoot !== undefined) {
    const checkedRoot = inspectPath(requestedRoot, 'directory');
    if (!checkedRoot.ok) return blocked(checkedRoot.code, { unknown: checkedRoot.code === 'ROOT_MISSING' });
    root = checkedRoot.absolute;
  }
  let loaded;
  if (manifestObject) {
    loaded = readObjectManifest(manifestObject);
  } else {
    let manifestPath = requestedManifestPath;
    if (manifestPath === null && root !== null) manifestPath = path.join(root, DEFAULT_RENDERER_TOOLCHAIN_MANIFEST_NAME);
    const checkedManifest = inspectPath(manifestPath, 'manifest');
    if (!checkedManifest.ok) return blocked(checkedManifest.code, { unknown: checkedManifest.code === 'MANIFEST_MISSING' });
    if (root !== null && !isWithin(root, checkedManifest.absolute)) return blocked('MANIFEST_OUTSIDE_ROOT');
    loaded = readUtf8Bounded(checkedManifest.absolute, MAX_MANIFEST_BYTES, checkedManifest.fileIdentity, checkedManifest.stat);
    if (!loaded.ok) return blocked(loaded.code, { unknown: loaded.code === 'MANIFEST_MISSING' });
  }
  if (!loaded.ok) return blocked(loaded.code);
  const validated = validateManifest(loaded.value);
  if (!validated.ok) return blocked(validated.code, {
    checks: [{ id: 'MANIFEST', state: 'FAIL', code: validated.code }],
    reasonCodes: [validated.code],
  });
  const manifest = validated.manifest;
  const toolchain = {
    id: manifest.toolchain_id,
    version: manifest.toolchain_version,
    schemaVersion: manifest.manifest_schema_version,
    manifestSha256: loaded.sha256,
    manifestByteSize: loaded.byteSize,
  };
  const checks = [{ id: 'MANIFEST', state: 'PASS', code: 'MANIFEST_VERIFIED' }];
  const binaries = {};
  const failures = [];
  for (const name of BINARY_NAMES) {
    const expected = manifest.binaries[name];
    if (root !== null && !isWithin(root, expected.path)) {
      failures.push('BINARY_OUTSIDE_ROOT');
      binaries[name] = { state: 'FAIL', sha256: null, byte_size: null, version: expected.version };
      checks.push({ id: name.toUpperCase(), state: 'FAIL', code: 'BINARY_OUTSIDE_ROOT' });
      continue;
    }
    const checked = inspectPath(expected.path, 'file');
    if (!checked.ok) {
      failures.push(checked.code);
      binaries[name] = { state: 'FAIL', sha256: null, byte_size: null, version: expected.version };
      checks.push({ id: name.toUpperCase(), state: 'FAIL', code: checked.code });
      continue;
    }
    const actual = hashFile(checked.absolute, checked.stat, checked.fileIdentity);
    if (!actual.ok) {
      failures.push(actual.code);
      binaries[name] = { state: 'FAIL', sha256: null, byte_size: null, version: expected.version };
      checks.push({ id: name.toUpperCase(), state: 'FAIL', code: actual.code });
      continue;
    }
    if (expected.size !== undefined && expected.size !== actual.byteSize) {
      failures.push('BINARY_SIZE_MISMATCH');
      binaries[name] = { state: 'FAIL', sha256: actual.sha256, byte_size: actual.byteSize, version: expected.version, expected_sha256: expected.sha256 };
      checks.push({ id: name.toUpperCase(), state: 'FAIL', code: 'BINARY_SIZE_MISMATCH' });
      continue;
    }
    if (actual.sha256 !== expected.sha256) {
      failures.push('BINARY_DIGEST_MISMATCH');
      binaries[name] = { state: 'FAIL', sha256: actual.sha256, byte_size: actual.byteSize, version: expected.version, expected_sha256: expected.sha256 };
      checks.push({ id: name.toUpperCase(), state: 'FAIL', code: 'BINARY_DIGEST_MISMATCH' });
      continue;
    }
    binaries[name] = { state: 'VERIFIED', sha256: actual.sha256, byte_size: actual.byteSize, version: expected.version };
    checks.push({ id: name.toUpperCase(), state: 'PASS', code: 'BINARY_VERIFIED' });
  }
  if (failures.length > 0) {
    return blocked(failures[0], {
      toolchain,
      checks,
      reasonCodes: [...new Set(failures)],
      binaries,
    });
  }
  return {
    capability: RENDERER_TOOLCHAIN_CAPABILITY,
    state: 'READY',
    overall_state: 'READY',
    verification_state: 'ARTIFACT_VERIFIED',
    execution_state: 'DISABLED',
    toolchain_id: manifest.toolchain_id,
    toolchain_version: manifest.toolchain_version,
    manifest_schema_version: manifest.manifest_schema_version,
    manifest_sha256: loaded.sha256,
    manifest_byte_size: loaded.byteSize,
    network_policy: 'DENY',
    shell_execution: 'NOT_USED',
    checks,
    reason_codes: [],
    binaries,
    next_step: 'Toolchain đã được pin; vẫn cần render contract/QC riêng trước khi tạo master bytes.',
  };
}

