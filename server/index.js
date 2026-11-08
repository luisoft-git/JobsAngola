'use strict';

const http = require('node:http');
const path = require('node:path');
const { abrirBase } = require('./db');
const { criarServidor } = require('./app');
const { garantirAdmin, semearDemo } = require('./seed');

const BASE_PADRAO = path.join(__dirname, '..', 'data', 'jobsangola.db');

/**
 * Arranca o servidor. Usado pelo arranque normal e pelos testes.
 * @returns {Promise<{servidor, db, porta}>}
 */
function iniciar({
  ficheiroBase = process.env.DATABASE_PATH || BASE_PADRAO,
  porta = Number(process.env.PORT) || 3000,
  uploadsDir
} = {}) {
  const db = abrirBase(ficheiroBase);
  garantirAdmin(db);
  if (process.env.SEED_DEMO === '1') semearDemo(db);

  const servidor = http.createServer(criarServidor(db, { uploadsDir }));
  return new Promise((resolve) => {
    servidor.listen(porta, () => resolve({ servidor, db, porta: servidor.address().port }));
  });
}

if (require.main === module) {
  if (!process.env.JWT_SECRET) {
    console.warn('Aviso: defina JWT_SECRET em produção (sem ele, as sessões caem a cada reinício).');
  }
  iniciar().then(({ porta }) => {
    console.log(`JobsAngola a correr em http://localhost:${porta}`);
  });
}

module.exports = { iniciar };
