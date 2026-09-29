// Montagem dos e-mails de notificação (HTML com CSS inline, legível no Gmail, + texto puro)
// e a interface de transporte (o envio real via Gmail SMTP está em email-gmail.ts).

import { formatarDataBr } from './datas.ts';
import { DJEN_BASE_URL } from './djen-client.ts';
import { escaparHtml, htmlParaTexto, trecho, urlValida } from './texto.ts';
import type { ComunicacaoPendente } from './tipos.ts';

// ---------------------------------------------------------------------------
// Transporte (trocável: Gmail SMTP, arquivo local, API HTTP de terceiros...)
// ---------------------------------------------------------------------------

export interface MensagemEmail {
  para: string[];
  assunto: string;
  html: string;
  texto: string;
}

export interface TransporteEmail {
  /** Identificação para logs (ex.: "gmail-smtp:fulano@gmail.com") */
  readonly nome: string;
  enviar(msg: MensagemEmail): Promise<{ id?: string | null }>;
  fechar?(): Promise<void> | void;
}

// ---------------------------------------------------------------------------
// Conteúdo
// ---------------------------------------------------------------------------

export const TRECHO_MAX = 600;

export function urlCertidao(hash: string | null | undefined): string | null {
  return hash ? `${DJEN_BASE_URL}/api/v1/comunicacao/${encodeURIComponent(hash)}/certidao` : null;
}

export function textoQuantidade(n: number): string {
  return n === 1 ? '1 nova comunicação' : `${n} novas comunicações`;
}

export function montarAssunto(
  prefixo: string,
  quantidade: number,
  dataIso: string,
  parte?: { numero: number; total: number },
): string {
  const p = prefixo.trim();
  const sufixo = parte && parte.total > 1 ? ` (${parte.numero}/${parte.total})` : '';
  return `${p ? p + ' ' : ''}${textoQuantidade(quantidade)} — ${formatarDataBr(dataIso)}${sufixo}`;
}

const POLOS: Record<string, string> = {
  A: 'Polo ativo',
  P: 'Polo passivo',
  T: 'Terceiro interessado',
  D: 'Outros destinatários',
};

function corDoTipo(tipo: string | null): string {
  const t = (tipo ?? '').toLowerCase();
  if (t.startsWith('cita')) return '#dc2626';
  if (t.startsWith('intima')) return '#2563eb';
  if (t.startsWith('edital')) return '#d97706';
  if (t.startsWith('pauta')) return '#7c3aed';
  return '#64748b';
}

function partesAgrupadas(c: ComunicacaoPendente): Array<{ rotulo: string; nomes: string[] }> {
  const grupos = new Map<string, string[]>();
  for (const d of c.destinatarios ?? []) {
    const rotulo = POLOS[(d.polo ?? '').toUpperCase()] ?? 'Destinatário';
    const lista = grupos.get(rotulo) ?? [];
    if (!lista.includes(d.nome)) lista.push(d.nome);
    grupos.set(rotulo, lista);
  }
  return [...grupos.entries()].map(([rotulo, nomes]) => ({ rotulo, nomes }));
}

function limitar(nomes: string[], max: number): string[] {
  return nomes.length <= max ? nomes : [...nomes.slice(0, max), `+${nomes.length - max}`];
}

function advogadoTexto(a: { nome: string; numero_oab: string | null; uf_oab: string | null }): string {
  const oab = a.numero_oab ? ` (OAB ${a.numero_oab}${a.uf_oab ? '/' + a.uf_oab : ''})` : '';
  return `${a.nome}${oab}`;
}

/** A API devolve classes como "INVENTáRIO": se não há minúsculas ASCII, põe tudo em maiúsculas. */
function normalizarCaixa(s: string | null | undefined): string {
  if (!s) return '';
  return /[a-z]/.test(s) ? s : s.toLocaleUpperCase('pt-BR');
}

function processoDe(c: ComunicacaoPendente): string {
  return c.numero_processo_mascara ?? c.numero_processo ?? 'Processo não informado';
}

// Paleta / estilos inline reutilizados
const FONTE = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
const ROTULO = 'color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:.04em;';

function botao(href: string, rotulo: string, primario: boolean): string {
  const estilo = primario
    ? 'background:#1e3a8a;color:#ffffff;border:1px solid #1e3a8a;'
    : 'background:#ffffff;color:#1e3a8a;border:1px solid #1e3a8a;';
  return `<a href="${escaparHtml(href)}" target="_blank" style="${estilo}display:inline-block;padding:9px 16px;margin:4px 8px 0 0;border-radius:6px;font-size:14px;font-weight:600;text-decoration:none;">${escaparHtml(rotulo)}</a>`;
}

