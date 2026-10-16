# Bimind Code

**Deux esprits, une décision.** Bimind Code fait travailler Claude et Gemini ensemble sur tes projets,
chacun avec ton abonnement : Claude dirige et code, Gemini apporte un second regard indépendant,
lit les gros volumes et vérifie, Claude tranche.

## La méthode

Une seule IA se trompe avec assurance. Deux IA qui pensent **chacune de leur côté**, puis se confrontent,
révèlent ce que l'une ou l'autre a manqué.

1. **Diverger** — Claude et Gemini analysent la même chose sans se voir (pas d'ancrage).
2. **Confronter** — l'accord renforce la confiance, le désaccord montre où creuser.
3. **Vérifier** — personne ne valide son propre constat : chaque faille ou bug trouvé par l'un est contrôlé par l'autre.
4. **Converger** — Claude décide, agit et t'explique ce que chacun a apporté. Avant de trancher, il formule le
   meilleur argument de Gemini contre lui. Un désaccord de valeurs (vitesse contre sécurité…), c'est toi qui tranches.

**Économie de tokens** : Gemini lit le code en masse (tout un projet en un appel, voir « Limites ») et rend une carte ou un rapport
compact ; Claude ne lit que les fichiers ciblés. La mémoire du projet évite de tout réexpliquer à chaque appel.

## Les commandes

Dans n'importe quel projet ouvert avec Claude Code :

| Commande | Ce qu'elle fait |
|---|---|
| `/bimind-init` | Crée la mémoire partagée du projet : Gemini cartographie le code, Claude vérifie et écrit `.bimind/contexte.md` |
| `/bimind-relecture [dossier]` | Relecture complète : deux analyses, vérification croisée, rapport classé par gravité |
| `/bimind-securite [dossier]` | Audit de sécurité défensif : deux audits + vulnérabilités connues des dépendances, chaque faille vérifiée par l'autre IA |
| `/bimind-fonctionnalite <description>` | Plan de Claude critiqué par Gemini, code et tests par Claude, relecture croisée du changement |
| `/bimind <question>` | Penser à deux sur une question ou une décision |

En dehors des commandes, Claude consulte Gemini de lui-même quand ça vaut le coup, et reste seul sur les tâches simples.
Les rapports vont dans `.bimind/rapports/`, chaque échange avec Gemini dans `.bimind/journal/`.

## La mémoire partagée d'un projet

| Fichier | Contenu | Git |
|---|---|---|
| `.bimind/contexte.md` | But, stack, architecture, commandes, zones sensibles — jointe à chaque appel de Gemini | à commiter |
| `.bimind/decisions.md` | Les décisions d'architecture prises, avec leurs raisons | à commiter |
| `.bimind/config.json` | Facultatif : modèles propres à ce projet | au choix |
| `.bimind/journal/`, `.bimind/out/` | Échanges et brouillons | ignorés |

## Sécurité et confidentialité

- Gemini est en **lecture seule** : il travaille dans un dossier jetable propre à chaque appel, hors de tes projets,
  effacé ensuite. Antigravity bloque toute écriture ailleurs (vérifié). Seul Claude modifie ton code.
- Le code joint est envoyé à Google, dans le cadre de ton abonnement. Les **fichiers de secrets** (`.env`, clés
  privées, `credentials`, `.npmrc`…) ne sont jamais envoyés ni copiés : Bimind les exclut et signale leur présence.
- **Garde des outils** : en mode automatique, Antigravity laisse Gemini *lire* n'importe quel fichier du PC sans
  demander (vérifié le 16/10/2026, contrairement à sa documentation). Un fichier piégé dans un projet pourrait donc
  lui faire lire un secret. Bimind surveille chaque outil que Gemini annonce et coupe l'appel s'il lit hors de son
  dossier jetable, lance un outil risqué (sous-agent, navigateur, MCP, messagerie) ou si une commande s'exécute
  vraiment (Antigravity les refuse lui-même en mode automatique, vérifié) : Gemini ne continue pas et rien ne
  revient dans la réponse. Limite : Antigravity exécute la lecture aussitôt annoncée, donc le contenu a pu entrer dans son
  historique local ; il n'est très probablement pas reparti vers Google, sans preuve absolue. Le blocage à la
  source se règle dans Antigravity (`allowNonWorkspaceAccess` ou des règles `deny` dans
  `~/.gemini/antigravity-cli/settings.json`) : un réglage global, que Bimind ne change pas à ta place.

## Limites à connaître

- **Taille d'un message** : par Antigravity, un message fait au plus ~180 ko (au-delà, Antigravity le coupait en
  silence). Bimind met la demande en tête. Si les fichiers de `-d` ne tiennent pas, Bimind les **copie dans le
  dossier jetable de Gemini**, qui les lit avec ses outils : tout un projet en un appel (mesuré : 45 fichiers sur 45
  et 92 sur 92). Bimind vérifie les fichiers réellement ouverts ; s'il en manque, il relance Gemini (2 fois au plus)
  puis liste ceux qui restent. Plus lent qu'un message (2 à 5 min). Les gros fichiers de données (dictionnaires
  JSON, exports CSV…) et les fichiers générés sont écartés d'office. Par l'API (sans outils), le message monte à
  3 Mo et ce qui ne tient pas est listé.
