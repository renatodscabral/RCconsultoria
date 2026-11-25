/* Leitura e gravação de documentos com as regras de acesso aplicadas no servidor. */
import { q, tx } from './db.mjs';
import { ErroHttp } from './http.mjs';
import { NIVEL, exigido, validarCaminho, partes, ehUsuarios, lojaPodeGravar } from './regras.mjs';
import { acessoPorMatriz, exclusaoPermitida } from './permissoes.mjs';
import { podeLerSalarioDoc, salariosLiberados, ehColecaoSalarios } from './arvore-rh.mjs';
import { protegerConfigDfc } from './dfc-1413.mjs';
import { protegerAdq1414 } from './adq-1414.mjs';
import { protegerAdq1415 } from './adq-1415.mjs';

export const LIMITE_DOC = 5.5 * 1024 * 1024;   // bytes de JSON por documento
export const LIMITE_PAGINA = 3.5 * 1024 * 1024; // bytes de JSON por página de listagem (resposta da função ≤ 6 MB)
const PROTEGIDOS_USUARIO = ['perfil', 'permissoes', 'ativo', 'funcionarioId', 'escopo', 'cpf', 'nome', 'criadoEm', 'criadoPor'];

export function podeLer(sess, caminho) {
  if (!sess) return false;
  if (sess.trocaPendente) return caminho === sess.caminho;
  return sess.nivel >= exigido(caminho, 'r', sess.uid) || acessoPorMatriz(sess, caminho, 'r'); // v13.88: + coleções liberadas pela matriz
}
export function podeGravar(sess, caminho) {
  if (!sess) return false;
  if (sess.trocaPendente || (ehUsuarios(caminho) && sess.nivel < NIVEL.admin)) return caminho === sess.caminho; // só o próprio login
  return sess.nivel >= exigido(caminho, 'w', sess.uid) || acessoPorMatriz(sess, caminho, 'w'); // v13.88
}

/** Documento como o painel espera: { id, ...dados } — sem a senha para quem não é Master. */
export function saida(sess, caminho, docId, dados) {
  const d = { id: docId, ...dados };
  if (ehUsuarios(caminho) && !(sess && sess.nivel >= NIVEL.admin && !sess.trocaPendente)) delete d.senha;
  return d;
}

export function checarDoc(caminho) { if (!validarCaminho(caminho, 'doc')) throw new ErroHttp(400, 'Caminho de documento inválido.'); }
export function checarColecao(c) { if (!validarCaminho(c, 'col')) throw new ErroHttp(400, 'Caminho de coleção inválido.'); }

export async function lerDoc(sess, caminho) {
  checarDoc(caminho); if (!podeLer(sess, caminho) && !(await podeLerSalarioDoc(sess, caminho))) throw new ErroHttp(sess ? 403 : 401, sess ? 'Sem permissão para ler este registro.' : 'Faça login.'); /* v14.12: salário de quem está na árvore do gestor de topo */
  const [r] = await q('SELECT doc_id, dados FROM documentos WHERE caminho = $1', [caminho]);
  return r ? saida(sess, caminho, r.doc_id, r.dados) : null;
}

/** v15.1 · filtros ADITIVOS da listagem paginada (hoje só a coleção "extratos", para a Conciliação de Cartões ler o OFX por conta bancária em vez da coleção inteira).
 *  contaId = uma ou várias contas (separadas por vírgula, no máx. 20); mesDe / mesAte = competência AAAA-MM; maxBytes = teto de JSON da página (64 KB a 3,5 MB).
 *  Servidores antigos ignoram estes parâmetros (a resposta não traz `filtrado: true` e o painel filtra no navegador). */
export const COLECOES_FILTRAVEIS = ['extratos'];
export function filtrosLista(colecao, { contaId, mesDe, mesAte } = {}) {
  const f = { contas: null, de: null, ate: null };
  if (contaId == null && mesDe == null && mesAte == null) return null;
  if (!COLECOES_FILTRAVEIS.includes(colecao)) throw new ErroHttp(400, 'Filtro de listagem indisponível para esta coleção.');
  if (contaId != null && contaId !== '') {
    const l = String(contaId).split(',').map(x => x.trim()).filter(Boolean);
    if (!l.length || l.length > 20 || l.some(x => x.length > 160)) throw new ErroHttp(400, 'contaId inválido (de 1 a 20 contas, até 160 caracteres cada).');
    f.contas = [...new Set(l)];
  }
  for (const [k, v] of [['de', mesDe], ['ate', mesAte]]) {
    if (v == null || v === '') continue;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(v))) throw new ErroHttp(400, 'Competência inválida (use AAAA-MM).');
    f[k] = String(v);
  }
  return f;
}
/** v15.2 · filtros ADITIVOS da coleção "fcx" (o FCX guarda cada chave como um documento-meta + fatias `chave~N`): `semFatias` devolve só as metas (sem as fatias de dados) e `idPrefixos`
 *  (de 1 a 20 chaves, separadas por vírgula) devolve só os documentos cujo id começa por uma delas (a meta e as fatias dessa chave). Servidores antigos ignoram os dois parâmetros
 *  (a resposta não traz `filtrado152: true` e o painel usa a lista completa). Só leitura, mesma regra de acesso de qualquer listagem. */
