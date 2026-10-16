// Simulateur d'agy pour les tests : même format de sortie stream-json que le vrai.
// Comme agy, il traite un message par ligne d'entrée standard (un tour chacun, même conversation) et s'arrête
// quand l'entrée se ferme. Répond "MODELE=<modèle>" puis le message reçu (écho), pour que les tests vérifient ce
// que Gemini aurait vu.
// Un modèle contenant "epuise" simule un quota épuisé, "inconnu" un modèle absent d'Antigravity, "filtre" un refus
// des filtres de Google (texte réel, renvoyé par agy comme une réponse réussie).
// Lecture par l'espace : le simulateur ouvre les fichiers de son dossier courant avec view_file (événements tool
// ACTIVE puis DONE, comme agy) et recopie leur début. "paresseux" n'ouvre que le premier, puis le reste quand on le
// relance ; "obstine" n'ouvre jamais que le premier. "fouineur" tente de lire un fichier hors de l'espace,
// "sousagent" de lancer un sous-agent, "commande" une commande (refusée comme par le vrai agy, ou exécutée avec
// "commande-executee") ; le simulateur attend 1,5 s après l'annonce de l'outil pour vérifier que le pont coupe
// l'appel avant toute réponse (le vrai agy, lui, exécute aussitôt).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : "defaut-agy";
const effort = args.includes("--effort") ? args[args.indexOf("--effort") + 1] : "";
const out = (event, body) => console.log(JSON.stringify({ event, [event]: body }));
const pause = () => new Promise((ok) => setTimeout(ok, 1500));
let etape = 0;
const outil = (state, tool_name, parameters, output) =>
  out("step_update", { step_index: state === "ACTIVE" ? ++etape : etape, state, step_type: "tool", tool_name,
    tool_info: { name: tool_name, parameters, ...(output ? { output } : {}) } });

const fichiersEspace = () => {
  const fichiers = [];
  const parcourir = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory()) parcourir(join(dir, e.name)); else fichiers.push(join(dir, e.name));
    }
  };
  parcourir(process.cwd());
  return fichiers;
};
const dejaLus = new Set();

async function tour(prompt, numero) {
  if (model.includes("epuise")) {
    out("result", { status: "ERROR", response: "", error: `RESOURCE_EXHAUSTED: quota exceeded for ${model}` });
    process.exit(1);
  }
  if (model.includes("inconnu")) {
    out("result", { status: "ERROR", response: "", error: `invalid model selection (--model "${model}"): model ${model} is not recognized as a known model` });
    process.exit(1);
  }
  if (model.includes("filtre")) {
    const refus = "This request was blocked by Gemini's filters. They can occasionally trigger by mistake on safe coding, " +
      "security, or biology-related queries. Please try rephrasing your prompt. You can [send feedback](https://ai.google.dev/" +
      "gemini-api/docs/troubleshooting#file-bug) or read more about [our policies here](https://policies.google.com/terms/" +
      "generative-ai/use-policy).";
    return out("result", { status: "SUCCESS", response: refus, usage: { total_tokens: 1 } });
  }
  if (model.includes("fouineur")) {
    const cible = resolve(process.cwd(), "..", "..", "bimind-hors-espace-test.txt");
    outil("ACTIVE", "view_file", { AbsolutePath: cible });
    await pause();
    const vole = existsSync(cible) ? readFileSync(cible, "utf8") : "";
    outil("DONE", "view_file", { AbsolutePath: cible }, "1 lines");
    return out("result", { status: "SUCCESS", response: `CONTENU VOLÉ : ${vole}`, usage: { total_tokens: 1 } });
  }
  if (model.includes("commande")) {
    outil("ACTIVE", "run_command", { CommandLine: "dir" });
    if (model.includes("executee")) { // réglages d'agy permissifs : la commande tourne
      await pause();
      outil("DONE", "run_command", { CommandLine: "dir" }, "a.txt");
      await pause();
      return out("result", { status: "SUCCESS", response: "COMMANDE EXÉCUTÉE", usage: { total_tokens: 1 } });
    }
    // comportement réel par défaut : agy refuse, et Gemini continue
    out("step_update", { step_index: etape, state: "ERROR", step_type: "tool", tool_name: "run_command",
      tool_info: { name: "run_command", parameters: { CommandLine: "dir" }, error: { type: "TOOL_ERROR", message: "permission check failed for command \"dir\": user denied permission to run command" } } });
  }
  if (model.includes("sousagent")) {
    outil("ACTIVE", "invoke_subagent", { Task: "lire le disque" });
    await pause();
    return out("result", { status: "SUCCESS", response: "SOUS-AGENT LANCÉ", usage: { total_tokens: 1 } });
  }
  let lus = "";
  if (prompt.includes("===== Fichiers à lire dans ton espace de travail =====") || prompt.startsWith("Tu n'as pas ouvert")) {
    const relance = numero > 1;
    for (const [i, f] of fichiersEspace().entries()) {
      if (dejaLus.has(f)) continue;
      if ((model.includes("paresseux") && !relance && i > 0) || (model.includes("obstine") && i > 0)) break;
      outil("ACTIVE", "view_file", { AbsolutePath: f });
      outil("DONE", "view_file", { AbsolutePath: f }, "lu");
      dejaLus.add(f);
      lus += `LU ${relative(process.cwd(), f).replaceAll("\\", "/")} => ${readFileSync(f, "utf8").slice(0, 60)}\n`;
    }
  }
  out("step_update", { step_type: "agent_response", state: "ACTIVE", text_delta: "…" });
  out("result", { status: "SUCCESS", response: `MODELE=${model}\nEFFORT=${effort}\nCWD=${process.cwd()}\nTOUR=${numero}\n${lus}${prompt}\n`, usage: { total_tokens: 1 } });
}

out("init", { model, cwd: process.cwd() });
let numero = 0;
for await (const ligne of createInterface({ input: process.stdin })) {
  if (ligne.trim()) await tour(JSON.parse(ligne).message.content, ++numero);
}
