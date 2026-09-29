// Transporte de e-mail via Gmail SMTP com Senha de App (nodemailer).
// Porta 465 com TLS implícito (secure: true): as Edge Functions da Supabase
// bloqueiam conexões de saída nas portas 25 e 587.
//
// Variáveis de ambiente: GMAIL_USER, GMAIL_APP_PASSWORD, EMAIL_FROM_NAME (opcional).
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
  const usuario = env('GMAIL_USER')?.trim();
  const senhaApp = env('GMAIL_APP_PASSWORD')?.trim();
  if (!usuario || !senhaApp) return null;
  return new TransporteGmailSmtp({ usuario, senhaApp, nomeRemetente: env('EMAIL_FROM_NAME')?.trim() || undefined });
}
