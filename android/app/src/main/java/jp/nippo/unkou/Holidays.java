package jp.nippo.unkou;

// 国民の祝日・休日（内閣府「国民の祝日について」の syukujitsu.csv）。
// ・アプリの中に 2026〜2027年分を入れておく（2026-11-21 に内閣府の CSV から写した）
// ・月に1回、内閣府の CSV を取り直してスマホの中に保存する（翌年以降の分が増えたら、それを使う）
// 帰庫の連絡「車庫着明日／月曜日／火曜日、点呼…」の「次に行く日」を決めるのに使う（土日と祝日・休日は運行なし）

import android.content.Context;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.Charset;
import java.util.Calendar;
import java.util.HashSet;
import java.util.Set;

public class Holidays {
    static final String URL_CSV = "https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv";
    static final String[] BUILTIN = {
        "2026/1/1", "2026/1/12", "2026/2/11", "2026/2/23", "2026/3/20", "2026/4/29", "2026/5/3", "2026/5/4", "2026/5/5", "2026/5/6",
        "2026/7/20", "2026/8/11", "2026/9/21", "2026/9/22", "2026/9/23", "2026/10/12", "2026/11/3", "2026/11/23",
        "2027/1/1", "2027/1/11", "2027/2/11", "2027/2/23", "2027/3/21", "2027/3/22", "2027/4/29", "2027/5/3", "2027/5/4", "2027/5/5",
        "2027/7/19", "2027/8/11", "2027/9/20", "2027/9/23", "2027/10/11", "2027/11/3", "2027/11/23",
    };

    static File file(Context c) { return new File(c.getFilesDir(), "holidays.csv"); }

    static Set<String> all(Context c) {
        Set<String> s = new HashSet<>();
        for (String x : BUILTIN) s.add(x);
        try {
            File f = file(c);
            if (f.exists()) {
                byte[] b = new byte[(int) f.length()];
                try (FileInputStream in = new FileInputStream(f)) { int n = 0; while (n < b.length) { int k = in.read(b, n, b.length - n); if (k < 0) break; n += k; } }
                for (String line : new String(b, Charset.forName("Shift_JIS")).split("\\r?\\n")) {
                    String d = line.split(",")[0].trim();
                    if (d.matches("\\d{4}/\\d{1,2}/\\d{1,2}")) s.add(d);
                }
            }
        } catch (Exception e) { }
        return s;
    }

    static String key(Calendar c) { return c.get(Calendar.YEAR) + "/" + (c.get(Calendar.MONTH) + 1) + "/" + c.get(Calendar.DAY_OF_MONTH); }

    static boolean off(Set<String> H, Calendar c) {
        int w = c.get(Calendar.DAY_OF_WEEK);
        return w == Calendar.SATURDAY || w == Calendar.SUNDAY || H.contains(key(c));
    }

    // from の次の運行日を言葉で：翌日なら「明日」、1週間以内なら「火曜日」、それより先（年末年始など）は「1月4日」
    static String nextWord(Context ctx, Calendar from) {
        Set<String> H = all(ctx);
        Calendar c = (Calendar) from.clone();
        int add = 0;
        do { c.add(Calendar.DAY_OF_MONTH, 1); add++; } while (off(H, c) && add < 30);
        if (add == 1) return "明日";
        if (add <= 6) return new String[]{"", "日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"}[c.get(Calendar.DAY_OF_WEEK)];
        return (c.get(Calendar.MONTH) + 1) + "月" + c.get(Calendar.DAY_OF_MONTH) + "日";
    }

    // 月に1回、内閣府の CSV を取り直す（電波が無ければ次の機会に。失敗してもアプリの中の分で動く）
    static void refresh(Context c) {
        File f = file(c);
        if (f.exists() && System.currentTimeMillis() - f.lastModified() < 30L * 86400000L) return;
        new Thread(() -> {
            try {
                HttpURLConnection h = (HttpURLConnection) new URL(URL_CSV).openConnection();
                h.setConnectTimeout(15000); h.setReadTimeout(30000);
                if (h.getResponseCode() != 200) { h.disconnect(); return; }
                java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
                try (InputStream in = h.getInputStream()) { byte[] buf = new byte[8192]; int n; while ((n = in.read(buf)) > 0) bo.write(buf, 0, n); }
                h.disconnect();
                byte[] b = bo.toByteArray();
                String t = new String(b, Charset.forName("Shift_JIS"));
                if (!t.contains("元日") || b.length < 5000) return;   // 中身が違う（エラーのページなど）ときは保存しない
                File tmp = new File(c.getFilesDir(), "holidays.csv.tmp");
                try (FileOutputStream o = new FileOutputStream(tmp)) { o.write(b); }
                tmp.renameTo(f);
            } catch (Exception e) { }
        }).start();
    }
}
