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
adb shell am start -W -n $P/jp.nippo.unkou.KyohiActivity
sleep 3
adb exec-out screencap -p > out/kyohi2.png
WH=$(adb shell wm size | grep -oE '[0-9]+x[0-9]+' | tail -1); W=${WH%x*}; H=${WH#*x}
# 3) 拒否の記録：アプリを閉じて開き直し、③に海外の番号が残っているか（国内の番号は残らない）
adb shell am force-stop $P
adb shell am start -W -n $P/jp.nippo.unkou.KyohiActivity
sleep 3
for i in 1 2 3 4; do adb shell input swipe $((W/2)) $((H*8/10)) $((W/2)) $((H*2/10)) 300; sleep 1; done
adb shell uiautomator dump /sdcard/ui2.xml
adb shell cat /sdcard/ui2.xml > out/kyohi-ui2.xml
grep -oE 'text="[^"]*国際電話[^"]*"' out/kyohi-ui2.xml | head -5
LOG=no; if grep -q '18445550000' out/kyohi-ui2.xml && ! grep -q '09012345678' out/kyohi-ui2.xml; then LOG=yes; fi
adb shell content query --uri content://call_log/calls --projection number:type > out/kyohi-calllog.txt 2>&1
echo "海外の番号: $S1 ／ 国内の番号: $S2 ／ 記録: $LOG" | tee out/kyohi.txt
if [ "$S1" = "mCallState=0" ] && [ "$S2" = "mCallState=1" ] && [ "$LOG" = "yes" ]; then echo PASS-KYOHI | tee -a out/kyohi.txt; exit 0; fi
echo FAIL | tee -a out/kyohi.txt
adb logcat -d | grep -i -E "kyohi|AndroidRuntime|Telecom" | tail -80 | tee -a out/kyohi.txt
exit 9
