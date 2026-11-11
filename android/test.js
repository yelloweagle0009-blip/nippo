// アプリの中の画面につないで、本物の部品で写真を読み、結果を書き出す（青・黄の数、始業・終業、店名、かかった時間）
const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = b.contexts()[0]; const p = ctx.pages().find(x => x.url().includes('/nippo/')) || ctx.pages()[0];
  console.log('URL', p.url());
  await p.waitForFunction(() => window.NippoOCR && window.NippoPhoto, null, { timeout: 60000 });
  const info = await p.evaluate(async () => {
    const r = await fetch('/nippo/m-app/PP-OCRv6_tiny_rec.onnx'); const n = (await r.arrayBuffer()).byteLength;
    return { ua: navigator.userAgent.slice(-40), inApp: NippoOCR.IN_APP, tinyStatus: r.status, tinyBytes: n, android: !!window.NippoAndroid, ver: window.NippoAndroid && NippoAndroid.version() };
  });
  console.log('INFO', JSON.stringify(info));
  if (!info.inApp || info.tinyStatus !== 200 || info.tinyBytes !== 4462639) { console.log('FAIL: 部品がアプリの中から出ていない'); process.exit(2); }
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
  console.log('PASS');
  await b.close();
})().catch(e => { console.log('FAIL', e && e.stack || e); process.exit(1); });
