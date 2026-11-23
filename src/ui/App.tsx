import { t } from '../shared/i18n';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Check,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  Eye,
  EyeOff,
  Globe2,
  Info,
  LoaderCircle,
  LockKeyhole,
  PlugZap,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import {
  DEFAULT_SETTINGS,
  applySettingsPatch,
  hasProviderConsent,
  MICROSOFT_ORIGIN,
  isProviderConfigured,
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
  CaptionMode,
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

type Page = 'general' | 'service' | 'appearance' | 'about';
type ConnectionTest =
  { kind: 'untested' } | { kind: 'testing' | 'passed' | 'failed'; fingerprint: string };
const REPOSITORY_URL = 'https://github.com/weiguangchao/openai-translate-chrome-extension';
const PAGES = [
  {
    id: 'general' as const,
    name: t('常规设置', 'General'),
    icon: Settings2,
  },
  {
    id: 'service' as const,
    name: copy.translationService,
    icon: PlugZap,
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

function pageFromHash(): Page {
  const hash = typeof window === 'undefined' ? '' : window.location.hash;
  return PAGES.find((item) => `#${item.id}` === hash)?.id ?? 'general';
}

function scrollWorkspace() {
  const shell = document.querySelector<HTMLElement>('.app-shell');
  const workspace = document.querySelector<HTMLElement>('.workspace');
  const scroller = shell && getComputedStyle(shell).overflowY === 'auto' ? shell : workspace;
  scroller?.scrollTo?.({ top: 0 });
}

function Section({
  icon,
  title,
  description,
  action,
  children,
  className = '',
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`settings-section ${className}`}>
      <div className="section-heading">
        {icon}
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </div>
      <div className="section-body">{children}</div>
    </section>
  );
}

export function App() {
  const [page, setPage] = useState<Page>(pageFromHash);
  const pageRef = useRef(page);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const navigating = useRef(false);
  const baseUrlRef = useRef<HTMLInputElement>(null);
  const focusInvalidUrl = useRef(false);
  const [baseUrlError, setBaseUrlError] = useState('');
  const [settings, setSettings] = useState<Settings>(structuredClone(DEFAULT_SETTINGS));
  const [saved, setSaved] = useState<Settings>(structuredClone(DEFAULT_SETTINGS));
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const ready = loadState === 'ready';
  const { alert, showAlert } = useAlert();
  const [busy, setBusy] = useState<'save' | 'models' | 'test' | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const modelsVersion = useRef(0);
  const [manualModel, setManualModel] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [connection, setConnection] = useState<ConnectionTest>({ kind: 'untested' });
  const dirty = ready && JSON.stringify(settings) !== JSON.stringify(saved);
  const current = PAGES.find((item) => item.id === page)!;
  const fingerprint = JSON.stringify([
    settings.provider,
    settings.baseUrl,
    settings.apiKey,
    settings.model,
  ]);
  const testKind =
    connection.kind !== 'untested' && connection.fingerprint === fingerprint
      ? connection.kind
      : 'untested';
  const testText = {
    untested: t('本次尚未测试', 'Not tested this session'),
    testing: t('测试中…', 'Testing…'),
    passed: t('测试通过', 'Test passed'),
    failed: t('测试失败', 'Test failed'),
  };
  const origin = providerOrigin(settings);
  const provider = origin ? new URL(origin).host : t('所选翻译服务', 'the selected service');
  const consented = hasProviderConsent(settings);
  const microsoftConsented = settings.providerConsent.split(',').includes(MICROSOFT_ORIGIN);

  useEffect(() => {
    const syncPage = () => {
      const next = pageFromHash();
      if (next === pageRef.current) return;
      pageRef.current = next;
      navigating.current = true;
      setPage(next);
      scrollWorkspace();
    };
    window.addEventListener('hashchange', syncPage);
    return () => window.removeEventListener('hashchange', syncPage);
  }, []);
  useEffect(() => {
    let active = true;
    setLoadState('loading');
    void loadSettings()
      .then((value) => {
        if (!active) return;
        setSettings(value);
        setSaved(value);
        setLoadState('ready');
      })
      .catch(() => {
        if (!active) return;
        setLoadState('error');
      });
    return () => {
      active = false;
    };
  }, [showAlert, loadAttempt]);
  useEffect(() => {
    if (focusInvalidUrl.current && page === 'service') {
      revealBaseUrl();
      focusInvalidUrl.current = false;
      navigating.current = false;
    } else if (navigating.current) {
      headingRef.current?.focus({ preventScroll: true });
      navigating.current = false;
    }
  }, [page, baseUrlError]);
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
    if (key === 'baseUrl' || key === 'provider') setBaseUrlError('');
    if (key === 'provider' || key === 'baseUrl' || key === 'apiKey' || key === 'model')
      setConnection({ kind: 'untested' });
    if (key === 'baseUrl' || key === 'apiKey') setModels([]);
  }
  function navigate(next: Page) {
    pageRef.current = next;
    navigating.current = next !== page;
    window.location.hash = next;
    setPage(next);
    scrollWorkspace();
  }
  function revealBaseUrl() {
    baseUrlRef.current?.focus({ preventScroll: true });
    baseUrlRef.current?.closest('.field')?.scrollIntoView?.({ block: 'center' });
  }
  function validateServiceUrl() {
    try {
      validateSettings(settings);
      return true;
    } catch (error) {
      const text = error instanceof Error ? error.message : copy.saveFailed;
      setBaseUrlError(text);
      if (page === 'service' && baseUrlError === text) revealBaseUrl();
      else {
        focusInvalidUrl.current = true;
        navigate('service');
      }
      return false;
    }
  }
  async function save() {
    if (!validateServiceUrl()) return;
    try {
      const permission =
        settings.provider === 'microsoft' || settings.apiKey.trim()
          ? allowApiHost(settings)
          : Promise.resolve();
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
        isProviderConfigured(persisted) && !hasProviderConsent(persisted)
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
    if (!validateServiceUrl()) {
      if (kind === 'test') setConnection({ kind: 'failed', fingerprint });
      return;
    }
    if (kind === 'test') setConnection({ kind: 'testing', fingerprint });
    try {
      if (settings.provider === 'openai' && !settings.apiKey.trim())
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
        setConnection({ kind: 'passed', fingerprint });
        showAlert({
          kind: 'success',
          text: t('连接测试成功', 'Connection test passed'),
        });
      }
    } catch (error) {
      if (kind === 'test') setConnection({ kind: 'failed', fingerprint });
      showAlert({
        kind: 'error',
        text: error instanceof Error ? error.message : t('接口请求失败。', 'API request failed.'),
      });
    } finally {
      setBusy(null);
    }
  }

  const setupNeeded = !isProviderConfigured(settings) || !consented;
  const serviceShortcut = (
    <button
      className={`service-shortcut ${setupNeeded ? 'needs-setup' : ''}`}
      onClick={() => navigate('service')}
    >
      <PlugZap size={18} aria-hidden />
      <span className="service-shortcut-label">
        {setupNeeded
          ? isProviderConfigured(settings)
            ? copy.reviewConsent
            : t('完成翻译设置', 'Finish translation setup')
          : copy.translationService}
      </span>
      <span className="service-shortcut-meta">
        <span className="service-shortcut-value">
          <span>
            {settings.provider === 'microsoft' ? 'Microsoft Translate' : copy.openaiCompatible}
          </span>
          {settings.provider === 'openai' && settings.model.trim() && (
            <span className="service-shortcut-model" title={settings.model}>
              {settings.model}
            </span>
          )}
        </span>
        {setupNeeded && (
          <span className="setup-badge">
            {isProviderConfigured(settings)
              ? t('待授权', 'Consent needed')
              : t('待设置', 'Setup needed')}
          </span>
        )}
      </span>
      <ChevronRight size={18} aria-hidden />
    </button>
  );

  return (
    <div className="app-shell">
      {alert}
      <header className="app-header">
        <div className="header-inner">
          <Logo />
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
              </button>
            ))}
          </nav>
          <div className="sidebar-platforms" aria-hidden="true">
            <YoutubeMark />
            <XMark />
            <span>{t('为视频配上双语字幕', 'Bilingual subtitles for videos')}</span>
          </div>
        </div>
      </header>
      <main className="workspace" aria-busy={loadState === 'loading'}>
        <div className="page-content">
          <div className="page-heading">
            <h1 ref={headingRef} tabIndex={-1}>
              {current.name}
            </h1>
            {(page !== 'about' || dirty) && ready && (
              <div className="save-actions">
                <span className="save-state" role="status">
                  {dirty && (
                    <>
                      <i aria-hidden />
                      {t('有未保存的更改', 'Unsaved changes')}
                    </>
                  )}
                </span>
                {dirty && (
                  <button
                    className="discard-button"
                    disabled={Boolean(busy)}
                    onClick={() => {
                      setSettings(structuredClone(saved));
                      setBaseUrlError('');
                      setConnection({ kind: 'untested' });
                      setShowKey(false);
                    }}
                  >
                    {t('撤销更改', 'Discard changes')}
                  </button>
                )}
                <button
                  className="button primary save-button"
                  onClick={() => void save()}
                  disabled={!dirty || Boolean(busy)}
                >
                  {busy === 'save' ? (
                    <LoaderCircle size={16} className="spinning" />
                  ) : (
                    <Check size={17} />
                  )}{' '}
                  {busy === 'save'
                    ? t('保存中…', 'Saving…')
                    : dirty
                      ? t('保存更改', 'Save changes')
                      : t('设置已保存', 'Settings saved')}
                </button>
              </div>
            )}
          </div>
          {!isExtension && ready && page === 'service' && (
            <p className="browser-preview-note">
              {t(
                '浏览器预览：API Key 刷新后需重新填写。',
                'Browser preview: re-enter your API Key after refreshing.',
              )}
            </p>
          )}
          {loadState !== 'ready' && (
            <div
              className={`settings-state ${loadState}`}
              role={loadState === 'error' ? 'alert' : 'status'}
            >
              {loadState === 'loading' ? (
                <>
                  <LoaderCircle size={20} className="spinning" aria-hidden />
                  <p>{t('正在读取设置…', 'Loading settings…')}</p>
                </>
              ) : (
                <>
                  <CircleAlert size={20} aria-hidden />
                  <div>
                    <p>{copy.loadFailed}</p>
                    <button
                      className="text-button"
                      onClick={() => setLoadAttempt((attempt) => attempt + 1)}
                    >
                      {t('重试', 'Retry')}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          {ready && (
            <div className={`content-grid ${page === 'appearance' ? 'with-preview' : ''}`}>
              {page === 'appearance' && (
                <aside className="preview-column" aria-label={copy.subtitlePreview}>
                  <SubtitlePreview settings={settings} />
                </aside>
              )}
              <div className="settings-column">
                {page === 'general' && (
                  <>
                    {setupNeeded && serviceShortcut}
                    <Section title={copy.subtitles}>
                      <div className="enable-panel">
                        <div>
                          <label htmlFor="settings-enabled">{copy.enableSubtitles} </label>
                        </div>
                        <Toggle
                          id="settings-enabled"
                          label={copy.enableSubtitles}
                          checked={settings.enabled}
                          onChange={(value) => update('enabled', value)}
                        />
                      </div>
                      <div className="field setting-row">
                        <label htmlFor="target-language">{copy.translationLanguage}</label>
                        <LanguageSelect
                          id="target-language"
                          value={settings.targetLanguage}
                          onChange={(value) => update('targetLanguage', value)}
                        />
                      </div>
                      <CaptionMode
                        name="settings-display-mode"
                        value={settings.translationOnly}
                        onChange={(value) => update('translationOnly', value)}
                      />
                    </Section>
                    {!setupNeeded && serviceShortcut}
                    <Section title={t('支持的网站', 'Supported sites')}>
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
                {page === 'service' && (
                  <>
                    <Section title={t('翻译方式', 'Translation method')} className="api-section">
                      <fieldset disabled={Boolean(busy)}>
                        <fieldset className="provider-options">
                          <legend className="sr-only">{copy.translationService}</legend>
                          {(['microsoft', 'openai'] as const).map((value) => (
                            <label className="provider-option" key={value}>
                              <input
                                type="radio"
                                name="provider"
                                value={value}
                                checked={settings.provider === value}
                                onChange={() => update('provider', value)}
                              />
                              <span className="provider-option-title">
                                {value === 'microsoft'
                                  ? 'Microsoft Translate'
                                  : copy.openaiCompatible}
                                <Check size={16} aria-hidden />
                              </span>
                              <span className="provider-option-detail">
                                {value === 'microsoft'
                                  ? t('无需 API Key', 'No API key needed')
                                  : t('使用自己的兼容接口', 'Your compatible API')}
                              </span>
                            </label>
                          ))}
                        </fieldset>
                        {settings.provider === 'openai' && (
                          <>
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
                                  ref={baseUrlRef}
                                  type="url"
                                  aria-invalid={Boolean(baseUrlError)}
                                  aria-describedby={
                                    baseUrlError ? 'base-url-error' : 'base-url-hint'
                                  }
                                  value={settings.baseUrl}
                                  onChange={(event) => update('baseUrl', event.target.value)}
                                  placeholder="https://api.openai.com/v1"
                                  spellCheck={false}
                                />
                              </div>
                              {baseUrlError && (
                                <p className="field-error" id="base-url-error" role="alert">
                                  {baseUrlError}
                                </p>
                              )}
                              <p className="field-hint" id="base-url-hint">
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
                                  <RefreshCw
                                    size={16}
                                    className={busy === 'models' ? 'spinning' : ''}
                                  />
                                  <span>{t('获取模型', 'Fetch models')}</span>
                                </button>
                              </div>
                            </div>
                          </>
                        )}
                      </fieldset>
                      <div className="data-notice">
                        <h3>
                          <ShieldCheck size={15} /> {t('数据使用说明', 'Data use')}
                        </h3>
                        <p className="data-summary">
                          {settings.provider === 'openai'
                            ? t(
                                `字幕原文与视频标题将发送到 ${provider}，按服务商的隐私政策处理，可能产生费用。`,
                                `Subtitle text and the video title are sent to ${provider} under its privacy policy. Charges may apply.`,
                              )
                            : t(
                                `字幕原文将发送到 ${provider}，按 Microsoft 的隐私政策处理。`,
                                `Subtitle text is sent to ${provider} under Microsoft's privacy policy.`,
                              )}
                        </p>
                        <label className="consent-check">
                          <input
                            type="checkbox"
                            checked={consented}
                            disabled={!origin}
                            onChange={(event) => {
                              const origins = new Set(
                                settings.providerConsent.split(',').filter(Boolean),
                              );
                              if (event.target.checked) origins.add(origin);
                              else origins.delete(origin);
                              update('providerConsent', [...origins].join(','));
                            }}
                          />
                          {settings.provider === 'openai'
                            ? t(
                                `我同意将字幕原文与视频标题发送到 ${provider} 翻译`,
                                `I agree to send subtitle text and the video title to ${provider} for translation`,
                              )
                            : t(
                                `我同意将字幕原文发送到 ${provider} 翻译`,
                                `I agree to send subtitle text to ${provider} for translation`,
                              )}
                        </label>
                        {settings.provider === 'openai' && (
                          <label className="consent-check">
                            <input
                              type="checkbox"
                              checked={microsoftConsented}
                              onChange={(event) => {
                                const origins = new Set(
                                  settings.providerConsent.split(',').filter(Boolean),
                                );
                                if (event.target.checked) origins.add(MICROSOFT_ORIGIN);
                                else origins.delete(MICROSOFT_ORIGIN);
                                update('providerConsent', [...origins].join(','));
                              }}
                            />
                            {t(
                              '我同意将字幕原文发送到 Microsoft 作为临时翻译',
                              'I agree to send subtitle text to Microsoft for temporary translations',
                            )}
                          </label>
                        )}
                      </div>
                      <div className="api-footer">
                        <div
                          className={`connection-badge ${testKind === 'passed' ? 'connected' : testKind}`}
                          role="status"
                          aria-label={t('连接测试', 'Connection test')}
                        >
                          <i />
                          {isProviderConfigured(settings)
                            ? testText[testKind]
                            : t('待配置', 'Not configured')}
                        </div>
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
                  </>
                )}
                {page === 'appearance' && (
                  <>
                    {(['original', 'translation'] as const).map((kind) => (
                      <Section
                        key={kind}
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
                            <span className="color-value">
                              {settings[kind].color.toUpperCase()}
                            </span>
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
                                    aria-pressed={settings[kind].color.toUpperCase() === color}
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
                    <Section title={t('间距与背景', 'Spacing and background')}>
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
                          {t('字幕背景不透明度', 'Subtitle background opacity')}{' '}
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
                      icon={<img src="./logo-ui.svg" alt="" />}
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
                            <svg
                              width="18"
                              height="18"
                              viewBox="0 0 24 24"
                              fill="currentColor"
                              aria-hidden
                            >
                              <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.64 7.584H.47l8.6-9.835L0 1.154h7.594l5.243 6.932 6.064-6.933ZM17.61 20.644h2.039L6.486 3.24H4.298L17.61 20.644Z" />
                            </svg>
                          </a>
                        </div>
                      }
                    >
                      <p className="about-intro">
                        {t(
                          '在 YouTube 和 X 上看视频时，Subline 读取视频的原文字幕，通过 Microsoft Translate 或你自己的 OpenAI 兼容接口翻译，再把原文和译文一起显示在播放器里。',
                          'Subline reads subtitles on YouTube and X, translates them through Microsoft Translate or your OpenAI-compatible API, and displays the source and translation in the player.',
                        )}
                      </p>
                      <ul className="about-features">
                        <li>
                          {t(
                            '支持英语、简体中文、繁体中文、日语和韩语字幕，自动识别字幕语言。',
                            'Supports English, Simplified Chinese, Traditional Chinese, Japanese, and Korean subtitles, with automatic subtitle language detection.',
                          )}
                        </li>
                        <li>
                          {t(
                            '整理字幕，并提前翻译即将播放的内容，减少等待。',
                            'Organizes captions and prepares upcoming translations to reduce waiting.',
                          )}
                        </li>
                        <li>
                          {t(
                            '可以调整原文和译文的颜色、字号、两行间距和字幕背景，也可以按网站单独开关。',
                            'Adjust colors, font sizes, line spacing, and subtitle backgrounds. Enable or disable subtitles for each site.',
                          )}
                        </li>
                        <li>
                          {t(
                            'Subline 没有自己的服务器。字幕直接发送给所选翻译服务；开启临时翻译并额外同意后，也会发送给 Microsoft。OpenAI 接口还会接收视频标题作为翻译参考。设置保存在本机，API Key 加密保存。',
                            'Subline has no servers of its own. Subtitles go directly to your chosen service, and to Microsoft if you also consent to temporary translations. OpenAI-compatible services also receive the video title as context. Settings stay on your device, and your API Key is encrypted.',
                          )}
                        </li>
                      </ul>
                    </Section>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
