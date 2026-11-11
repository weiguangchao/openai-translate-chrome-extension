import { t } from '../shared/i18n';
import { LANGUAGES } from '../shared/languages';
import { PAGE_STATUSES, type PageStatus } from '../shared/messages';
import { platformForUrl } from '../shared/platforms';
import { useEffect, useState } from 'react';
import { Settings2, Subtitles } from 'lucide-react';
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
import { Logo, Select, Toggle } from './components';
import { copy } from './copy';

type PopupStatus = PageStatus | 'checking' | 'unsupported-page' | 'unavailable';
const STATUS_TEXT: Record<PopupStatus, string> = {
  checking: t('正在读取本页状态…', 'Checking this page…'),
  disabled: t('字幕已关闭', 'Subtitles are off'),
  'site-disabled': t('此网站字幕已关闭', 'Subtitles are off for this site'),
  'not-configured': t('请先配置翻译服务', 'Set up translation in settings'),
  'no-video': t('未检测到可用视频', 'No active video found'),
  waiting: t('等待字幕', 'Waiting for captions'),
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
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  ready: boolean;
}) {
  return (
    <div className="popup-language">
      <label htmlFor={id}>{label}</label>
      <Select id={id} value={ready ? value : ''} onChange={onChange}>
        {!ready && <option value="">{t('读取中…', 'Loading…')}</option>}
        {LANGUAGES.map((language) => (
          <option key={language.value} value={language.value}>
            {language.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

function PopupTokens({ usage, ready }: { usage: TokenUsage; ready: boolean }) {
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
            : t('读取中', 'Loading')
        }
      >
        {ready ? formatTokenCount(total) : t('读取中…', 'Loading…')}
      </p>
      <dl className="popup-usage-parts">
        {parts.map(([label, value, className]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd
              className={className}
              title={ready ? formatExactTokens(value) : undefined}
              aria-label={ready ? formatExactTokens(value) : t('读取中', 'Loading')}
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
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pageStatus, setPageStatus] = useState<PopupStatus>('checking');

  useEffect(() => {
    if (!isExtension) {
      setPageStatus('unavailable');
      return;
    }
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function refresh() {
      let next: PopupStatus;
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!platformForUrl(tab?.url)) next = 'unsupported-page';
        else if (tab.id === undefined) next = 'unavailable';
        else {
          const response: unknown = await chrome.tabs.sendMessage(
            tab.id,
            { type: 'page-status' },
            { frameId: 0 },
          );
          next = PAGE_STATUSES.find((status) => status === response) ?? 'unavailable';
        }
      } catch {
        next = 'unavailable';
      }
      if (!active) return;
      setPageStatus(next);
      timer = setTimeout(() => void refresh(), 1000);
    }
    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [settings]);

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
        setReady(true);
      })
      .catch(() => {
        if (active)
          setError(
            t('无法读取设置，请重新打开扩展。', 'Could not load settings. Reopen the extension.'),
          );
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
    setBusy(true);
    setError('');
    try {
      const next = await saveSettings(changes);
      setSettings(next);
    } catch {
      setError(copy.saveFailed);
    } finally {
      setBusy(false);
    }
  }

  async function options() {
    try {
      if (isExtension) await chrome.runtime.openOptionsPage();
      else window.open('./index.html', '_blank', 'noopener');
    } catch {
      setError(t('无法打开设置，请重试。', 'Could not open settings. Try again.'));
    }
  }

  const configured = isProviderConfigured(settings);

  return (
    <main
      className="popup"
      aria-label={t('Subline 控制面板', 'Subline controls')}
      aria-busy={!ready || busy}
    >
      <header className="popup-header">
        <Logo small />
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

      <p className="popup-page-status" role="status" aria-label={t('本页状态', 'Page status')}>
        {STATUS_TEXT[pageStatus]}
      </p>

      <section className={`popup-power ${ready && settings.enabled ? 'is-enabled' : ''}`}>
        <span className="popup-power-icon">
          <Subtitles size={20} aria-hidden />
        </span>
        <h1>{t('双语字幕', 'Bilingual subtitles')}</h1>
        <fieldset disabled={!ready || busy}>
          <Toggle
            label={copy.enableSubtitles}
            checked={ready && settings.enabled}
            onChange={(enabled) => void update({ enabled })}
          />
        </fieldset>
      </section>

      <fieldset
        className="popup-languages"
        disabled={!ready || busy}
        aria-label={t('翻译语言', 'Translation language')}
      >
        <PopupLanguage
          id="popup-target-language"
          label={copy.target}
          value={settings.targetLanguage}
          onChange={(targetLanguage) => void update({ targetLanguage })}
          ready={ready}
        />
        <label className="popup-translation-only">
          <input
            type="checkbox"
            checked={ready && settings.translationOnly}
            disabled={!ready || busy}
            onChange={(event) => void update({ translationOnly: event.target.checked })}
          />
          {t('只显示译文', 'Show translation only')}
        </label>
      </fieldset>

      {ready && !configured && (
        <p className="popup-setup-hint">
          {settings.model.trim()
            ? t('请在设置中配置 API Key。', 'Configure your API Key in settings.')
            : t('请在设置中配置翻译服务。', 'Configure your translation service in settings.')}
        </p>
      )}
      {ready && configured && !hasProviderConsent(settings) && (
        <p className="popup-setup-hint">
          {t(
            '请在设置中同意将字幕发送给 Provider。',
            'Allow subtitles to be sent to your provider in settings.',
          )}
        </p>
      )}

      <details className="popup-details">
        <summary>{t('模型与用量', 'Model and usage')}</summary>
        <section className="popup-model" aria-labelledby="popup-model-label">
          <div className="popup-model-row">
            <h2 id="popup-model-label">
              {settings.provider === 'microsoft' ? 'Provider' : 'Model'}
            </h2>
            {ready && settings.provider === 'microsoft' ? (
              <span className="popup-model-id">Microsoft Translate</span>
            ) : ready && settings.model.trim() ? (
              <code className="popup-model-id" title={settings.model}>
                {settings.model}
              </code>
            ) : (
              <p className="popup-model-empty">
                {ready ? t('未配置', 'Not configured') : t('读取中…', 'Loading…')}
              </p>
            )}
          </div>
        </section>

        <PopupTokens usage={usage} ready={ready} />
      </details>

      {error && (
        <p role="alert" className="popup-error">
          {error}
        </p>
      )}
    </main>
  );
}
