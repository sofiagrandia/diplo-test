#!/usr/bin/env node
"use strict";
/*
 * Extracts multiple-choice questions from PDFs (bold option = correct answer).
 * Usage: node extract-questions.js [pdfDirectory] [outputDirectory]
 * Default input: ~/Downloads/tests    Default output: current directory
 * Writes questions.json (confident) and review.json (ambiguous, excluded).
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const INPUT_DIR = path.resolve(process.argv[2] || path.join(os.homedir(), "Downloads", "tests"));
const OUTPUT_DIR = path.resolve(process.argv[3] || process.cwd());

const BOLD_NAME = /bold|black|heavy|semibold|demibold|extrabold|\.b$|-bd\b|,bd\b/i;
const LETTERS = "abcdef";

function norm(s) {
  return s.replace(/\s+/g, " ").trim();
}

async function readLines(doc, pdfjs) {
  const pages = [];
  const fontInfo = {};
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    await page.getOperatorList(); // forces font loading into commonObjs
    const height = page.view[3] - page.view[1];
    const lines = [];
    let cur = null;
    for (const it of content.items) {
      if (typeof it.str !== "string" || it.str === "") continue;
      const y = it.transform[5];
      if (!fontInfo[it.fontName]) {
        try {
          const f = page.commonObjs.get(it.fontName);
          const name = f.name || "";
          fontInfo[it.fontName] = { name, namedBold: f.bold === true || BOLD_NAME.test(name) };
        } catch (e) {
          // font not resolved yet; retried on next occurrence
        }
      }
      if (!cur || Math.abs(cur.y - y) > 2.5) {
        cur = { y, segs: [], page: p, edge: y < height * 0.08 || y > height * 0.94 };
        lines.push(cur);
      }
      cur.segs.push({ text: it.str, font: it.fontName });
    }
    for (const l of lines) l.text = l.segs.map((s) => s.text).join("");
    pages.push(lines);
  }
  // remove page numbers at page edges and headers/footers repeated on most pages
  const freq = new Map();
  pages.forEach((lines) => {
    new Set(lines.map((l) => norm(l.text))).forEach((t) => freq.set(t, (freq.get(t) || 0) + 1));
  });
  const out = [];
  for (const lines of pages) {
    for (const l of lines) {
      const t = norm(l.text);
      if (!t) continue;
      if (l.edge && /^[\d\s\-–/]+$|^página\s*\d+/i.test(t)) continue;
      if (pages.length >= 4 && l.edge && freq.get(t) > pages.length / 2) continue;
      out.push(l);
    }
  }
  return { lines: out, fontInfo };
}

const KEY_LINE = /^\s*(\d{1,4})\s*[.)]?\s*([A-F])\s*$/;

// Some PDFs end with an official answer key ("1. C"). It is only used as a
// fallback for questions where no bold option exists; bold always wins.
function splitAnswerKey(lines) {
  const keyLines = lines.filter((l) => KEY_LINE.test(l.text));
  if (keyLines.length < 10) return { lines, key: {} };
  const key = {};
  keyLines.forEach((l) => {
    const m = l.text.match(KEY_LINE);
    key[Number(m[1])] = LETTERS.indexOf(m[2].toLowerCase());
  });
  return { lines: lines.filter((l) => !KEY_LINE.test(l.text)), key };
}

function parseQuestions(lines) {
  const questions = [];
  let q = null;
  let opt = null;
  let reserve = false;
  for (const line of lines) {
    const t = line.text;
    if (/^\s*-{5,}\s*$|^\s*preguntas?\s+de\s+reserva/i.test(t) || /^\s*proceso selectivo/i.test(t)) {
      if (!/proceso selectivo/i.test(t) && q) reserve = true;
      q = null;
      opt = null;
      continue;
    }
    const qm = t.match(/^\s*(\d{1,3})\s*[).]\s*(\S.*)?$/);
    const nextLetter = q ? LETTERS[q.options.length] : null;
    const om = q && nextLetter
      ? t.match(new RegExp("^\\s*" + nextLetter + "\\s*[).]\\s*(.*)$", "i"))
      : null;
    if (om) {
      opt = { segs: [] };
      q.options.push(opt);
      // drop the label (everything up to and including the first ')' or '.') from segments
      addSegments(opt, line.segs, true);
    } else if (qm && ((!q && !!qm[2]) || (q && q.options.length >= 2 && Number(qm[1]) === q.number + 1))) {
      q = { number: Number(qm[1]), reserve, stemSegs: [], options: [] };
      questions.push(q);
      opt = null;
      q.stemSegs.push(...stripLabel(line.segs, /^\s*\d{1,4}\s*[).]\s*/));
    } else if (q) {
      if (opt) addSegments(opt, line.segs, false);
      else q.stemSegs.push({ text: " ", font: null }, ...line.segs);
    }
  }
  return questions;
}

