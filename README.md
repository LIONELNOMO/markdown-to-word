# Markdown → Word

Convertisseur Markdown vers `.docx`, écrit en TypeScript. Deux usages sur le même
cœur de conversion :

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

Autres commandes :

| Commande            | Effet                                                 |
| ------------------- | ----------------------------------------------------- |
| `npm run build`     | Build de production dans `dist/`                       |
| `npm run preview`   | Sert le build de production                            |
| `npm run typecheck` | Vérification des types, sans émission                  |
| `npm test`          | Suite de tests (vitest)                                |
| `npm run convert`   | Conversion en ligne de commande                        |

### Ligne de commande

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
├── images/detect.ts       Détection de format et lecture des dimensions
├── browser/               Chargement d'images et téléchargement (navigateur)
├── node/                  Chargement d'images depuis le disque (CLI)
└── ui/                    Interface web
```

Le point structurant : **le cœur (`markdown/` + `docx/`) ne touche à aucune API
navigateur ni système de fichiers**. Le chargement des images passe par
l'interface `ImageResolver`, fournie par l'appelant. C'est ce qui permet
d'exécuter le même pipeline dans le navigateur, en CLI et dans les tests.

Second point : les images sont résolues **avant** le rendu, en un seul passage
concurrent. Tout le rendu est donc synchrone, donc simple à lire et à tester.

---

## Limites connues

- **Images en chemin relatif dans l'application web** : `![x](./img.png)` ne peut
  pas être résolu — le navigateur n'a pas accès au dossier du fichier déposé.
  Utilisez la CLI, une URL absolue ou une data-URI. Un avertissement le signale.
- **Images distantes** : récupérables uniquement si le serveur autorise le CORS.
- **SVG et WebP** : rastérisés en PNG dans le navigateur ; non pris en charge en
  CLI (aucun moteur de rendu disponible).
- **HTML brut** : les balises sont retirées, le texte est conservé. Un
  avertissement le signale.
- **Front matter** : seules les paires `clé: valeur` de premier niveau sont lues.
- **Table des matières** : Word demande de mettre à jour les champs à l'ouverture
  (le drapeau `updateFields` est positionné pour déclencher la demande).
- **Coloration syntaxique** : non appliquée aux blocs de code, volontairement —
  elle rendrait le document lourd et difficile à restyler.

## Sécurité

Le Markdown converti n'est pas nécessairement de confiance. En conséquence :

- les URL de liens sont filtrées par protocole (`javascript:`, `file:`… sont
  neutralisés) avant d'être écrites dans les relations du `.docx` ;
- le HTML brut n'est jamais interprété, seul son texte est repris ;
- l'interface n'écrit jamais de contenu utilisateur via `innerHTML` ;
- les images sont plafonnées en taille et le chargement est borné par un délai.
