// Единая точка публикации статьи. Тип цели — из site.profile.mjs → publish.type:
//   • 'astro' (по умолчанию): пишем MDX-файл в целевую коллекцию (сборка/FTP — отдельным шагом);
//   • 'joomla': публикуем напрямую через REST API Joomla (статья появляется на сайте сразу).
// Возвращает публичный URL опубликованной статьи (для лога и переобхода).
import { PROFILE } from '../../../site.profile.mjs';
import { writeBlogPost, targetUrlBase } from './content.mjs';
import { parsePost, publishToJoomla } from './publish-joomla.mjs';

export function publishTarget() { return PROFILE.publish?.type || 'astro'; }

export async function publishPost(slug, mdx) {
  if (publishTarget() === 'joomla') {
    const post = parsePost(mdx, slug);
    const res = await publishToJoomla(post, PROFILE.publish);
    return res.url;
  }
  // Astro (дефолт) — поведение как раньше: запись MDX-файла.
  writeBlogPost(slug, mdx);
  return `${targetUrlBase()}${slug}/`;
}
