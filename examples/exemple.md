---
title: Rapport d'activité
author: Direction technique
subject: Synthèse trimestrielle
keywords: rapport, activité, synthèse
---

# Rapport d'activité

Ce document sert d'exemple : il utilise l'ensemble des éléments Markdown pris en
charge par le convertisseur. Le texte peut être **en gras**, _en italique_,
~~barré~~, contenir du `code en ligne` ou un [lien externe](https://example.com).

## Faits marquants

1. Mise en production de la nouvelle chaîne de traitement
2. Réduction du délai moyen de traitement
   1. Phase de collecte automatisée
   2. Contrôles fusionnés en une seule passe
3. Ouverture du portail partenaires

### Points de vigilance

- Charge d'infrastructure en hausse
  - pics constatés en fin de mois
  - marge de capacité estimée à 30 %
- Dette technique sur le module de facturation

### Actions

- [x] Audit de sécurité réalisé
- [ ] Migration de la base de données
- [ ] Reprise de la documentation utilisateur

## Indicateurs

| Indicateur              | Cible |   Réel | Écart |
| ----------------------- | ----: | -----: | :---: |
| Délai moyen (jours)     |   5,0 |    4,2 |   ✓   |
| Taux de disponibilité   | 99,5 % | 99,8 % |   ✓   |
| Coût par dossier (€)    |  12,0 |   14,5 |   ✗   |

## Extrait de configuration

```yaml
pipeline:
  concurrence: 6
  delai_max_ms: 10000
  formats:
    - png
    - jpeg
```

## Citation

> La qualité n'est jamais un accident ; elle est toujours le résultat
> d'un effort intelligent.
>
> > Remarque imbriquée sur un second niveau.

## Illustration

![Vignette de démonstration](vignette.png)

## Note

Le délai de traitement est mesuré de bout en bout[^mesure].

---

[^mesure]: De la réception du dossier à sa clôture, jours ouvrés uniquement.
