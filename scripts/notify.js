/* イッチマ — 予約プッシュ通知 (GitHub Actions から実行)
 *
 * 使い方:  MODE=friday node scripts/notify.js   … 未購入件数を通知
 *          MODE=repeat node scripts/notify.js   … 繰り返し品の期限確認 + 通知
 *
 * 環境変数 FIREBASE_SERVICE_ACCOUNT にサービスアカウントJSONを渡す。
 */
const admin = require("firebase-admin");

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
if (!sa.project_id) {
  console.error("FIREBASE_SERVICE_ACCOUNT env var is missing or invalid.");
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(sa) });

const db = admin.firestore();
const DAY_MS = 24 * 60 * 60 * 1000;
const MODE = process.env.MODE || "friday";
// 알림 클릭 시 열릴 앱 주소 (GitHub Pages 주소, 예: https://user.github.io/icchima/)
const APP_URL = (process.env.APP_URL || "/").replace(/\/?$/, "/");

async function sendToFamily(familyRef, title, body) {
  const tokensSnap = await familyRef.collection("tokens").get();
  const tokens = tokensSnap.docs.map((d) => d.id);
  if (!tokens.length) return 0;

  const res = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: { title, body },
    webpush: {
      fcmOptions: { link: APP_URL },
      notification: {
        icon: `${APP_URL}icons/icon-192.png`,
        badge: `${APP_URL}icons/icon-192.png`,
      },
    },
  });

  // 無効になったトークンを掃除
  const invalid = [];
  res.responses.forEach((r, i) => {
    if (!r.success) {
      const code = r.error && r.error.code;
      if (code === "messaging/registration-token-not-registered" ||
          code === "messaging/invalid-argument") {
        invalid.push(tokens[i]);
      }
    }
  });
  await Promise.all(invalid.map((t) => familyRef.collection("tokens").doc(t).delete()));
  return res.successCount;
}

async function fridayReminder() {
  const families = await db.collection("families").get();
  for (const fam of families.docs) {
    const undone = await fam.ref.collection("items").where("done", "==", false).get();
    if (undone.empty) continue;
    const sent = await sendToFamily(
      fam.ref,
      "わすれもの番長 イッチマン 🛍",
      `まだ買っていないものが${undone.size}件あるぞ！週末の買い物、忘れるなよ！`
    );
    console.log(`[friday] family=${fam.id} undone=${undone.size} sent=${sent}`);
  }
}

async function repeatCheck() {
  const now = Date.now();
  const families = await db.collection("families").get();
  for (const fam of families.docs) {
    const doneItems = await fam.ref.collection("items").where("done", "==", true).get();
    const due = doneItems.docs.filter((d) => {
      const it = d.data();
      return it.repeatDays > 0 && it.completedAt &&
             it.completedAt + it.repeatDays * DAY_MS <= now;
    });
    if (!due.length) continue;

    const batch = db.batch();
    due.forEach((d) => batch.update(d.ref, { done: false, completedAt: null }));
    await batch.commit();

    const names = due.map((d) => `「${d.data().name}」`).join("、");
    const sent = await sendToFamily(fam.ref, "わすれもの番長 イッチマン 🔁", `${names}をまた買う時期だ！リストに戻しておいたぞ！`);
    console.log(`[repeat] family=${fam.id} due=${due.length} sent=${sent}`);
  }
}

(MODE === "repeat" ? repeatCheck() : fridayReminder())
  .then(() => { console.log(`done (mode=${MODE})`); process.exit(0); })
  .catch((e) => { console.error(e); process.exit(1); });
