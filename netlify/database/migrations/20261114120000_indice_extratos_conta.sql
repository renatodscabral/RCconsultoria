-- v15.1 · Índice parcial para ler os extratos OFX POR CONTA BANCÁRIA (e competência) sem varrer a coleção inteira (Conciliação de Cartões: 1 leitura leve por conta do contrato).
-- Migração aditiva e repetível (IF NOT EXISTS): o Netlify a aplica na publicação; o build e o botão "Executar Migrações do Banco" também podem aplicá-la. Não altera dados.
--   · dados->>'contaId' + doc_id, só para a coleção 'extratos': atende   WHERE colecao = 'extratos' AND dados->>'contaId' = ANY(...) AND doc_id > $cursor ORDER BY doc_id
--   · a leitura da coleção inteira (sem filtro) continua igual e não usa este índice.
CREATE INDEX IF NOT EXISTS idx_documentos_extratos_conta ON documentos ((dados->>'contaId'), doc_id) WHERE colecao = 'extratos';
