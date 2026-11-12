import type { PageStatus, SettingsUpdated } from '../shared/messages';
import type { PublicSettings } from '../shared/settings';
import { ExtensionConnection } from './connection';
import { CaptionController } from './controller';
import type { PlatformFactory } from './platform';

export function startContentScript(createPlatform: PlatformFactory): void {
  let controller: CaptionController | undefined;
  let pageActive = true;
  let generation = 0;
  let pageStatus: PageStatus = 'waiting';
  const statusPorts = new Set<chrome.runtime.Port>();
  const connection = new ExtensionConnection(() => {
    pageActive = false;
    clearController();
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
  });

  function start(settings: PublicSettings): void {
    controller = new CaptionController(createPlatform, settings, connection, publishStatus);
  }

  function publishStatus(status: PageStatus): void {
    if (pageStatus === status) return;
    pageStatus = status;
    for (const port of statusPorts) {
      try {
        port.postMessage(status);
      } catch {
        statusPorts.delete(port);
      }
    }
  }

  function onConnect(port: chrome.runtime.Port): void {
    if (port.name !== 'page-status') return;
    if (!pageActive || !connection.active) {
      port.disconnect();
      return;
    }
    statusPorts.add(port);
    port.onDisconnect.addListener(() => statusPorts.delete(port));
    port.postMessage(pageStatus);
  }

  function onMessage(message: Partial<SettingsUpdated>): void {
    if (!pageActive || !connection.active) return;
    if (message.type === 'settings-updated' && message.settings) {
      if (controller) controller.update(message.settings);
      else start(message.settings);
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
        start(response.data);
    } catch {}
  }

  function clearController(): void {
    generation++;
    controller?.destroy();
    controller = undefined;
    publishStatus('waiting');
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
    chrome.runtime.onConnect.addListener(onConnect);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    void loadSettings();
  }
}
