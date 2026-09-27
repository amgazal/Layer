import { defineConfig } from '@playwright/test';
export default defineConfig({outputDir:'./test-results/production',testDir:'./tests/deployment',use:{baseURL:'http://127.0.0.1:4175'},webServer:{command:'node scripts/serve-production.mjs',url:'http://127.0.0.1:4175'}});
