package expo.modules.apkinstaller

import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest

class ApkInstallerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ApkInstaller")

    Function("canInstallPackages") {
      val context = ctx()
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.packageManager.canRequestPackageInstalls()
      } else {
        true
      }
    }

    Function("openInstallPermissionSettings") {
      val context = ctx()
      val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
        data = Uri.parse("package:${context.packageName}")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      context.startActivity(intent)
    }

    AsyncFunction("sha256File") { path: String ->
      sha256File(File(path))
    }

    AsyncFunction("installedSigningCerts") {
      val context = ctx()
      val info = packageInfo(context.packageManager, context.packageName)
        ?: throw IllegalStateException("Branch couldn’t read this phone’s signing certificate.")
      val hex = currentSignerHex(info)
        ?: throw IllegalStateException("Branch couldn’t read this phone’s signing certificate.")
      listOf(hex)
    }

    AsyncFunction("apkSigningCerts") { path: String ->
      val parsed = ApkSigningBlockCerts.read(File(path))
      if (parsed.isUnreadable) {
        throw IllegalStateException("Branch couldn’t read the update’s signing certificate.")
      }
      if (parsed.isOk) {
        val hex = parsed.hex
          ?: throw IllegalStateException("Branch couldn’t read the update’s signing certificate.")
        return@AsyncFunction listOf(hex)
      }
      if (!parsed.isAbsent) {
        throw IllegalStateException("Branch couldn’t read the update’s signing certificate.")
      }
      val context = ctx()
      val info = v1ArchiveInfo(context.packageManager, path)
        ?: throw IllegalStateException("Branch couldn’t read the update’s signing certificate.")
      val hex = currentSignerHex(info)
        ?: throw IllegalStateException("Branch couldn’t read the update’s signing certificate.")
      listOf(hex)
    }

    AsyncFunction("installApk") { path: String ->
      val context = ctx()
      val file = File(path)
      if (!file.isFile) {
        throw IllegalStateException("The update file is missing.")
      }
      val uri = FileProvider.getUriForFile(context, "${context.packageName}.apkinstaller", file)
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, "application/vnd.android.package-archive")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      val matches = context.packageManager.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)
      if (matches.isEmpty()) {
        throw IllegalStateException("This phone has no installer for Android packages.")
      }
      for (resolve in matches) {
        context.grantUriPermission(
          resolve.activityInfo.packageName,
          uri,
          Intent.FLAG_GRANT_READ_URI_PERMISSION,
        )
      }
      context.startActivity(intent)
    }
  }

  private fun ctx() =
    appContext.reactContext
      ?: throw IllegalStateException("Branch isn’t ready to install yet.")

  private fun sha256File(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    FileInputStream(file).use { input ->
      val buf = ByteArray(64 * 1024)
      while (true) {
        val n = input.read(buf)
        if (n <= 0) break
        digest.update(buf, 0, n)
      }
    }
    return hex(digest.digest())
  }

  private fun hex(bytes: ByteArray): String =
    bytes.joinToString("") { byte -> "%02x".format(byte) }

  private fun currentSignerHex(info: PackageInfo): String? {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      val certs = info.signingInfo?.apkContentsSigners ?: return null
      if (certs.size != 1) return null
      return ApkSigningBlockCerts.sha256Hex(certs[0].toByteArray())
    }
    @Suppress("DEPRECATION")
    val certs = info.signatures ?: return null
    if (certs.size != 1) return null
    return ApkSigningBlockCerts.sha256Hex(certs[0].toByteArray())
  }

  private fun signingFlags(): Int =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      PackageManager.GET_SIGNING_CERTIFICATES
    } else {
      @Suppress("DEPRECATION")
      PackageManager.GET_SIGNATURES
    }

  private fun packageInfo(pm: PackageManager, packageName: String): PackageInfo? {
    val flags = signingFlags()
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      pm.getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(flags.toLong()))
    } else {
      @Suppress("DEPRECATION")
      pm.getPackageInfo(packageName, flags)
    }
  }

  @Suppress("DEPRECATION")
  private fun v1ArchiveInfo(pm: PackageManager, path: String): PackageInfo? {
    val flags = PackageManager.GET_SIGNATURES
    val info =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        pm.getPackageArchiveInfo(path, PackageManager.PackageInfoFlags.of(flags.toLong()))
      } else {
        pm.getPackageArchiveInfo(path, flags)
      }
    info?.applicationInfo?.apply {
      sourceDir = path
      publicSourceDir = path
    }
    return info
  }
}
