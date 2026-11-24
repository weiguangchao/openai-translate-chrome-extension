import { t } from '../shared/i18n';
export const copy = {
  get enableSubtitles() {
    return t('启用字幕', 'Enable subtitles', '啟用字幕', '字幕を有効にする');
  },
  get subtitles() {
    return t('字幕', 'Subtitles', '字幕', '字幕');
  },
  get source() {
    return t('原文', 'Source', '原文', '原文');
  },
  get target() {
    return t('译文', 'Translation', '譯文', '翻訳');
  },
  get translationLanguage() {
    return t('翻译语言', 'Translation language', '翻譯語言', '翻訳先の言語');
  },
  get translationService() {
    return t('翻译服务', 'Translation service', '翻譯服務', '翻訳サービス');
  },
  get openaiCompatible() {
    return t('OpenAI 兼容接口', 'OpenAI-compatible', 'OpenAI 相容 API', 'OpenAI 互換 API');
  },
  get reviewConsent() {
    return t(
      '查看字幕数据授权',
      'Review caption data consent',
      '查看字幕資料授權',
      '字幕データの送信への同意を確認',
    );
  },
  get saveFailed() {
    return t(
      '保存失败，请重试。',
      'Could not save. Try again.',
      '儲存失敗，請重試。',
      '保存に失敗しました。再試行してください。',
    );
  },
  get loadFailed() {
    return t(
      '无法读取本地设置，请检查浏览器存储权限。',
      'Could not load local settings. Check browser storage permissions.',
      '無法讀取本機設定，請檢查瀏覽器儲存空間權限。',
      'ローカルの設定を読み込めません。ブラウザのストレージ権限を確認してください。',
    );
  },
  get subtitlePreview() {
    return t('字幕预览', 'Subtitle preview', '字幕預覽', '字幕プレビュー');
  },
  get displayMode() {
    return t('显示模式', 'Display mode', '顯示模式', '表示モード');
  },
  get bilingual() {
    return t('双语', 'Bilingual', '雙語', 'バイリンガル');
  },
  get translationOnly() {
    return t('仅译文', 'Translation only', '僅譯文', '翻訳のみ');
  },
};
