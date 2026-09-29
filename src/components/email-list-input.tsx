"use client";

import { useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const emailValido = z.email();

/** Normaliza, remove duplicados e separa inválidos de uma string com vários e-mails. */
export function separarEmails(texto: string) {
  const partes = texto
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const validos: string[] = [];
  const invalidos: string[] = [];
  for (const p of partes) (emailValido.safeParse(p).success ? validos : invalidos).push(p);
  return { validos, invalidos };
}

/** Campo de lista de e-mails em "chips". Enter, vírgula ou colar vários adiciona. */
export function EmailListInput({
  id,
  valor,
  aoMudar,
  placeholder = "nome@exemplo.com.br",
  desabilitado,
  invalido,
}: {
  id?: string;
  valor: string[];
  aoMudar: (v: string[]) => void;
  placeholder?: string;
  desabilitado?: boolean;
  invalido?: boolean;
}) {
  const [rascunho, setRascunho] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  const adicionar = (texto = rascunho) => {
    if (!texto.trim()) return true;
    const { validos, invalidos } = separarEmails(texto);
    const novos = validos.filter((e) => !valor.includes(e));
    if (novos.length) aoMudar([...valor, ...novos]);
    if (invalidos.length) {
      setErro(`E-mail inválido: ${invalidos.join(", ")}`);
      setRascunho(invalidos.join(", "));
      return false;
    }
    setErro(null);
    setRascunho("");
    return true;
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          id={id}
          type="email"
          inputMode="email"
          autoComplete="off"
          placeholder={placeholder}
          value={rascunho}
          disabled={desabilitado}
          aria-invalid={erro || invalido ? true : undefined}
          onChange={(e) => {
            setRascunho(e.target.value);
            if (erro) setErro(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "," || e.key === ";") {
              e.preventDefault();
              adicionar();
            } else if (e.key === "Backspace" && !rascunho && valor.length) {
              aoMudar(valor.slice(0, -1));
            }
          }}
          onBlur={() => adicionar()}
          onPaste={(e) => {
            const t = e.clipboardData.getData("text");
            if (/[\s,;]/.test(t.trim())) {
              e.preventDefault();
              adicionar(t);
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Adicionar e-mail"
          disabled={desabilitado || !rascunho.trim()}
          onClick={() => adicionar()}
        >
          <PlusIcon />
        </Button>
      </div>
      {erro && <p className="text-xs text-destructive">{erro}</p>}
      {valor.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {valor.map((e) => (
            <Badge key={e} variant="secondary" className="h-6 max-w-full gap-1 pr-1">
              <span className="truncate">{e}</span>
              <button
                type="button"
                className="rounded-full p-0.5 hover:bg-foreground/10 disabled:opacity-50"
                aria-label={`Remover ${e}`}
                disabled={desabilitado}
                onClick={() => aoMudar(valor.filter((x) => x !== e))}
              >
                <XIcon className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
