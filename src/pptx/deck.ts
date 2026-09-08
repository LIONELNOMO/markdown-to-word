/**
 * Opérations sur le modèle de présentation.
 *
 * Toutes pures : elles renvoient un nouvel objet plutôt que de modifier
 * l'existant. C'est ce qui rend l'historique, la sauvegarde et les tests
 * triviaux, et ce qui évite qu'un rendu partiel laisse le modèle incohérent.
 */
import { isTemplateId } from "./templates.js";
import type { Block, BlockType, Deck, Slide, SlideLayout, TemplateId } from "./types.js";

const LAYOUTS: readonly SlideLayout[] = [
  "title",
  "section",
  "content",
  "split",
  "quote",
  "closing",
];

export const LAYOUT_LABELS: Readonly<Record<SlideLayout, string>> = {
  title: "Couverture",
  section: "Intertitre",
  content: "Titre et contenu",
  split: "Deux colonnes",
  quote: "Citation",
  closing: "Conclusion",
};

/** Dispositions qui exploitent la seconde colonne. */
export function usesAside(layout: SlideLayout): boolean {
  return layout === "split";
}

/** Dispositions dont le corps de texte est éditable. */
export function usesBlocks(layout: SlideLayout): boolean {
  return layout === "content" || layout === "split";
}

export function subtitleLabel(layout: SlideLayout): string {
  switch (layout) {
    case "section":
      return "Surtitre";
    case "quote":
      return "Auteur";
    default:
      return "Sous-titre";
  }
}

export function titleLabel(layout: SlideLayout): string {
  return layout === "quote" ? "Citation" : "Titre";
}

let compteur = 0;

/**
 * Identifiant unique.
 * `crypto.randomUUID` exige un contexte sécurisé ; le repli garantit que
 * l'éditeur fonctionne aussi en HTTP simple, sans dépendre de l'environnement.
 */
export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  compteur += 1;
  return `id-${String(Date.now())}-${String(compteur)}`;
}

export function createBlock(text = "", type: BlockType = "bullet", level = 0): Block {
  return { id: newId(), type, text, level };
}

export function createSlide(layout: SlideLayout = "content", overrides: Partial<Slide> = {}): Slide {
  return {
    id: newId(),
    layout,
    title: "",
    subtitle: "",
    blocks: usesBlocks(layout) ? [createBlock()] : [],
    asideBlocks: usesAside(layout) ? [createBlock()] : [],
    notes: "",
    ...overrides,
  };
}

/** Présentation d'exemple : un point de départ montrant chaque disposition. */
export function starterDeck(template: TemplateId = "azur"): Deck {
  return {
    title: "Nouvelle présentation",
    author: "",
    template,
    slides: [
      createSlide("title", {
        title: "Nouvelle présentation",
        subtitle: "Sous-titre ou contexte",
      }),
      createSlide("content", {
        title: "Titre de la diapositive",
        blocks: [
          createBlock("Première idée, formulée en une ligne"),
          createBlock("Deuxième idée, avec un détail", "bullet", 1),
          createBlock("Troisième idée"),
        ],
      }),
      createSlide("split", {
        title: "Comparer deux options",
        blocks: [createBlock("Avantage principal"), createBlock("Second avantage")],
        asideBlocks: [createBlock("Limite connue"), createBlock("Point de vigilance")],
      }),
      createSlide("closing", { title: "Merci", subtitle: "Questions ?" }),
    ],
  };
}

// --- Modifications ----------------------------------------------------------

export function replaceSlide(deck: Deck, slideId: string, updater: (slide: Slide) => Slide): Deck {
  return {
    ...deck,
    slides: deck.slides.map((slide) => (slide.id === slideId ? updater(slide) : slide)),
  };
}

export function insertSlide(deck: Deck, index: number, slide: Slide): Deck {
  const slides = [...deck.slides];
  slides.splice(clamp(index, 0, slides.length), 0, slide);
  return { ...deck, slides };
}

