import { watch, type FSWatcher } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export interface DetectedFile {
  readonly path: string;
  readonly size: number;
  readonly mtimeMs: number;
  /**
   * Instant où le fichier est apparu dans le dossier.
   *
   * Ce n’est pas toujours `mtimeMs` : un navigateur écrit `x.md.crdownload`
   * puis le *renomme*, et un renommage ne modifie pas la date de modification.
   * Un fichier copié depuis ailleurs conserve lui aussi sa date d’origine.
   * On retient donc la plus récente des trois dates du système de fichiers.
   */
  readonly arrivedAtMs: number;
}

export interface FolderWatcherOptions {
  readonly directory: string;
  readonly accept: (fileName: string) => boolean;
  readonly onFile: (file: DetectedFile) => Promise<void>;
  readonly onError: (error: unknown, path?: string) => void;
  /** Les fichiers modifiés avant cet instant (epoch ms) sont ignorés. */
  readonly since: number;
  /** Intervalle entre deux mesures de taille. */
  readonly stabilityMs?: number;
  /** Nombre de mesures identiques consécutives exigées. */
  readonly stableReadings?: number;
  /** Au-delà, on renonce : le fichier n'arrête pas de grossir. */
  readonly settleTimeoutMs?: number;
  /** Relecture périodique du dossier, filet de sécurité des événements perdus. */
  readonly reconcileMs?: number;
}

const DEFAULT_STABILITY_MS = 250;
const DEFAULT_STABLE_READINGS = 2;
const DEFAULT_SETTLE_TIMEOUT_MS = 30_000;
const DEFAULT_RECONCILE_MS = 10_000;

/**
 * Surveille un dossier et signale les fichiers acceptés, une fois leur écriture
 * terminée.
 *
 * Deux difficultés que ce composant existe pour résoudre :
 *
 *  1. **Le fichier à moitié écrit.** Le système crée l'entrée avant que le
 *     contenu ne soit complet ; lire immédiatement donne un fichier vide ou
 *     tronqué. On n'agit qu'après plusieurs mesures de taille identiques.
 *
 *  2. **Les événements perdus.** `fs.watch` s'appuie sur des notifications du
 *     système qui peuvent être manquées (charge, dossier réseau, mise en veille).
 *     Une relecture périodique du dossier rattrape ces oublis.
 *
 * Les conversions sont sérialisées : deux téléchargements simultanés ne doivent
 * pas déclencher deux rendus concurrents ni ouvrir deux fenêtres en même temps.
 */
export class FolderWatcher {
  private watcher: FSWatcher | null = null;
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private readonly inFlight = new Set<string>();
  /** Chemin → signature (taille:mtime) du dernier traitement réussi. */
  private readonly processed = new Map<string, string>();
  private stopped = false;

  constructor(private readonly options: FolderWatcherOptions) {}

  async start(): Promise<void> {
    // Un premier passage complet : `fs.watch` ne rapporte que les changements
    // survenus après son installation.
    await this.reconcile();

    this.watcher = watch(this.options.directory, { persistent: true }, (_event, fileName) => {
      if (fileName === null || fileName === undefined) {
        // Nom non communiqué par le système : on relit tout le dossier.
        void this.reconcile();
        return;
      }
      this.consider(fileName.toString());
    });

    this.watcher.on("error", (error) => this.options.onError(error));

    this.reconcileTimer = setInterval(() => {
      void this.reconcile();
    }, this.options.reconcileMs ?? DEFAULT_RECONCILE_MS);
  }

  /** Attend la fin des conversions en cours avant de rendre la main. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconcileTimer !== null) clearInterval(this.reconcileTimer);
    this.reconcileTimer = null;
    this.watcher?.close();
    this.watcher = null;
    await this.queue.catch(() => undefined);
  }

  /** Vide la file d'attente : utilisé par les tests pour observer un résultat. */
  async drain(): Promise<void> {
    // Deux tours : le traitement d'un fichier peut en enfiler un autre.
    await this.queue.catch(() => undefined);
    await this.queue.catch(() => undefined);
  }

  private async reconcile(): Promise<void> {
    if (this.stopped) return;

    const entries = await readdir(this.options.directory).catch((error: unknown) => {
      this.options.onError(error);
      return null;
    });
    if (entries === null) return;

    for (const entry of entries) this.consider(entry);
  }

  private consider(fileName: string): void {
    if (this.stopped) return;
    if (!this.options.accept(fileName)) return;

    const path = join(this.options.directory, fileName);
    // Déjà en file ou en cours : les événements suivants sont du bruit.
    if (this.inFlight.has(path)) return;

    this.inFlight.add(path);
    this.queue = this.queue.then(() => this.process(path));
  }

  private async process(path: string): Promise<void> {
    try {
      const file = await this.settle(path);
      if (file === null) return;
      if (file.arrivedAtMs < this.options.since) return;

      // Un fichier réécrit (nouvelle version téléchargée) est reconverti ;
      // un fichier inchangé ne l'est jamais deux fois.
      const signature = `${file.size}:${file.mtimeMs}`;
      if (this.processed.get(path) === signature) return;
      this.processed.set(path, signature);

      await this.options.onFile(file);
    } catch (error) {
      // Un fichier défectueux ne doit jamais arrêter le service.
      this.options.onError(error, path);
    } finally {
      this.inFlight.delete(path);
    }
  }

  /** Attend que la taille du fichier cesse de changer. */
  private async settle(path: string): Promise<DetectedFile | null> {
    const intervalMs = this.options.stabilityMs ?? DEFAULT_STABILITY_MS;
    const required = this.options.stableReadings ?? DEFAULT_STABLE_READINGS;
    const deadline = Date.now() + (this.options.settleTimeoutMs ?? DEFAULT_SETTLE_TIMEOUT_MS);

    let previousSize = -1;
    let stable = 0;

    while (Date.now() < deadline) {
      const info = await stat(path).catch(() => null);
      // Disparu ou renommé entre-temps : c'est le cas normal du fichier
      // temporaire d'un navigateur, pas une erreur.
      if (info === null || !info.isFile()) return null;

      if (info.size > 0 && info.size === previousSize) {
        stable += 1;
        if (stable >= required) {
          return {
            path,
            size: info.size,
            mtimeMs: info.mtimeMs,
            arrivedAtMs: Math.max(info.mtimeMs, info.ctimeMs, info.birthtimeMs),
          };
        }
      } else {
        stable = 0;
      }

      previousSize = info.size;
      await delay(intervalMs);
    }

    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
