-- JobsAngola: esquema da base de dados.
-- Executado automaticamente ao arrancar o servidor (SQLite, via node:sqlite).
-- Para PostgreSQL em produção: TEXT -> UUID/VARCHAR, TEXT (datas) -> TIMESTAMPTZ.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('CANDIDATO', 'RECRUTADOR', 'ADMIN')),
  nome          TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS candidate_profiles (
  user_id             TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  nome_completo       TEXT NOT NULL DEFAULT '',
  telefone            TEXT NOT NULL DEFAULT '',
  provincia           TEXT NOT NULL DEFAULT '',
  titulo_profissional TEXT NOT NULL DEFAULT '',
  resumo              TEXT NOT NULL DEFAULT '',
  cv_path             TEXT,
  cv_nome             TEXT
);

CREATE TABLE IF NOT EXISTS company_profiles (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  nome_empresa       TEXT NOT NULL,
  nif                TEXT NOT NULL UNIQUE CHECK (length(nif) = 10),
  setor              TEXT NOT NULL,
  logo_url           TEXT,
  descricao          TEXT NOT NULL DEFAULT '',
  status_verificacao TEXT NOT NULL DEFAULT 'PENDENTE'
                     CHECK (status_verificacao IN ('PENDENTE', 'APROVADO'))
);

CREATE TABLE IF NOT EXISTS jobs (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES company_profiles(id) ON DELETE CASCADE,
  titulo        TEXT NOT NULL,
  descricao     TEXT NOT NULL,
  requisitos    TEXT NOT NULL DEFAULT '',
  modalidade    TEXT NOT NULL CHECK (modalidade IN ('PRESENCIAL', 'REMOTO', 'HIBRIDO')),
  provincia     TEXT NOT NULL,
  tipo_contrato TEXT NOT NULL CHECK (tipo_contrato IN ('EFETIVO', 'TERMO_CERTO', 'ESTAGIO', 'PRESTACAO')),
  setor         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'ATIVA' CHECK (status IN ('ATIVA', 'ENCERRADA')),
  moderacao     TEXT NOT NULL DEFAULT 'PENDENTE'
                CHECK (moderacao IN ('PENDENTE', 'APROVADA', 'REJEITADA')),
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_publicas ON jobs (moderacao, status, created_at);

CREATE TABLE IF NOT EXISTS applications (
  id                TEXT PRIMARY KEY,
  job_id            TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  candidate_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'SUBMETIDA'
                    CHECK (status IN ('SUBMETIDA', 'EM_ANALISE', 'ENTREVISTA', 'REJEITADA', 'ACEITA')),
  applied_at        TEXT NOT NULL,
  UNIQUE (job_id, candidate_user_id)
);
CREATE INDEX IF NOT EXISTS idx_applications_job ON applications (job_id);

-- Registo das notificações enviadas (e-mail simulado nesta versão).
CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mensagem   TEXT NOT NULL,
  created_at TEXT NOT NULL
);
