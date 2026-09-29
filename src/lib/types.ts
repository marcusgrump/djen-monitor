// Tipos espelhando supabase/migrations/20260928203046_schema.sql

export const TIPOS_MONITOR = ["oab", "advogado", "parte", "processo", "texto"] as const;
export type TipoMonitor = (typeof TIPOS_MONITOR)[number];

export type StatusExecucao = "executando" | "sucesso" | "parcial" | "erro";
export type OrigemExecucao = "cron" | "manual";

export interface Monitor {
  id: number;
  nome: string;
  tipo: TipoMonitor;
  valor: string;
  uf_oab: string | null;
  sigla_tribunal: string | null;
  emails: string[] | null;
  ativo: boolean;
  dias_retroativos: number;
  ultima_sincronizacao: string | null;
  ultimo_erro: string | null;
  created_at: string;
}

export type MonitorInput = Omit<
  Monitor,
  "id" | "created_at" | "ultima_sincronizacao" | "ultimo_erro"
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
  emails_padrao: string[];
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
