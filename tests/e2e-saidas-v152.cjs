/* v15.2 · NAVEGADOR REAL + SERVIDOR REAL (Netlify Functions emuladas + Postgres): importação de baixas em FCX › Saídas (layout atual CSV e layout antigo XLSX com abas PGTO.* e AgendaPagto),
   gravação 100% no Postgres (compactada, com conferência), DFC de janeiro/2026 refletindo na hora, prova ao centavo Σ categorias = Σ OFX, botão e alertas removidos da DFC,
   modo inteligente sem duplicar, cache em IndexedDB (sem baixar de novo as Saídas), recurso desligado = v15.1. Dados 100% fictícios.
   Uso (banco novo + servidor local na porta 8890):
     export NETLIFY_DB_URL=postgres://usuario@127.0.0.1:5432/painel_teste; bash tests/preparar-banco.sh      # recria o banco de teste (com a semente fictícia)
     node tests/servidor-local.mjs 8890 &                                                                    # servidor local do painel
     NODE_PATH=<node_modules do projeto> XLSX_PATH=<pasta do pacote xlsx> node tests/e2e-saidas-v152.cjs     # Playwright + Chromium, psql e SheetJS (xlsx)
   Variáveis opcionais: URL_PAINEL (padrão http://localhost:8890/). O Master do banco de teste entra com a senha provisória e define a nova senha no primeiro acesso. */
