'use strict';

const { id, agora } = require('./db');
const { criarUtilizador } = require('./api');

/** Cria a conta de administração a partir de ADMIN_EMAIL e ADMIN_PASSWORD (se ainda não existir). */
function garantirAdmin(db) {
  const email = process.env.ADMIN_EMAIL;
  const senha = process.env.ADMIN_PASSWORD;
  if (!email || !senha) return;
  if (senha.length < 8) throw new Error('ADMIN_PASSWORD deve ter pelo menos 8 caracteres.');
  const existe = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (!existe) criarUtilizador(db, { nome: 'Administração', email, password: senha, role: 'ADMIN' });
}

/** Dados de demonstração (apenas se a base estiver vazia). */
function semearDemo(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM company_profiles').get().n > 0) return false;

  const senha = 'demo12345';
  const recrutador = (nome, email) => criarUtilizador(db, { nome, email, password: senha, role: 'RECRUTADOR' });

  const empresa = (userId, nome, nif, setor, descricao, status) => {
    const eid = id();
    db.prepare(`INSERT INTO company_profiles (id, user_id, nome_empresa, nif, setor, descricao, status_verificacao)
                VALUES (?, ?, ?, ?, ?, ?, ?)`).run(eid, userId, nome, nif, setor, descricao, status);
    return eid;
  };

  const vaga = (companyId, v, moderacao, diasAtras) => {
    db.prepare(`INSERT INTO jobs (id, company_id, titulo, descricao, requisitos, modalidade, provincia,
                                  tipo_contrato, setor, status, moderacao, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ATIVA', ?, ?)`).run(
      id(), companyId, v.titulo, v.descricao, v.requisitos, v.modalidade, v.provincia, v.tipo, v.setor,
      moderacao, new Date(Date.now() - diasAtras * 864e5).toISOString()
    );
  };

  const c1 = empresa(recrutador('RH TechKwanza', 'rh@techkwanza.exemplo.com'),
    'TechKwanza, Lda', '5417890123', 'Tecnologia',
    'Desenvolvemos software para pequenas e médias empresas angolanas.', 'APROVADO');
  const c2 = empresa(recrutador('RH Agro Namibe', 'rh@agronamibe.exemplo.com'),
    'Agro Namibe, SA', '5000123456', 'Agricultura',
    'Produção e comercialização agrícola na costa sul.', 'APROVADO');
  const c3 = empresa(recrutador('Nova Empresa', 'geral@novaempresa.exemplo.com'),
    'Nova Empresa, Lda', '5499887766', 'Comércio', 'Comércio geral de produtos de consumo.', 'PENDENTE');

  vaga(c1, { titulo: 'Desenvolvedor Front-end (React)', setor: 'Tecnologia', modalidade: 'HIBRIDO', provincia: 'Luanda', tipo: 'EFETIVO',
    descricao: 'Construir interfaces rápidas e leves para os nossos clientes, otimizadas para telemóveis e redes 3G/4G.',
    requisitos: '2+ anos de experiência com React\nExperiência com TypeScript\nBoa comunicação em português' }, 'APROVADA', 2);
  vaga(c1, { titulo: 'Técnico de Suporte Informático', setor: 'Tecnologia', modalidade: 'PRESENCIAL', provincia: 'Luanda', tipo: 'TERMO_CERTO',
    descricao: 'Apoio a clientes por telefone e presencialmente, instalação e manutenção de equipamentos.',
    requisitos: 'Curso técnico em informática\nConhecimentos de redes básicas\nDisponibilidade para deslocações' }, 'APROVADA', 5);
  vaga(c1, { titulo: 'Estágio em Design UX/UI', setor: 'Tecnologia', modalidade: 'REMOTO', provincia: 'Luanda', tipo: 'ESTAGIO',
    descricao: 'Apoiar a equipa de produto na criação de protótipos e testes com utilizadores.',
    requisitos: 'Estudante de Design ou áreas afins\nDomínio de Figma\nCriatividade e vontade de aprender' }, 'APROVADA', 1);
  vaga(c2, { titulo: 'Engenheiro Agrónomo', setor: 'Agricultura', modalidade: 'PRESENCIAL', provincia: 'Namibe', tipo: 'EFETIVO',
    descricao: 'Acompanhar as culturas nas parcelas, planear rotações e supervisionar a equipa de campo.',
    requisitos: 'Licenciatura em Engenharia Agronómica\nExperiência em culturas tropicais\nCarta de condução B' }, 'APROVADA', 3);
  vaga(c2, { titulo: 'Motorista de Camião', setor: 'Agricultura', modalidade: 'PRESENCIAL', provincia: 'Benguela', tipo: 'EFETIVO',
    descricao: 'Transporte de produtos agrícolas entre armazéns e portos, com registo diário de viagens.',
    requisitos: 'Carta de condução C ou superior\nMínimo de 3 anos de experiência\nCertificado de saúde em dia' }, 'APROVADA', 4);
  vaga(c3, { titulo: 'Gestor de Loja', setor: 'Comércio', modalidade: 'PRESENCIAL', provincia: 'Huíla', tipo: 'EFETIVO',
    descricao: 'Gerir a loja, a equipa de vendas e o controlo de stock.',
    requisitos: 'Experiência em comércio retalhista\nLiderança de equipas' }, 'PENDENTE', 0);

  criarUtilizador(db, { nome: 'Ana Mendes', email: 'candidato@exemplo.com', password: senha, role: 'CANDIDATO' });
  criarUtilizador(db, { nome: 'Administração', email: 'admin@exemplo.com', password: senha, role: 'ADMIN' });
  console.log(`Dados de demonstração criados. Senha de todas as contas: ${senha}`);
  console.log('  Candidato:     candidato@exemplo.com');
  console.log('  Recrutador:    rh@techkwanza.exemplo.com');
  console.log('  Administrador: admin@exemplo.com');
  return true;
}

module.exports = { garantirAdmin, semearDemo };
