package jp.nippo.unkou;

// 運行連絡：出庫から帰庫まで位置を見て、登録した場所に「着いた」「出た」を決め、日報の行と LINE の文を作る。
// ・位置の許可は「アプリの使用中のみ」で動く（出庫ボタンから、通知を出したままの前面サービスとして動かすため）
// ・着いた：場所の円の中に dwell 秒（既定2分）いたら。時刻は円に入った時刻
// ・出た：円の外に exit 秒（既定1分）いたか、円から far メートル（既定300m）以上離れたら。時刻は円を出た時刻
// ・誤差が accMax メートル（既定50m）より大きい位置は使わない。位置が来ない間（トンネルなど）は決めずに待つ
// ・LINE は自動では送らない。文を作って音なしの通知を出すだけ（送るのは本人がタップ）
// ・未送信があるまま、2分以上止まっていたら1回だけ振動で知らせる（運転中は知らせない）

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;

import org.json.JSONArray;
import org.json.JSONObject;

public class TripService extends Service {
    static final String CH_RUN = "trip_run", CH_MSG = "trip_msg";
    static final int NOTI_RUN = 7001;
    static volatile boolean running = false;

    LocationManager lm;
    final Handler h = new Handler(Looper.getMainLooper());
    final LocationListener ll = new LocationListener() {
        @Override public void onLocationChanged(Location l) { onFix(l); }
        @Override public void onStatusChanged(String p, int s, Bundle b) { }
        @Override public void onProviderEnabled(String p) { }
        @Override public void onProviderDisabled(String p) { }
    };
    final Runnable tick = new Runnable() { public void run() { onTick(); h.postDelayed(this, 5000); } };

    // ---- 出庫・終わり（画面から呼ぶ）----
    // 戻り値：true＝今日の記録の続き（昼に車庫へ戻ったあとなど）、false＝新しい1日
    static boolean start(Context c, int car) {
        boolean resume = false;
        synchronized (TripStore.LOCK) { JSONObject t = TripStore.trip(c);
        try {
            if (t.optBoolean("active") && !TripStore.today().equals(t.optString("day"))) {   // 前の日の記録が止まらずに残っていた
                t.put("active", false); t.put("endWhy", "nextday"); TripStore.archive(c, t);
                t = newDay(car); TripStore.saveTrip(c, t);
            } else if (t.optBoolean("active")) resume = true;
            else if (TripStore.today().equals(t.optString("day")) && t.has("startTs")) {
                resume = true; t.put("active", true); t.remove("endTs"); t.remove("endWhy"); t.remove("lastFix"); t.remove("anchor"); t.put("car", car);
                // 昼に車庫へ戻って止まったあと：その車庫の行の続きにする（車庫を出たら、その行の「発」になる。すぐ止まらないように）
                JSONArray vs = t.optJSONArray("visits");
                JSONObject lv = vs != null && vs.length() > 0 ? vs.optJSONObject(vs.length() - 1) : null;
                if (lv != null && "garage".equals(lv.optString("type")) && lv.has("arr") && !lv.has("dep"))
                    t.put("cur", new JSONObject().put("pid", lv.optString("pid")).put("enter", lv.optLong("arr")).put("arrived", true).put("vid", lv.optLong("id")));
                TripStore.saveTrip(c, t);
            } else {
                if (t.has("startTs")) TripStore.archive(c, t);
                t = newDay(car);
                TripStore.saveTrip(c, t);
            }
        } catch (Exception e) { } }
        Intent i = new Intent(c, TripService.class);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
        return resume;
    }

    static JSONObject newDay(int car) throws Exception {
        JSONObject t = new JSONObject();
        t.put("active", true); t.put("car", car); t.put("day", TripStore.today()); t.put("startTs", System.currentTimeMillis());
        t.put("visits", new JSONArray()); t.put("msgs", new JSONArray()); t.put("stops", new JSONArray()); t.put("gaps", new JSONArray()); t.put("counts", new JSONObject());
        t.put("arrivedFirst", false); t.put("seq", 1);
        return t;
    }

