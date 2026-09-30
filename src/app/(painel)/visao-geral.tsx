"use client";

import Link from "next/link";
import {
  ArrowRightIcon,
  CalendarDaysIcon,
  CalendarIcon,
  MailWarningIcon,
  MailXIcon,
  RadarIcon,
  RefreshCwIcon,
} from "lucide-react";
import { EstadoVazio, ErroCarregamento, PageHeader, StatusBadge } from "@/components/comum";
import { TabelaExecucoes } from "@/components/execucoes";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAgora, useIntervalo, useQuery } from "@/hooks/use-query";
import { useSincronizar } from "@/hooks/use-sincronizar";
import {
  formatarData,
  formatarDataHora,
  formatarNumero,
  hojeISO,
  pluralizar,
  processoExibicao,
  tempoRelativo,
} from "@/lib/format";
import { listarContas } from "@/lib/contas-envio";
import { erroDaResposta, supabase } from "@/lib/supabase";
import type { Comunicacao, SyncExecucao } from "@/lib/types";
import { cn } from "@/lib/utils";

type ComunicacaoResumo = Pick<
  Comunicacao,
  | "id"
  | "data_disponibilizacao"
  | "sigla_tribunal"
  | "tipo_comunicacao"
  | "numero_processo"
  | "numero_processo_mascara"
  | "nome_orgao"
  | "nome_classe"
  | "lida"
>;

interface Painel {
  hoje: number;
  semana: number;
  naoLidas: number;
  monitoresAtivos: number;
  recentes: ComunicacaoResumo[];
  execucoes: SyncExecucao[];
}

