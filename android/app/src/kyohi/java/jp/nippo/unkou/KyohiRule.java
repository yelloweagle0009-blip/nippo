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

    // 拒否するか。理由（画面と通知に出す）を返し、拒否しないときは null
    public static String reason(String number, boolean blockHidden, boolean inContacts) {
        String s = clean(number);
        if (s.isEmpty()) return blockHidden ? "非通知" : null;
        if (inContacts) return null;
        if (isInternational(s)) return "国際電話";
        return null;
    }
}
