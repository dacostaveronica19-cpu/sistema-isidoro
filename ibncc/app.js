/* I-BNCC · aplicativo (v0.3: escolha de etapa, ano e disciplina; marcações salvas no aparelho) */
(function () {
  'use strict';

  const CAT = window.IBNCC_CATALOGO;
  const REG = {};
  window.IBNCC_REGISTRAR = (id, obj) => { REG[id] = Object.assign({ id }, obj); };
  const VERSAO_APP = '0.5 (teste)';

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
  const ESTADO = {}; // chave -> { marcadas, trilha, atualizado }
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
      if (!ESTADO[comp.chave]) {
        const s = ler(comp.chave, null);
        ESTADO[comp.chave] = s && s.marcadas ? s : { marcadas: {}, trilha: {}, atualizado: null };
      }
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
    $('#contexto').textContent = c ? `${c.nome} · ${ANO.nome}` : 'Escolher etapa e ano';
  }

  // ---------- marcações ----------
  const est = (cod) => ESTADO[HAB[cod].comp.chave];
  function salvar(comp) {
    const s = ESTADO[comp.chave]; s.atualizado = new Date().toISOString();
    if (!gravar(comp.chave, s)) avisar('Não foi possível salvar neste aparelho.');
  }
  const naTrilha = (cod) => HAB[cod].comp.trilhaSet.has(cod);
  const marcada = (cod) => !!est(cod).marcadas[cod];
  const nivel = (cod) => est(cod).trilha[cod] || null;
  function alternarMarcada(cod) {
    const s = est(cod);
    if (s.marcadas[cod]) delete s.marcadas[cod]; else s.marcadas[cod] = { em: new Date().toISOString() };
    salvar(HAB[cod].comp);
  }
  function definirNivel(cod, n) {
    const s = est(cod);
    if (s.trilha[cod] === n) delete s.trilha[cod]; else s.trilha[cod] = n;
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
        <h3 style="margin-top:0">Suas marcações</h3>
        <p>Nesta versão, as marcações ficam guardadas apenas neste aparelho e neste navegador, separadas por disciplina. A criação de conta, com cópia das marcações na nuvem, está em preparação. Até lá, é possível guardar uma cópia em arquivo e recuperá-la em outro aparelho.</p>
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
    renderAba(aba, partes[1]);
  }
  function renderAba(aba, arg) {
    const telas = { escolher: () => telaEscolher(arg), bimestres: () => telaBimestres(arg), trilha: telaTrilha, computacao: telaComputacao, buscar: telaBuscar, sobre: telaSobre };
    if (!telas[aba]) aba = 'bimestres';
    if (aba !== ultimaAba) window.scrollTo(0, 0);
    ultimaAba = aba;
    telas[aba]();
    document.querySelectorAll('.abas a').forEach((a) => { if (a.dataset.aba === aba) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    document.body.classList.toggle('sem-ano', !ANO);
  }
  function atualizarTudo() {
    const y = window.scrollY;
    renderAba(ultimaAba, ultimaAba === 'bimestres' ? ultimoBimestre() : undefined);
    window.scrollTo(0, y);
    if (!$('#painel').hidden) {
      const c = $('#painel-titulo').textContent; const corpo = $('#painel-corpo'); const st = corpo.scrollTop;
      corpo.innerHTML = detalhe(c); corpo.scrollTop = st;
    }
  }

  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-marcar],[data-nivel],[data-abrir],[data-fechar],[data-filtro],[data-acao]');
    if (!t) return;
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
        Object.keys(ESTADO).forEach((k) => { ESTADO[k] = { marcadas: {}, trilha: {}, atualizado: null }; });
        avisar('Marcações apagadas'); telaSobre();
      }
    }
    else if (t.dataset.acao === 'instalar' && eventoInstalar) { eventoInstalar.prompt(); eventoInstalar = null; }
  });
  document.addEventListener('change', (ev) => { if (ev.target.dataset.acao === 'importar') importar(ev.target.files[0]); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') fechar(false); });
  window.addEventListener('hashchange', () => render());
  window.addEventListener('popstate', () => { if (!location.hash.startsWith('#/h/') && !$('#painel').hidden) fechar(true); });

  // cópia em arquivo: todas as disciplinas guardadas no aparelho
  function exportar() {
    const estados = {};
    Object.keys(localStorage).filter((k) => k.startsWith('ibncc:v1:')).forEach((k) => { estados[k] = ler(k, null); });
    const blob = new Blob([JSON.stringify({ app: 'I-BNCC', versao: 2, estados }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'i-bncc-marcacoes-' + new Date().toISOString().slice(0, 10) + '.json';
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
        const novo = { marcadas: s.marcadas, trilha: s.trilha || {}, atualizado: new Date().toISOString() };
        gravar(k, novo); ESTADO[k] = novo;
      });
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
