import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, copyFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// /shutdown must end the helper promptly even when a client keeps a connection open (paused media stream,
// half-sent request), and must reset those connections instead of leaving them half-closed: on Windows a
// half-closed socket of an exited process keeps the port listening as PID 0 and the next start fails.
test('helper /shutdown resets open connections and exits promptly', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'karaoke-shutdown-')); let child;
  try {
    const src = fileURLToPath(new URL('../', import.meta.url));
    for (const file of await readdir(src)) if (file.endsWith('.mjs')) await copyFile(path.join(src, file), path.join(dir, file));
    const helper = path.join(dir, 'helper-local.mjs');
    let source = await readFile(helper, 'utf8');
    source = source.replace('`127.0.0.1:${port}`, `localhost:${port}`', '`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`').replace('${port}/health', '${server.address().port}/health');
    await writeFile(helper, source);
    child = spawn(process.execPath, [helper], { windowsHide: true, env: { ...process.env, KARAOKE_HELPER_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = new Promise(resolve => child.once('exit', code => resolve(code)));
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('helper startup timeout')), 10000);
      child.stdout.once('data', chunk => { clearTimeout(timer); resolve(chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/)[0]); });
    });
    const port = Number(new URL(base).port), origin = 'http://localhost:4273';
    // A client that sends half a request and never finishes it.
    const hanging = net.connect(port, '127.0.0.1');
    await new Promise(resolve => hanging.once('connect', resolve));
    hanging.write('GET /health HTTP/1.1\r\nHost: 127.0.0.1:' + port + '\r\n');
    const events = []; hanging.on('end', () => events.push('end')); hanging.resume();
    const hangEnded = new Promise(resolve => { hanging.once('error', error => resolve(error.code)); hanging.once('close', () => resolve(events.join(',') || 'closed')); });
    const token = (await (await fetch(base + '/session', { headers: { Origin: origin } })).json()).token;
    const started = Date.now();
    const reply = await fetch(base + '/shutdown', { method: 'POST', headers: { Origin: origin, 'X-Karaoke-Token': token } });
    assert.deepEqual(await reply.json(), { stopped: true });
    const code = await Promise.race([exited, new Promise(resolve => setTimeout(() => resolve('timeout'), 5000))]);
    assert.equal(code, 0, 'helper should exit by itself within 5 s');
    assert.ok(Date.now() - started < 3000, 'exit took ' + (Date.now() - started) + ' ms');
    assert.equal(await hangEnded, 'ECONNRESET', 'open connection should be reset, not left half-closed');
    // The port is free again right away.
    await new Promise((resolve, reject) => { const probe = net.createServer().once('error', reject).listen(port, '127.0.0.1', () => probe.close(resolve)); });
  } finally {
    if (child && child.exitCode === null) child.kill();
    if (path.basename(dir).startsWith('karaoke-shutdown-')) await rm(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});
