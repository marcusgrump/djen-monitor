// Orquestração da sincronização do DJEN Monitor.
//
// 1. Carrega configurações e monitores e decide quem roda agora:
//    - origem 'cron': só os monitores elegíveis pelo agendamento (dias_semana/horarios, ver
//      agendamento.ts). Os demais aparecem em detalhes com pulado: 'fora do agendamento' e
//      não consomem a API. Se ninguém for elegível, termina rápido SEM gravar sync_execucoes.
//    - origem 'manual' ("Sincronizar agora"): todos os ativos (ou o monitorId), ignorando o
//      agendamento e sem alterar ultimo_envio_agendado.
// 2. Registra a execução em sync_execucoes ('executando').
// 3. Para cada monitor processado (os menos recentemente sincronizados primeiro): busca na API
//    no período automático (desde a última sincronização - 1 dia; na primeira vez,
//    dias_retroativos; máx. 30 dias), grava em comunicacoes (ON CONFLICT DO NOTHING), vincula em
//    monitor_comunicacoes e atualiza ultima_sincronizacao / ultimo_erro.
// 4. Envia as comunicações pendentes (notificada_em IS NULL) vinculadas a pelo menos um monitor
//    processado nesta execução: um e-mail por (conta remetente, destinatário). Cada entrega é
//    registrada em public.envios ANTES de considerar a comunicação notificada; notificada_em só é
//    preenchida quando todos os destinatários previstos já receberam (nunca perde, não duplica).
// 5. Monitores com horário fixo: grava ultimo_envio_agendado = hoje@H se a busca e o envio do
//    monitor foram concluídos; senão a próxima execução do cron tenta de novo.
// 6. Finaliza a execução com status, contadores e detalhes por monitor.

import { type AvaliacaoAgendamento, avaliarAgendamento, periodoDeBusca } from './agendamento.ts';
import { dataBrasil, horaBrasil, inicioDoDiaBrasilIso } from './datas.ts';
import { type ClienteDjen, descreverErro } from './djen-client.ts';
import { montarEmailComunicacoes, montarEmailSemNovidades, type RemetenteEmail } from './email.ts';
import { itemParaComunicacao, resumoFiltros } from './mapeamento.ts';
import type { Repositorio } from './repositorio.ts';
import type {
  ComunicacaoPendente,
  Configuracoes,
  DetalheMonitor,
  Monitor,
  MonitorVinculado,
  OrigemSync,
} from './tipos.ts';
import { CONFIGURACOES_PADRAO } from './tipos.ts';

export interface OpcoesSync {
  repo: Repositorio;
  /** Cliente já configurado com o prazo (orçamento de tempo) da fase de busca. */
  cliente: ClienteDjen;
  /** Contas remetentes (a padrão primeiro). Vazio = e-mail não configurado (tudo fica pendente). */
  remetentes: RemetenteEmail[];
  origem: OrigemSync;
  monitorId?: number;
  /** Não grava nada no banco e não envia e-mail; consulta a API e simula o envio. */
  dryRun?: boolean;
  /** Região de execução (ex.: env SB_REGION). */
  regiao?: string | null;
  /** Após este instante (epoch ms) não inicia novos envios de e-mail (ficam para a próxima). */
  prazoEnvio?: number;
  /** Máximo de comunicações por e-mail (Gmail corta mensagens acima de ~102 KB). Padrão 20. */
  maxPorEmail?: number;
  /**
   * Máximo de e-mails por execução, somando todas as contas (evita inundar as caixas e respeita
   * o limite diário do Gmail). O excedente fica pendente para as próximas execuções. Padrão 12.
   */
  maxEmailsPorExecucao?: number;
  /** Hora (SP) a partir da qual o e-mail "sem novidades" pode ser enviado. Padrão 18. */
  horaSemNovidades?: number;
  agora?: () => Date;
  log?: (msg: string) => void;
}

/** Resultado do envio por conta remetente (detalhes._execucao.email.contas). */
export interface ResumoConta {
  conta_id: number | null;
  email: string;
  padrao: boolean;
  origem: 'painel' | 'secrets';
  enviados: number;
  falhas: string[];
}

