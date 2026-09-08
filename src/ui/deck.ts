/**
 * Éditeur de présentation.
 *
 * Trois zones : la liste des diapositives, l'aperçu, le panneau d'édition.
 *
 * L'aperçu n'est pas une approximation : il consomme `composeSlide`, la même
 * composition que l'export. À 96 pixels par pouce, une diapositive de 13,333 ×
 * 7,5 pouces fait exactement 1280 × 720 pixels, et une transformation d'échelle
 * l'adapte à la place disponible. Ce que l'on voit est donc ce que l'on obtient.
 */
import { downloadBlob } from "../browser/download.js";
import {
  LAYOUT_LABELS,
  changeLayout,
  createBlock,
  createSlide,
  duplicateSlide,
  insertSlide,
  moveSlide,
  parseDeck,
  removeSlide,
  replaceSlide,
  starterDeck,
  subtitleLabel,
  titleLabel,
  usesAside,
  usesBlocks,
} from "../pptx/deck.js";
import { slidesFromMarkdown } from "../pptx/from-markdown.js";
import { CANVAS, composeSlide, type ComposedSlide, type TextBox } from "../pptx/layout.js";
import { TEMPLATES, isTemplateId, templateById } from "../pptx/templates.js";
import type { Block, Deck, Slide, SlideLayout, TemplateSpec } from "../pptx/types.js";

/** 96 pixels par pouce : la résolution de référence du web. */
const PX_PAR_POUCE = 96;
const STAGE_WIDTH = CANVAS.width * PX_PAR_POUCE;
const STAGE_HEIGHT = CANVAS.height * PX_PAR_POUCE;

/** Un point vaut 1/72 de pouce. */
const PX_PAR_POINT = PX_PAR_POUCE / 72;

const CLE_STOCKAGE = "md2docx.deck.v1";
const DELAI_SAUVEGARDE_MS = 400;

interface Elements {
  readonly deckTitle: HTMLInputElement;
  readonly deckAuthor: HTMLInputElement;
  readonly templateSelect: HTMLSelectElement;
  readonly exportButton: HTMLButtonElement;
  readonly importButton: HTMLButtonElement;
  readonly resetButton: HTMLButtonElement;
  readonly status: HTMLElement;
  readonly slideList: HTMLOListElement;
  readonly addSlide: HTMLButtonElement;
  readonly scaler: HTMLElement;
  readonly stage: HTMLElement;
  readonly inspector: HTMLElement;
  readonly importDialog: HTMLDialogElement;
  readonly importTextarea: HTMLTextAreaElement;
  readonly importConfirm: HTMLButtonElement;
}

