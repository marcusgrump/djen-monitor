import { Suspense } from "react";
import type { Metadata } from "next";
import { Skeleton } from "@/components/ui/skeleton";
import { ExecucoesView } from "./execucoes-view";

export const metadata: Metadata = { title: "Execuções" };

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-96 w-full" />
        </div>
      }
    >
      <ExecucoesView />
    </Suspense>
  );
}
