package jp.nippo.unkou;

// 国際電話ブロック：どの番号を拒否するかの決まり（画面や電話の仕組みを使わない部分だけ。パソコンでも試せるようにする）
//  ・国際電話：「+」のあとが日本（81）以外、または「010」で始まる番号
//  ・非通知（番号が空）：設定でオンにしたときだけ
//  ・連絡先に入っている番号は拒否しない（海外の知り合いなど）。連絡先かどうかは呼び出し側で調べて渡す
public final class KyohiRule {
    private KyohiRule() {}

    // 番号から空白・ハイフン・かっこを取る（「+1 (844) 555-0000」→「+18445550000」）
    public static String clean(String n) {
        if (n == null) return "";
        StringBuilder b = new StringBuilder();
        for (char c : n.toCharArray()) if (Character.isDigit(c) || c == '+') b.append(c);
        return b.toString();
    }

    public static boolean isInternational(String n) {
        String s = clean(n);
        if (s.startsWith("+")) return !s.startsWith("+81");
        return s.startsWith("010");
    }

    // 国内の形にそろえる（「+81 90-1234-5678」→「09012345678」）。試しの番号と比べるため
    public static String domestic(String n) {
        String s = clean(n);
        return s.startsWith("+81") ? "0" + s.substring(3) : s;
    }

    // 拒否するか。理由（画面と通知に出す）を返し、拒否しないときは null
    //  testNum：試しに切る番号（国際電話がなかなか来ないので、家族や会社の番号で動きを確かめる用）。空なら使わない。連絡先に入っていても切る
    public static String reason(String number, boolean blockHidden, boolean inContacts) { return reason(number, blockHidden, inContacts, null); }
    public static String reason(String number, boolean blockHidden, boolean inContacts, String testNum) {
        String s = clean(number);
        if (s.isEmpty()) return blockHidden ? "非通知" : null;
        String t = domestic(testNum);
        if (t.length() >= 6 && t.equals(domestic(s))) return "試しの番号";
        if (inContacts) return null;
        if (isInternational(s)) return "国際電話";
        return null;
    }
}
