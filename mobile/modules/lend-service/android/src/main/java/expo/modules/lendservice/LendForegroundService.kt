package expo.modules.lendservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Runs while this phone is lent to Branch Agent, so Android keeps the app (and its connection to the computer)
 * alive in the background and the person always sees that lending is on. Its notification's Stop ends lending.
 */
class LendForegroundService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      LendStop.request(this)
      stopForegroundCompat()
      stopSelf()
      return START_NOT_STICKY
    }
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: return START_NOT_STICKY
    val text = intent.getStringExtra(EXTRA_TEXT) ?: ""
    val stopLabel = intent.getStringExtra(EXTRA_STOP) ?: return START_NOT_STICKY
    val notification = notification(title, text, stopLabel)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    // Not sticky: if Android kills the app, lending does not come back on by itself.
    return START_NOT_STICKY
  }

  private fun stopForegroundCompat() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
  }

  private fun notification(title: String, text: String, stopLabel: String): Notification {
    ensureChannel(this)
    val immutable = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
    val stop = PendingIntent.getService(
      this,
      REQUEST_STOP,
      Intent(this, LendForegroundService::class.java).setAction(ACTION_STOP),
      PendingIntent.FLAG_UPDATE_CURRENT or immutable,
    )
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val open = launch?.let {
      PendingIntent.getActivity(this, REQUEST_OPEN, it, PendingIntent.FLAG_UPDATE_CURRENT or immutable)
    }
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    builder
      .setSmallIcon(R.drawable.branch_lend_notif)
      .setContentTitle(title)
      .setContentText(text)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(Notification.CATEGORY_SERVICE)
      .addAction(Notification.Action.Builder(null, stopLabel, stop).build())
    if (open != null) builder.setContentIntent(open)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
    }
    return builder.build()
  }

  companion object {
    const val ACTION_STOP = "expo.modules.lendservice.STOP"
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
    const val EXTRA_STOP = "stop"
    private const val CHANNEL_ID = "lending"
    private const val NOTIFICATION_ID = 4107
    private const val REQUEST_STOP = 1
    private const val REQUEST_OPEN = 2

    fun ensureChannel(context: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val manager = context.getSystemService(NotificationManager::class.java) ?: return
      if (manager.getNotificationChannel(CHANNEL_ID) != null) return
      val channel = NotificationChannel(
        CHANNEL_ID,
        context.getString(R.string.branch_lend_channel_name),
        NotificationManager.IMPORTANCE_LOW,
      )
      channel.description = context.getString(R.string.branch_lend_channel_description)
      channel.setShowBadge(false)
      manager.createNotificationChannel(channel)
    }
  }
}

/** A Stop tapped on the notification, kept until the app reads it (the app may not be running). */
object LendStop {
  private const val PREFS = "branch_lend_service"
  private const val STOPPED = "stopped"

  @Volatile
  var listener: (() -> Unit)? = null

  fun request(context: Context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(STOPPED, true).apply()
    listener?.invoke()
  }

  fun take(context: Context): Boolean {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val stopped = prefs.getBoolean(STOPPED, false)
    if (stopped) prefs.edit().remove(STOPPED).apply()
    return stopped
  }
}
