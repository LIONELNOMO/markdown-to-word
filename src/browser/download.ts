/**
 * Déclenche le téléchargement d'un fichier produit dans le navigateur.
 *
 * Isolé de la conversion Word : la page de présentation s'en sert aussi, et
 * l'importer depuis `convert.ts` embarquerait toute la chaîne `docx` dans un
 * paquet qui n'en a aucun usage.
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  // L'URL objet est révoquée au tour de boucle suivant : la révoquer
  // immédiatement annulerait le téléchargement sur Firefox.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
