// Cliente da API pública do DJEN (comunicaapi.pje.jus.br) para uso direto no navegador.
// A API responde com `Access-Control-Allow-Origin: *`, então o site estático pode chamá-la sem servidor.
// Sem dependências de React/DOM: também roda em Node (tsx) para testes.

import { temFiltroForte, type FiltrosNormalizados } from "./filtros";

export const DJEN_API_BASE = "https://comunicaapi.pje.jus.br/api/v1";

/** Limite de resultados que a API devolve em consultas textuais/OAB/processo ou com período. */
export const LIMITE_RESULTADOS_API = 10_000;
/** Limite de requisições por minuto informado pela API (x-ratelimit-limit). */
export const LIMITE_REQUISICOES_PADRAO = 20;
/** Espera recomendada após HTTP 429. */
export const ESPERA_429_SEGUNDOS = 60;

const TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Tipos da resposta
// ---------------------------------------------------------------------------

export interface DestinatarioDjen {
  nome?: string | null;
  polo?: string | null;
}

export interface AdvogadoDjen {
  advogado?: { nome?: string | null; numero_oab?: string | null; uf_oab?: string | null } | null;
}

export interface ItemDjen {
  id: number;
  hash?: string | null;
  data_disponibilizacao?: string | null; // AAAA-MM-DD
  datadisponibilizacao?: string | null; // DD/MM/AAAA
  siglaTribunal?: string | null;
  tipoComunicacao?: string | null;
  nomeOrgao?: string | null;
  idOrgao?: number | null;
  texto?: string | null;
  numero_processo?: string | null;
  numeroprocessocommascara?: string | null;
  meio?: string | null;
  meiocompleto?: string | null;
  link?: string | null;
  tipoDocumento?: string | null;
  nomeClasse?: string | null;
  numeroComunicacao?: number | null;
  destinatarios?: DestinatarioDjen[] | null;
  destinatarioadvogados?: AdvogadoDjen[] | null;
}

export interface RateLimit {
  limite: number | null;
  restantes: number | null;
  /**
   * true quando os valores são estimados localmente: a API não expõe os cabeçalhos
   * x-ratelimit-* via CORS (sem Access-Control-Expose-Headers), então o navegador não os lê.
   */
  estimado: boolean;
}

export interface ResultadoPesquisa {
  count: number;
  items: ItemDjen[];
  pagina: number;
  itensPorPagina: 5 | 100;
  rateLimit: RateLimit;
}

export interface InstituicaoDjen {
  sigla: string;
  nome: string;
  dataUltimoEnvio?: string | null;
}

export interface GrupoInstituicoes {
  uf: string; // "" = Nacional
  nomeEstado: string;
  instituicoes: InstituicaoDjen[];
}

export interface OrgaoDjen {
  id: number;
  nome: string;
}

// ---------------------------------------------------------------------------
// Erros amigáveis
// ---------------------------------------------------------------------------

export type TipoErroDjen = "limite" | "cliente" | "servidor" | "rede" | "resposta";

export class ErroDjen extends Error {
  readonly tipo: TipoErroDjen;
  readonly status?: number;
  /** Para `limite` (HTTP 429): segundos até poder tentar de novo. */
  readonly aguardarSegundos?: number;

  constructor(
    mensagem: string,
    opcoes: { tipo: TipoErroDjen; status?: number; aguardarSegundos?: number },
  ) {
    super(mensagem);
    this.name = "ErroDjen";
    this.tipo = opcoes.tipo;
    this.status = opcoes.status;
    this.aguardarSegundos = opcoes.aguardarSegundos;
  }
}

export function ehAbort(e: unknown) {
  return (
    typeof e === "object" &&
    e !== null &&
    "name" in e &&
    ((e as { name?: string }).name === "AbortError")
  );
}

// ---------------------------------------------------------------------------
// Controle local de rate limit
// ---------------------------------------------------------------------------

let bloqueadoAte = 0;
const historico: number[] = [];
let ultimoRateLimit: RateLimit | null = null;

function registrarRequisicao() {
  const agora = Date.now();
  historico.push(agora);
  while (historico.length && historico[0] < agora - 60_000) historico.shift();
}

function estimarRestantes() {
  const agora = Date.now();
  const recentes = historico.filter((t) => t >= agora - 60_000).length;
  return Math.max(0, LIMITE_REQUISICOES_PADRAO - recentes);
}

/** Segundos que ainda faltam para liberar novas consultas após um 429 (0 = liberado). */
export function segundosBloqueio(agora = Date.now()) {
  return Math.max(0, Math.ceil((bloqueadoAte - agora) / 1000));
}

/** Último rate limit conhecido (lido da resposta ou estimado). */
export function obterRateLimit(): RateLimit | null {
  return ultimoRateLimit;
}

