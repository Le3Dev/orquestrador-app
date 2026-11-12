-- Contexto de licencas: a Licenca e a raiz do agregado; Maquina e interna a ela.
CREATE TABLE licencas (
  id                TEXT PRIMARY KEY,
  chave             TEXT NOT NULL UNIQUE,
  id_da_assinatura  TEXT NOT NULL UNIQUE,
  id_do_cliente     TEXT NOT NULL,
  email             TEXT NOT NULL,
  plano             TEXT NOT NULL CHECK (plano IN ('mensal', 'anual')),
  situacao          TEXT NOT NULL CHECK (situacao IN ('ativa', 'em-teste', 'atrasada', 'cancelada', 'expirada')),
  paga_ate          INTEGER NOT NULL,
  criada_em         INTEGER NOT NULL
);

CREATE TABLE maquinas (
  licenca_id  TEXT NOT NULL REFERENCES licencas (id) ON DELETE CASCADE,
  maquina_id  TEXT NOT NULL,
  nome        TEXT NOT NULL,
  ativada_em  INTEGER NOT NULL,
  PRIMARY KEY (licenca_id, maquina_id)
);

-- Idempotencia dos webhooks: um registro por evento do Stripe ja processado.
CREATE TABLE eventos_processados (
  id             TEXT PRIMARY KEY,
  processado_em  INTEGER NOT NULL
);