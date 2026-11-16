import readline from "readline";

const ACCENT = "\x1b[38;5;135m";
const ACCENT2 = "\x1b[38;5;207m";
const CYAN = "\x1b[38;5;45m";
const GREEN = "\x1b[38;5;42m";
const YELLOW = "\x1b[38;5;214m";
const RED = "\x1b[38;5;203m";
const MAGENTA = "\x1b[38;5;201m";
const DIM = "\x1b[38;5;245m";
const B = "\x1b[1m";
const RESET = "\x1b[0m";
const R = RED;

export const c = { R, B, DIM, RESET, CYAN, YELLOW, GREEN, MAGENTA, ACCENT, ACCENT2 };

const LOGO = [
  ["███╗   ██╗", "██╗     ", "██╗   ██╗", " ██████╗", "██╗  ██╗", "██╗   ██╗"],
  ["████╗  ██║", "██║     ", "██║   ██║", "██╔════╝", "██║ ██╔╝", "╚██╗ ██╔╝"],
  ["██╔██╗ ██║", "██║     ", "██║   ██║", "██║     ", "█████╔╝ ", " ╚████╔╝ "],
  ["██║╚██╗██║", "██║     ", "██║   ██║", "██║     ", "██╔═██╗ ", "  ╚██╔╝  "],
  ["██║ ╚████║", "███████╗", "╚██████╔╝", "╚██████╗", "██║  ██╗", "   ██║   "],
  ["╚═╝  ╚═══╝", "╚══════╝", " ╚═════╝ ", " ╚═════╝", "╚═╝  ╚═╝", "   ╚═╝   "],
];

const GRADIENT = ["\x1b[38;5;141m", "\x1b[38;5;141m", "\x1b[38;5;171m", "\x1b[38;5;177m", "\x1b[38;5;207m", "\x1b[38;5;213m"];

export function banner() {
  try {
    process.stdout.write("\u001b[2J\u001b[3J\u001b[H");
  } catch {
    console.clear();
  }
  console.log();
  LOGO.forEach((linha, i) => console.log(`   ${GRADIENT[i]}${B}${linha.join("")}${RESET}`));
  console.log();
  console.log(`   ${DIM}┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄${RESET}`);
  console.log(`   ${ACCENT2}${B}C H E C K E R${RESET}  ${DIM}·${RESET}  ${DIM}by Nlucky${RESET}`);
  console.log(`   ${DIM}┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄${RESET}`);
  console.log();
}

export function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

export async function readMultiline(message, { stopOnBlank = true } = {}) {
  console.log(`${ACCENT}${B}  ${message}${RESET}`);
  console.log(`${DIM}  (cole e finalize com uma linha vazia)${RESET}\n`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const lines = [];
  return new Promise((resolve) => {
    rl.on("line", (line) => {
      if (line === "" && lines.length > 0 && stopOnBlank) { rl.close(); return; }
      lines.push(line);
    });
    rl.on("close", () => resolve(lines.join("\n")));
  });
}

export async function menu(title, options) {
  console.log(`  ${ACCENT}${B}▍ ${title.toUpperCase()}${RESET}`);
  console.log(`  ${DIM}${"─".repeat(50)}${RESET}`);
  options.forEach((opt, i) => {
    const n = String(i + 1).padStart(2, "0");
    console.log(`  ${ACCENT2}${n}${RESET} ${DIM}│${RESET} ${opt}`);
  });
  console.log(`  ${DIM}00${RESET} ${DIM}│${RESET} ${DIM}Voltar / Sair${RESET}`);
  console.log(`  ${DIM}${"─".repeat(50)}${RESET}`);
  const choice = await prompt(`  ${ACCENT}❯${RESET} `);
  return parseInt(choice, 10);
}

export function separator() {
  console.log(`\n  ${DIM}${"─".repeat(58)}${RESET}\n`);
}

export async function pressEnter() {
  await prompt(`\n  ${DIM}enter para continuar${RESET}`);
}