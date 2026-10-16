#!/usr/bin/env node
// Installe Bimind Code pour Claude Code, dans tous les projets :
//  - les commandes (skills) de ./skills dans ~/.claude/skills/
//  - le bloc d'instructions claude-global.md dans ~/.claude/CLAUDE.md (entre deux marqueurs, le reste du fichier est préservé)
// Le chemin du pont est inscrit en dur : relancer l'installation si le dossier Bimind est déplacé ou mis à jour.
//
//   node install.mjs                 installe ou met à jour
//   node install.mjs --desinstaller  retire tout ce que Bimind a installé

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MOTEUR = dirname(fileURLToPath(import.meta.url));
const PONT = join(MOTEUR, "bimind.mjs").replaceAll("\\", "/");
const CLAUDE_DIR = process.env.BIMIND_CLAUDE_DIR || join(homedir(), ".claude");
const SKILLS_DIR = join(CLAUDE_DIR, "skills");
const CLAUDE_MD = join(CLAUDE_DIR, "CLAUDE.md");
const DEBUT = "<!-- bimind:debut — géré par Bimind (install.mjs), ne pas modifier à la main -->";
const FIN = "<!-- bimind:fin -->";

const skills = readdirSync(join(MOTEUR, "skills"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
const remplir = (texte) => texte.replaceAll("{{BIMIND}}", PONT);

function retirerBloc(texte) {
  const debut = texte.indexOf(DEBUT);
  const fin = texte.indexOf(FIN);
  if (debut === -1 || fin <= debut) return texte; // marqueurs absents ou dans le désordre : ne rien tronquer
  return (texte.slice(0, debut).trimEnd() + "\n\n" + texte.slice(fin + FIN.length).trimStart()).trim();
}

const reste = existsSync(CLAUDE_MD) ? retirerBloc(readFileSync(CLAUDE_MD, "utf8")) : "";

if (process.argv.includes("--desinstaller")) {
  for (const nom of skills) rmSync(join(SKILLS_DIR, nom), { recursive: true, force: true });
  // CLAUDE.md n'existait pas avant Bimind s'il ne reste rien d'autre que notre bloc
  if (reste) writeFileSync(CLAUDE_MD, reste + "\n", "utf8");
  else rmSync(CLAUDE_MD, { force: true });
  console.log(`Bimind désinstallé : ${skills.length} commandes retirées de ${SKILLS_DIR}, bloc retiré de ${CLAUDE_MD}.`);
  process.exit(0);
}

for (const nom of skills) {
  mkdirSync(join(SKILLS_DIR, nom), { recursive: true });
  writeFileSync(join(SKILLS_DIR, nom, "SKILL.md"), remplir(readFileSync(join(MOTEUR, "skills", nom, "SKILL.md"), "utf8")), "utf8");
}

const bloc = `${DEBUT}\n${remplir(readFileSync(join(MOTEUR, "claude-global.md"), "utf8")).trim()}\n${FIN}`;
mkdirSync(CLAUDE_DIR, { recursive: true });
writeFileSync(CLAUDE_MD, (reste ? `${reste}\n\n` : "") + bloc + "\n", "utf8");

console.log(`Bimind Code installé.
  Commandes : ${skills.map((s) => "/" + s).join(", ")}  ->  ${SKILLS_DIR}
  Instructions globales  ->  ${CLAUDE_MD}
  Pont  ->  ${PONT}
Ouvre une nouvelle session Claude Code dans n'importe quel projet, puis tape /bimind-init.`);
