package jp.nippo.unkou;

// LINE連絡キーボードの記録（スマホの中だけ。インターネットの許可を持たないアプリなので、どこにも送れない）
//  events：これまでに入れた文の種類と時刻（最初は名取さんの LINE 履歴16日分）。キーボードで文を入れるたびに足して覚え直す
//  cars：車番の一覧、car：いまの車番、tenko：点呼の時刻

import android.content.Context;
import android.content.SharedPreferences;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Locale;

public class RenrakuStore {
    final SharedPreferences sp;
    RenrakuStore(Context c) { sp = c.getSharedPreferences("renraku", Context.MODE_PRIVATE); }

    List<Renraku.Ev> events() {
        List<Renraku.Ev> L = Renraku.parse(sp.getString("events", Renraku.SEED));
        // 1年より前の分は使わない（記録が大きくなりすぎないように）
        String lim = new SimpleDateFormat("yyyyMMdd", Locale.JAPAN).format(new Date(System.currentTimeMillis() - 366L * 86400000L));
        List<Renraku.Ev> out = new ArrayList<>();
        for (Renraku.Ev e : L) if (e.day.compareTo(lim) >= 0) out.add(e);
        return out;
    }
    void saveEvents(List<Renraku.Ev> L) {
        L.sort((a, b) -> { int c = a.day.compareTo(b.day); return c != 0 ? c : a.min - b.min; });
        sp.edit().putString("events", Renraku.format(L)).apply();
    }

    static String today() { return new SimpleDateFormat("yyyyMMdd", Locale.JAPAN).format(new Date()); }
    static int nowMin() { Calendar c = Calendar.getInstance(); return c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE); }

    List<Renraku.Ev> past() { List<Renraku.Ev> o = new ArrayList<>(); String t = today(); for (Renraku.Ev e : events()) if (e.day.compareTo(t) < 0) o.add(e); return o; }
    List<String> todayCats() { List<String> o = new ArrayList<>(); String t = today(); for (Renraku.Ev e : events()) if (e.day.equals(t)) o.add(e.cat); return o; }

    void add(String cat) { List<Renraku.Ev> L = events(); L.add(new Renraku.Ev(today(), nowMin(), cat)); saveEvents(L); }
    // 今日の最後の1件を取り消す
    void undo() {
        List<Renraku.Ev> L = events(); String t = today();
        for (int i = L.size() - 1; i >= 0; i--) if (L.get(i).day.equals(t)) { L.remove(i); break; }
        saveEvents(L);
    }

    int car() { return sp.getInt("car", 8); }
    void setCar(int c) { sp.edit().putInt("car", c).apply(); }
    int[] cars() {
        String s = sp.getString("cars", "8,6,2");
        List<Integer> L = new ArrayList<>();
        for (String x : s.split("[,、\\s]+")) try { L.add(Integer.parseInt(x.trim())); } catch (Exception e) { }
        if (L.isEmpty()) L.add(8);
        int[] a = new int[L.size()]; for (int i = 0; i < a.length; i++) a[i] = L.get(i); return a;
    }
    String carsText() { return sp.getString("cars", "8,6,2"); }
    void setCars(String s) { sp.edit().putString("cars", s).apply(); }
    String tenko() { return sp.getString("tenko", "6:00"); }
    void setTenko(String s) { sp.edit().putString("tenko", s).apply(); }
    String lastText() { return sp.getString("lastText", ""); }
    void setLastText(String s) { sp.edit().putString("lastText", s).apply(); }

    int panaToday() { int n = 0; for (String c : todayCats()) if ("pana".equals(c)) n++; return n; }

    // 文の種類 → 実際の文（1番目の言い方）
    String text(String cat, int variant) {
        String[] v = Renraku.TEXTS.get(cat);
        return Renraku.fill(v[Math.min(variant, v.length - 1)], car(), panaToday(), Renraku.nextDayWord(Calendar.getInstance()), tenko());
    }
}
