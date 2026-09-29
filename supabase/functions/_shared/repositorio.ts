// Camada de dados do motor de sincronização.
// `Repositorio` é a interface; há duas implementações:
//   - RepositorioMemoria (este arquivo): para testes locais, sem banco.
//   - RepositorioSupabase (repositorio-supabase.ts): Postgres via @supabase/supabase-js (service role).

import type {
  Comunicacao,
  ComunicacaoPendente,
  Configuracoes,
  ExecucaoResumida,
  FinalizacaoExecucao,
  Monitor,
  NovaComunicacao,
  OrigemSync,
  StatusSync,
} from './tipos.ts';
import { CONFIGURACOES_PADRAO } from './tipos.ts';

export interface ResultadoGravacao {
  /** djen_id -> comunicacoes.id (novas e já existentes) */
  ids: Map<number, number>;
  /** comunicacoes.id das linhas inseridas agora */
  novasIds: number[];
}

export interface Repositorio {
  /** Sem monitorId: todos os monitores ativos. Com monitorId: só aquele (mesmo inativo). */
  listarMonitores(filtro?: { monitorId?: number }): Promise<Monitor[]>;
  obterConfiguracoes(): Promise<Configuracoes>;

  /** Execução com status 'executando' iniciada após `desde`, se houver. */
  execucaoEmAndamento(desde: Date): Promise<ExecucaoResumida | null>;
  /** Marca como 'erro' execuções 'executando' iniciadas antes de `antesDe` (travadas). */
  encerrarExecucoesTravadas(antesDe: Date, mensagem: string): Promise<number>;
  iniciarExecucao(origem: OrigemSync, detalhes?: Record<string, unknown>): Promise<number>;
  finalizarExecucao(id: number, dados: FinalizacaoExecucao): Promise<void>;
  /** Soma de emails_enviados das execuções iniciadas a partir de `desdeIso`. */
  emailsEnviadosDesde(desdeIso: string): Promise<number>;

  /** INSERT ... ON CONFLICT (djen_id) DO NOTHING, devolvendo os ids de todas as linhas. */
  gravarComunicacoes(itens: NovaComunicacao[]): Promise<ResultadoGravacao>;
  /** Quais destes djen_id já existem (usado no modo dry-run, somente leitura). */
  djenIdsExistentes(djenIds: number[]): Promise<Set<number>>;
  /** INSERT em monitor_comunicacoes ignorando duplicados. */
  vincularMonitor(monitorId: number, comunicacaoIds: number[]): Promise<void>;
  atualizarMonitor(id: number, dados: { ultima_sincronizacao?: string; ultimo_erro: string | null }): Promise<void>;

