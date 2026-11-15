import type { NextConfig } from "next";

// The unmodified company deployment provisions ONE Cloud Run image/service.
// Next.js must compile to static assets served by FastAPI in the final image.
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
