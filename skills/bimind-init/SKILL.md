---
name: bimind-init
description: Créer ou mettre à jour la mémoire partagée Bimind d'un projet (.bimind/contexte.md et .bimind/decisions.md), que Gemini reçoit automatiquement à chaque consultation et qui évite de réexpliquer le projet. À utiliser quand l'utilisateur tape /bimind-init, et avant une relecture, un audit ou une fonctionnalité Bimind sur un projet sans fichier .bimind/contexte.md.
argument-hint: [dossier du code — défaut : racine du projet]
---

# Mémoire partagée Bimind

But : une fiche **courte** (150 lignes max) et **vérifiée**, lue par Gemini à chaque appel et par toi au début
de chaque commande Bimind. Elle économise les tokens des deux côtés : personne ne réexplique le projet.

Pont : `node "{{BIMIND}}"`. Dossier visé : $ARGUMENTS (vide = racine du projet).

1. **Gemini cartographie** (arrière-plan, modèle rapide) :
   `node "{{BIMIND}}" --role cartographe --sans-contexte -d <dossier> -o .bimind/out/carte.md "Cartographie ce projet."`
   Gros projet : le pont copie les fichiers dans l'espace de travail de Gemini, qui lit tout en un appel (2 à 5 min).
   Lis les lignes « Bimind : » en tête de la carte : des fichiers « PAS ouverts » ou « NON transmis » n'ont pas été
   lus, relance sur eux (`-d` du sous-dossier) si leur contenu compte.
2. **Toi, en parallèle** : lis les fichiers de référence — README, manifeste (package.json, pyproject.toml, *.csproj…),
   configuration principale, points d'entrée. Pas tout le code : c'est le travail de Gemini.
3. **Confronte** la carte avec ce que tu as lu. Vérifie dans le code toute affirmation douteuse ; les chemins
   cités doivent exister. Corrige la carte plutôt que de la recopier.
4. **Écris `.bimind/contexte.md`** (s'il existe : mets-le à jour, ne l'écrase pas) avec ces sections :
   But · Stack · Architecture (modules et rôle) · Points d'entrée · Données et frontières de confiance ·
   Conventions · Commandes (installation, build, tests, lancement) · Zones sensibles.
5. **Crée `.bimind/decisions.md`** s'il n'existe pas : titre `# Décisions` et une ligne expliquant le format
   (`## AAAA-MM-JJ — titre`, puis Contexte, Décision, Raison, Alternatives écartées). Ajoute les décisions
   d'architecture déjà visibles dans le code si elles sont nettes.
6. Dépôt git : ajoute `.bimind/journal/` et `.bimind/out/` au `.gitignore` (contexte.md et decisions.md, eux,
   se commitent : c'est la mémoire de l'équipe).
7. Résume à l'utilisateur ce que contient la mémoire et ce que Gemini a apporté ou que tu as dû corriger.
