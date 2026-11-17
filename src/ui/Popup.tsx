import { t } from '../shared/i18n';
import { LANGUAGES } from '../shared/languages';
import { PAGE_STATUSES, type PageStatus } from '../shared/messages';
import { platformForUrl } from '../shared/platforms';
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, CircleAlert, Settings2, Subtitles } from 'lucide-react';
import {
  DEFAULT_SETTINGS,
  hasProviderConsent,
  isProviderConfigured,
  type Settings,
} from '../shared/settings';
import { isExtension, loadSettings, saveSettings } from '../shared/storage';
import {
  formatExactTokens,
  formatTokenCount,
  loadTokenUsage,
  tokenTotal,
  watchTokenUsage,
  type TokenUsage,
} from '../shared/token-usage';
import { CaptionMode, Logo, Select, Toggle } from './components';
import { copy } from './copy';

type PopupStatus = PageStatus | 'checking' | 'unsupported-page' | 'unavailable';
const STATUS_TEXT: Record<PopupStatus, string> = {
  checking: t('正在读取本页状态…', 'Checking this page…'),
  disabled: t('字幕已关闭', 'Subtitles are off'),
  'site-disabled': t('此网站字幕已关闭', 'Subtitles are off for this site'),
  'not-configured': t('翻译服务尚未就绪', 'Translation service is not ready'),
  'no-video': t('未检测到可用视频', 'No active video found'),
  waiting: t('等待字幕', 'Waiting for captions'),
  'source-error': t(
    '字幕轨加载失败，已恢复网站字幕',
    'Caption track failed to load; website captions restored',
  ),
  'source-unavailable': t(
    '无法读取字幕轨，已恢复网站字幕',
    'Caption track unavailable; website captions restored',
  ),
  loading: t('正在翻译当前字幕', 'Translating the current caption'),
  bilingual: t('正在显示双语字幕', 'Showing bilingual subtitles'),
  'translation-only': t('正在显示译文', 'Showing translated subtitles'),
  original: t('正在显示原文字幕', 'Showing original subtitles'),
  error: t('字幕翻译失败', 'Caption translation failed'),
  'unsupported-language': t('原文语言不支持', 'Unsupported caption language'),
  'unsupported-page': t('本页不支持字幕', 'Subtitles are not supported on this page'),
  unavailable: t('无法读取本页状态', "Could not read this page's status"),
};

