// Filtros da pesquisa do DJEN — os mesmos campos do formulário oficial (comunica.pje.jus.br).
// Lógica pura (sem React/DOM): usada pela página Pesquisar, pelo cadastro de monitores e por testes.

import { z } from "zod";
import { MEIOS_DJEN, UFS } from "./constants";
import { mascararProcesso, somenteDigitos } from "./format";
import type { FiltrosMonitor, MeioDjen } from "./types";

/** Estado do formulário (tudo como o usuário digita). */
export interface FiltrosDjen {
  texto: string;
  siglaTribunal: string;
  orgaoId: string;
  /** Apenas exibição. */
  orgaoNome: string;
  meio: "" | MeioDjen;
  dataInicio: string; // AAAA-MM-DD
  dataFim: string; // AAAA-MM-DD
  numeroProcesso: string;
  nomeParte: string;
  nomeAdvogado: string;
  numeroOab: string;
  ufOab: string;
}

export const FILTROS_VAZIOS: FiltrosDjen = {
  texto: "",
  siglaTribunal: "",
  orgaoId: "",
  orgaoNome: "",
  meio: "",
  dataInicio: "",
  dataFim: "",
  numeroProcesso: "",
  nomeParte: "",
  nomeAdvogado: "",
  numeroOab: "",
  ufOab: "",
};

/** Filtros já normalizados; só as chaves preenchidas existem. */
export interface FiltrosNormalizados {
  texto?: string;
  siglaTribunal?: string;
  orgaoId?: number;
  orgaoNome?: string;
  meio?: MeioDjen;
  dataInicio?: string;
  dataFim?: string;
  numeroProcesso?: string;
  nomeParte?: string;
  nomeAdvogado?: string;
  numeroOab?: string;
  ufOab?: string;
}

export type ModoFiltros = "pesquisa" | "monitor";
export type CampoFiltro = keyof FiltrosDjen;
export type ErrosFiltros = Partial<Record<CampoFiltro | "geral", string>>;

export const MIN_TEXTO = 5;
export const MIN_NOME = 4;

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;

const espacos = (v: string) => v.replace(/\s+/g, " ").trim();

/** Nº da OAB: só letras e dígitos, maiúsculo (ex.: "143.085-d" → "143085D"). */
export function normalizarOab(v: string | null | undefined) {
  return (v ?? "").replace(/[^0-9a-z]/gi, "").toUpperCase();
}

/** Converte o estado do formulário em filtros normalizados (strings vazias somem). */
export function normalizarFiltros(f: FiltrosDjen): FiltrosNormalizados {
  const n: FiltrosNormalizados = {};
  const texto = espacos(f.texto);
  if (texto) n.texto = texto;
  const sigla = f.siglaTribunal.trim().toUpperCase();
  if (sigla) {
    n.siglaTribunal = sigla;
    const orgao = Number.parseInt(f.orgaoId, 10);
    if (Number.isSafeInteger(orgao) && orgao > 0) {
      n.orgaoId = orgao;
      const nome = espacos(f.orgaoNome);
      if (nome) n.orgaoNome = nome;
    }
  }
  if (f.meio === "D" || f.meio === "E") n.meio = f.meio;
  if (RE_DATA.test(f.dataInicio)) n.dataInicio = f.dataInicio;
  if (RE_DATA.test(f.dataFim)) n.dataFim = f.dataFim;
  const processo = somenteDigitos(f.numeroProcesso);
  if (processo) n.numeroProcesso = processo;
  const parte = espacos(f.nomeParte);
  if (parte) n.nomeParte = parte;
  const advogado = espacos(f.nomeAdvogado);
  if (advogado) n.nomeAdvogado = advogado;
  const oab = normalizarOab(f.numeroOab);
  if (oab) {
    n.numeroOab = oab;
    const uf = f.ufOab.trim().toUpperCase();
    if (uf) n.ufOab = uf;
  }
  return n;
}

