// Cliente da API pública do DJEN/CNJ (https://comunicaapi.pje.jus.br).
//
// - Paginação com itensPorPagina=100.
// - Controle de taxa: lê x-ratelimit-remaining; se <= limiar, pausa antes da próxima
//   requisição. Em 429, aguarda 60 s e tenta de novo (até max429 vezes).
// - Timeout por requisição e retry com backoff exponencial para 5xx/erros de rede.
// - Orçamento de tempo (prazo absoluto): se o tempo acabar, para de forma limpa e
//   o resultado é marcado como "parcial" (os itens já obtidos são devolvidos).
// - Consultas com >= 10.000 resultados num intervalo de vários dias são
//   subdivididas automaticamente por dia (a API limita essas consultas a 10.000).
//
// Portável: usa apenas fetch/AbortSignal/URLSearchParams (Deno e Node >= 18).

import { diasEntre, somarDias } from './datas.ts';
import { somenteDigitos } from './texto.ts';
import type { ItemDjen, Monitor, RespostaDjen } from './tipos.ts';

export const DJEN_BASE_URL = 'https://comunicaapi.pje.jus.br';
export const DJEN_LIMITE_RESULTADOS = 10_000;
export const DJEN_ITENS_POR_PAGINA = 100;
export const USER_AGENT_PADRAO =
  'DJEN-Monitor/1.0 (monitoramento automatizado de comunicacoes processuais; baixo volume)';

export interface ParametrosConsulta {
  numeroOab?: string;
  ufOab?: string;
  nomeAdvogado?: string;
  nomeParte?: string;
  numeroProcesso?: string;
  texto?: string;
  siglaTribunal?: string;
  meio?: 'D' | 'E';
}

export interface OpcoesCliente {
  baseUrl?: string;
  userAgent?: string;
  /** Timeout de cada requisição (ms). Padrão 30 s. */
  timeoutMs?: number;
  /** Prazo absoluto (epoch ms). Sem prazo se omitido. */
  prazo?: number;
  /** Se x-ratelimit-remaining <= este valor, pausa antes da próxima requisição. Padrão 2. */
  limiarRestantes?: number;
  /** Pausa ao atingir o limite ou receber 429 (ms). Padrão 60 s (orientação do CNJ). */
  pausaRateLimitMs?: number;
  /** Quantas vezes tentar de novo após 429. Padrão 2. */
  max429?: number;
  /** Tentativas extras para 5xx/erros de rede. Padrão 3. */
  maxTentativas?: number;
  /** Base do backoff exponencial (ms). Padrão 2 s (2, 4, 8...). */
  backoffBaseMs?: number;
  /** Intervalo mínimo entre requisições (ms). Padrão 300. */
  intervaloMinimoMs?: number;
  fetch?: typeof fetch;
  dormir?: (ms: number) => Promise<void>;
  agora?: () => number;
  log?: (msg: string) => void;
}

export class PrazoEsgotadoError extends Error {
  constructor(msg = 'Orçamento de tempo esgotado') {
    super(msg);
    this.name = 'PrazoEsgotadoError';
  }
}

export class ErroDjen extends Error {
  constructor(
    msg: string,
    public readonly status: number | null = null,
  ) {
    super(msg);
    this.name = 'ErroDjen';
  }
}

export interface ResultadoBusca {
  itens: ItemDjen[];
  requisicoes: number;
  /** `count` informado pela API na primeira consulta (limitado a 10.000 pela API). */
  totalInformado: number;
  /** A consulta foi subdividida por dia por ter atingido 10.000 resultados. */
  subdividido: boolean;
  /** Mesmo após subdividir, algum dia ainda atingiu 10.000 (resultados podem faltar). */
  truncado: boolean;
  /** O prazo acabou antes de terminar (itens devolvidos são só parte do total). */
  parcial: boolean;
  erro: string | null;
  intervalo: { inicio: string; fim: string };
}

