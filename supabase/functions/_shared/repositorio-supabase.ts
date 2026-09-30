// Implementação do Repositorio sobre o Postgres da Supabase (via PostgREST / supabase-js).
// Deve receber um cliente criado com a SERVICE ROLE (ignora RLS).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Repositorio, ResultadoGravacao } from './repositorio.ts';
import type {
  ComunicacaoPendente,
  Configuracoes,
  ExecucaoResumida,
  FinalizacaoExecucao,
  Monitor,
  MonitorVinculado,
  NovaComunicacao,
  OrigemSync,
  RegistroEnvio,
} from './tipos.ts';
import { CONFIGURACOES_PADRAO } from './tipos.ts';

type Resultado<T> = { data: T | null; error: { message: string; details?: string | null; hint?: string | null } | null };

function exigir<T>(r: Resultado<T>, contexto: string): T {
  if (r.error) {
    const extra = [r.error.details, r.error.hint].filter(Boolean).join(' | ');
    throw new Error(`${contexto}: ${r.error.message}${extra ? ` (${extra})` : ''}`);
  }
  return r.data as T;
}

function lotes<T>(lista: T[], tamanho: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) out.push(lista.slice(i, i + tamanho));
  return out;
}

/** Colunas de filtro de public.monitores (as mesmas do formulário oficial do DJEN). */
const COLUNAS_FILTROS =
  'texto, sigla_tribunal, orgao_id, orgao_nome, meio, numero_processo, nome_parte, nome_advogado, numero_oab, uf_oab';

const COLUNAS_MONITOR =
  `id, nome, ${COLUNAS_FILTROS}, emails, ativo, dias_retroativos, ultima_sincronizacao, ultimo_erro, ` +
  'dias_semana, horarios, ultimo_envio_agendado, conta_envio_id';

/** Colunas do monitor embutidas em cada comunicação pendente (destinatários + descrição no e-mail). */
const COLUNAS_MONITOR_VINCULADO = `id, nome, emails, ativo, conta_envio_id, ${COLUNAS_FILTROS}`;

export class RepositorioSupabase implements Repositorio {
  constructor(private readonly db: SupabaseClient) {}

  async listarMonitores(filtro: { monitorId?: number } = {}): Promise<Monitor[]> {
    let q = this.db.from('monitores').select(COLUNAS_MONITOR).order('id');
    q = filtro.monitorId !== undefined ? q.eq('id', filtro.monitorId) : q.eq('ativo', true);
    return exigir(await q, 'Falha ao carregar monitores') as unknown as Monitor[];
  }

  async obterConfiguracoes(): Promise<Configuracoes> {
    const linhas = exigir(
      await this.db.from('configuracoes').select('chave, valor'),
      'Falha ao carregar configurações',
    ) as Array<{ chave: string; valor: unknown }>;
    const cfg: Configuracoes = { ...CONFIGURACOES_PADRAO };
    let temRecebemTudo = false;
    for (const { chave, valor } of linhas) {
      if (chave === 'emails_recebem_tudo' && Array.isArray(valor)) {
        cfg.emails_recebem_tudo = valor.filter((e): e is string => typeof e === 'string');
        temRecebemTudo = true;
      } else if (chave === 'emails_padrao' && Array.isArray(valor) && !temRecebemTudo) {
        // chave antiga (antes da migration contas_envio)
        cfg.emails_recebem_tudo = valor.filter((e): e is string => typeof e === 'string');
      } else if (chave === 'assunto_prefixo' && typeof valor === 'string') {
        cfg.assunto_prefixo = valor;
      } else if (chave === 'notificar_sem_novidades') {
        cfg.notificar_sem_novidades = valor === true || valor === 'true';
      }
    }
    return cfg;
  }

  async execucaoEmAndamento(desde: Date): Promise<ExecucaoResumida | null> {
    const linhas = exigir(
      await this.db
        .from('sync_execucoes')
        .select('id, status, iniciada_em')
        .eq('status', 'executando')
        .gte('iniciada_em', desde.toISOString())
        .order('iniciada_em', { ascending: false })
        .limit(1),
      'Falha ao verificar execuções em andamento',
    ) as ExecucaoResumida[];
    return linhas[0] ?? null;
  }

  async encerrarExecucoesTravadas(antesDe: Date, mensagem: string): Promise<number> {
    const linhas = exigir(
      await this.db
        .from('sync_execucoes')
        .update({ status: 'erro', mensagem, finalizada_em: new Date().toISOString() })
        .eq('status', 'executando')
        .lt('iniciada_em', antesDe.toISOString())
        .select('id'),
      'Falha ao encerrar execuções travadas',
    ) as Array<{ id: number }>;
    return linhas.length;
  }