/**
 * Filtro "forte": a API só aceita páginas de 100 itens quando há ao menos um destes.
 * Sem eles, a consulta só é aceita com itensPorPagina=5.
 */
export function temFiltroForte(n: FiltrosNormalizados) {
  return Boolean(
    n.siglaTribunal || n.texto || n.nomeParte || n.nomeAdvogado || n.numeroOab || n.numeroProcesso,
  );
}

export function temAlgumFiltro(n: FiltrosNormalizados) {
  return Object.keys(n).some((k) => k !== "orgaoNome");
}

const MSG_FORTE =
  "Preencha ao menos um destes: teor da comunicação, instituição, nº do processo, nome da parte, nome do advogado ou nº da OAB.";

function criarSchema(modo: ModoFiltros) {
  return z
    .object({
      texto: z.string(),
      siglaTribunal: z.string(),
      orgaoId: z.string(),
      orgaoNome: z.string(),
      meio: z.enum(["", "D", "E"], { error: "Meio inválido." }),
      dataInicio: z.string(),
      dataFim: z.string(),
      numeroProcesso: z.string(),
      nomeParte: z.string(),
      nomeAdvogado: z.string(),
      numeroOab: z.string(),
      ufOab: z.string(),
    })
    .superRefine((f, ctx) => {
      const erro = (campo: CampoFiltro | "geral", message: string) =>
        ctx.addIssue({ code: "custom", path: [campo], message });

      const texto = espacos(f.texto);
      if (texto && texto.length < MIN_TEXTO) erro("texto", `Use pelo menos ${MIN_TEXTO} caracteres.`);
      if (texto.length > 500) erro("texto", "Texto longo demais (máx. 500 caracteres).");

      const sigla = f.siglaTribunal.trim();
      if (sigla && !/^[A-Za-z0-9-]{2,20}$/.test(sigla)) erro("siglaTribunal", "Sigla de instituição inválida.");
      if (f.orgaoId.trim()) {
        if (!sigla) erro("orgaoId", "Escolha a instituição antes do órgão.");
        else if (!/^\d+$/.test(f.orgaoId.trim())) erro("orgaoId", "Órgão inválido.");
      }

      if (modo === "pesquisa") {
        if (f.dataInicio && !RE_DATA.test(f.dataInicio)) erro("dataInicio", "Data inválida.");
        if (f.dataFim && !RE_DATA.test(f.dataFim)) erro("dataFim", "Data inválida.");
        if (RE_DATA.test(f.dataInicio) && RE_DATA.test(f.dataFim) && f.dataFim < f.dataInicio) {
          erro("dataFim", "A data final deve ser igual ou posterior à inicial.");
        }
      }

      if (f.numeroProcesso.trim()) {
        if (/[^\d.\-\s/]/.test(f.numeroProcesso)) {
          erro("numeroProcesso", "Use apenas números (com ou sem a máscara CNJ).");
        } else if (somenteDigitos(f.numeroProcesso).length !== 20) {
          erro("numeroProcesso", "O número CNJ tem 20 dígitos (NNNNNNN-DD.AAAA.J.TR.OOOO).");
        }
      }

      const parte = espacos(f.nomeParte);
      if (parte && parte.length < MIN_NOME) erro("nomeParte", `Use pelo menos ${MIN_NOME} caracteres.`);
      const advogado = espacos(f.nomeAdvogado);
      if (advogado && advogado.length < MIN_NOME) erro("nomeAdvogado", `Use pelo menos ${MIN_NOME} caracteres.`);

      const oab = normalizarOab(f.numeroOab);
      if (f.numeroOab.trim() && !/^\d{1,8}[A-Z]{0,2}$/.test(oab)) {
        erro("numeroOab", "Nº da OAB inválido (ex.: 123456).");
      }
      const uf = f.ufOab.trim().toUpperCase();
      if (uf && !(UFS as readonly string[]).includes(uf)) erro("ufOab", "UF inválida.");
      if (uf && !oab) erro("numeroOab", "Informe o nº da OAB para filtrar pela UF.");

      const n = normalizarFiltros(f);
      if (modo === "monitor") {
        if (!temFiltroForte(n)) erro("geral", MSG_FORTE);
      } else if (!temAlgumFiltro(n)) {
        erro("geral", "Preencha ao menos um filtro para pesquisar.");
      }
    })
    .transform((f) => normalizarFiltros(f));
}

