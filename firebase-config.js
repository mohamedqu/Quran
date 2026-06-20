/* ============================================================
   firebase-config.js — إعدادات اتصال Firebase
   ============================================================
   ⚠️ هام جداً: استبدل القيم أدناه بإعدادات مشروعك الخاص في Firebase.
   احصل عليها من: Firebase Console → Project Settings → SDK setup
   تأكد أيضاً من تفعيل "Realtime Database" من قائمة Build في
   لوحة تحكم Firebase، وضبط قواعد الأمان (Rules) المناسبة.

   مثال لقواعد أمان بسيطة تناسب نموذج "هوية العائلة + PIN" المستخدم
   هنا (للتطوير فقط — يُفضّل قواعد أكثر صرامة قبل النشر الفعلي):

   {
     "rules": {
       "families": {
         "$familyId": {
           ".read": true,
           ".write": true
         }
       }
     }
   }
   ============================================================ */

const FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

if (typeof window !== "undefined") {
  window.FIREBASE_CONFIG = FIREBASE_CONFIG;
}
