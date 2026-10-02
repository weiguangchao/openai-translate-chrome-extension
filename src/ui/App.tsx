import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowLeftRight,
  ArrowRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronRight,
  CircleHelp,
  ExternalLink,
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
  X,
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
  loadSettings,
  saveSettings,
} from '../shared/storage';
import {
  HboMark,
  LanguageSelect,
  Logo,
  PrivacyNote,
  Select,
  SubtitlePreview,
  Toggle,
  YoutubeMark,
} from './components';

type Page = 'general' | 'appearance' | 'guide';
type Notice = { kind: 'success' | 'error'; text: string } | null;
const PAGES = [
  {
    id: 'general' as const,
    name: '常规设置',
    icon: Settings2,
    description: '连接翻译服务，让每一段精彩都有你熟悉的语言。',
  },
  {
    id: 'appearance' as const,
    name: '字幕样式',
    icon: SlidersHorizontal,
    description: '调整两种语言的颜色与大小，找到最舒服的阅读方式。',
  },
  {
    id: 'guide' as const,
    name: '使用指南',
    icon: BookOpen,
    description: '完成简单设置，就可以带着两种语言看世界。',
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
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState<'save' | 'models' | 'test' | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [manualModel, setManualModel] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [connection, setConnection] = useState('');
  const [testResult, setTestResult] = useState('');
  const dirty = ready && JSON.stringify(settings) !== saved;
  const current = PAGES.find((item) => item.id === page)!;
  const fingerprint = JSON.stringify([
    settings.baseUrl,
    settings.apiKey,
    settings.model,
    settings.apiFormat,
  ]);
  const connected = connection === fingerprint;

  useEffect(() => {
    void loadSettings()
      .then((value) => {
        setSettings(value);
        setSaved(JSON.stringify(value));
        setReady(true);
      })
      .catch(() => {
        setNotice({ kind: 'error', text: '无法读取本地设置，请检查浏览器存储权限。' });
      });
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    if (notice?.kind !== 'success') return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setNotice(null);
    setSettings((previous) => ({ ...previous, [key]: value }));
    if (key === 'baseUrl' || key === 'apiKey') setModels([]);
    if (
      ['baseUrl', 'apiKey', 'model', 'apiFormat', 'sourceLanguage', 'targetLanguage'].includes(key)
    )
      setTestResult('');
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
      setNotice(null);
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
      setNotice({
        kind: 'success',
        text: isExtension
          ? '设置已保存，已打开的视频页面会自动应用。'
          : '预览设置已保存。API Key 仅保留在当前页面，安装扩展后可本地保存。',
      });
    } catch (error) {
      setNotice({
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
      setNotice(null);
      setTestResult('');
      await permission;
      const result = await apiAction(kind, requestSettings);
      if (kind === 'models') {
        const ids = result as string[];
        setModels(ids);
        setManualModel(false);
        if (!requestSettings.model) update('model', ids[0]);
        setNotice({
          kind: 'success',
          text: `已获取 ${ids.length} 个模型，请选择支持文本翻译的模型。`,
        });
      } else {
        setConnection(
          JSON.stringify([
            requestSettings.baseUrl,
            requestSettings.apiKey,
            requestSettings.model,
            requestSettings.apiFormat,
          ]),
        );
        setTestResult(result as string);
        setNotice({ kind: 'success', text: '连接成功，已完成一条示例字幕的翻译。' });
      }
    } catch (error) {
      if (kind === 'test') setConnection('');
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '接口请求失败。' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="app-shell">
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
        <div className="sidebar-bottom">
          <div className="sidebar-help">
            <span className="help-icon">
              <Languages size={21} />
            </span>
            <h3>好故事，不止一种语言。</h3>
            <p>听懂对白，也读懂世界。</p>
            <button onClick={() => navigate('guide')}>
              开始使用 <ArrowRight size={14} />
            </button>
          </div>
          <div className="version">
            <span>
              <img src="./logo.svg" alt="" /> Subline for Chrome
            </span>
            <span>v0.1.0</span>
          </div>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <Settings2 size={15} />
            <span>偏好设置</span>
            <ChevronRight size={13} />
            <span>{current.name}</span>
          </div>
          <span className="local-tag">
            <span className="status-dot" /> 本地工作空间
          </span>
        </header>
        <div className="page-content">
          <div className="page-heading">
            <div>
              <h1>{current.name}</h1>
              <p>{current.description}</p>
            </div>
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
          {!isExtension && (
            <div className="browser-note">
              <Info size={14} />
              <span>当前为浏览器预览。安装 Chrome 扩展后，即可在视频页面启用双语字幕。</span>
              <button onClick={() => navigate('guide')}>
                安装方法 <ChevronRight size={13} />
              </button>
            </div>
          )}
          {notice && (
            <div
              className={`notice ${notice.kind}`}
              role={notice.kind === 'error' ? 'alert' : 'status'}
            >
              {notice.kind === 'success' ? <CheckCheck size={17} /> : <Info size={17} />}
              <span>{notice.text}</span>
              <button aria-label="关闭提示" onClick={() => setNotice(null)}>
                <X size={16} />
              </button>
            </div>
          )}
          <div className="content-grid">
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
                        <span className="small-tag">{settings.enabled ? '已开启' : '已暂停'}</span>
                      </h2>
                      <p>在支持的视频网站中，自动显示双语字幕</p>
                    </div>
                    <Toggle
                      label="启用双语字幕"
                      checked={settings.enabled}
                      onChange={(value) => update('enabled', value)}
                    />
                  </div>
                  <Section
                    icon={<Languages size={19} />}
                    title="语言偏好"
                    description="一边看喜欢的内容，一边熟悉另一种语言。"
                  >
                    <div className="language-pair">
                      <div className="field">
                        <label htmlFor="source-language">
                          学习语言 <span>原文</span>
                        </label>
                        <LanguageSelect
                          id="source-language"
                          value={settings.sourceLanguage}
                          onChange={(value) => update('sourceLanguage', value)}
                        />
                      </div>
                      <button
                        className="swap-button"
                        aria-label="交换学习语言和母语"
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
                        <label htmlFor="target-language">
                          我的母语 <span>译文</span>
                        </label>
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
                    title="翻译服务"
                    description="连接 OpenAI 或兼容 OpenAI 的 API 服务。"
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
                            <LockKeyhole size={11} /> 仅本地保存
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
                        <p className="field-hint">从你的 API 服务获取模型，也可以手动填写。</p>
                      </div>
                      <details className="advanced">
                        <summary>
                          高级接口设置 <ChevronRight size={13} />
                        </summary>
                        <div className="field">
                          <label htmlFor="api-format">接口类型</label>
                          <Select
                            id="api-format"
                            value={settings.apiFormat}
                            onChange={(value) =>
                              update('apiFormat', value as Settings['apiFormat'])
                            }
                          >
                            <option value="chat">Chat Completions · /chat/completions</option>
                            <option value="completions">Completions · /completions</option>
                          </Select>
                          <p className="field-hint">根据服务商及模型支持的接口选择。</p>
                        </div>
                      </details>
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
                    {testResult && (
                      <div className="test-result">
                        <CheckCheck size={15} />
                        <div>
                          <strong>示例翻译成功</strong>
                          <p>{testResult}</p>
                          <small>测试调用会按服务商规则计费。</small>
                        </div>
                      </div>
                    )}
                  </Section>
                  <Section icon={<MonitorPlay size={19} />} title="支持的网站">
                    <div className="site-options">
                      <div>
                        <YoutubeMark />
                        <span>
                          YouTube<small>视频与自动生成字幕</small>
                        </span>
                        <Toggle
                          label="在 YouTube 启用"
                          checked={settings.youtube}
                          onChange={(value) => update('youtube', value)}
                        />
                      </div>
                      <div>
                        <HboMark />
                        <span>
                          HBO Max<small>可读取的播放器字幕</small>
                        </span>
                        <Toggle
                          label="在 HBO Max 启用"
                          checked={settings.hbo}
                          onChange={(value) => update('hbo', value)}
                        />
                      </div>
                    </div>
                  </Section>
                </>
              )}
              {page === 'appearance' && (
                <>
                  <div className="page-callout">
                    <Layers3 size={21} />
                    <div>
                      <strong>原文在上，译文在下</strong>
                      <p>YouTube 使用自定义字幕，原文在上，译文在下，按句同步显示。</p>
                    </div>
                  </div>
                  {(['original', 'translation'] as const).map((kind) => (
                    <Section
                      key={kind}
                      icon={kind === 'original' ? <Subtitles size={19} /> : <Languages size={19} />}
                      title={kind === 'original' ? '原文样式' : '译文样式'}
                      description={
                        kind === 'original'
                          ? '正在学习的语言，保留原汁原味的表达。'
                          : '用熟悉的语言，理解每一句对白。'
                      }
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
              {page === 'guide' && (
                <>
                  <Section icon={<BookOpen size={19} />} title="从这里开始">
                    <ol className="guide-steps">
                      <li>
                        <span>1</span>
                        <div>
                          <h3>安装到 Chrome</h3>
                          <p>
                            在项目目录运行 <code>npm install</code> 和 <code>npm run build</code>
                            。打开 <code>chrome://extensions</code>
                            ，开启「开发者模式」，点击「加载已解压的扩展程序」，选择项目中的{' '}
                            <code>dist</code> 文件夹。
                          </p>
                        </div>
                      </li>
                      <li>
                        <span>2</span>
                        <div>
                          <h3>连接你的翻译服务</h3>
                          <p>
                            填写 Base URL 和 API
                            Key，点击「获取模型」并选择支持文本翻译的模型。也可以手动填写 Model
                            ID，再用「测试连接」确认。
                          </p>
                          <button className="text-button" onClick={() => navigate('general')}>
                            配置翻译服务 <ArrowRight size={13} />
                          </button>
                        </div>
                      </li>
                      <li>
                        <span>3</span>
                        <div>
                          <h3>选择语言，保存设置</h3>
                          <p>
                            选择正在学习的原文语言和你的母语。按需调整字幕样式，然后点击「保存更改」。
                          </p>
                        </div>
                      </li>
                      <li>
                        <span>4</span>
                        <div>
                          <h3>打开视频，开启原字幕</h3>
                          <p>
                            在 YouTube 或 HBO Max
                            播放视频，开启播放器字幕，并将字幕语言设为学习语言。安装或重新加载扩展后，请刷新已有的视频页面。
                          </p>
                        </div>
                      </li>
                    </ol>
                  </Section>
                  <Section icon={<CircleHelp size={19} />} title="常见问题">
                    <div className="faq">
                      <details>
                        <summary>为什么还没有显示译文？</summary>
                        <p>
                          先确认扩展已启用，原文语言和母语设置正确。YouTube
                          需要开启字幕并配置翻译服务，人工字幕和自动字幕都会先断句再交给模型翻译；首次翻译需要等待接口响应。HBO
                          可直接加载已有母语字幕，无需 API Key。部分 HBO
                          播放器会将字幕绘制在不可读取的图层上，这类字幕目前也无法翻译。
                        </p>
                      </details>
                      <details>
                        <summary>模型列表获取失败怎么办？</summary>
                        <p>
                          检查 Base URL 和 API Key。扩展先请求 /models，接口返回 404 或 405 时尝试
                          /model。若服务商不提供模型列表，可手动填写 Model ID。浏览器预览还受 CORS
                          限制，安装扩展并授权 API 域名后可跨域请求。
                        </p>
                      </details>
                      <details>
                        <summary>会上传什么内容？</summary>
                        <p>
                          YouTube 会将原文按句发送到翻译服务。HBO
                          使用已有母语字幕时不会调用模型。需要翻译时，会把当前和预加载的字幕、所选语言、提示词和模型
                          ID 发送到你配置的服务商。API Key
                          仅用于该服务的身份验证，不会提供给视频网站。扩展不收集观看记录，不接入分析服务。浏览器预览不会持久化
                          API Key。
                        </p>
                      </details>
                      <details>
                        <summary>翻译是否收费？支持离线吗？</summary>
                        <p>
                          API
                          调用由你的服务商按其规则计费，包括「测试连接」。字幕翻译需要可访问的接口，也可配置本地的
                          OpenAI 兼容服务。
                        </p>
                      </details>
                    </div>
                  </Section>
                  <div className="guide-links">
                    <a href="https://www.youtube.com" target="_blank" rel="noreferrer">
                      <YoutubeMark /> 打开 YouTube <ExternalLink size={13} />
                    </a>
                    <a href="https://www.hbomax.com" target="_blank" rel="noreferrer">
                      <HboMark /> 打开 HBO Max <ExternalLink size={13} />
                    </a>
                  </div>
                </>
              )}
              <footer className="settings-footer">
                <PrivacyNote />
                <span className={dirty ? 'unsaved' : ''}>
                  {dirty ? '有未保存的更改' : '所有更改已保存'}
                </span>
              </footer>
            </div>
            <aside className="preview-column">
              <SubtitlePreview
                settings={settings}
                onStyle={page !== 'appearance' ? () => navigate('appearance') : undefined}
              />
              <div className="preview-explainer">
                <span className="explainer-icon">
                  <Layers3 size={20} />
                </span>
                <div>
                  <h3>原声的精彩，双语的理解。</h3>
                  <p>原文与译文一起看，让理解跟上对白，也让语言学习自然发生。</p>
                  <button onClick={() => navigate('guide')}>
                    了解双语字幕 <ArrowRight size={13} />
                  </button>
                </div>
              </div>
              <div className="works-with">
                <span>陪你看喜欢的内容</span>
                <div>
                  <span>
                    <YoutubeMark /> YouTube
                  </span>
                  <i />
                  <HboMark />
                </div>
              </div>
              <div className="privacy-detail">
                <ShieldCheck size={16} />
                <p>
                  由你选择的 AI 提供翻译
                  <br />
                  无需注册，使用你自己的 API Key
                </p>
              </div>
            </aside>
          </div>
        </div>
      </main>
    </div>
  );
}
