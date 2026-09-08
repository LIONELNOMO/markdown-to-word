import { describe, expect, it } from "vitest";
import {
  changeLayout,
  createBlock,
  createSlide,
  duplicateSlide,
  moveSlide,
  parseDeck,
  removeSlide,
  starterDeck,
} from "../src/pptx/deck.js";
import { slidesFromMarkdown } from "../src/pptx/from-markdown.js";
import { CANVAS, composeSlide } from "../src/pptx/layout.js";
import { TEMPLATES, isTemplateId, templateById } from "../src/pptx/templates.js";
import { safeFileName } from "../src/pptx/export.js";
import type { Deck, Slide, SlideLayout } from "../src/pptx/types.js";

const TOUTES_DISPOSITIONS: readonly SlideLayout[] = [
  "title",
  "section",
  "content",
  "split",
  "quote",
  "closing",
];

const MARKDOWN = `# Revue de trimestre

Bilan et perspectives

## Ce qui a fonctionné

- Le délai moyen passe de 12 à 7 jours
  - Dont 3 jours sur la validation
- Trois clients ont renouvelé

> On ne peut pas industrialiser ce qu'on ne mesure pas.

# Perspectives

## Trois chantiers

1. Refonte du socle
2. Automatisation
`;

describe("modèles graphiques", () => {
  it("fournit exactement deux modèles, identifiables", () => {
    expect(TEMPLATES).toHaveLength(2);
    expect(TEMPLATES.map((t) => t.id).sort()).toEqual(["azur", "nocturne"]);
    expect(isTemplateId("azur")).toBe(true);
    expect(isTemplateId("inconnu")).toBe(false);
  });

  it("se rabat sur un modèle valide plutôt que de casser le rendu", () => {
    // `templateById` reçoit des valeurs venues du stockage local, non fiables.
    expect(templateById("azur").id).toBe("azur");
    expect(templateById("nocturne").dark).toBe(true);
  });

  it("n'utilise que des couleurs hexadécimales sans dièse, comme l'exige OOXML", () => {
    for (const template of TEMPLATES) {
      for (const couleur of Object.values(template.palette)) {
        expect(couleur).toMatch(/^[0-9A-Fa-f]{6}$/);
      }
    }
  });
});

describe("composition des diapositives", () => {
  const exemple = (layout: SlideLayout): Slide =>
    createSlide(layout, {
      title: "Un titre de diapositive raisonnablement long pour tester la largeur",
      subtitle: "Un sous-titre",
      blocks: [createBlock("Premier point"), createBlock("Second point", "bullet", 1)],
      asideBlocks: [createBlock("Autre colonne")],
    });

  it("garde tout élément à l'intérieur de la diapositive", () => {
    // L'invariant qui compte : un élément qui déborde est invisible à la
    // projection et coupé à l'impression.
    for (const template of TEMPLATES) {
      for (const layout of TOUTES_DISPOSITIONS) {
        const composition = composeSlide(exemple(layout), template, 2, 8);
        const zones = [
          ...composition.shapes.map((shape) => shape.rect),
          ...composition.boxes.map((box) => box.rect),
        ];

        for (const rect of zones) {
          expect(rect.x, `${template.id}/${layout} : x`).toBeGreaterThanOrEqual(0);
          expect(rect.y, `${template.id}/${layout} : y`).toBeGreaterThanOrEqual(0);
          expect(rect.x + rect.w, `${template.id}/${layout} : droite`).toBeLessThanOrEqual(
            CANVAS.width + 0.001,
          );
          expect(rect.y + rect.h, `${template.id}/${layout} : bas`).toBeLessThanOrEqual(
            CANVAS.height + 0.001,
          );
        }
      }
    }
  });

  it("sépare réellement les deux colonnes", () => {
    // Une gouttière nulle ferait fusionner les deux encarts en un seul bloc.
    const composition = composeSlide(exemple("split"), templateById("nocturne"), 1, 4);
    const encarts = composition.shapes.filter((shape) => shape.rect.h > 3);

    expect(encarts).toHaveLength(2);
    const [gauche, droite] = encarts;
    expect(gauche && droite).toBeTruthy();
    if (gauche && droite) {
      expect(droite.rect.x - (gauche.rect.x + gauche.rect.w)).toBeGreaterThan(0.1);
    }
  });

  it("n'émet aucun bloc de texte pour un champ vide", () => {
    const vide = createSlide("content", { title: "", subtitle: "", blocks: [createBlock("  ")] });
    const composition = composeSlide(vide, templateById("azur"), 0, 1);

    expect(composition.boxes.every((box) => box.lines.length === 0)).toBe(true);
  });

  it("ne pagine pas une présentation d'une seule diapositive", () => {
    const seule = composeSlide(exemple("content"), templateById("azur"), 0, 1);
    const paginee = composeSlide(exemple("content"), templateById("azur"), 0, 6);

    expect(seule.boxes.length).toBeLessThan(paginee.boxes.length);
  });
});

