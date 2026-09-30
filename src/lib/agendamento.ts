// Agendamento de envio por monitor (migração 20260930180520_agendamento_monitores.sql).
// dias_semana: 0 = domingo … 6 = sábado; horarios: 'HH:MM' só :00 ou :30; tudo no horário de Brasília.

import { FUSO } from "@/lib/format";

export const DIAS_SEMANA = [
  { valor: 0, nome: "Domingo", abrev: "Dom", letra: "D" },
  { valor: 1, nome: "Segunda-feira", abrev: "Seg", letra: "S" },
  { valor: 2, nome: "Terça-feira", abrev: "Ter", letra: "T" },
  { valor: 3, nome: "Quarta-feira", abrev: "Qua", letra: "Q" },
  { valor: 4, nome: "Quinta-feira", abrev: "Qui", letra: "Q" },
  { valor: 5, nome: "Sexta-feira", abrev: "Sex", letra: "S" },
  { valor: 6, nome: "Sábado", abrev: "Sáb", letra: "S" },
] as const;

export const DIAS_UTEIS = [1, 2, 3, 4, 5];
export const TODOS_OS_DIAS = [0, 1, 2, 3, 4, 5, 6];

/** 00:00, 00:30, … 23:30 (o cron roda a cada 30 min). */
export const OPCOES_HORARIO: string[] = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, "0");
  return `${h}:${i % 2 ? "30" : "00"}`;
});

export const REGEX_HORARIO = /^([01]\d|2[0-3]):(00|30)$/;

export type ModoDias = "uteis" | "todos" | "personalizado";

/** Ordena, remove duplicados e valores fora de 0–6. */
export function normalizarDias(dias: readonly number[] | null | undefined): number[] {
  return Array.from(new Set((dias ?? []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))).sort(
    (a, b) => a - b,
  );
}

/** Ordena, remove duplicados e horários inválidos. */
export function normalizarHorarios(horarios: readonly string[] | null | undefined): string[] {
  return Array.from(new Set((horarios ?? []).map((h) => h.trim()).filter((h) => REGEX_HORARIO.test(h)))).sort();
}

function mesmosDias(a: readonly number[], b: readonly number[]) {
  const na = normalizarDias(a);
  return na.length === b.length && na.every((d, i) => d === b[i]);
}

export function modoDosDias(dias: readonly number[]): ModoDias {
  if (mesmosDias(dias, DIAS_UTEIS)) return "uteis";
  if (mesmosDias(dias, TODOS_OS_DIAS)) return "todos";
  return "personalizado";
}

