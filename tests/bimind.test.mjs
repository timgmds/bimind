// Tests du pont Bimind contre le simulateur d'agy (aucun quota consommé).
//   npm.cmd test   (ou : node --test tests/bimind.test.mjs)
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ICI = dirname(fileURLToPath(import.meta.url));
const PONT = join(ICI, "..", "bimind.mjs");
const SIMULATEUR = join(ICI, "agy-simulateur.mjs");
const CONFIG = { modele: "fort-test", modeleRapide: "rapide-test", modeleSecours: "secours-test", effort: "" };

function projet(fichiers = {}, config = CONFIG) {
  const racine = mkdtempSync(join(tmpdir(), "bimind-test-"));
  for (const [chemin, contenu] of Object.entries({ ".bimind/config.json": JSON.stringify(config), ...fichiers })) {
    mkdirSync(dirname(join(racine, chemin)), { recursive: true });
    writeFileSync(join(racine, chemin), contenu);
  }
  return racine;
}

function bimind(args, { cwd, stdin = "" }) {
  const r = spawnSync(process.execPath, [PONT, ...args], {
    cwd, input: stdin, encoding: "utf8", env: { ...process.env, BIMIND_AGY: SIMULATEUR },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const journalDe = (racine) => {
  const dir = join(racine, ".bimind", "journal");
  return existsSync(dir) ? readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8")).join("") : "";
};

test("répond et consigne l'échange dans le journal du projet", () => {
  const racine = projet();
  const r = bimind(["Bonjour \"Gemini\" & | <test>"], { cwd: racine });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /MODELE=fort-test/);
  assert.match(r.out, /Bonjour "Gemini" & \| <test>/);
  assert.match(journalDe(racine), /Réponse de Gemini/);
});

test("trouve la racine du projet depuis un sous-dossier", () => {
  const racine = projet({ "src/app.js": "x" });
  assert.equal(bimind(["q"], { cwd: join(racine, "src") }).code, 0);
  assert.match(journalDe(racine), /Demande de Claude/);
  assert.equal(existsSync(join(racine, "src", ".bimind")), false);
});

test("Gemini travaille dans un espace jetable, hors du projet", () => {
  const racine = projet();
  const cwd = bimind(["q"], { cwd: racine }).out.match(/^CWD=(.*)$/m)[1];
  assert.ok(!cwd.startsWith(racine), cwd);
  assert.match(cwd, /bimind-espace/);
});

test("joint la mémoire partagée, sauf avec --sans-contexte", () => {
  const racine = projet({ ".bimind/contexte.md": "Architecture hexagonale", ".bimind/decisions.md": "On garde Postgres" });
  const avec = bimind(["q"], { cwd: racine }).out;
  assert.match(avec, /Architecture hexagonale/);
  assert.match(avec, /On garde Postgres/);
  assert.doesNotMatch(bimind(["--sans-contexte", "q"], { cwd: racine }).out, /hexagonale|Postgres/);
});

test("les rôles rapides utilisent modeleRapide, les autres le modèle fort", () => {
  const racine = projet();
  assert.match(bimind(["-r", "cartographe", "q"], { cwd: racine }).out, /MODELE=rapide-test/);
  assert.match(bimind(["-r", "recherche", "q"], { cwd: racine }).out, /MODELE=rapide-test/);
  assert.match(bimind(["-r", "auditeur", "q"], { cwd: racine }).out, /MODELE=fort-test/);
  assert.match(bimind(["-r", "verificateur", "q"], { cwd: racine }).out, /MODELE=fort-test/);
});

test("bascule sur le secours quand le quota est épuisé", () => {
  const racine = projet({}, { ...CONFIG, modele: "argon-epuise" });
  const r = bimind(["q"], { cwd: racine });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /MODELE=secours-test/);
  assert.match(r.err, /Quota épuisé sur argon-epuise/);
  assert.match(journalDe(racine), /bascule sur secours-test/);
});

test("bascule sur le secours quand le modèle est absent d'Antigravity", () => {
  const racine = projet({}, { ...CONFIG, modele: "argon-inconnu" });
  const r = bimind(["q"], { cwd: racine });
  assert.match(r.out, /MODELE=secours-test/);
  assert.match(r.err, /Modèle indisponible sur argon-inconnu/);
});

test("-m force un modèle, sans secours", () => {
  const r = bimind(["-m", "force-epuise", "q"], { cwd: projet() });
  assert.equal(r.code, 1);
  assert.match(r.err, /quota Gemini atteint/);
});

test("l'effort de la config est transmis, -e le remplace", () => {
  const racine = projet({}, { ...CONFIG, effort: "high" });
  assert.match(bimind(["q"], { cwd: racine }).out, /EFFORT=high/);
  assert.match(bimind(["-e", "low", "q"], { cwd: racine }).out, /EFFORT=low/);
});

test("-d joint le code, exclut dépendances et secrets, et signale les secrets", () => {
  const racine = projet({
    "src/app.js": "const app = 'CODE_APP';",
    ".env": "SECRET=abc123",
    ".env.local": "TOKEN=xyz789",
    ".env.example": "SECRET=a-remplir",
    "cles/serveur.pem": "-----BEGIN PRIVATE KEY-----",
    "node_modules/lib/index.js": "DEPENDANCE",
    "package-lock.json": "VERROU",
  });
  const r = bimind(["-r", "auditeur", "-d", ".", "q"], { cwd: racine });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /CODE_APP/);
  assert.match(r.out, /a-remplir/);
  for (const absent of ["abc123", "xyz789", "BEGIN PRIVATE KEY", "DEPENDANCE", "VERROU"]) assert.ok(!r.out.includes(absent), absent);
  assert.match(r.out, /NON transmis \(secrets\) : .*\.env/);
  assert.match(r.out, /cles\/serveur\.pem/);
});

