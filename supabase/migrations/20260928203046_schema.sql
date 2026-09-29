-- DJEN Monitor — esquema principal
-- Contrato compartilhado entre a Edge Function (djen-sync) e o painel (Next.js estático).

-- ---------------------------------------------------------------------------
-- Monitores: o que deve ser vigiado no DJEN
-- ---------------------------------------------------------------------------
create table public.monitores (
  id                        bigint generated always as identity primary key,
  nome                      text        not null,
  tipo                      text        not null check (tipo in ('oab', 'advogado', 'parte', 'processo', 'texto')),
  valor                     text        not null,           -- nº OAB, nome do advogado/parte, nº do processo ou texto livre
  uf_oab                    text,                           -- obrigatório quando tipo = 'oab'
  sigla_tribunal            text,                           -- filtro opcional (ex.: TJSP, TRT2)
  emails                    text[],                         -- destinatários; null = usa configuracoes.emails_padrao
  ativo                     boolean     not null default true,
  dias_retroativos          integer     not null default 3 check (dias_retroativos between 0 and 30),
  ultima_sincronizacao      timestamptz,                    -- última vez que a busca deste monitor terminou sem erro
  ultimo_erro               text,
  created_at                timestamptz not null default now(),
  constraint monitores_oab_requer_uf check (tipo <> 'oab' or uf_oab is not null)
);

-- ---------------------------------------------------------------------------
-- Comunicações recebidas da API (deduplicadas pelo id do DJEN)
-- ---------------------------------------------------------------------------
create table public.comunicacoes (
  id                        bigint generated always as identity primary key,
  djen_id                   bigint      not null unique,     -- items[].id da API
  hash                      text,                            -- items[].hash (usado no link da certidão)
  numero_comunicacao        bigint,
  data_disponibilizacao     date,
  sigla_tribunal            text,
  tipo_comunicacao          text,
  tipo_documento            text,
  nome_orgao                text,
  numero_processo           text,
  numero_processo_mascara   text,
  nome_classe               text,
  meio                      text,                            -- 'D' diário / 'E' edital
  texto                     text,
  link                      text,
  destinatarios             jsonb       not null default '[]'::jsonb,  -- [{nome, polo}]
  advogados                 jsonb       not null default '[]'::jsonb,  -- [{nome, numero_oab, uf_oab}]
  lida                      boolean     not null default false,
  notificada_em             timestamptz,                     -- null = ainda não enviada por e-mail
  created_at                timestamptz not null default now()
);

create index comunicacoes_data_idx       on public.comunicacoes (data_disponibilizacao desc);
create index comunicacoes_processo_idx   on public.comunicacoes (numero_processo);
create index comunicacoes_pendentes_idx  on public.comunicacoes (created_at) where notificada_em is null;

-- Qual monitor encontrou qual comunicação (N:N)
create table public.monitor_comunicacoes (
  monitor_id      bigint not null references public.monitores (id) on delete cascade,
  comunicacao_id  bigint not null references public.comunicacoes (id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (monitor_id, comunicacao_id)
);

create index monitor_comunicacoes_comunicacao_idx on public.monitor_comunicacoes (comunicacao_id);

-- ---------------------------------------------------------------------------
-- Histórico de execuções da sincronização
-- ---------------------------------------------------------------------------
create table public.sync_execucoes (
  id               bigint generated always as identity primary key,
  origem           text        not null check (origem in ('cron', 'manual')),
  status           text        not null default 'executando'
                               check (status in ('executando', 'sucesso', 'parcial', 'erro')),
  iniciada_em      timestamptz not null default now(),
  finalizada_em    timestamptz,
  requisicoes      integer     not null default 0,   -- chamadas feitas à API do DJEN
  encontradas      integer     not null default 0,   -- itens retornados (inclui já conhecidos)
  novas            integer     not null default 0,   -- comunicações inéditas gravadas
  emails_enviados  integer     not null default 0,
  mensagem         text,
  detalhes         jsonb       not null default '{}'::jsonb   -- por monitor: {monitor_id: {requisicoes, encontradas, novas, erro}}
);

create index sync_execucoes_iniciada_idx on public.sync_execucoes (iniciada_em desc);

-- ---------------------------------------------------------------------------
-- Configurações (chave/valor)
--   emails_padrao           : ["voce@gmail.com"]
--   assunto_prefixo         : "[DJEN]"
--   notificar_sem_novidades : false
-- ---------------------------------------------------------------------------
create table public.configuracoes (
  chave       text primary key,
  valor       jsonb not null,
  updated_at  timestamptz not null default now()
);

insert into public.configuracoes (chave, valor) values
  ('emails_padrao',           '[]'::jsonb),
  ('assunto_prefixo',         '"[DJEN]"'::jsonb),
  ('notificar_sem_novidades', 'false'::jsonb);

-- ---------------------------------------------------------------------------
-- Segurança: RLS. O painel usa usuários autenticados (cadastro público desativado);
-- a Edge Function usa a service role e ignora RLS.
-- ---------------------------------------------------------------------------
alter table public.monitores            enable row level security;
alter table public.comunicacoes         enable row level security;
alter table public.monitor_comunicacoes enable row level security;
alter table public.sync_execucoes       enable row level security;
alter table public.configuracoes        enable row level security;

create policy "autenticados_total" on public.monitores            for all to authenticated using (true) with check (true);
create policy "autenticados_total" on public.comunicacoes         for all to authenticated using (true) with check (true);
create policy "autenticados_total" on public.monitor_comunicacoes for all to authenticated using (true) with check (true);
create policy "autenticados_leitura" on public.sync_execucoes     for select to authenticated using (true);
create policy "autenticados_total" on public.configuracoes        for all to authenticated using (true) with check (true);