describe("opérations sur la présentation", () => {
  it("propose un point de départ couvrant plusieurs dispositions", () => {
    const deck = starterDeck();
    expect(deck.slides.length).toBeGreaterThanOrEqual(3);
    expect(new Set(deck.slides.map((slide) => slide.layout)).size).toBeGreaterThan(1);
  });

  it("duplique sans jamais partager d'identifiant", () => {
    const deck = starterDeck();
    const source = deck.slides[1];
    expect(source).toBeDefined();
    if (!source) return;

    const apres = duplicateSlide(deck, source.id);
    const copie = apres.slides[2];

    expect(apres.slides).toHaveLength(deck.slides.length + 1);
    expect(copie?.id).not.toBe(source.id);
    // Des blocs partageant une clé feraient éditer les deux diapositives à la fois.
    const idsSource = source.blocks.map((block) => block.id);
    for (const block of copie?.blocks ?? []) expect(idsSource).not.toContain(block.id);
  });

  it("refuse de supprimer la dernière diapositive", () => {
    const deck: Deck = { ...starterDeck(), slides: [createSlide("content")] };
    const apres = removeSlide(deck, deck.slides[0]?.id ?? "");

    expect(apres.slides).toHaveLength(1);
  });

  it("ne déplace pas au-delà des bornes", () => {
    const deck = starterDeck();
    const premier = deck.slides[0]?.id ?? "";

    expect(moveSlide(deck, premier, -1).slides[0]?.id).toBe(premier);
    expect(moveSlide(deck, premier, 1).slides[1]?.id).toBe(premier);
  });

  it("crée un bloc en passant à une disposition qui en attend", () => {
    const titre = createSlide("title", { title: "Couverture" });
    expect(titre.blocks).toHaveLength(0);

    const contenu = changeLayout(titre, "content");
    expect(contenu.blocks.length).toBeGreaterThan(0);
    // Le titre saisi n'est pas perdu au passage.
    expect(contenu.title).toBe("Couverture");
  });
});

describe("relecture du stockage local", () => {
  it("relit une présentation qu'elle vient d'écrire", () => {
    const deck = starterDeck("nocturne");
    const relu = parseDeck(JSON.parse(JSON.stringify(deck)));

    expect(relu?.template).toBe("nocturne");
    expect(relu?.slides).toHaveLength(deck.slides.length);
  });

  it("écarte un contenu invalide plutôt que d'ouvrir un éditeur incohérent", () => {
    expect(parseDeck(null)).toBeNull();
    expect(parseDeck("du texte")).toBeNull();
    expect(parseDeck({ slides: [] })).toBeNull();
    expect(parseDeck({ slides: ["pas un objet"] })).toBeNull();
  });

  it("répare les champs douteux au lieu de tout rejeter", () => {
    const relu = parseDeck({
      title: 42,
      template: "modele-inexistant",
      slides: [{ layout: "disposition-inconnue", title: "Titre", blocks: [{ text: "x", level: 99 }] }],
    });

    expect(relu).not.toBeNull();
    expect(relu?.title).toBe("Nouvelle présentation");
    expect(relu?.template).toBe("azur");
    expect(relu?.slides[0]?.layout).toBe("content");
    // Un niveau d'imbrication aberrant est ramené dans les bornes.
    expect(relu?.slides[0]?.blocks[0]?.level).toBe(1);
  });
});

describe("import depuis du Markdown", () => {
  const { slides, title } = slidesFromMarkdown(MARKDOWN);

  it("fait du premier titre de niveau 1 la couverture", () => {
    expect(title).toBe("Revue de trimestre");
    expect(slides[0]?.layout).toBe("title");
    expect(slides[0]?.title).toBe("Revue de trimestre");
  });

  it("rattache le paragraphe suivant la couverture à son sous-titre", () => {
    // Sans cette règle, il ouvrirait une diapositive de contenu sans titre.
    expect(slides[0]?.subtitle).toBe("Bilan et perspectives");
    expect(slides.some((slide) => slide.title === "" && slide.layout === "content")).toBe(false);
  });

  it("transforme les titres de niveau 2 en diapositives de contenu", () => {
    const contenu = slides.find((slide) => slide.title === "Ce qui a fonctionné");
    expect(contenu?.layout).toBe("content");
    expect(contenu?.blocks).toHaveLength(3);
  });

  it("conserve un niveau d'imbrication pour les sous-listes", () => {
    const contenu = slides.find((slide) => slide.title === "Ce qui a fonctionné");
    expect(contenu?.blocks[1]?.level).toBe(1);
  });

  it("donne une diapositive dédiée à une citation", () => {
    const citation = slides.find((slide) => slide.layout === "quote");
    expect(citation?.title).toContain("industrialiser");
  });

  it("fait des titres de niveau 1 suivants des intertitres", () => {
    const intertitre = slides.find((slide) => slide.layout === "section");
    expect(intertitre?.title).toBe("Perspectives");
  });

  it("produit toujours au moins une diapositive", () => {
    expect(slidesFromMarkdown("").slides).toHaveLength(1);
    expect(slidesFromMarkdown("   ").slides).toHaveLength(1);
  });

  it("scinde une diapositive trop chargée plutôt que de la faire déborder", () => {
    const longue = `## Beaucoup de points\n\n${Array.from({ length: 15 }, (_, i) => `- Point ${String(i + 1)}`).join("\n")}`;
    const resultat = slidesFromMarkdown(longue);

    expect(resultat.slides.length).toBeGreaterThan(1);
    for (const slide of resultat.slides) expect(slide.blocks.length).toBeLessThanOrEqual(7);
  });
});

describe("nom du fichier exporté", () => {
  it("retire les caractères interdits sans détruire le reste", () => {
    expect(safeFileName("Revue T1 : bilan/perspectives")).toBe("Revue T1 bilan perspectives");
    expect(safeFileName("Plan 2026-2027")).toBe("Plan 2026-2027");
  });

  it("garantit toujours un nom exploitable", () => {
    expect(safeFileName("")).toBe("presentation");
    expect(safeFileName("   ")).toBe("presentation");
    expect(safeFileName("///")).toBe("presentation");
  });
});
