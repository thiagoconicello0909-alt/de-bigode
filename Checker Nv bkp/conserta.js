import fs from "fs";
import path from "path";
import { ROOT } from "./src/paths.js";

const ARQ = path.join(ROOT, "db", "casas.json");

let txt = fs.readFileSync(ARQ, "utf-8").replace(/^\ufeff/, "").trim();

fs.writeFileSync(`${ARQ}.quebrado`, txt, "utf-8");

// remove vírgula solta no começo
txt = txt.replace(/^,/, "").trim();

// chave de abertura e fechamento
if (!txt.startsWith("{")) txt = "{" + txt;
if (txt.endsWith(",")) txt = txt.slice(0, -1).trim();
if (!txt.endsWith("}")) txt = txt + "}";

// vírgulas sobrando antes de fechar
txt = txt.replace(/,(\s*})/g, "$1");

function tentar(rotulo, conteudo) {
  try {
    const obj = JSON.parse(conteudo);
    fs.writeFileSync(ARQ, JSON.stringify(obj, null, 2), "utf-8");
    console.log(`  OK (${rotulo}) — casas: ${Object.keys(obj).join(" ")}`);
    console.log(`  backup do original quebrado: ${ARQ}.quebrado`);
    return true;
  } catch (e) {
    const m = String(e.message).match(/position (\d+)/);
    const pos = m ? Number(m[1]) : -1;
    console.log(`  falhou (${rotulo}): ${e.message}`);
    if (pos >= 0) {
      const ini = Math.max(0, pos - 90);
      console.log(`  trecho: ...${conteudo.slice(ini, pos)}>>>${conteudo.slice(pos, pos + 90)}...`);
    }
    return false;
  }
}

if (!tentar("reparo", txt)) process.exit(1);