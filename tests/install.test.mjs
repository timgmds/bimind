// Tests de l'installeur, dans un faux dossier ~/.claude (BIMIND_CLAUDE_DIR).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MOTEUR = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS = readdirSync(join(MOTEUR, "skills"));

function installer(claudeDir, ...args) {
  const r = spawnSync(process.execPath, [join(MOTEUR, "install.mjs"), ...args], {
    encoding: "utf8", env: { ...process.env, BIMIND_CLAUDE_DIR: claudeDir },
  });
  assert.equal(r.status, 0, r.stderr);
}

test("installe les commandes avec le chemin réel du pont", () => {
  const dir = mkdtempSync(join(tmpdir(), "bimind-claude-"));
  installer(dir);
  const pont = join(MOTEUR, "bimind.mjs").replaceAll("\\", "/");
  for (const nom of SKILLS) {
    const skill = readFileSync(join(dir, "skills", nom, "SKILL.md"), "utf8");
    assert.match(skill, new RegExp(`^---\\nname: ${nom}\\n`));
    assert.ok(!skill.includes("{{BIMIND}}"), nom);
  }
  assert.ok(readFileSync(join(dir, "skills", "bimind-securite", "SKILL.md"), "utf8").includes(pont));
  assert.ok(readFileSync(join(dir, "CLAUDE.md"), "utf8").includes(pont));
});

test("préserve le CLAUDE.md existant et ne duplique pas le bloc", () => {
  const dir = mkdtempSync(join(tmpdir(), "bimind-claude-"));
  writeFileSync(join(dir, "CLAUDE.md"), "# Mes règles\n\nToujours tutoyer.\n");
  installer(dir);
  installer(dir);
  const md = readFileSync(join(dir, "CLAUDE.md"), "utf8");
  assert.match(md, /^# Mes règles\n\nToujours tutoyer\./);
  assert.equal(md.match(/bimind:debut/g).length, 1);
  assert.equal(md.match(/bimind:fin/g).length, 1);
});

test("la désinstallation rend le CLAUDE.md d'origine et retire les commandes", () => {
  const dir = mkdtempSync(join(tmpdir(), "bimind-claude-"));
  writeFileSync(join(dir, "CLAUDE.md"), "# Mes règles\n");
  installer(dir);
  installer(dir, "--desinstaller");
  assert.equal(readFileSync(join(dir, "CLAUDE.md"), "utf8"), "# Mes règles\n");
  for (const nom of SKILLS) assert.equal(existsSync(join(dir, "skills", nom)), false);
});

test("des marqueurs dans le désordre ne tronquent pas le CLAUDE.md", () => {
  const dir = mkdtempSync(join(tmpdir(), "bimind-claude-"));
  writeFileSync(join(dir, "CLAUDE.md"), "Règle A\n<!-- bimind:fin -->\nRègle B\n");
  installer(dir);
  const md = readFileSync(join(dir, "CLAUDE.md"), "utf8");
  assert.match(md, /Règle A[\s\S]*Règle B/);
  assert.match(md, /Bimind Code — second esprit Gemini/);
});

test("la désinstallation supprime un CLAUDE.md créé par Bimind seul", () => {
  const dir = mkdtempSync(join(tmpdir(), "bimind-claude-"));
  installer(dir);
  installer(dir, "--desinstaller");
  assert.equal(existsSync(join(dir, "CLAUDE.md")), false);
});