export interface ResumoEmail {
  /** Transportes usados (ex.: "gmail-smtp:a@gmail.com, gmail-smtp:b@gmail.com"); null = sem conta. */
  transporte: string | null;
  /** Origem das credenciais da conta padrão: 'painel' (contas_envio) ou 'secrets' (GMAIL_*). */
  origem_credenciais: 'painel' | 'secrets' | null;
  /** Comunicações pendentes consideradas nesta execução (vinculadas a monitores processados). */
  pendentes: number;
  /** E-mails enviados (todas as contas). */
  enviados: number;
  /** Comunicações que tiveram notificada_em preenchida agora. */
  notificadas: number;
  /** Entregas (comunicação × destinatário) registradas em public.envios agora. */
  entregas: number;
  falhas: string[];
  sem_destinatario: number;
  /**
   * Pendentes sem nenhum monitor vinculado (ex.: monitor apagado): nunca são enviadas nem
   * bloqueiam a fila; só são contadas aqui. null = não foi possível contar.
   */
  orfas: number | null;
  contas: ResumoConta[];
  /** Só no dry-run: o que seria enviado. */
  simulacao?: { emails: number; destinatarios: number; comunicacoes: number };
}

export interface ResumoSync {
  execucao_id: number | null;
  status: 'sucesso' | 'parcial' | 'erro';
  dry_run: boolean;
  regiao: string | null;
  data_referencia: string;
  /** Monitores processados nesta execução. */
  monitores: number;
  /** Monitores pulados por estarem fora do agendamento (só origem 'cron'). */
  pulados: number;
  requisicoes: number;
  encontradas: number;
  novas: number;
  emails_enviados: number;
  mensagem: string;
  email: ResumoEmail;
  detalhes: Record<string, unknown>;
  duracao_ms: number;
}

const EMAIL_VALIDO = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

/** Endereços válidos, minúsculos, sem repetição (na ordem em que aparecem). */
function normalizarEmails(lista: readonly unknown[] | null | undefined): string[] {
  const out: string[] = [];
  for (const e of lista ?? []) {
    const n = String(e ?? '').trim().toLowerCase();
    if (EMAIL_VALIDO.test(n) && !out.includes(n)) out.push(n);
  }
  return out;
}

