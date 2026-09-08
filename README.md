# Markdown → Word

Convertisseur Markdown vers `.docx`, écrit en TypeScript. Trois usages sur le
même cœur de conversion :

- **automatique** : un `.md` téléchargé, ou du Markdown copié, devient un
  document Word sans aucune manipulation ;
- **une application web** : on dépose un fichier `.md` (ou on colle du Markdown),
  on récupère un document Word ;
- **une CLI** : conversion unitaire ou par lot, utilisable en script.

Le traitement est **entièrement local**. Aucun document n'est envoyé sur un
serveur : l'application web tourne dans le navigateur, sans backend.

---

## Démarrage

```bash
npm install
npm run dev      # application web sur http://localhost:5173
```

| Commande                   | Effet                                              |
| -------------------------- | -------------------------------------------------- |
| `npm run watch`            | Surveille les téléchargements et convertit          |
| `npm run clip`             | Convertit le presse-papiers                         |
| `npm run auto:installer`   | Installe l'automatisation dans Windows              |
| `npm run auto:desinstaller`| La retire                                           |
| `npm run build`            | Build de production dans `dist/`                    |
| `npm run preview`          | Sert le build de production                         |
| `npm run typecheck`        | Vérification des types, sans émission               |
| `npm test`                 | Suite de tests (vitest)                             |
| `npm run convert`          | Conversion en ligne de commande                     |

---

## Mode automatique

L'objectif : supprimer le copier-coller. On récupère du Markdown depuis une
conversation, et le document Word apparaît.

### Installation

```bash
npm run auto:installer
```

Deux raccourcis sont créés — sans droits administrateur, sans écriture dans la
base de registre :

| Raccourci                       | Emplacement    | Effet                                    |
| ------------------------------- | -------------- | ---------------------------------------- |
| `Markdown vers Word (presse-papiers)` | Menu Démarrer | Touche **Ctrl+Alt+W**                |
| `Markdown vers Word (surveillance)`   | Démarrage     | Service lancé à l'ouverture de session |

`npm run auto:desinstaller` les retire. Un service déjà lancé continue jusqu'à
la fermeture de session.

### Les deux déclencheurs

**1. Un fichier téléchargé.** Dès qu'un `.md` arrive dans le dossier
*Téléchargements*, il est converti et le document s'ouvre. Le fichier source
reste en place : rien n'est déplacé ni supprimé.

**2. Du Markdown copié.** On copie le texte (`Ctrl+C`), on presse
**`Ctrl+Alt+W`**. C'est le cas le plus fréquent : une conversation propose bien
plus souvent un bouton *Copier* qu'un vrai téléchargement.

