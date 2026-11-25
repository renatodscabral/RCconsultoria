/* v15.1 · ITEM 1 NO NAVEGADOR REAL: o OFX é lido POR CONTA BANCÁRIA, em segundo plano, com pílula "OFX: lendo conta i/N…", "Creditado OFX" atualizado conta a conta,
   limite de tempo + UMA nova tentativa, e a tela sem travar mesmo quando o servidor falha ou não responde. Dados FICTÍCIOS (massa de tests/estresse-v151/massa151.dump: 6 contas, 55.776 lançamentos).
   O servidor local não reproduz o limite de 10 s do Netlify: as falhas são SIMULADAS interceptando as requisições de extratos no navegador (route do Playwright).
   Cenários: A) atraso em cada conta; B) um 503 e sucesso na nova tentativa; C) uma conta que não responde (tempo esgotado → nova tentativa → erro só dessa conta, as outras entram);
             E) servidor fora do ar: depois de 2 contas seguidas com falha as demais não esperam; D) recuperação pelo Recalcular com o servidor de volta. Em todos: pedidos sempre com contaId e maxBytes (nunca a coleção inteira) e 0 quadros acima de 50 ms.
   Uso: NETLIFY_DB_URL=postgres://usuario@127.0.0.1:5432/painel_teste node tests/e2e-ofx-conta-v151.mjs   (Playwright + Chromium, psql, pg_restore) */
import { ambiente, abrirPainel, playwright, relatorio } from './estresse-v151/_infra.mjs';

