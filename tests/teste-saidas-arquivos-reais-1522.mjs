/* v15.2.2 · TESTE COM OS ARQUIVOS REAIS — FCX › Saídas lê o ERP Legado (01-JANEIRO.26.xlsx) e o ERP Sállamos (CTGP_Sállamos.xlsx) SEM flag nenhuma.
   Código REAL fatiado de public/index.html (Pagto17/Leitor1521/Saidas152/CNAB17/DFC) e de public/fcx.html (importSaidasFile + importação da v15.2) sobre um banco simulado em memória.
   Os arquivos reais NÃO acompanham o pacote (dados de folha e fornecedores): informe a pasta em ARQUIVOS_REAIS; sem ela as seções de arquivo são puladas e dizem isso (a parte estática roda sempre).
   Uso:  ARQUIVOS_REAIS=/pasta/com/os/dois/xlsx XLSX_PATH=/caminho/node_modules/xlsx node tests/teste-saidas-arquivos-reais-1522.mjs
   As contagens esperadas vêm de um gabarito INDEPENDENTE lido das linhas brutas do Excel (não do leitor do painel). Não há OFX real no pacote: a prova da DFC usa um extrato SINTÉTICO de jan/2026
   montado com os títulos reais (um lote CNAB por banco e dia), com as mesmas travas do motor (ao centavo). */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(process.env.PAINEL_HTML || path.join(raiz, 'public/index.html'), 'utf8');
const fcx = fs.readFileSync(process.env.FCX_HTML || path.join(raiz, 'public/fcx.html'), 'utf8');
const OK = [], FAIL = [], PULOU = [];
const chk = (n, c, x = '') => { (c ? OK : FAIL).push(n); console.log((c ? 'ok   ' : 'FALHA ') + n + (!c && x !== '' ? ' → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 1800) : '')); };
const pula = (n, porque = 'SheetJS não instalado') => { PULOU.push(n); console.log('pulou ' + n + ' (' + porque + ')'); };
const md5 = t => createHash('md5').update(t).digest('hex');
const corta = (src, ini, fim) => { const a = src.indexOf(ini), b = src.indexOf(fim, a + ini.length); if (a < 0 || b < 0) throw new Error('bloco não encontrado: ' + ini.slice(0, 60) + ' … ' + fim.slice(0, 60)); return src.slice(a, b); };
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const c100 = x => Math.round((Number(x) + Number.EPSILON) * 100);
const espera = (ms = 30) => new Promise(r => setTimeout(r, ms));
let XLSX = null; try { const req = createRequire(import.meta.url); XLSX = req(process.env.XLSX_PATH || 'xlsx'); } catch { XLSX = null; }
const DB_URL = process.env.NETLIFY_DB_URL || '';
const csvCod = corta(html, 'const CSV = {', '/**\n * WhatsApp (camada Util)');
const ofxCod = corta(html, 'const OFX = {', '/* ======================= CONTAS (de-para)');
const dfcCod = corta(html, 'const DFC_GRUPOS = {', '/* ============================ IEO ============================ */');
const prevCod = corta(html, '/** Conta contábil do FCX → categoria de saída da DFC, pelo prefixo do código', 'const Cruzamento = {');
const uiCod09 = corta(html, '/* v14.09 · Extratos OFX × Contas a Pagar do FCX (FCX → Saídas): cruzamento na importação', '/* v14.06 · DFC · Resumo Executivo Oficial');
const parcCod = corta(html, 'const Parc11 = {', 'const PartesContratuais11 = {');
const cnabMotor = corta(html, 'const CNAB17 = {', '/* =====================================================================\n   v14.17 · FRENTE 2 · DESDOBRAMENTO CNAB — TELA');
const cnabTela = corta(html, 'Object.assign(FluxoDFC, {\n  _c17:', '/* ---- fim v14.17 ---- */');
const diasUteisCod = html.slice(html.indexOf('const DiasUteis = {'), html.indexOf('\n};\n', html.indexOf('const DiasUteis = {')) + 4);
const fcxPonte = html.slice(html.indexOf('const FCX = {\n  html: null'), html.indexOf('window.FCX = FCX;'));
const mod152 = corta(html, 'const Z152 = {', '/* ---- fim v15.2 ---- */');

/** IndexedDB mínimo em memória (compartilhado entre "sessões": recarregar o painel = novo ambiente, mesmo IndexedDB) */
function idbSimulado() {
  const dbs = new Map();
  return { open(nome) {
    const rq = {}; queueMicrotask(() => {
      let d = dbs.get(nome); const novo = !d; if (!d) { d = { lojas: new Map() }; dbs.set(nome, d); }
      rq.result = { createObjectStore(n) { d.lojas.set(n, new Map()); return {}; }, close() { },
        transaction(loja) { const st = d.lojas.get(loja), tx = {}, store = { getAll() { return { result: [...st.values()].map(v => JSON.parse(JSON.stringify(v))) }; }, put(v) { st.set(v.id, JSON.parse(JSON.stringify(v))); return {}; }, delete(k) { st.delete(k); return {}; }, clear() { st.clear(); return {}; } }; tx.objectStore = () => store; setTimeout(() => tx.oncomplete && tx.oncomplete(), 0); return tx; } };
      if (novo && rq.onupgradeneeded) rq.onupgradeneeded(); if (rq.onsuccess) rq.onsuccess();
    }); return rq; } };
}
globalThis.indexedDB = idbSimulado();

/** Banco online simulado: guarda os documentos do adaptador da nuvem e conta o que "desceu" (listas, documentos e bytes). `semFiltro` imita um servidor da v15.1 (ignora semFatias/idPrefixos). */
function bancoSimulado() {
  const docs = new Map(), A = { docs, listas: 0, docsBaixados: 0, bytesBaixados: 0, gets: 0, sets: 0, removes: 0, falhaSet: false, semFiltro: false, chamadas: [] }, clone = o => JSON.parse(JSON.stringify(o));
  A.zerar = () => { A.listas = 0; A.docsBaixados = 0; A.bytesBaixados = 0; A.gets = 0; A.sets = 0; A.removes = 0; A.chamadas = []; };
  A.adapter = {
    async list(col, o = {}) {
      A.listas++; A.chamadas.push(['list', col, JSON.stringify(o)]);
      let l = [...docs].filter(([p]) => p.startsWith(col + '/')).map(([p, d]) => ({ id: p.slice(col.length + 1), ...clone(d) }));
      if (!A.semFiltro) { if (o.semFatias) l = l.filter(d => !d.id.includes('~')); if (o.idPrefixos) l = l.filter(d => o.idPrefixos.some(p => d.id === p || d.id.startsWith(p + '~'))); }
      A.docsBaixados += l.length; A.bytesBaixados += JSON.stringify(l).length; return l;
    },
    async get(p) { A.gets++; A.chamadas.push(['get', p]); const d = docs.get(p); if (d) A.bytesBaixados += JSON.stringify(d).length; return d ? { id: p.slice(p.indexOf('/') + 1), ...clone(d) } : null; },
    async set(p, d) { if (A.falhaSet) throw new Error('banco indisponível (simulado)'); A.sets++; docs.set(p, clone(d)); return true; },
    async remove(p) { A.removes++; docs.delete(p); return true; },
  };
  return A;
}

const CONTAS = [{ id: 'ct-esp', apelido: 'ESPOSENDE -SANTANDER', ativa: true }, { id: 'ct-mar', apelido: 'MAR ABERTO - SANTANDER', ativa: true }];
function amb152({ ext = [], saidas = [], g152 = true, g17 = true, contas = CONTAS, pode = () => true, itens = null, banco = null, xlsx = XLSX } = {}) {
  const S = { extratos: new Map(ext.map(d => [d.id, d])), config: new Map(), contasBancarias: new Map(contas.map(c => [c.id, c])), parceiros: new Map() }, V = {}; let tic = 0; const bump = c => { V[c] = (V[c] || 0) + 1; };
  if (itens) S.config.set('dfc_item17', { id: 'dfc_item17', itens });
  const A = banco || bancoSimulado(), ctx = { g152, g17, toasts: [], audits: [], bases: [], renders: 0, modais: [], cargas: [], sync: [], saidasFcx: saidas, apiOk: true, salvos: [], banco: A };
  ctx.api = { saidas: () => ctx.saidasFcx, contas: () => [], sincronizarSaidas: () => 0 };
  const Repo = { prontas: new Set(Object.keys(S)), todos: c => [...(S[c] || new Map()).values()], get: (c, id) => (S[c] || new Map()).get(id) || null, versao: c => V[c] || 0,
    salvar: async (c, id, d) => { S[c].set(id, { id, ...JSON.parse(JSON.stringify(d)), atualizadoEm: 't' + (++tic) }); bump(c); ctx.salvos.push([c, id]); } };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const Fmt = { data: d => String(d).split('-').reverse().join('/'), brl: v => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }), brl0: v => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) };
  const Auth = { can: k => pode(k), id: 'usr-teste' };
  const FluxoDFC = { ui: { mes: '2026-01' }, mesLabel: m => m, podeCruzar05: () => true, cruzarUma05: t => ({ t: { ...t }, ambigua: false }), atualizarBaseDFC: async m => { ctx.bases.push(m); },
    transacoes() { return [...S.extratos.values()].flatMap(d => (d.transacoes || []).map(t => ({ ...t, contaId: d.contaId, docId: d.id }))); },
    contas: () => [...S.contasBancarias.values()], norm: s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim(),
    esperarApi09: async () => (ctx.apiOk ? ctx.api : null) };
  const MotorConciliacao = { somaDias: (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); } };
  const Libs = { xlsx: async () => { if (!xlsx) throw new Error('sem SheetJS'); return xlsx; } };
  const CargaFeedback = { mostrar: r => { ctx.cargas.push(r); return Promise.resolve(true); }, falha: (o, a, e) => { ctx.cargas.push({ origem: o, arquivo: a, erro: String(e && e.message || e) }); return Promise.resolve(true); } };
  const UI = { toast: m => ctx.toasts.push(m), modal(o) { ctx.modais.push(o); return { el: {}, fechar() { } }; } };
  const Cloud = { base: { netlify: true }, nuvem: true, adapter: A.adapter }, Sync = { ocupado() { } }, MotorAluguel = { _rodando: false, agendar() { } };
  const App = { rota: '', render() { ctx.renders++; }, agendarRender() { ctx.renders++; } };
  const nomes = ['MotorConciliacao', 'Repo', 'g04', 'g05', 'g09', 'g11', 'g17', 'g152', 'FluxoDFC', 'esc', 'Fmt', 'Auth', 'sleep', 'UI', 'Acesso', 'App', 'Audit', 'ContasBancarias', 'Libs', 'CargaFeedback', 'Cloud', 'Sync', 'MotorAluguel'];
  const vals = [MotorConciliacao, Repo, () => true, () => true, () => true, () => false, () => ctx.g17, () => ctx.g152, FluxoDFC, esc, Fmt, Auth, () => Promise.resolve(), UI, { loja: () => false }, App, { registrar: a => { ctx.audits.push(a); return Promise.resolve(); } }, { rotulo: c => c.apelido }, Libs, CargaFeedback, Cloud, Sync, MotorAluguel];
  const fn = new Function(...nomes, parcCod + '\n' + csvCod + '\n' + ofxCod + '\n' + diasUteisCod + '\n' + dfcCod + '\n' + prevCod + '\n' + uiCod09 + '\n' + cnabMotor + '\n' + cnabTela + '\n' + fcxPonte + '\n' + mod152 +
    '\nreturn { CSV, OFX, DFC, PARC_PIX, CP_OFX, PrevistoFCX, DiasUteis, CNAB17, PAGTO17, Pagto17, Leitor1521, FCX, Z152, Saidas152, CNAB152, Cloud };');
  const R = fn(...vals); R.FCX.api = () => (ctx.apiOk ? ctx.api : null);
  Object.assign(ctx, R, { S, Repo, FluxoDFC, Fmt, UI, bump }); return ctx;
}

