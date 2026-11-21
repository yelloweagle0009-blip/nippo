package jp.nippo.unkou;

// 運行日報 Android版
// ・画面は GitHub Pages のアプリ（https://yelloweagle0009-blip.github.io/nippo/）をそのまま表示する（アプリの更新は自動で届く）
// ・文字を読む部品（/nippo/m/ と /nippo/m-app/）はアプリの中（assets/m/）から出すので、ダウンロードしない
//   後から部品が増えても、最初の1回だけダウンロードしてアプリの中に保存するので、アプリを入れ直す必要はない
// ・このアプリ自体は「画面を表示する入れ物」なので、画面や読み取りの直しは入れ直さなくても自動で届く
// ・入力した内容や覚えた場所はこのアプリの中に保存されるので、Chrome の閲覧履歴を消しても消えない
// ・写真を撮る／選ぶ、読み取りの記録の書き出し（ダウンロードフォルダへ保存）に対応
// ・待機アラーム（前のトラックが動いたら鳴らす）のカメラと、見張り中に画面を消さない仕組みに対応
// ・同じ作りで「待機アラーム」だけのアプリも作る（開くページ・名前・アイコン・アプリの番号だけが違う。build.gradle の productFlavors）

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.Manifest;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends Activity {
    static final String HOST = "yelloweagle0009-blip.github.io";
    static final String HOME = BuildConfig.HOME;   // 運行日報は /nippo/、待機アラームだけのアプリは /nippo/taiki/
    static final int REQ_FILE = 1;
    static final int REQ_CAM = 2;
    static final int REQ_CAM_PHOTO = 3;
    static final int REQ_LOC = 4;
    int pendingCar = -1;          // 位置の許可を待っているあいだの「出庫」（車番）
    boolean pendingFix = false;   // 位置の許可を待っているあいだの「場所の登録」
    volatile String oneFix = "";  // 場所の登録用に、いま1回だけ取った位置
    Intent camIntent;   // カメラの許可を待っているあいだの「写真を撮る」
    PermissionRequest camReq;   // 待機アラームのカメラの許可待ち
    Ringtone ring;               // 待機アラームの音（目覚ましと同じ「アラーム」の音量・音で鳴らす）
    final Handler loop = new Handler(Looper.getMainLooper());
    final Handler retry = new Handler(Looper.getMainLooper());   // 電波が無くて開けなかったときの開き直し
    String failed;   // 開けなかったページ（開けたら null）
    boolean errored;  // いま開いているページでエラーがあったか
    static final String OFFLINE_PAGE = "<!doctype html><html lang=ja><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
            + "<style>body{margin:0;font-family:sans-serif;background:#f5f2fa;color:#221a33;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px;box-sizing:border-box}"
            + "h1{font-size:22px;color:#3f1868}p{font-size:16px;line-height:1.6}</style></head><body><div><h1>電波がつながっていません</h1>"
            + "<p>最初の1回だけは、電波のある所で開く必要があります。<br>電波がつながると、自動で開きます（5秒ごとに試しています）。</p></div></body></html>";

    WebView web;
    ValueCallback<Uri[]> pending;
    Uri camUri;
    boolean camMode;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        WebView.setWebContentsDebuggingEnabled(true);
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setUserAgentString(s.getUserAgentString() + BuildConfig.UA);
        s.setMediaPlaybackRequiresUserGesture(false);   // 待機アラームの音を鳴らせるように

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                return part(r.getUrl());
            }

            // 電波が無くて最初の画面を開けないとき：英語のエラー画面ではなく、日本語で知らせて、5秒ごとに自動で開き直す
            // （一度開ければ、ページはスマホに保存されるので、次からは電波が無くても開ける）
            @Override
            public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r == null || !r.isForMainFrame()) return;
                String url = r.getUrl() != null ? r.getUrl().toString() : HOME;
                if (!url.startsWith("https://")) return;
                failed = url; errored = true;
                v.loadDataWithBaseURL(null, OFFLINE_PAGE, "text/html", "utf-8", null);
                retry.removeCallbacksAndMessages(null);
                retry.postDelayed(() -> { if (failed != null) web.loadUrl(failed); }, 5000);
            }

            @Override
            public void onPageStarted(WebView v, String url, android.graphics.Bitmap icon) {
                if (url != null && url.startsWith("https://")) errored = false;   // 新しく開き始めた（エラーの印を消す）
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                // 開けたときだけ開き直しを止める（開けなかったときも onPageFinished は呼ばれるので、エラーの印で見分ける）
                if (url != null && url.startsWith("https://") && !errored) { failed = null; retry.removeCallbacksAndMessages(null); }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (HOST.equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception e) { }
                return true;
            }
        });
        if (Build.VERSION.SDK_INT >= 24) {
            ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebResourceRequest r) {
                    return part(r.getUrl());
                }
            });
        }
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                return choose(cb, p);
            }

            // 待機アラーム（taiki.html）がカメラを使うとき：このアプリのページだけ、カメラだけを許可する
            @Override
            public void onPermissionRequest(PermissionRequest r) {
                runOnUiThread(() -> {
                    boolean ours = r.getOrigin() != null && HOST.equals(r.getOrigin().getHost());
                    boolean cam = false;
                    for (String x : r.getResources()) if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(x)) cam = true;
                    if (!ours || !cam) { r.deny(); return; }
                    if (Build.VERSION.SDK_INT >= 23 && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                        camReq = r;
                        requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAM);
                    } else r.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                });
            }
        });
        web.addJavascriptInterface(new Bridge(), "NippoAndroid");

        if (state != null) web.restoreState(state);
        else web.loadUrl(pageUrl(getIntent()));
    }

    // 通知から開いたとき：運行連絡の画面（renraku.html）を開く
    String pageUrl(Intent i) {
        String pg = i != null ? i.getStringExtra("page") : null;
        if (pg != null && pg.matches("[a-z]+\\.html")) return HOME + pg;
        return HOME;
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        setIntent(i);
        String pg = i.getStringExtra("page");
        if (pg != null && web != null) {
            String u = pageUrl(i), now = web.getUrl();
            if (now == null || !now.startsWith(u)) web.loadUrl(u);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (!BuildConfig.TRIP) return;
        // 記録中のはずなのに止まっていた（スマホが止めた・電池切れのあと）：開き直したら続ける
        try {
            org.json.JSONObject t = TripStore.trip(this);
            if (t.optBoolean("active") && !TripStore.today().equals(t.optString("day"))) TripService.stop(this, "nextday");   // 前の日の記録は続けない（朝の［出庫］で新しい1日）
            else if (t.optBoolean("active") && !TripService.running && hasLoc()) TripService.start(this, t.optInt("car"));
        } catch (Exception e) { }
        if (web != null) web.evaluateJavascript("window.onAppResume&&window.onAppResume()", null);
    }

    boolean hasLoc() {
        return Build.VERSION.SDK_INT < 23 || checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    // 位置（使用中のみ）と通知の許可をもらう。もう許可されていれば true
    boolean askLoc() {
        if (hasLoc()) {
            if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_LOC + 10);
            return true;
        }
        java.util.ArrayList<String> L = new java.util.ArrayList<>();
        L.add(Manifest.permission.ACCESS_FINE_LOCATION); L.add(Manifest.permission.ACCESS_COARSE_LOCATION);
        if (Build.VERSION.SDK_INT >= 33) L.add(Manifest.permission.POST_NOTIFICATIONS);
        requestPermissions(L.toArray(new String[0]), REQ_LOC);
        return false;
    }

    void js(String code) { runOnUiThread(() -> { if (web != null) web.evaluateJavascript(code, null); }); }

    void startTrip(int car) {
        boolean resume = TripService.start(this, car);
        js("window.onTripStarted&&window.onTripStarted(" + resume + ")");
    }

    // 場所の登録用：GPS で1回だけ位置を取る（記録中なら最後の位置を使う）
    @SuppressWarnings("MissingPermission")
    void fixOnce() {
        oneFix = "";
        if (!hasLoc()) return;
        android.location.LocationManager lm = (android.location.LocationManager) getSystemService(LOCATION_SERVICE);
        android.location.LocationListener l = new android.location.LocationListener() {
            public void onLocationChanged(android.location.Location x) {
                try { oneFix = new org.json.JSONObject().put("lat", x.getLatitude()).put("lon", x.getLongitude()).put("acc", x.hasAccuracy() ? x.getAccuracy() : -1).put("ts", System.currentTimeMillis()).toString(); } catch (Exception e) { }
                lm.removeUpdates(this);
            }
            public void onStatusChanged(String p, int st, Bundle b) { }
            public void onProviderEnabled(String p) { }
            public void onProviderDisabled(String p) { }
        };
        try { lm.requestLocationUpdates(android.location.LocationManager.GPS_PROVIDER, 1000, 0f, l, Looper.getMainLooper()); } catch (Exception e) { }
        loop.postDelayed(() -> { try { lm.removeUpdates(l); } catch (Exception e) { } }, 60000);
    }

    // 文字を読む部品をアプリの中から出す（無ければ null を返して普通に取りに行く）
    WebResourceResponse part(Uri u) {
        if (u == null || !HOST.equals(u.getHost())) return null;
        String path = u.getPath();
        if (path == null) return null;
        String name;
        if (path.startsWith("/nippo/m-app/")) name = path.substring("/nippo/m-app/".length());
        else if (path.startsWith("/nippo/m/")) name = path.substring("/nippo/m/".length());
        else return null;
        if (name.isEmpty() || name.contains("/") || name.contains("..")) return null;
        String mime = name.endsWith(".wasm") ? "application/wasm"
                : (name.endsWith(".js") || name.endsWith(".mjs")) ? "text/javascript"
                : name.endsWith(".txt") ? "text/plain"
                : "application/octet-stream";
        InputStream in = null;
        // 1) アプリの中に入っている部品
        try { in = getAssets().open("m/" + name); } catch (Exception e) { in = null; }
        // 2) 後から増えた部品は、最初の1回だけダウンロードしてアプリの中（files/parts）に保存し、次からはそれを使う
        //    （部品を新しくしてもアプリを入れ直さなくてよいように）
        if (in == null) {
            try {
                File dir = new File(getFilesDir(), "parts");
                dir.mkdirs();
                File f = new File(dir, name);
                if (!f.exists() || f.length() == 0) {
                    File tmp = new File(dir, name + ".tmp");
                    HttpURLConnection c = (HttpURLConnection) new URL("https://" + HOST + "/nippo/m/" + name).openConnection();
                    c.setConnectTimeout(20000);
                    c.setReadTimeout(60000);
                    if (c.getResponseCode() != 200) { c.disconnect(); return null; }
                    try (InputStream src = c.getInputStream(); FileOutputStream o = new FileOutputStream(tmp)) {
                        byte[] buf = new byte[65536];
                        int n;
                        while ((n = src.read(buf)) > 0) o.write(buf, 0, n);
                    }
                    c.disconnect();
                    if (!tmp.renameTo(f)) return null;
                }
                in = new FileInputStream(f);
            } catch (Exception e) {
                return null;
            }
        }
        Map<String, String> h = new HashMap<>();
        h.put("Access-Control-Allow-Origin", "*");
        h.put("Cache-Control", "no-store");
        return new WebResourceResponse(mime, mime.startsWith("text/") ? "utf-8" : null, 200, "OK", h, in);
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] res) {
        super.onRequestPermissionsResult(req, perms, res);
        boolean ok = res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED;
        if (req == REQ_LOC) {
            boolean loc = hasLoc();
            if (loc && pendingFix) fixOnce();
            pendingFix = false;
            if (loc && pendingCar >= 0) startTrip(pendingCar);
            else if (!loc) js("window.onTripStarted&&window.onTripStarted('denied')");
            pendingCar = -1;
            return;
        }
        if (req == REQ_CAM_PHOTO && camIntent != null) {
            Intent go = camIntent; camIntent = null;
            if (!ok) {   // 許可されなかったら、保存した写真から選ぶ
                camMode = false;
                Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
                pick.addCategory(Intent.CATEGORY_OPENABLE);
                pick.setType("image/*");
                go = Intent.createChooser(pick, "写真を選ぶ");
            }
            try { startActivityForResult(go, REQ_FILE); }
            catch (Exception e) { if (pending != null) { pending.onReceiveValue(null); pending = null; } }
            return;
        }
        if (req != REQ_CAM || camReq == null) return;
        if (res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED) camReq.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
        else camReq.deny();
        camReq = null;
    }

    // 写真を撮る（カメラ）／保存した写真から選ぶ
    boolean choose(ValueCallback<Uri[]> cb, WebChromeClient.FileChooserParams p) {
        if (pending != null) pending.onReceiveValue(null);
        pending = cb;
        camMode = p != null && p.isCaptureEnabled();
        Intent go;
        if (camMode) {
            try {
                File dir = new File(getCacheDir(), "cam");
                dir.mkdirs();
                File[] old = dir.listFiles();
                if (old != null) for (File f : old) f.delete();
                File f = new File(dir, "photo_" + System.currentTimeMillis() + ".jpg");
                camUri = FileProvider.getUriForFile(this, getPackageName() + ".files", f);
                go = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                go.putExtra(MediaStore.EXTRA_OUTPUT, camUri);
                go.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (Exception e) {
                camMode = false;
                go = null;
            }
        } else go = null;
        if (go == null) {
            Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
            pick.addCategory(Intent.CATEGORY_OPENABLE);
            pick.setType("image/*");
            go = Intent.createChooser(pick, "写真を選ぶ");
        }
        // カメラの許可（CAMERA）を宣言したアプリは、許可が無いまま撮影を頼むと失敗するので、先に許可をもらう
        if (camMode && Build.VERSION.SDK_INT >= 23 && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            camIntent = go;
            requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAM_PHOTO);
            return true;
        }
        try {
            startActivityForResult(go, REQ_FILE);
            return true;
        } catch (Exception e) {
            pending.onReceiveValue(null);
            pending = null;
            Toast.makeText(this, "写真のアプリを開けませんでした", Toast.LENGTH_LONG).show();
            return true;
        }
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req != REQ_FILE || pending == null) return;
        Uri[] out = null;
        if (res == RESULT_OK) {
            if (camMode) out = new Uri[]{camUri};
            else if (data != null && data.getData() != null) out = new Uri[]{data.getData()};
        }
        pending.onReceiveValue(out);
        pending = null;
    }

    // ページから呼ぶ：読み取りの記録をスマホの「ダウンロード」フォルダに保存する
    class Bridge {
        @JavascriptInterface
        public void save(String name, String text) {
            String msg;
            try {
                byte[] b = text.getBytes(StandardCharsets.UTF_8);
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Downloads.DISPLAY_NAME, name);
                    v.put(MediaStore.Downloads.MIME_TYPE, "application/json");
                    v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/運行日報");
                    Uri u = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    try (OutputStream o = getContentResolver().openOutputStream(u)) { o.write(b); }
                    msg = "「ダウンロード／運行日報」に保存しました：" + name;
                } else {
                    File dir = getExternalFilesDir(null);
                    File f = new File(dir, name);
                    try (FileOutputStream o = new FileOutputStream(f)) { o.write(b); }
                    msg = "保存しました：" + f.getAbsolutePath();
                }
            } catch (Exception e) {
                msg = "保存できませんでした：" + e.getMessage();
            }
            final String m = msg;
            runOnUiThread(() -> Toast.makeText(MainActivity.this, m, Toast.LENGTH_LONG).show());
        }

        // 待機アラームの音を、動画の音量ではなく目覚ましと同じ「アラーム」の音量で鳴らす（止めるまで鳴り続ける）
        @JavascriptInterface
        public void alarm(boolean on) {
            runOnUiThread(() -> { if (on) startAlarm(); else stopAlarm(); });
        }

        @JavascriptInterface
        public boolean alarmPlaying() {
            return ring != null && ring.isPlaying();
        }

        // アラームの音量（今の値と最大）。0 なら画面で知らせる
        @JavascriptInterface
        public String alarmVolume() {
            AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
            if (am == null) return "";
            return am.getStreamVolume(AudioManager.STREAM_ALARM) + "/" + am.getStreamMaxVolume(AudioManager.STREAM_ALARM);
        }

        // 待機アラームで見張っているあいだ、画面を消さない
        @JavascriptInterface
        public void keepOn(boolean on) {
            runOnUiThread(() -> {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }

        // 仲間に送る：LINE やメールなどを選んで、文を送る
        @JavascriptInterface
        public void share(String text) {
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType("text/plain");
                i.putExtra(Intent.EXTRA_TEXT, text);
                try { startActivity(Intent.createChooser(i, "送る先を選ぶ")); }
                catch (Exception e) { Toast.makeText(MainActivity.this, "送るアプリが見つかりませんでした", Toast.LENGTH_LONG).show(); }
            });
        }

        // ---- 運行連絡（運行日報のアプリだけ）----
        @JavascriptInterface
        public boolean tripAvailable() { return BuildConfig.TRIP; }

        // 今日の記録・登録した場所・設定をまとめて返す
        @JavascriptInterface
        public String tripState() {
            if (!BuildConfig.TRIP) return "";
            try {
                org.json.JSONObject o = new org.json.JSONObject();
                o.put("trip", TripStore.trip(MainActivity.this)); o.put("conf", TripStore.conf(MainActivity.this));
                o.put("running", TripService.running); o.put("loc", hasLoc()); o.put("now", System.currentTimeMillis());
                return o.toString();
            } catch (Exception e) { return ""; }
        }

        // 出庫：許可が無ければ聞いてから始める。結果は onTripStarted(true＝続き / false＝新しい1日 / 'denied') で返す
        @JavascriptInterface
        public void tripStart(int car) {
            if (!BuildConfig.TRIP) return;
            runOnUiThread(() -> { if (askLoc()) startTrip(car); else pendingCar = car; });
        }

        @JavascriptInterface
        public void tripStop() { if (BuildConfig.TRIP) TripService.stop(MainActivity.this, "button"); }

        // 設定（場所・点呼の時刻・よく使う文・予定・判定の数値）を丸ごと保存する
        @JavascriptInterface
        public boolean confSave(String json) {
            if (!BuildConfig.TRIP) return false;
            try { TripStore.saveConf(MainActivity.this, new org.json.JSONObject(json)); return true; } catch (Exception e) { return false; }
        }

        // 今日の記録の1件（visits / msgs / stops / gaps の id）を直す。json の中身を上書きする（null は消す）
        @JavascriptInterface
        public boolean tripPatch(String kind, long id, String json) {
            if (!BuildConfig.TRIP) return false;
            synchronized (TripStore.LOCK) {
                try {
                    org.json.JSONObject t = TripStore.trip(MainActivity.this), p = new org.json.JSONObject(json);
                    org.json.JSONArray a = t.optJSONArray(kind);
                    if (a == null) return false;
                    for (int i = 0; i < a.length(); i++) {
                        org.json.JSONObject x = a.getJSONObject(i);
                        if (x.optLong("id") != id) continue;
                        org.json.JSONArray ks = p.names();
                        if (ks != null) for (int k = 0; k < ks.length(); k++) { String key = ks.getString(k); if (p.isNull(key)) x.remove(key); else x.put(key, p.get(key)); }
                        if (p.optBoolean("del")) a.remove(i);
                        TripStore.saveTrip(MainActivity.this, t);
                        if ("msgs".equals(kind) && (p.has("sent") || p.has("skip")) && (x.optBoolean("sent") || x.optBoolean("skip"))) TripService.cancelMsg(MainActivity.this, id);
                        else if ("msgs".equals(kind) && p.has("texts") && x.optBoolean("posted") && !x.optBoolean("sent") && !x.optBoolean("skip"))
                            TripService.postMsg(MainActivity.this, id, "連絡（文を直しました・未送信）", x.getJSONArray("texts").optString(0));
                        return true;
                    }
                } catch (Exception e) { }
                return false;
            }
        }

        // 今日の記録に1件足す（手で入れた行・手打ちの連絡など）。付けた id を返す
        @JavascriptInterface
        public long tripAdd(String kind, String json) {
            if (!BuildConfig.TRIP) return -1;
            synchronized (TripStore.LOCK) {
                try {
                    org.json.JSONObject t = TripStore.trip(MainActivity.this), x = new org.json.JSONObject(json);
                    if (!t.has("startTs")) return -1;
                    long id = t.optLong("seq", 1); t.put("seq", id + 1); x.put("id", id);
                    if (!t.has(kind)) t.put(kind, new org.json.JSONArray());
                    t.getJSONArray(kind).put(x);
                    TripStore.saveTrip(MainActivity.this, t);
                    return id;
                } catch (Exception e) { return -1; }
            }
        }

        // LINE を開く（文入りの「送る先を選ぶ」）。mid は今日の連絡の id（無ければ -1）。送信は本人が LINE で押す
        @JavascriptInterface
        public void lineSend(String text, long mid) {
            runOnUiThread(() -> SendActivity.openLine(MainActivity.this, text, mid));
        }

        @JavascriptInterface
        public void msgMark(long mid, boolean sent) { if (BuildConfig.TRIP) SendActivity.mark(MainActivity.this, mid, sent, null); }

        // 場所の登録用に位置を1回取る。fixGet() で受け取る（取れるまで ""）
        @JavascriptInterface
        public void fixStart() {
            if (!BuildConfig.TRIP) return;
            runOnUiThread(() -> { if (askLoc()) fixOnce(); else pendingFix = true; });
        }

        @JavascriptInterface
        public String fixGet() {
            if (!oneFix.isEmpty()) return oneFix;
            org.json.JSONObject lf = TripStore.trip(MainActivity.this).optJSONObject("lastFix");
            if (TripService.running && lf != null && System.currentTimeMillis() - lf.optLong("ts") < 30000) return lf.toString();
            return "";
        }

        @JavascriptInterface
        public String version() {
            try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return ""; }
        }
    }

    // 目覚ましの音（端末で設定しているアラーム音）を、アラームの音量で、止めるまで繰り返し鳴らす。振動も止めるまで続ける
    void startAlarm() {
        stopAlarm();
        Uri u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        if (u == null) u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        if (u == null) u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        AudioAttributes aa = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
        if (u != null) {
            ring = RingtoneManager.getRingtone(this, u);
            if (ring != null) {
                ring.setAudioAttributes(aa);
                if (Build.VERSION.SDK_INT >= 28) ring.setLooping(true);
                ring.play();
                // 古い Android（9より前）は繰り返しの設定が無いので、止まったらまた鳴らす
                if (Build.VERSION.SDK_INT < 28) loop.postDelayed(new Runnable() { public void run() {
                    if (ring == null) return;
                    if (!ring.isPlaying()) ring.play();
                    loop.postDelayed(this, 1000);
                } }, 1000);
            }
        }
        Vibrator vb = (Vibrator) getSystemService(VIBRATOR_SERVICE);
        if (vb != null) {
            long[] p = {0, 800, 400};
            if (Build.VERSION.SDK_INT >= 26) vb.vibrate(VibrationEffect.createWaveform(p, 0), aa);
            else vb.vibrate(p, 0);
        }
    }

    void stopAlarm() {
        loop.removeCallbacksAndMessages(null);
        if (ring != null) { try { ring.stop(); } catch (Exception e) { } ring = null; }
        Vibrator vb = (Vibrator) getSystemService(VIBRATOR_SERVICE);
        if (vb != null) vb.cancel();
    }

    @Override
    protected void onDestroy() {
        retry.removeCallbacksAndMessages(null);
        stopAlarm();
        super.onDestroy();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}
