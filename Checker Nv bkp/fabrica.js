// fabrica.js — só minta e guarda no estoque, nunca consome
import { loadCasas } from "./src/storage.js";
import { mintarPar, fecharBrowser } from "./src/browser.js";
import * as stock from "./src/tokens.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const casaNome = process.argv[2];
const PARALELO = Number(process.env.PARALELO) || 4;
const RENOVA = Number(process.env.RENOVA) || 20000;
const META = Number(process.env.META) || 8;
const VALIDADE = Number(process.env.CHK_VALIDADE) || 45000;

const casas = loadCasas();
const casa = casas[casaNome] || Object.values(casas)[0];
if (!casa) {
  console.log("casa nao encontrada");
  process.exit(1);
}

casa.browserPages = Math.max(2, PARALELO);
console.log(`  fabrica ${casaNome} (${casa.domain}) | abas=${casa.browserPages} paralelo=${PARALELO} renova=${RENOVA}ms meta=${META}`);
console.log(`  abrindo browser...`);

let ativo = true;
let mintados = 0;
let erros = 0;
let ultimoErro = 0;

process.on("SIGINT", async () => {
  ativo = false;
  await fecharBrowser();
  process.exit(0);
});

async function operario() {
  while (ativo) {
    try {
      const n = stock.contar(casa.domain);
      const idade = stock.idadeMaisVelho(casa.domain);
      if (n >= META && idade < RENOVA / 1000) {
        await sleep(150);
        continue;
      }
      await mintarPar(casa);
      mintados++;
    } catch (e) {
      erros++;
      if (Date.now() - ultimoErro > 4000) {
        ultimoErro = Date.now();
        console.log(`  erro: ${e.message}`);
      }
      await sleep(600);
    }
  }
}

setInterval(() => {
  if (!ativo) return;
  const n = stock.contar(casa.domain);
  const idade = stock.idadeMaisVelho(casa.domain);
  console.log(`  [estoque] ${n}/${META} | idade ${idade}s/${Math.round(VALIDADE / 1000)}s | +${mintados} erros ${erros}`);
}, 2000);

setInterval(() => {
  if (ativo) stock.limpar(casa.domain);
}, 10000);

try {
  await mintarPar(casa);
  mintados++;
  console.log(`  browser pronto, abrindo ${PARALELO} operarios`);
} catch (e) {
  console.log(`  aquecimento falhou: ${e.message}`);
}

await Promise.all(Array.from({ length: PARALELO }, () => operario()));