import { t } from '../shared/i18n';
export const copy = {
  enableSubtitles: t('启用双语字幕', 'Enable bilingual subtitles'),
  source: t('原文', 'Source'),
  target: t('译文', 'Translation'),
  saveFailed: t('保存失败，请重试。', 'Could not save. Try again.'),
  subtitlePreview: t('字幕预览', 'Subtitle preview'),
} as const;
