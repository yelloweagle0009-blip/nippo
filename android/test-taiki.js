// 待機アラームだけのアプリの試験：アプリの中の画面につないで（Chrome の開発用のつなぎ方：CDP）、
// 開くページ・カメラ・見張り・目覚ましの音・仲間に送る仕組み・電波が無いときに開けるかを確かめる
const WebSocket = require('ws');
let passed = false; process.exitCode = 1;
const keep = setInterval(() => {}, 1000);
setTimeout(() => { console.log('FAIL: 時間切れ（8分）'); process.exit(8); }, 8 * 60 * 1000).unref();
process.on('exit', () => { if (!passed) console.log('FAIL: 途中で終わった'); });
(async () => {
  // 電波がつながっていないと、アプリは日本語の「電波がつながっていません」を出して5秒ごとに開き直すので、
  // 待機アラームの画面が出るまで最大90秒待つ（recover の試験では、これが「自動で開き直せたか」の確かめになる）
  let list = [], pg = null; const t0 = Date.now();
  for (let k = 0; k < 90 && !pg; k++) {
    try { list = await (await fetch('http://127.0.0.1:9223/json')).json(); } catch (e) { list = []; }
    pg = list.find(x => x.type === 'page' && x.url.includes('/nippo/taiki/'));
    if (!pg) await new Promise(r => setTimeout(r, 1000));
  }
  if (!pg) { console.log('FAIL: 待機アラームの画面が開いていない', JSON.stringify(list.map(x => x.url))); process.exit(4); }
  console.log('OPENED', ((Date.now() - t0) / 1000).toFixed(0) + '秒');
  console.log('URL', pg.url);
  const ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((ok, ng) => { ws.on('open', ok); ws.on('error', ng); });
  let id = 0; const wait = {};
  ws.on('message', m => { const d = JSON.parse(m); if (d.id && wait[d.id]) { wait[d.id](d); delete wait[d.id]; } });
  const send = (method, params) => new Promise(ok => { const i = ++id; wait[i] = ok; ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const ev = async (fn, arg) => { const d = await send('Runtime.evaluate', { expression: '(' + fn.toString() + ')(' + JSON.stringify(arg === undefined ? null : arg) + ')', awaitPromise: true, returnByValue: true });
    if (d.error) throw new Error(JSON.stringify(d.error)); if (d.result.exceptionDetails) throw new Error(JSON.stringify(d.result.exceptionDetails)); return d.result.result.value; };
  // 画面の様子（うまくいかないときの手がかり）
  const diag = () => ev(() => JSON.stringify({ ready: document.readyState, title: document.title, url: location.href, scripts: [...document.scripts].map(x => x.src.split('/').pop()), taiki: !!window.NippoTaiki, cam: !!document.getElementById('camBtn'), body: (document.body && document.body.innerText || '').slice(0, 200), errs: window.__errs || [] })).catch(e => 'diag失敗 ' + e.message);
  const until = async (fn, noReload) => {
    for (let round = 0; round < (noReload ? 1 : 2); round++) {
      for (let k = 0; k < 60; k++) { try { if (await ev(fn)) return; } catch (e) { if (k % 15 === 0) console.log('EVERR', e.message.slice(0, 200)); } await new Promise(r => setTimeout(r, 1000)); }
      console.log('WAIT', round, await diag());
      if (round === 0) { await send('Page.reload', {}); await new Promise(r => setTimeout(r, 6000)); }
    }
    throw new Error('timeout'); };
  await ev(() => { window.__errs = window.__errs || []; window.addEventListener('error', e => window.__errs.push(String(e.message) + ' ' + (e.filename || '').split('/').pop())); return 1; }).catch(e => console.log('EVERR0', e.message));
  console.log('DIAG0', await diag());
  if (process.argv[2] === 'recover') {   // 電波が無い所で初めて開いたあと、電波が戻ったら自動で開けたか
    await until(() => !!(window.NippoTaiki && document.getElementById('camBtn')), true);   // 開き直しは試験側ではしない（アプリが自分で開き直せたかを見る）
    console.log('RECOVER', JSON.stringify({ title: await ev(() => document.title) }));
    console.log('PASS'); passed = true; process.exitCode = 0; clearInterval(keep); ws.close(); return;
  }
  if (process.argv[2] === 'offline') {
    await send('Page.reload', { ignoreCache: false }); await new Promise(r => setTimeout(r, 8000));
    await until(() => !!(window.NippoTaiki && document.getElementById('camBtn')));
    const off = await ev(async () => { let net = true; try { await fetch('https://www.google.com/generate_204?' + Date.now(), { mode: 'no-cors', cache: 'no-store' }); } catch (e) { net = false; } return { net, title: document.title, sw: !!navigator.serviceWorker.controller }; });
    console.log('OFFLINE', JSON.stringify(off));
    if (off.net) { console.log('FAIL: 電波を切れていない（試験が成り立たない）'); process.exit(7); }
    if (off.title !== '待機アラーム') { console.log('FAIL: 電波が無いと開けない'); process.exit(5); }
    console.log('PASS'); passed = true; process.exitCode = 0; clearInterval(keep); ws.close(); return;
  }
  await until(() => !!(window.NippoTaiki && document.getElementById('camBtn')));
  const info = await ev(() => ({ ua: /TaikiApp\//.test(navigator.userAgent), nippoUA: /NippoApp\//.test(navigator.userAgent), title: document.title, back: !document.getElementById('back').hidden, share: !!(window.NippoAndroid && NippoAndroid.share), ver: window.NippoAndroid && NippoAndroid.version(), sn: document.getElementById('sn').textContent.slice(0, 30) }));
  console.log('INFO', JSON.stringify(info));
  if (!info.ua || info.nippoUA || info.title !== '待機アラーム' || info.back || !info.share || !/目覚まし/.test(info.sn)) { console.log('FAIL: 待機アラームだけのアプリとして開いていない'); process.exit(2); }
  const tk = await ev(async () => {
    document.getElementById('camBtn').click();
    for (let k = 0; k < 30 && !document.getElementById('v').videoWidth; k++) await new Promise(r => setTimeout(r, 500));
    const v = document.getElementById('v');
    if (!v.videoWidth) return { cam: false, st: document.getElementById('st').textContent };
    document.getElementById('goBtn').click();
    await new Promise(r => setTimeout(r, 6500));
    NippoAndroid.alarm(true); await new Promise(r => setTimeout(r, 1500)); const playing = NippoAndroid.alarmPlaying();
    NippoAndroid.alarm(false); await new Promise(r => setTimeout(r, 800)); const stopped = !NippoAndroid.alarmPlaying();
    const b = document.getElementById('goBtn'); if (/止める/.test(b.textContent)) b.click();
    return { cam: true, w: v.videoWidth, h: v.videoHeight, st: document.getElementById('st').textContent, alarmPlaying: playing, alarmStopped: stopped };
  });
  console.log('TAIKI', JSON.stringify(tk));
  if (!tk.cam) { console.log('FAIL: カメラが使えない'); process.exit(9); }
  if (!tk.alarmPlaying || !tk.alarmStopped) { console.log('FAIL: アラームの音が鳴らない、または止まらない'); process.exit(10); }
  // 電波が無い試験のために、保存の仕組み（サービスワーカー）が働いているか待つ
  await until(() => !!navigator.serviceWorker.controller);
  console.log('PASS'); passed = true; process.exitCode = 0; clearInterval(keep); ws.close();
})().catch(e => { console.log('FAIL', e && e.stack || e); clearInterval(keep); process.exit(1); });
