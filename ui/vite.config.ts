import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

function stripLegacyKatexFonts(): Plugin {
  return {
    name: 'strip-legacy-katex-fonts',
    apply: 'build',
    generateBundle(_, bundle) {
      for (const [fileName, output] of Object.entries(bundle)) {
        if (/KaTeX_.*\.(?:ttf|woff)$/i.test(fileName)) {
          delete bundle[fileName];
          continue;
        }
        if (output.type === 'asset' && fileName.endsWith('.css') && typeof output.source === 'string') {
          output.source = output.source
            .replace(/,\s*url\([^)]*KaTeX_[^)]*\.(?:woff|ttf)(?:[?#][^)]*)?\)\s*format\([^)]*\)/gi, '')
            .replace(/url\([^)]*KaTeX_[^)]*\.(?:woff|ttf)(?:[?#][^)]*)?\)\s*format\([^)]*\)\s*,\s*/gi, '');
        }
      }
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), stripLegacyKatexFonts()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
