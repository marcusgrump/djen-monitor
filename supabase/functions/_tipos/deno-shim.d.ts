// Declarações mínimas do runtime Deno, apenas para checagem de tipos com `tsc` no Node
// (npx tsc --noEmit -p supabase/functions/tsconfig.json). O Deno real ignora este arquivo.

declare namespace Deno {
  interface Env {
    get(key: string): string | undefined;
  }
  const env: Env;
  function serve(handler: (request: Request) => Response | Promise<Response>): unknown;
}