export function duplicateSlide(deck: Deck, slideId: string): Deck {
  const index = deck.slides.findIndex((slide) => slide.id === slideId);
  if (index === -1) return deck;

  const source = deck.slides[index];
  if (source === undefined) return deck;

  // Les identifiants sont régénérés : deux diapositives ne doivent jamais
  // partager une clé, sinon toute édition frapperait les deux.
  const copie: Slide = {
    ...source,
    id: newId(),
    blocks: source.blocks.map((block) => ({ ...block, id: newId() })),
    asideBlocks: source.asideBlocks.map((block) => ({ ...block, id: newId() })),
  };

  return insertSlide(deck, index + 1, copie);
}

/** Une présentation vide n'existe pas : la dernière diapositive n'est pas supprimable. */
export function removeSlide(deck: Deck, slideId: string): Deck {
  if (deck.slides.length <= 1) return deck;
  return { ...deck, slides: deck.slides.filter((slide) => slide.id !== slideId) };
}

export function moveSlide(deck: Deck, slideId: string, direction: -1 | 1): Deck {
  const index = deck.slides.findIndex((slide) => slide.id === slideId);
  const cible = index + direction;
  if (index === -1 || cible < 0 || cible >= deck.slides.length) return deck;

  const slides = [...deck.slides];
  const [retiree] = slides.splice(index, 1);
  if (retiree === undefined) return deck;
  slides.splice(cible, 0, retiree);

  return { ...deck, slides };
}

/**
 * Change la disposition en conservant ce qui reste pertinent.
 * Passer à une disposition qui utilise des blocs alors qu'il n'y en a aucun en
 * crée un : un éditeur qui affiche une zone vide sans rien à modifier bloque.
 */
export function changeLayout(slide: Slide, layout: SlideLayout): Slide {
  return {
    ...slide,
    layout,
    blocks: usesBlocks(layout) && slide.blocks.length === 0 ? [createBlock()] : slide.blocks,
    asideBlocks:
      usesAside(layout) && slide.asideBlocks.length === 0 ? [createBlock()] : slide.asideBlocks,
  };
}

// --- Sérialisation ----------------------------------------------------------

/**
 * Relit une présentation venue du stockage local.
 *
 * Le contenu du stockage n'est pas de confiance : il a pu être écrit par une
 * version antérieure, tronqué, ou modifié à la main. Chaque champ est donc
 * validé, et un objet invalide donne `null` plutôt qu'un éditeur incohérent.
 */
export function parseDeck(raw: unknown): Deck | null {
  if (!isRecord(raw)) return null;

  const slides = Array.isArray(raw["slides"])
    ? raw["slides"].map(parseSlide).filter((slide): slide is Slide => slide !== null)
    : [];
  if (slides.length === 0) return null;

  return {
    title: asString(raw["title"], "Nouvelle présentation"),
    author: asString(raw["author"], ""),
    template: isTemplateId(raw["template"]) ? raw["template"] : "azur",
    slides,
  };
}

function parseSlide(raw: unknown): Slide | null {
  if (!isRecord(raw)) return null;

  const layout = LAYOUTS.find((candidate) => candidate === raw["layout"]) ?? "content";

  return {
    id: asString(raw["id"], "") || newId(),
    layout,
    title: asString(raw["title"], ""),
    subtitle: asString(raw["subtitle"], ""),
    blocks: parseBlocks(raw["blocks"]),
    asideBlocks: parseBlocks(raw["asideBlocks"]),
    notes: asString(raw["notes"], ""),
  };
}

function parseBlocks(raw: unknown): Block[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry): Block[] => {
    if (!isRecord(entry)) return [];
    const type: BlockType = entry["type"] === "text" ? "text" : "bullet";
    const level = typeof entry["level"] === "number" ? clamp(Math.trunc(entry["level"]), 0, 1) : 0;
    return [{ id: asString(entry["id"], "") || newId(), type, text: asString(entry["text"], ""), level }];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
