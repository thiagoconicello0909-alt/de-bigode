import fs from "fs";
import path from "path";
import { ROOT } from "./paths.js";

const FLAG = path.join(ROOT, "parar.txt");

let ativo = false;
let motivo = "";
let handler = null;

/**
 * Cria o ponto de parada: arquivo parar.txt ou tecla Q / Ctrl+C durante o run.
 * Chame `encerrar()` no finally para devolver o terminal.
 */
export function criarParada(aoParar) {
  try { if (fs.existsSync(FLAG)) fs.unlinkSync(FLAG); } catch {}

  const dispara = (m) => {
    if (ativo) return;
    ativo = true;
    motivo = m;
    process.stdout.write(`\n  ⏹ parada solicitada (${m}) — encerrando após as threads atuais\n`);
    if (typeof aoParar === "function") { try { aoParar(m); } catch {} }
  };

  const timer = setInterval(() => {
    try { if (fs.existsSync(FLAG)) dispara("arquivo parar.txt"); } catch {}
  }, 500);
  timer.unref?.();

  if (process.stdin.isTTY) {
    try { process.stdin.setRawMode(true); } catch {}
    process.stdin.resume();
    handler = (buf) => {
      const t = buf.toString();
      if (t === "\u0003") dispara("Ctrl+C");
      else if (/[qQ]/.test(t)) dispara("tecla Q");
    };
    process.stdin.on("data", handler);
  }

  return {
    parado: () => ativo,
    motivo: () => motivo,
    encerrar: () => {
      clearInterval(timer);
      if (handler) { try { process.stdin.off("data", handler); } catch {} handler = null; }
      try { if (process.stdin.isTTY) process.stdin.setRawMode(false); } catch {}
      try { if (fs.existsSync(FLAG)) fs.unlinkSync(FLAG); } catch {}
    },
  };
}