  async iniciarExecucao(origem: OrigemSync, detalhes: Record<string, unknown> = {}): Promise<number> {
    const linha = exigir(
      await this.db.from('sync_execucoes').insert({ origem, status: 'executando', detalhes }).select('id').single(),
      'Falha ao registrar início da execução',
    ) as { id: number };
    return linha.id;
  }

  async finalizarExecucao(id: number, dados: FinalizacaoExecucao): Promise<void> {
    exigir(
      await this.db
        .from('sync_execucoes')
        .update({ ...dados, finalizada_em: new Date().toISOString() })
        .eq('id', id),
      'Falha ao registrar fim da execução',
    );
  }

  async emailsEnviadosDesde(desdeIso: string): Promise<number> {
    const linhas = exigir(
      await this.db.from('sync_execucoes').select('emails_enviados').gte('iniciada_em', desdeIso),
      'Falha ao consultar e-mails enviados',
    ) as Array<{ emails_enviados: number | null }>;
    return linhas.reduce((s, l) => s + (l.emails_enviados ?? 0), 0);
  }

  async gravarComunicacoes(itens: NovaComunicacao[]): Promise<ResultadoGravacao> {
    const ids = new Map<number, number>();
    const novasIds: number[] = [];
    // dedup por djen_id dentro do lote
    const unicos = [...new Map(itens.map((i) => [i.djen_id, i])).values()];

    for (const lote of lotes(unicos, 50)) {
      // ON CONFLICT (djen_id) DO NOTHING RETURNING id, djen_id -> só as linhas inseridas agora
      const inseridas = exigir(
        await this.db
          .from('comunicacoes')
          .upsert(lote, { onConflict: 'djen_id', ignoreDuplicates: true })
          .select('id, djen_id'),
        'Falha ao gravar comunicações',
      ) as Array<{ id: number; djen_id: number }>;
      for (const l of inseridas) {
        ids.set(Number(l.djen_id), Number(l.id));
        novasIds.push(Number(l.id));
      }
      const faltantes = lote.map((i) => i.djen_id).filter((d) => !ids.has(d));
      for (const sub of lotes(faltantes, 150)) {
        const existentes = exigir(
          await this.db.from('comunicacoes').select('id, djen_id').in('djen_id', sub),
          'Falha ao localizar comunicações existentes',
        ) as Array<{ id: number; djen_id: number }>;
        for (const l of existentes) ids.set(Number(l.djen_id), Number(l.id));
      }
    }
    return { ids, novasIds };
  }

  async djenIdsExistentes(djenIds: number[]): Promise<Set<number>> {
    const set = new Set<number>();
    for (const sub of lotes([...new Set(djenIds)], 150)) {
      const linhas = exigir(
        await this.db.from('comunicacoes').select('djen_id').in('djen_id', sub),
        'Falha ao consultar comunicações existentes',
      ) as Array<{ djen_id: number }>;
      for (const l of linhas) set.add(Number(l.djen_id));
    }
    return set;
  }

  async vincularMonitor(monitorId: number, comunicacaoIds: number[]): Promise<void> {
    for (const lote of lotes([...new Set(comunicacaoIds)], 500)) {
      exigir(
        await this.db.from('monitor_comunicacoes').upsert(
          lote.map((comunicacao_id) => ({ monitor_id: monitorId, comunicacao_id })),
          { onConflict: 'monitor_id,comunicacao_id', ignoreDuplicates: true },
        ),
        'Falha ao vincular comunicações ao monitor',
      );
    }
  }

  async atualizarMonitor(
    id: number,
    dados: { ultima_sincronizacao?: string; ultimo_erro: string | null },
  ): Promise<void> {
    exigir(await this.db.from('monitores').update(dados).eq('id', id), 'Falha ao atualizar monitor');
  }

  async marcarEnvioAgendado(id: number, quando: string): Promise<void> {
    exigir(
      await this.db.from('monitores').update({ ultimo_envio_agendado: quando }).eq('id', id),
      'Falha ao gravar o último envio agendado do monitor',
    );
  }

