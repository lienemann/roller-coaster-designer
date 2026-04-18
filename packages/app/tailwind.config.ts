// SPDX-License-Identifier: GPL-3.0-only
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Neutral design surface. Dialed in properly at M7 once the viewport
        // exists and we can check legibility against the 3D canvas.
        surface: {
          0: '#0b0b0b',
          1: '#141414',
          2: '#1c1c1c',
          3: '#262626',
        },
      },
      fontFamily: {
        sans: [
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};

// Tailwind's CLI expects a default export. This file is whitelisted from the
// no-default-export rule in eslint.config.js.
export default config;
