import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  devIndicators: false,
  // The seeded photos and fixtures are read from disk by API routes.
  outputFileTracingIncludes: { '/api/**': ['./public/photos/**', './fixtures/**', './seed/**'] },
};

export default nextConfig;
