package jp.nippo.unkou;

// LINE連絡キーボード：次に送る文を予測する（Android の部品を使わない純粋な計算。手元の試験でもそのまま動かす）
// もとにしたのは名取さんの LINE「運行情報」の履歴（2026/10/28〜11/20、16日分）。
// 決め方：①さっき入れた文の「次によく送った文」を候補にする ②いまの時刻がその文の時間帯（±15分）に入るものを上にする
//        ③その中では回数の多い順 ④候補にない文は時間帯に近い順で下に並べる

import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

public class Renraku {
    // 文の種類と、その文（1番目が選択肢に出る文。2番目以降は「全部の文」に出る言い方違い）
    public static final String[] IDS = {"depart", "wash", "kmArr", "mcArr", "amPlan", "pana", "fujiDone", "pmPlan", "katsuDone", "koishi", "kfkDone", "garage"};
    public static final Map<String, String[]> TEXTS = new HashMap<>();
    static {
        TEXTS.put("depart", new String[]{"おはようございます!{car}番出庫します!🚛"});
        TEXTS.put("wash", new String[]{"洗車＆給油完了しました！", "洗車完了しました！", "給油完了しました！"});
        TEXTS.put("kmArr", new String[]{"甲府南工場着です！"});
        TEXTS.put("mcArr", new String[]{"マシンセンター到着しました！"});
        TEXTS.put("amPlan", new String[]{"富士吉田、納品引き取りになります！🚛", "富士吉田、勝山納品引き取りになります！🚛富士吉田からまわります！"});
        TEXTS.put("pana", new String[]{"Panasonic{n}回目納品完了しました！"});
        TEXTS.put("fujiDone", new String[]{"富士吉田納品引き取り完了しました！", "富士吉田納品引き取り完了！勝山に向います！", "富士吉田納品完了！引き取り無しです！"});
        TEXTS.put("pmPlan", new String[]{"午後は勝山、納品引き取りになります！", "午後は富士吉田、納品引き取りになります！"});
        TEXTS.put("katsuDone", new String[]{"勝山完了しました！"});
        TEXTS.put("koishi", new String[]{"勝山引き取り分、納品完了しました！小石和倉庫の横持ちに向います！"});
        TEXTS.put("kfkDone", new String[]{"KFK完了！帰庫します！", "KFK完了！洗車＆給油してから帰庫します！"});
        TEXTS.put("garage", new String[]{"お疲れ様です！車庫着{day}、点呼{tenko}です！"});
    }

    // 履歴の文 → 種類（LINE の履歴を読み込むときにも使う）
    static final String[][] PAT = {{"depart", "おはようございます"}, {"kmArr", "甲府南工場着"}, {"mcArr", "マシンセンター到着|マシンセンター着"}, {"wash", "洗車|給油"},
            {"amPlan", "^富士吉田、.*納品引き取りになります"}, {"pana", "Panasonic"}, {"fujiDone", "^富士吉田.*完了"}, {"pmPlan", "午後は"}, {"katsuDone", "^勝山完了"},
            {"koishi", "小石和"}, {"kfkDone", "KFK完了"}, {"garage", "車庫着"}};
    public static String category(String text) {
        for (String[] p : PAT) if (Pattern.compile(p[1]).matcher(text).find()) return p[0];
        return null;
    }

