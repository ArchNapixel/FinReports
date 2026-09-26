/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // react-pdf and exceljs are Node-only; keep them out of the server bundle.
    serverComponentsExternalPackages: ["@react-pdf/renderer", "exceljs"],
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
