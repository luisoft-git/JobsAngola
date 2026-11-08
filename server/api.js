'use strict';

const fs = require('node:fs');
const path = require('node:path');
const C = require('./constants');
const { id, agora } = require('./db');
const { hashSenha, verificaSenha, emitirToken, lerToken } = require('./auth');
const { HttpError, enviar, lerCorpoBruto, lerJson } = require('./http');

const CV_MAX_BYTES = 5 * 1024 * 1024;
const LOGIN_MAX_TENTATIVAS = 10;
const LOGIN_JANELA_MS = 15 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const str = (valor, max) => (typeof valor === 'string' ? valor.trim().slice(0, max) : '');
const dentro = (valor, lista) => lista.includes(valor);
const chaveEm = (valor, objeto) => Object.prototype.hasOwnProperty.call(objeto, valor);

/* ---------- Consultas e mapeamentos ---------- */

const SQL_VAGA = `
  SELECT j.id, j.titulo, j.descricao, j.requisitos, j.modalidade, j.provincia, j.tipo_contrato,
         j.setor, j.status, j.moderacao, j.created_at,
         c.id AS company_id, c.nome_empresa, c.setor AS company_setor,
         c.descricao AS company_descricao, c.status_verificacao AS company_status,
         c.user_id AS company_user_id
  FROM jobs j JOIN company_profiles c ON c.id = j.company_id`;

// Vaga visível publicamente: ativa, moderada e de empresa verificada.
const CONDICAO_PUBLICA = `j.status = 'ATIVA' AND j.moderacao = 'APROVADA' AND c.status_verificacao = 'APROVADO'`;

const mapVaga = (r) => ({
  id: r.id,
  titulo: r.titulo,
  descricao: r.descricao,
  requisitos: r.requisitos.split('\n').map((s) => s.trim()).filter(Boolean),
  modalidade: r.modalidade,
  provincia: r.provincia,
  tipoContrato: r.tipo_contrato,
  setor: r.setor,
  status: r.status,
  moderacao: r.moderacao,
  createdAt: r.created_at,
  company: {
    id: r.company_id,
    nome: r.nome_empresa,
    setor: r.company_setor,
    descricao: r.company_descricao,
    status: r.company_status
  }
});

const mapEmpresa = (e) => ({
  id: e.id,
  nome: e.nome_empresa,
  nif: e.nif,
  setor: e.setor,
  descricao: e.descricao,
  status: e.status_verificacao
});

const mapPerfil = (p) => ({
  nomeCompleto: p.nome_completo,
  telefone: p.telefone,
  provincia: p.provincia,
  tituloProfissional: p.titulo_profissional,
  resumo: p.resumo,
  cvNome: p.cv_nome
});

const mapUser = (u) => ({ id: u.id, email: u.email, nome: u.nome, role: u.role });

const empresaDo = (db, userId) => db.prepare('SELECT * FROM company_profiles WHERE user_id = ?').get(userId);
const perfilDo = (db, userId) => db.prepare('SELECT * FROM candidate_profiles WHERE user_id = ?').get(userId);

function vagaDoRecrutador(db, jobId, userId) {
  return db.prepare(`
    SELECT j.id FROM jobs j JOIN company_profiles c ON c.id = j.company_id
    WHERE j.id = ? AND c.user_id = ?`).get(jobId, userId);
}

function notificar(db, userId, mensagem) {
  db.prepare('INSERT INTO notifications (id, user_id, mensagem, created_at) VALUES (?, ?, ?, ?)')
    .run(id(), userId, mensagem, agora());
  const destino = db.prepare('SELECT email FROM users WHERE id = ?').get(userId);
  // Substituir por SendGrid/Resend em produção.
  console.log(`[e-mail simulado] para ${destino?.email}: ${mensagem}`);
}

