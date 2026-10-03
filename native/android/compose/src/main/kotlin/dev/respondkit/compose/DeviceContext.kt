package dev.respondkit.compose

import android.content.Context
import android.os.Build
import dev.respondkit.core.DeviceContext

/** Collects diagnostic model/version only; no serial, advertising ID, or Android ID. */
fun androidDeviceContext(context: Context): DeviceContext = DeviceContext(
    platform = "android",
    model = "${Build.MANUFACTURER} ${Build.MODEL}".trim().take(128),
    osVersion = Build.VERSION.RELEASE.take(64),
    appVersion = context.packageManager.getPackageInfo(context.packageName, 0).versionName?.take(64),
)
