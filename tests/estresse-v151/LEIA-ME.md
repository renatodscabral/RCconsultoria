# Stress-test e OFX por conta da v15.1 (testes de navegador)

Dois roteiros no **Chromium real** (Playwright) contra o **servidor local de teste** e o **Postgres**, com a massa **fictícia** de `massa151.dump` (1,7 MB):

| Arquivo | O que faz |
|---|---|
| `../e2e-estresse-v151.mjs` | Abre a Conciliação de Cartões com **50.000 linhas de ERP, 120.000 vendas de adquirente e 55.776 lançamentos de OFX** e mede quadros e tarefas longas em: abrir, trocar o filtro, voltar, abrir o detalhe (clique real), trocar de competência e Recalcular. **Falha se algum quadro passar de 50 ms.** Com `COMPARAR=1` mede também a v14.9 (recurso desligado) no mesmo roteiro. |
| `../e2e-ofx-conta-v151.mjs` | Leitura do OFX **por conta** com a pílula "OFX: lendo conta i/N…", Creditado OFX conta a conta, 503 com nova tentativa, conta que não responde (tempo esgotado + 1 nova tentativa), recuperação pelo Recalcular. As falhas são simuladas no navegador (o servidor local não tem o limite de 10 s do Netlify). |
| `_infra.mjs` | Restaura o dump num banco **próprio** (`painel_estresse`), liga/desliga o recurso `gestao_v151`, sobe o servidor numa porta própria (8891 e 8892) e entra como Master. Não mexe no banco nem na porta dos outros testes. |

## Como rodar

Pré-requisitos: Node 20+, `psql` e `pg_restore` (PostgreSQL 13+), Playwright com o Chromium (`npm i -g playwright && npx playwright install chromium`).

```bash
export NETLIFY_DB_URL=postgres://usuario@127.0.0.1:5432/painel_teste   # só usa o servidor/credenciais; o teste cria e apaga o banco painel_estresse
node tests/e2e-estresse-v151.mjs
COMPARAR=1 node tests/e2e-estresse-v151.mjs      # com a comparação v14.9 × v15.1
node tests/e2e-ofx-conta-v151.mjs
```

Cada roteiro leva cerca de 1 a 2 minutos. Eles **não entram** na rodada dos `tests/teste-*.mjs` (Node puro) (dependem de navegador, de `pg_restore` e de uma máquina sem outra carga: medir quadros numa máquina ocupada dá falso alarme).

## Sobre a massa

- Dados **fictícios** (CNPJs e valores inventados). O Master é o CPF 529.982.247-25 com a senha `NovaSenha9X`, só dentro desse banco de teste.
- Contratos da Getnet, SafraPay e Credsystem ligados a 6 contas bancárias; ERP de 50.000 linhas; 120.000 vendas de adquirente; OFX de janeiro/2026 com 20.000 lançamentos mais 6 meses de histórico (36.000).
- A massa foi **gerada de forma determinística** e carregada pelas telas reais de importação do painel (por isso o dump reflete a gravação real, inclusive a divisão dos documentos em partes). O dump é o resultado portátil dessa carga.

## Leitura dos números

O critério é **nenhum quadro bloqueado acima de 50 ms** e **nenhuma tarefa longa** (≥ 50 ms, definição do Chrome). O relógio de quadros avança de 16,7 em 16,7 ms, então os valores possíveis são 17, 33, 50, 67 ms…: um intervalo de 50 ms (3 quadros) corresponde a uma tarefa de no máximo ~50 ms e **não** conta; o teste só marca como bloqueado o que passa de 55 ms (ou seja, 67 ms em diante). Nas medições o "pior quadro" foi 17 a 33 ms. A pré-carga do FCX (iframe + xlsx) acontece logo depois do login e fica fora da janela medida; `public/fcx.html` não foi alterado.

## Tentativas (ruído do ambiente × regressão real)

O Chromium do teste usa renderização por software e, no sandbox em que a v15.1 foi validada, divide 2 CPUs com o servidor e o Postgres. Nessas condições aparece, de vez em quando, **um único quadro de 67–83 ms** (4 a 5 vsyncs) no **primeiro desenho com dados** da tela, às vezes junto de uma tarefa de 54–62 ms: é o custo do primeiro desenho/layout (código ainda frio, ~45–50 ms) somado a uma fatia de ≤ 8 ms ou a uma coleta de lixo de 5–15 ms. Por isso o roteiro da v15.1 pode ser **repetido** (`TENTATIVAS=3` por padrão, em página nova): o teste passa se **alguma tentativa** tiver 0 quadros > 55 ms e 0 tarefas longas; as tentativas ficam impressas. **Quadro ou tarefa de 100 ms ou mais reprova de imediato** (isso nunca é ruído: a v14.9 bloqueava 400 a 1.900 ms). Use `TENTATIVAS=1` para exigir uma tentativa limpa de primeira.

A janela medida **não lê o texto da tela** (`document.body.innerText` força o layout da página inteira e inflava os quadros): o andamento vem do estado da leitura do OFX (`OfxInc.est`), e o texto só é conferido depois da janela.
