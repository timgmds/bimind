#!/usr/bin/env node
// Bimind — pont entre Claude (chef d'orchestre) et Gemini (second esprit).
// Appelle Antigravity CLI (`agy`) en mode non interactif avec l'abonnement Google de l'utilisateur,
// dans un espace de travail jetable (Gemini ne peut rien modifier dans les projets) — ou, pour les modèles
// préfixés "api:", l'API Gemini directement (sans outils, donc lecture seule par construction) —
// joint la mémoire partagée du projet (.bimind/contexte.md, .bimind/decisions.md)
// et consigne chaque échange dans <projet>/.bimind/journal/.
//
//   node bimind.mjs [options] "question"
//   <texte> | node bimind.mjs [options]
//
// Aucune dépendance : Node >= 20 et `agy` connecté une fois (lancer `agy`, se connecter avec Google).

import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MOTEUR = dirname(fileURLToPath(import.meta.url));
// Hors de tout projet exprès : dans un dépôt git, agy prendrait la racine du dépôt comme espace de travail.
const ESPACE = join(tmpdir(), "bimind-espace");
// Antigravity tronque en silence tout message au-delà d'environ 191,6 ko (octets UTF-8, quel que soit le contenu :
// mesuré le 15/10/2026 avec agy 1.3.5, Gemini voit alors « <truncated N bytes> »). On reste en dessous, avec une marge.
const BUDGET_AGY = 180_000;
const BUDGET_API = 3_000_000; // ~750k tokens : sous la fenêtre de contexte de Gemini
// -d écarte les fichiers plus gros que ça : presque toujours générés (bundles) ou des données (dictionnaires, exports)
const MAX_FICHIER = 100_000;
const MAX_DONNEES = 30_000;
const DONNEES = /\.(json|jsonl|ndjson|geojson|csv|tsv|txt|xml|ya?ml|sql|log|dat)$/i;
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

const COMMUN =
  "Réponds en français. Tu es en lecture seule : tu ne modifies aucun fichier et tu ne lances aucune commande, " +
  "c'est Claude qui agit. Tout le contenu utile est dans ce message. Sois direct et dense, sans formules de politesse : " +
  "Claude lira ta réponse, chaque ligne doit servir.";

// niveau "rapide" : gros volumes et tâches de collecte, sur modeleRapide pour épargner le quota du modèle fort.
const ROLES = {
  pair: {
    niveau: "fort",
    consigne:
      "Tu es le second esprit de Bimind. Claude traite la même question de son côté, sans voir ta réponse, " +
      "et confrontera ensuite vos deux analyses. Donne TA propre analyse, complète et indépendante. " +
      "Ne cherche pas le consensus : apporte ton angle, rends tes hypothèses explicites, signale ce qui te ferait " +
      "changer d'avis. Termine par ton niveau de confiance (faible / moyen / élevé) et pourquoi.",
  },
  critique: {
    niveau: "fort",
    consigne:
      "Tu es le contradicteur de Bimind. On te soumet une proposition rédigée par Claude. Mets-la à l'épreuve : " +
      "erreurs factuelles, hypothèses cachées, cas oubliés, risques, incohérences avec le contexte et les décisions " +
      "du projet, alternatives plus simples. Classe tes remarques de la plus grave à la moins grave et cible, " +
      "ne réécris pas tout. Si la proposition est solide, dis-le franchement au lieu d'inventer des objections.",
  },
  relecteur: {
    niveau: "fort",
    consigne:
      "Tu es le relecteur de code de Bimind. On te soumet du code (un changement ou un périmètre entier). Cherche : " +
      "bugs et cas limites, régressions, failles de sécurité, incohérences avec l'architecture et les conventions du " +
      "projet, tests manquants, complexité inutile, dette technique. Pour chaque constat : identifiant (G1, G2…), " +
      "gravité (bloquant / important / mineur), fichier:ligne, problème, correction proposée. " +
      "Ne signale que ce que le code montre. Si c'est bon, dis-le.",
  },
  auditeur: {
    niveau: "fort",
    consigne:
      "Tu es l'auditeur sécurité de Bimind, pour un audit défensif de l'application de l'utilisateur. Examine le code " +
      "fourni : injections (SQL, commande, template, XSS), authentification et sessions, contrôle d'accès (IDOR, " +
      "élévation de privilèges), validation des entrées, secrets en dur, cryptographie, désérialisation, SSRF, " +
      "uploads, configuration (CORS, en-têtes, mode debug), dépendances et versions. Pour chaque faille : " +
      "identifiant (G1, G2…), gravité (critique / haute / moyenne / basse), fichier:ligne, description, scénario " +
      "d'exploitation concret, correctif, confiance (sûr / probable / à vérifier). Ne signale que ce que le code " +
      "montre, pas de généralités. Termine par les zones que tu n'as pas pu évaluer.",
  },
  verificateur: {
    niveau: "fort",
    consigne:
      "Tu es le vérificateur de Bimind. On te soumet des constats (failles, bugs) trouvés par Claude, avec le code " +
      "concerné. Pour chacun, rends un verdict CONFIRMÉ, INFIRMÉ ou INCERTAIN, avec la preuve dans le code " +
      "(fichier:ligne) et, si confirmé, la gravité que tu estimes. Sois exigeant : un faux positif coûte autant " +
      "qu'un oubli. Signale aussi tout problème lié que Claude aurait manqué.",
  },
  cartographe: {
    niveau: "rapide",
    consigne:
      "Tu es le cartographe de Bimind. On te fournit un code source. Produis une carte compacte qui permettra à " +
      "Claude de ne lire que l'essentiel : 1) but de l'application et stack (langages, frameworks, versions " +
      "visibles) ; 2) architecture : dossiers et modules clés, rôle en une ligne chacun ; 3) points d'entrée " +
      "(routes, CLI, handlers, tâches) ; 4) flux de données et frontières de confiance (entrées utilisateur, " +
      "authentification, stockage, appels externes) ; 5) conventions observées (style, tests, erreurs) ; " +
      "6) commandes de build, test et lancement ; 7) zones sensibles ou complexes à examiner en priorité, " +
      "avec chemins exacts. Pas de code recopié sauf extrait indispensable.",
  },
  lecteur: {
    niveau: "rapide",
    consigne:
      "Tu es le lecteur de Bimind. Ta grande fenêtre de contexte est ton atout : lis attentivement tout le contenu " +
      "fourni. Réponds précisément en citant les passages et les chemins de fichiers exacts. " +
      "N'invente rien qui ne soit pas dans les sources.",
  },
  recherche: {
    niveau: "rapide",
    consigne:
      "Tu es le chercheur de Bimind. Utilise la recherche Google pour trouver des informations à jour et " +
      "vérifiables. Donne des faits datés avec leurs sources (URL). Sépare clairement ce qui est établi, " +
      "ce qui est incertain, et ce que tu n'as pas trouvé.",
  },
  libre: { niveau: "fort", consigne: "" },
};

