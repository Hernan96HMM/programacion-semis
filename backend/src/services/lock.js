// Mutex en memoria: sirve porque el backend corre en un solo proceso Node
// (ver Global Constraints del plan). Si en el futuro se escala a múltiples
// procesos/réplicas, hay que migrar a un advisory lock de Postgres.
let tail = Promise.resolve();

function withLock(fn) {
  const run = tail.then(() => fn());
  // Evita que un rechazo corte la cadena para las próximas llamadas.
  tail = run.catch(() => {});
  return run;
}

module.exports = { withLock };