export const COLECOES_FCX_152 = ['fcx'];
export function filtroFcx152(colecao, { semFatias, idPrefixos } = {}) {
  const so = semFatias === true || semFatias === '1' || semFatias === 'true', temP = idPrefixos != null && idPrefixos !== '';
  if (!so && !temP) return null;
  if (!COLECOES_FCX_152.includes(colecao)) throw new ErroHttp(400, 'Filtro de listagem indisponível para esta coleção.');
  const f = { semFatias: so, prefixos: null };
  if (temP) {
    const l = String(idPrefixos).split(',').map(x => x.trim()).filter(Boolean);
    if (!l.length || l.length > 20 || l.some(x => x.length > 160 || x.includes('~'))) throw new ErroHttp(400, 'idPrefixos inválido (de 1 a 20 chaves, até 160 caracteres cada, sem "~").');
    f.prefixos = [...new Set(l)];
  }
  return f;
}
export async function listar(sess, colecao, { ordem, dir, limite, apos, contaId, mesDe, mesAte, maxBytes, semFatias, idPrefixos } = {}) {
  checarColecao(colecao); let somente = null; /* v14.12: gestor de topo lê só os salários da própria árvore (o resto da coleção segue 403) */
  if (!podeLer(sess, colecao) || sess.trocaPendente) { if (sess && !sess.trocaPendente && ehColecaoSalarios(colecao)) somente = await salariosLiberados(sess); if (!somente) throw new ErroHttp(sess ? 403 : 401, sess ? 'Sem permissão para ler esta coleção.' : 'Faça login.'); }
  let linhas, proximo = null;
  if (ordem && limite) {
    const n = Math.min(Math.max(parseInt(limite, 10) || 1, 1), 1000), desc = String(dir).toLowerCase() === 'desc';
    linhas = await q(`SELECT doc_id, dados FROM documentos WHERE colecao = $1 ORDER BY dados -> $2 ${desc ? 'DESC NULLS LAST' : 'ASC NULLS FIRST'}, doc_id LIMIT $3`, [colecao, String(ordem), n]);
  } else {
    const filtro = filtrosLista(colecao, { contaId, mesDe, mesAte }), f152 = filtroFcx152(colecao, { semFatias, idPrefixos }), teto = Math.min(Math.max(parseInt(maxBytes, 10) || LIMITE_PAGINA, 64 * 1024), LIMITE_PAGINA);
    let sql = `SELECT doc_id, dados, octet_length(dados::text) AS tam FROM documentos WHERE colecao = $1 AND doc_id > $2`; const par = [colecao, apos || ''];
    if (filtro?.contas) { par.push(filtro.contas); sql += ` AND dados->>'contaId' = ANY($${par.length}::text[])`; }
    if (filtro?.de) { par.push(filtro.de); sql += ` AND dados->>'mes' >= $${par.length}`; }
    if (filtro?.ate) { par.push(filtro.ate); sql += ` AND dados->>'mes' <= $${par.length}`; }
    if (f152?.semFatias) sql += ` AND position('~' IN doc_id) = 0`;
    if (f152?.prefixos) { par.push(f152.prefixos); sql += ` AND EXISTS (SELECT 1 FROM unnest($${par.length}::text[]) AS p(x) WHERE starts_with(doc_id, p.x))`; }
    const brutas = await q(sql + ' ORDER BY doc_id LIMIT 500', par);
    linhas = []; let soma = 0;
    for (const r of brutas) { if (linhas.length && soma + r.tam > teto) { proximo = linhas[linhas.length - 1].doc_id; break; } soma += r.tam; linhas.push(r); }
    if (!proximo && brutas.length === 500) proximo = brutas[499].doc_id;
    if (somente) linhas = linhas.filter(r => somente.has(r.doc_id));
    return { docs: linhas.map(r => saida(sess, colecao + '/' + r.doc_id, r.doc_id, r.dados)), proximo, ...(filtro ? { filtrado: true } : {}), ...(f152 ? { filtrado152: true } : {}) };
  }
  if (somente) linhas = linhas.filter(r => somente.has(r.doc_id));
  return { docs: linhas.map(r => saida(sess, colecao + '/' + r.doc_id, r.doc_id, r.dados)), proximo };
}