export async function executarSincronizacao(op: OpcoesSync): Promise<ResumoSync> {
  const agora = op.agora ?? (() => new Date());
  const log = op.log ?? (() => {});
  const t0 = Date.now();
  const dryRun = !!op.dryRun;
  const instante = agora();
  const hoje = dataBrasil(instante);
  const regiao = op.regiao ?? null;
  const respeitaAgenda = op.origem === 'cron';
  const { repo, cliente } = op;
  const remetentes = op.remetentes ?? [];

  const detalhes: Record<string, unknown> = {};
  const avisos: string[] = [];
  const email: ResumoEmail = {
    transporte: remetentes.length ? remetentes.map((r) => r.transporte.nome).join(', ') : null,
    origem_credenciais: remetentes[0]?.origem ?? null,
    pendentes: 0,
    enviados: 0,
    notificadas: 0,
    entregas: 0,
    falhas: [],
    sem_destinatario: 0,
    orfas: null,
    contas: remetentes.map((r) => ({
      conta_id: r.contaId,
      email: r.email,
      padrao: r.padrao,
      origem: r.origem,
      enviados: 0,
      falhas: [],
    })),
  };
  let encontradas = 0;
  let novas = 0;
  let falhasMonitor = 0;
  let parciais = 0;
  let pulados = 0;
  let envioIncompleto = false;
  let erroFatal: string | null = null;
  let cfg: Configuracoes = { ...CONFIGURACOES_PADRAO };
  const monitores: Monitor[] = [];
  const agenda = new Map<number, AvaliacaoAgendamento>();
  let execucaoId: number | null = null;

  const meta = () => ({
    regiao,
    dry_run: dryRun,
    origem: op.origem,
    monitor_id: op.monitorId ?? null,
    data_referencia: hoje,
    agendamento: respeitaAgenda ? 'respeitado (cron)' : 'ignorado (manual)',
    pulados,
    duracao_ms: Date.now() - t0,
    rate_limit: { limite: cliente.limiteJanela, restantes: cliente.restantesJanela },
    email,
    avisos,
  });

  // ------------------------------------------------- carga + agendamento
  let motivoUnico: string | null = null;
  try {
    cfg = await repo.obterConfiguracoes();
    const todos = await repo.listarMonitores(op.monitorId !== undefined ? { monitorId: op.monitorId } : {});
    if (op.monitorId !== undefined && todos.length === 0) {
      throw new Error(`Monitor ${op.monitorId} não encontrado`);
    }
    for (const m of todos) {
      const av: AvaliacaoAgendamento = respeitaAgenda
        ? avaliarAgendamento(m, instante)
        : { elegivel: true, motivo: 'manual (ignora o agendamento)', horario: null, marco: null };
      if (av.elegivel) {
        monitores.push(m);
        agenda.set(m.id, av);
        continue;
      }
      pulados++;
      motivoUnico = av.motivo;
      const det: DetalheMonitor = {
        nome: m.nome,
        filtros: resumoFiltros(m),
        requisicoes: 0,
        encontradas: 0,
        novas: 0,
        erro: null,
        pulado: 'fora do agendamento',
        motivo: av.motivo,
      };
      detalhes[String(m.id)] = det;
    }
    // Os menos recentemente sincronizados primeiro: se o orçamento de tempo acabar,
    // os que ficaram de fora serão os primeiros na próxima execução.
    monitores.sort(
      (a, b) => (a.ultima_sincronizacao ?? '').localeCompare(b.ultima_sincronizacao ?? '') || a.id - b.id,
    );
  } catch (e) {
    erroFatal = descreverErro(e);
    log(`erro fatal ao carregar monitores: ${erroFatal}`);
  }

  // Cron sem nenhum monitor elegível: resposta rápida, sem registro no histórico.
  if (!erroFatal && respeitaAgenda && monitores.length === 0) {
    const fora = pulados
      ? `: ${plural(pulados, 'monitor fora', 'monitores fora')} do agendamento${pulados === 1 && motivoUnico ? ` (${motivoUnico})` : ''}`
      : ' (nenhum monitor ativo)';
    const mensagem = `Nenhum monitor agendado para agora${fora}.`;
    log(mensagem);
    detalhes._execucao = meta();
    return {
      execucao_id: null,
      status: 'sucesso',
      dry_run: dryRun,
      regiao,
      data_referencia: hoje,
      monitores: 0,
      pulados,
      requisicoes: cliente.requisicoes,
      encontradas: 0,
      novas: 0,
      emails_enviados: 0,
      mensagem,
      email,
      detalhes,
      duracao_ms: Date.now() - t0,
    };
  }

  if (erroFatal) {
    // registra a falha de carga no histórico (se o banco permitir)
    if (!dryRun) execucaoId = await repo.iniciarExecucao(op.origem, { _execucao: meta() }).catch(() => null);
  } else {
    try {
      if (!dryRun) execucaoId = await repo.iniciarExecucao(op.origem, { _execucao: meta() });
      log(
        `${plural(monitores.length, 'monitor', 'monitores')} a processar` +
          (pulados ? `, ${pulados} fora do agendamento` : '') +
          `; data de referência ${hoje}`,
      );

      // ---------------------------------------------------------------- busca
      const buscaConcluida = new Set<number>();
      for (const m of monitores) {
        const av = agenda.get(m.id);
        const filtros = resumoFiltros(m);
        const periodo = periodoDeBusca(m, hoje);
        const intervalo = { inicio: periodo.inicio, fim: periodo.fim };
        if (cliente.tempoRestante() < 3_000) {
          const det: DetalheMonitor = {
            nome: m.nome,
            filtros,
            requisicoes: 0,
            encontradas: 0,
            novas: 0,
            erro: null,
            parcial: true,
            nao_processado: true,
            intervalo,
            agendamento: av?.motivo,
          };
          if (av?.horario) det.horario = av.horario;
          detalhes[String(m.id)] = det;
          parciais++;
          continue;
        }
        const r = await cliente.buscarMonitor(m, intervalo);
        const det: DetalheMonitor = {
          nome: m.nome,
          filtros,
          requisicoes: r.requisicoes,
          encontradas: r.itens.length,
          novas: 0,
          erro: r.erro,
          intervalo: r.intervalo,
          agendamento: av?.motivo,
        };
        if (av?.horario) det.horario = av.horario;
        if (r.parcial) det.parcial = true;
        if (r.subdividido) det.subdividido = true;
        if (r.truncado) det.truncado = true;
        encontradas += r.itens.length;
        log(
          `monitor #${m.id} "${m.nome}" [${filtros}] ${intervalo.inicio}..${intervalo.fim}: ${r.itens.length} item(ns) (count=${r.totalInformado}), ${r.requisicoes} req.` +
            (r.parcial ? ' [PARCIAL]' : '') +
            (r.erro ? ` [ERRO: ${r.erro}]` : ''),
        );

        try {
          const linhas = r.itens.map(itemParaComunicacao).filter((c) => Number.isFinite(c.djen_id));
          if (linhas.length) {
            if (dryRun) {
              const existentes = await repo.djenIdsExistentes(linhas.map((l) => l.djen_id));
              det.novas = linhas.filter((l) => !existentes.has(l.djen_id)).length;
            } else {
              const g = await repo.gravarComunicacoes(linhas);
              det.novas = g.novasIds.length;
              await repo.vincularMonitor(m.id, [...g.ids.values()]);
            }
          }
          novas += det.novas;

          if (!dryRun) {
            if (r.erro) {
              await repo.atualizarMonitor(m.id, { ultimo_erro: r.erro });
            } else if (!r.parcial) {
              await repo.atualizarMonitor(m.id, {
                ultima_sincronizacao: agora().toISOString(),
                ultimo_erro: r.truncado
                  ? 'Aviso: mais de 10.000 comunicações em um único dia; algumas podem ter ficado de fora. Refine o monitor (ex.: combine com tribunal, órgão ou meio).'
                  : null,
              });
            }
          }
          if (!r.erro && !r.parcial) buscaConcluida.add(m.id);
        } catch (e) {
          det.erro = `Falha ao gravar resultados: ${descreverErro(e)}`;
          if (!dryRun) {
            await repo.atualizarMonitor(m.id, { ultimo_erro: det.erro }).catch(() => {});
          }
        }

        if (det.erro) falhasMonitor++;
        else if (det.parcial) parciais++;
        detalhes[String(m.id)] = det;
      }

      if (parciais > 0) {
        avisos.push(
          `Orçamento de tempo esgotado: ${plural(parciais, 'monitor ficou', 'monitores ficaram')} incompleto(s); continua na próxima execução.`,
        );
      }
      if (falhasMonitor > 0) avisos.push(`${plural(falhasMonitor, 'monitor falhou', 'monitores falharam')}.`);

      // ----------------------------------------------------------- notificação
      const envio = await notificar(op, cfg, hoje, monitores, novas, email, avisos, log, dryRun);
      envioIncompleto = envio.incompleto;

      // ------------------------------------------------ horário agendado concluído?
      let naoConcluidos = 0;
      for (const m of monitores) {
        const av = agenda.get(m.id);
        const det = detalhes[String(m.id)] as DetalheMonitor | undefined;
        if (!av?.marco || !det || dryRun) continue;
        const ok = buscaConcluida.has(m.id) && !envio.tudoIncompleto && !envio.monitoresIncompletos.has(m.id);
        if (!ok) {
          det.horario_concluido = false;
          naoConcluidos++;
          continue;
        }
        try {
          await repo.marcarEnvioAgendado(m.id, av.marco);
          det.horario_concluido = true;
        } catch (e) {
          det.horario_concluido = false;
          naoConcluidos++;
          avisos.push(`Falha ao gravar o horário processado do monitor #${m.id}: ${descreverErro(e)}`);
        }
      }
      if (naoConcluidos > 0) {
        avisos.push(
          `Horário agendado não concluído para ${plural(naoConcluidos, 'monitor', 'monitores')}; nova tentativa na próxima execução.`,
        );
      }
    } catch (e) {
      erroFatal = descreverErro(e);
      log(`erro fatal: ${erroFatal}`);
    }
  }

  const qtd = monitores.length;
  let status: ResumoSync['status'];
  if (erroFatal) status = 'erro';
  else if (qtd > 0 && falhasMonitor === qtd) status = 'erro';
  else if (falhasMonitor > 0 || parciais > 0 || envioIncompleto || email.falhas.length > 0) status = 'parcial';
  else status = 'sucesso';

  const partes = [
    `${plural(qtd, 'monitor', 'monitores')}: ${encontradas} encontrada(s), ${novas} nova(s)`,
    ...(pulados ? [`${plural(pulados, 'monitor fora', 'monitores fora')} do agendamento`] : []),
    dryRun
      ? `modo simulação (nada gravado, nenhum e-mail enviado${email.simulacao ? `; seriam ${plural(email.simulacao.emails, 'e-mail', 'e-mails')}` : ''})`
      : `${plural(email.enviados, 'e-mail enviado', 'e-mails enviados')}`,
  ];
  const mensagem = [erroFatal ? `Erro: ${erroFatal}` : null, partes.join('; ') + '.', ...avisos]
    .filter(Boolean)
    .join(' ');

  detalhes._execucao = meta();

  if (execucaoId !== null) {
    try {
      await repo.finalizarExecucao(execucaoId, {
        status,
        requisicoes: cliente.requisicoes,
        encontradas,
        novas,
        emails_enviados: email.enviados,
        mensagem,
        detalhes,
      });
    } catch (e) {
      log(`falha ao finalizar registro da execução: ${descreverErro(e)}`);
    }
  }

  return {
    execucao_id: execucaoId,
    status,
    dry_run: dryRun,
    regiao,
    data_referencia: hoje,
    monitores: qtd,
    pulados,
    requisicoes: cliente.requisicoes,
    encontradas,
    novas,
    emails_enviados: email.enviados,
    mensagem,
    email,
    detalhes,
    duracao_ms: Date.now() - t0,
  };
}