const AIDE = `Bimind — demander à Gemini depuis Claude

Usage :
  node bimind.mjs [options] "question"
  <texte> | node bimind.mjs [options]

Rôles (-r) :
  fort   : ${Object.keys(ROLES).filter((r) => ROLES[r].niveau === "fort").join(", ")}
  rapide : ${Object.keys(ROLES).filter((r) => ROLES[r].niveau === "rapide").join(", ")}
  (défaut : pair)

Options :
  -r, --role <nom>     rôle de Gemini
  -f, --file <chemin>  joint le contenu d'un fichier (répétable)
  -d, --dir <chemin>   joint les fichiers texte d'un dossier, secrets et gros fichiers de données exclus (répétable)
  -m, --model <slug>   force un modèle (désactive le secours)
  -e, --effort <n>     ${EFFORTS.join(" | ")}
  -o, --out <chemin>   écrit aussi la réponse dans ce fichier (utile en arrière-plan)
  -t, --timeout <s>    délai max en secondes (défaut : 600)
  -p, --projet <dir>   racine du projet (défaut : dossier contenant .bimind ou .git, sinon le dossier courant)
      --sans-contexte  ne joint pas la mémoire du projet (.bimind/contexte.md, decisions.md)
      --espace         fait lire les fichiers de -d dans l'espace de travail de Gemini même s'ils tiennent
                       dans le message (automatique quand ils ne tiennent pas)
      --json           sortie JSON : réponse, modèle, durée, consommation, journal
  -h, --help           cette aide

Modèles (bimind.config.json du moteur, surchargé par <projet>/.bimind/config.json) :
  modele (rôles forts), modeleRapide (rôles rapides), modeleSecours (si quota épuisé, modèle absent ou
  accès API refusé), effort. Modèles de l'abonnement : agy models.
  Préfixe "api:" (ex. api:gemini-4-argon) = API Gemini payante, clé dans GEMINI_API_KEY.

Taille : un message fait ${BUDGET_AGY / 1000} ko au plus par Antigravity (au-delà, il tronque), ${BUDGET_API / 1_000_000} Mo par l'API.
  La demande passe en tête. Avec Antigravity, un -d trop gros pour le message est copié dans l'espace de
  travail jetable de Gemini, qui lit tout avec ses outils (plus lent : 2 à 5 min) ; Bimind vérifie les fichiers
  réellement ouverts et liste les autres. Par l'API, les fichiers qui ne tiennent pas sont listés (« non
  transmis faute de place ») : relancer sur eux. Mémoire, -f et entrée standard trop gros : refus (code 2).

Sécurité : une lecture hors de l'espace jetable de Gemini, un outil risqué (sous-agent, navigateur, MCP…) ou
  une commande qui s'exécute vraiment interrompt l'appel (erreur « appel interrompu »).`;

function fail(message, code = 1) {
  console.error(`bimind : ${message}`);
  process.exit(code);
}

function readJson(path) {
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (err) { fail(`${path} illisible : ${err.message}`, 2); }
}

function findProjectRoot(start) {
  for (let dir = resolve(start); ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".bimind")) || existsSync(join(dir, ".git"))) return dir;
    if (dirname(dir) === dir) return resolve(start);
  }
}

function parseArgs(argv) {
  const opts = {
    role: "pair", files: [], dirs: [], model: "", effort: "", timeout: 600, json: false, out: "",
    projet: "", contexte: true, espace: false, words: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      if (i + 1 >= argv.length) fail(`option ${a} : valeur manquante`, 2);
      return argv[++i];
    };
    if (a === "-h" || a === "--help") { console.log(AIDE); process.exit(0); }
    else if (a === "-r" || a === "--role") opts.role = val();
    else if (a === "-f" || a === "--file") opts.files.push(val());
    else if (a === "-d" || a === "--dir") opts.dirs.push(val());
    else if (a === "-m" || a === "--model") opts.model = val();
    else if (a === "-e" || a === "--effort") opts.effort = val();
    else if (a === "-o" || a === "--out") opts.out = val();
    else if (a === "-t" || a === "--timeout") opts.timeout = Number(val());
    else if (a === "-p" || a === "--projet") opts.projet = val();
    else if (a === "--sans-contexte") opts.contexte = false;
    else if (a === "--espace") opts.espace = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--") { opts.words.push(...argv.slice(i + 1)); break; }
    else if (a.startsWith("-") && a !== "-") fail(`option inconnue : ${a}\n\n${AIDE}`, 2);
    else if (a !== "-") opts.words.push(a);
  }
  if (!(opts.role in ROLES)) fail(`rôle inconnu : ${opts.role} (choix : ${Object.keys(ROLES).join(", ")})`, 2);
  if (opts.effort && !EFFORTS.includes(opts.effort)) fail(`--effort : ${EFFORTS.join(", ")}`, 2);
  if (!(opts.timeout > 0)) fail("--timeout doit être un nombre de secondes positif", 2);
  return opts;
}

