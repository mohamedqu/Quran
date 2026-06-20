/* ============================================================
   cloud-sync.js — طبقة الاتصال بـ Firebase Realtime Database
   ============================================================
   هذا الملف مستقل تماماً عن index.js الأساسي؛ يوفّر واجهة بسيطة
   (CloudSync.*) يستدعيها index.js دون أي تداخل في الأسماء أو
   الحالة الداخلية.

   نموذج البيانات في Firebase:
   families/
     {familyId}/             <- رقم الهاتف أو البريد (مُطهَّر ليصلح كمفتاح)
       pin: "1234"
       children/
         {childId}/
           name: "أحمد"
           gender: "boy"
           points: 120
           badges: ["station_1", "station_2"]
           progress/
             {stationId}/
               {surahNumber}: true
   ============================================================ */

const CloudSync = (function () {
  "use strict";

  let app = null;
  let db = null;
  let available = false;
  let initError = null;

  function init() {
    try {
      if (typeof firebase === "undefined") {
        throw new Error("مكتبة Firebase غير محمّلة (تحقق من اتصال الإنترنت أو الـ CDN).");
      }
      if (!window.FIREBASE_CONFIG || window.FIREBASE_CONFIG.apiKey === "YOUR_API_KEY") {
        throw new Error("إعدادات Firebase لم تُضبط بعد — عدّل ملف firebase-config.js بمعلومات مشروعك.");
      }
      app = firebase.initializeApp(window.FIREBASE_CONFIG);
      db = firebase.database();
      available = true;
    } catch (err) {
      available = false;
      initError = err.message || String(err);
      console.warn("[CloudSync] تعذّر تهيئة Firebase:", initError);
    }
    return available;
  }

  function isAvailable() {
    return available;
  }

  function getInitError() {
    return initError;
  }

  /* ----- تطهير معرّف العائلة ليصلح كمفتاح Firebase -----
     مفاتيح Firebase لا تقبل: . # $ [ ] / */
  function sanitizeFamilyId(raw) {
    return raw.trim().toLowerCase().replace(/[.#$\[\]\/\s]/g, "_");
  }

  /* ----- جلب بيانات عائلة (للتحقق من وجودها ومطابقة الرقم السري) ----- */
  async function fetchFamily(familyId) {
    if (!available) throw new Error("الاتصال بالسحابة غير متاح حالياً.");
    const safeId = sanitizeFamilyId(familyId);
    const snap = await db.ref(`families/${safeId}`).once("value");
    return { safeId, data: snap.exists() ? snap.val() : null };
  }

  /* ----- إنشاء عائلة جديدة برقم سري ----- */
  async function createFamily(familyId, pin) {
    if (!available) throw new Error("الاتصال بالسحابة غير متاح حالياً.");
    const safeId = sanitizeFamilyId(familyId);
    await db.ref(`families/${safeId}`).set({
      pin: pin,
      children: {}
    });
    return safeId;
  }

  /* ----- إضافة طفل جديد لعائلة ----- */
  async function addChild(familyId, childId, name, gender) {
    if (!available) throw new Error("الاتصال بالسحابة غير متاح حالياً.");
    await db.ref(`families/${familyId}/children/${childId}`).set({
      name: name,
      gender: gender,
      points: 0,
      badges: [],
      progress: {}
    });
  }

  /* ----- جلب كل أطفال عائلة ----- */
  async function fetchChildren(familyId) {
    if (!available) throw new Error("الاتصال بالسحابة غير متاح حالياً.");
    const snap = await db.ref(`families/${familyId}/children`).once("value");
    return snap.exists() ? snap.val() : {};
  }

  /* ----- تحديث تقدّم سورة محددة لطفل (تُستدعى عند كل حفظ سورة) ----- */
  async function markSurahProgress(familyId, childId, stationId, surahNumber) {
    if (!available) return; // تجاهل بصمت إن لم تتوفر السحابة (التطبيق يعمل محلياً بدون انقطاع)
    const path = `families/${familyId}/children/${childId}/progress/station_${stationId}/${surahNumber}`;
    await db.ref(path).set(true);
  }

  /* ----- تحديث رصيد النقاط ----- */
  async function updatePoints(familyId, childId, newTotal) {
    if (!available) return;
    await db.ref(`families/${familyId}/children/${childId}/points`).set(newTotal);
  }

  /* ----- إضافة وسام جديد ----- */
  async function addBadge(familyId, childId, badgeId, currentBadges) {
    if (!available) return;
    const updated = Array.from(new Set([...(currentBadges || []), badgeId]));
    await db.ref(`families/${familyId}/children/${childId}/badges`).set(updated);
    return updated;
  }

  /* ----- جلب سجل تقدّم طفل كامل (يُستخدم عند فتح الملف الشخصي) ----- */
  async function fetchChildFull(familyId, childId) {
    if (!available) throw new Error("الاتصال بالسحابة غير متاح حالياً.");
    const snap = await db.ref(`families/${familyId}/children/${childId}`).once("value");
    return snap.exists() ? snap.val() : null;
  }

  return {
    init,
    isAvailable,
    getInitError,
    sanitizeFamilyId,
    fetchFamily,
    createFamily,
    addChild,
    fetchChildren,
    markSurahProgress,
    updatePoints,
    addBadge,
    fetchChildFull
  };
})();

if (typeof window !== "undefined") {
  window.CloudSync = CloudSync;
}