async function carregarPainel(): Promise<Painel> {
  const sb = supabase();
  const hoje = hojeISO();
  const seteDias = hojeISO(-6);
  const contar = () => sb.from("comunicacoes").select("id", { count: "exact", head: true });

  const [rHoje, rSemana, rNaoLidas, rMonitores, rRecentes, rExec] = await Promise.all([
    contar().eq("data_disponibilizacao", hoje),
    contar().gte("data_disponibilizacao", seteDias),
    contar().eq("lida", false),
    sb.from("monitores").select("id", { count: "exact", head: true }).eq("ativo", true),
    sb
      .from("comunicacoes")
      .select(
        "id,data_disponibilizacao,sigla_tribunal,tipo_comunicacao,numero_processo,numero_processo_mascara,nome_orgao,nome_classe,lida",
      )
      .order("data_disponibilizacao", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(8),
    sb.from("sync_execucoes").select("*").order("iniciada_em", { ascending: false }).limit(8),
  ]);

  const falha = [rHoje, rSemana, rNaoLidas, rMonitores, rRecentes, rExec].find((r) => r.error);
  if (falha) throw erroDaResposta(falha);

  return {
    hoje: rHoje.count ?? 0,
    semana: rSemana.count ?? 0,
    naoLidas: rNaoLidas.count ?? 0,
    monitoresAtivos: rMonitores.count ?? 0,
    recentes: (rRecentes.data ?? []) as ComunicacaoResumo[],
    execucoes: (rExec.data ?? []) as SyncExecucao[],
  };
}

/**
 * Nº de comunicações aguardando envio (com pelo menos um monitor vinculado — as sem vínculo não são
 * enviadas) quando não há nenhuma conta de envio ativa com Senha de App;
 * null quando não há o que avisar (ou quando não dá para saber — ex.: atualização do servidor pendente).
 */
async function carregarAvisoEnvio(): Promise<number | null> {
  try {
    const r = await listarContas();
    if (r.pendente) return null;
    if (r.contas.some((c) => c.ativo && c.senha_configurada)) return null;
    const q = await supabase()
      .from("comunicacoes")
      .select("id, monitor_comunicacoes!inner(monitor_id)", { count: "exact", head: true })
      .is("notificada_em", null);
    if (q.error) return null;
    return q.count ? q.count : null;
  } catch {
    return null;
  }
}

function Metrica({
  titulo,
  valor,
  icone: Icone,
  href,
  destaque,
  carregando,
  rodape,
}: {
  titulo: string;
  valor: React.ReactNode;
  icone: React.ComponentType<{ className?: string }>;
  href?: string;
  destaque?: boolean;
  carregando?: boolean;
  rodape?: React.ReactNode;
}) {
  const conteudo = (
    <Card
      size="sm"
      className={cn("h-full transition-colors", href && "hover:bg-muted/40", destaque && "ring-primary/30")}
    >
      <CardHeader>
        <CardDescription className="flex items-center gap-1.5">
          <Icone className="size-3.5" />
          {titulo}
        </CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums">
          {carregando ? <Skeleton className="h-8 w-16" /> : valor}
        </CardTitle>
      </CardHeader>
      {rodape && <CardContent className="text-xs text-muted-foreground">{rodape}</CardContent>}
    </Card>
  );
  return href ? (
    <Link href={href} className="block rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
      {conteudo}
    </Link>
  ) : (
    conteudo
  );
}

export function VisaoGeral() {
  const { dados, erro, carregandoInicial, carregando, recarregar } = useQuery("painel", carregarPainel);
  const { executando, executar } = useSincronizar(recarregar);
  const agora = useAgora();
  const avisoEnvio = useQuery("painel:aviso-envio", carregarAvisoEnvio);

  const ultima = dados?.execucoes[0];
  const emAndamento = ultima?.status === "executando";
  useIntervalo(recarregar, 10_000, emAndamento && executando === null);

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Visão geral"
        descricao="Resumo das comunicações encontradas no DJEN e das sincronizações."
        acoes={
          <>
            <Button variant="outline" size="icon" onClick={recarregar} aria-label="Atualizar dados" disabled={carregando}>
              <RefreshCwIcon className={cn(carregando && "animate-spin")} />
            </Button>
            <Button onClick={() => executar()} disabled={executando !== null || emAndamento}>
              <RefreshCwIcon className={cn(executando !== null && "animate-spin")} />
              {executando !== null ? "Sincronizando…" : "Sincronizar agora"}
            </Button>
          </>
        }
      />

      {erro && <ErroCarregamento mensagem={erro} aoTentarNovamente={recarregar} />}

      {!!avisoEnvio.dados && (
        <Alert className="border-warning/50">
          <MailXIcon className="text-warning-text" />
          <AlertTitle>
            Há {pluralizar(avisoEnvio.dados, "comunicação aguardando envio", "comunicações aguardando envio")}
          </AlertTitle>
          <AlertDescription>
            <p>
              Não há conta de envio ativa com Senha de App.{" "}
              <Link href="/configuracoes/" className="font-medium text-foreground underline underline-offset-2">
                Configure uma conta de envio em Configurações
              </Link>{" "}
              para receber os avisos.
            </p>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Metrica
          titulo="Hoje"
          icone={CalendarIcon}
          valor={formatarNumero(dados?.hoje)}
          carregando={carregandoInicial}
          href={`/comunicacoes/?de=${hojeISOClient(agora, 0)}`}
        />
        <Metrica
          titulo="Últimos 7 dias"
          icone={CalendarDaysIcon}
          valor={formatarNumero(dados?.semana)}
          carregando={carregandoInicial}
          href={`/comunicacoes/?de=${hojeISOClient(agora, -6)}`}
        />
        <Metrica
          titulo="Não lidas"
          icone={MailWarningIcon}
          valor={formatarNumero(dados?.naoLidas)}
          carregando={carregandoInicial}
          destaque={(dados?.naoLidas ?? 0) > 0}
          href="/comunicacoes/?naoLidas=1"
        />
        <Metrica
          titulo="Monitores ativos"
          icone={RadarIcon}
          valor={formatarNumero(dados?.monitoresAtivos)}
          carregando={carregandoInicial}
          href="/monitores/"
        />
        <Metrica
          titulo="Última sincronização"
          icone={RefreshCwIcon}
          carregando={carregandoInicial}
          href="/execucoes/"
          valor={
            ultima ? (
              <span className="text-base font-medium" title={formatarDataHora(ultima.iniciada_em)}>
                {agora ? tempoRelativo(ultima.finalizada_em ?? ultima.iniciada_em, agora) : formatarDataHora(ultima.iniciada_em)}
              </span>
            ) : (
              <span className="text-base font-medium text-muted-foreground">Nunca</span>
            )
          }
          rodape={ultima ? <StatusBadge status={ultima.status} /> : "Nenhuma execução registrada"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Comunicações recentes</CardTitle>
            <CardDescription>As mais novas por data de disponibilização.</CardDescription>
            <CardAction>
              <Link href="/comunicacoes/" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                Ver todas <ArrowRightIcon />
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
            {carregandoInicial ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : !dados?.recentes.length ? (
              <EstadoVazio
                titulo="Nenhuma comunicação ainda"
                descricao="Cadastre monitores e rode uma sincronização para começar."
                acao={
                  <Link href="/monitores/" className={buttonVariants({ variant: "outline", size: "sm" })}>
                    Cadastrar monitor
                  </Link>
                }
              />
            ) : (
              <ul className="-mx-2 divide-y">
                {dados.recentes.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/comunicacoes/?id=${c.id}`}
                      className="flex items-start gap-3 rounded-lg px-2 py-2.5 hover:bg-muted/50"
                    >
                      <span
                        className={cn(
                          "mt-1.5 size-2 shrink-0 rounded-full",
                          c.lida ? "bg-transparent" : "bg-primary",
                        )}
                        aria-label={c.lida ? undefined : "Não lida"}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className={cn("tabular-nums text-xs sm:text-sm", !c.lida && "font-semibold")}>
                            {processoExibicao(c)}
                          </span>
                          {c.sigla_tribunal && <Badge variant="outline">{c.sigla_tribunal}</Badge>}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {[c.tipo_comunicacao, c.nome_classe, c.nome_orgao].filter(Boolean).join(" · ") || "—"}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {formatarData(c.data_disponibilizacao)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Últimas execuções</CardTitle>
            <CardDescription>Automáticas (a cada 30 min) e manuais.</CardDescription>
            <CardAction>
              <Link href="/execucoes/" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                Histórico <ArrowRightIcon />
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
            {carregandoInicial ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : !dados?.execucoes.length ? (
              <EstadoVazio titulo="Nenhuma execução registrada" descricao="Use “Sincronizar agora” para a primeira busca." />
            ) : (
              <TabelaExecucoes execucoes={dados.execucoes} compacta />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** Data AAAA-MM-DD relativa a "agora" (só no cliente; vazio antes de montar). */
function hojeISOClient(agora: number | null, dias: number) {
  return agora === null ? "" : hojeISO(dias);
}
