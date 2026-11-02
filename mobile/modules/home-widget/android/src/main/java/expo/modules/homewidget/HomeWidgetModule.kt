package expo.modules.homewidget

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class HomeWidgetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HomeWidget")

    Events("onLaunchAction")

    Function("publish") { title: String, detail: String, counts: String, askLabel: String, work: String, action: String ->
      val context = ctx()
      HomeWidgetStore.write(
        context,
        HomeWidgetViews(
          title = title,
          detail = detail,
          counts = counts,
          askLabel = askLabel,
          work = work,
          action = action,
        ),
      )
      HomeWidgetProvider.refreshAll(context)
    }

    Function("takeLaunchAction") {
      val pending = HomeWidgetLaunch.take()
      if (pending != null) return@Function pending
      val intent = appContext.currentActivity?.intent ?: return@Function null
      val action = intent.getStringExtra(HomeWidgetLaunch.EXTRA_ACTION) ?: return@Function null
      intent.removeExtra(HomeWidgetLaunch.EXTRA_ACTION)
      action
    }

    OnNewIntent { intent ->
      val action = intent.getStringExtra(HomeWidgetLaunch.EXTRA_ACTION) ?: return@OnNewIntent
      intent.removeExtra(HomeWidgetLaunch.EXTRA_ACTION)
      HomeWidgetLaunch.offer(action)
      sendEvent("onLaunchAction", mapOf("action" to action))
    }
  }

  private fun ctx() =
    appContext.reactContext
      ?: throw IllegalStateException("Branch isn’t ready to update the home screen widget yet.")
}