test("-d exclut aussi les autres formats de secrets, mais garde le code qui les manipule", () => {
  const racine = projet({
    ".envrc": "export K=s1",
    ".git-credentials": "https://u:s2@host",
    "config/credentials.yml": "s3",
    "config/secrets.json": "s4",
    "putty.ppk": "s5",
    "src/secrets.ts": "export const lireSecret = 'CODE_OK';",
  });
  const r = bimind(["-d", ".", "q"], { cwd: racine });
  assert.match(r.out, /CODE_OK/);
  for (const secret of ["s1", "s2", "s3", "s4", "s5"]) assert.doesNotMatch(r.out, new RegExp(`\\b${secret}\\b`), secret);
});

test("-d écarte les gros fichiers de données et les fichiers générés, et le signale", () => {
  const racine = projet({
    "src/a.js": "PETIT",
    "src/config.json": '{"PETIT_JSON": true}',
    "public/data/mots.json": `["${"mot".repeat(15_000)}"]`,
    "public/bundle.js": "GENERE".repeat(20_000),
  });
  const r = bimind(["--json", "-d", ".", "q"], { cwd: racine });
  const data = JSON.parse(r.out);
  assert.match(data.response, /PETIT_JSON/);
  assert.ok(!data.response.includes("motmotmot") && !data.response.includes("GENEREGENERE"));
  assert.match(data.response, /volumineux NON transmis .*public\/data\/mots\.json \(46 ko\)/);
  assert.match(data.response, /volumineux NON transmis .*public\/bundle\.js \(120 ko\)/);
  assert.equal(data.volumineux.length, 2);
  assert.match(r.err, /volumineux écartés/);
});

test("la demande passe avant le contenu joint et est rappelée après", () => {
  const racine = projet({ "src/a.js": "CONTENU_A" });
  const out = bimind(["-f", "src/a.js", "-d", "src", "QUESTION_ICI"], { cwd: racine }).out;
  const premiere = out.indexOf("QUESTION_ICI"), contenu = out.indexOf("CONTENU_A");
  assert.ok(premiere > 0 && premiere < contenu, "demande en tête");
  assert.ok(out.lastIndexOf("QUESTION_ICI") > out.lastIndexOf("CONTENU_A"), "rappel en fin");
  // sans contenu joint, pas de rappel
  assert.equal(bimind(["--sans-contexte", "SEULE"], { cwd: racine }).out.split("SEULE").length, 2);
});

test("le diff reçu par stdin est joint après la demande", () => {
  const out = bimind(["Relis ce diff"], { cwd: projet(), stdin: "+ligne ajoutée" }).out;
  assert.ok(out.indexOf("Relis ce diff") < out.indexOf("----- Entrée standard -----\n+ligne ajoutée"));
});

// 80 ko : deux tiennent dans un message de 180 ko, pas trois
const code80 = (n) => (`// ${n}\n` + `const x = "${n}";\n`.repeat(8_000)).slice(0, 80_000);

