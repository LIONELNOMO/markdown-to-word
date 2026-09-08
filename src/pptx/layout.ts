/**
 * Composition d'une diapositive : géométrie et styles, en unités PowerPoint.
 *
 * Ce module est la **source unique** de la mise en page. L'aperçu à l'écran et
 * le fichier exporté le consomment tous les deux : sans cela, deux mises en page
 * parallèles divergeraient dès la première retouche, et l'aperçu mentirait.
 *
 * Toutes les distances sont en pouces sur un canevas 13,333 × 7,5 (le format
 * large de PowerPoint), toutes les tailles de texte en points.
 */
import type { Block, Slide, TemplateSpec } from "./types.js";

export const CANVAS = { width: 13.333, height: 7.5 } as const;

const MARGIN_X = 1;
const CONTENT_WIDTH = CANVAS.width - MARGIN_X * 2;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Shape {
  readonly rect: Rect;
  readonly color: string;
  /** 0 à 100 : 0 est opaque. */
  readonly transparency?: number;
  /** Rayon des coins, en pouces. */
  readonly radius?: number;
}

export interface TextLine {
  readonly text: string;
  readonly bullet: boolean;
  readonly level: number;
}

export interface TextBox {
  readonly rect: Rect;
  readonly lines: readonly TextLine[];
  /** Taille en points. */
  readonly size: number;
  readonly color: string;
  readonly font: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly align: "left" | "center" | "right";
  readonly valign: "top" | "middle" | "bottom";
  /** Interligne, en multiple de la taille de police. */
  readonly lineSpacing: number;
  /** Interlettrage en points ; sert aux surtitres en capitales. */
  readonly charSpacing: number;
  readonly uppercase: boolean;
}

export interface ComposedSlide {
  readonly background: string;
  readonly shapes: readonly Shape[];
  readonly boxes: readonly TextBox[];
}

/** Valeurs par défaut : chaque composition ne précise que ce qui la distingue. */
function text(box: Partial<TextBox> & Pick<TextBox, "rect" | "lines" | "color" | "font">): TextBox {
  return {
    size: 18,
    bold: false,
    italic: false,
    align: "left",
    valign: "top",
    lineSpacing: 1.25,
    charSpacing: 0,
    uppercase: false,
    ...box,
  };
}

function fromBlocks(blocks: readonly Block[]): TextLine[] {
  return blocks
    .filter((block) => block.text.trim() !== "")
    .map((block) => ({
      text: block.text,
      bullet: block.type === "bullet",
      level: Math.min(Math.max(block.level, 0), 1),
    }));
}

function line(value: string): TextLine[] {
  return value.trim() === "" ? [] : [{ text: value, bullet: false, level: 0 }];
}

/**
 * Traduit une diapositive en formes et blocs de texte positionnés.
 *
 * `index` et `total` servent la pagination ; la couverture et la dernière
 * diapositive en sont exemptes, comme dans une présentation soignée.
 */
export function composeSlide(
  slide: Slide,
  template: TemplateSpec,
  index: number,
  total: number,
): ComposedSlide {
  switch (slide.layout) {
    case "title":
      return composeTitle(slide, template);
    case "section":
      return composeSection(slide, template);
    case "split":
      return composeSplit(slide, template, index, total);
    case "quote":
      return composeQuote(slide, template, index, total);
    case "closing":
      return composeClosing(slide, template);
    default:
      return composeContent(slide, template, index, total);
  }
}

// --- Couverture -------------------------------------------------------------

function composeTitle(slide: Slide, template: TemplateSpec): ComposedSlide {
  const { palette, fonts } = template;

  const gauche = 1.6;

  return {
    background: palette.background,
    shapes: [
      // Bandeau vertical pleine hauteur : signe distinctif de la couverture.
      { rect: { x: 0, y: 0, w: 0.55, h: CANVAS.height }, color: palette.accent },
      // Filet sous le titre, puis une réglure basse qui referme la composition.
      { rect: { x: gauche, y: 4.52, w: 2.1, h: 0.07 }, color: palette.accent },
      {
        rect: { x: gauche, y: 6.6, w: CANVAS.width - gauche - MARGIN_X, h: 0.012 },
        color: palette.accentSoft,
      },
    ],
    boxes: [
      text({
        rect: { x: gauche, y: 2.45, w: CANVAS.width - gauche - MARGIN_X, h: 1.9 },
        lines: line(slide.title),
        size: 44,
        bold: true,
        color: template.dark ? palette.text : palette.accent,
        font: fonts.title,
        valign: "bottom",
        lineSpacing: 1.1,
      }),
      text({
        rect: { x: gauche, y: 4.88, w: CANVAS.width - gauche - MARGIN_X, h: 1.2 },
        lines: line(slide.subtitle),
        size: 18,
        color: palette.muted,
        font: fonts.body,
      }),
    ],
  };
}

