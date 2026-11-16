import path from 'path';
import { ROOT } from './src/paths.js';
import { loadCasas, saveCasas } from './src/storage.js';

const SH = '0x4AAAAAAB0oRY23FyZnllMo';
const SB = '0x4AAAAAAAiHEkDee-yqSdMj';

const casas = loadCasas();
let mudou = 0;

for (const [nome, casa] of Object.entries(casas)) {
  if (!/ycyd123\.com$/i.test(casa.apiHost || '')) {
    console.log('- ' + nome + ': fora da plataforma, ignorada');
    continue;
  }
  casa.captchaId = SB;
  casa.browserLogin = true;
  casa.browserPages = Number(casa.browserPages) || 10;
  casa.channelId = 0;
  casa.lang = 'pt';
  casa.rotativa = true;
  casa.turnstile = { sitekeyBody: SB, sitekeyHeader: SH, action: 'api_protection', actionBody: 'login' };
  if (!Array.isArray(casa.perfilProcs) || !casa.perfilProcs.length) casa.perfilProcs = ['user.assets', 'vip.info'];
  mudou++;
  console.log('+ ' + nome + ': ' + casa.domain + ' | abas=' + casa.browserPages + ' | rotativa');
}

if (mudou) {
  saveCasas(casas);
  console.log(mudou + ' casa(s) preparada(s)');
} else {
  console.log('nada alterado');
}
process.exit(0);
