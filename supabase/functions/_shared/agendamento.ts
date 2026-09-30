// Agendamento de envio por monitor e período automático de busca.
// Contrato: supabase/migrations/20260930180520_agendamento_monitores.sql
//
// Regras (fuso America/Sao_Paulo; o cron chama a cada :00 e :30, às vezes com atraso):
//   - dias_semana: o monitor só roda (origem 'cron') nos dias escolhidos (0 = dom … 6 = sáb).
//   - horarios null/vazio: "assim que publicar" — roda em toda execução do cron nesses dias.
//   - horarios preenchidos: roda uma vez por horário, na primeira execução em que
//     agora >= hoje@H e ultimo_envio_agendado < hoje@H. Se vários horários ficaram para
//     trás, processa só o mais recente. Depois do sucesso, ultimo_envio_agendado = hoje@H.
//   - "Sincronizar agora" (origem 'manual') ignora o agendamento (tratado em sync.ts).
//   - Período de busca: desde a data (Brasília) da última sincronização bem-sucedida menos
//     1 dia de folga até hoje; sem sincronização anterior, hoje - dias_retroativos. Máx. 30 dias.
//
// Código portável (Deno e Node).

import { dataBrasil, diaSemanaBrasil, instanteBrasil, NOMES_DIAS_SEMANA, somarDias } from './datas.ts';
import type { Monitor } from './tipos.ts';

/** Padrão do banco: dias úteis (seg–sex). */
export const DIAS_SEMANA_PADRAO: readonly number[] = [1, 2, 3, 4, 5];

/** Janela máxima de busca (dias para trás a partir de hoje). */
export const MAX_DIAS_BUSCA = 30;

/**
 * Tolerância para relógio adiantado/atrasado: um horário H conta como "chegado" se
 * agora + tolerância >= H (o pg_cron dispara às HH:00/HH:30 exatos pelo relógio do banco e
 * a função pode receber a chamada alguns milissegundos "antes" pelo relógio dela).
 */
export const TOLERANCIA_HORARIO_MS = 2 * 60_000;

const RE_HORARIO = /^([01]\d|2[0-3]):([0-5]\d)$/;

export type MonitorAgendavel = Pick<Monitor, 'dias_semana' | 'horarios' | 'ultimo_envio_agendado'>;

export interface AvaliacaoAgendamento {
  /** O monitor deve ser processado nesta execução. */
  elegivel: boolean;
  /** Motivo curto (ex.: 'assim que publicar', 'horário das 08:00', 'próximo envio às 17:30'). */
  motivo: string;
  /** Horário agendado ('HH:MM') que esta execução processa; null quando não há horário fixo. */
  horario: string | null;
  /** hoje@horario em ISO UTC — gravado em ultimo_envio_agendado após o sucesso. */
  marco: string | null;
}

