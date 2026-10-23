# verifier/2023 — live assist proof on release APK versionCode 55

Source run: https://github.com/KeepOak/Branch-Agent/actions/runs/39869870719 (attempt 2, job Android APK reinstall)
Release APK: `branch-android-0.4.4-build-85612a8f5516.apk` (includes #2023 BIND_RECOGNITION_SERVICE)

## Result
- **Picker:** PASS — `assist-picker.png` / `assist-picker.xml` show **Branch Agent** listed under Default digital assistant app (with None and Google).
- **Role holder:** NOT verified — `assist-role.log` shows `cmd role get-role-holders` → `Unknown command: get-role-holders` on API 31 `google_apis` image; job failed before `add-role-holder`. `dumpsys role` still shows `android.app.role.ASSISTANT` held by Google.

## Files
- assist-picker.png / assist-picker.xml
- assist-settings.png / assist-settings.xml
- assist-role.log
- am-start.log
- run-39869870719-assist-excerpt.txt
