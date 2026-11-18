import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const vditorSource = fileURLToPath(new URL('../ui/node_modules/vditor/dist/', import.meta.url));
const vditorOutRoot = fileURLToPath(new URL('../ui/dist/vditor/', import.meta.url));
const vditorOutDist = fileURLToPath(new URL('../ui/dist/vditor/dist/', import.meta.url));

await rm(vditorOutRoot, { recursive: true, force: true });

const requiredFiles = [
  'js/lute/lute.min.js',
  'js/i18n/fr_FR.js',
  'js/i18n/en_US.js',
];

for (const relativePath of requiredFiles) {
  const destination = new URL(relativePath, `file:///${vditorOutDist.replace(/\\/g, '/')}`);
  await mkdir(new URL('.', destination), { recursive: true });
  await cp(new URL(relativePath, `file:///${vditorSource.replace(/\\/g, '/')}`), destination);
}

await cp(
  fileURLToPath(new URL('../ui/node_modules/vditor/dist/css/content-theme', import.meta.url)),
  fileURLToPath(new URL('../ui/dist/vditor/dist/css/content-theme', import.meta.url)),
  { recursive: true },
);

await cp(
  fileURLToPath(new URL('../ui/node_modules/vditor/LICENSE', import.meta.url)),
  fileURLToPath(new URL('../ui/dist/vditor/LICENSE', import.meta.url)),
);

console.log('Copied minimal offline note editor assets and license');
