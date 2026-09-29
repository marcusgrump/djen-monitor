"use client";

import { useState } from "react";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  Loader2Icon,
  MailIcon,
  SendIcon,
  Trash2Icon,
  XCircleIcon,
} from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@/hooks/use-query";
import { formatarDataHora } from "@/lib/format";
import {
  MSG_ATUALIZACAO_PENDENTE,
  NOME_REMETENTE_PADRAO,
  removerGmail,
  salvarGmail,
  statusGmail,
  testarEmail,
  URL_SENHAS_APP,
  type ResultadoTesteEmail,
  type StatusGmail,
} from "@/lib/gmail";
import { cn } from "@/lib/utils";

const emailValido = z.email();

/** Card "E-mail de envio (Gmail)": credenciais no Vault via RPC + teste pela Edge Function. */
export function GmailCard({ emailsPadrao }: { emailsPadrao: string[] }) {
  const status = useQuery("gmail:status", statusGmail);
  const pendente = status.erro === MSG_ATUALIZACAO_PENDENTE;
  const dados = status.dados;
  const configurado = !!dados?.usuario && !!dados?.senha_configurada;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MailIcon className="size-4" /> E-mail de envio (Gmail)
        </CardTitle>
        <CardDescription>
          Conta usada para enviar os avisos de novas comunicações. Fica guardada de forma criptografada
          no servidor — a senha nunca é exibida de volta.
        </CardDescription>
        <CardAction>
          {status.carregandoInicial ? (
            <Skeleton className="h-5 w-24" />
          ) : pendente || !dados ? null : configurado ? (
            <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">Configurado</Badge>
          ) : (
            <Badge variant="outline" className="border-amber-500/50 text-amber-800 dark:text-amber-300">
              Não configurado
            </Badge>
          )}
        </CardAction>
      </CardHeader>

      {status.carregandoInicial ? (
        <CardContent className="space-y-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-2/3" />
        </CardContent>
      ) : (
        <FormGmail
          key={dados?.atualizado_em ?? (pendente ? "pendente" : "vazio")}
          status={dados ?? null}
          pendente={pendente}
          erroStatus={!pendente ? status.erro : undefined}
          emailsPadrao={emailsPadrao}
          aoAtualizar={status.recarregar}
        />
      )}
    </Card>
  );
}

