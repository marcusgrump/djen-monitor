// Tipos compartilhados do motor de sincronização do DJEN Monitor.
// Espelham o contrato em supabase/migrations/20260928203046_schema.sql e
// supabase/migrations/*_monitores_filtros.sql.
// Código portável: roda no Deno (Edge Function) e no Node (tsx).

export type OrigemSync = 'cron' | 'manual';
export type StatusSync = 'executando' | 'sucesso' | 'parcial' | 'erro';
/** 'D' = Diário Eletrônico, 'E' = Edital */
export type MeioComunicacao = 'D' | 'E';

/**
 * Filtros de um monitor — os mesmos do formulário oficial (comunica.pje.jus.br).
 * Todos opcionais e combináveis (vão juntos, em AND, na mesma consulta à API).
 * Pelo menos um de texto, sigla_tribunal, nome_parte, nome_advogado, numero_oab
 * ou numero_processo deve estar preenchido.
 */
export interface FiltrosMonitor {
  /** parâmetro texto (mín. 5 caracteres) */
  texto: string | null;
  /** parâmetro siglaTribunal */
  sigla_tribunal: string | null;
  /** parâmetro orgaoId (exige sigla_tribunal) */
  orgao_id: number | null;
  /** nome do órgão, só para exibição */
  orgao_nome: string | null;
  /** parâmetro meio */
  meio: MeioComunicacao | null;
  /** parâmetro numeroProcesso (só dígitos) */
  numero_processo: string | null;
  /** parâmetro nomeParte (mín. 4 caracteres) */
  nome_parte: string | null;
  /** parâmetro nomeAdvogado (mín. 4 caracteres) */
  nome_advogado: string | null;
  /** parâmetro numeroOab */
  numero_oab: string | null;
  /** parâmetro ufOab (exige numero_oab) */
  uf_oab: string | null;
}

/** Parâmetros de filtro de GET /api/v1/comunicacao (sem datas/paginação). */
export interface ParametrosConsulta {
  texto?: string;
  siglaTribunal?: string;
  orgaoId?: string;
  meio?: MeioComunicacao;
  numeroProcesso?: string;
  nomeParte?: string;
  nomeAdvogado?: string;
  numeroOab?: string;
  ufOab?: string;
}

/** Linha de public.monitores */
export interface Monitor extends FiltrosMonitor {
  id: number;
  nome: string;
  emails: string[] | null;
  ativo: boolean;
  dias_retroativos: number;
  ultima_sincronizacao: string | null;
  ultimo_erro: string | null;
}

/** Item bruto devolvido por GET /api/v1/comunicacao */
export interface ItemDjen {
  id: number;
  hash?: string | null;
  data_disponibilizacao?: string | null;
  datadisponibilizacao?: string | null;
  siglaTribunal?: string | null;
  tipoComunicacao?: string | null;
  nomeOrgao?: string | null;
  texto?: string | null;
  numero_processo?: string | null;
  numeroprocessocommascara?: string | null;
  meio?: string | null;
  link?: string | null;
  tipoDocumento?: string | null;
  nomeClasse?: string | null;
  codigoClasse?: string | null;
  numeroComunicacao?: number | null;
  destinatarios?: Array<{ nome?: string | null; polo?: string | null }> | null;
  destinatarioadvogados?: Array<{
    advogado?: { nome?: string | null; numero_oab?: string | null; uf_oab?: string | null } | null;
  }> | null;
  [extra: string]: unknown;
}

export interface RespostaDjen {
  status: string;
  message?: string;
  count: number;
  items: ItemDjen[];
}

export interface Destinatario {
  nome: string;
  polo: string | null;
}

export interface Advogado {
  nome: string;
  numero_oab: string | null;
  uf_oab: string | null;
}

/** Dados de public.comunicacoes (sem id/lida/notificada_em/created_at) */
export interface NovaComunicacao {
  djen_id: number;
  hash: string | null;
  numero_comunicacao: number | null;
  data_disponibilizacao: string | null;
  sigla_tribunal: string | null;
  tipo_comunicacao: string | null;
  tipo_documento: string | null;
  nome_orgao: string | null;
  numero_processo: string | null;
  numero_processo_mascara: string | null;
  nome_classe: string | null;
  meio: string | null;
  texto: string | null;
  link: string | null;
  destinatarios: Destinatario[];
  advogados: Advogado[];
}

/** Comunicação já gravada (linha completa de public.comunicacoes) */
export interface Comunicacao extends NovaComunicacao {
  id: number;
  lida: boolean;
  notificada_em: string | null;
  created_at: string;
}

/** Monitor vinculado a uma comunicação pendente (os filtros servem para descrevê-lo no e-mail). */
export type MonitorVinculado = Pick<Monitor, 'id' | 'nome' | 'emails'> & Partial<FiltrosMonitor>;

/** Comunicação ainda não notificada + monitores que a encontraram */
export interface ComunicacaoPendente extends Comunicacao {
  monitores: MonitorVinculado[];
}

export interface Configuracoes {
  emails_padrao: string[];
  assunto_prefixo: string;
  notificar_sem_novidades: boolean;
}

export const CONFIGURACOES_PADRAO: Configuracoes = {
  emails_padrao: [],
  assunto_prefixo: '[DJEN]',
  notificar_sem_novidades: false,
};

/** Detalhe por monitor gravado em sync_execucoes.detalhes[monitor_id] */
export interface DetalheMonitor {
  nome: string;
  /** Resumo legível dos filtros (ex.: "OAB 146444/RJ · TJRJ · Diário") */
  filtros?: string;
  requisicoes: number;
  encontradas: number;
  novas: number;
  erro: string | null;
  parcial?: boolean;
  subdividido?: boolean;
  truncado?: boolean;
  intervalo?: { inicio: string; fim: string };
}

export interface FinalizacaoExecucao {
  status: Exclude<StatusSync, 'executando'>;
  requisicoes: number;
  encontradas: number;
  novas: number;
  emails_enviados: number;
  mensagem: string | null;
  detalhes: Record<string, unknown>;
}

export interface ExecucaoResumida {
  id: number;
  status: StatusSync;
  iniciada_em: string;
}
