import esbuild from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
const production = process.argv.includes('production');
const context = await esbuild.context({
  entryPoints: ['src/main.ts'], bundle: true, format: 'cjs', platform: 'node',
  target: 'es2022', external: ['obsidian', 'electron'], outfile: 'main.js',
  sourcemap: production ? false : 'inline', minify: production,
  banner: { js: '/* DeepReviews — generated bundle. Source: src/main.ts */' }
});
if (production) {
  await context.rebuild();
  await context.dispose();
  await mkdir('dist/deepreviews', { recursive: true });
  for (const file of ['main.js', 'manifest.json', 'styles.css', 'LICENSE', 'THIRD_PARTY_NOTICES.txt']) {
    await copyFile(file, `dist/deepreviews/${file}`);
  }
  console.log('Installable plugin: dist/deepreviews');
} else {
  await context.watch();
  console.log('Watching DeepReviews sources…');
}
