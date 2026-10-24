import { t } from '../shared/i18n';
import { LANGUAGES } from '../shared/languages';
import { useEffect, useState } from 'react';
import { Settings2, Subtitles } from 'lucide-react';
import { DEFAULT_SETTINGS, hasProviderConsent, type Settings } from '../shared/settings';
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

  const configured = Boolean(settings.apiKey.trim() && settings.model.trim());

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
        </button>
      </header>

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

      <section className="popup-model" aria-labelledby="popup-model-label">
        <div className="popup-model-row">
          <h2 id="popup-model-label">Model</h2>
          {ready && settings.model.trim() ? (
            <code className="popup-model-id" title={settings.model}>
              {settings.model}
            </code>
          ) : (
            <p className="popup-model-empty">
              {ready ? t('未配置', 'Not configured') : t('读取中…', 'Loading…')}
            </p>
          )}
        </div>
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
      </section>

      <PopupTokens usage={usage} ready={ready} />

      {error && (
        <p role="alert" className="popup-error">
          {error}
        </p>
      )}
    </main>
  );
}
