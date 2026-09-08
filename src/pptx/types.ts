/**
 * Modèle d'une présentation.
 *
 * Volontairement pauvre : une diapositive est une *disposition* accompagnée de
 * textes, jamais une liste de formes libres. Un éditeur de formes libres produit
 * des présentations incohérentes ; contraindre la structure est précisément ce
 * qui permet à un modèle graphique de rester beau quel que soit le contenu.
 */

export type TemplateId = "azur" | "nocturne";

export type SlideLayout =
  /** Couverture. */
  | "title"
  /** Intertitre séparant deux parties. */
  | "section"
  /** Titre et contenu — la disposition courante. */
  | "content"
  /** Titre et deux colonnes. */
  | "split"
  /** Citation mise en exergue. */
  | "quote"
  /** Dernière diapositive. */
  | "closing";

export type BlockType = "bullet" | "text";

export interface Block {
  readonly id: string;
  readonly type: BlockType;
  readonly text: string;
  /** Niveau d'imbrication d'une puce : 0 ou 1. Au-delà, une diapositive devient illisible. */
  readonly level: number;
}

export interface Slide {
  readonly id: string;
  readonly layout: SlideLayout;
  readonly title: string;
  /** Sous-titre, surtitre ou auteur de la citation, selon la disposition. */
  readonly subtitle: string;
  readonly blocks: readonly Block[];
  /** Seconde colonne ; ignorée hors disposition « split ». */
  readonly asideBlocks: readonly Block[];
  /** Notes du présentateur, exportées dans le fichier PowerPoint. */
  readonly notes: string;
}

export interface Deck {
  readonly title: string;
  readonly author: string;
  readonly template: TemplateId;
  readonly slides: readonly Slide[];
}

/** Couleurs d'un modèle, en hexadécimal sans dièse — la forme attendue par OOXML. */
export interface Palette {
  readonly background: string;
  /** Fond des encarts et des diapositives de citation. */
  readonly surface: string;
  readonly accent: string;
  /** Déclinaison douce de l'accent : filets, surtitres, éléments discrets. */
  readonly accentSoft: string;
  readonly text: string;
  readonly muted: string;
  /** Texte posé sur un aplat d'accent. */
  readonly onAccent: string;
}

export interface TemplateSpec {
  readonly id: TemplateId;
  readonly name: string;
  readonly description: string;
  readonly palette: Palette;
  readonly fonts: {
    readonly title: string;
    readonly body: string;
  };
  /** Vrai pour un modèle sombre : certains contrastes s'inversent. */
  readonly dark: boolean;
}
