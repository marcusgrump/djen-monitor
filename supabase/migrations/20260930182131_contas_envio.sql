-- DJEN Monitor — várias contas Gmail de envio + destinatários por monitor + "recebem tudo"
--
-- contas_envio        : Gmails remetentes. A Senha de App de cada conta fica no Vault, no segredo
--                       'gmail_app_password:<id>' — nunca em tabela. Exatamente uma conta é a padrão.
-- monitores.conta_envio_id : por qual conta o monitor envia (null = conta padrão).
-- monitores.emails    : destinatários próprios do monitor.
-- configuracoes.emails_recebem_tudo : endereços que recebem as comunicações de TODOS os monitores.
--   (substitui 'emails_padrao', cujo valor é migrado para cá.)
-- envios              : registro por comunicação × destinatário (evita duplicar quando um dos
--                       destinatários falha e o envio é refeito). comunicacoes.notificada_em é
--                       preenchida quando todos os destinatários previstos receberam.
--
-- Regras de envio (motor): para cada comunicação pendente, destinatários = união de
-- (emails de cada monitor vinculado e processado nesta execução) ∪ emails_recebem_tudo.
-- Remetente para um destinatário = conta do primeiro monitor vinculado (menor id) que o inclui;
-- para "recebem tudo", a conta do primeiro monitor vinculado; sem conta definida → conta padrão.
-- Um e-mail por (conta remetente, destinatário), agrupando as comunicações.

