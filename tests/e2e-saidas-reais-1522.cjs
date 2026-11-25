/* v15.2.2 · NAVEGADOR REAL + SERVIDOR REAL (Netlify Functions emuladas + Postgres) com os DOIS ARQUIVOS REAIS: 01-JANEIRO.26.xlsx (ERP Legado) e CTGP_Sállamos.xlsx (ERP Sállamos).
   O recurso gestao_v152 fica DESLIGADO (cenário A: as demais versões ligadas; cenário B: também sem gestao_v151/v1417/v1419 — a Produção "parada" numa versão antiga). O botão Importar de
   FCX › Saídas tem de ler os dois arquivos assim mesmo, gravar no Postgres, sobreviver ao F5, bloquear a sobreposição entre ERPs e fechar a DFC de jan/2026 ao centavo com o OFX.
   Os arquivos reais NÃO acompanham o pacote (folha e fornecedores): informe a pasta em ARQUIVOS_REAIS. Sem ela o teste se declara pulado. Não há OFX real: o extrato de jan/2026 é SINTÉTICO,
   montado com os títulos reais gravados no banco (um lote CNAB por banco e dia).
   Uso (banco novo + servidor local na porta 8890):
     export NETLIFY_DB_URL=postgres://postgres@127.0.0.1:54329/painel_teste; bash tests/preparar-banco.sh
     node tests/servidor-local.mjs 8890 &
     ARQUIVOS_REAIS=/pasta/dos/xlsx NODE_PATH=<node_modules do projeto> XLSX_PATH=<pasta do pacote xlsx> node tests/e2e-saidas-reais-1522.cjs
   Variáveis opcionais: URL_PAINEL (padrão http://localhost:8890/). O Master do banco de teste entra com a senha provisória e define a nova senha no primeiro acesso. */
