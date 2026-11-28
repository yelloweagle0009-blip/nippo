package jp.nippo.unkou;

// 国際電話ブロックの画面（アプリを開くとこの画面）
//  ① 許可を出す ② 拒否のオン・オフ ③ 拒否した電話の記録

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

public class KyohiActivity extends Activity {
    SharedPreferences p;
    TextView perm, logView;
    int ink = 0xFF221A33, mute = 0xFF6C6480, purple = 0xFF5A2A91, red = 0xFFB4232D;

    int dp(float v) { return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()); }
    TextView text(LinearLayout box, String s, int sp, boolean bold, int color) {
        TextView t = new TextView(this); t.setText(s); t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp); t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setPadding(0, dp(10), 0, dp(4)); box.addView(t); return t;
    }

    // 要る許可：電話の状態（鳴っているか）・通話履歴（番号を知る）・電話を切る・連絡先（入っている番号は拒否しない）・通知
    String[] need() {
        List<String> l = new ArrayList<>();
        l.add(Manifest.permission.READ_PHONE_STATE); l.add(Manifest.permission.READ_CALL_LOG);
        l.add(Manifest.permission.ANSWER_PHONE_CALLS); l.add(Manifest.permission.READ_CONTACTS);
        if (Build.VERSION.SDK_INT >= 33) l.add(Manifest.permission.POST_NOTIFICATIONS);
        return l.toArray(new String[0]);
    }
    boolean allOk() { for (String s : need()) if (checkSelfPermission(s) != PackageManager.PERMISSION_GRANTED) return false; return true; }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        p = getSharedPreferences(KyohiReceiver.PREF, MODE_PRIVATE);
        ScrollView sv = new ScrollView(this);
        LinearLayout box = new LinearLayout(this); box.setOrientation(LinearLayout.VERTICAL); box.setPadding(dp(18), dp(18), dp(18), dp(40));
        box.setBackgroundColor(0xFFF5F2FA); sv.addView(box); setContentView(sv);
        if (Build.VERSION.SDK_INT >= 35) box.setOnApplyWindowInsetsListener((v, ins) -> { android.graphics.Insets s = ins.getInsets(android.view.WindowInsets.Type.systemBars());
            v.setPadding(dp(18), dp(18) + s.top, dp(18), dp(40) + s.bottom); return ins; });

        text(box, "国際電話ブロック", 24, true, purple);
        text(box, "海外の番号（＋のあとが81以外・010で始まる番号）からの電話を、鳴り始めたらすぐ切ります。連絡先に入っている番号は切りません。あんしんセキュリティなど「迷惑電話アプリ」の設定はそのままで使えます。", 15, false, mute);

        text(box, "① 許可", 18, true, ink);
        perm = text(box, "", 15, false, ink);
        Button go = new Button(this); go.setAllCaps(false); go.setText("許可を出す"); go.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        go.setOnClickListener(v -> requestPermissions(need(), 1)); box.addView(go);
        Button app = new Button(this); app.setAllCaps(false); app.setText("（うまくいかないとき）アプリの設定を開く"); app.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        app.setOnClickListener(v -> startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())))); box.addView(app);

        text(box, "② 設定", 18, true, ink);
        CheckBox on = new CheckBox(this); on.setText("国際電話を拒否する"); on.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16); on.setChecked(p.getBoolean("on", true));
        on.setOnCheckedChangeListener((v, c) -> p.edit().putBoolean("on", c).apply()); box.addView(on);
        CheckBox hid = new CheckBox(this); hid.setText("非通知も拒否する"); hid.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16); hid.setChecked(p.getBoolean("hidden", false));
        hid.setOnCheckedChangeListener((v, c) -> p.edit().putBoolean("hidden", c).apply()); box.addView(hid);

        p.edit().remove("test").apply();   // 前の版の「試しの番号」が残っていれば消す

        text(box, "③ 拒否した電話（新しい順）", 18, true, ink);
        logView = text(box, "", 15, false, ink);
    }

    // 画面を開いたまま電話が来ても、記録がすぐ画面に出るようにする（拒否の記録や許可が変わったら描き直す）
    final SharedPreferences.OnSharedPreferenceChangeListener watch = (sp, k) -> { if ("log".equals(k)) runOnUiThread(this::show); };
    @Override protected void onResume() { super.onResume(); p.registerOnSharedPreferenceChangeListener(watch); show(); }
    @Override protected void onPause() { super.onPause(); p.unregisterOnSharedPreferenceChangeListener(watch); }
    @Override public void onWindowFocusChanged(boolean f) { super.onWindowFocusChanged(f); if (f) show(); }
    @Override public void onRequestPermissionsResult(int r, String[] ps, int[] res) { super.onRequestPermissionsResult(r, ps, res); show(); }

    void show() {
        StringBuilder s = new StringBuilder();
        String[] names = {"電話の状態", "通話履歴（番号を知るため）", "電話を切る", "連絡先（入っている番号は切らない）", "通知"};
        String[] ps = need();
        for (int i = 0; i < ps.length; i++) s.append(checkSelfPermission(ps[i]) == PackageManager.PERMISSION_GRANTED ? "○ " : "× ").append(names[i]).append('\n');
        s.append(allOk() ? "準備できました。国際電話が来たら自動で切ります。" : "× の許可を出してください。");
        perm.setText(s.toString()); perm.setTextColor(allOk() ? ink : red);
        String log = p.getString("log", "");
        if (log.isEmpty()) { logView.setText("まだありません"); return; }
        SimpleDateFormat f = new SimpleDateFormat("M/d HH:mm", Locale.JAPAN); StringBuilder o = new StringBuilder();
        for (String row : log.split("\n")) { String[] c = row.split("\t", -1); if (c.length < 4) continue;
            o.append(f.format(new Date(Long.parseLong(c[0])))).append("　").append(c[1].isEmpty() ? "番号なし" : c[1]).append("　").append(c[2]).append(c[3].equals("1") ? "" : "（切れなかった）").append('\n'); }
        logView.setText(o.toString().trim());
    }
}