function cartaoHtml(c: ComunicacaoPendente): string {
  const cor = corDoTipo(c.tipo_comunicacao);
  const partes = partesAgrupadas(c);
  const advs = limitar((c.advogados ?? []).map(advogadoTexto), 6);
  const resumo = trecho(htmlParaTexto(c.texto), TRECHO_MAX);
  const link = urlValida(c.link);
  const certidao = urlCertidao(c.hash);
  const monitores = [...new Set((c.monitores ?? []).map((m) => m.nome))];

  const badges = [c.sigla_tribunal, c.tipo_comunicacao, c.tipo_documento, c.meio === 'E' ? 'Edital' : null]
    .filter((b, i, arr): b is string => !!b && arr.indexOf(b) === i)
    .map(
      (b, i) =>
        `<span style="display:inline-block;padding:2px 8px;margin:0 6px 4px 0;border-radius:999px;font-size:12px;font-weight:600;${
          i === 0 ? 'background:#1e3a8a;color:#ffffff;' : `background:#f1f5f9;color:${cor};`
        }">${escaparHtml(b)}</span>`,
    )
    .join('');

  const linhas: string[] = [];
  if (c.nome_classe) linhas.push(linhaInfo('Classe', escaparHtml(normalizarCaixa(c.nome_classe))));
  for (const p of partes) linhas.push(linhaInfo(p.rotulo, escaparHtml(limitar(p.nomes, 6).join('; '))));
  if (advs.length) linhas.push(linhaInfo('Advogados', escaparHtml(advs.join('; '))));

  const botoes = [link ? botao(link, 'Ver inteiro teor', true) : '', certidao ? botao(certidao, 'Certidão', !link) : '']
    .filter(Boolean)
    .join('');

  return `
<tr><td style="padding:0 0 16px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;background:#ffffff;border:1px solid #e2e8f0;border-left:4px solid ${cor};border-radius:8px;">
<tr><td style="padding:16px 18px;${FONTE}color:#0f172a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="vertical-align:top;">${badges}</td>
<td style="vertical-align:top;text-align:right;white-space:nowrap;color:#475569;font-size:13px;">${escaparHtml(formatarDataBr(c.data_disponibilizacao))}</td>
</tr></table>
<div style="font-size:17px;font-weight:700;margin:6px 0 2px 0;color:#0f172a;word-break:break-word;">${escaparHtml(processoDe(c))}</div>
${c.nome_orgao ? `<div style="font-size:14px;color:#475569;margin:0 0 8px 0;">${escaparHtml(c.nome_orgao)}</div>` : '<div style="height:8px;line-height:8px;">&nbsp;</div>'}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:14px;line-height:1.45;">${linhas.join('')}</table>
${
  resumo
    ? `<div style="margin:12px 0 4px 0;padding:10px 12px;background:#f8fafc;border-radius:6px;color:#334155;font-size:13px;line-height:1.55;word-break:break-word;">${escaparHtml(resumo)}</div>`
    : ''
}
${botoes ? `<div style="margin-top:8px;">${botoes}</div>` : ''}
${
  monitores.length
    ? `<div style="margin-top:10px;color:#94a3b8;font-size:12px;">Encontrada pelo monitor: ${escaparHtml(monitores.join(', '))}</div>`
    : ''
}
</td></tr></table>
</td></tr>`;
}

function linhaInfo(rotulo: string, valorHtml: string): string {
  return `<tr><td style="padding:2px 0;vertical-align:top;"><span style="${ROTULO}">${escaparHtml(rotulo)}</span><br><span style="color:#0f172a;">${valorHtml}</span></td></tr>`;
}

