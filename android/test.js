// アプリの中の画面につないで（Chrome の開発用のつなぎ方：CDP）、本物の部品で読み、結果を書き出す
const WebSocket = require('ws');
// 途中で黙って終わっても「合格」にならないようにする（PASS を書いたときだけ合格）
let passed = false; process.exitCode = 1;
const keep = setInterval(() => {}, 1000);
setTimeout(() => { console.log('FAIL: 時間切れ（15分）'); process.exit(8); }, 15 * 60 * 1000).unref();
process.on('exit', () => { if (!passed) console.log('FAIL: 途中で終わった'); });
const step = m => console.log('STEP', m);
(async () => {
  step('つなぐ先を探す');
  const list = await (await fetch('http://127.0.0.1:9222/json')).json();
  const pg = list.find(x => x.type === 'page' && x.url.includes('/nippo/')) || list.find(x => x.type === 'page');
  if (!pg) { console.log('FAIL: 画面が見つからない', JSON.stringify(list)); process.exit(4); }
  step('画面 ' + pg.url);
  const ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((ok, ng) => { ws.on('open', ok); ws.on('error', ng); });
  step('つないだ');
  let id = 0; const wait = {};
  ws.on('message', m => { const d = JSON.parse(m); if (d.id && wait[d.id]) { wait[d.id](d); delete wait[d.id]; } });
  const ev = (fn, arg) => new Promise((ok, ng) => { const i = ++id; wait[i] = d => { if (d.error) return ng(new Error(JSON.stringify(d.error))); const r = d.result; if (r.exceptionDetails) return ng(new Error(JSON.stringify(r.exceptionDetails).slice(0, 800))); ok(r.result.value); };
    ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: '(' + fn.toString() + ')(' + JSON.stringify(arg === undefined ? null : arg) + ')', awaitPromise: true, returnByValue: true } })); });
  const diag = () => ev(() => JSON.stringify({ ready: document.readyState, title: document.title, url: location.href, scripts: [...document.scripts].map(x => x.src.split('/').pop()), ocr: !!window.NippoOCR, photo: !!window.NippoPhoto, err: window.__errs || [], text: (document.body && document.body.innerText || '').slice(0, 200) })).catch(e => 'diag-error ' + e);
  const p = { url: () => pg.url, evaluate: ev, waitForFunction: async (fn) => {
    for (let round = 0; round < 2; round++) {
      for (let k = 0; k < 90; k++) { try { if (await ev(fn)) return; } catch (e) { } await new Promise(r => setTimeout(r, 1000)); }
      console.log('WAIT', round, await diag());
      if (round === 0) { await new Promise(ok => { const i = ++id; wait[i] = ok; ws.send(JSON.stringify({ id: i, method: 'Page.reload', params: {} })); }); await new Promise(r => setTimeout(r, 5000)); }
    }
    throw new Error('timeout'); } };
  await ev(() => { window.__errs = window.__errs || []; window.addEventListener('error', e => window.__errs.push(String(e.message) + ' ' + (e.filename || '').split('/').pop())); return 1; }).catch(() => {});
  console.log('URL', p.url());
  if (process.argv[2] === 'offline') {
    // 電波が無い状態：画面を開き直して、画面と部品（後から増えた分も）がスマホの中から出るか
    await new Promise((ok, ng) => { const i = ++id; wait[i] = ok; ws.send(JSON.stringify({ id: i, method: 'Page.reload', params: { ignoreCache: false } })); });
    await new Promise(r => setTimeout(r, 8000));
    await p.waitForFunction(() => !!(window.NippoOCR && window.NippoPhoto && document.getElementById('rows')));
    const off = await p.evaluate(async () => { let net = true; try { await fetch('https://www.google.com/generate_204?' + Date.now(), { mode: 'no-cors', cache: 'no-store' }); } catch (e) { net = false; } const t = await (await fetch('/nippo/m-app/test-part.txt')).text(); const w = await fetch('/nippo/m-app/PP-OCRv5_mobile_rec_infer.onnx'); return { net, online: navigator.onLine, part: t.trim(), v5: (await w.arrayBuffer()).byteLength, title: document.title }; });
    console.log('OFFLINE', JSON.stringify(off));
    if (off.net) { console.log('FAIL: 電波を切れていない（試験が成り立たない）'); process.exit(7); }
    if (off.part !== 'nippo-ok' || off.v5 !== 16559278) { console.log('FAIL: 電波が無いと使えない'); process.exit(5); }
    console.log('PASS'); passed = true; process.exitCode = 0; clearInterval(keep); ws.close(); return;
  }
  await p.waitForFunction(() => !!(window.NippoOCR && window.NippoPhoto));
  const info = await p.evaluate(async () => {
    const r = await fetch('/nippo/m-app/PP-OCRv6_tiny_rec.onnx'); const n = (await r.arrayBuffer()).byteLength;
    return { ua: navigator.userAgent.slice(-40), inApp: NippoOCR.IN_APP, tinyStatus: r.status, tinyBytes: n, android: !!window.NippoAndroid, ver: window.NippoAndroid && NippoAndroid.version() };
  });
  console.log('INFO', JSON.stringify(info));
  if (!info.inApp || info.tinyStatus !== 200 || info.tinyBytes !== 4462639) { console.log('FAIL: 部品がアプリの中から出ていない'); process.exit(2); }
  // 後から増えた部品（アプリに入っていない test-part.txt）を、ダウンロードしてアプリの中に保存できるか
  const extra = await p.evaluate(async () => (await (await fetch('/nippo/m-app/test-part.txt')).text()).trim());
  console.log('EXTRA', extra);
  if (extra !== 'nippo-ok') { console.log('FAIL: 後から増えた部品を取れない'); process.exit(6); }
  // 日報の写真は公開の場所に置かないので、数字と店名を画面の中で描いて、本物の部品で読む
  const res = await p.evaluate(async () => {
    const cv = (t, w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.fillStyle = '#111'; x.font = Math.round(h * 0.7) + 'px sans-serif'; x.textBaseline = 'middle'; x.fillText(t, 8, h / 2); return c; };
    const cell = t => ({ A: cv(t, 180, 60), C: cv(t, 150, 50) });
    const rows = [
      { hasArr: false, hasDep: true, ocr: { dep: cell('6:05'), meter: cell(''), place: { A: cv('車庫', 300, 60) } } },
      { hasArr: true, hasDep: true, ocr: { arr: cell('8:40'), dep: cell('9:00'), meter: cell('753'), place: { A: cv('KFKマシンセンター', 420, 60) } } },
      { hasArr: true, hasDep: false, ocr: { arr: cell('17:30'), meter: cell(''), place: { A: cv('車庫', 300, 60) } } } ];
    const t0 = performance.now();
    const rr = await NippoOCR.readRows(rows, {}, () => {});
    const pl = await NippoOCR.readPlaces(rows, ['車庫', 'KFKマシンセンター', '国母パナソニック', 'KFK甲府南工場'], () => {});
    await NippoOCR.closeModels();
    return { res: rr.res, places: pl.map(x => x && x.name), sec: ((performance.now() - t0) / 1000).toFixed(1), reads: Object.values(rr.reads).reduce((a, l) => a + l.length, 0) };
  });
  console.log('READ', JSON.stringify(res));
  const g = (i, f) => res.res[i] && res.res[i][f] && res.res[i][f].v;
  const ok = g(0, 'dep') === '6:05' && g(1, 'arr') === '8:40' && g(1, 'dep') === '9:00' && g(1, 'meter') === '753' && g(2, 'arr') === '17:30' && res.places.join(',') === '車庫,KFKマシンセンター,車庫';
  if (!ok) { console.log('FAIL: 読んだ値が違う'); process.exit(3); }
  // 待機アラーム：アプリの中でカメラが使えるか（許可の受け渡し）と、見張りが動くか
  await new Promise(ok => { const i = ++id; wait[i] = ok; ws.send(JSON.stringify({ id: i, method: 'Page.navigate', params: { url: 'https://yelloweagle0009-blip.github.io/nippo/taiki.html' } })); });
  await new Promise(r => setTimeout(r, 6000));
  await p.waitForFunction(() => !!(window.NippoTaiki && document.getElementById('camBtn')));
  const tk = await p.evaluate(async () => {
    document.getElementById('camBtn').click();
    for (let k = 0; k < 30 && !document.getElementById('v').videoWidth; k++) await new Promise(r => setTimeout(r, 500));
    const v = document.getElementById('v'), st1 = document.getElementById('st').textContent;
    if (!v.videoWidth) return { cam: false, st: st1 };
    document.getElementById('goBtn').click();
    await new Promise(r => setTimeout(r, 6500));
    return { cam: true, w: v.videoWidth, h: v.videoHeight, st: document.getElementById('st').textContent, keepOn: !!(window.NippoAndroid && NippoAndroid.keepOn) };
  });
  console.log('TAIKI', JSON.stringify(tk));
  if (!tk.cam || !/見張り|動き/.test(tk.st)) { console.log('FAIL: 待機アラームでカメラが使えない、または見張りが始まらない'); process.exit(9); }
  console.log('PASS'); passed = true; process.exitCode = 0; clearInterval(keep);
  ws.close();
})().catch(e => { console.log('FAIL', e && e.stack || e); clearInterval(keep); process.exit(1); });
