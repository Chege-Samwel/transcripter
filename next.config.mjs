/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Arena/Vercel previews proxy browser requests through an e2b.app origin.
  // Allow that origin during development so assets and auth navigation remain stable.
  allowedDevOrigins: ["*.e2b.app"],
};

export default nextConfig;
