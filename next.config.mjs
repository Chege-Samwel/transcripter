/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Arena/Vercel previews proxy browser requests through an e2b.app origin.
  // Allow that origin during development so assets and auth navigation remain stable.
  allowedDevOrigins: ["*.e2b.app"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
