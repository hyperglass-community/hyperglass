/**
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typescript: {
    ignoreBuildErrors: true,
  },
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
    // Shared results (`/?share=<id>`) are read from the backend's share API.
    { source: '/api/share/:id', destination: `${process.env.HYPERGLASS_URL}api/share/:id` },
    { source: '/images/:image*', destination: `${process.env.HYPERGLASS_URL}images/:image*` },
  ];
}

module.exports = nextConfig;
