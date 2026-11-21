#!/bin/bash
# エミュレーター（パソコンの中の Android）で、アプリを入れて開き、写真の読み取りまで試す
set -x
adb install -r unkou-nippo.apk || exit 1
adb shell pm grant jp.nippo.unkou android.permission.CAMERA   # 待機アラームの試験のため、カメラの許可を先に出しておく
adb shell am start -W -n jp.nippo.unkou/.MainActivity
sleep 30
adb exec-out screencap -p > out/shot1.png
PID=$(adb shell pidof jp.nippo.unkou | tr -d '\r')
if [ -z "$PID" ]; then
  # アプリが落ちていたら、理由（例外）を書き出してから、もう一度開く
  echo "アプリが動いていない。落ちた理由："
  adb logcat -d -t 2000 | grep -A 30 -E "FATAL EXCEPTION|AndroidRuntime" | head -80
  adb shell am start -W -n jp.nippo.unkou/.MainActivity
  sleep 30
  PID=$(adb shell pidof jp.nippo.unkou | tr -d '\r')
  echo "開き直したあと PID=$PID"
  [ -z "$PID" ] && { adb logcat -d -t 2000 | grep -A 30 -E "FATAL EXCEPTION|AndroidRuntime" | tail -80; exit 9; }
fi
adb forward tcp:9222 localabstract:webview_devtools_remote_$PID
node android/test.js > out/test.txt 2>&1; RC=$?
cat out/test.txt
grep -q '^PASS' out/test.txt || RC=9
if [ $RC -eq 0 ]; then
  # 電波を切って（機内モード）、もう一度開いて使えるか
  adb shell cmd connectivity airplane-mode enable
  adb shell svc wifi disable
  adb shell svc data disable
  sleep 8
  node android/test.js offline > out/test-offline.txt 2>&1; RC=$?
  cat out/test-offline.txt
  grep -q '^PASS' out/test-offline.txt || RC=9
  adb shell cmd connectivity airplane-mode disable
  adb shell svc wifi enable
  adb shell svc data enable
fi
adb exec-out screencap -p > out/shot2.png
# ---- 運行連絡：作った道順の位置（GPS）を流して、着いた・出た・LINE の文・自動で止まるを確かめる ----
adb shell pm grant jp.nippo.unkou android.permission.ACCESS_FINE_LOCATION
adb shell pm grant jp.nippo.unkou android.permission.ACCESS_COARSE_LOCATION
adb shell pm grant jp.nippo.unkou android.permission.POST_NOTIFICATIONS
adb shell am start -W -n jp.nippo.unkou/.MainActivity
sleep 5
node android/test-trip.js > out/test-trip.txt 2>&1; PRC=$?
cat out/test-trip.txt
grep -q '^PASS' out/test-trip.txt || PRC=9
[ $RC -eq 0 ] && RC=$PRC
adb wait-for-device
adb exec-out screencap -p > out/shot-trip.png
# ---- 待機アラームだけのアプリ（jp.nippo.taiki） ----
adb install -r taiki-alarm.apk || exit 1
adb shell pm grant jp.nippo.taiki android.permission.CAMERA
# 待機アラームのアプリは位置の許可を持たない（運行連絡は入れていない）
if adb shell dumpsys package jp.nippo.taiki | grep -q "permission.ACCESS_FINE_LOCATION"; then echo "FAIL: 待機アラームに位置の許可が入っている"; RC=13; else echo "OK   待機アラームに位置の許可は無い"; fi
adb shell am start -W -n jp.nippo.taiki/jp.nippo.unkou.MainActivity
sleep 25
TPID=$(adb shell pidof jp.nippo.taiki | tr -d '\r')
if [ -z "$TPID" ]; then
  echo "待機アラームのアプリが動いていない。落ちた理由："
  adb logcat -d -t 2000 | grep -A 30 -E "FATAL EXCEPTION|AndroidRuntime" | head -80
  RC=11
else
  adb forward tcp:9223 localabstract:webview_devtools_remote_$TPID
  node android/test-taiki.js > out/test-taiki.txt 2>&1; TRC=$?
  cat out/test-taiki.txt
  grep -q '^PASS' out/test-taiki.txt || TRC=9
  if [ $TRC -eq 0 ]; then
    adb shell cmd connectivity airplane-mode enable
    adb shell svc wifi disable
    adb shell svc data disable
    sleep 8
    node android/test-taiki.js offline > out/test-taiki-offline.txt 2>&1; TRC=$?
    cat out/test-taiki-offline.txt
    grep -q '^PASS' out/test-taiki-offline.txt || TRC=9
    adb shell cmd connectivity airplane-mode disable
    adb shell svc wifi enable
    adb shell svc data enable
  fi
  adb exec-out screencap -p > out/shot-taiki.png
  [ $RC -eq 0 ] && RC=$TRC
  # 電波が無い所で初めて開いたとき：日本語で知らせ、電波が戻ったら自動で開けるか
  if [ $RC -eq 0 ]; then
    adb shell pm clear jp.nippo.taiki
    adb shell cmd connectivity airplane-mode enable
    adb shell svc wifi disable
    adb shell svc data disable
    sleep 5
    adb shell am start -W -n jp.nippo.taiki/jp.nippo.unkou.MainActivity
    sleep 12
    adb exec-out screencap -p > out/shot-taiki-nonet.png
    TPID=$(adb shell pidof jp.nippo.taiki | tr -d '\r')
    adb forward tcp:9223 localabstract:webview_devtools_remote_$TPID
    node android/test-taiki.js nonet > out/test-taiki-nonet.txt 2>&1
    cat out/test-taiki-nonet.txt
    grep -q '^PASS' out/test-taiki-nonet.txt || RC=12
    adb shell cmd connectivity airplane-mode disable
    adb shell svc wifi enable
    adb shell svc data enable
    TPID=$(adb shell pidof jp.nippo.taiki | tr -d '\r')
    adb forward tcp:9223 localabstract:webview_devtools_remote_$TPID
    node android/test-taiki.js recover > out/test-taiki-recover.txt 2>&1; TRC=$?
    cat out/test-taiki-recover.txt
    grep -q '^PASS' out/test-taiki-recover.txt || TRC=9
    [ $RC -eq 0 ] && RC=$TRC
  fi
fi
adb logcat -d -t 400 > out/logcat.txt
exit $RC
