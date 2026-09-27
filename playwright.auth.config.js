import { defineConfig } from '@playwright/test';
export default defineConfig({outputDir:'./test-results/auth',testDir:'./tests/auth',workers:1,
  use:{baseURL:'http://127.0.0.1:4174',reducedMotion:'reduce'},
  webServer:{command:'npm run dev -- --host 127.0.0.1 --port 4174',url:'http://127.0.0.1:4174'},
});
