import {
  LANGUAGES,
  initI18n,
  applyI18n,
  setLanguage,
  resolveLanguage,
  detectBrowserLanguage,
  t,
} from './lib/i18n.js';

const box = document.getElementById('languages');
const toast = document.getElementById('toast');
let toastTimer;

function render(setting) {
  applyI18n();
  document.title = t('settingsTitle');
  box.querySelectorAll('label.opt').forEach((el) => el.remove());

  const browserLang = LANGUAGES[detectBrowserLanguage(chrome.i18n.getUILanguage())];
  const options = [['auto', t('languageAuto', { lang: browserLang })], ...Object.entries(LANGUAGES)];
  for (const [value, label] of options) {
    const row = document.createElement('label');
    row.className = 'opt';
    const input = Object.assign(document.createElement('input'), { type: 'radio', name: 'language', value });
    input.checked = value === setting;
    input.onchange = () => save(value);
    row.append(input, label);
    box.append(row);
  }
}

async function save(setting) {
  await chrome.storage.sync.set({ language: setting });
  setLanguage(resolveLanguage(setting));
  render(setting);
  toast.textContent = t('savedToast');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.textContent = ''), 2000);
}

render(await initI18n());