const schemas = { pesquisa: criarSchema("pesquisa"), monitor: criarSchema("monitor") };

export function validarFiltros(
  f: FiltrosDjen,
  modo: ModoFiltros,
): { ok: true; dados: FiltrosNormalizados } | { ok: false; erros: ErrosFiltros } {
  const r = schemas[modo].safeParse(f);
  if (r.success) return { ok: true, dados: r.data };
  const erros: ErrosFiltros = {};
  for (const issue of r.error.issues) {
    const campo = (issue.path[0] as CampoFiltro | "geral" | undefined) ?? "geral";
    if (!erros[campo]) erros[campo] = issue.message;
  }
  return { ok: false, erros };
}

// ---------------------------------------------------------------------------
// Query string (links compartilháveis da página Pesquisar)
// ---------------------------------------------------------------------------

const CHAVES_QUERY: Record<Exclude<CampoFiltro, never>, string> = {
  texto: "texto",
  siglaTribunal: "tribunal",
  orgaoId: "orgao",
  orgaoNome: "orgaoNome",
  meio: "meio",
  dataInicio: "de",
  dataFim: "ate",
  numeroProcesso: "processo",
  nomeParte: "parte",
  nomeAdvogado: "advogado",
  numeroOab: "oab",
  ufOab: "uf",
};

/** Filtros normalizados → query string (sem página). */
export function filtrosParaQuery(n: FiltrosNormalizados, opcoes: { semDatas?: boolean } = {}) {
  const sp = new URLSearchParams();
  const put = (campo: CampoFiltro, v: string | number | undefined) => {
    if (v !== undefined && v !== "") sp.set(CHAVES_QUERY[campo], String(v));
  };
  put("texto", n.texto);
  put("siglaTribunal", n.siglaTribunal);
  put("orgaoId", n.orgaoId);
  put("orgaoNome", n.orgaoId ? n.orgaoNome : undefined);
  put("meio", n.meio);
  if (!opcoes.semDatas) {
    put("dataInicio", n.dataInicio);
    put("dataFim", n.dataFim);
  }
  put("numeroProcesso", n.numeroProcesso);
  put("nomeParte", n.nomeParte);
  put("nomeAdvogado", n.nomeAdvogado);
  put("numeroOab", n.numeroOab);
  put("ufOab", n.ufOab);
  return sp;
}

/** Query string → estado do formulário (valores desconhecidos são ignorados). */
export function filtrosDeQuery(sp: URLSearchParams): FiltrosDjen {
  const get = (campo: CampoFiltro) => (sp.get(CHAVES_QUERY[campo]) ?? "").slice(0, 500);
  const meio = get("meio").toUpperCase();
  const data = (v: string) => (RE_DATA.test(v) ? v : "");
  const orgaoId = /^\d+$/.test(get("orgaoId")) ? get("orgaoId") : "";
  const processo = get("numeroProcesso");
  return {
    texto: get("texto"),
    siglaTribunal: get("siglaTribunal").toUpperCase(),
    orgaoId,
    orgaoNome: orgaoId ? get("orgaoNome") : "",
    meio: meio === "D" || meio === "E" ? meio : "",
    dataInicio: data(get("dataInicio")),
    dataFim: data(get("dataFim")),
    numeroProcesso: somenteDigitos(processo).length === 20 ? mascararProcesso(processo) : processo,
    nomeParte: get("nomeParte"),
    nomeAdvogado: get("nomeAdvogado"),
    numeroOab: get("numeroOab"),
    ufOab: get("ufOab").toUpperCase(),
  };
}