const resolvePw = () => { try { return require('playwright'); } catch { return require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright'); } };
const { chromium } = resolvePw();
const fs = require('fs'), path = require('path'), zlib = require('zlib'), { execFileSync } = require('child_process');
const XLSX = require(process.env.XLSX_PATH || 'xlsx');
const OK = [], FAIL = []; const chk = (n, c, x = '') => { (c ? OK : FAIL).push(n); console.log((c ? 'ok   ' : 'FALHA ') + n + (x && !c ? ' → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 1800) : '')); };
const U = process.env.URL_PAINEL || 'http://localhost:8890/', TEMP = 'Temp2026Ab', NOVA = 'NovaSenha9X';
const D = path.join(require('os').tmpdir(), 'e2e152-' + process.pid) + '/'; fs.mkdirSync(D, { recursive: true });
const psql = sql => execFileSync('psql', [process.env.NETLIFY_DB_URL, '-At', '-c', sql]).toString().trim();

/* ---------- fixtures (as mesmas do teste unitário) ---------- */
const CAB_A = ['Status', 'Fornecedor', 'Valor Pago', 'Valor', 'Data de Pagamento', 'Vencimento', 'Conta Contábil', 'Centro de Custo', 'Conta Bancária', 'Banco de Pagamento', 'Forma de Pagamento', 'Descrição'];
const CT = { aluguel: '4.10.06 – (-) Aluguel de Loja de Rua', folha: '4.01.01 – (-) Salários e Ordenados', mkt: '4.33.15 – (-) Ações de Marketing', obras: '7.20.05 – (-) Obras (Expansão e Aquisições)', energia: '4.10.09 – (-) Energia Elétrica', contab: '4.38.05 – (-) Assessoria Contábil', material: '4.15.02 – (-) Material de Uso e Consumo' };
const A_ROWS_JAN = [
  ['Pago', 'IMOBILIARIA ALFA LTDA', 'R$5000.00', 'R$5000.00', '05/01/2026', '03/01/2026', CT.aluguel, 'LOJA 01', '', 'ESPOSENDE -SANTANDER', 'Boleto', 'Aluguel jan'],
  ['Pago', 'FOLHA DE PAGAMENTO', '3.000,50', '3.000,50', '05/01/2026', '03/01/2026', CT.folha, 'GESTÃO', 'ESPOSENDE -SANTANDER', 'ESPOSENDE -SANTANDER', 'TED', 'Salários jan'],
  ['Pago', 'AGENCIA ECO', 'R$1500.25', 'R$1500.25', '05/01/2026', '04/01/2026', CT.mkt, 'MARKETING', '', 'ESPOSENDE -SANTANDER', 'PIX', 'Mídia jan'],
  ['Pago', 'CONSTRUTORA DELTA', 'R$7000.00', 'R$7000.00', '06/01/2026', '05/01/2026', CT.obras, 'LOJA 09', '', 'ESPOSENDE -SANTANDER', 'TED', 'Obra loja nova'],
  ['Pago', 'IMOBILIARIA SIGMA', 'R$2500.00', 'R$2500.00', '06/01/2026', '05/01/2026', CT.aluguel, 'LOJA 05', 'MAR ABERTO - SANTANDER', 'MAR ABERTO - SANTANDER', 'Boleto', 'Aluguel mar aberto'],
  ['A Vencer', 'CONTABIL GAMA', 'R$800.00', 'R$800.00', '', '20/01/2026', CT.contab, 'GESTÃO', '', 'ESPOSENDE -SANTANDER', 'Boleto', 'Honorários'],
];
const A_ROW_FEV = ['Pago', 'PAPELARIA PI', 'R$120.00', 'R$120.00', '10/02/2026', '10/02/2026', CT.material, 'GESTÃO', '', 'ESPOSENDE -SANTANDER', 'Boleto', 'Material fev'];
const GAMA_PAGO = ['Pago', 'CONTABIL GAMA', 'R$800.00', 'R$800.00', '20/01/2026', '20/01/2026', CT.contab, 'GESTÃO', '', 'ESPOSENDE -SANTANDER', 'Boleto', 'Honorários'];
const ENERGIA_NOVA = ['Pago', 'ENERGIA S/A', 'R$900.00', 'R$900.00', '06/01/2026', '05/01/2026', CT.energia, 'LOJA 01', '', 'ESPOSENDE -SANTANDER', 'Boleto', 'Energia jan'];
const csvLinha = r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',');
const csv = rows => '﻿' + [CAB_A, ...rows].map(csvLinha).join('\r\n') + '\r\n';
const CAB_B = ['Item', 'Título', 'Fornecedor', 'Conta', 'Pagamento', 'Vlr Líquido', 'Forma Pagto', 'Instruções', 'Descrição do Título', 'Nome Loja'];
const dB = d => new Date(Date.UTC(2026, 0, d, 12, 0, 0));
const LINHAS_B = [
  [468, '1001', 'IMOBILIARIA ALFA LTDA', '070-ESPOSENDE -SANTANDER', dB(5), 5000, '2-TED', '', 'Aluguel loja de rua jan', 'LOJA 01 RUA'],
  [187, '1002', 'FOLHA DE PAGAMENTO', '070-ESPOSENDE -SANTANDER', dB(5), 3000.5, '2-TED', '', 'Salários jan', ''],
  [475, '1003', 'CONSTRUTORA DELTA', '070-ESPOSENDE -SANTANDER', dB(6), 7000, '2-TED', '', 'Obra loja nova', 'LOJA 09'],
  [217, '1004', 'AGENCIA ECO', '070-ESPOSENDE -SANTANDER', dB(5), 1500.25, '2-TED', '', 'Mídia jan', ''],
  [468, '1005', 'IMOBILIARIA OMEGA', '070-ESPOSENDE -SANTANDER', dB(7), 4000, '2-TED', 'Baixa Estornada em 08/01', 'Aluguel estornado', 'LOJA 02'],
  [210, '1006', 'ENERGIA S/A', 'CONCILIAÇÃO GETNET', dB(7), 900, '2-TED', '', 'Conciliação interna', 'LOJA 01 RUA'],
  [5, '1007', 'FORNECEDOR CAIXA', '001-CAIXA', dB(7), 450, '1-DINHEIRO', '', 'Pago em caixa', ''],
  [468, '1009', 'IMOBILIARIA SIGMA', '091-MAR ABERTO - SANTANDER', dB(5), 2500, '2-TED', '', 'Aluguel loja mar aberto', 'LOJA 05 SHOPPING'],
  [999, '1010', 'FORNECEDOR NOVO', '080-CAIXA ECONÔMICA FEDERAL', dB(9), 300, '2-TED', '', 'Item fora da tabela', ''],
];
const wbB = () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Esposende Calçados — Relação dos Títulos Pagos'], ['Período: janeiro/2026'], [], CAB_B, ...LINHAS_B], { cellDates: true }), 'PGTO.JANEIRO26');
  const CAB_BRUTA = ['', 'Item', 'Fornecedor', 'Conta', 'Pagamento', 'Vlr Líquido', 'Instruções', 'Forma Pagto', 'Descrição do Título', 'Nome Loja'];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Esposende Calçados — AgendaPagto'], ['Emitido em 02/02/2026'], [], [], [], CAB_BRUTA, ...LINHAS_B.map(l => ['', l[0], l[2], l[3], l[4], l[5], l[7], l[6], l[8], l[9]])], { cellDates: true }), 'AgendaPagto');
  return wb;
};
fs.writeFileSync(D + 'contas_a_pagar_dia1.csv', csv([...A_ROWS_JAN, A_ROW_FEV]));
fs.writeFileSync(D + 'contas_a_pagar_dia2.csv', csv([...A_ROWS_JAN.slice(0, 5), GAMA_PAGO, ENERGIA_NOVA]));
fs.writeFileSync(D + 'baixas_erp_antigo.xlsx', XLSX.write(wbB(), { bookType: 'xlsx', type: 'buffer', cellDates: true }));
/* ---------- v15.2.1 · fixtures dos layouts exatos: PGTO.JANEIRO26 (cabeçalho na linha 5, sem Fornecedor, Item "187-SALARIOS E ORDENADOS") e CTGP_Sállamos (mai–nov, vários Status) ---------- */
const serialXl = (y, m, d) => Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 864e5);
const PGTO_HDR = ['Gestão', 'Nome Loja', 'Item', 'Título', 'Pagamento', 'Vlr Líquido', 'Conta', 'Forma Pagto', 'Instruções', 'Descrição do Título'];
const Lg = (gestao, loja, item, tit, pag, vlr, conta, forma, instr, desc) => [gestao, loja, item, tit, pag, vlr, conta, forma, instr, desc];
const PGTO_ROWS = [
  Lg('ESPOSENDE', 'LOJA 01 RUA', '468-ALUGUEL LOJA DE RUA', '1001', serialXl(2026, 1, 5), 5000, '070-ESPOSENDE -SANTANDER', '2-TED', '', 'Aluguel loja de rua jan'),
  Lg('ESPOSENDE', '', '187-SALARIOS E ORDENADOS', '1002', dB(5), 3000.5, '070-ESPOSENDE -SANTANDER', '2-TED', '', 'Salários jan'),
  Lg('ESPOSENDE', 'LOJA 09', '475-OBRAS', '1003', '06/01/2026', 7000, '070-ESPOSENDE -SANTANDER', '2-TED', '', 'Obra loja nova'),
  Lg('ESPOSENDE', '', '217-PUBLICIDADE E PROPAGANDA', '1004', '05/01/2026', 1500.25, '070-ESPOSENDE -SANTANDER', '2-TED', '', 'Mídia jan'),
  Lg('ESPOSENDE', 'LOJA 02', '468-ALUGUEL LOJA DE RUA', '1005', dB(7), 4000, '070-ESPOSENDE -SANTANDER', '2-TED', 'baixa estornada em 08/01', 'Aluguel estornado'),
  Lg('ESPOSENDE', 'LOJA 01 RUA', '210-ENERGIA ELETRICA', '1006', dB(7), 900, '152-RECEITAS NÃO OPERACIONAIS', '2-TED', '', 'Conta interna sem banco'),
  Lg('ESPOSENDE', 'LOJA 01 RUA', '210-ENERGIA ELETRICA', '1006', dB(7), 910, 'CONCILIAÇÃO GETNET', '2-TED', '', 'Conciliação interna'),
  Lg('ESPOSENDE', '', '005-COMPRAS A PRAZO', '1007', dB(7), 450, '001-CAIXA', '1-DINHEIRO', '', 'Pago em caixa'),
  Lg('ESPOSENDE', '', '005-COMPRAS A PRAZO', '1008', dB(8), 320, '070-ESPOSENDE -SANTANDER', '4-CR CREDIARIO', '', 'Crediário'),
  Lg('MAR ABERTO', 'LOJA 05 SHOPPING', '468-ALUGUEL LOJA DE RUA', '1009', dB(5), 2500, '091-MAR ABERTO - SANTANDER', '2-TED', '', 'Aluguel loja mar aberto'),
  Lg('ESPOSENDE', '', '999-ITEM NOVO', '1010', dB(9), 300, '080-CAIXA ECONÔMICA FEDERAL', '2-TED', '', 'Item fora da tabela'),
  Lg('ESPOSENDE', '', '012-TRANSFERENCIAS', '1011', dB(5), 600, '070-ESPOSENDE -SANTANDER', '2-TED', '', 'Transferência'),
];
const PGTO_SHEET = () => [['ESPOSENDE CALÇADOS LTDA'], ['Relação dos Títulos Pagos'], ['Período: 01/01/2026 a 31/01/2026'], [], PGTO_HDR, ...PGTO_ROWS.slice(0, 5), [], PGTO_HDR, ...PGTO_ROWS.slice(5, 9),
  ['', '', 'Total do dia 05/01/2026', '', null, 12345.67, '', '', '', ''], ...PGTO_ROWS.slice(9), ['', '', 'Total Geral:', '', null, 99999.99, '', '', '', '']];
const SALL_HDR = ['Código', 'Status', 'Favorecido', 'Valor', 'Valor Pago', 'Data de Vencimento', 'Data de Pagamento', 'Conta Contábil', 'Centro de Custo', 'Conta Bancária', 'Banco de Pagamento'];
const SC = { adiant: '4.01.04 – (-) Adiantamento Salarial', prazo: '2.02 – (-) Compras a Prazo' };
const sallMes = mm => { const d = dia => `${String(dia).padStart(2, '0')}/${String(mm).padStart(2, '0')}/2026`, c = n => `S${mm}${n}`;
  return [[c(1), 'Pago', 'ADIANTAMENTO FOLHA', 1000 + mm, 'R$' + (1000 + mm).toFixed(2), d(3), d(5), SC.adiant, 'GESTÃO', 'ESPOSENDE -SANTANDER', ''], [c(2), 'Pago', 'FORNECEDOR PRAZO LTDA', 2000 + mm, 2000 + mm + 0.5, d(8), d(10), SC.prazo, 'LOJA 01', '', '091-MAR ABERTO - SANTANDER'],
    [c(3), 'Vencido', 'FORN VENCIDO', 300, 0, d(2), '', SC.prazo, 'GESTÃO', '', ''], [c(4), 'Renegociado', 'FORN RENEGOCIADO', 400, 0, d(2), '', SC.prazo, 'GESTÃO', '', ''], [c(5), 'Previsto', 'FORN PREVISTO', 500, 0, d(28), '', SC.prazo, 'GESTÃO', '', ''],
    [c(6), 'Cancelado', 'FORN CANCELADO', 600, 600, d(2), d(4), SC.prazo, 'GESTÃO', 'ESPOSENDE -SANTANDER', ''], [c(7), 'Vinculado', 'FORN VINCULADO', 700, 700, d(2), d(4), SC.prazo, 'GESTÃO', 'ESPOSENDE -SANTANDER', '']]; };
const SALL_ROWS = (meses, extra = []) => [['CTGP Sállamos — Contas a Pagar'], ['Exportado em 10/11/2026'], SALL_HDR, ...meses.flatMap(sallMes), ...extra];
const SALL_JAN = ['SJ1', 'Pago', 'LANÇAMENTO NO MÊS DO LEGADO', 100, 100, '10/01/2026', '15/01/2026', SC.prazo, 'GESTÃO', 'ESPOSENDE -SANTANDER', ''];
const xlsxDe = sheets => { const wb = XLSX.utils.book_new(); for (const [nome, rows] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows, { cellDates: true }), nome); return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer', cellDates: true }); };
const CAB_BRUTA2 = ['', 'Item', 'Fornecedor', 'Conta', 'Pagamento', 'Vlr Líquido', 'Instruções', 'Forma Pagto', 'Descrição do Título', 'Nome Loja'];
fs.writeFileSync(D + '01-JANEIRO.26.xlsx', xlsxDe([['AgendaPagto', [['Esposende Calçados — AgendaPagto'], ['Emitido em 02/02/2026'], [], [], [], CAB_BRUTA2, ...LINHAS_B.map(l => ['', l[0], l[2], l[3], l[4], l[5], l[7], l[6], l[8], l[9]])]], ['PGTO.JANEIRO26', PGTO_SHEET()]]));
fs.writeFileSync(D + 'CTGP_Sallamos.xlsx', xlsxDe([['CTGP', SALL_ROWS([5, 6, 7, 8, 9, 10, 11])]]));
fs.writeFileSync(D + 'CTGP_Sallamos_com_janeiro.xlsx', xlsxDe([['CTGP', SALL_ROWS([6, 7], [SALL_JAN])]]));
const EXT_JAN = [
  { id: 'd-esp', contaId: 'ct-esp', mes: '2026-01', banco: 'SANTANDER', arquivo: 'esp-jan.ofx', transacoes: [{ id: 't0', data: '2026-01-02', valor: 120000, hist: 'RECEBIMENTO CARTOES' }, { id: 't1', data: '2026-01-06', valor: -16500.75, hist: 'PAGTO FORNECEDORES CNAB 0601', isLoteCnab: true },
    { id: 't2', data: '2026-01-07', valor: -100, hist: 'TARIFA BANCARIA' }, { id: 't5', data: '2026-01-12', valor: -2500.4, hist: 'PAGAMENTO ENERGIA' }, { id: 't6', data: '2026-01-20', valor: 310.05, hist: 'RENDIMENTO APLICACAO' }] },
  { id: 'd-mar', contaId: 'ct-mar', mes: '2026-01', banco: 'SANTANDER', arquivo: 'mar-jan.ofx', transacoes: [{ id: 't3', data: '2026-01-06', valor: -2500, hist: 'REMESSA PAGTO', isLoteCnab: true }, { id: 't7', data: '2026-01-15', valor: 8000, hist: 'DEPOSITO CLIENTE' }] },
];
const SOMA_OFX = EXT_JAN.flatMap(d => d.transacoes).reduce((s, t) => s + Math.round(t.valor * 100), 0);

(async () => {
  const b = await chromium.launch(), errs = [], reqs = [];
  const aba = async () => { const c = await b.newContext({ viewport: { width: 1440, height: 950 } }), p = await c.newPage(); await p.route(/fonts\.g|awesomeapi|open-meteo|servicodados\.ibge/, r => r.abort()); await p.route(/cdnjs/, r => { const u = r.request().url(); if (/xlsx\.full/.test(u)) return r.fulfill({ path: path.join(path.dirname(require.resolve((process.env.XLSX_PATH || 'xlsx') + '/package.json')), 'dist/xlsx.full.min.js'), contentType: 'application/javascript' }); if (/Chart\.js/.test(u)) { try { return r.fulfill({ path: require.resolve('chart.js/dist/chart.umd.js'), contentType: 'application/javascript' }); } catch { /* chart.js não instalado: os gráficos do FCX ficam sem biblioteca */ } } return r.abort(); }); await p.addInitScript(() => { window.__QA_SEM_TRAVA_BACKUP = true; });
    p.on('pageerror', e => { if (!/Falha ao carregar https:\/\/cdnjs/.test(e.message)) errs.push('PE ' + e.message); }); p.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|ERR_TUNNEL|Failed to load|net::|404|401|403|409/.test(m.text())) errs.push(m.text()); });
    p.on('dialog', d => d.dismiss().catch(() => { })); p.on('request', r => { if (/\/api\/docs\?/.test(r.url())) reqs.push(r.url()); });
    await p.goto(U); await p.evaluate(() => { window.__esp = ms => new Promise(r => setTimeout(r, ms)); window.__ate = async (f, ms = 20000) => { for (let t = 0; t < ms; t += 50) { try { if (await f()) return true; } catch { } await __esp(50); } return false; }; }); return p; };
  const enviar = async (p, campos) => { await p.evaluate(() => __ate(() => document.querySelector('.login-form'))); for (const [k, v] of Object.entries(campos)) await p.fill(`.login-form [name="${k}"]`, v); await p.press(`.login-form [name="${Object.keys(campos).pop()}"]`, 'Enter'); await p.waitForTimeout(900); };
  const ev = (p, f, a) => p.evaluate(f, a);
  const ponta = p => p.evaluate(() => { window.__esp = ms => new Promise(r => setTimeout(r, ms)); window.__ate = async (f, ms = 20000) => { for (let t = 0; t < ms; t += 50) { try { if (await f()) return true; } catch { } await __esp(50); } return false; }; });
  const recarregar = async p => { await p.reload(); await ponta(p); await p.evaluate(() => __ate(() => Sessao.ativa && Repo.prontas.has('config') && Repo.prontas.has('extratos'), 30000)); await p.evaluate(() => __esp(700)); };
  const esp = (p, ms = 150) => p.waitForTimeout(ms);
  const recursos = (p, v152) => p.evaluate(async v152 => { const d = (await Cloud.adapter.get('config/recursos')) || {}, { id, ...x } = d; Object.keys(Recursos.LISTA).forEach(k => { x[k] = { ...Recursos.LISTA[k], ativo: k === 'gestao_v152' ? v152 : true, desde: new Date().toISOString() }; }); await Cloud.adapter.set('config/recursos', x); await __ate(() => Recursos.ativo('gestao_v152') === v152); }, v152);

  const M = await aba(); await enviar(M, { cpf: '529.982.247-25', senha: TEMP }); await enviar(M, { nova: NOVA, conf: NOVA }); await M.evaluate(() => __ate(() => Sessao.ativa && Repo.prontas.has('config')));

  /* ---------- 0 · cenário: contas, extratos de janeiro/2026 e recursos ligados ---------- */
  await recursos(M, true); await recarregar(M);
  await ev(M, async ({ EXT }) => {
    for (const [id, ap, cc] of [['ct-esp', 'ESPOSENDE -SANTANDER', '1111'], ['ct-mar', 'MAR ABERTO - SANTANDER', '2222']]) await Repo.salvar('contasBancarias', id, { apelido: ap, banco: '033', bancoNome: 'Santander', agencia: '0001', conta: cc, ativa: true });
    for (const d of EXT) { const { id, ...r } = d; await Repo.salvar('extratos', id, r); }
    await __ate(() => Repo.get('extratos', 'd-esp') && Repo.get('extratos', 'd-mar'), 20000);
  }, { EXT: EXT_JAN });
  await recarregar(M);
  chk('0.1 recurso gestao_v152 ligado (g152) e selo "v15.2" no cabeçalho', await ev(M, () => g152() === true && /v15\.2/.test(document.querySelector('.ver-badge')?.innerText || '')));
  const abrirDfc = async (sub = 'dfc') => { await ev(M, async sub => { App.ir('fcx'); FCX.ui.aba = 'dfc'; FluxoDFC.ui.sub = sub; FluxoDFC.ui.mes = '2026-01'; FluxoDFC.ui.conta = ''; App.render(); await __ate(() => document.querySelector('[data-a="fd-sub"]')); await __ate(() => !FluxoDFC.prontoForn05 || FluxoDFC.prontoForn05(), 40000); await FluxoDFC.garantirCnab17(true); await __esp(300); App.render(); }, sub); await esp(M, 500); };
  const dfcTxt = () => ev(M, () => document.body.innerText.replace(/ /g, ' '));

  /* ---------- 1 · DFC antes de importar: o botão antigo não existe; "Recalcular" sim ---------- */
  for (const sub of ['dfc', 'extratos']) {
    await abrirDfc(sub);
    const t = await dfcTxt();
    chk(`1.1 DFC (${sub}) · NÃO há botão nem modal "Importar Baixas do ERP (CNAB)" (data-a fd-pagto-importar)`, await ev(M, () => !document.querySelector('[data-a="fd-pagto-importar"]')) && !/Importar Baixas do ERP \(CNAB\)/.test(t));
  }
  await abrirDfc('dfc');
  chk('1.2 DFC · "Recalcular Desdobramento CNAB" continua ao lado do filtro de mês', await ev(M, () => !!document.querySelector('[data-a="fd-cnab-recalcular"]')));
  chk('1.3 sem títulos Pago importados do ERP na base de Saídas: nenhum lote é desdobrado (a DFC fica exatamente como o extrato)', await ev(M, o => { const p = FluxoDFC.planoCnab17(), pv = p && p.provasMes && p.provasMes.get('2026-01'); return !!p && p.resumo.nDesdobrados === 0 && (!pv || (pv.extratoCents === o.soma && pv.categoriasCents === o.soma)); }, { soma: SOMA_OFX }));

  /* ---------- 2 · FCX › Saídas: importar o Contas a Pagar atual (CSV) ---------- */
  await ev(M, () => { App.ir('fcx'); FCX.ui.aba = 'fcx'; App.render(); });
  await M.waitForSelector('#fcxFrame', { timeout: 30000 });
  const fr = await (await M.$('#fcxFrame')).contentFrame();
  await fr.waitForFunction(() => typeof goto === 'function' && typeof state !== 'undefined' && state.saidas !== undefined, null, { timeout: 60000 });
  await fr.evaluate(() => goto('manage', 'saidas')); await esp(M, 600);
  const N0 = await fr.evaluate(() => state.saidas.length); // o FCX já traz a sua base (dados de demonstração do banco de teste): tudo é conferido em relação a ela
  const modo = await fr.evaluate(() => state._saidasImportMode || 'smart');
  chk('2.1 FCX › Saídas · modo padrão "Inteligente por mês" e aviso "Fonte única de pagamentos"', modo === 'smart' && await fr.evaluate(() => !!document.querySelector('#saidasFonteUnica152') && /Inteligente por mês/.test(document.body.innerText)), modo);
  const importa = async arq => { await fr.setInputFiles('input[type=file][onchange*="importSaidasFile"]', arq); await esp(M, 400); };
  const baixaBanco = () => { // lê esp2:saidas direto do Postgres (compactado: z1:+base64 gzip) e devolve { meta, lista }
    const meta = JSON.parse(psql(`SELECT dados::text FROM documentos WHERE colecao='fcx' AND doc_id='esp2:saidas'`) || 'null');
    if (!meta) return { meta: null, lista: null };
    let tx = ''; for (let i = 0; i < meta.partes; i++) tx += JSON.parse(psql(`SELECT dados::text FROM documentos WHERE colecao='fcx' AND doc_id='esp2:saidas~${i}'`)).v;
    const valor = tx.startsWith('z1:') ? zlib.gunzipSync(Buffer.from(tx.slice(3), 'base64')).toString('utf8') : tx;
    return { meta, lista: JSON.parse(valor), compactado: tx.startsWith('z1:') };
  };
  await importa(D + 'contas_a_pagar_dia1.csv');
  await fr.waitForSelector('#saidasGravacao152[data-ok="1"]', { timeout: 60000 });
  const faixa = await fr.evaluate(() => document.querySelector('#saidasGravacao152').innerText.replace(/ /g, ' '));
  const bd1 = baixaBanco();
  const doErp = l => l.filter(x => x.erp17 === 'A');
  chk('2.2 importação gravada no Postgres: +6 registros do arquivo (só os Pago; o A Vencer fica de fora; R$ 19.120,75) sem tocar na base que já existia, e a faixa confirma a contagem total e o valor do mês (jan: 5 títulos, R$ 19.000,75; fev: 1 título, R$ 120,00)', bd1.lista && bd1.lista.length === N0 + 6 && doErp(bd1.lista).length === 6 && Math.round(doErp(bd1.lista).reduce((s, x) => s + x.valor * 100, 0)) === 1912075 && new RegExp(`${N0 + 6} registro`).test(faixa) && /19\.000,75/.test(faixa) && /120,00/.test(faixa), [N0, faixa.slice(0, 400), bd1.lista && bd1.lista.length]);
  chk('2.3 o banco guardou esp2:saidas compactado (gzip+base64), com hash e tamanho no meta, e o conteúdo bate com a tela', bd1.compactado === true && bd1.meta.z === 'gzip-b64' && !!bd1.meta.hash && bd1.meta.tamanho > bd1.meta.zTamanho && JSON.stringify(bd1.lista) === JSON.stringify(await fr.evaluate(() => state.saidas)), bd1.meta);
  chk('2.4 a faixa traz o resumo de cada mês do arquivo (janeiro: 5 títulos, 5 Pago; fevereiro: 1 título)', /01\/2026/.test(faixa) && /Pago: 5/.test(faixa) && /02\/2026/.test(faixa), faixa);

  /* ---------- 3 · a DFC de janeiro/2026 reflete na hora, sem duplicidade, com a prova ao centavo ---------- */
  await abrirDfc('dfc');
  const prova = await ev(M, () => { const p = FluxoDFC.planoCnab17(), pv = p.provasMes.get('2026-01'); return { n: p.resumo.nDesdobrados, real: p.resumo.valorRealocado, ext: pv.extratoCents, cat: pv.categoriasCents, banco: pv.saidasBancoCents, integ: p.integridade.ok, reprov: p.mesesReprovados.length, nr: p.naoRealocado.cents }; });
  chk('3.1 DFC · 2 lotes desdobrados, R$ 12.000,75 realocados; Σ categorias = Σ OFX = 10.670.890 centavos; Total de Saídas do Banco 2.160.115 (nada mudou)', prova.n === 2 && prova.real === 12000.75 && prova.ext === SOMA_OFX && prova.cat === SOMA_OFX && SOMA_OFX === 10670890 && prova.banco === 2160115 && prova.integ && prova.reprov === 0, prova);
  chk('3.2 a obra (investimento, R$ 7.000,00) fica em "Pagamento a fornecedores" (premissa: só atividades operacionais), reportada como não realocada', prova.nr === 700000, prova);
  const t3 = await dfcTxt();
  chk('3.3 DFC · resumo compacto de 1 linha (recolhido): "2 lotes desdobrados" + valor realocado + "Total do extrato = Total da DFC"', await ev(M, () => { const d = document.querySelector('#c152-resumo details'); const s = d && d.querySelector('summary'); return !!d && !d.open && !!s && /2 lotes desdobrados/.test(s.innerText) && /12\.000,75/.test(s.innerText) && /Total do extrato .* = Total da DFC/.test(s.innerText.replace(/ /g, ' ')); }));
  chk('3.4 DFC · sem a listagem linha a linha dos lotes e SEM nenhum "Excedente Contas a Pagar sem cobertura CNAB"', !/Excedente Contas a Pagar sem cobertura CNAB/i.test(t3) && await ev(M, () => document.querySelectorAll('#c152-resumo table, #c152-resumo .c17-lote, #c152-resumo [data-lote]').length === 0));
  chk('3.5 DFC · continua sem o botão "Importar Baixas do ERP (CNAB)"', !/Importar Baixas do ERP \(CNAB\)/.test(t3) && await ev(M, () => !document.querySelector('[data-a="fd-pagto-importar"]')));
  chk('3.6 a DFC do mês mostra a reclassificação do lote: Aluguel (R$ 7.500,00), Pessoal (R$ 3.000,50) e Marketing (R$ 1.500,25)', /7\.500,00/.test(t3) && /3\.000,50/.test(t3) && /1\.500,25/.test(t3), t3.slice(0, 400));

  /* ---------- 4 · arquivo atualizado do dia: modo inteligente, sem duplicar ---------- */
  await ev(M, () => { App.ir('fcx'); FCX.ui.aba = 'fcx'; App.render(); }); await esp(M, 500);
  await fr.evaluate(() => goto('manage', 'saidas')); await esp(M, 500);
  await importa(D + 'contas_a_pagar_dia1.csv'); await fr.waitForSelector('#saidasGravacao152[data-ok="1"]', { timeout: 60000 }); await esp(M, 300);
  const bd2 = baixaBanco();
  chk('4.1 reimportar o MESMO arquivo não duplica: continuam N+6 registros e ids únicos', bd2.lista.length === N0 + 6 && doErp(bd2.lista).length === 6 && new Set(bd2.lista.map(x => x.id)).size === bd2.lista.length, [N0, bd2.lista.length]);
  await importa(D + 'contas_a_pagar_dia2.csv'); await fr.waitForSelector('#saidasGravacao152[data-ok="1"]', { timeout: 60000 }); await esp(M, 400);
  const bd3 = baixaBanco(), gama = bd3.lista.filter(x => x.fornecedor === 'CONTABIL GAMA');
  chk('4.2 arquivo do dia seguinte (+ CONTABIL GAMA Pago e +1 título novo): CONTABIL GAMA UMA vez, como pago; Fevereiro intocado; N+8 registros, ids únicos', gama.length === 1 && gama[0].tipo === 'pago' && gama[0].dataPagamento === '2026-01-20' && bd3.lista.some(x => x.fornecedor === 'PAPELARIA PI') && bd3.lista.length === N0 + 8 && doErp(bd3.lista).length === 8 && new Set(bd3.lista.map(x => x.id)).size === bd3.lista.length, [gama, N0, bd3.lista.length]);
  await abrirDfc('dfc');
  const prova2 = await ev(M, () => { const p = FluxoDFC.planoCnab17(), pv = p.provasMes.get('2026-01'), l = p.porTx.get('ct-esp|t1'); return { ext: pv.extratoCents, cat: pv.categoriasCents, util: l && l.cats.find(g => g.cat === 'pag_utilidades') && l.cats.find(g => g.cat === 'pag_utilidades').cents, integ: p.integridade.ok }; });
  chk('4.3 DFC · o título novo (Energia, R$ 900,00 pago em 06/01) já aparece no desdobramento do mesmo lote e a prova segue fechando ao centavo', prova2.util === 90000 && prova2.ext === SOMA_OFX && prova2.cat === SOMA_OFX && prova2.integ, prova2);

  /* ---------- 5 · layout antigo (Relação dos Títulos Pagos · PGTO.* + AgendaPagto), modo "Substituir" com confirmação ---------- */
  await ev(M, () => { App.ir('fcx'); FCX.ui.aba = 'fcx'; App.render(); }); await esp(M, 500);
  await fr.evaluate(() => { goto('manage', 'saidas'); setSaidasImportMode('replace'); render(); }); await esp(M, 400);
  await importa(D + 'baixas_erp_antigo.xlsx');
  await fr.waitForSelector('#saidasPendente152', { timeout: 60000 });
  const pend = await fr.evaluate(() => document.querySelector('#saidasPendente152').innerText.replace(/ /g, ' '));
  chk('5.1 "Substituir todos os lançamentos" NÃO grava sozinho: abre o quadro "Conferir antes de gravar" (avisando que apaga as N+8 atuais) e o banco continua como estava', /Conferir antes de gravar/.test(pend) && new RegExp(`apaga as ${N0 + 8} saída`).test(pend) && baixaBanco().lista.length === N0 + 8, pend.slice(0, 300));
  await fr.evaluate(() => { const bt = [...document.querySelectorAll('#saidasPendente152 button')].find(x => /Confirmar e gravar no banco/.test(x.textContent)); bt.scrollIntoView({ block: 'center' }); bt.click(); }); // o mesmo clique do usuário (o botão fica sob a barra fixa do FCX)
  await fr.waitForSelector('#saidasGravacao152[data-ok="1"]', { timeout: 60000 }); await esp(M, 400);
  const bd4 = baixaBanco(), fx4 = await fr.evaluate(() => document.querySelector('#saidasGravacao152').innerText.replace(/ /g, ' '));
  chk('5.2 layout antigo: 6 baixas (ignora "Baixa Estornada", conta interna e caixa; mantém o item fora da tabela de contas), R$ 19.300,75 gravados e conferidos no banco (Substituir: só o arquivo fica)', bd4.lista.length === 6 && Math.round(bd4.lista.reduce((s, x) => s + x.valor * 100, 0)) === 1930075 && /19\.300,75/.test(fx4), [bd4.lista.length, fx4.slice(0, 300)]);
  chk('5.3 prefixo "070-" removido da conta bancária e coluna Item → Conta Contábil / Categoria DFC (aluguel, folha, marketing)', bd4.lista.every(x => !/^\d{3}\s*-/.test(String(x.contaPagamento || ''))) && bd4.lista.some(x => /Aluguel/i.test(x.conta || '')) && bd4.lista.some(x => /Sal[aá]rios/i.test(x.conta || '')), bd4.lista.map(x => [x.fornecedor, x.conta, x.contaPagamento]).slice(0, 8));
  await abrirDfc('dfc');
  const prova3 = await ev(M, () => { const p = FluxoDFC.planoCnab17(), pv = p.provasMes.get('2026-01'), l = p.porTx.get('ct-esp|t1'), c = l ? Object.fromEntries(l.cats.map(g => [g.cat, g.cents])) : {}; return { c, ext: pv.extratoCents, cat: pv.categoriasCents, integ: p.integridade.ok }; });
  chk('5.4 DFC · o lote de janeiro é desdobrado com as baixas do layout antigo (Ocupação 5.000,00 · Folha 3.000,50 · Marketing 1.500,25) e a prova ao centavo fecha', prova3.c.pag_ocupacao === 500000 && prova3.c.pag_folha === 300050 && prova3.c.pag_marketing === 150025 && prova3.ext === SOMA_OFX && prova3.cat === SOMA_OFX && prova3.integ, prova3);

  /* ---------- 6 · cache inteligente: a 2ª abertura não baixa as Saídas de novo ---------- */
  await recarregar(M); await esp(M, 800); reqs.length = 0;
  await recarregar(M); await esp(M, 1200);
  const buscas = reqs.filter(u => /colecao=fcx/.test(u));
  chk('6.1 abrir de novo o painel pede só os documentos-meta do FCX (semFatias) e NENHUMA fatia (idPrefixos): as Saídas vêm do cache (IndexedDB)', buscas.some(u => /semFatias=1|semFatias=true/.test(u)) && !buscas.some(u => /idPrefixos/.test(u)), buscas.slice(0, 6));
  chk('6.2 e a tela do FCX ainda enxerga as 6 baixas do layout antigo', await (async () => { await ev(M, () => { App.ir('fcx'); FCX.ui.aba = 'fcx'; App.render(); }); await M.waitForSelector('#fcxFrame', { timeout: 30000 }); const f = await (await M.$('#fcxFrame')).contentFrame(); await f.waitForFunction(() => typeof state !== 'undefined' && Array.isArray(state.saidas), null, { timeout: 60000 }); await esp(M, 600); return (await f.evaluate(() => state.saidas.length)) === 6; })());

  /* ---------- 6b · v15.2.1 · layouts exatos: 01-JANEIRO.26.xlsx (PGTO.JANEIRO26, cabeçalho na linha 5) e CTGP_Sállamos; isolamento por mês e origem ---------- */
  await ev(M, () => { App.ir('fcx'); FCX.ui.aba = 'fcx'; App.render(); }); await M.waitForSelector('#fcxFrame', { timeout: 30000 });
  const fb = await (await M.$('#fcxFrame')).contentFrame(); await fb.waitForFunction(() => typeof goto === 'function' && typeof state !== 'undefined' && Array.isArray(state.saidas), null, { timeout: 60000 }); await fb.evaluate(() => { goto('manage', 'saidas'); setSaidasImportMode('smart'); render(); }); await esp(M, 500);
  const importaB = async arq => { await fb.setInputFiles('input[type=file][onchange*="importSaidasFile"]', arq); await esp(M, 500); };
  const clicaB = async rotulo => fb.evaluate(r => { const bt = [...document.querySelectorAll('#saidasPendente152 button')].find(x => x.textContent.includes(r)); if (!bt) return false; bt.scrollIntoView({ block: 'center' }); bt.click(); return true; }, rotulo);
  const tela = () => fb.evaluate(() => document.querySelector('#saidasPendente152') ? document.querySelector('#saidasPendente152').innerText.replace(/ /g, ' ') : '');
  const jan = l => JSON.stringify(l.filter(x => String(x.date).startsWith('2026-01')));
  await importaB(D + '01-JANEIRO.26.xlsx'); await fb.waitForSelector('#saidasGravacao152[data-ok="1"]', { timeout: 60000 }); await esp(M, 400);
  const e1 = baixaBanco(), leg = e1.lista.filter(x => x.origemModelo === 'erp_legado'), faixaB = await fb.evaluate(() => document.querySelector('#saidasGravacao152').innerText.replace(/ /g, ' '));
  chk('6b.1 01-JANEIRO.26.xlsx (aba PGTO.JANEIRO26, cabeçalho na linha 5, sem coluna Fornecedor, Item "187-SALARIOS E ORDENADOS"): reconhecido como ERP Legado, 8 baixas (7 + 1 crediário, que a v15.2.2 importa e marca) = R$ 20.220,75 gravadas e conferidas no Postgres (substitui só janeiro do ERP Legado)', leg.length === 8 && Math.round(leg.reduce((t, x) => t + x.valor * 100, 0)) === 2022075 && /20\.220,75/.test(faixaB) && leg.filter(x => x.crediario).length === 1 && e1.lista.every(x => x.origemModelo === 'erp_legado') && leg.every(x => x.tipo === 'pago' && /^2026-01-0[5-9]$/.test(x.date) && x.date === x.dataPagamento), [e1.lista.length, faixaB.slice(0, 300)]);
  chk('6b.2 mapeamento no banco: contaPagamento padronizada (ESPOSENDE - SANTANDER, MAR ABERTO - SANTANDER, CAIXA ECONÔMICA FEDERAL), itemErp com o texto original do Item e conta do Plano de Contas (187 → 4.01.01, 468 → 4.10.06)', leg.every(x => !/^\d{3}\s*-/.test(x.contaPagamento)) && [...new Set(leg.map(x => x.contaPagamento))].sort().join('|') === 'CAIXA ECONÔMICA FEDERAL|ESPOSENDE - SANTANDER|MAR ABERTO - SANTANDER' && leg.some(x => x.itemErp === '187-SALARIOS E ORDENADOS' && x.conta.startsWith('4.01.01')) && leg.some(x => x.itemErp === '468-ALUGUEL LOJA DE RUA' && x.conta.startsWith('4.10.06')), leg.map(x => [x.itemErp, x.conta, x.contaPagamento]));
  await abrirDfc('dfc');
  const provaB = await ev(M, () => { const p = FluxoDFC.planoCnab17(), pv = p.provasMes.get('2026-01'), l = p.porTx.get('ct-esp|t1'), lm = p.porTx.get('ct-mar|t3'), c = l ? Object.fromEntries(l.cats.map(g => [g.cat, g.cents])) : {}, cm = lm ? Object.fromEntries(lm.cats.map(g => [g.cat, g.cents])) : {}; return { c, cm, ext: pv.extratoCents, cat: pv.categoriasCents, banco: pv.saidasBancoCents, integ: p.integridade.ok, reprov: p.mesesReprovados.length, contaPag: l ? [...new Set(l.alocs.map(a => a.x.contaPag))] : [] }; });
  chk('6b.3 DFC · Jan/2026 desdobra os lotes CNAB com as baixas do ERP Legado (Esposende: Aluguel 5.000,00 · Pessoal 3.000,50 · Marketing 1.500,25; Mar Aberto: Aluguel 2.500,00) e a paridade fecha AO CENTAVO: Σ categorias = Σ OFX = 10.670.890; Saídas do Banco 2.160.115', provaB.c.pag_ocupacao === 500000 && provaB.c.pag_folha === 300050 && provaB.c.pag_marketing === 150025 && provaB.cm.pag_ocupacao === 250000 && provaB.ext === SOMA_OFX && provaB.cat === SOMA_OFX && provaB.banco === 2160115 && provaB.integ && provaB.reprov === 0 && provaB.contaPag.join() === 'ESPOSENDE - SANTANDER', provaB);
  /* Sállamos de mai–nov: janeiro do ERP Legado fica 100% intacto */
  await ev(M, () => { App.ir('fcx'); FCX.ui.aba = 'fcx'; App.render(); }); await esp(M, 500); await fb.evaluate(() => goto('manage', 'saidas')); await esp(M, 500);
  const jan0 = jan(e1.lista);
  await importaB(D + 'CTGP_Sallamos.xlsx'); await fb.waitForSelector('#saidasGravacao152[data-ok="1"]', { timeout: 60000 }); await esp(M, 400);
  const e2 = baixaBanco(), sal = e2.lista.filter(x => x.origemModelo === 'erp_sallamos');
  chk('6b.4 CTGP_Sállamos (mai–nov) em XLSX: só os 14 títulos Pago entram (35 de Vencido/Renegociado/Previsto/Cancelado/Vinculado ficam de fora), nenhuma tela de conflito, e o banco passa a ter 8 + 14 = 22 registros', sal.length === 14 && e2.lista.length === 22 && sal.every(x => x.tipo === 'pago' && /^2026-(0[5-9]|1[01])-/.test(x.date)) && !(await fb.evaluate(() => !!document.querySelector('#saidasPendente152'))), [sal.length, e2.lista.length]);
  chk('6b.5 Upload do CTGP_Sállamos PRESERVA 100% dos dados de jan/2026 do ERP antigo (os 8 registros idênticos, byte a byte, lidos direto do Postgres)', jan(e2.lista) === jan0 && e2.lista.filter(x => x.origemModelo === 'erp_legado').length === 8, [jan(e2.lista).length, jan0.length]);
  /* Sállamos com um título em janeiro: sobreposição bloqueada */
  await importaB(D + 'CTGP_Sallamos_com_janeiro.xlsx'); await fb.waitForSelector('#sobreposicao152', { timeout: 60000 });
  const tq = await tela(), e3 = baixaBanco();
  chk('6b.6 arquivo Sállamos com um título em 01/2026: o painel mostra "Sobreposição entre ERPs bloqueada" (01/2026 já tem 8 lançamentos do ERP Legado × arquivo do ERP Sállamos), oferece "Gravar só os meses sem conflito" e "Substituir ERP Legado em 01/2026…", e NADA foi gravado', /Sobreposição entre ERPs bloqueada/.test(tq) && /01\/2026/.test(tq) && /8 lançamento\(s\) do ERP Legado/.test(tq) && /ERP Sállamos/.test(tq) && /Gravar só os meses sem conflito/.test(tq) && /Substituir ERP Legado em 01\/2026/.test(tq) && e3.lista.length === 22 && jan(e3.lista) === jan0, tq.slice(0, 500));
  chk('6b.7 "Gravar só os meses sem conflito": o título de janeiro do Sállamos NÃO entra; os 8 do ERP Legado ficam idênticos; o banco confere', await clicaB('Gravar só os meses sem conflito') && await fb.waitForSelector('#saidasGravacao152[data-ok="1"]', { timeout: 60000 }).then(() => true) && await (async () => { await esp(M, 500); const e = baixaBanco(); return jan(e.lista) === jan0 && !e.lista.some(x => x.origemModelo === 'erp_sallamos' && String(x.date).startsWith('2026-01')) && e.lista.length === 22; })());
  await importaB(D + 'CTGP_Sallamos_com_janeiro.xlsx'); await fb.waitForSelector('#sobreposicao152', { timeout: 60000 });
  await clicaB('Substituir ERP Legado'); await esp(M, 400);
  const ts = await tela(), e4 = baixaBanco();
  chk('6b.8 substituição só com confirmação: depois de "Substituir…" o aviso vermelho diz que os 8 lançamentos do ERP Legado em 01/2026 serão apagados e AINDA nada foi gravado', /Substituição entre ERPs/.test(ts) && /serão apagados/.test(ts) && /Confirmar substituição e gravar no banco/.test(ts) && jan(e4.lista) === jan0, ts.slice(0, 400));
  await clicaB('Confirmar substituição'); await fb.waitForSelector('#saidasGravacao152[data-ok="1"]', { timeout: 60000 }); await esp(M, 500);
  const e5 = baixaBanco();
  chk('6b.9 confirmada a substituição: os 8 do ERP Legado saem de janeiro e entra o título do ERP Sállamos; mai–nov do Sállamos seguem intactos (14 + 1 = 15 registros)', e5.lista.filter(x => x.origemModelo === 'erp_legado').length === 0 && e5.lista.filter(x => x.origemModelo === 'erp_sallamos' && String(x.date).startsWith('2026-01')).length === 1 && e5.lista.length === 15, [e5.lista.length]);
  await abrirDfc('dfc');
  const provaC = await ev(M, () => { const p = FluxoDFC.planoCnab17(), pv = p.provasMes.get('2026-01'); return { ext: pv ? pv.extratoCents : null, cat: pv ? pv.categoriasCents : null, integ: p.integridade.ok }; });
  chk('6b.10 DFC · depois de trocar o ERP de janeiro a integridade continua fechando (sem lote desdobrado, Σ categorias = Σ OFX)', provaC.integ && (provaC.ext === null || (provaC.ext === SOMA_OFX && provaC.cat === SOMA_OFX)), provaC);

  /* ---------- 7 · recurso desligado = v15.1 (botão antigo de volta, FCX com o leitor de sempre) ---------- */
  await recursos(M, false); await recarregar(M); await abrirDfc('dfc');
  chk('7.1 com a gestao_v152 desligada a DFC volta ao que era na v15.1 (botão "Importar Baixas do ERP (CNAB)" presente)', await ev(M, () => g152() === false && !!document.querySelector('[data-a="fd-pagto-importar"]')));
  await ev(M, () => { App.ir('fcx'); FCX.ui.aba = 'fcx'; App.render(); }); await esp(M, 800);
  const f2 = await (await M.$('#fcxFrame')).contentFrame(); await f2.waitForFunction(() => typeof goto === 'function', null, { timeout: 60000 }); await f2.evaluate(() => goto('manage', 'saidas')); await esp(M, 500);
  chk('7.2 v15.2.2 · com a gestao_v152 desligada o FCX › Saídas MANTÉM o leitor unificado (aviso "Fonte única de pagamentos" e modo "Inteligente por mês"): o que a flag desliga é só a compactação/cache e a releitura da DFC', await f2.evaluate(() => fcxV152() === false && fcxLeitor1522() === true && !!document.querySelector('#saidasFonteUnica152') && /Inteligente por mês/.test(document.body.innerText)));
  await recursos(M, true);

  chk('8 · nenhum erro de página nem de console durante o roteiro', errs.length === 0, errs.slice(0, 6));
  await b.close();
  console.log(`\n${OK.length} ok · ${FAIL.length} falha(s)`);
  if (FAIL.length) { console.log('FALHAS:'); FAIL.forEach(f => console.log(' - ' + f)); process.exit(1); }
})().catch(e => { console.error('ERRO FATAL', e); process.exit(2); });
