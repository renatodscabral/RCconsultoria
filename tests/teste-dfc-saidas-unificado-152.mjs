import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

/* v15.2 · TESTE DA FONTE ÚNICA DE PAGAMENTOS (FCX › Saídas) + DESDOBRAMENTO CNAB BLINDADO + ECONOMIA DE CRÉDITOS DO NETLIFY — recurso gestao_v152
   Dados 100% fictícios. Código REAL fatiado de public/index.html (ponte do FCX, Z152, Saidas152, CNAB152, CNAB17, PAGTO17, DFC) e de public/fcx.html (gravação e importação das Saídas),
   executado sobre um banco simulado em memória (a ponte do FCX fala com um adaptador que conta documentos e bytes) e, nas seções 1 e 2, sobre o Postgres de teste.
   Uso (as seções 1 e 2 precisam do Postgres local: `bash tests/preparar-banco.sh` e NETLIFY_DB_URL=postgres://…; sem a variável elas são puladas e dizem isso):
     NETLIFY_DB_URL=postgres://postgres@127.0.0.1:54329/painel_teste node tests/teste-dfc-saidas-unificado-152.mjs
   Para abrir .xlsx de verdade, o SheetJS precisa estar instalado (XLSX_PATH ou `npm i xlsx`); sem ele os casos de arquivo .xlsx são marcados como pulados e o .csv roda igual.
   Cobre: (1) retenção de 2 backups na nuvem + rotina das 23:59 que não regrava quando o dia já tem ponto; (2) filtros do servidor para o FCX (só metas / só as chaves pedidas);
   (3) compactação gzip de esp2:saidas e cache por versão/hash (IndexedDB) sem baixar megabytes de novo; (4) importação dos dois layouts do ERP em FCX › Saídas (inteligente por mês,
   sem duplicar, gravação conferida no banco, confirmação visual); (5) a DFC lê só os títulos Pago da base oficial e reflete a importação na hora; (6) prova ao centavo
   Σ(categorias da DFC após o desdobramento) = Σ(lançamentos do OFX do mês), com as travas de aborto por lote e por mês; (7) limpeza visual da DFC e botão removido; (8) recurso desligado ≡ v15.1. */
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