    // 最初から入っている履歴（日付|分:種類,…;…）。分＝0時からの分（6:23→383）
    public static final String SEED = "20261028|383:depart,440:wash,526:mcArr,578:pana,643:pana,717:pmPlan,918:katsuDone,992:kfkDone,1085:garage;20261029|398:depart,522:mcArr,587:pana,650:pana,731:pmPlan,921:katsuDone,1005:kfkDone,1078:garage;20261030|381:depart,519:mcArr,573:pana,641:pana,684:pmPlan,927:katsuDone,1009:kfkDone,1077:garage;20261104|353:depart,391:kmArr,458:amPlan,554:fujiDone,624:pmPlan,860:katsuDone,950:kfkDone,999:garage;20261105|362:depart,519:mcArr,575:pana,640:pana,677:pmPlan,885:katsuDone,981:kfkDone,1067:garage;20261106|358:depart,410:wash,518:mcArr,573:pana,640:pana,701:pmPlan,898:katsuDone,1002:koishi,1037:kfkDone,1105:garage;20261109|378:depart,521:mcArr,576:pana,645:pana,673:pmPlan,939:katsuDone,1025:kfkDone,1071:garage;20261110|410:depart,518:mcArr,565:pana,629:pana,671:pmPlan,989:katsuDone,1077:kfkDone,1127:garage;20261111|365:depart,391:kmArr,464:amPlan,570:fujiDone,744:pmPlan,916:katsuDone,1006:kfkDone,1051:garage;20261112|366:depart,393:kmArr,423:amPlan,604:fujiDone,659:katsuDone,750:wash,829:garage;20261113|362:depart,386:kmArr,469:amPlan,602:fujiDone,705:kfkDone,734:garage;20261116|364:depart,518:mcArr,573:pana,624:pana,724:pmPlan,906:katsuDone,976:kfkDone,1015:garage;20261117|435:depart,524:mcArr,566:pana,626:pana,710:pmPlan,928:katsuDone,1029:kfkDone,1082:garage;20261118|359:depart,521:mcArr,577:pana,639:pana,736:pmPlan,881:kfkDone,971:koishi,1027:kfkDone,1074:garage;20261119|359:depart,440:wash,519:mcArr,572:pana,633:pana,709:pmPlan,830:katsuDone,910:koishi,999:kfkDone,1044:garage;20261120|357:depart,519:mcArr,567:pana,632:pana,717:pmPlan,901:katsuDone,1007:kfkDone,1057:garage";

    public static class Ev { public String day; public int min; public String cat; public Ev(String d, int m, String c) { day = d; min = m; cat = c; } }

    public static List<Ev> parse(String s) {
        List<Ev> L = new ArrayList<>();
        if (s == null || s.isEmpty()) return L;
        for (String d : s.split(";")) {
            String[] a = d.split("\\|");
            if (a.length < 2) continue;
            for (String e : a[1].split(",")) { String[] b = e.split(":"); if (b.length == 2) L.add(new Ev(a[0], Integer.parseInt(b[0]), b[1])); }
        }
        return L;
    }
    public static String format(List<Ev> L) {
        StringBuilder b = new StringBuilder(); String day = null;
        for (Ev e : L) {
            if (!e.day.equals(day)) { if (day != null) b.append(';'); b.append(e.day).append('|'); day = e.day; } else b.append(',');
            b.append(e.min).append(':').append(e.cat);
        }
        return b.toString();
    }

    public static final int MARGIN = 15;

    // 順番を決める。past：今日より前の履歴（日付順・時刻順）。today：今日入れた種類（順番どおり）。now：いまの分
    public static List<String> rank(List<Ev> past, List<String> today, int now, String skipDay) {
        Map<String, Map<String, Integer>> nx = new HashMap<>();
        Map<String, int[]> tm = new HashMap<>();   // 種類 → {最小, 最大}
        String day = null, prev = null;
        for (Ev e : past) {
            if (skipDay != null && skipDay.equals(e.day)) continue;
            if (!e.day.equals(day)) { day = e.day; prev = "start"; }
            nx.computeIfAbsent(prev, k -> new HashMap<>()).merge(e.cat, 1, Integer::sum);
            int[] w = tm.get(e.cat); if (w == null) tm.put(e.cat, new int[]{e.min, e.min}); else { w[0] = Math.min(w[0], e.min); w[1] = Math.max(w[1], e.min); }
            prev = e.cat;
        }
        String last = today.isEmpty() ? "start" : today.get(today.size() - 1);
        Map<String, Integer> cand = nx.containsKey(last) ? nx.get(last) : new HashMap<>();
        List<String> order = new ArrayList<>(cand.keySet());
        order.sort((a, b) -> {
            int da = dist(tm, a, now), db = dist(tm, b, now);
            if ((da > 0) != (db > 0)) return da > 0 ? 1 : -1;
            int c = cand.get(b) - cand.get(a); if (c != 0) return c;
            if (da != db) return da - db;
            return idx(a) - idx(b);   // 同じなら決まった順（乱数は使わない）
        });
        List<String> rest = new ArrayList<>();
        for (String id : IDS) if (!order.contains(id)) rest.add(id);
        rest.sort((a, b) -> { int c = dist(tm, a, now) - dist(tm, b, now); return c != 0 ? c : idx(a) - idx(b); });
        order.addAll(rest);
        return order;
    }
    static int idx(String id) { for (int i = 0; i < IDS.length; i++) if (IDS[i].equals(id)) return i; return 99; }
    static int dist(Map<String, int[]> tm, String c, int t) {
        int[] w = tm.get(c); if (w == null) return 100000;
        int lo = w[0] - MARGIN, hi = w[1] + MARGIN;
        return t >= lo && t <= hi ? 0 : Math.min(Math.abs(t - lo), Math.abs(t - hi));
    }