/* ---------------------------------------------------------------------------------------------------------------------------------------
   FERRAMENTAS — o código REAL de public/fcx.html (importSaidasFile + importação da v15.2) com o estado do FCX e a ponte do painel de brincadeira.
   Diferença para o teste da v15.2: aqui entra importSaidasFile (o ponto de entrada do botão "Importar"), com um espião no leitor genérico antigo (importSaidasLegado).
   --------------------------------------------------------------------------------------------------------------------------------------- */
const fcxV152Cod = corta(fcx, 'function fcxV152(){', '\n') + '\n' + corta(fcx, 'function fcxLeitor1522(){', '\n'), fcxBRL2Cod = corta(fcx, 'const BRL2 = ', '\n'), fcxGlueCod = corta(fcx, 'function fcxEsc152(t)', '\nif(!state._saidaForm)');
const importFileCod = corta(fcx, 'function importSaidasFile(input){', '/* v14.17 (complemento)');
const arquivoDe = (nome, conteudo) => { const buf = Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo, 'utf8'); return { name: nome, size: buf.length, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }; };
const aoa = (nome, rows) => ({ nome, rows });
const arquivoMatriz = (nome, sheets) => ({ name: nome, size: 4096, __sheets: sheets });
function fcxGlue(E, { saidas = [], mes = '2026-01' } = {}) {
  const state = { saidas: saidas.map(s => ({ ...s })), config: { accounts: [], costCenters: [] }, _saidaFilter: { month: mes }, _erroLeitura: new Set(), _saidasImportMode: 'smart' }, G = { state, toasts: [], renders: 0, cargas: [], salvouConfig: 0, legado: { chamadas: 0 } };
  const P = { Recursos: { ativo: k => k === 'gestao_v152' && E.g152 }, g152: () => E.g152, Saidas152: E.Saidas152, Pagto17: E.Pagto17, Leitor1521: E.Leitor1521, CargaFeedback: { mostrar: r => { G.cargas.push(r); } } };
  const lerOrig = E.Pagto17.lerArquivo.bind(E.Pagto17); if (!E.Pagto17.__matriz152) { E.Pagto17.__matriz152 = true; E.Pagto17.lerArquivo = async (f, lib) => (f.__sheets ? { nome: f.name, tamanho: f.size || 1, sheets: f.__sheets } : lerOrig(f, lib)); } // arquivo "de matrizes": mesmo leitor, plano e gravação
  const win = { __embed: true, parent: P, storage: E.FCX.storage, XLSX: E.xlsx || XLSX };
  const fn = new Function('window', 'state', 'showToast', 'render', 'toISO', 'saveConfig', 'fcxCarga99', 'fcx1386Nova', 'fcxV1378', 'fcxArq99', 'importSaidasLegado',
    fcxV152Cod + '\n' + fcxBRL2Cod + '\n' + importFileCod + '\n' + fcxGlueCod + '\nreturn { importSaidasFile, fcxV152, fcxLeitor1522, saveSaidas152, fcxImportSaidas152, aplicarImportacaoSaidas152, confirmarImportacaoSaidas152, cancelarImportacaoSaidas152, substituirConflitoSaidas152, bloquearConflitoSaidas152, fcxPainelSaidas152, BRL2 };');
  const F = fn(win, state, m => G.toasts.push(m), () => { G.renders++; }, d => d.toISOString().slice(0, 10), async () => { G.salvouConfig++; }, r => { G.cargas.push(r); }, () => { }, () => false, f => [{ nome: f.name, tamanho: f.size }], () => { G.legado.chamadas++; });
  return Object.assign(G, F, { win });
}
const esperaAte = async (cond, ms = 120000) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) throw new Error('tempo esgotado esperando a importação'); await espera(25); } await espera(80); };
/** aperta "Importar" com o arquivo: espera a gravação (ou o quadro de confirmação) terminar */
async function importa(G, arquivo) {
  const n0 = G.cargas.length, p0 = G.state._saidasPendente152, t0 = Date.now(), k0 = G.toasts.length;
  G.importSaidasFile({ files: [arquivo], value: 'x' });
  await esperaAte(() => G.cargas.length > n0 || G.state._saidasPendente152 !== p0 || G.toasts.slice(k0).some(t => /não concluída|NÃO gravada|mais antigo|Arquivo do ERP|Nenhuma linha/.test(t)));
  return { ms: Date.now() - t0, carga: G.cargas[G.cargas.length - 1], toasts: G.toasts.slice(k0) };
}
const cents = l => l.reduce((s, x) => s + c100(x.valor), 0);
const contaPor = (l, f) => l.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
const ordena = o => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
const gravadas = async E => JSON.parse((await E.FCX.storage.get('esp2:saidas')).value);
const hash = x => md5(typeof x === 'string' ? x : JSON.stringify(x));

