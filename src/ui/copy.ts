import { t } from '../shared/i18n';
export const copy = {
  enableSubtitles: t('启用字幕', 'Enable subtitles'),
  subtitles: t('字幕', 'Subtitles'),
  source: t('原文', 'Source'),
  target: t('译文', 'Translation'),
  translationLanguage: t('翻译语言', 'Translation language'),
  translationService: t('翻译服务', 'Translation service'),
  openaiCompatible: t('OpenAI 兼容接口', 'OpenAI-compatible'),
  reviewConsent: t('查看字幕数据授权', 'Review caption data consent'),
  saveFailed: t('保存失败，请重试。', 'Could not save. Try again.'),
  loadFailed: t(
    '无法读取本地设置，请检查浏览器存储权限。',
    'Could not load local settings. Check browser storage permissions.',
  ),
  subtitlePreview: t('字幕预览', 'Subtitle preview'),
  displayMode: t('显示模式', 'Display mode'),
  bilingual: t('双语', 'Bilingual'),
  translationOnly: t('仅译文', 'Translation only'),
} as const;