/** Grava (substitui) um documento. `t` = função de consulta (dentro ou fora de transação). */
export async function gravar(t, sess, caminho, dados) {
  checarDoc(caminho);
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) throw new ErroHttp(400, 'O documento precisa ser um objeto.');
  if (!podeGravar(sess, caminho)) throw new ErroHttp(sess ? 403 : 401, sess ? 'Sem permissão para gravar este registro.' : 'Faça login.');
  let d = { ...dados }; delete d.id;
  if (sess.perfil === 'LOJA') { /* v13.83: perfil Loja só grava o que é dele */
    const [ex] = await t('SELECT dados FROM documentos WHERE caminho = $1', [caminho]);
    if (!lojaPodeGravar(sess, caminho, 'set', ex?.dados || null, d)) throw new ErroHttp(403, 'Perfil Loja: acesso somente leitura (grava só a Nova Solicitação de Viagem e as Solicitações Operacionais).');
  }
  if (ehUsuarios(caminho)) {
    const [ex] = await t('SELECT dados FROM documentos WHERE caminho = $1', [caminho]), atual = ex?.dados || null;
    if (!('senha' in d) && atual?.senha) d.senha = atual.senha; // leituras sem a senha não a apagam ao regravar
    if (sess.nivel < NIVEL.admin || sess.trocaPendente) {
      if (!atual) throw new ErroHttp(403, 'Sem permissão para criar usuários.');
      for (const k of PROTEGIDOS_USUARIO) { if (k in atual) d[k] = atual[k]; else delete d[k]; }
      const trocou = !!d.senha?.hash && d.senha.hash !== atual.senha?.hash;
      if (atual.trocarSenha && !trocou) d.trocarSenha = true; // a troca obrigatória só sai com uma senha nova
      if (sess.trocaPendente && trocou && d.trocarSenha === false) await t('UPDATE sessoes SET troca_pendente = false WHERE token_hash = $1', [sess.tokenHash]);
    }
  }
  d = await protegerConfigDfc(t, sess, caminho, d); /* v14.13: regras da DFC pétreas (config/dfc) — só com o recurso gestao_v1413 */
  d = await protegerAdq1415(t, sess, caminho, d); /* v14.15: agenda de vendas da SafraPay, ERP (Apuração dos Créditos) e lojas/ECs do contrato — só com o recurso gestao_v1415 */
  d = await protegerAdq1414(t, sess, caminho, d); /* v14.14: contrato (conta de crédito obrigatória e existente) e lote (chave = adquirente + CNPJ + competência) — só com o recurso gestao_v1414 */
  const texto = JSON.stringify(d);
  if (Buffer.byteLength(texto) > LIMITE_DOC) throw new ErroHttp(413, 'Registro grande demais (limite de 5,5 MB por documento).');
  const { colecao, docId } = partes(caminho);
  await t(`INSERT INTO documentos (caminho, colecao, doc_id, dados, atualizado_por) VALUES ($1, $2, $3, $4::jsonb, $5)
           ON CONFLICT (caminho) DO UPDATE SET dados = EXCLUDED.dados, versao = documentos.versao + 1, atualizado_em = now(), atualizado_por = EXCLUDED.atualizado_por`,
    [caminho, colecao, docId, texto, sess.uid]);
  await t('INSERT INTO mudancas (caminho, colecao, op, por) VALUES ($1, $2, $3, $4)', [caminho, colecao, 'set', sess.uid]);
}

export async function remover(t, sess, caminho) {
  checarDoc(caminho);
  if (!sess || (ehUsuarios(caminho) && sess.nivel < NIVEL.admin) || !podeGravar(sess, caminho) || !exclusaoPermitida(sess, caminho) || !lojaPodeGravar(sess, caminho, 'remove')) throw new ErroHttp(sess ? 403 : 401, sess ? 'Sem permissão para excluir este registro.' : 'Faça login.'); // v13.83: Loja não exclui
  const r = await t('DELETE FROM documentos WHERE caminho = $1 RETURNING colecao', [caminho]);
  if (r.length) await t('INSERT INTO mudancas (caminho, colecao, op, por) VALUES ($1, $2, $3, $4)', [caminho, r[0].colecao, 'remove', sess.uid]);
}

/** Lote de gravações numa transação, com SAVEPOINT por operação (uma recusa não derruba as demais).
    `permitido(op, caminho)` é uma checagem extra (ex.: política entre ambientes). */