export function initDeckApp(): void {
  const el = collectElements();

  let deck: Deck = chargerDepuisStockage() ?? starterDeck();
  let selectionId: string = deck.slides[0]?.id ?? "";
  let sauvegardeEnAttente: ReturnType<typeof setTimeout> | undefined;
  let occupe = false;

  const modele = (): TemplateSpec => templateById(deck.template);

  const diapoSelectionnee = (): { slide: Slide; index: number } => {
    const index = Math.max(
      0,
      deck.slides.findIndex((slide) => slide.id === selectionId),
    );
    const slide = deck.slides[index] ?? deck.slides[0];
    // Le modèle garantit au moins une diapositive ; ce repli n'existe que pour
    // le typage.
    return { slide: slide ?? createSlide(), index };
  };

  const setStatus = (message: string, kind: "info" | "error" | "success" = "info"): void => {
    el.status.textContent = message;
    el.status.classList.toggle("is-error", kind === "error");
    el.status.classList.toggle("is-success", kind === "success");
  };

  const sauvegarder = (): void => {
    clearTimeout(sauvegardeEnAttente);
    sauvegardeEnAttente = setTimeout(() => {
      try {
        localStorage.setItem(CLE_STOCKAGE, JSON.stringify(deck));
      } catch {
        // Stockage plein ou refusé (navigation privée) : le travail en cours
        // reste utilisable, seule la reprise après rechargement est perdue.
      }
    }, DELAI_SAUVEGARDE_MS);
  };

  /**
   * `structure` distingue les modifications qui changent la forme du panneau
   * d'édition de celles qui ne changent que du texte : reconstruire le panneau
   * à chaque frappe ferait perdre le curseur.
   */
  const rendre = (structure = true): void => {
    const { slide, index } = diapoSelectionnee();
    selectionId = slide.id;

    renderStage(el.stage, composeSlide(slide, modele(), index, deck.slides.length));
    renderSlideList(el, deck, selectionId, modele());
    if (structure) renderInspector(el, slide, actions);

    sauvegarder();
  };

  const majDiapo = (updater: (slide: Slide) => Slide, structure = false): void => {
    deck = replaceSlide(deck, selectionId, updater);
    rendre(structure);
  };

  const actions: InspectorActions = {
    setLayout: (layout) => majDiapo((slide) => changeLayout(slide, layout), true),
    setTitle: (value) => majDiapo((slide) => ({ ...slide, title: value })),
    setSubtitle: (value) => majDiapo((slide) => ({ ...slide, subtitle: value })),
    setNotes: (value) => majDiapo((slide) => ({ ...slide, notes: value })),
    setBlockText: (colonne, blockId, value) =>
      majDiapo((slide) => ({
        ...slide,
        [colonne]: colonneDe(slide, colonne).map((block) =>
          block.id === blockId ? { ...block, text: value } : block,
        ),
      })),
    toggleBlockType: (colonne, blockId) =>
      majDiapo(
        (slide) => ({
          ...slide,
          [colonne]: colonneDe(slide, colonne).map((block) =>
            block.id === blockId
              ? { ...block, type: block.type === "bullet" ? "text" : "bullet" }
              : block,
          ),
        }),
        true,
      ),
    toggleBlockLevel: (colonne, blockId) =>
      majDiapo(
        (slide) => ({
          ...slide,
          [colonne]: colonneDe(slide, colonne).map((block) =>
            block.id === blockId ? { ...block, level: block.level === 0 ? 1 : 0 } : block,
          ),
        }),
        true,
      ),
    moveBlock: (colonne, blockId, direction) =>
      majDiapo((slide) => ({ ...slide, [colonne]: deplacer(colonneDe(slide, colonne), blockId, direction) }), true),
    addBlock: (colonne) =>
      majDiapo((slide) => ({ ...slide, [colonne]: [...colonneDe(slide, colonne), createBlock()] }), true),
    removeBlock: (colonne, blockId) =>
      majDiapo(
        (slide) => ({
          ...slide,
          [colonne]: colonneDe(slide, colonne).filter((block) => block.id !== blockId),
        }),
        true,
      ),
  };

  // --- Barre supérieure ---

  el.deckTitle.value = deck.title;
  el.deckAuthor.value = deck.author;

  el.deckTitle.addEventListener("input", () => {
    deck = { ...deck, title: el.deckTitle.value };
    sauvegarder();
  });

  el.deckAuthor.addEventListener("input", () => {
    deck = { ...deck, author: el.deckAuthor.value };
    sauvegarder();
  });

  for (const template of TEMPLATES) {
    const option = document.createElement("option");
    option.value = template.id;
    option.textContent = `${template.name} — ${template.description}`;
    el.templateSelect.append(option);
  }
  el.templateSelect.value = deck.template;

  el.templateSelect.addEventListener("change", () => {
    if (!isTemplateId(el.templateSelect.value)) return;
    deck = { ...deck, template: el.templateSelect.value };
    rendre();
    setStatus(`Modèle « ${modele().name} » appliqué à toute la présentation.`, "success");
  });

  el.exportButton.addEventListener("click", () => {
    void (async () => {
      if (occupe) return;
      occupe = true;
      el.exportButton.disabled = true;
      setStatus("Génération du fichier PowerPoint…");

      try {
        // Chargée seulement maintenant : la bibliothèque est lourde et la
        // plupart des visites n'exportent jamais.
        const { exportDeck } = await import("../pptx/export.js");
        const { blob, fileName } = await exportDeck(deck);
        downloadBlob(blob, fileName);
        setStatus(`${fileName} — ${String(deck.slides.length)} diapositives.`, "success");
      } catch (error) {
        console.error("Échec de l'export", error);
        setStatus("L'export a échoué. Réessayez ; si cela persiste, rechargez la page.", "error");
      } finally {
        occupe = false;
        el.exportButton.disabled = false;
      }
    })();
  });

  el.resetButton.addEventListener("click", () => {
    if (!confirm("Repartir d'une présentation vierge ? Le travail en cours sera perdu.")) return;
    deck = starterDeck(deck.template);
    selectionId = deck.slides[0]?.id ?? "";
    el.deckTitle.value = deck.title;
    rendre();
    setStatus("Nouvelle présentation.", "success");
  });

  // --- Liste des diapositives ---

  el.addSlide.addEventListener("click", () => {
    const { index } = diapoSelectionnee();
    const nouvelle = createSlide("content");
    deck = insertSlide(deck, index + 1, nouvelle);
    selectionId = nouvelle.id;
    rendre();
  });

  el.slideList.addEventListener("click", (event) => {
    const bouton = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (bouton === null) return;

    const id = bouton.dataset["slideId"];
    if (id === undefined) return;

    switch (bouton.dataset["action"]) {
      case "select":
        selectionId = id;
        break;
      case "up":
        deck = moveSlide(deck, id, -1);
        break;
      case "down":
        deck = moveSlide(deck, id, 1);
        break;
      case "duplicate":
        deck = duplicateSlide(deck, id);
        break;
      case "delete": {
        if (deck.slides.length <= 1) {
          setStatus("Une présentation doit garder au moins une diapositive.", "error");
          return;
        }
        const suivant = voisinDe(deck, id);
        deck = removeSlide(deck, id);
        selectionId = suivant;
        break;
      }
      default:
        return;
    }

    rendre();
  });

  // --- Import Markdown ---

  const ouvrirImport = (contenu?: string): void => {
    if (contenu !== undefined) el.importTextarea.value = contenu;
    el.importDialog.showModal();
    el.importTextarea.focus();
  };

  el.importButton.addEventListener("click", () => ouvrirImport());

  el.importConfirm.addEventListener("click", (event) => {
    event.preventDefault();
    const markdown = el.importTextarea.value;

    if (markdown.trim() === "") {
      setStatus("Collez du Markdown avant d'importer.", "error");
      return;
    }

    const { slides, title } = slidesFromMarkdown(markdown);
    deck = { ...deck, title: deck.title.trim() === "" ? title : deck.title, slides: [...slides] };
    selectionId = slides[0]?.id ?? "";
    el.deckTitle.value = deck.title;
    el.importDialog.close();
    rendre();
    setStatus(`${String(slides.length)} diapositives créées depuis le Markdown.`, "success");
  });

  /** Coller sur la page pré-remplit l'import — sans jamais écraser sans confirmation. */
  window.addEventListener("paste", (event) => {
    if (isEditable(event.target) || el.importDialog.open) return;

    const markdown = event.clipboardData?.getData("text/plain") ?? "";
    if (markdown.trim() === "") return;

    event.preventDefault();
    ouvrirImport(markdown);
    setStatus("Markdown collé : vérifiez puis confirmez l'import.");
  });

  // --- Mise à l'échelle de l'aperçu ---

  const ajusterEchelle = (): void => {
    const largeur = el.scaler.clientWidth;
    if (largeur === 0) return;
    const echelle = largeur / STAGE_WIDTH;
    el.stage.style.transform = `scale(${String(echelle)})`;
    el.scaler.style.height = `${String(STAGE_HEIGHT * echelle)}px`;
  };

  new ResizeObserver(ajusterEchelle).observe(el.scaler);
  ajusterEchelle();

  rendre();
  setStatus("Présentation prête. Collez du Markdown pour la remplir d'un coup.");
}

