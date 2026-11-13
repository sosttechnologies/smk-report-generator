import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async rewrites() {
    // The UI is a static page in public/app; make /app and /app/ resolve to it.
    return [
      { source: '/app', destination: '/app/index.html' },
      { source: '/app/', destination: '/app/index.html' },
    ];
  },
  async redirects() {
    return [{ source: '/', destination: '/app', permanent: false }];
  },
};

export default nextConfig;