/** Junta itens como "a, b e c". */
export function juntarLista(itens: readonly string[]) {
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

/** Rótulo curto dos dias para listagens: "Dias úteis", "Todos os dias", "Sáb, Dom", "Seg, Qua, Sex". */
export function rotuloDias(dias: readonly number[]) {
  const n = normalizarDias(dias);
  const modo = modoDosDias(n);
  if (modo === "uteis") return "Dias úteis";
  if (modo === "todos") return "Todos os dias";
  if (!n.length) return "Nenhum dia";
  // Semana começando na segunda (domingo por último) fica mais natural na leitura.
  const ordem = [...n.filter((d) => d !== 0), ...n.filter((d) => d === 0)];
  return ordem.map((d) => DIAS_SEMANA[d].abrev).join(", ");
}

/** Dias em forma de frase para o texto-resumo: "Seg a sex", "Todos os dias", "Seg, Qua e Sex". */
export function fraseDias(dias: readonly number[]) {
  const n = normalizarDias(dias);
  const modo = modoDosDias(n);
  if (modo === "uteis") return "Seg a sex";
  if (modo === "todos") return "Todos os dias";
  const ordem = [...n.filter((d) => d !== 0), ...n.filter((d) => d === 0)];
  return juntarLista(ordem.map((d) => DIAS_SEMANA[d].abrev));
}

/** "Dias úteis · assim que publicar" / "Seg, Qua, Sex · 08:00, 17:30". */
export function resumoAgendamento(m: { dias_semana: readonly number[] | null; horarios: readonly string[] | null }) {
  const dias = rotuloDias(m.dias_semana?.length ? m.dias_semana : DIAS_UTEIS);
  const horarios = normalizarHorarios(m.horarios);
  return `${dias} · ${horarios.length ? horarios.join(", ") : "assim que publicar"}`;
}

// ---------------------------------------------------------------------------
// Próximo envio (horário de Brasília)
// ---------------------------------------------------------------------------

const fmtPartes = new Intl.DateTimeFormat("en-US", {
  timeZone: FUSO,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
  hourCycle: "h23",
});

/** Data/hora de parede em Brasília para um instante. */
function paredeBrasilia(instante: number) {
  const p: Record<string, number> = {};
  for (const { type, value } of fmtPartes.formatToParts(new Date(instante))) {
    if (type !== "literal") p[type] = Number(value);
  }
  return { ano: p.year, mes: p.month, dia: p.day, hora: p.hour % 24, minuto: p.minute, segundo: p.second };
}

/** Instante (ms) correspondente a uma data/hora de parede em Brasília. */
function instanteDeParede(ano: number, mes: number, dia: number, hora: number, minuto: number) {
  const comoUtc = Date.UTC(ano, mes - 1, dia, hora, minuto);
  // Diferença entre a parede em Brasília e UTC nesse instante (hoje -3 h, sem horário de verão).
  const w = paredeBrasilia(comoUtc);
  const offset = Date.UTC(w.ano, w.mes - 1, w.dia, w.hora, w.minuto, w.segundo) - comoUtc;
  return comoUtc - offset;
}

export interface ProximoEnvio {
  /** Instante do horário agendado. */
  instante: number;
  /**
   * true = o horário já passou e ainda não foi processado: sai na próxima execução
   * automática (até ~30 min).
   */
  pendente: boolean;
}

/**
 * Próximo envio de um monitor com horários fixos, calculado no cliente.
 * Regra do motor: nos dias escolhidos, roda uma vez por horário, na primeira execução em que
 * hora_atual >= horário; ultimo_envio_agendado guarda o último horário já processado.
 */
export function proximoEnvio(
  m: { dias_semana: readonly number[] | null; horarios: readonly string[] | null; ultimo_envio_agendado: string | null },
  agora: number,
): ProximoEnvio | null {
  const horarios = normalizarHorarios(m.horarios);
  const dias = normalizarDias(m.dias_semana?.length ? m.dias_semana : DIAS_UTEIS);
  if (!horarios.length || !dias.length) return null;

  const ultimo = m.ultimo_envio_agendado ? new Date(m.ultimo_envio_agendado).getTime() : Number.NaN;
  const hoje = paredeBrasilia(agora);
  const base = Date.UTC(hoje.ano, hoje.mes - 1, hoje.dia);

  for (let i = 0; i <= 7; i++) {
    const d = new Date(base + i * 86_400_000);
    if (!dias.includes(d.getUTCDay())) continue;
    const slots = horarios.map((h) => {
      const [hh, mm] = h.split(":").map(Number);
      return instanteDeParede(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hh, mm);
    });
    if (i === 0) {
      // Último horário de hoje que já passou: se ainda não foi processado, sai na próxima execução.
      const passados = slots.filter((s) => s <= agora);
      const ultimoPassado = passados[passados.length - 1];
      if (ultimoPassado !== undefined && (Number.isNaN(ultimo) || ultimo < ultimoPassado)) {
        return { instante: ultimoPassado, pendente: true };
      }
    }
    const futuro = slots.find((s) => s > agora);
    if (futuro !== undefined) return { instante: futuro, pendente: false };
  }
  return null;
}

/** "17:30" no horário de Brasília. */
export function horaBrasilia(instante: number) {
  const w = paredeBrasilia(instante);
  return `${String(w.hora).padStart(2, "0")}:${String(w.minuto).padStart(2, "0")}`;
}

/** "hoje às 17:30", "amanhã às 08:00", "Seg, 05/10 às 08:00". */
export function descreverInstante(instante: number, agora: number) {
  const w = paredeBrasilia(instante);
  const h = paredeBrasilia(agora);
  const hora = horaBrasilia(instante);
  const diaAlvo = Date.UTC(w.ano, w.mes - 1, w.dia);
  const diff = Math.round((diaAlvo - Date.UTC(h.ano, h.mes - 1, h.dia)) / 86_400_000);
  if (diff === 0) return `hoje às ${hora}`;
  if (diff === 1) return `amanhã às ${hora}`;
  const dSemana = DIAS_SEMANA[new Date(diaAlvo).getUTCDay()].abrev;
  return `${dSemana}, ${String(w.dia).padStart(2, "0")}/${String(w.mes).padStart(2, "0")} às ${hora}`;
}