/* ---------------------------------------------------------------------------------------------------------------------------------------
   0 · ESTÁTICO — Regra de Ouro, marcação do recurso e do código no lugar certo
   --------------------------------------------------------------------------------------------------------------------------------------- */
{
  chk('Regra de Ouro: contabilidade.html e contabilidade_v1391.html idênticos byte a byte ao que foram (a41642fb…, ea73d20b…)',
    md5(fs.readFileSync(path.join(raiz, 'public/contabilidade.html'))).startsWith('a41642fb') && md5(fs.readFileSync(path.join(raiz, 'public/contabilidade_v1391.html'))).startsWith('ea73d20b'));
  chk('recurso gestao_v152 registrado em Recursos.LISTA (rótulo v15.2) e g152() só liga junto com a v15.1', /gestao_v152:\s*\{\s*versao:\s*'v15\.2'/.test(html) && /function g152\(\) \{ return typeof Recursos !== 'undefined' && Recursos\.ativo\('gestao_v152'\) && g151\(\); \}/.test(html));
  chk('o módulo v15.2 está no painel (Z152, Saidas152, CNAB152) e fecha com o marcador "fim v15.2"', ['const Z152 = {', 'const Saidas152 = {', 'const CNAB152 = {', '/* ---- fim v15.2 ---- */'].every(s => html.includes(s)));
  chk('o FCX v15.2 só age com fcxV152() (importação inteligente, gravação conferida, painel de gravação) e mantém o leitor antigo como reserva', /function fcxV152\(\)/.test(fcx) && /if\(fcxV152\(\)\) return saveSaidas152\(\)/.test(fcx) && /importSaidasLegado\(file\)/.test(fcx));
  chk('as 11 gravações do persistAll passam por fcxSet152 (chave que não foi lida nunca é regravada com dado de demonstração)', (fcx.match(/await fcxSet152\('esp2:/g) || []).length === 11, (fcx.match(/await fcxSet152\('esp2:/g) || []).length);
  const bk = fs.readFileSync(path.join(raiz, 'netlify/lib/backup-nuvem.mjs'), 'utf8');
  chk('a poda roda DENTRO da mesma transação que grava o ponto (criarManual, primeiro acesso e rotina agendada chamam podar(c, …) no callback de comTrava)',
    /comTrava\(async c => \{[\s\S]*?inserirPonto\(c, \{ tipo: 'MANUAL'[\s\S]*?await podar\(c, \[r\.id\], v152\)/.test(bk) && /inserirPonto\(c, \{ tipo: 'PRIMEIRO_ACESSO'[\s\S]*?await podar\(c, \[r\.id\], await recurso152\(c, sess\)\)/.test(bk) && /inserirPonto\(c, \{ tipo: 'AUTOMATICO'[\s\S]*?await podar\(c, \[r\.id\], v152\)/.test(bk));
  chk('a rotina das 23:59 faz UMA consulta leve antes de tudo e só grava snapshot se o dia (Brasília) não tem PRIMEIRO_ACESSO/MANUAL', /const pre = await jaTemPontoDoDia\(\);\s*\n\s*if \(pre\?\.ligado && pre\.id\) return \{ criado: false, pulado152: true/.test(bk) && /America\/Sao_Paulo/.test(bk));
}

/* ---------------------------------------------------------------------------------------------------------------------------------------
   1 · BACKUPS NA NUVEM — retenção de 2 pontos e rotina das 23:59 (Postgres de teste)
   --------------------------------------------------------------------------------------------------------------------------------------- */
let pg = null, sql = async () => { throw new Error('sem banco'); };
if (DB_URL) { pg = (await import('pg')).default; const pool = new pg.Pool({ connectionString: DB_URL, max: 4 }); sql = (t, p) => pool.query(t, p).then(r => r.rows); globalThis.__pool152 = pool; }
const BK = DB_URL ? await import('../netlify/lib/backup-nuvem.mjs') : null;
if (!DB_URL) { for (const n of ['1 · retenção de 2 backups, rotina 23:59 e filtros do servidor']) pula(n, 'NETLIFY_DB_URL não definida'); }
else {
  const ligado = v => sql(`INSERT INTO documentos (caminho, colecao, doc_id, dados) VALUES ('config/recursos', 'config', 'recursos', $1::jsonb) ON CONFLICT (caminho) DO UPDATE SET dados = EXCLUDED.dados, versao = documentos.versao + 1`, [JSON.stringify({ gestao_v152: { ativo: v } })]);
  const limpar = () => sql('DELETE FROM painel_backups_historico');
  const total = async () => (await sql('SELECT count(*)::int n FROM painel_backups_historico'))[0].n;
  const ids = async () => (await sql('SELECT id FROM painel_backups_historico ORDER BY data_hora, id')).map(r => Number(r.id));
  const afrouxar = () => sql(`UPDATE painel_backups_historico SET data_hora = data_hora - interval '2 minutes' WHERE tipo_backup = 'MANUAL' AND NOT preventivo`); // contorna o intervalo mínimo entre pontos manuais
  const sess = (on, perfil = 'MASTER') => ({ uid: 'usr-teste', perfil, usuario: { cpf: '39053344705', nome: 'Teste Master' }, recursoAtivo: k => (k === 'gestao_v152' ? on : false) });
  const deHoje = (tipo, extra = '') => sql(`INSERT INTO painel_backups_historico (tipo_backup, payload_json, total_registros, versao_painel, data_hora, preventivo) VALUES ($1, '{}', 0, 'v', now() - interval '3 minutes', ${extra || 'false'}) RETURNING id`, [tipo]);
  delete process.env.BACKUP_NUVEM_RETENCAO;

  /* retenção com o recurso ligado */
  await limpar(); await ligado(true);
  const criados = [];
  for (let i = 1; i <= 5; i++) { const r = await BK.criarManual(sess(true), 'ponto ' + i); criados.push(Number(r.ponto.id)); await afrouxar(); if (i === 1) chk('ligado: o 1º ponto é gravado e nada é podado', r.podados === 0 && (await total()) === 1, r.podados); if (i === 2) chk('ligado: o 2º ponto também (2 pontos guardados)', r.podados === 0 && (await total()) === 2); if (i === 3) chk('ligado: o 3º ponto grava o novo e APAGA o mais antigo na mesma chamada (sempre ≤ 2 no banco)', r.podados === 1 && (await total()) === 2, [r.podados, await total()]); }
  chk('ligado: depois de 5 pontos restam exatamente os 2 mais recentes (#4 e #5) e os 3 primeiros foram apagados', igual(await ids(), criados.slice(3)), [await ids(), criados]);
  const L = await BK.listar(sess(true));
  chk('listar com o recurso ligado informa retenção 2, v152 e 2 guardados', L.retencao === 2 && L.v152 === true && L.guardados === 2 && L.pontos.length === 2, [L.retencao, L.v152, L.guardados]);
  process.env.BACKUP_NUVEM_RETENCAO = '200';
  await limpar(); for (let i = 0; i < 4; i++) { await BK.criarManual(sess(true)); await afrouxar(); }
  chk('ligado: a variável BACKUP_NUVEM_RETENCAO não vale (a retenção é fixa em 2)', (await total()) === 2 && BK.retencao(true) === 2 && BK.RETENCAO_152 === 2);
  await limpar(); await sql(`INSERT INTO painel_backups_historico (tipo_backup, payload_json, total_registros, versao_painel, data_hora) SELECT 'AUTOMATICO', '{}', g, 'v', now() - (g + 30 || ' hours')::interval FROM generate_series(1, 40) g`);
  const antes = await total(), rr = await BK.criarManual(sess(true));
  chk('ligado: 40 pontos antigos herdados da v15.1 caem para 2 de uma vez só, logo depois de gravar o novo (o novo fica)', antes === 40 && rr.podados === 39 && (await total()) === 2 && (await ids()).includes(Number(rr.ponto.id)), [antes, rr.podados, await total()]);
  delete process.env.BACKUP_NUVEM_RETENCAO;

  /* desligado ≡ v15.1 */
  await limpar();
  for (let i = 0; i < 5; i++) { await BK.criarManual(sess(false)); await afrouxar(); }
  const Lo = await BK.listar(sess(false));
  chk('desligado: nada é apagado (5 pontos ficam) e a retenção continua a da v15.1 (padrão 60), sem a marca v152', (await total()) === 5 && Lo.retencao === 60 && !('v152' in Lo) && BK.retencao() === 60 && BK.retencao(false) === 60, [await total(), Lo.retencao]);
  await limpar();

  /* verificarPrimeiroAcesso */
  await limpar(); const pa = await BK.verificarPrimeiroAcesso(sess(true)); const pa2 = await BK.verificarPrimeiroAcesso(sess(true));
  chk('primeiro acesso: cria 1 ponto PRIMEIRO_ACESSO e a segunda chamada do dia não grava nada', pa.criado === true && pa2.criado === false && pa2.existe === true && (await total()) === 1);
  await limpar(); await sql(`INSERT INTO painel_backups_historico (tipo_backup, payload_json, total_registros, versao_painel, data_hora) SELECT 'AUTOMATICO', '{}', g, 'v', now() - (g + 30 || ' hours')::interval FROM generate_series(1, 6) g`);
  await BK.verificarPrimeiroAcesso(sess(true));
  chk('primeiro acesso ligado: o excedente é apagado na mesma transação (6 antigos + 1 novo → 2)', (await total()) === 2);

  /* rotina das 23:59 */
  await limpar(); await ligado(true); const m1 = (await deHoje('MANUAL'))[0].id;
  const a1 = await BK.agendado();
  chk('rotina 23:59 · já existe ponto MANUAL no dia civil de Brasília → encerra na hora, sem regravar o snapshot (nenhuma linha nova)', a1.criado === false && a1.pulado152 === true && Number(a1.id) === Number(m1) && (await total()) === 1 && igual(await ids(), [Number(m1)]), a1);
  await limpar(); const p1 = (await deHoje('PRIMEIRO_ACESSO'))[0].id; const a2 = await BK.agendado();
  chk('rotina 23:59 · já existe PRIMEIRO_ACESSO no dia → também encerra sem gravar', a2.pulado152 === true && Number(a2.id) === Number(p1) && (await total()) === 1, a2);
  await limpar(); await deHoje('AUTOMATICO'); const a3 = await BK.agendado();
  chk('rotina 23:59 · só um AUTOMATICO recente (não conta como PRIMEIRO_ACESSO/MANUAL): segue a idempotência de 20 h da v15.1, sem regravar', a3.criado === false && !a3.pulado152 && /20 horas/.test(a3.motivo) && (await total()) === 1, a3);
  await limpar(); await deHoje('MANUAL', 'true'); const a4 = await BK.agendado();
  chk('rotina 23:59 · o ponto PREVENTIVO de uma restauração não conta: a rotina grava o AUTOMATICO do dia', a4.criado === true && !a4.pulado152 && (await total()) === 2, a4);
  await limpar(); await sql(`INSERT INTO painel_backups_historico (tipo_backup, payload_json, total_registros, versao_painel, data_hora) VALUES ('MANUAL', '{}', 0, 'v', ((date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') - interval '1 minute') AT TIME ZONE 'America/Sao_Paulo'))`);
  const a5 = await BK.agendado();
  chk('rotina 23:59 · ponto MANUAL de ONTEM (1 minuto antes da meia-noite de Brasília) não vale para hoje: grava o do dia e a retenção segura 2', a5.criado === true && !a5.pulado152 && (await total()) === 2, a5);
  await limpar(); await sql(`INSERT INTO painel_backups_historico (tipo_backup, payload_json, total_registros, versao_painel, data_hora) VALUES ('PRIMEIRO_ACESSO', '{}', 0, 'v', LEAST(now(), ((date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') + interval '1 minute') AT TIME ZONE 'America/Sao_Paulo')))`);
  const a6 = await BK.agendado();
  chk('rotina 23:59 · ponto de 00:01 de Brasília (já é HOJE no fuso, mesmo sendo ontem em UTC) conta e a rotina encerra', a6.pulado152 === true && (await total()) === 1, a6);
  await limpar(); await sql(`INSERT INTO painel_backups_historico (tipo_backup, payload_json, total_registros, versao_painel, data_hora) SELECT 'AUTOMATICO', '{}', g, 'v', now() - (g + 30 || ' hours')::interval FROM generate_series(1, 8) g`);
  const a7 = await BK.agendado();
  chk('rotina 23:59 · sem ponto no dia: grava o AUTOMATICO e apaga o excedente logo depois (8 antigos + 1 → 2)', a7.criado === true && a7.podados === 7 && (await total()) === 2, [a7.criado, a7.podados, await total()]);
  const a8 = await BK.agendado();
  chk('rotina 23:59 · rodar de novo (nova tentativa do Netlify) não cria outro ponto', a8.criado === false && (await total()) === 2, a8);
  await limpar(); await ligado(false); await deHoje('MANUAL'); const a9 = await BK.agendado();
  chk('rotina 23:59 · com o recurso DESLIGADO (≡ v15.1): o ponto manual do dia não faz a rotina encerrar — ela grava como sempre e não poda', a9.criado === true && !a9.pulado152 && (await total()) === 2, a9);
  await limpar(); await ligado(true);
}

/* ---------------------------------------------------------------------------------------------------------------------------------------
   2 · SERVIDOR — filtros aditivos da listagem do FCX (só metas / só as chaves pedidas) com o servidor de teste de verdade
   --------------------------------------------------------------------------------------------------------------------------------------- */
if (DB_URL) {
  const { gerar } = await import('../netlify/lib/senha.mjs');
  const PORTA = 8897, U = 'http://localhost:' + PORTA, SENHA = 'Teste2026Ab', CPF = '39053344705';
  const srv = spawn(process.execPath, ['tests/servidor-local.mjs', String(PORTA)], { cwd: raiz, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((ok, no) => { const t = setTimeout(() => no(new Error('servidor de teste não subiu')), 15000); srv.stdout.on('data', d => { if (/painel local/.test(String(d))) { clearTimeout(t); ok(); } }); srv.on('exit', c => { clearTimeout(t); no(new Error('servidor saiu ' + c)); }); });
  try {
    const doc = (caminho, dados) => { const i = caminho.indexOf('/'); return sql(`INSERT INTO documentos (caminho, colecao, doc_id, dados) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (caminho) DO UPDATE SET dados = EXCLUDED.dados, versao = documentos.versao + 1`, [caminho, caminho.slice(0, i), caminho.slice(i + 1), JSON.stringify(dados)]); };
    await doc('usuarios/usr-152', { perfil: 'MASTER', nome: 'Teste Master 152', cpf: CPF, ativo: true, permissoes: {}, trocarSenha: false, senha: gerar(SENHA, 'sal-152') });
    const r0 = await fetch(U + '/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json', 'x-painel': '1' }, body: JSON.stringify({ cpf: CPF, senha: SENHA }) });
    const ck = (r0.headers.get('set-cookie') || '').split(';')[0]; if (!ck) throw new Error('login de teste falhou: ' + r0.status);
    const grande = 'x'.repeat(79000);
    for (const [k, n] of [['esp2:saidas', 3], ['esp2:config', 1], ['esp2:orcamento', 2]]) {
      await doc('fcx/' + k, { chave: k, partes: n, tamanho: n * 79000, atualizadoEm: '2026-11-10T10:00:00.000Z' });
      for (let i = 0; i < n; i++) await doc(`fcx/${k}~${i}`, { v: grande });
    }
    const lista = async q => { const r = await fetch(U + '/api/docs?colecao=fcx' + q, { headers: { cookie: ck, 'x-painel': '1' } }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* texto */ } return { s: r.status, j, bytes: t.length, ids: (j?.docs || []).map(d => d.id).sort() }; };
    const todos = await lista(''), metas = await lista('&semFatias=1'), so = await lista('&idPrefixos=' + encodeURIComponent('esp2:saidas')), dois = await lista('&idPrefixos=' + encodeURIComponent('esp2:saidas,esp2:config'));
    chk('sem filtro, a listagem do FCX continua igual à v15.1: 3 metas + 6 fatias, sem a marca filtrado152', todos.s === 200 && todos.ids.length === 9 && !todos.j.filtrado152, [todos.s, todos.ids.length]);
    chk('semFatias=1 devolve só as 3 metas (nenhuma fatia "~") e marca filtrado152; a resposta é uma fração dos bytes da lista completa', metas.s === 200 && metas.j.filtrado152 === true && igual(metas.ids, ['esp2:config', 'esp2:orcamento', 'esp2:saidas']) && metas.bytes < todos.bytes / 20, [metas.ids, metas.bytes, todos.bytes]);
    chk('idPrefixos=esp2:saidas devolve só a meta e as 3 fatias dessa chave (o prefixo não puxa chaves de nome parecido)', so.s === 200 && so.j.filtrado152 === true && igual(so.ids, ['esp2:saidas', 'esp2:saidas~0', 'esp2:saidas~1', 'esp2:saidas~2']), so.ids);
    chk('idPrefixos aceita várias chaves separadas por vírgula (saidas + config = 2 metas + 4 fatias)', dois.s === 200 && dois.ids.length === 6 && !dois.ids.some(i => i.startsWith('esp2:orcamento')), dois.ids);
    const vinte1 = await lista('&idPrefixos=' + encodeURIComponent(Array.from({ length: 21 }, (_, i) => 'k' + i).join(',')));
    const comTil = await lista('&idPrefixos=' + encodeURIComponent('esp2:saidas~0'));
    const outra = await fetch(U + '/api/docs?colecao=lojas&semFatias=1', { headers: { cookie: ck, 'x-painel': '1' } });
    const semSessao = await fetch(U + '/api/docs?colecao=fcx&semFatias=1');
    chk('limites: mais de 20 chaves → 400; chave com "~" → 400; semFatias em outra coleção → 400; sem login → 401 (mesma regra de acesso de qualquer listagem)', vinte1.s === 400 && comTil.s === 400 && outra.status === 400 && semSessao.status === 401, [vinte1.s, comTil.s, outra.status, semSessao.status]);
  } finally { srv.kill(); await sql(`DELETE FROM documentos WHERE colecao = 'fcx'`); }
}

/* ---------------------------------------------------------------------------------------------------------------------------------------
   AMBIENTE — o código REAL do painel (ponte do FCX, Z152, Saidas152, CNAB152, CNAB17, PAGTO17, DFC) com Repo/UI/banco de brincadeira
   --------------------------------------------------------------------------------------------------------------------------------------- */
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
   3 · FRENTE 1 (c) — COMPACTAÇÃO GZIP DE esp2:saidas E CACHE LOCAL POR VERSÃO/HASH (ponte real do FCX sobre o banco simulado)
   --------------------------------------------------------------------------------------------------------------------------------------- */
{
  const titulo = i => ({ id: 'p-' + i, date: `2026-0${1 + (i % 6)}-${String(1 + (i % 28)).padStart(2, '0')}`, dataPagamento: `2026-0${1 + (i % 6)}-${String(1 + (i % 28)).padStart(2, '0')}`, tipo: i % 3 ? 'pago' : 'previsto', valor: 100 + (i % 977) + (i % 7) / 100,
    conta: '4.10.06 – (-) Aluguel de Loja de Rua', centro: 'LOJA ' + (1 + (i % 12)), fornecedor: 'FORNECEDOR ' + (i % 300) + ' LTDA', obs: 'Pagamento referente à competência ' + (i % 12) + ' — ação número ' + i, contaPagamento: i % 2 ? 'ESPOSENDE -SANTANDER' : 'MAR ABERTO - SANTANDER', erp17: 'A' });
  const lista = Array.from({ length: 12000 }, (_, i) => titulo(i)), json = JSON.stringify(lista), json2 = JSON.stringify(lista.slice(0, 11999).concat([{ ...lista[11999], valor: 1 }]));
  const E1 = amb152(), A = E1.banco, Z = E1.Z152, F = E1.FCX;
  chk('Z152 · compactar → descomprimir devolve o texto idêntico (acentos, travessão, emoji)', await (async () => { const t = 'Pagamento a fornecedores – ação ✓ 😀 ' + 'x'.repeat(5000); return (await Z.descomprimir(await Z.compactar(t))) === t; })());
  chk('Z152 · impressão (hash) estável e sensível a 1 caractere; assinatura inclui versão, tamanho e hash', Z.hash(json) === Z.hash(json) && Z.hash(json) !== Z.hash(json2) && /\|\d+\|\d+\|gzip-b64\|/.test(Z.sig({ atualizadoEm: 'x', partes: 3, tamanho: 9, z: 'gzip-b64', hash: 'h' })) || Z.sig({ atualizadoEm: 'x', partes: 3, tamanho: 9, z: 'gzip-b64', hash: 'h' }).includes('gzip-b64'));
  await F.storage.set('esp2:saidas', json); await F.storage.set('esp2:config', '{"a":1}'); await espera(60);
  const meta = A.docs.get('fcx/esp2:saidas'), fatias = Array.from({ length: meta.partes }, (_, i) => A.docs.get('fcx/esp2:saidas~' + i).v), guardado = fatias.join('');
  chk(`gravação · esp2:saidas (${(json.length / 1024).toFixed(0)} KB, 12.000 títulos) vai compactado: gzip em base64 com marcador z1:, ${(guardado.length / 1024).toFixed(0)} KB no banco (${(100 * guardado.length / json.length).toFixed(1)}%)`, meta.z === 'gzip-b64' && guardado.startsWith('z1:') && guardado.length < json.length * 0.25, [meta.z, guardado.length, json.length]);
  chk('gravação · o documento-meta guarda tamanho do JSON original, tamanho guardado e a impressão (hash) do original', meta.tamanho === json.length && meta.zTamanho === guardado.length && meta.hash === Z.hash(json) && meta.chave === 'esp2:saidas', meta);
  chk('gravação · só esp2:saidas é compactada; as outras chaves do FCX seguem como eram (texto puro, sem z)', A.docs.get('fcx/esp2:config').z === undefined && A.docs.get('fcx/esp2:config~0').v === '{"a":1}');
  chk('leitura · a ponte devolve o JSON idêntico ao enviado (descompacta sozinha)', (await F.storage.get('esp2:saidas')).value === json);
  const E1b = amb152({ banco: A }); const lido = await E1b.FCX.storage.get('esp2:saidas');
  chk('leitura em sessão nova (sem cache em memória) · idêntica, e o cache local (IndexedDB) já tinha a versão gravada: nada de fatia baixada', lido.value === json && E1b.Z152.stats.doCache === 2 && E1b.Z152.stats.baixadas === 0, E1b.Z152.stats);
  A.zerar(); const E2 = amb152({ banco: A }); await E2.FCX.precarregar();
  const kbMetas = A.bytesBaixados;
  chk(`cache · sessão nova com o banco igual: só os documentos-meta descem (${A.docsBaixados} docs, ${A.bytesBaixados} bytes), 0 chaves baixadas, ${E2.Z152.stats.doCache} servidas do IndexedDB`, E2.Z152.stats.baixadas === 0 && E2.Z152.stats.bytesBaixados === 0 && A.bytesBaixados < 2000 && A.docsBaixados === 2 && A.gets === 0, [E2.Z152.stats, A.bytesBaixados, A.docsBaixados]);
  const g0 = A.chamadas.length; for (let i = 0; i < 25; i++) { await E2.FCX.precarregar(); await E2.FCX.storage.get('esp2:saidas'); await E2.FCX.storage.get('esp2:config'); }
  chk('navegação · 25 idas e vindas entre FCX e DFC na mesma sessão não fazem nenhuma consulta nova ao banco (cache em memória)', A.chamadas.length === g0, A.chamadas.slice(g0).slice(0, 3));
  /* outro usuário grava uma versão nova */
  { const meu = globalThis.indexedDB; globalThis.indexedDB = idbSimulado(); /* outro usuário = outro navegador, com o IndexedDB dele */ const E3 = amb152({ banco: A }); await E3.FCX.storage.set('esp2:saidas', json2); await espera(60); globalThis.indexedDB = meu; }
  A.zerar(); const E4 = amb152({ banco: A }); const v4 = await E4.FCX.storage.get('esp2:saidas');
  chk('versão nova no banco · a sessão seguinte baixa só a chave que mudou (1 de 2), recebe o conteúdo novo e não serve o cache velho', E4.Z152.stats.baixadas === 1 && E4.Z152.stats.doCache === 1 && v4.value === json2 && v4.value !== json, E4.Z152.stats);
  chk('versão nova no banco · o que desce é o texto compactado, uma fração do JSON', A.bytesBaixados < json2.length * 0.3, [A.bytesBaixados, json2.length]);
  A.zerar(); const E5 = amb152({ banco: A }); await E5.FCX.precarregar();
  chk('cache atualizado · depois disso o IndexedDB passa a ter a versão nova e a sessão seguinte já não baixa nada', E5.Z152.stats.baixadas === 0 && E5.Z152.stats.doCache === 2, E5.Z152.stats);
  /* cache adulterado */
  { const db = await E5.Z152.idb(); await E5.Z152.gravarCache(db, 'esp2:saidas', E5.Z152.sig(A.docs.get('fcx/esp2:saidas')), '[{"id":"adulterado"}]'); await E5.Z152.limpar().catch(() => { }); }
  const E5b = amb152({ banco: A }); await E5b.FCX.precarregar(); await E5b.FCX.storage.get('esp2:saidas');
  chk('cache limpo ao sair do painel (Sessao.encerrar → Z152.limpar): a sessão seguinte baixa de novo (nada de dado do FCX fica no navegador)', E5b.Z152.stats.baixadas >= 1);
  { const E6 = amb152({ banco: A }); await E6.FCX.precarregar(); await espera(60); const db = await E6.Z152.idb(); await E6.Z152.gravarCache(db, 'esp2:saidas', E6.Z152.sig(A.docs.get('fcx/esp2:saidas')), '[{"id":"adulterado"}]');
    const E7 = amb152({ banco: A }); const v7 = await E7.FCX.storage.get('esp2:saidas');
    chk('cache adulterado (mesma versão, conteúdo diferente) é descartado pelo tamanho/hash e o conteúdo vem do banco', v7.value === json2 && E7.Z152.stats.baixadas === 1, E7.Z152.stats); }
  /* servidor antigo */
  { A.zerar(); A.semFiltro = true; await E5.Z152.limpar().catch(() => { }); const E8 = amb152({ banco: A }); const v8 = await E8.FCX.storage.get('esp2:saidas'); A.semFiltro = false;
    chk('servidor sem os filtros novos (v15.1): o painel percebe que a lista veio com as fatias, usa o que veio e o conteúdo está certo', E8.Z152.stats.semFiltro === true && v8.value === json2, E8.Z152.stats); }
  /* rollback seguro: documento compactado lido com o recurso DESLIGADO */
  { const Eoff = amb152({ banco: A, g152: false }); const v = await Eoff.FCX.storage.get('esp2:saidas');
    chk('volta à v15.1 · com o recurso desligado, um documento já compactado é lido descompactado (o FCX não fica sem as Saídas)', v.value === json2, String(v && v.value).slice(0, 60)); }
  { const B2 = bancoSimulado(), Eo = amb152({ banco: B2, g152: false }); await Eo.FCX.storage.set('esp2:saidas', json); const m = B2.docs.get('fcx/esp2:saidas'), g = Array.from({ length: m.partes }, (_, i) => B2.docs.get('fcx/esp2:saidas~' + i).v).join('');
    chk('desligado ≡ v15.1 · a gravação é texto puro, em fatias de 80.000 caracteres, sem z/hash no meta e sem consulta com filtros', g === json && m.z === undefined && m.hash === undefined && m.partes === Math.ceil(json.length / 80000) && !B2.chamadas.some(c => /semFatias|idPrefixos/.test(c[2] || '')), [m, B2.chamadas.slice(0, 2)]); }
  /* gzip ilegível: nunca "ausente", nunca sobrescreve */
  { const B3 = bancoSimulado(), Ea = amb152({ banco: B3 }); await Ea.FCX.storage.set('esp2:saidas', json); await Ea.FCX.storage.set('esp2:config', '{"a":1}'); await espera(60);
    const s0 = B3.docs.get('fcx/esp2:saidas~0'); B3.docs.set('fcx/esp2:saidas~0', { v: 'z1:@@@@' + s0.v.slice(8) });
    await Ea.Z152.limpar().catch(() => { }); const Eb = amb152({ banco: B3 }); const antes = JSON.stringify([...B3.docs]);
    const lerErr = await Eb.FCX.storage.get('esp2:saidas').then(() => null, e => e.message), setErr = await Eb.FCX.storage.set('esp2:saidas', '[]').then(() => null, e => e.message), outra = await Eb.FCX.storage.get('esp2:config');
    chk('gzip corrompido no banco · a leitura vira ERRO ("Não consegui descompactar…"), não "chave ausente"; as outras chaves continuam legíveis', /descompactar/i.test(lerErr || '') && outra && outra.value === '{"a":1}', [lerErr, outra]);
    chk('gzip corrompido no banco · a ponte RECUSA gravar por cima (nada é alterado no banco) — o FCX nunca regrava dados reais com o estado inicial', /descompactar/i.test(setErr || '') && JSON.stringify([...B3.docs]) === antes, setErr); }
  /* sem CompressionStream */
  { const B4 = bancoSimulado(), Ec = amb152({ banco: B4 }); Ec.Z152.temGzip = () => false; await Ec.FCX.storage.set('esp2:saidas', json); const m = B4.docs.get('fcx/esp2:saidas');
    chk('navegador sem CompressionStream · grava texto puro (como sempre), com hash no meta, e lê normalmente', m.z === undefined && B4.docs.get('fcx/esp2:saidas~0').v.startsWith('[{') && (await Ec.FCX.storage.get('esp2:saidas')).value === json, m); }
  /* só leitura */
  { const B5 = bancoSimulado(), Ed = amb152({ banco: B5, pode: k => k !== 'fcx.editar' }); const e = await Ed.FCX.storage.set('esp2:saidas', json).then(() => null, x => x.message);
    chk('perfil sem fcx.editar · a ponte compactada continua recusando gravar (somente leitura), nada chega ao banco', /somente leitura/i.test(e || '') && B5.docs.size === 0, e); }
  /* F5 já na tela do FCX: o precarregar roda ANTES de a coleção config (as flags) chegar — tem de esperar e só então escolher o caminho (senão baixa tudo, sem cache, até o próximo F5) */
  { const B6 = bancoSimulado(), Ew = amb152({ banco: B6 }); await Ew.FCX.storage.set('esp2:saidas', json); const E7 = amb152({ banco: B6 }); await E7.FCX.precarregar(); await espera(60); // 1ª leitura: aquece o IndexedDB
    const E8 = amb152({ banco: B6 }); E8.Repo.prontas.delete('config'); E8.g152 = false; B6.zerar(); // flag ainda desconhecida: config não chegou
    const p = E8.FCX.precarregar(); await espera(200); const antes = B6.chamadas.length; E8.g152 = true; E8.Repo.prontas.add('config'); await p;
    chk('F5 na tela do FCX · com as flags ainda não carregadas o precarregar ESPERA a coleção config (nada é baixado antes) e depois usa o caminho compactado: só os metas, Saídas vindas do cache', antes === 0 && B6.chamadas.some(c => c[0] === 'list' && /semFatias/.test(c[2])) && !B6.chamadas.some(c => c[0] === 'list' && !/semFatias|idPrefixos/.test(c[2])) && E8.Z152.stats.doCache >= 1 && E8.Z152.stats.baixadas === 0, [antes, B6.chamadas.map(c => c.join(' ')).slice(0, 6), E8.Z152.stats]);
    const E9 = amb152({ banco: B6, g152: false }); E9.Repo.prontas.delete('config'); B6.zerar(); const p9 = E9.FCX.precarregar(); await espera(100); E9.Repo.prontas.add('config'); await p9;
    chk('F5 na tela do FCX · com a flag DESLIGADA o precarregar espera a config e segue o caminho de sempre (lista completa), sem demorar além disso', B6.chamadas.filter(c => c[0] === 'list').length === 1 && !/semFatias|idPrefixos/.test(B6.chamadas.find(c => c[0] === 'list')[2]), B6.chamadas.map(c => c.join(' ')));
    const E10 = amb152({ banco: B6 }); E10.Repo.prontas.delete('config'); E10.g152 = false; const t0 = Date.now(); await E10.FCX.precarregar();
    chk('F5 na tela do FCX · se a config nunca chegar, a espera é limitada (6 s) e o FCX abre pelo caminho de sempre', Date.now() - t0 >= 5800 && Date.now() - t0 < 9000, Date.now() - t0); }
}

/** o código REAL de FCX › Saídas (public/fcx.html: gravação conferida e importação inteligente) com o estado do FCX e a ponte do painel de brincadeira */
const fcxV152Cod = corta(fcx, 'function fcxV152(){', '\n') + '\n' + corta(fcx, 'function fcxLeitor1522(){', '\n'), fcxBRL2Cod = corta(fcx, 'const BRL2 = ', '\n'), fcxGlueCod = corta(fcx, 'function fcxEsc152(t)', '\nif(!state._saidaForm)');
function fcxGlue(E, { saidas = [], mes = '2026-01' } = {}) {
  const state = { saidas: saidas.map(s => ({ ...s })), config: { accounts: [], costCenters: [] }, _saidaFilter: { month: mes }, _erroLeitura: new Set(), _saidasImportMode: 'smart' }, G = { state, toasts: [], renders: 0, cargas: [], salvouConfig: 0 };
  const P = { Recursos: { ativo: k => k === 'gestao_v152' && E.g152 }, g152: () => E.g152, Saidas152: E.Saidas152, Pagto17: E.Pagto17, Leitor1521: E.Leitor1521, CargaFeedback: { mostrar: r => { G.cargas.push(r); } } };
  const lerOrig = E.Pagto17.lerArquivo.bind(E.Pagto17); if (!E.Pagto17.__matriz152) { E.Pagto17.__matriz152 = true; E.Pagto17.lerArquivo = async (f, lib) => (f.__sheets ? { nome: f.name, tamanho: f.size || 1, sheets: f.__sheets } : lerOrig(f, lib)); } // arquivo "de matrizes": passa pelo mesmo leitor/plano/gravação, sem depender do SheetJS
  const win = { __embed: true, parent: P, storage: E.FCX.storage, XLSX: E.xlsx || XLSX };
  const fn = new Function('window', 'state', 'showToast', 'render', 'toISO', 'saveConfig', 'fcxCarga99', 'fcx1386Nova', 'fcxV1378',
    fcxV152Cod + '\n' + fcxBRL2Cod + '\n' + fcxGlueCod + '\nreturn { fcxV152, fcxLeitor1522, saveSaidas152, fcxImportSaidas152, aplicarImportacaoSaidas152, confirmarImportacaoSaidas152, cancelarImportacaoSaidas152, substituirConflitoSaidas152, bloquearConflitoSaidas152, fcxPainelSaidas152, fcxSelectModo152, fcxHintImport152, BRL2 };');
  const F = fn(win, state, m => G.toasts.push(m), () => { G.renders++; }, d => d.toISOString().slice(0, 10), async () => { G.salvouConfig++; }, r => { G.cargas.push(r); }, () => { }, () => false);
  return Object.assign(G, F, { win });
}
const arquivoDe = (nome, conteudo) => { const buf = Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo, 'utf8'); return { name: nome, size: buf.length, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }; };
const aoa = (nome, rows) => ({ nome, rows });
const arquivoMatriz = (nome, sheets) => ({ name: nome, size: 4096, __sheets: sheets });

/* ---------------------------------------------------------------------------------------------------------------------------------------
   FIXTURES — Janeiro/2026: extrato dos dois bancos, Contas a Pagar atual (layout A) e baixas do ERP antigo (layout B, abas PGTO.* e AgendaPagto)
   --------------------------------------------------------------------------------------------------------------------------------------- */
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
const shA = rows => [aoa('Contas a Pagar', [CAB_A, ...rows])];
const CAB_B = ['Item', 'Título', 'Fornecedor', 'Conta', 'Pagamento', 'Vlr Líquido', 'Forma Pagto', 'Instruções', 'Descrição do Título', 'Nome Loja'];
const dB = (d, m = 1, a = 2026) => new Date(a, m - 1, d, 12, 0, 0);
const LINHAS_B = [
  [468, '1001', 'IMOBILIARIA ALFA LTDA', '070-ESPOSENDE -SANTANDER', dB(5), 5000, '2-TED', '', 'Aluguel loja de rua jan', 'LOJA 01 RUA'],
  [187, '1002', 'FOLHA DE PAGAMENTO', '070-ESPOSENDE -SANTANDER', dB(5), 3000.5, '2-TED', '', 'Salários jan', ''],
  [475, '1003', 'CONSTRUTORA DELTA', '070-ESPOSENDE -SANTANDER', dB(6), 7000, '2-TED', '', 'Obra loja nova', 'LOJA 09'],
  [217, '1004', 'AGENCIA ECO', '070-ESPOSENDE -SANTANDER', '05/01/2026', 1500.25, '2-TED', '', 'Mídia jan', ''],
  [468, '1005', 'IMOBILIARIA OMEGA', '070-ESPOSENDE -SANTANDER', dB(7), 4000, '2-TED', 'Baixa Estornada em 08/01', 'Aluguel estornado', 'LOJA 02'],
  [210, '1006', 'ENERGIA S/A', 'CONCILIAÇÃO GETNET', dB(7), 900, '2-TED', '', 'Conciliação interna', 'LOJA 01 RUA'],
  [5, '1007', 'FORNECEDOR CAIXA', '001-CAIXA', dB(7), 450, '1-DINHEIRO', '', 'Pago em caixa', ''],
  [5, '1008', 'CLIENTE CREDIARIO', '070-ESPOSENDE -SANTANDER', dB(8), 320, '4-CR CREDIARIO', '', 'Crediário', ''],
  [468, '1009', 'IMOBILIARIA SIGMA', '091-MAR ABERTO - SANTANDER', dB(5), 2500, '2-TED', '', 'Aluguel loja mar aberto', 'LOJA 05 SHOPPING'],
  [999, '1010', 'FORNECEDOR NOVO', '080-CAIXA ECONÔMICA FEDERAL', dB(9), 300, '2-TED', '', 'Item fora da tabela', ''],
  [12, '1011', 'TRANSFERENCIA INTERNA', '070-ESPOSENDE -SANTANDER', dB(5), 600, '2-TED', '', 'Transferência', ''],
  ['Total', null, null, null, null, 99999, null, null, null, null],
];
const abaTratada = (nome, linhas) => aoa(nome, [['Esposende Calçados — Relação dos Títulos Pagos'], ['Período: janeiro/2026'], [], CAB_B, ...linhas]);
const CAB_BRUTA = ['', 'Item', 'Fornecedor', 'Conta', 'Pagamento', 'Vlr Líquido', 'Instruções', 'Forma Pagto', 'Descrição do Título', 'Nome Loja'];
const abaBruta = linhas => aoa('AgendaPagto', [['Esposende Calçados — AgendaPagto'], ['Emitido em 02/02/2026'], [], [], [], CAB_BRUTA, ...linhas.map(l => ['', l[0], l[2], l[3], l[4], l[5], l[7], l[6], l[8], l[9]])]);
const shB = linhas => [abaTratada('PGTO.JANEIRO26', linhas), abaBruta(linhas)];
const EXT_JAN = () => [
  { id: 'd-esp', contaId: 'ct-esp', mes: '2026-01', transacoes: [{ id: 't0', data: '2026-01-02', valor: 120000, hist: 'RECEBIMENTO CARTOES' }, { id: 't1', data: '2026-01-06', valor: -16500.75, hist: 'PAGTO FORNECEDORES CNAB 0601', isLoteCnab: true },
    { id: 't2', data: '2026-01-07', valor: -100, hist: 'TARIFA BANCARIA' }, { id: 't5', data: '2026-01-12', valor: -2500.4, hist: 'PAGAMENTO ENERGIA' }, { id: 't6', data: '2026-01-20', valor: 310.05, hist: 'RENDIMENTO APLICACAO' }] },
  { id: 'd-mar', contaId: 'ct-mar', mes: '2026-01', transacoes: [{ id: 't3', data: '2026-01-06', valor: -2500, hist: 'REMESSA PAGTO', isLoteCnab: true }, { id: 't7', data: '2026-01-15', valor: 8000, hist: 'DEPOSITO CLIENTE' }] },
];
const SOMA_OFX_JAN = EXT_JAN().flatMap(d => d.transacoes).reduce((s, t) => s + c100(t.valor), 0);
const catsDe = l => Object.fromEntries(l.cats.map(g => [g.cat, g.cents / 100]));
const somaCat = c => Object.values(c.porCategoria).reduce((s, x) => s + c100(x.valor), 0);
const somaLista = l => l.reduce((s, x) => s + c100(x.valor), 0);
const noMes = (l, mes) => l.filter(t => String(t.data).startsWith(mes));
/** DFC do mês como a tela monta: lançamentos do extrato com os lotes desdobrados (virtuais) × o extrato como veio */
const dfcMes = (E, mes, desdobrado = true) => { const regras = E.DFC.regras(), trs = noMes(desdobrado ? E.FluxoDFC.transacoesDFC() : E.FluxoDFC.transacoes(), mes); return { trs, c: E.DFC.consolidar(trs, regras) }; };
const gravadas = async E => JSON.parse((await E.FCX.storage.get('esp2:saidas')).value);

chk('fixtures · Janeiro/2026: Σ dos lançamentos do OFX (dois bancos) = R$ 106.708,90 (10.670.890 centavos)', SOMA_OFX_JAN === 10670890, SOMA_OFX_JAN);
const E0 = amb152(), A0 = E0.PAGTO17.interpretar(shA(A_ROWS_JAN), { soBaixas: false }), B0 = E0.PAGTO17.interpretar(shB(LINHAS_B), {});
chk('fixtures · os dois layouts são lidos pelo leitor real: A (6 títulos Jan, 5 Pago) e B pelo leitor da v15.1 (7 baixas válidas = R$ 19.900,75; estornada, internas e crediário ficam de fora)',
  A0.layout === 'A' && A0.linhas.length === 6 && A0.linhas.filter(x => x.tipo === 'pago').length === 5 && B0.layout === 'B' && B0.linhas.length === 7 && B0.totalCents === 1990075 && B0.contagem.estornadas === 1 && B0.contagem.internas === 2 && B0.contagem.crediario === 1, [A0.layout, A0.linhas.length, B0.layout, B0.linhas.length, B0.totalCents, B0.contagem]);

/* ---------------------------------------------------------------------------------------------------------------------------------------
   4 · FCX › SAÍDAS — importação unificada, inteligente por mês, gravação conferida no banco e reflexo imediato na DFC
   --------------------------------------------------------------------------------------------------------------------------------------- */
{
  const E = amb152({ ext: EXT_JAN() }), G = fcxGlue(E), manual = { id: 'manual-1', date: '2026-01-15', conta: CT.material, centro: 'GESTÃO', tipo: 'previsto', valor: 77.7, fornecedor: 'LANÇAMENTO MANUAL', obs: 'à mão' };
  G.state.saidas.push(manual);
  const ok1 = await G.fcxImportSaidas152(arquivoMatriz('contas_a_pagar_dia1.csv', shA([...A_ROWS_JAN, A_ROW_FEV]))); await espera(120);
  const gv = G.state._saidasGravacao, totalCents = somaLista(G.state.saidas), jan = G.state.saidas.filter(s => String(s.date).startsWith('2026-01')), pagoJan = jan.filter(s => s.tipo === 'pago');
  chk('A · importação (ERP Sállamos) de Janeiro/Fevereiro: só os 6 títulos Pago entram (o A Vencer fica de fora) + 1 lançamento manual preservado, sem confirmação pendente (nada encolheu)', ok1 === true && G.state.saidas.length === 7 && G.state.saidas.some(s => s.id === 'manual-1') && !G.state._saidasPendente152, [G.state.saidas.length, G.state._saidasPendente152 && 'pendente']);
  chk('A · gravação conferida: o banco foi relido, o conteúdo bate (conferência completa) e informa registros e R$ gravados (total e por mês)', gv && gv.ok === true && gv.conferencia === 'completa' && gv.n === 7 && gv.cents === totalCents && gv.porMes['2026-01'].n === jan.length && gv.porMes['2026-01'].cents === somaLista(jan) && gv.porMes['2026-01'].pago.n === 5 && gv.porMes['2026-01'].pago.cents === somaLista(pagoJan) && /Postgres/.test(gv.onde), gv);
  chk('A · o que ficou no banco é exatamente a lista da tela (mesmo JSON) — lido pela ponte e por uma sessão nova do painel', (await gravadas(E)) && igual(await gravadas(E), G.state.saidas) && igual(await gravadas(amb152({ banco: E.banco })), G.state.saidas));
  const pn = G.fcxPainelSaidas152(), brl = G.BRL2;
  chk('A · confirmação visual: faixa verde com "7 registro(s) · R$ …" e a linha do mês "01/2026: 6 título(s) · R$ … (Pago: 5 · R$ …)"', /id="saidasGravacao152" data-ok="1"/.test(pn) && pn.includes('7 registro(s) · ' + brl(totalCents / 100)) && pn.includes('Mês <b>01/2026</b>: ' + jan.length + ' título(s) · ' + brl(somaLista(jan) / 100)) && pn.includes('(Pago: 5 · ' + brl(somaLista(pagoJan) / 100) + ')') && /Conferência completa/.test(pn), pn.slice(0, 700));
  chk('A · relatório de carga (popup): lidas/importadas, "Gravado no banco (conferido)" e o mês', (r => r && r.processadas === 6 && r.campos.some(c => c[0] === 'Gravado no banco (conferido)' && /7 registro\(s\)/.test(c[1])) && r.campos.some(c => /01\/2026/.test(c[0]) && /Pago: 5/.test(c[1])) && !r.erro)(G.cargas[G.cargas.length - 1]), G.cargas[G.cargas.length - 1]);
  /* a DFC lê a mesma base e reflete na hora */
  const p1 = E.FluxoDFC.planoCnab17(), l1 = p1 && p1.porTx.get('ct-esp|t1'), lm = p1 && p1.porTx.get('ct-mar|t3');
  chk('DFC · logo depois de gravar, a DFC de Janeiro relê FCX › Saídas e desdobra o lote da Esposende pelos títulos Pago: Aluguel 5.000,00 · Pessoal 3.000,50 · Marketing 1.500,25 (a obra de 7.000,00 fica em Fornecedores)',
    l1 && igual(catsDe(l1), { pag_ocupacao: 5000, pag_folha: 3000.5, pag_marketing: 1500.25 }) && l1.resto === 700000 && l1.cap === 1650075 && p1.naoRealocado.cents === 700000 && p1.integridade.ok, l1 && [catsDe(l1), l1.resto]);
  chk('DFC · o lote da Mar Aberto usa a conta de pagamento certa (Conta Bancária preenchida) e o da Esposende o fallback Banco de Pagamento; o nome sai padronizado (ESPOSENDE - SANTANDER) e casa com a conta cadastrada (ESPOSENDE -SANTANDER)', lm && igual(catsDe(lm), { pag_ocupacao: 2500 }) && lm.resto === 0 && l1.alocs.every(a => a.x.contaPag === 'ESPOSENDE - SANTANDER') && lm.alocs.every(a => a.x.contaPag === 'MAR ABERTO - SANTANDER'), [l1 && l1.alocs.map(a => a.x.contaPag), lm && lm.alocs.map(a => a.x.contaPag)]);
  chk('DFC · só títulos PAGO entram (o A Vencer de R$ 800 nem chega à base) e cada título entra uma única vez', (ids => ids.length === new Set(ids).size && ids.every(i => G.state.saidas.find(s => s.id === i).tipo === 'pago'))(p1.lotes.flatMap(l => l.alocs.map(a => a.x.id))));
  chk('DFC · a base mensal de Janeiro foi regravada depois da importação (a DFC não espera o usuário clicar em Recalcular)', E.bases.some(m => (Array.isArray(m) ? m : [m]).includes('2026-01')), E.bases);
  /* reimportar o mesmo arquivo: nada duplica */
  const idsAntes = G.state.saidas.map(s => s.id).sort();
  await G.fcxImportSaidas152(arquivoMatriz('contas_a_pagar_dia1.csv', shA([...A_ROWS_JAN, A_ROW_FEV]))); await espera(120);
  const rel2 = G.cargas[G.cargas.length - 1], plano2 = E.FluxoDFC.planoCnab17(), l2 = plano2.porTx.get('ct-esp|t1');
  chk('A · subir de novo o MESMO arquivo não duplica nada: 7 registros, os mesmos ids, 6 substituídos (mesmo mês e mesmo ERP) e o lançamento manual intacto', G.state.saidas.length === 7 && igual(G.state.saidas.map(s => s.id).sort(), idsAntes) && rel2.campos.some(c => c[0].startsWith('Substituídos') && c[1] === '6') && G.state.saidas.find(s => s.id === 'manual-1').valor === 77.7, rel2.campos);
  chk('DFC · depois da reimportação o desdobramento é o mesmo (nenhum título contado duas vezes, lote não passa do teto)', igual(catsDe(l2), catsDe(l1)) && new Set(l2.alocs.map(a => a.x.id)).size === l2.alocs.length && l2.realocado <= l2.cap);
  /* arquivo atualizado do dia: o A Vencer de Janeiro virou Pago e entrou um título novo; Fevereiro não vem no arquivo */
  const GAMA_PAGO = ['Pago', 'CONTABIL GAMA', 'R$800.00', 'R$800.00', '20/01/2026', '20/01/2026', CT.contab, 'GESTÃO', '', 'ESPOSENDE -SANTANDER', 'Boleto', 'Honorários'];
  const ENERGIA_NOVA = ['Pago', 'ENERGIA S/A', 'R$900.00', 'R$900.00', '06/01/2026', '05/01/2026', CT.energia, 'LOJA 01', '', 'ESPOSENDE -SANTANDER', 'Boleto', 'Energia jan'];
  await G.fcxImportSaidas152(arquivoMatriz('contas_a_pagar_dia2.csv', shA([...A_ROWS_JAN.slice(0, 5), GAMA_PAGO, ENERGIA_NOVA]))); await espera(120);
  const gama = G.state.saidas.filter(s => s.fornecedor === 'CONTABIL GAMA');
  chk('A · arquivo atualizado do dia (A Vencer → Pago + título novo): CONTABIL GAMA entra UMA vez, como Pago; Fevereiro (fora do arquivo) e o manual não são tocados; 9 registros', gama.length === 1 && gama[0].tipo === 'pago' && gama[0].dataPagamento === '2026-01-20' && G.state.saidas.some(s => s.fornecedor === 'PAPELARIA PI') && G.state.saidas.some(s => s.id === 'manual-1') && G.state.saidas.length === 9 && new Set(G.state.saidas.map(s => s.id)).size === G.state.saidas.length, [gama.length, G.state.saidas.length]);
  chk('DFC · o título novo (Energia, R$ 900,00 pago em 06/01) já aparece no desdobramento do mesmo lote, sem refazer nada à mão', (l => l && l.cats.some(g => g.cat === 'pag_utilidades' && g.cents === 90000))(E.FluxoDFC.planoCnab17().porTx.get('ct-esp|t1')), catsDe(E.FluxoDFC.planoCnab17().porTx.get('ct-esp|t1')));
  /* arquivo que traz MENOS títulos do que o gravado no mês: pede confirmação e não grava */
  const setsAntes = E.banco.sets, estadoAntes = JSON.stringify(G.state.saidas);
  const ok4 = await G.fcxImportSaidas152(arquivoMatriz('contas_a_pagar_parcial.csv', shA(A_ROWS_JAN.slice(0, 2))));
  chk('A · arquivo com menos títulos que o gravado no mês (2 × 7): NÃO grava, mostra o quadro "Conferir antes de gravar" e nada muda até confirmar', ok4 === true && !!G.state._saidasPendente152 && E.banco.sets === setsAntes && JSON.stringify(G.state.saidas) === estadoAntes && /id="saidasPendente152"/.test(G.fcxPainelSaidas152()) && /menos títulos/.test(G.fcxPainelSaidas152()), [E.banco.sets, setsAntes]);
  G.cancelarImportacaoSaidas152();
  chk('A · cancelar mantém tudo como estava (tela e banco) e some o quadro', !G.state._saidasPendente152 && JSON.stringify(G.state.saidas) === estadoAntes && E.banco.sets === setsAntes && !/saidasPendente152/.test(G.fcxPainelSaidas152()));
  await G.fcxImportSaidas152(arquivoMatriz('contas_a_pagar_parcial.csv', shA(A_ROWS_JAN.slice(0, 2)))); G.confirmarImportacaoSaidas152(); await espera(150);
  chk('A · confirmar grava: os títulos do mesmo layout que não estão no arquivo saem do mês; o manual e Fevereiro ficam; o banco confere', G.state.saidas.filter(s => String(s.date).startsWith('2026-01') && s.erp17 === 'A').length === 2 && G.state.saidas.some(s => s.id === 'manual-1') && G.state.saidas.some(s => s.fornecedor === 'PAPELARIA PI') && igual(await gravadas(E), G.state.saidas) && G.state._saidasGravacao.ok === true, [G.state.saidas.length]);
  /* modos Adicionar e Substituir */
  G.state._saidasImportMode = 'append'; const nAntes = G.state.saidas.length;
  await G.fcxImportSaidas152(arquivoMatriz('x.csv', shA(A_ROWS_JAN.slice(0, 2)))); await espera(80);
  chk('modo Adicionar: o mesmo arquivo de novo não duplica (ids estáveis); acrescentar títulos novos só soma', G.state.saidas.length === nAntes, [G.state.saidas.length, nAntes]);
  G.state._saidasImportMode = 'replace'; await G.fcxImportSaidas152(arquivoMatriz('x.csv', shA(A_ROWS_JAN.slice(0, 2))));
  const pendRep = !!G.state._saidasPendente152 && G.state.saidas.length === nAntes; G.confirmarImportacaoSaidas152(); await espera(150);
  chk('modo Substituir: sempre pede confirmação e, confirmado, deixa só os títulos do arquivo (apaga o manual e Fevereiro — o quadro avisa quantos)', pendRep && G.state.saidas.length === 2 && igual(await gravadas(E), G.state.saidas), [pendRep, G.state.saidas.length]);
  G.state._saidasImportMode = 'smart';
}

{ /* gravação que falha: nada fica na tela que o banco não recebeu */
  const E = amb152({ ext: EXT_JAN() }), G = fcxGlue(E); G.state.saidas.push({ id: 'm', date: '2026-01-02', conta: CT.material, centro: 'GESTÃO', tipo: 'previsto', valor: 1, fornecedor: 'M', obs: '' });
  const antes = JSON.stringify(G.state.saidas), contasAntes = JSON.stringify(G.state.config.accounts), basesAntes = E.bases.length; E.banco.falhaSet = true;
  const ok = await G.fcxImportSaidas152(arquivoMatriz('x.csv', shA(A_ROWS_JAN))); await espera(80);
  chk('banco indisponível · a importação NÃO é gravada: a tela volta ao que estava, as contas novas somem, faixa vermelha explica e a DFC não é recalculada', ok === true && JSON.stringify(G.state.saidas) === antes && JSON.stringify(G.state.config.accounts) === contasAntes && E.bases.length === basesAntes && G.toasts.some(t => /NÃO gravada/.test(t)) && /data-ok="0"/.test(G.fcxPainelSaidas152()) && /NÃO foi confirmada/.test(G.fcxPainelSaidas152()), [G.toasts, G.fcxPainelSaidas152().slice(0, 300)]);
  E.banco.falhaSet = false; await G.fcxImportSaidas152(arquivoMatriz('x.csv', shA(A_ROWS_JAN))); await espera(80);
  chk('banco de volta · repetir a importação grava normalmente (faixa verde)', G.state._saidasGravacao.ok === true && /data-ok="1"/.test(G.fcxPainelSaidas152()) && G.state.saidas.length === 6);
}
{ /* chave que não pôde ser lida: nunca regravada */
  const E = amb152({ ext: EXT_JAN() }), G = fcxGlue(E); G.state._erroLeitura.add('esp2:saidas'); const antes = JSON.stringify(G.state.saidas);
  const ok = await G.fcxImportSaidas152(arquivoMatriz('x.csv', shA(A_ROWS_JAN))); const e = await G.saveSaidas152({}).then(() => null, x => x.message);
  chk('leitura das Saídas falhou nesta sessão · importar não altera nada e salvar é BLOQUEADO (nunca grava dado de demonstração por cima do real); nada chega ao banco', ok === true && JSON.stringify(G.state.saidas) === antes && /bloqueada/.test(e || '') && E.banco.sets === 0 && G.toasts.some(t => /não puderam ser lidas/.test(t)), [e, G.toasts]);
}
{ /* conferência detecta divergência no banco */
  const E = amb152({ ext: EXT_JAN() }), G = fcxGlue(E); await G.fcxImportSaidas152(arquivoMatriz('x.csv', shA(A_ROWS_JAN)));
  const texto = JSON.stringify(G.state.saidas), ok = await E.Saidas152.conferirGravacao('esp2:saidas', texto, ['2026-01']), okMeta = await E.Saidas152.conferirGravacao('esp2:saidas', texto, ['2026-01'], { completo: false });
  const adulterada = JSON.stringify(G.state.saidas.slice(1)), ruim = await E.Saidas152.conferirGravacao('esp2:saidas', adulterada, ['2026-01']), ruimMeta = await E.Saidas152.conferirGravacao('esp2:saidas', adulterada, ['2026-01'], { completo: false });
  chk('conferência · confere igual (completa e só pelo meta); se o que está no banco difere do enviado, os dois modos acusam (tamanho/hash e conteúdo)', ok.ok && okMeta.ok && okMeta.conferencia === 'meta' && !ruim.ok && /difere/.test(ruim.erro) && !ruimMeta.ok && /difere/.test(ruimMeta.erro), [ok.ok, okMeta.ok, ruim.erro, ruimMeta.erro]);
}
{ /* recurso desligado */
  const E = amb152({ g152: false }), G = fcxGlue(E);
  chk('recurso desligado · fcxV152 falso (compactação, releitura da DFC e desdobramento seguem como na v15.1), nenhuma faixa de gravação e nenhum quadro ainda; MAS o leitor unificado da v15.2.2 já vale (fcxLeitor1522 verdadeiro, sem flag)', G.fcxV152() === false && G.fcxLeitor1522() === true && G.fcxPainelSaidas152() === '' && E.banco.sets === 0);
}

/* layout antigo (baixas do ERP, abas PGTO.* e AgendaPagto) */
{
  const E = amb152({ ext: EXT_JAN() }), G = fcxGlue(E);
  const ok = await G.fcxImportSaidas152(arquivoMatriz('Relacao_Titulos_Pagos_Jan26.xlsx', shB(LINHAS_B))); await espera(120);
  const rel = G.cargas[G.cargas.length - 1], campo = n => (rel.campos.find(c => c[0] === n) || [])[1];
  chk('B · baixas do ERP antigo (PGTO.JANEIRO26 + AgendaPagto) entram em FCX › Saídas: 8 baixas (o crediário entra, marcado crediario:true); estornada e contas internas ignoradas; prefixo 070-/091-/080- removido; só a aba tratada é lida', ok === true && G.state.saidas.length === 8 && G.state.saidas.filter(s => s.crediario === true).length === 1 && campo('Estornadas') === '1' && campo('Contas internas') === '2' && campo('Crediário') === '1' && G.state.saidas.every(s => !/^\d{3}-/.test(s.contaPagamento) && s.tipo === 'pago' && s.erp17 === 'B') && /PGTO\.JANEIRO26/.test(campo('Abas lidas')) && !/AgendaPagto/.test(campo('Abas lidas')), [G.state.saidas.length, rel.campos]);
  chk('B · gravação conferida no banco: 8 registros e R$ 20.220,75 (conferência completa) e faixa verde com o mês', G.state._saidasGravacao.ok === true && G.state._saidasGravacao.n === 8 && G.state._saidasGravacao.cents === 2022075 && /Mês <b>01\/2026<\/b>: 8 título\(s\)/.test(G.fcxPainelSaidas152()), G.state._saidasGravacao);
  chk('B · o Item vira Conta Contábil e Categoria DFC (468 → 4.10.06 · 187 → 4.01.01 · 475 → 7.20.05 · 217 → 4.33.15) e o Item sem vínculo (999) fica "(sem conta)" e avisado', (por => por('IMOBILIARIA ALFA LTDA').conta.startsWith('4.10.06') && por('FOLHA DE PAGAMENTO').conta.startsWith('4.01.01') && por('CONSTRUTORA DELTA').conta.startsWith('7.20.05') && por('AGENCIA ECO').conta.startsWith('4.33.15') && por('FORNECEDOR NOVO').conta === '(sem conta)')(f => G.state.saidas.find(s => s.fornecedor === f)) && rel.inconsistencias.some(i => /999/.test(i.item || '')), rel.inconsistencias.slice(0, 3));
  const p = E.FluxoDFC.planoCnab17(), l = p.porTx.get('ct-esp|t1'), lm = p.porTx.get('ct-mar|t3');
  chk('DFC · o lote da Esposende é desdobrado pelo Item (468 → Aluguel · 187 → Pessoal · 217 → Marketing) e o da Mar Aberto pelo 468; o que sobra do Item 012 (Transferência) e o 999 (conta fora do cadastro) não entram', igual(catsDe(l), { pag_ocupacao: 5000, pag_folha: 3000.5, pag_marketing: 1500.25 }) && igual(catsDe(lm), { pag_ocupacao: 2500 }) && p.contasSemCadastro.some(c => c.nome === 'CAIXA ECONÔMICA FEDERAL'), [catsDe(l), catsDe(lm)]);
  /* v15.2.1 · A (ERP Sállamos) depois de B (ERP Legado) no MESMO mês: o painel não sobrepõe nem duplica — bloqueia o mês e pede confirmação (detalhes na seção 6) */
  const aposB = G.state.saidas.length; await G.fcxImportSaidas152(arquivoMatriz('contas_a_pagar.csv', shA(A_ROWS_JAN))); await espera(100);
  chk('A depois de B (mesmo mês, ERPs diferentes): as 8 baixas do ERP Legado NÃO são apagadas nem duplicadas — nada é gravado, o mês fica bloqueado e o quadro de sobreposição aparece', G.state.saidas.length === aposB && G.state.saidas.filter(s => s.erp17 === 'B').length === 8 && G.state.saidas.filter(s => s.erp17 === 'A').length === 0 && !!G.state._saidasPendente152 && /Sobreposição entre ERPs bloqueada/.test(G.fcxPainelSaidas152()), [G.state.saidas.length, aposB]);
  G.cancelarImportacaoSaidas152();
}

/* arquivos de verdade (SheetJS): CSV em vários formatos e XLSX/XLS, no mesmo caminho do FCX */
if (XLSX) {
  const csvLinha = r => r.map(c => (/[",\n]/.test(c) ? '"' + String(c).replace(/"/g, '""') + '"' : c)).join(',');
  const CSV_A = [CAB_A, ...A_ROWS_JAN, A_ROW_FEV].map(csvLinha).join('\n') + '\n';
  const cp1252 = s => Buffer.from([...s].map(ch => { const c = ch.codePointAt(0); if (c < 256) return c; const m = { 0x2013: 0x96, 0x2014: 0x97, 0x20AC: 0x80 }; if (m[c]) return m[c]; throw new Error('sem cp1252: ' + ch); }));
  const ref = amb152({ ext: EXT_JAN() }), Gr = fcxGlue(ref); await Gr.fcxImportSaidas152(arquivoMatriz('ref.csv', shA([...A_ROWS_JAN, A_ROW_FEV]))); const alvo = Gr.state.saidas.map(s => [s.date, s.dataPagamento, s.valor, s.contaPagamento, s.conta, s.tipo, s.fornecedor]);
  for (const [rot, buf] of [['CSV UTF-8', Buffer.from(CSV_A, 'utf8')], ['CSV UTF-8 com BOM', Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(CSV_A, 'utf8')])], ['CSV Windows-1252', cp1252(CSV_A)]]) {
    const E = amb152({ ext: EXT_JAN() }), G = fcxGlue(E); await G.fcxImportSaidas152(arquivoDe('contas_a_pagar.csv', buf));
    chk(`A · arquivo real ${rot}: o FCX grava as mesmas 7 saídas que as matrizes (datas DD/MM, R$5000.00, 3.000,50, fallback de conta) e o banco confere`, igual(G.state.saidas.map(s => [s.date, s.dataPagamento, s.valor, s.contaPagamento, s.conta, s.tipo, s.fornecedor]), alvo) && G.state._saidasGravacao.ok === true, [G.state.saidas.length]);
  }
  { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(abaTratada('PGTO.JANEIRO26', LINHAS_B).rows, { cellDates: true }), 'PGTO.JANEIRO26'); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(abaBruta(LINHAS_B).rows, { cellDates: true }), 'AgendaPagto');
    for (const [rot, tipo, nome] of [['XLSX', 'xlsx', 'Relacao_Titulos_Pagos_Jan-Mai26.xlsx'], ['XLS (OLE)', 'biff8', 'antigo.xls']]) {
      const E = amb152({ ext: EXT_JAN() }), G = fcxGlue(E); await G.fcxImportSaidas152(arquivoDe(nome, XLSX.write(wb, { type: 'buffer', bookType: tipo, cellDates: true }))); await espera(100);
      chk(`B · arquivo real ${rot} (PGTO.JANEIRO26 + AgendaPagto): 8 baixas, R$ 20.220,75 conferidos no banco e o lote de Janeiro desdobrado na DFC`, G.state.saidas.length === 8 && G.state._saidasGravacao.cents === 2022075 && G.state._saidasGravacao.ok === true && igual(catsDe(E.FluxoDFC.planoCnab17().porTx.get('ct-esp|t1')), { pag_ocupacao: 5000, pag_folha: 3000.5, pag_marketing: 1500.25 }), [G.state.saidas.length]);
    } }
} else for (const n of ['A · arquivos reais CSV (UTF-8, BOM, Windows-1252)', 'B · arquivos reais XLSX/XLS']) pula(n);

/* ---------------------------------------------------------------------------------------------------------------------------------------
   5 · DFC — PROVA AO CENTAVO: Σ(categorias após o desdobramento CNAB) = Σ(lançamentos do OFX) e as invariantes do banco e do caixa operacional
   --------------------------------------------------------------------------------------------------------------------------------------- */
const prepara = async o => { const E = amb152(o); await E.FluxoDFC.garantirCnab17(true); return E; };
const saidasBanco = l => l.filter(t => t.valor < 0).reduce((s, t) => s + c100(t.valor), 0), entradasBanco = l => l.filter(t => t.valor > 0).reduce((s, t) => s + c100(t.valor), 0);
{
  const E = await prepara({ ext: EXT_JAN(), saidas: A0.linhas }), F = E.FluxoDFC, p = F.planoCnab17(), antes = dfcMes(E, '2026-01', false), depois = dfcMes(E, '2026-01', true), brutoAntes = noMes(F.transacoes(), '2026-01');
  chk('prova · o lançamento do OFX de Janeiro soma R$ 106.708,90 e a DFC SEM desdobramento já fecha com ele (Σ categorias = Σ OFX, ao centavo)', somaLista(brutoAntes) === SOMA_OFX_JAN && somaCat(antes.c) === SOMA_OFX_JAN, [somaLista(brutoAntes), somaCat(antes.c)]);
  chk('PROVA ESTRITA · Soma(categorias da DFC APÓS o desdobramento CNAB) === Soma(lançamentos do OFX do mês) = 10.670.890 centavos (os 2 lotes desdobrados em 7 linhas virtuais)', depois.trs.length > brutoAntes.length && somaCat(depois.c) === SOMA_OFX_JAN && somaLista(depois.trs) === SOMA_OFX_JAN, [somaCat(depois.c), SOMA_OFX_JAN, depois.trs.length, brutoAntes.length]);
  chk('invariante · Total de Saídas do Banco, Total de Entradas e Saldo Final (variação do mês) idênticos antes e depois', saidasBanco(depois.trs) === saidasBanco(brutoAntes) && entradasBanco(depois.trs) === entradasBanco(brutoAntes) && somaLista(depois.trs) === somaLista(brutoAntes) && saidasBanco(brutoAntes) === -2160115, [saidasBanco(depois.trs), saidasBanco(brutoAntes)]);
  chk('invariante · saídas, entradas e variação líquida da DFC idênticas, e o Caixa Líquido das Atividades Operacionais não muda (nem as outras atividades)', c100(depois.c.saidas) === c100(antes.c.saidas) && c100(depois.c.entradas) === c100(antes.c.entradas) && c100(depois.c.liquido) === c100(antes.c.liquido) && Object.keys(antes.c.porGrupo).every(g => c100(depois.c.porGrupo[g].liquido) === c100(antes.c.porGrupo[g].liquido)), [depois.c.porGrupo.OPERACIONAL.liquido, antes.c.porGrupo.OPERACIONAL.liquido]);
  const delta = {}; for (const k of new Set([...Object.keys(antes.c.porCategoria), ...Object.keys(depois.c.porCategoria)])) { const d = c100((depois.c.porCategoria[k] || { valor: 0 }).valor) - c100((antes.c.porCategoria[k] || { valor: 0 }).valor); if (d) delta[k] = d; }
  const origem = [...new Set(['t1', 't3'].map(id => E.DFC.classificar(brutoAntes.find(t => t.id === id), E.DFC.regras()).categoria))];
  const pos = Object.entries(delta).filter(([, d]) => d > 0), neg = Object.entries(delta).filter(([, d]) => d < 0);
  chk('reclassificação · o dinheiro SÓ sai da categoria em que o extrato classificou os lotes (R$ 19.000,75) e vai para Aluguel (7.500,00), Pessoal (3.000,50), Marketing (1.500,25) e o que permanece em Pagamento a fornecedores (7.000,00): a soma dos deslocamentos é ZERO', origem.length === 1 && pos.length === 1 && pos[0][0] === origem[0] && pos[0][1] === 1900075 && neg.length === 4 && Object.values(delta).reduce((a, b) => a + b, 0) === 0 && delta.pag_ocupacao === -750000 && delta.pag_folha === -300050 && delta.pag_marketing === -150025 && delta.pag_fornecedores === -700000, [origem, delta]);
  chk('resumo do plano · 2 lotes desdobrados, R$ 12.000,75 realocados, a obra de R$ 7.000,00 (investimento) ficou em Fornecedores e a integridade fecha', p.resumo.nDesdobrados === 2 && p.resumo.valorRealocado === 12000.75 && p.naoRealocado.cents === 700000 && p.naoRealocado.porGrupo.INVESTIMENTO === 700000 && p.integridade.ok && p.mesesReprovados.length === 0, [p.resumo, p.naoRealocado]);
  const pv = p.provasMes.get('2026-01');
  chk('prova interna do motor (por mês, em centavos) · Σ extrato = Σ categorias = 10.670.890, Total de Saídas do Banco = 2.160.115', pv && pv.extratoCents === SOMA_OFX_JAN && pv.categoriasCents === SOMA_OFX_JAN && pv.saidasBancoCents === 2160115, pv);
  /* liberar a realocação para Investimento: total do banco e saldo final não mudam; o Caixa Operacional muda (e a tela avisa) */
  await F.salvarCfg17('grupos', '1'); const p2 = F.planoCnab17(), dep2 = dfcMes(E, '2026-01', true), l2 = p2.porTx.get('ct-esp|t1');
  chk('"Realocar também para Investimento/Financiamento" (opt-in) · a obra de 7.000,00 sai de Fornecedores para Obras/Investimentos; banco, saldo final e Σ categorias seguem idênticos', l2.resto === 0 && catsDe(l2).inv_capex === 7000 && p2.naoRealocado.cents === 0 && somaCat(dep2.c) === SOMA_OFX_JAN && somaLista(dep2.trs) === SOMA_OFX_JAN && saidasBanco(dep2.trs) === saidasBanco(brutoAntes) && c100(dep2.c.liquido) === c100(antes.c.liquido) && p2.integridade.ok, [catsDe(l2), l2.resto]);
  chk('…e só nesse modo o Caixa Operacional muda: +R$ 7.000,00 no operacional e −R$ 7.000,00 em investimento (por isso vem desligado)', c100(dep2.c.porGrupo.OPERACIONAL.liquido) - c100(antes.c.porGrupo.OPERACIONAL.liquido) === 700000 && c100(dep2.c.porGrupo.INVESTIMENTO.liquido) - c100(antes.c.porGrupo.INVESTIMENTO.liquido) === -700000, [dep2.c.porGrupo.OPERACIONAL.liquido, antes.c.porGrupo.OPERACIONAL.liquido]);
  await F.salvarCfg17('grupos', '0'); chk('…e voltar ao padrão restaura o Caixa Operacional original', c100(dfcMes(E, '2026-01', true).c.porGrupo.OPERACIONAL.liquido) === c100(antes.c.porGrupo.OPERACIONAL.liquido) && F.planoCnab17().naoRealocado.cents === 700000);
}

/* travas de aborto: por lote (> R$ 0,01 → mantém o extrato + alerta de conferência) e por mês (a prova da DFC real não fechou → os lotes do mês voltam ao extrato) */
{
  const E = await prepara({ ext: EXT_JAN(), saidas: A0.linhas }), F = E.FluxoDFC, raw = F.transacoes(), regras = E.DFC.regras();
  const tab = E.PAGTO17.tabelaItens(E.Pagto17.over()), nomes = new Map(F.contas().map(k => [k.id, [k.apelido]])), valida = id => { const k = E.DFC.cat(id); return !!k && E.DFC.compativel('S', k) && !E.DFC.neutra(k); };
  const args = (o = {}) => ({ transacoes: raw, saidas: A0.linhas, tolDias: 1, modoTeto: 'prioridade', permiteOutrosGrupos: false, util: iso => E.DiasUteis.util(iso), categoriaDe: conta => E.PrevistoFCX.categoriaDaConta(conta), categoriaDeItem: s => E.PAGTO17.categoriaDaSaida(s, tab),
    nomesConta: id => nomes.get(id) || [], todasContas: [...nomes.values()].flat(), categoriaValida: valida, classificar: t => E.DFC.classificar(t, regras), ...o });
  const novo = (o = {}) => { const a = args(o), p = E.CNAB152.planejar(a); return { a, p, l: p.porTx.get('ct-esp|t1') }; };
  const refaz = (p, a) => E.CNAB152.blindar(p, { ...a, permite: a.permiteOutrosGrupos === true, valida0: a.categoriaValida });
  const somaExp = (p, a) => somaLista(E.CNAB17.expandir(raw, p)), alvo = somaLista(raw);
  { const { a, p, l } = novo(); chk('lote · plano de partida: 5.000 + 3.000,50 + 1.500,25 explicados e 7.000,00 em Fornecedores; Σ categorias + resto = lote', l.cats.length === 3 && l.cats.reduce((s, g) => s + g.cents, 0) + l.resto === l.cap && !l.abortado && !p.alertas.length, catsDe(l)); }
  { const { a, p, l } = novo(); const resto0 = l.resto; l.cats[0].cents += 1; refaz(p, a); chk('lote · diferença de R$ 0,01 é tolerada: o centavo é absorvido no que permanece em Pagamento a fornecedores e o lote continua desdobrado', !l.abortado && l.ajusteCent === 1 && l.resto === resto0 - 1 && l.cats.reduce((s, g) => s + g.cents, 0) + l.resto === l.cap && p.aplicaveis.includes(l), [l.abortado, l.ajusteCent, l.resto, resto0]); }
  { const { a, p, l } = novo(); l.cats[0].cents += 2; refaz(p, a);
    chk('lote · diferença de R$ 0,02 (> R$ 0,01): o rateio DAQUELE lote é ABORTADO, o lote volta ao valor original do extrato e sai o alerta de conferência', !!l.abortado && /difere do lote/.test(l.abortado.motivo) && l.aloc === 0 && l.cats.length === 0 && l.resto === l.cap && !p.aplicaveis.includes(l) && p.alertas.some(x => x.tipo === 'conferencia' && x.chave === l.chave && x.lote === 16500.75), [l.abortado, p.alertas]);
    chk('lote abortado · a lista expandida do extrato mantém o lançamento original e soma exatamente o mesmo (o outro lote segue desdobrado)', somaExp(p, a) === alvo && E.CNAB17.expandir(raw, p).some(t => t.id === 't1' && t.valor === -16500.75) && p.aplicaveis.length === 1 && p.integridade.ok, [somaExp(p, a), alvo]); }
  { const { a, p, l } = novo(); l.cats[0].cents = -100; refaz(p, a); chk('lote · parcela negativa/inválida → aborta (nada de rateio com valor impossível)', !!l.abortado && /negativa|inválida/.test(l.abortado.motivo) && somaExp(p, a) === alvo, l.abortado); }
  { const { a, p, l } = novo({ permiteOutrosGrupos: false }); l.cats.push({ cat: 'inv_capex', cents: 0, n: 0, titulos: [] }); l.resto -= 0; refaz(p, a); chk('lote · categoria de outra atividade (Investimento) com a realocação desligada → aborta e explica o motivo', !!l.abortado && /outra atividade/.test(l.abortado.motivo), l.abortado); }
  { const dup = EXT_JAN(); dup[0].transacoes.push({ ...dup[0].transacoes[1] }); const Ed = await prepara({ ext: dup, saidas: A0.linhas }), pd = Ed.FluxoDFC.planoCnab17(), rawd = Ed.FluxoDFC.transacoes();
    chk('lote duplicado no extrato (mesma conta e mesmo identificador, 2 vezes) → os dois ficam como no extrato, com 2 alertas de conferência, e a prova ao centavo continua fechando', pd.alertas.filter(x => x.tipo === 'conferencia').length === 2 && pd.lotes.filter(l => l.chave === 'ct-esp|t1').every(l => l.abortado && /repetido/.test(l.abortado.motivo)) && pd.integridade.ok && somaCat(dfcMes(Ed, '2026-01', true).c) === somaLista(noMes(rawd, '2026-01')), pd.alertas.length);
    const h = Ed.FluxoDFC.painelCnab17(), lin = Ed.FluxoDFC.linhaCnab17({ ...rawd.find(t => t.id === 't1') });
    chk('alerta de conferência visível · o resumo abre sozinho e diz "em conferência"; a linha do extrato mostra "Conferência: lote mantido pelo valor do extrato" em vez de "sem títulos"', /<details open>/.test(h) && /c152-conferir/.test(h) && /Conferência:/.test(h) && /Conferência: lote mantido pelo valor do extrato/.test(lin) && !/sem títulos Pago/.test(lin), [h.slice(0, 300), lin.slice(0, 300)]); }
  /* mês: a DFC real é a juíza */
  { const { a, p } = novo(), honesta = trs => E.DFC.consolidar(trs, regras), r = E.CNAB152.guardarMeses(p, raw, honesta);
    chk('mês · com a DFC real a prova fecha (nenhum mês reprovado, 2 lotes continuam aplicáveis)', r.ok && p.mesesReprovados.length === 0 && p.aplicaveis.length === 2 && r.provas.get('2026-01').extratoCents === r.provas.get('2026-01').categoriasCents, [r.meses, p.aplicaveis.length]); }
  for (const [rot, mexe, esperado] of [['Total de saídas do banco', (c, trs) => { c.saidas += 0.5; }, /Saídas da DFC/], ['Caixa líquido por atividade', (c, trs) => { c.porGrupo.OPERACIONAL.liquido += 0.01; }, /Caixa líquido · OPERACIONAL/], ['Soma das categorias', (c, trs) => { const k = Object.keys(c.porCategoria)[0]; c.porCategoria[k].valor += 0.01; }, /Soma das categorias/]]) {
    const { a, p } = novo(), mentirosa = trs => { const c = E.DFC.consolidar(trs, regras); if (trs.some(t => t.cnab17)) mexe(c, trs); return c; }, r = E.CNAB152.guardarMeses(p, raw, mentirosa);
    chk(`mês · se a DFC desdobrada divergir R$ 0,01 em "${rot}", a prova do mês reprova: TODOS os lotes do mês voltam ao extrato, o alerta de conferência aparece e Σ extrato = Σ DFC continua valendo`, !r.ok && p.mesesReprovados.length === 1 && p.mesesReprovados[0].mes === '2026-01' && p.mesesReprovados[0].difs.some(d => esperado.test(d.rot)) && p.aplicaveis.length === 0 && p.lotes.filter(l => l.abortado).length === 2 && p.alertas.filter(x => x.tipo === 'conferencia').length === 2 && p.integridade.ok && somaExp(p, a) === alvo, [r.meses.map(m => m.difs), p.aplicaveis.length]);
  }
}

/* estresse: cenários aleatórios (semente fixa) com lotes sobrando/faltando título, títulos de outras contas, sem pagamento e de obras — a prova ao centavo tem de fechar em TODOS */
{
  const prng = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const cenario = seed => {
    const R = prng(seed), pick = a => a[Math.floor(R() * a.length)], int = (a, b) => a + Math.floor(R() * (b - a + 1)), money = (a, b) => Math.round((a + R() * (b - a)) * 100) / 100, ext = [], saidas = []; let n = 0;
    for (const [cid, ap] of [['ct-esp', 'ESPOSENDE -SANTANDER'], ['ct-mar', 'MAR ABERTO - SANTANDER']]) {
      const trs = [];
      for (const mes of ['2026-01', '2026-02']) {
        trs.push({ id: `${cid}-r-${mes}`, data: mes + '-03', valor: money(20000, 90000), hist: 'RECEBIMENTO CARTOES' });
        for (let k = 0, m = int(0, 5); k < m; k++) trs.push({ id: `${cid}-n-${mes}-${k}`, data: `${mes}-${String(int(1, 28)).padStart(2, '0')}`, valor: -money(10, 3000), hist: pick(['TARIFA BANCARIA', 'PAGAMENTO ENERGIA', 'PIX ENVIADO', 'TRANSFERENCIA ENTRE CONTAS', 'IOF']) });
        for (let k = 0, m = int(1, 6); k < m; k++) {
          const data = `${mes}-${String(int(2, 27)).padStart(2, '0')}`, cap = money(500, 40000);
          trs.push({ id: `${cid}-L-${mes}-${k}`, data, valor: -cap, hist: 'PAGTO FORNECEDORES CNAB', isLoteCnab: true });
          let resta = cap * (0.4 + R() * 1.0);
          for (let j = 0, nt = int(0, 8); j < nt && resta > 1; j++) {
            const v = Math.min(money(5, 9000), Math.round(resta * 100) / 100); resta -= v; const dd = new Date(data + 'T12:00:00Z'); dd.setUTCDate(dd.getUTCDate() + pick([-1, 0, 0, 0, 1])); const pg = dd.toISOString().slice(0, 10);
            saidas.push({ id: 's' + (n++), date: pg, dataPagamento: pg, tipo: R() < 0.9 ? 'pago' : pick(['efetivo', 'previsto']), valor: v, conta: pick(Object.values(CT)), fornecedor: 'F' + n, contaPagamento: R() < 0.9 ? ap : pick(['MAR ABERTO - SANTANDER', 'ESPOSENDE -SANTANDER']), erp17: 'A' });
          }
        }
      }
      ext.push({ id: 'd-' + cid, contaId: cid, mes: '2026-01', transacoes: trs });
    }
    return { ext, saidas, cfg: { tolDias: int(0, 3), modoTeto: pick(['prioridade', 'proporcional']), permiteOutrosGrupos: R() < 0.5 } };
  };
  let comDesdobro = 0, lotesDes = 0, abortados = 0, falhas = [], tit = 0, nCen = 0;
  for (let seed = 1; seed <= 24; seed++) {
    const c = cenario(seed), E = amb152({ ext: c.ext, saidas: c.saidas }), F = E.FluxoDFC; E.S.config.set(F.K17, { id: F.K17, ...c.cfg }); await F.garantirCnab17(true);
    const p = F.planoCnab17(); nCen++; tit += c.saidas.length;
    if (!p) { falhas.push([seed, 'sem plano']); continue; }
    const des = p.lotes.filter(l => l.aloc > 0); if (des.length) comDesdobro++; lotesDes += des.length; abortados += p.lotes.filter(l => l.abortado).length;
    const lotesOk = p.lotes.every(l => !(l.aloc > 0) || (l.cats.reduce((s, g) => s + g.cents, 0) + l.resto === l.cap && l.realocado <= l.cap && l.resto >= 0));
    if (!p.integridade.ok || p.mesesReprovados.length || !lotesOk) falhas.push([seed, 'plano', p.integridade.ok, p.mesesReprovados.map(m => m.difs), lotesOk]);
    for (const mes of ['2026-01', '2026-02']) {
      const a = dfcMes(E, mes, false), d = dfcMes(E, mes, true), bruto = noMes(F.transacoes(), mes), alvo = somaLista(bruto);
      const ruins = []; if (somaCat(a.c) !== alvo) ruins.push('baseline'); if (somaCat(d.c) !== alvo) ruins.push('Σcat≠ΣOFX'); if (somaLista(d.trs) !== alvo) ruins.push('Σtrs'); if (saidasBanco(d.trs) !== saidasBanco(bruto) || entradasBanco(d.trs) !== entradasBanco(bruto)) ruins.push('banco');
      if (c100(d.c.saidas) !== c100(a.c.saidas) || c100(d.c.entradas) !== c100(a.c.entradas) || c100(d.c.liquido) !== c100(a.c.liquido)) ruins.push('dfc');
      if (!c.cfg.permiteOutrosGrupos && c100(d.c.porGrupo.OPERACIONAL.liquido) !== c100(a.c.porGrupo.OPERACIONAL.liquido)) ruins.push('operacional');
      if (c.cfg.permiteOutrosGrupos && Object.keys(a.c.porGrupo).reduce((s, g) => s + c100(d.c.porGrupo[g].liquido), 0) !== Object.keys(a.c.porGrupo).reduce((s, g) => s + c100(a.c.porGrupo[g].liquido), 0)) ruins.push('Σ atividades');
      if (ruins.length) falhas.push([seed, mes, ruins.join(',')]);
    }
  }
  chk(`ESTRESSE · ${nCen} cenários aleatórios (${tit} títulos; 2 bancos × 2 meses; tolerância 0–3 dias; teto por prioridade/proporcional; com e sem realocação para outras atividades): em TODOS Σ categorias = Σ OFX ao centavo, e banco, saldo final, saídas, entradas e caixa operacional não mudam`, falhas.length === 0, falhas.slice(0, 4));
  chk(`ESTRESSE · não é vácuo: ${comDesdobro} cenários tiveram lotes desdobrados (${lotesDes} lotes no total)`, comDesdobro >= 20 && lotesDes >= 100, [comDesdobro, lotesDes]);
}

/* ---------------------------------------------------------------------------------------------------------------------------------------
   6 · DFC — LIMPEZA VISUAL (resumo de 1 linha recolhido, sem lista de lotes e sem "Excedente…") e botão "Importar Baixas do ERP (CNAB)" removido
   --------------------------------------------------------------------------------------------------------------------------------------- */
{
  /* Janeiro com tudo o que enchia a tela na v15.1: lote com excedente (energia 900 a mais), lote sem nenhum título, item sem vínculo (999) e conta fora do cadastro */
  const B_EXC = [...LINHAS_B.slice(0, 4), LINHAS_B[8], LINHAS_B[9], LINHAS_B[10], [210, '1012', 'ENERGIA S/A', '070-ESPOSENDE -SANTANDER', dB(6), 900, '2-TED', '', 'Energia', 'LOJA 01 RUA']];
  const extX = EXT_JAN(); extX[1].transacoes.push({ id: 't4', data: '2026-01-09', valor: -777, hist: 'REMESSA PAGTO 2', isLoteCnab: true });
  const saidasX = amb152().PAGTO17.interpretar([abaTratada('PGTO.JANEIRO26', B_EXC)], {}).linhas;
  const montar = async g152 => { const E = await prepara({ ext: extX, saidas: saidasX, g152 }); E.t1 = E.FluxoDFC.transacoes().find(t => t.id === 't1'); E.t4 = E.FluxoDFC.transacoes().find(t => t.id === 't4'); return E; };
  const OFF = await montar(false), ON = await montar(true);
  const hOff = OFF.FluxoDFC.painelCnab17(), hOn = ON.FluxoDFC.painelCnab17(), lOff = OFF.FluxoDFC.linhaCnab17({ ...OFF.t1 }), lOn = ON.FluxoDFC.linhaCnab17({ ...ON.t1 });
  chk('sensibilidade · com o recurso DESLIGADO (v15.1) a tela traz o que a v15.2 remove: lista de lotes por dia, "Excedente Contas a Pagar sem cobertura CNAB no dia", Alertas de auditoria e o botão de importar', /c17-lin/.test(hOff) && /Excedente Contas a Pagar sem cobertura CNAB no dia/.test(hOff) && /Alertas de auditoria/.test(hOff) && /Excedente Contas a Pagar sem cobertura CNAB/.test(lOff) && /Importar Baixas do ERP \(CNAB\)/.test(OFF.FluxoDFC.botaoCnab17()), [hOff.length]);
  chk('limpeza · NENHUM alerta "Excedente Contas a Pagar sem cobertura CNAB no dia…" na DFC (resumo nem linha do extrato), mesmo com título passando do lote', !/Excedente/i.test(hOn) && !/sem cobertura CNAB/i.test(hOn) && !/Excedente/i.test(lOn) && !/sem cobertura CNAB/i.test(lOn) && ON.FluxoDFC.planoCnab17().alertas.every(a => a.tipo === 'conferencia') && ON.FluxoDFC.planoCnab17().resumo.excedente === 0, [hOn.length]);
  chk('limpeza · sem a listagem linha a linha dos lotes diários (nenhum c17-lin, nenhuma data de lote, nenhum "sem títulos Pago no dia", nenhuma lista de alertas de auditoria)', !/c17-lin/.test(hOn) && !/<h4/.test(hOn) && !/sem títulos Pago no dia/.test(hOn) && !/Alertas de auditoria/.test(hOn) && !/\d{2}\/\d{2}\/\d{4}/.test(hOn.replace(/<[^>]*>/g, ' ').replace(/title="[^"]*"/g, '')), hOn.replace(/<[^>]*>/g, ' ').slice(0, 400));
  const resumo = (hOn.match(/<summary>([\s\S]*?)<\/summary>/g) || []), plano = ON.FluxoDFC.planoCnab17(), brl = ON.Fmt.brl;
  chk('resumo compacto · UMA só linha (um <summary>), RECOLHIDA (<details> sem "open"), com o nº de lotes desdobrados e o R$ realocado de Pagamento a fornecedores', resumo.length === 1 && /<details >/.test(hOn) && !/<details open/.test(hOn) && /<span class="c152-lotes">2 lotes desdobrados<\/span>/.test(hOn) && hOn.includes('<span class="c152-valor">' + brl(plano.resumo.valorRealocado) + ' realocados de Pagamento a fornecedores</span>') && plano.resumo.nDesdobrados === 2, [resumo.length, plano.resumo.nDesdobrados, plano.resumo.valorRealocado]);
  const integ = plano.integridade;
  chk('resumo compacto · mantém a prova "Total do extrato = Total da DFC" (os dois números iguais, ao centavo)', integ.ok && integ.dif === 0 && hOn.includes('Total do extrato ' + brl(integ.totalExtrato) + ' = Total da DFC ' + brl(integ.totalDfc) + ' ✓') && c100(integ.totalExtrato) === c100(integ.totalDfc), [integ, hOn.match(/c152-prova[^>]*>([^<]*)/)]);
  chk('resumo compacto · o aviso do que ficou em Fornecedores e os seletores ficam DENTRO do bloco recolhido (não pesam na tela)', hOn.indexOf('</summary>') > 0 && hOn.indexOf('Tolerância de data') > hOn.indexOf('</summary>') && hOn.indexOf('ficaram em Pagamento a fornecedores') > hOn.indexOf('</summary>'));
  chk('extrato · a linha do lote continua mostrando o desdobramento (categorias e títulos) sem o aviso amarelo; o lote sem título mostra só a etiqueta curta', /Desdobrado via Contas a Pagar/.test(lOn) && /Aluguel, condomínio e ocupação/.test(lOn) && /sem títulos Pago no Contas a Pagar neste dia/.test(ON.FluxoDFC.linhaCnab17({ ...ON.t4 })) && !/c17-alerta/.test(lOn));
  /* botões */
  const bOn = ON.FluxoDFC.botaoCnab17(), bOff = OFF.FluxoDFC.botaoCnab17();
  chk('botão "Importar Baixas do ERP (CNAB)" REMOVIDO da DFC (nem o texto, nem a ação fd-pagto-importar); fica "Recalcular Desdobramento CNAB"', !/Importar Baixas do ERP/.test(bOn) && !/fd-pagto-importar/.test(bOn) && /Recalcular Desdobramento CNAB/.test(bOn) && /fd-cnab-recalcular/.test(bOn), bOn.slice(0, 300));
  chk('"Itens do ERP" só aparece quando há código legado sem vínculo (aqui o Item 999: "1 pendente") e nunca como botão fixo', /Itens do ERP \(1 pendente\)/.test(bOn) && /fd-pagto-itens/.test(bOn));
  { const so = await prepara({ ext: extX, saidas: A0.linhas }); const b = so.FluxoDFC.botaoCnab17();
    chk('sem Item legado pendente (só layout atual) a DFC mostra APENAS "Recalcular Desdobramento CNAB"', /Recalcular Desdobramento CNAB/.test(b) && !/Itens do ERP/.test(b) && !/Importar/.test(b), b.replace(/<[^>]*>/g, ' ').trim()); }
  chk('o modal exclusivo da importação saiu: chamar a antiga ação só orienta a usar FCX › Saídas (nenhum modal, nenhuma leitura de arquivo) e a DFC nunca oferece importar', (() => { ON.toasts.length = 0; ON.FluxoDFC.abrirImportarPagto17(); ON.FluxoDFC.lerPagto17(); return ON.modais.length === 0 && ON.toasts.length === 2 && ON.toasts.every(t => /FCX › Saídas/.test(t)) && ON.FluxoDFC.podeImportarPagto17() === false; })());
  chk('o botão e o modal só voltam com o recurso desligado (volta à v15.1: a tela antiga é a mesma de antes)', /fd-pagto-importar/.test(bOff) && OFF.FluxoDFC.podeImportarPagto17() === true);
}

/* paridade: recurso desligado ≡ v15.1 (o plano da DFC é exatamente o do motor CNAB17 de sempre, com excedentes, avisos e todas as atividades) */
{
  const resumoPlano = p => ({ lotes: p.lotes.map(l => [l.chave, l.cap, l.aloc, l.resto, l.cats.map(g => [g.cat, g.cents, g.n]), l.excedente.cents, l.semTitulos]), alertas: p.alertas.map(a => [a.tipo, a.chave, a.valor]), r: [p.resumo.nDesdobrados, p.resumo.valorRealocado, p.resumo.excedente, p.resumo.semTitulos], integ: p.integridade.ok });
  const extX = EXT_JAN(); extX[1].transacoes.push({ id: 't4', data: '2026-01-09', valor: -777, hist: 'REMESSA PAGTO 2', isLoteCnab: true });
  const sx = amb152().PAGTO17.interpretar([abaTratada('PGTO.JANEIRO26', LINHAS_B)], {}).linhas;
  const E = await prepara({ ext: extX, saidas: sx, g152: false }), F = E.FluxoDFC, regras = E.DFC.regras();
  const tab = E.PAGTO17.tabelaItens(E.Pagto17.over()), nomes = new Map(F.contas().map(k => [k.id, [k.apelido]])), contasN = new Map(F.contas().map(k => [k.id, F.norm(k.apelido || '')]));
  const ref = E.CNAB17.planejar({ transacoes: F.transacoes(), saidas: sx, tolDias: 1, modoTeto: 'prioridade', util: iso => E.DiasUteis.util(iso), categoriaDe: conta => E.PrevistoFCX.categoriaDaConta(conta), categoriaDeItem: s => E.PAGTO17.categoriaDaSaida(s, tab),
    nomesConta: id => nomes.get(id) || [], todasContas: [...nomes.values()].flat(), categoriaValida: id => { const k = E.DFC.cat(id); return !!k && E.DFC.compativel('S', k) && !E.DFC.neutra(k); }, classificar: t => E.DFC.classificar(t, regras),
    dica: (s, t) => { const ap = contasN.get(t.contaId); return !!ap && ap.length >= 3 && F.norm([s.obs, s.formaPagamento, s.item].filter(Boolean).join(' ')).includes(ap); } });
  const p = F.planoCnab17();
  chk('desligado ≡ v15.1 · o plano da DFC é idêntico ao do motor CNAB17 puro (mesmos lotes, categorias, excedente, alertas e integridade) — inclusive a obra de R$ 7.000,00 realocada para Investimento, como era', igual(resumoPlano(p), resumoPlano(ref)) && !p.v152 && p.alertas.some(a => a.tipo === 'excedente') && p.lotes.some(l => l.cats.some(g => g.cat === 'inv_capex')), [resumoPlano(p).r, resumoPlano(ref).r]);
  chk('desligado ≡ v15.1 · a ponte do FCX volta a gravar texto puro e o FCX não usa o caminho novo (conferido na seção 3); o módulo v15.2 não muda nada sem a chave', !E.CNAB152.ativo() && !E.Saidas152.ativo() && !E.Z152.ligado());
  E.g152 = true; await F.garantirCnab17(true);
  chk('religar o recurso troca o comportamento na hora, sem recarregar: o plano passa a ser o blindado (sem excedente, obra fica em Fornecedores)', (q => q.v152 === true && q.alertas.every(a => a.tipo === 'conferencia') && !q.lotes.some(l => l.cats.some(g => g.cat === 'inv_capex')))(F.planoCnab17()));
}

/* ---------------------------------------------------------------------------------------------------------------------------------------
   6 · v15.2.1 (AJUSTE PONTUAL) — LEITOR UNIFICADO DOS DOIS ERPs EM FCX › SAÍDAS + ISOLAMENTO POR MÊS E ORIGEM (nunca um ERP sobrepõe o outro no mesmo mês)
   Layouts exatos: ERP Legado = aba PGTO.JANEIRO26 com cabeçalho na LINHA 5, Item "187-SALARIOS E ORDENADOS", conta "070-ESPOSENDE -SANTANDER", SEM coluna Fornecedor (a causa do "data ausente");
                   ERP Sállamos = CTGP_Sállamos com Status Pago/Vencido/Renegociado/Previsto/Cancelado/Vinculado de 2026-05 a 2026-11.
   --------------------------------------------------------------------------------------------------------------------------------------- */
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
const PGTO_SHEET = (nome, rows = PGTO_ROWS) => aoa(nome, [['ESPOSENDE CALÇADOS LTDA'], ['Relação dos Títulos Pagos'], ['Período: 01/01/2026 a 31/01/2026'], [], PGTO_HDR, ...rows.slice(0, 5), [], PGTO_HDR /* cabeçalho repetido na quebra de página */, ...rows.slice(5, 9),
  ['', '', 'Total do dia 05/01/2026', '', null, 12345.67, '', '', '', ''], ...rows.slice(9), ['', '', 'Total Geral:', '', null, 99999.99, '', '', '', '']]);
const WB_REAL = () => [abaBruta(LINHAS_B) /* AgendaPagto vem PRIMEIRO na pasta */, PGTO_SHEET('PGTO.JANEIRO26')];
const SALL_HDR = ['Código', 'Status', 'Favorecido', 'Valor', 'Valor Pago', 'Data de Vencimento', 'Data de Pagamento', 'Conta Contábil', 'Centro de Custo', 'Conta Bancária', 'Banco de Pagamento'];
const SC = { adiant: '4.01.04 – (-) Adiantamento Salarial', prazo: '2.02 – (-) Compras a Prazo' };
const sallMes = mm => { const d = dia => `${String(dia).padStart(2, '0')}/${String(mm).padStart(2, '0')}/2026`, c = n => `S${mm}${n}`;
  return [
    [c(1), 'Pago', 'ADIANTAMENTO FOLHA', 1000 + mm, 'R$' + (1000 + mm).toFixed(2), d(3), d(5), SC.adiant, 'GESTÃO', 'ESPOSENDE -SANTANDER', ''],
    [c(2), 'Pago', 'FORNECEDOR PRAZO LTDA', 2000 + mm, 2000 + mm + 0.5, d(8), d(10), SC.prazo, 'LOJA 01', '', '091-MAR ABERTO - SANTANDER'],
    [c(3), 'Vencido', 'FORN VENCIDO', 300, 0, d(2), '', SC.prazo, 'GESTÃO', '', ''],
    [c(4), 'Renegociado', 'FORN RENEGOCIADO', 400, 0, d(2), '', SC.prazo, 'GESTÃO', '', ''],
    [c(5), 'Previsto', 'FORN PREVISTO', 500, 0, d(28), '', SC.prazo, 'GESTÃO', '', ''],
    [c(6), 'Cancelado', 'FORN CANCELADO', 600, 600, d(2), d(4), SC.prazo, 'GESTÃO', 'ESPOSENDE -SANTANDER', ''],
    [c(7), 'Vinculado', 'FORN VINCULADO', 700, 700, d(2), d(4), SC.prazo, 'GESTÃO', 'ESPOSENDE -SANTANDER', ''],
  ]; };
const SALL_SHEET = (meses, extra = [], nome = 'CTGP') => aoa(nome, [['CTGP Sállamos — Contas a Pagar'], ['Exportado em 10/11/2026'], SALL_HDR, ...meses.flatMap(sallMes), ...extra]);
const SALL_5_11 = () => [SALL_SHEET([5, 6, 7, 8, 9, 10, 11])];
const centsSall = meses => meses.reduce((s, mm) => s + c100(1000 + mm) + c100(2000 + mm + 0.5), 0);
const SALL_JAN = ['SJ1', 'Pago', 'LANÇAMENTO NO MÊS DO LEGADO', 100, 100, '10/01/2026', '15/01/2026', SC.prazo, 'GESTÃO', 'ESPOSENDE -SANTANDER', ''];

chk('v15.2.1 · fixtures: serial do Excel de 05/01/2026 = 46027; PGTO.JANEIRO26 tem o cabeçalho na linha 5 e NÃO tem a coluna Fornecedor; Sállamos tem 14 títulos Pago + 35 de outros status', serialXl(2026, 1, 5) === 46027 && PGTO_SHEET('x').rows[4] === PGTO_HDR && !PGTO_HDR.includes('Fornecedor')
  && SALL_5_11()[0].rows.filter(r => r[1] === 'Pago').length === 14 && SALL_5_11()[0].rows.filter(r => ['Vencido', 'Renegociado', 'Previsto', 'Cancelado', 'Vinculado'].includes(r[1])).length === 35);

/* ---------- 1 · o defeito: o leitor da v15.1/v15.2 não reconhecia a planilha (sem Fornecedor) ---------- */
{
  const E = amb152(), velho = E.PAGTO17.interpretar([PGTO_SHEET('PGTO.JANEIRO26')], {}), velhoS = E.PAGTO17.interpretar([SALL_SHEET([6])], {});
  chk('defeito reproduzido · sem o pedido do FCX v15.2.1 (modo v15.1) a aba PGTO.JANEIRO26 sem Fornecedor NÃO é reconhecida (layout nulo → caía no importador genérico: "data ausente")', velho.layout === null && velhoS.layout === null, [velho.layout, velhoS.layout]);
  const novo = E.PAGTO17.interpretar([PGTO_SHEET('PGTO.JANEIRO26')], { v1521: true }), novoS = E.PAGTO17.interpretar([SALL_SHEET([6])], { v1521: true });
  chk('correção · com o leitor v15.2.1 os dois arquivos são reconhecidos só pelas colunas que definem o modelo (Pagamento+Vlr Líquido+Item+Conta · Status+Valor Pago+Data de Pagamento+Conta Contábil)', novo.layout === 'B' && novo.origemModelo === 'erp_legado' && novoS.layout === 'A' && novoS.origemModelo === 'erp_sallamos', [novo.layout, novoS.layout]);
  chk('desligado ≡ v15.1 · sem o pedido do FCX as linhas lidas NÃO ganham campos novos (origemModelo/itemErp) e nada muda para a DFC', B0.linhas.concat(A0.linhas).every(s => !('origemModelo' in s) && !('itemErp' in s)) && B0.linhas.every(s => s.contaPagamento !== 'ESPOSENDE - SANTANDER'));
}

/* ---------- 2 · ERP LEGADO (PGTO.JANEIRO26): aba, cabeçalho dinâmico, filtros e mapeamento ---------- */
{
  const E = amb152(), R = E.PAGTO17.interpretar(WB_REAL(), { v1521: true }), L = f => R.linhas.find(f);
  chk('ERP Legado · a aba PGTO.JANEIRO26 é a escolhida mesmo com AgendaPagto vindo primeiro na pasta; a AgendaPagto é descartada (mesmos pagamentos)', R.layout === 'B' && R.abas.join() === 'PGTO.JANEIRO26' && R.puladas.join() === 'AgendaPagto' && R.avisos.some(a => /AgendaPagto/.test(a) && /PGTO\.JANEIRO26/.test(a)), [R.abas, R.puladas]);
  chk('ERP Legado · cabeçalho achado na linha 5: 8 baixas válidas (inclui 1 crediário) = R$ 20.220,75 (2.022.075 centavos), competência única 2026-01, ZERO "data ausente" e nenhuma linha inválida', R.linhas.length === 8 && R.totalCents === 2022075 && igual(R.competencias, ['2026-01']) && R.contagem.semData === 0 && R.contagem.semValor === 0 && !R.ignoradas.some(x => /ausente|inválid/i.test(x.motivo)), [R.linhas.length, R.totalCents, R.contagem]);
  chk('ERP Legado · filtros obrigatórios: 1 Baixa Estornada (minúsculas), 3 contas internas sem banco (152-RECEITAS NÃO OPERACIONAIS, CONCILIAÇÃO GETNET, 001-CAIXA), 1 crediário, 2 linhas de total/subtotal e 1 cabeçalho repetido ignorados', R.contagem.estornadas === 1 && R.contagem.internas === 3 && R.contagem.crediario === 1 && R.contagem.totais === 2 && R.contagem.cabecalhoRepetido === 1
    && R.ignoradas.some(x => /Receitas|RECEITAS NÃO OPERACIONAIS/.test(x.motivo)), R.contagem);
  chk('ERP Legado · data = Pagamento normalizada para AAAA-MM-DD a partir de serial do Excel, Date e DD/MM/AAAA; date = dataPagamento; tipo sempre "pago"; origemModelo "erp_legado"', L(s => s.valor === 5000).date === '2026-01-05' && L(s => s.valor === 3000.5).date === '2026-01-05' && L(s => s.valor === 7000).date === '2026-01-06' && L(s => s.valor === 1500.25).date === '2026-01-05'
    && R.linhas.every(s => s.date === s.dataPagamento && /^2026-01-0[5-9]$/.test(s.date) && s.tipo === 'pago' && s.origemModelo === 'erp_legado' && s.erp17 === 'B'), R.linhas.map(s => s.date));
  chk('ERP Legado · valor = Vlr Líquido; conta = Item → Plano de Contas (187 → 4.01.01 · 468 → 4.10.06 · 217 → 4.33.15 · 475 → 7.20.05); itemErp guarda o texto original do Item e item o código', L(s => s.valor === 3000.5).conta.startsWith('4.01.01') && L(s => s.valor === 5000).conta.startsWith('4.10.06') && L(s => s.valor === 1500.25).conta.startsWith('4.33.15') && L(s => s.valor === 7000).conta.startsWith('7.20.05')
    && L(s => s.valor === 3000.5).itemErp === '187-SALARIOS E ORDENADOS' && L(s => s.valor === 3000.5).item === '187' && L(s => s.valor === 5000).itemErp === '468-ALUGUEL LOJA DE RUA' && L(s => s.valor === 300).conta === '(sem conta)' && L(s => s.valor === 300).itemErp === '999-ITEM NOVO', R.linhas.map(s => [s.valor, s.conta, s.itemErp]));
  chk('ERP Legado · contaPagamento sem prefixo e com espaços padronizados: "070-ESPOSENDE -SANTANDER" → "ESPOSENDE - SANTANDER", "091-MAR ABERTO - SANTANDER" → "MAR ABERTO - SANTANDER", "080-CAIXA ECONÔMICA FEDERAL" → "CAIXA ECONÔMICA FEDERAL"', igual(R.contasPagamento.map(c => c.nome).sort(), ['CAIXA ECONÔMICA FEDERAL', 'ESPOSENDE - SANTANDER', 'MAR ABERTO - SANTANDER']) && L(s => s.valor === 2500).contaPagamento === 'MAR ABERTO - SANTANDER', R.contasPagamento);
  chk('ERP Legado · centro de custo: Nome Loja quando há; senão a coluna Gestão', L(s => s.valor === 5000).centro === 'LOJA 01 RUA' && L(s => s.valor === 3000.5).centro === 'ESPOSENDE' && L(s => s.valor === 2500).centro === 'LOJA 05 SHOPPING', R.linhas.map(s => s.centro));
  const so = E.PAGTO17.interpretar([abaBruta(LINHAS_B)], { v1521: true });
  chk('ERP Legado · só usa a AgendaPagto quando NÃO existe aba PGTO*', so.layout === 'B' && so.abas.join() === 'AgendaPagto' && so.linhas.length === 8, [so.abas, so.linhas.length]);
  const ids1 = R.linhas.map(s => s.id), R2 = E.PAGTO17.interpretar(WB_REAL(), { v1521: true });
  chk('ERP Legado · ids estáveis (ler o mesmo arquivo duas vezes dá os mesmos ids; os ids são os mesmos da v15.2 → reimportação troca em vez de duplicar)', igual(ids1, R2.linhas.map(s => s.id)) && new Set(ids1).size === 8 && ids1.every(i => /^erp17-B-/.test(i)), ids1);
  /* mapeamento de Item → categoria */
  const mini = itens => [aoa('PGTO.TESTE', [['x'], [], [], [], PGTO_HDR, ...itens.map((it, i) => Lg('G', 'LOJA', it, String(i), '10/01/2026', 100 + i, '070-ESPOSENDE -SANTANDER', '2-TED', '', ''))])];
  const tab = E.PAGTO17.tabelaItens({});
  for (const [item, conta, cat] of [['187-SALARIOS E ORDENADOS', '4.01.01', 'pag_folha'], [187, '4.01.01', 'pag_folha'], ['468-ALUGUEL LOJA DE RUA', '4.10.06', 'pag_ocupacao'], ['005-COMPRAS A PRAZO', '2.02', 'pag_fornecedores'], ['125-IPTU', '4.10.11', 'pag_impostos'], ['388-CREDSYSTEM A PAGAR - REPASSE', '7.01.05', 'pag_repasse_credsystem'], ['ALUGUEL LOJA DE RUA', '4.10.06', 'pag_ocupacao']]) {
    const m = E.PAGTO17.interpretar(mini([item]), { v1521: true }), s = m.linhas[0];
    chk(`Item "${item}" → Plano de Contas ${conta}… e categoria DFC ${cat}`, m.linhas.length === 1 && s.conta.startsWith(conta) && E.PAGTO17.categoriaDaSaida(s, tab) === cat && s.itemErp === String(item), s);
  }
  /* datas em vários formatos */
  const dts = [[46027, '2026-01-05'], [dB(5), '2026-01-05'], ['05/01/2026', '2026-01-05'], ['05/01/26', '2026-01-05'], ['46027', '2026-01-05'], ['05/01/2026 14:30', '2026-01-05']];
  const md = E.PAGTO17.interpretar([aoa('PGTO.D', [['x'], [], [], [], PGTO_HDR, ...dts.map(([d], i) => Lg('G', 'LOJA', '468-ALUGUEL LOJA DE RUA', String(i), d, 100 + i, '070-ESPOSENDE -SANTANDER', '2-TED', '', ''))])], { v1521: true });
  chk('datas · serial (número e texto), Date, DD/MM/AAAA, DD/MM/AA e com hora → AAAA-MM-DD, sem nenhum "data ausente"', md.linhas.length === dts.length && md.linhas.every((s, i) => s.date === dts[i][1]) && md.contagem.semData === 0, md.linhas.map(s => s.date));
  const mr = E.PAGTO17.interpretar([aoa('PGTO.R', [['x'], [], [], [], PGTO_HDR, Lg('G', 'LOJA', '468-ALUGUEL LOJA DE RUA', '1', null, 100, '070-ESPOSENDE -SANTANDER', '2-TED', '', ''), Lg('G', 'LOJA', '468-ALUGUEL LOJA DE RUA', '2', '10/01/2026', 0, '070-ESPOSENDE -SANTANDER', '2-TED', '', ''), Lg('G', 'LOJA', '468-ALUGUEL LOJA DE RUA', '3', '10/01/2026', 50, '070-ESPOSENDE -SANTANDER', '2-TED', '', '')])], { v1521: true });
  chk('linha de pagamento de verdade sem data / com valor zero NÃO é engolida: vira inválida e aparece no relatório (só as linhas de total e rodapé são silenciosas)', mr.linhas.length === 1 && mr.contagem.semData === 1 && mr.contagem.semValor === 1 && mr.ignoradas.filter(x => x.tipo === 'invalida').length === 2, mr.contagem);
}

/* ---------- 3 · ERP SÁLLAMOS: só Status Pago com Valor Pago > 0 ---------- */
{
  const E = amb152(), R = E.PAGTO17.interpretar(SALL_5_11(), { v1521: true }), meses = [5, 6, 7, 8, 9, 10, 11];
  chk('ERP Sállamos · cabeçalho Status+Valor Pago+Data de Pagamento+Conta Contábil achado sem Fornecedor/Centro obrigatório; só os 14 títulos Pago entram; competências 2026-05 a 2026-11', R.layout === 'A' && R.origemModelo === 'erp_sallamos' && R.linhas.length === 14 && igual(R.competencias, ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']), [R.layout, R.linhas.length, R.competencias]);
  chk('ERP Sállamos · Vencido, Renegociado, Previsto, Cancelado e Vinculado ficam de fora (7 de cada) — inclusive Cancelado/Vinculado que trazem Valor Pago e data — e o relatório conta por status', igual(R.statusIgnorados, { Vencido: 7, Renegociado: 7, Previsto: 7, Cancelado: 7, Vinculado: 7 }) && R.contagem.naoPago === 35 && R.linhas.every(s => s.tipo === 'pago') && R.avisos.some(a => /35 linha\(s\)/.test(a) && /Vencido: 7/.test(a)), [R.statusIgnorados, R.avisos]);
  chk('ERP Sállamos · valor = Valor Pago ("R$1005.00" e número) somando exato ao centavo; zero erros de data/valor', R.totalCents === centsSall(meses) && R.contagem.semData === 0 && R.contagem.semValor === 0 && R.ignoradas.length === 0, [R.totalCents, centsSall(meses)]);
  chk('ERP Sállamos · date = Data de Pagamento (DD/MM/AAAA → AAAA-MM-DD); conta = Conta Contábil; centro = Centro de Custo; tipo "pago"; origemModelo "erp_sallamos"', R.linhas.every(s => s.date === s.dataPagamento && /^2026-(0[5-9]|1[01])-(05|10)$/.test(s.date) && s.tipo === 'pago' && s.origemModelo === 'erp_sallamos' && s.erp17 === 'A') && R.linhas.some(s => s.conta === SC.adiant && s.centro === 'GESTÃO') && R.linhas.some(s => s.conta === SC.prazo && s.centro === 'LOJA 01'), R.linhas.slice(0, 2));
  chk('ERP Sállamos · contaPagamento = Conta Bancária (fallback Banco de Pagamento) padronizada: "ESPOSENDE -SANTANDER" → "ESPOSENDE - SANTANDER", "091-MAR ABERTO - SANTANDER" → "MAR ABERTO - SANTANDER"', igual(R.contasPagamento.map(c => c.nome).sort(), ['ESPOSENDE - SANTANDER', 'MAR ABERTO - SANTANDER']) && R.contagem.bancoNoLugarDaConta === 7, R.contasPagamento);
  const sujo = E.PAGTO17.interpretar([SALL_SHEET([6], [['X1', 'Pago', 'PAGO SEM DATA', 10, 10, '01/06/2026', '', SC.prazo, 'GESTÃO', 'ESPOSENDE -SANTANDER', ''], ['X2', 'Pago', 'PAGO ZERADO', 0, 0, '01/06/2026', '02/06/2026', SC.prazo, 'GESTÃO', 'ESPOSENDE -SANTANDER', ''], ['', '', 'Total geral', null, 99999, '', '', '', '', '', '']])], { v1521: true });
  chk('ERP Sállamos · Pago sem data NÃO é engolido (inválido, no relatório) e Pago com Valor Pago zero é "ignorado" e contado (não é erro); linha de total sem Status é ignorada em silêncio', sujo.linhas.length === 2 && sujo.contagem.semData === 1 && sujo.contagem.valorZero === 1 && sujo.contagem.semValor === 0 && sujo.contagem.totais === 1, sujo.contagem);
}

/* ---------- 4 · padronização do nome da conta e casamento com o cadastro de Contas Bancárias ---------- */
{
  const E = amb152(), L = E.Leitor1521;
  chk('contaPagamento · padronização: prefixo numérico fora e " - " com um espaço de cada lado (hífen dentro de palavra não muda)', [['070-ESPOSENDE -SANTANDER', 'ESPOSENDE - SANTANDER'], ['091-MAR ABERTO - SANTANDER', 'MAR ABERTO - SANTANDER'], ['080-CAIXA ECONÔMICA FEDERAL', 'CAIXA ECONÔMICA FEDERAL'], ['070 -  ESPOSENDE  -  SANTANDER', 'ESPOSENDE - SANTANDER'], ['CRED-SYSTEM', 'CRED-SYSTEM'], ['ESPOSENDE -SANTANDER', 'ESPOSENDE - SANTANDER']].every(([a, b]) => L.contaPag(a) === b), L.contaPag('070-ESPOSENDE -SANTANDER'));
  chk('contaPagamento · "ESPOSENDE - SANTANDER" continua casando com a conta cadastrada "ESPOSENDE -SANTANDER" (o desdobramento CNAB não perde título por causa do hífen)', E.CNAB17.mesmaConta('ESPOSENDE - SANTANDER', 'ESPOSENDE -SANTANDER') && E.CNAB17.mesmaConta('MAR ABERTO - SANTANDER', 'MAR ABERTO - SANTANDER') && !E.CNAB17.mesmaConta('ESPOSENDE - SANTANDER', 'MAR ABERTO - SANTANDER'));
}

/* ---------- 5 · planejador por mês e origem (motor puro) ---------- */
{
  const E = amb152(), S = E.Saidas152, T = (id, date, extra = {}) => ({ id, date, valor: 10, tipo: 'pago', ...extra });
  const base = [T('b1', '2026-01-05', { erp17: 'B' }), T('b2', '2026-01-06', { erp17: 'B', origemModelo: 'erp_legado' }), T('man', '2026-01-15'), T('a1', '2026-03-05', { erp17: 'A' }), T('s6', '2026-06-05', { origemModelo: 'erp_sallamos', erp17: 'A' })];
  chk('origem do lançamento · origemModelo vale mais que a marca antiga (erp17 B = ERP Legado, A = ERP Sállamos); manual = sem origem', S.origemDe({ erp17: 'B' }) === 'erp_legado' && S.origemDe({ erp17: 'A' }) === 'erp_sallamos' && S.origemDe({ origemModelo: 'erp_sallamos', erp17: 'B' }) === 'erp_sallamos' && S.origemDe({ id: 'x' }) === '');
  const sall = (id, date, extra = {}) => T(id, date, { origemModelo: 'erp_sallamos', erp17: 'A', ...extra });
  { const p = S.planejarImportacao(base, [sall('n1', '2026-01-20')], 'smart', { layout: 'A', origem: 'erp_sallamos' }), r = p.relatorio;
    chk('planejador · mês do arquivo (01/2026) com lançamentos do OUTRO ERP: conflito detectado (2 do ERP Legado), mês BLOQUEADO — o resultado é exatamente o que já existia e a linha nova não entra', r.conflitos.length === 1 && r.conflitos[0].mes === '2026-01' && r.conflitos[0].n === 2 && r.conflitos[0].rotuloOutra === 'ERP Legado' && igual(r.mesesBloqueados, ['2026-01']) && igual(p.resultado, base) && p.efetivas.length === 0 && r.bloqueados === 1 && r.avisos.some(a => /01\/2026/.test(a) && /ERP Legado/.test(a) && /ERP Sállamos/.test(a) && /NÃO foram gravados/.test(a)), r); }
  { const p = S.planejarImportacao(base, [sall('n1', '2026-01-20')], 'smart', { layout: 'A', origem: 'erp_sallamos', conflito: 'substituir' }), r = p.relatorio;
    chk('planejador · substituição confirmada: saem os 2 do ERP Legado de 01/2026 e entra o novo; manual de janeiro, março e junho intactos', igual(p.resultado.map(x => x.id).sort(), ['a1', 'man', 'n1', 's6']) && r.removidos === 2 && r.mesesBloqueados.length === 0 && r.avisos.some(a => /substituição CONFIRMADA/.test(a)), p.resultado.map(x => x.id)); }
  { const p = S.planejarImportacao(base, [sall('n6', '2026-06-20')], 'smart', { layout: 'A', origem: 'erp_sallamos' });
    chk('planejador · mesmo ERP no mesmo mês (reimportação): troca só o mês e o ERP do arquivo; meses fora do arquivo (jan e mar, de qualquer ERP) e manuais NUNCA mudam', igual(p.resultado.map(x => x.id), ['b1', 'b2', 'man', 'a1', 'n6']) && p.relatorio.conflitos.length === 0 && p.relatorio.removidos === 1, p.resultado.map(x => x.id)); }
  { const p = S.planejarImportacao(base, [sall('n1', '2026-01-20'), sall('n6', '2026-06-20')], 'smart', { layout: 'A', origem: 'erp_sallamos' });
    chk('planejador · arquivo com um mês em conflito e outro livre: grava só o livre (junho) e deixa janeiro como estava', igual(p.resultado.map(x => x.id), ['b1', 'b2', 'man', 'a1', 'n6']) && igual(p.relatorio.mesesGravados, ['2026-06']) && igual(p.relatorio.mesesBloqueados, ['2026-01']) && p.efetivas.length === 1, p.resultado.map(x => x.id)); }
  { const p = S.planejarImportacao(base, [sall('n1', '2026-01-20')], 'append', { layout: 'A', origem: 'erp_sallamos' });
    chk('planejador · "Adicionar" também respeita a regra (não duplica pagamento do outro ERP no mesmo mês)', igual(p.resultado, base) && p.relatorio.conflitos.length === 1, p.relatorio.conflitos.length); }
  { const p = S.planejarImportacao(base, [sall('n1', '2026-01-20')], 'replace', { layout: 'A', origem: 'erp_sallamos' });
    chk('planejador · "Substituir todos" não tem conflito por mês (já exige confirmação própria e apaga tudo)', p.relatorio.conflitos.length === 0 && igual(p.resultado.map(x => x.id), ['n1']), p.relatorio.conflitos.length); }
  { const leg = (id, date) => T(id, date, { origemModelo: 'erp_legado', erp17: 'B' }), p = S.planejarImportacao(base, [leg('l5', '2026-05-10')], 'smart', { layout: 'B' });
    chk('planejador · mês novo (maio) não tem conflito: o arquivo entra, e o que já existia segue idêntico (origem derivada do layout)', p.relatorio.conflitos.length === 0 && p.resultado.length === base.length + 1 && igual(p.resultado.slice(0, base.length), base) && p.relatorio.origem === 'erp_legado', p.relatorio.origem); }
}

/* ---------- 6 · FCX › Saídas de ponta a ponta (código real do fcx.html): Jan/2026 do ERP Legado → Sállamos mai–nov → bloqueios ---------- */
{
  const E = amb152({ ext: EXT_JAN() }), G = fcxGlue(E), brl = G.BRL2, ESC = 'ESPOSENDE - SANTANDER';
  const manualJan = { id: 'manual-jan', date: '2026-01-15', conta: CT.material, centro: 'GESTÃO', tipo: 'previsto', valor: 77.7, fornecedor: 'MANUAL JAN', obs: 'à mão' }, manualMar = { id: 'manual-mar', date: '2026-03-10', conta: CT.material, centro: 'GESTÃO', tipo: 'previsto', valor: 12.34, fornecedor: 'MANUAL MAR', obs: 'à mão' };
  G.state.saidas.push(manualJan, manualMar);
  /* 6.1 · ERP Legado: janeiro */
  const ok1 = await G.fcxImportSaidas152(arquivoMatriz('01-JANEIRO.26.xlsx', WB_REAL())); await espera(150);
  const rel1 = G.cargas[G.cargas.length - 1], campo1 = n => (rel1.campos.find(c => c[0] === n) || [])[1], B1 = G.state.saidas.filter(s => s.origemModelo === 'erp_legado');
  chk('FCX › Saídas · 01-JANEIRO.26.xlsx: reconhecido como ERP Legado (aba PGTO.JANEIRO26), 8 baixas gravadas (7 + 1 crediário), ZERO "data ausente"/inválidas, manuais intactos, sem painel de conflito', ok1 === true && B1.length === 8 && G.state.saidas.length === 10 && !G.state._saidasPendente152 && /ERP Legado/.test(campo1('Modelo do arquivo')) && campo1('Competências no arquivo') === '01/2026' && rel1.invalidas === 0 && !rel1.erro && rel1.inconsistencias.every(i => !/ausente/i.test(i.motivo || '')) && G.state.saidas.some(s => s.id === 'manual-jan') && G.state.saidas.some(s => s.id === 'manual-mar'), [ok1, B1.length, rel1.campos, rel1.invalidas]);
  chk('FCX › Saídas · gravação conferida no banco: 10 registros (8 baixas R$ 20.220,75 + 2 manuais) e a faixa verde mostra o mês', G.state._saidasGravacao.ok === true && G.state._saidasGravacao.n === 10 && G.state._saidasGravacao.porMes['2026-01'].pago.cents === 2022075 && igual(await gravadas(E), G.state.saidas) && /Mês <b>01\/2026<\/b>/.test(G.fcxPainelSaidas152()), G.state._saidasGravacao);
  const p1 = E.FluxoDFC.planoCnab17(), l1 = p1.porTx.get('ct-esp|t1'), lm1 = p1.porTx.get('ct-mar|t3');
  chk('DFC · Janeiro/2026 desdobra os lotes CNAB com os baixas do ERP Legado: Esposende = Aluguel 5.000,00 · Pessoal 3.000,50 · Marketing 1.500,25 (obra de 7.000,00 e o 999 ficam de fora) e Mar Aberto = Aluguel 2.500,00; a conta "ESPOSENDE - SANTANDER" casa com o cadastro', l1 && igual(catsDe(l1), { pag_ocupacao: 5000, pag_folha: 3000.5, pag_marketing: 1500.25 }) && l1.resto === 700000 && lm1 && igual(catsDe(lm1), { pag_ocupacao: 2500 }) && lm1.resto === 0 && l1.alocs.every(a => a.x.contaPag === ESC) && p1.integridade.ok, [l1 && catsDe(l1), lm1 && catsDe(lm1)]);
  const dep = dfcMes(E, '2026-01', true), ant = dfcMes(E, '2026-01', false), bruto = noMes(E.FluxoDFC.transacoes(), '2026-01');
  chk('DFC · PARIDADE AO CENTAVO em Jan/2026 com o leitor v15.2.1: Σ categorias após o desdobramento = Σ OFX = 10.670.890; Total de Saídas do Banco, entradas e saldo final idênticos antes e depois', depois_ok(dep, ant, bruto), [somaCat(dep.c), SOMA_OFX_JAN]);
  function depois_ok(d, a, b) { return somaCat(d.c) === SOMA_OFX_JAN && somaLista(d.trs) === SOMA_OFX_JAN && somaLista(b) === SOMA_OFX_JAN && saidasBanco(d.trs) === saidasBanco(b) && entradasBanco(d.trs) === entradasBanco(b) && c100(d.c.saidas) === c100(a.c.saidas) && c100(d.c.liquido) === c100(a.c.liquido) && d.trs.length > b.length; }
  /* 6.2 · reimportar o mesmo arquivo: nada duplica, troca só janeiro do ERP Legado */
  const idsAntes = G.state.saidas.map(s => s.id).sort(); await G.fcxImportSaidas152(arquivoMatriz('01-JANEIRO.26.xlsx', WB_REAL())); await espera(150);
  const rel2 = G.cargas[G.cargas.length - 1];
  chk('mesmo ERP, mesmo mês (reimportação): 10 registros, os mesmos ids, 8 substituídos (mesmo mês e mesmo ERP), manuais intactos, nenhum painel de conflito', G.state.saidas.length === 10 && igual(G.state.saidas.map(s => s.id).sort(), idsAntes) && rel2.campos.some(c => c[0].startsWith('Substituídos') && c[1] === '8') && !G.state._saidasPendente152 && G.state.saidas.find(s => s.id === 'manual-jan').valor === 77.7, rel2.campos);
  /* 6.3 · Sállamos de mai–nov: janeiro do ERP Legado fica 100% intacto */
  const jan0 = JSON.stringify(G.state.saidas.filter(s => String(s.date).startsWith('2026-01'))), tudo0 = G.state.saidas.filter(s => !String(s.date).startsWith('2026-0') || String(s.date) < '2026-05').map(s => s.id).sort();
  const ok3 = await G.fcxImportSaidas152(arquivoMatriz('CTGP_Sállamos.xlsx', SALL_5_11())); await espera(150);
  const rel3 = G.cargas[G.cargas.length - 1], campo3 = n => (rel3.campos.find(c => c[0] === n) || [])[1], SA = G.state.saidas.filter(s => s.origemModelo === 'erp_sallamos');
  chk('Sállamos (mai–nov) · reconhecido, só os 14 Pago gravados (R$ por mês conferido no banco), 35 de outros status ficam de fora, nenhuma sobreposição e SEM painel pendente', ok3 === true && SA.length === 14 && G.state.saidas.length === 10 + 14 && !G.state._saidasPendente152 && /ERP Sállamos/.test(campo3('Modelo do arquivo')) && /05\/2026/.test(campo3('Competências no arquivo')) && /11\/2026/.test(campo3('Competências no arquivo')) && campo3('Fora por Status diferente de Pago') === '35 linha(s)' && rel3.invalidas === 0, [rel3.campos, G.state.saidas.length]);
  chk('Sállamos (mai–nov) · PRESERVA 100% dos dados de jan/2026 do ERP Legado (mesmos registros, byte a byte), os manuais e o que não é do período; o banco confere', JSON.stringify(G.state.saidas.filter(s => String(s.date).startsWith('2026-01'))) === jan0 && tudo0.every(id => G.state.saidas.some(s => s.id === id)) && G.state._saidasGravacao.ok === true && G.state._saidasGravacao.n === 24 && igual(await gravadas(E), G.state.saidas), [G.state._saidasGravacao.n]);
  chk('DFC · depois de subir o Sállamos o desdobramento de Janeiro continua exatamente o mesmo (Aluguel 5.000,00 · Pessoal 3.000,50 · Marketing 1.500,25) e a prova ao centavo fecha', (l => l && igual(catsDe(l), { pag_ocupacao: 5000, pag_folha: 3000.5, pag_marketing: 1500.25 }) && l.resto === 700000)(E.FluxoDFC.planoCnab17().porTx.get('ct-esp|t1')) && somaCat(dfcMes(E, '2026-01', true).c) === SOMA_OFX_JAN, catsDe(E.FluxoDFC.planoCnab17().porTx.get('ct-esp|t1')));
  /* 6.4 · reimportar só jun–nov com um valor mudado: troca só jun–nov do Sállamos; maio, janeiro e manuais não mudam */
  const maio0 = JSON.stringify(G.state.saidas.filter(s => String(s.date).startsWith('2026-05'))), jan1 = JSON.stringify(G.state.saidas.filter(s => String(s.date).startsWith('2026-01')));
  const junNov = SALL_SHEET([6, 7, 8, 9, 10, 11]); junNov.rows[3][3] = 1006 + 55; junNov.rows[3][4] = 'R$' + (1006 + 55).toFixed(2); // 1º título de junho: valor novo
  await G.fcxImportSaidas152(arquivoMatriz('CTGP_Sállamos_atualizado.xlsx', [junNov])); await espera(150);
  chk('Sállamos (jun–nov atualizado) · só jun–nov do ERP Sállamos são trocados (valor de junho atualizado); maio, janeiro e manuais ficam idênticos; continua 24 registros', G.state.saidas.length === 24 && JSON.stringify(G.state.saidas.filter(s => String(s.date).startsWith('2026-05'))) === maio0 && JSON.stringify(G.state.saidas.filter(s => String(s.date).startsWith('2026-01'))) === jan1 && G.state.saidas.some(s => s.origemModelo === 'erp_sallamos' && s.date === '2026-06-05' && s.valor === 1061) && !G.state._saidasPendente152, G.state.saidas.length);
  /* 6.5 · Sállamos com um lançamento em JANEIRO (mês do ERP Legado): sobreposição bloqueada */
  const comJan = SALL_SHEET([6, 7], [SALL_JAN]), setsAntes = E.banco.sets, estadoAntes = JSON.stringify(G.state.saidas);
  const ok5 = await G.fcxImportSaidas152(arquivoMatriz('CTGP_Sállamos_com_janeiro.xlsx', [comJan])), pend = G.state._saidasPendente152, html5 = G.fcxPainelSaidas152();
  chk('sobreposição · arquivo Sállamos com um título em 01/2026: NADA é gravado, aparece o alerta "Sobreposição entre ERPs bloqueada" dizendo que 01/2026 já tem 8 lançamentos do ERP Legado × arquivo do ERP Sállamos', ok5 === true && !!pend && E.banco.sets === setsAntes && JSON.stringify(G.state.saidas) === estadoAntes && /id="sobreposicao152"/.test(html5) && /Sobreposição entre ERPs bloqueada/.test(html5) && /01\/2026/.test(html5) && /<b>8<\/b> lançamento\(s\) do <b>ERP Legado<\/b>/.test(html5) && /ERP Sállamos/.test(html5) && /este mês não será gravado/.test(html5), html5.slice(0, 900));
  chk('sobreposição · o quadro oferece "Gravar só os meses sem conflito" (jun e jul) e "Substituir ERP Legado em 01/2026…" — a substituição NUNCA é o padrão', /id="btnGravarLivres152"/.test(html5) && /Gravar só os meses sem conflito/.test(html5) && /id="btnSubstituir152"/.test(html5) && /Substituir ERP Legado em 01\/2026/.test(html5) && /<b style="color:var\(--red\);">Bloqueado<\/b> · já tem ERP Legado/.test(html5) && !/btnConfirmarSubst152/.test(html5), html5.slice(0, 200));
  G.confirmarImportacaoSaidas152(); await espera(150);
  const relB = G.cargas[G.cargas.length - 1], campoB = n => (relB.campos.find(c => c[0] === n) || [])[1];
  chk('sobreposição · "Gravar só os meses sem conflito": jun/jul do Sállamos gravados; o título de janeiro NÃO entrou; os 8 do ERP Legado e os manuais seguem intactos; o relatório diz quantos ficaram de fora', !G.state.saidas.some(s => s.origemModelo === 'erp_sallamos' && String(s.date).startsWith('2026-01')) && JSON.stringify(G.state.saidas.filter(s => String(s.date).startsWith('2026-01'))) === jan1 && G.state.saidas.length === 24 && /1 título\(s\)/.test(campoB('NÃO gravados (mês com lançamentos do outro ERP)') || '') && /01\/2026/.test(campoB('NÃO gravados (mês com lançamentos do outro ERP)') || '') && G.state._saidasGravacao.ok === true && igual(await gravadas(E), G.state.saidas), [relB.campos]);
  /* 6.6 · substituição só com confirmação explícita */
  await G.fcxImportSaidas152(arquivoMatriz('CTGP_Sállamos_com_janeiro.xlsx', [comJan])); const set6 = E.banco.sets; G.substituirConflitoSaidas152(); const h6 = G.fcxPainelSaidas152();
  chk('substituição · depois de clicar em "Substituir…" o quadro vira o aviso vermelho ("serão apagados" os 8 do ERP Legado em 01/2026), ainda NADA foi gravado e há "Voltar: bloquear esses meses"', E.banco.sets === set6 && /Substituição entre ERPs/.test(h6) && /serão <b>apagados<\/b>/.test(h6) && /id="btnConfirmarSubst152"/.test(h6) && /Voltar: bloquear esses meses/.test(h6) && /Substitui ERP Legado/.test(h6) && G.state.saidas.filter(s => s.origemModelo === 'erp_legado').length === 8, h6.slice(0, 500));
  G.bloquearConflitoSaidas152(); chk('substituição · "Voltar" restaura o bloqueio (sem apagar nada)', /Sobreposição entre ERPs bloqueada/.test(G.fcxPainelSaidas152()) && G.state.saidas.filter(s => s.origemModelo === 'erp_legado').length === 8 && E.banco.sets === set6);
  G.substituirConflitoSaidas152(); G.confirmarImportacaoSaidas152(); await espera(160);
  chk('substituição confirmada · os 7 do ERP Legado de janeiro saem e entra o 1 do ERP Sállamos; manuais, março e mai–nov seguem intactos; o banco confere', G.state.saidas.filter(s => s.origemModelo === 'erp_legado').length === 0 && G.state.saidas.filter(s => s.origemModelo === 'erp_sallamos' && String(s.date).startsWith('2026-01')).length === 1 && G.state.saidas.some(s => s.id === 'manual-jan') && G.state.saidas.some(s => s.id === 'manual-mar') && G.state.saidas.length === 23 - 7 + 1 && G.state._saidasGravacao.ok === true && igual(await gravadas(E), G.state.saidas), G.state.saidas.length);
  chk('DFC · após trocar o ERP de janeiro, Σ categorias = Σ OFX continua valendo (sem títulos Pago para o lote, o valor fica inteiro no que o extrato classificou)', somaCat(dfcMes(E, '2026-01', true).c) === SOMA_OFX_JAN && E.FluxoDFC.planoCnab17().integridade.ok, somaCat(dfcMes(E, '2026-01', true).c));
}

/* ---------- 7 · o inverso: ERP Legado em mês que já é do Sállamos; arquivo inteiro em conflito; arquivo desconhecido ---------- */
{
  const E = amb152({ ext: EXT_JAN() }), G = fcxGlue(E);
  await G.fcxImportSaidas152(arquivoMatriz('CTGP_Sállamos.xlsx', SALL_5_11())); await espera(120);
  const junho = [PGTO_SHEET('PGTO.JUNHO26', PGTO_ROWS.map(r => { const x = r.slice(); if (typeof x[4] !== 'string') x[4] = '10/06/2026'; else x[4] = x[4].replace('/01/', '/06/'); return x; }))];
  const antes = JSON.stringify(G.state.saidas), sets = E.banco.sets;
  await G.fcxImportSaidas152(arquivoMatriz('02-JUNHO.26.xlsx', junho)); const h = G.fcxPainelSaidas152(), rr = G.state._saidasPendente152 && G.state._saidasPendente152.plano.relatorio;
  chk('inverso · ERP Legado (competência 06/2026) por cima de um mês que já é do ERP Sállamos: bloqueado, nada gravado; como NENHUM mês do arquivo está livre, não existe "Gravar só os meses sem conflito" (só Substituir…/Cancelar)', !!rr && igual(rr.mesesBloqueados, ['2026-06']) && rr.conflitos[0].rotuloOutra === 'ERP Sállamos' && JSON.stringify(G.state.saidas) === antes && E.banco.sets === sets && /ERP Sállamos<\/b> \(/.test(h) && !/btnGravarLivres152/.test(h) && /id="btnSubstituir152"/.test(h) && /Substituir ERP Sállamos em 06\/2026/.test(h), [rr && rr.mesesBloqueados, h.slice(0, 300)]);
  G.cancelarImportacaoSaidas152();
  chk('inverso · Cancelar mantém tudo como estava (tela e banco) e some o quadro', !G.state._saidasPendente152 && JSON.stringify(G.state.saidas) === antes && E.banco.sets === sets && !/saidasPendente152/.test(G.fcxPainelSaidas152()));
  /* arquivo que não é de nenhum ERP: o painel não grava, devolve false (segue o leitor simples) e guarda o diagnóstico */
  const R = E.PAGTO17.interpretar([aoa('Qualquer', [['Data', 'Conta', 'Valor'], ['01/01/2026', 'X', 10]])], { v1521: true }), faltaLiq = PGTO_HDR.filter(h => h !== 'Vlr Líquido'), R2 = E.PAGTO17.interpretar([aoa('PGTO.X', [['t'], [], [], [], faltaLiq, ['G', 'L', '468-ALUGUEL', '1', '05/01/2026', '070-ESPOSENDE -SANTANDER', '2-TED', '', '']])], { v1521: true });
  chk('arquivo desconhecido · mensagem clara com o que cada modelo exige e, na aba PGTO com cabeçalho quase certo, "o cabeçalho mais próximo está na linha 5 e falta Vlr Líquido"', R.layout === null && /Layout do ERP não reconhecido/.test(R.avisos[0]) && /Pagamento, Vlr Líquido, Item e Conta/.test(R.avisos[0]) && /Status, Valor Pago, Data de Pagamento e Conta Contábil/.test(R.avisos[0]) && R2.layout === null && R2.diagnostico[0].linha === 5 && R2.diagnostico[0].falta.includes('Vlr Líquido') && /linha 5/.test(R2.avisos[0]) && /falta Vlr Líquido/.test(R2.avisos[0]), [R.avisos[0], R2.avisos[0]]);
  const g0 = JSON.stringify(G.state.saidas), ok = await G.fcxImportSaidas152(arquivoMatriz('generico.xlsx', [aoa('Plan1', [['Data', 'Conta', 'Valor'], ['01/01/2026', 'X', 10]])]));
  chk('arquivo desconhecido · fcxImportSaidas152 devolve false (o FCX segue o leitor simples Data/Conta/Valor), não altera nada e guarda o diagnóstico para a mensagem de erro', ok === false && JSON.stringify(G.state.saidas) === g0 && /Layout do ERP não reconhecido/.test(G.state._diag1521 || ''), G.state._diag1521);
}

/* ---------- 8 · arquivos XLSX reais (SheetJS), no mesmo caminho do FCX ---------- */
if (XLSX) {
  const mk = sheets => { const wb = XLSX.utils.book_new(); for (const s of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows, { cellDates: true }), s.nome); return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true }); };
  const E = amb152({ ext: EXT_JAN() }), G = fcxGlue(E), Ref = amb152({ ext: EXT_JAN() }), Gr = fcxGlue(Ref);
  await Gr.fcxImportSaidas152(arquivoMatriz('ref.xlsx', WB_REAL())); await espera(100);
  await G.fcxImportSaidas152(arquivoDe('01-JANEIRO.26.xlsx', mk(WB_REAL()))); await espera(150);
  const r1 = G.cargas[G.cargas.length - 1];
  chk('XLSX real · 01-JANEIRO.26.xlsx (AgendaPagto + PGTO.JANEIRO26, cabeçalho na linha 5, serial/Date/texto): 8 baixas idênticas às da matriz (mesmos ids, datas, contas), zero "data ausente", 2.022.075 centavos conferidos no banco e Jan/2026 desdobrado na DFC', G.state.saidas.length === 8 && igual(G.state.saidas.map(s => [s.id, s.date, s.valor, s.contaPagamento, s.conta, s.itemErp, s.origemModelo]), Gr.state.saidas.map(s => [s.id, s.date, s.valor, s.contaPagamento, s.conta, s.itemErp, s.origemModelo])) && r1.invalidas === 0 && r1.inconsistencias.every(i => !/ausente/i.test(i.motivo || '')) && G.state._saidasGravacao.cents === 2022075 && igual(catsDe(E.FluxoDFC.planoCnab17().porTx.get('ct-esp|t1')), { pag_ocupacao: 5000, pag_folha: 3000.5, pag_marketing: 1500.25 }), [G.state.saidas.length, r1.campos]);
  await G.fcxImportSaidas152(arquivoDe('CTGP_Sállamos.xlsx', mk(SALL_5_11()))); await espera(150);
  chk('XLSX real · CTGP_Sállamos.xlsx (mai–nov): 14 Pago gravados, 35 de outros status fora, janeiro do ERP Legado preservado (8 baixas intactas) e 22 registros no banco', G.state.saidas.filter(s => s.origemModelo === 'erp_sallamos').length === 14 && G.state.saidas.filter(s => s.origemModelo === 'erp_legado').length === 8 && G.state.saidas.length === 22 && G.state._saidasGravacao.ok === true && igual(G.state.saidas.slice(0, 8).map(s => s.id), Gr.state.saidas.map(s => s.id)), [G.state.saidas.length]);
} else pula('v15.2.1 · arquivos XLSX reais (01-JANEIRO.26 e CTGP_Sállamos)');

/* ---------- 9 · recurso desligado ≡ v15.1 e Regra de Ouro ---------- */
{
  const E = amb152({ g152: false }), G = fcxGlue(E);
  chk('v15.2.2 · recurso desligado: fcxV152 falso, nenhum quadro de conflito ainda, e o PAGTO17 só muda de comportamento quando o FCX pede v1521 (a DFC e o modo antigo seguem os da v15.1)', G.fcxV152() === false && G.fcxLeitor1522() === true && G.fcxPainelSaidas152() === '' && E.banco.sets === 0 && E.PAGTO17.interpretar([PGTO_SHEET('PGTO.JANEIRO26')], {}).layout === null);
  chk('Regra de Ouro v15.2.1 · contabilidade.html e contabilidade_v1391.html idênticos byte a byte (a41642fb…, ea73d20b…)', md5(fs.readFileSync(path.join(raiz, 'public/contabilidade.html'))).startsWith('a41642fb') && md5(fs.readFileSync(path.join(raiz, 'public/contabilidade_v1391.html'))).startsWith('ea73d20b'));
  chk('v15.2.2 · no fcx.html a importação nova, o quadro de conflito e o diagnóstico existem (atrás de fcxLeitor1522, sem flag) e o leitor simples (importSaidasLegado) segue lá só para planilha que não é baixa do ERP', /v1521:true/.test(fcx) && /id="sobreposicao152"/.test(fcx) && /_diag1521/.test(fcx) && /function importSaidasLegado\(file\)/.test(fcx));
}

if (globalThis.__pool152) await globalThis.__pool152.end();
console.log(`\n${OK.length} ok · ${FAIL.length} falha(s) · ${PULOU.length} pulado(s)`);
if (FAIL.length) { console.log('FALHAS:\n - ' + FAIL.join('\n - ')); process.exit(1); }
