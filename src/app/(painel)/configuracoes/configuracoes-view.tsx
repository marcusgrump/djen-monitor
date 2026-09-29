"use client";

import { useState } from "react";
import { ClockIcon, GaugeIcon, InfoIcon, KeyRoundIcon, Loader2Icon, MapPinIcon, SearchIcon } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { useAuth } from "@/components/auth-provider";
import { ErroCarregamento, PageHeader } from "@/components/comum";
import { EmailListInput } from "@/components/email-list-input";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useQuery } from "@/hooks/use-query";
import { formatarDataHora } from "@/lib/format";
import { validarNovaSenha } from "@/lib/senha";
import { mensagemErro, supabase } from "@/lib/supabase";
import type { ConfiguracaoRow, Configuracoes } from "@/lib/types";
import { GmailCard } from "./gmail-card";

const PADRAO: Configuracoes = {
  emails_padrao: [],
  assunto_prefixo: "[DJEN]",
  notificar_sem_novidades: false,
};

const configSchema = z.object({
  emails_padrao: z.array(z.email("E-mail inválido.")).max(20, "No máximo 20 e-mails."),
  assunto_prefixo: z.string().trim().max(40, "Use no máximo 40 caracteres."),
  notificar_sem_novidades: z.boolean(),
});

async function buscarConfiguracoes() {
  const { data, error } = await supabase().from("configuracoes").select("*");
  if (error) throw error;
  const linhas = (data ?? []) as ConfiguracaoRow[];
  const mapa = new Map(linhas.map((l) => [l.chave, l.valor]));
  const emails = mapa.get("emails_padrao");
  const prefixo = mapa.get("assunto_prefixo");
  const notificar = mapa.get("notificar_sem_novidades");
  const config: Configuracoes = {
    emails_padrao: Array.isArray(emails) ? emails.filter((e): e is string => typeof e === "string") : PADRAO.emails_padrao,
    assunto_prefixo: typeof prefixo === "string" ? prefixo : PADRAO.assunto_prefixo,
    notificar_sem_novidades: typeof notificar === "boolean" ? notificar : PADRAO.notificar_sem_novidades,
  };
  const atualizado = linhas.reduce<string | null>(
    (max, l) => (!max || l.updated_at > max ? l.updated_at : max),
    null,
  );
  return { config, atualizado };
}

export function ConfiguracoesView() {
  const { dados, erro, carregandoInicial, recarregar } = useQuery("configuracoes", buscarConfiguracoes);

  return (
    <div className="space-y-6">
      <PageHeader titulo="Configurações" descricao="Notificações por e-mail e informações do serviço." />

      {erro && <ErroCarregamento mensagem={erro} aoTentarNovamente={recarregar} />}

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <GmailCard emailsPadrao={dados?.config.emails_padrao ?? []} />
          {carregandoInicial ? (
            <Card>
              <CardContent className="space-y-4">
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-2/3" />
              </CardContent>
            </Card>
          ) : dados ? (
            <FormNotificacoes
              key={dados.atualizado ?? "inicial"}
              inicial={dados.config}
              atualizado={dados.atualizado}
              aoSalvar={recarregar}
            />
          ) : null}
          <FormSenha />
        </div>
        <div className="lg:col-span-2">
          <LimitesApi />
        </div>
      </div>
    </div>
  );
}

