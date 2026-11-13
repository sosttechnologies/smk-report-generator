import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async rewrites() {
    // The UI is a static page in public/app; make /app and /app/ resolve to it.
    return [
      { source: '/app', destination: '/app/index.html' },
      { source: '/app/', destination: '/app/index.html' },
    ];
  },
  // No bare "/" redirect any more: src/middleware.ts decides where someone lands,
  // because an unauthenticated visitor must reach /signin and never /app.
};

export default nextConfig;
