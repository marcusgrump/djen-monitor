"use client";

import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { EmailListInput } from "@/components/email-list-input";
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

export function MonitorFormDialog({
  aberto,
  aoMudarAberto,
  monitor,
  inicial,
  versao,
  aoSalvar,
}: {
  aberto: boolean;
  aoMudarAberto: (v: boolean) => void;
  monitor: Monitor | null;
  /** Formulário inicial para um monitor novo (ex.: filtros vindos da página Pesquisar). */
  inicial?: MonitorForm | null;
  /** Muda a cada abertura para reiniciar o formulário. */
  versao: number;
  aoSalvar: () => void;
}) {
  return (
    <Dialog open={aberto} onOpenChange={aoMudarAberto}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
        <FormInterno
          key={versao}
          monitor={monitor}
          inicial={inicial ?? null}
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
  aoCancelar,
  aoSalvar,
}: {
  monitor: Monitor | null;
  inicial: MonitorForm | null;
  aoCancelar: () => void;
  aoSalvar: () => void;
}) {
  const [form, setForm] = useState<MonitorForm>(() =>
    monitor ? formDeMonitor(monitor) : (inicial ?? FORM_VAZIO),
  );
  const [erros, setErros] = useState<ErrosForm>({});
  const [salvando, setSalvando] = useState(false);

  const set = <K extends keyof MonitorForm>(k: K, v: MonitorForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (k !== "filtros" && erros[k as keyof Omit<ErrosForm, "filtros">]) setErros((e) => ({ ...e, [k]: undefined }));
  };

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = validarMonitor(form);
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
          Use os mesmos filtros da pesquisa oficial do DJEN — sozinhos ou combinados. A cada
          sincronização o período pesquisado é de hoje até os dias retroativos.
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
            <Campo
              id="m-dias"
              rotulo="Dias retroativos"
              erro={erros.dias_retroativos}
              ajuda="Período de cada sincronização: de hoje menos N dias até hoje (0 a 30)."
            >
              <Input
                id="m-dias"
                type="number"
                min={0}
                max={30}
                step={1}
                inputMode="numeric"
                className="max-w-32"
                value={form.dias_retroativos}
                onChange={(e) => set("dias_retroativos", e.target.value)}
                aria-invalid={erros.dias_retroativos ? true : undefined}
              />
            </Campo>
          }
        />
      </fieldset>

      <Campo
        id="m-emails"
        rotulo="E-mails destinatários"
        erro={erros.emails}
        ajuda="Vazio = usa os e-mails padrão das Configurações. Enter ou vírgula para adicionar."
      >
        <EmailListInput
          id="m-emails"
          valor={form.emails}
          aoMudar={(v) => set("emails", v)}
          invalido={!!erros.emails}
        />
      </Campo>

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
