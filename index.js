/* ============================================================
   index.js — منطق تطبيق "رحلة النور" (النسخة الموسّعة)
   ============================================================
   يعتمد على وحدات مستقلة: CloudSync (Firebase) و Gamification
   (نقاط/أوسمة/تحدي/شهادة)، المُحمّلة قبل هذا الملف. لا تكرار
   لأي أسماء دوال أو متغيرات بينها.
   ============================================================ */

(function () {
  "use strict";

  /* ---------------------------------------------------------
     1) الحالة العامة للتطبيق
     --------------------------------------------------------- */
  const state = {
    familyId: null,          // معرّف العائلة المُطهَّر (مفتاح Firebase)
    childId: null,           // معرّف الطفل الحالي
    childName: "",
    gender: null,             // "boy" | "girl"
    stations: [],              // نسخة عاملة من STATIONS مع حالة كل سورة
    currentStationIndex: 0,
    currentSurahNumber: null,
    currentAyahs: null,        // آخر مصفوفة آيات مُحمَّلة (تُستخدم لبناء التحدي)
    audio: null,
    points: 0,
    badges: [],                // مصفوفة معرّفات الأوسمة المكتسبة
    loopAyahMode: false,
    loopSurahMode: false,
    cloudReady: false
  };

  let pendingAdvance = null;
  let pendingChallenge = null; // { stationIdx, surahNumber, correctAnswer }

  /* ---------------------------------------------------------
     2) تهيئة حالة المحطات (كما في النسخة الأساسية تماماً)
     --------------------------------------------------------- */
  function buildInitialStations() {
    return window.STATIONS.map((station, sIdx) => ({
      ...station,
      status: sIdx === 0 ? "active" : "locked",
      surahProgress: station.surahs.map((num, idx) => ({
        number: num,
        name: window.SURAH_NAMES[num] || `سورة ${num}`,
        ayahCount: window.SURAH_AYAHS_COUNT[num] || null,
        unlocked: sIdx === 0 && idx === 0,
        completed: false
      }))
    }));
  }

  /* ----- إعادة بناء حالة المحطات من سجل تقدّم محفوظ في Firebase -----
     cloudProgress shape: { station_1: { "1": true, "114": true, ... }, ... } */
  function applyCloudProgress(cloudProgress) {
    if (!cloudProgress) return;
    state.stations.forEach((station, sIdx) => {
      const key = `station_${sIdx + 1}`;
      const savedSurahs = cloudProgress[key];
      if (!savedSurahs) return;
      station.surahProgress.forEach(s => {
        if (savedSurahs[String(s.number)]) {
          s.completed = true;
        }
      });
    });

    // أعد حساب حالة "unlocked" بناءً على ما اكتمل فعلياً (تسلسلياً)
    state.stations.forEach((station, sIdx) => {
      station.surahProgress.forEach((s, idx) => {
        if (idx === 0) {
          s.unlocked = s.unlocked || sIdx === 0 || station.status === "active";
        }
        if (s.completed) {
          const next = station.surahProgress[idx + 1];
          if (next) next.unlocked = true;
        }
      });
      const stationFullyComplete = station.surahProgress.every(s => s.completed);
      if (stationFullyComplete) {
        const next = state.stations[sIdx + 1];
        if (next) {
          next.status = "active";
          if (next.surahProgress[0]) next.surahProgress[0].unlocked = true;
        }
      }
      if (station.surahProgress.some(s => s.completed) || sIdx === 0) {
        if (station.status === "locked") station.status = "active";
      }
    });
  }

  function totalSurahs() {
    return state.stations.reduce((sum, st) => sum + st.surahs.length, 0);
  }

  function completedSurahsCount() {
    return state.stations.reduce(
      (sum, st) => sum + st.surahProgress.filter(s => s.completed).length,
      0
    );
  }

  /* ---------------------------------------------------------
     3) أدوات التنقل بين الشاشات
     --------------------------------------------------------- */
  function showScreen(id) {
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    document.getElementById(id).classList.add("active");
  }

  function showPointsHeader(visible) {
    document.getElementById("pointsHeader").style.display = visible ? "flex" : "none";
  }

  /* ============================================================
     شاشة 0: بوابة العائلة
     ============================================================ */
  const familyIdInput = document.getElementById("familyIdInput");
  const familyPinInput = document.getElementById("familyPinInput");
  const gatewayError = document.getElementById("gatewayError");
  const gatewayHint = document.getElementById("gatewayHint");

  async function handleFamilyEnter() {
    const rawId = familyIdInput.value.trim();
    const pin = familyPinInput.value.trim();

    gatewayError.textContent = "";

    if (!rawId) {
      gatewayError.textContent = "من فضلك أدخل رقم هاتف العائلة أو بريدها الإلكتروني 📱";
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      gatewayError.textContent = "الرقم السري يجب أن يتكوّن من ٤ أرقام بالضبط 🔢";
      return;
    }

    if (!state.cloudReady) {
      // لا يوجد اتصال سحابي متاح؛ نعمل في وضع محلي بدون مزامنة
      gatewayError.textContent = "تنبيه: الاتصال بالسحابة غير متاح، سيعمل التطبيق محلياً دون حفظ دائم. " +
        (window.CloudSync ? (window.CloudSync.getInitError() || "") : "");
      state.familyId = window.CloudSync ? window.CloudSync.sanitizeFamilyId(rawId) : rawId;
      enterProfilesScreen({});
      return;
    }

    const btn = document.getElementById("btnFamilyEnter");
    btn.disabled = true;
    btn.textContent = "جارٍ التحقق... ⏳";

    try {
      const { safeId, data } = await CloudSync.fetchFamily(rawId);
      state.familyId = safeId;

      if (data) {
        // عائلة موجودة: تحقّق من الرقم السري
        if (String(data.pin) !== pin) {
          gatewayError.textContent = "الرقم السري غير صحيح، حاول مرة أخرى 🔒";
          btn.disabled = false;
          btn.textContent = "دخول / إنشاء حساب العائلة";
          return;
        }
        enterProfilesScreen(data.children || {});
      } else {
        // عائلة جديدة: أنشئها بهذا الرقم السري
        await CloudSync.createFamily(rawId, pin);
        enterProfilesScreen({});
      }
    } catch (err) {
      gatewayError.textContent = "حدث خطأ أثناء الاتصال بالسحابة. حاول مرة أخرى 🌐";
      console.error(err);
    } finally {
      btn.disabled = false;
      btn.textContent = "دخول / إنشاء حساب العائلة";
    }
  }

  document.getElementById("btnFamilyEnter").addEventListener("click", handleFamilyEnter);

  document.getElementById("btnGatewayLogout").addEventListener("click", () => {
    state.familyId = null;
    state.childId = null;
    showPointsHeader(false);
    familyIdInput.value = "";
    familyPinInput.value = "";
    showScreen("screen-gateway");
  });

  /* ============================================================
     شاشة 0.5: لوحة ملفات الأبطال
     ============================================================ */
  let familyChildren = {};

  function enterProfilesScreen(childrenObj) {
    familyChildren = childrenObj || {};
    renderProfilesGrid();
    showScreen("screen-profiles");
  }

  function renderProfilesGrid() {
    const grid = document.getElementById("profilesGrid");
    grid.innerHTML = "";

    const ids = Object.keys(familyChildren);
    if (ids.length === 0) {
      const empty = document.createElement("p");
      empty.className = "profiles-empty";
      empty.textContent = "لا يوجد أبطال بعد — أضف أول بطل أو أميرة! 👇";
      grid.appendChild(empty);
      return;
    }

    ids.forEach(childId => {
      const child = familyChildren[childId];
      const card = document.createElement("button");
      card.type = "button";
      card.className = "profile-card " + (child.gender === "boy" ? "profile-boy" : "profile-girl");
      const emoji = child.gender === "boy" ? "👦" : "👑";
      const pts = child.points || 0;
      card.innerHTML = `
        <span class="profile-avatar">${emoji}</span>
        <span class="profile-name">${escapeHTML(child.name)}</span>
        <span class="profile-points">${toArabicDigits(pts)} نقطة ⭐</span>
      `;
      card.addEventListener("click", () => selectChildProfile(childId, child));
      grid.appendChild(card);
    });
  }

  document.getElementById("btnAddProfile").addEventListener("click", () => {
    document.getElementById("newChildNameInput").value = "";
    document.getElementById("newChildError").textContent = "";
    document.getElementById("addProfileModal").classList.add("active");
  });

  document.getElementById("btnCancelAddProfile").addEventListener("click", () => {
    document.getElementById("addProfileModal").classList.remove("active");
  });

  async function handleAddChild(gender) {
    const nameInput = document.getElementById("newChildNameInput");
    const errEl = document.getElementById("newChildError");
    const name = nameInput.value.trim();

    if (!name) {
      errEl.textContent = "من فضلك اكتب اسم الطفل أولاً 😊";
      return;
    }

    const childId = "child_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
    const newChild = { name, gender, points: 0, badges: [], progress: {} };

    try {
      if (state.cloudReady && state.familyId) {
        await CloudSync.addChild(state.familyId, childId, name, gender);
      }
      familyChildren[childId] = newChild;
      document.getElementById("addProfileModal").classList.remove("active");
      renderProfilesGrid();
    } catch (err) {
      errEl.textContent = "تعذّر إنشاء الملف الشخصي، حاول مرة أخرى 🌐";
      console.error(err);
    }
  }

  document.getElementById("btnNewChildBoy").addEventListener("click", () => handleAddChild("boy"));
  document.getElementById("btnNewChildGirl").addEventListener("click", () => handleAddChild("girl"));

  function selectChildProfile(childId, childData) {
    state.childId = childId;
    state.childName = childData.name;
    state.gender = childData.gender;
    state.points = childData.points || 0;
    state.badges = childData.badges || [];
    state.stations = buildInitialStations();

    if (childData.progress) {
      applyCloudProgress(childData.progress);
    }

    document.body.classList.remove("theme-boy", "theme-girl");
    document.body.classList.add(state.gender === "boy" ? "theme-boy" : "theme-girl");

    updatePointsHeader();
    showPointsHeader(true);
    renderMap();
    showScreen("screen-map");
  }

  document.getElementById("btnSwitchProfile").addEventListener("click", () => {
    stopAudio();
    showPointsHeader(false);
    renderProfilesGrid();
    showScreen("screen-profiles");
  });

  /* ============================================================
     نظام النقاط والأوسمة — شريط علوي + معرض
     ============================================================ */
  function updatePointsHeader() {
    document.getElementById("pointsCount").textContent = toArabicDigits(state.points);
    document.getElementById("badgesCount").textContent = toArabicDigits(state.badges.length);
  }

  async function addPoints(amount) {
    state.points += amount;
    updatePointsHeader();
    if (state.cloudReady && state.familyId && state.childId) {
      try {
        await CloudSync.updatePoints(state.familyId, state.childId, state.points);
      } catch (err) {
        console.warn("[index.js] تعذّر مزامنة النقاط:", err);
      }
    }
  }

  async function grantBadgeForStation(stationIdx) {
    const badgeDef = Gamification.getBadgeForStation(stationIdx);
    if (!badgeDef) return;
    if (state.badges.includes(badgeDef.id)) return;

    state.badges.push(badgeDef.id);
    updatePointsHeader();

    if (state.cloudReady && state.familyId && state.childId) {
      try {
        await CloudSync.addBadge(state.familyId, state.childId, badgeDef.id, state.badges);
      } catch (err) {
        console.warn("[index.js] تعذّر مزامنة الوسام:", err);
      }
    }
  }

  function renderBadgesGallery() {
    const grid = document.getElementById("badgesGrid");
    grid.innerHTML = "";
    const allDefs = Gamification.getAllBadgeDefs();

    allDefs.forEach(badge => {
      const earned = state.badges.includes(badge.id);
      const tile = document.createElement("div");
      tile.className = "badge-tile" + (earned ? " badge-earned" : " badge-locked");
      tile.style.setProperty("--badge-color", badge.color);
      tile.innerHTML = `
        <span class="badge-icon">${earned ? badge.icon : "🔒"}</span>
        <span class="badge-name">${earned ? badge.name : "وسام مقفل"}</span>
      `;
      grid.appendChild(tile);
    });
  }

  document.getElementById("btnOpenBadges").addEventListener("click", () => {
    renderBadgesGallery();
    document.getElementById("badgesModal").classList.add("active");
  });

  document.getElementById("btnCloseBadges").addEventListener("click", () => {
    document.getElementById("badgesModal").classList.remove("active");
  });

  /* ============================================================
     شاشة 2: خريطة الرحلة (مطابقة للمنطق الأساسي الأصلي)
     ============================================================ */
  function renderMap() {
    const greetEl = document.getElementById("mapGreeting");
    greetEl.textContent = state.gender === "boy"
      ? `أهلاً بك يا بطل ${state.childName}! 👦`
      : `أهلاً بك يا أميرة ${state.childName}! 👑`;

    const total = totalSurahs();
    const completed = completedSurahsCount();
    document.getElementById("mapProgressLabel").textContent = `${completed} من ${total} سورة محفوظة`;
    document.getElementById("mapProgressFill").style.width =
      total > 0 ? `${Math.round((completed / total) * 100)}%` : "0%";

    const trail = document.getElementById("trailContainer");
    trail.innerHTML = "";

    state.stations.forEach((station, idx) => {
      const row = document.createElement("div");
      row.className = "station-row";

      const card = document.createElement("button");
      card.type = "button";
      card.style.setProperty("--station-color", station.color);

      const completedInStation = station.surahProgress.filter(s => s.completed).length;
      const isStationComplete = completedInStation === station.surahProgress.length;
      const isCurrent = station.status === "active" && idx === firstActiveIncompleteIndex();

      let classes = "station-card";
      if (station.status === "locked") classes += " locked-station";
      if (station.status === "active") classes += " active-station";
      if (isStationComplete) classes += " completed-station";
      if (isCurrent) classes += " current-station";
      card.className = classes;
      card.disabled = station.status === "locked";

      let badge = "🔒";
      if (isStationComplete) badge = "⭐";
      else if (station.status === "active") badge = "▶️";

      card.innerHTML = `
        <div class="station-icon-wrap">${station.status === "locked" ? "🔒" : station.icon}</div>
        <div class="station-info">
          <h3>${station.name}</h3>
          <p>${station.subtitle} · ${completedInStation}/${station.surahProgress.length} سورة</p>
        </div>
        <div class="station-status-badge">${badge}</div>
      `;

      if (station.status !== "locked") {
        card.addEventListener("click", () => openStation(idx));
      }

      row.appendChild(card);

      if (idx < state.stations.length - 1) {
        const connector = document.createElement("div");
        connector.className = "trail-connector";
        connector.innerHTML = `<span>. . . . .</span><span>🔽</span>`;
        row.appendChild(connector);
      }

      trail.appendChild(row);
    });
  }

  function firstActiveIncompleteIndex() {
    return state.stations.findIndex(
      st => st.status === "active" && st.surahProgress.some(s => !s.completed)
    );
  }

  /* ============================================================
     شاشة 3: قراءة السورة (مطابقة للمنطق الأساسي + إضافة التكرار)
     ============================================================ */
  function openStation(stationIdx) {
    state.currentStationIndex = stationIdx;
    const station = state.stations[stationIdx];

    const firstIncomplete = station.surahProgress.find(s => !s.completed);
    const target = firstIncomplete || station.surahProgress[0];

    renderRecitationHeader(station);
    loadSurah(stationIdx, target.number);
    showScreen("screen-recite");
  }

  function renderRecitationHeader(station) {
    document.getElementById("reciteStationName").textContent = station.name;

    const pillsContainer = document.getElementById("surahPillsContainer");
    pillsContainer.innerHTML = "";

    station.surahProgress.forEach(s => {
      const pill = document.createElement("button");
      pill.type = "button";
      let cls = "surah-pill";
      cls += s.unlocked ? " pill-unlocked" : " pill-locked";
      if (s.completed) cls += " pill-completed";
      if (s.number === state.currentSurahNumber) cls += " pill-current";
      pill.className = cls;
      pill.disabled = !s.unlocked;

      const icon = s.completed ? "✅" : (s.unlocked ? "🔓" : "🔒");
      pill.innerHTML = `${icon} ${s.name}`;

      if (s.unlocked) {
        pill.addEventListener("click", () => {
          loadSurah(state.currentStationIndex, s.number);
        });
      }
      pillsContainer.appendChild(pill);
    });
  }

  function findSurahProgress(stationIdx, surahNumber) {
    return state.stations[stationIdx].surahProgress.find(s => s.number === surahNumber);
  }

  async function loadSurah(stationIdx, surahNumber) {
    state.currentSurahNumber = surahNumber;
    renderRecitationHeader(state.stations[stationIdx]);

    const card = document.getElementById("quranCard");
    const reviewNote = document.getElementById("reviewNote");
    const progress = findSurahProgress(stationIdx, surahNumber);

    reviewNote.style.display = progress.completed ? "block" : "none";

    card.innerHTML = `<div class="quran-card-loading">جارٍ تحميل سورة ${progress.name}... ⏳</div>`;

    stopAudio();

    try {
      const res = await fetch(`https://api.alquran.cloud/v1/surah/${surahNumber}/quran-uthmani`);
      if (!res.ok) throw new Error("network");
      const json = await res.json();
      if (json.code !== 200 || !json.data || !Array.isArray(json.data.ayahs)) {
        throw new Error("bad-data");
      }
      renderSurahCard(stationIdx, surahNumber, json.data);
    } catch (err) {
      card.innerHTML = `
        <div class="quran-card-error">
          تعذّر تحميل نص السورة 😔<br>تحقق من الاتصال بالإنترنت وحاول مرة أخرى.
          <br>
          <button class="retry-btn" id="retryLoadBtn" type="button">إعادة المحاولة 🔁</button>
        </div>`;
      document.getElementById("retryLoadBtn").addEventListener("click", () => {
        loadSurah(stationIdx, surahNumber);
      });
    }
  }

  /* ----- منطق إزالة ازدواجية البسملة (دون أي تعديل عن النسخة الأساسية) ----- */
  const BASMALA_PATTERN = /^(بِسْمِ\s*اللَّهِ\s*الرَّحْمَٰ?نِ\s*الرَّحِيمِ|بِسۡمِ\s*ٱللَّهِ\s*ٱلرَّحۡمَٰنِ\s*ٱلرَّحِيمِ)\s*/u;

  function splitBasmala(firstAyahText) {
    const match = firstAyahText.match(BASMALA_PATTERN);
    if (match) {
      return { basmala: match[1], rest: firstAyahText.slice(match[0].length).trim() };
    }
    return { basmala: null, rest: firstAyahText };
  }

  function renderSurahCard(stationIdx, surahNumber, data) {
    const card = document.getElementById("quranCard");
    const progress = findSurahProgress(stationIdx, surahNumber);
    const ayahs = data.ayahs;

    let basmalaHTML = "";
    let bodyAyahs = ayahs;

    if (surahNumber === 1) {
      bodyAyahs = ayahs;
    } else {
      const first = ayahs[0];
      const { basmala, rest } = splitBasmala(first.text);
      const displayBasmala = basmala || "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ";
      basmalaHTML = `<span class="basmala-block">${displayBasmala}</span>`;

      bodyAyahs = ayahs.map((a, idx) => {
        if (idx === 0) return { ...a, text: rest };
        return a;
      });
    }

    state.currentAyahs = bodyAyahs; // يُستخدم لاحقاً لبناء تحدي الكلمة المفقودة

    const versesHTML = bodyAyahs
      .map(a => `${escapeHTML(a.text)} <span class="ayah-num">${toArabicDigits(a.numberInSurah)}</span>`)
      .join(" ");

    card.innerHTML = `
      <div class="surah-title-row">
        <p class="surah-name-ar">سورة ${progress.name}</p>
        <p class="surah-meta">${data.numberOfAyahs} آيات · ${data.revelationType === "Meccan" ? "مكية" : "مدنية"}</p>
      </div>
      ${basmalaHTML}
      <p class="quran-text">${versesHTML}</p>
      <div class="audio-bar">
        <button class="play-btn" id="playAudioBtn" type="button" aria-label="تشغيل التلاوة">▶️</button>
        <span class="audio-status" id="audioStatus">استمع إلى التلاوة الصوتية</span>
      </div>
      <div class="loop-toggles">
        <label class="loop-toggle">
          <input type="checkbox" id="loopAyahToggle">
          <span>تكرار الآية الحالية ×٣ 🔁</span>
        </label>
        <label class="loop-toggle">
          <input type="checkbox" id="loopSurahToggle">
          <span>تكرار السورة كاملة 🔂</span>
        </label>
      </div>
      <div class="action-row" id="actionRow"></div>
    `;

    setupAudio(surahNumber);

    document.getElementById("loopAyahToggle").addEventListener("change", e => {
      state.loopAyahMode = e.target.checked;
      if (state.loopAyahMode) {
        document.getElementById("loopSurahToggle").checked = false;
        state.loopSurahMode = false;
      }
    });
    document.getElementById("loopSurahToggle").addEventListener("change", e => {
      state.loopSurahMode = e.target.checked;
      if (state.loopSurahMode) {
        document.getElementById("loopAyahToggle").checked = false;
        state.loopAyahMode = false;
      }
    });

    const actionRow = document.getElementById("actionRow");
    if (!progress.completed) {
      const btn = document.createElement("button");
      btn.className = "memorize-btn";
      btn.type = "button";
      btn.textContent = "لقد حفظت السورة بنجاح 🎉";
      btn.addEventListener("click", () => startChallengeOrCelebrate(stationIdx, surahNumber));
      actionRow.appendChild(btn);
    }
  }

  function escapeHTML(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function toArabicDigits(num) {
    const map = ["٠","١","٢","٣","٤","٥","٦","٧","٨","٩"];
    return String(num).split("").map(d => map[d] ?? d).join("");
  }

  /* ----- محرك الصوت المحلي + التكرار الذكي ----- */
  function setupAudio(surahNumber) {
    const paddedNum = String(surahNumber).padStart(3, "0");
    const audio = new Audio(`audio/${paddedNum}.mp3`);
    state.audio = audio;

    const playBtn = document.getElementById("playAudioBtn");
    const statusEl = document.getElementById("audioStatus");

    let isPlaying = false;
    let ayahLoopCount = 0;
    const AYAH_LOOP_TARGET = 3;

    playBtn.addEventListener("click", () => {
      if (isPlaying) {
        audio.pause();
        return;
      }
      ayahLoopCount = 0;
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          statusEl.textContent = "اضغط زر التشغيل مرة أخرى للاستماع 🔊";
        });
      }
      // عند تفعيل النقاط: امنح نقاط الاستماع مرة واحدة فقط لكل تشغيل كامل (تُمنح عند ended)
    });

    audio.addEventListener("play", () => {
      isPlaying = true;
      playBtn.textContent = "⏸️";
      statusEl.textContent = "جارٍ تشغيل التلاوة... 🎧";
    });

    audio.addEventListener("pause", () => {
      isPlaying = false;
      playBtn.textContent = "▶️";
      statusEl.textContent = "التلاوة متوقفة مؤقتاً";
    });

    audio.addEventListener("ended", () => {
      isPlaying = false;

      if (state.loopAyahMode && ayahLoopCount < AYAH_LOOP_TARGET - 1) {
        ayahLoopCount += 1;
        statusEl.textContent = `إعادة التكرار (${toArabicDigits(ayahLoopCount + 1)}/${toArabicDigits(AYAH_LOOP_TARGET)})... 🔁`;
        audio.currentTime = 0;
        const p = audio.play();
        if (p !== undefined) p.catch(() => {});
        return;
      }

      if (state.loopSurahMode) {
        statusEl.textContent = "إعادة تشغيل السورة كاملة... 🔂";
        audio.currentTime = 0;
        const p = audio.play();
        if (p !== undefined) p.catch(() => {});
        return;
      }

      playBtn.textContent = "▶️";
      statusEl.textContent = "انتهت التلاوة ✅ يمكنك الاستماع مرة أخرى";
      addPoints(Gamification.POINTS.LISTEN_FULL_SURAH);
    });

    audio.addEventListener("error", () => {
      isPlaying = false;
      playBtn.textContent = "▶️";
      statusEl.textContent = "الملف الصوتي غير متوفر حالياً، يمكنك القراءة من النص 📖";
      playBtn.disabled = true;
    });
  }

  function stopAudio() {
    if (state.audio) {
      try {
        state.audio.pause();
        state.audio.currentTime = 0;
      } catch (e) { /* تجاهل أي خطأ عند الإيقاف */ }
      state.audio = null;
    }
    state.loopAyahMode = false;
    state.loopSurahMode = false;
  }

  /* ============================================================
     [الميزة 3] تحدي الحفظ الذكي — الكلمة المفقودة
     ============================================================ */
  function startChallengeOrCelebrate(stationIdx, surahNumber) {
    const challenge = state.currentAyahs ? Gamification.buildChallenge(state.currentAyahs) : null;

    if (!challenge) {
      // سورة قصيرة جداً لا يمكن بناء تحدٍ منها — انتقل مباشرة للاحتفال
      finalizeSurahCompletion(stationIdx, surahNumber);
      return;
    }

    pendingChallenge = { stationIdx, surahNumber, correctAnswer: challenge.correctAnswer };

    document.getElementById("challengeAyahText").textContent = challenge.maskedText;
    document.getElementById("challengeFeedback").textContent = "";
    document.getElementById("challengeFeedback").className = "challenge-feedback";

    const optionsContainer = document.getElementById("challengeOptions");
    optionsContainer.innerHTML = "";

    challenge.options.forEach(opt => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "challenge-option-btn";
      btn.textContent = opt;
      btn.addEventListener("click", () => handleChallengeAnswer(opt, btn));
      optionsContainer.appendChild(btn);
    });

    document.getElementById("challengeModal").classList.add("active");
  }

  function handleChallengeAnswer(selected, btnEl) {
    if (!pendingChallenge) return;
    const feedback = document.getElementById("challengeFeedback");
    const allBtns = document.querySelectorAll("#challengeOptions .challenge-option-btn");

    if (selected === pendingChallenge.correctAnswer) {
      allBtns.forEach(b => b.disabled = true);
      btnEl.classList.add("option-correct");
      feedback.textContent = "إجابة صحيحة! أحسنت 🌟";
      feedback.className = "challenge-feedback feedback-success";

      addPoints(Gamification.POINTS.PASS_CHALLENGE);

      const { stationIdx, surahNumber } = pendingChallenge;
      setTimeout(() => {
        document.getElementById("challengeModal").classList.remove("active");
        finalizeSurahCompletion(stationIdx, surahNumber);
        pendingChallenge = null;
      }, 900);
    } else {
      btnEl.classList.add("option-wrong");
      feedback.textContent = "حاول مرة أخرى يا بطل، اقتربت من الإجابة الصحيحة! 💡";
      feedback.className = "challenge-feedback feedback-hint";
      btnEl.disabled = true;
    }
  }

  /* ============================================================
     إكمال سورة فعلياً + فتح التالية + التقدم بين المحطات
     ============================================================ */
  async function finalizeSurahCompletion(stationIdx, surahNumber) {
    const station = state.stations[stationIdx];
    const progress = findSurahProgress(stationIdx, surahNumber);
    progress.completed = true;

    addPoints(Gamification.POINTS.MEMORIZE_SURAH);

    if (state.cloudReady && state.familyId && state.childId) {
      CloudSync.markSurahProgress(state.familyId, state.childId, stationIdx + 1, surahNumber)
        .catch(err => console.warn("[index.js] تعذّر مزامنة تقدّم السورة:", err));
    }

    const idxInStation = station.surahProgress.findIndex(s => s.number === surahNumber);
    const nextInStation = station.surahProgress[idxInStation + 1];
    if (nextInStation) {
      nextInStation.unlocked = true;
    }

    const stationFullyComplete = station.surahProgress.every(s => s.completed);
    let isFinalStation = false;

    if (stationFullyComplete) {
      await grantBadgeForStation(stationIdx);
      const nextStation = state.stations[stationIdx + 1];
      if (nextStation) {
        nextStation.status = "active";
        if (nextStation.surahProgress[0]) {
          nextStation.surahProgress[0].unlocked = true;
        }
      } else {
        // لا توجد محطة تالية: هذه كانت المحطة الأخيرة (التاسعة) — التتويج الكبير!
        isFinalStation = true;
      }
    }

    showCelebration(progress.name, stationIdx, surahNumber, stationFullyComplete, isFinalStation);
  }

  /* ============================================================
     شاشة 4: نافذة الاحتفال + الكونفيتي
     ============================================================ */
  function showCelebration(surahName, stationIdx, completedSurahNumber, stationFullyComplete, isFinalStation) {
    document.getElementById("celebrateName").textContent = state.childName;
    document.getElementById("celebrateSurah").textContent = `سورة ${surahName}`;
    document.getElementById("celebratePointsEarned").textContent =
      `+${toArabicDigits(Gamification.POINTS.MEMORIZE_SURAH)} نقطة 🌟`;

    pendingAdvance = { stationIdx, completedSurahNumber, stationFullyComplete, isFinalStation };

    const applause = document.getElementById("applauseAudio");
    applause.currentTime = 0;
    const p = applause.play();
    if (p !== undefined) p.catch(() => {});

    Gamification.fireConfetti();

    document.getElementById("celebrateModal").classList.add("active");
  }

  document.getElementById("btnNextStep").addEventListener("click", () => {
    document.getElementById("celebrateModal").classList.remove("active");
    if (!pendingAdvance) return;

    const { stationIdx, completedSurahNumber, stationFullyComplete, isFinalStation } = pendingAdvance;
    const station = state.stations[stationIdx];
    const idxInStation = station.surahProgress.findIndex(s => s.number === completedSurahNumber);
    const nextInStation = station.surahProgress[idxInStation + 1];

    renderMap();

    if (isFinalStation) {
      // [الميزة 5] حفل التتويج الكبير
      showCoronation();
    } else if (nextInStation) {
      renderRecitationHeader(station);
      loadSurah(stationIdx, nextInStation.number);
      showScreen("screen-recite");
    } else {
      showScreen("screen-map");
    }

    pendingAdvance = null;
  });

  /* ============================================================
     [الميزة 5] حفل التتويج الكبير + الشهادة القابلة للطباعة
     ============================================================ */
  function showCoronation() {
    const certHTML = Gamification.buildCertificateHTML(state.childName, state.points, state.badges.length);
    document.getElementById("certificateContainer").innerHTML = certHTML;
    Gamification.fireConfetti();
    showScreen("screen-coronation");
  }

  document.getElementById("btnPrintCertificate").addEventListener("click", () => {
    window.print();
  });

  document.getElementById("btnCoronationToMap").addEventListener("click", () => {
    showScreen("screen-map");
  });

  /* ============================================================
     زر العودة إلى الخريطة من شاشة القراءة
     ============================================================ */
  document.getElementById("btnBackToMap").addEventListener("click", () => {
    stopAudio();
    renderMap();
    showScreen("screen-map");
  });

  /* ============================================================
     تهيئة عامة عند تحميل الصفحة
     ============================================================ */
  state.cloudReady = window.CloudSync ? window.CloudSync.init() : false;
  if (!state.cloudReady) {
    gatewayHint.textContent = "تنبيه: لم يتم ضبط الاتصال بالسحابة بعد — يمكنك المتابعة محلياً، لكن لن يُحفظ التقدم بين الزيارات.";
  }

})();
