package jp.nippo.unkou;

// LINE連絡キーボードの設定画面（アプリを開くとこの画面）
//  ① キーボードを有効にする ② ここで試す ③ 車番・点呼の時刻 ④ LINE の履歴を読み込む

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.inputmethod.InputMethodInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

public class SetupActivity extends Activity {
    static final int REQ_FILE = 1;
    RenrakuStore st;
    TextView status, learned;
    EditText cars, tenko;

    int dp(float v) { return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()); }

    TextView text(LinearLayout box, String s, int sp, boolean bold, int color) {
        TextView t = new TextView(this); t.setText(s); t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp); t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setPadding(0, dp(10), 0, dp(4)); box.addView(t); return t;
    }
    Button button(LinearLayout box, String s, View.OnClickListener l) {
        Button b = new Button(this); b.setAllCaps(false); b.setText(s); b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16); b.setOnClickListener(l); box.addView(b); return b;
    }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        st = new RenrakuStore(this);
        ScrollView sv = new ScrollView(this);
        LinearLayout box = new LinearLayout(this); box.setOrientation(LinearLayout.VERTICAL); box.setPadding(dp(18), dp(18), dp(18), dp(40));
        box.setBackgroundColor(0xFFF5F2FA);
        sv.addView(box); setContentView(sv);
        int ink = 0xFF221A33, mute = 0xFF6C6480, purple = 0xFF5A2A91;

        TextView h = text(box, "LINE連絡キーボード", 24, true, 0xFF3F1868);
        text(box, "会社の LINE の入力欄の下に、次に送る文の選択肢を出すキーボードです。押すと入力欄に文が入るので、LINE の［送信］を押してください。"
                + "このアプリはインターネットを使う許可を持っていないので、入力した内容をどこかへ送ることはできません。", 15, false, mute);
        learned = text(box, "", 15, true, ink);

        text(box, "① キーボードを有効にする（最初の1回だけ）", 17, true, purple);
        status = text(box, "", 15, false, ink);
        button(box, "キーボードの設定を開く", v -> startActivity(new Intent(Settings.ACTION_INPUT_METHOD_SETTINGS)));
        text(box, "開いた画面で「LINE連絡キーボード」をオンにしてください（Android の決まった注意が出ます）。", 14, false, mute);

        text(box, "② ここで試す", 17, true, purple);
        EditText test = new EditText(this); test.setHint("ここを押すとキーボードが出ます"); test.setContentDescription("試す欄"); test.setMinLines(2); box.addView(test);
        button(box, "キーボードを切り替える", v -> ((InputMethodManager) getSystemService(INPUT_METHOD_SERVICE)).showInputMethodPicker());
        text(box, "LINE でも同じです。入力欄を押して、画面下のキーボードのボタン（地球マークなど）で「LINE連絡キーボード」に替えます。手で打つときは［あ 普通のキーボード］で戻ります。", 14, false, mute);

        text(box, "③ 車番と点呼の時刻", 17, true, purple);
        text(box, "車番（よく乗る順に、カンマで区切る）", 14, false, ink);
        cars = new EditText(this); cars.setText(st.carsText()); cars.setInputType(InputType.TYPE_CLASS_TEXT); box.addView(cars);
        text(box, "点呼の時刻（帰庫の連絡に入ります）", 14, false, ink);
        tenko = new EditText(this); tenko.setText(st.tenko()); tenko.setInputType(InputType.TYPE_CLASS_DATETIME | InputType.TYPE_DATETIME_VARIATION_TIME); box.addView(tenko);
        button(box, "保存", v -> {
            st.setCars(cars.getText().toString().trim());
            st.setTenko(tenko.getText().toString().trim().isEmpty() ? "6:00" : tenko.getText().toString().trim());
            int[] cs = st.cars(); boolean has = false; for (int x : cs) if (x == st.car()) has = true; if (!has) st.setCar(cs[0]);
            Toast.makeText(this, "保存しました", Toast.LENGTH_SHORT).show();
        });

        text(box, "④ 履歴を覚え直す", 17, true, purple);
        button(box, "LINE の履歴を読み込む（.txt）", v -> {
            Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT); i.addCategory(Intent.CATEGORY_OPENABLE); i.setType("text/*");
            startActivityForResult(i, REQ_FILE);
        });
        text(box, "LINE の会社のトーク → 右上の ≡ → 設定 → トーク履歴を送信 で作ったファイルを選ぶと、自分の発言を読み直して選択肢の順番を覚え直します。", 14, false, mute);
        text(box, "祝日は内閣府「国民の祝日」の 2026・2027年分が入っています。", 13, false, mute);
    }

    @Override
    protected void onResume() {
        super.onResume();
        boolean on = false;
        InputMethodManager im = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        for (InputMethodInfo i : im.getEnabledInputMethodList()) if (getPackageName().equals(i.getPackageName())) on = true;
        status.setText(on ? "有効になっています ✓" : "まだ有効になっていません");
        status.setTextColor(on ? 0xFF1F6B3A : 0xFF9C4D0A);
        showLearned();
    }

    void showLearned() {
        Set<String> days = new HashSet<>(); List<Renraku.Ev> E = st.events();
        for (Renraku.Ev e : E) days.add(e.day);
        learned.setText(days.size() + "日分・" + E.size() + "件の連絡を覚えています");
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req != REQ_FILE || res != RESULT_OK || data == null || data.getData() == null) return;
        try {
            Uri u = data.getData();
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            try (InputStream in = getContentResolver().openInputStream(u)) { byte[] buf = new byte[8192]; int n; while ((n = in.read(buf)) > 0) bo.write(buf, 0, n); }
            List<Renraku.Ev> I = Renraku.importLine(new String(bo.toByteArray(), StandardCharsets.UTF_8));
            if (I.isEmpty()) { Toast.makeText(this, "自分の発言が見つかりませんでした（「出庫します」の文を送った人を自分とみなします）", Toast.LENGTH_LONG).show(); return; }
            // 読み込んだ日は履歴の内容で置き換え、それ以外の日（キーボードで覚えた日）は残す
            Set<String> days = new HashSet<>(); for (Renraku.Ev e : I) days.add(e.day);
            List<Renraku.Ev> L = new ArrayList<>(I);
            for (Renraku.Ev e : st.events()) if (!days.contains(e.day)) L.add(e);
            st.saveEvents(L);
            Toast.makeText(this, days.size() + "日分・" + I.size() + "件を読み込みました", Toast.LENGTH_LONG).show();
            showLearned();
        } catch (Exception e) { Toast.makeText(this, "読み込めませんでした：" + e.getMessage(), Toast.LENGTH_LONG).show(); }
    }
}
