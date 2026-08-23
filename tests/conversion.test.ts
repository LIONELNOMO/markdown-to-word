import { Packer } from "docx";
import { describe, expect, it } from "vitest";
import { buildDocument, deriveBaseName, sanitizeFileName } from "../src/docx/document.js";
import { fitToWidth, sanitizeUrl, stripHtml } from "../src/docx/inlines.js";
import { detectImageType, readImageSize } from "../src/images/detect.js";
import { metadataFromFrontmatter, parseFrontmatter } from "../src/markdown/frontmatter.js";
import { indexDocument, toPlainText } from "../src/markdown/inspect.js";
import { parseMarkdown } from "../src/markdown/parse.js";

const RICH_MARKDOWN = `---
title: Rapport trimestriel
author: Service Qualité
keywords: qualité, audit
---

# Rapport trimestriel

Un paragraphe avec du **gras**, de l'_italique_, du ~~barré~~, du \`code\` et un
[lien](https://example.com/doc).

## Constats

1. Premier constat
2. Deuxième constat
   - sous-point
   - autre sous-point avec un [lien de référence][ref]

- [x] Action réalisée
- [ ] Action à mener

> Une citation.
>
> > Imbriquée sur deux niveaux.

| Indicateur | Cible | Réel |
| ---------- | ----: | :--: |
| Délai      |    5j |  4j  |
| Coût       |  100k | 120k |

\`\`\`ts
const total = items.reduce((sum, item) => sum + item.price, 0);
\`\`\`

Une note de bas de page[^1].

![Schéma](https://example.invalid/schema.png)

---

[^1]: Contenu de la note.

[ref]: https://example.com/reference
`;

describe("parseFrontmatter", () => {
  it("lit les paires clé/valeur de premier niveau", () => {
    const entries = parseFrontmatter('title: "Mon rapport"\nauthor: Dupont\ndraft: true');

    expect(entries.get("title")).toBe("Mon rapport");
    expect(entries.get("author")).toBe("Dupont");
  });

  it("ignore les structures imbriquées et les listes", () => {
    const entries = parseFrontmatter("title: X\nauteurs:\n  - Alice\n  - Bob\n# commentaire");

    expect(entries.get("title")).toBe("X");
    expect(entries.has("auteurs")).toBe(false);
    expect(entries.has("- alice")).toBe(false);
  });

  it("projette les alias français sur les métadonnées Word", () => {
    const metadata = metadataFromFrontmatter(parseFrontmatter("titre: T\nauteur: A"));

    expect(metadata).toEqual({ title: "T", creator: "A" });
  });
});

describe("indexDocument", () => {
  it("recense définitions, notes, images et statistiques", () => {
    const index = indexDocument(parseMarkdown(RICH_MARKDOWN));

    expect(index.firstHeading).toBe("Rapport trimestriel");
    expect(index.frontmatter.get("title")).toBe("Rapport trimestriel");
    expect(index.definitions.has("ref")).toBe(true);
    expect(index.footnoteDefinitions.has("1")).toBe(true);
    expect(index.imageUrls).toEqual(["https://example.invalid/schema.png"]);
    expect(index.stats).toMatchObject({ headings: 2, tables: 1, images: 1, codeBlocks: 1, footnotes: 1 });
  });

  it("résout l'URL d'une image référencée déclarée plus bas", () => {
    const index = indexDocument(parseMarkdown("![alt][img]\n\n[img]: photo.png"));

    expect(index.imageUrls).toEqual(["photo.png"]);
  });

  it("extrait le texte d'un sous-arbre en écartant les balises HTML", () => {
    const root = parseMarkdown("# Titre **fort** <br/>suite");

    expect(toPlainText(root).trim()).toBe("Titre fort suite");
  });
});

describe("sanitizeUrl", () => {
  it.each(["https://example.com", "http://a.b", "mailto:x@y.z", "#ancre", "./relatif.md"])(
    "accepte %s",
    (url) => {
      expect(sanitizeUrl(url)).toBe(url);
    },
  );

  it.each(["javascript:alert(1)", "vbscript:msgbox", "file:///C:/secret.txt", "   "])(
    "rejette %s",
    (url) => {
      expect(sanitizeUrl(url)).toBeNull();
    },
  );

  it("neutralise une casse trompeuse", () => {
    expect(sanitizeUrl("JaVaScRiPt:alert(1)")).toBeNull();
  });
});

