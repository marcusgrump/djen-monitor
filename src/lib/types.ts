// Tipos espelhando supabase/migrations/ (schema + 20260929180000_monitores_filtros.sql
// + 20260930180520_agendamento_monitores.sql)

export type StatusExecucao = "executando" | "sucesso" | "parcial" | "erro";
export type OrigemExecucao = "cron" | "manual";

/** Meio de divulgação: D = Diário Eletrônico, E = Edital. */
export type MeioDjen = "D" | "E";

/**
 * Filtros de um monitor — as mesmas opções do formulário oficial de pesquisa
 * (comunica.pje.jus.br). Todos opcionais e combináveis; null = não filtrar.
 */
export interface FiltrosMonitor {
  texto: string | null;
  sigla_tribunal: string | null;
  orgao_id: number | null;
  /** Apenas exibição (a API filtra por orgao_id). */
  orgao_nome: string | null;
  meio: MeioDjen | null;
  /** Só dígitos. */
  numero_processo: string | null;
  nome_parte: string | null;
  nome_advogado: string | null;
  numero_oab: string | null;
  uf_oab: string | null;
}

export interface Monitor extends FiltrosMonitor {
  id: number;
  nome: string;
  emails: string[] | null;
  ativo: boolean;
  /** Janela (em dias) só da PRIMEIRA busca; depois o período é automático. */
  dias_retroativos: number;
  /** Dias em que roda/envia: 0 = domingo … 6 = sábado (horário de Brasília). 1 a 7 itens. */
  dias_semana: number[];
  /** Horários fixos 'HH:MM' (:00/:30). null/vazio = assim que publicar (a cada 30 min). */
  horarios: string[] | null;
  /** Controle interno (somente leitura): último horário agendado já processado. */
  ultimo_envio_agendado: string | null;
  /** Conta de envio (contas_envio.id); null = conta padrão. Ausente antes da migration de contas de envio. */
  conta_envio_id?: number | null;
  ultima_sincronizacao: string | null;
  ultimo_erro: string | null;
  created_at: string;
}

export type MonitorInput = Omit<
  Monitor,
  "id" | "created_at" | "ultima_sincronizacao" | "ultimo_erro" | "ultimo_envio_agendado"
>;

export interface Destinatario {
  nome?: string | null;
  polo?: string | null;
}

export interface Advogado {
  nome?: string | null;
  numero_oab?: string | null;
  uf_oab?: string | null;
}

export interface Comunicacao {
  id: number;
  djen_id: number;
  hash: string | null;
  numero_comunicacao: number | null;
  data_disponibilizacao: string | null; // YYYY-MM-DD
  sigla_tribunal: string | null;
  tipo_comunicacao: string | null;
  tipo_documento: string | null;
  nome_orgao: string | null;
  numero_processo: string | null;
  numero_processo_mascara: string | null;
  nome_classe: string | null;
  meio: string | null; // 'D' | 'E'
  texto: string | null;
  link: string | null;
  destinatarios: Destinatario[];
  advogados: Advogado[];
  lida: boolean;
  notificada_em: string | null;
  created_at: string;
}

export interface MonitorComunicacao {
  monitor_id: number;
  comunicacao_id: number;
  created_at: string;
}

export interface DetalheExecucaoMonitor {
  nome?: string;
  parcial?: boolean;
  truncado?: boolean;
  requisicoes?: number;
  encontradas?: number;
  novas?: number;
  erro?: string | null;
  [chave: string]: unknown;
}

/** Metadados gravados em sync_execucoes.detalhes._execucao pela Edge Function. */
export interface MetaExecucao {
  regiao?: string | null;
  dry_run?: boolean;
  origem?: string;
  monitor_id?: number | null;
  data_referencia?: string;
  duracao_ms?: number;
  rate_limit?: { limite?: number | null; restantes?: number | null } | null;
  email?: {
    transporte?: string | null;
    pendentes?: number;
    enviados?: number;
    notificadas?: number;
    falhas?: string[];
    sem_destinatario?: number;
  } | null;
  avisos?: string[];
}

export interface SyncExecucao {
  id: number;
  origem: OrigemExecucao;
  status: StatusExecucao;
  iniciada_em: string;
  finalizada_em: string | null;
  requisicoes: number;
  encontradas: number;
  novas: number;
  emails_enviados: number;
  mensagem: string | null;
  detalhes: Record<string, DetalheExecucaoMonitor> | null;
}

export interface ConfiguracaoRow {
  chave: string;
  valor: unknown;
  updated_at: string;
}

export interface Configuracoes {
  /** Recebem as comunicações de todos os monitores (substitui 'emails_padrao'). */
  emails_recebem_tudo: string[];
  assunto_prefixo: string;
  notificar_sem_novidades: boolean;
}

/** Resposta da Edge Function djen-sync. */
export interface ResultadoSync {
  status?: StatusExecucao | string;
  requisicoes?: number;
  encontradas?: number;
  novas?: number;
  emails_enviados?: number;
  mensagem?: string | null;
  [chave: string]: unknown;
}
