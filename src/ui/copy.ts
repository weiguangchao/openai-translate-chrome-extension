import { t } from '../shared/i18n';
export const copy = {
  enableSubtitles: t('启用双语字幕', 'Enable bilingual subtitles'),
  source: t('原文', 'Source'),
  target: t('译文', 'Translation'),
  translationLanguage: t('翻译语言', 'Translation language'),
  translationService: t('翻译服务', 'Translation service'),
  saveFailed: t('保存失败，请重试。', 'Could not save. Try again.'),
  loadFailed: t(
    '无法读取本地设置，请检查浏览器存储权限。',
    'Could not load local settings. Check browser storage permissions.',
  ),
  subtitlePreview: t('字幕预览', 'Subtitle preview'),
} as const;