function lerRateLimit(res: Response): RateLimit {
  const num = (v: string | null) => {
    if (v === null || v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const limite = num(res.headers.get("x-ratelimit-limit"));
  const restantes = num(res.headers.get("x-ratelimit-remaining"));
  const rl: RateLimit =
    restantes !== null
      ? { limite: limite ?? LIMITE_REQUISICOES_PADRAO, restantes, estimado: false }
      : { limite: LIMITE_REQUISICOES_PADRAO, restantes: estimarRestantes(), estimado: true };
  ultimoRateLimit = rl;
  return rl;
}

function bloquear(segundos: number) {
  bloqueadoAte = Math.max(bloqueadoAte, Date.now() + segundos * 1000);
  ultimoRateLimit = { limite: ultimoRateLimit?.limite ?? LIMITE_REQUISICOES_PADRAO, restantes: 0, estimado: false };
}

function erroDeLimite(segundos: number) {
  return new ErroDjen(
    `Limite de consultas da API do DJEN atingido (${LIMITE_REQUISICOES_PADRAO} por minuto). Aguarde ${segundos} s e tente novamente.`,
    { tipo: "limite", status: 429, aguardarSegundos: segundos },
  );
}

// ---------------------------------------------------------------------------
// Requisição base
// ---------------------------------------------------------------------------

function combinarSinais(sinal?: AbortSignal) {
  const timeout = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(TIMEOUT_MS) : undefined;
  if (!sinal) return timeout;
  if (!timeout) return sinal;
  return typeof AbortSignal.any === "function" ? AbortSignal.any([sinal, timeout]) : sinal;
}

async function mensagemDoCorpo(res: Response) {
  try {
    const texto = await res.text();
    try {
      const json = JSON.parse(texto) as { message?: unknown; mensagem?: unknown; error?: unknown };
      const m = json.message ?? json.mensagem ?? json.error;
      if (typeof m === "string" && m.trim()) return m.trim().slice(0, 300);
    } catch {
      /* não é JSON */
    }
    const limpo = texto.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    return limpo && limpo.length <= 200 ? limpo : "";
  } catch {
    return "";
  }
}

async function requisitar(url: string, opcoes: { sinal?: AbortSignal; contarLimite?: boolean } = {}) {
  const espera = segundosBloqueio();
  if (espera > 0) throw erroDeLimite(espera);

  let res: Response;
  try {
    if (opcoes.contarLimite) registrarRequisicao();
    res = await fetch(url, { method: "GET", signal: combinarSinais(opcoes.sinal) });
  } catch (e) {
    if (opcoes.sinal?.aborted) throw e; // cancelada pelo chamador
    if (e && typeof e === "object" && (e as { name?: string }).name === "TimeoutError") {
      throw new ErroDjen("A API do DJEN demorou demais para responder. Tente novamente em instantes.", {
        tipo: "rede",
      });
    }
    throw new ErroDjen(
      "Não foi possível conectar à API do DJEN. Verifique sua conexão com a internet ou tente novamente em instantes.",
      { tipo: "rede" },
    );
  }

  if (res.status === 429) {
    const retry = Number(res.headers.get("retry-after"));
    const segundos = Number.isFinite(retry) && retry > 0 && retry <= 600 ? Math.ceil(retry) : ESPERA_429_SEGUNDOS;
    bloquear(segundos);
    throw erroDeLimite(segundos);
  }

  if (!res.ok) {
    const detalhe = await mensagemDoCorpo(res);
    if (res.status >= 500) {
      throw new ErroDjen(
        `A API do DJEN está instável ou indisponível no momento (HTTP ${res.status}). Tente novamente mais tarde.`,
        { tipo: "servidor", status: res.status },
      );
    }
    const base =
      res.status === 404
        ? "Recurso não encontrado na API do DJEN"
        : res.status === 403
          ? "A API do DJEN recusou o acesso"
          : "A API do DJEN recusou a consulta";
    throw new ErroDjen(`${base} (HTTP ${res.status})${detalhe ? `: ${detalhe}` : "."}`, {
      tipo: "cliente",
      status: res.status,
    });
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ErroDjen("A API do DJEN devolveu uma resposta inválida. Tente novamente.", {
      tipo: "resposta",
      status: res.status,
    });
  }
  return { res, json };
}

// ---------------------------------------------------------------------------
// Pesquisa de comunicações
// ---------------------------------------------------------------------------

/** 100 itens por página quando há filtro "forte"; senão a API só aceita 5. */
export function tamanhoPagina(n: FiltrosNormalizados): 5 | 100 {
  return temFiltroForte(n) ? 100 : 5;
}

/** Monta os parâmetros da API omitindo filtros vazios. */
export function montarParametros(n: FiltrosNormalizados, pagina = 1): URLSearchParams {
  const sp = new URLSearchParams();
  const put = (k: string, v: string | number | undefined) => {
    if (v === undefined || v === null) return;
    const s = String(v).trim();
    if (s) sp.set(k, s);
  };
  put("texto", n.texto);
  put("siglaTribunal", n.siglaTribunal);
  if (n.siglaTribunal) put("orgaoId", n.orgaoId);
  put("meio", n.meio);
  put("dataDisponibilizacaoInicio", n.dataInicio);
  put("dataDisponibilizacaoFim", n.dataFim);
  put("numeroProcesso", n.numeroProcesso);
  put("nomeParte", n.nomeParte);
  put("nomeAdvogado", n.nomeAdvogado);
  put("numeroOab", n.numeroOab);
  if (n.numeroOab) put("ufOab", n.ufOab);
  put("pagina", Math.max(1, Math.floor(pagina)));
  put("itensPorPagina", tamanhoPagina(n));
  return sp;
}

export function urlPesquisa(n: FiltrosNormalizados, pagina = 1) {
  return `${DJEN_API_BASE}/comunicacao?${montarParametros(n, pagina).toString()}`;
}

export async function pesquisarComunicacoes(
  n: FiltrosNormalizados,
  pagina = 1,
  sinal?: AbortSignal,
): Promise<ResultadoPesquisa> {
  const { res, json } = await requisitar(urlPesquisa(n, pagina), { sinal, contarLimite: true });
  const rateLimit = lerRateLimit(res);
  const corpo = json as { status?: unknown; message?: unknown; count?: unknown; items?: unknown };
  if (corpo && typeof corpo === "object" && corpo.status && corpo.status !== "success") {
    const msg = typeof corpo.message === "string" && corpo.message ? corpo.message : "erro desconhecido";
    throw new ErroDjen(`A API do DJEN não concluiu a consulta: ${msg}`, { tipo: "resposta", status: res.status });
  }
  const items = Array.isArray(corpo?.items) ? (corpo.items as ItemDjen[]) : [];
  const count = typeof corpo?.count === "number" ? corpo.count : Number(corpo?.count) || items.length;
  return { count, items, pagina, itensPorPagina: tamanhoPagina(n), rateLimit };
}

// ---------------------------------------------------------------------------
// Listas auxiliares (cache em memória)
// ---------------------------------------------------------------------------

let cacheTribunais: Promise<GrupoInstituicoes[]> | null = null;
const cacheOrgaos = new Map<string, Promise<OrgaoDjen[]>>();

const colator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

/** Instituições agrupadas por UF ("Nacional" primeiro). Cacheado por sessão da página. */
export function listarTribunais(): Promise<GrupoInstituicoes[]> {
  if (!cacheTribunais) {
    cacheTribunais = requisitar(`${DJEN_API_BASE}/comunicacao/tribunal`).then(({ json }) => {
      if (!Array.isArray(json)) throw new ErroDjen("Lista de instituições inválida.", { tipo: "resposta" });
      const grupos = (json as Partial<GrupoInstituicoes>[])
        .map((g) => ({
          uf: typeof g.uf === "string" ? g.uf.trim() : "",
          nomeEstado: typeof g.nomeEstado === "string" && g.nomeEstado.trim() ? g.nomeEstado.trim() : "Nacional",
          instituicoes: (Array.isArray(g.instituicoes) ? g.instituicoes : [])
            .filter((i): i is InstituicaoDjen => !!i && typeof i.sigla === "string" && !!i.sigla.trim())
            .map((i) => ({ sigla: i.sigla.trim(), nome: (i.nome ?? i.sigla).trim(), dataUltimoEnvio: i.dataUltimoEnvio }))
            .sort((a, b) => colator.compare(a.sigla, b.sigla)),
        }))
        .filter((g) => g.instituicoes.length > 0);
      return grupos.sort((a, b) =>
        !a.uf ? -1 : !b.uf ? 1 : colator.compare(a.nomeEstado, b.nomeEstado),
      );
    });
    cacheTribunais.catch(() => {
      cacheTribunais = null; // permite nova tentativa
    });
  }
  return cacheTribunais;
}

/** Órgãos de uma instituição (ex.: TJRJ tem mais de 2.000). Cacheado por sigla. */
export function listarOrgaos(sigla: string): Promise<OrgaoDjen[]> {
  const chave = sigla.trim().toUpperCase();
  if (!chave) return Promise.resolve([]);
  let p = cacheOrgaos.get(chave);
  if (!p) {
    p = requisitar(`${DJEN_API_BASE}/orgaos/${encodeURIComponent(chave)}`).then(({ json }) => {
      if (!Array.isArray(json)) throw new ErroDjen("Lista de órgãos inválida.", { tipo: "resposta" });
      return (json as Partial<OrgaoDjen>[])
        .map((o) => ({ id: Number(o.id), nome: typeof o.nome === "string" ? o.nome.trim() : "" }))
        .filter((o) => Number.isSafeInteger(o.id) && o.id > 0 && o.nome)
        .sort((a, b) => colator.compare(a.nome, b.nome));
    });
    cacheOrgaos.set(chave, p);
    p.catch(() => cacheOrgaos.delete(chave));
  }
  return p;
}