function stripLabel(segs, re) {
  const out = [];
  let acc = "";
  let done = false;
  for (const s of segs) {
    if (done) { out.push(s); continue; }
    acc += s.text;
    const m = acc.match(re);
    if (m) {
      done = true;
      const rest = acc.slice(m[0].length);
      const consumedBefore = acc.length - s.text.length;
      const cut = Math.max(0, m[0].length - consumedBefore);
      if (s.text.slice(cut)) out.push({ text: s.text.slice(cut), font: s.font });
      void rest;
    }
  }
  return out;
}

function addSegments(opt, segs, isFirst) {
  if (isFirst) {
    segs = stripLabel(segs, /^\s*[a-f]\s*[).]\s*/i);
  } else {
    opt.segs.push({ text: " ", font: null });
  }
  opt.segs.push(...segs);
}

function finalize(rawQuestions, fontInfo, source, key) {
  // Determine which fonts count as "bold".
  const used = new Set();
  const charsByFont = {};
  for (const q of rawQuestions) {
    for (const o of q.options) {
      for (const s of o.segs) {
        if (!s.font) continue;
        const n = s.text.replace(/[^\p{L}\p{N}]/gu, "").length;
        if (!n) continue;
        used.add(s.font);
        charsByFont[s.font] = (charsByFont[s.font] || 0) + n;
      }
    }
  }
  const anyNamedBold = [...used].some((f) => fontInfo[f] && fontInfo[f].namedBold);
  let dominant = null;
  Object.keys(charsByFont).forEach((f) => {
    if (!dominant || charsByFont[f] > charsByFont[dominant]) dominant = f;
  });
  const isBoldFont = (f) => (anyNamedBold ? !!(fontInfo[f] && fontInfo[f].namedBold) : f !== dominant);

  const good = [];
  const review = [];
  let keyUsed = 0;
  const numberCount = {};
  rawQuestions.forEach((q) => { numberCount[q.number] = (numberCount[q.number] || 0) + 1; });
  for (const q of rawQuestions) {
    const question = norm(q.stemSegs.map((s) => s.text).join(""));
    const options = q.options.map((o) => norm(o.segs.map((s) => s.text).join("")));
    const ratios = q.options.map((o) => {
      let bold = 0;
      let total = 0;
      for (const s of o.segs) {
        if (!s.font) continue;
        const n = s.text.replace(/[^\p{L}\p{N}]/gu, "").length;
        total += n;
        if (isBoldFont(s.font)) bold += n;
      }
      return total ? bold / total : 0;
    });
    const boldIdx = [];
    let unclear = false;
    ratios.forEach((r, i) => {
      if (r >= 0.9) boldIdx.push(i);
      else if (r > 0.1) unclear = true;
    });
    let reason = null;
    if (!question) reason = "Empty question text";
    else if (options.length < 2) reason = "Fewer than two options detected";
    else if (options.some((o) => !o)) reason = "Empty option text";
    else if (unclear) reason = "Partially bold option text";
    else if (boldIdx.length === 0) reason = "No bold option found";
    else if (boldIdx.length > 1) reason = "More than one bold option found";

    let fromKey = false;
    // A printed answer key, when the PDF has one, is authoritative (skipped if the question number appears twice in the PDF).
    const keyAnswer = key[q.number];
    if (options.length >= 2 && question && keyAnswer !== undefined && keyAnswer < options.length && numberCount[q.number] === 1) {
      boldIdx.length = 0;
      boldIdx.push(key[q.number]);
      reason = null;
      fromKey = true;
    }

    if (reason) {
      review.push({ number: q.number, question, options, boldCandidates: boldIdx, reason, source });
    } else {
      good.push({ question, options, correctAnswer: boldIdx[0], source });
      if (fromKey) keyUsed++;
    }
  }
  return { good, review, keyUsed };
}

async function main() {
  if (!fs.existsSync(INPUT_DIR)) {
    console.error("Input directory not found: " + INPUT_DIR);
    process.exit(1);
  }
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const files = fs.readdirSync(INPUT_DIR).filter((f) => /\.pdf$/i.test(f)).sort();
  if (!files.length) {
    console.error("No PDF files found in " + INPUT_DIR);
    process.exit(1);
  }
  const all = [];
  const allReview = [];
  for (const file of files) {
    const data = new Uint8Array(fs.readFileSync(path.join(INPUT_DIR, file)));
    const doc = await pdfjs.getDocument({ data, verbosity: 0 }).promise;
    const { lines, fontInfo } = await readLines(doc, pdfjs);
    const split = splitAnswerKey(lines);
    const raw = parseQuestions(split.lines);
    const { good, review, keyUsed } = finalize(raw, fontInfo, file, split.key);
    console.log(`${file}: ${raw.length} questions found, ${good.length} imported, ${review.length} for review` +
      (keyUsed ? ` (${keyUsed} answers taken from the PDF's printed answer key)` : ""));
    all.push(...good);
    allReview.push(...review);
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, "questions.json"), JSON.stringify(all, null, 2) + "\n");
  fs.writeFileSync(path.join(OUTPUT_DIR, "review.json"), JSON.stringify(allReview, null, 2) + "\n");
  console.log(`\nWrote ${all.length} questions to questions.json`);
  console.log(`Wrote ${allReview.length} ambiguous questions to review.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
