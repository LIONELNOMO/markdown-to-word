/**
 * Service worker de l'application.
 *
 * Il rend l'application installable et utilisable hors ligne. C'est cohérent
 * avec ce qu'elle est : la conversion est entièrement locale, rien n'a jamais
 * besoin du réseau une fois le code chargé.
 *
 * Deux stratégies, choisies selon ce que la ressource garantit :
 *
 *  - **la page** est servie par le réseau d'abord. Sans cela, un nouveau
 *    déploiement resterait invisible tant que le cache n'expire pas. Le cache
 *    ne sert que de secours, hors ligne.
 *  - **les ressources horodatées** (`/assets/index-<hash>.js`) sont servies par
 *    le cache d'abord : leur nom change à chaque contenu, elles ne peuvent donc
 *    pas être périmées.
 */

const CACHE = "md2docx-v1";

/** Ce qui permet à l'application de démarrer sans réseau dès la première visite. */
const SOCLE = ["./", "./manifest.webmanifest", "./icone-192.png", "./icone-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Une ressource manquante ne doit pas faire échouer toute l'installation.
      await Promise.allSettled(SOCLE.map((url) => cache.add(url)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Les caches des versions précédentes n'ont plus de raison d'exister.
      const noms = await caches.keys();
      await Promise.all(noms.filter((nom) => nom !== CACHE).map((nom) => caches.delete(nom)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const requete = event.request;

  // On ne se mêle ni des écritures ni des autres domaines.
  if (requete.method !== "GET") return;
  if (new URL(requete.url).origin !== self.location.origin) return;

  event.respondWith(requete.mode === "navigate" ? reseauDAbord(requete) : cacheDAbord(requete));
});

async function reseauDAbord(requete) {
  const cache = await caches.open(CACHE);

  try {
    const reponse = await fetch(requete);
    if (reponse.ok) await cache.put(requete, reponse.clone());
    return reponse;
  } catch (erreur) {
    // Hors ligne : la dernière page connue, sinon la racine.
    const enCache = (await cache.match(requete)) ?? (await cache.match("./"));
    if (enCache) return enCache;
    throw erreur;
  }
}

async function cacheDAbord(requete) {
  const cache = await caches.open(CACHE);

  const enCache = await cache.match(requete);
  if (enCache) return enCache;

  const reponse = await fetch(requete);
  // Les réponses opaques et les erreurs ne sont pas mises en cache : elles
  // rendraient la ressource définitivement cassée.
  if (reponse.ok && reponse.type === "basic") await cache.put(requete, reponse.clone());
  return reponse;
}