const R = relatorio(), { chk } = R, { chromium } = playwright();
const amb = await ambiente({ porta: Number(process.env.PORTA_OFX || 8892), v151: true }), b = await chromium.launch();
let codigo = 1, piorQuadro = 0;
try {
  const M = await abrirPainel(b, amb.url, { medirQuadros: true }), ev = (f, a) => M.evaluate(f, a);
  await M.waitForTimeout(6500);
  const zerarQuadros = () => ev(() => { window.__fr.gaps = []; window.__fr.max = 0; });
  const quadros = () => ev(() => ({ n: window.__fr.gaps.length, max: Math.round(window.__fr.max) })).then(q => { piorQuadro = Math.max(piorQuadro, q.max); return q; });
  /* abre a Conciliação e espera terminar (a 1ª leitura pode vir da memória, sem requisições) */
  await ev(() => { Adq14.ui.mes = '2026-01'; Adq14.ui.filtro = '*'; App.ir('conciliacao'); ConcMP.ui.aba = 'credito'; ConcMP.ui.sub = 'c14'; App.render(); });
  await ev(() => __ate(() => Adq14.bancoEstado().carregou && !(Adq19.perf && Adq19.perf._aq), 120000)); await ev(() => __esp(1000));
  const base = await ev(() => ({ nTx: Adq14.bancoEstado().nTx, n: OfxInc.est.n, contas: OfxInc.est.contas.length, erros: Adq14.bancoEstado().erros.length }));
  chk('ponto de partida: a Conciliação abriu com o OFX de todas as contas (mais de 50.000 lançamentos), sem erro', base.nTx >= 50000 && base.n >= 4 && base.erros === 0, base);
  const N = base.n;

  /* rotas de extratos controladas pelo teste */
  const pedidos = []; let modo = 'ok', contaTrava = null, atrasoMs = 700, falhou503 = false; const presos = [];
  await M.route(/\/api\/docs\?colecao=extratos/, async route => {
    const u = new URL(route.request().url()), conta = u.searchParams.get('contaId'); pedidos.push({ url: route.request().url().replace(/^https?:\/\/[^/]+/, ''), conta, maxBytes: u.searchParams.get('maxBytes'), t: Date.now(), modo });
    if (modo === 'atraso') { await new Promise(r => setTimeout(r, atrasoMs)); return route.continue(); }
    if (modo === '503-uma-vez' && !falhou503) { falhou503 = true; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ erro: 'Servidor indisponível (simulado no teste)' }) }); }
    if (modo === 'tudo-preso') { presos.push(route); return; }
    if (modo === 'trava') { if (!contaTrava) contaTrava = conta; if (conta === contaTrava) { presos.push(route); return; } }
    return route.continue();
  });
  /* o clique do Recalcular primeiro recalcula o "antes" (rápido) e só então começa a leitura: espera a leitura COMEÇAR antes de esperar o fim */
  const recalcular = async () => { await M.click('[data-a="a14-recalcular"]'); await ev(() => __ate(() => !!OfxInc._carga, 20000)); };
  const espiar = () => ev(() => { window.__sp = { pilulas: [], nTx: [], erro: false }; clearInterval(window.__spT); window.__spT = setInterval(() => { const t = document.body.innerText, m = t.match(/OFX: lendo conta \d+\/\d+…|OFX: preparando a leitura…/), n = OfxInc.nTx(); if (m && !window.__sp.pilulas.includes(m[0])) window.__sp.pilulas.push(m[0]); if (!window.__sp.nTx.length || window.__sp.nTx.at(-1) !== n) window.__sp.nTx.push(n); if (/OFX: não foi possível ler/.test(t)) window.__sp.erro = true; }, 25); });
  const parar = () => ev(() => { clearInterval(window.__spT); return window.__sp; });
  /* fim da leitura E do aquecimento em fatias que vem depois dela (um Recalcular logo em seguida, com as memórias ainda frias, recalcula o "antes" na hora: ~0,3 s na massa, contra 1,6 s da v14.9) */
  /* "estável" = leitura terminada, cálculo em fatias terminado, nenhum desenho de andamento pendente (a v15.1 espaça esses desenhos em 200 ms) e sem "Calculando" na tela, por 3 verificações seguidas */
  const fim = (ms = 90000) => ev(ms => (async () => { let ok = 0; for (let t = 0; t < ms && ok < 3; t += 120) { const livre = OfxInc.est.fase !== 'lendo' && !OfxInc._carga && !(Adq19.perf && Adq19.perf._aq) && !Coop151._rt && !App._raf && !/Calculando a conciliação/.test(document.body.innerText); ok = livre ? ok + 1 : 0; await __esp(120); } return ok >= 3; })(), ms);

  /* A · atraso em cada conta: progresso na pílula, Creditado OFX conta a conta, tela livre */
  modo = 'atraso'; pedidos.length = 0; await ev(() => { OfxInc.stats.retentativas = 0; }); await zerarQuadros(); await espiar(); await recalcular();
  const tela = await ev(() => ({ lendo: OfxInc.est.fase === 'lendo', pointer: getComputedStyle(document.body).pointerEvents, ativo: !document.querySelector('.overlay, .modal-bloqueio') }));
  await fim(); await ev(() => __esp(400)); const A = await parar(), qA = await quadros(), nA = await ev(() => ({ nTx: Adq14.bancoEstado().nTx, erros: Adq14.bancoEstado().erros.length, st: { ...OfxInc.stats } }));
  console.log('   · A:', JSON.stringify({ pilulas: A.pilulas, nTx: A.nTx.slice(0, 12), pedidos: pedidos.length, quadros: qA, nA }));
  chk(`A1 a pílula mostra o progresso por conta ("OFX: lendo conta 1/${N}…" até "${N}/${N}…") e some quando termina`, A.pilulas.length >= Math.min(N, 3) && /lendo conta 1\//.test(A.pilulas.join(' ')) && A.pilulas.some(p => new RegExp(`lendo conta ${N}/${N}`).test(p)), { A: A.pilulas, N });
  const sobe = A.nTx.slice(Math.max(0, A.nTx.indexOf(0))); /* a releitura recomeça do zero e daí só sobe */
  chk('A2 o "Creditado OFX" é atualizado conta a conta: depois que a releitura recomeça, o total de lançamentos lidos sobe em vários degraus (nunca de uma vez só) e nunca diminui até o total', sobe.length >= 5 && sobe.every((v, i) => i === 0 || v >= sobe[i - 1]) && sobe.at(-1) === base.nTx, { nTx: A.nTx });
  chk('A3 cada pedido ao servidor é de UMA conta (contaId) com página de no máximo 768 KB (maxBytes=786432) — nunca a coleção inteira — e há pelo menos um pedido por conta', pedidos.length >= N && pedidos.every(p => p.conta && p.maxBytes === '786432'), pedidos.slice(0, 4));
  chk('A4 a tela não ficou presa: nenhum bloqueio de cliques durante a leitura (sem janela modal) e 0 quadros ficaram bloqueados acima de 50 ms', tela.lendo && tela.pointer !== 'none' && tela.ativo && qA.n === 0 && qA.max <= 55, { tela, qA });
  chk('A5 ao terminar o resultado é o mesmo (mesmo total de lançamentos, sem erro) e o texto de erro "OFX: não foi possível ler" nunca apareceu', nA.nTx === base.nTx && nA.erros === 0 && !A.erro, { nA, erro: A.erro });

  /* B · um 503 e sucesso na nova tentativa automática */
  modo = '503-uma-vez'; falhou503 = false; pedidos.length = 0; await ev(() => { OfxInc.stats.retentativas = 0; }); await zerarQuadros(); await espiar(); await recalcular(); await fim();
  const B = await parar(), qB = await quadros(), nB = await ev(() => ({ nTx: Adq14.bancoEstado().nTx, erros: Adq14.bancoEstado().erros, ret: OfxInc.stats.retentativas }));
  console.log('   · B:', JSON.stringify({ nB, pedidos: pedidos.length, quadros: qB }));
  chk('B1 um erro 503 do servidor é repetido UMA vez automaticamente: a conta chega, não há erro na tela e o resultado é o mesmo', nB.ret === 1 && nB.erros.length === 0 && nB.nTx === base.nTx && !B.erro && pedidos.length >= N + 1, { nB, B: B.erro, pedidos: pedidos.length });
  chk('B2 durante a falha e a nova tentativa a tela continuou livre (0 quadros > 50 ms)', qB.n === 0, qB);

  /* C · uma conta que não responde: tempo esgotado + 1 nova tentativa, só essa conta falha, as outras entram */
  modo = 'trava'; contaTrava = null; presos.length = 0; pedidos.length = 0; await ev(() => { ADQ151.OFX_TIMEOUT_MS = 1200; OfxInc.stats.retentativas = 0; }); await zerarQuadros(); await espiar(); await recalcular();
  const t0 = Date.now(); await fim(60000); const dt = Date.now() - t0; await ev(() => __esp(500));
  const C = await parar(), qC = await quadros(), nC = await ev(() => ({ nTx: Adq14.bancoEstado().nTx, erros: Adq14.bancoEstado().erros, ret: OfxInc.stats.retentativas, fase: OfxInc.est.fase, lidas: OfxInc.nLidas(), txt: document.body.innerText.match(/OFX: [^\n]{0,70}/g) }));
  const presosDaConta = pedidos.filter(p => p.conta === contaTrava).length;
  console.log('   · C:', JSON.stringify({ dt, nC: { ...nC, erros: nC.erros.map(e => e.msg) }, presosDaConta, quadros: qC }));
  chk('C1 conta que não responde: o pedido é abortado pelo limite de tempo (aqui 1,2 s; em produção 25 s), repetido UMA vez e então vira erro só dessa conta', presosDaConta === 2 && nC.ret >= 1 && nC.erros.length === 1 && /tempo esgotado/.test(nC.erros[0].msg), { presosDaConta, nC });
  chk('C2 as demais contas continuam entrando: o resultado parcial tem lançamentos (mas menos que o total) e a tela diz que não foi possível ler — sem travar (0 quadros > 50 ms)', nC.nTx > 0 && nC.nTx < base.nTx && nC.lidas === N - 1 && C.erro && qC.n === 0, { nC: { nTx: nC.nTx, lidas: nC.lidas }, erro: C.erro, qC });
  chk('C3 a mensagem diz QUAL conta falhou (nome da conta no erro) e o tempo total foi o limite × 2 mais a espera da nova tentativa, não minutos', nC.erros[0].conta && dt < 20000 && dt >= 2400, { conta: nC.erros[0].conta, dt });

  /* E · servidor fora do ar (nenhuma conta responde): depois de 2 contas seguidas que falharam (cada uma já com a nova tentativa) as demais não esperam mais 2 × 25 s cada */
  presos.forEach(r => r.abort().catch(() => { })); presos.length = 0; modo = 'tudo-preso'; pedidos.length = 0; await ev(() => { ADQ151.OFX_TIMEOUT_MS = 800; OfxInc.stats.retentativas = 0; OfxInc.stats.disjuntor = 0; }); await zerarQuadros(); await espiar(); await recalcular();
  const t1 = Date.now(); await fim(60000); const dtE = Date.now() - t1; await ev(() => __esp(300)); const E = await parar(), qE = await quadros();
  const nE = await ev(() => ({ nTx: Adq14.bancoEstado().nTx, erros: Adq14.bancoEstado().erros.map(e => e.msg), disj: OfxInc.stats.disjuntor, txt: /OFX: não foi possível ler/.test(document.body.innerText) }));
  console.log('   · E:', JSON.stringify({ dtE, pedidos: pedidos.length, nE, quadros: qE }));
  chk('E1 servidor fora do ar: só as 2 primeiras contas tentam (2 pedidos cada, com a nova tentativa) e as outras são marcadas como "não lida" sem esperar (disjuntor)', pedidos.length === 4 && nE.disj === N - 2 && nE.erros.length === N && nE.erros.filter(m => /não lida/.test(m)).length === N - 2 && nE.nTx === 0, { pedidos: pedidos.length, nE });
  chk('E2 o tempo total é o de 2 contas (cerca de 4 s aqui; 6 contas × 2 tentativas levariam 9 s ou mais), a tela avisa "não foi possível ler — use Recalcular" e continua livre (0 quadros > 55 ms)', dtE < 8000 && nE.txt && qE.n === 0, { dtE, txt: nE.txt, qE });

  /* D · o servidor volta: Recalcular recupera tudo */
  presos.forEach(r => r.abort().catch(() => { })); modo = 'ok'; pedidos.length = 0; await ev(() => { ADQ151.OFX_TIMEOUT_MS = 25000; }); await zerarQuadros(); await recalcular(); await fim(); await ev(() => __esp(600));
  const nD = await ev(() => ({ nTx: Adq14.bancoEstado().nTx, erros: Adq14.bancoEstado().erros.length, txt: /OFX: não foi possível ler/.test(document.body.innerText) })), qD = await quadros();
  console.log('   · D:', JSON.stringify({ nD, quadros: qD }));
  chk('D1 com o servidor de volta, Recalcular relê tudo: o mesmo total de lançamentos do início, sem erro e sem o aviso vermelho', nD.nTx === base.nTx && nD.erros === 0 && !nD.txt, nD);
  chk('D2 sem exceções de página no roteiro inteiro', M.erros.length === 0, M.erros.slice(0, 3));
  codigo = R.fim();
} catch (e) { console.error('ERRO no roteiro:', e); codigo = 1; }
finally { await b.close(); amb.parar(); }
/* Ruído do ambiente × regressão (mesma regra do stress-test): o Chromium roda com renderização por software em 2 CPUs compartilhadas; um quadro isolado de 67–83 ms de vez em quando não é
   da v15.1. Se as ÚNICAS falhas foram de quadro e o pior quadro ficou abaixo de 100 ms, o roteiro roda UMA vez mais (OFX_REPETIDO=1); quadro de 100 ms ou mais reprova de imediato. */
if (codigo !== 0 && !process.env.OFX_REPETIDO && R.FAIL.length && R.FAIL.every(n => /quadros/.test(n)) && piorQuadro < 100) {
  console.log(`\n   · só falhou a medida de quadros (pior ${piorQuadro} ms, < 100 ms): ruído do ambiente; repetindo o roteiro UMA vez`);
  const { spawnSync } = await import('node:child_process'); const r = spawnSync(process.execPath, [new URL(import.meta.url).pathname], { stdio: 'inherit', env: { ...process.env, OFX_REPETIDO: '1', PORTA_OFX: String(Number(process.env.PORTA_OFX || 8892) + 10) } });
  codigo = r.status === 0 ? 0 : 1;
}
process.exit(codigo);