// --- Rendu de l'aperçu -------------------------------------------------------

function renderStage(stage: HTMLElement, composition: ComposedSlide): void {
  stage.style.background = `#${composition.background}`;
  stage.replaceChildren();

  for (const shape of composition.shapes) {
    const element = document.createElement("div");
    element.className = "stage__shape";
    element.style.left = pouces(shape.rect.x);
    element.style.top = pouces(shape.rect.y);
    element.style.width = pouces(shape.rect.w);
    element.style.height = pouces(shape.rect.h);
    element.style.background = `#${shape.color}`;
    element.style.opacity = String(1 - (shape.transparency ?? 0) / 100);
    if (shape.radius !== undefined) element.style.borderRadius = pouces(shape.radius);
    stage.append(element);
  }

  for (const box of composition.boxes) {
    if (box.lines.length === 0) continue;
    stage.append(renderTextBox(box));
  }
}

function renderTextBox(box: TextBox): HTMLElement {
  const element = document.createElement("div");
  element.className = "stage__text";
  element.style.left = pouces(box.rect.x);
  element.style.top = pouces(box.rect.y);
  element.style.width = pouces(box.rect.w);
  element.style.height = pouces(box.rect.h);
  element.style.color = `#${box.color}`;
  element.style.fontFamily = `"${box.font}", "Segoe UI", system-ui, sans-serif`;
  element.style.fontSize = `${String(box.size * PX_PAR_POINT)}px`;
  element.style.fontWeight = box.bold ? "700" : "400";
  element.style.fontStyle = box.italic ? "italic" : "normal";
  element.style.textAlign = box.align;
  element.style.lineHeight = String(box.lineSpacing);
  element.style.justifyContent =
    box.valign === "middle" ? "center" : box.valign === "bottom" ? "flex-end" : "flex-start";
  if (box.charSpacing !== 0) element.style.letterSpacing = `${String(box.charSpacing * PX_PAR_POINT)}px`;

  for (const ligne of box.lines) {
    const paragraphe = document.createElement("p");
    paragraphe.className = ligne.bullet ? "stage__line stage__line--bullet" : "stage__line";
    if (ligne.bullet) paragraphe.style.paddingLeft = `${String((ligne.level + 1) * 20)}px`;
    // textContent, jamais innerHTML : ce texte vient de la saisie de
    // l'utilisateur ou d'un Markdown collé.
    paragraphe.textContent = box.uppercase ? ligne.text.toLocaleUpperCase("fr-FR") : ligne.text;
    element.append(paragraphe);
  }

  return element;
}