function resumoPorTribunal(cs: ComunicacaoPendente[]): string {
  const cont = new Map<string, number>();
  for (const c of cs) cont.set(c.sigla_tribunal ?? '?', (cont.get(c.sigla_tribunal ?? '?') ?? 0) + 1);
  return [...cont.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${t} (${n})`)
    .join(' · ');
}

function ordenar(cs: ComunicacaoPendente[]): ComunicacaoPendente[] {
  return [...cs].sort(
    (a, b) =>
      (b.data_disponibilizacao ?? '').localeCompare(a.data_disponibilizacao ?? '') ||
      (a.sigla_tribunal ?? '').localeCompare(b.sigla_tribunal ?? '') ||
      processoDe(a).localeCompare(processoDe(b)),
  );
}

function envelopeHtml(titulo: string, subtitulo: string, corpo: string, preheader: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>${escaparHtml(titulo)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escaparHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;width:100%;">
<tr><td style="background:#1e3a8a;border-radius:10px 10px 0 0;padding:20px 22px;${FONTE}">
<div style="color:#bfdbfe;font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;">DJEN Monitor</div>
<div style="color:#ffffff;font-size:22px;font-weight:700;margin-top:4px;">${escaparHtml(titulo)}</div>
<div style="color:#dbeafe;font-size:14px;margin-top:4px;">${escaparHtml(subtitulo)}</div>
</td></tr>
<tr><td style="background:#f1f5f9;padding:16px 0 0 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${corpo}</table>
</td></tr>
<tr><td style="padding:8px 4px 0 4px;${FONTE}color:#94a3b8;font-size:12px;line-height:1.5;text-align:center;">
Mensagem automática do DJEN Monitor com base no Diário de Justiça Eletrônico Nacional (CNJ).<br>
Este e-mail é um resumo: confira sempre o inteiro teor e a certidão da comunicação.
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

export interface OpcoesEmail {
  prefixo: string;
  /** Data de referência 'YYYY-MM-DD' (hoje em São Paulo) */
  data: string;
  parte?: { numero: number; total: number };
  /** Total de comunicações do envio inteiro (quando dividido em partes) */
  totalGeral?: number;
}

export function montarEmailComunicacoes(
  comunicacoes: ComunicacaoPendente[],
  op: OpcoesEmail,
): { assunto: string; html: string; texto: string } {
  const lista = ordenar(comunicacoes);
  const n = lista.length;
  const total = op.totalGeral ?? n;
  const assunto = montarAssunto(op.prefixo, n, op.data, op.parte);
  const titulo = textoQuantidade(n).replace(/^./, (c) => c.toUpperCase());
  const parteTxt = op.parte && op.parte.total > 1 ? ` · parte ${op.parte.numero} de ${op.parte.total} (${total} no total)` : '';
  const subtitulo = `${formatarDataBr(op.data)} · ${resumoPorTribunal(lista)}${parteTxt}`;
  const html = envelopeHtml(
    titulo,
    subtitulo,
    lista.map(cartaoHtml).join(''),
    `${titulo}: ${lista
      .slice(0, 3)
      .map((c) => `${c.sigla_tribunal ?? ''} ${processoDe(c)}`.trim())
      .join(', ')}`,
  );
  return { assunto, html, texto: montarTexto(lista, titulo, subtitulo) };
}

function montarTexto(lista: ComunicacaoPendente[], titulo: string, subtitulo: string): string {
  const blocos = lista.map((c, i) => {
    const l: string[] = [];
    l.push(`${i + 1}. ${processoDe(c)}`);
    l.push(
      `   ${[c.sigla_tribunal, c.tipo_comunicacao, c.tipo_documento, formatarDataBr(c.data_disponibilizacao)]
        .filter(Boolean)
        .join(' | ')}`,
    );
    if (c.nome_orgao) l.push(`   Órgão: ${c.nome_orgao}`);
    if (c.nome_classe) l.push(`   Classe: ${normalizarCaixa(c.nome_classe)}`);
    for (const p of partesAgrupadas(c)) l.push(`   ${p.rotulo}: ${limitar(p.nomes, 6).join('; ')}`);
    const advs = limitar((c.advogados ?? []).map(advogadoTexto), 6);
    if (advs.length) l.push(`   Advogados: ${advs.join('; ')}`);
    const resumo = trecho(htmlParaTexto(c.texto), TRECHO_MAX);
    if (resumo) l.push(`   Trecho: ${resumo}`);
    const link = urlValida(c.link);
    if (link) l.push(`   Inteiro teor: ${link}`);
    const cert = urlCertidao(c.hash);
    if (cert) l.push(`   Certidão: ${cert}`);
    const mons = [...new Set((c.monitores ?? []).map((m) => m.nome))];
    if (mons.length) l.push(`   Monitor: ${mons.join(', ')}`);
    return l.join('\n');
  });
  return [
    `DJEN Monitor — ${titulo}`,
    subtitulo,
    '',
    blocos.join('\n\n'),
    '',
    '--',
    'Mensagem automática do DJEN Monitor com base no Diário de Justiça Eletrônico Nacional (CNJ).',
    'Este e-mail é um resumo: confira sempre o inteiro teor e a certidão da comunicação.',
  ].join('\n');
}

/** E-mail diário opcional quando não há comunicações novas (configuracoes.notificar_sem_novidades). */
export function montarEmailSemNovidades(op: { prefixo: string; data: string; monitores: number }): {
  assunto: string;
  html: string;
  texto: string;
} {
  const p = op.prefixo.trim();
  const assunto = `${p ? p + ' ' : ''}Nenhuma comunicação nova — ${formatarDataBr(op.data)}`;
  const msg = `Nenhuma comunicação nova foi encontrada hoje para os ${op.monitores} monitor(es) ativo(s).`;
  const corpo = `<tr><td style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:18px;${FONTE}color:#334155;font-size:15px;">${escaparHtml(msg)}</td></tr>`;
  return {
    assunto,
    html: envelopeHtml('Sem novidades', formatarDataBr(op.data), corpo, msg),
    texto: `DJEN Monitor — Sem novidades (${formatarDataBr(op.data)})\n\n${msg}\n`,
  };
}