// Modèle principal et secours selon le niveau du rôle ; -m force un modèle sans secours.
function pickModels(opts, config) {
  if (opts.model) return { model: opts.model, fallback: "" };
  const model = (ROLES[opts.role].niveau === "rapide" && config.modeleRapide) || config.modele || "";
  return { model, fallback: config.modeleSecours || "" };
}

async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

// ---------- Contenu joint ----------

const DOSSIERS_IGNORES = new Set(["node_modules", ".git", ".bimind", "dist", "build", ".next", ".nuxt", "coverage",
  "__pycache__", ".venv", "venv", "target", "vendor", ".idea", ".vscode", ".gradle", "obj"]);
const FICHIERS_IGNORES = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|Cargo\.lock|poetry\.lock|Gemfile\.lock)$|\.(min\.js|map|svg|ico|png|jpe?g|gif|webp|pdf|zip|gz|exe|dll|woff2?|ttf|mp[34]|wav)$/i;
// Jamais transmis à Gemini : on signale seulement leur présence (un secret commité est un constat d'audit).
// Les fichiers de code (ex. secrets.ts) restent transmis : seuls les fichiers de données sont exclus.
const SENSIBLES = /(^|\/)(\.env(\.(?!example$|sample$|template$|dist$)[^/]*)?|\.envrc|id_(rsa|dsa|ecdsa|ed25519)[^/]*|[^/]*\.(pem|key|p12|pfx|jks|keystore|kdbx|tfstate|ppk)|[^/]*credentials(\.(json|ya?ml|ini|toml|xml|txt))?|secrets?\.(json|ya?ml|ini|toml|env|txt)|service[-_]?account[^/]*\.(json|ya?ml)|\.npmrc|\.pypirc|\.netrc)$/i;

function listFiles(root) {
  const git = spawnSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (git.status === 0) return git.stdout.split("\0").filter(Boolean);
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { if (!DOSSIERS_IGNORES.has(entry.name)) walk(rel); }
      else if (entry.isFile()) files.push(rel);
    }
  };
  walk("");
  return files;
}

// Ordre de remplissage quand tout ne tient pas : le code d'abord, puis docs et données, les styles en dernier.
const priorite = (chemin) => (/\.(css|scss|sass|less|styl)$/i.test(chemin) ? 2
  : DONNEES.test(chemin) || /\.(md|markdown|rst|adoc)$/i.test(chemin) ? 1 : 0);
const octets = (texte) => Buffer.byteLength(texte, "utf8");
const ko = (n) => `${Math.ceil(n / 1000)} ko`;

// Fichiers texte d'un dossier, sans dépendances, secrets ni gros fichiers (listés à part, avec leur raison).
function collectDir(dir) {
  const root = resolve(dir);
  if (!existsSync(root) || !statSync(root).isDirectory()) fail(`dossier introuvable : ${dir}`, 2);
  const base = dir.replaceAll("\\", "/").replace(/\/+$/, "");
  const prefixe = base === "" || base === "." ? "" : `${base}/`;
  const fichiers = [], sensibles = [], volumineux = [];
  for (const rel of listFiles(root)) {
    if (rel.split("/").some((part) => DOSSIERS_IGNORES.has(part)) || FICHIERS_IGNORES.test(rel)) continue;
    if (SENSIBLES.test(rel)) { sensibles.push(rel); continue; }
    const path = join(root, rel);
    if (!existsSync(path)) continue;
    const taille = statSync(path).size;
    if (taille > (DONNEES.test(rel) ? MAX_DONNEES : MAX_FICHIER)) { volumineux.push(`${prefixe}${rel} (${ko(taille)})`); continue; }
    const content = readFileSync(path);
    if (content.includes(0)) continue; // binaire
    const contenu = content.toString("utf8");
    const bloc = `----- Fichier : ${rel} -----\n${contenu}`;
    fichiers.push({ chemin: `${prefixe}${rel}`, contenu, bloc, taille: octets(bloc) + 2 });
  }
  return { dir, fichiers, sensibles, volumineux };
}

// Chemin d'un fichier copié dans l'espace de Gemini : toujours relatif et sans « .. », pour rester dedans.
const cheminEspace = (chemin) => chemin.replace(/^[A-Za-z]:/, "").split("/").filter((p) => p && p !== "." && p !== "..").join("/");

