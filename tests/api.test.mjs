// Tests de la voie API Gemini (modèles "api:…") contre un faux serveur local : aucun appel réel, aucun coût.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ICI = dirname(fileURLToPath(import.meta.url));
const PONT = join(ICI, "..", "bimind.mjs");
const CLE = "cle-de-test-123";
let serveur, url, derniere;

before(async () => {
  serveur = createServer((req, res) => {
    let corps = "";
    req.on("data", (c) => (corps += c));
    req.on("end", () => {
      derniere = { headers: req.headers, body: JSON.parse(corps) };
      const repondre = (code, data) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
      const { model, input } = derniere.body;
      if (req.headers["x-goog-api-key"] !== CLE) return repondre(400, { error: { code: 400, message: "API key not valid. Please pass a valid API key." } });
      if (model.includes("epuise")) return repondre(429, { error: { code: 429, message: "Resource has been exhausted (e.g. check quota).", status: "RESOURCE_EXHAUSTED" } });
      if (model.includes("inconnu")) return repondre(404, { error: { code: 404, message: `models/${model} is not found for API version v1beta` } });
      // format réellement renvoyé par Google pour certaines erreurs : une liste
      if (model.includes("facturation")) return repondre(403, [{ error: { code: 403, message: "Billing must be enabled to use this model.", status: "PERMISSION_DENIED" } }]);
      repondre(200, {
        id: "int_1", object: "interaction", status: "completed", model,
        steps: [{ type: "thought", content: [] }, { type: "model_output", content: [{ type: "text", text: `ARGON(${model}) a lu ${input.length} caractères` }] }],
        usage: { total_input_tokens: 100, total_output_tokens: 20, total_thought_tokens: 30, total_cached_tokens: 0, total_tokens: 150 },
      });
    });
  });
  await new Promise((ok) => serveur.listen(0, "127.0.0.1", ok));
  url = `http://127.0.0.1:${serveur.address().port}/v1beta/interactions`;
});
after(() => serveur.close());

function projet(config, fichiers = {}) {
  const racine = mkdtempSync(join(tmpdir(), "bimind-api-"));
  for (const [chemin, contenu] of Object.entries({ ".bimind/config.json": JSON.stringify(config), ...fichiers })) {
    mkdirSync(dirname(join(racine, chemin)), { recursive: true });
    writeFileSync(join(racine, chemin), contenu);
  }
  return racine;
}

// spawn asynchrone : le faux serveur tourne dans ce processus et doit pouvoir répondre pendant l'appel
function bimind(args, { cwd, cle = CLE }) {
  const env = { ...process.env, BIMIND_GEMINI_API_URL: url, BIMIND_AGY: join(ICI, "agy-simulateur.mjs") };
  if (cle) env.GEMINI_API_KEY = cle; else delete env.GEMINI_API_KEY;
  return new Promise((ok) => {
    const child = spawn(process.execPath, [PONT, ...args], { cwd, env });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => ok({ code, out, err }));
    child.stdin.end();
  });
}

const CONFIG = { modele: "api:gemini-4-argon", modeleRapide: "rapide-test", modeleSecours: "secours-test", effort: "" };

test("un modèle api: passe par l'API Gemini, sans conservation côté Google", async () => {
  const racine = projet(CONFIG, { ".bimind/contexte.md": "MEMOIRE_PROJET" });
  const r = await bimind(["--json", "-e", "max", "q"], { cwd: racine });
  assert.equal(r.code, 0, r.err);
  const data = JSON.parse(r.out);
  assert.match(data.response, /^ARGON\(gemini-4-argon\)/);
  assert.equal(data.model, "api:gemini-4-argon");
  assert.equal(data.usage.total_tokens, 150);
  assert.equal(derniere.body.model, "gemini-4-argon");
  assert.equal(derniere.body.store, false);
  assert.equal(derniere.body.generation_config.thinking_level, "high");
  assert.match(derniere.body.input, /MEMOIRE_PROJET/);
});

test("les rôles rapides restent sur l'abonnement", async () => {
  const r = await bimind(["-r", "cartographe", "q"], { cwd: projet(CONFIG) });
  assert.match(r.out, /MODELE=rapide-test/);
});

