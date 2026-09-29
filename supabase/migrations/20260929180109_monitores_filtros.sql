-- DJEN Monitor — monitores com os mesmos filtros da pesquisa oficial (comunica.pje.jus.br)
--
-- Antes: um monitor tinha um único critério (tipo + valor).
-- Agora: cada filtro é uma coluna própria e todos são opcionais e combináveis,
-- exatamente como no formulário oficial. Os filtros preenchidos são enviados juntos
-- à API (GET /api/v1/comunicacao); o período é [hoje - dias_retroativos, hoje].
--
-- Mapeamento coluna → parâmetro da API:
--   texto            → texto               (mín. 5 caracteres)
--   sigla_tribunal   → siglaTribunal       (lista: GET /api/v1/comunicacao/tribunal)
--   orgao_id         → orgaoId             (lista: GET /api/v1/orgaos/{sigla}; exige tribunal)
--   orgao_nome       → (só exibição)
--   meio             → meio                ('D' Diário Eletrônico, 'E' Edital)
--   numero_processo  → numeroProcesso      (só dígitos)
--   nome_parte       → nomeParte           (mín. 4 caracteres)
--   nome_advogado    → nomeAdvogado        (mín. 4 caracteres)
--   numero_oab       → numeroOab
--   uf_oab           → ufOab
--
-- A API exige ao menos um destes: siglaTribunal, texto, nomeParte, nomeAdvogado,
-- numeroOab ou numeroProcesso (senão só aceita itensPorPagina=5). Para um monitor
-- recorrente exigimos o mesmo, garantindo consultas eficientes (100 itens/página).

alter table public.monitores
  add column texto            text,
  add column orgao_id         bigint,
  add column orgao_nome       text,
  add column meio             text,
  add column numero_processo  text,
  add column nome_parte       text,
  add column nome_advogado    text,
  add column numero_oab       text;

-- Preserva os monitores existentes (mesmo id, vínculos em monitor_comunicacoes intactos):
-- copia o critério único (tipo + valor) para a coluna de filtro correspondente.
update public.monitores set
  numero_oab      = case when tipo = 'oab'      then btrim(valor) end,
  nome_advogado   = case when tipo = 'advogado' then btrim(valor) end,
  nome_parte      = case when tipo = 'parte'    then btrim(valor) end,
  numero_processo = case when tipo = 'processo' then nullif(regexp_replace(valor, '\D', '', 'g'), '') end,
  texto           = case when tipo = 'texto'    then btrim(valor) end,
  uf_oab          = case when tipo = 'oab'      then upper(btrim(uf_oab)) end;

alter table public.monitores drop constraint if exists monitores_oab_requer_uf;
alter table public.monitores drop column if exists tipo;
alter table public.monitores drop column if exists valor;

alter table public.monitores
  add constraint monitores_meio_valido      check (meio is null or meio in ('D', 'E')),
  add constraint monitores_texto_min        check (texto is null or char_length(btrim(texto)) >= 5),
  add constraint monitores_parte_min        check (nome_parte is null or char_length(btrim(nome_parte)) >= 4),
  add constraint monitores_advogado_min     check (nome_advogado is null or char_length(btrim(nome_advogado)) >= 4),
  add constraint monitores_orgao_requer_trib check (orgao_id is null or sigla_tribunal is not null),
  add constraint monitores_uf_requer_oab    check (uf_oab is null or numero_oab is not null),
  add constraint monitores_algum_filtro     check (
    num_nonnulls(nullif(btrim(texto), ''), nullif(btrim(sigla_tribunal), ''), nullif(btrim(nome_parte), ''),
                 nullif(btrim(nome_advogado), ''), nullif(btrim(numero_oab), ''), nullif(btrim(numero_processo), '')) >= 1
  );

comment on column public.monitores.texto           is 'Teor da comunicação (parâmetro texto, mín. 5 caracteres)';
comment on column public.monitores.sigla_tribunal  is 'Instituição (parâmetro siglaTribunal)';
comment on column public.monitores.orgao_id        is 'Órgão (parâmetro orgaoId; lista em /api/v1/orgaos/{sigla})';
comment on column public.monitores.orgao_nome      is 'Nome do órgão, apenas para exibição';
comment on column public.monitores.meio            is 'D = Diário Eletrônico, E = Edital (parâmetro meio)';
comment on column public.monitores.numero_processo is 'Nº do processo, só dígitos (parâmetro numeroProcesso)';
comment on column public.monitores.nome_parte      is 'Nome da parte (parâmetro nomeParte, mín. 4 caracteres)';
comment on column public.monitores.nome_advogado   is 'Nome do advogado (parâmetro nomeAdvogado, mín. 4 caracteres)';
comment on column public.monitores.numero_oab      is 'Nº da OAB (parâmetro numeroOab)';
comment on column public.monitores.uf_oab          is 'UF da OAB (parâmetro ufOab)';