function criarUtilizador(db, { nome, email, password, role }) {
  const uid = id();
  db.prepare('INSERT INTO users (id, email, password_hash, role, nome, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(uid, email.toLowerCase(), hashSenha(password), role, nome, agora());
  if (role === 'CANDIDATO') {
    db.prepare('INSERT INTO candidate_profiles (user_id, nome_completo) VALUES (?, ?)').run(uid, nome);
  }
  return uid;
}

function sessao(db, userId) {
  const u = db.prepare('SELECT id, email, nome, role FROM users WHERE id = ?').get(userId);
  return { token: emitirToken(u), user: mapUser(u) };
}

/** Devolve o utilizador autenticado ou null (não lança erro). */
function utilizadorAtual(ctx) {
  const cabecalho = ctx.req.headers.authorization || '';
  const payload = cabecalho.startsWith('Bearer ') ? lerToken(cabecalho.slice(7)) : null;
  if (!payload) return null;
  return ctx.db.prepare('SELECT id, email, nome, role FROM users WHERE id = ?').get(payload.sub) || null;
}

/** Exige sessão válida e, opcionalmente, um dos perfis indicados. */
function exigir(ctx, ...perfis) {
  const u = utilizadorAtual(ctx);
  if (!u) throw new HttpError(401, 'Precisa de iniciar sessão.');
  if (perfis.length && !perfis.includes(u.role)) throw new HttpError(403, 'Não tem permissão para esta ação.');
  return u;
}

function decodificarNomeFicheiro(cabecalho) {
  let nome = '';
  try { nome = decodeURIComponent(String(cabecalho || '')); } catch (_) { nome = ''; }
  nome = nome.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().slice(0, 120) || 'curriculo';
  return nome.toLowerCase().endsWith('.pdf') ? nome : `${nome}.pdf`;
}

/* ---------- Rotas ---------- */

function criarApi({ uploadsDir }) {
  const tentativasLogin = new Map();
  const rotas = [];

  const registar = (metodo, padrao, fn) => rotas.push({ metodo, partes: padrao.split('/').filter(Boolean), fn });

  function limitarLogin(ctx) {
    const ip = ctx.req.socket.remoteAddress || 'desconhecido';
    const agoraMs = Date.now();
    let r = tentativasLogin.get(ip);
    if (!r || r.reinicia < agoraMs) {
      r = { n: 0, reinicia: agoraMs + LOGIN_JANELA_MS };
      tentativasLogin.set(ip, r);
    }
    r.n += 1;
    if (r.n > LOGIN_MAX_TENTATIVAS) throw new HttpError(429, 'Demasiadas tentativas. Aguarde 15 minutos.');
  }

  /* --- Públicas --- */

  registar('GET', '/api/meta', () => ({
    body: {
      provincias: C.PROVINCIAS,
      modalidades: C.MODALIDADES,
      contratos: C.CONTRATOS,
      setores: C.SETORES,
      estadosCandidatura: C.STATUS_CAND,
      estadosEmpresa: C.STATUS_EMPRESA,
      estadosVaga: C.STATUS_VAGA
    }
  }));

  registar('GET', '/api/jobs', ({ db, url }) => {
    const condicoes = [CONDICAO_PUBLICA];
    const args = [];

    const q = str(url.searchParams.get('q'), 100).replace(/[%_\\]/g, '');
    if (q) {
      condicoes.push('(j.titulo LIKE ? OR j.descricao LIKE ? OR j.requisitos LIKE ? OR j.setor LIKE ? OR c.nome_empresa LIKE ?)');
      for (let i = 0; i < 5; i += 1) args.push(`%${q}%`);
    }
    const provincia = url.searchParams.get('provincia');
    if (provincia && dentro(provincia, C.PROVINCIAS)) { condicoes.push('j.provincia = ?'); args.push(provincia); }
    const modalidade = url.searchParams.get('modalidade');
    if (modalidade && chaveEm(modalidade, C.MODALIDADES)) { condicoes.push('j.modalidade = ?'); args.push(modalidade); }
    const contrato = url.searchParams.get('tipoContrato');
    if (contrato && chaveEm(contrato, C.CONTRATOS)) { condicoes.push('j.tipo_contrato = ?'); args.push(contrato); }

    const linhas = db.prepare(`${SQL_VAGA} WHERE ${condicoes.join(' AND ')} ORDER BY j.created_at DESC LIMIT 100`).all(...args);
    return { body: { jobs: linhas.map(mapVaga) } };
  });

  registar('GET', '/api/jobs/:id', (ctx) => {
    const { db, params } = ctx;
    const linha = db.prepare(`${SQL_VAGA} WHERE j.id = ?`).get(params.id);
    if (!linha) throw new HttpError(404, 'Vaga não encontrada.');

    const u = utilizadorAtual(ctx);
    const publica = linha.status === 'ATIVA' && linha.moderacao === 'APROVADA' && linha.company_status === 'APROVADO';
    const dona = u && u.id === linha.company_user_id;
    if (!publica && !dona && u?.role !== 'ADMIN') throw new HttpError(404, 'Vaga não encontrada.');

    let minhaCandidatura = null;
    if (u?.role === 'CANDIDATO') {
      const a = db.prepare('SELECT status, applied_at FROM applications WHERE job_id = ? AND candidate_user_id = ?')
        .get(linha.id, u.id);
      if (a) minhaCandidatura = { status: a.status, appliedAt: a.applied_at };
    }
    return { body: { job: mapVaga(linha), minhaCandidatura } };
  });

  registar('POST', '/api/auth/register', async (ctx) => {
    const b = await lerJson(ctx.req);
    const nome = str(b.nome, 120);
    const email = str(b.email, 200).toLowerCase();
    const password = typeof b.password === 'string' ? b.password : '';

    if (nome.length < 2) throw new HttpError(400, 'Indique o nome completo.');
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'E-mail inválido.');
    if (password.length < 8 || password.length > 200) throw new HttpError(400, 'A senha deve ter entre 8 e 200 caracteres.');
    if (!dentro(b.role, ['CANDIDATO', 'RECRUTADOR'])) throw new HttpError(400, 'Perfil inválido.');
    if (ctx.db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
      throw new HttpError(409, 'Já existe uma conta com este e-mail.');
    }

    const uid = criarUtilizador(ctx.db, { nome, email, password, role: b.role });
    return { status: 201, body: sessao(ctx.db, uid) };
  });

  registar('POST', '/api/auth/login', async (ctx) => {
    limitarLogin(ctx);
    const b = await lerJson(ctx.req);
    const email = str(b.email, 200).toLowerCase();
    const password = typeof b.password === 'string' ? b.password : '';
    const u = ctx.db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!u || !verificaSenha(password, u.password_hash)) {
      throw new HttpError(401, 'E-mail ou senha incorretos.');
    }
    return { body: sessao(ctx.db, u.id) };
  });

  registar('GET', '/api/auth/me', (ctx) => ({ body: { user: mapUser(exigir(ctx)) } }));

  /* --- Candidato --- */

  registar('GET', '/api/candidate/profile', (ctx) => {
    const u = exigir(ctx, 'CANDIDATO');
    return { body: { profile: mapPerfil(perfilDo(ctx.db, u.id)) } };
  });

  registar('PUT', '/api/candidate/profile', async (ctx) => {
    const u = exigir(ctx, 'CANDIDATO');
    const b = await lerJson(ctx.req);
    const nome = str(b.nomeCompleto, 120);
    if (nome.length < 2) throw new HttpError(400, 'Indique o nome completo.');
    const provincia = dentro(b.provincia, C.PROVINCIAS) ? b.provincia : '';

    ctx.db.prepare(`
      UPDATE candidate_profiles
      SET nome_completo = ?, telefone = ?, provincia = ?, titulo_profissional = ?, resumo = ?
      WHERE user_id = ?`).run(
      nome, str(b.telefone, 30), provincia, str(b.tituloProfissional, 120), str(b.resumo, 2000), u.id
    );
    return { body: { profile: mapPerfil(perfilDo(ctx.db, u.id)) } };
  });

  registar('POST', '/api/candidate/cv', async (ctx) => {
    const u = exigir(ctx, 'CANDIDATO');
    const buffer = await lerCorpoBruto(ctx.req, CV_MAX_BYTES);
    if (buffer.length === 0) throw new HttpError(400, 'Ficheiro vazio.');
    if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new HttpError(400, 'O currículo deve ser um ficheiro PDF válido.');
    }

    const nome = decodificarNomeFicheiro(ctx.req.headers['x-file-name']);
    fs.mkdirSync(uploadsDir, { recursive: true });
    const caminho = path.join(uploadsDir, `${id()}.pdf`);
    fs.writeFileSync(caminho, buffer);

    const antigo = perfilDo(ctx.db, u.id).cv_path;
    if (antigo) fs.rmSync(antigo, { force: true });
    ctx.db.prepare('UPDATE candidate_profiles SET cv_path = ?, cv_nome = ? WHERE user_id = ?').run(caminho, nome, u.id);
    return { body: { cvNome: nome } };
  });

  registar('GET', '/api/candidate/applications', (ctx) => {
    const u = exigir(ctx, 'CANDIDATO');
    const linhas = ctx.db.prepare(`
      SELECT a.id, a.status, a.applied_at, j.id AS job_id, j.titulo, c.nome_empresa
      FROM applications a
      JOIN jobs j ON j.id = a.job_id
      JOIN company_profiles c ON c.id = j.company_id
      WHERE a.candidate_user_id = ?
      ORDER BY a.applied_at DESC`).all(u.id);
    return {
      body: {
        applications: linhas.map((a) => ({
          id: a.id,
          status: a.status,
          appliedAt: a.applied_at,
          job: { id: a.job_id, titulo: a.titulo, empresa: a.nome_empresa }
        }))
      }
    };
  });

  registar('POST', '/api/jobs/:id/apply', (ctx) => {
    const u = exigir(ctx, 'CANDIDATO');
    const { db, params } = ctx;
    const vaga = db.prepare(`
      SELECT j.id, j.titulo, c.user_id AS dono, c.nome_empresa
      FROM jobs j JOIN company_profiles c ON c.id = j.company_id
      WHERE j.id = ? AND ${CONDICAO_PUBLICA}`).get(params.id);
    if (!vaga) throw new HttpError(404, 'Vaga não encontrada ou já não está disponível.');

    if (!perfilDo(db, u.id).cv_path) throw new HttpError(400, 'Carregue o seu CV no painel antes de se candidatar.');
    if (db.prepare('SELECT id FROM applications WHERE job_id = ? AND candidate_user_id = ?').get(vaga.id, u.id)) {
      throw new HttpError(409, 'Já se candidatou a esta vaga.');
    }

    const candidaturaId = id();
    db.prepare('INSERT INTO applications (id, job_id, candidate_user_id, status, applied_at) VALUES (?, ?, ?, ?, ?)')
      .run(candidaturaId, vaga.id, u.id, 'SUBMETIDA', agora());
    notificar(db, u.id, `Candidatura enviada para "${vaga.titulo}" (${vaga.nome_empresa}).`);
    notificar(db, vaga.dono, `Nova candidatura para "${vaga.titulo}" de ${u.nome}.`);
    return { status: 201, body: { applicationId: candidaturaId, mensagem: 'Candidatura enviada com sucesso.' } };
  });

  /* --- Recrutador --- */

  registar('GET', '/api/company', (ctx) => {
    const u = exigir(ctx, 'RECRUTADOR');
    const e = empresaDo(ctx.db, u.id);
    return { body: { company: e ? mapEmpresa(e) : null } };
  });

  registar('POST', '/api/company', async (ctx) => {
    const u = exigir(ctx, 'RECRUTADOR');
    const { db } = ctx;
    if (empresaDo(db, u.id)) throw new HttpError(409, 'A sua conta já tem uma empresa registada.');

    const b = await lerJson(ctx.req);
    const nome = str(b.nomeEmpresa, 150);
    const nif = str(b.nif, 10);
    if (nome.length < 2) throw new HttpError(400, 'Indique o nome da empresa.');
    if (!/^\d{10}$/.test(nif)) throw new HttpError(400, 'O NIF deve ter 10 dígitos.');
    if (!dentro(b.setor, C.SETORES)) throw new HttpError(400, 'Setor inválido.');
    if (db.prepare('SELECT id FROM company_profiles WHERE nif = ?').get(nif)) {
      throw new HttpError(409, 'Este NIF já está registado.');
    }

    const eid = id();
    db.prepare(`
      INSERT INTO company_profiles (id, user_id, nome_empresa, nif, setor, descricao, status_verificacao)
      VALUES (?, ?, ?, ?, ?, ?, 'PENDENTE')`).run(eid, u.id, nome, nif, b.setor, str(b.descricao, 2000));
    return { status: 201, body: { company: mapEmpresa(db.prepare('SELECT * FROM company_profiles WHERE id = ?').get(eid)) } };
  });

  registar('POST', '/api/jobs', async (ctx) => {
    const u = exigir(ctx, 'RECRUTADOR');
    const { db } = ctx;
    const emp = empresaDo(db, u.id);
    if (!emp) throw new HttpError(400, 'Crie primeiro o perfil da empresa.');
    if (emp.status_verificacao !== 'APROVADO') throw new HttpError(403, 'A empresa ainda não foi verificada.');

    const b = await lerJson(ctx.req);
    const titulo = str(b.titulo, 150);
    const descricao = str(b.descricao, 5000);
    const requisitos = Array.isArray(b.requisitos)
      ? b.requisitos.map((r) => str(String(r), 300)).filter(Boolean).join('\n')
      : str(b.requisitos, 3000);

    if (titulo.length < 3) throw new HttpError(400, 'Indique o título do cargo.');
    if (descricao.length < 10) throw new HttpError(400, 'A descrição deve ter pelo menos 10 caracteres.');
    if (!dentro(b.provincia, C.PROVINCIAS)) throw new HttpError(400, 'Província inválida.');
    if (!dentro(b.setor, C.SETORES)) throw new HttpError(400, 'Setor inválido.');
    if (!chaveEm(b.modalidade, C.MODALIDADES)) throw new HttpError(400, 'Modalidade inválida.');
    if (!chaveEm(b.tipoContrato, C.CONTRATOS)) throw new HttpError(400, 'Tipo de contrato inválido.');

    const jobId = id();
    db.prepare(`
      INSERT INTO jobs (id, company_id, titulo, descricao, requisitos, modalidade, provincia,
                        tipo_contrato, setor, status, moderacao, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ATIVA', 'PENDENTE', ?)`).run(
      jobId, emp.id, titulo, descricao, requisitos, b.modalidade, b.provincia, b.tipoContrato, b.setor, agora()
    );
    return { status: 201, body: { job: mapVaga(db.prepare(`${SQL_VAGA} WHERE j.id = ?`).get(jobId)) } };
  });

  registar('GET', '/api/recruiter/jobs', (ctx) => {
    const u = exigir(ctx, 'RECRUTADOR');
    const { db } = ctx;
    const emp = empresaDo(db, u.id);
    if (!emp) return { body: { jobs: [] } };

    const contagens = new Map(
      db.prepare('SELECT job_id, COUNT(*) AS n FROM applications GROUP BY job_id').all().map((r) => [r.job_id, r.n])
    );
    const linhas = db.prepare(`${SQL_VAGA} WHERE c.id = ? ORDER BY j.created_at DESC`).all(emp.id);
    return { body: { jobs: linhas.map((r) => ({ ...mapVaga(r), candidaturas: contagens.get(r.id) || 0 })) } };
  });

  registar('GET', '/api/recruiter/jobs/:id/candidates', (ctx) => {
    const u = exigir(ctx, 'RECRUTADOR');
    const { db, params } = ctx;
    if (!vagaDoRecrutador(db, params.id, u.id)) throw new HttpError(404, 'Vaga não encontrada.');

    const job = mapVaga(db.prepare(`${SQL_VAGA} WHERE j.id = ?`).get(params.id));
    const linhas = db.prepare(`
      SELECT a.id, a.status, a.applied_at, p.nome_completo, p.titulo_profissional,
             p.provincia, p.cv_nome, p.cv_path IS NOT NULL AS tem_cv
      FROM applications a
      JOIN candidate_profiles p ON p.user_id = a.candidate_user_id
      WHERE a.job_id = ?
      ORDER BY a.applied_at DESC`).all(params.id);

    return {
      body: {
        job,
        applications: linhas.map((a) => ({
          id: a.id,
          status: a.status,
          appliedAt: a.applied_at,
          candidato: {
            nome: a.nome_completo,
            titulo: a.titulo_profissional,
            provincia: a.provincia,
            cvNome: a.cv_nome,
            temCv: Boolean(a.tem_cv)
          }
        }))
      }
    };
  });

  registar('GET', '/api/recruiter/applications/:id/cv', (ctx) => {
    const u = exigir(ctx, 'RECRUTADOR');
    const { db, params } = ctx;
    const linha = db.prepare(`
      SELECT c.user_id AS dono, p.cv_path, p.cv_nome
      FROM applications a
      JOIN jobs j ON j.id = a.job_id
      JOIN company_profiles c ON c.id = j.company_id
      JOIN candidate_profiles p ON p.user_id = a.candidate_user_id
      WHERE a.id = ?`).get(params.id);
    if (!linha || linha.dono !== u.id) throw new HttpError(404, 'Candidatura não encontrada.');
    if (!linha.cv_path || !fs.existsSync(linha.cv_path)) throw new HttpError(404, 'Este candidato não tem CV carregado.');
    return { raw: fs.readFileSync(linha.cv_path), tipo: 'application/pdf', nome: linha.cv_nome || 'curriculo.pdf' };
  });

  registar('PATCH', '/api/applications/:id/status', async (ctx) => {
    const u = exigir(ctx, 'RECRUTADOR');
    const { db, params } = ctx;
    const b = await lerJson(ctx.req);
    if (!chaveEm(b.status, C.STATUS_CAND)) throw new HttpError(400, 'Estado inválido.');

    const linha = db.prepare(`
      SELECT a.id, a.status, a.candidate_user_id, j.titulo, c.user_id AS dono
      FROM applications a
      JOIN jobs j ON j.id = a.job_id
      JOIN company_profiles c ON c.id = j.company_id
      WHERE a.id = ?`).get(params.id);
    if (!linha || linha.dono !== u.id) throw new HttpError(404, 'Candidatura não encontrada.');

    db.prepare('UPDATE applications SET status = ? WHERE id = ?').run(b.status, linha.id);
    if (b.status !== linha.status) {
      notificar(db, linha.candidate_user_id,
        `O estado da sua candidatura a "${linha.titulo}" mudou para: ${C.STATUS_CAND[b.status]}.`);
    }
    return { body: { application: { id: linha.id, status: b.status } } };
  });

  /* --- Administração --- */

  registar('GET', '/api/admin/pending', (ctx) => {
    exigir(ctx, 'ADMIN');
    const { db } = ctx;
    const companies = db.prepare("SELECT * FROM company_profiles WHERE status_verificacao = 'PENDENTE' ORDER BY nome_empresa")
      .all().map(mapEmpresa);
    const jobs = db.prepare(`${SQL_VAGA} WHERE j.moderacao = 'PENDENTE' ORDER BY j.created_at`).all().map(mapVaga);
    const publicadas = db.prepare(`
      SELECT COUNT(*) AS n FROM jobs j JOIN company_profiles c ON c.id = j.company_id WHERE ${CONDICAO_PUBLICA}`).get().n;
    const candidaturas = db.prepare('SELECT COUNT(*) AS n FROM applications').get().n;
    return { body: { companies, jobs, stats: { vagasPublicadas: publicadas, candidaturas } } };
  });

  registar('POST', '/api/admin/companies/:id/approve', (ctx) => {
    exigir(ctx, 'ADMIN');
    const { db, params } = ctx;
    const e = db.prepare('SELECT user_id FROM company_profiles WHERE id = ?').get(params.id);
    if (!e) throw new HttpError(404, 'Empresa não encontrada.');
    db.prepare("UPDATE company_profiles SET status_verificacao = 'APROVADO' WHERE id = ?").run(params.id);
    notificar(db, e.user_id, 'A sua empresa foi verificada. Já pode publicar vagas.');
    return { body: { mensagem: 'Empresa verificada.' } };
  });

  registar('POST', '/api/admin/jobs/:id/moderation', async (ctx) => {
    exigir(ctx, 'ADMIN');
    const { db, params } = ctx;
    const b = await lerJson(ctx.req);
    if (!dentro(b.decision, ['APROVADA', 'REJEITADA'])) throw new HttpError(400, 'Decisão inválida.');

    const j = db.prepare(`
      SELECT j.titulo, c.user_id AS dono FROM jobs j JOIN company_profiles c ON c.id = j.company_id WHERE j.id = ?`).get(params.id);
    if (!j) throw new HttpError(404, 'Vaga não encontrada.');
    db.prepare('UPDATE jobs SET moderacao = ? WHERE id = ?').run(b.decision, params.id);
    notificar(db, j.dono, `A vaga "${j.titulo}" foi ${b.decision === 'APROVADA' ? 'publicada' : 'recusada'}.`);
    return { body: { mensagem: b.decision === 'APROVADA' ? 'Vaga publicada.' : 'Vaga recusada.' } };
  });

  /* ---------- Despacho ---------- */

  const casar = (rota, caminho) => {
    const esperadas = rota.partes;
    const recebidas = caminho.split('/').filter(Boolean);
    if (esperadas.length !== recebidas.length) return null;
    const params = {};
    for (let i = 0; i < esperadas.length; i += 1) {
      if (esperadas[i].startsWith(':')) {
        try { params[esperadas[i].slice(1)] = decodeURIComponent(recebidas[i]); } catch (_) { return null; }
      } else if (esperadas[i] !== recebidas[i]) {
        return null;
      }
    }
    return params;
  };

  return async function tratarApi(req, res, db) {
    const url = new URL(req.url, 'http://localhost');
    let rota = null;
    let params = null;
    let metodoExiste = false;

    for (const candidata of rotas) {
      const p = casar(candidata, url.pathname);
      if (!p) continue;
      if (candidata.metodo === req.method) { rota = candidata; params = p; break; }
      metodoExiste = true;
    }
    if (!rota) {
      return enviar(res, metodoExiste ? 405 : 404, { erro: metodoExiste ? 'Método não permitido.' : 'Rota não encontrada.' });
    }

    try {
      const resultado = await rota.fn({ req, res, db, url, params });
      if (resultado.raw) {
        res.writeHead(200, {
          'Content-Type': resultado.tipo,
          'Content-Length': resultado.raw.length,
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(resultado.nome)}`
        });
        return res.end(resultado.raw);
      }
      return enviar(res, resultado.status || 200, resultado.body ?? {});
    } catch (err) {
      if (err instanceof HttpError) return enviar(res, err.status, { erro: err.message });
      if (/UNIQUE constraint/.test(err.message)) {
        return enviar(res, 409, { erro: 'Já existe um registo com estes dados.' });
      }
      console.error(err);
      return enviar(res, 500, { erro: 'Erro interno do servidor.' });
    }
  };
}

module.exports = { criarApi, criarUtilizador };
