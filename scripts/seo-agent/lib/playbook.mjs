// Плейбук агента — единый план работы над сайтом (свой или клиентский). Не жёсткий скрипт, а
// осознанная последовательность: агент понимает, ЗАЧЕМ его используют, и идёт по шагам, подключая
// нужные модули. Первый запуск (onboard.mjs) показывает этот план и какие шаги доступны по возможностям.

/** @typedef {{n:number, title:string, why:string, needs:string[], modules:string[]}} Step */

/** Шаги для режима «свои сайты» (создаём и продвигаем) и «клиентские» (продвигаем чужие). */
export const PLAYBOOK = {
  own: [
    { n: 1, title: 'Ниша и конкуренты', why: 'понять рынок, спрос и кто в топе — куда бить', needs: ['semantics'], modules: ['serp-intent', 'brand-mentions'] },
    { n: 2, title: 'Семантика и реальные ключи', why: 'выбрать ключи с реальной частотностью под трафик/заявки/топ (без выдумок)', needs: ['semantics'], modules: ['cluster-plan', 'content-brief', 'webmaster.demandGaps'] },
    { n: 3, title: 'AEO-фундамент (поиск + нейросети) + право', why: 'техничка, Schema+сущности (Person/FAQPage/dateModified), доступ AI-ботам (OAI-SearchBot и др.), llms.txt, citability, убрать пустые блоки + 152-ФЗ. Цель — быть цитируемым нейросетями, а не только видимым в поиске.', needs: [], modules: ['aeo', 'schema', 'llmstxt', 'citability', 'eeat', 'templates/politika+cookie+consent'] },
    { n: 35, title: 'Базовый снимок + KPI', why: 'зафиксировать старт (drift baseline) и цели (ключи, трафик, заявки), чтобы мерить прогресс', needs: [], modules: ['drift.baseline', 'agent-journal.goals'] },
    { n: 4, title: 'Оптимизация и новые страницы', why: 'закрывать gap-темы и тонкие страницы; каждая страница — через quality-gate до публикации', needs: ['llm'], modules: ['generate-post', 'expand-existing', 'quality-gate', 'geo-prompt', 'freshness'] },
    { n: 5, title: 'Внешние сервисы агента', why: 'аналитика (Umami/Метрика), A/B форм (GrowthBook), crawl-мониторинг (goaccess), индексация (IndexNow)', needs: [], modules: ['umami-proxy', 'growthbook', 'logaudit', 'indexnow'] },
    { n: 6, title: 'ТГ-бот проекта', why: 'отчёты, /approve рискованного, бюджет-стоп, канал связи с владельцем', needs: ['bot'], modules: ['bot/*', 'daily-report'] },
    { n: 7, title: 'Автономный агент', why: 'петля perceive→decide→act ради роста; наблюдение → 1 боевой цикл → cron; риск через /approve; бюджет-стоп → бот', needs: ['llm', 'bot'], modules: ['agent', 'agent-tools', 'capabilities'] },
  ],
  client: [
    { n: 1, title: 'Аудит и ниша клиента', why: 'глубокий обход сайта (Crawlee), тип бизнеса (local/shop/контент), конкуренты', needs: ['deep_crawl'], modules: ['client-audit', 'deepcrawl', 'local', 'ecommerce'] },
    { n: 2, title: 'Семантика и точки роста', why: 'реальные ключи + gap-анализ: где клиент теряет трафик/заявки', needs: ['semantics'], modules: ['cluster-plan', 'serp-intent'] },
    { n: 3, title: 'Отчёт + КП клиенту', why: 'показать проблемы и план: PDF-отчёт (графики) + КП с тарифами SEO+GEO', needs: ['pdf'], modules: ['client-report', 'proposal', 'charts', 'pdf'] },
    { n: 4, title: 'Работы по сайту', why: 'исправления/новые страницы у клиента (по согласованию), quality-gate', needs: ['llm'], modules: ['generate-post', 'quality-gate'] },
    { n: 5, title: 'Внешние сервисы', why: 'аналитика, A/B, crawl-мониторинг на сайте клиента', needs: [], modules: ['umami', 'growthbook', 'logaudit'] },
    { n: 6, title: 'ТГ-бот + CRM', why: 'бот-пульт агентства: заявки, воронка клиентов (CRM), аудит/КП/аутрич, /discover из 2ГИС', needs: ['bot'], modules: ['bot/*', 'prospect', 'discover', 'outreach', 'kanban'] },
    { n: 7, title: 'Автономный агент + отчёты клиенту', why: 'петля роста + ежемесячный отчёт клиенту (compare), бюджет-стоп → бот', needs: ['llm', 'bot'], modules: ['agent', 'compare'] },
  ],
};

/** Человекочитаемый план с пометкой доступности каждого шага по возможностям сервера. */
export function fmtPlaybook(mode, availableCaps = null) {
  const steps = PLAYBOOK[mode] || PLAYBOOK.own;
  const L = [`📋 <b>План работы — режим «${mode === 'client' ? 'клиентские сайты' : 'свои сайты'}»</b>`, ''];
  for (const s of steps) {
    const gap = availableCaps ? (s.needs || []).filter((n) => !availableCaps.includes(n)) : [];
    const mark = gap.length ? '⚠️' : '✓';
    L.push(`${mark} <b>${s.n === 35 ? '3.5' : s.n}. ${s.title}</b> — ${s.why}` + (gap.length ? `\n   (не хватает: ${gap.join(', ')})` : ''));
  }
  return L.join('\n');
}