// Projet trop gros pour un message : les fichiers sont copiés dans l'espace de travail jetable de Gemini, qui les
// lit avec ses outils (mesuré le 16/10/2026 : 45 fichiers sur 45 et 50 codes de contrôle sur 50 retrouvés,
// 675 ko, en 1 min 30 à 2 min 15). Le message ne porte que la liste.
function espaceSection(dossiers) {
  const fichiers = dossiers.flatMap((d) => d.fichiers);
  const total = fichiers.reduce((s, f) => s + octets(f.contenu), 0);
  const notes = dossiers.flatMap((d) => [
    d.sensibles.length && `Fichiers sensibles présents mais NON transmis (secrets) : ${d.sensibles.join(", ")}`,
    d.volumineux.length && `Fichiers volumineux NON transmis (données ou fichiers générés probables) : ${d.volumineux.join(", ")}`,
  ]).filter(Boolean);
  return `===== Fichiers à lire dans ton espace de travail =====\n` +
    `Les ${fichiers.length} fichiers ci-dessous (${ko(total)}) sont copiés dans ton espace de travail (le dossier courant), ` +
    "avec ces chemins. Ils ne tiennent pas dans ce message : lis-les TOUS, en entier, avec view_file avant de " +
    "répondre (pour un long fichier, va jusqu'à la dernière ligne). Ne lis rien en dehors de ce dossier. " +
    "Si un fichier n'a pas pu être lu, dis-le.\n" +
    `${notes.map((n) => `> ${n}\n`).join("")}` +
    fichiers.map((f) => `- ${cheminEspace(f.chemin)} (${ko(octets(f.contenu))})`).join("\n") +
    "\n===== Fin de la liste =====";
}

function dirSection({ dir, fichiers, sensibles, volumineux }, inclus, omis) {
  const notes = [
    sensibles.length && `Fichiers sensibles présents mais NON transmis (secrets) : ${sensibles.join(", ")}`,
    volumineux.length && `Fichiers volumineux NON transmis (données ou fichiers générés probables) : ${volumineux.join(", ")}`,
    omis.length && `Fichiers NON transmis faute de place dans ce message : ${omis.join(", ")}. Ne conclus rien à leur sujet.`,
  ].filter(Boolean);
  const blocs = fichiers.filter((f) => inclus.has(f)).map((f) => f.bloc);
  return `===== Dossier : ${dir} (${blocs.length} fichiers sur ${fichiers.length}) =====\n${notes.map((n) => `> ${n}\n`).join("")}\n` +
    `${blocs.join("\n\n")}\n\n===== Fin du dossier ${dir} =====`;
}

function readMemory(projet) {
  const parts = [];
  for (const [file, titre] of [["contexte.md", "Contexte du projet"], ["decisions.md", "Décisions déjà prises"]]) {
    const path = join(projet, ".bimind", file);
    if (existsSync(path) && readFileSync(path, "utf8").trim())
      parts.push(`----- Mémoire partagée — ${titre} (.bimind/${file}) -----\n${readFileSync(path, "utf8").trim()}`);
  }
  return parts;
}

// La demande passe en tête (une troncature ne peut plus l'emporter) et, si elle est courte, est rappelée après le
// contenu joint (Gemini suit mieux une consigne placée après un long contexte). Mémoire, entrée standard et -f sont
// indispensables : s'ils dépassent le budget, refus. Les fichiers de -d vont dans le message s'ils tiennent ; sinon,
// avec Antigravity (outils), dans l'espace de travail de Gemini ; par l'API (sans outils), ils remplissent la place
// restante et ceux qui ne tiennent pas sont listés et renvoyés à Claude (omis).
function buildPrompt(opts, projet, { demande, entree }, budget, outils) {
  const { consigne } = ROLES[opts.role];
  const tete = [consigne ? `${consigne}\n${COMMUN}` : COMMUN, `----- Demande de Claude -----\n${demande}`];
  const joints = opts.contexte ? readMemory(projet) : [];
  if (entree) joints.push(`----- Entrée standard -----\n${entree}\n----- Fin de l'entrée standard -----`);
  for (const f of opts.files) {
    const path = resolve(f);
    if (!existsSync(path) || !statSync(path).isFile()) fail(`fichier introuvable : ${f} (pour un dossier, utilise -d)`, 2);
    if (SENSIBLES.test(path.replaceAll("\\", "/"))) fail(`${f} ressemble à un fichier de secrets : refusé (il ne doit pas partir chez Google)`, 2);
    const content = readFileSync(path);
    if (content.includes(0)) fail(`${f} est un fichier binaire : refusé`, 2);
    joints.push(`----- Fichier : ${f} -----\n${content.toString("utf8")}\n----- Fin de ${basename(f)} -----`);
  }
  const dossiers = opts.dirs.map(collectDir);
  const rappel = !joints.length && !dossiers.length ? []
    : [octets(demande) <= 4000 ? `----- Rappel de la demande de Claude -----\n${demande}`
      : "----- Fin du contenu joint : réponds à la demande de Claude placée au début du message -----"];

  const fixe = octets([...tete, ...joints, ...rappel].join("\n\n"));
  if (fixe > budget)
    return { erreur: `trop de contenu pour un seul appel : ${ko(fixe)} sans compter -d, pour ${ko(budget)} au plus` +
      `${budget === BUDGET_AGY ? " (au-delà, Antigravity tronque le message)" : ""}. Découpe en plusieurs appels ` +
      "ou allège -f, l'entrée standard ou la mémoire (--sans-contexte)." };

  let place = budget - fixe - 2000 * dossiers.length;
  const tousLesFichiers = dossiers.flatMap((d) => d.fichiers);
  const volumineux = dossiers.flatMap((d) => d.volumineux);
  if (outils && tousLesFichiers.length && (opts.espace || tousLesFichiers.reduce((s, f) => s + f.taille, 0) > place)) {
    const prompt = [...tete, ...joints, espaceSection(dossiers), ...rappel].join("\n\n");
    if (octets(prompt) > budget) return { erreur: `trop de fichiers pour un seul appel : la liste seule dépasse ${ko(budget)}. Découpe en plusieurs appels.` };
    const espace = tousLesFichiers.map((f) => ({ chemin: cheminEspace(f.chemin), contenu: f.contenu }));
    return { prompt, omis: [], budget, volumineux, espace };
  }

  // Remplissage de la place restante par priorité ; les notes de chaque dossier sont comptées au montage, et on
  // retire les derniers fichiers ajoutés tant que le message dépasse.
  const inclus = new Set();
  const candidats = dossiers.flatMap((d) => d.fichiers).sort((a, b) => priorite(a.chemin) - priorite(b.chemin));
  for (const f of candidats) if (f.taille <= place) { inclus.add(f); place -= f.taille; }
  const monter = () => {
    const omis = dossiers.map((d) => d.fichiers.filter((f) => !inclus.has(f)).map((f) => f.chemin));
    const sections = dossiers.map((d, i) => dirSection(d, inclus, omis[i]));
    return { prompt: [...tete, ...joints, ...sections, ...rappel].join("\n\n"), omis: omis.flat() };
  };
  let envoi = monter();
  while (octets(envoi.prompt) > budget && inclus.size) {
    inclus.delete([...inclus].pop());
    envoi = monter();
  }
  return { ...envoi, budget, volumineux };
}

