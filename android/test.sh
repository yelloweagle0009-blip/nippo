#!/bin/bash
# エミュレーター（パソコンの中の Android）で、アプリを入れて開き、写真の読み取りまで試す
set -x
adb install -r unkou-nippo.apk || exit 1
adb shell am start -W -n jp.nippo.unkou/.MainActivity
sleep 30
adb exec-out screencap -p > out/shot1.png
PID=$(adb shell pidof jp.nippo.unkou | tr -d '\r')
adb forward tcp:9222 localabstract:webview_devtools_remote_$PID
node android/test.js > out/test.txt 2>&1; RC=$?
cat out/test.txt
if [ $RC -eq 0 ]; then
  # 電波を切って（機内モード）、もう一度開いて使えるか
  adb shell cmd connectivity airplane-mode enable
  adb shell svc wifi disable
  adb shell svc data disable
  sleep 8
  node android/test.js offline > out/test-offline.txt 2>&1; RC=$?
  cat out/test-offline.txt
  adb shell cmd connectivity airplane-mode disable
  adb shell svc wifi enable
  adb shell svc data enable
fi
adb exec-out screencap -p > out/shot2.png
adb logcat -d -t 400 > out/logcat.txt
exit $RC
