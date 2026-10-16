---
name: bimind
description: Penser à deux esprits — Claude et Gemini traitent chacun de leur côté une question ou une décision, puis Claude confronte, fait critiquer sa synthèse par Gemini et tranche. À utiliser quand l'utilisateur tape /bimind, demande l'avis des deux IA, un second regard, ou une décision importante à bien peser (choix technique, architecture, stratégie).
argument-hint: <question ou décision à traiter>
---

# Cycle Bimind

Question : $ARGUMENTS
Si elle est vide ou trop floue pour être envoyée telle quelle à Gemini, demande d'abord à l'utilisateur de la préciser.

Pont : `node "{{BIMIND}}"` (lecture seule, mémoire `.bimind/` du projet jointe automatiquement).

## 1. Diverger — en parallèle

1. Reformule la question en **demande autonome** : contexte utile, contraintes, objectif, forme de réponse attendue.
   Gemini ne voit ni la conversation ni les fichiers ; joins ce qu'il doit lire (`-f`, `-d`). Ne lui donne **pas** ton avis.
2. Lance Gemini **en arrière-plan** (`run_in_background: true`) :
   `node "{{BIMIND}}" --role pair -o .bimind/out/pair.md "<demande autonome>"`
   Si des faits récents comptent, lance aussi :
   `node "{{BIMIND}}" --role recherche -o .bimind/out/recherche.md "<question factuelle>"`
3. Pendant ce temps, construis **ta propre analyse** complète, sans attendre Gemini.

## 2. Confronter

Lis `.bimind/out/pair.md` et compare : **accords** (confiance renforcée), **désaccords** (hypothèses, faits,
priorités), **angles morts** de chacun. Ne fais pas la moyenne. Pour chaque désaccord, écris d'abord l'argument
le plus fort de Gemini contre ta position et la condition sous laquelle il aurait raison, puis détermine
l'argument le mieux étayé ou ce qui permettrait de trancher. Un désaccord de **valeurs ou de compromis**
revient à l'utilisateur : expose l'alternative au lieu de choisir à sa place.

## 3. Éprouver

Écris ta synthèse provisoire dans `.bimind/out/synthese.md`, puis :
`node "{{BIMIND}}" --role critique -f .bimind/out/synthese.md "Synthèse de Claude sur : <question>. Mets-la à l'épreuve."`
Intègre les critiques valables ; écarte les autres en sachant dire pourquoi.

## 4. Converger

Réponds avec : la réponse ou décision, claire et actionnable · **Ce que Gemini a apporté** ·
**Désaccords et arbitrage** · ce qui reste incertain. Une décision d'architecture retenue va dans
`.bimind/decisions.md` (format : `## AAAA-MM-JJ — titre`, puis Contexte, Décision, Raison, Alternatives écartées).

Gemini indisponible (non connecté, quota) : dis-le en une ligne et joue toi-même l'avocat du diable à l'étape 3.