// ---------- Appel à Antigravity ----------

function locateAgy() {
  if (process.env.BIMIND_AGY) return process.env.BIMIND_AGY;
  const local = process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "agy", "bin", "agy.exe");
  if (local && existsSync(local)) return local;
  return "agy";
}

// Garde des outils de Gemini. En mode automatique, agy laisse Gemini lire N'IMPORTE QUEL fichier du PC sans
// demander (vérifié le 16/10/2026 avec un fichier témoin hors de l'espace), alors que sa doc annonce une
// confirmation. Un fichier de projet piégé pourrait donc lui faire lire un secret et l'envoyer chez Google.
// Bimind lit chaque outil annoncé et coupe l'appel dès qu'un outil sort de cette liste ou vise un chemin hors de
// l'espace jetable : Gemini ne continue pas et rien ne revient dans la réponse ni le journal. Limite mesurée :
// agy exécute la lecture aussitôt annoncée, le contenu a pu entrer dans son historique local avant la coupure ;
// il n'est très probablement pas reparti vers le modèle, sans preuve absolue. Le blocage à la source passe par
// les réglages d'agy (voir README, « Sécurité »).
// Commandes et écritures : agy les refuse lui-même en mode automatique (vérifié le 16/10/2026 : « user denied
// permission », aucun fichier créé) ; Gemini essaie parfois un `dir` pour explorer, ce n'est pas une raison de
// couper. On coupe seulement si l'une d'elles aboutit (réglages d'agy devenus permissifs) ou écrit hors de l'espace.
const OUTILS_LECTURE = new Set(["view_file", "list_dir", "grep_search", "find_by_name"]);
const OUTILS_ANODINS = new Set(["search_web", "finish", "wait", "wait_5_seconds"]);
const OUTILS_COMMANDE = new Set(["run_command", "send_command_input", "command_status"]);
const OUTILS_ECRITURE = new Set(["write_to_file", "replace_file_content", "multi_replace_file_content", "sed_file", "notebook_edit"]);

function horsEspace(params, espace) {
  for (const [cle, valeur] of Object.entries(params ?? {})) {
    if (typeof valeur !== "string" || !/path|dir|file/i.test(cle)) continue;
    const rel = relative(espace, resolve(espace, valeur));
    if (rel.startsWith("..") || isAbsolute(rel)) return valeur;
  }
  return "";
}

function controlerOutil(nom, params, espace, role, etat) {
  if (OUTILS_LECTURE.has(nom)) {
    const cible = horsEspace(params, espace);
    return cible ? `${nom} hors de son espace de travail (${cible})` : "";
  }
  if (OUTILS_ANODINS.has(nom) || (nom === "read_url_content" && role === "recherche")) return "";
  if (OUTILS_COMMANDE.has(nom)) return etat === "DONE" ? `${nom} exécuté (Antigravity ne l'a pas refusé : vérifie ses réglages)` : "";
  if (OUTILS_ECRITURE.has(nom)) {
    const cible = horsEspace(params, espace);
    return cible ? `${nom} hors de son espace de travail (${cible})` : "";
  }
  return `outil non autorisé : ${nom}`;
}

// Lecture par l'espace : une consigne ne suffit pas (mesuré : 1 fichier ouvert sur 92 quand la mémoire du projet
// permettait de répondre sans lire). Après chaque réponse, Bimind compare aux fichiers réellement ouverts et, s'il en
// manque, relance Gemini dans la même conversation (agy lit un message par ligne d'entrée standard).
const MAX_RELANCES = 2;
const relanceTexte = (manquants, total) =>
  `Tu n'as pas ouvert ${manquants.length} des ${total} fichiers de ton espace de travail : ${manquants.join(", ")}. ` +
  "Ouvre-les TOUS maintenant avec view_file, en entier, puis redonne ta réponse COMPLÈTE à la demande de Claude, " +
  "en tenant compte de tout ce que tu as lu : elle remplace ta réponse précédente.";

