// Edge Function "djen-sync" — sincroniza o DJEN e envia notificações por e-mail.
//
// Invocação:
//   - pg_cron (a cada 30 min, :00 e :30): header `x-cron-secret: <CRON_SECRET>`, body {"origem":"cron"}.
//     Respeita o agendamento de cada monitor (dias_semana/horarios). Se nenhum monitor estiver
//     agendado para agora, responde {status:'sucesso', execucao_id:null, mensagem:'Nenhum monitor
//     agendado para agora…'} sem gravar em sync_execucoes.
//   - painel: supabase.functions.invoke('djen-sync', { body: {origem:'manual', monitorId?, dryRun?} })
//     com o JWT do usuário logado (Authorization: Bearer ...). Ignora o agendamento.
//   - painel, teste de e-mail: body {acao:'testar_email', contaId?, destinatario?} (SOMENTE com JWT
//     de usuário; sem contaId = conta padrão). Responde sempre 200 com
//     {ok:true, conta_id, destinatario, remetente, origem_credenciais} ou
//     {ok:false, conta_id, erro, dica, remetente?, destinatario?, origem_credenciais}.
//     Registra o resultado na conta (RPC djen_registrar_teste_conta); não grava sync_execucoes.
// verify_jwt = false no config: a autorização é feita aqui.
//
// Deve rodar em sa-east-1 (IP brasileiro): o cron força com `x-region: sa-east-1` e
// `?forceFunctionRegion=sa-east-1`; no painel use `region: FunctionRegion.SaEast1`.
//
// E-mail: contas Gmail cadastradas no painel (tabela contas_envio + Senha de App no Vault, RPC
// djen_contas_envio_credenciais). Sem nenhuma conta ativa com senha, os segredos GMAIL_USER,
// GMAIL_APP_PASSWORD e EMAIL_FROM_NAME viram a conta padrão.
// Outros segredos (supabase secrets set ...): CRON_SECRET, SYNC_ORCAMENTO_MS (opcional),
// DJEN_USER_AGENT (opcional).
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e SB_REGION são injetadas pela plataforma.

import { createClient } from '@supabase/supabase-js';
import { dataHoraBrasil } from '../_shared/datas.ts';
import { ClienteDjen, descreverErro, USER_AGENT_PADRAO } from '../_shared/djen-client.ts';
import { montarEmailTeste, type RemetenteEmail } from '../_shared/email.ts';
import {
  type CredenciaisConta,
  DICA_SEM_CREDENCIAIS,
  dicaErroEmail,
  resolverContasEnvio,
  TransporteGmailSmtp,
} from '../_shared/email-gmail.ts';
import { RepositorioSupabase } from '../_shared/repositorio-supabase.ts';
import { executarSincronizacao } from '../_shared/sync.ts';
import type { OrigemSync } from '../_shared/tipos.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-region, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const EMAIL_VALIDO = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;
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

/** Um remetente (transporte SMTP reutilizado durante a execução) por conta. */
function remetenteDe(c: CredenciaisConta): RemetenteEmail {
  return {
    contaId: c.contaId,
    email: c.usuario.toLowerCase(),
    padrao: c.padrao,
    origem: c.origem,
    transporte: new TransporteGmailSmtp(c),
  };
}

