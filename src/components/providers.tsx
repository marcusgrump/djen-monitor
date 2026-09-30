"use client";

import { AuthProvider } from "@/components/auth-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AuthProvider>
        <TooltipProvider delay={300}>{children}</TooltipProvider>
      </AuthProvider>
      <Toaster richColors closeButton position="top-right" />
    </>
  );
}
