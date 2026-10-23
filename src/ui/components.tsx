import { t } from '../shared/i18n';
import { LANGUAGES } from '../shared/languages';
import { Check, ChevronDown, Expand, Languages, Subtitles, X } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { type Settings } from '../shared/settings';
import { isExtension } from '../shared/storage';
import { copy } from './copy';

export function Logo({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand ${small ? 'brand-small' : ''}`}>
      <img src="./logo.svg" alt="" />
      <div>
        <strong>
          Subline<span className="brand-period">.</span>
          {small && isExtension && (
            <span className="brand-version">v{chrome.runtime.getManifest().version}</span>
          )}
        </strong>
      </div>
    </div>
  );
}
export function Toggle({
  checked,
  onChange,
  label,
  id,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  id?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`toggle ${checked ? 'is-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span>{checked && <Check size={11} strokeWidth={3} />}</span>
    </button>
  );
}
export function Select({
  id,
  value,
  onChange,
  children,
  disabled = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="select-wrap">
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      >
        {children}
      </select>
      <ChevronDown size={16} aria-hidden />
    </div>
  );
}
export function LanguageSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select id={id} value={value} onChange={onChange}>
      {LANGUAGES.map((language) => (
        <option key={language.value} value={language.value}>
          {language.label}
          {language.native !== language.label ? ` / ${language.native}` : ''}
        </option>
      ))}
    </Select>
  );
}
export function YoutubeMark() {
  return (
    <span className="youtube-mark">
      <svg viewBox="0 0 28 20" fill="none" aria-hidden>
        <rect width="28" height="20" rx="6" fill="#F03D3D" />
        <path d="m11 6 8 4-8 4V6Z" fill="white" />
      </svg>
    </span>
  );
}
export function HboMark() {
  return (
    <span className="hbo-mark">
      HBO<span>max</span>
    </span>
  );
}
export function XMark() {
  return (
    <span className="x-mark">
      <svg viewBox="0 0 20 20" fill="none" aria-hidden>
        <rect width="20" height="20" rx="5" fill="#0F1419" />
        <path d="m6.5 6 7 8M13.5 6l-7 8" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </span>
  );
}
export function GithubMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}
function PreviewDialog({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="preview-dialog"
      aria-label={t('放大的字幕预览', 'Expanded subtitle preview')}
      onCancel={onClose}
    >
      <div>
        <button
          autoFocus
          className="dialog-close"
          aria-label={t('关闭字幕预览', 'Close subtitle preview')}
          onClick={onClose}
        >
          <X size={21} />
        </button>
        {children}
      </div>
    </dialog>
  );
}
const SAMPLES: Record<string, [string, string]> = {
  en: ['There’s a whole world waiting for us.', 'Some moments are worth slowing down for.'],
  'zh-CN': ['总有一个世界，等待着我们去探索。', '有些时刻，值得我们放慢脚步。'],
  'zh-TW': ['總有一個世界，等待著我們去探索。', '有些時刻，值得我們放慢腳步。'],
  ja: ['私たちが探検する世界が、いつも待っている。', 'ゆっくり味わいたい瞬間がある。'],
};
export function SubtitlePreview({ settings }: { settings: Settings }) {
  const [expanded, setExpanded] = useState(false);
  const [sample, setSample] = useState(0);
  const sampleText = (language: string) => (SAMPLES[language] ?? SAMPLES.en)[sample];
  const style = (kind: 'original' | 'translation'): CSSProperties => ({
    color: settings[kind].color,
    fontSize: settings[kind].size,
    backgroundColor: `rgba(0,0,0,${settings.backgroundOpacity / 100})`,
  });
  const scene = (large: boolean) => (
    <div className={`preview-scene ${large ? 'large' : ''}`}>
      <img
        className="landscape"
        src="./preview-landscape.jpg"
        alt={t(
          '群山环绕的湖泊，作为字幕样式的示例背景',
          'A lake surrounded by mountains, used as the subtitle preview background',
        )}
      />
      <div className="scene-shade" />
      <div className="scene-top">
        {!large && (
          <button
            className="scene-button"
            aria-label={t('放大字幕预览', 'Expand subtitle preview')}
            onClick={() => setExpanded(true)}
          >
            <Expand size={15} />
          </button>
        )}
      </div>
      <div
        className="sample-subtitles"
        style={{ gap: settings.subtitleGap }}
        aria-label={t('字幕样式预览', 'Subtitle style preview')}
      >
        <div style={style('original')} dir="auto">
          {sampleText('en')}
        </div>
        <div style={style('translation')} dir="auto">
          {sampleText(settings.targetLanguage)}
        </div>
      </div>
      <div className="scene-bottom">
        <button onClick={() => setSample((value) => 1 - value)}>
          {t('切换示例', 'Next sample')} <span aria-hidden>↻</span>
        </button>
      </div>
    </div>
  );
  return (
    <>
      <section className="preview-panel">
        <div className="preview-heading">
          <h2>
            <Subtitles size={18} /> {copy.subtitlePreview}
          </h2>
        </div>
        {scene(false)}
        <div className="preview-details">
          <div className="style-legend">
            <span>
              <i style={{ background: settings.original.color }} /> {copy.source}{' '}
              <b>{settings.original.size} px</b>
            </span>
            <span>
              <i style={{ background: settings.translation.color }} /> {copy.target}{' '}
              <b>{settings.translation.size} px</b>
            </span>
          </div>
        </div>
      </section>
      {expanded && <PreviewDialog onClose={() => setExpanded(false)}>{scene(true)}</PreviewDialog>}
    </>
  );
}
export function LanguageIcon() {
  return (
    <span className="section-icon">
      <Languages size={18} />
    </span>
  );
}
