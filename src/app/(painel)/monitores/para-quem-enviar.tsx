"use client";

import { useId } from "react";
import { AlertTriangleIcon } from "lucide-react";
import Link from "next/link";
import { EmailListInput } from "@/components/email-list-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ContaEnvioComStatus } from "@/lib/contas-envio";
import type { ErrosForm, MonitorForm } from "./monitor-schema";

/** Contas de envio e lista "Recebem tudo", carregadas pela tela de Monitores. */
export interface DadosEnvio {
  /** true = migration de contas de envio ainda não aplicada no servidor. */
  pendente: boolean;
  contas: ContaEnvioComStatus[];
  recebemTudo: string[];
}

export function rotuloConta(c: Pick<ContaEnvioComStatus, "email" | "nome_remetente">) {
  return c.nome_remetente ? `${c.email} (${c.nome_remetente})` : c.email;
}

/** Itens do Select de conta: padrão + contas ativas (+ a atual, se inativa ou removida). */
function itensConta(envio: DadosEnvio, atual: string) {
  const padrao = envio.contas.find((c) => c.padrao);
  const itens = [
    { value: "", label: `Conta padrão (${padrao ? padrao.email : "nenhuma definida"})` },
    ...envio.contas.filter((c) => c.ativo).map((c) => ({ value: String(c.id), label: rotuloConta(c) })),
  ];
  if (atual && !itens.some((i) => i.value === atual)) {
    const conta = envio.contas.find((c) => String(c.id) === atual);
    itens.push({ value: atual, label: conta ? `${conta.email} (inativa)` : "Conta removida" });
  }
  return itens;
}

export function ParaQuemEnviar({
  form,
  erros,
  envio,
  aoMudar,
}: {
  form: MonitorForm;
  erros: ErrosForm;
  envio: DadosEnvio | null;
  aoMudar: (mudancas: Partial<MonitorForm>) => void;
}) {
  const base = useId();
  const id = (c: string) => `${base}-${c}`;
  const pendente = envio?.pendente ?? false;
  const itens = envio ? itensConta(envio, form.conta_envio_id) : [{ value: "", label: "Conta padrão" }];
  const recebemTudo = envio?.recebemTudo ?? [];
  const semContas = !!envio && !envio.pendente && !envio.contas.some((c) => c.ativo && c.senha_configurada);
  const semDestinatarios = !!envio && form.emails.length === 0 && recebemTudo.length === 0;

  return (
    <fieldset className="grid gap-4 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">Para quem enviar</legend>

      <div className="grid gap-1.5">
        <Label htmlFor={id("conta")}>Enviar pela conta</Label>
        <Select
          items={itens}
          value={form.conta_envio_id}
          onValueChange={(v) => aoMudar({ conta_envio_id: typeof v === "string" ? v : "" })}
          disabled={pendente || !envio}
        >
          <SelectTrigger id={id("conta")} className="w-full sm:max-w-md">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {itens.map((i) => (
              <SelectItem key={i.value || "padrao"} value={i.value}>
                {i.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {pendente ? (
          <p className="text-xs text-muted-foreground">
            Atualização do servidor pendente — por enquanto o envio usa a conta configurada no servidor.
          </p>
        ) : semContas ? (
          <p className="text-xs text-warning-text">
            Nenhuma conta de envio ativa com Senha de App.{" "}
            <Link href="/configuracoes/" className="font-medium underline underline-offset-2">
              Configure em Configurações
            </Link>
            .
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">Conta Gmail que aparece como remetente dos avisos deste monitor.</p>
        )}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={id("emails")}>Destinatários deste monitor</Label>
        <EmailListInput
          id={id("emails")}
          valor={form.emails}
          aoMudar={(v) => aoMudar({ emails: v })}
          invalido={!!erros.emails}
        />
        {erros.emails ? (
          <p className="text-xs text-destructive">{erros.emails}</p>
        ) : (
          <p className="text-xs text-muted-foreground">Enter ou vírgula para adicionar.</p>
        )}
        {recebemTudo.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Também recebem (“Recebem tudo”):{" "}
            <span className="text-foreground/80">{recebemTudo.join(", ")}</span>
          </p>
        )}
        {semDestinatarios && (
          <p className="flex items-start gap-1.5 text-xs text-warning-text" role="status">
            <AlertTriangleIcon className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>
              Nenhum destinatário: adicione e-mails aqui ou em “Recebem tudo” nas Configurações — sem isso,
              nada deste monitor é enviado.
            </span>
          </p>
        )}
      </div>
    </fieldset>
  );
}
