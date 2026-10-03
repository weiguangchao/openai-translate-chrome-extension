import { useEffect, useState } from 'react';
import { ArrowLeftRight, Check, LockKeyhole, Settings2, Subtitles } from 'lucide-react';
import { DEFAULT_SETTINGS, LANGUAGES, type Settings } from '../shared/settings';
import { isExtension, loadSettings, saveSettings } from '../shared/storage';
import { Logo, Select, Toggle } from './components';

function PopupLanguage({
  id,
  label,
  value,
  otherLanguage,
  onChange,
  ready,
}: {
  id: string;
  label: string;
  value: string;
  otherLanguage: string;
  onChange: (value: string) => void;
  ready: boolean;
}) {
  return (
    <div className="popup-language">
      <label htmlFor={id}>{label}</label>
      <Select id={id} value={ready ? value : ''} onChange={onChange}>
        {!ready && <option value="">读取中…</option>}
        {LANGUAGES.map((language) => (
          <option
            key={language.value}
            value={language.value}
            disabled={language.value === otherLanguage}
          >
            {language.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function Popup() {
  const [settings, setSettings] = useState<Settings>(structuredClone(DEFAULT_SETTINGS));
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const busy = saveStatus === 'saving';

  useEffect(() => {
    let active = true;
    document.body.classList.add('popup-body');
    void loadSettings()
      .then((value) => {
        if (!active) return;
        setSettings(value);
        setReady(true);
      })
      .catch(() => {
        if (active) setError('无法读取设置，请重新打开扩展。');
      });
    return () => {
      active = false;
      document.body.classList.remove('popup-body');
    };
  }, []);

  async function update(
    changes: Partial<Pick<Settings, 'enabled' | 'sourceLanguage' | 'targetLanguage'>>,
  ) {
    if (!ready || busy) return;
    setSaveStatus('saving');
    setError('');
    try {
      const latest = await loadSettings();
      const next = { ...latest, ...changes };
      if (
        (changes.sourceLanguage !== undefined || changes.targetLanguage !== undefined) &&
        next.sourceLanguage === next.targetLanguage
      ) {
        setSettings(latest);
        setSaveStatus('idle');
        setError('原文和译文语言需要不同。');
        return;
      }
      await saveSettings(next);
      setSettings(next);
      setSaveStatus('saved');
    } catch {
      setSaveStatus('idle');
      setError('保存失败，请重试。');
    }
  }

  async function options() {
    try {
      if (isExtension) await chrome.runtime.openOptionsPage();
      else window.open('./index.html', '_blank', 'noopener');
    } catch {
      setError('无法打开设置，请重试。');
    }
  }

  const configured = Boolean(settings.apiKey.trim() && settings.model.trim());

  return (
    <main className="popup" aria-label="Subline 控制面板" aria-busy={!ready || busy}>
      <header className="popup-header">
        <Logo small />
        <button className="popup-settings" onClick={() => void options()}>
          <Settings2 size={16} aria-hidden />
          设置
        </button>
      </header>

      <section className={`popup-power ${ready && settings.enabled ? 'is-enabled' : ''}`}>
        <span className="popup-power-icon">
          <Subtitles size={20} aria-hidden />
        </span>
        <div className="popup-power-label">
          <h1>双语字幕</h1>
          <p>{!ready ? '读取中…' : settings.enabled ? '已开启' : '已关闭'}</p>
        </div>
        <fieldset disabled={!ready || busy}>
          <Toggle
            label="启用双语字幕"
            checked={ready && settings.enabled}
            onChange={(enabled) => void update({ enabled })}
          />
        </fieldset>
      </section>

      <fieldset className="popup-languages" disabled={!ready || busy} aria-label="翻译语言">
        <PopupLanguage
          id="popup-source-language"
          label="原文语言"
          value={settings.sourceLanguage}
          otherLanguage={settings.targetLanguage}
          onChange={(sourceLanguage) => void update({ sourceLanguage })}
          ready={ready}
        />
        <button
          className="popup-swap"
          aria-label="互换原文和译文语言"
          title="互换原文和译文语言"
          onClick={() =>
            void update({
              sourceLanguage: settings.targetLanguage,
              targetLanguage: settings.sourceLanguage,
            })
          }
        >
          <ArrowLeftRight size={16} aria-hidden />
        </button>
        <PopupLanguage
          id="popup-target-language"
          label="译文语言"
          value={settings.targetLanguage}
          otherLanguage={settings.sourceLanguage}
          onChange={(targetLanguage) => void update({ targetLanguage })}
          ready={ready}
        />
      </fieldset>

      <section className="popup-model" aria-labelledby="popup-model-label">
        <div className="popup-model-heading">
          <h2 id="popup-model-label">Model ID</h2>
          <span>
            <LockKeyhole size={11} aria-hidden /> 只读
          </span>
        </div>
        {ready && settings.model.trim() ? (
          <code className="popup-model-id" title={settings.model}>
            {settings.model}
          </code>
        ) : (
          <p className="popup-model-empty">{ready ? '未配置' : '读取中…'}</p>
        )}
        {ready && !configured && (
          <p className="popup-setup-hint">
            请在设置中配置{settings.model.trim() ? ' API Key' : '翻译服务'}。
          </p>
        )}
      </section>

      <div className="popup-feedback" role="status">
        {busy ? (
          '正在保存…'
        ) : saveStatus === 'saved' ? (
          <>
            <Check size={12} aria-hidden />
            已保存
          </>
        ) : (
          ''
        )}
      </div>
      {error && (
        <p role="alert" className="popup-error">
          {error}
        </p>
      )}
    </main>
  );
}
