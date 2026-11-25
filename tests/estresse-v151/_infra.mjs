/* v15.1 · infraestrutura dos testes de navegador (stress-test e OFX por conta): restaura a massa FICTÍCIA num banco próprio, sobe o servidor local numa porta própria,
   abre o painel no Chromium (Playwright) e entra como Master. Não toca no banco nem na porta dos outros testes. */
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url)), raiz = path.resolve(aqui, '..', '..');
export const MASTER = { cpf: '529.982.247-25', senha: 'NovaSenha9X' };
export const DUMP = path.join(aqui, 'massa151.dump');

export function playwright() {
  const req = createRequire(import.meta.url);
  for (const base of [() => req.resolve('playwright'), () => path.join(execFileSync('npm', ['root', '-g']).toString().trim(), 'playwright')]) {
    try { return req(base()); } catch { /* tenta o próximo */ }
  }
  throw new Error('Playwright não encontrado (npm i -g playwright ou npm i -D playwright; depois "npx playwright install chromium").');
}

/** { url, banco, parar() } — restaura o dump em "painel_estresse", liga (ou não) o recurso gestao_v151 e sobe o servidor local */
export async function ambiente({ porta = 8891, v151 = true, bancoNome = 'painel_estresse' } = {}) {
  const base = process.env.NETLIFY_DB_URL; if (!base) throw new Error('Defina NETLIFY_DB_URL (ex.: postgres://postgres@127.0.0.1:5432/painel_teste).');
  const u = new URL(base), admin = new URL(base); admin.pathname = '/postgres'; const alvo = new URL(base); alvo.pathname = '/' + bancoNome;
  const psql = (uri, ...sql) => execFileSync('psql', [uri, '-v', 'ON_ERROR_STOP=1', '-q', ...sql.flatMap(s => ['-c', s])], { stdio: ['ignore', 'pipe', 'pipe'] });
  psql(admin.href, `DROP DATABASE IF EXISTS ${bancoNome} WITH (FORCE)`, `CREATE DATABASE ${bancoNome}`);
  execFileSync('pg_restore', ['--no-owner', '-d', alvo.href, DUMP], { stdio: ['ignore', 'pipe', 'pipe'] });
  const flag = v151 ? `jsonb_build_object('gestao_v151', jsonb_build_object('versao','v15.1','ativo',true,'desde',now()::text))` : `'{}'::jsonb`;
  psql(alvo.href, `UPDATE documentos SET dados = (dados - 'gestao_v151') || ${flag} WHERE caminho='config/recursos'`);
  const srv = spawn('node', [path.join(raiz, 'tests/servidor-local.mjs'), String(porta)], { env: { ...process.env, NETLIFY_DB_URL: alvo.href }, stdio: ['ignore', 'pipe', 'pipe'], cwd: raiz });
  let log = ''; srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
  const url = `http://localhost:${porta}/`;
  for (let i = 0; i < 60; i++) { try { const r = await fetch(url); if (r.ok) break; } catch { /* ainda subindo */ } await new Promise(r => setTimeout(r, 250)); if (i === 59) throw new Error('servidor local não subiu: ' + log); }
  return { url, banco: alvo.href, host: u.host, parar() { try { srv.kill(); } catch { /* já parado */ } } };
}

/** abre uma aba, entra como Master e devolve a página (com os auxiliares __esp e __ate dentro dela) */
export async function abrirPainel(browser, url, { medirQuadros = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } }), p = await ctx.newPage(), erros = [];
  await p.route(/fonts\.g|awesomeapi|open-meteo|servicodados\.ibge/, r => r.abort());
  await p.route(/cdnjs/, r => r.abort()); /* bibliotecas externas não são necessárias para a Conciliação */
  await p.addInitScript(() => { window.__QA_SEM_TRAVA_BACKUP = true; });
  if (medirQuadros) await p.addInitScript(() => {
    window.__fr = { gaps: [], max: 0, n: 0 }; window.__lt = []; let ult = performance.now();
    /* o relógio de quadros avança de 16,7 em 16,7 ms: 3 quadros = 50,0 ms (tarefa de até ~50 ms). Só conta como BLOQUEADO o que passa de 55 ms; as tarefas longas (≥ 50 ms, definição do Chrome) são contadas à parte e têm de ser 0 */
    const tick = t => { const d = t - ult; window.__fr.n++; if (d > 55) window.__fr.gaps.push([Math.round(t), Math.round(d)]); if (d > window.__fr.max) window.__fr.max = d; ult = t; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    try { new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ entryTypes: ['longtask'] }); } catch { /* sem longtask */ }
  });
  p.on('pageerror', e => erros.push('PE ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|ERR_TUNNEL|Failed to load|net::|404|401|403|409/.test(m.text())) erros.push(m.text()); });
  p.on('dialog', d => d.dismiss().catch(() => { }));
  await p.goto(url);
  await p.evaluate(() => { window.__esp = ms => new Promise(r => setTimeout(r, ms)); window.__ate = async (f, ms = 20000) => { for (let t = 0; t < ms; t += 50) { try { if (await f()) return true; } catch { /* ainda não */ } await __esp(50); } return false; }; });
  await p.evaluate(() => __ate(() => document.querySelector('.login-form')));
  await p.fill('.login-form [name="cpf"]', MASTER.cpf); await p.fill('.login-form [name="senha"]', MASTER.senha); await p.press('.login-form [name="senha"]', 'Enter');
  await p.waitForTimeout(900);
  await p.evaluate(() => __ate(() => Sessao.ativa && Repo.prontas.has('config'), 40000));
  p.erros = erros; return p;
}

export function relatorio() {
  const OK = [], FAIL = [];
  return { OK, FAIL, chk(n, c, x = '') { (c ? OK : FAIL).push(n); console.log((c ? 'ok   ' : 'FALHA ') + n + (!c && x !== '' ? ' → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 1600) : '')); }, fim() { console.log(`\n${OK.length} ok · ${FAIL.length} falha(s)`); return FAIL.length ? 1 : 0; } };
}
