import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeftRight,
  Check,
  ChevronRight,
  CircleHelp,
  Eye,
  EyeOff,
  Globe2,
  Info,
  Languages,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  MonitorPlay,
  PlugZap,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Subtitles,
} from 'lucide-react';
import {
  DEFAULT_SETTINGS,
  languageName,
  validateSettings,
  type Settings,
} from '../shared/settings';
import {
  allowApiHost,
  apiAction,
  isExtension,
  loadCachedModels,
  loadSettings,
  saveCachedModels,
  saveSettings,
} from '../shared/storage';
import {
  HboMark,
  LanguageSelect,
  Logo,
  Select,
  SubtitlePreview,
  Toggle,
  XMark,
  YoutubeMark,
} from './components';
import { useAlert } from './Alert';

type Page = 'general' | 'appearance';
const PAGES = [
  {
    id: 'general' as const,
    name: '常规设置',
    icon: Settings2,
  },
  {
    id: 'appearance' as const,
    name: '字幕样式',
    icon: SlidersHorizontal,
  },
];

function Section({
  icon,
  title,
  description,
  children,
  className = '',
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`settings-section ${className}`}>
      <div className="section-heading">
        <span className="section-icon">{icon}</span>
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export function App() {
  const [page, setPage] = useState<Page>('general');
  const [settings, setSettings] = useState<Settings>(structuredClone(DEFAULT_SETTINGS));
  const [saved, setSaved] = useState(JSON.stringify(DEFAULT_SETTINGS));
  const [ready, setReady] = useState(false);
  const { alert, showAlert } = useAlert();
  const [busy, setBusy] = useState<'save' | 'models' | 'test' | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const modelsVersion = useRef(0);
  const [manualModel, setManualModel] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [connection, setConnection] = useState('');
  const dirty = ready && JSON.stringify(settings) !== saved;
  const current = PAGES.find((item) => item.id === page)!;
  const fingerprint = JSON.stringify([settings.baseUrl, settings.apiKey, settings.model]);
  const connected = connection === fingerprint;

  useEffect(() => {
    void loadSettings()
      .then((value) => {
        setSettings(value);
        setSaved(JSON.stringify(value));
        setReady(true);
        if (!isExtension)
          showAlert({ kind: 'info', text: '浏览器预览：API Key 刷新后需重新填写。' });
      })
      .catch(() => {
        showAlert({ kind: 'error', text: '无法读取本地设置，请检查浏览器存储权限。' });
      });
  }, [showAlert]);
  useEffect(() => {
    if (!ready) return;
    const version = ++modelsVersion.current;
    void loadCachedModels({ baseUrl: settings.baseUrl, apiKey: settings.apiKey }).then((ids) => {
      if (modelsVersion.current === version) setModels(ids);
    });
    return () => {
      modelsVersion.current++;
    };
  }, [ready, settings.baseUrl, settings.apiKey]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((previous) => ({ ...previous, [key]: value }));
    if (key === 'baseUrl' || key === 'apiKey') setModels([]);
  }
  function navigate(next: Page) {
    setPage(next);
    document.querySelector('.workspace')?.scrollTo({ top: 0 });
  }
  async function save() {
    try {
      validateSettings(settings);
      const permission = settings.apiKey.trim() ? allowApiHost(settings) : Promise.resolve();
      setBusy('save');
      await permission;
      const normalized = {
        ...settings,
        baseUrl: settings.baseUrl.trim().replace(/\/+$/, ''),
        apiKey: settings.apiKey.trim(),
        model: settings.model.trim(),
      };
      await saveSettings(normalized);
      setSettings(normalized);
      setSaved(JSON.stringify(normalized));
      showAlert({
        kind: 'success',
        text: isExtension
          ? '设置已保存，已打开的视频页面会自动应用。'
          : '预览设置已保存。API Key 仅保留在当前页面，安装扩展后可本地保存。',
      });
    } catch (error) {
      showAlert({
        kind: 'error',
        text: error instanceof Error ? error.message : '保存失败，请重试。',
      });
    } finally {
      setBusy(null);
    }
  }
  async function runApi(kind: 'models' | 'test') {
    try {
      if (!settings.apiKey.trim()) throw new Error('请先填写 API Key，再连接翻译服务。');
      if (kind === 'test') validateSettings(settings, true);
      const permission = allowApiHost(settings);
      const requestSettings = structuredClone(settings);
      setBusy(kind);
      await permission;
      const result = await apiAction(kind, requestSettings);
      if (kind === 'models') {
        const ids = result as string[];
        modelsVersion.current++;
        setModels(ids);
        setManualModel(false);
        if (!requestSettings.model) update('model', ids[0]);
        await saveCachedModels(requestSettings, ids);
        showAlert({
          kind: 'success',
          text: `已获取 ${ids.length} 个模型，请选择支持文本翻译的模型。`,
        });
      } else {
        setConnection(
          JSON.stringify([requestSettings.baseUrl, requestSettings.apiKey, requestSettings.model]),
        );
        showAlert({
          kind: 'success',
          text: '连接测试成功',
        });
      }
    } catch (error) {
      if (kind === 'test') setConnection('');
      showAlert({ kind: 'error', text: error instanceof Error ? error.message : '接口请求失败。' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="app-shell">
      {alert}
      <aside className="sidebar">
        <Logo />
        <div className="sidebar-rule" />
        <nav aria-label="设置导航">
          {PAGES.map(({ id, name, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${page === id ? 'active' : ''}`}
              aria-current={page === id ? 'page' : undefined}
              onClick={() => navigate(id)}
            >
              <Icon size={19} />
              <span>{name}</span>
              {page === id && <i />}
            </button>
          ))}
        </nav>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <Settings2 size={15} />
            <span>偏好设置</span>
            <ChevronRight size={13} />
            <span>{current.name}</span>
          </div>
        </header>
        <div className={`page-content ${page === 'general' ? 'general-page' : ''}`}>
          <div className="page-heading">
            <h1>{current.name}</h1>
            <button
              className="button primary save-button"
              onClick={() => void save()}
              disabled={!dirty || Boolean(busy) || !ready}
            >
              {busy === 'save' ? (
                <LoaderCircle size={16} className="spinning" />
              ) : (
                <Check size={17} />
              )}{' '}
              {dirty ? '保存更改' : '已保存'}
            </button>
          </div>
          <div className={`content-grid ${page === 'appearance' ? 'with-preview' : ''}`}>
            <div className="settings-column">
              {page === 'general' && (
                <>
                  <div className={`enable-panel ${settings.enabled ? '' : 'disabled-panel'}`}>
                    <span className="enable-icon">
                      <Subtitles size={23} />
                    </span>
                    <div>
                      <h2>
                        启用双语字幕{' '}
                        <span className="small-tag">{settings.enabled ? '已开启' : '已关闭'}</span>
                      </h2>
                    </div>
                    <Toggle
                      label="启用双语字幕"
                      checked={settings.enabled}
                      onChange={(value) => update('enabled', value)}
                    />
                  </div>
                  <Section icon={<Languages size={19} />} title="字幕语言">
                    <div className="language-pair">
                      <div className="field">
                        <label htmlFor="source-language">原文语言</label>
                        <LanguageSelect
                          id="source-language"
                          value={settings.sourceLanguage}
                          onChange={(value) => update('sourceLanguage', value)}
                        />
                      </div>
                      <button
                        className="swap-button"
                        aria-label="互换原文和译文语言"
                        title="交换语言"
                        onClick={() =>
                          setSettings((previous) => ({
                            ...previous,
                            sourceLanguage: previous.targetLanguage,
                            targetLanguage: previous.sourceLanguage,
                          }))
                        }
                      >
                        <ArrowLeftRight size={17} />
                      </button>
                      <div className="field">
                        <label htmlFor="target-language">译文语言</label>
                        <LanguageSelect
                          id="target-language"
                          value={settings.targetLanguage}
                          onChange={(value) => update('targetLanguage', value)}
                        />
                      </div>
                    </div>
                    <p className="field-hint language-hint">
                      <Info size={13} /> 请在视频播放器中，将原字幕语言设置为
                      {languageName(settings.sourceLanguage)}。
                    </p>
                  </Section>
                  <Section
                    icon={<PlugZap size={19} />}
                    title="Provider"
                    description="OpenAI 兼容接口"
                    className="api-section"
                  >
                    <div className={`connection-badge ${connected ? 'connected' : ''}`}>
                      <i />
                      {connected
                        ? '连接正常'
                        : settings.apiKey && settings.model
                          ? '等待测试'
                          : '待配置'}
                    </div>
                    <fieldset disabled={Boolean(busy)}>
                      <div className="field">
                        <label htmlFor="base-url">
                          Base URL{' '}
                          <span
                            className="field-tip"
                            title="填写包含版本路径的接口根地址，例如 https://api.openai.com/v1"
                          >
                            <CircleHelp size={13} />
                          </span>
                        </label>
                        <div className="input-icon">
                          <Globe2 size={16} />
                          <input
                            id="base-url"
                            type="url"
                            value={settings.baseUrl}
                            onChange={(event) => update('baseUrl', event.target.value)}
                            placeholder="https://api.openai.com/v1"
                            spellCheck={false}
                          />
                        </div>
                        <p className="field-hint">填写接口根地址，无需添加 /chat/completions</p>
                      </div>
                      <div className="field">
                        <label htmlFor="api-key">
                          API Key{' '}
                          <span className="label-side">
                            <LockKeyhole size={11} />
                            {isExtension ? '仅本地保存' : '仅当前页面有效'}
                          </span>
                        </label>
                        <div className="input-icon key-input">
                          <LockKeyhole size={16} />
                          <input
                            id="api-key"
                            type={showKey ? 'text' : 'password'}
                            value={settings.apiKey}
                            onChange={(event) => update('apiKey', event.target.value)}
                            placeholder="输入你的 API Key"
                            autoComplete="off"
                            spellCheck={false}
                          />
                          <button
                            type="button"
                            aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
                            onClick={() => setShowKey((value) => !value)}
                          >
                            {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                      </div>
                      <div className="field">
                        <label htmlFor="model">
                          Model ID{' '}
                          <button
                            className="text-button"
                            onClick={() => setManualModel((value) => !value)}
                          >
                            {manualModel ? '从列表选择' : '手动填写'}
                          </button>
                        </label>
                        <div className="model-row">
                          {manualModel ? (
                            <input
                              id="model"
                              value={settings.model}
                              onChange={(event) => update('model', event.target.value)}
                              placeholder="输入服务商提供的 Model ID"
                              spellCheck={false}
                            />
                          ) : (
                            <Select
                              id="model"
                              value={settings.model}
                              onChange={(value) => update('model', value)}
                            >
                              <option value="">选择翻译模型</option>
                              {[
                                ...new Set([
                                  ...(settings.model ? [settings.model] : []),
                                  ...models,
                                ]),
                              ].map((model) => (
                                <option key={model} value={model}>
                                  {model}
                                </option>
                              ))}
                            </Select>
                          )}
                          <button
                            className="button secondary fetch-button"
                            onClick={() => void runApi('models')}
                          >
                            <RefreshCw size={14} className={busy === 'models' ? 'spinning' : ''} />{' '}
                            {busy === 'models' ? '获取中' : '获取模型'}
                          </button>
                        </div>
                      </div>
                    </fieldset>
                    <div className="api-footer">
                      <span>
                        <ShieldCheck size={14} /> API Key 不会发送给视频网站
                      </span>
                      <button
                        className="button secondary test-button"
                        disabled={Boolean(busy)}
                        onClick={() => void runApi('test')}
                      >
                        {busy === 'test' ? (
                          <LoaderCircle size={14} className="spinning" />
                        ) : (
                          <PlugZap size={14} />
                        )}{' '}
                        {busy === 'test' ? '连接中…' : '测试连接'}
                      </button>
                    </div>
                  </Section>
                  <Section icon={<MonitorPlay size={19} />} title="支持的网站">
                    <div className="site-options">
                      <div>
                        <YoutubeMark />
                        <span>YouTube</span>
                        <Toggle
                          label="在 YouTube 启用"
                          checked={settings.youtube}
                          onChange={(value) => update('youtube', value)}
                        />
                      </div>
                      <div>
                        <HboMark />
                        <span>HBO Max</span>
                        <Toggle
                          label="在 HBO Max 启用"
                          checked={settings.hbo}
                          onChange={(value) => update('hbo', value)}
                        />
                      </div>
                      <div>
                        <XMark />
                        <span>X（推特）</span>
                        <Toggle
                          label="在 X（推特）启用"
                          checked={settings.x}
                          onChange={(value) => update('x', value)}
                        />
                      </div>
                    </div>
                  </Section>
                </>
              )}
              {page === 'appearance' && (
                <>
                  {(['original', 'translation'] as const).map((kind) => (
                    <Section
                      key={kind}
                      icon={kind === 'original' ? <Subtitles size={19} /> : <Languages size={19} />}
                      title={kind === 'original' ? '原文样式' : '译文样式'}
                    >
                      <div className="color-field">
                        <label htmlFor={`${kind}-color`}>字体颜色</label>
                        <div className="color-controls">
                          <label
                            className="color-picker"
                            style={{ backgroundColor: settings[kind].color }}
                          >
                            <input
                              id={`${kind}-color`}
                              type="color"
                              value={settings[kind].color}
                              onChange={(event) =>
                                update(kind, { ...settings[kind], color: event.target.value })
                              }
                            />
                            <span className="sr-only">
                              {kind === 'original' ? '原文' : '译文'}字体颜色
                            </span>
                          </label>
                          <span className="color-value">{settings[kind].color.toUpperCase()}</span>
                          <div className="color-presets">
                            {['#FFFFFF', '#B8E5CF', '#FFE3A3', '#A9D5FF', '#F2B8D5'].map(
                              (color) => (
                                <button
                                  key={color}
                                  aria-label={`${kind === 'original' ? '原文' : '译文'}颜色 ${color}`}
                                  title={color}
                                  className={
                                    settings[kind].color.toUpperCase() === color ? 'selected' : ''
                                  }
                                  style={{ backgroundColor: color }}
                                  onClick={() => update(kind, { ...settings[kind], color })}
                                >
                                  {settings[kind].color.toUpperCase() === color && (
                                    <Check size={13} />
                                  )}
                                </button>
                              ),
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="range-field">
                        <label htmlFor={`${kind}-size`}>
                          字体大小{' '}
                          <output>
                            {settings[kind].size}
                            <small> px</small>
                          </output>
                        </label>
                        <input
                          id={`${kind}-size`}
                          type="range"
                          min={12}
                          max={48}
                          value={settings[kind].size}
                          onChange={(event) =>
                            update(kind, { ...settings[kind], size: Number(event.target.value) })
                          }
                        />
                        <div className="range-labels">
                          <span>12 px</span>
                          <span>48 px</span>
                        </div>
                      </div>
                    </Section>
                  ))}
                  <Section icon={<Layers3 size={19} />} title="间距与背景">
                    <div className="range-field">
                      <label htmlFor="subtitle-gap">
                        两行字幕间距{' '}
                        <output>
                          {settings.subtitleGap}
                          <small> px</small>
                        </output>
                      </label>
                      <input
                        id="subtitle-gap"
                        type="range"
                        min={0}
                        max={24}
                        value={settings.subtitleGap}
                        onChange={(event) => update('subtitleGap', Number(event.target.value))}
                      />
                      <div className="range-labels">
                        <span>紧凑</span>
                        <span>宽松</span>
                      </div>
                    </div>
                    <div className="range-field">
                      <label htmlFor="background-opacity">
                        译文背景不透明度{' '}
                        <output>
                          {settings.backgroundOpacity}
                          <small> %</small>
                        </output>
                      </label>
                      <input
                        id="background-opacity"
                        type="range"
                        min={0}
                        max={90}
                        value={settings.backgroundOpacity}
                        onChange={(event) =>
                          update('backgroundOpacity', Number(event.target.value))
                        }
                      />
                      <div className="range-labels">
                        <span>透明</span>
                        <span>深色</span>
                      </div>
                    </div>
                    <button
                      className="text-button reset-style"
                      onClick={() =>
                        setSettings((previous) => ({
                          ...previous,
                          original: { ...DEFAULT_SETTINGS.original },
                          translation: { ...DEFAULT_SETTINGS.translation },
                          subtitleGap: DEFAULT_SETTINGS.subtitleGap,
                          backgroundOpacity: DEFAULT_SETTINGS.backgroundOpacity,
                        }))
                      }
                    >
                      <RotateCcw size={13} /> 恢复默认样式
                    </button>
                  </Section>
                </>
              )}
              <footer className="settings-footer">
                <span className={dirty ? 'unsaved' : ''}>
                  {dirty ? '有未保存的更改' : '所有更改已保存'}
                </span>
              </footer>
            </div>
            {page === 'appearance' && (
              <aside className="preview-column" aria-label="字幕预览">
                <SubtitlePreview settings={settings} />
              </aside>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
