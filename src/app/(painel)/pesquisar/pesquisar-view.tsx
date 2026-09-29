"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GaugeIcon,
  LinkIcon,
  Loader2Icon,
  RadarIcon,
  RotateCwIcon,
  SearchIcon,
  TimerIcon,
} from "lucide-react";
import { toast } from "sonner";
import { EstadoVazio, PageHeader } from "@/components/comum";
import { FiltrosDjenForm } from "@/components/filtros-djen";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ErroDjen,
  LIMITE_RESULTADOS_API,
  obterRateLimit,
  pesquisarComunicacoes,
  segundosBloqueio,
  tamanhoPagina,
  type ResultadoPesquisa,
} from "@/lib/djen-api";
import {
  FILTROS_VAZIOS,
  filtrosDeQuery,
  filtrosParaQuery,
  resumoFiltros,
  temAlgumFiltro,
  temFiltroForte,
  validarFiltros,
  type ErrosFiltros,
  type FiltrosDjen,
  type FiltrosNormalizados,
} from "@/lib/filtros";
import { formatarNumero, pluralizar } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ResultadoCard } from "./resultado-card";

interface EstadoPesquisa {
  chave: string;
  dados?: ResultadoPesquisa;
  erro?: Error;
}

/** Executa a pesquisa na API do DJEN sempre que a chave (filtros + página) muda. */
function usePesquisaDjen(filtros: FiltrosNormalizados | null, pagina: number) {
  const chave = filtros ? JSON.stringify([filtros, pagina]) : null;
  const [versao, setVersao] = useState(0);
  const [estado, setEstado] = useState<EstadoPesquisa | null>(null);
  const chaveCompleta = chave === null ? null : `${versao}#${chave}`;

  useEffect(() => {
    if (chaveCompleta === null) return;
    const [f, p] = JSON.parse(chaveCompleta.slice(chaveCompleta.indexOf("#") + 1)) as [
      FiltrosNormalizados,
      number,
    ];
    const ctrl = new AbortController();
    pesquisarComunicacoes(f, p, ctrl.signal).then(
      (dados) => setEstado({ chave: chaveCompleta, dados }),
      (erro: unknown) => {
        if (ctrl.signal.aborted) return;
        setEstado((ant) => ({
          chave: chaveCompleta,
          // mantém o total anterior para a paginação não "sumir" em caso de erro
          dados: ant?.dados,
          erro: erro instanceof Error ? erro : new Error(String(erro)),
        }));
      },
    );
    return () => ctrl.abort();
  }, [chaveCompleta]);

  const atual = estado?.chave === chaveCompleta ? estado : null;
  return {
    dados: atual && !atual.erro ? atual.dados : undefined,
    anteriores: estado?.dados,
    erro: atual?.erro,
    carregando: chaveCompleta !== null && !atual,
    estado,
    repetir: useCallback(() => setVersao((v) => v + 1), []),
  };
}

/** Segundos restantes do bloqueio após HTTP 429 (atualiza a cada segundo enquanto > 0). */
function useSegundosBloqueio(gatilho: unknown) {
  const [seg, setSeg] = useState(0);
  useEffect(() => {
    const atualizar = () => {
      const s = segundosBloqueio();
      setSeg(s);
      return s;
    };
    const t0 = setTimeout(atualizar, 0);
    const id = setInterval(() => {
      if (atualizar() <= 0) clearInterval(id);
    }, 1000);
    return () => {
      clearTimeout(t0);
      clearInterval(id);
    };
  }, [gatilho]);
  return seg;
}

function lerPagina(sp: URLSearchParams) {
  const p = Number.parseInt(sp.get("pagina") ?? "1", 10);
  return Number.isFinite(p) && p > 0 ? Math.min(p, 2000) : 1;
}

