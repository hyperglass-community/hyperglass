/**
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  // The UI lints with Biome (`pnpm run lint`). Without this, `next build` runs its own
  // ESLint step, which only warns that no ESLint configuration exists.
  eslint: {
    ignoreDuringBuilds: true,
  },
  productionBrowserSourceMaps: true,
};

if (process.env.NODE_ENV === 'production') {
  nextConfig.output = 'export';
}

if (process.env.NODE_ENV === 'development') {
  nextConfig.rewrites = async () => [
    { source: '/api/query', destination: `${process.env.HYPERGLASS_URL}api/query` },
    // Shared results (`/?share=<id>`) are read from the backend's share API, and a
    // result's Share button creates (`POST /api/share`) and deletes them.
    { source: '/api/share', destination: `${process.env.HYPERGLASS_URL}api/share` },
    { source: '/api/share/:id', destination: `${process.env.HYPERGLASS_URL}api/share/:id` },
    { source: '/images/:image*', destination: `${process.env.HYPERGLASS_URL}images/:image*` },
  ];
}

module.exports = nextConfig;