/** Envia um e-mail curto de teste. Nunca lança: o resultado vai no corpo (sempre HTTP 200). */
async function testarEmail(
  contas: CredenciaisConta[],
  contaIdBruto: unknown,
  destinatarioBruto: unknown,
  registrar: (contaId: number, ok: boolean, erro: string | null) => Promise<void>,
): Promise<Record<string, unknown>> {
  let contaId: number | null = null;
  if (contaIdBruto !== undefined && contaIdBruto !== null && contaIdBruto !== '') {
    contaId = Number(contaIdBruto);
    if (!Number.isInteger(contaId) || contaId <= 0) {
      return { ok: false, conta_id: null, erro: 'contaId inválido', dica: null, origem_credenciais: null };
    }
  }
  const conta = contaId !== null ? contas.find((c) => c.contaId === contaId) : (contas.find((c) => c.padrao) ?? contas[0]);
  if (!conta) {
    return contaId !== null
      ? {
          ok: false,
          conta_id: contaId,
          erro: `Conta de envio ${contaId} não encontrada, inativa ou sem Senha de App`,
          dica: 'Confira em Configurações → Contas de envio se a conta está ativa e com a Senha de App salva.',
          origem_credenciais: null,
        }
      : { ok: false, conta_id: null, erro: 'E-mail não configurado', dica: DICA_SEM_CREDENCIAIS, origem_credenciais: null };
  }
  const remetente = conta.usuario;
  const base = { conta_id: conta.contaId, remetente, origem_credenciais: conta.origem };
  const destinatario =
    typeof destinatarioBruto === 'string' && destinatarioBruto.trim() !== ''
      ? destinatarioBruto.trim().toLowerCase()
      : remetente.toLowerCase();
  if (!EMAIL_VALIDO.test(destinatario)) {
    return {
      ok: false,
      ...base,
      erro: `Destinatário inválido: ${destinatario}`,
      dica: 'Informe um endereço de e-mail completo (ex.: nome@gmail.com).',
    };
  }
  const transporte = new TransporteGmailSmtp(conta);
  let resultado: Record<string, unknown>;
  try {
    const conteudo = montarEmailTeste({ remetente, quando: dataHoraBrasil() });
    await transporte.enviar({ para: [destinatario], ...conteudo });
    resultado = { ok: true, ...base, destinatario };
  } catch (e) {
    const erro = descreverErro(e);
    console.log(`[email] teste de envio pela conta ${remetente} falhou: ${erro}`);
    resultado = { ok: false, ...base, erro, dica: dicaErroEmail(erro), destinatario };
  } finally {
    try {
      transporte.fechar();
    } catch {
      /* ignora */
    }
  }
  if (conta.contaId !== null) {
    try {
      await registrar(conta.contaId, resultado.ok === true, resultado.ok === true ? null : String(resultado.erro ?? ''));
    } catch (e) {
      console.log(`[email] não foi possível registrar o teste da conta ${conta.contaId}: ${descreverErro(e)}`);
    }
  }
  return resultado;
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
    // fallback: segredo guardado no Vault (migration 20260928204455_cron.sql).
    // Falha transitória na leitura não pode virar 401 (o cron perderia o horário):
    // tenta até 3 vezes e, se não conseguir ler, responde 503.
    let ultimoErro: unknown = null;
    for (let tentativa = 1; tentativa <= 3 && !cronSecret; tentativa++) {
      const { data, error } = await admin.rpc('djen_cron_secret');
      if (typeof data === 'string' && data) cronSecret = data;
      else {
        ultimoErro = error ?? 'segredo vazio';
        if (tentativa < 3) await new Promise((r) => setTimeout(r, 500 * tentativa));
      }
    }
    if (!cronSecret) {
      console.error('[auth] não foi possível ler cron_secret do Vault', ultimoErro);
      return json({ erro: 'Não foi possível validar o segredo do cron (Vault indisponível); tente novamente.' }, 503);
    }
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
  let corpo: {
    origem?: unknown;
    monitorId?: unknown;
    dryRun?: unknown;
    acao?: unknown;
    contaId?: unknown;
    destinatario?: unknown;
  } = {};
  try {
    const bruto = await req.text();
    if (bruto.trim()) corpo = JSON.parse(bruto);
  } catch {
    return json({ erro: 'Corpo JSON inválido' }, 400);
  }
  if (!corpo || typeof corpo !== 'object') corpo = {};

  // Contas de envio: painel (contas_envio + Vault) ou, sem nenhuma, os Secrets GMAIL_*.
  const obterContas = () =>
    resolverContasEnvio(
      async () => {
        const { data, error } = await admin.rpc('djen_contas_envio_credenciais');
        if (error) throw new Error(error.message);
        return data;
      },
      env,
      (m) => console.log(`[email] ${m}`),
    );

  // ------------------------------------------------------- ação: testar e-mail
  if (corpo.acao !== undefined && corpo.acao !== null) {
    if (corpo.acao !== 'testar_email') return json({ erro: `Ação desconhecida: ${String(corpo.acao)}` }, 400);
    if (autorizadoPor !== 'usuario') {
      return json({ erro: 'A ação testar_email exige um usuário autenticado (JWT)' }, 403);
    }
    return json(
      await testarEmail(await obterContas(), corpo.contaId, corpo.destinatario, async (id, ok, erro) => {
        const { error } = await admin.rpc('djen_registrar_teste_conta', { p_id: id, p_ok: ok, p_erro: erro });
        if (error) throw new Error(error.message);
      }),
    );
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
    const contas = await obterContas();
    const resumo = await executarSincronizacao({
      repo,
      cliente,
      remetentes: contas.map(remetenteDe),
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
