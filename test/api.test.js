'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { iniciar } = require('../server/index');
const { criarUtilizador } = require('../server/api');

let servidor;
let db;
let base;
let uploads;

before(async () => {
  uploads = fs.mkdtempSync(path.join(os.tmpdir(), 'jobsangola-test-'));
  const r = await iniciar({ ficheiroBase: ':memory:', porta: 0, uploadsDir: uploads });
  servidor = r.servidor;
  db = r.db;
  base = `http://127.0.0.1:${r.porta}`;
  criarUtilizador(db, { nome: 'Administração', email: 'admin@teste.com', password: 'admin12345', role: 'ADMIN' });
});

after(() => {
  servidor.close();
  db.close();
  fs.rmSync(uploads, { recursive: true, force: true });
});

async function pedido(metodo, caminho, { token, corpo, bruto, tipo, nome } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (bruto) {
    headers['Content-Type'] = tipo;
    headers['X-File-Name'] = encodeURIComponent(nome);
    body = bruto;
  } else if (corpo) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(corpo);
  }
  const res = await fetch(base + caminho, { method: metodo, headers, body });
  const dados = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;
  return { status: res.status, dados, res };
}

test('metadados públicos', async () => {
  const r = await pedido('GET', '/api/meta');
  assert.equal(r.status, 200);
  assert.ok(r.dados.provincias.includes('Luanda'));
  assert.equal(r.dados.modalidades.REMOTO, 'Remoto');
});

test('registo valida dados e impede perfis indevidos', async () => {
  let r = await pedido('POST', '/api/auth/register', { corpo: { nome: 'X', email: 'x@teste.com', password: 'senha12345', role: 'CANDIDATO' } });
  assert.equal(r.status, 400, 'nome demasiado curto');
  r = await pedido('POST', '/api/auth/register', { corpo: { nome: 'Teste', email: 'x@teste.com', password: 'curta', role: 'CANDIDATO' } });
  assert.equal(r.status, 400, 'senha curta');
  r = await pedido('POST', '/api/auth/register', { corpo: { nome: 'Teste', email: 'x@teste.com', password: 'senha12345', role: 'ADMIN' } });
  assert.equal(r.status, 400, 'não se pode criar admin por registo');
});

test('login: senha errada é rejeitada e não revela o motivo', async () => {
  const r = await pedido('POST', '/api/auth/login', { corpo: { email: 'admin@teste.com', password: 'errada12345' } });
  assert.equal(r.status, 401);
  assert.equal(r.dados.erro, 'E-mail ou senha incorretos.');
});

test('rotas protegidas exigem sessão e perfil correto', async () => {
  let r = await pedido('GET', '/api/candidate/applications');
  assert.equal(r.status, 401);

  const cand = await pedido('POST', '/api/auth/register', { corpo: { nome: 'Ana Teste', email: 'ana@teste.com', password: 'senha12345', role: 'CANDIDATO' } });
  r = await pedido('GET', '/api/admin/pending', { token: cand.dados.token });
  assert.equal(r.status, 403);
});