const dormirPadrao = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class ClienteDjen {
  /** Total de requisições HTTP enviadas por esta instância. */
  requisicoes = 0;
  /** Último x-ratelimit-limit / x-ratelimit-remaining observado. */
  limiteJanela: number | null = null;
  restantesJanela: number | null = null;

  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly prazo: number;
  private readonly limiarRestantes: number;
  private readonly pausaRateLimitMs: number;
  private readonly max429: number;
  private readonly maxTentativas: number;
  private readonly backoffBaseMs: number;
  private readonly intervaloMinimoMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly dormirFn: (ms: number) => Promise<void>;
  private readonly agora: () => number;
  private readonly log: (msg: string) => void;
  private ultimaRequisicaoEm = 0;

  constructor(op: OpcoesCliente = {}) {
    this.baseUrl = (op.baseUrl ?? DJEN_BASE_URL).replace(/\/+$/, '');
    this.userAgent = op.userAgent ?? USER_AGENT_PADRAO;
    this.timeoutMs = op.timeoutMs ?? 30_000;
    this.prazo = op.prazo ?? Number.POSITIVE_INFINITY;
    this.limiarRestantes = op.limiarRestantes ?? 2;
    this.pausaRateLimitMs = op.pausaRateLimitMs ?? 60_000;
    this.max429 = op.max429 ?? 2;
    this.maxTentativas = op.maxTentativas ?? 3;
    this.backoffBaseMs = op.backoffBaseMs ?? 2_000;
    this.intervaloMinimoMs = op.intervaloMinimoMs ?? 300;
    this.fetchFn = op.fetch ?? ((input, init) => fetch(input, init));
    this.dormirFn = op.dormir ?? dormirPadrao;
    this.agora = op.agora ?? (() => Date.now());
    this.log = op.log ?? (() => {});
  }

  /** Milissegundos restantes até o prazo. */
  tempoRestante(): number {
    return this.prazo - this.agora();
  }

  /** Espera `ms`, mas lança PrazoEsgotadoError se a espera ultrapassar o prazo. */
  private async esperar(ms: number, motivo: string): Promise<void> {
    if (ms <= 0) return;
    if (this.agora() + ms > this.prazo) {
      throw new PrazoEsgotadoError(`Orçamento de tempo insuficiente para aguardar ${Math.ceil(ms / 1000)} s (${motivo})`);
    }
    if (ms >= 1_000) this.log(`aguardando ${Math.ceil(ms / 1000)} s: ${motivo}`);
    await this.dormirFn(ms);
  }

  private lerCabecalhosTaxa(resp: Response): void {
    const lim = Number(resp.headers.get('x-ratelimit-limit'));
    const rest = resp.headers.get('x-ratelimit-remaining');
    if (Number.isFinite(lim) && lim > 0) this.limiteJanela = lim;
    if (rest !== null && rest !== '' && Number.isFinite(Number(rest))) this.restantesJanela = Number(rest);
  }

  /** Antes de cada requisição: respeita o limite da janela e o intervalo mínimo. */
  private async aguardarJanela(): Promise<void> {
    if (this.restantesJanela !== null && this.restantesJanela <= this.limiarRestantes) {
      await this.esperar(
        this.pausaRateLimitMs,
        `limite de taxa quase esgotado (x-ratelimit-remaining=${this.restantesJanela})`,
      );
      this.restantesJanela = null; // desconhecido até a próxima resposta
    }
    const desde = this.agora() - this.ultimaRequisicaoEm;
    if (desde < this.intervaloMinimoMs) await this.esperar(this.intervaloMinimoMs - desde, 'intervalo mínimo');
  }

  montarUrl(params: ParametrosConsulta, inicio: string, fim: string, pagina: number): string {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && String(v).trim() !== '') q.set(k, String(v).trim());
    }
    q.set('dataDisponibilizacaoInicio', inicio);
    q.set('dataDisponibilizacaoFim', fim);
    q.set('pagina', String(pagina));
    q.set('itensPorPagina', String(DJEN_ITENS_POR_PAGINA));
    return `${this.baseUrl}/api/v1/comunicacao?${q.toString()}`;
  }

  /** Uma página de resultados, com controle de taxa, timeout e retries. */
  async consultar(params: ParametrosConsulta, inicio: string, fim: string, pagina: number): Promise<RespostaDjen> {
    const url = this.montarUrl(params, inicio, fim, pagina);
    let tentativas429 = 0;
    let tentativasErro = 0;

    while (true) {
      await this.aguardarJanela();
      const restante = this.tempoRestante();
      if (restante < 2_000) throw new PrazoEsgotadoError();
      const timeout = Math.min(this.timeoutMs, restante - 500);

      let resp: Response;
      this.ultimaRequisicaoEm = this.agora();
      this.requisicoes++;
      try {
        resp = await this.fetchFn(url, {
          method: 'GET',
          headers: { Accept: 'application/json', 'User-Agent': this.userAgent },
          signal: AbortSignal.timeout(timeout),
        });
      } catch (e) {
        if (this.tempoRestante() < 2_000) throw new PrazoEsgotadoError();
        tentativasErro++;
        const msg = descreverErro(e);
        if (tentativasErro > this.maxTentativas) throw new ErroDjen(`Falha de rede ao consultar o DJEN: ${msg}`);
        await this.esperar(this.backoffBaseMs * 2 ** (tentativasErro - 1), `erro de rede (${msg}), nova tentativa`);
        continue;
      }

      this.lerCabecalhosTaxa(resp);

      if (resp.status === 429) {
        await resp.body?.cancel().catch(() => {});
        this.restantesJanela = 0;
        tentativas429++;
        if (tentativas429 > this.max429) {
          throw new ErroDjen('DJEN recusou por excesso de requisições (429) repetidamente', 429);
        }
        await this.esperar(this.pausaRateLimitMs, 'HTTP 429 (excesso de requisições)');
        this.restantesJanela = null;
        continue;
      }

      if (resp.status >= 500) {
        await resp.body?.cancel().catch(() => {});
        tentativasErro++;
        if (tentativasErro > this.maxTentativas) {
          throw new ErroDjen(`DJEN indisponível (HTTP ${resp.status})`, resp.status);
        }
        await this.esperar(this.backoffBaseMs * 2 ** (tentativasErro - 1), `HTTP ${resp.status}, nova tentativa`);
        continue;
      }

      let corpoTexto: string;
      try {
        corpoTexto = await resp.text();
      } catch (e) {
        if (this.tempoRestante() < 2_000) throw new PrazoEsgotadoError();
        tentativasErro++;
        if (tentativasErro > this.maxTentativas) throw new ErroDjen(`Falha ao ler resposta do DJEN: ${descreverErro(e)}`);
        await this.esperar(this.backoffBaseMs * 2 ** (tentativasErro - 1), 'falha ao ler resposta');
        continue;
      }

      if (!resp.ok) {
        const dica =
          resp.status === 403 ? ' — acesso negado; possível bloqueio de IP/região (a função deve rodar em sa-east-1)' : '';
        throw new ErroDjen(`DJEN respondeu HTTP ${resp.status}: ${resumir(corpoTexto)}${dica}`, resp.status);
      }

      let json: Partial<RespostaDjen>;
      try {
        json = JSON.parse(corpoTexto);
      } catch {
        throw new ErroDjen(`Resposta do DJEN não é JSON: ${resumir(corpoTexto)}`, resp.status);
      }
      if (json.status && json.status !== 'success') {
        throw new ErroDjen(`DJEN retornou status "${json.status}": ${json.message ?? ''}`.trim(), resp.status);
      }
      return {
        status: json.status ?? 'success',
        message: json.message,
        count: Number(json.count) || 0,
        items: Array.isArray(json.items) ? json.items : [],
      };
    }
  }

  /** Percorre todas as páginas de um intervalo. Devolve se o total atingiu o limite de 10.000. */
  private async paginar(
    params: ParametrosConsulta,
    inicio: string,
    fim: string,
    primeira: RespostaDjen | null,
    acumulador: Map<number, ItemDjen>,
  ): Promise<{ truncado: boolean }> {
    let resp = primeira ?? (await this.consultar(params, inicio, fim, 1));
    const total = resp.count;
    adicionar(acumulador, resp.items);
    const paginas = Math.ceil(Math.min(total, DJEN_LIMITE_RESULTADOS) / DJEN_ITENS_POR_PAGINA);
    for (let p = 2; p <= paginas; p++) {
      if (resp.items.length < DJEN_ITENS_POR_PAGINA) break; // última página já veio
      resp = await this.consultar(params, inicio, fim, p);
      if (resp.items.length === 0) break;
      adicionar(acumulador, resp.items);
    }
    return { truncado: total >= DJEN_LIMITE_RESULTADOS };
  }

  /**
   * Busca tudo no intervalo [inicio, fim]. Uma única consulta paginada; se a API
   * informar >= 10.000 resultados e o intervalo tiver mais de um dia, refaz por dia
   * (do mais recente para o mais antigo). Nunca lança: erros e prazo vão no resultado.
   */
  async buscar(params: ParametrosConsulta, inicio: string, fim: string): Promise<ResultadoBusca> {
    const reqAntes = this.requisicoes;
    const itens = new Map<number, ItemDjen>();
    const r: ResultadoBusca = {
      itens: [],
      requisicoes: 0,
      totalInformado: 0,
      subdividido: false,
      truncado: false,
      parcial: false,
      erro: null,
      intervalo: { inicio, fim },
    };
    try {
      const primeira = await this.consultar(params, inicio, fim, 1);
      r.totalInformado = primeira.count;
      if (primeira.count >= DJEN_LIMITE_RESULTADOS && inicio !== fim) {
        r.subdividido = true;
        this.log(`consulta atingiu ${primeira.count} resultados; subdividindo ${inicio}..${fim} por dia`);
        for (const dia of diasEntre(inicio, fim).reverse()) {
          const { truncado } = await this.paginar(params, dia, dia, null, itens);
          if (truncado) r.truncado = true;
        }
      } else {
        const { truncado } = await this.paginar(params, inicio, fim, primeira, itens);
        r.truncado = truncado;
      }
    } catch (e) {
      if (e instanceof PrazoEsgotadoError) {
        r.parcial = true;
        this.log(`prazo esgotado: ${e.message}`);
      } else {
        r.erro = descreverErro(e);
      }
    }
    r.itens = [...itens.values()];
    r.requisicoes = this.requisicoes - reqAntes;
    return r;
  }

  /** Busca as comunicações de um monitor no intervalo [hoje - dias_retroativos, hoje]. */
  async buscarMonitor(
    monitor: Pick<Monitor, 'tipo' | 'valor' | 'uf_oab' | 'sigla_tribunal' | 'dias_retroativos'>,
    hoje: string,
  ): Promise<ResultadoBusca> {
    const { inicio, fim } = intervaloDoMonitor(monitor.dias_retroativos, hoje);
    let params: ParametrosConsulta;
    try {
      params = parametrosDoMonitor(monitor);
    } catch (e) {
      return {
        itens: [],
        requisicoes: 0,
        totalInformado: 0,
        subdividido: false,
        truncado: false,
        parcial: false,
        erro: descreverErro(e),
        intervalo: { inicio, fim },
      };
    }
    return this.buscar(params, inicio, fim);
  }
}

