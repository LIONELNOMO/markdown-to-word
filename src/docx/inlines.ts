import {
  ExternalHyperlink,
  FootnoteReferenceRun,
  ImageRun,
  TextRun,
  type IRunOptions,
} from "docx";
import type { Image, PhrasingContent } from "mdast";
import type { ResolvedImage } from "../core/types.js";
import { addWarning, type RenderContext } from "./context.js";
import { STYLE_ID } from "./styles.js";

export type InlineChild = TextRun | ExternalHyperlink | ImageRun | FootnoteReferenceRun;

/** Mise en forme héritée en descendant dans l'arbre (`**_texte_**` → gras + italique). */
export interface InlineFormat {
  readonly bold?: boolean;
  readonly italics?: boolean;
  readonly strike?: boolean;
  readonly style?: string;
}

/** Protocoles autorisés dans un lien. Tout le reste est neutralisé. */
const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:", "ftp:"]);

/**
 * Un `.docx` embarque ses hyperliens dans `word/_rels/…` : un lien
 * `javascript:` ou `file://` importé depuis un Markdown non maîtrisé est un
 * vecteur d'attaque réel. On ne garde que les protocoles inoffensifs ; les
 * chemins relatifs et les ancres sont conservés tels quels.
 */
export function sanitizeUrl(raw: string): string | null {
  const url = raw.trim();
  if (url === "") return null;
  if (url.startsWith("#") || url.startsWith("/") || url.startsWith("./") || url.startsWith("../")) {
    return url;
  }

  // Une URL sans schéma explicite ne peut pas être exécutable.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;

  try {
    return SAFE_PROTOCOLS.has(new URL(url).protocol) ? url : null;
  } catch {
    return null;
  }
}

export function renderInline(
  nodes: readonly PhrasingContent[],
  ctx: RenderContext,
  format: InlineFormat = {},
): InlineChild[] {
  const children: InlineChild[] = [];

  for (const node of nodes) {
    switch (node.type) {
      case "text":
        children.push(new TextRun(runOptions(softBreaksToSpaces(node.value), format)));
        break;

      case "strong":
        children.push(...renderInline(node.children, ctx, { ...format, bold: true }));
        break;

      case "emphasis":
        children.push(...renderInline(node.children, ctx, { ...format, italics: true }));
        break;

      case "delete":
        children.push(...renderInline(node.children, ctx, { ...format, strike: true }));
        break;

      case "inlineCode":
        children.push(
          new TextRun(runOptions(node.value, { ...format, style: STYLE_ID.inlineCode })),
        );
        break;

      case "break":
        children.push(new TextRun({ break: 1 }));
        break;

      case "link":
        children.push(...renderLink(node.children, node.url, ctx, format));
        break;

      case "linkReference": {
        const definition = ctx.definitions.get(node.identifier.toLowerCase());
        if (definition) {
          children.push(...renderLink(node.children, definition.url, ctx, format));
        } else {
          // Référence orpheline : on retombe sur le texte, comme le ferait un
          // moteur Markdown standard.
          children.push(...renderInline(node.children, ctx, format));
        }
        break;
      }

      case "image":
        children.push(...renderImage(node, ctx, format));
        break;

      case "imageReference": {
        const definition = ctx.definitions.get(node.identifier.toLowerCase());
        if (definition) {
          const image: Image = { type: "image", url: definition.url, alt: node.alt ?? null };
          children.push(...renderImage(image, ctx, format));
        } else if (node.alt) {
          children.push(new TextRun(runOptions(node.alt, format)));
        }
        break;
      }

      case "footnoteReference": {
        const id = ctx.footnoteIds.get(node.identifier.toLowerCase());
        if (id !== undefined) children.push(new FootnoteReferenceRun(id));
        break;
      }

      case "html": {
        const inlineHtml = renderInlineHtml(node.value, format);
        if (inlineHtml.length > 0) children.push(...inlineHtml);
        addWarning(
          ctx,
          "Du HTML brut a été rencontré : seul son contenu textuel est repris dans le document Word.",
          node.position?.start.line,
        );
        break;
      }

      default:
        break;
    }
  }

  return children;
}

function renderLink(
  children: readonly PhrasingContent[],
  rawUrl: string,
  ctx: RenderContext,
  format: InlineFormat,
): InlineChild[] {
  const url = sanitizeUrl(rawUrl);
  const inner = renderInline(children, ctx, { ...format, style: format.style ?? "Hyperlink" });

  if (url === null) {
    addWarning(ctx, `Lien ignoré car son protocole n'est pas autorisé : ${truncate(rawUrl)}`);
    return renderInline(children, ctx, format);
  }
  if (inner.length === 0) return [];

  return [new ExternalHyperlink({ children: inner, link: url })];
}

function renderImage(node: Image, ctx: RenderContext, format: InlineFormat): InlineChild[] {
  const resolved = ctx.images.get(node.url);

  if (!resolved) {
    const fallback = node.alt?.trim() ?? "";
    addWarning(
      ctx,
      `Image non intégrée (introuvable, format non pris en charge ou accès refusé) : ${truncate(node.url)}`,
      node.position?.start.line,
    );
    return fallback === "" ? [] : [new TextRun(runOptions(`[${fallback}]`, { ...format, italics: true }))];
  }

  const { width, height } = fitToWidth(resolved, ctx.maxImageWidthPx);
  const alt = node.alt?.trim();

  return [
    new ImageRun({
      type: resolved.type,
      data: resolved.data,
      transformation: { width, height },
      ...(alt
        ? { altText: { name: alt, description: alt, title: node.title ?? alt } }
        : {}),
    }),
  ];
}

/** Réduit l'image à la largeur utile de la page en conservant le ratio. */
export function fitToWidth(
  image: Pick<ResolvedImage, "width" | "height">,
  maxWidth: number,
): { width: number; height: number } {
  if (image.width <= 0 || image.height <= 0) {
    return { width: maxWidth, height: Math.round(maxWidth * 0.75) };
  }
  if (image.width <= maxWidth) {
    return { width: Math.round(image.width), height: Math.round(image.height) };
  }

  const ratio = maxWidth / image.width;
  return { width: maxWidth, height: Math.max(1, Math.round(image.height * ratio)) };
}

/**
 * Le HTML en ligne se limite le plus souvent à `<br>` ou à des balises de mise
 * en forme. On traite le saut de ligne, on ignore les balises, on conserve le texte.
 */
function renderInlineHtml(value: string, format: InlineFormat): InlineChild[] {
  if (/^<br\s*\/?>$/i.test(value.trim())) return [new TextRun({ break: 1 })];

  const text = stripHtml(value);
  return text === "" ? [] : [new TextRun(runOptions(text, format))];
}

export function stripHtml(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, "")).trim();
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const codePoint = entity.startsWith("#x") || entity.startsWith("#X")
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** En Markdown, un retour à la ligne simple est un espace, pas un saut de ligne. */
function softBreaksToSpaces(value: string): string {
  return value.replace(/\s*\r?\n\s*/g, " ");
}

function runOptions(text: string, format: InlineFormat): IRunOptions {
  return {
    text,
    ...(format.bold ? { bold: true } : {}),
    ...(format.italics ? { italics: true } : {}),
    ...(format.strike ? { strike: true } : {}),
    ...(format.style ? { style: format.style } : {}),
  };
}

function truncate(value: string, max = 80): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
