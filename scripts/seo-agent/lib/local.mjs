// RU-local модуль (агентский режим): детект локального бизнеса + чек-лист локальных сигналов для
// аудита клиента + генератор LocalBusiness/MedicalClinic JSON-LD. Инструментарий RU — Яндекс Бизнес /
// Яндекс Карты (не Google GBP). Для одиночных локальных бизнесов (клиника, салон, магазин с адресом).

const RX_ADDRESS = /(?:\bг\.?\s?[А-ЯЁ][а-яё-]+|город\s+[А-ЯЁ])[^<]{0,60}?(?:ул\.?|улица|пр-?кт|проспект|пер\.?|переулок|шоссе|наб\.?|д\.?\s?\d)/i;
const RX_INDEX = /\b\d{6}\b/;
const RX_PHONE = /(?:tel:|href=["']tel:)?\+7[\s(]?\d{3}[\s)]?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/;
const RX_YMAPS = /(yandex\.[a-z]+\/maps|api-maps\.yandex|yandex\.ru\/(?:maps|sprav)|yandexbusiness|maps\.yandex|api\.yandex\.ru\/maps)/i;
const RX_HOURS = /(пн[\s.–-]*пт|ежедневно|круглосуточно|время работы|режим работы|\d{1,2}:\d{2}\s*[–-]\s*\d{1,2}:\d{2})/i;
const RX_LOCALSCHEMA = /"@type"\s*:\s*(?:"[^"]*(?:LocalBusiness|MedicalClinic|Dentist|Store|Restaurant|BeautySalon|MedicalBusiness)[^"]*"|\[[^\]]*(?:LocalBusiness|MedicalClinic|Dentist)[^\]]*\])/i;

/** Похоже ли на локальный бизнес (по главной). @returns {{isLocal, signals}} */
export function detectLocal(html) {
  const h = String(html);
  const s = {
    address: RX_ADDRESS.test(h) || RX_INDEX.test(h),
    phone: RX_PHONE.test(h),
    map: RX_YMAPS.test(h),
    hours: RX_HOURS.test(h),
    schema: RX_LOCALSCHEMA.test(h),
  };
  const score = (s.address ? 2 : 0) + (s.phone ? 1 : 0) + (s.map ? 1 : 0) + (s.hours ? 1 : 0);
  return { isLocal: score >= 2, signals: s };
}

/** Локальные проблемы для отчёта клиента. @returns {Array<{sev,cat,msg}>} */
export function localChecks(html) {
  const { isLocal, signals } = detectLocal(html);
  if (!isLocal) return [];
  const out = [];
  if (!signals.schema) out.push({ sev: 'high', cat: 'local', msg: 'Нет LocalBusiness/MedicalClinic-разметки — Яндекс/нейросети не распознают карточку организации' });
  if (!signals.map) out.push({ sev: 'medium', cat: 'local', msg: 'Нет карты Яндекс / ссылки на Яндекс Бизнес — теряете видимость в Картах и локальной выдаче' });
  if (!signals.address) out.push({ sev: 'high', cat: 'local', msg: 'Адрес не найден на странице (NAP) — критично для локального SEO' });
  if (!signals.phone) out.push({ sev: 'high', cat: 'local', msg: 'Телефон не найден в разметке (tel:) — снижает конверсию и локальные сигналы' });
  if (!signals.hours) out.push({ sev: 'low', cat: 'local', msg: 'Не указан режим работы (OpeningHours) — полезно для карточки в Картах' });
  return out;
}

/** Чек-лист Яндекс Бизнес (рекомендации, не привязаны к странице). */
export const YANDEX_BUSINESS_CHECKLIST = [
  'Завести/заполнить карточку в Яндекс Бизнесе (адрес, телефон, часы, категории, фото)',
  'NAP (название/адрес/телефон) одинаковы на сайте, в Картах и справочниках',
  'Собрать отзывы в Яндекс Картах (свежие отзывы = выше в локальной выдаче)',
  'Указать зону обслуживания (areaServed) и районы',
  'Добавить LocalBusiness-разметку с sameAs на карточку Яндекс Бизнеса',
];

/**
 * Генератор LocalBusiness JSON-LD (для оптимизации сайта клиента/каталожной карточки).
 * @param {object} d — { type='LocalBusiness', name, url, phone, email, street, city, postal, lat, lng, hours, priceRange, areaServed[], sameAs[], image }
 */
export function localBusinessSchema(d = {}) {
  const node = {
    '@type': d.type || 'LocalBusiness',
    name: d.name,
    ...(d.url ? { url: d.url } : {}),
    ...(d.phone ? { telephone: d.phone } : {}),
    ...(d.email ? { email: d.email } : {}),
    ...(d.image ? { image: d.image } : {}),
    ...(d.street || d.city ? {
      address: {
        '@type': 'PostalAddress',
        ...(d.street ? { streetAddress: d.street } : {}),
        ...(d.city ? { addressLocality: d.city } : {}),
        ...(d.postal ? { postalCode: d.postal } : {}),
        addressCountry: 'RU',
      },
    } : {}),
    ...(d.lat && d.lng ? { geo: { '@type': 'GeoCoordinates', latitude: d.lat, longitude: d.lng } } : {}),
    ...(d.hours ? { openingHours: d.hours } : {}),
    ...(d.priceRange ? { priceRange: d.priceRange } : {}),
    ...(d.areaServed?.length ? { areaServed: d.areaServed } : {}),
    ...(d.sameAs?.length ? { sameAs: d.sameAs } : {}), // ссылки на Яндекс Бизнес/Карты
  };
  return { '@context': 'https://schema.org', ...node };
}
