import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { canonicalJson } from './canonical.mjs';
import { CoreService } from './core.mjs';
import { listenCoreHttp } from './http.mjs';
import { preflightRendererToolchain } from './renderer-toolchain.mjs';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cineforge-renderer-toolchain-'));
}

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function writeFixture(root) {
  const ffmpegName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const ffprobeName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  const ffmpeg = Buffer.from('fixture-ffmpeg-v9.0.2', 'utf8');
  const ffprobe = Buffer.from('fixture-ffprobe-v9.0.2', 'utf8');
  const ffmpegPath = path.join(root, ffmpegName);
  const ffprobePath = path.join(root, ffprobeName);
  fs.writeFileSync(ffmpegPath, ffmpeg);
  fs.writeFileSync(ffprobePath, ffprobe);
  const manifest = {
    manifest_type: 'CINEFORGE_RENDERER_TOOLCHAIN',
    manifest_schema_version: 1,
    toolchain_id: 'ffmpeg-fixture',
    toolchain_version: '9.0.2',
    network: false,
    binaries: {
      ffmpeg: { path: ffmpegPath, sha256: digest(ffmpeg), version: '9.0.2', size: ffmpeg.byteLength },
      ffprobe: { path: ffprobePath, sha256: digest(ffprobe), version: '9.0.2', size: ffprobe.byteLength },
    },
  };
  const manifestPath = path.join(root, 'renderer-toolchain.json');
  fs.writeFileSync(manifestPath, canonicalJson(manifest), 'utf8');
  return { manifest, manifestPath, ffmpegPath };
}

function assertNoPath(value, paths) {
  const text = JSON.stringify(value);
  for (const valuePath of paths) assert.equal(text.includes(valuePath), false, `redacted result leaked ${valuePath}`);
}

test('renderer toolchain preflight defaults to blocked without a certified manifest', () => {
  const result = preflightRendererToolchain();
  assert.equal(result.state, 'BLOCKED');
  assert.equal(result.verification_state, 'UNKNOWN');
  assert.deepEqual(result.reason_codes, ['NO_CERTIFIED_TOOLCHAIN']);
  assert.equal(Object.hasOwn(result, 'path'), false);
});

