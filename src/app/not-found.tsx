import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export const metadata = { title: "Página não encontrada" };

export default function NotFound() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-3 p-4 text-center">
      <p className="text-sm font-medium text-muted-foreground">Erro 404</p>
      <h1 className="text-2xl font-semibold tracking-tight">Página não encontrada</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        O endereço acessado não existe no painel do DJEN Monitor.
      </p>
      <Link href="/" className={buttonVariants({ className: "mt-2" })}>
        Ir para a visão geral
      </Link>
    </div>
  );
}
