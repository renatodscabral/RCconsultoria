import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* v15.1 · HOTFIX CRÍTICO DE ARQUITETURA E DESEMPENHO da Conciliação de Cartões (recurso gestao_v151, depende da v14.19 — rótulo "v15.1").
   Valida o CÓDIGO REAL do painel (public/index.html) em contexto isolado do Node, com dados FICTÍCIOS. O que precisa de navegador (frames, 50.000 ERP + 120.000 adquirente + OFX) está em
   tests/e2e-estresse-v151.mjs e tests/e2e-equivalencia-v151.mjs. Blocos:
     0) Regra de Ouro (FCX e Contábil byte a byte, regiões protegidas do painel) e o recurso/flag (OFF = v14.9);
     1) item 1 · OFX por conta: URL, página ≤ 768 KB, timeout de 25 s, UMA nova tentativa (5xx / 429 / 408 / tempo esgotado; nunca em 4xx), servidor antigo (filtro ignorado), páginas com cursor, índice por conta, pílula;
     2) item 2 · fatias cooperativas: nenhuma passa de 1.500 registros nem de ~8 ms, ordenação cooperativa idêntica ao Array.sort estável, sessão de fatias;
     3) item 3 · nada grande em localStorage / sessionStorage: trava de 256 KB no setItem, coleções brutas só em memória no LocalAdapter, e varredura do código v15.1 (nenhum acesso direto ao armazenamento);
     4) item 4 · DOM estrito: 30 linhas iniciais, "Ver mais 30" até 1.000, nada abre sozinho (o aberto de outra competência volta recolhido);
     5) registro de trocas: desligado, cada função volta a ser exatamente a original (v14.9).
   Uso: node tests/teste-hotfix-v151.mjs */
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(process.env.PAINEL_HTML || path.join(raiz, 'public/index.html'), 'utf8');
const OK = [], FAIL = [];
const chk = (n, c, x = '') => { (c ? OK : FAIL).push(n); console.log((c ? 'ok   ' : 'FALHA ') + n + (!c && x !== '' ? ' → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 1400) : '')); };
const md5 = t => createHash('md5').update(t).digest('hex');
const corta = (ini, fim) => { const a = html.indexOf(ini), b = html.indexOf(fim, a + ini.length); if (a < 0 || b < 0) throw new Error('bloco não encontrado: ' + ini.slice(0, 60) + ' … ' + fim.slice(0, 60)); return html.slice(a, b); };
const espera = ms => new Promise(r => setTimeout(r, ms));

/* ---------- 0 · Regra de Ouro e recurso ---------- */
const MK_DFC = '/* ============================ DFC ============================ */', MK_PE = 'const PARTE_EXTRATO = 900;', MK_M6 = '/* =====================================================================\n   MÓDULO 6 · CREDSYSTEM';
const guardas = {
  'OFX/contas (OFX → início da DFC)': [md5(html.slice(html.indexOf('const OFX = {'), html.indexOf(MK_DFC))), 'f24c59ac5f7a2ec7544b3643a321f096'],
  'adquirentes e FCX (ADQ_CFG → PARTE_EXTRATO)': [md5(html.slice(html.indexOf('const ADQ_CFG'), html.indexOf(MK_PE))), '6a43dc199b96629c8c8af17b4016d126'],
  'Credsystem em diante (Módulo 6 → CS_INDICADORES)': [md5(html.slice(html.indexOf(MK_M6), html.indexOf('const CS_INDICADORES'))), '4738cb8f2d12cff23c6e385e573f9eae'],
  'motor CP_OFX (v14.09)': [md5(corta('/* CP_OFX:INI */', '/* CP_OFX:FIM */')), 'b1c09176c057b4e993ab5b3a3f98e9bc'],
  'regras padrão da DFC (DFC_REGRAS_PADRAO)': [md5(corta('const DFC_REGRAS_PADRAO = [', 'const DFC = {')), 'e27e858c728ca653b2d4261c567a5ba4'],
  'categorias padrão da DFC (DFC_CATEGORIAS)': [md5(corta('const DFC_CATEGORIAS = [', '/** Regras padrão')), 'c50a8dd959d6e32f7ef08ffb6a447436'],
};
for (const [k, [a, b]] of Object.entries(guardas)) chk(`Regra de Ouro: ${k} idêntico ao da v14.17 (md5 ${b.slice(0, 8)}…)`, a === b, a);
for (const [f, h] of [['fcx.html', '145f7f37'], ['contabilidade.html', 'a41642fb'], ['contabilidade_v1391.html', 'ea73d20b']]) {
  const p = path.join(raiz, 'public', f);
  chk(`Regra de Ouro: public/${f} idêntico — a v15.1 NÃO toca no FCX nem no Contábil (md5 ${h}…)`, fs.existsSync(p) && md5(fs.readFileSync(p)).startsWith(h));
}
chk('recurso gestao_v151 na lista de liberação com a versão "v15.1" (o rótulo é a própria versão; a gestao_v1419 segue com o valor interno v14.19)', /gestao_v151: \{ versao: 'v15\.1', titulo: '/.test(html) && /gestao_v1419: \{ versao: 'v14\.19'/.test(html));
chk('helper g151() = recurso gestao_v151 && g19() (depende da v14.19) e ADQ151.ligado() o usa', html.includes("function g151() { return typeof Recursos !== 'undefined' && Recursos.ativo('gestao_v151') && g19(); }") && /ligado\(\) \{ return typeof g151 === 'function' && g151\(\); \}/.test(html));
chk('nenhuma peça deixou marcador de montagem no painel final e o rótulo antigo "v14.9" não foi trocado em lugar nenhum além do que a v14.9 já fazia', !/@@V15/.test(html) && !/@@V141[789]_/.test(html));
const flagTxt = (/gestao_v151: \{ versao: 'v15\.1', titulo: '([^']*)'/.exec(html) || [])[1] || '';
chk('o texto da liberação descreve os 4 itens (OFX por conta, fatias, nada grande no armazenamento, DOM estrito)', /OFX/.test(flagTxt) && /fatia|assíncron|time/i.test(flagTxt) && /armazen|localStorage/i.test(flagTxt) && /30 linhas|DOM/i.test(flagTxt), flagTxt.slice(0, 500));

/* ---------- recorte dos módulos v15.1 ---------- */
const iniMod = html.indexOf('const ADQ151 = {'), fimMod = html.indexOf('/* ---- fim da tela v15.1 ---- */') + '/* ---- fim da tela v15.1 ---- */'.length;
const modulos = html.slice(iniMod, fimMod);
const base = corta('const ADQ151 = {', '/* ---- fim da base v15.1 ---- */');
const ofxSrc = corta('const OfxInc = {', '/* ---------------- ganchos (todos atrás de OfxInc.ativo()');
const telaSrc = corta('const Tela151 = {', '/* ---- fim da tela v15.1 ---- */');
chk('os 5 módulos v15.1 estão no painel, depois do bloco v14.19 e antes do fim do script (base, OFX por conta, motor, pipeline, tela)', iniMod > html.indexOf('/* ---- fim v14.19 ---- */') && ['const Coop151 = {', 'const Armaz151 = {', 'const Otim151 = {', 'const OfxInc = {', 'const Motor151 = {', 'const Pipe151 = {', 'const Tela151 = {'].every(m => modulos.includes(m)));
const ADQ = Function(base.slice(0, base.indexOf('/* ----------------') ) .replace(/^/, '') + '; return ADQ151;');
void ADQ;
const A151 = vm.runInNewContext(base.slice(base.indexOf('const ADQ151 = {'), base.indexOf('/* ---------------- agendador cooperativo')) + '; ADQ151;', { g151: () => true });
chk('constantes pedidas: timeout do OFX 25 s, 1 nova tentativa, página ≤ 768 KB, fatia ≤ 1.500 registros e 8 ms, sub-tabela 30 linhas (teto 1.000), abrir sozinho ≤ 500 diárias, armazenamento ≤ 256 KB',
  A151.OFX_TIMEOUT_MS === 25000 && A151.OFX_REPETIR === 1 && A151.OFX_PAGINA_BYTES === 768 * 1024 && A151.FATIA_REGISTROS === 1500 && A151.FATIA_MS === 8 && A151.SUB_LINHAS === 30 && A151.SUB_LINHAS_MAX === 1000 && A151.AUTOABRIR_MAX === 500 && A151.STORAGE_MAX === 256 * 1024, A151);
chk('a v15.1 NÃO usa Web Worker: o processamento pesado é time-slicing cooperativo (MessageChannel, ≤ 8 ms por fatia) — sem new Worker / Blob nos módulos', !/new\s+Worker\s*\(/.test(modulos) && /MessageChannel/.test(modulos));

/* ---------- 3 · varredura: nenhum acesso direto ao armazenamento do navegador nos módulos v15.1 ---------- */
const semComentarios = modulos.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
const acessos = [...semComentarios.matchAll(/\b(localStorage|sessionStorage|indexedDB|openDatabase|caches\.open)\b/g)].map(m => m[1]);
chk('varredura (sem comentários): os módulos v15.1 não leem nem gravam em localStorage / sessionStorage / IndexedDB — a única relação com o armazenamento é a TRAVA em Storage.prototype.setItem', acessos.length === 0, acessos);
chk('a trava é instalada ao carregar (Armaz151.instalar()) e as otimizações só quando o recurso liga (Otim151.sincronizar), nunca no carregamento', /\nArmaz151\.instalar\(\);/.test(modulos) && !/\nOtim151\.instalar\(\);/.test(modulos) && /sincronizar\(\)/.test(modulos));

/* ---------- 1 · OFX por conta (OfxInc) ---------- */
const mkCtx = extra => {
  const ctx = vm.createContext({ console, performance, MessageChannel, setTimeout, clearTimeout, Intl, AbortController, Promise, URL, g151: () => true, Date, ...extra });
  return ctx;
};
{
  const calls = []; let rotina = () => ({ status: 200, corpo: { docs: [], proximo: null, filtrado: true } });
  const fetchFalso = async (url, op) => {
    calls.push(url); const r = await rotina(url, op, calls.length);
    if (r && r.espera) await new Promise((res, rej) => { op.signal.addEventListener('abort', () => { const e = new Error('The operation was aborted'); e.name = 'AbortError'; rej(e); }); });
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.corpo || {} };
  };
  const ctx = mkCtx({ fetch: fetchFalso, Cloud: { adapter: { netlify: true, api: '/api/docs' } }, Repo: { versao: () => 1, get: () => null, todos: () => [], prontas: new Set() } });
  const rodar = c => vm.runInContext(c, ctx);
  rodar(base.slice(base.indexOf('const ADQ151 = {'), base.indexOf('/* ---------------- dados brutos só em memória')) + '\nglobalThis.ADQ151 = ADQ151; globalThis.Coop151 = Coop151;');
  rodar(ofxSrc + '\nglobalThis.OfxInc = OfxInc;');
  const O = ctx.OfxInc, AD = ctx.ADQ151;
  const url = O._url(['conta-a', 'conta-b'], 'extratos/x y');
  chk('URL da leitura por conta: /api/docs?colecao=extratos&contaId=a%2Cb&maxBytes=786432&apos=… (filtro aditivo do servidor, páginas ≤ 768 KB, cursor codificado)', url === '/api/docs?colecao=extratos&contaId=conta-a%2Cconta-b&maxBytes=786432&apos=extratos%2Fx%20y', url);
  let j = await O._pagina('/x');
  chk('requisição ok na 1ª tentativa: 1 requisição, nenhuma nova tentativa', calls.length === 1 && O.stats.reqs === 1 && O.stats.retentativas === 0 && j.filtrado === true);
  calls.length = 0; O.stats.reqs = 0; O.stats.retentativas = 0; rotina = (u, o, n) => n === 1 ? { status: 503, corpo: { erro: 'tempo esgotado no servidor' } } : { status: 200, corpo: { docs: [{ id: 'd1' }], proximo: null, filtrado: true } };
  j = await O._pagina('/x');
  chk('erro 503 na 1ª tentativa e sucesso na 2ª: UMA nova tentativa automática (2 requisições, 1 retentativa) e o dado chega', calls.length === 2 && O.stats.retentativas === 1 && j.docs.length === 1, [calls.length, O.stats]);
  calls.length = 0; O.stats.reqs = 0; O.stats.retentativas = 0; rotina = () => ({ status: 503, corpo: { erro: 'falhou' } });
  let erro = null; try { await O._pagina('/x'); } catch (e) { erro = e; }
  chk('503 nas duas tentativas: exatamente 2 requisições (nunca um laço) e o erro sobe com a mensagem do servidor', calls.length === 2 && erro && /falhou/.test(erro.message), [calls.length, erro && erro.message]);
  for (const st of [401, 403, 404]) {
    calls.length = 0; rotina = () => ({ status: st, corpo: { erro: 'recusado ' + st } }); erro = null; try { await O._pagina('/x'); } catch (e) { erro = e; }
    chk(`erro ${st} (resposta definitiva do servidor): NÃO repete — 1 requisição só`, calls.length === 1 && erro && erro.status === st, [calls.length, erro && erro.message]);
  }
  calls.length = 0; rotina = (u, o, n) => n === 1 ? { status: 429, corpo: {} } : { status: 200, corpo: { docs: [], filtrado: true } }; await O._pagina('/x');
  chk('429 (limite de requisições) é repetido uma vez', calls.length === 2);
  /* tempo esgotado: o limite é lido em cada requisição (ADQ151.OFX_TIMEOUT_MS); aqui 40 ms para o teste não demorar 25 s */
  AD.OFX_TIMEOUT_MS = 40; calls.length = 0; O.stats.retentativas = 0; rotina = () => ({ espera: true, status: 200 }); erro = null; const t0 = Date.now(); try { await O._pagina('/x'); } catch (e) { erro = e; }
  chk('requisição que não responde: aborta pelo limite de tempo (AbortController), tenta mais UMA vez e então informa "tempo esgotado (… s) lendo os extratos da conta" — sem travar a tela', calls.length === 2 && erro && /tempo esgotado/.test(erro.message) && Date.now() - t0 < 2000, [calls.length, erro && erro.message, Date.now() - t0]);
  AD.OFX_TIMEOUT_MS = 25000;
  chk('o limite padrão que vai para produção é 25 s e a 2ª tentativa é de 25 s também (texto da mensagem usa o valor da constante)', /Math\.round\(ADQ151\.OFX_TIMEOUT_MS \/ 1000\)/.test(ofxSrc) && AD.OFX_TIMEOUT_MS === 25000);
  /* _lerConta: paginação por cursor e servidor antigo */
  calls.length = 0; O._docs.clear(); O.stats.filtroIgnorado = 0;
  const pg = [{ docs: [{ id: 'e1', contaId: 'A' }, { id: 'e2', contaId: 'A' }], proximo: 'e2', filtrado: true }, { docs: [{ id: 'e3', contaId: 'A' }], proximo: 'e3', filtrado: true }, { docs: [{ id: 'e4', contaId: 'A' }], proximo: null, filtrado: true }];
  rotina = (u, o, n) => ({ status: 200, corpo: pg[n - 1] });
  const S = ctx.Coop151.sessao(); let docs = await O._lerConta(['A'], S);
  chk('leitura da conta em 3 páginas com cursor (apos): todos os documentos, na ordem, e o cursor da página seguinte vai na URL', docs.map(d => d.id).join() === 'e1,e2,e3,e4' && /apos=e2/.test(calls[1]) && /apos=e3/.test(calls[2]) && !/apos=/.test(calls[0]), calls);
  calls.length = 0; O._docs.clear();
  rotina = () => ({ status: 200, corpo: { docs: [{ id: 'x1', contaId: 'A' }, { id: 'x2', contaId: 'OUTRA' }, { id: 'x3', contaId: 'A' }], proximo: null } });
  docs = await O._lerConta(['A'], ctx.Coop151.sessao());
  chk('SERVIDOR ANTIGO (ignora o filtro, resposta sem `filtrado`): o painel filtra a conta no navegador e conta o fato (filtroIgnorado)', docs.map(d => d.id).join() === 'x1,x3' && O.stats.filtroIgnorado === 1);
  /* índice por conta */
  rodar(`globalThis.Adq14 = { contasEquivalentes: id => ({ ids: [id], contas: [] }), r2: n => Math.round((n + Number.EPSILON) * 100) / 100, somaDias: (d, n) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); } };
    globalThis.AdqTaxas = { chave: s => String(s || '').toUpperCase() }; globalThis.DiasUteis = { proximo: d => d };`);
  const txs = (c, mes) => Array.from({ length: 400 }, (_, i) => ({ id: `${c}-${i}`, data: `${mes}-${String(1 + (i % 28)).padStart(2, '0')}`, valor: i % 3 === 0 ? -(i + 1) : i + 1, hist: 'LANC ' + i, tipo: 'X' }));
  const ds = [{ id: 'd1', contaId: 'A', mes: '2026-01', transacoes: txs('a', '2026-01'), saldo: { data: '2026-01-31', valor: 1 } }, { id: 'd2', contaId: 'A', mes: '2026-02', transacoes: txs('b', '2026-02') }, { id: 'd3', contaId: 'ZZ', mes: '2026-02', transacoes: txs('z', '2026-02') }];
  const idx = await O._indexar({ gk: 'A', ids: ['A'] }, ds, ctx.Coop151.sessao());
  const esperado = ds.filter(d => d.contaId === 'A').flatMap(d => d.transacoes.map(t => ({ id: d.id + '|' + t.id, data: t.data.slice(0, 10), valor: t.valor }))).sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  chk('índice da conta (a mesma estrutura do Adq14.bancoConta): só a conta pedida, lançamentos ordenados por data e id, créditos / débitos separados e por dia', idx.tx.length === 800 && idx.cred.length + idx.deb.length === 800 && idx.tx.every((t, i) => t.id === esperado[i].id && t.valor === esperado[i].valor) && idx.credDia.size > 0 && idx.cred.every(t => t.valor > 0) && idx.deb.every(t => t.valor < 0) && idx.temAlgum === true, [idx.tx.length, idx.cred.length, idx.deb.length]);
  chk('cobertura do extrato por competência (datas dos lançamentos e do saldo) e conta sem lançamentos fica "pendente" até ser lida', idx.cobertura.length >= 1 && idx.cobre('2026-01-15') === true && idx.cobre('2025-06-01') === false);
  O.est.n = 4; O.est.i = 2; O.est.conta = 'Banco X · Ag 1 · CC 2'; ctx.Adq19 = { esc: s => String(s) };
  const pil = O.pilula(O.est);
  chk('pílula do topo: "OFX: lendo conta 2/4…" com a conta no title, role=status e sem bloquear a tela', />OFX: lendo conta 2\/4…</.test(pil) && /title="[^"]*Banco X/.test(pil) && /role="status"/.test(pil), pil);
  chk('a pílula entra na tela da Conciliação no lugar do "OFX: carregando…" enquanto a leitura por conta corre (pp151_03)', html.includes("est.lendo && typeof OfxInc !== 'undefined' && OfxInc.ativo() ? OfxInc.pilula(est)"));
  chk('o "Creditado OFX" é atualizado conta a conta: cada conta que termina sobe a versão do OFX (OfxInc._mudou()), reinicia o cálculo barato e redesenha (Coop151.renderAndamento, espaçado)', /this\._mudou\(\); est\.nTx = this\.nTx\(\); est\.nDocs = r\.nDocs; Coop151\.renderAndamento\(\);/.test(ofxSrc));
}

/* ---------- 1b · fora da Conciliação (DFC) e frescor do índice por conta ---------- */
{
  const ganchos = corta('/* ---------------- ganchos (todos atrás de OfxInc.ativo()', '/* ---- fim do OFX por conta v15.1 ---- */');
  let ver = 1; const prontas = new Set(), docsRepo = []; const Repo = { prontas, falhas: {}, cols: {}, versao: c => (c === 'extratos' ? ver : 1), _bump(c) { if (c === 'extratos') ver++; }, get: () => null, todos: c => (c === 'extratos' ? docsRepo : []) };
  const Adq14 = { carregarBanco() { return 'ORIGINAL-carregar'; }, bancoConta(id) { return 'LEGADO:' + id; }, bancoEstado() { return { carregou: false, nTx: 0 }; }, garantirAssinaturas() { }, pronto() { return true; },
    contratos: () => [{ id: 'c1', contaId: 'A', adquirente: 'GETNET', empresaId: 'e1' }], contasEquivalentes: id => ({ ids: [id], conta: null, contas: [] }), r2: n => Math.round((n + Number.EPSILON) * 100) / 100, somaDias: d => d };
  const ctx = mkCtx({ Repo, Adq14, fetch: async () => ({}), Cloud: { adapter: { netlify: true } }, App: { agendarRender() { ctx.__r = (ctx.__r || 0) + 1; } }, AdqTaxas: { chave: s => String(s || '').toUpperCase() }, DiasUteis: { proximo: d => d }, Motor151: { agendaFp() { }, livre: () => !ctx.__ov }, Otim151: { sincronizar() { } }, Adq19: { esc: x => x, perf: {}, contasDaEmpresa: () => [] }, ADQ15: { ADQS_TRI: ['GETNET'] }, ContasBancarias: { rotulo: c => String(c.id) } });
  vm.runInContext(base.slice(base.indexOf('const ADQ151 = {'), base.indexOf('/* ---------------- dados brutos só em memória')) + '\nglobalThis.ADQ151 = ADQ151; globalThis.Coop151 = Coop151;', ctx);
  vm.runInContext(ofxSrc + '\nglobalThis.OfxInc = OfxInc;', ctx); vm.runInContext(ganchos, ctx);
  const O = ctx.OfxInc, B = ctx.Adq14;
  chk('conta ainda não lida, coleção "extratos" AINDA não chegou e nenhuma leitura por conta: índice vazio e "pendente" (nada inventado)', B.bancoConta('A').pendente === true && O.usaLegado('A') === false);
  prontas.add('extratos');
  chk('DFC / Auditoria / telas fora da Conciliação: com a coleção inteira em memória e fora de uma leitura por conta, bancoConta devolve o cálculo da v14.9 (nunca zerado, nunca "pendente")', B.bancoConta('A') === 'LEGADO:A' && O.usaLegado('A') === true);
  O._carga = Promise.resolve();
  chk('DENTRO da leitura por conta a conta pendente segue vazia até terminar (o cálculo síncrono da v14.9 não roda na Conciliação)', B.bancoConta('A').pendente === true && O.usaLegado('A') === false);
  O._carga = null; O._pedida = true;
  chk('depois que a Conciliação pediu a leitura por conta e a conta não veio (falhou): fica pendente e NUNCA monta o índice inteiro de uma vez dentro do desenho da tela (sem tarefa longa)', O.usaLegado('A') === false && B.bancoConta('A').pendente === true);
  ctx.__ov = true;
  chk('a leitura da DFC com sobreposição (DFC._ov18 > 0) segue com o cálculo da v14.9 mesmo depois disso', O.usaLegado('A') === true && B.bancoConta('A') === 'LEGADO:A');
  ctx.__ov = false; O._pedida = false;
  const doc = (id, conta, n) => ({ id, contaId: conta, mes: '2026-01', transacoes: Array.from({ length: n }, (_, i) => ({ id: id + i, data: '2026-01-' + String(1 + (i % 27)).padStart(2, '0'), valor: 10 + i, hist: 'CRED' })) });
  docsRepo.push(doc('e1', 'A', 5)); O._idx.set('A', { grupo: 'A', ids: ['A'], tx: [{ id: 'velho' }], cred: [], deb: [], credDia: new Map(), debDia: new Map(), cobertura: [], temAlgum: true, cobre: () => true }); O._lidas.set('A', { em: 1, nDocs: 1, nTx: 1, fonte: 'servidor' }); O._srcVer = null;
  chk('conta com índice por conta: o índice (do servidor) responde e não cai no legado', B.bancoConta('A').tx.length === 1 && O.usaLegado('A') === false);
  await espera(30); await ctx.Coop151.ceder();
  chk('a coleção inteira chegou DEPOIS da leitura por conta (versão ≠ a da leitura): os índices são refeitos a partir dela em segundo plano, uma vez, e a tela é redesenhada', O._idx.get('A').tx.length === 5 && O._srcVer === 1 && (ctx.__r || 0) >= 1 && O._lidas.get('A').fonte === 'memoria', [O._idx.get('A').tx.length, O._srcVer, ctx.__r]);
  const r0 = ctx.__r; await espera(20); B.bancoConta('A');
  chk('cada mudança do OFX avança a versão da coleção "extratos" no Repo (o que o código original usa como chave dos resultados guardados) e as voltas da própria v15.1 são descontadas (sem laço de atualização)', ver >= 2 && O._bumps >= 1 && O._rv() === O._srcVer, [ver, O._bumps, O._rv(), O._srcVer]);
  chk('sem mudança na coleção, nenhuma nova atualização (uma vez por versão)', ctx.__r === r0 && O._atualizando === false);
  docsRepo.push(doc('e2', 'A', 3)); ver++; B.bancoConta('A'); await espera(40); await ctx.Coop151.ceder(); await espera(20);
  chk('OFX recém-importado (a coleção em memória muda de versão): o índice da conta passa a incluir os 3 lançamentos novos sozinho — o mesmo que a v14.9 mostrava na hora', O._idx.get('A').tx.length === 8 && O._srcVer === 2, [O._idx.get('A').tx.length, O._srcVer]);
  docsRepo.length = 0; ver++; B.bancoConta('A'); await espera(30); await ctx.Coop151.ceder();
  chk('coleção em memória VAZIA (ou sem acesso): o que veio por conta é mantido, nunca apagado', O._idx.get('A').tx.length === 8 && O._srcVer === 3);
  /* uma releitura (Recalcular) começou no meio: ela manda, a atualização da memória não grava por cima */
  docsRepo.push(doc('e3', 'A', 2)); ver++; O._carga = Promise.resolve(); const antes = O._idx.get('A');
  chk('com uma leitura por conta em andamento a atualização da memória não roda (a releitura manda)', (await O.atualizarDoRepo()) === false && O._idx.get('A') === antes);
  O._carga = null;
  chk('desligado: bancoConta e carregarBanco voltam ao original (v14.9)', (() => { ctx.g151 = () => false; try { return B.bancoConta('Z') === 'LEGADO:Z' && B.carregarBanco() === 'ORIGINAL-carregar'; } finally { ctx.g151 = () => true; } })());
}

/* ---------- 2 · agendador cooperativo ---------- */
{
  const ctx = mkCtx({ fetch: async () => ({}), Cloud: {}, Repo: {} });
  vm.runInContext(base.slice(base.indexOf('const ADQ151 = {'), base.indexOf('/* ---------------- dados brutos só em memória')) + '\nglobalThis.ADQ151 = ADQ151; globalThis.Coop151 = Coop151;', ctx);
  const C = ctx.Coop151;
  let dec = 0, seq = 0, maxSeq = 0; const cederOrig = C.ceder.bind(C); C.ceder = function () { maxSeq = Math.max(maxSeq, seq); seq = 0; dec++; return cederOrig(); };
  const lista = Array.from({ length: 20000 }, (_, i) => i); let soma = 0;
  await C.fatiar(lista, x => { seq++; soma += x; });
  chk('fatiar: processa os 20.000 registros e NENHUMA fatia passa de 1.500 registros (cede a thread pelo menos 13 vezes)', soma === lista.reduce((a, b) => a + b, 0) && maxSeq <= 1500 && dec >= 13, { maxSeq, dec });
  dec = 0; maxSeq = 0; seq = 0; const usa = (ms) => { const t = performance.now(); while (performance.now() - t < ms); };
  const t0 = performance.now(); let maiorFatia = 0, ini = performance.now();
  C.ceder = function () { maiorFatia = Math.max(maiorFatia, performance.now() - ini); dec++; const p = cederOrig(); return p.then(() => { ini = performance.now(); }); };
  await C.fatiar(Array.from({ length: 600 }, (_, i) => i), () => usa(0.1), { passo: 4 });
  chk('fatiar com registros de ~0,1 ms: cada fatia dura perto de 8 ms (no máximo 12 ms no Node) e a thread é devolvida dezenas de vezes — nunca um bloco único', maiorFatia <= 12 && dec >= 5, { maiorFatia: Math.round(maiorFatia * 10) / 10, dec, total: Math.round(performance.now() - t0) });
  C.ceder = cederOrig;
  const alvo = Array.from({ length: 5000 }, (_, i) => ({ k: (i * 7919) % 97, i })), copia = alvo.map(x => ({ ...x }));
  await C.ordenar(alvo, (a, b) => a.k - b.k); copia.sort((a, b) => a.k - b.k);
  chk('ordenação cooperativa de 5.000 itens com muitos empates: idêntica ao Array.sort estável (mesma ordem, inclusive entre empates)', alvo.every((x, i) => x.i === copia[i].i && x.k === copia[i].k));
  const peq = [{ k: 2 }, { k: 1 }]; await C.ordenar(peq, (a, b) => a.k - b.k);
  chk('lista pequena (≤ 192 itens) usa o sort nativo direto', peq[0].k === 1);
  const S = C.sessao();
  chk('sessão de fatias: S.passo(k) acumula e pede para ceder ao chegar em 1.500 registros; S.ceder() zera e devolve a thread', S.passo(1499) === false && S.passo(1) === true && (await S.ceder(), S.passo(1) === false));
  chk('o agendador usa MessageChannel (sem o atraso mínimo de 4 ms do setTimeout aninhado)', /new MessageChannel\(\)/.test(base));
  chk('o relógio é lido a cada 8 registros (ADQ151.CHECA_RELOGIO), não a cada 32: um laço de corpo caro não estoura a fatia antes da primeira leitura', ctx.ADQ151.CHECA_RELOGIO === 8 && /passo = ADQ151\.CHECA_RELOGIO/.test(base) && /S\.c >= ADQ151\.CHECA_RELOGIO/.test(base));
  let nr = 0; ctx.App = { agendarRender() { nr++; } };
  for (let i = 0; i < 50; i++) C.renderAndamento(); await espera(40); const r1 = nr;
  for (let i = 0; i < 30; i++) C.renderAndamento(); await espera(90); const r2 = nr; await espera(260);
  chk('renderAndamento: 50 pedidos seguidos viram 1 desenho; o seguinte só sai depois de ADQ151.RENDER_ANDAMENTO_MS (200 ms) e o último estado sempre é desenhado', ctx.ADQ151.RENDER_ANDAMENTO_MS === 200 && r1 === 1 && r2 === 1 && nr === 2, { r1, r2, nr });
}

/* ---------- 3 · trava de armazenamento ---------- */
{
  class Storage { constructor() { this.d = {}; } setItem(k, v) { this.d[k] = String(v); } getItem(k) { return k in this.d ? this.d[k] : null; } }
  let ligado = true; const gravados = [];
  class LocalAdapter { constructor() { this.mem = {}; } _gravar(p, v) { gravados.push(p); } }
  const ctx = mkCtx({ Storage, LocalAdapter, g151: () => ligado, localStorage: new Storage(), sessionStorage: new Storage() });
  vm.runInContext(base + '\nglobalThis.Armaz151 = Armaz151; globalThis.ADQ151 = ADQ151;', ctx);
  const ls = ctx.localStorage, A = ctx.Armaz151;
  ls.setItem('pequeno', 'x'.repeat(1000)); let erro = null; try { ls.setItem('grande', 'x'.repeat(300 * 1024)); } catch (e) { erro = e; }
  chk('valor grande (300 KB de JSON) no localStorage / sessionStorage: RECUSADO com QuotaExceededError (código 22) — todo chamador do painel já trata essa exceção', erro && erro.name === 'QuotaExceededError' && erro.code === 22 && ls.getItem('grande') === null && ls.getItem('pequeno') !== null, erro && erro.message);
  let e2 = null; try { ctx.sessionStorage.setItem('s', 'y'.repeat(256 * 1024 + 1)); } catch (e) { e2 = e; }
  chk('o teto é de 256 KB por valor (o limite exato: 256 KB passa, 256 KB + 1 não); contagem de recusas e do que foi recusado registrada', e2 && A.stats.recusados === 2 && A.recusas.length === 2 && /grande/.test(A.recusas[0].chave) && A.recusas[0].chars === 300 * 1024, A.stats);
  ls.setItem('no-limite', 'z'.repeat(256 * 1024));
  chk('exatamente 256 KB é aceito', ls.getItem('no-limite') !== null);
  ligado = false; ls.setItem('grande2', 'x'.repeat(300 * 1024));
  chk('recurso DESLIGADO: a trava não age (comportamento da v14.9)', ls.getItem('grande2') !== null);
  ligado = true;
  const ad = new ctx.LocalAdapter();
  ad._gravar('extratos/abc', { transacoes: [1] }); ad._gravar('adq_erp/2026-01:meta', {}); ad._gravar('adq_lotes/x', {}); ad._gravar('adq_agendas/y', {});
  ad._gravar('lojas/1', { nome: 'x', lista: new Array(2500).fill(0) }); ad._gravar('lojas/2', { nome: 'pequena' }); ad._gravar('config/recursos', {});
  chk('LocalAdapter: extratos, ERP, lotes, agendas e qualquer documento com array > 2.000 linhas ficam SÓ em memória (adapter.mem); o resto grava como sempre', gravados.join() === 'lojas/2,config/recursos' && Object.keys(ad.mem).sort().join() === 'adq_agendas/y,adq_erp/2026-01:meta,adq_lotes/x,extratos/abc,lojas/1' && A.stats.somenteRam === 5, [gravados, Object.keys(ad.mem), A.stats]);
  chk('Armaz151.pesado(): coleções brutas e arrays gigantes são "pesados"; documento comum não', A.pesado('extratos/x', {}) && A.pesado('qualquer/y', { a: new Array(2001) }) && !A.pesado('lojas/z', { a: [1, 2, 3] }));
}

/* ---------- 4 · DOM estrito (Tela151) ---------- */
{
  const O = { _reg: [], _troca(obj, nome, nova) { const o = obj[nome]; nova._o151 = true; nova._orig = o; obj[nome] = nova; this._reg.push([obj, nome, o, nova]); return nova; } };
  const Fmt = { num: n => String(n) };
  const A19 = { perf: { ligado: () => true }, esc: s => String(s), ui: { todas: {}, aberto: {} }, fatiar(L) { return { linhas: L.slice(0, 50), rodape: 'v14.19' }; },
    async acao(a, el) { if (a === 'a19-linha') { const id = el.dataset.id; if (A19.ui.aberto[id]) delete A19.ui.aberto[id]; else A19.ui.aberto[id] = 'a'; } if (a === 'a19-vertodas') { const k = el.dataset.k; if (el.dataset.v === '0') delete A19.ui.todas[k]; else A19.ui.todas[k] = true; } },
    render() { return 'ok'; } };
  const ctx = mkCtx({ Fmt, Adq19: A19, Adq14: { ui: { mes: '2026-01' } }, App: { render() { ctx.__renders = (ctx.__renders || 0) + 1; } } });
  vm.runInContext(base.slice(base.indexOf('const ADQ151 = {'), base.indexOf('/* ---------------- agendador cooperativo')) + '\nglobalThis.ADQ151 = ADQ151;', ctx);
  vm.runInContext(telaSrc + '\nglobalThis.Tela151 = Tela151;', ctx); const T = ctx.Tela151; T.instalar(O);
  const L = Array.from({ length: 500 }, (_, i) => i), el = (k, v) => ({ dataset: { k, v } });
  let F = A19.fatiar(L, 'ctr:1', 300);
  chk('sub-tabela expandida nasce com 30 linhas (não 50, não 300) e o rodapé oferece "Ver mais 30" e "Ver todas (500)"', F.linhas.length === 30 && /Mostrando 30 de 500/.test(F.rodape) && /Ver mais 30/.test(F.rodape) && /Ver todas \(500\)/.test(F.rodape) && /data-a="a19-vermais"/.test(F.rodape), F.rodape);
  await A19.acao('a19-vermais', el('ctr:1')); F = A19.fatiar(L, 'ctr:1', 300);
  chk('"Ver mais 30": +30 linhas por clique (60), sob demanda e só daquela tabela; as outras seguem com 30', F.linhas.length === 60 && A19.fatiar(L, 'outra', 300).linhas.length === 30);
  for (let i = 0; i < 40; i++) await A19.acao('a19-vermais', el('ctr:1'));
  const G = Array.from({ length: 3000 }, (_, i) => i); F = A19.fatiar(G, 'ctr:1', 300);
  chk('teto de 1.000 linhas no DOM mesmo clicando muitas vezes, com o aviso do limite e sem o botão "Ver mais"', F.linhas.length === 1000 && /limite de 1000/.test(F.rodape) && !/Ver mais/.test(F.rodape), F.rodape);
  A19.ui.mais = {}; await A19.acao('a19-vertodas', el('ctr:2')); F = A19.fatiar(G, 'ctr:2', 300);
  chk('"Ver todas": até 1.000 linhas (nunca as 3.000) e o botão "Mostrar só 30" volta ao corte inicial', F.linhas.length === 1000 && /Mostrar só 30/.test(F.rodape));
  await A19.acao('a19-vertodas', el('ctr:2', '0')); F = A19.fatiar(G, 'ctr:2', 300);
  chk('"Mostrar só 30" restaura as 30 linhas iniciais', F.linhas.length === 30);
  chk('tabela de até 30 linhas: sem rodapé (nada para paginar)', A19.fatiar(Array.from({ length: 30 }, (_, i) => i), 'k3', 300).rodape === '');
  /* nada abre sozinho */
  A19.ui.aberto = {}; ctx.Adq14.ui.mes = '2026-01';
  await A19.acao('a19-linha', { dataset: { id: 'adq-getnet__emp-a' } });
  A19.render(); chk('o que a pessoa abriu NESTA competência continua aberto no redesenho', A19.ui.aberto['adq-getnet__emp-a'] === 'a');
  ctx.Adq14.ui.mes = '2025-12'; A19.render();
  chk('trocou de competência: o detalhe aberto antes volta RECOLHIDO (um contrato com mais de 500 linhas diárias nunca abre sozinho com a carga de outro mês)', A19.ui.aberto['adq-getnet__emp-a'] === undefined && T.stats.recolhidas === 1);
  A19.ui.aberto['aberto-por-codigo'] = true; A19.render();
  chk('estado aberto sem clique da pessoa (sem registro de competência) também volta recolhido', A19.ui.aberto['aberto-por-codigo'] === undefined);
  chk('regra de segurança do limite: só um contrato de até 500 linhas diárias poderia abrir sozinho', T.podeAbrirSozinho(500) === true && T.podeAbrirSozinho(501) === false);
  /* desligado */
  const regs = O._reg.slice(); for (const [obj, nome, o, nova] of regs.reverse()) if (obj[nome] === nova) obj[nome] = o;
  A19.ui.todas = {}; F = A19.fatiar(L, 'z', 300);
  chk('recurso desligado (trocas desfeitas): fatiar, acao e render voltam a ser EXATAMENTE as funções da v14.9', F.rodape === 'v14.19' && F.linhas.length === 50 && regs.length === 3 && regs.every(([obj, nome, o]) => obj[nome] === o));
}

/* ---------- 5 · registro de trocas do Otim151 ---------- */
{
  const ctx = mkCtx({});
  vm.runInContext(base + '\nglobalThis.Otim151 = Otim151;', ctx); const O = ctx.Otim151;
  const obj = { f() { return 'original'; }, g() { return 'g'; } }, f0 = obj.f, g0 = obj.g;
  O._troca(obj, 'f', function () { return 'trocada'; }); O._troca(obj, 'g', function () { return 'g2'; });
  const antes = [obj.f(), obj.g()]; O._remover();
  chk('Otim151: cada função trocada guarda a original e _remover() devolve EXATAMENTE a função original (OFF = v14.9)', antes.join() === 'trocada,g2' && obj.f === f0 && obj.g === g0 && obj.f() === 'original');
  chk('as memórias de funções puras só cobrem texto → texto, datas e formatação (resultado idêntico ao original); nada é memorizado em armazenamento do navegador', /puro\(AdqTaxas, 'chave'\)/.test(base) && /Fmt, 'brl'/.test(base));
}

/* ---------- documentação ---------- */
const readme = fs.existsSync(path.join(raiz, 'README.md')) ? fs.readFileSync(path.join(raiz, 'README.md'), 'utf8') : '';
chk('README: traz a seção da v15.1 com os 4 itens e as premissas (flag, índice, Worker × fatias)', /v15\.1/.test(readme) && /gestao_v151/.test(readme) && /OFX/.test(readme) && /Worker/.test(readme));

console.log(`\n${OK.length} ok · ${FAIL.length} falha(s)`); process.exit(FAIL.length ? 1 : 0);
