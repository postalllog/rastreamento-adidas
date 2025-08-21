/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // Desabilitar para evitar problemas com Leaflet
  swcMinify: true,
  compiler: {
    removeConsole: process.env.NODE_ENV === "production"
  },
  experimental: {
    serverComponentsExternalPackages: ['leaflet']
  },
  webpack: (config, { isServer }) => {
    // Configuração para Leaflet
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }
    
    // Ignorar canvas para evitar erros
    config.externals = [...config.externals, { canvas: 'canvas' }];
    
    return config;
  },
  transpilePackages: ['react-leaflet'],
}

module.exports = nextConfig