function pouces(valeur: number): string {
  return `${String(valeur * PX_PAR_POUCE)}px`;
}

// --- Liste des diapositives --------------------------------------------------

function renderSlideList(
  el: Elements,
  deck: Deck,
  selectionId: string,
  template: TemplateSpec,
): void {
  el.slideList.replaceChildren();

  for (const [index, slide] of deck.slides.entries()) {
    const item = document.createElement("li");
    item.className = slide.id === selectionId ? "slide-item is-selected" : "slide-item";

    const choisir = document.createElement("button");
    choisir.type = "button";
    choisir.className = "slide-item__select";
    choisir.dataset["action"] = "select";
    choisir.dataset["slideId"] = slide.id;

    const numero = document.createElement("span");
    numero.className = "slide-item__number";
    numero.textContent = String(index + 1);
    // Pastille aux couleurs du modèle : le changement de modèle devient visible
    // dans la liste, pas seulement dans l'aperçu.
    numero.style.background = `#${template.palette.accent}`;
    numero.style.color = `#${template.palette.onAccent}`;

    const texte = document.createElement("span");
    texte.className = "slide-item__label";

    const titre = document.createElement("span");
    titre.className = "slide-item__title";
    titre.textContent = slide.title.trim() === "" ? "(sans titre)" : slide.title;

    const disposition = document.createElement("span");
    disposition.className = "slide-item__layout";
    disposition.textContent = LAYOUT_LABELS[slide.layout];

    texte.append(titre, disposition);
    choisir.append(numero, texte);

    const outils = document.createElement("span");
    outils.className = "slide-item__tools";
    for (const [action, libelle, titreOutil] of [
      ["up", "▲", "Monter"],
      ["down", "▼", "Descendre"],
      ["duplicate", "⧉", "Dupliquer"],
      ["delete", "✕", "Supprimer"],
    ] as const) {
      const bouton = document.createElement("button");
      bouton.type = "button";
      bouton.className = "slide-item__tool";
      bouton.dataset["action"] = action;
      bouton.dataset["slideId"] = slide.id;
      bouton.textContent = libelle;
      bouton.title = titreOutil;
      bouton.setAttribute("aria-label", `${titreOutil} la diapositive ${String(index + 1)}`);
      outils.append(bouton);
    }

    item.append(choisir, outils);
    el.slideList.append(item);
  }
}

