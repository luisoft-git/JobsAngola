# JobsAngola

Portal de empregos para Angola. Liga candidatos a empresas verificadas, com candidatura simples, acompanhamento do processo e moderação das vagas antes de ficarem públicas.

Esta é a versão **MVP**: backend com API REST e base de dados SQLite, e frontend em HTML, CSS e JavaScript puros. Não tem dependências externas, por isso não é preciso `npm install`.

## Requisitos

- Node.js **22.13 ou superior** (usa o módulo nativo `node:sqlite`).

## Como executar

```bash
# Arranque com dados de demonstração
SEED_DEMO=1 npm run dev

# Arranque normal (base de dados vazia)
npm start
```

Abra `http://localhost:3000`.

Com `SEED_DEMO=1`, são criadas estas contas (senha `demo12345`):

| Perfil | E-mail |
|--------|--------|
| Candidato | `candidato@exemplo.com` |
| Recrutador | `rh@techkwanza.exemplo.com` |
| Administrador | `admin@exemplo.com` |

## Configuração

Variáveis de ambiente:

| Variável | Predefinição | Descrição |
|----------|--------------|-----------|
| `PORT` | `3000` | Porta do servidor |
| `DATABASE_PATH` | `data/jobsangola.db` | Ficheiro da base de dados SQLite |
| `JWT_SECRET` | aleatório a cada arranque | **Obrigatório em produção.** Segredo para assinar os tokens |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | — | Cria a conta de administração no arranque (senha com pelo menos 8 caracteres) |
| `SEED_DEMO` | — | `1` para criar dados de demonstração se a base estiver vazia |

## Testes

```bash
npm test
```

Os testes arrancam um servidor com base de dados em memória e percorrem o fluxo completo: registo, verificação da empresa, moderação da vaga, candidatura, mudança de estado e acesso ao CV.

## Fluxo de negócio

1. O **recrutador** regista-se e cria o perfil da empresa com o NIF.
2. O **administrador** verifica a empresa. Só depois o recrutador pode publicar vagas.
3. Cada vaga fica **em moderação** e só aparece publicamente quando o administrador a aprova.
4. O **candidato** carrega o CV (PDF, até 5 MB) e candidata-se a vagas públicas.
5. O recrutador vê os candidatos num painel Kanban, descarrega o CV e muda o estado de cada candidatura. O candidato é notificado.

## API

Todas as respostas são JSON. As rotas protegidas exigem `Authorization: Bearer <token>`.

| Método | Rota | Perfil | Descrição |
|--------|------|--------|-----------|
| GET | `/api/meta` | — | Catálogos: províncias, modalidades, contratos, setores, estados |
| GET | `/api/jobs?q=&provincia=&modalidade=&tipoContrato=` | — | Vagas públicas |
| GET | `/api/jobs/:id` | — | Detalhe de uma vaga |
| POST | `/api/auth/register` | — | Criar conta (`CANDIDATO` ou `RECRUTADOR`) |
| POST | `/api/auth/login` | — | Iniciar sessão (limite de 10 tentativas por 15 min) |
| GET | `/api/auth/me` | Autenticado | Utilizador atual |
| GET / PUT | `/api/candidate/profile` | Candidato | Ler e atualizar o perfil |
| POST | `/api/candidate/cv` | Candidato | Enviar CV em PDF (corpo binário) |
| GET | `/api/candidate/applications` | Candidato | Histórico de candidaturas |
| POST | `/api/jobs/:id/apply` | Candidato | Candidatar-se a uma vaga |
| GET / POST | `/api/company` | Recrutador | Ler ou criar o perfil da empresa |
| POST | `/api/jobs` | Recrutador | Criar vaga (empresa verificada) |
| GET | `/api/recruiter/jobs` | Recrutador | Vagas da minha empresa |
| GET | `/api/recruiter/jobs/:id/candidates` | Recrutador | Candidatos de uma vaga |
| GET | `/api/recruiter/applications/:id/cv` | Recrutador | Descarregar o CV |
| PATCH | `/api/applications/:id/status` | Recrutador | Alterar o estado da candidatura |
| GET | `/api/admin/pending` | Administrador | Empresas e vagas por analisar |
| POST | `/api/admin/companies/:id/approve` | Administrador | Verificar empresa |
| POST | `/api/admin/jobs/:id/moderation` | Administrador | Aprovar ou recusar vaga (`decision`) |

## Segurança implementada

- Senhas com **scrypt** (`node:crypto`), sem texto simples.
- Tokens **HS256** assinados, com validade de 12 horas.
- Verificação de perfil e de propriedade em cada rota no servidor.
- Limite de tentativas no login.
- Validação de tipo do CV pelo conteúdo (`%PDF-`) e não só pela extensão.
- Limite de tamanho nos corpos dos pedidos.
- Cabeçalhos `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options` e `Referrer-Policy`.
- Proteção contra path traversal no servidor de ficheiros estáticos.

## Estrutura

```
JobsAngola/
├── server/
│   ├── index.js      # Arranque do servidor
│   ├── app.js        # Roteamento HTTP e ficheiros estáticos
│   ├── api.js        # Rotas da API e regras de negócio
│   ├── auth.js       # Senhas (scrypt) e tokens (HS256)
│   ├── db.js         # Ligação à base de dados e aplicação do esquema
│   ├── http.js       # Respostas JSON e leitura de corpos
│   ├── constants.js  # Catálogos partilhados
│   └── seed.js       # Conta de administração e dados de demonstração
├── db/schema.sql    # Esquema da base de dados
├── public/           # Frontend (HTML, CSS, JavaScript)
├── test/api.test.js  # Testes de integração da API
└── package.json
```

## Limitações e próximos passos para produção

1. **Base de dados**: o SQLite serve para desenvolvimento e para uma instância pequena. Para produção, migrar para PostgreSQL (o `db/schema.sql` indica os ajustes de tipos).
2. **Ficheiros**: os CVs ficam no disco local. Migrar para S3 ou Cloudinary com URLs assinados.
3. **E-mail**: as notificações são registadas na consola. Integrar SendGrid ou Resend.
4. **Recuperação de senha** e verificação de e-mail ainda não existem.
5. **Verificação de NIF**: a aprovação é manual. A validação automática junto de fontes oficiais fica por definir.
6. **Pesquisa**: usa `LIKE`, que não ignora acentos. Para pesquisa avançada, usar PostgreSQL com índices de texto completo.
7. **Frontend**: o token fica em `localStorage`. Em produção, considerar cookies `HttpOnly` com `SameSite`.
8. **Infraestrutura**: definir `JWT_SECRET` e `ADMIN_PASSWORD` através de variáveis de ambiente e servir atrás de HTTPS.
