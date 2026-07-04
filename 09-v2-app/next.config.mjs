/** @type {import('next').NextConfig} */
const nextConfig = {
  // The JSON dev store and CBS seed live outside the app dir; keep them out of file tracing.
  outputFileTracingExcludes: { "*": ["./data/**"] },
};

export default nextConfig;