function PopupLanguage({
  id,
  label,
  value,
  onChange,
  ready,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  ready: boolean;
  placeholder: string;
}) {
  return (
    <div className="popup-language">
      <label htmlFor={id}>{label}</label>
      <Select id={id} value={ready ? value : ''} onChange={onChange}>
        {!ready && <option value="">{placeholder}</option>}
        {LANGUAGES.map((language) => (
          <option key={language.value} value={language.value}>
            {language.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

function PopupTokens({
  usage,
  ready,
  placeholder,
}: {
  usage: TokenUsage;
  ready: boolean;
  placeholder: string;
}) {
  const total = tokenTotal(usage);
  const parts = [
    [t('输入', 'Input'), usage.input, 'popup-usage-input'],
    [t('输出', 'Output'), usage.output, 'popup-usage-output'],
    [t('缓存', 'Cache'), usage.cache, 'popup-usage-cache'],
  ] as const;
  return (
    <section className="popup-usage" aria-labelledby="popup-usage-label">
      <h2 id="popup-usage-label">{t('Token 消耗', 'Token usage')}</h2>
      <p
        className="popup-usage-total"
        title={ready ? formatExactTokens(total) : undefined}
        aria-label={
          ready
            ? t(`总共 ${formatExactTokens(total)}`, `Total ${formatExactTokens(total)}`)
            : placeholder
        }
      >
        {ready ? formatTokenCount(total) : placeholder}
      </p>
      <dl className="popup-usage-parts">
        {parts.map(([label, value, className]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd
              className={className}
              title={ready ? formatExactTokens(value) : undefined}
              aria-label={ready ? formatExactTokens(value) : placeholder}
            >
              {ready ? formatTokenCount(value) : '—'}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function Popup() {
  const [settings, setSettings] = useState<Settings>(structuredClone(DEFAULT_SETTINGS));
  const [usage, setUsage] = useState<TokenUsage>({ input: 0, output: 0, cache: 0 });
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const ready = loadState === 'ready';
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const focusAfterSave = useRef<HTMLElement | null>(null);
  const [pageStatus, setPageStatus] = useState<PopupStatus>('checking');

  useEffect(() => {
    if (busy) return;
    const control = focusAfterSave.current;
    focusAfterSave.current = null;
    if (control?.isConnected && document.activeElement === document.body) control.focus();
  }, [busy]);

  useEffect(() => {
    if (!isExtension) {
      setPageStatus('unavailable');
      return;
    }
    let active = true;
    let revision = 0;
    let tabId: number | undefined;
    let port: chrome.runtime.Port | undefined;
    async function refresh() {
      const requested = ++revision;
      const previous = port;
      port = undefined;
      previous?.disconnect();
      setPageStatus('checking');
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!active || requested !== revision) return;
        tabId = tab?.id;
        if (!platformForUrl(tab?.url)) setPageStatus('unsupported-page');
        else if (tab.id === undefined) setPageStatus('unavailable');
        else {
          const subscription = chrome.tabs.connect(tab.id, { name: 'page-status', frameId: 0 });
          port = subscription;
          subscription.onMessage.addListener((response: unknown) => {
            if (active && port === subscription)
              setPageStatus(PAGE_STATUSES.find((status) => status === response) ?? 'unavailable');
          });
          subscription.onDisconnect.addListener(() => {
            void chrome.runtime.lastError;
            if (active && port === subscription) {
              port = undefined;
              setPageStatus('unavailable');
            }
          });
        }
      } catch {
        if (active && requested === revision) setPageStatus('unavailable');
      }
    }
    const onActivated = () => void refresh();
    function onUpdated(id: number, changes: chrome.tabs.TabChangeInfo) {
      if (id === tabId && (changes.url !== undefined || changes.status === 'complete'))
        void refresh();
    }
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    void refresh();
    return () => {
      active = false;
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      port?.disconnect();
    };
  }, []);

  useEffect(() => {
    let active = true;
    let seen = false;
    document.body.classList.add('popup-body');
    const stop = watchTokenUsage((value) => {
      if (!active) return;
      seen = true;
      setUsage(value);
    });
    void Promise.all([loadSettings(), loadTokenUsage()])
      .then(([value, tokens]) => {
        if (!active) return;
        setSettings(value);
        if (!seen) setUsage(tokens);
        setLoadState('ready');
      })
      .catch(() => {
        if (active) {
          setLoadState('error');
          setError(
            t('无法读取设置，请重新打开扩展。', 'Could not load settings. Reopen the extension.'),
          );
        }
      });
    return () => {
      active = false;
      stop();
      document.body.classList.remove('popup-body');
    };
  }, []);

  async function update(
    changes: Partial<Pick<Settings, 'enabled' | 'targetLanguage' | 'translationOnly'>>,
  ) {
    if (!ready || busy) return;
    focusAfterSave.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setBusy(true);
    setSaved(false);
    setError('');
    try {
      const next = await saveSettings(changes);
      setSettings(next);
      setSaved(true);
    } catch {
      setError(copy.saveFailed);
    } finally {
      setBusy(false);
    }
  }

  async function options(page?: 'service') {
    try {
      if (isExtension) {
        if (page) {
          const base = chrome.runtime.getURL('index.html');
          const existing = (await chrome.runtime.getContexts({})).find(
            (context) => context.tabId >= 0 && context.documentUrl?.split(/[?#]/, 1)[0] === base,
          );
          if (existing) {
            const url = new URL(existing.documentUrl!);
            url.hash = page;
            await chrome.tabs.update(existing.tabId, { url: url.href, active: true });
            await chrome.windows.update(existing.windowId, { focused: true });
          } else await chrome.tabs.create({ url: `${base}#${page}` });
        } else await chrome.runtime.openOptionsPage();
      } else window.open(`./index.html${page ? `#${page}` : ''}`, '_blank', 'noopener');
    } catch {
      setError(t('无法打开设置，请重试。', 'Could not open settings. Try again.'));
    }
  }

  const configured = isProviderConfigured(settings);
  const statusText =
    pageStatus === 'not-configured' && ready && configured && !hasProviderConsent(settings)
      ? t('等待字幕数据授权', 'Caption data consent needed')
      : STATUS_TEXT[pageStatus];
  const placeholder =
    loadState === 'error' ? t('读取失败', 'Could not load') : t('读取中…', 'Loading…');

  return (
    <main
      className="popup"
      aria-label={t('Subline 控制面板', 'Subline controls')}
      aria-busy={loadState === 'loading' || busy}
    >
      <header className="popup-header">
        <Logo small />
        <p className="popup-save-state" role="status">
          {saved && !busy && <Check size={12} aria-hidden />}
          {busy ? t('正在保存…', 'Saving…') : saved ? t('已保存', 'Saved') : ''}
        </p>
        <button
          className="popup-settings"
          aria-label={t('设置', 'Settings')}
          title={t('设置', 'Settings')}
          onClick={() => void options()}
        >
          <Settings2 size={16} aria-hidden />
          <span>{t('设置', 'Settings')}</span>
        </button>
      </header>

      <section className={`popup-control ${ready && settings.enabled ? 'is-enabled' : ''}`}>
        <div className="popup-power">
          <span className="popup-power-icon">
            <Subtitles size={20} aria-hidden />
          </span>
          <div className="popup-power-text">
            <h1>{copy.subtitles}</h1>
            <span className="popup-power-scope">{t('所有支持的网站', 'All supported sites')}</span>
          </div>
          <fieldset disabled={!ready || busy}>
            <Toggle
              label={copy.enableSubtitles}
              checked={ready && settings.enabled}
              onChange={(enabled) => void update({ enabled })}
            />
          </fieldset>
        </div>
        <p
          className="popup-page-status"
          data-status={pageStatus}
          role="status"
          aria-atomic="true"
          aria-label={t('本页状态', 'Page status')}
        >
          {pageStatus === 'error' ? <CircleAlert size={14} aria-hidden /> : <i aria-hidden />}
          {statusText}
        </p>
        {ready && (!configured || !hasProviderConsent(settings)) && (
          <button
            className="text-button popup-setup-action"
            onClick={() => void options('service')}
          >
            {configured ? copy.reviewConsent : t('配置翻译服务', 'Set up translation service')}
            <ChevronRight size={14} aria-hidden />
          </button>
        )}
      </section>

      <fieldset className="popup-languages" disabled={!ready || busy}>
        <PopupLanguage
          id="popup-target-language"
          label={copy.translationLanguage}
          value={settings.targetLanguage}
          onChange={(targetLanguage) => void update({ targetLanguage })}
          ready={ready}
          placeholder={placeholder}
        />
        <CaptionMode
          name="popup-display-mode"
          value={ready ? settings.translationOnly : null}
          onChange={(translationOnly) => void update({ translationOnly })}
        />
      </fieldset>

      <details className="popup-details">
        <summary>
          {t('模型与用量', 'Model and usage')}
          <ChevronDown size={15} aria-hidden />
        </summary>
        <section className="popup-model" aria-labelledby="popup-model-label">
          <div className="popup-model-row">
            <h2 id="popup-model-label">
              {settings.provider === 'microsoft' ? copy.translationService : t('模型', 'Model')}
            </h2>
            {ready && settings.provider === 'microsoft' ? (
              <span className="popup-model-id">Microsoft Translate</span>
            ) : ready && settings.model.trim() ? (
              <code className="popup-model-id" title={settings.model}>
                {settings.model}
              </code>
            ) : (
              <p className="popup-model-empty">
                {ready ? t('未配置', 'Not configured') : placeholder}
              </p>
            )}
          </div>
        </section>

        <PopupTokens usage={usage} ready={ready} placeholder={placeholder} />
      </details>

      {error && (
        <p role="alert" className="popup-error">
          {error}
        </p>
      )}
    </main>
  );
}
