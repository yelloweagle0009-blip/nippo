// LINE連絡キーボードの試験：エミュレーターで、キーボードに替えて、ボタンを押すと入力欄に文が入るか・取り消せるか・
// 全部の文が出るか・普通のキーボードに戻れるか・インターネットの許可を持っていないか を確かめる
const { execSync } = require('child_process');
const fs = require('fs');
const sh = c => { try { return execSync(c, { encoding: 'utf8', timeout: 60000 }).trim(); } catch (e) { return 'ERR ' + (e.stdout || '') + (e.stderr || ''); } };
const adb = c => sh('adb ' + c);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PKG = 'jp.nippo.renraku', IME = 'jp.nippo.renraku/jp.nippo.unkou.RenrakuIME';
const fails = [];
const check = (ok, what, detail) => { console.log((ok ? 'OK   ' : 'NG   ') + what + (detail !== undefined ? '  ' + JSON.stringify(detail) : '')); if (!ok) fails.push(what); };
const dec = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#10;/g, '\n');
function nodes() {
  adb('shell uiautomator dump /sdcard/ui.xml'); const x = adb('shell cat /sdcard/ui.xml');
  fs.writeFileSync('out/renraku-ui.xml', x);
  const L = []; const re = /<node [^>]*?text="([^"]*)"[^>]*?class="([^"]*)"[^>]*?content-desc="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g; let m;
  while ((m = re.exec(x))) L.push({ text: dec(m[1]), cls: m[2], desc: dec(m[3]), x: (+m[4] + +m[6]) >> 1, y: (+m[5] + +m[7]) >> 1 });
  // キーボードのボタンは、キーボードが書いた位置のファイルからも読む（画面の読み取りでキーボードの窓が取れない機種のため）
  if (!L.some(n => n.cls === 'KB')) {
    const t = adb(`shell cat /data/data/${PKG}/files/ime-layout.txt`);
    if (!t.startsWith('ERR')) for (const line of t.split('\n')) { const a = line.split('\t'); if (a.length >= 3 && !L.some(n => n.text === a[2] && n.cls.includes('Button'))) L.push({ text: a.slice(2).join('\t'), cls: 'KB Button', desc: '', x: +a[0], y: +a[1] }); }
  }
  return L;
}
const tap = n => adb(`shell input tap ${n.x} ${n.y}`);
const field = L => L.find(n => n.desc === '試す欄' || (n.cls.includes('EditText') && n.text !== '' && false)) || L.find(n => n.cls.includes('EditText'));
const fieldText = () => { const f = nodes().find(n => n.desc === '試す欄'); return f ? f.text : null; };

(async () => {
  console.log('ROOT', adb('root')); await sleep(4000); adb('wait-for-device');
  const dump = adb(`shell dumpsys package ${PKG}`);
  const perms = (dump.match(/android\.permission\.[A-Z_]+/g) || []).filter((v, i, a) => a.indexOf(v) === i);
  check(!perms.includes('android.permission.INTERNET'), 'インターネットの許可を持っていない', perms);
  check(!/jp\.nippo\.unkou\.MainActivity/.test(dump), '運行日報の画面は入っていない');
  const list = adb('shell ime list -a -s');
  check(list.includes(IME), 'キーボードとして登録されている', list.split('\n'));
  adb(`shell ime enable ${IME}`); adb(`shell ime set ${IME}`);
  check(adb('shell settings get secure default_input_method') === IME, 'LINE連絡キーボードに切り替えた');
  adb(`shell am start -W -n ${PKG}/jp.nippo.unkou.SetupActivity`); await sleep(3000);
  let L = nodes();
  check(L.some(n => /有効になっています/.test(n.text)), '設定画面：有効になっていると出る', L.filter(n => /有効/.test(n.text)).map(n => n.text));
  check(L.some(n => /16日分・131件/.test(n.text)), '設定画面：LINE の履歴16日分・131件を覚えている', L.filter(n => /日分/.test(n.text)).map(n => n.text));
  const f = L.find(n => n.desc === '試す欄'); check(!!f, '試す欄がある'); tap(f); await sleep(2500);
  adb('exec-out screencap -p > out/renraku-1.png'); sh('adb exec-out screencap -p > out/renraku-1.png');
  L = nodes();
  const dep = L.find(n => n.text.startsWith('おはようございます!8番出庫します!'));
  check(!!dep, 'その日まだ何も入れていない：選択肢に「おはようございます!8番出庫します!🚛」', L.filter(n => n.cls.includes('Button')).map(n => n.text));
  if (!dep) throw new Error('キーボードのボタンが見つからない');
  tap(dep); await sleep(1500);
  check(fieldText() === 'おはようございます!8番出庫します!🚛', '押したら入力欄に文が入った', fieldText());
  L = nodes(); const btns = L.filter(n => n.cls.includes('Button')).map(n => n.text);
  check(!btns.some(t => t.startsWith('おはようございます')) && btns.some(t => /到着しました|甲府南工場着|洗車/.test(t)), '次の選択肢：出庫の次（マシンセンター・甲府南・洗車）', btns.slice(0, 6));
  const und = L.find(n => n.text === '取り消し'); check(!!und, '取り消しのボタンが出る'); tap(und); await sleep(1500);
  check(fieldText() === '' || fieldText() === 'ここを押すとキーボードが出ます', '取り消すと入力欄の文が消えた', fieldText());
  L = nodes(); check(L.some(n => n.text.startsWith('おはようございます!8番')), '取り消すと選択肢も出庫に戻る');
  // 車番を変える
  const car = L.find(n => n.text === '8番'); tap(car); await sleep(1200); L = nodes();
  check(L.some(n => n.text.startsWith('おはようございます!6番出庫します!')), '車番のボタンで 8番→6番 に変わり、文も変わる');
  tap(L.find(n => n.text === '6番')); await sleep(800); L = nodes(); tap(L.find(n => n.text === '2番')); await sleep(800); L = nodes();
  check(L.some(n => n.text === '8番'), '車番は 8→6→2→8 と回る');
  // 出庫→マシンセンター→Panasonic を続けて入れる
  tap(L.find(n => n.text.startsWith('おはようございます!8番'))); await sleep(1200);
  L = nodes(); const all = L.find(n => n.text === '全部の文'); tap(all); await sleep(1500); L = nodes();
  const allTexts = L.map(n => n.text);
  check(allTexts.some(t => t === 'マシンセンター到着しました！') && allTexts.some(t => t === '選択肢に戻る'), '全部の文の一覧が出る', allTexts.filter(t => t).slice(0, 12));
  tap(L.find(n => n.text === 'マシンセンター到着しました！')); await sleep(1200);
  L = nodes(); const top = L.filter(n => n.cls.includes('Button')).map(n => n.text);
  check(/^Panasonic1回目納品完了しました！$/.test(top.find(t => t.startsWith('Panasonic')) || '') , 'マシンセンターの次は Panasonic1回目', top.slice(0, 6));
  tap(L.find(n => n.text.startsWith('Panasonic1回目'))); await sleep(1200);
  L = nodes(); const top2 = L.filter(n => n.cls.includes('Button')).map(n => n.text);
  check(top2.some(t => t === 'Panasonic2回目納品完了しました！'), 'Panasonic を1回入れたら、次は「Panasonic2回目」', top2.slice(0, 6));
  check(fieldText() === 'おはようございます!8番出庫します!🚛マシンセンター到着しました！Panasonic1回目納品完了しました！', '入力欄に3つの文が順に入った', fieldText());
  sh('adb exec-out screencap -p > out/renraku-2.png');
  // 普通のキーボードに戻る
  L = nodes(); tap(L.find(n => n.text === 'あ 普通のキーボード')); await sleep(1500);
  const now = adb('shell settings get secure default_input_method');
  check(now !== IME && !now.startsWith('ERR'), '［あ 普通のキーボード］で前のキーボードに戻る', now);
  console.log(fails.length ? 'FAIL: ' + fails.join(' / ') : 'PASS');
  process.exit(fails.length ? 3 : 0);
})().catch(e => { console.log('FAIL: ' + e.message); process.exit(9); });