/** Dias válidos (0..6), sem repetição e ordenados; vazio/inválido => padrão seg–sex. */
export function normalizarDiasSemana(dias: unknown): number[] {
  const lista = Array.isArray(dias)
    ? [...new Set(dias.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
    : [];
  return lista.length ? lista : [...DIAS_SEMANA_PADRAO];
}

/** Horários 'HH:MM' válidos, sem repetição e ordenados. Vazio = "assim que publicar". */
export function normalizarHorarios(horarios: unknown): string[] {
  if (!Array.isArray(horarios)) return [];
  const validos = horarios
    .map((h) => String(h ?? '').trim())
    .map((h) => (/^\d:\d\d$/.test(h) ? `0${h}` : h))
    .filter((h) => RE_HORARIO.test(h));
  return [...new Set(validos)].sort();
}

/** "amanhã às 08:00" / "sexta-feira às 08:00" — primeiro horário do próximo dia escolhido. */
function proximoDiaEscolhido(diaHoje: number, dias: number[], primeiroHorario: string | null): string {
  for (let k = 1; k <= 7; k++) {
    const d = (diaHoje + k) % 7;
    if (!dias.includes(d)) continue;
    const quando = k === 1 ? 'amanhã' : k === 7 ? `${NOMES_DIAS_SEMANA[d]} que vem` : NOMES_DIAS_SEMANA[d];
    return primeiroHorario ? `${quando} às ${primeiroHorario}` : quando;
  }
  return 'no próximo dia escolhido';
}

/**
 * Decide se o monitor roda numa execução do cron no instante `agora`.
 * Não considera `ativo` nem a origem (quem chama filtra ativos e trata 'manual').
 */
export function avaliarAgendamento(
  m: MonitorAgendavel,
  agora: Date,
  toleranciaMs: number = TOLERANCIA_HORARIO_MS,
): AvaliacaoAgendamento {
  const hoje = dataBrasil(agora);
  const diaHoje = diaSemanaBrasil(agora);
  const dias = normalizarDiasSemana(m.dias_semana);
  const horarios = normalizarHorarios(m.horarios);

  if (!dias.includes(diaHoje)) {
    return {
      elegivel: false,
      motivo: `${NOMES_DIAS_SEMANA[diaHoje]} não está nos dias escolhidos`,
      horario: null,
      marco: null,
    };
  }

  if (horarios.length === 0) {
    return { elegivel: true, motivo: 'assim que publicar', horario: null, marco: null };
  }

  const limite = agora.getTime() + toleranciaMs;
  const devidos = horarios.filter((h) => instanteBrasil(hoje, h).getTime() <= limite);
  const proximo = horarios.find((h) => instanteBrasil(hoje, h).getTime() > limite) ?? null;

  if (devidos.length === 0) {
    return { elegivel: false, motivo: `próximo envio às ${proximo}`, horario: null, marco: null };
  }

  // Só o horário devido mais recente: vários horários atrasados geram um único envio.
  const horario = devidos[devidos.length - 1];
  const marco = instanteBrasil(hoje, horario);
  const ultimo = m.ultimo_envio_agendado ? Date.parse(m.ultimo_envio_agendado) : Number.NaN;
  if (!Number.isFinite(ultimo) || ultimo < marco.getTime()) {
    return { elegivel: true, motivo: `horário das ${horario}`, horario, marco: marco.toISOString() };
  }

  const depois = proximo
    ? `próximo envio às ${proximo}`
    : `próximo envio ${proximoDiaEscolhido(diaHoje, dias, horarios[0])}`;
  return { elegivel: false, motivo: `envio das ${horario} já feito; ${depois}`, horario: null, marco: null };
}

export interface PeriodoBusca {
  inicio: string;
  fim: string;
  /** De onde veio o início: última sincronização, janela da primeira busca, ou o limite de 30 dias. */
  base: 'ultima_sincronizacao' | 'dias_retroativos';
  limitado: boolean;
}

/**
 * Período automático de busca (datas civis de Brasília, inclusivas):
 *   início = data(ultima_sincronizacao) - 1 dia, ou hoje - dias_retroativos se nunca sincronizou;
 *   fim = hoje; início limitado a hoje - 30 dias (e nunca depois de hoje).
 */
export function periodoDeBusca(
  m: Pick<Monitor, 'dias_retroativos' | 'ultima_sincronizacao'>,
  hoje: string,
): PeriodoBusca {
  const ultima = m.ultima_sincronizacao ? new Date(m.ultima_sincronizacao) : null;
  let inicio: string;
  let base: PeriodoBusca['base'];
  if (ultima && Number.isFinite(ultima.getTime())) {
    inicio = somarDias(dataBrasil(ultima), -1);
    base = 'ultima_sincronizacao';
  } else {
    const dias = Math.max(0, Math.floor(Number(m.dias_retroativos) || 0));
    inicio = somarDias(hoje, -dias);
    base = 'dias_retroativos';
  }
  const minimo = somarDias(hoje, -MAX_DIAS_BUSCA);
  let limitado = false;
  if (inicio < minimo) {
    inicio = minimo;
    limitado = true;
  }
  if (inicio > hoje) inicio = hoje;
  return { inicio, fim: hoje, base, limitado };
}
