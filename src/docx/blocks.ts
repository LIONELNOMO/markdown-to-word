import {
  AlignmentType,
  BorderStyle,
  HeadingLevel,
  Paragraph,
  Table,
  TextRun,
  type IParagraphOptions,
} from "docx";
import type { BlockContent, List, RootContent } from "mdast";
import { addWarning, type RenderContext } from "./context.js";
import { renderInline, stripHtml } from "./inlines.js";
import { INDENT_STEP, MAX_LIST_LEVEL, NUMBERING_REF, STYLE_ID } from "./styles.js";
import { renderTable } from "./tables.js";

export type BlockChild = Paragraph | Table;

export interface BlockOptions {
  /** Indentation gauche supplémentaire, en twips. */
  readonly indent?: number;
  /** Profondeur de citation ; > 0 applique le style « citation ». */
  readonly quoteDepth?: number;
}

const HEADING_LEVELS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const;

/** Numérotation en cours, transmise aux sous-listes pour préserver la hiérarchie. */
interface ListNumbering {
  readonly reference: string;
  readonly instance: number;
}

export function renderBlocks(
  nodes: readonly RootContent[],
  ctx: RenderContext,
  options: BlockOptions = {},
): BlockChild[] {
  const blocks: BlockChild[] = [];

  for (const node of nodes) {
    switch (node.type) {
      case "heading":
        blocks.push(
          paragraph(
            {
              heading: HEADING_LEVELS[clamp(node.depth, 1, 6) - 1],
              children: renderInline(node.children, ctx),
            },
            options,
          ),
        );
        break;

      case "paragraph": {
        const children = renderInline(node.children, ctx);
        if (children.length === 0) break;

        // Une image seule sur sa ligne se comporte comme une illustration : centrée.
        const isStandaloneImage =
          node.children.length === 1 && node.children[0]?.type === "image";

        blocks.push(
          paragraph(
            { children, ...(isStandaloneImage ? { alignment: AlignmentType.CENTER } : {}) },
            options,
          ),
        );
        break;
      }

      case "list":
        blocks.push(...renderList(node, ctx, options, 0));
        break;

      case "code":
        blocks.push(...renderCode(node.value, options));
        break;

      case "blockquote":
        blocks.push(
          ...renderBlocks(node.children, ctx, {
            indent: (options.indent ?? 0) + INDENT_STEP * 2,
            quoteDepth: (options.quoteDepth ?? 0) + 1,
          }),
        );
        break;

      case "thematicBreak":
        blocks.push(
          new Paragraph({
            spacing: { before: 200, after: 200 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "D0D7DE", space: 1 } },
          }),
        );
        break;

      case "table":
        blocks.push(renderTable(node, ctx));
        // Word fusionne deux tableaux consécutifs s'ils ne sont pas séparés par
        // un paragraphe ; celui-ci sert aussi de point d'insertion à la souris.
        blocks.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
        break;

      case "html": {
        const text = stripHtml(node.value);
        addWarning(
          ctx,
          "Du HTML brut a été rencontré : seul son contenu textuel est repris dans le document Word.",
          node.position?.start.line,
        );
        if (text !== "") blocks.push(paragraph({ children: [new TextRun(text)] }, options));
        break;
      }

      // Nœuds sans rendu direct : métadonnées ou contenus rendus ailleurs.
      case "yaml":
      case "definition":
      case "footnoteDefinition":
        break;

      default:
        break;
    }
  }

  return blocks;
}

function renderList(
  node: List,
  ctx: RenderContext,
  options: BlockOptions,
  level: number,
  inherited?: ListNumbering,
): BlockChild[] {
  const reference = node.ordered
    ? ctx.numbering.orderedRef(node.start ?? 1)
    : NUMBERING_REF.bullet;

  // Une sous-liste de même nature réutilise l'instance du parent : c'est ce qui
  // fait repartir le compteur du niveau n+1 à chaque élément du niveau n.
  const numbering: ListNumbering =
    inherited?.reference === reference
      ? inherited
      : { reference, instance: ctx.numbering.nextInstance() };

  const blocks: BlockChild[] = [];
  const contentIndent = (options.indent ?? 0) + INDENT_STEP * 2 * (level + 1);

  for (const item of node.children) {
    const isTask = typeof item.checked === "boolean";
    const [firstChild, ...trailing] = item.children;
    const leadOptions: IParagraphOptions = isTask
      ? {
          indent: { left: contentIndent, hanging: INDENT_STEP },
          spacing: { after: node.spread ? 160 : 60 },
        }
      : {
          numbering: { reference: numbering.reference, level, instance: numbering.instance },
          ...(node.spread ? { spacing: { after: 160 } } : {}),
        };

    const checkbox = isTask ? [new TextRun({ text: item.checked ? "☑  " : "☐  " })] : [];

    if (firstChild?.type === "paragraph") {
      blocks.push(
        paragraph(
          { ...leadOptions, children: [...checkbox, ...renderInline(firstChild.children, ctx)] },
          { quoteDepth: options.quoteDepth ?? 0 },
        ),
      );
    } else {
      // L'élément ne commence pas par du texte (sous-liste immédiate, bloc de
      // code…) : on émet la puce seule pour ne pas perdre le niveau.
      blocks.push(paragraph({ ...leadOptions, children: checkbox }, { quoteDepth: options.quoteDepth ?? 0 }));
      if (firstChild) trailing.unshift(firstChild);
    }

    for (const child of trailing) {
      blocks.push(...renderItemChild(child, ctx, options, level, numbering, contentIndent));
    }
  }

  return blocks;
}

function renderItemChild(
  child: BlockContent | RootContent,
  ctx: RenderContext,
  options: BlockOptions,
  level: number,
  numbering: ListNumbering,
  contentIndent: number,
): BlockChild[] {
  if (child.type === "list") {
    return renderList(child, ctx, options, Math.min(level + 1, MAX_LIST_LEVEL), numbering);
  }
  return renderBlocks([child], ctx, {
    indent: contentIndent,
    ...(options.quoteDepth !== undefined ? { quoteDepth: options.quoteDepth } : {}),
  });
}

/**
 * Un bloc de code devient une suite de paragraphes monospace ombrés — un par
 * ligne. C'est la seule façon en OOXML d'obtenir un bloc dont chaque ligne
 * garde son fond et sa bordure tout en restant sélectionnable et modifiable.
 */
function renderCode(value: string, options: BlockOptions): Paragraph[] {
  const lines = value.replace(/\s+$/, "").split(/\r?\n/);
  const indent = options.indent ?? 0;

  return lines.map((line, index) => {
    // Air avant la première ligne et après la dernière — les deux à la fois
    // lorsque le bloc tient sur une seule ligne.
    const spacing = {
      before: index === 0 ? 160 : 0,
      after: index === lines.length - 1 ? 160 : 0,
    };

    return new Paragraph({
      style: STYLE_ID.codeBlock,
      spacing,
      ...(indent > 0 ? { indent: { left: indent + INDENT_STEP } } : {}),
      children: [new TextRun({ text: line })],
    });
  });
}

function paragraph(props: IParagraphOptions, options: BlockOptions): Paragraph {
  const indent = options.indent ?? 0;
  const isQuote = (options.quoteDepth ?? 0) > 0;

  return new Paragraph({
    ...props,
    ...(isQuote && props.heading === undefined ? { style: STYLE_ID.quote } : {}),
    ...(indent > 0 && props.numbering === undefined
      ? { indent: { ...props.indent, left: indent } }
      : {}),
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