test("projet trop gros pour un message : Gemini le lit dans son espace de travail, puis l'espace est effacé", () => {
  const racine = projet({
    "src/a.js": code80("FICHIER_A"), "src/b.js": code80("FICHIER_B"), "src/c.js": code80("FICHIER_C"),
    "src/.env": "SECRET=abc123", "src/data/mots.json": `["${"mot".repeat(15_000)}"]`,
  });
  const r = bimind(["--json", "-o", "sortie.md", "-d", "src", "q"], { cwd: racine });
  assert.equal(r.code, 0, r.err);
  const data = JSON.parse(r.out);
  assert.equal(data.mode, "espace");
  assert.deepEqual(data.omis, []);
  assert.deepEqual(data.non_lus, []);
  for (const n of ["A", "B", "C"]) assert.match(data.response, new RegExp(`LU src/${n.toLowerCase()}\\.js => // FICHIER_${n}`));
  assert.ok(!data.response.includes("abc123") && !data.response.includes("motmotmot"), "ni secrets ni données copiés");
  assert.ok(Buffer.byteLength(data.response) < 180_000, "le message ne porte que la liste");
  assert.match(data.response, /lis-les TOUS, en entier/);
  assert.match(r.err, /Lecture par l'espace de travail : 3 fichier\(s\) ouvert\(s\) par Gemini sur 3/);
  assert.match(readFileSync(join(racine, "sortie.md"), "utf8"), /^> Bimind : Lecture par l'espace de travail/);
  const espace = data.response.match(/^CWD=(.*)$/m)[1];
  assert.ok(!espace.startsWith(racine) && !existsSync(espace), "espace jetable, hors du projet, effacé après l'appel");
});

test("lecture par l'espace : Gemini qui saute des fichiers est relancé dans la même conversation", () => {
  const racine = projet({ "src/a.js": code80("A"), "src/b.js": code80("B"), "src/c.js": code80("C") }, { ...CONFIG, modele: "flash-paresseux" });
  const r = bimind(["--json", "-d", "src", "q"], { cwd: racine });
  assert.equal(r.code, 0, r.err);
  const data = JSON.parse(r.out);
  assert.deepEqual(data.non_lus, []);
  assert.match(data.response, /^TOUR=2$/m); // la réponse gardée est celle d'après la relance
  assert.match(data.response, /^Tu n'as pas ouvert 2 des 3 fichiers de ton espace de travail : src\/b\.js, src\/c\.js\./m);
  assert.match(r.err, /3 fichier\(s\) ouvert\(s\) par Gemini sur 3 .*après 1 relance\(s\) de Bimind/);
});

test("lecture par l'espace : après deux relances, les fichiers jamais ouverts sont signalés", () => {
  const racine = projet({ "src/a.js": code80("A"), "src/b.js": code80("B"), "src/c.js": code80("C") }, { ...CONFIG, modele: "flash-obstine" });
  const r = bimind(["--json", "-d", "src", "q"], { cwd: racine });
  const data = JSON.parse(r.out);
  assert.match(data.response, /^TOUR=3$/m);
  assert.deepEqual(data.non_lus, ["src/b.js", "src/c.js"]);
  assert.match(r.err, /Gemini n'a PAS ouvert 2 fichier\(s\) : src\/b\.js, src\/c\.js/);
});

test("--espace force la lecture par l'espace pour un petit dossier", () => {
  const racine = projet({ "src/a.js": "PETIT" });
  const data = JSON.parse(bimind(["--json", "--espace", "-d", "src", "q"], { cwd: racine }).out);
  assert.equal(data.mode, "espace");
  assert.match(data.response, /LU src\/a\.js => PETIT/);
  assert.equal(JSON.parse(bimind(["--json", "-d", "src", "q"], { cwd: racine }).out).mode, "message");
});

test("garde : une lecture hors de l'espace de travail coupe l'appel avant que le contenu reparte", () => {
  const cible = join(tmpdir(), "bimind-hors-espace-test.txt");
  writeFileSync(cible, "FUITE-4821");
  const racine = projet({}, { ...CONFIG, modele: "flash-fouineur" });
  const r = bimind(["--json", "q"], { cwd: racine });
  assert.equal(r.code, 1);
  const data = JSON.parse(r.out);
  assert.match(data.error, /^appel interrompu par Bimind : Gemini a voulu utiliser view_file hors de son espace de travail/);
  assert.ok(!r.out.includes("FUITE-4821") && !journalDe(racine).includes("FUITE-4821"));
  assert.equal(data.model, "flash-fouineur"); // pas de bascule sur le secours
});

test("garde : une commande refusée par Antigravity ne coupe pas l'appel", () => {
  const r = bimind(["-m", "flash-commande", "q"], { cwd: projet() });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /MODELE=flash-commande/);
});

test("garde : une commande qui s'exécute ou un outil risqué coupe l'appel", () => {
  const r = bimind(["-m", "flash-commande-executee", "q"], { cwd: projet() });
  assert.equal(r.code, 1);
  assert.match(r.err, /appel interrompu par Bimind : Gemini a voulu utiliser run_command exécuté \(Antigravity ne l'a pas refusé/);
  assert.doesNotMatch(r.out, /COMMANDE EXÉCUTÉE/);
  const s = bimind(["-m", "flash-sousagent", "q"], { cwd: projet() });
  assert.equal(s.code, 1);
  assert.match(s.err, /outil non autorisé : invoke_subagent/);
  assert.doesNotMatch(s.out, /SOUS-AGENT/);
});

test("budget d'Antigravity : mémoire, -f ou stdin trop gros sont refusés avant tout appel", () => {
  const racine = projet({ "gros.js": "x".repeat(200_000) });
  const r = bimind(["-f", "gros.js", "q"], { cwd: racine });
  assert.equal(r.code, 2);
  assert.match(r.err, /trop de contenu pour un seul appel : 20\d ko .*180 ko au plus \(au-delà, Antigravity tronque/);
  assert.equal(journalDe(racine), "");
  assert.equal(bimind(["q"], { cwd: racine, stdin: "y".repeat(200_000) }).code, 2);
});

test("refus des filtres de Gemini : erreur claire, sans bascule, au lieu d'une fausse réponse", () => {
  const racine = projet({}, { ...CONFIG, modele: "flash-filtre" });
  const r = bimind(["--json", "q"], { cwd: racine });
  assert.equal(r.code, 1);
  const data = JSON.parse(r.out);
  assert.equal(data.ok, false);
  assert.equal(data.response, null);
  assert.match(data.error, /^refus des filtres de Gemini/);
  assert.equal(data.model, "flash-filtre"); // pas de bascule : le secours serait filtré de la même façon
  assert.match(journalDe(racine), /\*\*Erreur\*\*\n\nrefus des filtres/);
  assert.match(bimind(["-m", "x-filtre", "q"], { cwd: racine }).err, /Reformule en relecture de code/);
});

test("-f refuse un dossier ou un binaire", () => {
  const racine = projet({ "src/a.js": "x", "image.bin": "AB\0CD" });
  assert.equal(bimind(["-f", "src", "q"], { cwd: racine }).code, 2);
  assert.equal(bimind(["-f", "image.bin", "q"], { cwd: racine }).code, 2);
});

test("-- permet une question qui commence par un tiret", () => {
  const r = bimind(["-r", "critique", "--", "-question qui commence par un tiret"], { cwd: projet() });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /-question qui commence par un tiret/);
});

test("un journal impossible à écrire ne fait pas perdre la réponse", () => {
  const racine = projet({ ".bimind/journal": "un fichier à la place du dossier" });
  const r = bimind(["q"], { cwd: racine });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /MODELE=fort-test/);
  assert.match(r.err, /journal non écrit/);
});

test("-d respecte le .gitignore d'un dépôt git", { skip: spawnSync("git", ["--version"]).status !== 0 }, () => {
  const racine = projet({ ".gitignore": "genere/\n", "genere/x.js": "NE_PAS_VOIR", "src/a.js": "A_VOIR" });
  spawnSync("git", ["init", "-q"], { cwd: racine });
  const r = bimind(["-d", ".", "q"], { cwd: racine });
  assert.match(r.out, /A_VOIR/);
  assert.doesNotMatch(r.out, /NE_PAS_VOIR/);
});

test("-f refuse un fichier de secrets", () => {
  const racine = projet({ ".env": "SECRET=abc123" });
  const r = bimind(["-f", ".env", "q"], { cwd: racine });
  assert.equal(r.code, 2);
  assert.doesNotMatch(r.out, /abc123/);
});

test("combine la question et stdin", () => {
  const r = bimind(["question en argument"], { cwd: projet(), stdin: "diff reçu par stdin" });
  assert.match(r.out, /question en argument/);
  assert.match(r.out, /diff reçu par stdin/);
});

test("--json et -o donnent la réponse, le modèle et le journal", () => {
  const racine = projet();
  const r = bimind(["--json", "-o", "sortie/rep.md", "q"], { cwd: racine });
  const data = JSON.parse(r.out);
  assert.equal(data.ok, true);
  assert.equal(data.model, "fort-test");
  assert.ok(data.journal.startsWith(racine));
  assert.match(readFileSync(join(racine, "sortie", "rep.md"), "utf8"), /MODELE=fort-test/);
});

test("agy introuvable : message clair", () => {
  const r = spawnSync(process.execPath, [PONT, "q"], {
    cwd: projet(), encoding: "utf8", env: { ...process.env, BIMIND_AGY: join(tmpdir(), "absent", "agy.exe") },
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /agy\) introuvable/);
});

test("options invalides refusées", () => {
  const racine = projet();
  assert.equal(bimind(["-r", "inexistant", "q"], { cwd: racine }).code, 2);
  assert.equal(bimind(["-e", "extreme", "q"], { cwd: racine }).code, 2);
  assert.equal(bimind([], { cwd: racine }).code, 2);
});
