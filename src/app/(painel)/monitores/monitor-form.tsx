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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TIPO_MONITOR_INFO, UFS } from "@/lib/constants";
import { mensagemErro, supabase } from "@/lib/supabase";
import { TIPOS_MONITOR, type Monitor, type TipoMonitor } from "@/lib/types";
import { FORM_VAZIO, formDeMonitor, validarMonitor, type ErrosForm, type MonitorForm } from "./monitor-schema";

const ITENS_TIPO = TIPOS_MONITOR.map((t) => ({ value: t, label: TIPO_MONITOR_INFO[t].rotulo }));
const ITENS_UF = UFS.map((u) => ({ value: u, label: u }));

export function MonitorFormDialog({
  aberto,
  aoMudarAberto,
  monitor,
  versao,
  aoSalvar,
}: {
  aberto: boolean;
  aoMudarAberto: (v: boolean) => void;
  monitor: Monitor | null;
  /** Muda a cada abertura para reiniciar o formulário. */
  versao: number;
  aoSalvar: () => void;
}) {
  return (
    <Dialog open={aberto} onOpenChange={aoMudarAberto}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
        <FormInterno
          key={versao}
          monitor={monitor}
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
  aoCancelar,
  aoSalvar,
}: {
  monitor: Monitor | null;
  aoCancelar: () => void;
  aoSalvar: () => void;
}) {
  const [form, setForm] = useState<MonitorForm>(() => (monitor ? formDeMonitor(monitor) : FORM_VAZIO));
  const [erros, setErros] = useState<ErrosForm>({});
  const [salvando, setSalvando] = useState(false);

  const set = <K extends keyof MonitorForm>(k: K, v: MonitorForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (erros[k]) setErros((e) => ({ ...e, [k]: undefined }));
  };

  const info = TIPO_MONITOR_INFO[form.tipo];

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
          Defina o que procurar nas comunicações do DJEN e quem deve ser avisado.
        </DialogDescription>
      </DialogHeader>

      <Campo id="m-nome" rotulo="Nome" erro={erros.nome}>
        <Input
          id="m-nome"
          value={form.nome}
          onChange={(e) => set("nome", e.target.value)}
          placeholder="Ex.: Minha OAB, Cliente X"
          aria-invalid={erros.nome ? true : undefined}
          autoFocus
        />
      </Campo>

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Tipo" erro={erros.tipo}>
          <Select
            items={ITENS_TIPO}
            value={form.tipo}
            onValueChange={(v) => {
              if (v) {
                set("tipo", v as TipoMonitor);
                setErros((e) => ({ ...e, valor: undefined, uf_oab: undefined }));
              }
            }}
          >
            <SelectTrigger className="w-full" aria-label="Tipo de monitor">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ITENS_TIPO.map((i) => (
                <SelectItem key={i.value} value={i.value}>
                  {i.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
        <Campo
          id="m-tribunal"
          rotulo="Tribunal (opcional)"
          erro={erros.sigla_tribunal}
          ajuda="Vazio = todos os tribunais."
        >
          <Input
            id="m-tribunal"
            value={form.sigla_tribunal}
            onChange={(e) => set("sigla_tribunal", e.target.value.toUpperCase().replace(/\s+/g, ""))}
            placeholder="Ex.: TJSP"
            aria-invalid={erros.sigla_tribunal ? true : undefined}
          />
        </Campo>
      </div>

      <div className={form.tipo === "oab" ? "grid gap-4 sm:grid-cols-[1fr_7rem]" : "grid gap-4"}>
        <Campo id="m-valor" rotulo={info.rotuloValor} erro={erros.valor} ajuda={info.ajuda}>
          <Input
            id="m-valor"
            value={form.valor}
            onChange={(e) => set("valor", e.target.value)}
            placeholder={info.placeholder}
            inputMode={form.tipo === "oab" || form.tipo === "processo" ? "numeric" : undefined}
            aria-invalid={erros.valor ? true : undefined}
          />
        </Campo>
        {form.tipo === "oab" && (
          <Campo rotulo="UF da OAB" erro={erros.uf_oab}>
            <Select
              items={ITENS_UF}
              value={form.uf_oab || null}
              onValueChange={(v) => set("uf_oab", (v as string | null) ?? "")}
            >
              <SelectTrigger className="w-full" aria-label="UF da OAB" aria-invalid={erros.uf_oab ? true : undefined}>
                <SelectValue placeholder="UF" />
              </SelectTrigger>
              <SelectContent>
                {ITENS_UF.map((i) => (
                  <SelectItem key={i.value} value={i.value}>
                    {i.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
        )}
      </div>

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

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          id="m-dias"
          rotulo="Dias retroativos"
          erro={erros.dias_retroativos}
          ajuda="Quantos dias para trás buscar (0 a 30)."
        >
          <Input
            id="m-dias"
            type="number"
            min={0}
            max={30}
            step={1}
            inputMode="numeric"
            value={form.dias_retroativos}
            onChange={(e) => set("dias_retroativos", e.target.value)}
            aria-invalid={erros.dias_retroativos ? true : undefined}
          />
        </Campo>
        <div>
          <Label htmlFor="m-ativo" className="mb-1.5">
            Situação
          </Label>
          <div className="flex h-8 items-center gap-2">
            <Switch id="m-ativo" checked={form.ativo} onCheckedChange={(v) => set("ativo", v)} />
            <span className="text-sm">{form.ativo ? "Ativo" : "Pausado"}</span>
          </div>
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
