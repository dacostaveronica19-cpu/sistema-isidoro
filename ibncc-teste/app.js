/* I-BNCC · aplicativo (Parte 2: uso sem conta, marcações salvas no aparelho) */
(function () {
  'use strict';

  const D = window.IBNCC_DADOS;
  const LP = {}; D.lp.habilidades.forEach((h) => { LP[h.codigo] = h; });
  const CO = {}; D.co.habilidades.forEach((h) => { CO[h.codigo] = h; });
  const EXP = D.exp;
  const ORG = D.org;
  const BIM_DE = {}; ORG.bimestres.forEach((b) => { b.lp.forEach((c) => { BIM_DE[c] = b.n; }); b.co.forEach((c) => { BIM_DE[c] = b.n; }); });
  const EXCLUSIVAS = D.lp.habilidades.filter((h) => h.tipo === 'exclusiva_1ano').map((h) => h.codigo);
  const TRILHA = ORG.trilha_continua;
  const NIVEIS = ORG.niveis_trilha; // iniciada, em_desenvolvimento, trabalhada_no_ano
  const VINC_LP = {}; const VINC_CO = {};
  ORG.vinculos_computacao.forEach((v) => {
    (VINC_LP[v.lp] = VINC_LP[v.lp] || []).push(v);
    (VINC_CO[v.co] = VINC_CO[v.co] || []).push(v);
  });
  const MAT = {}; (ORG.materiais || []).forEach((m) => m.habilidades.forEach((c) => { (MAT[c] = MAT[c] || []).push(m); }));
  const TIPO_ROTULO = { exclusiva_1ano: 'Exclusiva do 1º ano', compartilhada_1_2: '1º e 2º anos', compartilhada_1_5: '1º ao 5º ano' };

  // ---------- armazenamento local ----------
  const CHAVE = 'ibncc:v1:lp-1ano';
  let estado = { marcadas: {}, trilha: {}, atualizado: null };
  try { const s = JSON.parse(localStorage.getItem(CHAVE)); if (s && s.marcadas) estado = s; } catch (_) {}
  function salvar() {
    estado.atualizado = new Date().toISOString();
    try { localStorage.setItem(CHAVE, JSON.stringify(estado)); } catch (_) { avisar('Não foi possível salvar neste aparelho.'); }
  }
  const marcada = (c) => !!estado.marcadas[c];
  const nivel = (c) => estado.trilha[c] || null;
  function alternarMarcada(c) {
    if (marcada(c)) delete estado.marcadas[c]; else estado.marcadas[c] = { em: new Date().toISOString() };
    salvar();
  }
  function definirNivel(c, n) {
    if (estado.trilha[c] === n) delete estado.trilha[c]; else estado.trilha[c] = n;
    salvar();
  }
  const lpTrabalhada = (c) => (LP[c].tipo === 'exclusiva_1ano' ? marcada(c) : !!nivel(c));
  const coTrabalhada = (c) => (VINC_CO[c] || []).some((v) => lpTrabalhada(v.lp));

  // ---------- utilidades ----------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const $ = (sel, el = document) => el.querySelector(sel);
  const tela = $('#tela');
  const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function avisar(msg) {
    const a = $('#aviso'); a.textContent = msg; a.hidden = false;
    clearTimeout(avisar.t); avisar.t = setTimeout(() => { a.hidden = true; }, 2600);
  }
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  function selosHab(c) {
    let s = '';
    (VINC_LP[c] || []).forEach((v) => { s += `<span class="selo selo-co">${esc(v.co)}</span>`; });
    (MAT[c] || []).forEach((m) => { s += m.acesso === 'pago' ? '<span class="selo selo-pago">Material pago</span>' : '<span class="selo selo-gratis">Gratuito</span>'; });
    return s;
  }

  function cartaoExclusiva(c) {
    const h = LP[c]; const m = marcada(c);
    return `<div class="hab${m ? ' feita' : ''}" data-cod="${c}">
      <button class="hab-corpo" data-abrir="${c}">
        <div class="hab-cod">${c}</div>
        <p class="hab-texto">${esc(h.texto)}</p>
        <div class="hab-meta"><span>${esc(h.campo_atuacao)}</span>${selosHab(c)}</div>
      </button>
      <button class="marcar" role="checkbox" aria-checked="${m}" data-marcar="${c}" aria-label="Marcar ${c} como trabalhada"><span class="caixa">${CHECK}</span></button>
    </div>`;
  }

  function botoesNivel(c) {
    const atual = nivel(c);
    return NIVEIS.map((n) => `<button data-nivel="${n.id}" data-cod="${c}" aria-pressed="${atual === n.id}">${esc(n.rotulo)}</button>`).join('');
  }
  function cartaoTrilha(c) {
    const h = LP[c]; const n = nivel(c);
    return `<div class="hab hab-trilha${n ? ' nivel-' + n : ''}" data-cod="${c}">
      <button class="hab-corpo" data-abrir="${c}">
        <div class="hab-cod">${c} <span class="selo selo-tipo">${TIPO_ROTULO[h.tipo]}</span></div>
        <p class="hab-texto">${esc(h.texto)}</p>
        <div class="hab-meta"><span>${esc(h.pratica_linguagem)}</span>${selosHab(c)}</div>
      </button>
      <div class="niveis" role="group" aria-label="Nível de progresso de ${c}">${botoesNivel(c)}</div>
    </div>`;
  }

  function cartaoCO(c) {
    const h = CO[c]; const ok = coTrabalhada(c);
    const via = (VINC_CO[c] || []).map((v) => `<button data-abrir="${v.lp}" class="${lpTrabalhada(v.lp) ? 'ok' : ''}">${v.lp}${lpTrabalhada(v.lp) ? ' ✓' : ''}</button>`).join('');
    return `<div class="hab${ok ? ' feita' : ''}" data-cod="${c}" style="flex-direction:column">
      <button class="hab-corpo" data-abrir="${c}">
        <div class="hab-cod" style="color:var(--azul)">${c} <span class="selo selo-co">${esc(h.eixo)}</span></div>
        <p class="hab-texto">${esc(h.texto)}</p>
        <div class="co-status ${ok ? 'sim' : 'nao'}">${ok ? '✓ Trabalhada por meio de Língua Portuguesa' : 'Ainda sem habilidade vinculada marcada'}</div>
      </button>
      <div style="padding:0 14px 12px"><div class="fonte">Habilidades de Língua Portuguesa vinculadas:</div><div class="via">${via}</div></div>
    </div>`;
  }

  function resumoGeral() {
    const ex = EXCLUSIVAS.filter(marcada).length;
    const tr = TRILHA.filter((c) => nivel(c)).length;
    const co = Object.keys(CO).filter(coTrabalhada).length;
    return `<div class="resumo">
      <div><b>${ex}/${EXCLUSIVAS.length}</b><span>Exclusivas do 1º ano</span><div class="barra"><i style="width:${pct(ex, EXCLUSIVAS.length)}%"></i></div></div>
      <div><b>${tr}/${TRILHA.length}</b><span>Trilha contínua</span><div class="barra"><i style="width:${pct(tr, TRILHA.length)}%"></i></div></div>
      <div><b>${co}/${Object.keys(CO).length}</b><span>Computação</span><div class="barra"><i style="width:${pct(co, Object.keys(CO).length)}%"></i></div></div>
    </div>`;
  }

  // ---------- telas ----------
  function telaBimestres(n) {
    n = Math.min(4, Math.max(1, Number(n) || ultimoBimestre()));
    try { localStorage.setItem('ibncc:bimestre', String(n)); } catch (_) {}
    const b = ORG.bimestres.find((x) => x.n === n);
    const seletor = ORG.bimestres.map((x) => {
      const feitas = x.lp.filter(marcada).length;
      return `<a href="#/bimestres/${x.n}" ${x.n === n ? 'aria-current="page"' : ''}>${x.n}º bim<small>${feitas}/${x.lp.length}</small></a>`;
    }).join('');
    const trFeitas = TRILHA.filter((c) => nivel(c)).length;
    tela.innerHTML = `
      <p class="rotulo">Organização por bimestre</p>
      <h1>Língua Portuguesa · 1º ano</h1>
      ${resumoGeral()}
      <nav class="seletor" aria-label="Bimestres">${seletor}</nav>
      <h2>${n}º bimestre — ${esc(b.titulo)}</h2>
      <div class="foco"><span class="selo selo-sugestao">Sugestão</span> ${esc(b.foco)}</div>
      <h3>Habilidades exclusivas do 1º ano</h3>
      <div class="lista">${b.lp.map(cartaoExclusiva).join('')}</div>
      <h3>Computação em destaque neste bimestre</h3>
      <div class="lista">${b.co.map(cartaoCO).join('')}</div>
      <a class="cartao cartao-link" href="#/trilha">
        <div><p class="rotulo">Em todos os bimestres</p><b class="serif" style="font-size:20px">Trilha contínua</b>
        <div class="fonte">${trFeitas} de ${TRILHA.length} habilidades compartilhadas com algum nível marcado</div></div>
        <span class="seta">→</span>
      </a>`;
  }
  function ultimoBimestre() { try { return Number(localStorage.getItem('ibncc:bimestre')) || 1; } catch (_) { return 1; } }

  function telaTrilha() {
    const grupos = {};
    TRILHA.forEach((c) => { const k = LP[c].campo_atuacao; (grupos[k] = grupos[k] || []).push(c); });
    tela.innerHTML = `
      <p class="rotulo">Em todos os bimestres</p>
      <h1>Trilha contínua</h1>
      <p class="descricao">Habilidades que a BNCC prevê para o 1º e o 2º anos (EF12LP) ou do 1º ao 5º ano (EF15LP). Como continuam a ser desenvolvidas nos anos seguintes, a marcação indica um nível de progresso no 1º ano: <b>Iniciada</b>, <b>Em desenvolvimento</b> ou <b>Trabalhada no ano</b>. Um novo toque no nível escolhido desfaz a marcação.</p>
      ${Object.keys(grupos).map((k) => `<h2>${esc(k)}</h2><div class="lista">${grupos[k].map(cartaoTrilha).join('')}</div>`).join('')}`;
  }

  function telaComputacao() {
    tela.innerHTML = `
      <p class="rotulo">Transversal</p>
      <h1>Computação · 1º ano</h1>
      <p class="descricao">As habilidades de Computação são trabalhadas junto com as de Língua Portuguesa. Uma habilidade de Computação passa a contar como trabalhada quando alguma habilidade de Língua Portuguesa vinculada a ela é marcada.</p>
      ${resumoGeral()}
      <div class="lista">${Object.keys(CO).map(cartaoCO).join('')}</div>`;
  }

  let busca = { termo: '', filtro: 'todas' };
  function telaBuscar() {
    tela.innerHTML = `
      <p class="rotulo">Consulta</p>
      <h1>Buscar</h1>
      <label class="sr" for="campo-busca">Buscar por código ou palavra</label>
      <input id="campo-busca" class="campo-busca" type="search" placeholder="Código (EF01LP05) ou palavra (rima, alfabeto…)" value="${esc(busca.termo)}" autocomplete="off">
      <div class="filtros" role="group" aria-label="Filtrar">
        ${[['todas', 'Todas'], ['exclusiva_1ano', 'Exclusivas'], ['trilha', 'Trilha'], ['co', 'Computação'], ['pendentes', 'Não marcadas']].map(([id, r]) => `<button data-filtro="${id}" aria-pressed="${busca.filtro === id}">${r}</button>`).join('')}
      </div>
      <div id="resultados" class="lista"></div>`;
    const campo = $('#campo-busca');
    campo.addEventListener('input', () => { busca.termo = campo.value; resultados(); });
    resultados();
    if (!busca.termo) setTimeout(() => campo.focus({ preventScroll: true }), 50);
  }
  function resultados() {
    const t = norm(busca.termo.trim());
    let itens = [];
    const casa = (txt) => !t || norm(txt).includes(t);
    if (busca.filtro !== 'co') {
      D.lp.habilidades.forEach((h) => {
        if (busca.filtro === 'exclusiva_1ano' && h.tipo !== 'exclusiva_1ano') return;
        if (busca.filtro === 'trilha' && h.tipo === 'exclusiva_1ano') return;
        if (busca.filtro === 'pendentes' && lpTrabalhada(h.codigo)) return;
        const e = EXP[h.codigo] || {};
        if (casa([h.codigo, h.texto, h.objeto_conhecimento, h.pratica_linguagem, h.campo_atuacao, e.o_que_se_espera].join(' '))) itens.push(h.codigo);
      });
    }
    if (busca.filtro === 'todas' || busca.filtro === 'co' || busca.filtro === 'pendentes') {
      D.co.habilidades.forEach((h) => {
        if (busca.filtro === 'pendentes' && coTrabalhada(h.codigo)) return;
        if (casa([h.codigo, h.texto, h.objeto_conhecimento, h.eixo, h.explicacao].join(' '))) itens.push(h.codigo);
      });
    }
    $('#resultados').innerHTML = itens.length
      ? `<p class="fonte">${itens.length} habilidade${itens.length > 1 ? 's' : ''}</p>` + itens.map((c) => (CO[c] ? cartaoCO(c) : LP[c].tipo === 'exclusiva_1ano' ? cartaoExclusiva(c) : cartaoTrilha(c))).join('')
      : '<p class="vazio">Nenhuma habilidade encontrada.</p>';
  }

  let eventoInstalar = null;
  function telaSobre() {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const instalado = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    tela.innerHTML = `
      <p class="rotulo">Sobre o aplicativo</p>
      <h1>I-BNCC</h1>
      <p class="descricao">A BNCC em formato de aplicativo, para consulta rápida e acompanhamento do que foi trabalhado em sala. Esta versão traz Língua Portuguesa do 1º ano do Ensino Fundamental, com as habilidades de Computação integradas de forma transversal.</p>

      <div class="cartao">
        <h3 style="margin-top:0">O que é oficial e o que é sugestão</h3>
        <p><span class="selo selo-oficial">Texto oficial</span> O texto das habilidades, os campos de atuação, as práticas de linguagem e os objetos de conhecimento foram transcritos da BNCC (BRASIL, 2018) e da BNCC Computação (BRASIL, 2022), com a página de origem indicada em cada habilidade.</p>
        <p><span class="selo selo-sugestao">Sugestão</span> A BNCC não distribui habilidades por bimestre. A divisão em bimestres, os vínculos com Computação e as explicações "O que se espera" são uma proposta do Sistema Isidoro.</p>
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
        <p>Nesta versão, as marcações ficam guardadas apenas neste aparelho e neste navegador. A criação de conta, com cópia das marcações na nuvem, está em preparação. Até lá, é possível guardar uma cópia em arquivo e recuperá-la em outro aparelho.</p>
        <p class="fonte">${estado.atualizado ? 'Última alteração: ' + new Date(estado.atualizado).toLocaleString('pt-BR') : 'Nenhuma marcação feita ainda.'}</p>
        <div class="botoes">
          <button class="btn" data-acao="exportar">Salvar cópia em arquivo</button>
          <label class="btn">Recuperar de arquivo<input type="file" accept="application/json,.json" data-acao="importar" hidden></label>
          <button class="btn btn-perigo" data-acao="apagar">Apagar todas as marcações</button>
        </div>
      </div>

      <h2>Referências</h2>
      <p class="ref">BRASIL. Ministério da Educação. <b>Base Nacional Comum Curricular</b>. Brasília: MEC, 2018.</p>
      <p class="ref">BRASIL. Ministério da Educação. Conselho Nacional de Educação. <b>Computação</b>: complemento à BNCC. Anexo ao Parecer CNE/CEB nº 2/2022. Brasília: MEC, 2022.</p>

      <p class="credito">Desenvolvido por Verônica Silveira · <a href="https://sistemaisidoro.com.br" target="_blank" rel="noopener">Sistema Isidoro</a><br>Versão 0.2 (teste)</p>`;
  }

  // ---------- painel de detalhe ----------
  function abrir(c) {
    const corpo = $('#painel-corpo');
    $('#painel-titulo').textContent = c;
    corpo.innerHTML = CO[c] ? detalheCO(c) : detalheLP(c);
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

  function detalheLP(c) {
    const h = LP[c]; const e = EXP[c];
    const exclusiva = h.tipo === 'exclusiva_1ano';
    const marcacao = exclusiva
      ? `<button class="marcacao-grande" role="checkbox" aria-checked="${marcada(c)}" data-marcar="${c}"><span class="caixa">${CHECK}</span>${marcada(c) ? 'Trabalhada' : 'Marcar como trabalhada'}</button>`
      : `<p class="fonte" style="margin:4px 0">Nível de progresso no 1º ano</p><div class="niveis" style="padding:0" role="group" aria-label="Nível de progresso">${botoesNivel(c)}</div>`;
    const bim = exclusiva ? `<span class="selo selo-sugestao">Sugestão: ${BIM_DE[c]}º bimestre</span>` : '<span class="selo selo-sugestao">Trilha contínua: todos os bimestres</span>';
    let html = `
      <div style="display:flex;gap:6px;flex-wrap:wrap"><span class="selo selo-tipo">${TIPO_ROTULO[h.tipo]}</span>${bim}</div>
      <div class="oficial"><span class="selo selo-oficial">Texto oficial da BNCC</span><p><b>(${c})</b> ${esc(h.texto)}</p><div class="fonte">${esc(h.fonte)}</div></div>
      <dl class="ficha">
        <dt>Campo de atuação</dt><dd>${esc(h.campo_atuacao)}</dd>
        <dt>Prática de linguagem</dt><dd>${esc(h.pratica_linguagem)}</dd>
        <dt>Objeto de conhecimento</dt><dd>${esc(h.objeto_conhecimento)}</dd>
      </dl>
      ${marcacao}`;
    if (e) {
      html += `<div class="explica"><p class="rotulo">Sistema Isidoro</p><h3 style="margin-top:4px">O que se espera desta habilidade</h3>
        <p>${esc(e.o_que_se_espera)}</p>
        <p><b>Sinais de que a criança está desenvolvendo a habilidade</b></p>
        <ul>${e.sinais.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
        <div class="atencao"><b>Atenção:</b> ${esc(e.atencao)}</div></div>`;
    }
    const vs = VINC_LP[c] || [];
    if (vs.length) {
      html += `<h3>Computação vinculada <span class="selo selo-sugestao">Sugestão</span></h3>` + vs.map((v) => `
        <div class="vinculo"><button data-abrir="${v.co}">${v.co} →</button> <span class="fonte">${esc(CO[v.co].eixo)}</span>
        <p style="margin:6px 0 4px">${esc(CO[v.co].texto)}</p><p class="fonte" style="margin:0"><b>Por que se relacionam:</b> ${esc(v.justificativa)}</p></div>`).join('');
    }
    html += blocoMateriais(c);
    return html;
  }

  function detalheCO(c) {
    const h = CO[c]; const ok = coTrabalhada(c);
    const vs = VINC_CO[c] || [];
    return `
      <div style="display:flex;gap:6px;flex-wrap:wrap"><span class="selo selo-co">${esc(h.eixo)}</span><span class="selo selo-sugestao">Destaque sugerido: ${BIM_DE[c]}º bimestre</span></div>
      <div class="oficial" style="border-left-color:var(--azul)"><span class="selo selo-oficial">Texto oficial da BNCC Computação</span><p><b>(${c})</b> ${esc(h.texto)}</p><div class="fonte">${esc(h.fonte)}</div></div>
      <dl class="ficha"><dt>Eixo</dt><dd>${esc(h.eixo)}</dd><dt>Objeto de conhecimento</dt><dd>${esc(h.objeto_conhecimento)}</dd></dl>
      <div class="cartao" style="margin:8px 0"><b class="co-status ${ok ? 'sim' : 'nao'}">${ok ? '✓ Trabalhada por meio de Língua Portuguesa' : 'Ainda sem habilidade vinculada marcada'}</b></div>
      <div class="explica"><p class="rotulo">Texto oficial</p><h3 style="margin-top:4px">Explicação da habilidade</h3><p>${esc(h.explicacao)}</p><p><b>Exemplos</b></p><p>${esc(h.exemplos)}</p></div>
      <h3>Habilidades de Língua Portuguesa vinculadas <span class="selo selo-sugestao">Sugestão</span></h3>
      ${vs.map((v) => `<div class="vinculo" style="border-left-color:var(--salvia)"><button data-abrir="${v.lp}" style="color:var(--salvia-escuro)">${v.lp}${lpTrabalhada(v.lp) ? ' ✓' : ''} →</button>
        <p style="margin:6px 0 4px">${esc(LP[v.lp].texto)}</p><p class="fonte" style="margin:0"><b>Por que se relacionam:</b> ${esc(v.justificativa)}</p></div>`).join('')}
      ${blocoMateriais(c)}`;
  }

  function blocoMateriais(c) {
    const ms = MAT[c] || [];
    if (!ms.length) return '';
    return '<h3>Materiais do Sistema Isidoro</h3>' + ms.map((m) => `
      <a class="material" href="${esc(m.pagina)}" target="_blank" rel="noopener">
        ${m.acesso === 'pago' ? '<span class="selo selo-pago">Material pago</span>' : '<span class="selo selo-gratis">Gratuito</span>'}
        <span>${esc(m.titulo)}</span>
      </a>`).join('');
  }

  // ---------- navegação ----------
  function render() {
    const partes = location.hash.replace(/^#\/?/, '').split('/');
    let aba = partes[0] || 'bimestres';
    if (aba === 'h') {
      const c = partes[1];
      if (LP[c] || CO[c]) { if ($('#painel').hidden) { renderAba(ultimaAba); abrir(c); } return; }
      aba = 'bimestres';
    }
    if (!$('#painel').hidden) { $('#painel').hidden = true; document.body.style.overflow = ''; }
    renderAba(aba, partes[1]);
  }
  let ultimaAba = 'bimestres';
  function renderAba(aba, arg) {
    const telas = { bimestres: () => telaBimestres(arg), trilha: telaTrilha, computacao: telaComputacao, buscar: telaBuscar, sobre: telaSobre };
    if (!telas[aba]) aba = 'bimestres';
    if (aba !== ultimaAba) window.scrollTo(0, 0);
    ultimaAba = aba;
    telas[aba]();
    document.querySelectorAll('.abas a').forEach((a) => { if (a.dataset.aba === aba) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  }
  function atualizarTudo() {
    const y = window.scrollY;
    renderAba(ultimaAba, ultimaAba === 'bimestres' ? ultimoBimestre() : undefined);
    window.scrollTo(0, y);
    if (!$('#painel').hidden) {
      const c = $('#painel-titulo').textContent; const corpo = $('#painel-corpo'); const st = corpo.scrollTop;
      corpo.innerHTML = CO[c] ? detalheCO(c) : detalheLP(c); corpo.scrollTop = st;
    }
  }

  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-marcar],[data-nivel],[data-abrir],[data-fechar],[data-filtro],[data-acao]');
    if (!t) return;
    if (t.dataset.marcar) { alternarMarcada(t.dataset.marcar); avisar(marcada(t.dataset.marcar) ? t.dataset.marcar + ' marcada como trabalhada' : 'Marcação desfeita'); atualizarTudo(); }
    else if (t.dataset.nivel) { definirNivel(t.dataset.cod, t.dataset.nivel); const n = nivel(t.dataset.cod); avisar(n ? t.dataset.cod + ': ' + NIVEIS.find((x) => x.id === n).rotulo : 'Nível desfeito'); atualizarTudo(); }
    else if (t.dataset.abrir) { const corpoAberto = !$('#painel').hidden; if (corpoAberto) { $('#painel-titulo').textContent = t.dataset.abrir; $('#painel-corpo').innerHTML = CO[t.dataset.abrir] ? detalheCO(t.dataset.abrir) : detalheLP(t.dataset.abrir); $('#painel-corpo').scrollTop = 0; history.replaceState({ painel: t.dataset.abrir }, '', '#/h/' + t.dataset.abrir); } else abrir(t.dataset.abrir); }
    else if (t.hasAttribute('data-fechar')) fechar(false);
    else if (t.dataset.filtro) { busca.filtro = t.dataset.filtro; telaBuscar(); }
    else if (t.dataset.acao === 'exportar') exportar();
    else if (t.dataset.acao === 'apagar') { if (confirm('Apagar todas as marcações deste aparelho? Esta ação não pode ser desfeita.')) { estado = { marcadas: {}, trilha: {}, atualizado: null }; salvar(); avisar('Marcações apagadas'); telaSobre(); } }
    else if (t.dataset.acao === 'instalar' && eventoInstalar) { eventoInstalar.prompt(); eventoInstalar = null; }
  });
  document.addEventListener('change', (ev) => { if (ev.target.dataset.acao === 'importar') importar(ev.target.files[0]); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') fechar(false); });
  window.addEventListener('hashchange', () => render());
  window.addEventListener('popstate', () => { if (!location.hash.startsWith('#/h/') && !$('#painel').hidden) fechar(true); });

  function exportar() {
    const blob = new Blob([JSON.stringify({ app: 'I-BNCC', versao: 1, conjunto: 'lp-1ano', ...estado }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'i-bncc-marcacoes-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    avisar('Cópia salva em arquivo');
  }
  function importar(arq) {
    if (!arq) return;
    arq.text().then((t) => {
      const d = JSON.parse(t);
      if (d.app !== 'I-BNCC' || !d.marcadas) throw new Error();
      estado = { marcadas: d.marcadas || {}, trilha: d.trilha || {}, atualizado: null }; salvar();
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
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  if (location.hash.startsWith('#/h/')) { const c = location.hash.slice(4); history.replaceState(null, '', '#/bimestres'); render(); if (LP[c] || CO[c]) abrir(c); }
  else render();
})();