function FormGmail({
  status,
  pendente,
  erroStatus,
  emailsPadrao,
  aoAtualizar,
}: {
  status: StatusGmail | null;
  pendente: boolean;
  erroStatus?: string;
  emailsPadrao: string[];
  aoAtualizar: () => void;
}) {
  const [usuario, setUsuario] = useState(status?.usuario ?? "");
  // Só em memória: limpo após salvar, nunca persistido.
  const [senha, setSenha] = useState("");
  const [nome, setNome] = useState(status?.nome_remetente ?? NOME_REMETENTE_PADRAO);
  const [destinatario, setDestinatario] = useState("");
  const [erros, setErros] = useState<{ usuario?: string; senha?: string; nome?: string; destinatario?: string }>({});
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [teste, setTeste] = useState<ResultadoTesteEmail | null>(null);
  const [confirmarRemocao, setConfirmarRemocao] = useState(false);
  const [removendo, setRemovendo] = useState(false);

  const senhaSalva = !!status?.senha_configurada;
  const destinatarioPadrao = emailsPadrao[0] ?? status?.usuario ?? usuario.trim();
  const alterado =
    usuario.trim().toLowerCase() !== (status?.usuario ?? "") ||
    senha.trim() !== "" ||
    nome.trim() !== (status?.nome_remetente ?? NOME_REMETENTE_PADRAO);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    const novos: typeof erros = {};
    if (!emailValido.safeParse(usuario.trim()).success) {
      novos.usuario = "Informe o endereço completo da conta Gmail (ex.: nome@gmail.com).";
    }
    const senhaLimpa = senha.replace(/\s+/g, "");
    if (senhaLimpa && !/^[a-zA-Z]{16}$/.test(senhaLimpa)) {
      novos.senha = "A Senha de App tem 16 letras (ex.: abcd efgh ijkl mnop). Não use a senha normal da conta.";
    } else if (!senhaLimpa && !senhaSalva) {
      novos.senha = "Informe a Senha de App gerada no Google.";
    }
    if (nome.trim().length > 100) novos.nome = "Use no máximo 100 caracteres.";
    setErros(novos);
    if (Object.keys(novos).length) return;

    setSalvando(true);
    try {
      await salvarGmail({ usuario, senhaApp: senhaLimpa, nomeRemetente: nome });
      setSenha("");
      toast.success("Configuração do Gmail salva.", {
        description: "Use “Enviar e-mail de teste” para conferir.",
      });
      aoAtualizar();
    } catch (err) {
      toast.error("Não foi possível salvar", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSalvando(false);
    }
  };

  const enviarTeste = async () => {
    const alvo = destinatario.trim();
    if (alvo && !emailValido.safeParse(alvo).success) {
      setErros((e) => ({ ...e, destinatario: "E-mail inválido." }));
      return;
    }
    setErros((e) => ({ ...e, destinatario: undefined }));
    setTestando(true);
    setTeste(null);
    const r = await testarEmail(alvo || destinatarioPadrao || undefined);
    setTeste(r);
    setTestando(false);
  };

  const remover = async () => {
    setRemovendo(true);
    try {
      await removerGmail();
      toast.success("Credenciais do Gmail removidas.");
      setConfirmarRemocao(false);
      setTeste(null);
      aoAtualizar();
    } catch (err) {
      toast.error("Não foi possível remover", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRemovendo(false);
    }
  };

  return (
    <form onSubmit={salvar} noValidate className="contents">
      <CardContent className="space-y-5">
        {pendente && (
          <Alert>
            <AlertTriangleIcon />
            <AlertTitle>Atualização do servidor pendente</AlertTitle>
            <AlertDescription>
              As funções que guardam o Gmail no banco ainda não foram instaladas. Enquanto isso, o envio
              usa as credenciais definidas nos Secrets da Supabase (se houver) — o teste abaixo continua
              disponível.
            </AlertDescription>
          </Alert>
        )}
        {erroStatus && (
          <Alert variant="destructive">
            <AlertTriangleIcon />
            <AlertTitle>Não foi possível ler a configuração</AlertTitle>
            <AlertDescription>{erroStatus}</AlertDescription>
          </Alert>
        )}

        <ol className="list-decimal space-y-1 rounded-lg border bg-muted/30 py-3 pr-3 pl-8 text-xs leading-relaxed text-muted-foreground">
          <li>
            A conta precisa ter a <strong className="text-foreground">verificação em 2 etapas</strong> ativada.
          </li>
          <li>
            Logado na <strong className="text-foreground">mesma conta</strong> do remetente, abra{" "}
            <a
              href={URL_SENHAS_APP}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 font-medium text-foreground underline underline-offset-2"
            >
              myaccount.google.com/apppasswords <ExternalLinkIcon className="size-3" />
            </a>{" "}
            e gere uma Senha de App (ex.: “DJEN Monitor”).
          </li>
          <li>Cole abaixo só as 16 letras (com ou sem espaços) e salve.</li>
        </ol>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="g-usuario">Conta Gmail (remetente)</Label>
            <Input
              id="g-usuario"
              type="email"
              autoComplete="off"
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              placeholder="nome@gmail.com"
              aria-invalid={erros.usuario ? true : undefined}
              disabled={pendente}
            />
            {erros.usuario && <p className="text-xs text-destructive">{erros.usuario}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="g-senha">Senha de App</Label>
            <Input
              id="g-senha"
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              placeholder={senhaSalva ? "•••• •••• •••• ••••" : "abcd efgh ijkl mnop"}
              aria-invalid={erros.senha ? true : undefined}
              disabled={pendente}
              maxLength={40}
            />
            {erros.senha ? (
              <p className="text-xs text-destructive">{erros.senha}</p>
            ) : senhaSalva ? (
              <p className="text-xs text-muted-foreground">
                Senha configurada
                {status?.atualizado_em ? ` em ${formatarDataHora(status.atualizado_em)}` : ""} — deixe em
                branco para manter.
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="g-nome">Nome do remetente</Label>
            <Input
              id="g-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder={NOME_REMETENTE_PADRAO}
              aria-invalid={erros.nome ? true : undefined}
              disabled={pendente}
              maxLength={100}
            />
            {erros.nome && <p className="text-xs text-destructive">{erros.nome}</p>}
          </div>
        </div>

        <div className="space-y-1.5 rounded-lg border p-3">
          <Label htmlFor="g-teste">Enviar e-mail de teste para</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="g-teste"
              type="email"
              value={destinatario}
              onChange={(e) => setDestinatario(e.target.value)}
              placeholder={destinatarioPadrao || "destinatario@exemplo.com.br"}
              aria-invalid={erros.destinatario ? true : undefined}
            />
            <Button type="button" variant="outline" onClick={enviarTeste} disabled={testando}>
              {testando ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
              Enviar e-mail de teste
            </Button>
          </div>
          {erros.destinatario ? (
            <p className="text-xs text-destructive">{erros.destinatario}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Opcional — vazio envia para {destinatarioPadrao || "o primeiro e-mail padrão ou o próprio remetente"}.
              {alterado && " O teste usa a configuração já salva."}
            </p>
          )}
          {teste && <ResultadoTeste resultado={teste} />}
        </div>
      </CardContent>

      <CardFooter className="flex-wrap justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive"
          onClick={() => setConfirmarRemocao(true)}
          disabled={pendente || (!status?.usuario && !senhaSalva)}
        >
          <Trash2Icon /> Remover credenciais
        </Button>
        <Button type="submit" disabled={pendente || salvando || !alterado}>
          {salvando && <Loader2Icon className="animate-spin" />}
          Salvar
        </Button>
      </CardFooter>

      <Dialog open={confirmarRemocao} onOpenChange={(v) => !removendo && setConfirmarRemocao(v)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover credenciais do Gmail?</DialogTitle>
            <DialogDescription>
              A conta e a Senha de App salvas pelo painel serão apagadas. Sem credenciais, os avisos por
              e-mail deixam de ser enviados (a menos que existam Secrets GMAIL_* na Supabase).
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmarRemocao(false)} disabled={removendo}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={remover} disabled={removendo}>
              {removendo && <Loader2Icon className="animate-spin" />}
              Remover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}

function ResultadoTeste({ resultado }: { resultado: ResultadoTesteEmail }) {
  if (resultado.ok) {
    return (
      <Alert
        role="status"
        className={cn("mt-2 border-emerald-500/40 text-emerald-800 dark:text-emerald-300")}
      >
        <CheckCircle2Icon />
        <AlertTitle>✓ E-mail de teste enviado{resultado.destinatario ? ` para ${resultado.destinatario}` : ""}</AlertTitle>
        <AlertDescription className="text-emerald-800/90 dark:text-emerald-300/90">
          Confira a caixa de entrada e o Spam.
          {resultado.remetente ? ` Remetente: ${resultado.remetente}.` : ""}
          {resultado.origem ? ` Credenciais: ${resultado.origem}.` : ""}
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert variant="destructive" className="mt-2">
      <XCircleIcon />
      <AlertTitle>Falha no envio do e-mail de teste</AlertTitle>
      <AlertDescription>
        <p>{resultado.erro}</p>
        {resultado.dica && <p className="mt-1">Dica: {resultado.dica}</p>}
      </AlertDescription>
    </Alert>
  );
}
