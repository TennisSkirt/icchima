# わすれもの番長 イッチマン — 설정 가이드

가족 공유 + 푸시 알림 기능을 켜기 위한 Firebase 설정 순서입니다.
**설정 전에도 앱은 "로컬 모드"(이 기기 전용, 메모·체크·완료·반복구입 동작)로 사용할 수 있습니다.**

## 폴더 구조

```
icchima/
├── public/            # PWA 본체 (호스팅되는 파일)
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   ├── sw.js          # 오프라인 캐시 + 백그라운드 푸시
│   ├── firebase-config.js  # ★ 여기에 Firebase 키를 붙여넣음
│   ├── manifest.webmanifest
│   └── icons/
├── scripts/notify.js  # 예약 푸시 알림 스크립트 (GitHub Actions에서 실행)
├── .github/workflows/reminders.yml  # 금요일 18시 + 매일 아침 스케줄
├── firebase.json
├── firestore.rules    # 보안 규칙
└── SETUP.md
```

## 1. Firebase 프로젝트 만들기

1. https://console.firebase.google.com 접속 → **프로젝트 추가** (이름 예: `icchima`)
2. 왼쪽 메뉴 **빌드 > Authentication** → 시작하기 → 로그인 방법에서 **익명(Anonymous)** 사용 설정
3. **빌드 > Firestore Database** → 데이터베이스 만들기 → 위치는 `asia-northeast1`(도쿄) 또는 `asia-northeast3`(서울) 추천 → **프로덕션 모드**로 시작

## 2. 웹 앱 등록 & 키 붙여넣기

1. 프로젝트 설정(⚙️) > 일반 > 내 앱 > **웹 앱 추가**(`</>` 아이콘), 이름 예: `icchima-web`
2. 표시되는 `firebaseConfig` 값을 [public/firebase-config.js](public/firebase-config.js)의 `FIREBASE_CONFIG`에 붙여넣기
3. 프로젝트 설정 > **클라우드 메시징** 탭 > 웹 구성 > **웹 푸시 인증서 생성** → 키 쌍을 `VAPID_KEY`에 붙여넣기

## 3. 배포 (GitHub Pages — 무료, 로컬에 아무것도 설치 안 함)

1. github.com에서 새 저장소 생성 (이름 예: `icchima`)
   - **public(공개)** 이어야 무료 계정에서 GitHub Pages를 쓸 수 있습니다.
   - 코드가 공개되어도 안전합니다: `firebase-config.js`의 apiKey는 원래 웹에 공개되는 값이고,
     진짜 비밀인 서비스 계정 키는 GitHub **Secrets**에만 저장됩니다.
2. 이 폴더를 푸시:
   ```bash
   cd icchima
   git init && git add -A && git commit -m "イッチマ"
   git remote add origin https://github.com/<계정명>/icchima.git
   git push -u origin main
   ```
3. 저장소 **Settings > Pages** > Source를 **GitHub Actions**로 선택
   → 푸시할 때마다 자동 배포되고 주소는 `https://<계정명>.github.io/icchima/`
4. **Firebase 콘솔 > Authentication > Settings > 승인된 도메인**에 `<계정명>.github.io` 추가
   (이걸 안 하면 배포된 사이트에서 로그인이 차단됩니다)
5. (선택) 저장소 Settings > Secrets and variables > Actions > **Variables**에
   `APP_URL` = `https://<계정명>.github.io/icchima/` 등록 → 푸시 알림을 눌렀을 때 앱이 정확히 열립니다.

가족들은 이 주소를 스마트폰에서 열고 **홈 화면에 추가**하면 앱처럼 사용할 수 있습니다.

> ⚠️ iPhone(iOS 16.4+)은 **홈 화면에 추가한 후에만** 푸시 알림이 동작합니다.

**Firestore 보안 규칙 적용**: Firebase 콘솔 > Firestore Database > **규칙** 탭에
[firestore.rules](firestore.rules) 파일 내용을 붙여넣고 **게시**를 누르세요.
(CLI 없이 콘솔에서 바로 적용하는 방법입니다)

## 4. 예약 푸시 알림 (GitHub Actions — 완전 무료, Blaze 불필요)

금요일 18시 리마인드와 반복구입 리마인드는 GitHub Actions의 예약 실행(cron)으로 보냅니다.

1. **GitHub 저장소 만들기** — 이 `icchima` 폴더를 GitHub의 **비공개(private)** 저장소로 푸시
2. **서비스 계정 키 만들기** — Firebase 콘솔 > 프로젝트 설정(⚙️) > **서비스 계정** 탭 > **새 비공개 키 생성** → JSON 파일 다운로드
   (⚠️ 이 파일은 절대 저장소에 커밋하지 말 것 — .gitignore에 이미 차단되어 있음)
3. **GitHub Secret 등록** — 저장소 Settings > Secrets and variables > Actions > **New repository secret**
   - Name: `FIREBASE_SERVICE_ACCOUNT`
   - Value: 다운로드한 JSON 파일 내용 전체를 붙여넣기
4. 끝. 이후 자동으로 실행됩니다:
   - **금요일 18:00 (JST)** — 아직 사지 않은 물건 개수를 푸시로 알림
   - **매일 09:00 (JST)** — 반복구입 기한이 된 물건을 목록으로 되돌리고 푸시로 알림

테스트: 저장소 Actions 탭 > `icchima reminders` > **Run workflow**에서 mode를 골라 수동 실행할 수 있습니다.

> 참고: GitHub Actions의 cron은 몇 분 정도 지연될 수 있습니다(무료 인프라 특성). 리마인드 용도로는 충분합니다.

## 5. 가족과 공유하기

1. 앱을 처음 열면 **새 그룹 만들기** → 6자리 코드가 생성됨
2. 가족은 같은 주소를 열고 **코드로 참가**에 그 코드 입력
3. 이후 리스트가 실시간으로 동기화됨 (설정 ⚙️ 에서 코드 확인/복사 가능)
4. 각자 기기에서 설정 ⚙️ > **通知を有効にする**를 눌러야 푸시를 받습니다

## 참고

- 보안: 익명 로그인 + 6자리 코드를 아는 사람만 그룹에 접근하는 구조입니다. 코드 목록 조회(list)는 규칙으로 차단되어 있습니다.
- 로컬 모드 데이터는 Firebase 연결 후 자동 이전되지 않습니다(처음부터 공유 그룹으로 시작하는 걸 추천).
- 아이콘을 바꾸고 싶으면 `public/icons/icon.svg`를 수정한 뒤 PNG로 다시 변환하세요.