interface ResultadoNotificacao {
  /** Envio interrompido por prazo (status 'parcial'). */
  incompleto: boolean;
  /** Havia mais pendentes do que cabem numa execução: nenhum horário é dado como concluído. */
  tudoIncompleto: boolean;
  /** Monitores processados com alguma comunicação que ficou sem entregar nesta execução. */
  monitoresIncompletos: Set<number>;
}

interface PlanoComunicacao {
  c: ComunicacaoPendente;
  /** Todos os destinatários que precisam receber antes de marcar notificada_em. */
  previstos: Set<string>;
  /** Já entregues (public.envios) antes desta execução. */
  entregues: Set<string>;
  /** Destinatários a atender NESTA execução → conta remetente. */
  alvo: Map<string, RemetenteEmail | null>;
}

/**
 * Envia as comunicações pendentes vinculadas aos monitores processados.
 *
 * Destinatários previstos de uma comunicação = emails de cada monitor vinculado que esteja
 * ativo ou processado agora ∪ emails_recebem_tudo. Nesta execução só são atendidos os que vêm
 * de monitores processados ∪ recebem tudo (monitores fora do horário recebem no horário deles),
 * menos os que já constam em public.envios. Remetente de cada destinatário = conta do primeiro
 * monitor vinculado (menor id) que o inclui; para "recebem tudo", a do primeiro monitor
 * vinculado; sem conta (ou conta inativa/sem senha) → conta padrão.
 */
