import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultConfig, type AutomationConfig } from "../src/automation/config.js";
import { acquireSingleInstanceLock } from "../src/automation/lock.js";
import { convertToWord } from "../src/automation/pipeline.js";
import {
  SandboxedImageResolver,
  candidateFileName,
  isMarkdownCandidate,
} from "../src/automation/policy.js";
import { FolderWatcher, type DetectedFile } from "../src/automation/watcher.js";

/** PNG 1x1 valide : sert de vraie image sur disque pour les tests d'accès. */
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const CONTENU_COMPLET = `# Titre

Contenu complet du document.
`;

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "md2docx-test-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function testConfig(overrides: Partial<AutomationConfig> = {}): AutomationConfig {
  return {
    ...defaultConfig(),
    outputDir: join(workspace, "sortie"),
    // Aucun test ne doit ouvrir Word.
    openAfterConvert: false,
    ...overrides,
  };
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("filtre des fichiers surveillés", () => {
  it("accepte les extensions Markdown", () => {
    expect(isMarkdownCandidate("rapport.md")).toBe(true);
    expect(isMarkdownCandidate("NOTES.MARKDOWN")).toBe(true);
    expect(isMarkdownCandidate("guide.mkd")).toBe(true);
  });

  it("ignore un téléchargement encore en cours", () => {
    // Le piège central : agir sur ces fichiers convertirait un contenu tronqué.
    expect(isMarkdownCandidate("rapport.md.crdownload")).toBe(false);
    expect(isMarkdownCandidate("rapport.md.part")).toBe(false);
    expect(isMarkdownCandidate("rapport.md.tmp")).toBe(false);
  });

  it("ignore les fichiers de service et les autres formats", () => {
    expect(isMarkdownCandidate("~$rapport.md")).toBe(false);
    expect(isMarkdownCandidate(".eslintrc.md")).toBe(false);
    expect(isMarkdownCandidate("rapport.docx")).toBe(false);
    expect(isMarkdownCandidate("rapport.txt")).toBe(false);
  });
});

describe("cloisonnement des images", () => {
  it("lit une image voisine du fichier source", async () => {
    await writeFile(join(workspace, "schema.png"), PNG_1PX);
    const resolver = new SandboxedImageResolver({ baseDir: workspace, allowRemote: false });

    const image = await resolver.resolve("schema.png");

    expect(image).not.toBeNull();
    expect(image?.type).toBe("png");
    expect(resolver.blocked).toEqual([]);
  });

  it("refuse de remonter hors du dossier source", async () => {
    const nested = join(workspace, "docs");
    await mkdir(nested, { recursive: true });
    await writeFile(join(workspace, "prive.png"), PNG_1PX);

    const resolver = new SandboxedImageResolver({ baseDir: nested, allowRemote: false });

    expect(await resolver.resolve("../prive.png")).toBeNull();
    // Même remontée, dissimulée par un encodage d'URL.
    expect(await resolver.resolve("..%2Fprive.png")).toBeNull();
    expect(resolver.blocked).toHaveLength(2);
  });

  it("refuse les chemins absolus et le schéma file:", async () => {
    const resolver = new SandboxedImageResolver({ baseDir: workspace, allowRemote: false });

    expect(await resolver.resolve("C:/Windows/win.ini")).toBeNull();
    expect(await resolver.resolve("/etc/passwd")).toBeNull();
    expect(await resolver.resolve("file:///C:/Windows/win.ini")).toBeNull();
    expect(await resolver.resolve("//serveur/partage/image.png")).toBeNull();
    expect(resolver.blocked).toHaveLength(4);
  });

  it("ne déclenche aucune requête sortante sans autorisation explicite", async () => {
    const resolver = new SandboxedImageResolver({ baseDir: workspace, allowRemote: false });

    expect(await resolver.resolve("https://exemple.test/pixel.png")).toBeNull();
    expect(resolver.blocked).toEqual(["https://exemple.test/pixel.png"]);
  });

  it("n'accorde aucun accès disque à une source sans emplacement", async () => {
    await writeFile(join(workspace, "schema.png"), PNG_1PX);
    const resolver = new SandboxedImageResolver({ baseDir: null, allowRemote: false });

    expect(await resolver.resolve("schema.png")).toBeNull();
    expect(await resolver.resolve("./schema.png")).toBeNull();
  });
});

