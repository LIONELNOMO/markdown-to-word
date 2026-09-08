import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";

export type LockResult =
  | { readonly acquired: true; readonly release: () => Promise<void> }
  | { readonly acquired: false; readonly holderPid: number | null };

/**
 * Verrou d'instance unique.
 *
 * Le service peut être lancé de deux façons (démarrage de session et lancement
 * manuel) : sans ce garde-fou, deux surveillants observeraient le même dossier
 * et produiraient deux documents pour un seul téléchargement.
 *
 * Un verrou laissé par un processus mort — arrêt brutal, redémarrage — est
 * détecté et repris, sinon le service deviendrait impossible à relancer.
 */
export async function acquireSingleInstanceLock(lockPath: string): Promise<LockResult> {
  await mkdir(dirname(lockPath), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      // `wx` échoue si le fichier existe : la création est atomique, donc
      // exempte de course entre deux démarrages simultanés.
      const handle = await open(lockPath, "wx");
      try {
        await handle.writeFile(String(process.pid), "utf8");
      } finally {
        await handle.close();
      }
      return {
        acquired: true,
        release: async () => {
          await unlink(lockPath).catch(() => undefined);
        },
      };
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;

      const holder = await readHolderPid(lockPath);
      if (holder !== null && isProcessAlive(holder)) {
        return { acquired: false, holderPid: holder };
      }

      // Verrou orphelin : on le retire et on retente une seule fois.
      await unlink(lockPath).catch(() => undefined);
    }
  }

  return { acquired: false, holderPid: null };
}

async function readHolderPid(lockPath: string): Promise<number | null> {
  const raw = await readFile(lockPath, "utf8").catch(() => null);
  if (raw === null) return null;
  const pid = Number.parseInt(raw.trim(), 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function isProcessAlive(pid: number): boolean {
  try {
    // Le signal 0 ne fait rien : il ne sert qu'à tester l'existence du processus.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // `EPERM` : le processus existe mais appartient à un autre utilisateur.
    return hasCode(error, "EPERM");
  }
}

function isAlreadyExists(error: unknown): boolean {
  return hasCode(error, "EEXIST");
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === code;
}
