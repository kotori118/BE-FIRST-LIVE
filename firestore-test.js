import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import {
  initializeFirestore, memoryLocalCache, doc, getDocFromServer,
  runTransaction, serverTimestamp, collection, query, limit, getDocsFromServer
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

const OWNER_UID = "xBt1XGXQjUg0UI9opk18Y76bucQ2";
const TEST_PATH = "diagnostics/firestoreConnection";
const MESSAGE = "BE-FIRST-LIVE connection test";
let app, auth, db, generation = 0, busy = false;
const $ = id => document.getElementById(id);

function status(text) { $("firestoreStatus").textContent = text; }
function controls() {
  const loggedIn = Boolean(auth?.currentUser);
  for (const id of ["saveTest", "readTest", "denyTest", "readCatalog"])
    if ($(id)) $(id).disabled = !loggedIn || busy || !navigator.onLine;
  $("firestoreNetwork").textContent = navigator.onLine ? "" : "インターネットに接続してください。";
  // Avoid changing accounts while an acknowledged server operation is running.
  for (const id of ["logout", "reset"]) $(id).disabled = busy;
}
export function connectFirestoreTest(firebaseApp, firebaseAuth) {
  app = firebaseApp;
  auth = firebaseAuth;
  db = initializeFirestore(app, { localCache: memoryLocalCache() });
  controls();
}
export function updateFirestoreUser(user) {
  generation++;
  $("firestorePanel").classList.toggle("hide", !user);
  $("gasPanel")?.classList.toggle("hide", !user);
  $("ownerStatus").textContent = !user ? "" : user.uid === OWNER_UID
    ? "設定した本人UIDと一致しています。"
    : "本人UIDと異なるアカウントです。データへのアクセスは拒否されます。";
  status("");
  controls();
}
function errorText(error) {
  if (error.code === "permission-denied")
    return "アクセスが拒否されました。本人のGoogleアカウントか確認し、Firebase Consoleで本人限定ルールを公開してください。";
  if (error.code === "unavailable")
    return "サーバーに接続できませんでした。接続状態を確認して、サーバーから読み直してください。";
  return `${error.code ?? "error"}: ${error.message ?? error}`;
}
async function run(action) {
  if (busy) return;
  if (!navigator.onLine) { status("インターネットに接続してください。"); return; }
  if (!auth?.currentUser) { status("Googleアカウントでログインしてください。"); return; }
  const currentGeneration = generation;
  busy = true;
  controls();
  status("サーバーで確認中…");
  try {
    const result = await action();
    if (currentGeneration === generation) status(result);
  } catch (error) {
    if (currentGeneration === generation) status(errorText(error));
  } finally {
    busy = false;
    controls();
  }
}
function describe(snapshot) {
  if (!snapshot.exists()) return "サーバーへの読み取りは成功。テストデータはまだありません。";
  const data = snapshot.data();
  if (data.message !== MESSAGE || typeof data.checkedAt?.toDate !== "function")
    throw new Error("テストデータの形式が一致しません。");
  return `サーバーからの読み取り成功！\n保存日時：${data.checkedAt.toDate().toLocaleString("ja-JP")}`;
}
$("saveTest").onclick = () => run(async () => {
  const ref = doc(db, TEST_PATH);
  // Transactions fail offline instead of leaving a queued offline write.
  await runTransaction(db, async transaction => {
    await transaction.get(ref);
    transaction.set(ref, { message: MESSAGE, checkedAt: serverTimestamp() });
  });
  try {
    const snapshot = await getDocFromServer(ref);
    if (!snapshot.exists()) throw new Error("保存後のデータが見つかりません。");
    return "1件の保存成功！\n" + describe(snapshot);
  } catch (error) {
    return "サーバーへの保存は成功しました。読み直しに失敗したため、再保存せず「サーバーから読み直す」で確認してください。\n" + errorText(error);
  }
});
$("readTest").onclick = () => run(async () => describe(await getDocFromServer(doc(db, TEST_PATH))));
$("denyTest").onclick = () => run(async () => {
  // A separate Firebase App has no authentication or shared sign-in state.
  const guestApp = initializeApp(app.options, "firestore-guest-" + crypto.randomUUID());
  const guestAuth = getAuth(guestApp);
  const guestDb = initializeFirestore(guestApp, { localCache: memoryLocalCache() });
  try {
    await guestAuth.authStateReady();
    if (guestAuth.currentUser) throw new Error("未ログイン状態を作成できませんでした。");
    try {
      await getDocFromServer(doc(guestDb, TEST_PATH));
    } catch (error) {
      if (error.code === "permission-denied") return "未ログインのアクセス拒否を確認できました。";
      throw error;
    }
    return "未ログインで読み取れてしまいました。Firestoreのルールを確認してください。";
  } finally {
    await deleteApp(guestApp);
  }
});
async function copyTextFile(buttonId, path, detailsId, textId) {
  try {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error("設定ファイルを取得できませんでした。");
    const text = await response.text();
    $(textId).value = text;
    $(detailsId).open = true;
    try { await navigator.clipboard.writeText(text); $(buttonId).textContent = "コピーしたよ ✓"; }
    catch { $(buttonId).textContent = "下の内容を長押ししてコピーしてね"; }
  } catch (error) { status(error.message); }
}
$("copyRules").onclick = () => copyTextFile("copyRules", "./firestore.rules", "rulesDetails", "rulesText");
if ($("copyGas")) $("copyGas").onclick = () => copyTextFile("copyGas", "./gas/UniverseSync.gs", "gasDetails", "gasText");
if ($("copyManifest")) $("copyManifest").onclick = () => copyTextFile("copyManifest", "./gas/appsscript.json", "manifestDetails", "manifestText");
if ($("readCatalog")) $("readCatalog").onclick = () => run(async () => {
  const ref = doc(db, "syncStatus/current");
  const before = await getDocFromServer(ref);
  if (!before.exists()) return "楽曲同期はまだ実行されていません。先にGASの接続確認を行ってください。";
  const songs = await getDocsFromServer(query(collection(db, "universeSongs"), limit(1001)));
  const after = await getDocFromServer(ref);
  if (!after.exists() || before.data().attemptId !== after.data().attemptId)
    return "楽曲を同期中です。もう一度「同期済みの楽曲を確認」を押してください。";
  if (songs.size > 1000) throw new Error("確認画面の取得上限を超えました。");
  const active = songs.docs.map(d => d.data()).filter(s => s.available !== false && s.artist === "BE:FIRST");
  const excluded = songs.docs.filter(d => d.data().artist !== "BE:FIRST").length;
  const info = after.data();
  const last = info.lastSuccessAt?.toDate?.().toLocaleString("ja-JP") ?? "まだありません";
  return `同期済み：${active.length}曲（BE:FIRST ${active.filter(s => s.artist === "BE:FIRST").length}曲）\n最終成功：${last}\n` +
    (excluded ? `対象外キャッシュが${excluded}曲残っています。更新したGASのプレビューで除外件数を確認してください。\n` : "") +
    (info.state === "ERROR" ? "最新の同期は失敗。前回の正常データを保持しています。" : "GASが最後に取得したデータです。起動時にSheetsへ直接同期する方式ではありません。");
});
window.addEventListener("online", controls);
window.addEventListener("offline", controls);
