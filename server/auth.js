'use strict';

const crypto = require('node:crypto');

// Em produção defina JWT_SECRET. Sem ele, gera-se um segredo aleatório a cada arranque.
const SEGREDO = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const DURACAO_TOKEN_S = 60 * 60 * 12; // 12 horas

/** Hash de senha com scrypt (memory-hard), formato: scrypt$<salt>$<hash> */
function hashSenha(senha) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(senha, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verificaSenha(senha, guardado) {
  const [alg, saltHex, hashHex] = String(guardado || '').split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const esperado = Buffer.from(hashHex, 'hex');
  const calculado = crypto.scryptSync(senha, Buffer.from(saltHex, 'hex'), esperado.length);
  return crypto.timingSafeEqual(esperado, calculado);
}

// Token no formato JWT (HS256), implementado com node:crypto para não depender de pacotes externos.
const b64 = (texto) => Buffer.from(texto).toString('base64url');

function emitirToken(utilizador) {
  const cabecalho = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const corpo = b64(JSON.stringify({
    sub: utilizador.id,
    role: utilizador.role,
    exp: Math.floor(Date.now() / 1000) + DURACAO_TOKEN_S
  }));
  const assinatura = crypto.createHmac('sha256', SEGREDO).update(`${cabecalho}.${corpo}`).digest('base64url');
  return `${cabecalho}.${corpo}.${assinatura}`;
}

function lerToken(token) {
  const partes = String(token || '').split('.');
  if (partes.length !== 3) return null;
  const [cabecalho, corpo, assinatura] = partes;
  const esperada = crypto.createHmac('sha256', SEGREDO).update(`${cabecalho}.${corpo}`).digest();
  const recebida = Buffer.from(assinatura, 'base64url');
  if (recebida.length !== esperada.length || !crypto.timingSafeEqual(recebida, esperada)) return null;
  const payload = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8'));
  if (!payload.exp || payload.exp < Date.now() / 1000) return null;
  return payload;
}

module.exports = { hashSenha, verificaSenha, emitirToken, lerToken };
