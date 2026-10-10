// Draws Subline's overlay and reports trace views the way src/core/trace.ts does.
// A cue starts every 4 s of video and lasts 3.5 s; four cues make a segment, and
// a segment shows the loading placeholder until the worker answers after
// ?delay= milliseconds (default 600). ?hidden=1 hides the overlay host with CSS.
const TRACE_ATTRIBUTE = 'data-subline-trace';
const TRACE_WORKER_ATTRIBUTE = 'data-subline-trace-worker';
const LOADING_TRANSLATION = '翻译中';
const HEARTBEAT_MS = 2000;
const CUE_SECONDS = 4;
const CUE_LENGTH = 3.5;
const SEGMENT_CUES = 4;

const params = new URLSearchParams(location.search);
const delay = Number(params.get('delay') ?? 600);
const segments = new Map();
let overlay = null;
let last = '';
let sentAt = 0;

document.documentElement.dataset.fixtureBuild = chrome.runtime.getManifest().version;

function mount(video) {
  const host = document.createElement('div');
  host.dataset.sublineOverlay = '';
  if (params.has('hidden')) host.style.display = 'none';
  const root = host.attachShadow({ mode: 'open' });
  const original = document.createElement('div');
  original.className = 'line original';
  const translation = document.createElement('div');
  translation.className = 'line translation';
  original.hidden = translation.hidden = true;
  root.append(original, translation);
  video.parentElement.append(host);
  return { original, translation };
}

function captionAt(time) {
  const cue = Math.floor(time / CUE_SECONDS);
  const start = cue * CUE_SECONDS;
  if (time - start >= CUE_LENGTH) return null;
  return { cue, start, end: start + CUE_LENGTH, segment: Math.floor(cue / SEGMENT_CUES), text: `Line ${cue}` };
}

function translate(segment) {
  if (segments.has(segment)) return;
  segments.set(segment, false);
  chrome.runtime.sendMessage({ type: 'translate', segment, delay }).then(
    () => segments.set(segment, true),
    () => segments.delete(segment),
  );
}

function render(caption, state) {
  const { original, translation } = overlay;
  original.hidden = state !== 'ready';
  original.textContent = state === 'ready' ? caption.text : '';
  translation.hidden = state === 'empty';
  translation.textContent =
    state === 'ready' ? `译文 ${caption.cue}` : state === 'loading' ? LOADING_TRANSLATION : '';
}

function report(video, caption, state) {
  const root = document.documentElement;
  const run = root.getAttribute(TRACE_ATTRIBUTE);
  if (!run) {
    last = '';
    return;
  }
  if (root.getAttribute(TRACE_WORKER_ATTRIBUTE) !== chrome.runtime.id)
    root.setAttribute(TRACE_WORKER_ATTRIBUTE, chrome.runtime.id);
  const key = JSON.stringify([run, caption, state, video.paused, video.seeking]);
  const now = Date.now();
  if (key === last && (video.paused || now - sentAt < HEARTBEAT_MS)) return;
  last = key;
  sentAt = now;
  chrome.runtime
    .sendMessage({
      type: 'trace',
      run: run.slice(0, 64),
      time: Math.round(video.currentTime * 100) / 100,
      paused: video.paused,
      seeking: video.seeking,
      state,
      ...caption,
    })
    .catch(() => {});
}

function tick() {
  const video = document.querySelector('video');
  if (!video) return;
  overlay ??= mount(video);
  const caption = captionAt(video.currentTime);
  let state = 'empty';
  if (caption) {
    translate(caption.segment);
    translate(caption.segment + 1);
    state = segments.get(caption.segment) ? 'ready' : 'loading';
  }
  render(caption, state);
  report(video, caption, state);
}

setInterval(tick, 100);