// Le prompt part par stdin en stream-json : pas de limite de longueur de ligne de commande
// sous Windows, pas de problème de guillemets, pas de shell.
function runAgy(opts, model, prompt, espace, attendus = []) {
  const args = [
    "--input-format", "stream-json", "--output-format", "stream-json",
    "--print-timeout", `${Math.ceil(opts.timeout / 60)}m`, "--disable-slash-commands",
  ];
  if (model) args.push("--model", model);
  if (opts.effort) args.push("--effort", opts.effort);

  return new Promise((done) => {
    const started = Date.now();
    const agy = locateAgy();
    // BIMIND_AGY peut pointer vers un script .mjs (simulateur d'agy des tests)
    const [cmd, cmdArgs] = /\.m?js$/.test(agy) ? [process.execPath, [agy, ...args]] : [agy, args];
    const child = spawn(cmd, cmdArgs, { cwd: espace, env: { ...process.env, NO_COLOR: "1" }, windowsHide: true });
    let stdout = "", stderr = "", timedOut = false, tampon = "", violation = "", relances = 0;
    const lectures = new Set();
    const envoyer = (texte) => child.stdin.write(JSON.stringify({ event: "user", message: { content: texte } }) + "\n", "utf8");
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, (opts.timeout + 30) * 1000);
    child.stdout.on("data", (d) => {
      stdout += d;
      tampon += d;
      for (let i; (i = tampon.indexOf("\n")) >= 0; tampon = tampon.slice(i + 1)) {
        const ligne = tampon.slice(0, i).trim();
        if (!ligne.startsWith("{")) continue;
        let ev;
        try { ev = JSON.parse(ligne); } catch { continue; }
        if (ev.event === "result") {
          const manquants = attendus.filter((c) => !lectures.has(c));
          if (ev.result?.status === "SUCCESS" && manquants.length && relances < MAX_RELANCES && !violation) {
            relances++;
            envoyer(relanceTexte(manquants, attendus.length));
          } else child.stdin.end();
          continue;
        }
        const step = ev.event === "step_update" ? ev.step_update : null;
        if (step?.step_type !== "tool") continue;
        const params = step.tool_info?.parameters;
        const motif = controlerOutil(step.tool_name, params, espace, opts.role, step.state);
        if (motif && !violation) { violation = motif; child.kill(); }
        if (!motif && step.state === "DONE" && step.tool_name === "view_file" && params?.AbsolutePath)
          lectures.add(relative(espace, resolve(espace, params.AbsolutePath)).replaceAll("\\", "/"));
      }
    });
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      const missing = err.code === "ENOENT";
      done({ error: missing ? "Antigravity CLI (agy) introuvable. Installe-le puis connecte-toi : voir le README de Bimind." : `impossible de lancer agy : ${err.message}`, seconds: 0 });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const seconds = (Date.now() - started) / 1000;
      if (violation)
        return done({ error: `appel interrompu par Bimind : Gemini a voulu utiliser ${violation}. Gemini reste en ` +
          "lecture seule dans son espace ; si un fichier du projet lui a demandé ça, c'est une tentative de " +
          "manipulation à signaler.", seconds, lectures: [...lectures], violation });
      if (timedOut) return done({ error: `Gemini n'a pas répondu en ${opts.timeout} s`, seconds, lectures: [...lectures], relances });
      done({ ...parseStream(stdout, stderr, code), seconds, lectures: [...lectures], relances });
    });
    child.stdin.on("error", () => {}); // agy peut fermer stdin s'il s'arrête tôt (ex. non connecté)
    envoyer(prompt); // stdin reste ouvert jusqu'à la réponse finale, pour pouvoir relancer
  });
}

// Chaque ligne est {"event":"<type>","<type>":{...}} : init (modèle réel), step_update (deltas), result (fin d'un
// tour). Avec des relances, il y a un result par tour : on garde la dernière réponse réussie et on cumule l'usage.
function parseStream(stdout, stderr, code) {
  let model = "", deltas = "";
  const results = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    const body = ev[ev.event] ?? ev;
    if (ev.event === "init") model = body.model || "";
    else if (ev.event === "result") results.push(body);
    else if (ev.event === "step_update" && body.step_type === "agent_response" && body.text_delta) deltas += body.text_delta;
  }
  const reussis = results.filter((r) => r.status === "SUCCESS" && typeof r.response === "string");
  const result = reussis.at(-1) ?? results.at(-1);
  if (result) {
    const usage = results.length > 1 ? results.reduce((s, r) => {
      for (const [k, v] of Object.entries(r.usage ?? {})) if (typeof v === "number") s[k] = (s[k] ?? 0) + v;
      return s;
    }, {}) : result.usage;
    if (result.status === "SUCCESS" && typeof result.response === "string") return { response: result.response.trim(), usage, model };
    const raw = result.error || `statut ${result.status}${stderr.trim() ? ` — ${stderr.trim()}` : ""}`;
    return { error: explainError(typeof raw === "string" ? raw : raw.message || JSON.stringify(raw)), model };
  }
  if (code === 0 && deltas.trim()) return { response: deltas.trim(), model };
  return { error: explainError((stderr || stdout || `code de sortie ${code}`).trim()), model };
}

// ---------- Appel direct à l'API Gemini (modèles préfixés "api:") ----------
// Pour les modèles absents de l'abonnement dans Antigravity (ex. Gemini 4 Argon sur AI Pro) : facturé à l'usage
// sur la clé GEMINI_API_KEY de l'utilisateur. store: false = Google ne conserve pas l'échange.

const API_URL = process.env.BIMIND_GEMINI_API_URL || "https://generativelanguage.googleapis.com/v1beta/interactions";
const THINKING = { low: "low", medium: "medium", high: "high", xhigh: "high", max: "high" };

