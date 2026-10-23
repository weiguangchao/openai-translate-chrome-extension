const chinese = /^zh(?:-|$)/i.test(navigator.language);

export const uiLanguage = chinese ? 'zh-CN' : 'en';

export function t(zh: string, en: string): string {
  return chinese ? zh : en;
}
