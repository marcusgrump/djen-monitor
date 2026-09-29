-- DJEN Monitor — configuração do Gmail pelo painel (Supabase Vault)
--
-- As credenciais de envio ficam no Vault (criptografadas), nos segredos:
--   gmail_user          e-mail do remetente (conta Gmail)
--   gmail_app_password  Senha de App do Google (16 letras, sem espaços)
--   email_from_name     nome exibido do remetente (opcional)
--
-- RPCs (PostgREST, schema public):
--   salvar_config_gmail(p_usuario, p_senha_app?, p_nome_remetente?) -> json   [authenticated]
--       p_senha_app nula/vazia mantém a senha atual; p_nome_remetente nulo mantém o atual
--       e '' remove. Retorna o mesmo que status_config_gmail().
--   status_config_gmail() -> json {usuario, nome_remetente, senha_configurada, atualizado_em} [authenticated]
--       NUNCA devolve a senha.
--   remover_config_gmail() -> void                                              [authenticated]
--   djen_gmail_credenciais() -> json {usuario, senha_app, nome_remetente}        [service_role]
--       usada pela Edge Function djen-sync (tem prioridade sobre os Secrets GMAIL_*).

-- Auxiliar interna: cria ou atualiza um segredo do Vault pelo nome.
create or replace function public.djen_vault_definir(p_nome text, p_valor text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = p_nome limit 1;
  if v_id is null then
    perform vault.create_secret(p_valor, p_nome, 'DJEN Monitor — configuração do Gmail');
  else
    perform vault.update_secret(v_id, p_valor);
  end if;
end;
$$;

revoke execute on function public.djen_vault_definir(text, text) from public, anon, authenticated, service_role;

create or replace function public.status_config_gmail()
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario text;
  v_nome text;
  v_senha text;
  v_atualizado timestamptz;
begin
  select decrypted_secret into v_usuario from vault.decrypted_secrets where name = 'gmail_user' limit 1;
  select decrypted_secret into v_nome from vault.decrypted_secrets where name = 'email_from_name' limit 1;
  select decrypted_secret into v_senha from vault.decrypted_secrets where name = 'gmail_app_password' limit 1;
  select max(updated_at) into v_atualizado
    from vault.secrets where name in ('gmail_user', 'gmail_app_password', 'email_from_name');
  return json_build_object(
    'usuario', nullif(btrim(coalesce(v_usuario, '')), ''),
    'nome_remetente', nullif(btrim(coalesce(v_nome, '')), ''),
    'senha_configurada', coalesce(btrim(v_senha), '') <> '',
    'atualizado_em', v_atualizado
  );
end;
$$;

create or replace function public.salvar_config_gmail(
  p_usuario text,
  p_senha_app text default null,
  p_nome_remetente text default null
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario text := lower(btrim(coalesce(p_usuario, '')));
  v_senha text := regexp_replace(coalesce(p_senha_app, ''), '\s', '', 'g');
  v_nome text := regexp_replace(btrim(coalesce(p_nome_remetente, '')), '["\r\n]', '', 'g');
begin
  if v_usuario !~ '^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$' then
    raise exception 'E-mail do remetente inválido: "%". Informe o endereço completo da conta Gmail (ex.: nome@gmail.com).', btrim(coalesce(p_usuario, ''))
      using errcode = '22023';
  end if;

  if v_senha <> '' and v_senha !~ '^[a-zA-Z]{16}$' then
    raise exception 'A Senha de App do Google tem 16 letras (ex.: abcd efgh ijkl mnop). Cole só essas 16 letras — não use a senha normal da conta. Gere em https://myaccount.google.com/apppasswords.'
      using errcode = '22023';
  end if;

  if char_length(v_nome) > 100 then
    raise exception 'O nome do remetente pode ter no máximo 100 caracteres.' using errcode = '22023';
  end if;

  perform public.djen_vault_definir('gmail_user', v_usuario);

  if v_senha <> '' then
    perform public.djen_vault_definir('gmail_app_password', v_senha);
  end if;

  if p_nome_remetente is not null then
    if v_nome = '' then
      delete from vault.secrets where name = 'email_from_name';
    else
      perform public.djen_vault_definir('email_from_name', v_nome);
    end if;
  end if;

  return public.status_config_gmail();
end;
$$;

create or replace function public.remover_config_gmail()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from vault.secrets where name in ('gmail_user', 'gmail_app_password', 'email_from_name');
$$;

create or replace function public.djen_gmail_credenciais()
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario text;
  v_senha text;
  v_nome text;
begin
  select decrypted_secret into v_usuario from vault.decrypted_secrets where name = 'gmail_user' limit 1;
  select decrypted_secret into v_senha from vault.decrypted_secrets where name = 'gmail_app_password' limit 1;
  select decrypted_secret into v_nome from vault.decrypted_secrets where name = 'email_from_name' limit 1;
  return json_build_object(
    'usuario', nullif(btrim(coalesce(v_usuario, '')), ''),
    'senha_app', nullif(btrim(coalesce(v_senha, '')), ''),
    'nome_remetente', nullif(btrim(coalesce(v_nome, '')), '')
  );
end;
$$;

revoke execute on function public.status_config_gmail() from public, anon, service_role;
revoke execute on function public.salvar_config_gmail(text, text, text) from public, anon, service_role;
revoke execute on function public.remover_config_gmail() from public, anon, service_role;
revoke execute on function public.djen_gmail_credenciais() from public, anon, authenticated;

grant execute on function public.status_config_gmail() to authenticated;
grant execute on function public.salvar_config_gmail(text, text, text) to authenticated;
grant execute on function public.remover_config_gmail() to authenticated;
grant execute on function public.djen_gmail_credenciais() to service_role;

comment on function public.salvar_config_gmail(text, text, text) is
  'Salva no Vault o remetente Gmail (e, se informada, a Senha de App de 16 letras). Retorna status_config_gmail().';
comment on function public.status_config_gmail() is
  'Situação da configuração do Gmail: {usuario, nome_remetente, senha_configurada, atualizado_em}. Nunca devolve a senha.';
comment on function public.remover_config_gmail() is 'Apaga do Vault as credenciais do Gmail configuradas pelo painel.';
comment on function public.djen_gmail_credenciais() is 'Credenciais do Gmail para a Edge Function djen-sync (somente service_role).';
