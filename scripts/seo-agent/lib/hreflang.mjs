// hreflang / i18n — для мультиязычных и инъязычных сайтов (нужно, когда агент растит Google-трафик
// на нескольких языках). ОПТ-ИН: активен, только если в профиле задан PROFILE.i18n с ≥2 локалями.
// По умолчанию (моноязычный RU-сайт под Яндекс) молчит.
//
// hreflang говорит Google/Яндексу «вот та же страница на другом языке» → правильная версия в нужной
// стране, нет каннибализации дублей. Обязательна взаимность (каждая версия ссылается на все, включая себя)
// и x-default. Ссылки должны быть абсолютные и на индексируемые (200, self-canonical) URL.

/** Готов ли i18n-слой (в профиле ≥2 локалей). false → сайт моноязычный, hreflang не нужен. */
export function hreflangReady(profile) {
  const loc = profile?.i18n?.locales;
  return Array.isArray(loc) && loc.length >= 2;
}

/**
 * Собрать hreflang-кластер для одной страницы.
 * @param {object} profile — site.profile.mjs (нужен profile.i18n).
 * @param {Record<string,string>} urlsByLocale — {'ru':'https://site.ru/page', 'en':'https://site.ru/en/page', ...}
 *        Ключи — коды локалей из profile.i18n.locales. Значения — АБСОЛЮТНЫЕ URL.
 * @param {object} [opts] — { xDefault: '<локаль для x-default>' } (по умолчанию — profile.i18n.default или первая).
 * @returns {Array<{hreflang:string, href:string}>} — готовые пары для <link rel="alternate">.
 */
export function buildCluster(profile, urlsByLocale, opts = {}) {
  if (!hreflangReady(profile)) return [];
  const locales = profile.i18n.locales; // [{code:'ru', hreflang:'ru-RU'}, {code:'en', hreflang:'en-US'}] или ['ru','en']
  const norm = locales.map((l) => (typeof l === 'string' ? { code: l, hreflang: l } : l));
  const out = [];
  for (const { code, hreflang } of norm) {
    const href = urlsByLocale[code];
    if (href) out.push({ hreflang, href });
  }
  // x-default — версия «по умолчанию» для стран/языков вне списка (обычно основная или англ.)
  const xd = opts.xDefault || profile.i18n.default || norm[0]?.code;
  if (xd && urlsByLocale[xd]) out.push({ hreflang: 'x-default', href: urlsByLocale[xd] });
  return out;
}

/** Отрендерить кластер в HTML-теги <link rel="alternate" hreflang="..."> (в <head>). */
export function renderTags(cluster) {
  return cluster.map((c) => `<link rel="alternate" hreflang="${c.hreflang}" href="${c.href}" />`).join('\n');
}

/**
 * Проверка корректности кластера (частые ошибки hreflang).
 * @returns {{ok:boolean, issues:string[]}}
 */
export function validateCluster(cluster) {
  const issues = [];
  if (!cluster.length) return { ok: true, issues };
  const seen = new Set();
  for (const c of cluster) {
    if (!/^https?:\/\//.test(c.href)) issues.push(`hreflang ${c.hreflang}: URL не абсолютный (${c.href})`);
    if (c.hreflang !== 'x-default' && !/^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(c.hreflang)) issues.push(`некорректный код языка: ${c.hreflang}`);
    if (seen.has(c.hreflang)) issues.push(`дубль hreflang: ${c.hreflang}`);
    seen.add(c.hreflang);
  }
  if (!seen.has('x-default')) issues.push('нет x-default (рекомендуется добавить)');
  return { ok: issues.length === 0, issues };
}

/**
 * Аудит проверки взаимности по набору кластеров всех страниц:
 * если A ссылается на B, B обязана ссылаться на A. Иначе Google игнорирует hreflang.
 * @param {Array<{page:string, cluster:Array<{hreflang,href}>}>} pages
 */
export function auditReciprocity(pages) {
  const byUrl = new Map(pages.map((p) => [p.page, new Set(p.cluster.map((c) => c.href))]));
  const broken = [];
  for (const p of pages) {
    for (const c of p.cluster) {
      if (c.hreflang === 'x-default' || c.href === p.page) continue;
      const back = byUrl.get(c.href);
      if (!back || !back.has(p.page)) broken.push({ from: p.page, to: c.href, hreflang: c.hreflang });
    }
  }
  return { ok: broken.length === 0, broken };
}
