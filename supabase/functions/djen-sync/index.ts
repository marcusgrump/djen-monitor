// Edge Function "djen-sync" — sincroniza o DJEN e envia notificações por e-mail.
//
// Invocação:
//   - pg_cron (a cada 30 min): header `x-cron-secret: <CRON_SECRET>`, body {"origem":"cron"}
//   - painel: supabase.functions.invoke('djen-sync', { body: {origem:'manual', monitorId?, dryRun?} })
//     com o JWT do usuário logado (Authorization: Bearer ...).
// verify_jwt = false no config: a autorização é feita aqui.
//
// Deve rodar em sa-east-1 (IP brasileiro): o cron força com `x-region: sa-east-1` e
// `?forceFunctionRegion=sa-east-1`; no painel use `region: FunctionRegion.SaEast1`.
//
// Segredos (supabase secrets set ...): CRON_SECRET, GMAIL_USER, GMAIL_APP_PASSWORD,
// EMAIL_FROM_NAME (opcional), SYNC_ORCAMENTO_MS (opcional), DJEN_USER_AGENT (opcional).
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e SB_REGION são injetadas pela plataforma.

import { createClient } from '@supabase/supabase-js';
import { ClienteDjen, descreverErro, USER_AGENT_PADRAO } from '../_shared/djen-client.ts';
import { transporteGmailDoAmbiente } from '../_shared/email-gmail.ts';
import { RepositorioSupabase } from '../_shared/repositorio-supabase.ts';
import { executarSincronizacao } from '../_shared/sync.ts';
import type { OrigemSync } from '../_shared/tipos.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-region, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const JANELA_CONCORRENCIA_MS = 10 * 60_000;
// Limite de parede da Edge Function: 150 s (Free) / 400 s (pagos). Reserva ~40 s p/ banco + e-mail.
const ORCAMENTO_PADRAO_MS = 110_000;
const RESERVA_EMAIL_MS = 25_000;

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function iguaisTempoConstante(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let dif = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) dif |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return dif === 0;
}

Deno.serve(async (req: Request) => {
  const inicio = Date.now();
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ erro: 'Método não permitido; use POST' }, 405);

  const env = (n: string) => Deno.env.get(n);
  const supabaseUrl = env('SUPABASE_URL');
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY') ?? env('SUPABASE_SECRET_KEY');
  if (!supabaseUrl || !serviceKey) return json({ erro: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes' }, 500);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // ------------------------------------------------------------ autorização
  let autorizadoPor: 'cron' | 'usuario' | null = null;
  const segredoRecebido = req.headers.get('x-cron-secret');
  let cronSecret = env('CRON_SECRET');
  if (!cronSecret && segredoRecebido) {
    // fallback: segredo guardado no Vault (migration 20260928210000_cron.sql)
    const { data } = await admin.rpc('djen_cron_secret');
    if (typeof data === 'string' && data) cronSecret = data;
  }
  if (cronSecret && segredoRecebido && iguaisTempoConstante(segredoRecebido, cronSecret)) {
    autorizadoPor = 'cron';
  } else {
    const auth = req.headers.get('authorization') ?? '';
    const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
    // só tokens de usuário (a chave anon/publishable não identifica usuário e falha aqui)
    if (token) {
      const { data, error } = await admin.auth.getUser(token);
      if (!error && data?.user) autorizadoPor = 'usuario';
    }
  }
  if (!autorizadoPor) return json({ erro: 'Não autorizado' }, 401);

  // ------------------------------------------------------------------ corpo
  let corpo: { origem?: unknown; monitorId?: unknown; dryRun?: unknown } = {};
  try {
    const bruto = await req.text();
    if (bruto.trim()) corpo = JSON.parse(bruto);
  } catch {
    return json({ erro: 'Corpo JSON inválido' }, 400);
  }
  const origem: OrigemSync =
    corpo.origem === 'cron' || corpo.origem === 'manual' ? corpo.origem : autorizadoPor === 'cron' ? 'cron' : 'manual';
  let monitorId: number | undefined;
  if (corpo.monitorId !== undefined && corpo.monitorId !== null) {
    monitorId = Number(corpo.monitorId);
    if (!Number.isInteger(monitorId) || monitorId <= 0) return json({ erro: 'monitorId inválido' }, 400);
  }
  const dryRun = corpo.dryRun === true;

  const repo = new RepositorioSupabase(admin);

  // ----------------------------------------------------- concorrência
  try {
    const limite = new Date(Date.now() - JANELA_CONCORRENCIA_MS);
    if (!dryRun) {
      await repo.encerrarExecucoesTravadas(limite, 'Execução interrompida (sem finalização após 10 min)');
      const emAndamento = await repo.execucaoEmAndamento(limite);
      if (emAndamento) {
        return json(
          { erro: 'Já existe uma sincronização em andamento', execucao_id: emAndamento.id, iniciada_em: emAndamento.iniciada_em },
          409,
        );
      }
    }
  } catch (e) {
    return json({ erro: `Falha ao verificar execuções: ${descreverErro(e)}` }, 500);
  }

  // ------------------------------------------------------------ execução
  const orcamento = Number(env('SYNC_ORCAMENTO_MS')) || ORCAMENTO_PADRAO_MS;
  const prazoEnvio = inicio + orcamento;
  const cliente = new ClienteDjen({
    prazo: prazoEnvio - RESERVA_EMAIL_MS,
    userAgent: env('DJEN_USER_AGENT') || USER_AGENT_PADRAO,
    log: (m) => console.log(`[djen] ${m}`),
  });

  try {
    const resumo = await executarSincronizacao({
      repo,
      cliente,
      transporte: transporteGmailDoAmbiente(env),
      origem,
      monitorId,
      dryRun,
      regiao: env('SB_REGION') ?? null,
      prazoEnvio,
      log: (m) => console.log(`[sync] ${m}`),
    });
    return json({ ...resumo, autorizado_por: autorizadoPor });
  } catch (e) {
    console.error('[sync] falha inesperada', e);
    return json({ erro: `Falha inesperada: ${descreverErro(e)}` }, 500);
  }
});
