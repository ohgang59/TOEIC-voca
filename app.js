(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const catalog = window.TOEIC_CATALOG || {};
  const requestedBook = new URLSearchParams(window.location.search).get("book") || "basic";
  const BOOK = catalog[requestedBook] || catalog.basic;
  const BOOK_KEY = BOOK?.key || "basic";

  function showToast(message) {
    const toast = $("toast");
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => { toast.hidden = true; }, 2600);
  }

  function loadWordData() {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = BOOK.dataFile;
      script.addEventListener("load", () => resolve(window.TOEIC_WORDS));
      script.addEventListener("error", () => reject(new Error("word data load failed")));
      document.head.append(script);
    });
  }

  function showLoadingError() {
    $("cardCue").textContent = "단어 데이터를 불러오지 못했어요";
    $("cardText").textContent = "다시 열어주세요";
    $("selectionSummary").textContent = "잠시 후 페이지를 새로고침해 주세요";
    showToast("단어 데이터를 불러오지 못했습니다.");
  }

  function init(words) {
    const WORDS = Array.isArray(words) ? words : [];
    if (!WORDS.length) {
      showLoadingError();
      return;
    }

    const AVAILABLE_DAYS = [...new Set(WORDS.map((item) => item.day))]
      .sort((a, b) => dayNumber(a) - dayNumber(b));
    const AVAILABLE_DAY_SET = new Set(AVAILABLE_DAYS);
    const DEFAULT_DAY = AVAILABLE_DAYS[0];
    const STORAGE_KEY = `toeic-flip-progress-v1-${BOOK_KEY}`;
    const LEGACY_STORAGE_KEY = "toeic-flip-progress-v1";

    function loadSaved() {
      try {
        let raw = localStorage.getItem(STORAGE_KEY);
        if (!raw && BOOK_KEY === "basic") {
          raw = localStorage.getItem(LEGACY_STORAGE_KEY);
          if (raw) localStorage.setItem(STORAGE_KEY, raw);
        }
        const value = JSON.parse(raw || "{}");
        return {
          reviewIds: Array.isArray(value.reviewIds) ? value.reviewIds : [],
          selectedDays: Array.isArray(value.selectedDays) && value.selectedDays.length ? value.selectedDays : [DEFAULT_DAY],
          mode: value.mode === "ko" ? "ko" : "en",
          lifetimeDone: Number.isFinite(value.lifetimeDone) ? value.lifetimeDone : 0,
        };
      } catch {
        return { reviewIds: [], selectedDays: [DEFAULT_DAY], mode: "en", lifetimeDone: 0 };
      }
    }

    const saved = loadSaved();
    const validIds = new Set(WORDS.map((item) => item.id));
    const state = {
      selectedDays: new Set(saved.selectedDays.filter((day) => AVAILABLE_DAY_SET.has(day))),
      reviewIds: new Set(saved.reviewIds.filter((id) => validIds.has(id))),
      cards: [],
      index: 0,
      flipped: false,
      done: 0,
      complete: false,
      sessionType: "days",
      lifetimeDone: saved.lifetimeDone,
    };

    if (!state.selectedDays.size) state.selectedDays.add(DEFAULT_DAY);

    function save() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          reviewIds: [...state.reviewIds],
          selectedDays: [...state.selectedDays],
          mode: currentMode(),
          lifetimeDone: state.lifetimeDone,
        }));
      } catch {
        showToast("이 브라우저에서는 학습 기록을 저장할 수 없어요.");
      }
    }

    function shuffle(items) {
      const result = [...items];
      for (let i = result.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
      }
      return result;
    }

    function announce(message) {
      $("liveRegion").textContent = "";
      window.setTimeout(() => { $("liveRegion").textContent = message; }, 20);
    }

    function currentMode() {
      return document.querySelector('input[name="mode"]:checked')?.value || "en";
    }

    function currentCard() {
      return state.cards[state.index] || null;
    }

    function dayNumber(day) {
      return Number(String(day).replace("day", ""));
    }

    function dayLabel(days) {
      const sorted = [...days].sort((a, b) => dayNumber(a) - dayNumber(b));
      if (sorted.length <= 4) return sorted.map((day) => `DAY ${dayNumber(day)}`).join(" + ");
      return `${sorted.length} DAYS MIX`;
    }

    function selectedPool() {
      return WORDS.filter((item) => state.selectedDays.has(item.day));
    }

    function updateSelectionSummary() {
      const pool = selectedPool();
      const sorted = [...state.selectedDays].sort((a, b) => dayNumber(a) - dayNumber(b));
      const labels = sorted.length <= 5
        ? sorted.map((day) => `Day ${dayNumber(day)}`).join(", ")
        : `${sorted.length}개 Day`;
      $("selectionSummary").textContent = state.selectedDays.size
        ? `${labels} · ${pool.length.toLocaleString("ko-KR")}개`
        : "Day를 하나 이상 골라주세요";
    }

    function renderDayButtons() {
      document.querySelectorAll(".day-chip").forEach((button) => {
        button.setAttribute("aria-pressed", String(state.selectedDays.has(button.dataset.day)));
      });
      updateSelectionSummary();
    }

    function render() {
      const card = currentCard();
      const mode = currentMode();
      const total = state.cards.length;
      const flashcard = $("flashcard");
      const answerActions = $("answerActions");

      $("doneCount").textContent = state.done.toLocaleString("ko-KR");
      $("reviewCount").textContent = state.reviewIds.size.toLocaleString("ko-KR");
      $("reviewButton").disabled = state.reviewIds.size === 0;
      $("reviewListButton").disabled = state.reviewIds.size === 0;
      if ($("reviewDialog").open) renderReviewDialog();

      if (state.complete || !card) {
        flashcard.className = "flashcard is-complete";
        flashcard.disabled = true;
        $("cardDay").textContent = state.sessionType === "review" ? "REVIEW COMPLETE" : "SESSION COMPLETE";
        $("cardCue").textContent = `${state.done.toLocaleString("ko-KR")}개 카드를 확인했어요`;
        $("cardText").textContent = "학습 완료";
        document.querySelector(".flip-hint").textContent = state.sessionType === "review" && state.reviewIds.size
          ? `복습함에 ${state.reviewIds.size.toLocaleString("ko-KR")}개가 남아 있어요`
          : "범위를 골라 새로 섞어 시작할 수 있어요";
        $("progressText").textContent = `${total} / ${total}`;
        $("progressBar").style.width = "100%";
        answerActions.hidden = true;
        return;
      }

      const showingKorean = state.flipped ? mode === "en" : mode === "ko";
      const visibleText = state.flipped
        ? (mode === "en" ? card.meaning : card.word)
        : (mode === "en" ? card.word : card.meaning);

      flashcard.disabled = false;
      flashcard.className = `flashcard${state.flipped ? " is-flipped" : ""}${showingKorean ? " is-ko" : ""}`;
      $("cardDay").textContent = `DAY ${dayNumber(card.day)}`;
      $("cardCue").textContent = state.flipped ? (mode === "en" ? "한국어 뜻" : "영어 정답") : (mode === "en" ? "영어" : "한국어");
      $("cardText").textContent = visibleText;
      $("progressText").textContent = `${state.index + 1} / ${total}`;
      $("progressBar").style.width = `${(state.index / total) * 100}%`;
      $("sessionLabel").textContent = state.sessionType === "review" ? `${BOOK.name} · REVIEW BOX` : dayLabel(state.selectedDays);
      answerActions.hidden = !state.flipped;
      document.querySelector(".flip-hint").textContent = state.flipped ? "아래에서 기억 여부를 선택하세요" : "Space 눌러 카드 뒤집기";
    }

    function flip() {
      if (state.complete || !currentCard()) return;
      state.flipped = !state.flipped;
      render();
      if (state.flipped) announce(currentMode() === "en" ? "한국어 뜻을 표시했습니다." : "영어 정답을 표시했습니다.");
    }

    function speak() {
      const card = currentCard();
      if (!card || !("speechSynthesis" in window)) {
        showToast("이 브라우저에서는 발음 재생을 지원하지 않아요.");
        return;
      }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(card.word.replace(/\([^)]*\)/g, ""));
      utterance.lang = "en-US";
      utterance.rate = 0.82;
      window.speechSynthesis.speak(utterance);
    }

    function advance(result) {
      if (!state.flipped || state.complete) return false;
      const card = currentCard();
      if (result === "again") state.reviewIds.add(card.id);
      else state.reviewIds.delete(card.id);

      state.done += 1;
      state.lifetimeDone += 1;
      state.flipped = false;
      if (state.index >= state.cards.length - 1) {
        state.complete = true;
        save();
        render();
        announce("학습 세션을 완료했습니다.");
        return true;
      }
      state.index += 1;
      save();
      render();
      announce(result === "again" ? "복습함에 넣고 다음 카드로 이동했습니다." : "외운 단어로 처리하고 다음 카드로 이동했습니다.");
      return true;
    }

    function startSession(type = "days") {
      const pool = type === "review"
        ? WORDS.filter((item) => state.reviewIds.has(item.id))
        : selectedPool();

      if (!pool.length) {
        showToast(type === "review" ? "복습함이 비어 있어요." : "학습할 Day를 하나 이상 골라주세요.");
        return false;
      }

      state.cards = shuffle(pool);
      state.index = 0;
      state.flipped = false;
      state.done = 0;
      state.complete = false;
      state.sessionType = type;
      save();
      render();
      announce(`${BOOK.name} ${pool.length}개 단어를 무작위 순서로 시작합니다.`);
      if (window.matchMedia("(max-width: 700px)").matches) {
        $("flashcard").scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return true;
    }

    function buildDayGrid() {
      const counts = WORDS.reduce((map, item) => map.set(item.day, (map.get(item.day) || 0) + 1), new Map());
      for (const day of AVAILABLE_DAYS) {
        const number = dayNumber(day);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "day-chip";
        button.dataset.day = day;
        button.textContent = number;
        button.title = `Day ${number} · ${counts.get(day) || 0}개`;
        button.setAttribute("aria-label", `Day ${number}, ${counts.get(day) || 0}개 단어`);
        button.addEventListener("click", () => {
          if (state.selectedDays.has(day)) state.selectedDays.delete(day);
          else state.selectedDays.add(day);
          save();
          renderDayButtons();
        });
        $("dayGrid").append(button);
      }
      renderDayButtons();
    }

    function renderReviewDialog() {
      const reviewWords = WORDS.filter((item) => state.reviewIds.has(item.id));
      const body = $("reviewListBody");
      body.replaceChildren();
      $("reviewDialogSummary").textContent = `${reviewWords.length.toLocaleString("ko-KR")}개의 단어가 있어요`;
      $("reviewEmpty").hidden = reviewWords.length > 0;
      $("reviewTableWrap").hidden = reviewWords.length === 0;

      for (const item of reviewWords) {
        const row = document.createElement("tr");
        const day = document.createElement("td");
        const word = document.createElement("td");
        const meaning = document.createElement("td");
        day.textContent = `Day ${dayNumber(item.day)}`;
        word.textContent = item.word;
        meaning.textContent = item.meaning;
        word.className = "review-word";
        row.append(day, word, meaning);
        body.append(row);
      }
    }

    function openReviewDialog() {
      renderReviewDialog();
      $("reviewDialog").showModal();
      announce(`다시 볼 단어 ${state.reviewIds.size}개의 목록을 열었습니다.`);
    }

    function registerWebMcpTools() {
      const context = document.modelContext;
      if (!context?.registerTool) return;
      const reportError = () => {};
      const register = (tool) => {
        try { void Promise.resolve(context.registerTool(tool)).catch(reportError); } catch { reportError(); }
      };

      register({
        name: "start_study_session",
        title: "Day 섞어 학습 시작",
        description: `${BOOK.name}에서 선택한 Day들을 합쳐 무작위 학습 세션을 시작합니다.`,
        inputSchema: {
          type: "object",
          properties: {
            days: {
              type: "array",
              items: { type: "integer", minimum: dayNumber(AVAILABLE_DAYS[0]), maximum: dayNumber(AVAILABLE_DAYS.at(-1)) },
              minItems: 1,
              uniqueItems: true,
            },
            front: { type: "string", enum: ["english", "korean"] },
          },
          required: ["days", "front"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          const dayKeys = Array.isArray(input?.days) ? input.days.map((number) => `day${number}`) : [];
          if (!dayKeys.length || dayKeys.some((day) => !AVAILABLE_DAY_SET.has(day))) {
            throw new Error("days must contain available Day numbers");
          }
          if (!["english", "korean"].includes(input.front)) throw new Error("front must be english or korean");
          state.selectedDays = new Set(dayKeys);
          document.querySelector(`input[name="mode"][value="${input.front === "english" ? "en" : "ko"}"]`).checked = true;
          renderDayButtons();
          startSession("days");
          return { started: true, book: BOOK_KEY, cardCount: state.cards.length, days: input.days, front: input.front };
        },
      });

      register({
        name: "reveal_current_card",
        title: "현재 카드 뒤집기",
        description: "현재 카드의 뒷면을 표시하고 정답을 반환합니다.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute() {
          const card = currentCard();
          if (!card || state.complete) throw new Error("No active card");
          if (!state.flipped) flip();
          return { book: BOOK_KEY, word: card.word, meaning: card.meaning, day: dayNumber(card.day) };
        },
      });

      register({
        name: "rate_current_card",
        title: "현재 카드 분류",
        description: "뒤집은 현재 카드를 외운 단어 또는 다시 볼 단어로 분류합니다.",
        inputSchema: {
          type: "object",
          properties: { result: { type: "string", enum: ["known", "again"] } },
          required: ["result"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          if (!state.flipped) throw new Error("Reveal the current card before rating it");
          if (!input || !["known", "again"].includes(input.result)) throw new Error("result must be known or again");
          const rated = currentCard();
          advance(input.result);
          return {
            book: BOOK_KEY,
            rated: rated?.word,
            result: input.result,
            reviewCount: state.reviewIds.size,
            sessionComplete: state.complete,
          };
        },
      });
    }

    $("flashcard").addEventListener("click", flip);
    $("soundButton").addEventListener("click", speak);
    $("againButton").addEventListener("click", () => advance("again"));
    $("knownButton").addEventListener("click", () => advance("known"));
    $("startButton").addEventListener("click", () => startSession("days"));
    $("reviewButton").addEventListener("click", () => startSession("review"));
    $("reviewListButton").addEventListener("click", openReviewDialog);
    $("closeReviewDialog").addEventListener("click", () => $("reviewDialog").close());
    $("closeReviewDialogBottom").addEventListener("click", () => $("reviewDialog").close());
    $("reviewDialog").addEventListener("click", (event) => {
      if (event.target === $("reviewDialog")) $("reviewDialog").close();
    });
    $("selectAll").addEventListener("click", () => {
      state.selectedDays = new Set(AVAILABLE_DAYS);
      save();
      renderDayButtons();
    });
    $("clearDays").addEventListener("click", () => {
      state.selectedDays.clear();
      save();
      renderDayButtons();
    });
    document.querySelectorAll('input[name="mode"]').forEach((input) => {
      input.addEventListener("change", () => { save(); render(); });
    });
    document.addEventListener("keydown", (event) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;
      if (event.code === "Space") { event.preventDefault(); flip(); }
      if (event.key.toLowerCase() === "p") speak();
      if (event.key.toLowerCase() === "a") advance("again");
      if (event.key.toLowerCase() === "k") advance("known");
    });

    document.title = `TOEIC Flip · ${BOOK.name}`;
    $("bookName").textContent = BOOK.name;
    $("bookMeta").textContent = `${WORDS.length.toLocaleString("ko-KR")}개 · 복습 기록은 이 단어장에 따로 저장돼요`;
    $("startButton").disabled = false;
    document.querySelector(`input[name="mode"][value="${saved.mode}"]`).checked = true;
    buildDayGrid();
    startSession("days");
    registerWebMcpTools();
  }

  if (!BOOK?.dataFile) {
    showLoadingError();
    return;
  }

  $("bookName").textContent = BOOK.name;
  loadWordData().then(init).catch(showLoadingError);
})();