// --- Panneau d'édition -------------------------------------------------------

type Colonne = "blocks" | "asideBlocks";

interface InspectorActions {
  setLayout(layout: SlideLayout): void;
  setTitle(value: string): void;
  setSubtitle(value: string): void;
  setNotes(value: string): void;
  setBlockText(colonne: Colonne, blockId: string, value: string): void;
  toggleBlockType(colonne: Colonne, blockId: string): void;
  toggleBlockLevel(colonne: Colonne, blockId: string): void;
  moveBlock(colonne: Colonne, blockId: string, direction: -1 | 1): void;
  addBlock(colonne: Colonne): void;
  removeBlock(colonne: Colonne, blockId: string): void;
}

function renderInspector(el: Elements, slide: Slide, actions: InspectorActions): void {
  el.inspector.replaceChildren();

  const disposition = document.createElement("label");
  disposition.className = "field";
  disposition.append(champLabel("Disposition"));

  const select = document.createElement("select");
  select.className = "field__control";
  for (const [layout, libelle] of Object.entries(LAYOUT_LABELS)) {
    const option = document.createElement("option");
    option.value = layout;
    option.textContent = libelle;
    select.append(option);
  }
  select.value = slide.layout;
  select.addEventListener("change", () => actions.setLayout(select.value as SlideLayout));
  disposition.append(select);
  el.inspector.append(disposition);

  el.inspector.append(
    champTexte(titleLabel(slide.layout), slide.title, actions.setTitle.bind(actions), slide.layout === "quote"),
    champTexte(subtitleLabel(slide.layout), slide.subtitle, actions.setSubtitle.bind(actions)),
  );

  if (usesBlocks(slide.layout)) {
    el.inspector.append(
      sectionBlocs(usesAside(slide.layout) ? "Colonne de gauche" : "Contenu", "blocks", slide.blocks, actions),
    );
  }
  if (usesAside(slide.layout)) {
    el.inspector.append(sectionBlocs("Colonne de droite", "asideBlocks", slide.asideBlocks, actions));
  }

  el.inspector.append(champTexte("Notes du présentateur", slide.notes, actions.setNotes.bind(actions), true));
}

function sectionBlocs(
  titre: string,
  colonne: Colonne,
  blocks: readonly Block[],
  actions: InspectorActions,
): HTMLElement {
  const section = document.createElement("section");
  section.className = "blocks";

  const entete = document.createElement("h3");
  entete.className = "blocks__title";
  entete.textContent = titre;
  section.append(entete);

  for (const [index, block] of blocks.entries()) {
    section.append(ligneDeBloc(block, index, blocks.length, colonne, actions));
  }

  const ajouter = document.createElement("button");
  ajouter.type = "button";
  ajouter.className = "button button--link blocks__add";
  ajouter.textContent = "+ Ajouter un bloc";
  ajouter.addEventListener("click", () => actions.addBlock(colonne));
  section.append(ajouter);

  return section;
}

function ligneDeBloc(
  block: Block,
  index: number,
  total: number,
  colonne: Colonne,
  actions: InspectorActions,
): HTMLElement {
  const ligne = document.createElement("div");
  ligne.className = "block";

  const zone = document.createElement("textarea");
  zone.className = "block__text";
  zone.rows = 2;
  zone.value = block.text;
  zone.placeholder = "Texte du bloc";
  zone.addEventListener("input", () => actions.setBlockText(colonne, block.id, zone.value));
  ligne.append(zone);

  const outils = document.createElement("div");
  outils.className = "block__tools";

  outils.append(
    petitBouton(block.type === "bullet" ? "•" : "¶", block.type === "bullet" ? "Puce — cliquer pour un paragraphe" : "Paragraphe — cliquer pour une puce", () =>
      actions.toggleBlockType(colonne, block.id),
    ),
    petitBouton(block.level === 0 ? "→" : "←", block.level === 0 ? "Décaler vers la droite" : "Ramener vers la gauche", () =>
      actions.toggleBlockLevel(colonne, block.id),
    ),
    petitBouton("▲", "Monter", () => actions.moveBlock(colonne, block.id, -1), index === 0),
    petitBouton("▼", "Descendre", () => actions.moveBlock(colonne, block.id, 1), index === total - 1),
    petitBouton("✕", "Supprimer", () => actions.removeBlock(colonne, block.id)),
  );

  ligne.append(outils);
  return ligne;
}