async function runApi(opts, model, prompt) {
  const started = Date.now();
  const seconds = () => (Date.now() - started) / 1000;
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { error: "accès API refusé : variable GEMINI_API_KEY absente (voir le README de Bimind).", seconds: 0 };
  const body = { model, input: prompt, store: false, generation_config: { max_output_tokens: 32768 } };
  if (opts.effort) body.generation_config.thinking_level = THINKING[opts.effort];
  let res, data;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeout * 1000),
    });
    data = await res.json().catch(() => ({}));
  } catch (err) {
    return { error: err.name === "TimeoutError" ? `Gemini n'a pas répondu en ${opts.timeout} s` : `API Gemini injoignable : ${err.message}`, seconds: seconds() };
  }
  // Google renvoie ses erreurs tantôt en objet, tantôt en liste : [{"error":{…}}]
  const erreur = (Array.isArray(data) ? data[0] : data)?.error;
  if (!res.ok) return { error: explainError(`HTTP ${res.status} : ${erreur?.message || JSON.stringify(data)}`), seconds: seconds() };
  const text = (data.steps ?? []).filter((s) => s.type === "model_output")
    .flatMap((s) => s.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("");
  if (data.status !== "completed" || !text.trim())
    return { error: explainError(`statut ${data.status} ${(data.errors ?? []).map((e) => e.message).join(" ; ")}`.trim()), seconds: seconds() };
  const u = data.usage ?? {};
  return {
    response: text.trim(), model: `api:${data.model || model}`, seconds: seconds(),
    usage: { input_tokens: u.total_input_tokens, output_tokens: u.total_output_tokens, thinking_tokens: u.total_thought_tokens, cache_read_tokens: u.total_cached_tokens, total_tokens: u.total_tokens },
  };
}

// Un refus des filtres de Google arrive comme une réponse réussie (statut SUCCESS, code 0) : on le requalifie en
// erreur, sinon Claude conclurait « Gemini n'a rien trouvé ».
const REFUS = /blocked by Gemini'?s filters/i;
// Chaque appel à agy a son propre espace jetable (appels parallèles sans collision), effacé ensuite.
async function runModel(opts, model, envoi) {
  if (model.startsWith("api:")) return requalifierRefus(await runApi(opts, model.slice(4), envoi.prompt));
  mkdirSync(ESPACE, { recursive: true });
  const espace = realpathSync.native(mkdtempSync(join(ESPACE, "appel-")));
  try {
    for (const f of envoi.espace ?? []) {
      mkdirSync(dirname(join(espace, f.chemin)), { recursive: true });
      writeFileSync(join(espace, f.chemin), f.contenu);
    }
    return requalifierRefus(await runAgy(opts, model, envoi.prompt, espace, (envoi.espace ?? []).map((f) => f.chemin)));
  } finally {
    rmSync(espace, { recursive: true, force: true });
  }
}

function requalifierRefus(r) {
  if (!r.error && r.response && r.response.length < 2000 && REFUS.test(r.response)) {
    const { response, ...reste } = r;
    return { ...reste, error: explainError(response) };
  }
  return r;
}

const isRefus = (message) => REFUS.test(message) || /finish_reason.{0,5}SAFETY|PROHIBITED_CONTENT|BLOCKLIST/i.test(message);
const isQuota = (message) => /quota|429|RESOURCE_EXHAUSTED|rate.?limit|exhausted|credits/i.test(message);
const isUnknownModel = (message) => /not recognized as a known model|invalid model selection|HTTP 404|is not found/i.test(message);
const isApiDenied = (message) => /accès API refusé|HTTP 40[13]|API key not valid|PERMISSION_DENIED|billing/i.test(message);

function explainError(message) {
  if (isRefus(message))
    return "refus des filtres de Gemini : Google a bloqué la demande (ça arrive à tort sur du code ou de la sécurité). " +
      "Reformule en relecture de code (robustesse, protection des données des utilisateurs) plutôt qu'en recherche " +
      "d'attaques, découpe en lots plus petits, ou essaie un autre modèle avec -m (les filtres varient d'un modèle " +
      `à l'autre).\n(détail : ${message.replace(/\s+/g, " ").slice(0, 300)})`;
  if (/authentication required|not authenticated|sign.?in|login/i.test(message))
    return `Gemini n'est pas connecté. Lance \`agy\` dans un terminal et connecte-toi avec ton compte Google.\n(détail : ${message})`;
  if (isQuota(message))
    return `quota Gemini atteint pour ce modèle. Réessaie plus tard ou choisis un autre modèle (agy models).\n(détail : ${message})`;
  if (isUnknownModel(message))
    return `ce modèle n'est pas disponible en ce moment (agy models pour la liste de l'abonnement).\n(détail : ${message})`;
  if (isApiDenied(message) && !message.startsWith("accès API refusé"))
    return `accès API refusé : clé GEMINI_API_KEY invalide ou sans facturation activée (Argon n'est pas sur le niveau gratuit).\n(détail : ${message})`;
  return message;
}

// ---------- Journal ----------

function journal(projet, opts, question, result) {
  const dir = join(projet, ".bimind", "journal");
  mkdirSync(dir, { recursive: true });
  const now = new Date();
  const day = now.toLocaleDateString("sv-SE");
  const file = join(dir, `${day}.md`);
  const header = existsSync(file) && statSync(file).size > 0 ? "" : `# Journal Bimind — ${day}\n\n`;
  const meta = [opts.role, result.model || "modèle par défaut", `${result.seconds.toFixed(1)} s`].join(" · ");
  const joints = [...opts.files.map((f) => `fichier \`${f}\``), ...opts.dirs.map((d) => `dossier \`${d}\``)];
  const entry =
    `${header}## ${now.toLocaleTimeString("fr-FR")} — ${meta}\n\n` +
    (result.note ? `> ${result.note}\n\n` : "") +
    `**Demande de Claude**${joints.length ? ` (avec ${joints.join(", ")})` : ""}\n\n${question}\n\n` +
    (result.error ? `**Erreur**\n\n${result.error}\n\n` : `**Réponse de Gemini**\n\n${result.response}\n\n`) +
    `---\n\n`;
  appendFileSync(file, entry, "utf8");
  return file;
}

