// Prints the worker events chrome-debug's trace reads, in the shape Subline's
// background.ts and queue.ts print them.
const TRACE_PREFIX = '[subline] ';
const SEGMENT_SECONDS = 16;
let batches = 0;

const trace = (event) => console.debug(TRACE_PREFIX + JSON.stringify(event));

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const tab = `${sender.tab?.id}:${sender.frameId}`;
  if (message.type === 'trace') {
    const event = {
      e: 'view',
      tab,
      run: message.run,
      t: message.time,
      state: message.state,
      paused: message.paused,
      seeking: message.seeking,
    };
    if (message.cue !== undefined) event.cue = message.cue;
    if (message.start !== undefined) event.start = message.start;
    if (message.end !== undefined) event.end = message.end;
    if (message.segment !== undefined) event.seg = message.segment;
    if (message.text) event.text = message.text;
    trace(event);
    return false;
  }
  if (message.type === 'translate') {
    const id = ++batches;
    const start = message.segment * SEGMENT_SECONDS;
    trace({ e: 'batch', id, tab, size: 4, start, end: start + SEGMENT_SECONDS });
    trace({ e: 'sent', id });
    setTimeout(() => {
      trace({ e: 'first', id });
      trace({ e: 'done', id, result: 'ok' });
      respond(true);
    }, message.delay);
    return true;
  }
  return false;
});
