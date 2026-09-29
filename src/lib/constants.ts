import type { StatusExecucao, TipoMonitor } from "./types";

export const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

export const TIPO_MONITOR_INFO: Record<
  TipoMonitor,
  { rotulo: string; rotuloValor: string; placeholder: string; ajuda: string }
> = {
  oab: {
    rotulo: "OAB",
    rotuloValor: "Número da OAB",
    placeholder: "123456",
    ajuda: "Somente o número da inscrição; a UF é escolhida ao lado.",
  },
  advogado: {
    rotulo: "Advogado",
    rotuloValor: "Nome do advogado",
    placeholder: "Maria da Silva",
    ajuda: "Nome completo, como aparece nas publicações.",
  },
  parte: {
    rotulo: "Parte",
    rotuloValor: "Nome da parte",
    placeholder: "Empresa Exemplo Ltda",
    ajuda: "Nome da pessoa física ou jurídica.",
  },
  processo: {
    rotulo: "Processo",
    rotuloValor: "Número do processo (CNJ)",
    placeholder: "0000000-00.0000.0.00.0000",
    ajuda: "Numeração única CNJ, com ou sem pontuação (20 dígitos).",
  },
  texto: {
    rotulo: "Texto",
    rotuloValor: "Texto a procurar",
    placeholder: "termo de busca",
    ajuda: "Busca livre no conteúdo das comunicações.",
  },
};

export const STATUS_EXECUCAO_INFO: Record<StatusExecucao, { rotulo: string; classe: string }> = {
  executando: {
    rotulo: "Executando",
    classe: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  sucesso: {
    rotulo: "Sucesso",
    classe: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  parcial: {
    rotulo: "Parcial",
    classe: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  },
  erro: {
    rotulo: "Erro",
    classe: "bg-destructive/10 text-destructive",
  },
};

export const ORIGEM_EXECUCAO_ROTULO: Record<string, string> = {
  cron: "Automática",
  manual: "Manual",
};

export const TAMANHO_PAGINA = 25;