function FormNotificacoes({
  inicial,
  atualizado,
  aoSalvar,
}: {
  inicial: Configuracoes;
  atualizado: string | null;
  aoSalvar: () => void;
}) {
  const [form, setForm] = useState<Configuracoes>(inicial);
  const [erros, setErros] = useState<Partial<Record<keyof Configuracoes, string>>>({});
  const [salvando, setSalvando] = useState(false);
  const alterado = JSON.stringify(form) !== JSON.stringify(inicial);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = configSchema.safeParse(form);
    if (!r.success) {
      const novos: typeof erros = {};
      for (const i of r.error.issues) {
        const k = i.path[0] as keyof Configuracoes;
        if (k && !novos[k]) novos[k] = i.message;
      }
      setErros(novos);
      return;
    }
    setErros({});
    setSalvando(true);
    const agora = new Date().toISOString();
    const { error } = await supabase()
      .from("configuracoes")
      .upsert(
        [
          { chave: "emails_padrao", valor: r.data.emails_padrao, updated_at: agora },
          { chave: "assunto_prefixo", valor: r.data.assunto_prefixo, updated_at: agora },
          { chave: "notificar_sem_novidades", valor: r.data.notificar_sem_novidades, updated_at: agora },
        ],
        { onConflict: "chave" },
      );
    setSalvando(false);
    if (error) {
      toast.error("Não foi possível salvar", { description: mensagemErro(error) });
      return;
    }
    toast.success("Configurações salvas.");
    aoSalvar();
  };

  return (
    <Card>
      <form onSubmit={salvar} noValidate className="contents">
        <CardHeader>
          <CardTitle>Notificações por e-mail</CardTitle>
          <CardDescription>
            Usadas por todos os monitores que não têm destinatários próprios.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="c-emails">E-mails padrão</Label>
            <EmailListInput
              id="c-emails"
              valor={form.emails_padrao}
              aoMudar={(v) => setForm((f) => ({ ...f, emails_padrao: v }))}
              invalido={!!erros.emails_padrao}
            />
            {erros.emails_padrao ? (
              <p className="text-xs text-destructive">{erros.emails_padrao}</p>
            ) : form.emails_padrao.length === 0 ? (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Sem e-mails padrão, monitores sem destinatários próprios não enviarão avisos.
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="c-prefixo">Prefixo do assunto</Label>
            <Input
              id="c-prefixo"
              value={form.assunto_prefixo}
              onChange={(e) => setForm((f) => ({ ...f, assunto_prefixo: e.target.value }))}
              placeholder="[DJEN]"
              className="sm:max-w-60"
              aria-invalid={erros.assunto_prefixo ? true : undefined}
            />
            {erros.assunto_prefixo ? (
              <p className="text-xs text-destructive">{erros.assunto_prefixo}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Exemplo: “{form.assunto_prefixo.trim() || "[DJEN]"} 3 novas comunicações”.
              </p>
            )}
          </div>

          <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="c-sem-novidades">Notificar mesmo sem novidades</Label>
              <p className="text-xs text-muted-foreground">
                Envia um e-mail a cada execução, mesmo quando nada novo for encontrado.
              </p>
            </div>
            <Switch
              id="c-sem-novidades"
              checked={form.notificar_sem_novidades}
              onCheckedChange={(v) => setForm((f) => ({ ...f, notificar_sem_novidades: v }))}
            />
          </div>
        </CardContent>
        <CardFooter className="flex-wrap justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {atualizado ? `Atualizado em ${formatarDataHora(atualizado)}` : ""}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!alterado || salvando}
              onClick={() => {
                setForm(inicial);
                setErros({});
              }}
            >
              Descartar
            </Button>
            <Button type="submit" disabled={!alterado || salvando}>
              {salvando && <Loader2Icon className="animate-spin" />}
              Salvar
            </Button>
          </div>
        </CardFooter>
      </form>
    </Card>
  );
}

function FormSenha() {
  const { sessao } = useAuth();
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    const problema = validarNovaSenha(senha, confirmacao);
    if (problema) return setErro(problema);
    setErro(null);
    setSalvando(true);
    const { error } = await supabase().auth.updateUser({ password: senha });
    setSalvando(false);
    if (error) return setErro(mensagemErro(error));
    setSenha("");
    setConfirmacao("");
    toast.success("Senha alterada.");
  };

  return (
    <Card>
      <form onSubmit={salvar} noValidate className="contents">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRoundIcon className="size-4" /> Sua conta
          </CardTitle>
          <CardDescription>Conectado como {sessao?.user.email ?? "—"}.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="s-nova">Nova senha</Label>
            <Input
              id="s-nova"
              type="password"
              autoComplete="new-password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-conf">Confirmar nova senha</Label>
            <Input
              id="s-conf"
              type="password"
              autoComplete="new-password"
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
            />
          </div>
          {erro && (
            <p className="text-sm text-destructive sm:col-span-2" role="alert">
              {erro}
            </p>
          )}
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" variant="outline" disabled={salvando || !senha}>
            {salvando && <Loader2Icon className="animate-spin" />}
            Alterar senha
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function LimitesApi() {
  const itens = [
    {
      icone: GaugeIcon,
      titulo: "20 requisições por janela, por IP",
      texto:
        "A API pública do DJEN limita o volume de chamadas. A sincronização espaça as requisições; se o limite for atingido, a execução pode terminar como “parcial” e o restante fica para a próxima rodada.",
    },
    {
      icone: SearchIcon,
      titulo: "Até 10 mil resultados por consulta",
      texto:
        "Buscas muito amplas (ex.: texto genérico ou muitos dias retroativos) podem ser truncadas. Prefira OAB, nome completo ou número do processo, e filtre por tribunal quando possível.",
    },
    {
      icone: ClockIcon,
      titulo: "Execução automática a cada 30 minutos",
      texto:
        "Um agendamento chama a função de sincronização periodicamente. O botão “Sincronizar agora” dispara uma execução extra — apenas uma execução roda por vez.",
    },
    {
      icone: MapPinIcon,
      titulo: "Região São Paulo",
      texto:
        "A função de sincronização roda na região de São Paulo (sa-east-1). Todos os horários do painel são exibidos no fuso de Brasília.",
    },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <InfoIcon className="size-4" /> Limites da API do DJEN
        </CardTitle>
        <CardDescription>
          Fonte: API pública de comunicações processuais do CNJ (comunicaapi.pje.jus.br).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-4">
          {itens.map(({ icone: Icone, titulo, texto }) => (
            <li key={titulo} className="flex gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Icone className="size-4 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium">{titulo}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{texto}</p>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
