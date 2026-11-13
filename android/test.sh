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
adb logcat -d -t 400 > out/logcat.txt
exit $RC
