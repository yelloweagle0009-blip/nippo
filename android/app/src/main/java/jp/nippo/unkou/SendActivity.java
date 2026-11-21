package jp.nippo.unkou;

// 通知の「LINEで送る」から開く：文を入れた LINE の「送る先を選ぶ」画面を出す（送信は本人が押す）。
// アプリから LINE の中は見られないので、LINE を開いた時点で「送信済み」にする（違っていたら画面で「未送信に戻す」）。

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.URLEncoder;

public class SendActivity extends Activity {
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        String text = getIntent().getStringExtra("text");
        long mid = getIntent().getLongExtra("mid", -1);
        if (text != null && !text.isEmpty()) openLine(this, text, mid);
        finish();
    }

    // LINE の共有の URL（https://line.me/R/share?text=…）。LINE が無いときは、普通の「送る先を選ぶ」を出す
    static boolean openLine(Context c, String text, long mid) {
        boolean ok = false;
        try {
            String q = URLEncoder.encode(text, "UTF-8").replace("+", "%20");
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse("https://line.me/R/share?text=" + q));
            i.setPackage("jp.naver.line.android");
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            c.startActivity(i);
            ok = true;
        } catch (Exception e) {
            try {
                Intent s = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text);
                Intent ch = Intent.createChooser(s, "送る先を選ぶ"); ch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                c.startActivity(ch);
                ok = true;
            } catch (Exception e2) { Toast.makeText(c, "LINE を開けませんでした", Toast.LENGTH_LONG).show(); }
        }
        if (ok && mid >= 0) mark(c, mid, true, text);
        return ok;
    }

    static void mark(Context c, long mid, boolean sent, String text) {
        synchronized (TripStore.LOCK) {
            JSONObject t = TripStore.trip(c);
            JSONArray ms = t.optJSONArray("msgs");
            if (ms == null) return;
            try {
                for (int i = 0; i < ms.length(); i++) {
                    JSONObject m = ms.getJSONObject(i);
                    if (m.optLong("id") != mid) continue;
                    m.put("sent", sent);
                    if (sent) { m.put("sentTs", System.currentTimeMillis()); if (text != null) m.put("sentText", text); }
                    else { m.remove("sentTs"); m.remove("sentText"); }
                }
                TripStore.saveTrip(c, t);
            } catch (Exception e) { }
        }
        if (sent) TripService.cancelMsg(c, mid);
    }
}
