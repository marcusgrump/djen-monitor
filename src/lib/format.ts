// Helpers de formatação (pt-BR, fuso America/Sao_Paulo)

export const FUSO = "America/Sao_Paulo";

const fmtDataHora = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const fmtDataHoraCurta = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO,
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const fmtData = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

// en-CA produz AAAA-MM-DD
const fmtIso = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const fmtNumero = new Intl.NumberFormat("pt-BR");

function paraDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Timestamp (timestamptz) → "28/09/2026 14:05" no horário de Brasília. */
export function formatarDataHora(v: string | Date | null | undefined, vazio = "—") {
  const d = paraDate(v);
  return d ? fmtDataHora.format(d) : vazio;
}

export function formatarDataHoraCurta(v: string | Date | null | undefined, vazio = "—") {
  const d = paraDate(v);
  return d ? fmtDataHoraCurta.format(d) : vazio;
}

/**
 * Data. Se vier como "AAAA-MM-DD" (coluna date), é formatada sem conversão de fuso
 * para não "voltar um dia".
 */
export function formatarData(v: string | Date | null | undefined, vazio = "—") {
  if (!v) return vazio;
  if (typeof v === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  }
  const d = paraDate(v);
  return d ? fmtData.format(d) : vazio;
}

/** Data de hoje (ou deslocada em dias) no fuso de São Paulo, formato AAAA-MM-DD. */
export function hojeISO(deslocamentoDias = 0) {
  const base = new Date(Date.now() + deslocamentoDias * 86_400_000);
  return fmtIso.format(base);
}

export function formatarNumero(n: number | null | undefined) {
  return n == null ? "—" : fmtNumero.format(n);
}

/** Tempo relativo simples ("há 5 min", "há 2 h", "há 3 dias"). */
export function tempoRelativo(v: string | Date | null | undefined, agora: number) {
  const d = paraDate(v);
  if (!d) return "—";
  const seg = Math.round((agora - d.getTime()) / 1000);
  if (seg < 0) return "agora";
  if (seg < 60) return "agora há pouco";
  const min = Math.floor(seg / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const dias = Math.floor(h / 24);
  return dias === 1 ? "há 1 dia" : `há ${dias} dias`;
}

/** Duração entre dois timestamps ("1 min 12 s"). */
export function duracao(inicio: string | null | undefined, fim: string | null | undefined) {
  const a = paraDate(inicio);
  const b = paraDate(fim);
  if (!a || !b) return "—";
  const s = Math.max(0, Math.round((b.getTime() - a.getTime()) / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m} min ${r} s` : `${m} min`;
}

export function somenteDigitos(v: string | null | undefined) {
  return (v ?? "").replace(/\D+/g, "");
}

/**
 * Máscara CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO (20 dígitos).
 * Se o valor não tiver 20 dígitos, devolve o original.
 */
export function mascararProcesso(v: string | null | undefined) {
  if (!v) return "";
  const d = somenteDigitos(v);
  if (d.length !== 20) return v;
  return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16, 20)}`;
}

/** Número do processo preferindo a máscara fornecida pela API. */
export function processoExibicao(c: {
  numero_processo_mascara?: string | null;
  numero_processo?: string | null;
}) {
  return c.numero_processo_mascara || mascararProcesso(c.numero_processo) || "—";
}

/**
 * Converte o texto da comunicação (que pode conter HTML) em texto puro.
 * Nunca injeta HTML no DOM: DOMParser apenas analisa (scripts não executam) e usamos textContent.
 */
export function htmlParaTexto(html: string | null | undefined) {
  if (!html) return "";
  const comQuebras = html
    .replace(/\r\n?/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|table|blockquote)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ");
  let texto: string;
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(comQuebras, "text/html");
    doc.querySelectorAll("script,style,noscript,template").forEach((el) => el.remove());
    texto = doc.body.textContent ?? "";
  } else {
    texto = comQuebras.replace(/<[^>]*>/g, "");
  }
  return texto
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Apenas URLs http(s) são aceitas como links externos. */
export function urlSegura(v: string | null | undefined) {
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function urlCertidao(hash: string | null | undefined) {
  if (!hash) return null;
  return `https://comunicaapi.pje.jus.br/api/v1/comunicacao/${encodeURIComponent(hash)}/certidao`;
}

export const ROTULO_MEIO: Record<string, string> = {
  D: "Diário",
  E: "Edital",
};

export function pluralizar(n: number, singular: string, plural: string) {
  return `${formatarNumero(n)} ${n === 1 ? singular : plural}`;
}