const resolvePw = () => { try { return require('playwright'); } catch { return require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright'); } };
const { chromium } = resolvePw();
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { execFileSync } = require('child_process');
const OK = [], FAIL = []; const chk = (n, c, x = '') => { (c ? OK : FAIL).push(n); console.log((c ? 'ok   ' : 'FALHA ') + n + (x && !c ? ' → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 1800) : '')); };
const DIR = process.env.ARQUIVOS_REAIS || path.join(__dirname, 'arquivos-reais');
const achar = re => { try { return fs.readdirSync(DIR).find(n => re.test(n) && /\.xlsx?$/i.test(n)) || null; } catch { return null; } };
const fLeg = achar(/JANEIRO/i), fSal = achar(/CTGP|S[aá]llamos/i);
if (!fLeg || !fSal) { console.log('pulou e2e com os arquivos reais (defina ARQUIVOS_REAIS=<pasta com 01-JANEIRO.26.xlsx e CTGP_Sállamos.xlsx>)'); process.exit(0); }
const XLSX = require(process.env.XLSX_PATH || 'xlsx');
const U = process.env.URL_PAINEL || 'http://localhost:8890/', TEMP = 'Temp2026Ab', NOVA = 'NovaSenha9X';
const D = path.join(require('os').tmpdir(), 'e2e1522-' + process.pid) + '/'; fs.mkdirSync(D, { recursive: true });
const psql = sql => execFileSync('psql', [process.env.NETLIFY_DB_URL, '-At', '-c', sql], { maxBuffer: 256 * 1024 * 1024 }).toString().trim();
const c100 = x => Math.round((Number(x) + Number.EPSILON) * 100), md5 = t => crypto.createHash('md5').update(t).digest('hex');

/* arquivo do Sállamos com 30 pagamentos redatados para jan/2026 (mês que já tem o Legado) */
{ const wb = XLSX.read(fs.readFileSync(path.join(DIR, fSal)), { cellDates: true }), ws = wb.Sheets[wb.SheetNames[0]], rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true }), H = rows[0].map(x => String(x ?? '').trim());
  const iS = H.indexOf('Status'), iV = H.indexOf('Valor Pago'), iD = H.indexOf('Data de Pagamento'); let k = 0;
  for (let i = 1; i < rows.length && k < 30; i++) if (String(rows[i][iS]) === 'Pago' && rows[i][iV] > 0) { rows[i][iD] = String(rows[i][iD]).includes('/') ? '15/01/2026' : '2026-01-15'; k++; }
  const nb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(nb, XLSX.utils.aoa_to_sheet(rows), wb.SheetNames[0]); fs.writeFileSync(D + 'CTGP_Sallamos_com_janeiro.xlsx', XLSX.write(nb, { bookType: 'xlsx', type: 'buffer' })); }

/** lê esp2:saidas direto do Postgres (JSON puro ou z1:+gzip) e devolve { meta, lista, compactado } */
const baixaBanco = () => {
  const meta = JSON.parse(psql(`SELECT dados::text FROM documentos WHERE colecao='fcx' AND doc_id='esp2:saidas'`) || 'null'); if (!meta) return { meta: null, lista: [] };
  let tx = ''; for (let i = 0; i < meta.partes; i++) tx += JSON.parse(psql(`SELECT dados::text FROM documentos WHERE colecao='fcx' AND doc_id='esp2:saidas~${i}'`)).v;
  const comp = tx.startsWith('z1:'), valor = comp ? require('zlib').gunzipSync(Buffer.from(tx.slice(3), 'base64')).toString('utf8') : tx;
  return { meta, lista: JSON.parse(valor), compactado: comp, bytes: tx.length };
};
const centsDe = l => l.reduce((s, x) => s + c100(x.valor), 0);
const hashDe = l => md5(JSON.stringify(l));

(async () => {
  const b = await chromium.launch(), errs = [];
  const aba = async () => { const c = await b.newContext({ viewport: { width: 1440, height: 950 } }), p = await c.newPage(); await p.route(/fonts\.g|awesomeapi|open-meteo|servicodados\.ibge/, r => r.abort()); await p.route(/cdnjs/, r => { const u = r.request().url(); if (/xlsx\.full/.test(u)) return r.fulfill({ path: path.join(path.dirname(require.resolve((process.env.XLSX_PATH || 'xlsx') + '/package.json')), 'dist/xlsx.full.min.js'), contentType: 'application/javascript' }); return r.abort(); });
    p.on('pageerror', e => { if (!/Falha ao carregar https:\/\/cdnjs/.test(e.message)) errs.push('PE ' + e.message); }); p.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|ERR_TUNNEL|Failed to load|net::|404|401|403|409/.test(m.text())) errs.push(m.text()); });
    p.on('dialog', d => d.dismiss().catch(() => { }));
    await p.goto(U); await p.evaluate(() => { window.__esp = ms => new Promise(r => setTimeout(r, ms)); window.__ate = async (f, ms = 20000) => { for (let t = 0; t < ms; t += 50) { try { if (await f()) return true; } catch { } await __esp(50); } return false; }; }); return p; };
  const enviar = async (p, campos) => { await p.evaluate(() => __ate(() => document.querySelector('.login-form'))); for (const [k, v] of Object.entries(campos)) await p.fill(`.login-form [name="${k}"]`, v); await p.press(`.login-form [name="${Object.keys(campos).pop()}"]`, 'Enter'); await p.waitForTimeout(900); };
  const ev = (p, f, a) => p.evaluate(f, a);
  const ponta = p => p.evaluate(() => { window.__esp = ms => new Promise(r => setTimeout(r, ms)); window.__ate = async (f, ms = 20000) => { for (let t = 0; t < ms; t += 50) { try { if (await f()) return true; } catch { } await __esp(50); } return false; }; });
  const recarregar = async p => { await p.reload(); await ponta(p); await p.evaluate(() => __ate(() => Sessao.ativa && Repo.prontas.has('config') && Repo.prontas.has('extratos'), 30000)); await p.evaluate(() => __esp(700)); };
  const esp = (p, ms = 150) => p.waitForTimeout(ms);
  /** cenário de recursos: todos ligados, exceto os listados */
  const recursos = (p, desligados) => p.evaluate(async off => { const d = (await Cloud.adapter.get('config/recursos')) || {}, { id, ...x } = d; Object.keys(Recursos.LISTA).forEach(k => { x[k] = { ...Recursos.LISTA[k], ativo: !off.includes(k), desde: new Date().toISOString() }; }); await Cloud.adapter.set('config/recursos', x); await __ate(() => Recursos.ativo('gestao_v152') === !off.includes('gestao_v152')); }, desligados);
  const abrirSaidas = async p => { await ev(p, () => { App.ir('fcx'); FCX.ui.aba = 'fcx'; App.render(); }); await p.waitForSelector('#fcxFrame', { timeout: 30000 }); const fr = await (await p.$('#fcxFrame')).contentFrame();
    await fr.waitForFunction(() => typeof goto === 'function' && typeof state !== 'undefined' && state.saidas !== undefined, null, { timeout: 60000 }); await fr.evaluate(() => goto('manage', 'saidas')); await esp(p, 700); return fr; };

  const M = await aba(); await enviar(M, { cpf: '529.982.247-25', senha: TEMP }); await enviar(M, { nova: NOVA, conf: NOVA }); await M.evaluate(() => __ate(() => Sessao.ativa && Repo.prontas.has('config')));
  const REL = {};

  for (const [cen, off] of [['A · Produção com a gestao_v152 desligada (demais versões ligadas)', ['gestao_v152']], ['B · Produção parada numa versão antiga (sem gestao_v152, v151, v1419 e v1417)', ['gestao_v152', 'gestao_v151', 'gestao_v1419', 'gestao_v1417']]]) {
    const L = cen[0]; console.log('\n— cenário ' + cen + ' —');
    psql(`DELETE FROM documentos WHERE colecao='fcx' AND doc_id LIKE 'esp2:saidas%'`);
    await recursos(M, off); await recarregar(M);
    chk(`${L}.0 flags: gestao_v152 desligada (g152 falso) ${L === 'B' ? 'e gestao_v1417 desligada (g17 falso)' : ''}; selo do cabeçalho mostra o código instalado "v15.2.2"`, await ev(M, o => g152() === false && (o !== 'B' || (g17() === false)) && /v15\.2\.2/.test(document.querySelector('.ver-badge')?.innerText || ''), L), await ev(M, () => document.querySelector('.ver-badge')?.innerText));
    const fr = await abrirSaidas(M), N0 = await fr.evaluate(() => state.saidas.length);
    chk(`${L}.1 dentro do iframe do FCX: fcxV152() falso (sem flag) e mesmo assim o leitor unificado está ativo (fcxLeitor1522 verdadeiro), com o aviso "Fonte única de pagamentos" e o modo Inteligente por mês`, await fr.evaluate(() => fcxV152() === false && fcxLeitor1522() === true && !!document.querySelector('#saidasFonteUnica152') && /Inteligente por mês/.test(document.body.innerText)));
    const importa = async arq => { await fr.setInputFiles('input[type=file][onchange*="importSaidasFile"]', arq); };
    const ate = (n, ms = 240000) => fr.waitForFunction(n => state._saidasGravacao && state._saidasGravacao.ok === true && state._saidasGravacao.n === n, n, { timeout: ms });
    const textoTela = () => fr.evaluate(() => document.body.innerText.replace(/ /g, ' '));

    /* ---- ERP Legado real ---- */
    let t0 = Date.now(); await importa(path.join(DIR, fLeg)); await ate(N0 + 2874); const msL = Date.now() - t0;
    const b1 = baixaBanco(), leg = b1.lista.filter(x => x.origemModelo === 'erp_legado'), tl = await textoTela();
    REL[L] = { legadoNoBanco: leg.length, ms: msL };
    chk(`${L}.2 ${fLeg} (ERP Legado real): ${leg.length} títulos gravados no Postgres (esperado 2.874), soma R$ ${(centsDe(leg) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (esperado 45.265.088,80), em ${msL} ms`, leg.length === 2874 && centsDe(leg) === 4526508880 && b1.lista.length === N0 + 2874, [leg.length, centsDe(leg), N0, b1.lista.length]);
    chk(`${L}.3 …nenhuma mensagem "Nenhuma linha reconhecida" na tela; a faixa de gravação conferida confirma ${N0 + 2874} registros; 24 crediário marcados; 32 estornos fora; só 2026-01`, !/Nenhuma linha reconhecida|Data, Conta, Valor/.test(tl) && new RegExp(`${N0 + 2874} registro`).test(tl) && leg.filter(x => x.crediario).length === 24 && leg.every(x => /^2026-01-/.test(x.date) && x.tipo === 'pago'), tl.slice(0, 300));
    chk(`${L}.4 …sem a flag o banco guarda JSON puro (sem z1:/gzip), como na v15.1: ${(b1.bytes / 1024).toFixed(0)} KB em ${b1.meta.partes} fatias`, b1.compactado === false && b1.meta.z === undefined, b1.meta);
    const jan0 = hashDe(leg);

    /* ---- ERP Sállamos real ---- */
    t0 = Date.now(); await importa(path.join(DIR, fSal)); await ate(N0 + 18615); const msS = Date.now() - t0;
    const b2 = baixaBanco(), sal = b2.lista.filter(x => x.origemModelo === 'erp_sallamos'), leg2 = b2.lista.filter(x => x.origemModelo === 'erp_legado'), t2 = await textoTela();
    const meses = sal.reduce((m, x) => { const k = String(x.date).slice(0, 7); m[k] = (m[k] || 0) + 1; return m; }, {}); REL[L].sallamosNoBanco = sal.length; REL[L].msSallamos = msS; REL[L].meses = meses;
    chk(`${L}.5 ${fSal} (ERP Sállamos real): ${sal.length} títulos pagos gravados (esperado 15.741 = 15.746 "Pago" − 5 de valor zero), soma R$ ${(centsDe(sal) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (esperado 185.520.875,09), mai–nov/2026, em ${msS} ms`, sal.length === 15741 && centsDe(sal) === 18552087509 && Object.keys(meses).sort().join() === '2026-05,2026-06,2026-07,2026-08,2026-09,2026-10,2026-11' && b2.lista.length === N0 + 18615, [sal.length, centsDe(sal), meses]);
    chk(`${L}.6 …os 2.874 títulos de jan/2026 do Legado seguem IDÊNTICOS no Postgres (hash do conteúdo antes = depois); sem "Nenhuma linha reconhecida" e sem quadro de conflito`, leg2.length === 2874 && hashDe(leg2) === jan0 && !/Nenhuma linha reconhecida|Data, Conta, Valor/.test(t2) && !(await fr.evaluate(() => !!document.querySelector('#saidasPendente152'))), [leg2.length]);
    chk(`${L}.7 …só Status "Pago" com Valor Pago > 0: nenhum Vencido/Renegociado/Previsto/Cancelado/Vinculado e nenhum valor zero entre os 15.741`, sal.every(x => x.tipo === 'pago' && x.valor > 0));

    /* ---- reimportar o mesmo arquivo: sem duplicar ---- */
    await fr.evaluate(() => { state._saidasGravacao = null; }); await importa(path.join(DIR, fSal)); await fr.waitForFunction(() => state._saidasGravacao && state._saidasGravacao.ok === true, null, { timeout: 240000 }); await esp(M, 300);
    const b3 = baixaBanco(); chk(`${L}.8 reimportar o mesmo arquivo do Sállamos substitui sem duplicar: continuam ${N0 + 18615} registros e ids únicos`, b3.lista.length === N0 + 18615 && new Set(b3.lista.map(x => x.id)).size === b3.lista.length && hashDe(b3.lista.filter(x => x.origemModelo === 'erp_legado')) === jan0, [b3.lista.length]);

    /* ---- F5: as Saídas voltam do banco com tudo ---- */
    await recarregar(M); const fr2 = await abrirSaidas(M), nTela = await fr2.evaluate(() => state.saidas.length);
    chk(`${L}.9 depois do F5 o FCX relê as Saídas do Postgres: ${nTela} registros (${N0 + 18615} esperados), sem erro de leitura`, nTela === N0 + 18615 && await fr2.evaluate(() => !(state._erroLeitura && state._erroLeitura.size)), nTela);

    if (L === 'A') {
      /* ---- sobreposição entre ERPs, na tela ---- */
      const fr3 = fr2, imp3 = arq => fr3.setInputFiles('input[type=file][onchange*="importSaidasFile"]', arq), bAntes = baixaBanco();
      await imp3(D + 'CTGP_Sallamos_com_janeiro.xlsx'); await fr3.waitForSelector('#sobreposicao152', { timeout: 120000 });
      const tq = await fr3.evaluate(() => document.body.innerText.replace(/ /g, ' ')), bPend = baixaBanco();
      chk('A.10 Sállamos com 30 pagamentos em jan/2026: a tela mostra "Sobreposição entre ERPs bloqueada" (01/2026 já tem 2874 lançamento(s) do ERP Legado), oferece "Gravar só os meses sem conflito" e "Substituir ERP Legado em 01/2026…" e NADA foi gravado no banco', /Sobreposição entre ERPs bloqueada/.test(tq) && /01\/2026/.test(tq) && /2874 lançamento\(s\) do ERP Legado/.test(tq) && /Gravar só os meses sem conflito/.test(tq) && /Substituir ERP Legado/.test(tq) && hashDe(bPend.lista) === hashDe(bAntes.lista), tq.slice(0, 400));
      await fr3.evaluate(() => { const bt = [...document.querySelectorAll('#saidasPendente152 button')].find(x => /Substituir ERP Legado/.test(x.textContent)); bt.scrollIntoView({ block: 'center' }); bt.click(); }); await esp(M, 500);
      const ts = await fr3.evaluate(() => document.body.innerText.replace(/ /g, ' '));
      chk('A.11 "Substituir…" só prepara a troca: aviso vermelho "serão apagados" + botão "Confirmar substituição e gravar no banco", e o banco continua intacto', /Substituição entre ERPs/.test(ts) && /serão apagados/.test(ts) && /Confirmar substituição e gravar no banco/.test(ts) && hashDe(baixaBanco().lista) === hashDe(bAntes.lista), ts.slice(0, 300));
      await fr3.evaluate(() => { const bt = [...document.querySelectorAll('#saidasPendente152 button')].find(x => /Voltar: bloquear esses meses/.test(x.textContent)); bt.scrollIntoView({ block: 'center' }); bt.click(); }); await esp(M, 400);
      await fr3.evaluate(() => { state._saidasGravacao = null; const bt = [...document.querySelectorAll('#saidasPendente152 button')].find(x => /Gravar só os meses sem conflito/.test(x.textContent)); bt.scrollIntoView({ block: 'center' }); bt.click(); });
      await fr3.waitForFunction(() => state._saidasGravacao && state._saidasGravacao.ok === true, null, { timeout: 240000 }); await esp(M, 400);
      const b4 = baixaBanco(), l4 = b4.lista.filter(x => x.origemModelo === 'erp_legado'), s4 = b4.lista.filter(x => x.origemModelo === 'erp_sallamos');
      chk('A.12 "Gravar só os meses sem conflito": o Legado de jan/2026 continua com 2.874 títulos idênticos no Postgres, os 30 títulos de jan do Sállamos NÃO entraram e os demais meses foram regravados (15.711)', l4.length === 2874 && hashDe(l4) === jan0 && s4.length === 15711 && !s4.some(x => /^2026-01-/.test(x.date)), [l4.length, s4.length]);
      /* ---- DFC de jan/2026 (g17 ligada): OFX sintético com os títulos reais ---- */
      const mapaConta = { 'ESPOSENDE - SANTANDER': 'ct-esp', 'MAR ABERTO - SANTANDER': 'ct-mar' }, grupos = new Map();
      for (const s of l4) { if (s.crediario || !mapaConta[s.contaPagamento]) continue; const k = s.contaPagamento + '|' + s.dataPagamento, g = grupos.get(k) || { conta: s.contaPagamento, data: s.dataPagamento, c: 0 }; g.c += c100(s.valor); grupos.set(k, g); }
      const EXT = ['ct-esp', 'ct-mar'].map((cid, j) => { const trs = []; let i = 0; for (const g of grupos.values()) if (mapaConta[g.conta] === cid) trs.push({ id: cid + '-l' + (i++), data: g.data, valor: -g.c / 100, hist: 'PAGTO FORNECEDORES CNAB ' + g.data.slice(8) + g.data.slice(5, 7), isLoteCnab: true });
        trs.push({ id: cid + '-r0', data: '2026-01-05', valor: 1500000.55 + j, hist: 'RECEBIMENTO CARTOES' }, { id: cid + '-tf', data: '2026-01-07', valor: -123.45, hist: 'TARIFA BANCARIA' }); return { id: 'd-' + cid, contaId: cid, mes: '2026-01', banco: 'SANTANDER', arquivo: cid + '-jan.ofx', transacoes: trs }; });
      const nLotes = EXT.flatMap(d => d.transacoes).filter(t => t.isLoteCnab).length, SOMA_OFX = EXT.flatMap(d => d.transacoes).reduce((s, t) => s + c100(t.valor), 0);
      await ev(M, async ({ EXT }) => { for (const [id, ap, cc] of [['ct-esp', 'ESPOSENDE -SANTANDER', '1111'], ['ct-mar', 'MAR ABERTO - SANTANDER', '2222']]) await Repo.salvar('contasBancarias', id, { apelido: ap, banco: '033', bancoNome: 'Santander', agencia: '0001', conta: cc, ativa: true });
        for (const d of EXT) { const { id, ...r } = d; await Repo.salvar('extratos', id, r); } await __ate(() => Repo.get('extratos', 'd-esp') && Repo.get('extratos', 'd-mar'), 20000); }, { EXT });
      await recarregar(M);
      await ev(M, async () => { App.ir('fcx'); FCX.ui.aba = 'dfc'; FluxoDFC.ui.sub = 'dfc'; FluxoDFC.ui.mes = '2026-01'; FluxoDFC.ui.conta = ''; App.render(); await __ate(() => document.querySelector('[data-a="fd-sub"]')); await __ate(() => !FluxoDFC.prontoForn05 || FluxoDFC.prontoForn05(), 40000); await FluxoDFC.garantirCnab17(true); await __esp(500); App.render(); });
      const dfc = await ev(M, () => { const p = FluxoDFC.planoCnab17(), regras = DFC.regras(), jan = l => l.filter(t => String(t.data).startsWith('2026-01')), bruto = jan(FluxoDFC.transacoes()), dep = jan(FluxoDFC.transacoesDFC()), soma = l => l.reduce((s, t) => s + Math.round((t.valor + Number.EPSILON) * 100), 0), cat = c => Object.values(c.porCategoria).reduce((s, x) => s + Math.round((x.valor + Number.EPSILON) * 100), 0);
        const usados = p ? p.lotes.flatMap(l => l.alocs.map(a => a.x.s)) : []; return p ? { lotes: p.lotes.length, integ: p.integridade.ok, brutoN: bruto.length, depN: dep.length, somaBruto: soma(bruto), somaDep: soma(dep), catAntes: cat(DFC.consolidar(bruto, regras)), catDepois: cat(DFC.consolidar(dep, regras)), usados: usados.length, cred: usados.filter(s => s.crediario).length, realocado: p.resumo.valorRealocado } : null; });
      REL.dfc = { nLotes, ...dfc, somaOfxCentavos: SOMA_OFX };
      chk(`A.13 DFC jan/2026 (títulos reais gravados no Postgres + OFX sintético de ${nLotes} lotes CNAB): todos os lotes desdobrados, integridade OK, nenhum crediário usado`, !!dfc && dfc.lotes === nLotes && dfc.integ && dfc.usados > 2000 && dfc.cred === 0 && dfc.depN > dfc.brutoN, dfc);
      chk(`A.14 …PROVA AO CENTAVO: Σ(categorias da DFC após o desdobramento) = Σ(lançamentos do OFX) = ${SOMA_OFX} centavos`, !!dfc && dfc.somaBruto === SOMA_OFX && dfc.somaDep === SOMA_OFX && dfc.catAntes === SOMA_OFX && dfc.catDepois === SOMA_OFX, dfc);
    }
  }

  chk('9 nenhum erro de página nem de console durante o roteiro', errs.length === 0, errs.slice(0, 6));
  await b.close();
  console.log('\nRESUMO DO NAVEGADOR COM OS ARQUIVOS REAIS: ' + JSON.stringify(REL, null, 1));
  console.log(`\n${OK.length} ok · ${FAIL.length} falha(s)`);
  if (FAIL.length) { console.log('FALHAS:'); FAIL.forEach(f => console.log(' - ' + f)); process.exit(1); }
})().catch(e => { console.error('ERRO FATAL', e); process.exit(2); });
