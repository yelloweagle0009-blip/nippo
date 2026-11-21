// 運行連絡の試験：エミュレーターに作った道順の位置（GPS）を流して、
// 着いた・出た・通り過ぎ・隣どうしの場所・登録していない場所で止まった・電波切れ・アプリが止められたあとの再開・帰庫で自動で止まる
// を確かめる。アプリは「ホーム」に下げて画面を消した状態で走らせる（使用中のみの許可で、裏でも記録が続くか）。
// 判定の秒数は試験のために短くする（着いた 20秒・出た 10秒・止まった 30秒）。本番の値は 2分・1分・5分。
const WebSocket = require('ws');
const { execSync } = require('child_process');
const fs = require('fs');
let passed = false; process.exitCode = 1;
setTimeout(() => { console.log('FAIL: 時間切れ（20分）'); dump(); process.exit(8); }, 20 * 60 * 1000).unref();
process.on('exit', () => { if (!passed) console.log('FAIL: 途中で終わった'); });
const sh = c => { try { return execSync(c, { encoding: 'utf8', timeout: 60000 }).trim(); } catch (e) { return 'ERR ' + (e.stdout || '') + (e.stderr || ''); } };
const adb = c => sh('adb ' + c);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PKG = 'jp.nippo.unkou';
const readTrip = () => { const s = adb(`shell cat /data/data/${PKG}/files/trip.json`); try { return JSON.parse(s); } catch (e) { return { err: s.slice(0, 200) }; } };
const emuNow = () => Number(adb('shell date +%s')) * 1000;
function dump() { try { fs.writeFileSync('out/trip.json', JSON.stringify(readTrip(), null, 1)); } catch (e) { } }

// ---- 場所（試験用の架空の位置。緯度 0.001 ≒ 111m、経度 0.001 ≒ 90m）----
const P = {
  G: [35.6000, 138.5000], MC: [35.6100, 138.5100], KM: [35.6100, 138.5110], PA: [35.6200, 138.5200], F: [35.6300, 138.5300], X: [35.6400, 138.5400],
  R1: [35.6050, 138.5050], R2: [35.6150, 138.5150], R3: [35.6200, 138.5050], R4: [35.6450, 138.5450], R5: [35.6350, 138.5350], R6: [35.6250, 138.5250], MCD: [35.6105, 138.5100],
};
const fix = ([lat, lon]) => adb(`emu geo fix ${lon} ${lat}`);
async function at(name, sec) { const t = Date.now(); while (Date.now() - t < sec * 1000) { fix(P[name]); await sleep(3000); } }

async function page(port) {
  for (let k = 0; k < 60; k++) {
    try { const l = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const g = l.find(x => x.type === 'page' && x.url.includes('/nippo/')); if (g) return g; } catch (e) { }
    await sleep(1000);
  }
  return null;
}
async function connect(port) {
  const pg = await page(port); if (!pg) throw new Error('画面につながらない');
  const ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((ok, ng) => { ws.on('open', ok); ws.on('error', ng); });
  let id = 0; const wait = {};
  ws.on('message', m => { const d = JSON.parse(m); if (d.id && wait[d.id]) { wait[d.id](d); delete wait[d.id]; } });
  const ev = expr => new Promise(ok => { const i = ++id; wait[i] = ok; ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } })); })
    .then(d => { if (d.result && d.result.exceptionDetails) throw new Error(JSON.stringify(d.result.exceptionDetails).slice(0, 300)); return d.result && d.result.result && d.result.result.value; });
  return { ws, ev };
}
const fails = [];
const check = (ok, what, detail) => { console.log((ok ? 'OK   ' : 'NG   ') + what + (detail !== undefined ? '  ' + JSON.stringify(detail) : '')); if (!ok) fails.push(what); };