    // 文の中の {…} を入れる
    public static String fill(String t, int car, int panaCount, String dayWord, String tenko) {
        return t.replace("{car}", String.valueOf(car)).replace("{n}", String.valueOf(panaCount + 1)).replace("{day}", dayWord).replace("{tenko}", tenko);
    }

    // ---- 次に行く日（土日と国民の祝日・休日を飛ばす）。内閣府「国民の祝日」syukujitsu.csv の 2026・2027年分 ----
    static final Set<String> HOL = new HashSet<>();
    static {
        String[] h = {"2026/1/1", "2026/1/12", "2026/2/11", "2026/2/23", "2026/3/20", "2026/4/29", "2026/5/3", "2026/5/4", "2026/5/5", "2026/5/6",
                "2026/7/20", "2026/8/11", "2026/9/21", "2026/9/22", "2026/9/23", "2026/10/12", "2026/11/3", "2026/11/23",
                "2027/1/1", "2027/1/11", "2027/2/11", "2027/2/23", "2027/3/21", "2027/3/22", "2027/4/29", "2027/5/3", "2027/5/4", "2027/5/5",
                "2027/7/19", "2027/8/11", "2027/9/20", "2027/9/23", "2027/10/11", "2027/11/3", "2027/11/23"};
        for (String x : h) HOL.add(x);
    }
    static boolean off(Calendar c) {
        int w = c.get(Calendar.DAY_OF_WEEK);
        return w == Calendar.SATURDAY || w == Calendar.SUNDAY || HOL.contains(c.get(Calendar.YEAR) + "/" + (c.get(Calendar.MONTH) + 1) + "/" + c.get(Calendar.DAY_OF_MONTH));
    }
    public static String nextDayWord(Calendar from) {
        Calendar c = (Calendar) from.clone(); int add = 0;
        do { c.add(Calendar.DAY_OF_MONTH, 1); add++; } while (off(c) && add < 30);
        if (add == 1) return "明日";
        if (add <= 6) return new String[]{"", "日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"}[c.get(Calendar.DAY_OF_WEEK)];
        return (c.get(Calendar.MONTH) + 1) + "月" + c.get(Calendar.DAY_OF_MONTH) + "日";
    }

    // ---- LINE の「トーク履歴を送信」で作った .txt を読む。自分の発言だけ（出庫の文を送った人を自分とみなす）----
    public static List<Ev> importLine(String txt) {
        String[] lines = txt.replace("﻿", "").split("\r?\n");
        Pattern dayP = Pattern.compile("^(\\d{4})/(\\d{1,2})/(\\d{1,2})\\(.\\)");
        Pattern msgP = Pattern.compile("^(\\d{1,2}):(\\d{2})\\t([^\\t]*)\\t(.*)$");
        Map<String, Integer> who = new HashMap<>();
        List<String[]> all = new ArrayList<>();   // 日付, 分, 送った人, 文
        String day = null;
        for (String l : lines) {
            java.util.regex.Matcher m = dayP.matcher(l);
            if (m.find()) { day = String.format("%s%02d%02d", m.group(1), Integer.parseInt(m.group(2)), Integer.parseInt(m.group(3))); continue; }
            m = msgP.matcher(l);
            if (m.find() && day != null) {
                all.add(new String[]{day, String.valueOf(Integer.parseInt(m.group(1)) * 60 + Integer.parseInt(m.group(2))), m.group(3), m.group(4)});
                if (m.group(4).contains("出庫します")) who.merge(m.group(3), 1, Integer::sum);
            }
        }
        String me = null; int best = 0;
        for (Map.Entry<String, Integer> e : who.entrySet()) if (e.getValue() > best) { best = e.getValue(); me = e.getKey(); }
        List<Ev> L = new ArrayList<>();
        if (me == null) return L;
        for (String[] a : all) { if (!a[2].equals(me)) continue; String c = category(a[3]); if (c != null) L.add(new Ev(a[0], Integer.parseInt(a[1]), c)); }
        return L;
    }
}