Dans les deux cas, le `.docx` est écrit dans `Documents\Markdown en Word\` et
ouvert dans Word.

### Nommage des documents

Le nom vient du **contenu**, pas du fichier source — un export s'appelle souvent
`document.md`, ce qui ne dit rien. L'ordre de préférence est : titre du front
matter, puis premier titre de niveau 1, puis nom du fichier source.

Un homonyme n'écrase jamais un document existant : `Rapport.docx`, puis
`Rapport (2).docx`.

### Options

Utilisables avec `npm run watch` comme avec `npm run clip` :

| Option                  | Effet                                                     |
| ----------------------- | --------------------------------------------------------- |
| `--dir <dossier>`       | Dossier surveillé (répétable). Défaut : *Téléchargements*  |
| `--out <dossier>`       | Dossier de sortie                                          |
| `--toc`                 | Table des matières cliquable                               |
| `--no-header`           | Supprime l'en-tête et le pied de page                      |
| `--no-open`             | N'ouvre pas le document une fois créé                      |
| `--allow-remote-images` | Autorise le téléchargement des images distantes            |
| `--backfill`            | Traite aussi les fichiers déjà présents au démarrage       |
| `--log <fichier>`       | Journal persistant                                         |

Lancé par les raccourcis, le service journalise dans
`%LOCALAPPDATA%\md2docx\watch.log` et `clip.log`.

### Ce que le mode automatique traite en plus

Un fichier surveillé n'a pas été relu par un humain avant conversion. Trois
garde-fous en découlent, décrits dans la section *Sécurité*.

Deux détails d'implémentation méritent d'être connus :

- **Fichier en cours d'écriture.** Un navigateur crée l'entrée avant d'avoir fini
  d'écrire. Le service attend que la taille cesse de varier, et ignore les
  extensions temporaires (`.crdownload`, `.part`, `.tmp`…).
- **Instance unique.** Un verrou empêche deux surveillances simultanées, qui
  produiraient deux documents pour un seul téléchargement.

---

## Ligne de commande

```bash
npm run convert -- examples/exemple.md
npm run convert -- docs/*.md --out build --toc --header --author "Direction technique"
```

| Option            | Effet                                                     |
| ----------------- | --------------------------------------------------------- |
| `--out <dossier>` | Dossier de sortie (défaut : à côté du fichier source)      |
| `--toc`           | Insère une table des matières (titres 1 à 3)               |
| `--header`        | En-tête (titre du document) + pied de page (pagination)    |
| `--title <texte>` | Force le titre du document                                 |
| `--author <texte>`| Renseigne la propriété « Auteur » du fichier Word          |

---

## Ce qui est converti

| Markdown                        | Résultat dans Word                                             |
| ------------------------------- | -------------------------------------------------------------- |
| `#` … `######`                  | Styles natifs **Titre 1 à 6** — volet Navigation et TOC fonctionnels |
| `**gras**`, `_italique_`, `~~barré~~` | Mise en forme correspondante                             |
| `` `code` ``                    | Style de caractère dédié (`MdInlineCode`)                       |
| Blocs ` ``` `                   | Paragraphes monospace ombrés, indentation préservée             |
| Listes à puces / numérotées     | Numérotation Word réelle, jusqu'à 5 niveaux d'imbrication       |
| `1.` démarrant à *n*            | Numérotation Word démarrant au même rang                        |
| `- [x]` / `- [ ]`               | Cases cochées / décochées                                       |
| `>` (imbriquées comprises)      | Style citation : filet gauche, retrait, texte atténué           |
| Tableaux GFM                    | Tableau Word, alignements respectés, en-tête répété par page    |
| `[texte](url)`, `[texte][ref]`  | Hyperliens cliquables                                           |
| `![alt](image)`                 | Image intégrée, redimensionnée à la largeur utile               |
| `[^1]`                          | Vraies notes de bas de page                                     |
| `---`                           | Séparateur horizontal                                           |
| Front matter YAML               | Propriétés du document (titre, auteur, sujet, mots-clés)        |

Le document produit est en **A4, marges de 25 mm**.

---

## Architecture

```
src/
├── core/types.ts          Contrats partagés (options, images, erreurs)
├── markdown/
│   ├── parse.ts           Markdown → AST mdast (remark + GFM + front matter)
│   ├── frontmatter.ts     Lecture des métadonnées de tête
│   └── inspect.ts         Pré-passage : définitions, notes, images, statistiques
├── docx/
│   ├── styles.ts          Styles Word, numérotations, géométrie de page
│   ├── context.ts         Contexte de rendu et registre de numérotation
│   ├── blocks.ts          Rendu des blocs (titres, listes, code, citations…)
│   ├── inlines.ts         Rendu du texte enrichi (+ filtrage des URL)
│   ├── tables.ts          Rendu des tableaux
│   └── document.ts        Assemblage du document, en-têtes, notes, TOC
├── automation/
│   ├── config.ts          Réglages et emplacements par défaut
│   ├── policy.ts          Règles appliquées sans supervision humaine
│   ├── watcher.ts         Détection des fichiers réellement terminés d'écrire
│   ├── pipeline.ts        Conversion, nommage, écriture sans écrasement
│   ├── clipboard.ts       Lecture du presse-papiers
│   ├── clipboard-read.js  Script compagnon (hôte de scripts Windows)
│   ├── lock.ts            Verrou d'instance unique
│   ├── logger.ts          Journal console + fichier, avec rotation
│   ├── open.ts            Ouverture dans l'application associée
│   ├── cli.ts             Options communes aux deux modes
│   └── report.ts          Restitution des résultats et avertissements
├── images/detect.ts       Détection de format et lecture des dimensions
├── browser/               Chargement d'images et téléchargement (navigateur)
├── node/                  Chargement d'images depuis le disque (CLI)
└── ui/                    Interface web

scripts/
├── convert.ts             CLI de conversion
├── watch.ts               Service de surveillance
└── clip.ts                Conversion du presse-papiers

tools/                     Intégration Windows (raccourcis, lanceur silencieux)
```

Le point structurant : **le cœur (`markdown/` + `docx/`) ne touche à aucune API
navigateur ni système de fichiers**. Le chargement des images passe par
l'interface `ImageResolver`, fournie par l'appelant. C'est ce qui permet
d'exécuter le même pipeline dans le navigateur, en CLI, en automatique et dans
les tests.

Second point : les images sont résolues **avant** le rendu, en un seul passage
concurrent. Tout le rendu est donc synchrone, donc simple à lire et à tester.

---

## Limites connues

- **Images en chemin relatif dans l'application web** : `![x](./img.png)` ne peut
  pas être résolu — le navigateur n'a pas accès au dossier du fichier déposé.
  Utilisez la CLI, une URL absolue ou une data-URI. Un avertissement le signale.
- **Images distantes** : récupérables uniquement si le serveur autorise le CORS.
  En mode automatique, elles sont bloquées par défaut (voir *Sécurité*).
- **SVG et WebP** : rastérisés en PNG dans le navigateur ; non pris en charge en
  CLI ni en automatique (aucun moteur de rendu disponible).
- **HTML brut** : les balises sont retirées, le texte est conservé. Un
  avertissement le signale.
- **Front matter** : seules les paires `clé: valeur` de premier niveau sont lues.
- **Table des matières** : Word demande de mettre à jour les champs à l'ouverture
  (le drapeau `updateFields` est positionné pour déclencher la demande).
- **Coloration syntaxique** : non appliquée aux blocs de code, volontairement —
  elle rendrait le document lourd et difficile à restyler.
- **Raccourci clavier** : Windows n'active la touche d'un raccourci que depuis le
  menu Démarrer ou le bureau. L'installateur place donc le raccourci dans le menu
  Démarrer. Comptez un court délai avant le déclenchement.
- **Hôte de scripts Windows** : la lecture du presse-papiers et les raccourcis
  reposent sur `cscript`/`wscript`. PowerShell a été écarté après constat de son
  indisponibilité sur le poste cible (arrêt immédiat, code `0xC0000409`).
- **Fichier déjà présent** : au démarrage, le service ignore les fichiers
  antérieurs, pour ne pas ouvrir d'un coup tout l'historique. `--backfill` lève
  cette réserve.

---

## Sécurité

Le Markdown converti n'est pas nécessairement de confiance. En conséquence :

- les URL de liens sont filtrées par protocole (`javascript:`, `file:`… sont
  neutralisés) avant d'être écrites dans les relations du `.docx` ;
- le HTML brut n'est jamais interprété, seul son texte est repris ;
- l'interface n'écrit jamais de contenu utilisateur via `innerHTML` ;
- les images sont plafonnées en taille et le chargement est borné par un délai.

### Le mode automatique va plus loin

En mode manuel, l'utilisateur choisit et relit ce qu'il convertit. En mode
automatique, **tout `.md` déposé dans le dossier surveillé est traité**, quelle
qu'en soit la provenance. La frontière de confiance n'est plus la même :

| Vecteur                              | Traitement                                          |
| ------------------------------------ | --------------------------------------------------- |
| `![](https://tiers/pixel.png)`       | Aucune requête sortante sans `--allow-remote-images` |
| `![](file:///C:/…)`, `![](/etc/…)`   | Refusé                                               |
| `![](../../prive.png)`               | Refusé : lecture confinée au dossier du fichier source |
| Fichier de plusieurs centaines de Mo | Refusé au-delà de 5 Mo                               |
| Presse-papiers                       | Aucun accès disque : la source n'a pas d'emplacement |

Les images écartées sont **signalées dans le journal**, jamais silencieusement
ignorées.
