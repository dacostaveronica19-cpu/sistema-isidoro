/* I-BNCC · gera arquivos do Word (.docx) no próprio aparelho, sem bibliotecas externas.
   Carregado só quando o professor pede um documento em Word. */
(function () {
  'use strict';
  const enc = new TextEncoder();
  const x = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

  // ---------- pacote zip (sem compressão) ----------
  const TAB = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = TAB[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function zip(arquivos) {
    const partes = [], central = []; let pos = 0;
    const d = new Date();
    const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const data = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    arquivos.forEach(([nome, texto]) => {
      const n = enc.encode(nome), b = enc.encode(texto), c = crc32(b);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, hora, true); h.setUint16(12, data, true); h.setUint32(14, c, true); h.setUint32(18, b.length, true); h.setUint32(22, b.length, true);
      h.setUint16(26, n.length, true); h.setUint16(28, 0, true);
      partes.push(new Uint8Array(h.buffer), n, b);
      const ce = new DataView(new ArrayBuffer(46));
      ce.setUint32(0, 0x02014b50, true); ce.setUint16(4, 20, true); ce.setUint16(6, 20, true); ce.setUint16(8, 0x0800, true); ce.setUint16(10, 0, true);
      ce.setUint16(12, hora, true); ce.setUint16(14, data, true); ce.setUint32(16, c, true); ce.setUint32(20, b.length, true); ce.setUint32(24, b.length, true);
      ce.setUint16(28, n.length, true); ce.setUint32(42, pos, true);
      central.push(new Uint8Array(ce.buffer), n);
      pos += 30 + n.length + b.length;
    });
    const tam = central.reduce((s, p) => s + p.length, 0);
    const fim = new DataView(new ArrayBuffer(22));
    fim.setUint32(0, 0x06054b50, true); fim.setUint16(8, arquivos.length, true); fim.setUint16(10, arquivos.length, true);
    fim.setUint32(12, tam, true); fim.setUint32(16, pos, true);
    return new Blob([...partes, ...central, new Uint8Array(fim.buffer)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  // ---------- conteúdo ----------
  const VERDE = '3F5B50';
  function run(t, o = {}) {
    const rp = (o.b ? '<w:b/>' : '') + (o.i ? '<w:i/>' : '') + (o.cor ? `<w:color w:val="${o.cor}"/>` : '') + (o.tam ? `<w:sz w:val="${o.tam}"/><w:szCs w:val="${o.tam}"/>` : '') + (o.fonte ? `<w:rFonts w:ascii="${o.fonte}" w:hAnsi="${o.fonte}"/>` : '');
    return String(t).split('\n').map((linha, k) => (k ? '<w:r><w:br/></w:r>' : '') + `<w:r>${rp ? `<w:rPr>${rp}</w:rPr>` : ''}<w:t xml:space="preserve">${x(linha)}</w:t></w:r>`).join('');
  }
  function par(conteudo, o = {}) {
    const pp = (o.antes != null || o.depois != null ? `<w:spacing w:before="${o.antes || 0}" w:after="${o.depois == null ? 120 : o.depois}"/>` : '') + (o.recuo ? `<w:ind w:left="${o.recuo}" w:hanging="${o.pendente || 0}"/>` : '') + (o.junto ? '<w:keepNext/>' : '');
    return `<w:p>${pp ? `<w:pPr>${pp}</w:pPr>` : ''}${conteudo}</w:p>`;
  }
  const LARG = 9638; // largura útil da página A4 com margens de 2 cm (em vigésimos de ponto)
  function tabela(linhas, cab, pesos) {
    const nc = (cab || linhas[0] || ['']).length;
    const p = pesos || Array(nc).fill(1); const soma = p.reduce((a, b) => a + b, 0);
    const larg = p.map((v) => Math.round((LARG * v) / soma));
    const borda = (l) => `<w:${l} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`;
    const cel = (t, i, topo) => `<w:tc><w:tcPr><w:tcW w:w="${larg[i]}" w:type="dxa"/>${topo ? '<w:shd w:val="clear" w:color="auto" w:fill="E8EFEC"/>' : ''}</w:tcPr>${
      String(t == null ? '' : t).split('\n\n').map((bl) => par(run(bl, topo ? { b: true, cor: VERDE } : (i === 0 && !cab ? { b: true } : {})), { antes: 40, depois: 40 })).join('')}</w:tc>`;
    const tr = (l, topo) => `<w:tr>${topo ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${l.map((t, i) => cel(t, i, topo)).join('')}</w:tr>`;
    return `<w:tbl><w:tblPr><w:tblW w:w="${LARG}" w:type="dxa"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(borda).join('')}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>`
      + `<w:tblGrid>${larg.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${cab ? tr(cab, true) : ''}${linhas.map((l) => tr(l, false)).join('')}</w:tbl>` + par('', { antes: 0, depois: 60 });
  }
  function corpo(blocos) {
    return blocos.map((b) => {
      switch (b.t) {
        case 'titulo': return par(run(b.x, { b: true, tam: 32, cor: VERDE, fonte: 'Georgia' }), { antes: 0, depois: 60 });
        case 'sub': return par(run(b.x, { cor: '6B6A66', tam: 20 }), { antes: 0, depois: 200 });
        case 'h2': return par(run(b.x, { b: true, tam: 26, cor: VERDE, fonte: 'Georgia' }), { antes: 240, depois: 100, junto: true });
        case 'h3': return par(run(b.x, { b: true, tam: 22 }), { antes: 160, depois: 80, junto: true });
        case 'p': return par(run(b.x, b.b ? { b: true } : {}));
        case 'nota': return par(run(b.x, { i: true, tam: 18, cor: '6B6A66' }), { antes: 120, depois: 60 });
        case 'lista': return b.itens.map((t) => par(run('•\t' + t), { recuo: 360, pendente: 360, antes: 0, depois: 60 })).join('');
        case 'kv': return tabela(b.pares, null, [1, 3]);
        case 'tabela': return tabela(b.linhas, b.cab, b.pesos);
        default: return '';
      }
    }).join('');
  }

  window.IBNCC_DOCX = function (blocos) {
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${corpo(blocos)}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
    const estilos = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="pt-BR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;
    return zip([
      ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
      ['word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
      ['word/document.xml', doc],
      ['word/styles.xml', estilos],
    ]);
  };
})();
