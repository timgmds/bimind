---
name: bimind-securite
description: Audit de sécurité défensif d'une application de l'utilisateur par Claude et Gemini — deux audits indépendants, recherche des vulnérabilités connues des dépendances, vérification croisée de chaque faille pour écarter les faux positifs, rapport avec gravité et correctifs. À utiliser quand l'utilisateur tape /bimind-securite, ou demande un audit de sécurité, une revue de cybersécurité ou une recherche de failles dans son propre code avec Bimind.
argument-hint: [périmètre : dossier ou fichiers — défaut : tout le projet]
---

# Audit de sécurité Bimind

Périmètre : $ARGUMENTS (vide = tout le projet). Pont : `node "{{BIMIND}}"`.

**Cadre** : audit **défensif** du code de l'utilisateur, en lecture seule. Aucune action contre un système en
production ou appartenant à un tiers. Une preuve de concept n'est écrite que si l'utilisateur la demande,
et seulement pour un test en local. Les fichiers de secrets (.env, clés) ne partent jamais chez Gemini : le
pont les exclut et signale seulement leur présence.

0. Pas de `.bimind/contexte.md` ? Déroule d'abord /bimind-init. Repère dans le contexte les **frontières de
   confiance** : entrées utilisateur, authentification, autorisations, stockage, appels externes, uploads.

1. **Diverger — trois travaux en parallèle.**
   - Gemini, audit complet (arrière-plan) :
     `node "{{BIMIND}}" --role auditeur -d <périmètre> -o .bimind/out/audit-gemini.md "Audit de sécurité défensif de ce code."`
   - Gemini, dépendances (arrière-plan) : extrais les dépendances et leurs versions du manifeste
     (package.json, requirements.txt, pyproject.toml, *.csproj, pom.xml, go.mod…), puis
     `node "{{BIMIND}}" --role recherche -f <manifeste> -o .bimind/out/deps-gemini.md "Pour ces dépendances et versions, liste les vulnérabilités connues (CVE, avis de sécurité) qui les concernent, avec la version corrigée et la source."`
   - Toi, audit ciblé et profond : suis les données depuis chaque frontière de confiance jusqu'à leur usage
     (requêtes, commandes, rendu HTML, fichiers, désérialisation). Vérifie authentification, sessions, contrôle
     d'accès sur chaque route sensible, gestion des secrets, configuration (CORS, en-têtes, debug, cookies).
     Note tes failles C1, C2… avec fichier:ligne **avant** de lire Gemini.
   - Gros périmètre : le pont le fait lire en entier dans l'espace de travail de Gemini (un appel, 2 à 5 min). Si
     les lignes « Bimind : » en tête de la réponse signalent des fichiers « PAS ouverts » ou « NON transmis »,
     relance sur eux en joignant (`-f`) les fichiers du socle qu'ils utilisent (auth, API, helpers).
   - Erreur « refus des filtres de Gemini » (Google bloque parfois à tort l'analyse de sécurité) : relance avec
     `--role libre` et une demande de relecture de code centrée sur la protection des comptes et des données des
     utilisateurs, ou avec un autre modèle Flash (`-m`, liste : `agy models` ; le 15/10/2026, flash-low a accepté un
     lot que flash-high refusait). Un appel en erreur ne prouve jamais l'absence de faille : note la zone comme non
     revue par Gemini.

2. **Confronter.** Classe chaque faille : trouvée par les deux · par Gemini seul · par toi seul.

3. **Vérifier — chaque faille est contrôlée par l'autre esprit.**
   - Failles de Gemini : ouvre chaque fichier:ligne, refais le chemin de la donnée, confirme ou infirme.
   - Tes failles : écris-les dans `.bimind/out/failles-claude.md` puis
     `node "{{BIMIND}}" --role verificateur -f .bimind/out/failles-claude.md -f <fichiers concernés> "Vérifie ces failles trouvées par Claude."`
   - Vulnérabilités de dépendances : vérifie que la version installée est bien concernée et que le code
     utilise la fonction vulnérable si l'avis le précise.
   - Un faux positif écarté est noté avec la raison ; une faille INCERTAINE reste « à vérifier ».

4. **Rapport** dans `.bimind/rapports/securite-AAAA-MM-JJ.md` :
   synthèse du niveau de risque en 3 lignes · failles confirmées par gravité (critique / haute / moyenne / basse) :
   fichier:ligne, description, scénario d'exploitation, correctif, confirmée par Claude, Gemini ou les deux ·
   dépendances vulnérables et version cible · secrets détectés dans le dépôt · points à vérifier ·
   **Ce que Gemini a apporté** · **Désaccords et arbitrage** · zones non auditées.

5. Résume à l'utilisateur, critiques en premier, et **propose** les correctifs sans les appliquer. S'il valide,
   corrige avec /bimind-fonctionnalite (plan, relecture croisée, tests) pour ne rien casser.
