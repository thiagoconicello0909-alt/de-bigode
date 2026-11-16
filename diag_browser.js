import { loadCasas } from './src/storage.js';
import { obterPar, fecharBrowser } from './src/browser.js';

const casa = loadCasas()[process.argv[2]];
if (!casa) { console.log('casa nao encontrada'); process.exit(0); }

const t0 = Date.now();
for (let i = 1; i <= 2; i++) {
  const ini = Date.now();
  try {
    const par = await obterPar(casa, 'login');
    console.log('par ' + i + ': ' + (Date.now() - ini) + 'ms x=' + par.x.length + ' h=' + par.h.length);
  } catch (e) {
    console.log('par ' + i + ' falhou: ' + e.message);
  }
}
console.log('total: ' + (Date.now() - t0) + 'ms');

await fecharBrowser();
process.exit(0);
