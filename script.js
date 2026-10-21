(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const screens = { start: $("screen-start"), question: $("screen-question"), results: $("screen-results") };
  const MAX_OPTIONS = 6;

  let allQuestions = [];
  let session = null;
  let timerHandle = null;

  /* ---------- helpers ---------- */

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function pad(n) { return String(n).padStart(2, "0"); }

  function formatClock(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  function formatSeconds(ms) {
    return (ms / 1000).toFixed(1) + " s";
  }

  function formatDuration(ms) {
    return ms >= 60000 ? `${formatClock(ms)} (${formatSeconds(ms)})` : formatSeconds(ms);
  }

  function formatDateTime(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function show(name) {
    Object.keys(screens).forEach((k) => { screens[k].hidden = k !== name; });
    window.scrollTo(0, 0);
  }

  /* ---------- data loading ---------- */

  function isValidQuestion(q) {
    return q && typeof q.question === "string" && Array.isArray(q.options) &&
      q.options.length >= 2 && q.options.length <= MAX_OPTIONS &&
      Number.isInteger(q.correctAnswer) && q.correctAnswer >= 0 && q.correctAnswer < q.options.length;
  }

  async function loadQuestions() {
    const info = $("start-info");
    try {
      const res = await fetch("questions.json", { cache: "no-cache" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      allQuestions = (Array.isArray(data) ? data : []).filter(isValidQuestion);
      if (!allQuestions.length) throw new Error("No hay preguntas válidas");
      info.textContent = `${allQuestions.length} preguntas disponibles`;
      $("btn-start").disabled = false;
    } catch (err) {
      info.textContent = "No se pudieron cargar las preguntas (questions.json). " +
        "Si abres el archivo directamente, usa un servidor local (p. ej. npx serve).";
      console.error(err);
    }
  }

  /* ---------- session ---------- */

  function startSession() {
    stopTimer();
    session = {
      startTs: Date.now(),
      endTs: null,
      queue: shuffle(allQuestions),
      index: -1,
      current: null,
      records: [],
      finished: false
    };
    show("question");
    startTimer();
    nextQuestion();
  }

  function startTimer() {
    updateTimer();
    timerHandle = setInterval(updateTimer, 1000);
  }

  function stopTimer() {
    if (timerHandle) clearInterval(timerHandle);
    timerHandle = null;
  }

  function updateTimer() {
    if (!session) return;
    const end = session.endTs || Date.now();
    $("timer").textContent = formatClock(end - session.startTs);
  }

  function nextQuestion() {
    session.index++;
    if (session.index >= session.queue.length) {
      finishSession();
      return;
    }
    const q = session.queue[session.index];
    const shuffled = shuffle(q.options.map((text, orig) => ({ text, orig })));
    session.current = {
      source: q,
      options: shuffled,
      correctIndex: shuffled.findIndex((o) => o.orig === q.correctAnswer),
      selected: null,
      answered: false,
      startTs: Date.now()
    };
    renderQuestion();
  }

  function renderQuestion() {
    const c = session.current;
    const total = session.queue.length;
    $("progress").textContent = `Pregunta ${session.index + 1} de ${total}`;
    $("progress-bar").style.width = (session.index / total) * 100 + "%";
    $("question-text").textContent = c.source.question;
    $("question-source").textContent = c.source.source ? "Fuente: " + c.source.source : "";

    const box = $("options");
    box.textContent = "";
    c.options.forEach((opt, i) => {
      const b = el("button", "option");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", "false");
      b.dataset.index = String(i);
      b.appendChild(el("span", "num", String(i + 1)));
      b.appendChild(el("span", "txt", opt.text));
      b.addEventListener("click", () => selectOption(i));
      box.appendChild(b);
    });

    $("feedback").hidden = true;
    $("feedback").className = "feedback";
    $("btn-answer").hidden = false;
    $("btn-answer").disabled = true;
    $("btn-next").hidden = true;
    $("btn-skip").hidden = false;
  }

  function selectOption(i) {
    const c = session && session.current;
    if (!c || c.answered || i < 0 || i >= c.options.length) return;
    c.selected = i;
    Array.from($("options").children).forEach((b, idx) => {
      const on = idx === i;
      b.classList.toggle("selected", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
    });
    $("btn-answer").disabled = false;
  }

  function record(status) {
    const c = session.current;
    const endTs = Date.now();
    const correct = c.options[c.correctIndex].text;
    session.records.push({
      number: session.records.length + 1,
      question: c.source.question,
      options: c.options.map((o) => o.text),
      userAnswer: c.selected !== null ? c.options[c.selected].text : null,
      correctAnswer: correct,
      status,
      startTimestamp: c.startTs,
      endTimestamp: endTs,
      timeMs: endTs - c.startTs,
      source: c.source.source || ""
    });
  }

  function submitAnswer() {
    const c = session && session.current;
    if (!c || c.answered || c.selected === null) return;
    c.answered = true;
    const ok = c.selected === c.correctIndex;
    record(ok ? "correct" : "incorrect");

    const buttons = Array.from($("options").children);
    buttons.forEach((b, i) => {
      b.disabled = true;
      b.classList.remove("selected");
      if (i === c.correctIndex) b.classList.add("correct");
      else if (i === c.selected) b.classList.add("incorrect");
    });

    const fb = $("feedback");
    fb.hidden = false;
    fb.className = "feedback " + (ok ? "ok" : "ko");
    fb.textContent = ok ? "✅ Correcto" : "❌ Incorrecto";

    $("btn-answer").hidden = true;
    $("btn-skip").hidden = true;
    $("btn-next").hidden = false;
    $("btn-next").focus();
  }

  function skipQuestion() {
    const c = session && session.current;
    if (!c || c.answered) return;
    c.answered = true;
    record("skipped");
    nextQuestion();
  }

  function goNext() {
    const c = session && session.current;
    if (!c || !c.answered) return;
    nextQuestion();
  }

  function finishSession() {
    if (!session || session.finished) return;
    session.finished = true;
    session.endTs = Date.now();
    stopTimer();
    updateTimer();
    renderResults();
    show("results");
  }

  /* ---------- statistics ---------- */

  function computeStats() {
    const recs = session.records;
    const correct = recs.filter((r) => r.status === "correct");
    const incorrect = recs.filter((r) => r.status === "incorrect");
    const skipped = recs.filter((r) => r.status === "skipped");
    const answered = correct.length + incorrect.length;
    const seen = recs.length;
    const duration = session.endTs - session.startTs;
    const sum = (a) => a.reduce((t, r) => t + r.timeMs, 0);
    const answeredRecs = correct.concat(incorrect);
    const minOf = (a) => (a.length ? Math.min.apply(null, a.map((r) => r.timeMs)) : null);
    const maxOf = (a) => (a.length ? Math.max.apply(null, a.map((r) => r.timeMs)) : null);
    return {
      seen,
      correct: correct.length,
      incorrect: incorrect.length,
      skipped: skipped.length,
      answered,
      successRate: answered ? (correct.length / answered) * 100 : 0,
      durationMs: duration,
      avgTimeMs: seen ? sum(recs) / seen : null,
      avgResponseMs: answered ? sum(answeredRecs) / answered : null,
      fastestCorrectMs: minOf(correct),
      slowestCorrectMs: maxOf(correct),
      fastestResponseMs: minOf(answeredRecs),
      slowestResponseMs: maxOf(answeredRecs),
      perMinute: duration > 0 ? answered / (duration / 60000) : 0
    };
  }

  /* ---------- results rendering ---------- */

  function statBox(label, value, cls) {
    const d = el("div", "stat" + (cls ? " " + cls : ""));
    d.appendChild(el("span", "label", label));
    d.appendChild(el("span", "value", value));
    return d;
  }

  const dash = (ms, fn) => (ms === null ? "—" : fn(ms));

  function reviewItem(r, kind) {
    const item = el("article", "review-item " + kind);
    item.appendChild(el("p", "q", r.question));
    const dl = el("dl");
    const row = (k, v, cls) => {
      dl.appendChild(el("dt", "", k));
      dl.appendChild(el("dd", cls || "", v));
    };
    if (kind === "bad") row("Tu respuesta:", r.userAnswer, "wrong");
    row("Respuesta correcta:", r.correctAnswer, "right");
    row(kind === "bad" ? "Tiempo:" : "Tiempo antes de saltar:", formatSeconds(r.timeMs));
    row("PDF de origen:", r.source || "—");
    item.appendChild(dl);
    return item;
  }

  function fillList(box, recs, kind, emptyText) {
    box.textContent = "";
    if (!recs.length) box.appendChild(el("p", "empty", emptyText));
    recs.forEach((r) => box.appendChild(reviewItem(r, kind)));
  }

  function renderResults() {
    const s = computeStats();

    const sg = $("summary-grid");
    sg.textContent = "";
    sg.appendChild(statBox("Preguntas vistas", String(s.seen)));
    sg.appendChild(statBox("Respuestas correctas", String(s.correct), "good"));
    sg.appendChild(statBox("Respuestas incorrectas", String(s.incorrect), "bad"));
    sg.appendChild(statBox("Preguntas saltadas", String(s.skipped)));
    sg.appendChild(statBox("Porcentaje de acierto (sobre respondidas)", s.successRate.toFixed(1) + " %"));
    sg.appendChild(statBox("Tiempo total", formatClock(s.durationMs)));
    sg.appendChild(statBox("Tiempo medio por pregunta", dash(s.avgTimeMs, formatSeconds)));
    sg.appendChild(statBox("Respuesta correcta más rápida", dash(s.fastestCorrectMs, formatSeconds)));
    sg.appendChild(statBox("Respuesta correcta más lenta", dash(s.slowestCorrectMs, formatSeconds)));

    const dg = $("detail-grid");
    dg.textContent = "";
    dg.appendChild(statBox("Duración total de la sesión", formatClock(s.durationMs)));
    dg.appendChild(statBox("Preguntas respondidas por minuto", s.perMinute.toFixed(2)));
    dg.appendChild(statBox("Tiempo medio de respuesta", dash(s.avgResponseMs, formatSeconds)));
    dg.appendChild(statBox("Respuesta más rápida", dash(s.fastestResponseMs, formatSeconds)));
    dg.appendChild(statBox("Respuesta más lenta", dash(s.slowestResponseMs, formatSeconds)));

    fillList($("incorrect-list"), session.records.filter((r) => r.status === "incorrect"), "bad",
      "No has fallado ninguna pregunta.");
    fillList($("skipped-list"), session.records.filter((r) => r.status === "skipped"), "skip",
      "No has saltado ninguna pregunta.");

    const tbody = $("time-table").tBodies[0];
    tbody.textContent = "";
    if (!session.records.length) {
      const tr = el("tr");
      const td = el("td", "empty", "Sin preguntas respondidas.");
      td.colSpan = 6;
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
    const labels = { correct: ["Correcta", "res-ok"], incorrect: ["Incorrecta", "res-ko"], skipped: ["Saltada", "res-skip"] };
    session.records.forEach((r) => {
      const tr = el("tr");
      tr.appendChild(el("td", "", String(r.number)));
      tr.appendChild(el("td", "", r.question));
      tr.appendChild(el("td", labels[r.status][1], labels[r.status][0]));
      tr.appendChild(el("td", "mono", formatDateTime(r.startTimestamp).slice(11)));
      tr.appendChild(el("td", "mono", formatDateTime(r.endTimestamp).slice(11)));
      tr.appendChild(el("td", "mono", formatSeconds(r.timeMs)));
      tbody.appendChild(tr);
    });
  }

  /* ---------- export ---------- */

  function buildExport() {
    const s = computeStats();
    const start = new Date(session.startTs);
    return {
      date: formatDateTime(session.startTs).slice(0, 10),
      time: formatDateTime(session.startTs).slice(11),
      startedAt: start.toISOString(),
      sessionDurationSeconds: Math.round(s.durationMs / 100) / 10,
      sessionDuration: formatClock(s.durationMs),
      totalQuestionsSeen: s.seen,
      correctCount: s.correct,
      incorrectCount: s.incorrect,
      skippedCount: s.skipped,
      successPercentage: Math.round(s.successRate * 10) / 10,
      questions: session.records.map((r) => ({
        number: r.number,
        question: r.question,
        status: r.status,
        userAnswer: r.userAnswer,
        correctAnswer: r.correctAnswer,
        startTimestamp: new Date(r.startTimestamp).toISOString(),
        endTimestamp: new Date(r.endTimestamp).toISOString(),
        timeSeconds: Math.round(r.timeMs / 100) / 10,
        source: r.source
      }))
    };
  }

  function csvCell(v) {
    const t = v === null || v === undefined ? "" : String(v);
    return /[",\r\n;]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }

  function buildCsv(data) {
    const rows = [];
    const summary = [
      ["Date", data.date],
      ["Time", data.time],
      ["Session duration", data.sessionDuration],
      ["Session duration (seconds)", data.sessionDurationSeconds],
      ["Questions seen", data.totalQuestionsSeen],
      ["Correct", data.correctCount],
      ["Incorrect", data.incorrectCount],
      ["Skipped", data.skippedCount],
      ["Success percentage", data.successPercentage]
    ];
    summary.forEach((r) => rows.push(r.map(csvCell).join(",")));
    rows.push("");
    const head = ["Number", "Question", "Status", "User answer", "Correct answer",
      "Start", "End", "Time (s)", "Source"];
    rows.push(head.join(","));
    data.questions.forEach((q) => {
      rows.push([q.number, q.question, q.status, q.userAnswer, q.correctAnswer,
        q.startTimestamp, q.endTimestamp, q.timeSeconds, q.source].map(csvCell).join(","));
    });
    return rows.join("\r\n");
  }

  function download(filename, mime, content) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function fileStamp() {
    const d = new Date(session.startTs);
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  }

  function exportJson() {
    if (!session) return;
    download(`resultados-${fileStamp()}.json`, "application/json;charset=utf-8",
      JSON.stringify(buildExport(), null, 2));
  }

  function exportCsv() {
    if (!session) return;
    download(`resultados-${fileStamp()}.csv`, "text/csv;charset=utf-8",
      "\ufeff" + buildCsv(buildExport()));
  }

  /* ---------- new session ---------- */

  function newSession() {
    stopTimer();
    session = null;
    $("timer").textContent = "00:00";
    $("options").textContent = "";
    $("summary-grid").textContent = "";
    $("detail-grid").textContent = "";
    $("incorrect-list").textContent = "";
    $("skipped-list").textContent = "";
    $("time-table").tBodies[0].textContent = "";
    show("start");
  }

  /* ---------- events ---------- */

  $("btn-start").addEventListener("click", startSession);
  $("btn-answer").addEventListener("click", submitAnswer);
  $("btn-next").addEventListener("click", goNext);
  $("btn-skip").addEventListener("click", skipQuestion);
  $("btn-finish").addEventListener("click", finishSession);
  $("btn-export-json").addEventListener("click", exportJson);
  $("btn-export-csv").addEventListener("click", exportCsv);
  $("btn-new").addEventListener("click", newSession);

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!session || session.finished || screens.question.hidden) return;
    const c = session.current;
    if (!c) return;
    const k = e.key.toLowerCase();

    if (/^[1-6]$/.test(k)) {
      selectOption(Number(k) - 1);
    } else if (k === "enter") {
      e.preventDefault();
      if (!c.answered) submitAnswer();
      else goNext();
    } else if (k === "n") {
      goNext();
    } else if (k === "s") {
      skipQuestion();
    } else if (k === "f") {
      finishSession();
    }
  });

  loadQuestions();
})();
