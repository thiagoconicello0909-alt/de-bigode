// sync.js — observa a pasta e empurra para o GitHub sozinho
import { watch } from "fs";
import { execSync } from "child_process";

const IGNORAR = /(^|[\\/])(node_modules|\.git|hits|\.vscode)([\\/]|$)/;
let timer = null;
let rodando = false;
let pendente = false;

function sync() {
  if (rodando) { pendente = true; return; }
  rodando = true;
  try {
    execSync("git add -A", { stdio: "ignore" });
    const st = execSync("git status --porcelain", { encoding: "utf8" });
    if (st.trim()) {
      const n = st.split("\n").filter(Boolean).length;
      execSync(`git commit -m "auto ${new Date().toISOString()}"`, { stdio: "ignore" });
      execSync("git push", { stdio: "inherit" });
      console.log(`[sync] ${new Date().toLocaleTimeString()} — ${n} arquivo(s) enviados`);
    }
  } catch (e) {
    console.log(`[sync] falhou: ${String(e.message).split("\n")[0]}`);
  } finally {
    rodando = false;
    if (pendente) { pendente = false; timer = setTimeout(sync, 800); }
  }
}

watch(".", { recursive: true }, (ev, arq) => {
  if (!arq || IGNORAR.test(arq)) return;
  clearTimeout(timer);
  timer = setTimeout(sync, 1500);
});

console.log("Observando. Ctrl+C para parar.");