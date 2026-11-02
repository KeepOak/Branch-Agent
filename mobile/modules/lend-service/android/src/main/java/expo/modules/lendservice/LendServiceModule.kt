package expo.modules.lendservice

import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class LendServiceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LendService")

    Events("onStopLending")

    OnCreate {
      LendStop.listener = { sendEvent("onStopLending", emptyMap<String, Any>()) }
    }

    OnDestroy {
      LendStop.listener = null
    }

    Function("start") { title: String, text: String, stopLabel: String ->
      val context = ctx()
      val intent = Intent(context, LendForegroundService::class.java)
        .putExtra(LendForegroundService.EXTRA_TITLE, title)
        .putExtra(LendForegroundService.EXTRA_TEXT, text)
        .putExtra(LendForegroundService.EXTRA_STOP, stopLabel)
      // Android refuses a new foreground service from the background; the app tries again when it is opened.
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
        true
      } catch (error: IllegalStateException) {
        false
      } catch (error: SecurityException) {
        false
      }
    }

    Function("stop") {
      val context = ctx()
      context.stopService(Intent(context, LendForegroundService::class.java))
    }

    Function("takeStopRequest") {
      LendStop.take(ctx())
    }
  }

  private fun ctx() =
    appContext.reactContext
      ?: throw IllegalStateException("Branch Agent isn’t ready to show that this phone is lent yet.")
}
