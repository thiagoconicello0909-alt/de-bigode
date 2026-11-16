import fs from "fs";
import path from "path";
import { ROOT } from "./src/paths.js";

const flag = path.join(ROOT, "parar.txt");
fs.writeFileSync(flag, new Date().toISOString(), "utf-8");
console.log("⏹ sinal de parada criado — o run encerra após as threads atuais.");
console.log("   (apague parar.txt ou rode de novo para voltar ao normal)");