async function notificar(
  op: OpcoesSync,
  cfg: Configuracoes,
  hoje: string,
  processados: Monitor[],
  novas: number,
  resumo: ResumoEmail,
  avisos: string[],
  log: (msg: string) => void,
  simular: boolean,
): Promise<ResultadoNotificacao> {
  const { repo } = op;
  const remetentes = op.remetentes ?? [];
  const agora = op.agora ?? (() => new Date());
  const maxPorEmail = Math.max(1, op.maxPorEmail ?? 20);
  const maxEmails = Math.max(1, op.maxEmailsPorExecucao ?? 12);
  const res: ResultadoNotificacao = { incompleto: false, tudoIncompleto: false, monitoresIncompletos: new Set() };
  const idsProcessados = new Set(processados.map((m) => m.id));

  try {
    resumo.orfas = await repo.contarPendentesOrfas();
  } catch (e) {
    log(`não foi possível contar as pendentes sem monitor: ${descreverErro(e)}`);
  }

  // Carrega só o que cabe nesta execução (+1 para saber se sobra algo).
  const limite = maxEmails * maxPorEmail;
  const lidas = await repo.listarPendentes(limite + 1, [...idsProcessados]);
  const sobraAlem = lidas.length > limite;
  const pendentes = sobraAlem ? lidas.slice(0, limite) : lidas;
  resumo.pendentes = pendentes.length;

  const recebemTudo = normalizarEmails(cfg.emails_recebem_tudo);
  const padrao = remetentes.find((r) => r.padrao) ?? remetentes[0] ?? null;
  const porConta = new Map<number, RemetenteEmail>();
  for (const r of remetentes) if (r.contaId !== null) porConta.set(r.contaId, r);
  const contaDe = (m: MonitorVinculado | undefined): RemetenteEmail | null =>
    (m?.conta_envio_id !== null && m?.conta_envio_id !== undefined ? porConta.get(Number(m.conta_envio_id)) : undefined) ??
    padrao;

  const jaEnviados = pendentes.length ? await repo.enviosRegistrados(pendentes.map((c) => c.id)) : new Map();

  // ------------------------------------------------------------ planejamento
  const planos: PlanoComunicacao[] = [];
  const marcarSemEnviar: number[] = []; // todos os previstos já receberam (ex.: falha ao marcar antes)
  for (const c of pendentes) {
    const vinculados = [...(c.monitores ?? [])].sort((a, b) => a.id - b.id);
    const entregues = new Set<string>(jaEnviados.get(c.id) ?? []);
    const previstos = new Set<string>(recebemTudo);
    const contaPorDest = new Map<string, RemetenteEmail | null>();
    const deProcessados = new Set<string>();
    for (const m of vinculados) {
      const processado = idsProcessados.has(m.id);
      const emails = normalizarEmails(m.emails);
      for (const e of emails) if (!contaPorDest.has(e)) contaPorDest.set(e, contaDe(m));
      if (!processado && m.ativo === false) continue;
      for (const e of emails) {
        previstos.add(e);
        if (processado) deProcessados.add(e);
      }
    }
    if (previstos.size === 0) {
      resumo.sem_destinatario++;
      continue;
    }
    if ([...previstos].every((e) => entregues.has(e))) {
      marcarSemEnviar.push(c.id);
      continue;
    }
    const alvo = new Map<string, RemetenteEmail | null>();
    for (const e of deProcessados) if (!entregues.has(e)) alvo.set(e, contaPorDest.get(e) ?? padrao);
    for (const e of recebemTudo) {
      if (!entregues.has(e) && !alvo.has(e)) alvo.set(e, contaPorDest.get(e) ?? contaDe(vinculados[0]));
    }
    planos.push({ c, previstos, entregues, alvo });
  }
  if (resumo.sem_destinatario > 0) {
    avisos.push(
      `${resumo.sem_destinatario} comunicação(ões) sem destinatário — adicione destinatários ao monitor ou em Configurações → Recebem tudo. Continuam pendentes.`,
    );
  }

  const entreguesAgora = new Map<number, Set<string>>();
  const marcarPendentesConcluidas = async () => {
    const ids = [...marcarSemEnviar];
    for (const p of planos) {
      const agoraSet = entreguesAgora.get(p.c.id);
      if ([...p.previstos].every((e) => p.entregues.has(e) || agoraSet?.has(e))) ids.push(p.c.id);
    }
    if (!ids.length || simular) return;
    try {
      await repo.marcarNotificadas(ids, agora().toISOString());
      resumo.notificadas += ids.length;
    } catch (e) {
      // as entregas já estão em public.envios: a próxima execução marca sem reenviar
      const msg = `Falha ao marcar notificada_em (será refeito na próxima execução, sem reenvio): ${descreverErro(e)}`;
      resumo.falhas.push(msg);
      avisos.push(msg);
      log(msg);
    }
  };

  const comAlvo = planos.filter((p) => p.alvo.size > 0);
  if (remetentes.length === 0 || !padrao) {
    if (comAlvo.length) {
      avisos.push(
        `E-mail não configurado (adicione uma conta Gmail em Configurações → Contas de envio): ${comAlvo.length} comunicação(ões) aguardando envio.`,
      );
    }
    await marcarPendentesConcluidas();
    return res; // sem conta não há o que tentar de novo: não bloqueia o horário agendado
  }
  if (sobraAlem) res.tudoIncompleto = true;

  const resumoConta = new Map<RemetenteEmail, ResumoConta>();
  remetentes.forEach((r, i) => resumoConta.set(r, resumo.contas[i]));

  try {
    if (pendentes.length === 0) {
      if (!simular) await talvezEnviarSemNovidades(op, cfg, hoje, processados.length, novas, padrao, recebemTudo, resumo, resumoConta, log);
      return res;
    }

    // Um e-mail por (conta, destinatário), mantendo a ordem das mais antigas.
    const grupos = new Map<string, { conta: RemetenteEmail; dest: string; itens: ComunicacaoPendente[] }>();
    for (const p of comAlvo) {
      for (const [dest, contaAlvo] of p.alvo) {
        const conta = contaAlvo ?? padrao;
        const chave = `${conta.contaId ?? 'env'}|${dest}`;
        const g = grupos.get(chave) ?? { conta, dest, itens: [] };
        g.itens.push(p.c);
        grupos.set(chave, g);
      }
    }

    if (simular) {
      const emails = [...grupos.values()].reduce((s, g) => s + Math.ceil(g.itens.length / maxPorEmail), 0);
      resumo.simulacao = {
        emails: Math.min(emails, maxEmails),
        destinatarios: new Set([...grupos.values()].map((g) => g.dest)).size,
        comunicacoes: comAlvo.length,
      };
      if (emails > maxEmails) {
        avisos.push(`Simulação: ${emails} e-mail(s) necessários; ${maxEmails} por execução, o restante ficaria para as próximas.`);
      }
      return res;
    }

    let tentativas = 0;
    let cotaEsgotada = false;
    const falhasSeguidas = new Map<RemetenteEmail, number>();
    const contasSuspensas = new Set<RemetenteEmail>();
    externo: for (const g of grupos.values()) {
      const total = Math.ceil(g.itens.length / maxPorEmail);
      for (let i = 0; i < total; i++) {
        if (contasSuspensas.has(g.conta)) continue externo;
        if (tentativas >= maxEmails) {
          cotaEsgotada = true;
          break externo;
        }
        if (op.prazoEnvio !== undefined && Date.now() > op.prazoEnvio) {
          res.incompleto = true;
          avisos.push('Tempo esgotado antes de enviar todos os e-mails; o restante segue na próxima execução.');
          break externo;
        }
        const lote = g.itens.slice(i * maxPorEmail, (i + 1) * maxPorEmail);
        const conteudo = montarEmailComunicacoes(lote, {
          prefixo: cfg.assunto_prefixo,
          data: hoje,
          parte: { numero: i + 1, total },
          totalGeral: g.itens.length,
        });
        const rc = resumoConta.get(g.conta);
        tentativas++;
        try {
          await g.conta.transporte.enviar({ para: [g.dest], ...conteudo });
        } catch (e) {
          const n = (falhasSeguidas.get(g.conta) ?? 0) + 1;
          falhasSeguidas.set(g.conta, n);
          const msg = `Falha ao enviar pela conta ${g.conta.email} para ${g.dest}: ${descreverErro(e)}`;
          resumo.falhas.push(msg);
          rc?.falhas.push(msg);
          avisos.push(msg);
          log(msg);
          if (n >= 2) {
            contasSuspensas.add(g.conta);
            avisos.push(`Envios pela conta ${g.conta.email} suspensos nesta execução após falhas seguidas; as comunicações continuam pendentes.`);
          }
          continue externo; // próximo grupo; as deste continuam pendentes
        }
        falhasSeguidas.set(g.conta, 0);
        resumo.enviados++;
        if (rc) rc.enviados++;
        log(`e-mail enviado por ${g.conta.email} para ${g.dest}: "${conteudo.assunto}"`);
        try {
          await repo.registrarEnvios(
            lote.map((c) => ({ comunicacao_id: c.id, destinatario: g.dest, conta_envio_id: g.conta.contaId })),
            agora().toISOString(),
          );
          resumo.entregas += lote.length;
          for (const c of lote) {
            const s = entreguesAgora.get(c.id) ?? new Set<string>();
            s.add(g.dest);
            entreguesAgora.set(c.id, s);
          }
        } catch (e) {
          const msg = `E-mail enviado para ${g.dest}, mas falhou ao registrar em envios (pode haver reenvio): ${descreverErro(e)}`;
          resumo.falhas.push(msg);
          rc?.falhas.push(msg);
          avisos.push(msg);
          log(msg);
        }
      }
    }

    // Quem ficou sem entregar nesta execução → o horário agendado desses monitores não conclui.
    let adiadas = 0;
    for (const p of comAlvo) {
      const agoraSet = entreguesAgora.get(p.c.id);
      if ([...p.alvo.keys()].every((e) => agoraSet?.has(e))) continue;
      adiadas++;
      for (const m of p.c.monitores ?? []) if (idsProcessados.has(m.id)) res.monitoresIncompletos.add(m.id);
    }
    if (cotaEsgotada || sobraAlem) {
      const qtd = sobraAlem ? `mais de ${adiadas}` : String(adiadas);
      avisos.push(
        `Limite de ${maxEmails} e-mail(s) por execução: ${qtd} comunicação(ões) seguem pendentes para as próximas execuções.`,
      );
    }
  } finally {
    await marcarPendentesConcluidas();
    if (!simular) {
      for (const r of remetentes) {
        try {
          await r.transporte.fechar?.();
        } catch {
          /* ignora */
        }
      }
    }
  }
  return res;
}

