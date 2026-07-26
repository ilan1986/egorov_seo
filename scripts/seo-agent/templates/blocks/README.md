# Библиотека лендинг-блоков (донор: AstroWind)

Готовые self-contained Astro-секции для быстрой сборки лендингов (агентство, продуктовые
страницы ilyaegorov, клиентские лендинги). Идеи блоков — из **AstroWind** (onwidget/astrowind,
MIT), переписаны под чистый CSS (без Tailwind), scoped-стили, CSS-переменные темы
(`--navy --accent --muted --border --surface`) — подхватывают палитру сайта или дефолты.

| Блок | Назначение | Ключевые props |
|------|-----------|----------------|
| `Hero.astro` | Первый экран: тезис + CTA + картинка | title, subtitle, tagline?, primary, secondary?, image? |
| `Features.astro` | Сетка преимуществ/услуг | title?, columns?=3, items:[{icon,title,text}] |
| `Steps.astro` | «Как это работает» (нумерованный процесс) | title?, items:[{title,text}] |
| `Faqs.astro` | Вопрос-ответ, нативный `<details>`, без JS | title?, items:[{q,a}] |
| `CallToAction.astro` | Финальная лента-призыв | title, text?, primary, secondary? |

## Пример страницы

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import Hero from '../components/blocks/Hero.astro';
import Features from '../components/blocks/Features.astro';
import Steps from '../components/blocks/Steps.astro';
import Faqs from '../components/blocks/Faqs.astro';
import CallToAction from '../components/blocks/CallToAction.astro';
---
<BaseLayout title="…" description="…" path="/lp/">
  <Hero title="Заголовок-<b>тезис</b>" subtitle="…" tagline="УСЛУГА"
    primary={{ text: 'Оставить заявку', href: '#lead' }} />
  <Features title="Что вы получите" items={[
    { icon: '⚡', title: '…', text: '…' },
    { icon: '🎯', title: '…', text: '…' },
    { icon: '📈', title: '…', text: '…' },
  ]} />
  <Steps title="Как мы работаем" items={[{title:'…',text:'…'},{title:'…',text:'…'}]} />
  <Faqs title="Частые вопросы" items={[{q:'…',a:'…'}]} />
  <CallToAction title="Готовы начать?" primary={{ text: 'Обсудить проект', href: '#lead' }} />
</BaseLayout>
```

## Подсказки
- Блоки кладутся в `src/components/blocks/` конкретного проекта.
- Пары из `Faqs` продублируй как **FAQPage JSON-LD** (`lib/schema.mjs`) — плюс к GEO-цитируемости.
- `Hero.title` / заголовки принимают HTML (`set:html`) — можно выделять `<b>` слово-акцент.
- Тарифные карточки для КП/агентства — брать из `site.profile.agency.packages` (уже есть).
