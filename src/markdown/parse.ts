import type { Root } from "mdast";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

/**
 * Processeur unique et sans état : `parse()` ne mute rien, on peut donc le
 * réutiliser d'une conversion à l'autre sans risque (et sans repayer le coût
 * d'assemblage des plugins).
 *
 * - `remark-gfm`     : tableaux, listes de tâches, barré, notes de bas de page, autoliens.
 * - `remark-frontmatter` : isole le bloc YAML de tête au lieu de le rendre comme du texte.
 */
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ["yaml"])
  .freeze();

export function parseMarkdown(source: string): Root {
  return processor.parse(source) as Root;
}
