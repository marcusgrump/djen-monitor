import type { Metadata } from "next";
import { ConfiguracoesView } from "./configuracoes-view";

export const metadata: Metadata = { title: "Configurações" };

export default function Page() {
  return <ConfiguracoesView />;
}
