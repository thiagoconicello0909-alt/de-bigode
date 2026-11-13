// pool.js v3 — sem rejeição solta, sem contagem dupla
export async function runPool(tasks, concurrency, intervalMs = 0) {
  const total = tasks.length;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let proxima = 0;
  let concluidas = 0;
  let ultimoSlot = 0;

  return new Promise((resolve) => {
    if (total === 0) return resolve();

    const finalizar = () => {
      concluidas++;
      if (concluidas >= total) resolve();
    };

    async function worker() {
      while (true) {
        const i = proxima++;
        if (i >= total) return;

        if (intervalMs > 0) {
          const agora = Date.now();
          const espera = Math.max(0, ultimoSlot - agora);
          ultimoSlot = agora + espera + intervalMs;
          if (espera > 0) await sleep(espera);
        }

        try {
          await tasks[i]();
        } catch {
          // run.js já contabiliza
        } finally {
          finalizar();
        }
      }
    }

    const n = Math.max(1, Math.min(concurrency, total));
    for (let i = 0; i < n; i++) {
      worker().catch(() => finalizar());
    }
  });
}