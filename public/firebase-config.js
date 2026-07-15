// ============================================================
// Firebase 설정 (가족 공유 + 푸시 알림에 필요)
//
// 1. https://console.firebase.google.com 에서 프로젝트 생성
// 2. 프로젝트 설정 > 일반 > 내 앱 > 웹 앱 추가 → 아래에 설정값 붙여넣기
// 3. 프로젝트 설정 > 클라우드 메시징 > 웹 푸시 인증서 생성 → VAPID_KEY에 붙여넣기
//
// 설정 전에는 앱이 "로컬 모드"(이 기기 전용)로 동작합니다.
// 자세한 순서는 프로젝트 루트의 SETUP.md 참고.
// ============================================================
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDzfQps1Z3vA454NOznMVNiowGZA-Z26lI",
  authDomain: "icchima-6974.firebaseapp.com",
  projectId: "icchima-6974",
  storageBucket: "icchima-6974.firebasestorage.app",
  messagingSenderId: "153350804087",
  appId: "1:153350804087:web:9bcde226f0afd2ea4b6c72",
  measurementId: "G-8C4CNXCGCW"
};

const VAPID_KEY = "PASTE_YOUR_VAPID_PUBLIC_KEY";
