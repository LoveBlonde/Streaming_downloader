import { test } from 'node:test';
import assert from 'node:assert/strict';
import { t, detectBrowserLanguage, LANGUAGES, _MESSAGES } from '../src/lib/i18n.js';

test('모든 언어가 한국어와 같은 키 집합을 가진다', () => {
  const ko = Object.keys(_MESSAGES.ko).sort();
  for (const lang of Object.keys(LANGUAGES)) {
    assert.deepEqual(Object.keys(_MESSAGES[lang]).sort(), ko, `${lang} 키 불일치`);
  }
});

test('모든 언어가 원문과 같은 자리표시자를 쓴다', () => {
  const ph = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join();
  for (const lang of Object.keys(LANGUAGES)) {
    for (const [key, ko] of Object.entries(_MESSAGES.ko)) {
      assert.equal(ph(_MESSAGES[lang][key]), ph(ko), `${lang}.${key}`);
    }
  }
});

test('자리표시자 치환과 대체(fallback)', () => {
  assert.equal(t('retries', { n: 3 }, 'ko'), '재시도 3회');
  assert.equal(t('retries', { n: 3 }, 'en'), 'Retries: 3');
  assert.equal(t('retries', { n: 3 }, 'xx'), 'Retries: 3');
  assert.equal(t('noSuchKey', {}, 'ko'), 'noSuchKey');
});

test('브라우저 언어 매핑', () => {
  assert.equal(detectBrowserLanguage('ko-KR'), 'ko');
  assert.equal(detectBrowserLanguage('ja'), 'ja');
  assert.equal(detectBrowserLanguage('zh-TW'), 'zh-CN');
  assert.equal(detectBrowserLanguage('fr-FR'), 'en');
});
