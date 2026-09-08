/**
 * Génération du fichier PowerPoint.
 *
 * `pptxgenjs` est chargé à la demande : la bibliothèque et son moteur d'archive
 * pèsent lourd, et la plupart des visites n'exportent jamais. L'éditeur démarre
 * donc sans elle.
 *
 * Aucune mise en page n'est décidée ici : tout vient de `composeSlide`, partagé
 * avec l'aperçu. Ce module ne fait que traduire des rectangles et des blocs de
 * texte dans le vocabulaire de la bibliothèque.
 */
import type PptxGenJS from "pptxgenjs";
import { CANVAS, composeSlide, type Shape, type TextBox } from "./layout.js";
import { templateById } from "./templates.js";
import type { Deck } from "./types.js";

const LAYOUT_NAME = "MD2DOCX_16x9";

type Presentation = PptxGenJS;
type SlideHandle = ReturnType<PptxGenJS["addSlide"]>;

export interface ExportResult {
  readonly blob: Blob;
  readonly fileName: string;
}

export async function exportDeck(deck: Deck): Promise<ExportResult> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const template = templateById(deck.template);

  const pptx = new PptxGenJS();
  // Le format large de PowerPoint. Défini explicitement : la valeur intégrée
  // « LAYOUT_16x9 » vaut 10 × 5,625 pouces, une géométrie différente.
  pptx.defineLayout({ name: LAYOUT_NAME, width: CANVAS.width, height: CANVAS.height });
  pptx.layout = LAYOUT_NAME;

  pptx.title = deck.title;
  if (deck.author.trim() !== "") pptx.author = deck.author.trim();

  const total = deck.slides.length;

  for (const [index, slide] of deck.slides.entries()) {
    const composition = composeSlide(slide, template, index, total);
    const page = pptx.addSlide();
    page.background = { color: composition.background };

    for (const shape of composition.shapes) ajouterForme(pptx, page, shape);
    for (const box of composition.boxes) ajouterTexte(page, box);

    if (slide.notes.trim() !== "") page.addNotes(slide.notes);
  }

  const donnees = await pptx.write({ outputType: "blob" });

  return {
    // `write` renvoie un Blob avec cette option ; le contrat de typage est plus
    // large parce que la même méthode sert aussi côté Node.
    blob: donnees as Blob,
    fileName: `${safeFileName(deck.title)}.pptx`,
  };
}

function ajouterForme(pptx: Presentation, page: SlideHandle, shape: Shape): void {
  const forme = shape.radius === undefined ? pptx.ShapeType.rect : pptx.ShapeType.roundRect;

  page.addShape(forme, {
    x: shape.rect.x,
    y: shape.rect.y,
    w: shape.rect.w,
    h: shape.rect.h,
    fill: {
      color: shape.color,
      ...(shape.transparency === undefined ? {} : { transparency: shape.transparency }),
    },
    line: { width: 0 },
    // `rectRadius` s'exprime en pouces, comme le reste de la géométrie.
    ...(shape.radius === undefined ? {} : { rectRadius: shape.radius }),
  });
}

function ajouterTexte(page: SlideHandle, box: TextBox): void {
  if (box.lines.length === 0) return;

  const runs = box.lines.map((ligne) => ({
    text: box.uppercase ? ligne.text.toLocaleUpperCase("fr-FR") : ligne.text,
    options: {
      // Un carré fin plutôt que la puce ronde par défaut : plus net à l'écran
      // comme à l'impression.
      ...(ligne.bullet ? { bullet: { code: "25AA" }, indentLevel: ligne.level } : { bullet: false }),
      breakLine: true,
    },
  }));

  page.addText(runs, {
    x: box.rect.x,
    y: box.rect.y,
    w: box.rect.w,
    h: box.rect.h,
    fontSize: box.size,
    fontFace: box.font,
    color: box.color,
    bold: box.bold,
    italic: box.italic,
    align: box.align,
    valign: box.valign,
    lineSpacingMultiple: box.lineSpacing,
    ...(box.charSpacing === 0 ? {} : { charSpacing: box.charSpacing }),
    // Le texte ne doit jamais déborder de sa zone sur une diapositive.
    shrinkText: true,
    wrap: true,
    margin: 0,
  });
}

/** Mêmes interdits que pour les documents Word : le nom vient d'une saisie libre. */
const CARACTERES_INTERDITS = /[<>:"/\\|?*]/g;

export function safeFileName(value: string): string {
  const propre = value
    .replace(CARACTERES_INTERDITS, " ")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "")
    .slice(0, 100)
    .trim();

  return propre === "" ? "presentation" : propre;
}
