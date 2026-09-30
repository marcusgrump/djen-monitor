// Datas no fuso America/Sao_Paulo (o DJEN trabalha com datas civis brasileiras).
// Usa apenas Intl (disponível no Deno e no Node).

export const FUSO_BRASIL = 'America/Sao_Paulo';

const fmtData = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO_BRASIL,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const fmtHora = new Intl.DateTimeFormat('en-GB', {
  timeZone: FUSO_BRASIL,
  hour: '2-digit',
  hour12: false,
});

/** 'YYYY-MM-DD' do instante informado, no fuso de São Paulo. */
export function dataBrasil(instante: Date = new Date()): string {
  // en-CA formata como YYYY-MM-DD
  return fmtData.format(instante);
}

/** Hora (0-23) do instante no fuso de São Paulo. */
export function horaBrasil(instante: Date = new Date()): number {
  return Number(fmtHora.format(instante)) % 24;
}

/** Soma dias a uma data civil 'YYYY-MM-DD' (aritmética em UTC, sem efeito de fuso). */
export function somarDias(dataIso: string, dias: number): string {
  const [a, m, d] = dataIso.split('-').map(Number);
  const t = Date.UTC(a, m - 1, d) + dias * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Lista de datas de inicio a fim (inclusive), em ordem crescente. */
export function diasEntre(inicio: string, fim: string): string[] {
  const dias: string[] = [];
  for (let d = inicio; d <= fim; d = somarDias(d, 1)) dias.push(d);
  return dias;
}

/** 'YYYY-MM-DD' -> 'DD/MM/YYYY' */
export function formatarDataBr(dataIso: string | null | undefined): string {
  if (!dataIso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dataIso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : dataIso;
}

const fmtDataHora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO_BRASIL,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** 'DD/MM/YYYY HH:MM' do instante, no horário de Brasília. */
export function dataHoraBrasil(instante: Date = new Date()): string {
  return fmtDataHora.format(instante).replace(',', '');
}

/** Início do dia civil de São Paulo como ISO UTC (SP é UTC-3 fixo desde 2019). */
export function inicioDoDiaBrasilIso(instante: Date = new Date()): string {
  return `${dataBrasil(instante)}T03:00:00.000Z`;
}

/** Nomes dos dias da semana (0 = domingo … 6 = sábado). */
export const NOMES_DIAS_SEMANA = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
] as const;

/** Dia da semana (0 = domingo … 6 = sábado) de uma data civil 'YYYY-MM-DD'. */
export function diaSemanaDaData(dataIso: string): number {
  const [a, m, d] = dataIso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}

/** Dia da semana (0 = domingo … 6 = sábado) do instante, no fuso de São Paulo. */
export function diaSemanaBrasil(instante: Date = new Date()): number {
  return diaSemanaDaData(dataBrasil(instante));
}

/**
 * Instante correspondente a 'YYYY-MM-DD' às 'HH:MM' no horário de Brasília
 * (SP é UTC-3 fixo desde 2019, sem horário de verão).
 */
export function instanteBrasil(dataIso: string, horaMinuto: string): Date {
  return new Date(`${dataIso}T${horaMinuto}:00.000-03:00`);
}