/* ---------------------------------------------------------------------------------------------------------------------------------------
   GABARITO INDEPENDENTE — as contagens saem das linhas brutas do Excel (SheetJS), SEM passar pelo leitor do painel
   --------------------------------------------------------------------------------------------------------------------------------------- */
const usada = ws => { let mr = 0, mc = 0; for (const k of Object.keys(ws)) { if (k[0] === '!') continue; const c = XLSX.utils.decode_cell(k); if (c.r > mr) mr = c.r; if (c.c > mc) mc = c.c; } return XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: mr, c: mc } }); };
function gabaritoLegado(buf) {
  const wb = XLSX.read(buf, { cellDates: true }), nome = wb.SheetNames.find(s => /^PGTO/i.test(s)), declarado = wb.Sheets[nome]['!ref'], ws = wb.Sheets[nome]; ws['!ref'] = usada(ws);
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true }), hi = rows.findIndex(r => r.some(c => String(c ?? '').trim() === 'Vlr Líquido')), H = rows[hi].map(x => String(x ?? '').trim());
  const iI = H.indexOf('Item'), iP = H.indexOf('Pagamento'), iV = H.indexOf('Vlr Líquido'), iC = H.indexOf('Conta'), iIn = H.indexOf('Instruções'), iF = H.indexOf('Forma Pagto');
  const g = { abas: wb.SheetNames, aba: nome, declarado, linhasBrutas: rows.length, cabecalho: hi + 1, naoVazias: 0, importaveis: 0, estornadas: 0, crediario: 0, cents: 0, porForma: {}, porConta: {}, semBanco: 0 };
  for (const r of rows.slice(hi + 1)) { if (!r.some(c => c != null)) continue; g.naoVazias++;
    if (!/^\d{3}-/.test(String(r[iI] ?? '')) || !(r[iP] instanceof Date) || typeof r[iV] !== 'number') continue;
    if (/baixa estornada/i.test(String(r[iIn] ?? ''))) { g.estornadas++; continue; }
    if (!/^\d{3}-/.test(String(r[iC] ?? ''))) g.semBanco++;
    if (/CREDI/i.test(String(r[iF] ?? ''))) g.crediario++;
    g.porForma[String(r[iF])] = (g.porForma[String(r[iF])] || 0) + 1; g.importaveis++; g.cents += c100(r[iV]); }
  return g;
}
function gabaritoSallamos(buf) {
  const wb = XLSX.read(buf, { cellDates: true }), ws = wb.Sheets[wb.SheetNames[0]], rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true }), H = rows[0].map(x => String(x ?? '').trim());
  const iS = H.indexOf('Status'), iV = H.indexOf('Valor Pago'), iD = H.indexOf('Data de Pagamento'), iF = H.indexOf('Forma de Pagamento');
  const g = { aba: wb.SheetNames[0], linhasBrutas: rows.length - 1, porStatus: {}, pago: 0, importaveis: 0, valorZero: 0, cents: 0, porMes: {}, porForma: {} };
  for (const r of rows.slice(1)) { if (!r.some(c => c != null)) continue; const s = String(r[iS]); g.porStatus[s] = (g.porStatus[s] || 0) + 1; if (s !== 'Pago') continue; g.pago++;
    if (!(typeof r[iV] === 'number' && r[iV] > 0)) { g.valorZero++; continue; }
    const t = String(r[iD]).trim(), m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t), iso = m ? m[3] + '-' + m[2] : t.slice(0, 7); g.porMes[iso] = (g.porMes[iso] || 0) + 1; g.porForma[String(r[iF])] = (g.porForma[String(r[iF])] || 0) + 1; g.importaveis++; g.cents += c100(r[iV]); }
  return g;
}

