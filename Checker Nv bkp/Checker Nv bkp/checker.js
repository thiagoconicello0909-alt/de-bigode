import { banner, menu, prompt, pressEnter, c } from "./src/ui.js";
import { cmdAdd, cmdList, cmdRemove, cmdRemoveAll, cmdDiscover, cmdLinkPerfil } from "./src/casas.js";
import { cmdRun } from "./src/run.js";
import { loadConfig, saveConfig } from "./src/storage.js";
import { loadCaptchaConfig, saveCaptchaConfig } from "./src/captcha.js";

async function menuCasas() {
  while (true) {
    banner();
    const escolha = await menu("Gerenciar Casas", [
      "Adicionar casa (colar curl — aceita vários)",
      "Listar casas",
      "Extrair procedures do site (auto, sem conta)",
      "Descobrir endpoint de perfil (VIP + saldo)",
      "Vincular curl de perfil (VIP/saldo)",
      "Remover casa",
      "Excluir TODAS as casas",
    ]);
    if (escolha === 0) return;
    banner();
    if (escolha === 1) await cmdAdd();
    else if (escolha === 2) cmdList();
    else if (escolha === 3) await cmdDiscover();
    else if (escolha === 4) await cmdDiscover();
    else if (escolha === 5) await cmdLinkPerfil();
    else if (escolha === 6) await cmdRemove();
    else if (escolha === 7) await cmdRemoveAll();
    await pressEnter();
  }
}

async function menuConfig() {
  while (true) {
    banner();
    const config = loadConfig();
    console.log(`  threads: ${c.ACCENT2}${config.threads}${c.RESET} ${c.DIM}│${c.RESET} delay: ${c.ACCENT2}${config.delay}ms${c.RESET} ${c.DIM}│${c.RESET} saldo mín.: ${c.ACCENT2}R$${config.minBalance}${c.RESET} ${c.DIM}│${c.RESET} VIP mín.: ${c.ACCENT2}${config.minVip}${c.RESET}`);
    console.log(`  som: ${config.sound ? c.GREEN + "on" + c.RESET : c.DIM + "off" + c.RESET} ${c.DIM}│${c.RESET} notificação: ${config.notify ? c.GREEN + "on" + c.RESET : c.DIM + "off" + c.RESET} ${c.DIM}│${c.RESET} filtro 9: ${config.filtro9 ? c.GREEN + "on" + c.RESET : c.DIM + "off" + c.RESET} ${c.DIM}│${c.RESET} txt: ${config.txtDetalhado ? c.GREEN + "on" + c.RESET : c.DIM + "off" + c.RESET}\n`);
    const escolha = await menu("Configurações", [
      "Alterar threads",
      "Alterar delay entre requisições (ms)",
      "Alterar saldo mínimo para hit",
      "Alterar VIP mínimo para hit",
      "Alternar som",
      "Alternar notificação",
      "Alternar filtro do 3º dígito (9 = celular)",
      "Alternar arquivos .txt detalhados",
    ]);
    if (escolha === 0) return;
    banner();
    if (escolha === 1) config.threads = parseInt(await prompt("  Threads: ") || config.threads, 10);
    else if (escolha === 2) config.delay = parseInt(await prompt("  Delay (ms): ") || config.delay, 10);
    else if (escolha === 3) config.minBalance = Number(await prompt("  Saldo mínimo: ") || config.minBalance);
    else if (escolha === 4) config.minVip = Number(await prompt("  VIP mínimo: ") || config.minVip);
    else if (escolha === 5) config.sound = !config.sound;
    else if (escolha === 6) config.notify = !config.notify;
    else if (escolha === 7) config.filtro9 = !config.filtro9;
    else if (escolha === 8) config.txtDetalhado = !config.txtDetalhado;
    saveConfig(config);
  }
}

async function menuCaptcha() {
  while (true) {
    banner();
    const cfg = loadCaptchaConfig();
    console.log(`  provedor: ${c.YELLOW}${cfg.provider.toUpperCase()}${c.RESET}`);
    if (cfg.provider === "custom") console.log(`  url: ${c.DIM}${cfg.customApiUrl || "não configurada"}${c.RESET}`);
    else if (cfg.provider !== "disabled") console.log(`  chave: ${c.DIM}${cfg.apiKey ? "********" : "não configurada"}${c.RESET}`);
    console.log();

    const escolha = await menu("Captcha / hToken", [
      "API customizada (usa {domain} {tenantId} {username} {captchaId})",
      "CapSolver",
      "2Captcha",
      "Anti-Captcha",
      "Desativar",
    ]);
    if (escolha === 0) return;
    banner();

    if (escolha === 1) {
      const url = await prompt("  URL: ");
      if (url) saveCaptchaConfig({ provider: "custom", apiKey: "", customApiUrl: url });
    } else if (escolha === 2 || escolha === 3 || escolha === 4) {
      const map = { 2: "capsolver", 3: "2captcha", 4: "anticaptcha" };
      const key = await prompt("  API Key: ");
      if (key) saveCaptchaConfig({ provider: map[escolha], apiKey: key, customApiUrl: "" });
    } else {
      saveCaptchaConfig({ provider: "disabled", apiKey: "", customApiUrl: "" });
    }
    console.log(`\n  ${c.GREEN}✅ salvo.${c.RESET}`);
    await pressEnter();
  }
}

async function main() {
  while (true) {
    banner();
    const escolha = await menu("Menu Principal", [
      "Puxar contas",
      "Gerenciar casas",
      "Configurações",
      "Captcha / hToken",
    ]);
    if (escolha === 0) {
      console.log(`\n  ${c.DIM}saindo...${c.RESET}\n`);
      process.exit(0);
    } else if (escolha === 1) {
      banner();
      await cmdRun();
      await pressEnter();
    } else if (escolha === 2) {
      await menuCasas();
    } else if (escolha === 3) {
      await menuConfig();
    } else if (escolha === 4) {
      await menuCaptcha();
    }
  }
}

main();