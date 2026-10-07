import { t } from './i18n.js';

/** 화면 언어에 맞춰 번역할 수 있도록 메시지 키와 인자를 함께 담는 에러. */
export class LocalizedError extends Error {
  constructor(i18nKey, params = {}) {
    super(t(i18nKey, params));
    this.name = 'LocalizedError';
    this.i18nKey = i18nKey;
    this.params = params;
  }
}