test('Core renderer preflight is blocked by default and ignores caller-supplied path overrides', () => {
  const root = tempRoot();
  const fixture = writeFixture(root);
  const core = new CoreService({ dbPath: ':memory:' });
  try {
    const result = core.handle({
      request_id: 'renderer-default', api_version: '1', method: 'query.release.renderer.preflight',
      params: { renderer_toolchain_root: root, renderer_toolchain_manifest: fixture.manifestPath },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.result.state, 'BLOCKED');
    assert.equal(result.result.reason_codes[0], 'NO_CERTIFIED_TOOLCHAIN');
    assertNoPath(result.result, [root, fixture.manifestPath]);
  } finally {
    core.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('live Core rejects in-memory manifests and requires a startup-bound canonical file', () => {
  const root = tempRoot();
  const fixture = writeFixture(root);
  const core = new CoreService({ dbPath: ':memory:', rendererToolchainManifest: fixture.manifest });
  try {
    const result = core.handle({ request_id: 'renderer-object', api_version: '1', method: 'query.release.renderer.preflight', params: {} });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.result.state, 'BLOCKED');
    assert.equal(result.result.reason_codes[0], 'MANIFEST_FILE_REQUIRED');
  } finally {
    core.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('renderer toolchain preflight blocks missing and tampered files without shell or PATH lookup', () => {
  const root = tempRoot();
  try {
    const missing = preflightRendererToolchain({ rendererToolchainRoot: root });
    assert.equal(missing.state, 'BLOCKED');
    assert.equal(missing.reason_codes[0], 'MANIFEST_MISSING');

    const fixture = writeFixture(root);
    fs.appendFileSync(fixture.ffmpegPath, Buffer.from('-tampered', 'utf8'));
    const tampered = preflightRendererToolchain({ rendererToolchainRoot: root, rendererToolchainManifest: fixture.manifestPath });
    assert.equal(tampered.state, 'BLOCKED');
    assert.ok(tampered.reason_codes.includes('BINARY_SIZE_MISMATCH') || tampered.reason_codes.includes('BINARY_DIGEST_MISMATCH'));
    assert.equal(tampered.binaries.ffmpeg.state, 'FAIL');
    assertNoPath(tampered, [root, fixture.manifestPath, fixture.ffmpegPath]);

    const relative = preflightRendererToolchain({ rendererToolchainRoot: '.', rendererToolchainManifest: fixture.manifestPath });
    assert.equal(relative.state, 'BLOCKED');
    assert.equal(relative.reason_codes[0], 'PATH_NOT_ABSOLUTE');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('renderer toolchain preflight verifies exact local binaries and only exposes redacted metadata', () => {
  const root = tempRoot();
  const fixture = writeFixture(root);
  const core = new CoreService({
    dbPath: ':memory:',
    rendererToolchainRoot: root,
    rendererToolchainManifest: fixture.manifestPath,
  });
  try {
    const direct = preflightRendererToolchain({ rendererToolchainRoot: root, rendererToolchainManifest: fixture.manifestPath });
    assert.equal(direct.state, 'READY');
    assert.equal(direct.overall_state, 'READY');
    assert.equal(direct.toolchain_id, fixture.manifest.toolchain_id);
    assert.equal(direct.binaries.ffmpeg.state, 'VERIFIED');
    assert.equal(direct.binaries.ffprobe.state, 'VERIFIED');
    assert.match(direct.manifest_sha256, /^[0-9a-f]{64}$/);
    assertNoPath(direct, [root, fixture.manifestPath, fixture.ffmpegPath]);

    const queried = core.handle({ request_id: 'renderer-preflight', api_version: '1', method: 'query.release.renderer.preflight', params: {} });
    assert.equal(queried.ok, true, JSON.stringify(queried));
    assert.equal(queried.result.state, 'READY');
    assert.equal(queried.result.projection_seq, 0);
    assertNoPath(queried.result, [root, fixture.manifestPath, fixture.ffmpegPath]);
  } finally {
    core.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('renderer toolchain preflight rejects unknown manifest fields and network policy', () => {
  const root = tempRoot();
  try {
    const fixture = writeFixture(root);
    const unknown = { ...fixture.manifest, unexpected: true };
    let result = preflightRendererToolchain({ rendererToolchainRoot: root, rendererToolchainManifest: unknown });
    assert.equal(result.state, 'BLOCKED');
    assert.equal(result.reason_codes[0], 'MANIFEST_UNKNOWN_FIELD');
    const network = { ...fixture.manifest, network: true };
    result = preflightRendererToolchain({ rendererToolchainRoot: root, rendererToolchainManifest: network });
    assert.equal(result.state, 'BLOCKED');
    assert.equal(result.reason_codes[0], 'NETWORK_POLICY_NOT_DISABLED');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('renderer toolchain preflight rejects hardlink aliases before hashing', () => {
  if (process.platform === 'win32' || process.platform === 'linux' || process.platform === 'darwin') {
    const root = tempRoot();
    try {
      const fixture = writeFixture(root);
      const aliasDir = path.join(root, 'alias');
      fs.mkdirSync(aliasDir);
      const alias = path.join(aliasDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
      try { fs.linkSync(fixture.ffmpegPath, alias); } catch { return; }
      const manifest = { ...fixture.manifest, binaries: { ...fixture.manifest.binaries, ffmpeg: { ...fixture.manifest.binaries.ffmpeg, path: alias } } };
      const result = preflightRendererToolchain({ rendererToolchainRoot: root, rendererToolchainManifest: manifest });
      assert.equal(result.state, 'BLOCKED');
      assert.equal(result.reason_codes[0], 'BINARY_HARDLINK_REJECTED');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('renderer toolchain HTTP preflight is read-only, startup-bound and redacted', async () => {
  const root = tempRoot();
  const fixture = writeFixture(root);
  const core = new CoreService({
    dbPath: ':memory:',
    rendererToolchainRoot: root,
    rendererToolchainManifest: fixture.manifestPath,
  });
  const listener = await listenCoreHttp(core, { host: '127.0.0.1', port: 0 });
  const base = `http://127.0.0.1:${listener.address.port}`;
  try {
    const response = await fetch(`${base}/v1/release/renderer/preflight?renderer_toolchain_root=${encodeURIComponent('C:\\private')}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true, JSON.stringify(body));
    assert.equal(body.result.state, 'READY');
    assertNoPath(body.result, [root, fixture.manifestPath, fixture.ffmpegPath]);
    assert.equal(JSON.stringify(body).includes('private'), false);
  } finally {
    await new Promise((resolve) => listener.server.close(resolve));
    core.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

