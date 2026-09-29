"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  CopyIcon,
  ExternalLinkIcon,
  FileBadgeIcon,
  FileTextIcon,
  MailIcon,
  MailOpenIcon,
} from "lucide-react";
import { toast } from "sonner";
import { ErroCarregamento } from "@/components/comum";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@/hooks/use-query";
import { normalizadosDeMonitor, resumoFiltros } from "@/lib/filtros";
import {
  formatarData,
  formatarDataHora,
  htmlParaTexto,
  processoExibicao,
  ROTULO_MEIO,
  urlCertidao,
  urlSegura,
} from "@/lib/format";
import { mensagemErro, supabase } from "@/lib/supabase";
import type { Comunicacao, FiltrosMonitor, Monitor } from "@/lib/types";

const COLUNAS_MONITOR =
  "id,nome,texto,sigla_tribunal,orgao_id,orgao_nome,meio,numero_processo,nome_parte,nome_advogado,numero_oab,uf_oab";

type Detalhe = Comunicacao & {
  monitor_comunicacoes: {
    created_at: string;
    monitores: Pick<Monitor, "id" | "nome" | keyof FiltrosMonitor> | null;
  }[];
};

async function buscarDetalhe(id: number): Promise<Detalhe | null> {
  const { data, error } = await supabase()
    .from("comunicacoes")
    .select(`*, monitor_comunicacoes(created_at, monitores(${COLUNAS_MONITOR}))`)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as Detalhe) ?? null;
}

export function ComunicacaoDetalhe({
  id,
  aoFechar,
  aoAlterar,
}: {
  id: number | null;
  aoFechar: () => void;
  aoAlterar?: () => void;
}) {
  const aberto = id !== null;
  return (
    <Sheet open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <SheetContent
        side="right"
        className="w-full gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl"
      >
        {id !== null && <Conteudo key={id} id={id} aoAlterar={aoAlterar} />}
      </SheetContent>
    </Sheet>
  );
}

