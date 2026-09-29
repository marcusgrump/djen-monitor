import type { Metadata } from "next";
import { RedefinirSenhaForm } from "./redefinir-form";

export const metadata: Metadata = { title: "Redefinir senha" };

export default function RedefinirSenhaPage() {
  return <RedefinirSenhaForm />;
}
