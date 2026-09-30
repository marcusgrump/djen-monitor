import type { MeioDjen, StatusExecucao } from "./types";

export const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

/** Rótulos do filtro "Meio" do formulário oficial de pesquisa. */
export const MEIOS_DJEN: { value: MeioDjen; label: string; curto: string }[] = [
  { value: "D", label: "Diário Eletrônico", curto: "Diário" },
  { value: "E", label: "Edital", curto: "Edital" },
];

export const STATUS_EXECUCAO_INFO: Record<StatusExecucao, { rotulo: string; classe: string }> = {
  executando: {
    rotulo: "Executando",
    classe: "bg-accent text-primary",
  },
  sucesso: {
    rotulo: "Sucesso",
    classe: "bg-success/10 text-success-text",
  },
  parcial: {
    rotulo: "Parcial",
    classe: "bg-warning/20 text-warning-text",
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
