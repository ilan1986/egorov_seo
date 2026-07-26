// E-commerce слой (агентский режим): детект интернет-магазина + чек-лист товарных SEO-сигналов для
// аудита клиента + генератор Product/Offer JSON-LD. Для клиентов-магазинов (напр. из 2ГИС).

const RX_CART = /(в корзину|добавить в корзину|купить в один клик|оформить заказ|add to cart|\bкорзина\b|checkout)/i;
const RX_PRICE = /(\d[\d\s.,]*\s*(?:₽|руб\.?|р\.))/i;
const RX_BUY = /(купить|заказать|в наличии|под заказ|доставка)/i;
const RX_PRODSCHEMA = /"@type"\s*:\s*(?:"Product"|\[[^\]]*"Product"[^\]]*\])/i;
const RX_OFFERSCHEMA = /"@type"\s*:\s*"Offer"|"priceCurrency"|"availability"/i;
const RX_RATINGSCHEMA = /"@type"\s*:\s*"AggregateRating"|"ratingValue"/i;
const RX_CATALOG_URL = /\/(catalog|product|tovar|goods|shop|store|cart|basket|collection)\//i;
const RX_FEED = /(yandex.*market|market\.yandex|yml_catalog|merchant|shopping.*feed)/i;

/** Похоже ли на интернет-магазин. @returns {{isShop, signals}} */
export function detectShop(html, url = '') {
  const h = String(html);
  const s = {
    cart: RX_CART.test(h),
    price: RX_PRICE.test(h),
    buy: RX_BUY.test(h),
    catalogUrl: RX_CATALOG_URL.test(url) || RX_CATALOG_URL.test(h),
    productSchema: RX_PRODSCHEMA.test(h),
  };
  const score = (s.cart ? 2 : 0) + (s.price ? 1 : 0) + (s.buy ? 1 : 0) + (s.catalogUrl ? 1 : 0);
  return { isShop: score >= 3, signals: s };
}

/** Товарные проблемы для отчёта клиента. */
export function ecommerceChecks(html, url = '') {
  const { isShop, signals } = detectShop(html, url);
  if (!isShop) return [];
  const h = String(html);
  const out = [];
  if (!signals.productSchema) out.push({ sev: 'high', cat: 'ecommerce', msg: 'Нет Product-разметки — цена/наличие/рейтинг не попадают в сниппет Яндекса и в ответы нейросетей' });
  else {
    if (!RX_OFFERSCHEMA.test(h)) out.push({ sev: 'medium', cat: 'ecommerce', msg: 'Product без Offer (цена/валюта/наличие) — неполная разметка' });
    if (!RX_RATINGSCHEMA.test(h)) out.push({ sev: 'low', cat: 'ecommerce', msg: 'Нет AggregateRating — звёзды рейтинга не показываются в выдаче' });
  }
  if (!RX_PRICE.test(h)) out.push({ sev: 'medium', cat: 'ecommerce', msg: 'Цена не найдена в разметке — важна для товарных сниппетов и фидов' });
  if (!RX_FEED.test(h)) out.push({ sev: 'low', cat: 'ecommerce', msg: 'Не видно товарного фида (Яндекс Маркет) — упущенный канал продаж' });
  return out;
}

/** Рекомендации для магазина. */
export const ECOMMERCE_CHECKLIST = [
  'Product + Offer + AggregateRating разметка на карточках товара',
  'Товарный фид (YML) для Яндекс Маркета',
  'Канонизация фасетных фильтров (не плодить дубли-URL из комбинаций фильтров)',
  'Уникальные описания карточек (не копипаст с сайта поставщика)',
  'Отзывы на товары (Review) + микроразметка',
  'Хлебные крошки (BreadcrumbList) на категориях и карточках',
];

/**
 * Генератор Product JSON-LD.
 * @param {object} d — { name, image, description, brand, sku, price, currency='RUB', availability='InStock', ratingValue, reviewCount, url }
 */
export function productSchema(d = {}) {
  return {
    '@context': 'https://schema.org', '@type': 'Product',
    name: d.name,
    ...(d.image ? { image: d.image } : {}),
    ...(d.description ? { description: d.description } : {}),
    ...(d.brand ? { brand: { '@type': 'Brand', name: d.brand } } : {}),
    ...(d.sku ? { sku: d.sku } : {}),
    ...(d.price != null ? {
      offers: {
        '@type': 'Offer', price: String(d.price), priceCurrency: d.currency || 'RUB',
        availability: `https://schema.org/${d.availability || 'InStock'}`,
        ...(d.url ? { url: d.url } : {}),
      },
    } : {}),
    ...(d.ratingValue != null ? {
      aggregateRating: { '@type': 'AggregateRating', ratingValue: String(d.ratingValue), reviewCount: String(d.reviewCount || 1) },
    } : {}),
  };
}