export const MAX_OPS = 200;
export async function executarLote(sess, ops, permitido = () => true) {
  if (!Array.isArray(ops) || !ops.length || ops.length > MAX_OPS) throw new ErroHttp(400, `Envie de 1 a ${MAX_OPS} operações.`);
  return tx(async t => {
    const out = [];
    for (const o of ops) {
      await t('SAVEPOINT op');
      try {
        const caminho = String(o?.caminho || '');
        if (!['set', 'remove'].includes(o?.op)) throw new ErroHttp(400, 'Operação inválida.');
        if (!permitido(o.op, caminho)) throw new ErroHttp(403, 'Operação não permitida entre estes ambientes.');
        if (o.op === 'remove') await remover(t, sess, caminho); else await gravar(t, sess, caminho, o.dados);
        await t('RELEASE SAVEPOINT op'); out.push({ ok: true });
      } catch (e) { await t('ROLLBACK TO SAVEPOINT op'); if (!e.status) throw e; out.push({ ok: false, status: e.status, erro: e.message, ...(e.extra?.codigo ? { codigo: e.extra.codigo } : {}) }); } /* v14.13: o motivo (ex.: regras_desatualizadas) chega ao painel */
    }
    return out;
  });
}

/**
 * v14.11 · Gravação EM MASSA (importação de planilhas grandes): até MAX_MASSA documentos de UMA coleção por requisição, numa transação, com UMA instrução
 * INSERT … SELECT … FROM unnest(…) ON CONFLICT DO UPDATE (e uma linha no log de mudanças) — o lote por operação (executarLote) faz ~4 consultas por documento e
 * estouraria o tempo da Function com 2.000 registros. Upsert idempotente: reenviar o mesmo lote depois de uma falha não duplica nada.
 * Só para as coleções de COLECOES_MASSA, com a mesma regra de gravação do documento comum (podeGravar); o perfil Loja nunca grava em massa.
 */
export const MAX_MASSA = 2000;
export const LIMITE_MASSA_BYTES = 5 * 1024 * 1024;   // soma do JSON do lote (a requisição das Functions vai até 6 MB)
export const COLECOES_MASSA = new Set(['parceiros']);
export async function gravarMassa(sess, colecao, docs) {
  colecao = String(colecao || '');
  if (!sess) throw new ErroHttp(401, 'Faça login.');
  if (!COLECOES_MASSA.has(colecao)) throw new ErroHttp(400, 'A gravação em massa não está disponível para esta coleção.');
  if (!Array.isArray(docs) || !docs.length || docs.length > MAX_MASSA) throw new ErroHttp(400, `Envie de 1 a ${MAX_MASSA} registros por requisição.`);
  if (sess.perfil === 'LOJA' || !lojaPodeGravar(sess, colecao + '/_massa', 'set', null, {})) throw new ErroHttp(403, 'Perfil Loja: acesso somente leitura.');
  const caminhos = [], ids = [], textos = [], vistos = new Set(); let bytes = 0;
  for (const d of docs) {
    const id = String(d?.id ?? ''), caminho = colecao + '/' + id;
    if (!id || !validarCaminho(caminho, 'doc')) throw new ErroHttp(400, 'Identificador de registro inválido.');
    if (vistos.has(id)) throw new ErroHttp(400, 'Registro repetido no lote.');
    vistos.add(id);
    const dados = d?.dados;
    if (!dados || typeof dados !== 'object' || Array.isArray(dados)) throw new ErroHttp(400, 'Cada registro precisa ser um objeto.');
    const { id: _i, ...limpo } = dados, texto = JSON.stringify(limpo), n = Buffer.byteLength(texto);
    if (n > LIMITE_DOC) throw new ErroHttp(413, 'Registro grande demais (limite de 5,5 MB por documento).');
    bytes += n; if (bytes > LIMITE_MASSA_BYTES) throw new ErroHttp(413, 'Lote grande demais: envie menos registros por requisição.');
    caminhos.push(caminho); ids.push(id); textos.push(texto);
  }
  if (!podeGravar(sess, caminhos[0])) throw new ErroHttp(403, 'Sem permissão para gravar nesta coleção.');
  await tx(async t => {
    await t(`INSERT INTO documentos (caminho, colecao, doc_id, dados, atualizado_por)
             SELECT u.c, $1::text, u.i, u.d::jsonb, $5::text FROM unnest($2::text[], $3::text[], $4::text[]) AS u(c, i, d)
             ON CONFLICT (caminho) DO UPDATE SET dados = EXCLUDED.dados, versao = documentos.versao + 1, atualizado_em = now(), atualizado_por = EXCLUDED.atualizado_por`,
      [colecao, caminhos, ids, textos, sess.uid]);
    await t('INSERT INTO mudancas (caminho, colecao, op, por) VALUES ($1, $2, $3, $4)', [colecao + '/_massa', colecao, 'set', sess.uid]); /* uma linha por lote: o consultor de mudanças só olha a coleção */
  });
  return { gravados: caminhos.length };
}
