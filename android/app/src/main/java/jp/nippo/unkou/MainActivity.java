package jp.nippo.unkou;

// 運行日報 Android版
// ・画面は GitHub Pages のアプリ（https://yelloweagle0009-blip.github.io/nippo/）をそのまま表示する（アプリの更新は自動で届く）
// ・文字を読む部品（/nippo/m/ と /nippo/m-app/）はアプリの中（assets/m/）から出すので、ダウンロードしない
//   後から部品が増えても、最初の1回だけダウンロードしてアプリの中に保存するので、アプリを入れ直す必要はない
// ・このアプリ自体は「画面を表示する入れ物」なので、画面や読み取りの直しは入れ直さなくても自動で届く
// ・入力した内容や覚えた場所はこのアプリの中に保存されるので、Chrome の閲覧履歴を消しても消えない
// ・写真を撮る／選ぶ、読み取りの記録の書き出し（ダウンロードフォルダへ保存）に対応

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
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
    static final String HOME = "https://" + HOST + "/nippo/";
    static final int REQ_FILE = 1;

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
        s.setUserAgentString(s.getUserAgentString() + " NippoApp/1");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                return part(r.getUrl());
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
        });
        web.addJavascriptInterface(new Bridge(), "NippoAndroid");

        if (state != null) web.restoreState(state);
        else web.loadUrl(HOME);
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
                camUri = FileProvider.getUriForFile(this, "jp.nippo.unkou.files", f);
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

        @JavascriptInterface
        public String version() {
            try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return ""; }
        }
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
