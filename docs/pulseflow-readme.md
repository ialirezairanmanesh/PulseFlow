# PulseFlow — فایل‌های پروژه

کد کامل اپ اینجاست:

- پوشه: `docs/pulseflow/`
- زیپ یک‌جا: `docs/pulseflow.zip`

## روی لوکال

1. پوشه `docs/pulseflow` را کپی کن، یا `docs/pulseflow.zip` را از زیپ دربیار
2. داخل پوشه (Node 18+):

```bash
npm install
npm run dev
```

3. باز کن: http://127.0.0.1:3846

## بعد از Connect

صفحهٔ اصلی **Problems** است (مسائل رتبه‌بندی‌شده). نمودارها و استرس در صفحات جدا:

`/problems` · `/widgets` · `/frames` · `/memory` · `/network` · `/tools`

## ویجت‌های پرمصرف

برای دیدن لیست ویجت‌هایی که زیاد rebuild می‌شوند:

1. فایل `docs/pulseflow/examples/pulseflow_extension.dart` را به پروژه Flutter کپی کن
2. در `main()` قبل از `runApp` صدا بزن: `registerPulseFlowExtensions();`
3. Hot-restart کن و در PulseFlow دوباره Connect بزن

بدون این فایل هم نمودار Build/Raster و حافظه کار می‌کند؛ فقط Problems/Widgets توضیح می‌دهد که probe نیست.