// ---------- Programme ----------

const opts = parseArgs(process.argv.slice(2));
const projet = opts.projet ? resolve(opts.projet) : findProjectRoot(process.cwd());
const config = { ...readJson(join(MOTEUR, "bimind.config.json")), ...readJson(join(projet, ".bimind", "config.json")) };
if (!opts.effort && config.effort) opts.effort = config.effort;
const { model, fallback } = pickModels(opts, config);

const piped = (await readStdin()).trim();
const mots = opts.words.join(" ").trim();
// Sans question en argument, l'entrée standard est la demande ; sinon, c'est du contenu joint (ex. un diff).
const demande = mots || piped;
if (!demande) fail(`aucune question fournie.\n\n${AIDE}`, 2);
const question = [mots, piped].filter(Boolean).join("\n\n");

const budgetDe = (m) => (m.startsWith("api:") ? BUDGET_API : BUDGET_AGY);
const preparer = (m) => buildPrompt(opts, projet, { demande, entree: mots ? piped : "" }, budgetDe(m), !m.startsWith("api:"));
let envoi = preparer(model);
if (envoi.erreur) fail(envoi.erreur, 2);
const withModel = (r, m) => ({ ...r, model: r.model || m });
let result = withModel(await runModel(opts, model, envoi), model);
const notes = [];
const reason = !result.error ? "" : isQuota(result.error) ? "quota épuisé"
  : isUnknownModel(result.error) ? "modèle indisponible" : isApiDenied(result.error) ? "accès API refusé" : "";
if (reason && fallback && fallback !== model) {
  const first = result;
  const envoiSecours = fallback.startsWith("api:") === model.startsWith("api:") ? envoi : preparer(fallback);
  if (envoiSecours.erreur) result.error += `\n(secours ${fallback} impossible : ${envoiSecours.erreur})`;
  else {
    envoi = envoiSecours;
    result = withModel(await runModel(opts, fallback, envoi), fallback);
    result.seconds += first.seconds;
    notes.push(`${reason[0].toUpperCase()}${reason.slice(1)} sur ${model || "le modèle par défaut"} : bascule sur ${fallback}.`);
  }
}
if (envoi.omis.length)
  notes.push(`${envoi.omis.length} fichier(s) NON transmis faute de place (${ko(envoi.budget)} par appel) : ` +
    `${envoi.omis.join(", ")}. Réponse partielle : relance Bimind sur ces fichiers pour couvrir tout le périmètre.`);
// Lecture par l'espace : on vérifie sur les outils réellement appelés, pas sur ce que Gemini affirme.
const nonLus = envoi.espace ? envoi.espace.map((f) => f.chemin).filter((c) => !(result.lectures ?? []).includes(c)) : [];
if (envoi.espace && !result.error) {
  const total = envoi.espace.reduce((s, f) => s + octets(f.contenu), 0);
  notes.push(`Lecture par l'espace de travail : ${envoi.espace.length - nonLus.length} fichier(s) ouvert(s) par Gemini ` +
    `sur ${envoi.espace.length} (${ko(total)}, trop pour un message)` +
    `${result.relances ? `, après ${result.relances} relance(s) de Bimind pour les fichiers sautés` : ""}.`);
  if (nonLus.length)
    notes.push(`Gemini n'a PAS ouvert ${nonLus.length} fichier(s) : ${nonLus.join(", ")}. Réponse partielle sur eux : ` +
      "relance Bimind sur ces fichiers si leur contenu compte.");
}
if (envoi.volumineux.length)
  notes.push(`Fichiers volumineux écartés de -d (joins-les avec -f s'ils comptent) : ${envoi.volumineux.join(", ")}.`);
for (const n of notes) console.error(`bimind : ${n}`);
if (notes.length) result.note = notes.join("\n> ");
// Un journal impossible à écrire ne doit pas faire perdre une réponse déjà payée en quota.
let journalFile = null;
try { journalFile = journal(projet, opts, question, result); }
catch (err) { console.error(`bimind : journal non écrit (${err.message})`); }

if (opts.out) {
  mkdirSync(dirname(resolve(opts.out)), { recursive: true });
  // Les notes en tête : lu plus tard depuis un appel en arrière-plan, le fichier doit dire s'il est partiel.
  const entete = notes.map((n) => `> Bimind : ${n}\n`).join("") + (notes.length ? "\n" : "");
  writeFileSync(opts.out, entete + (result.error ? `ERREUR : ${result.error}\n` : `${result.response}\n`), "utf8");
}
// Pas de process.exit() ici : après un fetch, Node sous Windows plante (assertion libuv) si on coupe
// le processus pendant la fermeture des sockets. On fixe le code de sortie et on laisse Node finir.
process.exitCode = result.error ? 1 : 0;
if (opts.json) {
  console.log(JSON.stringify({
    ok: !result.error, role: opts.role, model: result.model || null, note: result.note ?? null, seconds: result.seconds,
    usage: result.usage ?? null, response: result.response ?? null, error: result.error ?? null,
    omis: envoi.omis, volumineux: envoi.volumineux, mode: envoi.espace ? "espace" : "message", non_lus: nonLus,
    projet, journal: journalFile,
  }, null, 2));
} else if (result.error) console.error(`bimind : ${result.error}`);
else console.log(result.response);