  async listarPendentes(limite: number, monitorIds?: number[]): Promise<ComunicacaoPendente[]> {
    const montar = (l: Record<string, unknown>, monitores: MonitorVinculado[]): ComunicacaoPendente => {
      const resto: Record<string, unknown> = { ...l };
      delete resto.monitor_comunicacoes;
      return {
        ...(resto as unknown as ComunicacaoPendente),
        destinatarios: (resto.destinatarios ?? []) as ComunicacaoPendente['destinatarios'],
        advogados: (resto.advogados ?? []) as ComunicacaoPendente['advogados'],
        monitores,
      };
    };
    const extrair = (v: unknown): MonitorVinculado[] =>
      ((v ?? []) as Array<{ monitores: MonitorVinculado | null }>)
        .map((x) => x.monitores)
        .filter((m): m is MonitorVinculado => !!m);

    if (!monitorIds) {
      const linhas = exigir(
        await this.db
          .from('comunicacoes')
          .select(`*, monitor_comunicacoes(monitores(${COLUNAS_MONITOR_VINCULADO}))`)
          .is('notificada_em', null)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .limit(limite),
        'Falha ao listar comunicações pendentes de notificação',
      ) as Array<Record<string, unknown>>;
      return linhas.map((l) => montar(l, extrair(l.monitor_comunicacoes)));
    }

    const ids = [...new Set(monitorIds)];
    if (ids.length === 0) return [];

    // 1) Pendentes vinculadas a pelo menos um dos monitores (o !inner filtra as comunicações;
    //    o embed filtrado não serve para destinatários, por isso o passo 2).
    const linhas = exigir(
      await this.db
        .from('comunicacoes')
        .select('*, monitor_comunicacoes!inner(monitor_id)')
        .is('notificada_em', null)
        .in('monitor_comunicacoes.monitor_id', ids)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(limite),
      'Falha ao listar comunicações pendentes de notificação',
    ) as Array<Record<string, unknown>>;
    if (linhas.length === 0) return [];

    // 2) TODOS os monitores vinculados a essas comunicações (destinatários de cada uma).
    const porComunicacao = new Map<number, MonitorVinculado[]>();
    for (const sub of lotes(linhas.map((l) => Number(l.id)), 150)) {
      const vinculos = exigir(
        await this.db
          .from('monitor_comunicacoes')
          .select(`comunicacao_id, monitores(${COLUNAS_MONITOR_VINCULADO})`)
          .in('comunicacao_id', sub),
        'Falha ao carregar os monitores das comunicações pendentes',
      ) as unknown as Array<{ comunicacao_id: number; monitores: MonitorVinculado | MonitorVinculado[] | null }>;
      for (const v of vinculos) {
        // muitos-para-um: o PostgREST devolve um objeto (aceita lista por segurança)
        const ms = Array.isArray(v.monitores) ? v.monitores : v.monitores ? [v.monitores] : [];
        if (!ms.length) continue;
        const cid = Number(v.comunicacao_id);
        const lista = porComunicacao.get(cid) ?? [];
        lista.push(...ms);
        porComunicacao.set(cid, lista);
      }
    }
    return linhas.map((l) => montar(l, (porComunicacao.get(Number(l.id)) ?? []).sort((a, b) => a.id - b.id)));
  }

  async contarPendentesOrfas(): Promise<number> {
    // anti-join do PostgREST: embed !left + filtro "is null" no recurso embutido
    const r = await this.db
      .from('comunicacoes')
      .select('id, monitor_comunicacoes!left(monitor_id)', { count: 'exact', head: true })
      .is('notificada_em', null)
      .is('monitor_comunicacoes', null);
    exigir(r, 'Falha ao contar comunicações pendentes sem monitor');
    return r.count ?? 0;
  }

  async enviosRegistrados(comunicacaoIds: number[]): Promise<Map<number, Set<string>>> {
    const mapa = new Map<number, Set<string>>();
    for (const sub of lotes([...new Set(comunicacaoIds)], 150)) {
      const linhas = exigir(
        await this.db.from('envios').select('comunicacao_id, destinatario').in('comunicacao_id', sub),
        'Falha ao consultar envios já feitos',
      ) as Array<{ comunicacao_id: number; destinatario: string }>;
      for (const l of linhas) {
        const cid = Number(l.comunicacao_id);
        const set = mapa.get(cid) ?? new Set<string>();
        set.add(String(l.destinatario).toLowerCase());
        mapa.set(cid, set);
      }
    }
    return mapa;
  }

  async registrarEnvios(linhas: RegistroEnvio[], quando: string): Promise<void> {
    for (const lote of lotes(linhas, 500)) {
      exigir(
        await this.db.from('envios').upsert(
          lote.map((l) => ({ ...l, enviado_em: quando })),
          { onConflict: 'comunicacao_id,destinatario', ignoreDuplicates: true },
        ),
        'Falha ao registrar envios',
      );
    }
  }

  async marcarNotificadas(ids: number[], quando: string): Promise<void> {
    for (const lote of lotes([...new Set(ids)], 200)) {
      exigir(
        await this.db.from('comunicacoes').update({ notificada_em: quando }).in('id', lote).is('notificada_em', null),
        'Falha ao marcar comunicações como notificadas',
      );
    }
  }
}