export function PesquisarView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qs = searchParams.toString();

  // Filtros da URL (fonte da verdade da pesquisa executada; links compartilháveis)
  const filtrosUrl = useMemo(() => filtrosDeQuery(new URLSearchParams(qs)), [qs]);
  const pagina = useMemo(() => lerPagina(new URLSearchParams(qs)), [qs]);
  const validacaoUrl = useMemo(() => validarFiltros(filtrosUrl, "pesquisa"), [filtrosUrl]);
  const urlTemFiltros = useMemo(() => {
    const sp = new URLSearchParams(qs);
    sp.delete("pagina");
    return sp.size > 0;
  }, [qs]);
  const filtrosAtivos = validacaoUrl.ok && temAlgumFiltro(validacaoUrl.dados) ? validacaoUrl.dados : null;
  const chaveFiltrosUrl = useMemo(() => {
    const sp = new URLSearchParams(qs);
    sp.delete("pagina");
    return sp.toString();
  }, [qs]);

  // Estado do formulário; resincroniza quando os filtros da URL mudam (voltar/avançar, links).
  const [form, setForm] = useState<FiltrosDjen>(filtrosUrl);
  const [erros, setErros] = useState<ErrosFiltros>(() =>
    urlTemFiltros && !validacaoUrl.ok ? validacaoUrl.erros : {},
  );
  const [chaveForm, setChaveForm] = useState(chaveFiltrosUrl);
  if (chaveForm !== chaveFiltrosUrl) {
    setChaveForm(chaveFiltrosUrl);
    setForm(filtrosUrl);
    setErros(urlTemFiltros && !validacaoUrl.ok ? validacaoUrl.erros : {});
  }

  const pesquisa = usePesquisaDjen(filtrosAtivos, pagina);
  const segundos = useSegundosBloqueio(pesquisa.estado);
  const rateLimit = pesquisa.estado ? obterRateLimit() : null;
  const topoResultados = useRef<HTMLDivElement>(null);

  const navegar = (sp: URLSearchParams, rolar = false) => {
    const s = sp.toString();
    router.push(s ? `${pathname}?${s}` : pathname, { scroll: false });
    if (rolar) topoResultados.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const pesquisar = () => {
    const r = validarFiltros(form, "pesquisa");
    if (!r.ok) {
      setErros(r.erros);
      return;
    }
    setErros({});
    const sp = filtrosParaQuery(r.dados);
    if (sp.toString() === chaveFiltrosUrl && pagina === 1) {
      pesquisa.repetir(); // mesma pesquisa: consulta de novo
      return;
    }
    navegar(sp, true);
  };

  const limpar = () => {
    setForm(FILTROS_VAZIOS);
    setErros({});
    if (qs) navegar(new URLSearchParams());
  };

  const irParaPagina = (p: number) => {
    const sp = new URLSearchParams(chaveFiltrosUrl);
    if (p > 1) sp.set("pagina", String(p));
    navegar(sp, true);
  };

  const criarMonitor = () => {
    if (!filtrosAtivos) return;
    const sp = filtrosParaQuery(filtrosAtivos, { semDatas: true });
    router.push(`/monitores/?novo=1&${sp.toString()}`);
  };

  const copiarLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Link da pesquisa copiado.");
    } catch {
      toast.error("Não foi possível copiar o link.");
    }
  };

  const dados = pesquisa.dados;
  const exibidos = dados ?? (pesquisa.carregando ? pesquisa.anteriores : undefined);
  const porPagina = filtrosAtivos ? tamanhoPagina(filtrosAtivos) : 100;
  const totalConsultavel = Math.min(exibidos?.count ?? 0, LIMITE_RESULTADOS_API);
  const totalPaginas = Math.max(1, Math.ceil(totalConsultavel / porPagina));
  const erro = pesquisa.erro;
  const erroLimite = erro instanceof ErroDjen && erro.tipo === "limite";
  const bloqueio = segundos > 0 ? `Limite da API atingido — nova consulta em ${segundos} s.` : null;

  return (
    <div className="space-y-5">
      <PageHeader
        titulo="Pesquisar"
        descricao="Consulta direta à API pública do DJEN, com os mesmos filtros do site oficial (comunica.pje.jus.br)."
        acoes={rateLimit && <IndicadorLimite restantes={rateLimit.restantes} limite={rateLimit.limite} estimado={rateLimit.estimado} />}
      />

      <Card>
        <CardContent>
          <FiltrosDjenForm
            modo="pesquisa"
            valor={form}
            aoMudar={setForm}
            erros={erros}
            aoLimparErro={(c) => setErros((e) => ({ ...e, [c]: undefined }))}
            aoPesquisar={pesquisar}
            aoLimpar={limpar}
            pesquisando={pesquisa.carregando}
            pesquisaBloqueada={bloqueio}
          />
        </CardContent>
      </Card>

      <div ref={topoResultados} className="scroll-mt-20" />

      {!filtrosAtivos ? (
        urlTemFiltros && !validacaoUrl.ok ? (
          <Alert variant="destructive">
            <AlertTriangleIcon />
            <AlertTitle>Filtros do link inválidos</AlertTitle>
            <AlertDescription>Corrija os campos destacados e clique em Pesquisar.</AlertDescription>
          </Alert>
        ) : (
          <EstadoVazio
            icone={SearchIcon}
            titulo="Preencha um ou mais filtros e clique em Pesquisar"
            descricao="Os filtros funcionam sozinhos ou combinados. Os resultados vêm direto do DJEN e não são gravados no painel."
          />
        )
      ) : (
        <section className="space-y-4" aria-busy={pesquisa.carregando}>
          {/* Cabeçalho dos resultados */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-base font-semibold">
                {exibidos ? (
                  <>
                    {pluralizar(exibidos.count, "comunicação encontrada", "comunicações encontradas")}
                    {pesquisa.carregando && (
                      <Loader2Icon className="ml-2 inline size-4 animate-spin text-muted-foreground" aria-hidden />
                    )}
                  </>
                ) : pesquisa.carregando ? (
                  <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <Loader2Icon className="size-4 animate-spin" aria-hidden /> Consultando o DJEN…
                  </span>
                ) : (
                  "Resultados"
                )}
              </h2>
              <p className="mt-0.5 text-xs break-words text-muted-foreground">
                {resumoFiltros(filtrosAtivos, { comDatas: true })}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={copiarLink}>
                <LinkIcon /> Copiar link
              </Button>
              {temFiltroForte(filtrosAtivos) ? (
                <Button size="sm" onClick={criarMonitor}>
                  <RadarIcon /> Criar monitor com estes filtros
                </Button>
              ) : (
                <Tooltip>
                  <TooltipTrigger render={<span tabIndex={0} className="inline-flex" />}>
                    <Button size="sm" disabled>
                      <RadarIcon /> Criar monitor com estes filtros
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    Um monitor precisa de ao menos um destes filtros: teor, instituição, nº do processo,
                    parte, advogado ou OAB.
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>

          {porPagina === 5 && (
            <p className="text-xs text-muted-foreground">
              Sem teor, instituição, processo, parte, advogado ou OAB, a API do DJEN só devolve 5 resultados
              por página.
            </p>
          )}

          {exibidos && exibidos.count >= LIMITE_RESULTADOS_API && (
            <Alert>
              <AlertTriangleIcon />
              <AlertTitle>Resultado limitado a {formatarNumero(LIMITE_RESULTADOS_API)} comunicações</AlertTitle>
              <AlertDescription>
                A API do DJEN não devolve mais que isso para esta consulta. Refine os filtros ou reduza o
                período para ver tudo.
              </AlertDescription>
            </Alert>
          )}

          {erro && (
            <Alert variant="destructive">
              {erroLimite ? <TimerIcon /> : <AlertTriangleIcon />}
              <AlertTitle>{erroLimite ? "Muitas consultas em pouco tempo" : "Não foi possível consultar o DJEN"}</AlertTitle>
              <AlertDescription>
                <p>
                  {erroLimite
                    ? segundos > 0
                      ? `A API do DJEN permite 20 consultas por minuto. Aguarde ${segundos} s para tentar de novo.`
                      : "Pronto — já é possível tentar de novo."
                    : erro.message}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={pesquisa.repetir}
                  disabled={segundos > 0}
                >
                  <RotateCwIcon /> {segundos > 0 ? `Tentar novamente (${segundos} s)` : "Tentar novamente"}
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {!exibidos && pesquisa.carregando ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-48 w-full" />
              ))}
            </div>
          ) : exibidos && exibidos.items.length === 0 && !erro ? (
            <EstadoVazio
              titulo="Nenhuma comunicação encontrada"
              descricao="Tente outros filtros ou amplie o período."
            />
          ) : exibidos ? (
            <div className={cn("space-y-3 transition-opacity", pesquisa.carregando && "opacity-60")}>
              {exibidos.items.map((item) => (
                <ResultadoCard key={item.id} item={item} />
              ))}
            </div>
          ) : null}

          {exibidos && totalPaginas > 1 && (
            <nav
              className="flex flex-wrap items-center justify-between gap-2 border-t pt-4"
              aria-label="Paginação dos resultados"
            >
              <span className="text-sm text-muted-foreground">
                Página {formatarNumero(pagina)} de {formatarNumero(totalPaginas)} · {porPagina} por página
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => irParaPagina(pagina - 1)}
                  disabled={pagina <= 1 || pesquisa.carregando}
                >
                  <ChevronLeftIcon /> Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => irParaPagina(pagina + 1)}
                  disabled={pagina >= totalPaginas || pesquisa.carregando}
                >
                  Próxima <ChevronRightIcon />
                </Button>
              </div>
            </nav>
          )}
        </section>
      )}
    </div>
  );
}

function IndicadorLimite({
  restantes,
  limite,
  estimado,
}: {
  restantes: number | null;
  limite: number | null;
  estimado: boolean;
}) {
  if (restantes === null) return null;
  const baixo = restantes <= 3;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            variant="outline"
            className={cn("h-7 gap-1.5 px-2.5", baixo && "border-amber-500/50 text-amber-800 dark:text-amber-300")}
          />
        }
      >
        <GaugeIcon aria-hidden />
        {estimado ? "≈ " : ""}
        {restantes}/{limite ?? 20} consultas restantes
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        A API do DJEN permite {limite ?? 20} consultas por minuto.
        {estimado
          ? " O navegador não tem acesso ao contador oficial (x-ratelimit-remaining), então este número é uma estimativa com base nas consultas feitas nesta aba no último minuto."
          : " Valor informado pela API (x-ratelimit-remaining)."}
      </TooltipContent>
    </Tooltip>
  );
}
