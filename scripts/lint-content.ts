import { loadContent } from './content.ts';

const { errors, files } = loadContent();
if (errors.length) {
  console.error(`content lint: ${errors.length} problem(s)\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
console.log(`content lint: ${files.length} files OK`);
