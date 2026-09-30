"use client";

import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { mensagemErro, supabase } from "@/lib/supabase";
import { FiltrosDjenForm } from "@/components/filtros-djen";
import type { Monitor } from "@/lib/types";
import { FORM_VAZIO, formDeMonitor, validarMonitor, type ErrosForm, type MonitorForm } from "./monitor-schema";
import { ParaQuemEnviar, type DadosEnvio } from "./para-quem-enviar";
import { QuandoEnviar } from "./quando-enviar";

export function MonitorFormDialog({
  aberto,
  aoMudarAberto,
  monitor,
  inicial,
  versao,
  envio,
  aoSalvar,
}: {
  aberto: boolean;
  aoMudarAberto: (v: boolean) => void;
  monitor: Monitor | null;
  /** Formulário inicial para um monitor novo (ex.: filtros vindos da página Pesquisar). */
  inicial?: MonitorForm | null;
  /** Muda a cada abertura para reiniciar o formulário. */
  versao: number;
  /** Contas de envio e "Recebem tudo" (null enquanto carrega). */
  envio: DadosEnvio | null;
  aoSalvar: () => void;
}) {
  return (
    <Dialog open={aberto} onOpenChange={aoMudarAberto}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
        <FormInterno
          key={versao}
          monitor={monitor}
          inicial={inicial ?? null}
          envio={envio}
          aoCancelar={() => aoMudarAberto(false)}
          aoSalvar={() => {
            aoMudarAberto(false);
            aoSalvar();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function Campo({
  id,
  rotulo,
  erro,
  ajuda,
  children,
  className,
}: {
  id?: string;
  rotulo: string;
  erro?: string;
  ajuda?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={id} className="mb-1.5">
        {rotulo}
      </Label>
      {children}
      {erro ? (
        <p className="mt-1 text-xs text-destructive">{erro}</p>
      ) : ajuda ? (
        <p className="mt-1 text-xs text-muted-foreground">{ajuda}</p>
      ) : null}
    </div>
  );
}

function FormInterno({
  monitor,
  inicial,
  envio,
  aoCancelar,
  aoSalvar,
}: {
  monitor: Monitor | null;
  inicial: MonitorForm | null;
  envio: DadosEnvio | null;
  aoCancelar: () => void;
  aoSalvar: () => void;
}) {
  const [form, setForm] = useState<MonitorForm>(() =>
    monitor ? formDeMonitor(monitor) : (inicial ?? FORM_VAZIO),
  );
  const [erros, setErros] = useState<ErrosForm>({});
  const [salvando, setSalvando] = useState(false);

  /** Campos do formulário que têm erro próprio (o restante é agrupado no campo exibido). */
  const campoDoErro = (k: keyof MonitorForm): keyof Omit<ErrosForm, "filtros"> | null => {
    if (k === "filtros" || k === "conta_envio_id") return null;
    if (k === "modo_dias") return "dias_semana";
    if (k === "modo_horario") return "horarios";
    return k;
  };

  const mudar = (mudancas: Partial<MonitorForm>) => {
    setForm((f) => ({ ...f, ...mudancas }));
    const campos = (Object.keys(mudancas) as (keyof MonitorForm)[])
      .map(campoDoErro)
      .filter((c): c is keyof Omit<ErrosForm, "filtros"> => c !== null && !!erros[c]);
    if (campos.length) setErros((e) => ({ ...e, ...Object.fromEntries(campos.map((c) => [c, undefined])) }));
  };

  const set = <K extends keyof MonitorForm>(k: K, v: MonitorForm[K]) => mudar({ [k]: v } as Partial<MonitorForm>);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    // A coluna conta_envio_id só existe depois da migration de contas de envio.
    const r = validarMonitor(form, { comConta: !!envio && !envio.pendente });
    if (!r.ok) {
      setErros(r.erros);
      return;
    }
    setSalvando(true);
    const sb = supabase();
    const { error } = monitor
      ? await sb.from("monitores").update(r.dados).eq("id", monitor.id)
      : await sb.from("monitores").insert(r.dados);
    setSalvando(false);
    if (error) {
      toast.error("Não foi possível salvar o monitor", { description: mensagemErro(error) });
      return;
    }
    toast.success(monitor ? "Monitor atualizado." : "Monitor criado.", {
      description: monitor ? undefined : "Ele será incluído na próxima sincronização.",
    });
    aoSalvar();
  };

  return (
    <form onSubmit={salvar} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{monitor ? "Editar monitor" : "Novo monitor"}</DialogTitle>
        <DialogDescription>
          Use os mesmos filtros da pesquisa oficial do DJEN — sozinhos ou combinados — e escolha quando
          receber os e-mails. O período de cada busca é automático: desde a última sincronização.
        </DialogDescription>
      </DialogHeader>

      <Campo id="m-nome" rotulo="Nome do monitor" erro={erros.nome}>
        <Input
          id="m-nome"
          value={form.nome}
          onChange={(e) => set("nome", e.target.value)}
          placeholder="Ex.: Minha OAB, Cliente X"
          aria-invalid={erros.nome ? true : undefined}
          maxLength={120}
          autoFocus
        />
      </Campo>

      <fieldset className="grid gap-3 rounded-lg border p-3">
        <legend className="px-1 text-sm font-medium">Filtros</legend>
        <FiltrosDjenForm
          modo="monitor"
          valor={form.filtros}
          aoMudar={(v) => set("filtros", v)}
          erros={erros.filtros}
          aoLimparErro={(campo) =>
            setErros((e) => (e.filtros ? { ...e, filtros: { ...e.filtros, [campo]: undefined } } : e))
          }
          periodo={
            <div>
              <div className="mb-1.5 text-sm leading-none font-medium">Período</div>
              <p className="flex min-h-8 items-center text-sm text-muted-foreground">
                Automático — desde a última sincronização, sem perder nada.
              </p>
            </div>
          }
        />
      </fieldset>

      <QuandoEnviar form={form} erros={erros} aoMudar={mudar} />

      <ParaQuemEnviar form={form} erros={erros} envio={envio} aoMudar={mudar} />

      <div>
        <Label htmlFor="m-ativo" className="mb-1.5">
          Ativo
        </Label>
        <div className="flex h-8 items-center gap-2">
          <Switch id="m-ativo" checked={form.ativo} onCheckedChange={(v) => set("ativo", v)} />
          <span className="text-sm">{form.ativo ? "Ativo — incluído nas sincronizações" : "Pausado"}</span>
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={aoCancelar} disabled={salvando}>
          Cancelar
        </Button>
        <Button type="submit" disabled={salvando}>
          {salvando && <Loader2Icon className="animate-spin" />}
          {monitor ? "Salvar alterações" : "Criar monitor"}
        </Button>
      </DialogFooter>
    </form>
  );
}
