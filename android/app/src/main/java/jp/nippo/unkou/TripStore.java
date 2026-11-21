package jp.nippo.unkou;

// 運行連絡：1日の記録（場所・着いた/出た・LINE の文・止まった所）と、登録した場所を、スマホの中のファイルに保存する。
// 位置の記録はどこにも送らない。30日より前の記録は消す。

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class TripStore {
    static final Object LOCK = new Object();

    static File f(Context c, String name) { return new File(c.getFilesDir(), name); }

    static JSONObject readObj(Context c, String name) {
        synchronized (LOCK) {
            try {
                File file = f(c, name);
                if (!file.exists()) return new JSONObject();
                byte[] b = new byte[(int) file.length()];
                try (FileInputStream in = new FileInputStream(file)) { int n = 0; while (n < b.length) { int k = in.read(b, n, b.length - n); if (k < 0) break; n += k; } }
                return new JSONObject(new String(b, StandardCharsets.UTF_8));
            } catch (Exception e) { return new JSONObject(); }
        }
    }

    static void writeObj(Context c, String name, JSONObject o) {
        synchronized (LOCK) {
            try {
                File tmp = f(c, name + ".tmp");
                try (FileOutputStream out = new FileOutputStream(tmp)) { out.write(o.toString().getBytes(StandardCharsets.UTF_8)); }
                tmp.renameTo(f(c, name));
            } catch (Exception e) { }
        }
    }

    // 今の1日の記録
    static JSONObject trip(Context c) { return readObj(c, "trip.json"); }
    static void saveTrip(Context c, JSONObject t) { writeObj(c, "trip.json", t); }

    // 登録した場所と設定（点呼の時刻・よく使う文・判定の数値）
    static JSONObject conf(Context c) { return readObj(c, "trip-conf.json"); }
    static void saveConf(Context c, JSONObject o) { writeObj(c, "trip-conf.json", o); }

    static JSONArray places(Context c) { JSONArray a = conf(c).optJSONArray("places"); return a != null ? a : new JSONArray(); }

    // 判定の数値（秒・メートル）。試験のときだけ短くできる
    static double param(Context c, String k, double def) {
        JSONObject p = conf(c).optJSONObject("params");
        return p != null && p.has(k) ? p.optDouble(k, def) : def;
    }

    static String today() { return new SimpleDateFormat("yyyy-MM-dd", Locale.JAPAN).format(new Date()); }

    // 終わった日の記録を履歴に移す（30日分だけ残す）
    static void archive(Context c, JSONObject t) {
        try {
            JSONObject h = readObj(c, "trip-history.json");
            String day = t.optString("day", today());
            h.put(day + "_" + t.optLong("startTs", 0), t);
            long lim = System.currentTimeMillis() - 30L * 86400000L;
            JSONArray names = h.names();
            if (names != null) for (int i = 0; i < names.length(); i++) { JSONObject x = h.optJSONObject(names.getString(i)); if (x != null && x.optLong("startTs", 0) < lim) h.remove(names.getString(i)); }
            writeObj(c, "trip-history.json", h);
        } catch (Exception e) { }
    }

    static double dist(double la1, double lo1, double la2, double lo2) {
        double R = 6371000, p1 = Math.toRadians(la1), p2 = Math.toRadians(la2), dp = p2 - p1, dl = Math.toRadians(lo2 - lo1);
        double a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
        return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
}