// --- Intertitre -------------------------------------------------------------

function composeSection(slide: Slide, template: TemplateSpec): ComposedSlide {
  const { palette, fonts } = template;
  const fond = template.dark ? palette.surface : palette.accent;

  const texteGauche = MARGIN_X + 0.5;

  return {
    background: fond,
    shapes: [
      // Filet vertical adossé au titre : marque l'intertitre sans le charger.
      // Sa hauteur couvre le surtitre et un titre de deux lignes ; au-delà il
      // pendrait dans le vide.
      {
        rect: { x: MARGIN_X, y: 2.5, w: 0.08, h: 1.85 },
        color: template.dark ? palette.accent : palette.accentSoft,
      },
    ],
    boxes: [
      text({
        rect: { x: texteGauche, y: 2.6, w: CONTENT_WIDTH - 0.5, h: 0.5 },
        lines: line(slide.subtitle),
        size: 14,
        color: template.dark ? palette.accent : palette.accentSoft,
        font: fonts.body,
        uppercase: true,
        charSpacing: 2,
      }),
      text({
        rect: { x: texteGauche, y: 3.15, w: CONTENT_WIDTH - 0.5, h: 1.7 },
        lines: line(slide.title),
        size: 40,
        bold: true,
        color: template.dark ? palette.text : palette.onAccent,
        font: fonts.title,
        lineSpacing: 1.1,
      }),
    ],
  };
}

// --- Titre et contenu -------------------------------------------------------

function composeContent(
  slide: Slide,
  template: TemplateSpec,
  index: number,
  total: number,
): ComposedSlide {
  const { palette, fonts } = template;

  return {
    background: palette.background,
    shapes: [...enTete(template), ...pied(template)],
    boxes: [
      titreDeDiapositive(slide.title, template),
      text({
        rect: { x: MARGIN_X, y: 2.05, w: CONTENT_WIDTH, h: 4.55 },
        lines: fromBlocks(slide.blocks),
        size: 19,
        color: palette.text,
        font: fonts.body,
        lineSpacing: 1.45,
      }),
      ...pagination(index, total, template),
    ],
  };
}

// --- Deux colonnes ----------------------------------------------------------

function composeSplit(
  slide: Slide,
  template: TemplateSpec,
  index: number,
  total: number,
): ComposedSlide {
  const { palette, fonts } = template;

  /**
   * La gouttière doit être strictement supérieure au double de la marge
   * intérieure des encarts, sinon les deux cartes se touchent et se lisent
   * comme un seul bloc.
   */
  const GOUTTIERE = 0.9;
  const MARGE_ENCART = 0.3;
  const largeur = (CONTENT_WIDTH - GOUTTIERE) / 2;
  const droite = MARGIN_X + largeur + GOUTTIERE;

  // En modèle sombre, les colonnes deviennent des encarts : c'est ce qui
  // structure une diapositive dense sans ajouter de filets.
  const encarts: Shape[] = template.dark
    ? [MARGIN_X, droite].map((x) => ({
        rect: {
          x: x - MARGE_ENCART,
          y: 1.95,
          w: largeur + MARGE_ENCART * 2,
          h: 4.35,
        },
        color: palette.surface,
        radius: 0.12,
      }))
    : [
        // En modèle clair, un simple filet médian sépare les colonnes.
        {
          rect: { x: MARGIN_X + largeur + GOUTTIERE / 2, y: 2.1, w: 0.02, h: 4 },
          color: palette.accentSoft,
        },
      ];

  return {
    background: palette.background,
    shapes: [...enTete(template), ...encarts, ...pied(template)],
    boxes: [
      titreDeDiapositive(slide.title, template),
      text({
        rect: { x: MARGIN_X, y: 2.25, w: largeur, h: 3.85 },
        lines: fromBlocks(slide.blocks),
        size: 17,
        color: palette.text,
        font: fonts.body,
        lineSpacing: 1.4,
      }),
      text({
        rect: { x: droite, y: 2.25, w: largeur, h: 3.85 },
        lines: fromBlocks(slide.asideBlocks),
        size: 17,
        color: palette.text,
        font: fonts.body,
        lineSpacing: 1.4,
      }),
      ...pagination(index, total, template),
    ],
  };
}

