---
name: bimind-fonctionnalite
description: Implémenter une nouvelle fonctionnalité ou un correctif avec Bimind — plan de Claude critiqué par Gemini, implémentation et tests par Claude, relecture croisée du changement par Gemini, mise à jour de la mémoire du projet. À utiliser quand l'utilisateur tape /bimind-fonctionnalite, ou demande d'ajouter une fonctionnalité, de corriger un bug ou d'appliquer les correctifs d'un rapport Bimind.
argument-hint: <description de la fonctionnalité ou du correctif>
---

# Fonctionnalité Bimind

Demande : $ARGUMENTS. Pont : `node "{{BIMIND}}"`. Claude est le seul à écrire du code ; Gemini critique et relit.

0. Pas de `.bimind/contexte.md` ? Déroule d'abord /bimind-init. Lis contexte.md et decisions.md : le plan
   doit respecter l'architecture, les conventions et les décisions déjà prises.

1. **Cadrer.** Si la demande est ambiguë (comportement attendu, cas limites, interface), pose les questions à
   l'utilisateur **avant** de planifier. Zone concernée large ou mal connue : fais-la lire par Gemini plutôt que
   de tout lire toi-même —
   `node "{{BIMIND}}" --role lecteur -d <zone> "Pour implémenter : <demande>. Quels fichiers et fonctions sont concernés, quels points d'extension existent, quelles conventions respecter ?"`
   Puis lis seulement les fichiers qu'il désigne.

2. **Planifier** dans `.bimind/out/plan.md` : fichiers à créer ou modifier, interfaces et données, cas limites,
   impact sécurité, tests à écrire, ce qui est hors périmètre.

3. **Faire critiquer le plan — en parallèle.**
   Gemini (arrière-plan) :
   `node "{{BIMIND}}" --role critique -f .bimind/out/plan.md -o .bimind/out/critique-plan.md "Plan d'implémentation de : <demande>. Vérifie la cohérence avec l'architecture et les décisions du projet, les cas oubliés, les risques de sécurité, et s'il existe plus simple."`
   Pendant ce temps, prépare l'implémentation (lecture des fichiers à modifier, des tests existants).
   Intègre les critiques valables. Un compromis de valeurs (vitesse contre robustesse, etc.) : demande à l'utilisateur.

4. **Implémenter** (toi seul), dans le style du code existant. Écris ou mets à jour les tests. Lance les tests,
   le lint et le build (commandes dans contexte.md) jusqu'à ce qu'ils passent.

5. **Relecture croisée du changement.**
   Dépôt git : `git diff HEAD | node "{{BIMIND}}" --role relecteur "Relis ce changement qui implémente : <demande>."`
   en ajoutant `-f <fichier>` pour chaque **nouveau** fichier (git diff ne montre pas les fichiers non suivis).
   Hors git : `-f` sur chaque fichier modifié ou créé.
   Corrige les points bloquants et importants, relance les tests. Écarte les autres en disant pourquoi.

6. **Mémoire.** Si l'architecture, les commandes ou les zones sensibles ont changé, mets à jour `.bimind/contexte.md`.
   Consigne toute décision structurante dans `.bimind/decisions.md`.

7. **Rendre compte** : ce qui a été fait (fichiers), résultat des tests, **Ce que Gemini a apporté**,
   **Désaccords et arbitrage**, ce qui reste à faire. Ne commite que si l'utilisateur le demande.
