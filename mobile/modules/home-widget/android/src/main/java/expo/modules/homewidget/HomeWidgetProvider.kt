package expo.modules.homewidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build

class HomeWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    val snapshot = HomeWidgetStore.read(context)
    val body = clickIntent(context, snapshot.action, REQUEST_BODY)
    val ask = clickIntent(context, HomeWidgetLaunch.ACTION_ASK, REQUEST_ASK)
    for (id in appWidgetIds) {
      val views = HomeWidgetStore.remoteViews(context, snapshot)
      views.setOnClickPendingIntent(R.id.root, body)
      views.setOnClickPendingIntent(R.id.ask, ask)
      appWidgetManager.updateAppWidget(id, views)
    }
  }

  companion object {
    private const val REQUEST_BODY = 1
    private const val REQUEST_ASK = 2

    fun refreshAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, HomeWidgetProvider::class.java))
      if (ids.isEmpty()) return
      val provider = HomeWidgetProvider()
      provider.onUpdate(context, manager, ids)
    }

    fun clickIntent(context: Context, action: String, requestCode: Int): PendingIntent {
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
        ?: Intent(Intent.ACTION_MAIN).setPackage(context.packageName).addCategory(Intent.CATEGORY_LAUNCHER)
      launch.putExtra(HomeWidgetLaunch.EXTRA_ACTION, action)
      launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
      return PendingIntent.getActivity(context, requestCode, launch, flags)
    }
  }
}