-- ---------------------------------------------------------------------------
create table public.contas_envio (
  id                 bigint generated always as identity primary key,
  email              text        not null unique check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  nome_remetente     text        not null default 'DJEN Monitor',
  padrao             boolean     not null default false,
  ativo              boolean     not null default true,
  ultimo_teste_em    timestamptz,
  ultimo_teste_ok    boolean,
  ultimo_teste_erro  text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- no máximo uma conta padrão
create unique index contas_envio_uma_padrao on public.contas_envio (padrao) where padrao;

alter table public.contas_envio enable row level security;
-- leitura pelo painel; escrita apenas via RPCs abaixo (que também cuidam do Vault)
create policy "autenticados_leitura" on public.contas_envio for select to authenticated using (true);

alter table public.monitores
  add column conta_envio_id bigint references public.contas_envio (id) on delete set null;

-- ---------------------------------------------------------------------------
create table public.envios (
  comunicacao_id  bigint      not null references public.comunicacoes (id) on delete cascade,
  destinatario    text        not null,
  conta_envio_id  bigint      references public.contas_envio (id) on delete set null,
  enviado_em      timestamptz not null default now(),
  primary key (comunicacao_id, destinatario)
);

alter table public.envios enable row level security;
create policy "autenticados_leitura" on public.envios for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 'emails_padrao' → 'emails_recebem_tudo'
insert into public.configuracoes (chave, valor)
select 'emails_recebem_tudo', coalesce((select valor from public.configuracoes where chave = 'emails_padrao'), '[]'::jsonb)
on conflict (chave) do nothing;
delete from public.configuracoes where chave = 'emails_padrao';

-- ---------------------------------------------------------------------------
-- RPCs do painel (somente usuário autenticado). Senhas nunca são devolvidas.

-- Cria (p_id null) ou atualiza uma conta. p_senha_app vazia/nula mantém a senha atual
-- (obrigatória ao criar). A primeira conta criada vira padrão automaticamente.
create or replace function public.salvar_conta_envio(
  p_id bigint,
  p_email text,
  p_senha_app text default null,
  p_nome_remetente text default null,
  p_padrao boolean default null,
  p_ativo boolean default null
) returns public.contas_envio
language plpgsql security definer set search_path = ''
as $$
declare
  v_conta public.contas_envio;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_senha text := regexp_replace(coalesce(p_senha_app, ''), '\s', '', 'g');
  v_nome  text := nullif(btrim(coalesce(p_nome_remetente, '')), '');
  v_segredo text;
  v_existe uuid;
begin
  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'E-mail do remetente inválido: %', p_email using errcode = '22023';
  end if;
  if v_senha <> '' and v_senha !~ '^[A-Za-z]{16}$' then
    raise exception 'A Senha de App do Google tem 16 letras (ex.: abcd efgh ijkl mnop). Gere em https://myaccount.google.com/apppasswords.'
      using errcode = '22023';
  end if;

  if p_id is null then
    if v_senha = '' then
      raise exception 'Informe a Senha de App para adicionar a conta.' using errcode = '22023';
    end if;
    insert into public.contas_envio (email, nome_remetente, ativo, padrao)
    values (v_email, coalesce(v_nome, 'DJEN Monitor'), coalesce(p_ativo, true),
            not exists (select 1 from public.contas_envio where padrao))
    returning * into v_conta;
  else
    update public.contas_envio set
      email          = v_email,
      nome_remetente = coalesce(v_nome, nome_remetente),
      ativo          = coalesce(p_ativo, ativo),
      updated_at     = now()
    where id = p_id
    returning * into v_conta;
    if v_conta.id is null then
      raise exception 'Conta de envio % não encontrada.', p_id using errcode = '22023';
    end if;
  end if;

  if v_senha <> '' then
    v_segredo := 'gmail_app_password:' || v_conta.id;
    select id into v_existe from vault.secrets where name = v_segredo;
    if v_existe is null then
      perform vault.create_secret(v_senha, v_segredo, 'Senha de App do Gmail — ' || v_conta.email);
    else
      perform vault.update_secret(v_existe, v_senha, v_segredo, 'Senha de App do Gmail — ' || v_conta.email);
    end if;
    -- senha nova invalida o resultado do último teste
    update public.contas_envio set ultimo_teste_em = null, ultimo_teste_ok = null, ultimo_teste_erro = null
    where id = v_conta.id returning * into v_conta;
  end if;

  if coalesce(p_padrao, false) then
    update public.contas_envio set padrao = false where padrao and id <> v_conta.id;
    update public.contas_envio set padrao = true where id = v_conta.id returning * into v_conta;
  end if;

  return v_conta;
end;
$$;

create or replace function public.remover_conta_envio(p_id bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_era_padrao boolean;
begin
  delete from public.contas_envio where id = p_id returning padrao into v_era_padrao;
  delete from vault.secrets where name = 'gmail_app_password:' || p_id;
  -- se a padrão foi removida, promove a conta ativa mais antiga
  if coalesce(v_era_padrao, false) then
    update public.contas_envio set padrao = true
    where id = (select id from public.contas_envio where ativo order by id limit 1);
  end if;
end;
$$;

-- Indica se cada conta tem senha guardada (sem revelar a senha).
create or replace function public.contas_envio_status()
returns table (id bigint, senha_configurada boolean)
language sql security definer set search_path = ''
as $$
  select c.id, exists (select 1 from vault.secrets s where s.name = 'gmail_app_password:' || c.id)
  from public.contas_envio c order by c.id;
$$;

-- Somente a Edge Function (service role): credenciais completas das contas ativas.
create or replace function public.djen_contas_envio_credenciais()
returns table (id bigint, email text, nome_remetente text, padrao boolean, senha_app text)
language sql security definer set search_path = ''
as $$
  select c.id, c.email, c.nome_remetente, c.padrao, s.decrypted_secret
  from public.contas_envio c
  join vault.decrypted_secrets s on s.name = 'gmail_app_password:' || c.id
  where c.ativo
  order by c.padrao desc, c.id;
$$;

-- Somente a Edge Function: registra o resultado do teste de envio de uma conta.
create or replace function public.djen_registrar_teste_conta(p_id bigint, p_ok boolean, p_erro text)
returns void
language sql security definer set search_path = ''
as $$
  update public.contas_envio
  set ultimo_teste_em = now(), ultimo_teste_ok = p_ok, ultimo_teste_erro = case when p_ok then null else p_erro end
  where id = p_id;
$$;

revoke execute on function public.salvar_conta_envio(bigint, text, text, text, boolean, boolean) from public, anon;
revoke execute on function public.remover_conta_envio(bigint)                                  from public, anon;
revoke execute on function public.contas_envio_status()                                        from public, anon;
revoke execute on function public.djen_contas_envio_credenciais()                              from public, anon, authenticated;
revoke execute on function public.djen_registrar_teste_conta(bigint, boolean, text)            from public, anon, authenticated;

grant execute on function public.salvar_conta_envio(bigint, text, text, text, boolean, boolean) to authenticated;
grant execute on function public.remover_conta_envio(bigint)                                  to authenticated;
grant execute on function public.contas_envio_status()                                        to authenticated;
grant execute on function public.djen_contas_envio_credenciais()                              to service_role;
grant execute on function public.djen_registrar_teste_conta(bigint, boolean, text)            to service_role;

-- ---------------------------------------------------------------------------
-- Migra a configuração antiga de conta única (se existir) para contas_envio.
do $$
declare
  v_user text; v_senha text; v_nome text; v_id bigint;
begin
  select decrypted_secret into v_user  from vault.decrypted_secrets where name = 'gmail_user';
  select decrypted_secret into v_senha from vault.decrypted_secrets where name = 'gmail_app_password';
  select decrypted_secret into v_nome  from vault.decrypted_secrets where name = 'email_from_name';
  if v_user is not null and v_senha is not null then
    insert into public.contas_envio (email, nome_remetente, padrao)
    values (lower(v_user), coalesce(nullif(v_nome, ''), 'DJEN Monitor'), true)
    returning id into v_id;
    perform vault.create_secret(v_senha, 'gmail_app_password:' || v_id, 'Senha de App do Gmail — ' || lower(v_user));
  end if;
  delete from vault.secrets where name in ('gmail_user', 'gmail_app_password', 'email_from_name');
end $$;

-- As RPCs de conta única deixam de existir (substituídas pelas acima).
drop function if exists public.salvar_config_gmail(text, text, text);
drop function if exists public.status_config_gmail();
drop function if exists public.remover_config_gmail();
drop function if exists public.djen_gmail_credenciais();
drop function if exists public.djen_vault_definir(text, text); -- auxiliar usada só pelas RPCs acima