export function intervaloDoMonitor(diasRetroativos: number, hoje: string): { inicio: string; fim: string } {
  const dias = Math.max(0, Math.min(30, Math.floor(Number(diasRetroativos) || 0)));
  return { inicio: somarDias(hoje, -dias), fim: hoje };
}

/** Converte o monitor nos parâmetros de consulta da API. Lança Error se inválido. */
export function parametrosDoMonitor(
  m: Pick<Monitor, 'tipo' | 'valor' | 'uf_oab' | 'sigla_tribunal'>,
): ParametrosConsulta {
  const valor = (m.valor ?? '').trim().replace(/\s+/g, ' ');
  if (!valor) throw new Error('Monitor sem valor de busca');
  const p: ParametrosConsulta = {};
  switch (m.tipo) {
    case 'oab': {
      const numero = valor.replace(/[^0-9a-z]/gi, '').toUpperCase().replace(/^0+(?=\d)/, '');
      const uf = (m.uf_oab ?? '').trim().toUpperCase();
      if (!numero) throw new Error('Número de OAB inválido');
      if (!/^[A-Z]{2}$/.test(uf)) throw new Error('UF da OAB inválida ou ausente');
      p.numeroOab = numero;
      p.ufOab = uf;
      break;
    }
    case 'advogado':
      p.nomeAdvogado = valor;
      break;
    case 'parte':
      p.nomeParte = valor;
      break;
    case 'processo': {
      const digitos = somenteDigitos(valor);
      if (!digitos) throw new Error('Número de processo inválido');
      p.numeroProcesso = digitos;
      break;
    }
    case 'texto':
      p.texto = valor;
      break;
    default:
      throw new Error(`Tipo de monitor desconhecido: ${String((m as { tipo: unknown }).tipo)}`);
  }
  const sigla = (m.sigla_tribunal ?? '').trim().toUpperCase();
  if (sigla) p.siglaTribunal = sigla;
  return p;
}

function adicionar(acc: Map<number, ItemDjen>, itens: ItemDjen[]): void {
  for (const it of itens) {
    const id = Number(it?.id);
    if (Number.isFinite(id)) acc.set(id, it);
  }
}

function resumir(s: string, max = 300): string {
  const t = s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

export function descreverErro(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') return 'tempo limite da requisição excedido';
    const causa = (e as { cause?: unknown }).cause;
    const detalhe = causa instanceof Error ? `: ${causa.message}` : '';
    return `${e.message}${detalhe}`;
  }
  return String(e);
}
