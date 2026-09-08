/**
 * Markdown → diapositives.
 *
 * Le contenu vient d'une conversation : le retaper diapositive par diapositive
 * serait absurde. Cette passerelle réutilise l'analyseur déjà en place — le même
 * qui alimente la conversion Word — plutôt que d'inventer un second dialecte.
 *
 * Règles de découpe, dans cet ordre :
 *  - `---` (séparateur horizontal) force une nouvelle diapositive ;
 *  - un titre de niveau 1 devient un intertitre ;
 *  - un titre de niveau 2 ou plus ouvre une diapositive de contenu ;
 *  - le reste alimente la diapositive courante.
 *
 * Le premier titre de niveau 1 sert de couverture : une présentation qui
 * commence par un intertitre n'a pas de sens.
 */
import type { List, ListItem, Paragraph, Root } from "mdast";
import { parseMarkdown } from "../markdown/parse.js";
import { toPlainText } from "../markdown/inspect.js";
import { createBlock, createSlide } from "./deck.js";
import type { Block, Slide } from "./types.js";

/** Au-delà, une diapositive déborde : on ouvre la suivante. */
const MAX_BLOCKS_PAR_DIAPOSITIVE = 7;

export interface ImportResult {
  readonly slides: readonly Slide[];
  /** Titre déduit du document, pour nommer la présentation. */
  readonly title: string;
}

/** Diapositive en cours de constitution, avant d'être figée. */
interface Brouillon {
  titre: string;
  blocs: Block[];
}

export function slidesFromMarkdown(markdown: string): ImportResult {
  const racine: Root = parseMarkdown(markdown);

  const slides: Slide[] = [];
  let courante: Brouillon | null = null;
  let titreDocument = "";
  let couvertureFaite = false;
  /**
   * Vrai juste après la couverture : le paragraphe qui suit immédiatement le
   * titre principal est son sous-titre, pas le début d'une diapositive de
   * contenu sans titre.
   */
  let attenteSousTitre = false;

  const cloturer = (): void => {
    if (courante === null) return;
    if (courante.titre.trim() === "" && courante.blocs.length === 0) {
      courante = null;
      return;
    }

    slides.push(
      createSlide("content", { title: courante.titre, blocks: courante.blocs }),
    );
    courante = null;
  };

  const ajouter = (blocs: readonly Block[]): void => {
    if (blocs.length === 0) return;

    let cible: Brouillon = courante ?? { titre: "", blocs: [] };
    courante = cible;

    for (const bloc of blocs) {
      // Une diapositive trop chargée est illisible : on la scinde en gardant
      // le même titre, comme le ferait un rédacteur.
      if (cible.blocs.length >= MAX_BLOCKS_PAR_DIAPOSITIVE) {
        const titre = cible.titre;
        cloturer();
        cible = { titre, blocs: [] };
        courante = cible;
      }
      cible.blocs.push(bloc);
    }
  };

  for (const noeud of racine.children) {
    // Le drapeau ne vaut que pour le nœud immédiatement suivant : on le
    // consomme ici, plutôt que de devoir penser à l'éteindre dans chaque
    // branche — un oubli y serait invisible.
    const attendaitSousTitre = attenteSousTitre;
    attenteSousTitre = false;

    switch (noeud.type) {
      case "heading": {
        const texte = toPlainText(noeud).trim();
        if (texte === "") break;

        if (titreDocument === "") titreDocument = texte;

        if (noeud.depth === 1) {
          cloturer();
          if (!couvertureFaite) {
            slides.push(createSlide("title", { title: texte }));
            couvertureFaite = true;
            attenteSousTitre = true;
          } else {
            slides.push(createSlide("section", { title: texte }));
          }
          break;
        }

        cloturer();
        courante = { titre: texte, blocs: [] };
        break;
      }

      case "thematicBreak":
        cloturer();
        break;

      case "list":
        ajouter(blocsDeListe(noeud, 0));
        break;

      case "paragraph": {
        const texte = toPlainText(noeud).trim();

        if (attendaitSousTitre && texte !== "") {
          const couverture = slides[slides.length - 1];
          if (couverture !== undefined) {
            slides[slides.length - 1] = { ...couverture, subtitle: texte };
          }
          break;
        }

        ajouter(blocsDeParagraphe(noeud));
        break;
      }

      case "blockquote": {
        const texte = toPlainText(noeud).trim();
        if (texte === "") break;
        cloturer();
        slides.push(createSlide("quote", { title: texte }));
        break;
      }

      case "code": {
        // Le code est repris tel quel, ligne à ligne, sans puce.
        const lignes = noeud.value
          .split("\n")
          .filter((ligne) => ligne.trim() !== "")
          .map((ligne) => createBlock(ligne, "text"));
        ajouter(lignes);
        break;
      }

      default:
        break;
    }
  }

  cloturer();

  if (slides.length === 0) {
    slides.push(createSlide("title", { title: titreDocument || "Présentation" }));
  }

  return { slides, title: titreDocument || "Présentation" };
}

function blocsDeParagraphe(noeud: Paragraph): Block[] {
  const texte = toPlainText(noeud).trim();
  return texte === "" ? [] : [createBlock(texte, "text")];
}

function blocsDeListe(liste: List, niveau: number): Block[] {
  const blocs: Block[] = [];

  for (const element of liste.children) {
    blocs.push(...blocsDElement(element, niveau));
  }

  return blocs;
}

function blocsDElement(element: ListItem, niveau: number): Block[] {
  const blocs: Block[] = [];
  // Le texte propre à l'élément, sans celui de ses sous-listes.
  const propre = element.children
    .filter((enfant) => enfant.type !== "list")
    .map((enfant) => toPlainText(enfant).trim())
    .filter((texte) => texte !== "")
    .join(" ");

  if (propre !== "") blocs.push(createBlock(propre, "bullet", Math.min(niveau, 1)));

  for (const enfant of element.children) {
    if (enfant.type === "list") blocs.push(...blocsDeListe(enfant, niveau + 1));
  }

  return blocs;
}
