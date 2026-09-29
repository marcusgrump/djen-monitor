// Orquestração da sincronização do DJEN Monitor.
//
// 1. Registra a execução em sync_execucoes ('executando').
// 2. Para cada monitor (os menos recentemente sincronizados primeiro): busca na API
//    (uma consulta por intervalo com todos os filtros preenchidos do monitor, em AND,
//    paginada), grava em comunicacoes (ON CONFLICT DO NOTHING),
//    vincula em monitor_comunicacoes e atualiza ultima_sincronizacao / ultimo_erro.
// 3. Envia e-mail com as comunicações notificada_em IS NULL, agrupadas pelo conjunto de
//    destinatários, e só então marca notificada_em (nunca perde; cada comunicação pertence
//    a exatamente um e-mail, então uma falha não gera duplicatas nos demais grupos).
// 4. Finaliza a execução com status, contadores e detalhes por monitor.

import { dataBrasil, horaBrasil, inicioDoDiaBrasilIso } from './datas.ts';
import { type ClienteDjen, descreverErro } from './djen-client.ts';
import { montarEmailComunicacoes, montarEmailSemNovidades, type TransporteEmail } from './email.ts';
import { itemParaComunicacao, resumoFiltros } from './mapeamento.ts';
import type { Repositorio } from './repositorio.ts';
import type { ComunicacaoPendente, Configuracoes, DetalheMonitor, Monitor, OrigemSync } from './tipos.ts';

export interface OpcoesSync {
  repo: Repositorio;
  /** Cliente já configurado com o prazo (orçamento de tempo) da fase de busca. */
  cliente: ClienteDjen;
  /** null = e-mail não configurado (as comunicações ficam pendentes). */
  transporte: TransporteEmail | null;
  /** De onde vieram as credenciais do e-mail: 'painel' (Vault), 'secrets' (GMAIL_*) ou null. */
  origemCredenciais?: 'painel' | 'secrets' | null;
  origem: OrigemSync;
  monitorId?: number;
  /** Não grava nada no banco e não envia e-mail; apenas consulta a API e relata. */
  dryRun?: boolean;
  /** Região de execução (ex.: env SB_REGION). */
  regiao?: string | null;
  /** Após este instante (epoch ms) não inicia novos envios de e-mail (ficam para a próxima). */
  prazoEnvio?: number;
  /** Máximo de comunicações por e-mail (Gmail corta mensagens acima de ~102 KB). Padrão 20. */
  maxPorEmail?: number;
  /**
   * Máximo de e-mails por execução (evita inundar a caixa e respeita o limite diário do
   * Gmail, ~500 mensagens/dia). O excedente fica pendente para as próximas execuções. Padrão 8.
   */
  maxEmailsPorExecucao?: number;
  /** Hora (SP) a partir da qual o e-mail "sem novidades" pode ser enviado. Padrão 18. */
  horaSemNovidades?: number;
  agora?: () => Date;
  log?: (msg: string) => void;
}

export interface ResumoEmail {
  transporte: string | null;
  /** 'painel' (Vault, via Configurações), 'secrets' (GMAIL_* da função) ou null (não configurado). */
  origem_credenciais: 'painel' | 'secrets' | null;
  pendentes: number;
  enviados: number;
  notificadas: number;
  falhas: string[];
  sem_destinatario: number;
}

