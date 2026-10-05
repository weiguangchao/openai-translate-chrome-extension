import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';

const extension = path.resolve(process.env.SUBLINE_EXTENSION_PATH ?? 'dist');
const providerDelay = Number(process.env.SUBLINE_PROVIDER_DELAY_MS ?? 40_000);
const extensionId = [...createHash('sha256').update(extension).digest('hex').slice(0, 32)]
  .map((digit) => String.fromCharCode(97 + parseInt(digit, 16)))
  .join('');
const script = `chrome-extension://${extensionId}/background.js`;
const output = path.resolve('.artifacts/worker-lifecycle');
const source = 'The moon is bright tonight.';
const translations = {
  [source]: '今晚的月亮很明亮。',
  'We will meet at the station.': '我们将在车站见面。',
  'The garden is quiet.': '花园很安静。',
};
const cues = [
  { start: 0, end: 20, text: source },
  { start: 30, end: 50, text: 'We will meet at the station.' },
  { start: 65, end: 90, text: 'The garden is quiet.' },
];
const started = Date.now();
const events = [];
const posts = [];
const note = (event, detail = {}) => events.push({ ms: Date.now() - started, event, ...detail });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, timeout, message) {
  for (const deadline = Date.now() + timeout; !(await check()); await sleep(250))
    assert.ok(Date.now() < deadline, message);
}