(async () => {
  console.log('ROOT', adb('root')); await sleep(4000); adb('wait-for-device');
  adb('shell svc power stayon true');
  // 試験の前に、位置を車庫に置いておく
  for (let k = 0; k < 3; k++) { fix(P.G); await sleep(1500); }
  let pid = adb(`shell pidof ${PKG}`); adb(`forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
  let c = await connect(9222);
  const today = await c.ev(`(()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')})()`);
  const conf = {
    cars: [6, 8], car: 8, tenko: '6:00', plan: '勝山', planDay: today,
    params: { dwellSec: 20, exitSec: 10, farM: 300, stopSec: 30, stopR: 50, stillSec: 15, gapSec: 40, freshSec: 10, accMax: 50 },
    places: [
      { id: 'g', name: '車庫', type: 'garage', r: 60, lat: P.G[0], lon: P.G[1], arrText: '', doneTexts: [] },
      { id: 'mc', name: 'KFKマシンセンター', type: 'site', r: 50, lat: P.MC[0], lon: P.MC[1], arrText: 'マシンセンター到着しました！', beforeTexts: ['{planMsg}'], doneTexts: ['KFK完了！帰庫します！'] },
      { id: 'km', name: 'KFK甲府南工場', type: 'site', r: 50, lat: P.KM[0], lon: P.KM[1], arrText: '甲府南工場着です！', beforeTexts: ['{planMsg}'], doneTexts: ['KFK完了！帰庫します！', '勝山引き取り分、納品完了しました！小石和倉庫の横持ちに向います！'] },
      { id: 'pa', name: '国母パナソニック', type: 'site', r: 60, lat: P.PA[0], lon: P.PA[1], arrText: '', doneTexts: ['Panasonic{n}回目納品完了しました！'] },
      { id: 'f', name: '牧野フライス富士吉田', type: 'site', r: 60, lat: P.F[0], lon: P.F[1], arrText: '', doneTexts: ['富士吉田納品引き取り完了！{next}に向います！', '富士吉田納品引き取り完了しました！', '富士吉田納品完了！引き取り無しです！'] },
    ] };
  const info = await c.ev(`(()=>{ window.__st=[]; window.onTripStarted=r=>window.__st.push(r); return JSON.stringify({avail:NippoAndroid.tripAvailable(), save:NippoAndroid.confSave(${JSON.stringify(JSON.stringify(conf))})}); })()`);
  console.log('SETUP', info);
  check(JSON.parse(info).avail === true && JSON.parse(info).save === true, '運行連絡が使える・設定を保存できた');

  // ---- 出庫 ----
  await c.ev('NippoAndroid.tripStart(8)');
  await at('G', 12);
  const st0 = await c.ev('JSON.stringify(window.__st)'); console.log('STARTED', st0);
  check(st0 === '[false]', '出庫：新しい1日として始まった', st0);
  let svc = adb(`shell dumpsys activity services ${PKG}`);
  check(/TripService/.test(svc) && /isForeground=true/.test(svc), '前面サービス（通知付き）で動いている', (svc.match(/isForeground=\w+|foregroundServiceType=\S+/g) || []).join(' '));
  let t = readTrip();
  check(t.active === true && t.visits && t.visits.length === 1 && t.visits[0].pid === 'g' && t.visits[0].arr == null, '出庫したとき車庫の中：車庫の行（着なし）', t.visits);
  // アプリを下げて、画面を消す（使用中のみの許可で、裏でも記録が続くか）
  adb('shell input keyevent KEYCODE_HOME'); await sleep(1500); adb('shell input keyevent KEYCODE_SLEEP');

  // ---- 車庫を出る → 国母パナソニックの前を通り過ぎる ----
  await at('R1', 12);
  await at('PA', 9); await at('R2', 9);
  // ---- マシンセンターに着く（朝一）----
  const tMC = emuNow(); await at('MC', 36);
  // 止まっている間に位置が55m揺れた（円50m＋余裕30m の内側）：15秒続いても「出た」にしない
  await at('MCD', 15); await at('MC', 6);
  // ---- そのまま隣の甲府南工場へ ----
  const tKM = emuNow(); await at('KM', 45);
  await at('R3', 12);
  // ---- 登録していない場所で止まる ----
  await at('X', 45); await at('R4', 9);
  // ---- 位置が来ない（トンネル）50秒：エミュレーターは同じ位置を出し続けるので、位置情報を切って作る ----
  console.log('LOCOFF', adb('shell cmd location set-location-enabled false')); await sleep(50000);
  console.log('LOCON', adb('shell cmd location set-location-enabled true')); await sleep(2000); await at('R4', 9);
  t = readTrip(); dump();
  console.log('MID', JSON.stringify({ visits: t.visits, gaps: t.gaps, stops: t.stops }));
  let noti = adb('shell dumpsys notification --noredact');
  check(noti.includes('マシンセンター到着しました') && noti.includes('勝山、納品引き取りになります') && noti.includes('運行を記録中'), '通知：記録中・到着の連絡・予定の連絡', ['マシンセンター到着しました', '勝山、納品引き取りになります', '運行を記録中'].map(x => noti.includes(x)));
  check(!noti.includes('Panasonic1回目'), '通り過ぎたパナソニックの通知は出ていない');
  // ---- アプリが止められた（スマホが止めた・電池切れのつもり）→ 開き直す ----
  adb('shell input keyevent KEYCODE_WAKEUP');
  adb(`shell am force-stop ${PKG}`); await sleep(1000);
  await sleep(45000);
  adb(`shell am start -W -n ${PKG}/.MainActivity`); await sleep(8000);
  await at('R5', 9);
  svc = adb(`shell dumpsys activity services ${PKG}`);
  check(/TripService/.test(svc), '開き直したら記録が続く');
  adb('shell input keyevent KEYCODE_HOME'); await sleep(1000); adb('shell input keyevent KEYCODE_SLEEP');
  // ---- 富士吉田（予定「勝山」が入っている）----
  const tF = emuNow(); await at('F', 6);
  console.log('LOCOFF2', adb('shell cmd location set-location-enabled false')); await sleep(25000);
  fix(P.R6); console.log('LOCON2', adb('shell cmd location set-location-enabled true')); await sleep(1000); await at('R6', 12);
  // ---- 牧野の後に、もう一度 KFK（甲府南）→ ここで「KFK完了！帰庫します！」 ----
  await at('KM', 36); await at('R3', 12);
  // ---- 帰庫 ----
  const tG = emuNow(); await at('G', 36);
  await sleep(6000);
  t = readTrip(); dump();
  console.log('END', JSON.stringify(t).slice(0, 3000));

  // ---- 確かめる ----
  const V = t.visits || [], M = t.msgs || [];
  const names = V.map(v => v.pid);
  check(JSON.stringify(names) === JSON.stringify(['g', 'mc', 'km', 'f', 'km', 'g']), '行の並び：車庫→マシンセンター→甲府南→富士吉田→甲府南→車庫（パナソニックは通り過ぎたので行にしない）', names);
  check(V[0] && V[0].dep > 0, '車庫を出た時刻がある');
  const mc = V.find(v => v.pid === 'mc'), km = V.find(v => v.pid === 'km'), f = V.find(v => v.pid === 'f');
  check(mc && Math.abs(mc.arr - tMC) < 8000, 'マシンセンターの着：円に入った時刻（判定まで待った時間を含めない）', mc && (mc.arr - tMC) / 1000 + '秒差');
  check(mc && km && mc.dep > 0 && Math.abs(km.arr - mc.dep) < 1000, '隣の甲府南へ：マシンセンターの発＝甲府南の着', mc && km && [(mc.dep - tKM) / 1000, (km.arr - tKM) / 1000]);
  check(km && km.dep > 0 && f && f.arr > 0 && f.dep > 0, '甲府南・富士吉田に着と発がある');
  check(V.filter(v => v.pid === 'mc').length === 1, '止まっている間に位置が55m揺れても、マシンセンターは1行のまま', V.filter(v => v.pid === 'mc').length);
  check(f && f.unsure === true && Math.abs(f.arr - tF) < 8000 && f.dep < f.arr + 15000, '富士吉田：位置が来ないまま外に出た→着〜最後に中にいた時刻で1行、要確認の印', f && [(f.arr - tF) / 1000, (f.dep - f.arr) / 1000, f.unsure]);
  const g2 = V[5]; check(g2 && g2.arr > 0 && Math.abs(g2.arr - tG) < 8000, '帰庫の時刻', g2 && (g2.arr - tG) / 1000);
  const arrive = M.filter(m => m.kind === 'arrive');
  check(arrive.length === 1 && arrive[0].texts[0] === 'マシンセンター到着しました！' && arrive[0].posted, '到着の連絡は朝一のマシンセンターだけ（甲府南は出さない）', arrive.map(m => m.texts));
  const done = vid => M.find(m => m.kind === 'done' && m.vid === vid);
  check(mc && done(mc.id) && done(mc.id).posted && JSON.stringify(done(mc.id).texts) === JSON.stringify(['勝山、納品引き取りになります！🚛']), '朝（牧野の前）にマシンセンターを出た：予定の連絡（KFK完了は出さない）', mc && done(mc.id) && done(mc.id).texts);
  const km2 = V.filter(v => v.pid === 'km')[1];
  check(km2 && done(km2.id) && JSON.stringify(done(km2.id).texts) === JSON.stringify(['KFK完了！帰庫します！', '勝山引き取り分、納品完了しました！小石和倉庫の横持ちに向います！']), '牧野の後に KFK を出た：KFK完了！帰庫します！', km2 && done(km2.id) && done(km2.id).texts);
  check(f && done(f.id) && JSON.stringify(done(f.id).texts) === JSON.stringify(['富士吉田納品引き取り完了！勝山に向います！', '富士吉田納品引き取り完了しました！', '富士吉田納品完了！引き取り無しです！']), '富士吉田：予定の行き先が付いた文', f && done(f.id) && done(f.id).texts);
  const gm = M.find(m => m.kind === 'garage');
  check(gm && /^お疲れ様です！車庫着(明日|[月火水木金]曜日)、点呼6:00です！$/.test(gm.texts[0]), '帰庫の連絡（次に行く日：明日／金曜なら月曜日）', gm && gm.texts);
  check(t.active === false && t.endWhy === 'garage', '車庫に着いたら自動で止まった', [t.active, t.endWhy]);
  await sleep(3000);
  svc = adb(`shell dumpsys activity services ${PKG}`);
  check(!/TripService/.test(svc), '止まったあと、位置を見るサービスは動いていない');
  const stops = t.stops || [];
  check(stops.length === 1 && stops[0].end > stops[0].start && Math.abs(stops[0].lat - P.X[0]) < 0.001, '登録していない場所で止まった所を1つ記録', stops);
  const gaps = t.gaps || [];
  check(gaps.length === 2, '位置が来なかった時間（トンネル・アプリが止められた間）を記録', gaps.map(g => (g.to - g.from) / 1000));
  check(km && done(km.id) && done(km.id).buzzed === true, '未送信のまま止まったら1回だけ振動（甲府南の完了）', km && done(km.id));
  noti = adb('shell dumpsys notification --noredact');
  check(noti.includes('富士吉田納品引き取り完了') && noti.includes('点呼6:00') && !noti.includes('運行を記録中'), '通知：富士吉田の完了・帰庫の連絡（記録中の通知は消えた）', ['富士吉田納品引き取り完了', '点呼6:00', '運行を記録中'].map(x => noti.includes(x)));

  // ---- LINE で送る（LINE が入っていないエミュレーターでは「送る先を選ぶ」が出る）→ 送信済みになる ----
  adb('shell input keyevent KEYCODE_WAKEUP'); adb('shell wm dismiss-keyguard');
  adb(`shell am start -W -n ${PKG}/.MainActivity`); await sleep(5000);
  pid = adb(`shell pidof ${PKG}`); adb(`forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
  c = await connect(9222);
  await c.ev(`NippoAndroid.lineSend('勝山、納品引き取りになります！🚛', ${done(mc.id).id})`); await sleep(3000);
  const top = adb('shell dumpsys activity activities').split('\n').filter(l => /mResumedActivity|topResumedActivity/.test(l)).join(' | ');
  sh('adb exec-out screencap -p > out/trip-share.png');
  check(/Chooser|Resolver|intentresolver/i.test(top), '「送る先を選ぶ」画面が開いた', top.slice(0, 200));
  adb('shell input keyevent KEYCODE_BACK'); await sleep(1500);
  t = readTrip();
  const sent = (t.msgs || []).find(m => m.id === done(mc.id).id);
  check(sent && sent.sent === true && sent.sentText === '勝山、納品引き取りになります！🚛', '開いたら「送信済み」になった', sent);
  // ---- もう一度［出庫］→ 今日の続き（出庫の連絡を出さない）----
  await c.ev('window.__st=[]; window.onTripStarted=r=>window.__st.push(r); NippoAndroid.tripStart(8)'); await sleep(3000);
  const st1 = await c.ev('JSON.stringify(window.__st)');
  check(st1 === '[true]', '同じ日に出庫を押し直すと、続きから記録', st1);
  t = readTrip(); check(t.active === true && (t.visits || []).length === 6, '続きでも、それまでの行は消えない', (t.visits || []).length);
  check(t.cur && t.cur.arrived === true && t.cur.vid === t.visits[5].id, '車庫で押し直した：車庫の行の続き（出たら「発」が入る。すぐ止まらない）', t.cur);
  await c.ev('NippoAndroid.tripStop()'); await sleep(2000);
  t = readTrip(); check(t.active === false && t.endWhy === 'button', '［終わり］で止まる', [t.active, t.endWhy]);

  // ---- 前の日の記録が「記録中」のまま残っていた（止め忘れ・電池切れ）----
  const old = readTrip(); old.active = true; old.day = '2000-01-01'; delete old.endWhy; delete old.endTs;
  fs.writeFileSync('out/old.json', JSON.stringify(old));
  const uid = adb(`shell stat -c %u /data/data/${PKG}`);
  adb(`push out/old.json /data/data/${PKG}/files/trip.json`); adb(`shell chown ${uid}:${uid} /data/data/${PKG}/files/trip.json`); adb(`shell chmod 600 /data/data/${PKG}/files/trip.json`);
  adb('shell input keyevent KEYCODE_HOME'); await sleep(1500);
  adb(`shell am start -W -n ${PKG}/.MainActivity`); await sleep(4000);
  t = readTrip();
  check(t.active === false && t.endWhy === 'nextday' && !/TripService/.test(adb(`shell dumpsys activity services ${PKG}`)), '開いたとき前の日の記録だったら、続けずに止める', [t.active, t.endWhy]);
  await c.ev('window.__st=[]; window.onTripStarted=r=>window.__st.push(r); NippoAndroid.tripStart(6)'); await sleep(3000);
  t = readTrip(); const st2 = await c.ev('JSON.stringify(window.__st)');
  check(st2 === '[false]' && t.day !== '2000-01-01' && (t.visits || []).length <= 1 && t.car === 6, '翌朝の［出庫］は新しい1日（出庫の連絡も出す）', [st2, t.day, (t.visits || []).length]);
  await c.ev('NippoAndroid.tripStop()'); await sleep(2000);
  // ---- 位置の許可が無いまま［場所の登録］→ 許可を押したら、そのまま位置が取れる ----
  adb('shell input keyevent KEYCODE_WAKEUP'); adb('shell wm dismiss-keyguard');
  adb(`shell pm revoke ${PKG} android.permission.ACCESS_FINE_LOCATION`); adb(`shell pm revoke ${PKG} android.permission.ACCESS_COARSE_LOCATION`); await sleep(3000);
  adb(`shell am start -W -n ${PKG}/.MainActivity`); await sleep(4000);
  pid = adb(`shell pidof ${PKG}`); adb(`forward tcp:9222 localabstract:webview_devtools_remote_${pid}`); c = await connect(9222);
  await c.ev('NippoAndroid.fixStart()'); await sleep(3000);
  let tapped = false;
  for (let k = 0; k < 5 && !tapped; k++) {
    adb('shell uiautomator dump /sdcard/ui.xml'); const xml = adb('shell cat /sdcard/ui.xml');
    const m = xml.match(/resource-id="com\.android\.permissioncontroller:id\/permission_allow_foreground_only_button"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/) || xml.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*resource-id="com\.android\.permissioncontroller:id\/permission_allow_foreground_only_button"/);
    if (m) { adb(`shell input tap ${(+m[1] + +m[3]) >> 1} ${(+m[2] + +m[4]) >> 1}`); tapped = true; } else await sleep(1500);
  }
  await sleep(2000);
  for (let k = 0; k < 4; k++) { fix(P.X); await sleep(2000); }
  let got = ''; for (let k = 0; k < 15 && !got; k++) { got = await c.ev('NippoAndroid.fixGet()'); if (!got) { fix(P.X); await sleep(2000); } }
  check(tapped && !!got && Math.abs(JSON.parse(got).lat - P.X[0]) < 0.001, '許可が無いまま［場所の登録］→「アプリの使用中のみ」を押すと、そのまま位置が取れる', [tapped, got.slice(0, 80)]);

  dump();
  if (fails.length) { console.log('FAIL: ' + fails.join(' / ')); process.exitCode = 3; }
  else { console.log('PASS'); passed = true; process.exitCode = 0; }
  try { c.ws.close(); } catch (e) { }
  process.exit(process.exitCode);
})().catch(e => { console.log('FAIL: ' + e.message); dump(); process.exit(9); });