test('fluxo completo: empresa, moderação, candidatura e estado', async () => {
  const rec = await pedido('POST', '/api/auth/register', { corpo: { nome: 'RH Teste', email: 'rh@teste.com', password: 'senha12345', role: 'RECRUTADOR' } });
  const recToken = rec.dados.token;
  const cand = await pedido('POST', '/api/auth/register', { corpo: { nome: 'Ana Teste', email: 'ana2@teste.com', password: 'senha12345', role: 'CANDIDATO' } });
  const candToken = cand.dados.token;
  const adm = await pedido('POST', '/api/auth/login', { corpo: { email: 'admin@teste.com', password: 'admin12345' } });
  const admToken = adm.dados.token;

  // Empresa começa pendente e não pode publicar vagas
  let r = await pedido('POST', '/api/company', { token: recToken, corpo: { nomeEmpresa: 'Empresa Teste, Lda', nif: '5411111111', setor: 'Tecnologia', descricao: 'Empresa de teste.' } });
  assert.equal(r.status, 201);
  assert.equal(r.dados.company.status, 'PENDENTE');
  const empresaId = r.dados.company.id;

  const corpoVaga = { titulo: 'Programador Node', setor: 'Tecnologia', provincia: 'Luanda', modalidade: 'REMOTO', tipoContrato: 'EFETIVO', descricao: 'Desenvolvimento de APIs e serviços web.', requisitos: ['Node.js', 'SQL'] };
  r = await pedido('POST', '/api/jobs', { token: recToken, corpo: corpoVaga });
  assert.equal(r.status, 403);

  // Admin verifica a empresa
  r = await pedido('POST', `/api/admin/companies/${empresaId}/approve`, { token: admToken });
  assert.equal(r.status, 200);

  // Vaga criada fica em moderação e não aparece publicamente
  r = await pedido('POST', '/api/jobs', { token: recToken, corpo: corpoVaga });
  assert.equal(r.status, 201);
  assert.equal(r.dados.job.moderacao, 'PENDENTE');
  assert.deepEqual(r.dados.job.requisitos, ['Node.js', 'SQL']);
  const vagaId = r.dados.job.id;

  r = await pedido('GET', '/api/jobs');
  assert.ok(!r.dados.jobs.some((j) => j.id === vagaId), 'vaga pendente não deve ser pública');

  // Admin aprova a vaga
  r = await pedido('POST', `/api/admin/jobs/${vagaId}/moderation`, { token: admToken, corpo: { decision: 'APROVADA' } });
  assert.equal(r.status, 200);
  r = await pedido('GET', '/api/jobs?q=node&provincia=Luanda');
  assert.ok(r.dados.jobs.some((j) => j.id === vagaId), 'vaga aprovada deve aparecer na pesquisa');

  // Candidatura exige CV válido
  r = await pedido('POST', `/api/jobs/${vagaId}/apply`, { token: candToken });
  assert.equal(r.status, 400);
  r = await pedido('POST', '/api/candidate/cv', { token: candToken, bruto: Buffer.from('isto não é um pdf'), tipo: 'application/pdf', nome: 'cv.pdf' });
  assert.equal(r.status, 400);

  const pdf = Buffer.from('%PDF-1.4\n% teste\n%%EOF');
  r = await pedido('POST', '/api/candidate/cv', { token: candToken, bruto: pdf, tipo: 'application/pdf', nome: 'CV Ana.pdf' });
  assert.equal(r.status, 200);
  assert.equal(r.dados.cvNome, 'CV Ana.pdf');

  r = await pedido('POST', `/api/jobs/${vagaId}/apply`, { token: candToken });
  assert.equal(r.status, 201);
  r = await pedido('POST', `/api/jobs/${vagaId}/apply`, { token: candToken });
  assert.equal(r.status, 409, 'candidatura duplicada');

  // Recrutador vê candidatos e altera o estado
  r = await pedido('GET', `/api/recruiter/jobs/${vagaId}/candidates`, { token: recToken });
  assert.equal(r.dados.applications.length, 1);
  assert.equal(r.dados.applications[0].candidato.temCv, true);
  assert.equal(r.dados.applications[0].candidato.cvPath, undefined, 'caminho interno não deve ser exposto');
  const candidaturaId = r.dados.applications[0].id;

  r = await pedido('PATCH', `/api/applications/${candidaturaId}/status`, { token: recToken, corpo: { status: 'ENTREVISTA' } });
  assert.equal(r.status, 200);
  r = await pedido('GET', '/api/candidate/applications', { token: candToken });
  assert.equal(r.dados.applications[0].status, 'ENTREVISTA');

  // Recrutador descarrega o CV; candidato não pode
  const cvRes = await fetch(`${base}/api/recruiter/applications/${candidaturaId}/cv`, { headers: { Authorization: `Bearer ${recToken}` } });
  assert.equal(cvRes.status, 200);
  assert.equal(cvRes.headers.get('content-type'), 'application/pdf');
  assert.deepEqual(Buffer.from(await cvRes.arrayBuffer()), pdf);
  const cvNegado = await fetch(`${base}/api/recruiter/applications/${candidaturaId}/cv`, { headers: { Authorization: `Bearer ${candToken}` } });
  assert.equal(cvNegado.status, 403);
});

test('recrutador não acede a candidatos de vagas de outra empresa', async () => {
  const outro = await pedido('POST', '/api/auth/register', { corpo: { nome: 'Outro RH', email: 'outro@teste.com', password: 'senha12345', role: 'RECRUTADOR' } });
  const lista = await pedido('GET', '/api/recruiter/jobs', { token: outro.dados.token });
  assert.deepEqual(lista.dados.jobs, []);
  const todas = await pedido('GET', '/api/jobs');
  const vagaAlheia = todas.dados.jobs[0].id;
  const r = await pedido('GET', `/api/recruiter/jobs/${vagaAlheia}/candidates`, { token: outro.dados.token });
  assert.equal(r.status, 404);
});

test('upload de CV acima de 5 MB é recusado', async () => {
  const cand = await pedido('POST', '/api/auth/register', { corpo: { nome: 'Grande Ficheiro', email: 'grande@teste.com', password: 'senha12345', role: 'CANDIDATO' } });
  const grande = Buffer.alloc(5 * 1024 * 1024 + 10, 'a');
  grande.write('%PDF-', 0, 'latin1');
  const r = await pedido('POST', '/api/candidate/cv', { token: cand.dados.token, bruto: grande, tipo: 'application/pdf', nome: 'grande.pdf' });
  assert.equal(r.status, 413);
});

test('frontend é servido com cabeçalhos de segurança e sem sair da pasta public', async () => {
  const home = await fetch(`${base}/`);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /JobsAngola/);
  assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(home.headers.get('x-content-type-options'), 'nosniff');

  const fuga = await fetch(`${base}/%2e%2e/package.json`);
  assert.equal(fuga.status, 404);
});

test('administrador luisoft entra com utilizador e acede à área de moderação', async () => {
  criarUtilizador(db, { nome: 'Luisoft', email: 'luisoft', password: 'luisoft2026', role: 'ADMIN' });
  const login = await pedido('POST', '/api/auth/login', { corpo: { email: 'luisoft', password: 'luisoft2026' } });
  assert.equal(login.status, 200);
  assert.equal(login.dados.user.role, 'ADMIN');
  const area = await pedido('GET', '/api/admin/pending', { token: login.dados.token });
  assert.equal(area.status, 200);
});
