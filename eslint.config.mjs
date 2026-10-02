import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Node.js 빌드·서명 스크립트는 CommonJS(require) 사용
  {
    files: ["scripts/**/*.{js,cjs}"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Electron 빌드 산출물
    "electron-dist/**",
    "dist-electron/**",
    // 벤더 번들 (Silero VAD worklet, 압축본)
    "public/vad/**",
  ]),
]);

export default eslintConfig;
