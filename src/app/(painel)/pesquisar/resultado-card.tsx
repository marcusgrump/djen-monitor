"use client";

import { useMemo, useState } from "react";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  ExternalLinkIcon,
  FileBadgeIcon,
  FileTextIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { ItemDjen } from "@/lib/djen-api";
import {
  formatarData,
  htmlParaTexto,
  mascararProcesso,
  ROTULO_MEIO,
  urlCertidao,
  urlSegura,
} from "@/lib/format";

const TAMANHO_TRECHO = 420;
const MAX_NOMES = 4;

function poloRotulo(p?: string | null) {
  const v = (p ?? "").toUpperCase();
  if (v === "A" || v === "ATIVO") return "Polo ativo";
  if (v === "P" || v === "PASSIVO") return "Polo passivo";
  return p || null;
}

export function ResultadoCard({ item }: { item: ItemDjen }) {
  const [expandido, setExpandido] = useState(false);
  const texto = useMemo(() => htmlParaTexto(item.texto), [item.texto]);
  const longo = texto.length > TAMANHO_TRECHO;
  const exibido = expandido || !longo ? texto : `${texto.slice(0, TAMANHO_TRECHO).trimEnd()}…`;

  const processo =
    item.numeroprocessocommascara || mascararProcesso(item.numero_processo) || item.numero_processo || "";
  const linkTeor = urlSegura(item.link);
  const linkCertidao = urlCertidao(item.hash);
  const meio = item.meio ? (ROTULO_MEIO[item.meio] ?? item.meio) : null;

  const partes = (Array.isArray(item.destinatarios) ? item.destinatarios : []).filter((d) => d?.nome);
  const advogados = (Array.isArray(item.destinatarioadvogados) ? item.destinatarioadvogados : [])
    .map((a) => a?.advogado)
    .filter((a): a is NonNullable<typeof a> => !!a?.nome);
  const partesVisiveis = expandido ? partes : partes.slice(0, MAX_NOMES);
  const advVisiveis = expandido ? advogados : advogados.slice(0, MAX_NOMES);
  const temMais = longo || partes.length > MAX_NOMES || advogados.length > MAX_NOMES;

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(processo);
      toast.success("Número copiado.");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };

  return (
    <Card size="sm" className="gap-0">
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {item.siglaTribunal && <Badge>{item.siglaTribunal}</Badge>}
            {item.tipoComunicacao && <Badge variant="secondary">{item.tipoComunicacao}</Badge>}
            {meio && (
              <Badge variant="outline" title={item.meiocompleto ?? undefined}>
                {meio}
              </Badge>
            )}
            {item.tipoDocumento && <Badge variant="outline">{item.tipoDocumento}</Badge>}
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatarData(item.data_disponibilizacao ?? null, item.datadisponibilizacao ?? "—")}
          </span>
        </div>

        <div className="min-w-0">
          {processo ? (
            <div className="flex items-center gap-1">
              <span className="font-mono text-sm font-semibold break-all">{processo}</span>
              <Button variant="ghost" size="icon-xs" aria-label="Copiar número do processo" onClick={copiar}>
                <CopyIcon />
              </Button>
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">Processo não informado</span>
          )}
          <dl className="mt-1 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="sr-only">Órgão</dt>
              <dd className="break-words text-muted-foreground">{item.nomeOrgao || "Órgão não informado"}</dd>
            </div>
            {item.nomeClasse && (
              <div className="min-w-0">
                <dt className="sr-only">Classe</dt>
                <dd className="break-words text-muted-foreground">{item.nomeClasse}</dd>
              </div>
            )}
          </dl>
        </div>

        {(partes.length > 0 || advogados.length > 0) && (
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            {partes.length > 0 && (
              <div className="min-w-0">
                <h4 className="text-xs font-medium text-muted-foreground">Partes</h4>
                <ul className="mt-1 space-y-0.5">
                  {partesVisiveis.map((d, i) => (
                    <li key={i} className="break-words">
                      {d.nome}
                      {poloRotulo(d.polo) && (
                        <span className="ml-1.5 text-xs text-muted-foreground">{poloRotulo(d.polo)}</span>
                      )}
                    </li>
                  ))}
                  {!expandido && partes.length > MAX_NOMES && (
                    <li className="text-xs text-muted-foreground">e mais {partes.length - MAX_NOMES}</li>
                  )}
                </ul>
              </div>
            )}
            {advogados.length > 0 && (
              <div className="min-w-0">
                <h4 className="text-xs font-medium text-muted-foreground">Advogados</h4>
                <ul className="mt-1 space-y-0.5">
                  {advVisiveis.map((a, i) => (
                    <li key={i} className="break-words">
                      {a.nome}
                      {(a.numero_oab || a.uf_oab) && (
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          OAB {[a.numero_oab, a.uf_oab].filter(Boolean).join("/")}
                        </span>
                      )}
                    </li>
                  ))}
                  {!expandido && advogados.length > MAX_NOMES && (
                    <li className="text-xs text-muted-foreground">e mais {advogados.length - MAX_NOMES}</li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}

        {texto ? (
          <div className="rounded-lg border bg-muted/30 p-3 text-sm leading-relaxed break-words whitespace-pre-wrap">
            {exibido}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Sem texto disponível.</p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {temMais && (
            <Button variant="ghost" size="sm" onClick={() => setExpandido((v) => !v)} aria-expanded={expandido}>
              {expandido ? <ChevronUpIcon /> : <ChevronDownIcon />}
              {expandido ? "Recolher" : "Ver texto completo"}
            </Button>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            {linkTeor && (
              <a
                href={linkTeor}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
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
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