function Conteudo({ id, aoAlterar }: { id: number; aoAlterar?: () => void }) {
  const { dados, erro, carregandoInicial, recarregar } = useQuery(`comunicacao:${id}`, () =>
    buscarDetalhe(id),
  );
  const [lidaLocal, setLidaLocal] = useState<boolean | null>(null);
  const [salvando, setSalvando] = useState(false);
  const autoMarcada = useRef(false);
  const aoAlterarRef = useRef(aoAlterar);
  useEffect(() => {
    aoAlterarRef.current = aoAlterar;
  });

  const lida = lidaLocal ?? dados?.lida ?? false;

  // Ao abrir uma comunicação não lida, marca como lida automaticamente.
  useEffect(() => {
    if (!dados || dados.lida || autoMarcada.current) return;
    autoMarcada.current = true;
    supabase()
      .from("comunicacoes")
      .update({ lida: true })
      .eq("id", dados.id)
      .then(({ error }) => {
        if (!error) {
          setLidaLocal(true);
          aoAlterarRef.current?.();
        }
      });
  }, [dados]);

  const texto = useMemo(() => htmlParaTexto(dados?.texto), [dados?.texto]);

  const alternarLida = async () => {
    if (!dados) return;
    setSalvando(true);
    const { error } = await supabase().from("comunicacoes").update({ lida: !lida }).eq("id", dados.id);
    setSalvando(false);
    if (error) {
      toast.error("Não foi possível atualizar", { description: mensagemErro(error) });
      return;
    }
    setLidaLocal(!lida);
    toast.success(!lida ? "Marcada como lida." : "Marcada como não lida.");
    aoAlterar?.();
  };

  const copiar = async (valor: string) => {
    try {
      await navigator.clipboard.writeText(valor);
      toast.success("Número copiado.");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };

  if (carregandoInicial) {
    return (
      <>
        <SheetHeader className="pr-12">
          <SheetTitle>Carregando comunicação…</SheetTitle>
          <SheetDescription className="sr-only">Carregando</SheetDescription>
        </SheetHeader>
        <div className="space-y-3 px-4">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </>
    );
  }

  if (erro || !dados) {
    return (
      <>
        <SheetHeader className="pr-12">
          <SheetTitle>Comunicação</SheetTitle>
          <SheetDescription className="sr-only">Detalhe</SheetDescription>
        </SheetHeader>
        <div className="px-4">
          {erro ? (
            <ErroCarregamento mensagem={erro} aoTentarNovamente={recarregar} />
          ) : (
            <p className="text-sm text-muted-foreground">Comunicação não encontrada.</p>
          )}
        </div>
      </>
    );
  }

  const processo = processoExibicao(dados);
  const linkTeor = urlSegura(dados.link);
  const linkCertidao = urlCertidao(dados.hash);
  const destinatarios = Array.isArray(dados.destinatarios) ? dados.destinatarios : [];
  const advogados = Array.isArray(dados.advogados) ? dados.advogados : [];
  const monitores = (dados.monitor_comunicacoes ?? []).filter((m) => m.monitores);

  return (
    <>
      <SheetHeader className="border-b pr-12">
        <div className="flex flex-wrap items-center gap-1.5">
          {dados.sigla_tribunal && <Badge>{dados.sigla_tribunal}</Badge>}
          {dados.tipo_comunicacao && <Badge variant="secondary">{dados.tipo_comunicacao}</Badge>}
          {dados.meio && <Badge variant="outline">{ROTULO_MEIO[dados.meio] ?? dados.meio}</Badge>}
          <Badge
            variant="outline"
            className={lida ? "text-muted-foreground" : "border-sky-500/40 text-sky-700 dark:text-sky-300"}
          >
            {lida ? "Lida" : "Não lida"}
          </Badge>
        </div>
        <SheetTitle className="mt-2 flex items-center gap-1 font-mono text-base break-all">
          {processo}
          {processo !== "—" && (
            <Button variant="ghost" size="icon-xs" aria-label="Copiar número do processo" onClick={() => copiar(processo)}>
              <CopyIcon />
            </Button>
          )}
        </SheetTitle>
        <SheetDescription>
          Disponibilizada em {formatarData(dados.data_disponibilizacao)}
          {dados.nome_classe ? ` · ${dados.nome_classe}` : ""}
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
        <div className="flex flex-wrap gap-2">
          {linkTeor && (
            <a href={linkTeor} target="_blank" rel="noopener noreferrer" className={buttonVariants({ size: "sm" })}>
              <FileTextIcon /> Inteiro teor <ExternalLinkIcon className="opacity-60" />
            </a>
          )}
          {linkCertidao && (
            <a
              href={linkCertidao}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <FileBadgeIcon /> Certidão <ExternalLinkIcon className="opacity-60" />
            </a>
          )}
          <Button variant="outline" size="sm" onClick={alternarLida} disabled={salvando}>
            {lida ? <MailIcon /> : <MailOpenIcon />}
            {lida ? "Marcar como não lida" : "Marcar como lida"}
          </Button>
        </div>

        <dl className="grid grid-cols-1 gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
          <Item rotulo="Órgão">{dados.nome_orgao}</Item>
          <Item rotulo="Classe">{dados.nome_classe}</Item>
          <Item rotulo="Tipo de documento">{dados.tipo_documento}</Item>
          <Item rotulo="Nº da comunicação">{dados.numero_comunicacao?.toString()}</Item>
          <Item rotulo="ID no DJEN">{dados.djen_id?.toString()}</Item>
          <Item rotulo="Registrada no painel">{formatarDataHora(dados.created_at)}</Item>
          <Item rotulo="Notificada por e-mail">
            {dados.notificada_em ? formatarDataHora(dados.notificada_em) : "Ainda não"}
          </Item>
        </dl>

        <Separator />

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Encontrada pelos monitores</h3>
          {monitores.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum monitor vinculado.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {monitores.map(({ monitores: m }) => (
                <Link
                  key={m!.id}
                  href={`/comunicacoes/?monitor=${m!.id}`}
                  className={buttonVariants({ variant: "secondary", size: "xs", className: "max-w-full" })}
                  title={resumoFiltros(normalizadosDeMonitor(m!))}
                >
                  <span className="truncate">{m!.nome}</span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Partes / destinatários</h3>
          {destinatarios.length === 0 ? (
            <p className="text-sm text-muted-foreground">Não informado.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {destinatarios.map((d, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="break-words">{d.nome || "—"}</span>
                  {d.polo && <span className="text-xs text-muted-foreground">Polo {poloRotulo(d.polo)}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Advogados</h3>
          {advogados.length === 0 ? (
            <p className="text-sm text-muted-foreground">Não informado.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {advogados.map((a, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="break-words">{a.nome || "—"}</span>
                  {(a.numero_oab || a.uf_oab) && (
                    <span className="text-xs text-muted-foreground">
                      OAB {[a.numero_oab, a.uf_oab].filter(Boolean).join("/")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <Separator />

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Texto da comunicação</h3>
          {texto ? (
            <div className="rounded-lg border bg-muted/30 p-3 text-sm leading-relaxed break-words whitespace-pre-wrap">
              {texto}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Sem texto disponível.</p>
          )}
        </section>
      </div>
    </>
  );
}

function poloRotulo(p: string) {
  const v = p.toUpperCase();
  if (v === "A" || v === "ATIVO") return "ativo";
  if (v === "P" || v === "PASSIVO") return "passivo";
  return p;
}

function Item({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="mt-0.5 break-words">{children || "—"}</dd>
    </div>
  );
}
