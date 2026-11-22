package jp.nippo.unkou;

// LINE連絡キーボード：LINE の入力欄の下に、次に送る文の選択肢を出す。押すと入力欄に文が入る（送信は LINE の［送信］を本人が押す）
//  ┌ 11/24（火）  [8番]          [取り消し] ┐
//  │ ┏━ いちばん可能性が高い文 ━━━━━━━━┓ │
//  │ [2番目の文]                            │
//  │ [3番目の文]                            │
//  │ [全部の文] [⌫] [あ 普通のキーボード]      │
//  └─────────────────────┘

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.inputmethodservice.InputMethodService;
import android.os.Build;
import android.os.IBinder;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.util.Calendar;
import java.util.List;

public class RenrakuIME extends InputMethodService {
    static final int PURPLE = 0xFF5A2A91, PURPLE_D = 0xFF3F1868, SOFT = 0xFFEFE6F9, PAPER = 0xFFF5F2FA, INK = 0xFF221A33;
    RenrakuStore st;
    LinearLayout root;
    boolean showAll = false;

    @Override public void onCreate() { super.onCreate(); st = new RenrakuStore(this); }

    int dp(float v) { return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()); }

    @Override
    public View onCreateInputView() {
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(PAPER);
        root.setPadding(dp(8), dp(6), dp(8), dp(8));
        build();
        return root;
    }

    @Override
    public void onStartInputView(EditorInfo info, boolean restarting) {
        super.onStartInputView(info, restarting);
        showAll = false;
        if (root != null) build();   // 開くたびに、いまの時刻で選択肢を作り直す
    }

    Button btn(String text, boolean main, View.OnClickListener l) {
        Button b = new Button(this);
        b.setAllCaps(false);
        b.setText(text);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, main ? 19 : 16);
        b.setTypeface(Typeface.DEFAULT, main ? Typeface.BOLD : Typeface.NORMAL);
        b.setTextColor(main ? Color.WHITE : INK);
        b.setGravity(Gravity.CENTER_VERTICAL | Gravity.START);
        b.setPadding(dp(14), dp(8), dp(14), dp(8));
        GradientDrawable g = new GradientDrawable();
        g.setCornerRadius(dp(12));
        if (main) { g.setColors(new int[]{PURPLE_D, 0xFF7440B5}); g.setOrientation(GradientDrawable.Orientation.TL_BR); }
        else { g.setColor(Color.WHITE); g.setStroke(dp(1.5f), PURPLE); }
        b.setBackground(g);
        b.setMinHeight(dp(main ? 64 : 50));
        b.setOnClickListener(l);
        return b;
    }

    Button small(String text, View.OnClickListener l) {
        Button b = btn(text, false, l);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        b.setGravity(Gravity.CENTER);
        b.setMinHeight(dp(44));
        b.setPadding(dp(6), dp(4), dp(6), dp(4));
        return b;
    }

    LinearLayout.LayoutParams lp(float w) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(w > 0 ? 0 : ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, w);
        p.setMargins(dp(3), dp(3), dp(3), dp(3));
        return p;
    }

    void build() {
        root.removeAllViews();
        // 上の段：日付・車番・取り消し
        LinearLayout top = new LinearLayout(this);
        top.setGravity(Gravity.CENTER_VERTICAL);
        Calendar c = Calendar.getInstance();
        TextView d = new TextView(this);
        d.setText((c.get(Calendar.MONTH) + 1) + "/" + c.get(Calendar.DAY_OF_MONTH) + "（" + "日月火水木金土".charAt(c.get(Calendar.DAY_OF_WEEK) - 1) + "）");
        d.setTextColor(INK); d.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        top.addView(d, lp(1));
        top.addView(small(st.car() + "番", v -> nextCar()), lp(0.8f));
        List<String> today = st.todayCats();
        if (!today.isEmpty()) top.addView(small("取り消し", v -> undo()), lp(1));
        root.addView(top);

        if (showAll) {
            ScrollView sv = new ScrollView(this);
            LinearLayout box = new LinearLayout(this); box.setOrientation(LinearLayout.VERTICAL);
            for (String id : Renraku.IDS) {
                String[] vs = Renraku.TEXTS.get(id);
                for (int i = 0; i < vs.length; i++) { final int vi = i; box.addView(btn(st.text(id, i), false, v -> put(id, vi)), lp(0)); }
            }
            sv.addView(box);
            root.addView(sv, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(230)));
        } else {
            List<String> r = Renraku.rank(st.past(), today, RenrakuStore.nowMin(), null);
            for (int i = 0; i < 3 && i < r.size(); i++) { final String id = r.get(i); root.addView(btn(st.text(id, 0), i == 0, v -> put(id, 0)), lp(0)); }
        }

        LinearLayout bot = new LinearLayout(this);
        bot.addView(small(showAll ? "選択肢に戻る" : "全部の文", v -> { showAll = !showAll; build(); }), lp(1.2f));
        bot.addView(small("⌫", v -> sendDownUpKeyEvents(KeyEvent.KEYCODE_DEL)), lp(0.6f));
        bot.addView(small("あ 普通のキーボード", v -> backToKeyboard()), lp(1.6f));
        root.addView(bot);
        root.post(this::writeLayout);
    }

    // 試験用：いま出ているボタンの文と画面の位置を、スマホの中のファイルに書く（外には出ない）
    void writeLayout() {
        StringBuilder b = new StringBuilder();
        collect(root, b);
        try (java.io.FileOutputStream o = openFileOutput("ime-layout.txt", MODE_PRIVATE)) { o.write(b.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)); } catch (Exception e) { }
    }
    void collect(View v, StringBuilder b) {
        if (v instanceof Button) { int[] p = new int[2]; v.getLocationOnScreen(p); b.append(p[0] + v.getWidth() / 2).append('\t').append(p[1] + v.getHeight() / 2).append('\t').append(((Button) v).getText()).append('\n'); }
        if (v instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) v).getChildCount(); i++) collect(((ViewGroup) v).getChildAt(i), b);
    }

    // 選んだ文を入力欄に入れて、記録して、次の選択肢に進む
    void put(String id, int variant) {
        InputConnection ic = getCurrentInputConnection();
        if (ic == null) return;
        String t = st.text(id, variant);
        ic.commitText(t, 1);
        st.add(id);
        st.setLastText(t);
        showAll = false;
        build();
    }

    // 直前に入れた文を入力欄から消して、記録も戻す
    void undo() {
        InputConnection ic = getCurrentInputConnection();
        String last = st.lastText();
        if (ic != null && !last.isEmpty()) {
            CharSequence before = ic.getTextBeforeCursor(last.length(), 0);
            if (before != null && before.toString().equals(last)) ic.deleteSurroundingText(last.length(), 0);
        }
        st.undo();
        st.setLastText("");
        build();
    }

    void nextCar() {
        int[] cs = st.cars(); int cur = st.car(), i = 0;
        for (int k = 0; k < cs.length; k++) if (cs[k] == cur) i = k;
        st.setCar(cs[(i + 1) % cs.length]);
        build();
    }

    // 前に使っていたキーボード（Gboard など）に戻る
    void backToKeyboard() {
        boolean ok = false;
        if (Build.VERSION.SDK_INT >= 28) ok = switchToPreviousInputMethod();
        else {
            IBinder tk = getWindow() != null && getWindow().getWindow() != null ? getWindow().getWindow().getAttributes().token : null;
            InputMethodManager im = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
            if (tk != null) ok = im.switchToLastInputMethod(tk);
        }
        if (!ok) ((InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE)).showInputMethodPicker();
    }
}
