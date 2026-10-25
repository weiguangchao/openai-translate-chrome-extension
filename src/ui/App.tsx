import { t } from '../shared/i18n';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
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
  Twitter,
} from 'lucide-react';
import {
  DEFAULT_SETTINGS,
  applySettingsPatch,
  hasProviderConsent,
  providerOrigin,
  settingsPatch,
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
  GithubMark,
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
import { copy } from './copy';

type Page = 'general' | 'appearance' | 'about';
const REPOSITORY_URL = 'https://github.com/weiguangchao/openai-translate-chrome-extension';
const PAGES = [
  {
    id: 'general' as const,
    name: t('常规设置', 'General'),
    icon: Settings2,
  },
  {
    id: 'appearance' as const,
    name: t('字幕样式', 'Subtitle style'),
    icon: SlidersHorizontal,
  },
  {
    id: 'about' as const,
    name: t('关于', 'About'),
    icon: Info,
  },
];

function Section({
  icon,
  title,
  description,
  action,
  children,
  className = '',
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
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
        {action}
      </div>
      {children}
    </section>
  );
}

export function App() {
  const [page, setPage] = useState<Page>('general');
  const [settings, setSettings] = useState<Settings>(structuredClone(DEFAULT_SETTINGS));
  const [saved, setSaved] = useState<Settings>(structuredClone(DEFAULT_SETTINGS));
  const [ready, setReady] = useState(false);
  const { alert, showAlert } = useAlert();
  const [busy, setBusy] = useState<'save' | 'models' | 'test' | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const modelsVersion = useRef(0);
  const [manualModel, setManualModel] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [connection, setConnection] = useState('');
  const dirty = ready && JSON.stringify(settings) !== JSON.stringify(saved);
  const current = PAGES.find((item) => item.id === page)!;
  const fingerprint = JSON.stringify([settings.baseUrl, settings.apiKey, settings.model]);
  const connected = connection === fingerprint;
  const origin = providerOrigin(settings.baseUrl);
  const provider = origin ? new URL(origin).host : t('你填写的 Provider', 'your provider');
  const consented = hasProviderConsent(settings);

  useEffect(() => {
    void loadSettings()
      .then((value) => {
        setSettings(value);
        setSaved(value);
        setReady(true);
        if (!isExtension)
          showAlert({
            kind: 'info',
            text: t(
              '浏览器预览：API Key 刷新后需重新填写。',
              'Browser preview: re-enter your API Key after refreshing.',
            ),
          });
      })
      .catch(() => {
        showAlert({
          kind: 'error',
          text: t(
            '无法读取本地设置，请检查浏览器存储权限。',
            'Could not load local settings. Check browser storage permissions.',
          ),
        });
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
      const patch = settingsPatch(saved, normalized);
      if (!isExtension) patch.apiKey = normalized.apiKey;
      const persisted = await saveSettings(patch);
      setSettings((draft) => applySettingsPatch(persisted, settingsPatch(settings, draft)));
      setSaved(persisted);
      showAlert(
        persisted.apiKey && persisted.model && !hasProviderConsent(persisted)
          ? {
              kind: 'info',
              text: t(
                '设置已保存。同意数据使用说明后，才会翻译字幕。',
                'Settings saved. Accept the data use notice to translate subtitles.',
              ),
            }
          : {
              kind: 'success',
              text: isExtension
                ? t(
                    '设置已保存，已打开的视频页面会自动应用。',
                    'Settings saved and applied to open video pages.',
                  )
                : t(
                    '预览设置已保存。API Key 仅保留在当前页面，安装扩展后可本地保存。',
                    'Preview settings saved. The API Key stays on this page. Install the extension to save it locally.',
                  ),
            },
      );
    } catch (error) {
      showAlert({
        kind: 'error',
        text: error instanceof Error ? error.message : copy.saveFailed,
      });
    } finally {
      setBusy(null);
    }
  }
  async function runApi(kind: 'models' | 'test') {
    try {
      if (!settings.apiKey.trim())
        throw new Error(
          t(
            '请先填写 API Key，再连接翻译服务。',
            'Enter an API Key before connecting to the translation service.',
          ),
        );
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
          text: t(
            `已获取 ${ids.length} 个模型，请选择支持文本翻译的模型。`,
            `Fetched ${ids.length} models. Choose one that supports text translation.`,
          ),
        });
      } else {
        setConnection(
          JSON.stringify([requestSettings.baseUrl, requestSettings.apiKey, requestSettings.model]),
        );
        showAlert({
          kind: 'success',
          text: t('连接测试成功', 'Connection test passed'),
        });
      }
    } catch (error) {
      if (kind === 'test') setConnection('');
      showAlert({
        kind: 'error',
        text: error instanceof Error ? error.message : t('接口请求失败。', 'API request failed.'),
      });
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
        <nav aria-label={t('设置导航', 'Settings navigation')}>
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
            <span>{t('偏好设置', 'Preferences')}</span>
            <ChevronRight size={13} />
            <span>{current.name}</span>
          </div>
        </header>
        <div className={`page-content ${page === 'appearance' ? '' : 'narrow-page'}`}>
          <div className="page-heading">
            <h1>{current.name}</h1>
            {page !== 'about' && (
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
                {dirty ? t('保存更改', 'Save changes') : t('已保存', 'Saved')}
              </button>
            )}
          </div>
          <div className={`content-grid ${page === 'appearance' ? 'with-preview' : ''}`}>
            <div className="settings-column">
              {page === 'general' && (
                <>
                  <div className={`enable-panel ${settings.enabled ? 'is-enabled' : ''}`}>
                    <span className="enable-icon">
                      <Subtitles size={20} />
                    </span>
                    <div>
                      <h2>
                        {copy.enableSubtitles}{' '}
                        <span className="small-tag">
                          {settings.enabled ? t('已开启', 'On') : t('已关闭', 'Off')}
                        </span>
                      </h2>
                    </div>
                    <Toggle
                      label={copy.enableSubtitles}
                      checked={settings.enabled}
                      onChange={(value) => update('enabled', value)}
                    />
                  </div>
                  <Section
                    icon={<Languages size={19} />}
                    title={t('字幕语言', 'Subtitle language')}
                  >
                    <div className="field">
                      <label htmlFor="target-language">{copy.target}</label>
                      <LanguageSelect
                        id="target-language"
                        value={settings.targetLanguage}
                        onChange={(value) => update('targetLanguage', value)}
                      />
                    </div>
                  </Section>
                  <Section icon={<PlugZap size={19} />} title="Provider" className="api-section">
                    <div className={`connection-badge ${connected ? 'connected' : ''}`}>
                      <i />
                      {connected
                        ? t('连接正常', 'Connected')
                        : settings.apiKey && settings.model
                          ? t('等待测试', 'Not tested')
                          : t('待配置', 'Not configured')}
                    </div>
                    <fieldset disabled={Boolean(busy)}>
                      <div className="field">
                        <label htmlFor="base-url">
                          Base URL{' '}
                          <span
                            className="field-tip"
                            title={t(
                              '填写包含版本路径的接口根地址，例如 https://api.openai.com/v1',
                              'Enter the API base URL including its version path, such as https://api.openai.com/v1',
                            )}
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
                        <p className="field-hint">
                          {t(
                            '填写接口根地址，无需添加 /chat/completions',
                            'Enter the API base URL without /chat/completions',
                          )}
                        </p>
                      </div>
                      <div className="field">
                        <label htmlFor="api-key">API Key</label>
                        <div className="input-icon key-input">
                          <LockKeyhole size={16} />
                          <input
                            id="api-key"
                            type={showKey ? 'text' : 'password'}
                            value={settings.apiKey}
                            onChange={(event) => update('apiKey', event.target.value)}
                            placeholder={t('输入你的 API Key', 'Enter your API Key')}
                            autoComplete="off"
                            spellCheck={false}
                          />
                          <button
                            type="button"
                            aria-label={
                              showKey
                                ? t('隐藏 API Key', 'Hide API Key')
                                : t('显示 API Key', 'Show API Key')
                            }
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
                            {manualModel
                              ? t('从列表选择', 'Choose from list')
                              : t('手动填写', 'Enter manually')}
                          </button>
                        </label>
                        <div className="model-row">
                          {manualModel ? (
                            <input
                              id="model"
                              value={settings.model}
                              onChange={(event) => update('model', event.target.value)}
                              placeholder={t(
                                '输入服务商提供的 Model ID',
                                'Enter the Model ID from your provider',
                              )}
                              spellCheck={false}
                            />
                          ) : (
                            <Select
                              id="model"
                              value={settings.model}
                              onChange={(value) => update('model', value)}
                            >
                              <option value="">
                                {t('选择翻译模型', 'Choose a translation model')}
                              </option>
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
                            className="fetch-button"
                            aria-label={t('获取模型', 'Fetch models')}
                            title={t('获取模型', 'Fetch models')}
                            onClick={() => void runApi('models')}
                          >
                            <RefreshCw size={16} className={busy === 'models' ? 'spinning' : ''} />
                          </button>
                        </div>
                      </div>
                    </fieldset>
                    <div className="data-notice">
                      <h3>
                        <ShieldCheck size={15} /> {t('数据使用说明', 'Data use')}
                      </h3>
                      <ul>
                        <li>
                          {t(
                            `在 YouTube、HBO Max、X 上播放带字幕的视频时，Subline 会把字幕原文发送到 ${provider} 翻译。`,
                            `When you watch videos with subtitles on YouTube, HBO Max, or X, Subline sends subtitle text to ${provider} for translation.`,
                          )}
                        </li>
                        <li>
                          {t(
                            '不发送视频网址、标题或你的视频网站账号信息。Subline 没有自己的服务器。',
                            'Subline does not send video URLs, titles, or video site account details. Subline has no servers of its own.',
                          )}
                        </li>
                        <li>
                          {t(
                            '字幕由 Provider 按其隐私政策处理，请求可能产生费用。',
                            'Your provider processes subtitles under its privacy policy. Requests may incur charges.',
                          )}
                        </li>
                      </ul>
                      <label className="consent-check">
                        <input
                          type="checkbox"
                          checked={consented}
                          disabled={!origin}
                          onChange={(event) =>
                            update('providerConsent', event.target.checked ? origin : '')
                          }
                        />
                        {t(
                          `我同意将字幕原文发送到 ${provider} 翻译`,
                          `I agree to send subtitle text to ${provider} for translation`,
                        )}
                      </label>
                    </div>
                    <div className="api-footer">
                      <button
                        className="test-button"
                        disabled={Boolean(busy)}
                        onClick={() => void runApi('test')}
                      >
                        {busy === 'test'
                          ? t('连接中…', 'Connecting…')
                          : t('测试连接', 'Test connection')}
                      </button>
                    </div>
                  </Section>
                  <Section
                    icon={<MonitorPlay size={19} />}
                    title={t('支持的网站', 'Supported sites')}
                  >
                    <div className="site-options">
                      <div>
                        <YoutubeMark />
                        <span>YouTube</span>
                        <Toggle
                          label={t('在 YouTube 启用', 'Enable on YouTube')}
                          checked={settings.youtube}
                          onChange={(value) => update('youtube', value)}
                        />
                      </div>
                      <div>
                        <HboMark />
                        <span>HBO Max</span>
                        <Toggle
                          label={t('在 HBO Max 启用', 'Enable on HBO Max')}
                          checked={settings.hbo}
                          onChange={(value) => update('hbo', value)}
                        />
                      </div>
                      <div>
                        <XMark />
                        <span>{t('X（推特）', 'X (Twitter)')}</span>
                        <Toggle
                          label={t('在 X（推特）启用', 'Enable on X (Twitter)')}
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
                      title={
                        kind === 'original'
                          ? t('原文样式', 'Source style')
                          : t('译文样式', 'Translation style')
                      }
                    >
                      <div className="color-field">
                        <label htmlFor={`${kind}-color`}>{t('字体颜色', 'Font color')}</label>
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
                              {kind === 'original'
                                ? t('原文字体颜色', 'Source font color')
                                : t('译文字体颜色', 'Translation font color')}
                            </span>
                          </label>
                          <span className="color-value">{settings[kind].color.toUpperCase()}</span>
                          <div className="color-presets">
                            {['#FFFFFF', '#B8E5CF', '#FFE3A3', '#A9D5FF', '#F2B8D5'].map(
                              (color) => (
                                <button
                                  key={color}
                                  aria-label={
                                    kind === 'original'
                                      ? t(`原文颜色 ${color}`, `Source color ${color}`)
                                      : t(`译文颜色 ${color}`, `Translation color ${color}`)
                                  }
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
                          {t('字体大小', 'Font size')}{' '}
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
                  <Section
                    icon={<Layers3 size={19} />}
                    title={t('间距与背景', 'Spacing and background')}
                  >
                    <div className="range-field">
                      <label htmlFor="subtitle-gap">
                        {t('两行字幕间距', 'Line spacing')}{' '}
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
                        <span>{t('紧凑', 'Compact')}</span>
                        <span>{t('宽松', 'Wide')}</span>
                      </div>
                    </div>
                    <div className="range-field">
                      <label htmlFor="background-opacity">
                        {t('译文背景不透明度', 'Translation background opacity')}{' '}
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
                        <span>{t('透明', 'Transparent')}</span>
                        <span>{t('深色', 'Dark')}</span>
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
                      <RotateCcw size={13} /> {t('恢复默认样式', 'Reset style')}
                    </button>
                  </Section>
                </>
              )}
              {page === 'about' && (
                <>
                  <Section
                    icon={<Subtitles size={19} />}
                    title={t('Subline 双语字幕', 'Subline bilingual subtitles')}
                    description={
                      isExtension
                        ? t(
                            `版本 ${chrome.runtime.getManifest().version}`,
                            `Version ${chrome.runtime.getManifest().version}`,
                          )
                        : undefined
                    }
                    action={
                      <div className="about-links">
                        <a
                          className="about-icon-link"
                          href={REPOSITORY_URL}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={t('GitHub 仓库', 'GitHub repository')}
                        >
                          <GithubMark />
                        </a>
                        <a
                          className="about-icon-link"
                          href="https://x.com/itbuxiangma"
                          target="_blank"
                          rel="noreferrer"
                          aria-label={t('作者的 X', 'Author on X')}
                        >
                          <Twitter size={18} aria-hidden />
                        </a>
                      </div>
                    }
                  >
                    <p className="about-intro">
                      {t(
                        '在 YouTube、HBO Max 和 X 上看视频时，Subline 读取视频的原文字幕，用你自己的 OpenAI 兼容接口翻译，再把原文和译文一起显示在播放器里。',
                        'Subline reads subtitles on YouTube, HBO Max, and X, translates them through your OpenAI-compatible API, and displays the source and translation in the player.',
                      )}
                    </p>
                    <ul className="about-features">
                      <li>
                        {t(
                          '支持英语、简体中文、繁体中文和日语字幕，自动识别字幕语言。',
                          'Supports English, Simplified Chinese, Traditional Chinese, and Japanese subtitles, with automatic subtitle language detection.',
                        )}
                      </li>
                      <li>
                        {t(
                          '字幕按句子翻译，并提前翻译即将播放的部分，减少等待。',
                          'Translates subtitles by sentence and prepares upcoming translations to reduce waiting.',
                        )}
                      </li>
                      <li>
                        {t(
                          '可以调整原文和译文的颜色、字号、两行间距和译文背景，也可以按网站单独开关。',
                          'Adjust colors, font sizes, line spacing, and translation backgrounds. Enable or disable subtitles for each site.',
                        )}
                      </li>
                      <li>
                        {t(
                          'Subline 没有自己的服务器。字幕原文只发送给你选择的 Provider，设置保存在本机，API Key 加密保存。',
                          'Subline has no servers of its own. Subtitles go only to your chosen provider. Settings stay on your device, and your API Key is encrypted.',
                        )}
                      </li>
                    </ul>
                    <div className="about-feedback">
                      <a
                        className="about-feedback-link"
                        href={`${REPOSITORY_URL}/issues/new`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t('反馈', 'Feedback')}
                      </a>
                    </div>
                  </Section>
                </>
              )}
            </div>
            {page === 'appearance' && (
              <aside className="preview-column" aria-label={copy.subtitlePreview}>
                <SubtitlePreview settings={settings} />
              </aside>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