    static void stop(Context c, String why) {
        synchronized (TripStore.LOCK) { JSONObject t = TripStore.trip(c);
        try { if (t.optBoolean("active")) { t.put("active", false); t.put("endTs", System.currentTimeMillis()); t.put("endWhy", why); t.remove("cur"); t.remove("cand"); TripStore.saveTrip(c, t); } } catch (Exception e) { } }
        c.stopService(new Intent(c, TripService.class));
    }

    @Override public IBinder onBind(Intent i) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        channels(this);
        Notification n = runNoti();
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(NOTI_RUN, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            else startForeground(NOTI_RUN, n);
        } catch (Exception e) { stopSelf(); return START_NOT_STICKY; }   // 位置の許可が無いなど：記録できないので止める（画面で開き直す）
        JSONObject t = TripStore.trip(this);
        if (!t.optBoolean("active")) { stopSelf(); return START_NOT_STICKY; }
        if (!running) {
            running = true;
            // 止まっていた間（電池切れ・アプリが止められた）を「不明」として残す
            try { JSONObject lf = t.optJSONObject("lastFix"); long now = System.currentTimeMillis();
                if (lf != null && now - lf.optLong("ts") > TripStore.param(this, "gapSec", 300) * 1000) { addGap(t, lf.optLong("ts"), now); TripStore.saveTrip(this, t); } } catch (Exception e) { }
            lm = (LocationManager) getSystemService(LOCATION_SERVICE);
            try { lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 5000, 0f, ll, Looper.getMainLooper()); } catch (Exception e) { }
            try { if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 10000, 0f, ll, Looper.getMainLooper()); } catch (Exception e) { }
            h.postDelayed(tick, 5000);
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        h.removeCallbacks(tick);
        try { if (lm != null) lm.removeUpdates(ll); } catch (Exception e) { }
        super.onDestroy();
    }

    static void channels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(NOTIFICATION_SERVICE);
        NotificationChannel a = new NotificationChannel(CH_RUN, "運行の記録中", NotificationManager.IMPORTANCE_LOW);
        a.setShowBadge(false); nm.createNotificationChannel(a);
        NotificationChannel b = new NotificationChannel(CH_MSG, "LINE の連絡（音なし）", NotificationManager.IMPORTANCE_LOW);
        b.enableVibration(false); b.setSound(null, null); nm.createNotificationChannel(b);
    }

    PendingIntent openApp(int req) {
        Intent i = new Intent(this, MainActivity.class).putExtra("page", "renraku.html").addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(this, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    Notification runNoti() {
        JSONObject t = TripStore.trip(this);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CH_RUN) : new Notification.Builder(this);
        return b.setSmallIcon(R.mipmap.ic_launcher).setContentTitle("運行を記録中（" + t.optInt("car") + "番）")
                .setContentText("車庫に着くと自動で止まります").setOngoing(true).setContentIntent(openApp(1)).build();
    }

    // ---- 位置が来たとき ----
    void onFix(Location l) { synchronized (TripStore.LOCK) { onFix0(l); } }
    void onTick() { synchronized (TripStore.LOCK) { onTick0(); } }

    void onFix0(Location l) {
        if (l == null) return;
        double accMax = TripStore.param(this, "accMax", 50);
        if (l.hasAccuracy() && l.getAccuracy() > accMax) return;   // ずれの大きい位置は使わない
        long now = System.currentTimeMillis();
        JSONObject t = TripStore.trip(this);
        if (!t.optBoolean("active")) { stopSelf(); return; }
        try {
            JSONObject lf = t.optJSONObject("lastFix");
            long prevTs = lf != null ? lf.optLong("ts") : 0;
            if (lf != null && now - lf.optLong("ts") > TripStore.param(this, "gapSec", 300) * 1000)
            { addGap(t, lf.optLong("ts"), now);   // 長く位置が来なかった（トンネルなど）
              JSONObject cd = t.optJSONObject("cand"); if (cd != null) { closeStop(t, cd, now); t.remove("cand"); } }   // その間どこにいたか分からないので、止まった所の数え直し
            t.put("lastFix", new JSONObject().put("lat", l.getLatitude()).put("lon", l.getLongitude()).put("acc", l.hasAccuracy() ? l.getAccuracy() : -1).put("ts", now));
            process(t, l.getLatitude(), l.getLongitude(), now, prevTs);
            TripStore.saveTrip(this, t);
        } catch (Exception e) { }
    }

    // 位置が来なくても、時間がたったことで決まるもの（2分たった・1分たった）を5秒ごとに見る。最後の位置が新しいときだけ
    void onTick0() {
        JSONObject t = TripStore.trip(this);
        if (!t.optBoolean("active")) { stopSelf(); return; }
        JSONObject lf = t.optJSONObject("lastFix");
        long now = System.currentTimeMillis();
        if (lf == null || now - lf.optLong("ts") > TripStore.param(this, "freshSec", 60) * 1000) return;   // 位置が古い：決めずに待つ
        try { process(t, lf.getDouble("lat"), lf.getDouble("lon"), now, 0); TripStore.saveTrip(this, t); } catch (Exception e) { }
    }

    // 位置が分からない時間を足す。同じ所から始まる時間がもうあれば（開き直したときに記録済み）、終わりを延ばすだけにする
    static void addGap(JSONObject t, long from, long to) throws Exception {
        JSONArray g = t.getJSONArray("gaps");
        JSONObject last = g.length() > 0 ? g.optJSONObject(g.length() - 1) : null;
        if (last != null && last.optLong("from") == from) { if (to > last.optLong("to")) last.put("to", to); }
        else g.put(new JSONObject().put("from", from).put("to", to));
    }

    JSONObject placeById(JSONArray ps, String id) {
        for (int i = 0; i < ps.length(); i++) { JSONObject p = ps.optJSONObject(i); if (p != null && id.equals(p.optString("id"))) return p; }
        return null;
    }

    // prevTs：ひとつ前の位置の時刻（5秒ごとの見直しのときは 0）
    void process(JSONObject t, double lat, double lon, long now, long prevTs) throws Exception {
        if (!t.optBoolean("active")) return;
        JSONArray ps = TripStore.places(this);
        double dwell = TripStore.param(this, "dwellSec", 120) * 1000, exit = TripStore.param(this, "exitSec", 60) * 1000, far = TripStore.param(this, "farM", 300);
        double pad = TripStore.param(this, "exitPad", 30);   // 着いたあとは、円より30m外に出るまで「出た」にしない（止まっていても位置が数十m揺れるため）
        boolean wasLost = prevTs > 0 && now - prevTs > TripStore.param(this, "freshSec", 60) * 1000;   // この位置の前に、しばらく位置が来なかった
        // いちばん中心に近い、円の中の場所（隣どうしの円が重なっても1つに決まる）
        JSONObject in = null; double best = 1e18;
        for (int i = 0; i < ps.length(); i++) { JSONObject p = ps.getJSONObject(i); double d = TripStore.dist(lat, lon, p.getDouble("lat"), p.getDouble("lon")); if (d <= p.optDouble("r", 60) && d < best) { best = d; in = p; } }
        JSONObject cur = t.optJSONObject("cur");
        long leftAt = 0;   // いまの場所を出たと決めた時刻（隣の場所へそのまま入ったときは、それが入った時刻）
        if (cur != null) {
            JSONObject p = placeById(ps, cur.optString("pid"));
            if (p == null) { t.remove("cur"); cur = null; }
            else {
                double d = TripStore.dist(lat, lon, p.getDouble("lat"), p.getDouble("lon"));
                double r = p.optDouble("r", 60) + (cur.optBoolean("arrived") && in == null ? pad : 0);
                boolean inside = d <= r && (in == null || in.optString("id").equals(p.optString("id")));
                if (inside) {
                    cur.remove("outSince");
                    if (!cur.optBoolean("arrived") && now - cur.optLong("enter") >= dwell) arrive(t, cur, p, cur.optLong("enter"));
                } else if (!cur.optBoolean("arrived") && wasLost && now - cur.optLong("enter") >= dwell) {
                    // 円に入ったあと建物の中などで位置が来なくなり、次に来た位置はもう外：その間そこにいたとみなして行にする（時刻は要確認の印）
                    arrive(t, cur, p, cur.optLong("enter"));
                    markUnsure(t, cur.optLong("vid"));
                    if (!t.optBoolean("active")) return;
                    leftAt = prevTs; depart(t, cur, p, prevTs); t.remove("cur"); cur = null;
                } else if (!cur.optBoolean("arrived")) { t.remove("cur"); cur = null; }   // 止まらずに通り過ぎた
                else {
                    if (!cur.has("outSince")) { cur.put("outSince", wasLost ? prevTs : now); if (wasLost) markUnsure(t, cur.optLong("vid")); }   // 位置が来ない間に出ていた：最後に中にいた時刻を「発」にする
                    if (d > far || now - cur.optLong("outSince") >= exit) { leftAt = cur.optLong("outSince"); depart(t, cur, p, leftAt); t.remove("cur"); cur = null; }
                }
            }
        }
        if (!t.optBoolean("active")) return;
        if (cur == null && in != null) {
            cur = new JSONObject().put("pid", in.optString("id")).put("enter", leftAt > 0 ? leftAt : now).put("arrived", false);
            t.put("cur", cur);
            // 出庫したとき車庫の中にいた：すぐ「車庫にいる」にする（朝は到着の連絡をしない）
            if ("garage".equals(in.optString("type")) && t.getJSONArray("visits").length() == 0) arrive(t, cur, in, 0);
        }
        // 登録していない場所で止まった（5分以上、半径50m以内）
        double stopR = TripStore.param(this, "stopR", 50), stopSec = TripStore.param(this, "stopSec", 300) * 1000;
        JSONObject cand = t.optJSONObject("cand");
        if (cur != null) { if (cand != null) closeStop(t, cand, now); t.remove("cand"); }
        else if (cand == null || TripStore.dist(lat, lon, cand.getDouble("lat"), cand.getDouble("lon")) > stopR) {
            if (cand != null) closeStop(t, cand, now);
            t.put("cand", new JSONObject().put("lat", lat).put("lon", lon).put("since", now).put("last", now));
        } else {
            cand.put("last", now);
            if (!cand.has("sid") && now - cand.optLong("since") >= stopSec) {
                long sid = t.optLong("seq", 1); t.put("seq", sid + 1);
                t.getJSONArray("stops").put(new JSONObject().put("id", sid).put("lat", cand.getDouble("lat")).put("lon", cand.getDouble("lon")).put("start", cand.optLong("since")).put("status", "new"));
                cand.put("sid", sid);
            }
        }
        // 止まっているか（30m以内に2分）：未送信があれば1回だけ振動
        JSONObject an = t.optJSONObject("anchor");
        if (an == null || TripStore.dist(lat, lon, an.getDouble("lat"), an.getDouble("lon")) > 30) { an = new JSONObject().put("lat", lat).put("lon", lon).put("ts", now); t.put("anchor", an); }
        if (now - an.optLong("ts") >= TripStore.param(this, "stillSec", 120) * 1000) {
            JSONArray ms = t.getJSONArray("msgs"); boolean buzz = false;
            for (int i = 0; i < ms.length(); i++) { JSONObject m = ms.getJSONObject(i); if (m.optBoolean("posted") && !m.optBoolean("sent") && !m.optBoolean("skip") && !m.optBoolean("buzzed") && (cur == null || m.optLong("vid") != cur.optLong("vid"))) { m.put("buzzed", true); buzz = true; } }
            if (buzz) vibrateOnce();
        }
        // 止め忘れ：同じ所に3時間（場所の外）→ 止めて知らせる
        if (cur == null && now - an.optLong("ts") >= TripStore.param(this, "idleSec", 10800) * 1000) { finish(t, "idle"); }
        // 1日が長すぎる（18時間）→ 止める
        if (now - t.optLong("startTs") > 18L * 3600000L) finish(t, "long");
    }

    static void markUnsure(JSONObject t, long vid) throws Exception {
        JSONArray vs = t.getJSONArray("visits");
        for (int i = 0; i < vs.length(); i++) { JSONObject v = vs.getJSONObject(i); if (v.optLong("id") == vid) v.put("unsure", true); }
    }

    void closeStop(JSONObject t, JSONObject cand, long now) throws Exception {
        if (!cand.has("sid")) return;
        JSONArray st = t.getJSONArray("stops");
        for (int i = 0; i < st.length(); i++) { JSONObject s = st.getJSONObject(i); if (s.optLong("id") == cand.optLong("sid") && !s.has("end")) s.put("end", cand.optLong("last", now)); }
    }

    void arrive(JSONObject t, JSONObject cur, JSONObject p, long at) throws Exception {
        cur.put("arrived", true);
        long vid = t.optLong("seq", 1); t.put("seq", vid + 1);
        JSONObject v = new JSONObject().put("id", vid).put("pid", p.optString("id")).put("name", p.optString("name")).put("type", p.optString("type", "site"))
                .put("cargo", new JSONArray()).put("meter", "");
        if (at > 0) v.put("arr", at);
        t.getJSONArray("visits").put(v);
        cur.put("vid", vid);
        String type = p.optString("type", "site");
        if ("site".equals(type)) {
            JSONObject cn = t.getJSONObject("counts"); cn.put(p.optString("id"), cn.optInt(p.optString("id")) + 1);
            String a = p.optString("arrText", "");
            boolean first = !t.optBoolean("arrivedFirst");
            t.put("arrivedFirst", true);
            String hm = new java.text.SimpleDateFormat("H:mm", java.util.Locale.JAPAN).format(new java.util.Date(at));
            if (first && !a.isEmpty()) addMsg(t, "arrive", vid, new String[]{fill(t, p, a)}, p.optString("name") + " " + hm + "着（到着の連絡）", true);
            else postInfo(this, (int) (100 + vid + 50000), p.optString("name") + " " + hm + "着", "荷物の数・メーターは、手が空いたときに入れてください");
            // 完了の連絡は、着いたときに作っておく（場所カードからいつでも送れる）。送らずに出たら通知する
            String[] dt = doneTexts(t, p);
            if (dt.length > 0) addMsg(t, "done", vid, dt, p.optString("name") + "（完了の連絡）", false);
        } else if ("garage".equals(type) && at > 0) {
            // 帰庫：夕方の連絡を作って、記録を止める
            String tk = TripStore.conf(this).optString("tenko", "6:00");
            addMsg(t, "garage", vid, new String[]{"お疲れ様です！車庫着明日、点呼" + tk + "です！"}, "車庫に着きました", true);
            finish(t, "garage");
        }
    }

    String[] doneTexts(JSONObject t, JSONObject p) {
        JSONArray dt = p.optJSONArray("doneTexts");
        java.util.ArrayList<String> L = new java.util.ArrayList<>();
        String plan = plan(TripStore.conf(this));
        if (dt != null) for (int i = 0; i < dt.length(); i++) { String s = dt.optString(i); if (s.isEmpty() || (s.contains("{plan}") && plan.isEmpty())) continue; L.add(fill(t, p, s)); }
        return L.toArray(new String[0]);
    }

    void depart(JSONObject t, JSONObject cur, JSONObject p, long at) throws Exception {
        JSONArray vs = t.getJSONArray("visits");
        for (int i = 0; i < vs.length(); i++) { JSONObject v = vs.getJSONObject(i); if (v.optLong("id") == cur.optLong("vid")) v.put("dep", at); }
        cancelMsg(this, (int) (100 + cur.optLong("vid") + 50000) - 100);
        if (!"site".equals(p.optString("type", "site"))) return;
        // 送らずに出た完了の連絡：文を作り直して（予定が入っていれば「〜に向かいます」も付ける）音なしで通知する
        JSONArray ms = t.getJSONArray("msgs");
        for (int i = 0; i < ms.length(); i++) {
            JSONObject m = ms.getJSONObject(i);
            if (m.optLong("vid") != cur.optLong("vid") || !"done".equals(m.optString("kind")) || m.optBoolean("sent") || m.optBoolean("skip")) continue;
            if (!m.optBoolean("edited")) { String[] dt = doneTexts(t, p); JSONArray tx = new JSONArray(); for (String x : dt) tx.put(x); if (dt.length > 0) m.put("texts", tx); }
            m.put("posted", true); m.put("postTs", at);
            postMsg(this, m.optLong("id"), p.optString("name") + " を出ました（完了の連絡・未送信）", m.getJSONArray("texts").optString(0));
        }
    }

    // 予定（午後の行き先）は、入れた日だけ使う
    static String plan(JSONObject cf) { return TripStore.today().equals(cf.optString("planDay")) ? cf.optString("plan", "") : ""; }

    String fill(JSONObject t, JSONObject p, String s) {
        JSONObject cf = TripStore.conf(this);
        return s.replace("{n}", String.valueOf(t.optJSONObject("counts") != null ? Math.max(1, t.optJSONObject("counts").optInt(p.optString("id"))) : 1))
                .replace("{name}", p.optString("name")).replace("{plan}", plan(cf)).replace("{car}", String.valueOf(t.optInt("car")))
                .replace("{tenko}", cf.optString("tenko", "6:00"));
    }

    void addMsg(JSONObject t, String kind, long vid, String[] texts, String title, boolean post) throws Exception {
        long id = t.optLong("seq", 1); t.put("seq", id + 1);
        JSONArray tx = new JSONArray(); for (String s : texts) tx.put(s);
        t.getJSONArray("msgs").put(new JSONObject().put("id", id).put("kind", kind).put("vid", vid).put("texts", tx).put("ts", System.currentTimeMillis()).put("sent", false).put("posted", post));
        if (post) postMsg(this, id, title, texts[0]);
    }

    // 送るボタンの無い知らせ（「〇〇 9:15着」）。開くと場所カード
    static void postInfo(Context c, int nid, String title, String text) {
        channels(c);
        Intent open = new Intent(c, MainActivity.class).putExtra("page", "renraku.html").addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent po = PendingIntent.getActivity(c, nid, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, CH_MSG) : new Notification.Builder(c);
        b.setSmallIcon(R.mipmap.ic_launcher).setContentTitle(title).setContentText(text).setContentIntent(po).setAutoCancel(true);
        if (Build.VERSION.SDK_INT < 26) b.setPriority(Notification.PRIORITY_LOW);
        ((NotificationManager) c.getSystemService(NOTIFICATION_SERVICE)).notify(nid, b.build());
    }

    static void postMsg(Context c, long id, String title, String text) {
        channels(c);
        Intent send = new Intent(c, SendActivity.class).putExtra("text", text).putExtra("mid", id);
        PendingIntent ps = PendingIntent.getActivity(c, (int) (1000 + id), send, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Intent open = new Intent(c, MainActivity.class).putExtra("page", "renraku.html").addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent po = PendingIntent.getActivity(c, (int) (5000 + id), open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, CH_MSG) : new Notification.Builder(c);
        b.setSmallIcon(R.mipmap.ic_launcher).setContentTitle(title).setContentText(text).setStyle(new Notification.BigTextStyle().bigText(text))
                .setContentIntent(po).setAutoCancel(false).setOnlyAlertOnce(true)
                .addAction(new Notification.Action.Builder(null, "LINEで送る", ps).build())
                .addAction(new Notification.Action.Builder(null, "文を変える・開く", po).build());
        if (Build.VERSION.SDK_INT < 26) b.setPriority(Notification.PRIORITY_LOW);
        ((NotificationManager) c.getSystemService(NOTIFICATION_SERVICE)).notify((int) (100 + id), b.build());
    }

    static void cancelMsg(Context c, long id) { ((NotificationManager) c.getSystemService(NOTIFICATION_SERVICE)).cancel((int) (100 + id)); }

    void vibrateOnce() {
        Vibrator vb = (Vibrator) getSystemService(VIBRATOR_SERVICE);
        if (vb == null) return;
        if (Build.VERSION.SDK_INT >= 26) vb.vibrate(VibrationEffect.createOneShot(600, VibrationEffect.DEFAULT_AMPLITUDE)); else vb.vibrate(600);
    }

    void finish(JSONObject t, String why) throws Exception {
        JSONObject cand = t.optJSONObject("cand"); if (cand != null) closeStop(t, cand, System.currentTimeMillis());
        t.put("active", false); t.put("endTs", System.currentTimeMillis()); t.put("endWhy", why); t.remove("cand");
        if ("idle".equals(why) || "long".equals(why)) postInfo(this, 99, "運行の記録を止めました", "idle".equals(why) ? "3時間動きが無かったので止めました。続けるときは画面で「出庫」を押し直してください。" : "18時間たったので止めました。");
        TripStore.saveTrip(this, t);
        h.post(() -> { try { stopForeground(true); } catch (Exception e) { } stopSelf(); });
    }
}
