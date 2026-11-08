'use strict';

class HttpError extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

function enviar(res, status, corpo) {
  const texto = JSON.stringify(corpo);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(texto)
  });
  res.end(texto);
}

/** Lê o corpo do pedido com limite de tamanho. */
function lerCorpoBruto(req, limite) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let total = 0;
    req.on('data', (parte) => {
      total += parte.length;
      if (total > limite) {
        reject(new HttpError(413, 'Ficheiro demasiado grande (máximo 5 MB).'));
        req.resume(); // descarta o resto sem bloquear a resposta
        return;
      }
      partes.push(parte);
    });
    req.on('end', () => resolve(Buffer.concat(partes)));
    req.on('error', reject);
  });
}

async function lerJson(req) {
  const buffer = await lerCorpoBruto(req, 64 * 1024);
  if (buffer.length === 0) return {};
  try {
    const valor = JSON.parse(buffer.toString('utf8'));
    if (valor && typeof valor === 'object' && !Array.isArray(valor)) return valor;
  } catch (_) { /* cai no erro abaixo */ }
  throw new HttpError(400, 'Pedido JSON inválido.');
}

module.exports = { HttpError, enviar, lerCorpoBruto, lerJson };
