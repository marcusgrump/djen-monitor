-- DJEN Monitor — agendamento da sincronização (pg_cron + pg_net)
--
-- Chama a Edge Function "djen-sync" a cada 30 minutos, forçando a execução na região
-- São Paulo (sa-east-1), pois a API do DJEN pode bloquear IPs estrangeiros.
-- Mecanismo documentado pela Supabase (guides/functions/regional-invocation):
--   header  `x-region: sa-east-1`  e/ou  query `?forceFunctionRegion=sa-east-1`.
--
-- PRÉ-REQUISITO (uma vez, no SQL Editor do projeto — NÃO versionar os valores):
--
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<mesmo valor do segredo CRON_SECRET da função>', 'cron_secret');
--
-- A função lê o cron_secret do Vault (RPC djen_cron_secret, abaixo). Opcionalmente,
-- o mesmo valor pode ser definido como segredo da função (tem prioridade):
--   npx supabase secrets set CRON_SECRET=<valor>
-- Para gerar um valor aleatório:  select encode(extensions.gen_random_bytes(32), 'hex');
-- Para trocar um segredo depois:
--   select vault.update_secret((select id from vault.secrets where name = 'cron_secret'), '<novo valor>');
--
-- Diagnóstico:
--   select * from cron.job where jobname = 'djen-sync';
--   select * from cron.job_run_details order by start_time desc limit 20;
--   select id, status_code, left(content, 500), error_msg, created
--     from net._http_response order by created desc limit 20;   -- respostas ficam ~6 h
-- Pausar / remover:
--   select cron.unschedule('djen-sync');

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- A função lê o cron_secret do Vault por esta RPC quando o segredo CRON_SECRET não
-- estiver definido nas Edge Functions. Só a service role pode executá-la.
create or replace function public.djen_cron_secret()
returns text
language sql
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1;
$$;

revoke execute on function public.djen_cron_secret() from public, anon, authenticated;
grant execute on function public.djen_cron_secret() to service_role;

grant usage on schema cron to postgres;

-- cron.schedule com um nome já existente atualiza o job (idempotente).
select cron.schedule(
  'djen-sync',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/djen-sync?forceFunctionRegion=sa-east-1',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-region', 'sa-east-1',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := jsonb_build_object('origem', 'cron'),
    -- a função responde em até ~150 s (limite de parede do plano Free)
    timeout_milliseconds := 150000
  ) as request_id;
  $$
);
