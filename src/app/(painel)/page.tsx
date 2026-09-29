import type { Metadata } from "next";
import { VisaoGeral } from "./visao-geral";

export const metadata: Metadata = { title: "Visão geral" };

export default function Page() {
  return <VisaoGeral />;
}
