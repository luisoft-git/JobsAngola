(() => {
  'use strict';

  const TOKEN_KEY = 'jobsangola-token';
  const MAX_CV_BYTES = 5 * 1024 * 1024;

  const TOM_CAND = { SUBMETIDA: 'gray', EM_ANALISE: 'blue', ENTREVISTA: 'yellow', ACEITA: 'green', REJEITADA: 'red' };
  const TOM_VAGA = { PENDENTE: 'yellow', APROVADA: 'green', REJEITADA: 'red' };

  let meta = null;          // catálogo vindo de GET /api/meta
  let utilizador = null;    // sessão atual
  let pedidoLista = 0;      // evita respostas antigas na pesquisa

  /* =========================================================
   * Comunicação com a API
   * ========================================================= */
  async function api(caminho, { metodo = 'GET', corpo, bruto, tipo, nomeFicheiro } = {}) {
    const headers = {};
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) headers.Authorization = `Bearer ${token}`;

    let body;
    if (bruto) {
      headers['Content-Type'] = tipo;
      if (nomeFicheiro) headers['X-File-Name'] = encodeURIComponent(nomeFicheiro);
      body = bruto;
    } else if (corpo !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(corpo);
    }

    const res = await fetch(caminho, { method: metodo, headers, body });
    const dados = await res.json().catch(() => ({}));
    if (!res.ok) {
      const erro = new Error(dados.erro || 'Erro inesperado. Tente novamente.');
      erro.status = res.status;
      throw erro;
    }
    return dados;
  }

  /* =========================================================
   * Utilitários
   * ========================================================= */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (iso) => new Date(iso).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' });

  const opts = (lista, atual, vazio) => {
    const pares = Array.isArray(lista) ? lista.map((v) => [v, v]) : Object.entries(lista);
    const inicio = vazio ? `<option value="">${esc(vazio)}</option>` : '';
    return inicio + pares.map(([v, t]) => `<option value="${esc(v)}" ${v === atual ? 'selected' : ''}>${esc(t)}</option>`).join('');
  };

  const badge = (tom, texto) => `<span class="badge ${tom}">${esc(texto)}</span>`;
  const statusBadge = (st) => badge(TOM_CAND[st], meta.estadosCandidatura[st]);
  const vagaBadge = (j) => badge(TOM_VAGA[j.moderacao], meta.estadosVaga[j.moderacao]);
  const empresaBadge = (c) => badge(c.status === 'APROVADO' ? 'green' : 'yellow', meta.estadosEmpresa[c.status]);
  const tags = (j) => `<span class="tag">${esc(meta.modalidades[j.modalidade])}</span>`
    + `<span class="tag">${esc(meta.contratos[j.tipoContrato])}</span>`
    + `<span class="tag">${esc(j.setor)}</span>`;

  let toastTimer;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
  }

  /* =========================================================
   * Navegação
   * ========================================================= */
  function renderNav() {
    const links = [['#/vagas', 'Vagas']];
    if (utilizador?.role === 'CANDIDATO') links.push(['#/candidato', 'Meu painel']);
    if (utilizador?.role === 'RECRUTADOR') links.push(['#/recrutador', 'Minha empresa']);
    if (utilizador?.role === 'ADMIN') links.push(['#/admin', 'Moderação']);
    const atual = location.hash.split('?')[0];
    document.getElementById('nav').innerHTML =
      links.map(([h, t]) => `<a href="${h}" class="${atual === h ? 'active' : ''}">${t}</a>`).join('') +
      (utilizador
        ? `<span class="who">${esc(utilizador.nome)}</span><button class="btn ghost sm" data-action="logout">Sair</button>`
        : '<a class="btn sm" href="#/login">Entrar</a>');
  }

  const negado = (root) => {
    root.innerHTML = `<div class="empty"><h2>Acesso reservado</h2><p>Entre com a conta correta para ver esta página.</p><a class="btn" href="#/login">Entrar</a></div>`;
  };

  const naoEncontrado = (root, texto) => {
    root.innerHTML = `<div class="empty"><h2>${esc(texto)}</h2><a class="btn" href="#/vagas">Ver vagas</a></div>`;
  };

  const ROTAS = [
    [/^\/$/, viewHome],
    [/^\/vagas$/, viewVagas],
    [/^\/vagas\/([^/]+)$/, viewVaga],
    [/^\/login$/, viewLogin],
    [/^\/candidato$/, viewCandidato],
    [/^\/recrutador$/, viewRecrutador],
    [/^\/admin$/, viewAdmin]
  ];

  async function route() {
    const raw = location.hash.replace(/^#/, '') || '/';
    const [caminho, qs = ''] = raw.split('?');
    const path = caminho.replace(/\/+$/, '') || '/';
    const params = new URLSearchParams(qs);
    renderNav();
    const root = document.getElementById('app');

    for (const [re, fn] of ROTAS) {
      const m = path.match(re);
      if (m) {
        try {
          await fn(root, params, ...m.slice(1).map(decodeURIComponent));
        } catch (err) {
          root.innerHTML = `<div class="empty"><h2>Não foi possível carregar a página</h2><p>${esc(err.message)}</p><a class="btn" href="#/">Voltar ao início</a></div>`;
        }
        return;
      }
    }
    root.innerHTML = '<div class="empty"><h2>Página não encontrada</h2><a class="btn" href="#/">Voltar ao início</a></div>';
  }

  /* =========================================================
   * Componentes
   * ========================================================= */
  const jobCard = (j) => `<a class="card" href="#/vagas/${esc(j.id)}">
      <div class="job-head">
        <span class="logo">${esc(j.company.nome.charAt(0))}</span>
        <div><h3>${esc(j.titulo)}</h3><p class="muted small">${esc(j.company.nome)} · ${esc(j.provincia)}</p></div>
      </div>
      <div class="tags">${tags(j)}</div>
      <p class="small muted">Publicada em ${fmt(j.createdAt)}</p>
    </a>`;

  /* ---------- Início ---------- */
  async function viewHome(root) {
    const { jobs } = await api('/api/jobs');
    root.innerHTML = `
      <section class="hero">
        <p class="eyebrow">Emprego em Angola</p>
        <h1>Encontre o seu próximo emprego</h1>
        <p class="lead">Vagas de empresas verificadas, candidatura em poucos cliques e acompanhamento do seu processo.</p>
        <form class="search" data-form="home-search">
          <input name="q" placeholder="Cargo ou palavra-chave, ex.: contabilista" aria-label="Cargo ou palavra-chave">
          <select name="provincia" aria-label="Província">${opts(meta.provincias, '', 'Todas as províncias')}</select>
          <button class="btn">Pesquisar</button>
        </form>
        <div class="cta">
          <a class="btn outline" href="#/login">Cadastre o seu CV</a>
          <a class="btn outline" href="#/login?modo=criar">Publique uma vaga</a>
        </div>
      </section>
      <section>
        <div class="section-head"><h2>Vagas recentes</h2><a href="#/vagas">Ver todas →</a></div>
        <div class="grid">${jobs.slice(0, 6).map(jobCard).join('') || '<p class="muted">Ainda não há vagas publicadas.</p>'}</div>
      </section>`;
  }

  /* ---------- Lista de vagas ---------- */
  async function viewVagas(root, params) {
    root.innerHTML = `
      <h1>Vagas em Angola</h1>
      <form class="filters" data-form="vagas-filter">
        <input type="search" name="q" placeholder="Cargo, setor ou palavra-chave" aria-label="Pesquisar" value="${esc(params.get('q') || '')}">
        <select name="provincia" aria-label="Província">${opts(meta.provincias, params.get('provincia'), 'Todas as províncias')}</select>
        <select name="modalidade" aria-label="Modalidade">${opts(meta.modalidades, params.get('modalidade'), 'Qualquer modalidade')}</select>
        <select name="tipoContrato" aria-label="Tipo de contrato">${opts(meta.contratos, params.get('tipoContrato'), 'Qualquer contrato')}</select>
      </form>
      <p class="muted small" id="contagem"></p>
      <div class="grid" id="lista"></div>`;
    await atualizarLista(root.querySelector('form'));
  }

  async function atualizarLista(form) {
    const d = new FormData(form);
    const qs = new URLSearchParams();
    for (const [k, v] of d.entries()) if (v) qs.set(k, v);
    history.replaceState(null, '', '#/vagas' + (qs.toString() ? '?' + qs : ''));

    const pedido = ++pedidoLista;
    const { jobs } = await api('/api/jobs?' + qs.toString());
    if (pedido !== pedidoLista) return; // resposta antiga

    const lista = document.getElementById('lista');
    if (!lista) return;
    lista.innerHTML = jobs.length
      ? jobs.map(jobCard).join('')
      : '<div class="empty">Nenhuma vaga encontrada. Experimente outros filtros.</div>';
    document.getElementById('contagem').textContent = `${jobs.length} vaga(s) encontrada(s)`;
  }

  /* ---------- Detalhe ---------- */
  async function viewVaga(root, _params, id) {
    let dados;
    try {
      dados = await api(`/api/jobs/${encodeURIComponent(id)}`);
    } catch (err) {
      if (err.status === 404) return naoEncontrado(root, 'Vaga não encontrada');
      throw err;
    }
    const { job: j, minhaCandidatura } = dados;

    let acao;
    if (!utilizador) acao = '<a class="btn full" href="#/login">Entre como candidato para se candidatar</a>';
    else if (utilizador.role !== 'CANDIDATO') acao = '<p class="muted">Apenas candidatos podem candidatar-se a vagas.</p>';
    else if (minhaCandidatura) acao = `<p>Já se candidatou em ${fmt(minhaCandidatura.appliedAt)}.</p>${statusBadge(minhaCandidatura.status)}`;
    else acao = `<button class="btn full" data-action="apply" data-id="${esc(j.id)}">Candidatar-me</button>`;

    root.innerHTML = `
      <a href="#/vagas" class="back">← Voltar às vagas</a>
      <div class="detail">
        <article class="panel">
          <h1>${esc(j.titulo)}</h1>
          <p class="muted">${esc(j.company.nome)} · ${esc(j.provincia)} · publicada em ${fmt(j.createdAt)}</p>
          <div class="tags">${tags(j)}</div>
          <h2>Descrição</h2>
          <p>${esc(j.descricao)}</p>
          <h2>Requisitos</h2>
          <ul>${j.requisitos.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
        </article>
        <aside class="panel">
          ${acao}
          <hr>
          <h3>Sobre a empresa</h3>
          <p>${esc(j.company.descricao)}</p>
          <p class="small muted">Setor: ${esc(j.company.setor)}</p>
          ${empresaBadge(j.company)}
        </aside>
      </div>`;
  }

  /* ---------- Login e registo ---------- */
  function viewLogin(root, params) {
    const criar = params.get('modo') === 'criar';
    root.innerHTML = `
      <div class="auth panel">
        <nav class="tabs">
          <a class="tab ${criar ? '' : 'active'}" href="#/login">Entrar</a>
          <a class="tab ${criar ? 'active' : ''}" href="#/login?modo=criar">Criar conta</a>
        </nav>
        ${criar ? `
          <form class="form" data-form="criar">
            <fieldset class="roles">
              <legend>Eu sou</legend>
              <label><input type="radio" name="role" value="CANDIDATO" checked> Candidato</label>
              <label><input type="radio" name="role" value="RECRUTADOR"> Recrutador / empresa</label>
            </fieldset>
            <label>Nome completo<input name="nome" required minlength="2" autocomplete="name"></label>
            <label>E-mail<input type="email" name="email" required autocomplete="email"></label>
            <label>Senha (mínimo 8 caracteres)<input type="password" name="password" required minlength="8" autocomplete="new-password"></label>
            <button class="btn full">Criar conta</button>
          </form>` : `
          <form class="form" data-form="entrar">
            <label>E-mail<input type="email" name="email" required autocomplete="email"></label>
            <label>Senha<input type="password" name="password" required autocomplete="current-password"></label>
            <button class="btn full">Entrar</button>
          </form>`}
      </div>`;
  }

  function iniciarSessao(r) {
    localStorage.setItem(TOKEN_KEY, r.token);
    utilizador = r.user;
    const destino = { CANDIDATO: '#/candidato', RECRUTADOR: '#/recrutador', ADMIN: '#/admin' }[utilizador.role];
    location.hash = destino;
  }

  /* ---------- Painel do candidato ---------- */
  async function viewCandidato(root) {
    if (utilizador?.role !== 'CANDIDATO') return negado(root);
    const [{ profile: p }, { applications }] = await Promise.all([
      api('/api/candidate/profile'),
      api('/api/candidate/applications')
    ]);

    root.innerHTML = `
      <h1>Meu painel</h1>
      <div class="two-col">
        <section class="panel">
          <h2>Perfil</h2>
          <form class="form" data-form="candidato-perfil">
            <label>Nome completo<input name="nome" required minlength="2" value="${esc(p.nomeCompleto)}"></label>
            <label>Telefone<input name="telefone" type="tel" placeholder="+244 9xx xxx xxx" value="${esc(p.telefone)}"></label>
            <label>Província<select name="provincia">${opts(meta.provincias, p.provincia, 'Selecione')}</select></label>
            <label>Título profissional<input name="titulo" placeholder="ex.: Contabilista" value="${esc(p.tituloProfissional)}"></label>
            <label>Resumo<textarea name="resumo" rows="4">${esc(p.resumo)}</textarea></label>
            <label>Currículo (PDF, até 5 MB)<input type="file" name="cv" accept="application/pdf,.pdf"></label>
            <p class="small muted">${p.cvNome ? `CV atual: ${esc(p.cvNome)}.` : 'Ainda não tem CV carregado.'}</p>
            <button class="btn">Guardar perfil</button>
          </form>
        </section>
        <section class="panel">
          <h2>Minhas candidaturas</h2>
          ${applications.length
            ? applications.map((a) => `<div class="row-item">
                <div><strong>${esc(a.job.titulo)}</strong>
                  <div class="small muted">${esc(a.job.empresa)} · candidatura em ${fmt(a.appliedAt)}</div></div>
                ${statusBadge(a.status)}
              </div>`).join('')
            : '<p class="muted">Ainda não se candidatou a nenhuma vaga. <a href="#/vagas">Ver vagas</a></p>'}
        </section>
      </div>`;
  }

  /* ---------- Painel do recrutador ---------- */
  async function viewRecrutador(root, params) {
    if (utilizador?.role !== 'RECRUTADOR') return negado(root);
    const { company: emp } = await api('/api/company');

    if (!emp) {
      root.innerHTML = `
        <h1>Publique vagas</h1>
        <section class="panel narrow">
          <h2>Crie o perfil da sua empresa</h2>
          <p class="muted">Verificamos o NIF antes de publicar vagas, para proteger os candidatos de burlas.</p>
          <form class="form" data-form="empresa-criar">
            <label>Nome da empresa<input name="nome" required minlength="2"></label>
            <label>NIF (10 dígitos)<input name="nif" required inputmode="numeric" pattern="\\d{10}"></label>
            <label>Setor<select name="setor">${opts(meta.setores)}</select></label>
            <label>Descrição<textarea name="descricao" rows="4"></textarea></label>
            <button class="btn">Enviar para verificação</button>
          </form>
        </section>`;
      return;
    }

    const pendente = emp.status !== 'APROVADO';
    const { jobs } = await api('/api/recruiter/jobs');
    const selId = params.get('vaga');
    let painelKanban = '';
    if (selId && jobs.some((j) => j.id === selId)) {
      const { job, applications } = await api(`/api/recruiter/jobs/${encodeURIComponent(selId)}/candidates`);
      painelKanban = kanban(job, applications);
    }

    root.innerHTML = `
      <h1>${esc(emp.nome)} ${empresaBadge(emp)}</h1>
      ${pendente ? '<div class="notice">A sua empresa está em verificação. Assim que o NIF for confirmado poderá publicar vagas.</div>' : ''}
      <div class="two-col">
        <section class="panel">
          <h2>Publicar nova vaga</h2>
          ${pendente ? '<p class="muted">Disponível após a verificação da empresa.</p>' : vagaForm()}
        </section>
        <section class="panel">
          <h2>As minhas vagas</h2>
          ${jobs.length ? jobs.map(vagaRow).join('') : '<p class="muted">Ainda não publicou vagas.</p>'}
        </section>
      </div>
      ${painelKanban}`;
  }

  function vagaForm() {
    return `
      <form class="form" data-form="vaga-criar">
        <label>Título do cargo<input name="titulo" required minlength="3"></label>
        <div class="grid-2">
          <label>Setor<select name="setor">${opts(meta.setores)}</select></label>
          <label>Província<select name="provincia" required>${opts(meta.provincias, '', 'Selecione')}</select></label>
          <label>Modalidade<select name="modalidade">${opts(meta.modalidades)}</select></label>
          <label>Tipo de contrato<select name="tipoContrato">${opts(meta.contratos)}</select></label>
        </div>
        <label>Descrição<textarea name="descricao" rows="5" required minlength="10"></textarea></label>
        <label>Requisitos (um por linha)<textarea name="requisitos" rows="4"></textarea></label>
        <button class="btn">Enviar para moderação</button>
      </form>`;
  }

  const vagaRow = (j) => `<a class="row-item link" href="#/recrutador?vaga=${esc(j.id)}">
      <div><strong>${esc(j.titulo)}</strong>
        <div class="small muted">${j.candidaturas} candidatura(s) · ${fmt(j.createdAt)}</div></div>
      ${vagaBadge(j)}
    </a>`;

  function kanban(job, applications) {
    const colunas = Object.keys(meta.estadosCandidatura).map((st) => {
      const itens = applications.filter((a) => a.status === st);
      return `<div class="col">
        <h3>${esc(meta.estadosCandidatura[st])} <span class="count">${itens.length}</span></h3>
        ${itens.map(cardCandidato).join('') || '<p class="muted small">Nenhum</p>'}
      </div>`;
    }).join('');

    return `<section class="panel kanban-panel">
      <h2>Candidatos · ${esc(job.titulo)}</h2>
      ${applications.length ? `<div class="kanban">${colunas}</div>` : '<p class="muted">Ainda não há candidaturas para esta vaga.</p>'}
    </section>`;
  }

  function cardCandidato(a) {
    const c = a.candidato;
    return `<div class="kcard">
      <strong>${esc(c.nome)}</strong>
      <div class="small muted">${esc(c.titulo)}${c.provincia ? ' · ' + esc(c.provincia) : ''}</div>
      <div class="small muted">${fmt(a.appliedAt)}</div>
      ${c.temCv
        ? `<button class="btn outline sm" data-action="baixar-cv" data-id="${esc(a.id)}" data-nome="${esc(c.cvNome)}">Baixar CV</button>`
        : '<span class="small muted">Sem CV</span>'}
      <label class="small">Estado
        <select data-status-select="${esc(a.id)}">${opts(meta.estadosCandidatura, a.status)}</select>
      </label>
    </div>`;
  }

  /* ---------- Administração ---------- */
  async function viewAdmin(root) {
    if (utilizador?.role !== 'ADMIN') return negado(root);
    const { companies, jobs, stats } = await api('/api/admin/pending');
    const stat = (rotulo, valor) => `<div class="stat"><span>${valor}</span>${esc(rotulo)}</div>`;

    root.innerHTML = `
      <h1>Moderação</h1>
      <div class="stats">
        ${stat('Empresas por verificar', companies.length)}
        ${stat('Vagas por moderar', jobs.length)}
        ${stat('Vagas publicadas', stats.vagasPublicadas)}
        ${stat('Candidaturas', stats.candidaturas)}
      </div>
      <div class="two-col">
        <section class="panel">
          <h2>Empresas por verificar</h2>
          ${companies.map((c) => `<div class="row-item">
              <div><strong>${esc(c.nome)}</strong><div class="small muted">NIF ${esc(c.nif)} · ${esc(c.setor)}</div></div>
              <button class="btn sm" data-action="aprovar-empresa" data-id="${esc(c.id)}">Verificar</button>
            </div>`).join('') || '<p class="muted">Nenhuma pendente.</p>'}
        </section>
        <section class="panel">
          <h2>Vagas por moderar</h2>
          ${jobs.map((j) => `<div class="row-item">
              <div><strong>${esc(j.titulo)}</strong><div class="small muted">${esc(j.company.nome)} · ${esc(j.provincia)}</div></div>
              <div class="btns">
                <button class="btn sm" data-action="moderar-vaga" data-id="${esc(j.id)}" data-decisao="APROVADA">Aprovar</button>
                <button class="btn sm outline" data-action="moderar-vaga" data-id="${esc(j.id)}" data-decisao="REJEITADA">Recusar</button>
              </div>
            </div>`).join('') || '<p class="muted">Nenhuma pendente.</p>'}
        </section>
      </div>`;
  }

  /* =========================================================
   * Ações e formulários
   * ========================================================= */
  const actions = {
    logout() {
      localStorage.removeItem(TOKEN_KEY);
      utilizador = null;
      location.hash = '#/';
    },
    async apply(el) {
      const r = await api(`/api/jobs/${encodeURIComponent(el.dataset.id)}/apply`, { metodo: 'POST' });
      toast(r.mensagem);
    },
    async 'baixar-cv'(el) {
      const res = await fetch(`/api/recruiter/applications/${encodeURIComponent(el.dataset.id)}/cv`, {
        headers: { Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY)}` }
      });
      if (!res.ok) {
        const dados = await res.json().catch(() => ({}));
        throw new Error(dados.erro || 'Não foi possível obter o CV.');
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = el.dataset.nome || 'curriculo.pdf';
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    },
    async 'aprovar-empresa'(el) {
      const r = await api(`/api/admin/companies/${encodeURIComponent(el.dataset.id)}/approve`, { metodo: 'POST' });
      toast(r.mensagem);
    },
    async 'moderar-vaga'(el) {
      const r = await api(`/api/admin/jobs/${encodeURIComponent(el.dataset.id)}/moderation`, {
        metodo: 'POST',
        corpo: { decision: el.dataset.decisao }
      });
      toast(r.mensagem);
    }
  };

  const handlers = {
    'home-search'(f) {
      const d = new FormData(f);
      const qs = new URLSearchParams();
      if (String(d.get('q') || '').trim()) qs.set('q', String(d.get('q')).trim());
      if (d.get('provincia')) qs.set('provincia', d.get('provincia'));
      location.hash = '#/vagas' + (qs.toString() ? '?' + qs : '');
    },

    'vagas-filter'(f) {
      return atualizarLista(f);
    },

    async entrar(f) {
      const d = new FormData(f);
      iniciarSessao(await api('/api/auth/login', {
        metodo: 'POST',
        corpo: { email: d.get('email'), password: d.get('password') }
      }));
    },

    async criar(f) {
      const d = new FormData(f);
      iniciarSessao(await api('/api/auth/register', {
        metodo: 'POST',
        corpo: { role: d.get('role'), nome: d.get('nome'), email: d.get('email'), password: d.get('password') }
      }));
    },

    async 'candidato-perfil'(f) {
      const d = new FormData(f);
      await api('/api/candidate/profile', {
        metodo: 'PUT',
        corpo: {
          nomeCompleto: d.get('nome'),
          telefone: d.get('telefone'),
          provincia: d.get('provincia'),
          tituloProfissional: d.get('titulo'),
          resumo: d.get('resumo')
        }
      });
      const cv = d.get('cv');
      if (cv && cv.size > 0) {
        if (cv.size > MAX_CV_BYTES) throw new Error('O ficheiro excede 5 MB.');
        await api('/api/candidate/cv', { metodo: 'POST', bruto: cv, tipo: 'application/pdf', nomeFicheiro: cv.name });
      }
      toast('Perfil guardado.');
    },

    async 'empresa-criar'(f) {
      const d = new FormData(f);
      await api('/api/company', {
        metodo: 'POST',
        corpo: { nomeEmpresa: d.get('nome'), nif: d.get('nif'), setor: d.get('setor'), descricao: d.get('descricao') }
      });
      toast('Empresa enviada para verificação.');
    },

    async 'vaga-criar'(f) {
      const d = new FormData(f);
      await api('/api/jobs', {
        metodo: 'POST',
        corpo: {
          titulo: d.get('titulo'),
          setor: d.get('setor'),
          provincia: d.get('provincia'),
          modalidade: d.get('modalidade'),
          tipoContrato: d.get('tipoContrato'),
          descricao: d.get('descricao'),
          requisitos: d.get('requisitos')
        }
      });
      toast('Vaga enviada para moderação. Será publicada após aprovação.');
    }
  };

  // Formulários que apenas filtram não recarregam a página.
  const SEM_RECARGA = new Set(['vagas-filter']);

  function executar(fn, recarregar) {
    return Promise.resolve()
      .then(fn)
      .then(() => (recarregar ? route() : undefined))
      .catch((err) => toast(err.message || 'Erro inesperado.'));
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !actions[el.dataset.action]) return;
    e.preventDefault();
    executar(() => actions[el.dataset.action](el), el.dataset.action !== 'baixar-cv');
  });

  document.addEventListener('submit', (e) => {
    const f = e.target;
    const nome = f.dataset && f.dataset.form;
    if (!nome) return;
    e.preventDefault();
    const fn = handlers[nome];
    if (fn) executar(() => fn(f), !SEM_RECARGA.has(nome));
  });

  document.addEventListener('input', (e) => {
    const f = e.target.form;
    if (f?.dataset.form === 'vagas-filter') atualizarLista(f).catch((err) => toast(err.message));
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (!t.matches('[data-status-select]')) return;
    executar(async () => {
      await api(`/api/applications/${encodeURIComponent(t.dataset.statusSelect)}/status`, {
        metodo: 'PATCH',
        corpo: { status: t.value }
      });
      toast('Estado atualizado. Candidato notificado por e-mail (simulado).');
    }, true);
  });

  /* =========================================================
   * Arranque
   * ========================================================= */
  async function iniciar() {
    document.getElementById('ano').textContent = new Date().getFullYear();
    meta = await api('/api/meta');
    if (localStorage.getItem(TOKEN_KEY)) {
      try {
        utilizador = (await api('/api/auth/me')).user;
      } catch (_) {
        localStorage.removeItem(TOKEN_KEY);
        utilizador = null;
      }
    }
    window.addEventListener('hashchange', route);
    route();
  }

  iniciar().catch(() => {
    document.getElementById('app').innerHTML = '<div class="empty"><h2>Servidor indisponível</h2><p>Tente novamente mais tarde.</p></div>';
  });
})();
