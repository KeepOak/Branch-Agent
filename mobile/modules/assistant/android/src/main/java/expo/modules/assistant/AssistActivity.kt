package expo.modules.assistant

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/** The assist gesture (long-press home, corner swipe) opens Branch Agent on a new chat. Nothing is shown here. */
class AssistActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    AssistLaunch.offer()
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    if (launch != null) {
      launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
      startActivity(launch)
    }
    finish()
  }
}

/** One assist launch, kept until the app reads it (the app may still be starting). */
object AssistLaunch {
  @Volatile
  private var pending = false

  @Volatile
  var listener: (() -> Unit)? = null

  fun offer() {
    pending = true
    listener?.invoke()
  }

  fun take(): Boolean {
    val was = pending
    pending = false
    return was
  }
}
