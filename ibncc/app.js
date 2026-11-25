/* I-BNCC · aplicativo (v0.8: turmas, marcações com data, planejamentos e relatórios) */
(function () {
  'use strict';

  const CAT = window.IBNCC_CATALOGO;
  const REG = {};
  window.IBNCC_REGISTRAR = (id, obj) => { REG[id] = Object.assign({ id }, obj); };
  const VERSAO_APP = '0.8 (teste)';

  // ---------- utilidades ----------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const $ = (sel, el = document) => el.querySelector(sel);
  const tela = $('#tela');
  const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const ler = (k, padrao) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? padrao : v; } catch (_) { return padrao; } };
  const gravar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (_) { return false; } };
  function avisar(msg) {
    const a = $('#aviso'); a.textContent = msg; a.hidden = false;
    clearTimeout(avisar.t); avisar.t = setTimeout(() => { a.hidden = true; }, 2600);
  }
  const lista = (xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' e ' + xs[xs.length - 1]);

  // ---------- catálogo ----------
  function acharAno(id) {
    for (const e of CAT.etapas) for (const a of e.anos) if (a.id === id) return { etapa: e, ano: a };
    return null;
  }
  const disponivel = (a) => a && a.componentes.length > 0;
  const disponiveis = () => lista(CAT.etapas.flatMap((e) => e.anos.filter(disponivel).map((a) => lista(a.componentes.map((c) => c.nome)) + ' do ' + a.nome)));

  // ---------- carregamento dos dados de um ano ----------
  function carregarScript(arquivo) {
    if (REG[arquivo]) return Promise.resolve();
    return new Promise((ok, falha) => {
      const s = document.createElement('script');
      s.src = 'dados/' + arquivo + '.js';
      s.onload = () => (REG[arquivo] ? ok() : falha(new Error(arquivo)));
      s.onerror = () => falha(new Error(arquivo));
      document.head.appendChild(s);
    });
  }

  // índice do ano carregado
  let ANO = null; // { id, nome, comps: [comp], co: {cod: h} }
  let HAB = {}, CO = {}, VINC_HAB = {}, VINC_CO = {}, MAT = {}, BIM_DE = {}, CO_BIM = {}, PONTES = [], PONTES_DE = {};
  const ESTADO = {}; // chave (disciplina + ano + turma) -> { marcadas, trilha, log, atualizado }
  const vazio = () => ({ marcadas: {}, trilha: {}, log: [], atualizado: null });

  // ---------- turmas ----------
  // A turma "principal" usa as chaves antigas (sem sufixo): quem já marcava habilidades não perde nada.
  let TURMAS = ler('ibncc:turmas', null) || [{ id: 'principal', nome: 'Minha turma', escola: '', ano: '' }];
  let turmaId = ler('ibncc:turma', 'principal');
  if (!TURMAS.some((t) => t.id === turmaId)) turmaId = TURMAS[0].id;
  const turmaAtual = () => TURMAS.find((t) => t.id === turmaId) || TURMAS[0];
  const turmaPor = (id) => TURMAS.find((t) => t.id === id) || null;
  const chaveDe = (comp, tid = turmaId) => comp.chave + (tid === 'principal' ? '' : ':' + tid);
  function estDe(comp, tid = turmaId) {
    const k = chaveDe(comp, tid);
    if (!ESTADO[k]) { const s = ler(k, null); ESTADO[k] = s && s.marcadas ? s : vazio(); }
    const s = ESTADO[k]; s.trilha = s.trilha || {}; s.log = s.log || [];
    return s;
  }
  const salvarTurmas = () => { gravar('ibncc:turmas', TURMAS); gravar('ibncc:turma', turmaId); };
  function usarTurma(id) { if (!turmaPor(id)) return; turmaId = id; salvarTurmas(); atualizarCabecalho(); }
  const NIVEIS = [{ id: 'iniciada', rotulo: 'Iniciada' }, { id: 'em_desenvolvimento', rotulo: 'Em desenvolvimento' }, { id: 'trabalhada_no_ano', rotulo: 'Trabalhada no ano' }];

  function indexarAno(a) {
    const comps = a.componentes.map((c) => REG[c.arquivo]);
    HAB = {}; CO = {}; VINC_HAB = {}; VINC_CO = {}; MAT = {}; BIM_DE = {}; CO_BIM = {};
    comps.forEach((comp) => {
      comp.trilhaSet = new Set(comp.trilha);
      comp.habilidades.forEach((h) => { HAB[h.codigo] = { h, comp }; });
      comp.bimestres.forEach((b) => {
        b.hab.forEach((c) => { BIM_DE[c] = b.n; });
        b.co.forEach((c) => { (CO_BIM[c] = CO_BIM[c] || []).push({ n: b.n, comp }); });
      });
      comp.vinculos.forEach((v) => {
        const vv = Object.assign({ comp }, v);
        (VINC_HAB[v.hab] = VINC_HAB[v.hab] || []).push(vv);
        (VINC_CO[v.co] = VINC_CO[v.co] || []).push(vv);
      });
      (comp.materiais || []).forEach((m) => m.habilidades.forEach((c) => { (MAT[c] = MAT[c] || []).push(m); }));
    });
    if (a.co) REG[a.co].habilidades.forEach((h) => { CO[h.codigo] = h; });
    PONTES = a.pontes && REG[a.pontes] ? REG[a.pontes].pontes : []; PONTES_DE = {};
    PONTES.forEach((p) => p.habilidades.forEach((x) => { (PONTES_DE[x.cod] = PONTES_DE[x.cod] || []).push(p); }));
    ANO = { id: a.id, nome: a.nome, comps };
  }

  let atual = ler('ibncc:atual', null); // { ano, comp }
  if (!atual && localStorage.getItem('ibncc:v1:lp-1ano')) atual = { ano: '1', comp: 'lp' }; // quem já usava a v0.2
  const compAtual = () => (ANO && ANO.comps.find((c) => c.comp === atual.comp)) || (ANO && ANO.comps[0]);

  function selecionar(anoId, compId) {
    const r = acharAno(anoId);
    if (!r || !disponivel(r.ano)) return Promise.reject(new Error('indisponível'));
    const arquivos = r.ano.componentes.map((c) => c.arquivo).concat(r.ano.co ? [r.ano.co] : [], r.ano.pontes ? [r.ano.pontes] : []);
    tela.innerHTML = '<p class="vazio">Carregando…</p>';
    return Promise.all(arquivos.map(carregarScript)).then(() => {
      indexarAno(r.ano);
      atual = { ano: anoId, comp: r.ano.componentes.some((c) => c.id === compId) ? compId : r.ano.componentes[0].id };
      gravar('ibncc:atual', atual);
      atualizarCabecalho();
      guardarParaUsoOffline(arquivos);
    });
  }

  function guardarParaUsoOffline(arquivos) {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    navigator.serviceWorker.ready.then((r) => { if (r.active) r.active.postMessage({ guardar: arquivos.map((a) => './dados/' + a + '.js') }); }).catch(() => {});
  }

  function atualizarCabecalho() {
    const c = compAtual();
    $('#contexto').textContent = c ? `${c.nome} · ${ANO.nome}` + (TURMAS.length > 1 ? ` · ${turmaAtual().nome}` : '') : 'Escolher etapa e ano';
  }

  // ---------- marcações ----------
  const est = (cod) => estDe(HAB[cod].comp);
  function salvar(comp, tid = turmaId) {
    const s = estDe(comp, tid); s.atualizado = new Date().toISOString();
    if (s.log.length > 3000) s.log = s.log.slice(-3000);
    if (!gravar(chaveDe(comp, tid), s)) avisar('Não foi possível salvar neste aparelho.');
  }
  const naTrilha = (cod) => HAB[cod].comp.trilhaSet.has(cod);
  const marcada = (cod) => !!est(cod).marcadas[cod];
  const nivel = (cod) => est(cod).trilha[cod] || null;
  function alternarMarcada(cod) {
    const s = est(cod);
    const em = new Date().toISOString();
    if (s.marcadas[cod]) { delete s.marcadas[cod]; s.log.push({ c: cod, v: 'desmarcada', em }); } else { s.marcadas[cod] = { em }; s.log.push({ c: cod, v: 'marcada', em }); }
    salvar(HAB[cod].comp);
  }
  function definirNivel(cod, n) {
    const s = est(cod);
    const em = new Date().toISOString();
    if (s.trilha[cod] === n) { delete s.trilha[cod]; s.log.push({ c: cod, v: 'sem_nivel', em }); } else { s.trilha[cod] = n; s.log.push({ c: cod, v: n, em }); }
    salvar(HAB[cod].comp);
  }
  const trabalhada = (cod) => (naTrilha(cod) ? !!nivel(cod) : marcada(cod));
  const coTrabalhada = (c) => (VINC_CO[c] || []).some((v) => trabalhada(v.hab));
  const coVia = (c) => [...new Set((VINC_CO[c] || []).filter((v) => trabalhada(v.hab)).map((v) => v.comp.nome))];

  // ---------- cartões ----------
  const seloAcesso = (m) => (m.acesso === 'pago' ? '<span class="selo selo-pago">Material pago</span>' : '<span class="selo selo-gratis">Gratuito</span>');
  function selosHab(c) {
    let s = '';
    (VINC_HAB[c] || []).forEach((v) => { s += `<span class="selo selo-co">${esc(v.co)}</span>`; });
    const np = (PONTES_DE[c] || []).length; if (np) s += `<span class="selo selo-ponte">${np} ponte${np > 1 ? 's' : ''}</span>`;
    (MAT[c] || []).forEach((m) => { s += seloAcesso(m); });
    return s;
  }
  const nomeComp = (c, mostrar) => (mostrar ? `<span class="selo selo-comp">${esc(HAB[c].comp.curto)}</span>` : '');

  function cartaoBimestre(c, mostrarComp) {
    const { h, comp } = HAB[c]; const m = marcada(c);
    return `<div class="hab${m ? ' feita' : ''}" data-cod="${c}">
      <button class="hab-corpo" data-abrir="${c}">
        <div class="hab-cod">${c} ${nomeComp(c, mostrarComp)}</div>
        <p class="hab-texto">${esc(h.texto)}</p>
        <div class="hab-meta"><span>${esc(h[comp.meta])}</span>${selosHab(c)}</div>
      </button>
      <button class="marcar" role="checkbox" aria-checked="${m}" data-marcar="${c}" aria-label="Marcar ${c} como trabalhada"><span class="caixa">${CHECK}</span></button>
    </div>`;
  }
  function botoesNivel(c) {
    const a = nivel(c);
    return NIVEIS.map((n) => `<button data-nivel="${n.id}" data-cod="${c}" aria-pressed="${a === n.id}">${esc(n.rotulo)}</button>`).join('');
  }
  function cartaoTrilha(c, mostrarComp) {
    const { h, comp } = HAB[c]; const n = nivel(c);
    return `<div class="hab hab-trilha${n ? ' nivel-' + n : ''}" data-cod="${c}">
      <button class="hab-corpo" data-abrir="${c}">
        <div class="hab-cod">${c} ${nomeComp(c, mostrarComp)}<span class="selo selo-tipo">${esc(comp.tipos[h.tipo] || '')}</span></div>
        <p class="hab-texto">${esc(h.texto)}</p>
        <div class="hab-meta"><span>${esc(h[comp.meta_trilha])}</span>${selosHab(c)}</div>
      </button>
      <div class="niveis" role="group" aria-label="Nível de progresso de ${c}">${botoesNivel(c)}</div>
    </div>`;
  }
  const cartaoHab = (c, mostrarComp) => (naTrilha(c) ? cartaoTrilha(c, mostrarComp) : cartaoBimestre(c, mostrarComp));

  function statusCO(c) {
    const via = coVia(c);
    return via.length ? `✓ Trabalhada por meio de ${lista(via)}` : 'Ainda sem habilidade vinculada marcada';
  }
  function cartaoCO(c) {
    const h = CO[c]; const ok = coTrabalhada(c);
    const vs = VINC_CO[c] || [];
    const via = vs.map((v) => `<button data-abrir="${v.hab}" class="${trabalhada(v.hab) ? 'ok' : ''}">${v.hab}${trabalhada(v.hab) ? ' ✓' : ''}</button>`).join('');
    return `<div class="hab${ok ? ' feita' : ''}" data-cod="${c}" style="flex-direction:column">
      <button class="hab-corpo" data-abrir="${c}">
        <div class="hab-cod" style="color:var(--azul)">${c} <span class="selo selo-co">${esc(h.eixo)}</span></div>
        <p class="hab-texto">${esc(h.texto)}</p>
        <div class="co-status ${ok ? 'sim' : 'nao'}">${statusCO(c)}</div>
      </button>
      ${vs.length ? `<div style="padding:0 14px 12px"><div class="fonte">Habilidades vinculadas (${esc(lista([...new Set(vs.map((v) => v.comp.curto))]))}):</div><div class="via">${via}</div></div>` : ''}
    </div>`;
  }

  // ---------- pontes entre disciplinas ----------
  const existe = (c) => !!(HAB[c] || CO[c]);
  const discDe = (c) => (CO[c] ? 'Computação' : HAB[c].comp.curto);
  const feito = (c) => (CO[c] ? coTrabalhada(c) : trabalhada(c));
  function discsPonte(p) { return [...new Set(p.habilidades.filter((x) => existe(x.cod)).map((x) => discDe(x.cod)))]; }
  function blocoPonte(p, aberto, destaque) {
    const hs = p.habilidades.filter((x) => existe(x.cod));
    const quando = p.bimestre === 'ano' ? 'Ao longo do ano' : `Sugestão: ${p.bimestre}º bimestre`;
    return `<details class="ponte"${aberto ? ' open' : ''}>
      <summary><span class="ponte-titulo">${esc(p.titulo)}</span><span class="ponte-discs">${discsPonte(p).map((d) => `<span class="selo selo-comp">${esc(d)}</span>`).join('')}<span class="selo selo-sugestao">${quando}</span></span></summary>
      <p class="ponte-ideia">${esc(p.ideia)}</p>
      <p class="rotulo" style="margin:10px 0 4px">Como fazer a ponte</p>
      <p>${esc(p.como)}</p>
      <p class="rotulo" style="margin:10px 0 4px">Habilidades envolvidas</p>
      <ul class="ponte-habs">${hs.map((x) => `<li${x.cod === destaque ? ' class="destaque"' : ''}><button data-abrir="${x.cod}">${x.cod}${feito(x.cod) ? ' ✓' : ''}</button> <span class="selo selo-comp">${esc(discDe(x.cod))}</span><span class="ponte-papel">${esc(x.papel)}</span></li>`).join('')}</ul>
    </details>`;
  }
  function secaoPontes(c) {
    const ps = PONTES_DE[c] || [];
    if (!ps.length) return '';
    return '<h3>Pontes com outras disciplinas <span class="selo selo-sugestao">Sugestão</span></h3>' + ps.map((p) => blocoPonte(p, ps.length === 1, c)).join('');
  }

  function resumo(comp) {
    const bim = comp.bimestres.flatMap((b) => b.hab);
    const fb = bim.filter(marcada).length;
    const ft = comp.trilha.filter((c) => nivel(c)).length;
    const cos = Object.keys(CO); const fc = cos.filter(coTrabalhada).length;
    const bloco = (n, t, r) => `<div><b>${n}/${t}</b><span>${r}</span><div class="barra"><i style="width:${pct(n, t)}%"></i></div></div>`;
    return `<div class="resumo">${bloco(fb, bim.length, 'Nos bimestres')}${bloco(ft, comp.trilha.length, 'Trilha contínua')}${cos.length ? bloco(fc, cos.length, 'Computação') : ''}</div>`;
  }

  function trocaDisciplina() {
    if (ANO.comps.length < 2) return '';
    return `<nav class="disciplinas" aria-label="Disciplinas do ${esc(ANO.nome)}">${ANO.comps.map((c) => `<a href="#/ir/${ANO.id}/${c.comp}" ${c === compAtual() ? 'aria-current="page"' : ''}>${esc(c.curto)}</a>`).join('')}<a href="#/escolher" class="mais">+ Outras</a></nav>`;
  }

  // ---------- telas ----------
  function telaEscolher(etapaFoco) {
    const etapas = CAT.etapas.map((e) => {
      const anos = e.anos.length
        ? `<div class="anos">${e.anos.map((a) => {
          if (!disponivel(a)) return `<div class="ano-item indisponivel"><b>${esc(a.nome)}</b><span>Em preparação</span></div>`;
          return `<div class="ano-item"><b>${esc(a.nome)}</b><div class="ano-comps">${a.componentes.map((c) => `<a href="#/ir/${a.id}/${c.id}">${esc(c.nome)}</a>`).join('')}</div>${(a.em_preparacao || []).length ? `<span class="fonte">Em preparação: ${esc(lista(a.em_preparacao))}</span>` : ''}</div>`;
        }).join('')}</div>`
        : '<p class="fonte" style="margin:6px 0 0">Em preparação. No Ensino Médio, as habilidades são organizadas por área do conhecimento, para as três séries.</p>';
      return `<section class="cartao etapa${etapaFoco === e.id ? ' foco' : ''}" id="etapa-${e.id}"><h2 style="margin-top:0">${esc(e.nome)}</h2><p class="fonte" style="margin:0 0 10px">${esc(e.sub)}</p>${anos}</section>`;
    }).join('');
    tela.innerHTML = `
      <p class="rotulo">${atual ? 'Trocar etapa, ano ou disciplina' : 'Boas-vindas'}</p>
      <h1>O que você vai acompanhar?</h1>
      <p class="descricao">Escolha o ano e a disciplina. Só os dados do ano escolhido são guardados no aparelho, e é possível trocar a qualquer momento.</p>
      ${etapas}`;
    if (etapaFoco) setTimeout(() => { const el = $('#etapa-' + etapaFoco); if (el) el.scrollIntoView({ block: 'start' }); }, 30);
  }

  function telaBimestres(n) {
    const comp = compAtual();
    n = Math.min(4, Math.max(1, Number(n) || ultimoBimestre()));
    gravar('ibncc:bimestre', n);
    const b = comp.bimestres.find((x) => x.n === n);
    const seletor = comp.bimestres.map((x) => `<a href="#/bimestres/${x.n}" ${x.n === n ? 'aria-current="page"' : ''}>${x.n}º bim<small>${x.hab.filter(marcada).length}/${x.hab.length}</small></a>`).join('');
    const tr = comp.trilha.filter((c) => nivel(c)).length;
    tela.innerHTML = `
      ${trocaDisciplina()}
      <p class="rotulo">Organização por bimestre</p>
      <h1>${esc(comp.nome)} · ${esc(ANO.nome)}</h1>
      ${resumo(comp)}
      <nav class="seletor" aria-label="Bimestres">${seletor}</nav>
      <h2>${n}º bimestre — ${esc(b.titulo)}</h2>
      <div class="foco"><span class="selo selo-sugestao">Sugestão</span> ${esc(b.foco)}</div>
      <h3>Habilidades do bimestre</h3>
      <div class="lista">${b.hab.map((c) => cartaoBimestre(c)).join('')}</div>
      ${b.co.length && Object.keys(CO).length ? `<h3>Computação em destaque neste bimestre</h3><div class="lista">${b.co.map(cartaoCO).join('')}</div>` : ''}
      ${(() => { const ps = PONTES.filter((p) => (p.bimestre === n || p.bimestre === 'ano') && p.habilidades.some((x) => HAB[x.cod] && HAB[x.cod].comp === comp)); return ps.length ? `<h3>Pontes com outras disciplinas</h3><p class="fonte" style="margin-top:-4px">Situações de sala que trabalham habilidades de várias disciplinas ao mesmo tempo.</p>${ps.map((p) => blocoPonte(p, false)).join('')}` : ''; })()}
      <a class="cartao cartao-link" href="#/trilha">
        <div><p class="rotulo">Em todos os bimestres</p><b class="serif" style="font-size:20px">Trilha contínua</b>
        <div class="fonte">${tr} de ${comp.trilha.length} habilidades com algum nível marcado</div></div>
        <span class="seta">→</span>
      </a>`;
  }
  const ultimoBimestre = () => Number(ler('ibncc:bimestre', 1)) || 1;

  function telaTrilha() {
    const comp = compAtual();
    const grupos = {};
    comp.trilha.forEach((c) => { const k = HAB[c].h[comp.agrupar_trilha]; (grupos[k] = grupos[k] || []).push(c); });
    tela.innerHTML = `
      ${trocaDisciplina()}
      <p class="rotulo">Em todos os bimestres</p>
      <h1>Trilha contínua · ${esc(comp.nome)}</h1>
      <p class="descricao">${esc(comp.trilha_descricao)} Um novo toque no nível escolhido desfaz a marcação.</p>
      ${Object.keys(grupos).map((k) => `<h2>${esc(k)}</h2><div class="lista">${grupos[k].map((c) => cartaoTrilha(c)).join('')}</div>`).join('')}`;
  }

  function telaComputacao() {
    const cos = Object.keys(CO);
    if (!cos.length) { tela.innerHTML = '<h1>Computação</h1><p class="vazio">Ainda não há habilidades de Computação para este ano.</p>'; return; }
    const nomes = lista(ANO.comps.map((c) => c.nome));
    const fc = cos.filter(coTrabalhada).length;
    tela.innerHTML = `
      <p class="rotulo">Transversal</p>
      <h1>Computação · ${esc(ANO.nome)}</h1>
      <p class="descricao">As habilidades de Computação são trabalhadas junto com as de ${esc(nomes)}. Uma habilidade de Computação passa a contar como trabalhada quando alguma habilidade vinculada a ela, de qualquer disciplina, é marcada.</p>
      <div class="resumo"><div><b>${fc}/${cos.length}</b><span>Computação no ano</span><div class="barra"><i style="width:${pct(fc, cos.length)}%"></i></div></div></div>
      <div class="lista">${cos.map(cartaoCO).join('')}</div>`;
  }

  let busca = { termo: '', filtro: 'todas' };
  function telaBuscar() {
    tela.innerHTML = `
      <p class="rotulo">Consulta · ${esc(ANO.nome)}</p>
      <h1>Buscar</h1>
      <label class="sr" for="campo-busca">Buscar por código ou palavra</label>
      <input id="campo-busca" class="campo-busca" type="search" placeholder="Código (EF01MA06) ou palavra (rima, calendário…)" value="${esc(busca.termo)}" autocomplete="off">
      <div class="filtros" role="group" aria-label="Filtrar">
        ${[['todas', 'Todas'], ...ANO.comps.map((c) => [c.comp, c.curto]), ['trilha', 'Trilha'], ['co', 'Computação'], ['pendentes', 'Não marcadas']].map(([id, r]) => `<button data-filtro="${id}" aria-pressed="${busca.filtro === id}">${esc(r)}</button>`).join('')}
      </div>
      <div id="resultados" class="lista"></div>`;
    const campo = $('#campo-busca');
    campo.addEventListener('input', () => { busca.termo = campo.value; resultados(); });
    resultados();
    if (!busca.termo) setTimeout(() => campo.focus({ preventScroll: true }), 50);
  }
  function resultados() {
    const t = norm(busca.termo.trim()); const f = busca.filtro;
    const casa = (txt) => !t || norm(txt).includes(t);
    const itens = [];
    if (f !== 'co') {
      ANO.comps.forEach((comp) => {
        if (ANO.comps.some((c) => c.comp === f) && comp.comp !== f) return;
        comp.habilidades.forEach((h) => {
          const c = h.codigo;
          if (f === 'trilha' && !naTrilha(c)) return;
          if (f === 'pendentes' && trabalhada(c)) return;
          const e = comp.explicacoes[c] || {};
          if (casa([c, h.texto, comp.nome, ...comp.contexto.map(([k]) => h[k]), e.o_que_se_espera].join(' '))) itens.push(c);
        });
      });
    }
    if (f === 'todas' || f === 'co' || f === 'pendentes') {
      Object.values(CO).forEach((h) => {
        if (f === 'pendentes' && coTrabalhada(h.codigo)) return;
        if (casa([h.codigo, h.texto, h.objeto_conhecimento, h.eixo, h.explicacao].join(' '))) itens.push(h.codigo);
      });
    }
    $('#resultados').innerHTML = itens.length
      ? `<p class="fonte">${itens.length} habilidade${itens.length > 1 ? 's' : ''}</p>` + itens.map((c) => (CO[c] ? cartaoCO(c) : cartaoHab(c, ANO.comps.length > 1))).join('')
      : '<p class="vazio">Nenhuma habilidade encontrada.</p>';
  }

  let eventoInstalar = null;
  function ultimaAlteracao() {
    const datas = Object.values(ESTADO).map((s) => s.atualizado).filter(Boolean).sort();
    return datas.length ? datas[datas.length - 1] : null;
  }
  function telaSobre() {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const instalado = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const ua = ultimaAlteracao();
    tela.innerHTML = `
      <p class="rotulo">Sobre o aplicativo</p>
      <h1>I-BNCC</h1>
      <p class="descricao">A BNCC em formato de aplicativo, para consulta rápida e acompanhamento do que foi trabalhado em sala. Esta versão de teste traz ${esc(disponiveis())}, com as habilidades de Computação integradas de forma transversal. As demais disciplinas e anos estão em preparação.</p>
      <div class="botoes" style="margin-bottom:12px"><a class="btn" href="#/escolher">Trocar etapa, ano ou disciplina</a></div>

      <div class="cartao">
        <h3 style="margin-top:0">O que é oficial e o que é sugestão</h3>
        <p><span class="selo selo-oficial">Texto oficial</span> O texto das habilidades e as informações que as acompanham (campos de atuação, práticas de linguagem, unidades temáticas, objetos de conhecimento) foram transcritos da BNCC (BRASIL, 2018) e da BNCC Computação (BRASIL, 2022), com a página de origem indicada em cada habilidade.</p>
        <p><span class="selo selo-sugestao">Sugestão</span> A BNCC não distribui habilidades por bimestre. A divisão em bimestres, a trilha contínua, as pontes entre disciplinas, os vínculos com Computação e as explicações "O que se espera" são uma proposta do Sistema Isidoro.</p>
        <p class="fonte">O I-BNCC não é um aplicativo oficial do Ministério da Educação (MEC).</p>
      </div>

      <div class="cartao">
        <h3 style="margin-top:0">Instalar no celular</h3>
        ${instalado ? '<p>O aplicativo já está instalado neste aparelho.</p>'
          : ios ? '<p>No iPhone ou iPad, o I-BNCC é instalado pelo Safari: toque no botão de compartilhar (quadrado com uma seta para cima) e depois em <b>Adicionar à Tela de Início</b>.</p>'
          : '<p>No Android, o navegador mostra a opção <b>Instalar aplicativo</b> ou <b>Adicionar à tela inicial</b> no menu (três pontinhos).</p>' + (eventoInstalar ? '<div class="botoes"><button class="btn btn-primario" data-acao="instalar">Instalar agora</button></div>' : '')}
      </div>

      <div class="cartao">
        <h3 style="margin-top:0">Suas marcações e planejamentos</h3>
        <p>Nesta versão, as marcações, as turmas e os planejamentos ficam guardados apenas neste aparelho e neste navegador. As marcações são separadas por turma e por disciplina, e cada marcação guarda a data em que foi feita. A criação de conta, com cópia na nuvem, está em preparação. Até lá, é possível guardar uma cópia em arquivo e recuperá-la em outro aparelho.</p>
        <p class="fonte">${ua ? 'Última alteração: ' + new Date(ua).toLocaleString('pt-BR') : 'Nenhuma marcação feita ainda.'}</p>
        <div class="botoes">
          <button class="btn" data-acao="exportar">Salvar cópia em arquivo</button>
          <label class="btn">Recuperar de arquivo<input type="file" accept="application/json,.json" data-acao="importar" hidden></label>
          <button class="btn btn-perigo" data-acao="apagar">Apagar todas as marcações</button>
        </div>
      </div>

      <h2>Referências</h2>
      <p class="ref">BRASIL. Ministério da Educação. <b>Base Nacional Comum Curricular</b>. Brasília: MEC, 2018.</p>
      <p class="ref">BRASIL. Ministério da Educação. Conselho Nacional de Educação. <b>Computação</b>: complemento à BNCC. Anexo ao Parecer CNE/CEB nº 2/2022. Brasília: MEC, 2022.</p>

      <p class="credito">Desenvolvido por Verônica Silveira · <a href="https://sistemaisidoro.com.br" target="_blank" rel="noopener">Sistema Isidoro</a><br>Versão ${VERSAO_APP}</p>`;
  }

  // ---------- planejamentos ----------
  const CAMPOS_PADRAO = ['Objetivos', 'Metodologia e estratégias', 'Recursos', 'Avaliação'];
  let PLANOS = ler('ibncc:planos', []);
  const salvarPlanos = () => { if (!gravar('ibncc:planos', PLANOS)) avisar('Não foi possível salvar neste aparelho.'); };
  const planoPor = (id) => PLANOS.find((p) => p.id === id) || null;
  const camposRede = () => ler('ibncc:campos', CAMPOS_PADRAO);
  const perfil = () => ler('ibncc:perfil', { professor: '' });
  const novoId = (pre) => pre + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const dataBR = (d) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '');
  const hojeISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const diaLocal = (iso) => { const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const compPor = (id) => ANO.comps.find((c) => c.comp === id);
  const ultimoCampo = (comp) => comp.contexto[comp.contexto.length - 1];

  function referencia(p) {
    if (p.tipo === 'mensal') { if (!p.mes) return 'Mensal'; const [a, m] = p.mes.split('-'); return MESES[Number(m) - 1] + ' de ' + a; }
    return p.bimestre ? p.bimestre + 'º bimestre' : 'Bimestral';
  }
  const tituloPlano = (p) => `${referencia(p).replace(/^./, (c) => c.toUpperCase())} · ${(turmaPor(p.turma) || { nome: 'Turma' }).nome}`;
  const periodo = (p) => (p.inicio || p.fim ? `${dataBR(p.inicio) || '…'} a ${dataBR(p.fim) || '…'}` : 'Período não definido');
  const encerrado = (p) => p.fim && p.fim < hojeISO();

  function criarPlano(base) {
    const p = Object.assign({
      id: novoId('p'), tipo: 'bimestral', bimestre: ultimoBimestre(), mes: '', ano: ANO.id, turma: turmaId,
      comps: [compAtual().comp], inicio: '', fim: '', habilidades: [], campos: {}, obs: '', obsRel: '',
      criado: new Date().toISOString(),
    }, base || {});
    PLANOS.unshift(p); salvarPlanos();
    return p;
  }

  // registro de uma habilidade numa turma: se foi trabalhada e quando
  function registro(cod, tid) {
    const { comp } = HAB[cod]; const s = estDe(comp, tid);
    if (comp.trilhaSet.has(cod)) {
      const n = s.trilha[cod]; if (!n) return null;
      const ult = s.log.filter((e) => e.c === cod && e.v === n).pop();
      return { em: ult ? ult.em : null, nivel: NIVEIS.find((x) => x.id === n).rotulo };
    }
    const m = s.marcadas[cod]; return m ? { em: m.em || null, nivel: null } : null;
  }
  const textoRegistro = (r) => (r.nivel ? r.nivel + (r.em ? ' (' + dataBR(diaLocal(r.em)) + ')' : ' (data não registrada)') : 'Marcada em ' + (r.em ? dataBR(diaLocal(r.em)) : 'data não registrada'));

  function analisar(p) {
    const plan = new Set(p.habilidades);
    return p.comps.map(compPor).filter(Boolean).map((comp) => {
      const cods = comp.habilidades.map((h) => h.codigo);
      const planejadas = cods.filter((c) => plan.has(c));
      const feitas = [], pendentes = [], extras = [];
      planejadas.forEach((c) => { const r = registro(c, p.turma); if (r) feitas.push({ c, r }); else pendentes.push(c); });
      cods.filter((c) => !plan.has(c)).forEach((c) => {
        const r = registro(c, p.turma);
        if (r && r.em && (!p.inicio || diaLocal(r.em) >= p.inicio) && (!p.fim || diaLocal(r.em) <= p.fim)) extras.push({ c, r });
      });
      return { comp, planejadas, feitas, pendentes, extras };
    });
  }
  function coDe(cods) {
    const m = {};
    cods.forEach((c) => (VINC_HAB[c] || []).forEach((v) => { (m[v.co] = m[v.co] || []).push(c); }));
    return Object.keys(m).sort().map((co) => ({ co, via: [...new Set(m[co])] }));
  }
  const pontesDe = (cods) => { const set = new Set(cods); return PONTES.filter((pt) => pt.habilidades.filter((x) => set.has(x.cod)).length >= 2); };

  // ----- tela principal: turmas, planejamentos e campos da rede -----
  let editTurma = null; // id da turma em edição ou 'nova'
  function formTurma(t) {
    const anos = CAT.etapas.flatMap((e) => e.anos.filter(disponivel));
    return `<div class="cartao form">
      <label>Nome da turma<input type="text" id="t-nome" value="${esc(t ? t.nome : '')}" placeholder="Ex.: 1º ano A"></label>
      <label>Escola<input type="text" id="t-escola" value="${esc(t ? t.escola : '')}" placeholder="Nome da escola"></label>
      <label>Ano<select id="t-ano"><option value="">—</option>${anos.map((a) => `<option value="${a.id}" ${(t ? t.ano : ANO.id) === a.id ? 'selected' : ''}>${esc(a.nome)}</option>`).join('')}</select></label>
      <div class="botoes"><button class="btn btn-primario" data-acao="turma-salvar">Salvar turma</button><button class="btn" data-acao="turma-cancelar">Cancelar</button>
      ${t && t.id !== 'principal' ? '<button class="btn btn-perigo" data-acao="turma-excluir">Excluir turma</button>' : ''}</div></div>`;
  }
  function telaPlanejar() {
    const t = turmaAtual();
    const turmas = TURMAS.map((x) => `<div class="turma${x.id === turmaId ? ' ativa' : ''}">
      <div><b>${esc(x.nome)}</b><div class="fonte">${esc([x.escola, (acharAno(x.ano) || { ano: {} }).ano.nome].filter(Boolean).join(' · ') || 'Sem escola informada')}</div></div>
      <div class="turma-acoes">${x.id === turmaId ? '<span class="selo selo-comp">Em uso</span>' : `<button class="btn" data-acao="turma-usar" data-id="${x.id}">Usar</button>`}<button class="btn" data-acao="turma-editar" data-id="${x.id}">Editar</button></div></div>`).join('');
    const planos = PLANOS.filter((p) => !p.turma || turmaPor(p.turma)).map((p) => {
      const tot = p.habilidades.length;
      return `<a class="cartao cartao-link plano-item" href="#/plano/${p.id}"><div>
        <b class="serif" style="font-size:18px">${esc(tituloPlano(p))}</b>
        <div class="fonte">${esc(periodo(p))} · ${tot} habilidade${tot === 1 ? '' : 's'} · ${esc(lista(p.comps.map((c) => (compPor(c) || { curto: c }).curto)))}</div>
        <div style="margin-top:6px">${encerrado(p) ? '<span class="selo selo-tipo">Período encerrado</span>' : '<span class="selo selo-comp">Em andamento</span>'}</div></div><span class="seta">→</span></a>`;
    }).join('');
    tela.innerHTML = `
      <p class="rotulo">Planejamento e relatório</p>
      <h1>Planejar</h1>
      <p class="descricao">Monte planejamentos mensais ou bimestrais escolhendo as habilidades. Ao final do período, as marcações feitas no app geram o relatório do que foi trabalhado, em PDF ou Word.</p>
      <h2>Turmas</h2>
      <p class="fonte" style="margin-top:-4px">As marcações são guardadas separadamente para cada turma. A turma em uso é a que recebe as marcações feitas nas outras telas.</p>
      <div class="lista-turmas">${turmas}</div>
      ${editTurma ? formTurma(editTurma === 'nova' ? null : turmaPor(editTurma)) : '<div class="botoes" style="margin-top:10px"><button class="btn" data-acao="turma-nova">+ Nova turma</button></div>'}
      <h2>Planejamentos</h2>
      <div class="botoes" style="margin-bottom:10px"><button class="btn btn-primario" data-acao="plano-novo">+ Novo planejamento para ${esc(t.nome)}</button></div>
      ${planos || '<p class="vazio">Nenhum planejamento ainda.</p>'}
      <h2>Modelo da sua rede</h2>
      <div class="cartao form">
        <label>Professor(a)<input type="text" id="perfil-professor" value="${esc(perfil().professor)}" placeholder="Seu nome, como aparece nos documentos"></label>
        <label>Campos exigidos no planejamento (um por linha)<textarea id="campos-rede" rows="5">${esc(camposRede().join('\n'))}</textarea></label>
        <p class="fonte" style="margin:0">Os campos aparecem no formulário de cada planejamento e no documento gerado, na ordem escrita aqui. Exemplos: Objetivos, Metodologia, Recursos, Avaliação, Adaptações.</p>
      </div>`;
  }

  // ----- editor do planejamento -----
  function linhaHab(c, marcado) {
    const { h } = HAB[c];
    return `<label class="pl-hab"><input type="checkbox" data-plano-hab="${c}" ${marcado ? 'checked' : ''}><span><b>${c}</b> ${esc(h.texto)}</span></label>`;
  }
  function telaPlano(id) {
    const p = planoPor(id);
    const sel = new Set(p.habilidades);
    const blocos = p.comps.map(compPor).filter(Boolean).map((comp) => {
      const nsel = comp.habilidades.filter((h) => sel.has(h.codigo)).length;
      const grupos = comp.bimestres.map((b) => `<details class="pl-grupo"${p.tipo === 'bimestral' && p.bimestre === b.n ? ' open' : ''}><summary>${b.n}º bimestre — ${esc(b.titulo)} <span class="fonte">(${b.hab.filter((c) => sel.has(c)).length}/${b.hab.length})</span></summary>${b.hab.map((c) => linhaHab(c, sel.has(c))).join('')}</details>`).join('')
        + (comp.trilha.length ? `<details class="pl-grupo"><summary>Trilha contínua <span class="fonte">(${comp.trilha.filter((c) => sel.has(c)).length}/${comp.trilha.length})</span></summary>${comp.trilha.map((c) => linhaHab(c, sel.has(c))).join('')}</details>` : '');
      return `<div class="cartao"><h3 style="margin-top:0">${esc(comp.nome)} <span class="fonte">· ${nsel} selecionada${nsel === 1 ? '' : 's'}</span></h3>
        <div class="botoes" style="margin-bottom:8px">${[1, 2, 3, 4].map((n) => `<button class="btn btn-peq" data-acao="plano-sugerir" data-comp="${comp.comp}" data-bim="${n}">+ ${n}º bim</button>`).join('')}<button class="btn btn-peq" data-acao="plano-sugerir" data-comp="${comp.comp}" data-bim="trilha">+ Trilha</button>${nsel ? `<button class="btn btn-peq btn-perigo" data-acao="plano-limpar" data-comp="${comp.comp}">Limpar</button>` : ''}</div>
        <p class="fonte" style="margin:0 0 6px">Os botões incluem as habilidades sugeridas para cada bimestre na organização do app. Também é possível marcar uma a uma.</p>
        ${grupos}</div>`;
    }).join('');
    const cos = coDe(p.habilidades.filter((c) => HAB[c]));
    const ps = pontesDe(p.habilidades);
    const turmaOpts = TURMAS.map((t) => `<option value="${t.id}" ${p.turma === t.id ? 'selected' : ''}>${esc(t.nome)}</option>`).join('');
    tela.innerHTML = `
      <p class="rotulo"><a href="#/planejar">← Planejar</a></p>
      <h1>${esc(tituloPlano(p))}</h1>
      <div class="cartao form">
        <div class="seg" role="group" aria-label="Tipo de planejamento">
          <button data-acao="plano-tipo" data-tipo="bimestral" aria-pressed="${p.tipo === 'bimestral'}">Bimestral</button>
          <button data-acao="plano-tipo" data-tipo="mensal" aria-pressed="${p.tipo === 'mensal'}">Mensal</button>
        </div>
        ${p.tipo === 'mensal'
          ? `<label>Mês<input type="month" data-plano="mes" value="${esc(p.mes)}"></label>`
          : `<label>Bimestre<select data-plano="bimestre">${[1, 2, 3, 4].map((n) => `<option value="${n}" ${p.bimestre === n ? 'selected' : ''}>${n}º bimestre</option>`).join('')}</select></label>`}
        <div class="duas"><label>Início<input type="date" data-plano="inicio" value="${esc(p.inicio)}"></label><label>Fim<input type="date" data-plano="fim" value="${esc(p.fim)}"></label></div>
        <label>Turma<select data-plano="turma">${turmaOpts}</select></label>
        <p class="fonte" style="margin:0">Escola: ${esc((turmaPor(p.turma) || {}).escola || 'não informada')} · Professor(a): ${esc(perfil().professor || 'não informado')} (<a href="#/planejar">alterar</a>)</p>
      </div>
      <h2>Disciplinas</h2>
      <div class="filtros">${ANO.comps.map((c) => `<button data-acao="plano-comp" data-comp="${c.comp}" aria-pressed="${p.comps.includes(c.comp)}">${esc(c.curto)}</button>`).join('')}</div>
      <h2>Habilidades</h2>
      ${blocos || '<p class="vazio">Escolha ao menos uma disciplina.</p>'}
      ${cos.length ? `<div class="cartao"><h3 style="margin-top:0">Computação contemplada</h3><p class="fonte" style="margin-top:0">Habilidades de Computação vinculadas às habilidades escolhidas.</p>${cos.map((x) => `<p style="margin:4px 0"><button class="link" data-abrir="${x.co}">${x.co}</button> <span class="fonte">via ${esc(x.via.join(', '))}</span></p>`).join('')}</div>` : ''}
      ${ps.length ? `<h3>Pontes possíveis com estas habilidades</h3>${ps.map((pt) => blocoPonte(pt, false)).join('')}` : ''}
      <h2>Campos do planejamento</h2>
      <div class="cartao form">
        ${camposRede().map((f) => `<label>${esc(f)}<textarea rows="3" data-plano-campo="${esc(f)}">${esc(p.campos[f] || '')}</textarea></label>`).join('')}
        <label>Observações<textarea rows="2" data-plano="obs">${esc(p.obs || '')}</textarea></label>
      </div>
      <h2>Documentos</h2>
      <div class="botoes">
        <button class="btn btn-primario" data-acao="doc-plano" data-formato="pdf">Planejamento em PDF</button>
        <button class="btn btn-primario" data-acao="doc-plano" data-formato="docx">Planejamento em Word</button>
      </div>
      <a class="cartao cartao-link" href="#/relatorio/${p.id}" style="margin-top:14px"><div><p class="rotulo">Ao final do período</p><b class="serif" style="font-size:20px">Relatório do que foi trabalhado</b><div class="fonte">Gerado a partir das marcações da turma</div></div><span class="seta">→</span></a>
      <div class="botoes" style="margin-top:14px"><button class="btn" data-acao="plano-duplicar">Duplicar</button><button class="btn btn-perigo" data-acao="plano-excluir">Excluir planejamento</button></div>`;
  }

  // ----- relatório -----
  function telaRelatorio(id) {
    const p = planoPor(id); const an = analisar(p);
    const tot = an.reduce((s, a) => s + a.planejadas.length, 0), fe = an.reduce((s, a) => s + a.feitas.length, 0);
    const linha = (x) => `<div class="rel-item"><button class="link" data-abrir="${x.c}">${x.c}</button> <span>${esc(HAB[x.c].h.texto)}</span><div class="fonte">${esc(textoRegistro(x.r))}</div></div>`;
    const secoes = an.map((a) => `<h2>${esc(a.comp.nome)}</h2>
      <h3>Planejadas e trabalhadas (${a.feitas.length})</h3>${a.feitas.length ? a.feitas.map(linha).join('') : '<p class="vazio">Nenhuma ainda.</p>'}
      <h3>Planejadas e ainda não trabalhadas (${a.pendentes.length})</h3>${a.pendentes.length ? `<p class="fonte" style="margin-top:-4px">Marque aqui o que foi trabalhado e ainda não estava registrado.</p><div class="lista">${a.pendentes.map((c) => cartaoHab(c)).join('')}</div>` : '<p class="vazio">Todas as habilidades planejadas foram trabalhadas.</p>'}
      ${a.extras.length ? `<h3>Trabalhadas além do planejado (${a.extras.length})</h3>${a.extras.map(linha).join('')}` : ''}`).join('');
    const feitas = an.flatMap((a) => a.feitas.concat(a.extras).map((x) => x.c));
    const cos = coDe(feitas); const ps = pontesDe(feitas);
    const pend = an.reduce((s, a) => s + a.pendentes.length, 0);
    tela.innerHTML = `
      <p class="rotulo"><a href="#/plano/${p.id}">← Planejamento</a></p>
      <h1>Relatório · ${esc(tituloPlano(p))}</h1>
      <p class="descricao">${esc(periodo(p))}. O relatório usa as marcações da turma ${esc((turmaPor(p.turma) || {}).nome || '')}. Habilidades fora do planejamento entram quando foram marcadas dentro do período.</p>
      <div class="resumo"><div><b>${fe}/${tot}</b><span>Planejadas e trabalhadas</span><div class="barra"><i style="width:${pct(fe, tot)}%"></i></div></div><div><b>${an.reduce((s, a) => s + a.extras.length, 0)}</b><span>Além do planejado</span></div><div><b>${cos.length}</b><span>Computação</span></div></div>
      <div class="botoes" style="margin:12px 0">
        <button class="btn btn-primario" data-acao="doc-relatorio" data-formato="pdf">Relatório em PDF</button>
        <button class="btn btn-primario" data-acao="doc-relatorio" data-formato="docx">Relatório em Word</button>
        ${pend ? `<button class="btn" data-acao="plano-pendentes">Novo planejamento com as ${pend} pendentes</button>` : ''}
      </div>
      ${secoes}
      ${cos.length ? `<h2>Computação contemplada</h2>${cos.map((x) => `<p style="margin:4px 0"><button class="link" data-abrir="${x.co}">${x.co}</button> <span class="fonte">via ${esc(x.via.join(', '))}</span></p>`).join('')}` : ''}
      ${ps.length ? `<h2>Pontes realizadas</h2><p class="fonte" style="margin-top:-4px">Pontes com ao menos duas habilidades trabalhadas.</p>${ps.map((pt) => blocoPonte(pt, false)).join('')}` : ''}
      <h2>Observações do relatório</h2>
      <div class="cartao form"><textarea rows="4" data-plano="obsRel" placeholder="Avanços da turma, ajustes no planejamento, encaminhamentos…">${esc(p.obsRel || '')}</textarea></div>`;
  }

  // ----- documentos (mesmo conteúdo para PDF e Word) -----
  function cabecalhoDoc(p, extra) {
    const t = turmaPor(p.turma) || {};
    return { t: 'kv', pares: [['Escola', t.escola || ''], ['Professor(a)', perfil().professor || ''], ['Turma', t.nome || ''], ['Ano', ANO.nome],
      ['Disciplinas', lista(p.comps.map((c) => (compPor(c) || { nome: c }).nome))], ['Período', periodo(p)], ['Referência', referencia(p)]].concat(extra || []) };
  }
  const NOTA = 'Textos das habilidades transcritos da BNCC (BRASIL, 2018) e da BNCC Computação (BRASIL, 2022). Organização por bimestre, vínculos e pontes: sugestão do I-BNCC (Sistema Isidoro, Verônica Silveira).';
  function docPlano(p) {
    const b = [{ t: 'titulo', x: 'Planejamento ' + (p.tipo === 'mensal' ? 'mensal' : 'bimestral') }, { t: 'sub', x: referencia(p).replace(/^./, (c) => c.toUpperCase()) }, cabecalhoDoc(p)];
    const sel = new Set(p.habilidades);
    p.comps.map(compPor).filter(Boolean).forEach((comp) => {
      const cods = comp.habilidades.map((h) => h.codigo).filter((c) => sel.has(c));
      if (!cods.length) return;
      const [k, rot] = ultimoCampo(comp);
      b.push({ t: 'h2', x: comp.nome }, { t: 'tabela', cab: ['Código', 'Habilidade', rot], pesos: [1.4, 5.2, 2.4], linhas: cods.map((c) => [c, HAB[c].h.texto, HAB[c].h[k] || '']) });
    });
    const cos = coDe(p.habilidades.filter((c) => HAB[c]));
    if (cos.length) b.push({ t: 'h2', x: 'Computação (trabalhada de forma transversal)' }, { t: 'tabela', cab: ['Código', 'Habilidade', 'Vinculada a'], pesos: [1.4, 5.2, 2.4], linhas: cos.map((x) => [x.co, CO[x.co].texto, x.via.join(', ')]) });
    const ps = pontesDe(p.habilidades);
    if (ps.length) b.push({ t: 'h2', x: 'Pontes entre disciplinas' }, { t: 'lista', itens: ps.map((pt) => `${pt.titulo} (${discsPonte(pt).join(', ')}): ${pt.ideia}`) });
    camposRede().forEach((f) => b.push({ t: 'h2', x: f }, { t: 'p', x: p.campos[f] || '' }));
    if (p.obs) b.push({ t: 'h2', x: 'Observações' }, { t: 'p', x: p.obs });
    b.push({ t: 'nota', x: NOTA });
    return b;
  }
  function docRelatorio(p) {
    const an = analisar(p);
    const tot = an.reduce((s, a) => s + a.planejadas.length, 0), fe = an.reduce((s, a) => s + a.feitas.length, 0);
    const b = [{ t: 'titulo', x: 'Relatório do planejamento' }, { t: 'sub', x: referencia(p).replace(/^./, (c) => c.toUpperCase()) + ' · gerado em ' + dataBR(hojeISO()) }, cabecalhoDoc(p),
      { t: 'p', x: `Das ${tot} habilidades planejadas, ${fe} foram trabalhadas (${pct(fe, tot)}%).`, b: true }];
    an.forEach((a) => {
      if (!a.planejadas.length && !a.extras.length) return;
      b.push({ t: 'h2', x: a.comp.nome });
      const tab = (xs) => ({ t: 'tabela', cab: ['Código', 'Habilidade', 'Registro'], pesos: [1.4, 5.4, 2.2], linhas: xs.map((x) => [x.c, HAB[x.c].h.texto, textoRegistro(x.r)]) });
      b.push({ t: 'h3', x: `Planejadas e trabalhadas (${a.feitas.length})` }, a.feitas.length ? tab(a.feitas) : { t: 'p', x: 'Nenhuma.' });
      b.push({ t: 'h3', x: `Planejadas e não trabalhadas (${a.pendentes.length})` }, a.pendentes.length ? { t: 'tabela', cab: ['Código', 'Habilidade'], pesos: [1.4, 7.6], linhas: a.pendentes.map((c) => [c, HAB[c].h.texto]) } : { t: 'p', x: 'Nenhuma.' });
      if (a.extras.length) b.push({ t: 'h3', x: `Trabalhadas além do planejado (${a.extras.length})` }, tab(a.extras));
    });
    const feitas = an.flatMap((a) => a.feitas.concat(a.extras).map((x) => x.c));
    const cos = coDe(feitas);
    if (cos.length) b.push({ t: 'h2', x: 'Computação contemplada' }, { t: 'tabela', cab: ['Código', 'Habilidade', 'Por meio de'], pesos: [1.4, 5.2, 2.4], linhas: cos.map((x) => [x.co, CO[x.co].texto, x.via.join(', ')]) });
    const ps = pontesDe(feitas);
    if (ps.length) b.push({ t: 'h2', x: 'Pontes entre disciplinas realizadas' }, { t: 'lista', itens: ps.map((pt) => `${pt.titulo} (${discsPonte(pt).join(', ')})`) });
    if (p.obsRel) b.push({ t: 'h2', x: 'Observações' }, { t: 'p', x: p.obsRel });
    b.push({ t: 'nota', x: NOTA });
    return b;
  }
  function blocosHTML(bs) {
    const tab = (cab, linhas, pesos) => { const s = (pesos || []).reduce((a, x) => a + x, 0);
      return `<table>${pesos ? `<colgroup>${pesos.map((w) => `<col style="width:${(100 * w / s).toFixed(1)}%">`).join('')}</colgroup>` : ''}${cab ? `<thead><tr>${cab.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>` : ''}<tbody>${linhas.map((l) => `<tr>${l.map((c) => `<td>${esc(c).replace(/\n/g, '<br>')}</td>`).join('')}</tr>`).join('')}</tbody></table>`; };
    return bs.map((b) => ({
      titulo: () => `<h1>${esc(b.x)}</h1>`, sub: () => `<p class="imp-sub">${esc(b.x)}</p>`, h2: () => `<h2>${esc(b.x)}</h2>`, h3: () => `<h3>${esc(b.x)}</h3>`,
      p: () => `<p${b.b ? ' class="imp-forte"' : ''}>${esc(b.x).replace(/\n/g, '<br>') || '&nbsp;'}</p>`, nota: () => `<p class="imp-nota">${esc(b.x)}</p>`,
      lista: () => `<ul>${b.itens.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`, kv: () => tab(null, b.pares, [1, 3]).replace('<table>', '<table class="imp-kv">'), tabela: () => tab(b.cab, b.linhas, b.pesos),
    }[b.t] || (() => ''))()).join('');
  }
  const nomeArquivo = (tipo, p) => norm(`${tipo}-${referencia(p)}-${(turmaPor(p.turma) || {}).nome || ''}`).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  function gerarDocumento(tipo, formato, p) {
    const blocos = tipo === 'planejamento' ? docPlano(p) : docRelatorio(p);
    const nome = nomeArquivo(tipo, p);
    if (formato === 'pdf') {
      let el = $('#impressao'); if (!el) { el = document.createElement('div'); el.id = 'impressao'; document.body.appendChild(el); }
      el.innerHTML = blocosHTML(blocos);
      const tituloAntes = document.title; document.title = nome;
      document.body.classList.add('imprimindo');
      const fim = () => { document.body.classList.remove('imprimindo'); document.title = tituloAntes; window.removeEventListener('afterprint', fim); };
      window.addEventListener('afterprint', fim);
      setTimeout(() => { window.print(); setTimeout(() => { if (!window.matchMedia('print').matches) fim(); }, 1500); }, 60);
      avisar('Na janela de impressão, escolha "Salvar como PDF"');
      return;
    }
    carregarArquivo('docx.js', () => window.IBNCC_DOCX).then(() => {
      const blob = window.IBNCC_DOCX(blocos);
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome + '.docx';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      avisar('Documento do Word salvo');
    }).catch(() => avisar('Não foi possível gerar o arquivo. Verifique a conexão e tente de novo.'));
  }
  function carregarArquivo(arquivo, pronto) {
    if (pronto()) return Promise.resolve();
    return new Promise((ok, falha) => { const s = document.createElement('script'); s.src = arquivo; s.onload = () => (pronto() ? ok() : falha()); s.onerror = falha; document.head.appendChild(s); });
  }

  // ----- eventos -----
  const planoDaTela = () => { const m = location.hash.match(/^#\/(plano|relatorio)\/([^/]+)/); return m ? planoPor(m[2]) : null; };
  function recarregarTela() { const y = window.scrollY; const abertos = [...document.querySelectorAll('details[open] > summary')].map((s) => s.textContent); render(); document.querySelectorAll('details > summary').forEach((s) => { if (abertos.includes(s.textContent)) s.parentElement.open = true; }); window.scrollTo(0, y); }
  function cliquePlanejar(t) {
    const a = t.dataset.acao; const p = planoDaTela();
    switch (a) {
      case 'turma-nova': editTurma = 'nova'; telaPlanejar(); return true;
      case 'turma-editar': editTurma = t.dataset.id; telaPlanejar(); return true;
      case 'turma-cancelar': editTurma = null; telaPlanejar(); return true;
      case 'turma-usar': usarTurma(t.dataset.id); avisar('Turma em uso: ' + turmaAtual().nome); telaPlanejar(); return true;
      case 'turma-salvar': {
        const nome = $('#t-nome').value.trim(); if (!nome) { avisar('Escreva o nome da turma'); return true; }
        const dados = { nome, escola: $('#t-escola').value.trim(), ano: $('#t-ano').value };
        if (editTurma === 'nova') { const nt = Object.assign({ id: novoId('t') }, dados); TURMAS.push(nt); turmaId = nt.id; avisar('Turma criada e em uso'); }
        else Object.assign(turmaPor(editTurma), dados);
        editTurma = null; salvarTurmas(); atualizarCabecalho(); telaPlanejar(); return true;
      }
      case 'turma-excluir': {
        const x = turmaPor(editTurma);
        if (x && confirm(`Excluir a turma "${x.nome}"? As marcações dessa turma e os planejamentos dela serão apagados.`)) {
          Object.keys(localStorage).filter((k) => k.startsWith('ibncc:v1:') && k.endsWith(':' + x.id)).forEach((k) => { localStorage.removeItem(k); delete ESTADO[k]; });
          TURMAS = TURMAS.filter((y) => y.id !== x.id); PLANOS = PLANOS.filter((y) => y.turma !== x.id); salvarPlanos();
          if (turmaId === x.id) turmaId = 'principal';
          editTurma = null; salvarTurmas(); atualizarCabecalho(); telaPlanejar();
        }
        return true;
      }
      case 'plano-novo': { const np = criarPlano(); location.hash = '#/plano/' + np.id; return true; }
      case 'plano-tipo': p.tipo = t.dataset.tipo; break;
      case 'plano-comp': { const c = t.dataset.comp; if (p.comps.includes(c)) { if (p.comps.length > 1) p.comps = p.comps.filter((x) => x !== c); } else p.comps.push(c); break; }
      case 'plano-sugerir': {
        const comp = compPor(t.dataset.comp);
        const cods = t.dataset.bim === 'trilha' ? comp.trilha : comp.bimestres.find((b) => b.n === Number(t.dataset.bim)).hab;
        p.habilidades = [...new Set(p.habilidades.concat(cods))]; break;
      }
      case 'plano-limpar': { const cods = new Set(compPor(t.dataset.comp).habilidades.map((h) => h.codigo)); p.habilidades = p.habilidades.filter((c) => !cods.has(c)); break; }
      case 'plano-duplicar': { const np = criarPlano({ tipo: p.tipo, bimestre: p.bimestre, mes: p.mes, turma: p.turma, comps: p.comps.slice(), habilidades: p.habilidades.slice(), campos: Object.assign({}, p.campos) }); location.hash = '#/plano/' + np.id; avisar('Planejamento duplicado'); return true; }
      case 'plano-excluir': if (confirm('Excluir este planejamento? As marcações das habilidades continuam guardadas.')) { PLANOS = PLANOS.filter((x) => x !== p); salvarPlanos(); location.hash = '#/planejar'; } return true;
      case 'plano-pendentes': {
        const pend = analisar(p).flatMap((x) => x.pendentes);
        const np = criarPlano({ tipo: p.tipo, bimestre: p.tipo === 'bimestral' ? Math.min(4, (p.bimestre || 1) + 1) : p.bimestre, turma: p.turma, comps: p.comps.slice(), habilidades: pend });
        location.hash = '#/plano/' + np.id; avisar('Novo planejamento com as habilidades pendentes'); return true;
      }
      case 'doc-plano': gerarDocumento('planejamento', t.dataset.formato, p); return true;
      case 'doc-relatorio': gerarDocumento('relatorio', t.dataset.formato, p); return true;
      default: return false;
    }
    p.atualizado = new Date().toISOString(); salvarPlanos(); recarregarTela(); return true;
  }
  function mudancaPlanejar(ev, final) {
    const el = ev.target;
    if (el.id === 'perfil-professor') { gravar('ibncc:perfil', Object.assign(perfil(), { professor: el.value })); return; }
    if (el.id === 'campos-rede') { const fs = el.value.split('\n').map((x) => x.trim()).filter(Boolean); gravar('ibncc:campos', fs.length ? fs : CAMPOS_PADRAO); return; }
    const p = planoDaTela(); if (!p) return;
    if (el.dataset.planoHab) {
      if (!final) return;
      const c = el.dataset.planoHab;
      p.habilidades = el.checked ? [...new Set(p.habilidades.concat(c))] : p.habilidades.filter((x) => x !== c);
      p.atualizado = new Date().toISOString(); salvarPlanos(); recarregarTela(); return;
    }
    if (el.dataset.planoCampo) { p.campos[el.dataset.planoCampo] = el.value; p.atualizado = new Date().toISOString(); salvarPlanos(); return; }
    const k = el.dataset.plano; if (!k) return;
    if (!final && el.tagName !== 'TEXTAREA') return;
    let v = el.value;
    if (k === 'bimestre') v = Number(v);
    p[k] = v;
    if (k === 'mes' && v) { const [a, m] = v.split('-').map(Number); p.inicio = `${v}-01`; p.fim = `${v}-${String(new Date(a, m, 0).getDate()).padStart(2, '0')}`; }
    if (k === 'turma') usarTurma(v);
    p.atualizado = new Date().toISOString(); salvarPlanos();
    if (final && ['mes', 'bimestre', 'turma', 'inicio', 'fim'].includes(k)) recarregarTela();
  }

  // ---------- painel de detalhe ----------
  const detalhe = (c) => (CO[c] ? detalheCO(c) : detalheHab(c));
  function abrir(c) {
    const corpo = $('#painel-corpo');
    $('#painel-titulo').textContent = c;
    corpo.innerHTML = detalhe(c);
    $('#painel').hidden = false;
    document.body.style.overflow = 'hidden';
    corpo.scrollTop = 0;
    $('.painel-fechar').focus();
    if (location.hash !== '#/h/' + c) history.pushState({ painel: c }, '', '#/h/' + c);
  }
  function fechar(viaHistorico) {
    if ($('#painel').hidden) return;
    $('#painel').hidden = true;
    document.body.style.overflow = '';
    if (!viaHistorico && location.hash.startsWith('#/h/')) history.back();
    else render();
  }

  function detalheHab(c) {
    const { h, comp } = HAB[c]; const e = comp.explicacoes[c];
    const tr = naTrilha(c);
    const marcacao = tr
      ? `<p class="fonte" style="margin:4px 0">Nível de progresso no ${esc(ANO.nome)}</p><div class="niveis" style="padding:0" role="group" aria-label="Nível de progresso">${botoesNivel(c)}</div>`
      : `<button class="marcacao-grande" role="checkbox" aria-checked="${marcada(c)}" data-marcar="${c}"><span class="caixa">${CHECK}</span>${marcada(c) ? 'Trabalhada' : 'Marcar como trabalhada'}</button>`;
    const bim = tr ? '<span class="selo selo-sugestao">Trilha contínua: todos os bimestres</span>' : `<span class="selo selo-sugestao">Sugestão: ${BIM_DE[c]}º bimestre</span>`;
    let html = `
      <div style="display:flex;gap:6px;flex-wrap:wrap"><span class="selo selo-comp">${esc(comp.nome)}</span><span class="selo selo-tipo">${esc(comp.tipos[h.tipo] || '')}</span>${bim}</div>
      <div class="oficial"><span class="selo selo-oficial">Texto oficial da BNCC</span><p><b>(${c})</b> ${esc(h.texto)}</p><div class="fonte">${esc(h.fonte)}</div></div>
      <dl class="ficha">${comp.contexto.map(([k, r]) => `<dt>${esc(r)}</dt><dd>${esc(h[k])}</dd>`).join('')}</dl>
      ${marcacao}`;
    if (e) {
      html += `<div class="explica"><p class="rotulo">Sistema Isidoro</p><h3 style="margin-top:4px">O que se espera desta habilidade</h3>
        <p>${esc(e.o_que_se_espera)}</p>
        <p><b>Sinais de que a criança está desenvolvendo a habilidade</b></p>
        <ul>${e.sinais.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
        <div class="atencao"><b>Atenção:</b> ${esc(e.atencao)}</div></div>`;
    }
    const vs = VINC_HAB[c] || [];
    if (vs.length && Object.keys(CO).length) {
      html += '<h3>Computação vinculada <span class="selo selo-sugestao">Sugestão</span></h3>' + vs.map((v) => `
        <div class="vinculo"><button data-abrir="${v.co}">${v.co} →</button> <span class="fonte">${esc(CO[v.co].eixo)}</span>
        <p style="margin:6px 0 4px">${esc(CO[v.co].texto)}</p><p class="fonte" style="margin:0"><b>Por que se relacionam:</b> ${esc(v.justificativa)}</p></div>`).join('');
    }
    return html + secaoPontes(c) + blocoMateriais(c);
  }

  function detalheCO(c) {
    const h = CO[c]; const ok = coTrabalhada(c);
    const vs = VINC_CO[c] || [];
    const destaques = (CO_BIM[c] || []).map((d) => `<span class="selo selo-sugestao">${esc(d.comp.curto)}: ${d.n}º bimestre</span>`).join('');
    const porComp = ANO.comps.map((comp) => {
      const vc = vs.filter((v) => v.comp === comp);
      if (!vc.length) return '';
      return `<h3>${esc(comp.nome)} <span class="selo selo-sugestao">Sugestão</span></h3>` + vc.map((v) => `<div class="vinculo" style="border-left-color:var(--salvia)"><button data-abrir="${v.hab}" style="color:var(--salvia-escuro)">${v.hab}${trabalhada(v.hab) ? ' ✓' : ''} →</button>
        <p style="margin:6px 0 4px">${esc(HAB[v.hab].h.texto)}</p><p class="fonte" style="margin:0"><b>Por que se relacionam:</b> ${esc(v.justificativa)}</p></div>`).join('');
    }).join('');
    return `
      <div style="display:flex;gap:6px;flex-wrap:wrap"><span class="selo selo-co">${esc(h.eixo)}</span>${destaques}</div>
      <div class="oficial" style="border-left-color:var(--azul)"><span class="selo selo-oficial">Texto oficial da BNCC Computação</span><p><b>(${c})</b> ${esc(h.texto)}</p><div class="fonte">${esc(h.fonte)}</div></div>
      <dl class="ficha"><dt>Eixo</dt><dd>${esc(h.eixo)}</dd><dt>Objeto de conhecimento</dt><dd>${esc(h.objeto_conhecimento)}</dd></dl>
      <div class="cartao" style="margin:8px 0"><b class="co-status ${ok ? 'sim' : 'nao'}">${statusCO(c)}</b></div>
      <div class="explica"><p class="rotulo">Texto oficial</p><h3 style="margin-top:4px">Explicação da habilidade</h3><p>${esc(h.explicacao)}</p><p><b>Exemplos</b></p><p>${esc(h.exemplos)}</p></div>
      <p class="rotulo" style="margin-top:18px">Habilidades vinculadas</p>
      ${porComp}
      ${secaoPontes(c)}
      ${blocoMateriais(c)}`;
  }

  function blocoMateriais(c) {
    const ms = MAT[c] || [];
    if (!ms.length) return '';
    return '<h3>Materiais do Sistema Isidoro</h3>' + ms.map((m) => `
      <a class="material" href="${esc(m.pagina)}" target="_blank" rel="noopener">${seloAcesso(m)}<span>${esc(m.titulo)}</span></a>`).join('');
  }

  // ---------- navegação ----------
  let ultimaAba = 'bimestres';
  function render() {
    const partes = location.hash.replace(/^#\/?/, '').split('/');
    let aba = partes[0] || (ANO ? 'bimestres' : 'escolher');
    if (aba === 'ir') {
      selecionar(partes[1], partes[2]).then(() => { history.replaceState(null, '', '#/bimestres'); render(); })
        .catch(() => { history.replaceState(null, '', '#/escolher'); render(); });
      return;
    }
    if (aba === 'etapa') { aba = 'escolher'; partes[1] = partes[1] || ''; }
    if (!ANO && aba !== 'escolher') aba = 'escolher';
    if (aba === 'h') {
      const c = partes[1];
      if (HAB[c] || CO[c]) { if ($('#painel').hidden) { renderAba(ultimaAba); abrir(c); } return; }
      aba = 'bimestres';
    }
    if (!$('#painel').hidden) { $('#painel').hidden = true; document.body.style.overflow = ''; }
    if (aba === 'plano' || aba === 'relatorio') {
      const pl = planoPor(partes[1]);
      if (!pl) { history.replaceState(null, '', '#/planejar'); aba = 'planejar'; }
      else {
        if (pl.turma !== turmaId && turmaPor(pl.turma)) usarTurma(pl.turma);
        if (pl.ano !== ANO.id) { selecionar(pl.ano, pl.comps[0]).then(render).catch(() => { history.replaceState(null, '', '#/planejar'); render(); }); return; }
      }
    }
    renderAba(aba, partes[1]);
  }
  function renderAba(aba, arg) {
    const telas = { escolher: () => telaEscolher(arg), bimestres: () => telaBimestres(arg), trilha: telaTrilha, computacao: telaComputacao, buscar: telaBuscar, sobre: telaSobre,
      planejar: telaPlanejar, plano: () => telaPlano(arg), relatorio: () => telaRelatorio(arg) };
    if (!telas[aba]) aba = 'bimestres';
    if (aba !== ultimaAba) window.scrollTo(0, 0);
    ultimaAba = aba;
    telas[aba]();
    const abaNav = ['plano', 'relatorio'].includes(aba) ? 'planejar' : aba;
    document.querySelectorAll('.abas a').forEach((a) => { if (a.dataset.aba === abaNav) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    document.body.classList.toggle('sem-ano', !ANO);
  }
  function atualizarTudo() {
    const y = window.scrollY;
    renderAba(ultimaAba, ultimaAba === 'bimestres' ? ultimoBimestre() : (['plano', 'relatorio'].includes(ultimaAba) ? location.hash.split('/')[2] : undefined));
    window.scrollTo(0, y);
    if (!$('#painel').hidden) {
      const c = $('#painel-titulo').textContent; const corpo = $('#painel-corpo'); const st = corpo.scrollTop;
      corpo.innerHTML = detalhe(c); corpo.scrollTop = st;
    }
  }

  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-marcar],[data-nivel],[data-abrir],[data-fechar],[data-filtro],[data-acao]');
    if (!t) return;
    if (t.dataset.acao && cliquePlanejar(t)) return;
    if (t.dataset.marcar) { alternarMarcada(t.dataset.marcar); avisar(marcada(t.dataset.marcar) ? t.dataset.marcar + ' marcada como trabalhada' : 'Marcação desfeita'); atualizarTudo(); }
    else if (t.dataset.nivel) { definirNivel(t.dataset.cod, t.dataset.nivel); const n = nivel(t.dataset.cod); avisar(n ? t.dataset.cod + ': ' + NIVEIS.find((x) => x.id === n).rotulo : 'Nível desfeito'); atualizarTudo(); }
    else if (t.dataset.abrir) {
      const c = t.dataset.abrir;
      if (!$('#painel').hidden) { $('#painel-titulo').textContent = c; $('#painel-corpo').innerHTML = detalhe(c); $('#painel-corpo').scrollTop = 0; history.replaceState({ painel: c }, '', '#/h/' + c); } else abrir(c);
    }
    else if (t.hasAttribute('data-fechar')) fechar(false);
    else if (t.dataset.filtro) { busca.filtro = t.dataset.filtro; telaBuscar(); }
    else if (t.dataset.acao === 'exportar') exportar();
    else if (t.dataset.acao === 'apagar') {
      if (confirm('Apagar todas as marcações deste aparelho, de todas as disciplinas? Esta ação não pode ser desfeita.')) {
        Object.keys(localStorage).filter((k) => k.startsWith('ibncc:v1:')).forEach((k) => localStorage.removeItem(k));
        Object.keys(ESTADO).forEach((k) => { ESTADO[k] = vazio(); });
        avisar('Marcações apagadas'); telaSobre();
      }
    }
    else if (t.dataset.acao === 'instalar' && eventoInstalar) { eventoInstalar.prompt(); eventoInstalar = null; }
  });
  document.addEventListener('change', (ev) => { if (ev.target.dataset.acao === 'importar') importar(ev.target.files[0]); else mudancaPlanejar(ev, true); });
  document.addEventListener('input', (ev) => mudancaPlanejar(ev, false));
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') fechar(false); });
  window.addEventListener('hashchange', () => render());
  window.addEventListener('popstate', () => { if (!location.hash.startsWith('#/h/') && !$('#painel').hidden) fechar(true); });

  // cópia em arquivo: todas as disciplinas guardadas no aparelho
  function exportar() {
    const estados = {};
    Object.keys(localStorage).filter((k) => k.startsWith('ibncc:v1:')).forEach((k) => { estados[k] = ler(k, null); });
    const extras = {}; ['ibncc:turmas', 'ibncc:turma', 'ibncc:planos', 'ibncc:campos', 'ibncc:perfil'].forEach((k) => { const v = ler(k, null); if (v != null) extras[k] = v; });
    const blob = new Blob([JSON.stringify({ app: 'I-BNCC', versao: 3, estados, extras }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'i-bncc-copia-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    avisar('Cópia salva em arquivo');
  }
  function importar(arq) {
    if (!arq) return;
    arq.text().then((t) => {
      const d = JSON.parse(t);
      if (d.app !== 'I-BNCC') throw new Error();
      const estados = d.estados || (d.marcadas ? { 'ibncc:v1:lp-1ano': { marcadas: d.marcadas, trilha: d.trilha || {}, atualizado: null } } : null);
      if (!estados) throw new Error();
      Object.entries(estados).forEach(([k, s]) => {
        if (!k.startsWith('ibncc:v1:') || !s || !s.marcadas) return;
        const novo = { marcadas: s.marcadas, trilha: s.trilha || {}, log: s.log || [], atualizado: new Date().toISOString() };
        gravar(k, novo); ESTADO[k] = novo;
      });
      if (d.extras) {
        Object.entries(d.extras).forEach(([k, v]) => { if (['ibncc:turmas', 'ibncc:turma', 'ibncc:planos', 'ibncc:campos', 'ibncc:perfil'].includes(k)) gravar(k, v); });
        TURMAS = ler('ibncc:turmas', TURMAS); turmaId = ler('ibncc:turma', turmaId); if (!turmaPor(turmaId)) turmaId = TURMAS[0].id;
        PLANOS = ler('ibncc:planos', []); atualizarCabecalho();
      }
      avisar('Marcações recuperadas'); telaSobre();
    }).catch(() => avisar('Arquivo não reconhecido'));
  }

  // ---------- instalação e uso sem internet ----------
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); eventoInstalar = e;
    const b = $('#btn-instalar'); b.hidden = false;
    b.onclick = () => { e.prompt(); b.hidden = true; eventoInstalar = null; };
  });
  window.addEventListener('appinstalled', () => { $('#btn-instalar').hidden = true; avisar('I-BNCC instalado'); });
  // Atualização automática: o app instalado procura versões novas ao abrir e ao voltar para a tela.
  // Quando encontra, a versão nova assume e a tela recarrega uma vez, sem reinstalar e sem perder marcações.
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    const jaTinhaVersao = !!navigator.serviceWorker.controller;
    let recarregando = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!jaTinhaVersao || recarregando) return;
      recarregando = true;
      try { sessionStorage.setItem('ibncc:atualizado', '1'); } catch (_) {}
      location.reload();
    });
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
        const procurar = () => reg.update().catch(() => {});
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') procurar(); });
        setInterval(procurar, 60 * 60 * 1000);
      }).catch(() => {});
    });
    try { if (sessionStorage.getItem('ibncc:atualizado')) { sessionStorage.removeItem('ibncc:atualizado'); setTimeout(() => avisar('I-BNCC atualizado para a versão ' + VERSAO_APP), 400); } } catch (_) {}
  }

  // ---------- início ----------
  const inicial = location.hash;
  const iniciar = () => {
    if (inicial.startsWith('#/h/')) {
      const c = inicial.slice(4); history.replaceState(null, '', '#/bimestres'); render();
      if (HAB[c] || CO[c]) abrir(c);
    } else render();
  };
  if (atual && !inicial.startsWith('#/ir/')) selecionar(atual.ano, atual.comp).then(iniciar).catch(() => { atual = null; iniciar(); });
  else { atualizarCabecalho(); iniciar(); }
})();
