import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  PageBreak,
  PageNumber,
  Paragraph,
  TableOfContents,
  TextRun,
} from "docx";
import {
  ConversionError,
  type ConversionOptions,
  type ConversionWarning,
  type DocumentMetadata,
  type ResolvedImage,
} from "../core/types.js";
import { metadataFromFrontmatter } from "../markdown/frontmatter.js";
import { indexDocument, type DocumentStats } from "../markdown/inspect.js";
import { parseMarkdown } from "../markdown/parse.js";
import { renderBlocks, type BlockChild } from "./blocks.js";
import { NumberingRegistry, type RenderContext } from "./context.js";
import { CONTENT_WIDTH_PX, MUTED_COLOR, PAGE, documentStyles } from "./styles.js";

export interface BuildResult {
  readonly document: Document;
  /** Nom de fichier complet, extension incluse. */
  readonly fileName: string;
  readonly metadata: DocumentMetadata;
  readonly warnings: readonly ConversionWarning[];
  /** Premier titre rencontré, utilisé pour nommer le fichier en mode automatique. */
  readonly firstHeading: string | null;
  readonly stats: DocumentStats;
}

/** Nombre de téléchargements d'images menés de front. */
const IMAGE_CONCURRENCY = 6;

type SectionChild = BlockChild | TableOfContents;

export async function buildDocument(
  markdown: string,
  options: ConversionOptions = {},
): Promise<BuildResult> {
  if (markdown.trim() === "") {
    throw new ConversionError("Le contenu Markdown est vide : rien à convertir.");
  }

  const root = parseMarkdown(markdown);
  const index = indexDocument(root);
  const metadata: DocumentMetadata = {
    ...metadataFromFrontmatter(index.frontmatter),
    ...options.metadata,
  };

  const warnings: ConversionWarning[] = [];
  const images = await resolveImages(index.imageUrls, options, warnings);

  const footnoteIds = new Map<string, number>();
  for (const identifier of index.footnoteDefinitions.keys()) {
    footnoteIds.set(identifier, footnoteIds.size + 1);
  }

  const ctx: RenderContext = {
    images,
    definitions: index.definitions,
    footnoteIds,
    footnoteDefinitions: index.footnoteDefinitions,
    numbering: new NumberingRegistry(),
    maxImageWidthPx: options.maxImageWidthPx ?? CONTENT_WIDTH_PX,
    warnings,
  };

  const body = renderBlocks(root.children, ctx);
  const children: SectionChild[] = [
    ...(options.tableOfContents ? tableOfContents() : []),
    // Une section OOXML doit contenir au moins un élément.
    ...(body.length > 0 ? body : [new Paragraph({ children: [] })]),
  ];

  const documentTitle = metadata.title ?? index.firstHeading ?? undefined;

  const document = new Document({
    ...(metadata.title ? { title: metadata.title } : {}),
    ...(metadata.creator ? { creator: metadata.creator } : {}),
    ...(metadata.subject ? { subject: metadata.subject } : {}),
    ...(metadata.description ? { description: metadata.description } : {}),
    ...(metadata.keywords ? { keywords: metadata.keywords } : {}),
    styles: documentStyles,
    numbering: ctx.numbering.build(),
    footnotes: buildFootnotes(ctx),
    // Sans ce drapeau, la table des matières reste vide tant que l'utilisateur
    // n'a pas pressé F9 lui-même.
    ...(options.tableOfContents ? { features: { updateFields: true } } : {}),
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE.width, height: PAGE.height },
            margin: {
              top: PAGE.margin,
              right: PAGE.margin,
              bottom: PAGE.margin,
              left: PAGE.margin,
            },
          },
        },
        ...(options.pageHeader
          ? {
              headers: { default: pageHeaderFor(documentTitle) },
              footers: { default: pageFooter() },
            }
          : {}),
        children,
      },
    ],
  });

  return {
    document,
    fileName: `${deriveBaseName(options.baseName, metadata.title, index.firstHeading)}.docx`,
    metadata,
    warnings,
    firstHeading: index.firstHeading,
    stats: index.stats,
  };
}

function tableOfContents(): SectionChild[] {
  return [
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Table des matières")] }),
    new TableOfContents("Table des matières", {
      hyperlink: true,
      headingStyleRange: "1-3",
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

function pageHeaderFor(title: string | undefined): Header {
  return new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: { after: 120 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "D0D7DE", space: 4 } },
        children: [new TextRun({ text: title ?? "", size: 18, color: MUTED_COLOR })],
      }),
    ],
  });
}

function pageFooter(): Footer {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 120 },
        children: [
          new TextRun({
            children: ["Page ", PageNumber.CURRENT, " / ", PageNumber.TOTAL_PAGES],
            size: 18,
            color: MUTED_COLOR,
          }),
        ],
      }),
    ],
  });
}

function buildFootnotes(ctx: RenderContext): Record<number, { children: Paragraph[] }> {
  const footnotes: Record<number, { children: Paragraph[] }> = {};

  for (const [identifier, id] of ctx.footnoteIds) {
    const definition = ctx.footnoteDefinitions.get(identifier);
    if (!definition) continue;

    // Une note de bas de page OOXML n'accepte que des paragraphes : un tableau
    // inséré dans une note est écarté plutôt que de produire un fichier invalide.
    const paragraphs = renderBlocks(definition.children, ctx).filter(
      (block): block is Paragraph => block instanceof Paragraph,
    );
    footnotes[id] = { children: paragraphs.length > 0 ? paragraphs : [new Paragraph({})] };
  }

  return footnotes;
}

async function resolveImages(
  urls: readonly string[],
  options: ConversionOptions,
  warnings: ConversionWarning[],
): Promise<Map<string, ResolvedImage | null>> {
  const resolved = new Map<string, ResolvedImage | null>();
  if (urls.length === 0) return resolved;

  const { imageResolver } = options;
  if (!imageResolver) {
    warnings.push({
      message: "Les images n'ont pas été intégrées : aucun mode de chargement n'est configuré.",
    });
    return resolved;
  }

  await mapWithConcurrency(urls, IMAGE_CONCURRENCY, async (url) => {
    // Une image qui échoue ne doit jamais interrompre les autres.
    const image = await imageResolver.resolve(url).catch(() => null);
    resolved.set(url, image);
  });

  return resolved;
}

async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      if (item !== undefined) await task(item);
    }
  });

  await Promise.all(workers);
}

/** Caractères interdits dans un nom de fichier Windows. */
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*]/g;
/** Noms réservés MS-DOS : refusés par Windows même suivis d'une extension. */
const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function deriveBaseName(
  explicit: string | undefined,
  title: string | undefined,
  firstHeading: string | null,
): string {
  const candidate = explicit?.trim() || title?.trim() || firstHeading?.trim() || "document";
  return sanitizeFileName(candidate);
}

export function sanitizeFileName(value: string): string {
  const cleaned = value
    .replace(INVALID_FILENAME_CHARS, " ")
    // Caractères de contrôle : illégaux dans un nom de fichier sur tout OS.
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    // Windows refuse les noms terminés par un point ou un espace.
    .replace(/[. ]+$/, "")
    .slice(0, 100)
    .trim();

  if (cleaned === "" || RESERVED_WINDOWS_NAMES.test(cleaned)) return "document";
  return cleaned;
}
