# Training de Test

Static multiple-choice practice site (GitHub Pages ready).

1. `npm install`
2. `npm run extract` (reads `~/Downloads/tests`, or pass a path: `node extract-questions.js <pdfDir> [outDir]`) → `questions.json`, `review.json`
3. Serve locally (`npx serve .`) or push `index.html`, `styles.css`, `script.js`, `questions.json` to GitHub Pages.