/* ---------------------------------------------------------------------------------------------------------------------------------------
   0 · ESTÁTICO — nenhuma trava de flag no leitor do FCX › Saídas, selo v15.2.2, Regra de Ouro
   --------------------------------------------------------------------------------------------------------------------------------------- */
{
  const corpo = corta(fcx, 'function importSaidasFile(input){', '/* v14.17 (complemento)'), leitor = corta(fcx, 'function fcxLeitor1522(){', '\n'), importacao = corta(fcx, 'async function fcxImportSaidas152(file){', 'function fcxModelo152'), painel = corta(fcx, 'function fcxPainelSaidas152(){', '\nif(!state._saidaForm)');
  const flag = /fcxV152|Recursos|gestao_v152|g152\b|g151\b|g17\b|fcxV1417|Pagto17\.ativo/;
  chk('Regra de Ouro: contabilidade.html e contabilidade_v1391.html idênticos byte a byte (a41642fb…, ea73d20b…)', md5(fs.readFileSync(path.join(raiz, 'public/contabilidade.html'))).startsWith('a41642fb') && md5(fs.readFileSync(path.join(raiz, 'public/contabilidade_v1391.html'))).startsWith('ea73d20b'));
  chk('1 · importSaidasFile (botão Importar de FCX › Saídas) não consulta flag nenhuma: nem gestao_v152, nem g152/g151/g17, nem Recursos', !flag.test(corpo), corpo.match(flag));
  chk('1 · fcxLeitor1522 (a única condição) só pergunta se os motores existem no painel carregado — sem Recursos, sem flag', !flag.test(leitor) && /Leitor1521/.test(leitor) && /lerArquivo/.test(leitor) && /interpretar/.test(leitor), leitor.match(flag));
  chk('1 · fcxImportSaidas152 (leitura → plano por mês → gravação conferida) e o quadro de conflito (fcxPainelSaidas152) rodam sem flag', !flag.test(importacao) && !/fcxV152\(\)/.test(painel), [importacao.match(flag), painel.match(/fcxV152\(\)/)]);
  chk('1 · o leitor genérico antigo (importSaidasLegado: Data, Conta, Valor) só é chamado quando o arquivo NÃO é baixa de ERP (fcxImportSaidas152 devolveu false) — e nunca depois de uma falha de gravação', (corpo.match(/importSaidasLegado\(/g) || []).length === 1 && /fcxImportSaidas152\(file\)\.then\(ok=>\{ if\(!ok\) importSaidasLegado\(file\); \}\)/.test(corpo) && /pareceERP/.test(importacao));
  chk('1 · a mensagem "Nenhuma linha reconhecida no arquivo (colunas esperadas: Data, Conta, Valor)" só existe dentro do leitor genérico (importSaidasLegado) — o caminho do ERP nunca a emite', (() => { const gen = corta(fcx, 'function importSaidasLegado(file){', 'window.importSaidasFile = importSaidasFile;'), todas = fcx.split('colunas esperadas: Data, Conta, Valor').length - 1, nasGen = gen.split('colunas esperadas: Data, Conta, Valor').length - 1; return todas === nasGen && nasGen === 1 && !/colunas esperadas: Data, Conta, Valor/.test(importacao + corpo); })());
  chk('4 · selo de versão: Recursos.BUILD = "v15.2.2", Recursos.codigo() = o maior entre o código e os recursos liberados, e o selo do cabeçalho mostra o código instalado', /BUILD: 'v15\.2\.2'/.test(html) && /codigo\(\) \{ return this\.maior\(this\.BUILD, this\.atual\(\)\); \}/.test(html) && /badge\(\) \{ const cod = Recursos\.rot\(Recursos\.codigo\(\)\)/.test(html));
  chk('4 · FCX: o Painel e o Netlify servem o mesmo fcx.html (iframe srcdoc via fetch): o arquivo do Artifact é publicado junto (veja o script de entrega) — aqui, marcador v15.2.2 presente', /v15\.2\.2/.test(fcx));
}

/* ---------------------------------------------------------------------------------------------------------------------------------------
   TESTE COM OS ARQUIVOS REAIS ANEXADOS (ARQUIVOS_REAIS=<pasta>): 01-JANEIRO.26.xlsx (ERP Legado) e CTGP_Sállamos.xlsx (ERP Sállamos)
   O recurso gestao_v152 fica DESLIGADO (como na Produção) e a gestao_v1417 também; o leitor tem de funcionar assim mesmo.
   --------------------------------------------------------------------------------------------------------------------------------------- */
const dirReais = process.env.ARQUIVOS_REAIS || path.join(raiz, 'tests/arquivos-reais');
const achar = re => { try { return fs.readdirSync(dirReais).find(n => re.test(n) && /\.xlsx?$/i.test(n)) || null; } catch { return null; } };
const fLeg = achar(/JANEIRO/i), fSal = achar(/CTGP|S[aá]llamos/i), TEM_REAIS = !!(XLSX && fLeg && fSal);
const RESUMO = {};
const NOMES_REAIS = ['arquivos reais · leitura, importação e contagens', 'arquivos reais · um ERP não apaga o mês do outro (jan/2026 preservado)', 'arquivos reais · reimportação do mesmo ERP substitui sem duplicar', 'arquivos reais · sobreposição entre ERPs no mesmo mês é bloqueada e só troca com confirmação', 'arquivos reais · DFC de jan/2026 fecha ao centavo com o OFX (lotes CNAB desdobrados)'];
if (!TEM_REAIS) { for (const n of NOMES_REAIS) pula(n, !XLSX ? 'SheetJS não instalado' : 'defina ARQUIVOS_REAIS=<pasta com 01-JANEIRO.26.xlsx e CTGP_Sállamos.xlsx>'); }
else {
  const bufL = fs.readFileSync(path.join(dirReais, fLeg)), bufS = fs.readFileSync(path.join(dirReais, fSal));
  const gL = gabaritoLegado(bufL), gS = gabaritoSallamos(bufS);
  RESUMO.gabarito = { legado: { aba: gL.aba, linhasNaoVazias: gL.naoVazias, estornadas: gL.estornadas, crediario: gL.crediario, importaveis: gL.importaveis, reais: gL.cents / 100 }, sallamos: { linhas: gS.linhasBrutas, pago: gS.pago, valorZero: gS.valorZero, importaveis: gS.importaveis, reais: gS.cents / 100 } };
  chk('gabarito independente (linhas brutas do Excel, sem o leitor do painel) · Legado: 2.906 linhas, 32 estornadas, 24 crediário → 2.874 títulos; Sállamos: 15.746 "Pago", 15.741 com Valor Pago > 0 (5 de valor zero sem data)', gL.naoVazias === 2906 && gL.estornadas === 32 && gL.crediario === 24 && gL.importaveis === 2874 && gL.semBanco === 0 && gS.pago === 15746 && gS.importaveis === 15741 && gS.valorZero === 5 && gS.linhasBrutas === 16097, [gL, gS]);
  chk('gabarito · a aba PGTO.JANEIRO26 declara um intervalo gigante (A1:AC1048576) mas só tem 2.911 linhas de verdade; AgendaPagto (3.978 linhas) existe e NÃO é a aba lida', /1048576/.test(gL.declarado) && gL.linhasBrutas === 2911 && gL.aba === 'PGTO.JANEIRO26' && gL.abas.includes('AgendaPagto'), gL);

  /* ---- 1 · cada arquivo real, apertando "Importar" com a flag desligada ---- */
  const E = amb152({ g152: false, g17: false }), G = fcxGlue(E);
  chk('ambiente de produção simulado · gestao_v152 desligada, gestao_v1417 desligada, e o leitor do FCX assim mesmo está disponível (fcxV152() = false, fcxLeitor1522() = true)', E.g152 === false && E.g17 === false && G.fcxV152() === false && G.fcxLeitor1522() === true);
  const r1 = await importa(G, arquivoDe(fLeg, bufL)), leg = G.state.saidas.slice();
  const cargaTxt1 = JSON.stringify(r1.carga || {}) + r1.toasts.join(' | ');
  RESUMO.legado = { importadas: leg.length, ms: r1.ms, reais: cents(leg) / 100 };
  chk(`1 · ERP Legado real (${fLeg}): ${leg.length.toLocaleString('pt-BR')} títulos importados (esperado 2.874) em ${r1.ms} ms — com o recurso desligado`, leg.length === 2874 && r1.ms < 30000, [leg.length, r1.ms]);
  chk('1 · …o leitor genérico antigo NÃO foi chamado e a mensagem "Nenhuma linha reconhecida (Data, Conta, Valor)" não apareceu (nem em aviso, nem no relatório de carga)', G.legado.chamadas === 0 && !/Nenhuma linha reconhecida|Data, Conta, Valor/.test(cargaTxt1) && !(r1.carga && r1.carga.erro), [G.legado.chamadas, cargaTxt1.slice(0, 400)]);
  chk('1 · …lida a aba PGTO.JANEIRO26 (AgendaPagto ignorada), modelo ERP Legado, 2.906 linhas lidas, 32 baixas estornadas fora', /PGTO\.JANEIRO26/.test(cargaTxt1) && /AgendaPagto ignorada/.test(cargaTxt1) && /ERP Legado/.test(cargaTxt1), cargaTxt1.slice(0, 700));
  chk('1 · …todos origemModelo "erp_legado", tipo "pago", ids únicos, só 2026-01, nenhum estornado, todos com conta de pagamento do banco', leg.every(s => s.origemModelo === 'erp_legado' && s.tipo === 'pago' && s.contaPagamento && /^2026-01-/.test(s.date) && s.dataPagamento === s.date) && new Set(leg.map(s => s.id)).size === 2874 && !leg.some(s => /estornad/i.test(s.obs || '')));
  chk(`1 · …soma ao centavo igual à do gabarito do Excel: R$ ${(gL.cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${cents(leg)} centavos)`, cents(leg) === gL.cents, [cents(leg), gL.cents]);
  chk('1 · …as formas de pagamento batem com o gabarito (PIX 670 · Boleto 2.145 · Crediário 24 · Depósito 34 · À vista 1) e os 24 crediário vêm marcados (crediario:true)', igual(ordena(contaPor(leg, s => s.formaPagamento)), ordena(gL.porForma)) && leg.filter(s => s.crediario).length === 24, [ordena(contaPor(leg, s => s.formaPagamento)), leg.filter(s => s.crediario).length]);
  const gv = G.state._saidasGravacao, doc = E.banco.docs.get('fcx/esp2:saidas'), noBanco = await gravadas(E);
  chk('1 · …gravação conferida no banco: 2.874 registros, soma igual; a leitura de volta do banco devolve os mesmos 2.874 ids (sem flag: JSON puro, sem compactação z1:)', gv && gv.ok === true && gv.n === 2874 && gv.cents === gL.cents && noBanco.length === 2874 && igual(noBanco.map(s => s.id), leg.map(s => s.id)) && doc.z === undefined, [gv, noBanco.length, doc && doc.z]);

  const r2 = await importa(G, arquivoDe(fSal, bufS)), tudo = G.state.saidas.slice(), sal = tudo.filter(s => s.origemModelo === 'erp_sallamos'), legDepois = tudo.filter(s => s.origemModelo === 'erp_legado');
  const cargaTxt2 = JSON.stringify(r2.carga || {}) + r2.toasts.join(' | ');
  RESUMO.sallamos = { importadas: sal.length, ms: r2.ms, reais: cents(sal) / 100, meses: ordena(contaPor(sal, s => String(s.date).slice(0, 7))) };
  chk(`1 · ERP Sállamos real (${fSal}): ${sal.length.toLocaleString('pt-BR')} títulos pagos importados (15.746 "Pago" − 5 de valor zero sem data = 15.741) em ${r2.ms} ms — com o recurso desligado`, sal.length === 15741 && r2.ms < 60000, [sal.length, r2.ms]);
  chk('1 · …leitor genérico não chamado, sem "Nenhuma linha reconhecida", modelo ERP Sállamos, Sheet1 com 16.097 linhas lidas', G.legado.chamadas === 0 && !/Nenhuma linha reconhecida|Data, Conta, Valor/.test(cargaTxt2) && !(r2.carga && r2.carga.erro) && /ERP Sállamos/.test(cargaTxt2), cargaTxt2.slice(0, 500));
  chk('1 · …só Status "Pago" com Valor Pago > 0: tipo "pago", valor > 0, nenhum Vencido/Renegociado/Previsto/Cancelado/Vinculado (351 fora), ids únicos', sal.every(s => s.tipo === 'pago' && s.valor > 0 && s.origemModelo === 'erp_sallamos') && new Set(sal.map(s => s.id)).size === 15741 && gS.porStatus.Vencido === 165 && gS.porStatus.Renegociado === 107 && gS.porStatus.Previsto === 71 && gS.porStatus.Cancelado === 4 && gS.porStatus.Vinculado === 4);
  chk(`1 · …soma ao centavo igual à do gabarito do Excel: R$ ${(gS.cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}; competências mai–nov/2026 com as mesmas contagens por mês e por forma de pagamento`, cents(sal) === gS.cents && igual(ordena(contaPor(sal, s => String(s.date).slice(0, 7))), ordena(gS.porMes)) && igual(ordena(contaPor(sal, s => s.formaPagamento)), ordena(gS.porForma)) && Object.keys(ordena(gS.porMes)).join() === '2026-05,2026-06,2026-07,2026-08,2026-09,2026-10,2026-11', [cents(sal), gS.cents, ordena(contaPor(sal, s => String(s.date).slice(0, 7)))]);
  const gv2 = G.state._saidasGravacao;
  chk('1 · …gravação conferida: 18.615 registros no banco (2.874 do Legado + 15.741 do Sállamos), leitura de volta idêntica', gv2 && gv2.ok === true && gv2.n === 18615 && (await gravadas(E)).length === 18615 && igual((await gravadas(E)).map(s => s.id).sort(), tudo.map(s => s.id).sort()), [gv2 && gv2.n]);
  const relS = E.Pagto17.interpretar((await E.Pagto17.lerArquivo(arquivoDe(fSal, bufS), XLSX)).sheets, { soBaixas: false, v1521: true }), relL = E.Pagto17.interpretar((await E.Pagto17.lerArquivo(arquivoDe(fLeg, bufL), XLSX)).sheets, { soBaixas: false, v1521: true });
  RESUMO.contagens = { legado: relL.contagem, sallamos: relS.contagem };
  chk('1 · relatório do leitor · Legado: 2.906 lidas, 2.874 importadas, 32 estornadas, 24 crediário (importadas e marcadas); Sállamos: 16.097 lidas, 15.741 importadas, 351 fora por Status ≠ Pago, 5 Pago de valor zero ignoradas', relL.contagem.lidas === 2906 && relL.contagem.importadas === 2874 && relL.contagem.estornadas === 32 && relL.contagem.crediario === 24 && relS.contagem.lidas === 16097 && relS.contagem.importadas === 15741 && relS.contagem.naoPago === 351 && relS.contagem.valorZero === 5, [relL.contagem, relS.contagem]);
  const tempoLeitura = []; { const t = Date.now(); await E.Pagto17.lerArquivo(arquivoDe(fLeg, bufL), XLSX); tempoLeitura.push(Date.now() - t); const u = Date.now(); await E.Pagto17.lerArquivo(arquivoDe(fSal, bufS), XLSX); tempoLeitura.push(Date.now() - u); }
  RESUMO.leituraMs = tempoLeitura;
  chk(`1 · leitura do .xlsx real: ${tempoLeitura[0]} ms (Legado, intervalo declarado de 1 milhão de linhas aparado) e ${tempoLeitura[1]} ms (Sállamos) — antes a aba PGTO levava ~22 s e 444 MB`, tempoLeitura[0] < 15000 && tempoLeitura[1] < 15000, tempoLeitura);
  chk('1 · fallback só para o que não é baixa de ERP: planilha simples "Data;Conta;Valor" (CSV) AINDA vai ao importador genérico (1 chamada); aba PGTO com cabeçalho incompleto NUNCA vai (diagnóstico do que faltou)', await (async () => {
    const E2 = amb152({ g152: false, g17: false }), G2 = fcxGlue(E2); G2.importSaidasFile({ files: [arquivoDe('simples.csv', 'Data;Conta;Valor\n05/01/2026;4.10.06 – Aluguel;100,00\n')], value: 'x' }); await espera(400);
    const chamouSimples = G2.legado.chamadas; const parcial = await importa(G2, arquivoMatriz('PGTO.parcial.xlsx', [aoa('PGTO.JANEIRO26', [['Esposende — títulos'], [], ['Item', 'Pagamento']])]));
    return chamouSimples === 1 && G2.legado.chamadas === 1 && /não reconhecido/i.test(parcial.toasts.join(' ')) && /Item|Vlr|Conta|faltou|coluna|Pagamento/i.test(JSON.stringify(parcial.carga || {}) + parcial.toasts.join(' '));
  })());
  chk('1 · navegador com painel velho (sem o leitor v15.2.2): o FCX avisa para recarregar com Ctrl+F5 e NÃO importa nada pelo leitor genérico', await (async () => {
    const E3 = amb152({ g152: false, g17: false }), G3 = fcxGlue(E3); E3.Leitor1521.interpretar = undefined; G3.importSaidasFile({ files: [arquivoDe(fLeg, bufL)], value: 'x' }); await espera(200);
    return G3.toasts.some(t => /Ctrl\+F5/.test(t)) && G3.legado.chamadas === 0 && G3.state.saidas.length === 0;
  })());
  const matL = (await E.Pagto17.lerArquivo(arquivoDe(fLeg, bufL), XLSX)).sheets, matS = (await E.Pagto17.lerArquivo(arquivoDe(fSal, bufS), XLSX)).sheets;
  console.log('\n— arquivos reais · leitura, importação e contagens —');

  /* ---- 2 · um ERP não apaga o mês do outro ---- */
  chk('2 · importar o Sállamos (mai–nov/2026) NÃO apaga nem altera os 2.874 títulos do Legado de jan/2026: mesmos registros, byte a byte, antes e depois', legDepois.length === 2874 && igual(legDepois, leg) && legDepois.every(s => /^2026-01-/.test(s.date)) && sal.every(s => !/^2026-01-/.test(s.date)), [legDepois.length]);
  chk('2 · …e a ordem inversa (Sállamos primeiro, depois Legado) dá o mesmo conjunto: 18.615 registros sem perder nem duplicar nenhum', await (async () => { const E2 = amb152({ g152: false, g17: false }), G2 = fcxGlue(E2); await importa(G2, arquivoMatriz(fSal, matS)); await importa(G2, arquivoMatriz(fLeg, matL)); return G2.state.saidas.length === 18615 && igual(G2.state.saidas.map(s => s.id).sort(), tudo.map(s => s.id).sort()) && G2.state._saidasPendente152 == null; })());

  /* ---- 3 · reimportação do mesmo ERP ---- */
  { const antes = hash(G.state.saidas.map(s => s.id).sort()), r3 = await importa(G, arquivoDe(fSal, bufS)), r4 = await importa(G, arquivoDe(fLeg, bufL));
    chk('3 · reimportar o mesmo arquivo do Sállamos e do Legado (modo Inteligente por mês) substitui sem duplicar: continuam 18.615 registros, mesmos ids, sem pedir confirmação', G.state.saidas.length === 18615 && hash(G.state.saidas.map(s => s.id).sort()) === antes && G.state._saidasPendente152 == null && G.state._saidasGravacao.ok === true && (await gravadas(E)).length === 18615, [G.state.saidas.length, r3.ms, r4.ms]); }

  /* ---- 4 · sobreposição entre ERPs no mesmo mês ---- */
  const prepara = async () => { const E4 = amb152({ g152: false, g17: false }), G4 = fcxGlue(E4); await importa(G4, arquivoMatriz(fLeg, matL)); await importa(G4, arquivoMatriz(fSal, matS)); G4.state.saidas.push({ id: 'manual-jan', date: '2026-01-20', conta: '4.10.06 – (-) Aluguel de Loja de Rua', centro: 'LOJA 01', tipo: 'previsto', valor: 123.45, fornecedor: 'LANÇAMENTO MANUAL', obs: '' }); return { E4, G4 }; };
  { /* (a) Sállamos com 30 pagamentos redatados para jan/2026, que já tem o Legado */
    const { E4, G4 } = await prepara(), estadoAntes = hash(G4.state.saidas), bancoAntes = hash(await gravadas(E4));
    const rows = matS[0].rows.map(r => r.slice()), H = rows[0].map(x => String(x ?? '').trim()), iS = H.indexOf('Status'), iV = H.indexOf('Valor Pago'), iD = H.indexOf('Data de Pagamento'); let k = 0;
    for (let i = 1; i < rows.length && k < 30; i++) if (String(rows[i][iS]) === 'Pago' && rows[i][iV] > 0) { rows[i][iD] = String(rows[i][iD]).includes('/') ? '15/01/2026' : '2026-01-15'; k++; }
    const r = await importa(G4, arquivoMatriz('CTGP_Sállamos_jan.xlsx', [{ nome: matS[0].nome, rows }])), pd = G4.state._saidasPendente152, rr = pd && pd.plano.relatorio, painel = G4.fcxPainelSaidas152();
    chk('4 · Sállamos com 30 pagamentos em jan/2026 (mês que já tem o Legado): importação PARADA no quadro de confirmação, com alerta explícito "Sobreposição entre ERPs bloqueada" (2.874 lançamentos do ERP Legado × 30 do ERP Sállamos)', !!pd && rr.conflitos.length === 1 && rr.conflitos[0].mes === '2026-01' && rr.conflitos[0].n === 2874 && rr.conflitos[0].noArquivo.n === 30 && /Legado/.test(rr.conflitos[0].rotuloOutra) && rr.bloqueados === 30 && /id="sobreposicao152"/.test(painel) && /Sobreposição entre ERPs bloqueada/.test(painel) && /btnSubstituir152/.test(painel), [rr && rr.conflitos, painel.slice(0, 300)]);
    chk('4 · …enquanto não há confirmação NADA muda: nem a tela (estado idêntico, 18.616 com o manual) nem o banco (mesmo conteúdo, 18.615 registros)', hash(G4.state.saidas) === estadoAntes && hash(await gravadas(E4)) === bancoAntes && (await gravadas(E4)).length === 18615, [G4.state.saidas.length]);
    /* (a1) gravar só os meses sem conflito: jan do Legado fica intacto, os 30 títulos de jan NÃO entram */
    const legAntes = G4.state.saidas.filter(s => s.origemModelo === 'erp_legado'); G4.confirmarImportacaoSaidas152(); await esperaAte(() => !G4.state._saidasPendente152);
    const aposLivres = G4.state.saidas, gAposLivres = G4.state._saidasGravacao;
    chk('4 · "Gravar só os meses sem conflito": jan/2026 do Legado intacto (2.874, idênticos), os 30 títulos redatados NÃO entram, o lançamento manual de jan fica, e os outros meses do Sállamos são regravados (15.711)', igual(aposLivres.filter(s => s.origemModelo === 'erp_legado'), legAntes) && !aposLivres.some(s => s.origemModelo === 'erp_sallamos' && /^2026-01-/.test(s.date)) && aposLivres.some(s => s.id === 'manual-jan') && aposLivres.filter(s => s.origemModelo === 'erp_sallamos').length === 15711 && gAposLivres.ok === true && /(não gravados|NÃO gravados)/i.test(JSON.stringify(G4.cargas[G4.cargas.length - 1])), [aposLivres.length, aposLivres.filter(s => s.origemModelo === 'erp_sallamos').length]); }
  { /* (b) substituição consciente: o usuário confirma trocar o Legado de jan pelo Sállamos */
    const { E4, G4 } = await prepara(); const rows = matS[0].rows.map(r => r.slice()), H = rows[0].map(x => String(x ?? '').trim()), iS = H.indexOf('Status'), iV = H.indexOf('Valor Pago'), iD = H.indexOf('Data de Pagamento'); let k = 0;
    for (let i = 1; i < rows.length && k < 30; i++) if (String(rows[i][iS]) === 'Pago' && rows[i][iV] > 0) { rows[i][iD] = String(rows[i][iD]).includes('/') ? '15/01/2026' : '2026-01-15'; k++; }
    await importa(G4, arquivoMatriz('CTGP_Sállamos_jan.xlsx', [{ nome: matS[0].nome, rows }])); G4.substituirConflitoSaidas152(); const painel = G4.fcxPainelSaidas152();
    chk('4 · "Substituir Legado em 01/2026…": o painel muda para o aviso vermelho "Substituição entre ERPs — confirme com atenção" (os 2.874 serão APAGADOS e trocados pelos 30) com botão próprio de confirmação — nada gravado ainda', /Substituição entre ERPs — confirme com atenção/.test(painel) && /btnConfirmarSubst152/.test(painel) && G4.state.saidas.filter(s => s.origemModelo === 'erp_legado').length === 2874, painel.slice(0, 300));
    G4.confirmarImportacaoSaidas152(); await esperaAte(() => !G4.state._saidasPendente152); const jan = G4.state.saidas.filter(s => /^2026-01-/.test(s.date));
    chk('4 · …depois de confirmar: jan/2026 passa a ter só os 30 do Sállamos (Legado apagado) + o lançamento manual, que nunca é tocado; gravação conferida no banco', jan.filter(s => s.origemModelo === 'erp_sallamos').length === 30 && !jan.some(s => s.origemModelo === 'erp_legado') && jan.some(s => s.id === 'manual-jan') && G4.state._saidasGravacao.ok === true && (await gravadas(E4)).filter(s => s.origemModelo === 'erp_legado').length === 0, [jan.length]); }
  { /* (c) sentido inverso: base só com o Sállamos; o Legado chega com datas em jun/2026 */
    const E5 = amb152({ g152: false, g17: false }), G5 = fcxGlue(E5); await importa(G5, arquivoMatriz(fSal, matS)); const antes = hash(G5.state.saidas), bancoN = (await gravadas(E5)).length;
    const rows = matL[matL.findIndex(s => /^PGTO/i.test(s.nome))].rows.map(r => r.slice()), hi = rows.findIndex(r => r.some(c => String(c ?? '').trim() === 'Vlr Líquido')), iP = rows[hi].findIndex(c => String(c ?? '').trim() === 'Pagamento');
    for (let i = hi + 1; i < rows.length; i++) if (rows[i][iP] instanceof Date) rows[i][iP] = new Date(2026, 5, Math.min(28, rows[i][iP].getDate()), 12, 0, 0);
    await importa(G5, arquivoMatriz('01-JANEIRO.26_em_junho.xlsx', [{ nome: 'PGTO.JANEIRO26', rows }])); const pd = G5.state._saidasPendente152, rr = pd && pd.plano.relatorio;
    chk('4 · sentido inverso: Legado com datas em jun/2026 numa base que já tem o Sállamos de junho → sobreposição bloqueada com alerta (ERP Sállamos × ERP Legado, 2.874 títulos parados), nada gravado até confirmar', !!pd && rr.conflitos.length === 1 && rr.conflitos[0].mes === '2026-06' && /Sállamos/.test(rr.conflitos[0].rotuloOutra) && rr.bloqueados === 2874 && /Sobreposição entre ERPs bloqueada/.test(G5.fcxPainelSaidas152()) && hash(G5.state.saidas) === antes && (await gravadas(E5)).length === bancoN, [rr && rr.conflitos, rr && rr.bloqueados]); }
  console.log('\n— arquivos reais · um ERP não apaga o mês do outro (jan/2026 preservado) —');
  console.log('\n— arquivos reais · reimportação do mesmo ERP substitui sem duplicar —');
  console.log('\n— arquivos reais · sobreposição entre ERPs no mesmo mês é bloqueada e só troca com confirmação —');

  /* ---- 5 · DFC de jan/2026: lotes CNAB desdobrados fechando ao centavo com o OFX ---- */
  const catsSoma = c => Object.values(c.porCategoria).reduce((s, x) => s + c100(x.valor), 0), lista = l => l.reduce((s, x) => s + c100(x.valor), 0), noMes = (l, m) => l.filter(t => String(t.data).startsWith(m));
  const dfcMes = (E5, mes, desd = true) => { const regras = E5.DFC.regras(), trs = noMes(desd ? E5.FluxoDFC.transacoesDFC() : E5.FluxoDFC.transacoes(), mes); return { trs, c: E5.DFC.consolidar(trs, regras) }; };
  const titulos = leg.slice(); // os 2.874 títulos reais de jan/2026, como o painel os gravou
  const mapaConta = { 'ESPOSENDE - SANTANDER': 'ct-esp', 'MAR ABERTO - SANTANDER': 'ct-mar' }, grupos = new Map();
  for (const s of titulos) { if (s.crediario || !mapaConta[s.contaPagamento]) continue; const kk = s.contaPagamento + '|' + s.dataPagamento, g = grupos.get(kk) || { conta: s.contaPagamento, data: s.dataPagamento, cents: 0, n: 0 }; g.cents += c100(s.valor); g.n++; grupos.set(kk, g); }
  const ofx = ['ct-esp', 'ct-mar'].map((cid, j) => { const trs = []; let i = 0; for (const g of grupos.values()) if (mapaConta[g.conta] === cid) trs.push({ id: cid + '-l' + (i++), data: g.data, valor: -g.cents / 100, hist: 'PAGTO FORNECEDORES CNAB ' + g.data.slice(8) + g.data.slice(5, 7), isLoteCnab: true });
    trs.push({ id: cid + '-r0', data: '2026-01-05', valor: 1500000.55 + j, hist: 'RECEBIMENTO CARTOES' }, { id: cid + '-tf', data: '2026-01-07', valor: -123.45, hist: 'TARIFA BANCARIA' }, { id: cid + '-rd', data: '2026-01-20', valor: 310.05, hist: 'RENDIMENTO APLICACAO' }); return { id: 'd-' + cid, contaId: cid, mes: '2026-01', transacoes: trs }; });
  const nLotes = ofx.flatMap(d => d.transacoes).filter(t => t.isLoteCnab).length, SOMA_OFX = ofx.flatMap(d => d.transacoes).reduce((s, t) => s + c100(t.valor), 0), semCred = titulos.filter(s => !s.crediario && mapaConta[s.contaPagamento]), centsLotes = grupos.size && [...grupos.values()].reduce((s, g) => s + g.cents, 0);
  RESUMO.ofx = { lotes: nLotes, titulosNosLotes: semCred.length, creditoForaDosLotes: titulos.filter(s => s.crediario).length, outrosBancos: titulos.filter(s => !s.crediario && !mapaConta[s.contaPagamento]).length, somaOfxReais: SOMA_OFX / 100 };
  for (const [rot, g152] of [['com a v15.2 ligada (prova interna por mês)', true], ['com a v15.2 desligada (como na Produção hoje)', false]]) {
    const E6 = amb152({ ext: ofx, saidas: titulos, g152, g17: true }); await E6.FluxoDFC.garantirCnab17(true);
    const F = E6.FluxoDFC, p = F.planoCnab17(), antes = dfcMes(E6, '2026-01', false), depois = dfcMes(E6, '2026-01', true), bruto = noMes(F.transacoes(), '2026-01');
    const alocados = p.lotes.reduce((s, l) => s + l.alocs.reduce((a, x) => a + x.cents, 0), 0), usados = p.lotes.flatMap(l => l.alocs.map(x => x.x.s));
    const saidasBanco = l => l.filter(t => t.valor < 0).reduce((s, t) => s + c100(t.valor), 0), entradasBanco = l => l.filter(t => t.valor > 0).reduce((s, t) => s + c100(t.valor), 0);
    RESUMO['dfc_' + (g152 ? 'v152' : 'v1417')] = { lotesDesdobrados: p.lotes.length, linhasVirtuais: depois.trs.length - bruto.length, somaCategoriasCentavos: catsSoma(depois.c), somaOfxCentavos: SOMA_OFX, realocadoReais: p.resumo.valorRealocado };
    chk(`5 · DFC jan/2026 ${rot} · ${nLotes} lotes CNAB do OFX (um por banco e dia) abatidos pelos ${semCred.length.toLocaleString('pt-BR')} títulos reais: todos desdobrados, resto zero, integridade do plano OK`, p.integridade.ok && p.lotes.length === nLotes && p.aplicaveis.length === nLotes && p.lotes.every(l => l.aloc === l.cap) && alocados === centsLotes && (!p.mesesReprovados || p.mesesReprovados.length === 0), [p.resumo, p.integridade, p.lotes.length, nLotes, p.mesesReprovados]);
    chk(`5 · …PROVA AO CENTAVO · Σ(categorias da DFC após o desdobramento) = Σ(lançamentos do OFX) = ${SOMA_OFX} centavos (antes do desdobramento já fechava; depois também)`, lista(bruto) === SOMA_OFX && catsSoma(antes.c) === SOMA_OFX && catsSoma(depois.c) === SOMA_OFX && lista(depois.trs) === SOMA_OFX && depois.trs.length > bruto.length, [lista(bruto), catsSoma(antes.c), catsSoma(depois.c), SOMA_OFX]);
    chk('5 · …Total de Saídas do Banco, Total de Entradas e variação do mês idênticos antes e depois; o Caixa Líquido de cada grupo não muda (só se reclassifica DENTRO das saídas)', saidasBanco(depois.trs) === saidasBanco(bruto) && entradasBanco(depois.trs) === entradasBanco(bruto) && lista(depois.trs) === lista(bruto) && c100(depois.c.saidas) === c100(antes.c.saidas) && c100(depois.c.entradas) === c100(antes.c.entradas) && c100(depois.c.liquido) === c100(antes.c.liquido), [saidasBanco(depois.trs), saidasBanco(bruto)]);
    chk('5 · …os 24 títulos de crediário (e os 2 do outro banco, sem extrato) NUNCA entram em lote CNAB: nenhum título usado no desdobramento é crediário', usados.length === semCred.length && !usados.some(s => s.crediario) && new Set(usados.map(s => s.id)).size === usados.length, [usados.length, semCred.length]);
    if (g152) { const pv = p.provasMes.get('2026-01'); chk('5 · …prova interna do motor (por mês, em centavos): Σ extrato = Σ categorias', !!pv && pv.extratoCents === SOMA_OFX && pv.categoriasCents === SOMA_OFX, pv); }
  }
  console.log('\n— arquivos reais · DFC de jan/2026 fecha ao centavo com o OFX (lotes CNAB desdobrados) —');
}

if (globalThis.__pool152) await globalThis.__pool152.end();
if (TEM_REAIS) console.log('\nRESUMO DOS ARQUIVOS REAIS: ' + JSON.stringify(RESUMO, null, 1));
console.log(`\n${OK.length} ok · ${FAIL.length} falha(s) · ${PULOU.length} pulado(s)`);
if (FAIL.length) { console.log('FALHAS:\n - ' + FAIL.join('\n - ')); process.exit(1); }