export interface ResumoSync {
  execucao_id: number | null;
  status: 'sucesso' | 'parcial' | 'erro';
  dry_run: boolean;
  regiao: string | null;
  data_referencia: string;
  monitores: number;
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

export async function executarSincronizacao(op: OpcoesSync): Promise<ResumoSync> {
  const agora = op.agora ?? (() => new Date());
  const log = op.log ?? (() => {});
  const t0 = Date.now();
  const dryRun = !!op.dryRun;
  const hoje = dataBrasil(agora());
  const regiao = op.regiao ?? null;
  const { repo, cliente } = op;

  const detalhes: Record<string, unknown> = {};
  const avisos: string[] = [];
  const email: ResumoEmail = {
    transporte: op.transporte?.nome ?? null,
    origem_credenciais: op.transporte ? (op.origemCredenciais ?? null) : null,
    pendentes: 0,
    enviados: 0,
    notificadas: 0,
    falhas: [],
    sem_destinatario: 0,
  };
  let encontradas = 0;
  let novas = 0;
  let falhasMonitor = 0;
  let parciais = 0;
  let envioIncompleto = false;
  let erroFatal: string | null = null;
  let monitores: Monitor[] = [];
  let execucaoId: number | null = null;

  const meta = () => ({
    regiao,
    dry_run: dryRun,
    origem: op.origem,
    monitor_id: op.monitorId ?? null,
    data_referencia: hoje,
    duracao_ms: Date.now() - t0,
    rate_limit: { limite: cliente.limiteJanela, restantes: cliente.restantesJanela },
    email,
    avisos,
  });

  try {
    if (!dryRun) execucaoId = await repo.iniciarExecucao(op.origem, { _execucao: meta() });
    const cfg = await repo.obterConfiguracoes();
    monitores = await repo.listarMonitores(op.monitorId !== undefined ? { monitorId: op.monitorId } : {});
    if (op.monitorId !== undefined && monitores.length === 0) {
      throw new Error(`Monitor ${op.monitorId} não encontrado`);
    }
    // Os menos recentemente sincronizados primeiro: se o orçamento de tempo acabar,
    // os que ficaram de fora serão os primeiros na próxima execução.
    monitores.sort(
      (a, b) => (a.ultima_sincronizacao ?? '').localeCompare(b.ultima_sincronizacao ?? '') || a.id - b.id,
    );
    log(`${monitores.length} monitor(es) a processar; data de referência ${hoje}`);

    // ------------------------------------------------------------------ busca
    for (const m of monitores) {
      const filtros = resumoFiltros(m);
      if (cliente.tempoRestante() < 3_000) {
        detalhes[String(m.id)] = {
          nome: m.nome,
          filtros,
          requisicoes: 0,
          encontradas: 0,
          novas: 0,
          erro: null,
          parcial: true,
          nao_processado: true,
        };
        parciais++;
        continue;
      }
      const r = await cliente.buscarMonitor(m, hoje);
      const det: DetalheMonitor = {
        nome: m.nome,
        filtros,
        requisicoes: r.requisicoes,
        encontradas: r.itens.length,
        novas: 0,
        erro: r.erro,
        intervalo: r.intervalo,
      };
      if (r.parcial) det.parcial = true;
      if (r.subdividido) det.subdividido = true;
      if (r.truncado) det.truncado = true;
      encontradas += r.itens.length;
      log(
        `monitor #${m.id} "${m.nome}" [${filtros}]: ${r.itens.length} item(ns) (count=${r.totalInformado}), ${r.requisicoes} req.` +
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

    if (parciais > 0) avisos.push(`Orçamento de tempo esgotado: ${plural(parciais, 'monitor ficou', 'monitores ficaram')} incompleto(s); continua na próxima execução.`);
    if (falhasMonitor > 0) avisos.push(`${plural(falhasMonitor, 'monitor falhou', 'monitores falharam')}.`);

    // ------------------------------------------------------------ notificação
    if (!dryRun) {
      envioIncompleto = await notificar(op, cfg, hoje, monitores.length, novas, email, avisos, log);
    }
  } catch (e) {
    erroFatal = descreverErro(e);
    log(`erro fatal: ${erroFatal}`);
  }

  let status: ResumoSync['status'];
  if (erroFatal) status = 'erro';
  else if (monitores.length > 0 && falhasMonitor === monitores.length) status = 'erro';
  else if (falhasMonitor > 0 || parciais > 0 || envioIncompleto || email.falhas.length > 0) status = 'parcial';
  else status = 'sucesso';

  const partes = [
    `${plural(monitores.length, 'monitor', 'monitores')}: ${encontradas} encontrada(s), ${novas} nova(s)`,
    dryRun ? 'modo simulação (nada gravado, nenhum e-mail enviado)' : `${plural(email.enviados, 'e-mail enviado', 'e-mails enviados')}`,
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
    monitores: monitores.length,
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

/** Envia as pendentes. Devolve true se o envio ficou incompleto (prazo/falha). */
async function notificar(
  op: OpcoesSync,
  cfg: Configuracoes,
  hoje: string,
  qtdMonitores: number,
  novas: number,
  resumo: ResumoEmail,
  avisos: string[],
  log: (msg: string) => void,
): Promise<boolean> {
  const { repo, transporte } = op;
  const agora = op.agora ?? (() => new Date());
  const maxPorEmail = Math.max(1, op.maxPorEmail ?? 20);
  const maxEmails = Math.max(1, op.maxEmailsPorExecucao ?? 8);
  // Carrega só o que cabe nos e-mails desta execução (+1 para saber se sobra algo).
  const limite = maxEmails * maxPorEmail;

  const lidas = await repo.listarPendentes(limite + 1);
  const sobraAlem = lidas.length > limite;
  const pendentes = sobraAlem ? lidas.slice(0, limite) : lidas;
  resumo.pendentes = pendentes.length;

  if (!transporte) {
    if (pendentes.length) {
      avisos.push(
        `E-mail não configurado (configure o Gmail em Configurações): ${pendentes.length} comunicação(ões) aguardando envio.`,
      );
    }
    return false;
  }

  let incompleto = false;
  try {
    if (pendentes.length === 0) {
      await talvezEnviarSemNovidades(op, cfg, hoje, qtdMonitores, novas, resumo, log);
      return false;
    }

    // Agrupa pelo conjunto exato de destinatários: cada comunicação vai em um único e-mail.
    const grupos = new Map<string, { para: string[]; itens: ComunicacaoPendente[] }>();
    for (const c of pendentes) {
      const dest = new Set<string>();
      const fontes = c.monitores.length ? c.monitores : [null];
      for (const m of fontes) {
        const lista = m?.emails && m.emails.length ? m.emails : cfg.emails_padrao;
        for (const e of lista ?? []) {
          const n = String(e).trim().toLowerCase();
          if (EMAIL_VALIDO.test(n)) dest.add(n);
        }
      }
      if (dest.size === 0) {
        resumo.sem_destinatario++;
        continue;
      }
      const para = [...dest].sort();
      const chave = para.join(',');
      const g = grupos.get(chave) ?? { para, itens: [] };
      g.itens.push(c);
      grupos.set(chave, g);
    }
    if (resumo.sem_destinatario > 0) {
      avisos.push(
        `${resumo.sem_destinatario} comunicação(ões) sem destinatário (configure configuracoes.emails_padrao ou monitores.emails); continuam pendentes.`,
      );
    }

    let adiadas = 0;
    let tentativas = 0;
    let falhasSeguidas = 0;
    externo: for (const g of grupos.values()) {
      // Quantas deste grupo cabem no que resta da cota de e-mails desta execução.
      const cabem = Math.max(0, maxEmails - tentativas) * maxPorEmail;
      const itens = g.itens.slice(0, cabem);
      adiadas += g.itens.length - itens.length;
      const total = Math.ceil(itens.length / maxPorEmail);
      for (let i = 0; i < total; i++) {
        if (op.prazoEnvio !== undefined && Date.now() > op.prazoEnvio) {
          incompleto = true;
          avisos.push('Tempo esgotado antes de enviar todos os e-mails; o restante segue na próxima execução.');
          break externo;
        }
        if (falhasSeguidas >= 2) {
          avisos.push('Envio de e-mails interrompido após falhas seguidas; as comunicações continuam pendentes.');
          break externo;
        }
        const lote = itens.slice(i * maxPorEmail, (i + 1) * maxPorEmail);
        const conteudo = montarEmailComunicacoes(lote, {
          prefixo: cfg.assunto_prefixo,
          data: hoje,
          parte: { numero: i + 1, total },
          totalGeral: itens.length,
        });
        tentativas++;
        try {
          await transporte.enviar({ para: g.para, ...conteudo });
          resumo.enviados++;
          falhasSeguidas = 0;
          log(`e-mail enviado para ${g.para.length} destinatário(s): "${conteudo.assunto}"`);
        } catch (e) {
          falhasSeguidas++;
          const msg = `Falha ao enviar e-mail (${g.para.length} destinatário(s)): ${descreverErro(e)}`;
          resumo.falhas.push(msg);
          avisos.push(msg);
          log(msg);
          continue externo; // próximo grupo; as deste continuam pendentes
        }
        try {
          await repo.marcarNotificadas(
            lote.map((c) => c.id),
            agora().toISOString(),
          );
          resumo.notificadas += lote.length;
        } catch (e) {
          const msg = `E-mail enviado, mas falhou ao marcar notificada_em (pode haver reenvio): ${descreverErro(e)}`;
          resumo.falhas.push(msg);
          avisos.push(msg);
          log(msg);
        }
      }
    }
    if (adiadas > 0 || sobraAlem) {
      const qtd = sobraAlem ? (adiadas > 0 ? `mais de ${adiadas}` : 'outras') : String(adiadas);
      avisos.push(
        `Limite de ${maxEmails} e-mail(s) por execução: ${qtd} comunicação(ões) seguem pendentes para as próximas execuções.`,
      );
    }
  } finally {
    try {
      await transporte.fechar?.();
    } catch {
      /* ignora */
    }
  }
  return incompleto;
}

async function talvezEnviarSemNovidades(
  op: OpcoesSync,
  cfg: Configuracoes,
  hoje: string,
  qtdMonitores: number,
  novas: number,
  resumo: ResumoEmail,
  log: (msg: string) => void,
): Promise<void> {
  if (!cfg.notificar_sem_novidades || novas > 0 || !op.transporte || op.monitorId !== undefined) return;
  const agora = (op.agora ?? (() => new Date()))();
  if (horaBrasil(agora) < (op.horaSemNovidades ?? 18)) return;
  const para = [...new Set(cfg.emails_padrao.map((e) => e.trim().toLowerCase()).filter((e) => EMAIL_VALIDO.test(e)))];
  if (!para.length) return;
  // no máximo um por dia: só se nenhum e-mail foi enviado hoje
  if ((await op.repo.emailsEnviadosDesde(inicioDoDiaBrasilIso(agora))) > 0) return;
  const conteudo = montarEmailSemNovidades({ prefixo: cfg.assunto_prefixo, data: hoje, monitores: qtdMonitores });
  try {
    await op.transporte.enviar({ para, ...conteudo });
    resumo.enviados++;
    log('e-mail "sem novidades" enviado');
  } catch (e) {
    resumo.falhas.push(`Falha ao enviar e-mail "sem novidades": ${descreverErro(e)}`);
  }
}
