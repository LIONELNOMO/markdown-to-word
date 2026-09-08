/**
 * Génère les icônes PNG du manifeste PWA.
 *
 *   node tools/generer-icones.mjs
 *
 * Aucune dépendance : l'encodeur PNG et le rastériseur tiennent ici. C'est
 * volontaire — ajouter une bibliothèque graphique complète pour trois images
 * générées une fois serait disproportionné, et les icônes doivent rester
 * reproductibles sans outil externe.
 *
 * Le rendu est suréchantillonné puis moyenné : c'est ce qui donne des bords
 * nets sans écrire de code d'anticrénelage.
 */
import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const SORTIE = join(RACINE, "public");

/** Charte de l'application : le bleu des titres Word. */
const FOND = [0x2f, 0x54, 0x96];
const PAPIER = [0xff, 0xff, 0xff];
const PLI = [0xc5, 0xd2, 0xe9];
const TITRE = [0x2f, 0x54, 0x96];
const TEXTE = [0x9f, 0xb4, 0xdc];

const SUR_ECHANTILLONNAGE = 4;

// --- Formes -----------------------------------------------------------------

const rectangleArrondi = (x0, y0, x1, y1, rayon) => (x, y) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;

  const dx = x < x0 + rayon ? x0 + rayon - x : x > x1 - rayon ? x - (x1 - rayon) : 0;
  const dy = y < y0 + rayon ? y0 + rayon - y : y > y1 - rayon ? y - (y1 - rayon) : 0;
  return dx * dx + dy * dy <= rayon * rayon;
};

const polygone = (sommets) => (x, y) => {
  let dedans = false;
  for (let i = 0, j = sommets.length - 1; i < sommets.length; j = i++) {
    const [xi, yi] = sommets[i];
    const [xj, yj] = sommets[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dedans = !dedans;
  }
  return dedans;
};

/**
 * Composition de l'icône, en coordonnees normalisees (0 a 1).
 * `echelle` retrecit le contenu pour la variante « maskable », dont les bords
 * peuvent etre rognes par le systeme.
 */
function composer(echelle) {
  const c = (v) => 0.5 + (v - 0.5) * echelle;
  const p = ([x, y]) => [c(x), c(y)];

  return [
    // Feuille, coin superieur droit coupe.
    {
      test: polygone(
        [
          [0.26, 0.15],
          [0.6, 0.15],
          [0.75, 0.3],
          [0.75, 0.85],
          [0.26, 0.85],
        ].map(p),
      ),
      couleur: PAPIER,
    },
    // Le pli du coin.
    {
      test: polygone(
        [
          [0.6, 0.15],
          [0.75, 0.3],
          [0.6, 0.3],
        ].map(p),
      ),
      couleur: PLI,
    },
    // Un titre, puis deux lignes de texte : ce que l'application produit.
    { test: rectangleArrondi(c(0.34), c(0.39), c(0.67), c(0.465), 0.014 * echelle), couleur: TITRE },
    { test: rectangleArrondi(c(0.34), c(0.53), c(0.67), c(0.575), 0.012 * echelle), couleur: TEXTE },
    { test: rectangleArrondi(c(0.34), c(0.63), c(0.58), c(0.675), 0.012 * echelle), couleur: TEXTE },
  ];
}

// --- Rendu ------------------------------------------------------------------

function dessiner(taille, { rayonFond, echelle }) {
  const calques = composer(echelle);
  const pixels = Buffer.alloc(taille * taille * 4);
  const fondArrondi = rectangleArrondi(0, 0, 1, 1, rayonFond);
  const pas = 1 / (taille * SUR_ECHANTILLONNAGE);

  for (let ligne = 0; ligne < taille; ligne += 1) {
    for (let colonne = 0; colonne < taille; colonne += 1) {
      let r = 0;
      let v = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SUR_ECHANTILLONNAGE; sy += 1) {
        for (let sx = 0; sx < SUR_ECHANTILLONNAGE; sx += 1) {
          const x = (colonne * SUR_ECHANTILLONNAGE + sx + 0.5) * pas;
          const y = (ligne * SUR_ECHANTILLONNAGE + sy + 0.5) * pas;

          if (!fondArrondi(x, y)) continue;

          // Peintre : le dernier calque contenant le point l'emporte.
          let couleur = FOND;
          for (const calque of calques) if (calque.test(x, y)) couleur = calque.couleur;

          r += couleur[0];
          v += couleur[1];
          b += couleur[2];
          a += 255;
        }
      }

      const total = SUR_ECHANTILLONNAGE * SUR_ECHANTILLONNAGE;
      const index = (ligne * taille + colonne) * 4;
      // Les composantes sont premultipliees par la couverture : on les ramene
      // a leur valeur pleine, sans quoi les bords tireraient vers le noir.
      pixels[index] = a === 0 ? 0 : Math.round(r / (a / 255));
      pixels[index + 1] = a === 0 ? 0 : Math.round(v / (a / 255));
      pixels[index + 2] = a === 0 ? 0 : Math.round(b / (a / 255));
      pixels[index + 3] = Math.round(a / total);
    }
  }

  return pixels;
}

// --- Encodage PNG -----------------------------------------------------------

const TABLE_CRC = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const octet of buffer) c = TABLE_CRC[(c ^ octet) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function bloc(type, donnees) {
  const longueur = Buffer.alloc(4);
  longueur.writeUInt32BE(donnees.length);

  const corps = Buffer.concat([Buffer.from(type, "latin1"), donnees]);
  const controle = Buffer.alloc(4);
  controle.writeUInt32BE(crc32(corps));

  return Buffer.concat([longueur, corps, controle]);
}

function encoderPng(pixels, taille) {
  const entete = Buffer.alloc(13);
  entete.writeUInt32BE(taille, 0);
  entete.writeUInt32BE(taille, 4);
  entete[8] = 8; // 8 bits par composante
  entete[9] = 6; // RVB + alpha
  // Compression, filtrage et entrelacement : valeurs standard (0).

  // Chaque ligne est precedee de son octet de filtre.
  const brut = Buffer.alloc(taille * (taille * 4 + 1));
  for (let ligne = 0; ligne < taille; ligne += 1) {
    const source = ligne * taille * 4;
    const cible = ligne * (taille * 4 + 1);
    brut[cible] = 0;
    pixels.copy(brut, cible + 1, source, source + taille * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloc("IHDR", entete),
    bloc("IDAT", deflateSync(brut, { level: 9 })),
    bloc("IEND", Buffer.alloc(0)),
  ]);
}

// --- Production -------------------------------------------------------------

const ICONES = [
  { nom: "icone-192.png", taille: 192, rayonFond: 0.22, echelle: 1 },
  { nom: "icone-512.png", taille: 512, rayonFond: 0.22, echelle: 1 },
  // « Maskable » : le systeme rogne les bords, le contenu doit rester au centre.
  { nom: "icone-maskable-512.png", taille: 512, rayonFond: 0, echelle: 0.68 },
];

await mkdir(SORTIE, { recursive: true });

for (const { nom, taille, rayonFond, echelle } of ICONES) {
  const png = encoderPng(dessiner(taille, { rayonFond, echelle }), taille);
  await writeFile(join(SORTIE, nom), png);
  console.log(`${nom.padEnd(26)} ${taille}x${taille}  ${(png.length / 1024).toFixed(1)} Ko`);
}
