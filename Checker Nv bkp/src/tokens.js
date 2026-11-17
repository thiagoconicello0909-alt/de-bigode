// tokens.js — estoque de tokens em SQLite (node:sqlite nativo)
import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import path from "path";
import { ROOT } from "./paths.js";

const DIR = path.join(ROOT, "db");
const ARQ = path.join(DIR, "estoque.db");
const VALIDADE = Number(process.env.CHK_VALIDADE) || 45000;

let db = null;

function abrir() {
  if (db) return db;
  fs.mkdirSync(DIR, { recursive: true });
  db = new DatabaseSync(ARQ);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec(`CREATE TABLE IF NOT EXISTS tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dominio TEXT NOT NULL,
    x TEXT NOT NULL,
    h TEXT,
    ts INTEGER NOT NULL,
    usado INTEGER NOT NULL DEFAULT 0
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_tok ON tokens (dominio, usado, ts)");
  return db;
}

export function guardar(dominio, x, h) {
  if (!x) return;
  const d = abrir();
  d.prepare("INSERT INTO tokens (dominio, x, h, ts, usado) VALUES (?, ?, ?, ?, 0)")
    .run(dominio, x, h || "", Date.now());
  limpar(dominio);
}

/** Pega o token válido mais antigo e marca como usado de forma atômica. */
export function consumir(dominio) {
  const d = abrir();
  const limite = Date.now() - VALIDADE;
  for (let i = 0; i < 5; i++) {
    const row = d
      .prepare("SELECT id, x, h FROM tokens WHERE dominio = ? AND usado = 0 AND ts > ? ORDER BY ts ASC LIMIT 1")
      .get(dominio, limite);
    if (!row) return null;
    const r = d.prepare("UPDATE tokens SET usado = 1 WHERE id = ? AND usado = 0").run(row.id);
    if (r.changes === 1) return { x: row.x, h: row.h || "" };
  }
  return null;
}

export function contar(dominio) {
  const d = abrir();
  const row = d
    .prepare("SELECT COUNT(*) AS n FROM tokens WHERE dominio = ? AND usado = 0 AND ts > ?")
    .get(dominio, Date.now() - VALIDADE);
  return Number(row?.n || 0);
}

export function idadeMaisVelho(dominio) {
  const d = abrir();
  const row = d
    .prepare("SELECT MIN(ts) AS t FROM tokens WHERE dominio = ? AND usado = 0 AND ts > ?")
    .get(dominio, Date.now() - VALIDADE);
  if (!row?.t) return 0;
  return Math.round((Date.now() - row.t) / 1000);
}

export function limpar(dominio) {
  const d = abrir();
  const limite = Date.now() - VALIDADE * 2;
  if (dominio) d.prepare("DELETE FROM tokens WHERE dominio = ? AND (ts < ? OR usado = 1)").run(dominio, limite);
  else d.prepare("DELETE FROM tokens WHERE ts < ? OR usado = 1").run(limite);
}

export function fechar() {
  try { db?.close(); } catch {}
  db = null;
}