test("sans clé API : bascule sur le secours de l'abonnement", async () => {
  const r = await bimind(["q"], { cwd: projet(CONFIG), cle: "" });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /MODELE=secours-test/);
  assert.match(r.err, /Accès API refusé sur api:gemini-4-argon/);
});

test("clé invalide : bascule, et la clé n'apparaît nulle part", async () => {
  const racine = projet(CONFIG);
  const r = await bimind(["q"], { cwd: racine, cle: "mauvaise-cle-secrete" });
  assert.match(r.out, /MODELE=secours-test/);
  const journal = readdirSync(join(racine, ".bimind", "journal")).map((f) => readFileSync(join(racine, ".bimind", "journal", f), "utf8")).join("");
  for (const texte of [r.out, r.err, journal]) assert.ok(!texte.includes("mauvaise-cle-secrete"));
});

test("quota API épuisé : bascule sur le secours", async () => {
  const r = await bimind(["q"], { cwd: projet({ ...CONFIG, modele: "api:argon-epuise" }) });
  assert.match(r.out, /MODELE=secours-test/);
  assert.match(r.err, /Quota épuisé sur api:argon-epuise/);
});

test("modèle API inconnu : bascule sur le secours", async () => {
  const r = await bimind(["q"], { cwd: projet({ ...CONFIG, modele: "api:argon-inconnu" }) });
  assert.match(r.out, /MODELE=secours-test/);
  assert.match(r.err, /Modèle indisponible sur api:argon-inconnu/);
});

test("erreur Google sous forme de liste : message lisible", async () => {
  const r = await bimind(["-m", "api:argon-facturation", "q"], { cwd: projet(CONFIG) });
  assert.equal(r.code, 1);
  assert.match(r.err, /sans facturation activée/);
  assert.match(r.err, /HTTP 403 : Billing must be enabled/);
});

// L'API n'a pas d'outils : un -d trop gros remplit le message (3 Mo) et le reste est listé, code d'abord.
const fichier99 = (n) => (`// ${n}\n` + `const v = "${n}";\n`.repeat(7_000)).slice(0, 99_000);

test("par l'API, -d remplit la place, le code d'abord, et les fichiers qui ne tiennent pas sont listés", async () => {
  const fichiers = { "a-styles.css": `.x{}\n`.repeat(19_000), "b-doc.md": "# doc\n".repeat(1_500) };
  for (let i = 0; i < 30; i++) fichiers[`src/m${String(i).padStart(2, "0")}.js`] = fichier99(`M${i}`);
  const racine = projet(CONFIG, fichiers); // 30 × 99 ko de code + 95 ko de styles + 9 ko de doc > 3 Mo
  const r = await bimind(["--json", "-o", "sortie.md", "-d", ".", "q"], { cwd: racine });
  assert.equal(r.code, 0, r.err);
  const data = JSON.parse(r.out);
  assert.equal(data.mode, "message");
  assert.deepEqual(data.omis, ["a-styles.css"]); // dans l'ordre alphabétique, ce serait un fichier de code
  assert.ok(Buffer.byteLength(derniere.body.input) <= 3_000_000);
  assert.match(derniere.body.input, /NON transmis faute de place dans ce message : a-styles\.css/);
  assert.match(r.err, /1 fichier\(s\) NON transmis faute de place \(3000 ko par appel\) : a-styles\.css/);
  assert.match(readFileSync(join(racine, "sortie.md"), "utf8"), /^> Bimind : 1 fichier\(s\) NON transmis/);
});

test("par l'API, le budget est celui de la fenêtre de Gemini, pas la limite d'Antigravity", async () => {
  const code = `const x = "API";\n`.repeat(4_000); // 68 ko chacun, 204 ko au total
  const racine = projet(CONFIG, { "src/a.js": code, "src/b.js": code, "src/c.js": code });
  const r = await bimind(["--json", "-d", "src", "q"], { cwd: racine });
  assert.equal(r.code, 0, r.err);
  const data = JSON.parse(r.out);
  assert.deepEqual(data.omis, []);
  assert.ok(derniere.body.input.length > 204_000);
});

test("-m api:… sans secours : erreur claire", async () => {
  const r = await bimind(["-m", "api:gemini-4-argon", "q"], { cwd: projet(CONFIG), cle: "" });
  assert.equal(r.code, 1);
  assert.match(r.err, /GEMINI_API_KEY absente/);
});
