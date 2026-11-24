import { t } from '../shared/i18n';
import { LANGUAGES } from '../shared/languages';
import { PAGE_STATUSES, type PageStatus } from '../shared/messages';
import { platformForUrl } from '../shared/platforms';
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, CircleAlert, Settings2 } from 'lucide-react';
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
const statusLabels = (): Record<PopupStatus, string> => ({
  checking: t(
    '正在读取本页状态…',
    'Checking this page…',
    '正在讀取本頁狀態…',
    'このページの状態を確認中…',
  ),
  disabled: t('字幕已关闭', 'Subtitles are off', '字幕已關閉', '字幕はオフです'),
  'site-disabled': t(
    '此网站字幕已关闭',
    'Subtitles are off for this site',
    '此網站的字幕已關閉',
    'このサイトの字幕はオフです',
  ),
  'not-configured': t(
    '翻译服务尚未就绪',
    'Translation service is not ready',
    '翻譯服務尚未就緒',
    '翻訳サービスの準備ができていません',
  ),
  'no-video': t(
    '未检测到可用视频',
    'No active video found',
    '未偵測到可用的影片',
    '再生中の動画が見つかりません',
  ),
  waiting: t('等待字幕', 'Waiting for captions', '等待字幕', '字幕を待っています'),
  'source-error': t(
    '字幕轨加载失败，已恢复网站字幕',
    'Caption track failed to load; website captions restored',
    '字幕軌載入失敗，已恢復網站字幕',
    '字幕トラックの読み込みに失敗したため、サイトの字幕に戻しました',
  ),
  'source-unavailable': t(
    '无法读取字幕轨，已恢复网站字幕',
    'Caption track unavailable; website captions restored',
    '無法讀取字幕軌，已恢復網站字幕',
    '字幕トラックを利用できないため、サイトの字幕に戻しました',
  ),
  loading: t(
    '正在翻译当前字幕',
    'Translating the current caption',
    '正在翻譯目前的字幕',
    '現在の字幕を翻訳中',
  ),
  bilingual: t(
    '正在显示双语字幕',
    'Showing bilingual subtitles',
    '正在顯示雙語字幕',
    'バイリンガル字幕を表示中',
  ),
  'translation-only': t(
    '正在显示译文',
    'Showing translated subtitles',
    '正在顯示譯文',
    '翻訳を表示中',
  ),
  original: t(
    '正在显示原文字幕',
    'Showing original subtitles',
    '正在顯示原文字幕',
    '原文の字幕を表示中',
  ),
  error: t(
    '字幕翻译失败',
    'Caption translation failed',
    '字幕翻譯失敗',
    '字幕の翻訳に失敗しました',
  ),
  'unsupported-language': t(
    '原文语言不支持',
    'Unsupported caption language',
    '不支援原文語言',
    '字幕の言語に対応していません',
  ),
  'unsupported-page': t(
    '本页不支持字幕',
    'Subtitles are not supported on this page',
    '本頁不支援字幕',
    'このページは字幕に対応していません',
  ),
  unavailable: t(
    '无法读取本页状态',
    "Could not read this page's status",
    '無法讀取本頁狀態',
    'このページの状態を読み取れません',
  ),
});

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
    [t('输入', 'Input', '輸入', '入力'), usage.input, 'popup-usage-input'],
    [t('输出', 'Output', '輸出', '出力'), usage.output, 'popup-usage-output'],
    [t('缓存', 'Cache', '快取', 'キャッシュ'), usage.cache, 'popup-usage-cache'],
  ] as const;
  return (
    <section className="popup-usage" aria-labelledby="popup-usage-label">
      <h2 id="popup-usage-label">{t('Token 消耗', 'Token usage', 'Token 用量', 'Token 使用量')}</h2>
      <p
        className="popup-usage-total"
        title={ready ? formatExactTokens(total) : undefined}
        aria-label={
          ready
            ? t(
                `总共 ${formatExactTokens(total)}`,
                `Total ${formatExactTokens(total)}`,
                `總計 ${formatExactTokens(total)}`,
                `合計 ${formatExactTokens(total)}`,
              )
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
            t(
              '无法读取设置，请重新打开扩展。',
              'Could not load settings. Reopen the extension.',
              '無法讀取設定，請重新開啟擴充功能。',
              '設定を読み込めません。拡張機能を開き直してください。',
            ),
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
      setError(
        t(
          '无法打开设置，请重试。',
          'Could not open settings. Try again.',
          '無法開啟設定，請重試。',
          '設定を開けません。再試行してください。',
        ),
      );
    }
  }

  const configured = isProviderConfigured(settings);
  const statusText =
    pageStatus === 'not-configured' && ready && configured && !hasProviderConsent(settings)
      ? t(
          '等待字幕数据授权',
          'Caption data consent needed',
          '等待字幕資料授權',
          '字幕データの送信への同意が必要です',
        )
      : statusLabels()[pageStatus];
  const placeholder =
    loadState === 'error'
      ? t('读取失败', 'Could not load', '讀取失敗', '読み込みに失敗しました')
      : t('读取中…', 'Loading…', '讀取中…', '読み込み中…');

  return (
    <main
      className="popup"
      aria-label={t(
        'Subline 控制面板',
        'Subline controls',
        'Subline 控制面板',
        'Subline コントロール',
      )}
      aria-busy={loadState === 'loading' || busy}
    >
      <header className="popup-header">
        <Logo small />
        <p className="popup-save-state" role="status">
          {saved && !busy && <Check size={12} aria-hidden />}
          {busy
            ? t('正在保存…', 'Saving…', '正在儲存…', '保存しています…')
            : saved
              ? t('已保存', 'Saved', '已儲存', '保存済み')
              : ''}
        </p>
        <button
          className="popup-settings"
          aria-label={t('设置', 'Settings', '設定', '設定')}
          title={t('设置', 'Settings', '設定', '設定')}
          onClick={() => void options()}
        >
          <Settings2 size={16} aria-hidden />
          <span>{t('设置', 'Settings', '設定', '設定')}</span>
        </button>
      </header>

      <section className="popup-control">
        <div className="popup-power">
          <div className="popup-power-text">
            <h1>{copy.subtitles}</h1>
            <span className="popup-power-scope">
              {t(
                '所有支持的网站',
                'All supported sites',
                '所有支援的網站',
                '対応しているすべてのサイト',
              )}
            </span>
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
          aria-label={t('本页状态', 'Page status', '本頁狀態', 'このページの状態')}
        >
          {pageStatus === 'error' ? <CircleAlert size={14} aria-hidden /> : <i aria-hidden />}
          {statusText}
        </p>
        {ready && (!configured || !hasProviderConsent(settings)) && (
          <button
            className="text-button popup-setup-action"
            onClick={() => void options('service')}
          >
            {configured
              ? copy.reviewConsent
              : t(
                  '配置翻译服务',
                  'Set up translation service',
                  '設定翻譯服務',
                  '翻訳サービスを設定',
                )}
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
          compact
          value={ready ? settings.translationOnly : null}
          onChange={(translationOnly) => void update({ translationOnly })}
        />
      </fieldset>

      <details className="popup-details">
        <summary>
          {t('模型与用量', 'Model and usage', '模型與用量', 'モデルと使用量')}
          <ChevronDown size={15} aria-hidden />
        </summary>
        <section className="popup-model" aria-labelledby="popup-model-label">
          <div className="popup-model-row">
            <h2 id="popup-model-label">
              {settings.provider === 'microsoft'
                ? copy.translationService
                : t('模型', 'Model', '模型', 'モデル')}
            </h2>
            {ready && settings.provider === 'microsoft' ? (
              <span className="popup-model-id">Microsoft Translate</span>
            ) : ready && settings.model.trim() ? (
              <code className="popup-model-id" title={settings.model}>
                {settings.model}
              </code>
            ) : (
              <p className="popup-model-empty">
                {ready ? t('未配置', 'Not configured', '未設定', '未設定') : placeholder}
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
