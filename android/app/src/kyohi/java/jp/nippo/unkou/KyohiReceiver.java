package jp.nippo.unkou;

// 国際電話ブロック：電話が鳴り始めたら番号を見て、国際電話なら切る（拒否する）
//  ・「迷惑電話アプリ」の役（あんしんセキュリティが使っている）は取らない。電話が鳴り始めた知らせ（PHONE_STATE）を受け取り、
//    「電話を切る」許可（ANSWER_PHONE_CALLS）で鳴っている電話を拒否する。なので、あんしんセキュリティの警告もそのまま動く
//  ・番号を知るには「通話履歴を読む」許可（READ_CALL_LOG）が要る（Android の決まり）
//  ・拒否した番号と時刻はスマホの中に残し、通知で知らせる（外へは送らない。インターネットの許可も持たない）

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.ContactsContract;
import android.telecom.TelecomManager;
import android.telephony.TelephonyManager;

public class KyohiReceiver extends BroadcastReceiver {
    static final String PREF = "kyohi";

    @Override
    public void onReceive(Context c, Intent in) {
        if (!TelephonyManager.ACTION_PHONE_STATE_CHANGED.equals(in.getAction())) return;
        if (!TelephonyManager.EXTRA_STATE_RINGING.equals(in.getStringExtra(TelephonyManager.EXTRA_STATE))) return;
        SharedPreferences p = c.getSharedPreferences(PREF, Context.MODE_PRIVATE);
        if (!p.getBoolean("on", true)) return;
        // 鳴り始めの知らせは2回来ることがある（番号なし→番号あり）。番号の入っていない1回目は、非通知の判定にだけ使う
        if (!in.hasExtra(TelephonyManager.EXTRA_INCOMING_NUMBER)) return;
        String num = in.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER);
        // 同じ電話で2回知らせが来ることがあるので、同じ番号を5秒以内に2回は扱わない
        long now = System.currentTimeMillis(); String key = KyohiRule.clean(num);
        if (key.equals(p.getString("lastNum", null)) && now - p.getLong("lastAt", 0) < 5000) return;
        p.edit().putString("lastNum", key).putLong("lastAt", now).apply();
        String why = KyohiRule.reason(num, p.getBoolean("hidden", false), inContacts(c, num));
        if (why == null) return;
        boolean ok = false;
        try {
            TelecomManager tm = (TelecomManager) c.getSystemService(Context.TELECOM_SERVICE);
            if (tm != null && c.checkSelfPermission(Manifest.permission.ANSWER_PHONE_CALLS) == PackageManager.PERMISSION_GRANTED) ok = tm.endCall();
        } catch (Exception e) { ok = false; }
        log(c, p, num, why, ok);
    }

    // 連絡先に入っている番号か（入っていれば拒否しない）。連絡先を読む許可が無ければ「入っていない」とみなす
    static boolean inContacts(Context c, String num) {
        String s = KyohiRule.clean(num);
        if (s.isEmpty() || c.checkSelfPermission(Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) return false;
        try (Cursor cur = c.getContentResolver().query(Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(s)),
                new String[]{ContactsContract.PhoneLookup._ID}, null, null, null)) {
            return cur != null && cur.moveToFirst();
        } catch (Exception e) { return false; }
    }

    // 拒否の記録（新しい順に最大100件）と通知
    static void log(Context c, SharedPreferences p, String num, String why, boolean ok) {
        String line = System.currentTimeMillis() + "\t" + (num == null ? "" : num) + "\t" + why + "\t" + (ok ? "1" : "0");
        String old = p.getString("log", "");
        String[] rows = old.isEmpty() ? new String[0] : old.split("\n");
        StringBuilder b = new StringBuilder(line);
        for (int i = 0; i < rows.length && i < 99; i++) b.append('\n').append(rows[i]);
        p.edit().putString("log", b.toString()).apply();
        try {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(new NotificationChannel("kyohi", "拒否した電話", NotificationManager.IMPORTANCE_LOW));
            Notification.Builder nb = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, "kyohi") : new Notification.Builder(c);
            nb.setSmallIcon(android.R.drawable.sym_call_missed)
              .setContentTitle(ok ? why + "を拒否しました" : why + "でしたが、拒否できませんでした")
              .setContentText(num == null || num.isEmpty() ? "番号なし" : num)
              .setAutoCancel(true);
            nm.notify((int) (System.currentTimeMillis() % 100000), nb.build());
        } catch (Exception e) { }
    }
}