describe("sanitizeFileName", () => {
  it("retire les caractères interdits en conservant la lisibilité", () => {
    expect(sanitizeFileName('Rapport: Q1/Q2 <final>')).toBe("Rapport Q1 Q2 final");
  });

  it("préserve les tirets et les accents", () => {
    expect(sanitizeFileName("Compte-rendu réunion")).toBe("Compte-rendu réunion");
  });

  it("remplace un nom réservé Windows", () => {
    expect(sanitizeFileName("CON")).toBe("document");
    expect(sanitizeFileName("   ")).toBe("document");
  });

  it("suit l'ordre de priorité nom explicite → titre → premier titre", () => {
    expect(deriveBaseName("explicite", "titre", "h1")).toBe("explicite");
    expect(deriveBaseName(undefined, "titre", "h1")).toBe("titre");
    expect(deriveBaseName(undefined, undefined, "h1")).toBe("h1");
    expect(deriveBaseName(undefined, undefined, null)).toBe("document");
  });
});

describe("fitToWidth", () => {
  it("laisse intacte une image plus étroite que la zone de texte", () => {
    expect(fitToWidth({ width: 320, height: 200 }, 600)).toEqual({ width: 320, height: 200 });
  });

  it("réduit en conservant le ratio", () => {
    expect(fitToWidth({ width: 1200, height: 800 }, 600)).toEqual({ width: 600, height: 400 });
  });

  it("retombe sur une taille par défaut si les dimensions sont absurdes", () => {
    expect(fitToWidth({ width: 0, height: 0 }, 600)).toEqual({ width: 600, height: 450 });
  });
});

describe("détection d'images", () => {
  const png = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // longueur + "IHDR"
    0x00, 0x00, 0x02, 0x00, // largeur 512
    0x00, 0x00, 0x01, 0x00, // hauteur 256
  ]);

  const jpeg = new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xc0, 0x00, 0x11, 0x08,
    0x01, 0x2c, // hauteur 300
    0x01, 0x90, // largeur 400
    0x00,
  ]);

  const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 0x00, 0x20, 0x00]);

  it("identifie les formats par signature", () => {
    expect(detectImageType(png)).toBe("png");
    expect(detectImageType(jpeg)).toBe("jpg");
    expect(detectImageType(gif)).toBe("gif");
    expect(detectImageType(new TextEncoder().encode('<svg xmlns="…"></svg>'))).toBe("svg");
    expect(detectImageType(new Uint8Array([1, 2, 3, 4]))).toBe("unknown");
  });

  it("lit les dimensions dans l'en-tête", () => {
    expect(readImageSize(png, "png")).toEqual({ width: 512, height: 256 });
    expect(readImageSize(jpeg, "jpg")).toEqual({ width: 400, height: 300 });
    expect(readImageSize(gif, "gif")).toEqual({ width: 64, height: 32 });
  });

  it("renvoie null sur un en-tête tronqué", () => {
    expect(readImageSize(png.subarray(0, 12), "png")).toBeNull();
    expect(readImageSize(new Uint8Array([0xff, 0xd8]), "jpg")).toBeNull();
  });
});

describe("stripHtml", () => {
  it("conserve le texte et décode les entités", () => {
    expect(stripHtml("<p>Bonjour &amp; bienvenue</p>")).toBe("Bonjour & bienvenue");
  });
});

describe("buildDocument", () => {
  it("refuse un contenu vide", async () => {
    await expect(buildDocument("   \n  ")).rejects.toThrow(/vide/i);
  });

  it("produit un .docx sérialisable à partir d'un document complet", async () => {
    const result = await buildDocument(RICH_MARKDOWN, { tableOfContents: true, pageHeader: true });

    expect(result.fileName).toBe("Rapport trimestriel.docx");
    expect(result.metadata).toMatchObject({ title: "Rapport trimestriel", creator: "Service Qualité" });

    const buffer = await Packer.toBuffer(result.document);
    // Signature d'archive ZIP : un .docx valide en commence toujours une.
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(buffer.byteLength).toBeGreaterThan(5000);
  });

  it("signale les images non intégrées sans faire échouer la conversion", async () => {
    const result = await buildDocument("![alt](https://example.invalid/a.png)");

    expect(result.warnings.map((warning) => warning.message).join(" ")).toMatch(/image/i);
    await expect(Packer.toBuffer(result.document)).resolves.toBeDefined();
  });

  it("laisse les métadonnées explicites primer sur le front matter", async () => {
    const result = await buildDocument(RICH_MARKDOWN, { metadata: { title: "Titre imposé" } });

    expect(result.metadata.title).toBe("Titre imposé");
    expect(result.fileName).toBe("Titre imposé.docx");
  });

  it("sérialise listes ordonnées à départ décalé, citations et tableaux irréguliers", async () => {
    const markdown = [
      "5. cinq",
      "6. six",
      "",
      "> citation",
      "",
      "| a | b | c |",
      "| - | - | - |",
      "| 1 |",
      "",
      "```",
      "  ligne indentée",
      "```",
    ].join("\n");

    const result = await buildDocument(markdown);

    await expect(Packer.toBuffer(result.document)).resolves.toBeDefined();
  });
});