describe("nommage des documents produits", () => {
  it("numérote les homonymes sans jamais écraser", () => {
    expect(candidateFileName("Rapport", 0)).toBe("Rapport.docx");
    expect(candidateFileName("Rapport", 1)).toBe("Rapport (2).docx");
    expect(candidateFileName("Rapport", 2)).toBe("Rapport (3).docx");
  });

  it("tire le nom du titre du document, pas du nom de fichier source", async () => {
    const outcome = await convertToWord(
      {
        markdown: "# Synthèse budgétaire\n\nContenu.",
        baseDir: null,
        fallbackName: "document",
      },
      testConfig(),
    );

    expect(outcome.outputPath.endsWith("Synthèse budgétaire.docx")).toBe(true);
  });

  it("préfère le titre du front matter au premier titre rencontré", async () => {
    const markdown = `---
title: Titre officiel
---

# Autre titre

Contenu.
`;

    const outcome = await convertToWord(
      { markdown, baseDir: null, fallbackName: "document" },
      testConfig(),
    );

    expect(outcome.outputPath.endsWith("Titre officiel.docx")).toBe(true);
  });

  it("se rabat sur le nom de la source quand le document n'a pas de titre", async () => {
    const outcome = await convertToWord(
      { markdown: "Juste un paragraphe.", baseDir: null, fallbackName: "export-conversation" },
      testConfig(),
    );

    expect(outcome.outputPath.endsWith("export-conversation.docx")).toBe(true);
  });

  it("conserve les deux documents en cas de titre identique", async () => {
    const config = testConfig();
    const source = { markdown: "# Rapport\n\nContenu.", baseDir: null, fallbackName: null };

    const first = await convertToWord(source, config);
    const second = await convertToWord(source, config);

    expect(first.outputPath).not.toBe(second.outputPath);
    expect(second.outputPath.endsWith("Rapport (2).docx")).toBe(true);
    expect((await readdir(config.outputDir)).sort()).toEqual(["Rapport (2).docx", "Rapport.docx"]);
  });

  it("écrit un .docx réellement valide", async () => {
    const outcome = await convertToWord(
      { markdown: "# Titre\n\nTexte.", baseDir: null, fallbackName: null },
      testConfig(),
    );

    const bytes = await readFile(outcome.outputPath);

    // Signature d'une archive ZIP : un .docx en est une.
    expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});

describe("détection des fichiers terminés", () => {
  it("attend la fin de l'écriture avant de signaler le fichier", async () => {
    const detected: DetectedFile[] = [];
    const target = join(workspace, "rapport.md");

    // Fichier créé vide puis complété : exactement ce que fait un navigateur
    // pendant un téléchargement.
    await writeFile(target, "");

    const watcher = new FolderWatcher({
      directory: workspace,
      since: 0,
      accept: isMarkdownCandidate,
      onFile: async (file) => {
        detected.push(file);
      },
      onError: () => undefined,
      stabilityMs: 20,
      stableReadings: 2,
      settleTimeoutMs: 3000,
      reconcileMs: 50,
    });

    await watcher.start();
    await writeFile(target, CONTENU_COMPLET);
    await pause(400);
    await watcher.drain();
    await watcher.stop();

    expect(detected).toHaveLength(1);
    // La taille observée est celle du fichier complet, pas du fichier vide.
    expect(detected[0]?.size).toBe(Buffer.byteLength(CONTENU_COMPLET, "utf8"));
  });

  it("ne signale pas deux fois un fichier inchangé", async () => {
    const detected: DetectedFile[] = [];
    await writeFile(join(workspace, "note.md"), "# Note");

    const watcher = new FolderWatcher({
      directory: workspace,
      since: 0,
      accept: isMarkdownCandidate,
      onFile: async (file) => {
        detected.push(file);
      },
      onError: () => undefined,
      stabilityMs: 20,
      stableReadings: 1,
      settleTimeoutMs: 3000,
      reconcileMs: 40,
    });

    await watcher.start();
    // Plusieurs cycles de relecture doivent rester sans effet.
    await pause(300);
    await watcher.drain();
    await watcher.stop();

    expect(detected).toHaveLength(1);
  });

  it("ignore les fichiers antérieurs au démarrage du service", async () => {
    const detected: DetectedFile[] = [];
    await writeFile(join(workspace, "ancien.md"), "# Ancien");

    const watcher = new FolderWatcher({
      directory: workspace,
      // Tout ce qui précède cet instant appartient au passé.
      since: Date.now() + 60_000,
      accept: isMarkdownCandidate,
      onFile: async (file) => {
        detected.push(file);
      },
      onError: () => undefined,
      stabilityMs: 20,
      stableReadings: 1,
      settleTimeoutMs: 1000,
      reconcileMs: 40,
    });

    await watcher.start();
    await pause(200);
    await watcher.drain();
    await watcher.stop();

    expect(detected).toEqual([]);
  });

  it("survit à une conversion en échec et poursuit avec les autres", async () => {
    const errors: unknown[] = [];
    const seen: string[] = [];
    await writeFile(join(workspace, "a.md"), "# A");
    await writeFile(join(workspace, "b.md"), "# B");

    const watcher = new FolderWatcher({
      directory: workspace,
      since: 0,
      accept: isMarkdownCandidate,
      onFile: async (file) => {
        seen.push(file.path);
        throw new Error("panne simulée");
      },
      onError: (error) => errors.push(error),
      stabilityMs: 20,
      stableReadings: 1,
      settleTimeoutMs: 1000,
      reconcileMs: 40,
    });

    await watcher.start();
    await pause(300);
    await watcher.drain();
    await watcher.stop();

    expect(seen).toHaveLength(2);
    expect(errors).toHaveLength(2);
  });
});

describe("instance unique", () => {
  it("refuse un second service et libère le verrou à l'arrêt", async () => {
    const lockPath = join(workspace, "etat", "watch.lock");

    const first = await acquireSingleInstanceLock(lockPath);
    expect(first.acquired).toBe(true);

    const second = await acquireSingleInstanceLock(lockPath);
    expect(second.acquired).toBe(false);
    if (!second.acquired) expect(second.holderPid).toBe(process.pid);

    if (first.acquired) await first.release();

    const third = await acquireSingleInstanceLock(lockPath);
    expect(third.acquired).toBe(true);
    if (third.acquired) await third.release();
  });

  it("reprend un verrou laissé par un processus disparu", async () => {
    const lockPath = join(workspace, "watch.lock");
    // PID hors de portée : simule un arrêt brutal du service précédent.
    await writeFile(lockPath, "4294967295", "utf8");

    const lock = await acquireSingleInstanceLock(lockPath);

    expect(lock.acquired).toBe(true);
    if (lock.acquired) await lock.release();
  });
});
