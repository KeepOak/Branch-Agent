package expo.modules.homewidget

import android.content.Context
import android.view.View
import android.widget.RemoteViews

data class HomeWidgetViews(
  val title: String,
  val detail: String,
  val counts: String,
  val askLabel: String,
  val work: String,
  val action: String,
)

object HomeWidgetLaunch {
  const val EXTRA_ACTION = "expo.modules.homewidget.ACTION"
  const val ACTION_ASK = "ask"
  const val ACTION_OPEN = "open"
  const val ACTION_APPROVALS = "approvals"

  @Volatile
  private var pending: String? = null

  fun offer(action: String) {
    pending = action
  }

  fun take(): String? {
    val action = pending
    pending = null
    return action
  }
}

object HomeWidgetStore {
  private const val PREFS = "branch_home_widget"
  private const val TITLE = "title"
  private const val DETAIL = "detail"
  private const val COUNTS = "counts"
  private const val ASK = "ask"
  private const val WORK = "work"
  private const val ACTION = "action"

  fun write(context: Context, views: HomeWidgetViews) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putString(TITLE, views.title)
      .putString(DETAIL, views.detail)
      .putString(COUNTS, views.counts)
      .putString(ASK, views.askLabel)
      .putString(WORK, views.work)
      .putString(ACTION, views.action)
      .apply()
  }

  fun read(context: Context): HomeWidgetViews {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    return HomeWidgetViews(
      title = prefs.getString(TITLE, null) ?: context.getString(R.string.branch_home_widget_title_default),
      detail = prefs.getString(DETAIL, null) ?: context.getString(R.string.branch_home_widget_detail_default),
      counts = prefs.getString(COUNTS, "") ?: "",
      askLabel = prefs.getString(ASK, null) ?: context.getString(R.string.branch_home_widget_ask),
      work = prefs.getString(WORK, "") ?: "",
      action = prefs.getString(ACTION, HomeWidgetLaunch.ACTION_OPEN) ?: HomeWidgetLaunch.ACTION_OPEN,
    )
  }

  fun remoteViews(context: Context, views: HomeWidgetViews = read(context)): RemoteViews {
    val remote = RemoteViews(context.packageName, R.layout.branch_home_widget)
    remote.setTextViewText(R.id.title, views.title)
    remote.setTextViewText(R.id.detail, views.detail)
    remote.setTextViewText(R.id.counts, views.counts)
    remote.setTextViewText(R.id.ask, views.askLabel)
    remote.setTextViewText(R.id.work, views.work)
    remote.setViewVisibility(R.id.work, if (views.work.isBlank()) View.GONE else View.VISIBLE)
    remote.setViewVisibility(R.id.counts, if (views.counts.isBlank()) View.GONE else View.VISIBLE)
    remote.setContentDescription(R.id.root, contentDescription(views))
    return remote
  }

  private fun contentDescription(views: HomeWidgetViews): String {
    return listOf(views.title, views.detail, views.work, views.counts, views.askLabel)
      .filter { it.isNotBlank() }
      .joinToString(". ")
  }
}
