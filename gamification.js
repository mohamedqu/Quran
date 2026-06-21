/* ============================================================
   gamification.js — النقاط، الأوسمة، التحدي التفاعلي، الشهادة
   ============================================================
   وحدة مستقلة بالكامل عن index.js؛ تتواصل معه عبر دوال صريحة
   فقط (لا متغيرات مشتركة)، لتفادي أي تصادم في الأسماء.
   ============================================================ */

const Gamification = (function () {
  "use strict";

  /* ---------------------------------------------------------
     1) جدول النقاط
     --------------------------------------------------------- */
  const POINTS = {
    LISTEN_FULL_SURAH: 10,
    PASS_CHALLENGE: 20,
    MEMORIZE_SURAH: 50
  };

  /* ---------------------------------------------------------
     2) قائمة الأوسمة (وسام واحد لكل محطة، يُمنح عند فتح المحطة التالية)
     --------------------------------------------------------- */
  const BADGES = {
    station_1: { id: "station_1", name: "وسام الصقر النبيل", icon: "🦅", color: "#4a7c59" },
    station_2: { id: "station_2", name: "وسام الفارس الذكي", icon: "🛡️", color: "#d4af37" },
    station_3: { id: "station_3", name: "وسام الحارس الأمين", icon: "🕋", color: "#8b5e34" },
    station_4: { id: "station_4", name: "وسام المسافر الصابر", icon: "🍇", color: "#6a994e" },
    station_5: { id: "station_5", name: "وسام القمر المنير", icon: "🌙", color: "#3a5a78" },
    station_6: { id: "station_6", name: "وسام النخلة الطيبة", icon: "🌾", color: "#bc6c25" },
    station_7: { id: "station_7", name: "وسام عابر الصحراء", icon: "🏜️", color: "#cb997e" },
    station_8: { id: "station_8", name: "وسام الوادي الأخضر", icon: "🏞️", color: "#588157" },
    station_9: { id: "station_9", name: "وسام تاج النور الذهبي", icon: "👑", color: "#7d4f9a" }
  };

  function getBadgeForStation(stationIndex) {
    // stationIndex قاعدته صفر؛ الوسام يُمنح عند إكمال هذه المحطة (انتقالاً للتالية)
    return BADGES[`station_${stationIndex + 1}`] || null;
  }

  function getAllBadgeDefs() {
    return Object.values(BADGES);
  }

  /* ---------------------------------------------------------
     3) محرك تحدي "الكلمة المفقودة"
     --------------------------------------------------------- */

  /* يبني سؤال اختيار من متعدد من نص آية:
     - يختار آية عشوائية من السورة (تُفضَّل آية بها 4 كلمات فأكثر)
     - يخفي كلمتين متتاليتين عشوائياً
     - يولّد خيارين خاطئين بسحب كلمات من آيات أخرى لنفس السورة */
  function buildChallenge(ayahsArray) {
    // ayahsArray: [{ text, numberInSurah }, ...] — النص بعد إزالة البسملة من أول آية
    const eligible = ayahsArray
      .map((a, idx) => ({ ...a, words: a.text.trim().split(/\s+/).filter(Boolean) }))
      .filter(a => a.words.length >= 4);

    if (eligible.length === 0) return null;

    const targetAyah = eligible[Math.floor(Math.random() * eligible.length)];
    const words = targetAyah.words;

    // اختر موضع بداية لكلمتين متتاليتين (تجنّب الكلمة الأولى لتفادي تعقيد البداية)
    const maxStart = words.length - 2;
    const startPos = Math.max(0, Math.floor(Math.random() * maxStart));
    const correctPair = words.slice(startPos, startPos + 2).join(" ");

    const maskedWords = [...words];
    maskedWords[startPos] = "▢▢▢▢▢";
    maskedWords[startPos + 1] = "";
    const maskedText = maskedWords.filter(Boolean).join(" ");

    // اجمع كلمات مرشحة من آيات أخرى لتوليد خيارين خاطئين معقولين الطول
    const distractorPool = [];
    eligible.forEach(a => {
      if (a.numberInSurah === targetAyah.numberInSurah) return;
      for (let i = 0; i < a.words.length - 1; i++) {
        distractorPool.push(`${a.words[i]} ${a.words[i + 1]}`);
      }
    });

    const shuffledPool = distractorPool.sort(() => Math.random() - 0.5);
    const distractors = [];
    for (const candidate of shuffledPool) {
      if (candidate !== correctPair && !distractors.includes(candidate)) {
        distractors.push(candidate);
      }
      if (distractors.length === 2) break;
    }

    // إن لم تتوفر كلمات كافية من آيات أخرى (سورة قصيرة جداً)، لا تحدٍ ممكن
    if (distractors.length < 2) return null;

    const options = [correctPair, ...distractors].sort(() => Math.random() - 0.5);

    return {
      maskedText,
      correctAnswer: correctPair,
      options,
      ayahNumber: targetAyah.numberInSurah
    };
  }

  /* ---------------------------------------------------------
     4) الاحتفال البصري (Confetti)
     --------------------------------------------------------- */
  function fireConfetti() {
    if (typeof confetti !== "function") {
      console.warn("[Gamification] مكتبة canvas-confetti غير محمّلة.");
      return;
    }
    const duration = 1600;
    const end = Date.now() + duration;

    (function frame() {
      confetti({
        particleCount: 4,
        angle: 60,
        spread: 65,
        origin: { x: 0, y: 0.7 },
        colors: ["#d4af37", "#4a7c59", "#c77dff", "#ffffff"]
      });
      confetti({
        particleCount: 4,
        angle: 120,
        spread: 65,
        origin: { x: 1, y: 0.7 },
        colors: ["#d4af37", "#4a7c59", "#c77dff", "#ffffff"]
      });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();

    // انفجار مركزي إضافي عند البداية
    confetti({
      particleCount: 90,
      spread: 100,
      origin: { y: 0.5 },
      colors: ["#d4af37", "#4a7c59", "#c77dff", "#ffffff"]
    });
  }

  /* ---------------------------------------------------------
     5) شهادة التتويج القابلة للطباعة
     --------------------------------------------------------- */
  function buildCertificateHTML(childName, totalPoints, badgeCount) {
    const todayStr = new Date().toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" });
    return `
      <div class="certificate-card">
        <div class="cert-crown">👑</div>
        <p class="cert-eyebrow">شهادة تتويج</p>
        <h1 class="cert-title">بطل القرآن المتوّج</h1>
        <p class="cert-sub">تُمنح هذه الشهادة بكل فخر إلى النجم المتألق</p>
        <p class="cert-name">${escapeHTML(childName)}</p>
        <p class="cert-body">
          لإتمامه رحلة "رحلة النور" كاملةً من واحة مكة إلى أبواب دمشق،
          وحفظه جميع سور الرحلة بنجاح وثبات.
        </p>
        <div class="cert-stats">
          <div class="cert-stat"><span class="cert-stat-num">${toArabicDigitsLocal(totalPoints)}</span><span class="cert-stat-label">نقطة</span></div>
          <div class="cert-stat"><span class="cert-stat-num">${toArabicDigitsLocal(badgeCount)}</span><span class="cert-stat-label">وسام</span></div>
          <div class="cert-stat"><span class="cert-stat-num">٤٩</span><span class="cert-stat-label">سورة محفوظة</span></div>
        </div>
        <p class="cert-date">${todayStr}</p>
      </div>
    `;
  }

  function escapeHTML(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function toArabicDigitsLocal(num) {
    const map = ["٠","١","٢","٣","٤","٥","٦","٧","٨","٩"];
    return String(num).split("").map(d => map[d] ?? d).join("");
  }

  /* ---------------------------------------------------------
     6) شهادة تقدير تلقائية عند إتمام محطة/مرحلة (وليس الرحلة كاملة)
     ---------------------------------------------------------
     تصميم نظيف خالٍ من الأيقونات التزيينية الإضافية؛ يُستخدم نص
     الشهادة المعتمد حرفياً، مع تعبئة اسم الطفل واسم المحطة وقائمة
     السور المحفوظة في هذه المرحلة ديناميكياً. */
  function stripDecorativeEmoji(text) {
    // يزيل أي رموز إيموجي زخرفية من نهاية اسم المحطة (مثل 🌴 في "واحة مكة 🌴")
    // لإبقاء اسم المحطة نظيفاً داخل نص الشهادة الرسمي
    return String(text).replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F\u200D]+/gu, "").trim();
  }

  function buildPhaseCertificateHTML(childName, gender, stationName, surahNamesArray) {
    const todayStr = new Date().toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" });
    const cleanStationName = stripDecorativeEmoji(stationName);
    const roleLabel = gender === "boy" ? "الْبَطَلَ" : "الْأَمِيرَةَ";
    const surahsList = surahNamesArray.map(n => `سورة ${escapeHTML(n)}`).join("، ");

    return `
      <div class="phase-cert-card">
        <p class="phase-cert-emblem-line">📜 شَهَادَةُ تَقْدِيرٍ 📜</p>
        <p class="phase-cert-line">
          تَفْخَرُ إِدَارَةُ تَطْبِيقِ رِحْلَةِ النُّورِ بِأَنْ تُتَوِّجَ:
        </p>
        <p class="phase-cert-name-line">
          🏆 ${roleLabel}: ${escapeHTML(childName)} 🏆
        </p>
        <p class="phase-cert-line">
          لِإِتْمَامِهِ طَرِيقَ النُّورِ وَاجْتِيَازِ ${escapeHTML(cleanStationName)} بِجَدَارَةٍ،
          وَحِفْظِ السُّوَرِ الْكَرِيمَةِ:
        </p>
        <p class="phase-cert-surahs-line">📖 ${surahsList} 📖</p>
        <p class="phase-cert-closing-line">
          سَائِلِينَ اللَّهَ لَهُ التَّوْفِيقَ وَالسَّدَادَ فِي إِكْمَالِ رِحْلَتِهِ الْمُبَارَكَةِ
          لِحِفْظِ كِتَابِ اللَّهِ.
        </p>
        <p class="phase-cert-date">${todayStr}</p>
      </div>
    `;
  }

  return {
    POINTS,
    BADGES,
    getBadgeForStation,
    getAllBadgeDefs,
    buildChallenge,
    fireConfetti,
    buildCertificateHTML,
    buildPhaseCertificateHTML
  };
})();

if (typeof window !== "undefined") {
  window.Gamification = Gamification;
}
