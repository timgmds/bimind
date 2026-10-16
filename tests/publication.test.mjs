// Garde-fou de publication : aucun fichier publiable ne contient de donnée personnelle ni de secret.
// Publiable = ce que git suivrait (hors .gitignore) ; sans git, tout le dossier sauf .bimind/ et node_modules/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");

function publiables() {
  const git = spawnSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: RACINE, encoding: "utf8" });
  if (git.status === 0 && git.stdout) return git.stdout.split("\0").filter(Boolean);
  const fichiers = [];
  const parcourir = (dir) => {
    for (const e of readdirSync(join(RACINE, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) { if (![".git", ".bimind", "node_modules"].includes(e.name)) parcourir(rel); }
      else fichiers.push(rel);
    }
  };
  parcourir("");
  return fichiers;
}

const INTERDITS = [
  ["chemin personnel Windows", /[A-Za-z]:\\(Users|Documents and Settings)\\(?!<)[^\\\s"'`]+/i],
  ["chemin personnel Windows (slash)", /[A-Za-z]:\/Users\/(?!<)[^/\s"'`]+/i],
  ["dossier personnel Unix", /\/(home|Users)\/(?!<|runner\b)[a-z][\w.-]+\//],
  ["adresse e-mail", /[\w.+-]+@(?!example\.|anthropic\.com|users\.noreply\.github\.com)[\w-]+\.[a-z]{2,}/i],
  ["clé API Google", /AIza[0-9A-Za-z_-]{30,}/],
  ["jeton GitHub", /gh[pousr]_[0-9A-Za-z]{30,}/],
  ["clé privée", /-----BEGIN [A-Z ]*PRIVATE KEY-----(?!")/],
];

test("aucun journal ni échange avec Gemini n'est publiable", () => {
  assert.deepEqual(publiables().filter((f) => f.startsWith(".bimind/")), []);
});

test("aucun fichier publiable ne contient de donnée personnelle ni de secret", () => {
  const fuites = [];
  for (const f of publiables()) {
    if (f === "tests/publication.test.mjs") continue; // contient les motifs eux-mêmes
    const texte = readFileSync(join(RACINE, f), "utf8");
    for (const [nom, motif] of INTERDITS) {
      const m = texte.match(motif);
      if (m) fuites.push(`${f} : ${nom} (« ${m[0]} »)`);
    }
  }
  assert.deepEqual(fuites, []);
});
