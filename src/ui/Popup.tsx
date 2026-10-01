import { useEffect, useState } from 'react';
import { ArrowRight, Settings2, Subtitles } from 'lucide-react';
import { DEFAULT_SETTINGS, languageName, type Settings } from '../shared/settings';
import { isExtension, loadSettings, saveSettings } from '../shared/storage';
import { Logo, Toggle } from './components';

export function Popup() {
  const [settings, setSettings] = useState<Settings>(structuredClone(DEFAULT_SETTINGS));
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    document.body.classList.add('popup-body');
    void loadSettings()
      .then((value) => {
        setSettings(value);
        setReady(true);
      })
      .catch(() => setError('无法读取设置，请重新打开扩展。'));
    return () => document.body.classList.remove('popup-body');
  }, []);
  async function toggle(enabled: boolean) {
    setBusy(true);
    try {
      const next = { ...settings, enabled };
      await saveSettings(next);
      setSettings(next);
    } catch {
      setError('保存失败，请重试。');
    } finally {
      setBusy(false);
    }
  }
  function options() {
    if (isExtension) void chrome.runtime.openOptionsPage();
    else window.open('./index.html', '_blank', 'noopener');
  }
  const configured = settings.apiKey.trim() && settings.model.trim();
  return (
    <main className="popup">
      <header>
        <Logo small />
        <span className="small-tag">双语字幕</span>
      </header>
      <div className="popup-toggle">
        <span className="enable-icon">
          <Subtitles size={24} />
        </span>
        <div>
          <h1>{settings.enabled ? '双语字幕已开启' : '双语字幕已暂停'}</h1>
          <p>{configured ? '在支持的视频网站自动运行' : 'YouTube 需要配置翻译服务'}</p>
        </div>
        <fieldset disabled={!ready || busy}>
          <Toggle
            label="启用双语字幕"
            checked={settings.enabled}
            onChange={(value) => void toggle(value)}
          />
        </fieldset>
      </div>
      <div className="popup-languages">
        <span>
          <small>学习语言</small>
          {languageName(settings.sourceLanguage)}
        </span>
        <ArrowRight size={17} />
        <span>
          <small>我的母语</small>
          {languageName(settings.targetLanguage)}
        </span>
      </div>
      {error && (
        <p role="alert" className="popup-error">
          {error}
        </p>
      )}
      <p className="popup-hint">
        {configured
          ? '记得开启播放器的原字幕，译文会显示在下方。'
          : 'YouTube 按句调用翻译服务；HBO 可直接使用已有母语字幕。'}
      </p>
      <button className="button primary" onClick={options}>
        <Settings2 size={16} /> 打开设置
      </button>
      <footer>原文与译文，一起看懂。</footer>
    </main>
  );
}