const profile = await mkdtemp(path.join(tmpdir(), 'subline-lifecycle-'));
execFileSync(
  'openssl',
  [
    ...[
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=www.youtube.com',
    ],
    ...['-keyout', path.join(profile, 'key.pem'), '-out', path.join(profile, 'cert.pem')],
  ],
  { stdio: 'ignore' },
);
const [html, video] = await Promise.all([
  readFile('e2e/fixtures/player.html'),
  readFile('e2e/fixtures/player.webm'),
]);
const server = createServer(
  {
    key: await readFile(path.join(profile, 'key.pem')),
    cert: await readFile(path.join(profile, 'cert.pem')),
  },
  async (request, response) => {
    const url = new URL(request.url, 'https://www.youtube.com');
    if (url.pathname === '/watch')
      return response.writeHead(200, { 'content-type': 'text/html' }).end(html);
    if (url.pathname === '/e2e/player.webm') {
      const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      if (!range)
        return response
          .writeHead(200, { 'content-type': 'video/webm', 'accept-ranges': 'bytes' })
          .end(video);
      const from = Number(range[1]);
      const to = range[2] ? Number(range[2]) : video.length - 1;
      return response
        .writeHead(206, {
          'content-type': 'video/webm',
          'accept-ranges': 'bytes',
          'content-range': `bytes ${from}-${to}/${video.length}`,
        })
        .end(video.subarray(from, to + 1));
    }
    if (url.pathname === '/api/timedtext')
      return response.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          events: cues.map((c) => ({
            tStartMs: c.start * 1000,
            dDurationMs: (c.end - c.start) * 1000,
            segs: [{ utf8: c.text }],
          })),
        }),
      );
    if (url.pathname === '/__e2e_provider__/v1/chat/completions' && request.method === 'POST') {
      let body = '';
      for await (const chunk of request) body += chunk;
      const inputs = JSON.parse(JSON.parse(body).messages.find((m) => m.role === 'user').content);
      const post = { requestedAt: Date.now() - started, inputs: inputs.map((i) => i.text) };
      posts.push(post);
      note('provider-request', { index: posts.length - 1 });
      response.on('close', () => {
        if (response.writableFinished) return;
        post.abortedAt = Date.now() - started;
        note('provider-aborted', { index: posts.indexOf(post) });
      });
      await sleep(providerDelay);
      if (response.destroyed) return;
      const results = inputs.map((i) => ({
        id: i.id,
        parts: [{ translation: translations[i.text] }],
      }));
      response
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ results }) } }] }));
      post.respondedAt = Date.now() - started;
      note('provider-responded', { index: posts.indexOf(post) });
      return;
    }
    note('unexpected-request', { url: url.href });
    response.writeHead(404).end();
  },
);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = spawn(
  chromium.executablePath(),
  [
    '--headless=new',
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-component-extensions-with-background-pages',
    '--ignore-certificate-errors',
    `--host-resolver-rules=MAP www.youtube.com 127.0.0.1:${server.address().port}`,
    '--autoplay-policy=no-user-gesture-required',
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);
let socket;
try {
  let endpoint;
  await until(
    async () => {
      const file = await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '');
      const [port, route] = file.trim().split('\n');
      endpoint = route && `ws://127.0.0.1:${port}${route}`;
      return endpoint;
    },
    15_000,
    'Chromium did not expose a DevTools endpoint',
  );
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  const workers = new Set();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) pending.get(message.id)?.(message);
    const info = message.params?.targetInfo;
    if (message.method === 'Target.targetCreated' && info.url === script) {
      workers.add(info.targetId);
      note('worker-started');
    }
    if (message.method === 'Target.targetDestroyed' && workers.delete(message.params.targetId))
      note('worker-stopped');
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const messageId = ++id;
      pending.set(messageId, (message) =>
        message.error ? reject(new Error(message.error.message)) : resolve(message.result),
      );
      socket.send(JSON.stringify({ id: messageId, method, params, sessionId }));
    });
  async function open(url) {
    const { targetId } = await send('Target.createTarget', { url });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const evaluate = async (expression) =>
      (
        await send(
          'Runtime.evaluate',
          { expression, awaitPromise: true, returnByValue: true },
          sessionId,
        ).catch(() => undefined)
      )?.result?.value;
    await until(
      async () =>
        (await evaluate(
          `location.href === ${JSON.stringify(url)} && document.readyState === 'complete'`,
        )) === true,
      15_000,
      `${url} did not load`,
    );
    return { targetId, evaluate };
  }
  const running = () => workers.size > 0;
  const version = await send('Browser.getVersion');
  await send('Target.setDiscoverTargets', { discover: true });
  await until(running, 15_000, 'The extension worker never started');

  const settingsPage = await open(`chrome-extension://${extensionId}/popup.html`);
  const configured = await settingsPage.evaluate(`(async () => {
    const key = 'subline.settings.v1';
    const current = (await chrome.storage.local.get(key))[key];
    await chrome.storage.local.set({ [key]: { ...current, enabled: true, youtube: true, hbo: true,
      baseUrl: 'https://www.youtube.com/__e2e_provider__/v1', apiKey: 'e2e-fake-key',
      model: 'e2e-fixed-model', sourceLanguage: 'en', targetLanguage: 'zh-CN' } });
    return (await chrome.runtime.sendMessage({ type: 'settings' })).data.configured;
  })()`);
  assert.equal(configured, true, 'The fixture Provider must be configured');
  await send('Target.closeTarget', { targetId: settingsPage.targetId });

  const idleFrom = Date.now();
  await until(
    () => !running(),
    120_000,
    'The extension worker stayed running without a debugger attached',
  );
  const idle = { stoppedAfterMs: Date.now() - idleFrom };

  const demandAt = Date.now();
  const player = await open('https://www.youtube.com/watch?v=first');
  const overlay = () =>
    player.evaluate(`(() => {
      const host = document.querySelector('[data-subline-overlay]');
      const line = (selector) => { const node = host?.shadowRoot?.querySelector(selector); return node && !node.hidden ? node.textContent : ''; };
      return { original: line('.original'), translation: line('.translation') };
    })()`);
  await until(
    async () => (await overlay())?.original === source,
    15_000,
    'The page did not reach the restarted worker',
  );
  assert.ok(running(), 'Page demand must restart the extension worker');
  idle.pageDemandRestartMs = Date.now() - demandAt;

  await player.evaluate(`document.querySelector('video').play().then(() => true)`);
  await until(() => posts.length > 0, 15_000, 'Playback did not send a Provider request');
  const pausedAt = await player.evaluate(
    `(() => { const video = document.querySelector('video'); video.pause(); return video.currentTime; })()`,
  );
  assert.ok(pausedAt < cues[0].end, 'Playback must pause inside the first caption');
  const first = posts[0];
  await until(
    () => first.respondedAt || first.abortedAt,
    providerDelay + 15_000,
    'The delayed Provider request neither finished nor aborted',
  );
  let shown;
  await until(
    async () => {
      shown = await overlay();
      return (
        shown?.translation === translations[source] ||
        Date.now() - started - (first.respondedAt ?? first.abortedAt) > 20_000
      );
    },
    40_000,
    'The page stopped responding',
  );
  const workerStoppedDuringRequest = events.some(
    (e) =>
      e.event === 'worker-stopped' &&
      e.ms > first.requestedAt &&
      e.ms < (first.respondedAt ?? first.abortedAt ?? Infinity),
  );
  const slowProvider = {
    delayMs: providerDelay,
    pausedAt,
    delivered: shown.translation === translations[source],
    workerStoppedDuringRequest,
    firstRequest: first,
    providerRequests: posts.length,
    overlay: shown,
  };
  const report = { browser: version.product, script, idle, slowProvider, events };
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  assert.equal(workerStoppedDuringRequest, false, 'The worker must stay alive for a slow Provider');
  assert.equal(posts.length, 1, 'A slow Provider response must not be requested again');
  assert.equal(slowProvider.delivered, true, 'The slow Provider translation must reach the page');
  console.log(
    `Idle: the worker stopped ${Math.round(idle.stoppedAfterMs / 1000)}s after its last event and restarted ${idle.pageDemandRestartMs}ms after page demand.`,
  );
  console.log(
    `Slow Provider (${providerDelay / 1000}s): translation delivered by one request while the worker stayed alive.`,
  );
} finally {
  socket?.close();
  browser.kill();
  await new Promise((resolve) => browser.once('exit', resolve));
  server.closeAllConnections();
  server.close();
  await rm(profile, { recursive: true, force: true });
}
