'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = path.join(__dirname, '..', 'db', 'schema.sql');

/**
 * Abre (ou cria) a base de dados SQLite e aplica o esquema.
 * Use ':memory:' para testes.
 */
function abrirBase(ficheiro) {
  if (ficheiro !== ':memory:') fs.mkdirSync(path.dirname(ficheiro), { recursive: true });
  const db = new DatabaseSync(ficheiro);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(fs.readFileSync(SCHEMA, 'utf8'));
  return db;
}

const id = () => randomUUID();
const agora = () => new Date().toISOString();

module.exports = { abrirBase, id, agora };