// ---------------------------------------------------------------------------
// Conversão monitor ↔ filtros
// ---------------------------------------------------------------------------

export function filtrosDeMonitor(m: FiltrosMonitor): FiltrosDjen {
  return {
    ...FILTROS_VAZIOS,
    texto: m.texto ?? "",
    siglaTribunal: m.sigla_tribunal ?? "",
    orgaoId: m.orgao_id != null ? String(m.orgao_id) : "",
    orgaoNome: m.orgao_nome ?? "",
    meio: m.meio === "D" || m.meio === "E" ? m.meio : "",
    numeroProcesso: m.numero_processo ? mascararProcesso(m.numero_processo) : "",
    nomeParte: m.nome_parte ?? "",
    nomeAdvogado: m.nome_advogado ?? "",
    numeroOab: m.numero_oab ?? "",
    ufOab: m.uf_oab ?? "",
  };
}

export function normalizadosDeMonitor(m: FiltrosMonitor): FiltrosNormalizados {
  return normalizarFiltros(filtrosDeMonitor(m));
}

/** Filtros normalizados → colunas da tabela monitores (vazio = null). */
export function colunasMonitor(n: FiltrosNormalizados): FiltrosMonitor {
  return {
    texto: n.texto ?? null,
    sigla_tribunal: n.siglaTribunal ?? null,
    orgao_id: n.siglaTribunal && n.orgaoId ? n.orgaoId : null,
    orgao_nome: n.siglaTribunal && n.orgaoId ? (n.orgaoNome ?? null) : null,
    meio: n.meio ?? null,
    numero_processo: n.numeroProcesso ?? null,
    nome_parte: n.nomeParte ?? null,
    nome_advogado: n.nomeAdvogado ?? null,
    numero_oab: n.numeroOab ?? null,
    uf_oab: n.numeroOab ? (n.ufOab ?? null) : null,
  };
}

// ---------------------------------------------------------------------------
// Resumo legível ("OAB 146444/RJ · TJRJ · 3ª Vara Cível · Diário")
// ---------------------------------------------------------------------------

export interface ParteResumo {
  rotulo: string;
  valor: string;
}

export function partesResumo(n: FiltrosNormalizados, opcoes: { comDatas?: boolean } = {}): ParteResumo[] {
  const p: ParteResumo[] = [];
  if (n.numeroProcesso) p.push({ rotulo: "Processo", valor: mascararProcesso(n.numeroProcesso) });
  if (n.numeroOab) p.push({ rotulo: "OAB", valor: `OAB ${n.numeroOab}${n.ufOab ? `/${n.ufOab}` : ""}` });
  if (n.nomeAdvogado) p.push({ rotulo: "Advogado", valor: `Adv.: ${n.nomeAdvogado}` });
  if (n.nomeParte) p.push({ rotulo: "Parte", valor: `Parte: ${n.nomeParte}` });
  if (n.texto) p.push({ rotulo: "Teor", valor: `“${n.texto}”` });
  if (n.siglaTribunal) p.push({ rotulo: "Instituição", valor: n.siglaTribunal });
  if (n.orgaoId) p.push({ rotulo: "Órgão", valor: n.orgaoNome || `Órgão ${n.orgaoId}` });
  if (n.meio) {
    p.push({ rotulo: "Meio", valor: MEIOS_DJEN.find((m) => m.value === n.meio)?.curto ?? n.meio });
  }
  if (opcoes.comDatas && (n.dataInicio || n.dataFim)) {
    const br = (d?: string) => (d ? d.split("-").reverse().join("/") : "…");
    p.push({ rotulo: "Período", valor: `${br(n.dataInicio)} a ${br(n.dataFim)}` });
  }
  return p;
}

export function resumoFiltros(n: FiltrosNormalizados, opcoes: { comDatas?: boolean } = {}) {
  return partesResumo(n, opcoes)
    .map((x) => x.valor)
    .join(" · ");
}
