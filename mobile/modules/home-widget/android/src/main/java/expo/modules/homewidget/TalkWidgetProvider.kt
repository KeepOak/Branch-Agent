package expo.modules.homewidget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.widget.RemoteViews

/** The small Talk to Branch widget: one tap opens Talk in the most recent chat. It has nothing to refresh. */
class TalkWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    val talk = HomeWidgetProvider.clickIntent(context, HomeWidgetLaunch.ACTION_TALK, REQUEST_TALK)
    for (id in appWidgetIds) {
      val views = RemoteViews(context.packageName, R.layout.branch_talk_widget)
      views.setOnClickPendingIntent(R.id.talk_root, talk)
      appWidgetManager.updateAppWidget(id, views)
    }
  }

  companion object {
    private const val REQUEST_TALK = 4
  }
}
