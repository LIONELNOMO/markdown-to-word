import type { Definition, FootnoteDefinition, Nodes, Root } from "mdast";
import { parseFrontmatter } from "./frontmatter.js";

export interface DocumentStats {
  readonly headings: number;
  readonly tables: number;
  readonly images: number;
  readonly codeBlocks: number;
  readonly footnotes: number;
}

export interface DocumentIndex {
  readonly frontmatter: Map<string, string>;
  readonly definitions: Map<string, Definition>;
  readonly footnoteDefinitions: Map<string, FootnoteDefinition>;
  /** URLs d'images uniques, dans l'ordre d'apparition. */
  readonly imageUrls: readonly string[];
  readonly firstHeading: string | null;
  readonly stats: DocumentStats;
}

/**
 * Parcours unique de l'arbre qui collecte tout ce dont la génération a besoin
 * *avant* de commencer à écrire : définitions de liens, notes de bas de page,
 * images à télécharger, métadonnées.
 *
 * Ce pré-passage est ce qui permet à tout le rendu d'être synchrone alors que le
 * chargement des images, lui, est asynchrone.
 */
export function indexDocument(root: Root): DocumentIndex {
  const definitions = new Map<string, Definition>();
  const footnoteDefinitions = new Map<string, FootnoteDefinition>();
  const imageUrls = new Set<string>();
  const imageReferenceIds = new Set<string>();

  let frontmatter = new Map<string, string>();
  let firstHeading: string | null = null;
  let headings = 0;
  let tables = 0;
  let images = 0;
  let codeBlocks = 0;

  walk(root, (node) => {
    switch (node.type) {
      case "yaml":
        // Seul le bloc de tête est du front matter ; les suivants sont du contenu.
        if (frontmatter.size === 0) frontmatter = parseFrontmatter(node.value);
        break;
      case "definition":
        definitions.set(node.identifier.toLowerCase(), node);
        break;
      case "footnoteDefinition":
        footnoteDefinitions.set(node.identifier.toLowerCase(), node);
        break;
      case "image":
        imageUrls.add(node.url);
        images += 1;
        break;
      case "imageReference":
        imageReferenceIds.add(node.identifier.toLowerCase());
        images += 1;
        break;
      case "heading": {
        headings += 1;
        if (firstHeading === null) {
          const text = toPlainText(node).trim();
          if (text !== "") firstHeading = text;
        }
        break;
      }
      case "table":
        tables += 1;
        break;
      case "code":
        codeBlocks += 1;
        break;
      default:
        break;
    }
  });

  // Les images référencées (`![alt][id]`) ne portent pas d'URL : elle vit dans
  // la définition, qui a pu être déclarée après l'usage.
  for (const identifier of imageReferenceIds) {
    const url = definitions.get(identifier)?.url;
    if (url !== undefined) imageUrls.add(url);
  }

  return {
    frontmatter,
    definitions,
    footnoteDefinitions,
    imageUrls: [...imageUrls],
    firstHeading,
    stats: { headings, tables, images, codeBlocks, footnotes: footnoteDefinitions.size },
  };
}

/** Concatène le texte d'un sous-arbre (titres, cellules, alternatives). */
export function toPlainText(node: Nodes): string {
  // Le HTML brut est exclu : son balisage n'est pas du texte lisible.
  if (node.type === "html") return "";
  if ("value" in node) return node.value;
  if (!("children" in node)) return "";
  return node.children.map(toPlainText).join("");
}

function walk(node: Nodes, visitor: (node: Nodes) => void): void {
  visitor(node);
  if (!("children" in node)) return;
  for (const child of node.children) walk(child, visitor);
}
