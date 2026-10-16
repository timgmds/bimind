---
name: bimind-relecture
description: Relecture d'un projet ou d'un dossier par Claude et Gemini — bugs, architecture, cohérence, dette technique, tests — avec deux analyses indépendantes, vérification croisée des constats et rapport classé par gravité. À utiliser quand l'utilisateur tape /bimind-relecture, ou demande une relecture, une revue de code ou un état des lieux de son projet avec Bimind.
argument-hint: [périmètre : dossier ou fichiers — défaut : tout le projet]
---

# Relecture Bimind

Périmètre : $ARGUMENTS (vide = tout le projet). **Lecture seule** : ne modifie aucun code sans l'accord de l'utilisateur.
Pont : `node "{{BIMIND}}"`.

0. Pas de `.bimind/contexte.md` ? Déroule d'abord /bimind-init. Sinon, lis-le : il te dit où regarder.

1. **Diverger — en parallèle.**
   - Gemini, vue d'ensemble (arrière-plan) : il lit tout le périmètre en un appel (dans son espace de travail s'il
     est gros, 2 à 5 min).
     `node "{{BIMIND}}" --role relecteur -d <périmètre> -o .bimind/out/relecture-gemini.md "Relecture complète de ce périmètre : bugs, cas limites, architecture, cohérence, dette technique, tests manquants."`
     Lignes « Bimind : » en tête de la réponse signalant des fichiers « PAS ouverts » ou « NON transmis » : relance
     sur eux en joignant (`-f`) les fichiers du socle qu'ils utilisent ; sinon Gemini signale comme absent ce qui
     est géré ailleurs (faux positifs).
   - Toi, en profondeur : à partir des zones sensibles de contexte.md, lis seulement les fichiers les plus
     critiques (cœur métier, gestion d'erreurs, état partagé, concurrence, frontières de confiance).
     Note tes constats C1, C2… avec fichier:ligne **avant** de lire le rapport de Gemini.

2. **Confronter.** Lis le rapport de Gemini (G1, G2…). Classe chaque constat : vu par les deux (confiance haute) ·
   par Gemini seul · par toi seul.

3. **Vérifier — personne ne valide son propre constat.**
   - Constats de Gemini seul : ouvre chaque fichier:ligne cité et confirme ou infirme toi-même.
   - Tes constats seuls : écris-les dans `.bimind/out/constats-claude.md` (avec fichier:ligne), puis
     `node "{{BIMIND}}" --role verificateur -f .bimind/out/constats-claude.md -f <fichiers concernés> "Vérifie ces constats de Claude."`
   - Écarte les faux positifs en disant pourquoi.

4. **Rapport** dans `.bimind/rapports/relecture-AAAA-MM-JJ.md` :
   état global en 3 lignes · constats confirmés par gravité (bloquant / important / mineur) avec fichier:ligne,
   problème, correctif · pistes d'amélioration de l'architecture · **Ce que Gemini a apporté** ·
   **Désaccords et arbitrage** · zones non relues.

5. Résume le rapport à l'utilisateur et **propose** les corrections par ordre de priorité, sans les appliquer.
   Une orientation d'architecture qu'il valide va dans `.bimind/decisions.md`.