async function talvezEnviarSemNovidades(
  op: OpcoesSync,
  cfg: Configuracoes,
  hoje: string,
  qtdMonitores: number,
  novas: number,
  conta: RemetenteEmail,
  para: string[],
  resumo: ResumoEmail,
  resumoConta: Map<RemetenteEmail, ResumoConta>,
  log: (msg: string) => void,
): Promise<void> {
  if (!cfg.notificar_sem_novidades || novas > 0 || op.monitorId !== undefined || !para.length) return;
  const agora = (op.agora ?? (() => new Date()))();
  if (horaBrasil(agora) < (op.horaSemNovidades ?? 18)) return;
  // no máximo um por dia: só se nenhum e-mail foi enviado hoje
  if ((await op.repo.emailsEnviadosDesde(inicioDoDiaBrasilIso(agora))) > 0) return;
  const conteudo = montarEmailSemNovidades({ prefixo: cfg.assunto_prefixo, data: hoje, monitores: qtdMonitores });
  const rc = resumoConta.get(conta);
  try {
    await conta.transporte.enviar({ para, ...conteudo });
    resumo.enviados++;
    if (rc) rc.enviados++;
    log('e-mail "sem novidades" enviado');
  } catch (e) {
    const msg = `Falha ao enviar e-mail "sem novidades" pela conta ${conta.email}: ${descreverErro(e)}`;
    resumo.falhas.push(msg);
    rc?.falhas.push(msg);
  }
}
