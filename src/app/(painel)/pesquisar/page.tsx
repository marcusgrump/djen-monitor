import { Suspense } from "react";
import type { Metadata } from "next";
import { Skeleton } from "@/components/ui/skeleton";
import { PesquisarView } from "./pesquisar-view";

export const metadata: Metadata = { title: "Pesquisar" };

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-80 w-full" />
        </div>
      }
    >
      <PesquisarView />
    </Suspense>
  );
}
