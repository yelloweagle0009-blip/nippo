#!/bin/bash
# 国際電話ブロックを、エミュレーター（パソコンの中の Android）で試す
#  海外の番号（+1 844…）から電話がかかってきたことにして、すぐ切れるか／国内の番号（090…）は切らずに鳴り続けるか
set -x
P=jp.nippo.kyohi
mkdir -p out
adb install -r kokusai-block.apk || exit 1
for x in READ_PHONE_STATE READ_CALL_LOG ANSWER_PHONE_CALLS READ_CONTACTS POST_NOTIFICATIONS; do adb shell pm grant $P android.permission.$x; done
adb shell am start -W -n $P/jp.nippo.unkou.KyohiActivity
sleep 4
adb exec-out screencap -p > out/kyohi1.png
state(){ adb shell dumpsys telephony.registry | grep -m1 -oE 'mCallState=[0-9]'; }
# 1) 海外の番号：鳴り始めてすぐ切れるはず（6秒後には「鳴っていない」= 0）
adb emu gsm call +18445550000
sleep 6
S1=$(state)
adb emu gsm cancel +18445550000
sleep 3
# 2) 国内の番号：切らないので、6秒後も「鳴っている」= 1
adb emu gsm call 09012345678
sleep 6
S2=$(state)
adb emu gsm cancel 09012345678
sleep 3
# 3) 試しの番号：画面の入力欄に 09012345678 を入れると、国内の番号でもすぐ切れるはず（= 0）
adb shell am start -W -n $P/jp.nippo.unkou.KyohiActivity
sleep 3
# 入力欄は画面の下のほうにあるので、下へ送ってから画面の部品の一覧を取り、入力欄の位置を探す
adb shell wm size
WH=$(adb shell wm size | grep -oE '[0-9]+x[0-9]+' | tail -1); W=${WH%x*}; H=${WH#*x}
for i in 1 2 3; do adb shell input swipe $((W/2)) $((H*8/10)) $((W/2)) $((H*2/10)) 300; sleep 1; done
adb shell uiautomator dump /sdcard/ui.xml
adb shell cat /sdcard/ui.xml > out/kyohi-ui.xml
B=$(grep -oE '<node[^>]*android.widget.EditText[^>]*>' out/kyohi-ui.xml | grep -oE 'bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | head -1)
if [ -z "$B" ]; then echo "入力欄が見つからない"; fi
# 原因を調べるため、画面に出ている部品（アプリ名・部品の種類・文字）を記録に出す
grep -oE 'package="[^"]*"' out/kyohi-ui.xml | sort | uniq -c
grep -oE 'class="[^"]*"' out/kyohi-ui.xml | sort | uniq -c
grep -oE 'text="[^"]{1,40}' out/kyohi-ui.xml | head -40
adb shell dumpsys window | grep -m3 -E 'mCurrentFocus|mFocusedApp'
adb shell dumpsys package $P | grep -E 'permission\.(READ_PHONE_STATE|READ_CALL_LOG|ANSWER_PHONE_CALLS|READ_CONTACTS|POST_NOTIFICATIONS): granted' 
X=$(echo "$B" | sed -E 's/\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]/\1 \3/' | awk '{print int(($1+$2)/2)}')
Y=$(echo "$B" | sed -E 's/\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]/\2 \4/' | awk '{print int(($1+$2)/2)}')
adb shell input tap $X $Y
sleep 1
adb shell input text 09012345678
sleep 1
adb shell input keyevent KEYCODE_BACK
sleep 1
adb emu gsm call 09012345678
sleep 6
S3=$(state)
adb emu gsm cancel 09012345678
sleep 3
adb shell am start -W -n $P/jp.nippo.unkou.KyohiActivity
sleep 3
adb exec-out screencap -p > out/kyohi2.png
# 4) 拒否の記録：アプリを閉じて開き直し、④に海外の番号と試しの番号が残っているか
adb shell am force-stop $P
adb shell am start -W -n $P/jp.nippo.unkou.KyohiActivity
sleep 3
for i in 1 2 3 4; do adb shell input swipe $((W/2)) $((H*8/10)) $((W/2)) $((H*2/10)) 300; sleep 1; done
adb shell uiautomator dump /sdcard/ui2.xml
adb shell cat /sdcard/ui2.xml > out/kyohi-ui2.xml
grep -oE 'text="[^"]*(国際電話|試しの番号)[^"]*"' out/kyohi-ui2.xml | head -5
LOG=no; if grep -q '18445550000' out/kyohi-ui2.xml && grep -q '試しの番号' out/kyohi-ui2.xml; then LOG=yes; fi
adb shell content query --uri content://call_log/calls --projection number:type > out/kyohi-calllog.txt 2>&1
echo "海外の番号: $S1 ／ 国内の番号: $S2 ／ 試しの番号: $S3（入力欄 $B）／ 記録: $LOG" | tee out/kyohi.txt
if [ "$S1" = "mCallState=0" ] && [ "$S2" = "mCallState=1" ] && [ "$S3" = "mCallState=0" ] && [ "$LOG" = "yes" ]; then echo PASS-KYOHI | tee -a out/kyohi.txt; exit 0; fi
echo FAIL | tee -a out/kyohi.txt
adb logcat -d | grep -i -E "kyohi|AndroidRuntime|Telecom" | tail -80 | tee -a out/kyohi.txt
exit 9
