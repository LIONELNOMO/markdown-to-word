import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";

/** Au-delà, le journal est archivé : un service permanent ne doit rien laisser croître sans fin. */
const MAX_LOG_BYTES = 1024 * 1024;

type Level = "info" | "ok" | "warn" | "error";

const MARKS: Record<Level, string> = { info: "·", ok: "✓", warn: "⚠", error: "✗" };

/**
 * Journal du service.
 *
 * Écrit toujours sur la console — utile quand le service tourne dans un
 * terminal — et, si un fichier est configuré, l'y recopie : sans fenêtre
 * visible, c'est la seule trace exploitable en cas de problème.
 */
export class Logger {
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string | null) {}

  info(message: string): void {
    this.write("info", message);
  }

  ok(message: string): void {
    this.write("ok", message);
  }

  warn(message: string): void {
    this.write("warn", message);
  }

  error(message: string, cause?: unknown): void {
    const detail = describe(cause);
    this.write("error", detail === null ? message : `${message} : ${detail}`);
  }

  /** Garantit que tout est écrit avant l'arrêt du processus. */
  async flush(): Promise<void> {
    await this.pending.catch(() => undefined);
  }

  private write(level: Level, message: string): void {
    const line = `${timestamp()} ${MARKS[level]} ${message}`;

    if (level === "error") console.error(line);
    else console.log(line);

    if (this.filePath === null) return;
    // Les écritures sont enchaînées : deux lignes ne doivent pas s'entremêler.
    this.pending = this.pending.then(() => this.appendLine(this.filePath as string, line));
  }

  private async appendLine(filePath: string, line: string): Promise<void> {
    try {
      await mkdir(dirname(filePath), { recursive: true });
      await this.rotateIfNeeded(filePath);
      await appendFile(filePath, `${line}\n`, "utf8");
    } catch {
      // Un journal indisponible ne doit jamais interrompre une conversion.
    }
  }

  private async rotateIfNeeded(filePath: string): Promise<void> {
    const info = await stat(filePath).catch(() => null);
    if (info === null || info.size < MAX_LOG_BYTES) return;
    await rename(filePath, `${filePath}.1`).catch(() => undefined);
  }
}

function timestamp(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function describe(cause: unknown): string | null {
  if (cause === undefined || cause === null) return null;
  return cause instanceof Error ? cause.message : String(cause);
}