function petitBouton(
  libelle: string,
  titre: string,
  onClick: () => void,
  disabled = false,
): HTMLButtonElement {
  const bouton = document.createElement("button");
  bouton.type = "button";
  bouton.className = "block__tool";
  bouton.textContent = libelle;
  bouton.title = titre;
  bouton.setAttribute("aria-label", titre);
  bouton.disabled = disabled;
  bouton.addEventListener("click", onClick);
  return bouton;
}

function champTexte(
  libelle: string,
  valeur: string,
  onInput: (value: string) => void,
  multiligne = false,
): HTMLElement {
  const champ = document.createElement("label");
  champ.className = "field";
  champ.append(champLabel(libelle));

  const controle = multiligne
    ? document.createElement("textarea")
    : document.createElement("input");
  controle.className = "field__control";
  controle.value = valeur;
  if (controle instanceof HTMLTextAreaElement) controle.rows = 3;
  controle.addEventListener("input", () => onInput(controle.value));

  champ.append(controle);
  return champ;
}

function champLabel(texte: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "field__label";
  span.textContent = texte;
  return span;
}

// --- Utilitaires -------------------------------------------------------------

function colonneDe(slide: Slide, colonne: Colonne): readonly Block[] {
  return colonne === "blocks" ? slide.blocks : slide.asideBlocks;
}

function deplacer(blocks: readonly Block[], blockId: string, direction: -1 | 1): Block[] {
  const index = blocks.findIndex((block) => block.id === blockId);
  const cible = index + direction;
  const copie = [...blocks];
  if (index === -1 || cible < 0 || cible >= copie.length) return copie;

  const [retire] = copie.splice(index, 1);
  if (retire === undefined) return copie;
  copie.splice(cible, 0, retire);
  return copie;
}

/** Diapositive à sélectionner après une suppression : la suivante, sinon la précédente. */
function voisinDe(deck: Deck, slideId: string): string {
  const index = deck.slides.findIndex((slide) => slide.id === slideId);
  const suivant = deck.slides[index + 1] ?? deck.slides[index - 1];
  return suivant?.id ?? "";
}

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function chargerDepuisStockage(): Deck | null {
  try {
    const brut = localStorage.getItem(CLE_STOCKAGE);
    if (brut === null) return null;
    return parseDeck(JSON.parse(brut));
  } catch {
    // Contenu illisible ou stockage inaccessible : on repart proprement plutôt
    // que d'ouvrir un éditeur dans un état incohérent.
    return null;
  }
}

function collectElements(): Elements {
  return {
    deckTitle: requireElement("deck-title", HTMLInputElement),
    deckAuthor: requireElement("deck-author", HTMLInputElement),
    templateSelect: requireElement("template-select", HTMLSelectElement),
    exportButton: requireElement("export-button", HTMLButtonElement),
    importButton: requireElement("import-button", HTMLButtonElement),
    resetButton: requireElement("reset-button", HTMLButtonElement),
    status: requireElement("deck-status", HTMLElement),
    slideList: requireElement("slide-list", HTMLOListElement),
    addSlide: requireElement("add-slide", HTMLButtonElement),
    scaler: requireElement("stage-scaler", HTMLElement),
    stage: requireElement("stage", HTMLElement),
    inspector: requireElement("inspector", HTMLElement),
    importDialog: requireElement("import-dialog", HTMLDialogElement),
    importTextarea: requireElement("import-textarea", HTMLTextAreaElement),
    importConfirm: requireElement("import-confirm", HTMLButtonElement),
  };
}

function requireElement<T extends HTMLElement>(id: string, type: new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) {
    throw new Error(`Élément « ${id} » introuvable ou de type inattendu.`);
  }
  return element;
}
