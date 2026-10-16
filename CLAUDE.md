# Bimind — le moteur

Ce dossier est le **moteur** de Bimind Code. Il est installé pour tous les projets de l'utilisateur par
`install.mjs` (commandes dans `~/.claude/skills/`, bloc d'instructions dans `~/.claude/CLAUDE.md`).
La méthode et l'usage sont décrits dans `README.md`.

## Structure

| Fichier | Rôle |
|---|---|
| `bimind.mjs` | Le pont Claude → Antigravity CLI (`agy`, abonnement) ou API Gemini (modèles `api:…`, payant) : rôles, mémoire `.bimind/`, choix du modèle, secours, journal |
| `bimind.config.json` | Modèles par défaut (un projet les surcharge dans `.bimind/config.json`) |
| `skills/<nom>/SKILL.md` | Les commandes `/bimind…` ; `{{BIMIND}}` est remplacé par le chemin du pont à l'installation |
| `claude-global.md` | Le bloc injecté dans `~/.claude/CLAUDE.md` — chargé dans **chaque** session : le garder court |
| `install.mjs` | Installe / met à jour (`--desinstaller` pour tout retirer) |
| `tests/` | Tests du pont (simulateur d'agy, aucun quota consommé) et de l'installeur |
| `GEMINI.md` | Rôle de Gemini si l'utilisateur lance `agy` en interactif dans ce dossier |

## Règles pour faire évoluer Bimind

- Aucune dépendance npm : Node ≥ 20 uniquement.
- Gemini reste **en lecture seule** : `agy` tourne dans un espace jetable hors des projets, sans
  `--dangerously-skip-permissions`. Ne jamais relâcher ça.
- Les fichiers de secrets ne partent jamais chez Google (`SENSIBLES` dans `bimind.mjs`) ; tout ajout de type de
  fichier sensible s'accompagne d'un test.
- Après toute modification : `npm.cmd test` doit passer. Tester avec un vrai Gemini uniquement sur un modèle
  rapide (`-m gemini-3.8-flash-low`), jamais sur Argon (quota quotidien limité).
- Après une modification des skills ou de `claude-global.md`, réinstaller **depuis le terminal de l'utilisateur**
  (`run_in_terminal`) : les écritures hors projet faites depuis l'outil Bash restent dans la sandbox.
  `node install.mjs` (dans ce dossier, chemin absolu).
- Dépôt public : aucune donnée personnelle (chemins de l'utilisateur, e-mail, échanges) dans les fichiers suivis ;
  `.bimind/` (journal du moteur) est ignoré. `tests/publication.test.mjs` le vérifie.
- Voie API : endpoint `v1beta/interactions`, réponse dans `steps[type=model_output].content[type=text]`, erreurs
  parfois en liste `[{"error":…}]`. Toujours `store: false`. Ne jamais appeler `process.exit()` après un `fetch`
  (plantage libuv sous Windows) : fixer `process.exitCode`. Tests contre un faux serveur (`tests/api.test.mjs`).
  Ne jamais faire d'appel API réel avec une vraie clé sans l'accord de l'utilisateur (c'est payant).
- Format réel de sortie d'`agy` en stream-json : `{"event":"<type>","<type>":{...}}` (la doc officielle
  omet l'enveloppe). Le simulateur `tests/agy-simulateur.mjs` doit rester fidèle à ce format.
- `agy` tronque en silence tout message au-delà d'environ 191,6 ko (octets UTF-8 ; mesuré deux fois le 15/10/2026
  avec agy 1.3.5, Gemini voit « <truncated N bytes> »). D'où `BUDGET_AGY` (180 ko) et la demande placée en tête.
  À remesurer après une mise à jour d'agy : remplissage numéroté + « dernier repère vu ? » sur Flash low.
- Un refus des filtres de Google (« This request was blocked by Gemini's filters ») arrive comme une réponse
  réussie : `runModel` le requalifie en erreur. Il touche surtout les rôles sécurité sur de gros lots.
- Lecture par l'espace : chaque appel agy a son dossier jetable (`ESPACE/appel-*`, effacé ensuite). Un `-d` trop
  gros pour le message y est copié (mêmes exclusions) et Gemini le lit avec `view_file`. Les événements
  `step_update` de type `tool` (ACTIVE puis DONE, `tool_info.parameters.AbsolutePath`) donnent les fichiers
  réellement ouverts : c'est la seule mesure fiable, Gemini peut répondre sans lire. Relance dans la même
  conversation = une 2e ligne sur stdin (stdin reste ouvert jusqu'au `result` final).
- Garde des outils (`controlerOutil`) : agy en mode automatique laisse lire tout le PC (fichier témoin lu le
  16/10/2026) et exécute la lecture dès l'annonce ; la garde coupe l'appel mais ne peut pas empêcher la lecture
  locale. Commandes et écritures : agy les refuse lui-même (état ERROR, « user denied permission ») ; la garde ne
  coupe que si une commande aboutit (DONE) ou si une écriture vise hors de l'espace. Ne jamais élargir les listes
  d'outils sans test ; tout outil inconnu coupe l'appel.
