// Transporte de e-mail via Gmail SMTP com Senha de App (nodemailer).
// Porta 465 com TLS implícito (secure: true): as Edge Functions da Supabase
// bloqueiam conexões de saída nas portas 25 e 587.
//
// Credenciais: as contas cadastradas no painel (tabela contas_envio + Senha de App no Vault,
// RPC djen_contas_envio_credenciais); sem nenhuma conta, as variáveis GMAIL_USER,
// GMAIL_APP_PASSWORD e EMAIL_FROM_NAME (opcional) viram uma conta padrão virtual.
// No Deno, "nodemailer" é mapeado para npm:nodemailer pelo deno.json da função.

import nodemailer from 'nodemailer';
import type { MensagemEmail, TransporteEmail } from './email.ts';

export interface ConfigGmail {
  usuario: string;
  senhaApp: string;
  nomeRemetente?: string;
}

type TransporterMinimo = {
  sendMail(opcoes: Record<string, unknown>): Promise<{ messageId?: string }>;
  close(): void;
};

export class TransporteGmailSmtp implements TransporteEmail {
  readonly nome: string;
  private transporter: TransporterMinimo | null = null;

  constructor(private readonly cfg: ConfigGmail) {
    this.nome = `gmail-smtp:${cfg.usuario}`;
  }

  private obterTransporter(): TransporterMinimo {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user: this.cfg.usuario, pass: this.cfg.senhaApp.replace(/\s+/g, '') },
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 30_000,
      }) as unknown as TransporterMinimo;
    }
    return this.transporter;
  }

  async enviar(msg: MensagemEmail): Promise<{ id?: string | null }> {
    const nomeRem = (this.cfg.nomeRemetente ?? 'DJEN Monitor').replace(/["\r\n]/g, '');
    const info = await this.obterTransporter().sendMail({
      from: `"${nomeRem}" <${this.cfg.usuario}>`,
      to: msg.para.join(', '),
      subject: msg.assunto,
      html: msg.html,
      text: msg.texto,
      headers: { 'X-DJEN-Monitor': '1' },
    });
    return { id: info?.messageId ?? null };
  }

  fechar(): void {
    this.transporter?.close();
    this.transporter = null;
  }
}

/** Cria o transporte a partir das variáveis de ambiente; null se não configurado. */
export function transporteGmailDoAmbiente(env: (nome: string) => string | undefined): TransporteGmailSmtp | null {
  const cfg = configGmailDoAmbiente(env);
  return cfg ? new TransporteGmailSmtp(cfg) : null;
}

function configGmailDoAmbiente(env: (nome: string) => string | undefined): ConfigGmail | null {
  const usuario = env('GMAIL_USER')?.trim();
  const senhaApp = env('GMAIL_APP_PASSWORD')?.trim();
  if (!usuario || !senhaApp) return null;
  return { usuario, senhaApp, nomeRemetente: env('EMAIL_FROM_NAME')?.trim() || undefined };
}

/** De onde vieram as credenciais: 'painel' (contas_envio + Vault) ou 'secrets' (GMAIL_* da função). */
export type OrigemCredenciais = 'painel' | 'secrets';

/** Uma conta Gmail remetente com a Senha de App (nunca registrar/logar senhaApp). */
export interface CredenciaisConta extends ConfigGmail {
  /** public.contas_envio.id; null = conta virtual dos Secrets GMAIL_* (fallback). */
  contaId: number | null;
  padrao: boolean;
  origem: OrigemCredenciais;
}

function textoOuNulo(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/**
 * Contas de envio ativas com senha: RPC djen_contas_envio_credenciais (contas_envio + Vault),
 * que devolve linhas {id, email, nome_remetente, padrao, senha_app}. Se não houver nenhuma
 * (ou a leitura falhar), usa os Secrets GMAIL_USER / GMAIL_APP_PASSWORD / EMAIL_FROM_NAME como
 * uma conta padrão virtual (contaId null). A primeira da lista devolvida é a padrão.
 */
export async function resolverContasEnvio(
  lerContas: () => Promise<unknown>,
  env: (nome: string) => string | undefined,
  log: (msg: string) => void = () => {},
): Promise<CredenciaisConta[]> {
  const contas: CredenciaisConta[] = [];
  try {
    const linhas = await lerContas();
    for (const l of Array.isArray(linhas) ? (linhas as Array<Record<string, unknown>>) : []) {
      const id = Number(l?.id);
      const usuario = textoOuNulo(l?.email);
      const senhaApp = textoOuNulo(l?.senha_app);
      if (!Number.isInteger(id) || !usuario || !senhaApp) continue;
      contas.push({
        contaId: id,
        usuario: usuario.toLowerCase(),
        senhaApp,
        nomeRemetente: textoOuNulo(l?.nome_remetente) ?? undefined,
        padrao: l?.padrao === true,
        origem: 'painel',
      });
    }
  } catch (e) {
    log(`não foi possível ler as contas de envio: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (contas.length === 0) {
    const doAmbiente = configGmailDoAmbiente(env);
    if (doAmbiente) contas.push({ ...doAmbiente, contaId: null, padrao: true, origem: 'secrets' });
  }
  // padrão primeiro; se nenhuma ativa estiver marcada como padrão, a de menor id assume
  contas.sort((a, b) => Number(b.padrao) - Number(a.padrao) || (a.contaId ?? 0) - (b.contaId ?? 0));
  if (contas.length && !contas.some((c) => c.padrao)) contas[0] = { ...contas[0], padrao: true };
  return contas;
}

export const DICA_SEM_CREDENCIAIS =
  'Adicione uma conta Gmail em Configurações → Contas de envio (e-mail do remetente e Senha de App de 16 letras).';

/** Dica em pt-BR para erros comuns de envio pelo Gmail (null se não reconhecido). */
export function dicaErroEmail(mensagem: string): string | null {
  const m = mensagem.toLowerCase();
  if (/\b535\b|badcredentials|username and password not accepted|invalid login/.test(m)) {
    return 'O Gmail recusou o usuário ou a Senha de App. Gere uma nova Senha de App em https://myaccount.google.com/apppasswords logado NA MESMA conta do remetente (exige verificação em 2 etapas) e cole só as 16 letras.';
  }
  if (/\b534\b|weblogin|please log in via your web browser|application-specific password required|app password/.test(m)) {
    return 'O Google exige uma Senha de App para este login: ative a verificação em 2 etapas na conta do remetente e gere uma Senha de App em https://myaccount.google.com/apppasswords (não use a senha normal da conta).';
  }
  if (/timeout|timed out|tempo limite|etimedout|econnrefused|econnreset|enotfound|eai_again|network|socket|connection/.test(m)) {
    return 'Não foi possível conectar ao servidor do Gmail (smtp.gmail.com:465) — tempo esgotado ou falha de rede. Tente novamente em alguns minutos.';
  }
  if (/\b55[0-3]\b|5\.1\.1|recipient|mailbox unavailable|no such user/.test(m)) {
    return 'O Gmail recusou o endereço do destinatário. Confira se o e-mail está correto.';
  }
  if (/\b421\b|\b454\b|4\.7\.0|rate limit|too many|daily user sending limit/.test(m)) {
    return 'O Gmail limitou temporariamente os envios desta conta. Aguarde um pouco (ou até amanhã, se o limite diário foi atingido) e tente de novo.';
  }
  return null;
}
