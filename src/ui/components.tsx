import { Check, ChevronDown, Expand, Languages, Subtitles, X } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { LANGUAGES, type Settings } from '../shared/settings';

export function Logo({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand ${small ? 'brand-small' : ''}`}>
      <img src="./logo.svg" alt="" />
      <div>
        <strong>
          Subline<span className="brand-period">.</span>
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
function PreviewDialog({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog ref={ref} className="preview-dialog" aria-label="放大的字幕预览" onCancel={onClose}>
      <div>
        <button autoFocus className="dialog-close" aria-label="关闭字幕预览" onClick={onClose}>
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
  ja: ['私たちを待っている世界がある。', 'ゆっくり味わいたい瞬間がある。'],
  ko: ['우리를 기다리는 세상이 있어요.', '천천히 음미할 가치가 있는 순간들이 있어요.'],
  fr: ['Tout un monde nous attend.', 'Certains instants méritent de ralentir.'],
  de: ['Eine ganze Welt wartet auf uns.', 'Für manche Momente lohnt es sich, langsamer zu werden.'],
  es: ['Hay todo un mundo esperándonos.', 'Hay momentos que merecen disfrutarse sin prisa.'],
  pt: ['Há um mundo inteiro à nossa espera.', 'Alguns momentos merecem ser vividos devagar.'],
  it: ['C’è un mondo intero che ci aspetta.', 'Alcuni momenti meritano di rallentare.'],
  ru: ['Нас ждёт целый мир.', 'Ради некоторых мгновений стоит замедлиться.'],
  ar: ['هناك عالم كامل ينتظرنا.', 'بعض اللحظات تستحق أن نتمهل من أجلها.'],
  hi: ['एक पूरी दुनिया हमारा इंतज़ार कर रही है।', 'कुछ पलों के लिए ठहरना अच्छा होता है।'],
  th: ['มีโลกทั้งใบกำลังรอเราอยู่', 'บางช่วงเวลาก็คุ้มค่าที่จะค่อย ๆ ซึมซับ'],
  vi: ['Cả một thế giới đang chờ chúng ta.', 'Có những khoảnh khắc đáng để sống chậm lại.'],
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
        alt="群山环绕的湖泊，作为字幕样式的示例背景"
      />
      <div className="scene-shade" />
      <div className="scene-top">
        {!large && (
          <button
            className="scene-button"
            aria-label="放大字幕预览"
            onClick={() => setExpanded(true)}
          >
            <Expand size={15} />
          </button>
        )}
      </div>
      <div
        className="sample-subtitles"
        style={{ gap: settings.subtitleGap }}
        aria-label="字幕样式预览"
      >
        <div style={style('original')} dir="auto">
          {sampleText(settings.sourceLanguage)}
        </div>
        <div style={style('translation')} dir="auto">
          {sampleText(settings.targetLanguage)}
        </div>
      </div>
      <div className="scene-bottom">
        <span>
          <Subtitles size={15} /> 双语字幕示例
        </span>
        <button onClick={() => setSample((value) => 1 - value)}>
          切换示例 <span aria-hidden>↻</span>
        </button>
      </div>
    </div>
  );
  return (
    <>
      <section className="preview-panel">
        <div className="preview-heading">
          <h2>
            <Subtitles size={18} /> 字幕预览
          </h2>
          <span className="live-label">
            <i /> 实时更新
          </span>
        </div>
        {scene(false)}
        <div className="preview-details">
          <div className="style-legend">
            <span>
              <i style={{ background: settings.original.color }} /> 原文{' '}
              <b>{settings.original.size} px</b>
            </span>
            <span>
              <i style={{ background: settings.translation.color }} /> 译文{' '}
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
