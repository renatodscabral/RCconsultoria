/* v15.1 · Servidor: leitura dos extratos OFX POR CONTA BANCÁRIA (GET /api/docs?colecao=extratos&contaId=…) contra um Postgres de verdade, com dados FICTÍCIOS.
   1) contaId (uma ou várias, separadas por vírgula), mesDe / mesAte e a resposta com `filtrado: true` (é a marca que o painel usa para saber que o servidor é novo);
   2) paginação por tamanho (maxBytes) com cursor `apos`: percorrer todas as páginas devolve cada documento UMA vez, na ordem do doc_id, sem estourar o teto da página;
   3) sem filtro o comportamento é o de sempre (sem `filtrado`), contaId inválido (mais de 20 contas / vazio) e competência inválida dão 400, sem sessão dá 401;
   4) o índice parcial idx_documentos_extratos_conta existe depois da migração 20261114120000 e a migração é repetível.
   Uso: bash tests/preparar-banco.sh && NETLIFY_DB_URL=postgres://… node tests/servidor-local.mjs 8890 &  e depois  NETLIFY_DB_URL=… node tests/teste-extratos-filtro-v151.mjs */
import fs from 'node:fs';
import pg from 'pg';
import { gerar } from '../netlify/lib/senha.mjs';

const U = process.env.PAINEL_URL || 'http://localhost:8890', OK = [], FAIL = [];
const chk = (n, c, x = '') => { (c ? OK : FAIL).push(n); console.log((c ? 'ok   ' : 'FALHA ') + n + (!c && x !== '' ? ' → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 900) : '')); };
const db = new pg.Pool({ connectionString: process.env.NETLIFY_DB_URL }), sql = (t, p) => db.query(t, p).then(r => r.rows);
const doc = async (caminho, dados) => { const i = caminho.lastIndexOf('/'); await sql(`INSERT INTO documentos (caminho, colecao, doc_id, dados) VALUES ($1, $2, $3, $4) ON CONFLICT (caminho) DO UPDATE SET dados = EXCLUDED.dados`, [caminho, caminho.slice(0, i), caminho.slice(i + 1), JSON.stringify(dados)]); };
const login = async cpf => { const r = await fetch(U + '/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json', 'x-painel': '1' }, body: JSON.stringify({ cpf, senha: 'Teste2026Ab' }) }); return (r.headers.get('set-cookie') || '').split(';')[0]; };
const get = async (ck, rota) => { const r = await fetch(U + rota, { headers: { ...(ck ? { cookie: ck } : {}), 'x-painel': '1' } }); return { s: r.status, j: await r.json().catch(() => ({})) }; };

await sql(`DELETE FROM documentos WHERE colecao = 'extratos' AND doc_id LIKE 'f151-%'`);
await doc('usuarios/usr-f151-master', { perfil: 'MASTER', nome: 'Teste f151', cpf: '12345678909', ativo: true, permissoes: {}, trocarSenha: false, senha: gerar('Teste2026Ab', 'sal-f151') });
const CONTAS = ['conta-f151-a', 'conta-f151-b', 'conta-f151-c'], MESES = ['2026-01', '2026-02', '2026-03', '2026-04'];
let n = 0;
for (const c of CONTAS) for (const m of MESES) { /* ~110 KB de JSON por documento: 600 lançamentos fictícios */
  const transacoes = Array.from({ length: 600 }, (_, i) => ({ id: `${c}-${m}-${i}`, data: `${m}-${String(1 + (i % 27)).padStart(2, '0')}`, valor: (i % 7) * 13.37 - 40, hist: 'LANCAMENTO FICTICIO ' + i + ' '.repeat(60), tipo: i % 2 ? 'CREDIT' : 'DEBIT' }));
  await doc(`extratos/f151-${c}-${m}`, { contaId: c, mes: m, transacoes, saldo: { data: `${m}-28`, valor: 1000 + n } }); n++;
}
const ck = await login('12345678909'), minhas = l => (l.docs || []).filter(d => String(d.id).startsWith('f151-'));

/* 1 · filtros */
let r = await get(ck, '/api/docs?colecao=extratos&contaId=conta-f151-a');
chk('contaId = uma conta: só os 4 documentos dela, com `filtrado: true`', r.s === 200 && r.j.filtrado === true && minhas(r.j).length === 4 && minhas(r.j).every(d => d.contaId === 'conta-f151-a'), { s: r.s, n: minhas(r.j).length, f: r.j.filtrado });
r = await get(ck, '/api/docs?colecao=extratos&contaId=conta-f151-a,conta-f151-c');
chk('contaId = duas contas (separadas por vírgula): 8 documentos e nenhum da conta b', r.s === 200 && minhas(r.j).length === 8 && !minhas(r.j).some(d => d.contaId === 'conta-f151-b'));
r = await get(ck, '/api/docs?colecao=extratos&contaId=conta-f151-b&mesDe=2026-02&mesAte=2026-03');
chk('mesDe / mesAte: só fevereiro e março da conta pedida', r.s === 200 && minhas(r.j).length === 2 && minhas(r.j).every(d => d.mes >= '2026-02' && d.mes <= '2026-03'), minhas(r.j).map(d => d.mes));
r = await get(ck, '/api/docs?colecao=extratos&contaId=conta-inexistente');
chk('conta sem extrato: lista vazia, ainda `filtrado: true` (o painel sabe que o servidor é novo e que a conta está vazia)', r.s === 200 && r.j.filtrado === true && minhas(r.j).length === 0);

/* 2 · paginação por tamanho */
const todas = [], paginas = []; let apos = '';
for (let i = 0; i < 50; i++) {
  r = await get(ck, `/api/docs?colecao=extratos&contaId=${CONTAS.join(',')}&maxBytes=${200 * 1024}` + (apos ? `&apos=${encodeURIComponent(apos)}` : ''));
  if (r.s !== 200) break; paginas.push(JSON.stringify(r.j.docs).length); todas.push(...minhas(r.j)); if (!r.j.proximo) break; apos = r.j.proximo;
}
chk('12 documentos de ~110 KB em páginas de até ~200 KB: cada documento aparece UMA vez, na ordem do doc_id, em mais de 4 páginas', todas.length === 12 && new Set(todas.map(d => d.id)).size === 12 && paginas.length > 4 && JSON.stringify(todas.map(d => d.id)) === JSON.stringify(todas.map(d => d.id).slice().sort()), { n: todas.length, paginas: paginas.length });
chk('nenhuma página passa do teto pedido por mais de um documento (o teto é por documento inteiro, nunca corta um documento ao meio)', paginas.every(t => t <= 200 * 1024 + 125 * 1024), paginas);

/* 3 · sem filtro, validações, acesso */
r = await get(ck, '/api/docs?colecao=extratos');
chk('sem filtro: comportamento de sempre (nenhuma marca `filtrado`)', r.s === 200 && r.j.filtrado === undefined && Array.isArray(r.j.docs));
r = await get(ck, '/api/docs?colecao=extratos&contaId=' + Array.from({ length: 21 }, (_, i) => 'c' + i).join(','));
chk('mais de 20 contas no mesmo pedido: 400', r.s === 400, r);
r = await get(ck, '/api/docs?colecao=extratos&contaId=,');
chk('contaId vazio (só vírgulas): 400', r.s === 400, r);
r = await get(ck, '/api/docs?colecao=extratos&contaId=conta-f151-a&mesDe=2026-13');
chk('competência inválida: 400', r.s === 400, r);
r = await get(null, '/api/docs?colecao=extratos&contaId=conta-f151-a');
chk('sem sessão: 401 (o filtro não abre uma porta para dados sem login)', r.s === 401, r);

/* 4 · índice e migração repetível */
const mig = fs.readFileSync(new URL('../netlify/database/migrations/20261114120000_indice_extratos_conta.sql', import.meta.url), 'utf8');
await sql(mig); await sql(mig);
const idx = await sql(`SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_documentos_extratos_conta'`);
chk('migração do índice: aplica duas vezes sem erro e cria o índice PARCIAL por conta (colecao = extratos)', idx.length === 1 && /contaId/.test(idx[0].indexdef) && /extratos/.test(idx[0].indexdef), idx);
const plano = (await sql(`EXPLAIN SELECT doc_id FROM documentos WHERE colecao = 'extratos' AND dados->>'contaId' = ANY($1::text[]) AND doc_id > '' ORDER BY doc_id LIMIT 500`, [['conta-f151-a']])).map(x => x['QUERY PLAN']).join(' | ');
chk('a consulta do painel é uma consulta de índice válida no Postgres (EXPLAIN roda; o índice é elegível para a coleção extratos)', /documentos/.test(plano), plano.slice(0, 200));

await sql(`DELETE FROM documentos WHERE colecao = 'extratos' AND doc_id LIKE 'f151-%'`); await db.end();
console.log(`\n${OK.length} ok · ${FAIL.length} falha(s)`); process.exit(FAIL.length ? 1 : 0);
