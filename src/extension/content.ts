import { CaptionController } from './captions';
import { ExtensionConnection } from './connection';
import type { PublicSettings } from '../shared/settings';

let controller: CaptionController | undefined;
let pageActive = true;
let generation = 0;
const connection = new ExtensionConnection(() => {
  pageActive = false;
  clearController();
  window.removeEventListener('pagehide', onPageHide);
  window.removeEventListener('pageshow', onPageShow);
});

function onMessage(message: { type?: string; settings?: PublicSettings }): void {
  if (!pageActive || !connection.active) return;
  if (message.type === 'settings-updated' && message.settings) {
    if (controller) controller.update(message.settings);
    else controller = new CaptionController(message.settings, connection);
  }
}

async function loadSettings(): Promise<void> {
  const requestedGeneration = generation;
  try {
    const response = await connection.sendMessage<PublicSettings>({ type: 'settings' });
    if (
      pageActive &&
      requestedGeneration === generation &&
      connection.active &&
      response?.ok &&
      response.data &&
      !controller
    )
      controller = new CaptionController(response.data, connection);
  } catch {}
}

function clearController(): void {
  generation++;
  controller?.destroy();
  controller = undefined;
}

function onPageHide(): void {
  pageActive = false;
  clearController();
}

function onPageShow(event: PageTransitionEvent): void {
  if (event.persisted && connection.active) {
    pageActive = true;
    void loadSettings();
  }
}

if (connection.active) {
  chrome.runtime.onMessage.addListener(onMessage);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  void loadSettings();
}
