// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import { loadEnv } from 'vite';

// 開發時把 .env 載入 process.env（server 端程式一律讀 process.env；正式環境由平台注入）
const mode = process.env.NODE_ENV === 'production' ? 'production' : 'development';
for (const [k, v] of Object.entries(loadEnv(mode, process.cwd(), ''))) {
  if (process.env[k] === undefined) process.env[k] = v;
}

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
});
