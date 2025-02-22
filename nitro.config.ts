//https://nitro.unjs.io/config
export default defineNitroConfig({
  preset: 'bun',
  srcDir: "server",
  minify: true,
  compatibilityDate: "2025-02-17",
  esbuild: {
    options: {
      target: 'esnext',
    }
  },
  experimental: {
    asyncContext: true
  }
});
