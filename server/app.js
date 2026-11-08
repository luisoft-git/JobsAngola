'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { criarApi } = require('./api');
const { enviar } = require('./http');

const PUBLICO = path.join(__dirname, '..', 'public');

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const CABECALHOS_SEGURANCA = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer'
};

function servirEstatico(pathname, res) {
  let relativo;
  try {
    relativo = decodeURIComponent(pathname);
  } catch (_) {
    return enviar(res, 400, { erro: 'Pedido inválido.' });
  }
  if (relativo === '/' || relativo === '') relativo = '/index.html';

  const alvo = path.normalize(path.join(PUBLICO, relativo));
  const existe = alvo.startsWith(PUBLICO + path.sep) && fs.existsSync(alvo) && fs.statSync(alvo).isFile();
  if (!existe) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Não encontrado');
  }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(alvo)] || 'application/octet-stream' });
  fs.createReadStream(alvo).pipe(res);
}

/** Cria o manipulador HTTP: API em /api/* e frontend estático no resto. */
function criarServidor(db, { uploadsDir } = {}) {
  const tratarApi = criarApi({
    uploadsDir: uploadsDir || path.join(__dirname, '..', 'uploads')
  });

  return (req, res) => {
    for (const [chave, valor] of Object.entries(CABECALHOS_SEGURANCA)) res.setHeader(chave, valor);

    let pathname;
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch (_) {
      return enviar(res, 400, { erro: 'Pedido inválido.' });
    }

    if (pathname.startsWith('/api/')) return tratarApi(req, res, db);
    if (req.method !== 'GET' && req.method !== 'HEAD') return enviar(res, 405, { erro: 'Método não permitido.' });
    return servirEstatico(pathname, res);
  };
}

module.exports = { criarServidor };
