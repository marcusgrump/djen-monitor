import type { NextConfig } from "next";

// Publicado como site estático (GitHub Pages). Para servir em https://<usuario>.github.io/<repo>,
// defina NEXT_PUBLIC_BASE_PATH="/<repo>" no momento do build. Vazio = raiz do domínio.
const rawBasePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").trim().replace(/\/+$/, "");
const basePath = rawBasePath && !rawBasePath.startsWith("/") ? `/${rawBasePath}` : rawBasePath;

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  ...(basePath ? { basePath } : {}),
  env: {
    // Exposto ao cliente já normalizado (usado para montar URLs absolutas, ex.: redirect de senha).
    NEXT_PUBLIC_APP_BASE_PATH: basePath,
  },
};

export default nextConfig;
