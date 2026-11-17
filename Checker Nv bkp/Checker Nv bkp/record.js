import fs from "fs";
import path from "path";
import readline from "readline";
import { chromium } from "playwright";
import { ROOT } from "./src/paths.js";
import { loadCasas } from "./src/storage.js";

const [nome] = process.argv.slice(2);
const casa = loadCasas()[nome];
if (!casa) { console.error("casa inválida"); process.exit(1); }

const outDir = path.join(ROOT, "capturas");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const arquivo = path.join(outDir, `${nome}-${Date.now()}.jsonl`);
const stream = fs.createWriteStream(arquivo, { flags: "a" });

const browser = await chromium.launch({
  headless: false,
  args: ["--disable-blink-features=AutomationControlled", "--start-maximized"],
});

const ctxOpts = {
  locale: "pt-BR",
  timezoneId: "America/Sao_Paulo",
  viewport: null,
  userAgent: casa.headers?.["user-agent"],
};
if (process.env.PROXY) ctxOpts.proxy = { server: process.env.PROXY };

const ctx = await browser.newContext(ctxOpts);
const page = await ctx.newPage();

function grava(obj) {
  stream.write(JSON.stringify(obj) + "\n");
}

page.on("request", (req) => {
  if (!req.url().includes("/trpc/")) return;
  grava({
    t: Date.now(), tipo: "req", metodo: req.method(), url: req.url(),
    headers: req.headers(), body: req.postData() || "",
  });
  console.log(`→ ${req.method()} ${req.url().replace(/^https:\/\/[^/]+/, "")}`);
});

page.on("response", async (res) => {
  if (!res.url().includes("/trpc/")) return;
  let body = "";
  try { body = (await res.text()).slice(0, 8000); } catch {}
  grava({
    t: Date.now(), tipo: "res", status: res.status(), url: res.url(),
    headers: res.headers(), body,
  });
  console.log(`← [${res.status()}] ${res.url().replace(/^https:\/\/[^/]+/, "")}`);
});

await page.goto(`https://${casa.domain}/`, { waitUntil: "domcontentloaded" });

console.log("\n" + "=".repeat(64));
console.log("1) Faça login na janela que abriu.");
console.log("2) Depois do login o script ABRE /main/perfil sozinho.");
console.log("   Se não abrir, digite /main/perfil na barra de endereço.");
console.log("3) Volte aqui e aperte ENTER pra salvar.");
console.log("=".repeat(64) + "\n");

if (process.env.ACC_USER && process.env.ACC_PASS) {
  try {
    await page.fill('input[type="text"], input[name*="user" i], input[name*="login" i], input[name*="phone" i]', process.env.ACC_USER, { timeout: 15000 });
    await page.fill('input[type="password"]', process.env.ACC_PASS, { timeout: 15000 });
    console.log("campos preenchidos automaticamente");
  } catch {
    console.log("auto-preenchimento falhou, digite na janela");
  }
}

// espera o login (URL sai do /login e entra no /main/)
const limite = Date.now() + 180000;
while (Date.now() < limite && !/\/main\//.test(page.url())) {
  await page.waitForTimeout(600);
}

if (/\/main\//.test(page.url())) {
  const alvo = `https://${casa.domain}/main/perfil`;
  console.log(`\n→ abrindo ${alvo}`);
  try {
    await page.goto(alvo, { waitUntil: "domcontentloaded" });
  } catch {}
  await page.waitForTimeout(7000);

  // se a SPA não renderizou o perfil, tenta clicar no menu
  for (const sel of ['a[href*="/main/perfil"]', 'text=Perfil', 'text=Minha conta', 'text=Carteira']) {
    try {
      const el = page.locator(sel).first();
      if (await el.count()) { await el.click({ timeout: 4000 }); await page.waitForTimeout(6000); break; }
    } catch {}
  }
  console.log("→ perfil carregado, requisições capturadas");
} else {
  console.log("\n⚠️ login não detectado — navegue manualmente até o perfil.");
}

await new Promise((resolve) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question("", () => { rl.close(); resolve(); });
});

await browser.close();
stream.end();
console.log(`\n✅ Captura salva: ${arquivo}`);
console.log(`   Aplicar na casa: node har2casa.js "${arquivo}" ${nome}`);