- **Filtres de Google** : Gemini refuse parfois, à tort, une analyse de sécurité. Bimind le signale comme une
  erreur (et non comme une réponse vide) ; Claude reformule ou continue seul sur cette zone.

## Modèles

`bimind.config.json` : `modele` pour les rôles qui jugent (critique, relecture, audit, vérification),
`modeleRapide` pour ceux qui lisent en masse (cartographie, lecture, recherche), `modeleSecours` quand le
modèle prévu a épuisé son quota, n'est pas disponible ou que l'accès API est refusé.
`agy models` liste les modèles de ton abonnement.

### Gemini 4 Argon

| Accès | Condition | Coût |
|---|---|---|
| Antigravity (`agy`) | Abonnement **AI Ultra** uniquement | inclus |
| API Gemini | Clé API avec **facturation activée** (pas le niveau gratuit) | à l'usage |
| Appli Gemini | AI Pro ou Ultra | inclus, mais pas automatisable proprement |

Avec AI Pro, Bimind peut utiliser Argon par l'API, **seulement pour les rôles qui jugent** : les gros volumes
restent sur l'abonnement (Flash), et Flash prend le relais si la clé, le quota ou Argon font défaut.

1. Crée une clé sur [Google AI Studio](https://aistudio.google.com/apikey) et active la facturation du projet.
2. Enregistre-la toi-même dans PowerShell (remplace `TA_CLE`), puis redémarre Claude Code :

```bash
setx GEMINI_API_KEY "TA_CLE"
```

3. Dans `bimind.config.json` : `"modele": "api:gemini-4-argon"`.

Tarif d'Argon : 2 $ par million de tokens en entrée et 10 $ en sortie (réflexion comprise) jusqu'au
30 novembre 2026, puis 4 $ / 20 $. Exemple : un audit qui envoie 200 000 tokens de code et reçoit 15 000 tokens
coûte environ 0,55 $. Les tokens de chaque appel sont notés dans `.bimind/journal/`. Les échanges par l'API
sont envoyés avec `store: false` (non conservés par Google).

## Installation

1. Node.js 20 ou plus.
2. Antigravity CLI (`agy`), le client officiel de Google pour les abonnements AI Pro / Ultra
   (Gemini CLI ne les accepte plus depuis le 18 juin 2026) :

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "irm https://antigravity.google/cli/install.ps1 | iex"
```

3. Lancer `agy` une fois et se connecter avec le compte Google de l'abonnement (choix « Google OAuth »).
4. Récupérer Bimind puis l'installer dans Claude Code, depuis son dossier (à relancer après chaque mise à jour) :

```bash
node install.mjs
```

Les commandes `/bimind…` pointent vers le dossier où Bimind est installé : ne le déplace pas sans relancer
`node install.mjs`. Désinstaller : `node install.mjs --desinstaller`. Tests : `npm test` (sous Windows PowerShell :
`npm.cmd test`). Aucune dépendance npm.

## Interroger Gemini directement

```bash
node bimind.mjs --role critique -f mon-plan.md "Qu'est-ce qui cloche ?"
```

Rôles : `pair`, `critique`, `relecteur`, `auditeur`, `verificateur`, `cartographe`, `lecteur`, `recherche`, `libre`.
`--help` liste toutes les options.
