#!/usr/bin/env node

import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import { CoreService } from './core.mjs';
import { listenCoreHttp } from './http.mjs';
import { uuidv7 } from './ids.mjs';

function parseArgs(argv) {
  const options = { dbPath: '.cineforge/cineforge.sqlite', mode: 'auto', host: '127.0.0.1', port: 43217 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--db' || arg === '--db-path') options.dbPath = argv[++index];
    else if (arg === '--studio-name') options.studioName = argv[++index];
    else if (arg === '--actor-name') options.actorName = argv[++index];
    else if (arg === '--locale') options.locale = argv[++index];
    else if (arg === '--http') options.mode = 'http';
    else if (arg === '--stdio') options.mode = 'stdio';
    else if (arg === '--host') options.host = argv[++index];
    else if (arg === '--port') options.port = Number(argv[++index]);
    else if (arg === '--token') options.token = argv[++index];
    else if (arg === '--health') options.mode = 'health';
    else if (arg === '--help' || arg === '-h') options.mode = 'help';
  }
  if (options.mode === 'auto') options.mode = argv.includes('--host') || argv.includes('--port') ? 'http' : 'stdio';
  return options;
}

function help() {
  return [
    'CineForge Core local JSON-line server',
    '',
    'Usage:',
    '  node core/server.mjs [--db PATH]          # one JSON request per line on stdin',
    '  node core/server.mjs --http [--port PORT] # loopback HTTP API',
    '  node core/server.mjs --health [--db PATH] # one health response and exit',
    '',
    'The server writes no protocol output until it receives a request. This makes',
    'it safe to launch as a child process from the desktop shell.',
  ].join('\n');
}

function protocolError(requestId, error) {
  return {
    request_id: requestId,
    ok: false,
    error: {
      code: 'INVALID_REQUEST',
      category: 'VALIDATION',
      user_message_key: 'errors.invalid_json',
      user_message_args: {},
      retryable: false,
      needs_user: false,
      decision_request_id: null,
      technical_details: { message: error instanceof Error ? error.message : String(error) },
    },
    warnings: [],
  };
}

export async function run(argv = process.argv.slice(2), streams = {}) {
  const options = parseArgs(argv);
  const output = streams.output ?? process.stdout;
  const input = streams.input ?? process.stdin;
  if (options.mode === 'help') {
    output.write(`${help()}\n`);
    return;
  }

  const core = new CoreService(options);
  const close = () => { try { core.close(); } catch { /* process is already exiting */ } };
  process.once('SIGINT', () => { close(); process.exit(0); });
  process.once('SIGTERM', () => { close(); process.exit(0); });

  if (options.mode === 'health') {
    output.write(`${JSON.stringify(core.handle({ request_id: uuidv7(), api_version: '1', method: 'query.system.health', params: {} }))}\n`);
    close();
    return;
  }

  if (options.mode === 'http') {
    const httpServer = await listenCoreHttp(core, options);
    process.stderr.write(`CineForge Core HTTP listening on http://${httpServer.host}:${httpServer.address.port}\n`);
    if (httpServer.token) process.stderr.write('HTTP authentication is enabled.\n');
    const closeHttp = () => { try { httpServer.server.close(); } catch { /* already closed */ } close(); };
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
    process.once('SIGINT', () => { closeHttp(); process.exit(0); });
    process.once('SIGTERM', () => { closeHttp(); process.exit(0); });
    await new Promise(() => {});
    return;
  }

  const reader = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of reader) {
      if (!line.trim()) continue;
      let request;
      try { request = JSON.parse(line); } catch (error) {
        output.write(`${JSON.stringify(protocolError(uuidv7(), error))}\n`);
        continue;
      }
      const response = core.handle(request);
      output.write(`${JSON.stringify(response)}\n`);
    }
  } finally {
    reader.close();
    close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
