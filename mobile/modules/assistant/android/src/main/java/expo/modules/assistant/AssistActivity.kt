package expo.modules.assistant

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle

/** The assist gesture (long-press home, corner swipe) opens Branch Agent on a new chat. Nothing is shown here. */
class AssistActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    AssistLaunch.offer()
    AssistLaunch.appIntent(this)?.let { startActivity(it) }
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

  /** The app's own launch intent, brought to the front; the JS side then opens a new chat. */
  fun appIntent(context: Context): Intent? =
    context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
    }

  fun take(): Boolean {
    val was = pending
    pending = false
    return was
  }
}