  /** Comunicações com notificada_em IS NULL (mais antigas primeiro), com os monitores vinculados. */
  listarPendentes(limite: number): Promise<ComunicacaoPendente[]>;
  /** UPDATE comunicacoes SET notificada_em = quando WHERE id IN (...) AND notificada_em IS NULL */
  marcarNotificadas(ids: number[], quando: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Implementação em memória
// ---------------------------------------------------------------------------

interface ExecucaoMemoria extends Omit<FinalizacaoExecucao, 'status'> {
  id: number;
  origem: OrigemSync;
  status: StatusSync;
  iniciada_em: string;
  finalizada_em: string | null;
}

export class RepositorioMemoria implements Repositorio {
  monitores: Monitor[] = [];
  comunicacoes: Comunicacao[] = [];
  vinculos: Array<{ monitor_id: number; comunicacao_id: number; created_at: string }> = [];
  execucoes: ExecucaoMemoria[] = [];
  configuracoes: Configuracoes;
  private seqComunicacao = 1;
  private seqExecucao = 1;

  constructor(inicial: { monitores?: Monitor[]; configuracoes?: Partial<Configuracoes> } = {}) {
    this.monitores = inicial.monitores ? inicial.monitores.map((m) => ({ ...m })) : [];
    this.configuracoes = { ...CONFIGURACOES_PADRAO, ...(inicial.configuracoes ?? {}) };
  }

  listarMonitores(filtro: { monitorId?: number } = {}): Promise<Monitor[]> {
    const lista =
      filtro.monitorId !== undefined
        ? this.monitores.filter((m) => m.id === filtro.monitorId)
        : this.monitores.filter((m) => m.ativo);
    return Promise.resolve(lista.map((m) => ({ ...m })).sort((a, b) => a.id - b.id));
  }

  obterConfiguracoes(): Promise<Configuracoes> {
    return Promise.resolve({ ...this.configuracoes });
  }

  execucaoEmAndamento(desde: Date): Promise<ExecucaoResumida | null> {
    const e = this.execucoes.find((x) => x.status === 'executando' && new Date(x.iniciada_em) >= desde);
    return Promise.resolve(e ? { id: e.id, status: e.status, iniciada_em: e.iniciada_em } : null);
  }

  encerrarExecucoesTravadas(antesDe: Date, mensagem: string): Promise<number> {
    let n = 0;
    for (const e of this.execucoes) {
      if (e.status === 'executando' && new Date(e.iniciada_em) < antesDe) {
        e.status = 'erro';
        e.mensagem = mensagem;
        e.finalizada_em = new Date().toISOString();
        n++;
      }
    }
    return Promise.resolve(n);
  }

  iniciarExecucao(origem: OrigemSync, detalhes: Record<string, unknown> = {}): Promise<number> {
    const id = this.seqExecucao++;
    this.execucoes.push({
      id,
      origem,
      status: 'executando',
      iniciada_em: new Date().toISOString(),
      finalizada_em: null,
      requisicoes: 0,
      encontradas: 0,
      novas: 0,
      emails_enviados: 0,
      mensagem: null,
      detalhes,
    });
    return Promise.resolve(id);
  }

  finalizarExecucao(id: number, dados: FinalizacaoExecucao): Promise<void> {
    const e = this.execucoes.find((x) => x.id === id);
    if (e) Object.assign(e, dados, { finalizada_em: new Date().toISOString() });
    return Promise.resolve();
  }

  emailsEnviadosDesde(desdeIso: string): Promise<number> {
    const desde = new Date(desdeIso);
    return Promise.resolve(
      this.execucoes.filter((e) => new Date(e.iniciada_em) >= desde).reduce((s, e) => s + (e.emails_enviados || 0), 0),
    );
  }

  gravarComunicacoes(itens: NovaComunicacao[]): Promise<ResultadoGravacao> {
    const ids = new Map<number, number>();
    const novasIds: number[] = [];
    for (const it of itens) {
      const existente = this.comunicacoes.find((c) => c.djen_id === it.djen_id);
      if (existente) {
        ids.set(it.djen_id, existente.id);
        continue;
      }
      const id = this.seqComunicacao++;
      this.comunicacoes.push({ ...it, id, lida: false, notificada_em: null, created_at: new Date().toISOString() });
      ids.set(it.djen_id, id);
      novasIds.push(id);
    }
    return Promise.resolve({ ids, novasIds });
  }

  djenIdsExistentes(djenIds: number[]): Promise<Set<number>> {
    const alvo = new Set(djenIds);
    return Promise.resolve(new Set(this.comunicacoes.filter((c) => alvo.has(c.djen_id)).map((c) => c.djen_id)));
  }

  vincularMonitor(monitorId: number, comunicacaoIds: number[]): Promise<void> {
    for (const cid of comunicacaoIds) {
      if (!this.vinculos.some((v) => v.monitor_id === monitorId && v.comunicacao_id === cid)) {
        this.vinculos.push({ monitor_id: monitorId, comunicacao_id: cid, created_at: new Date().toISOString() });
      }
    }
    return Promise.resolve();
  }

  atualizarMonitor(id: number, dados: { ultima_sincronizacao?: string; ultimo_erro: string | null }): Promise<void> {
    const m = this.monitores.find((x) => x.id === id);
    if (m) Object.assign(m, dados);
    return Promise.resolve();
  }

  listarPendentes(limite: number): Promise<ComunicacaoPendente[]> {
    const pend = this.comunicacoes
      .filter((c) => c.notificada_em === null)
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id)
      .slice(0, limite)
      .map((c) => {
        const mids = this.vinculos.filter((v) => v.comunicacao_id === c.id).map((v) => v.monitor_id);
        const monitores = this.monitores
          .filter((m) => mids.includes(m.id))
          .map((m) => ({ id: m.id, nome: m.nome, emails: m.emails }));
        return { ...c, monitores };
      });
    return Promise.resolve(pend);
  }

  marcarNotificadas(ids: number[], quando: string): Promise<void> {
    const alvo = new Set(ids);
    for (const c of this.comunicacoes) {
      if (alvo.has(c.id) && c.notificada_em === null) c.notificada_em = quando;
    }
    return Promise.resolve();
  }
}