// --- Citation ---------------------------------------------------------------

function composeQuote(
  slide: Slide,
  template: TemplateSpec,
  index: number,
  total: number,
): ComposedSlide {
  const { palette, fonts } = template;

  return {
    background: template.dark ? palette.background : palette.surface,
    shapes: [
      { rect: { x: MARGIN_X, y: 2.15, w: 0.07, h: 3.1 }, color: palette.accent },
      ...pied(template),
    ],
    boxes: [
      text({
        rect: { x: MARGIN_X + 0.55, y: 2.15, w: CONTENT_WIDTH - 1.6, h: 2.5 },
        lines: line(slide.title),
        size: 30,
        italic: true,
        color: palette.text,
        font: fonts.title,
        valign: "middle",
        lineSpacing: 1.3,
      }),
      text({
        rect: { x: MARGIN_X + 0.55, y: 4.85, w: CONTENT_WIDTH - 1.6, h: 0.5 },
        lines: line(slide.subtitle),
        size: 15,
        color: palette.muted,
        font: fonts.body,
      }),
      ...pagination(index, total, template),
    ],
  };
}

// --- Dernière diapositive ---------------------------------------------------

function composeClosing(slide: Slide, template: TemplateSpec): ComposedSlide {
  const { palette, fonts } = template;
  const fond = template.dark ? palette.surface : palette.accent;

  return {
    background: fond,
    shapes: [
      { rect: { x: CANVAS.width / 2 - 0.75, y: 4.35, w: 1.5, h: 0.06 }, color: template.dark ? palette.accent : palette.accentSoft },
    ],
    boxes: [
      text({
        rect: { x: MARGIN_X, y: 2.9, w: CONTENT_WIDTH, h: 1.3 },
        lines: line(slide.title),
        size: 40,
        bold: true,
        color: template.dark ? palette.text : palette.onAccent,
        font: fonts.title,
        align: "center",
        valign: "bottom",
      }),
      text({
        rect: { x: MARGIN_X, y: 4.65, w: CONTENT_WIDTH, h: 0.9 },
        lines: line(slide.subtitle),
        size: 17,
        color: template.dark ? palette.muted : palette.accentSoft,
        font: fonts.body,
        align: "center",
      }),
    ],
  };
}

// --- Éléments communs -------------------------------------------------------

function titreDeDiapositive(titre: string, template: TemplateSpec): TextBox {
  return text({
    rect: { x: MARGIN_X, y: 0.62, w: CONTENT_WIDTH, h: 0.95 },
    lines: line(titre),
    size: 30,
    bold: true,
    color: template.dark ? template.palette.text : template.palette.accent,
    font: template.fonts.title,
    valign: "bottom",
  });
}

/** Filet court sous le titre : repère visuel constant d'une diapositive à l'autre. */
function enTete(template: TemplateSpec): Shape[] {
  return [{ rect: { x: MARGIN_X, y: 1.66, w: 1.25, h: 0.055 }, color: template.palette.accent }];
}

function pied(template: TemplateSpec): Shape[] {
  return [
    {
      rect: { x: MARGIN_X, y: CANVAS.height - 0.78, w: CONTENT_WIDTH, h: 0.01 },
      color: template.palette.accentSoft,
      transparency: template.dark ? 40 : 0,
    },
  ];
}

function pagination(index: number, total: number, template: TemplateSpec): TextBox[] {
  if (total <= 1) return [];

  return [
    text({
      rect: { x: MARGIN_X, y: CANVAS.height - 0.68, w: CONTENT_WIDTH, h: 0.35 },
      lines: line(`${String(index + 1)} / ${String(total)}`),
      size: 10,
      color: template.palette.muted,
      font: template.fonts.body,
      align: "right",
    }),
  ];
}
