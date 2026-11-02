package expo.modules.assistant

import android.content.Intent
import android.os.Bundle
import android.service.voice.VoiceInteractionService
import android.service.voice.VoiceInteractionSession
import android.service.voice.VoiceInteractionSessionService
import android.speech.RecognitionService
import android.speech.SpeechRecognizer

/**
 * Some Android builds only list apps with a VoiceInteractionService under Default apps › Digital assistant app.
 * This service does nothing on its own; each assist session opens Branch Agent on a new chat, like AssistActivity.
 */
class BranchVoiceInteractionService : VoiceInteractionService()

class BranchVoiceInteractionSessionService : VoiceInteractionSessionService() {
  override fun onNewSession(args: Bundle?): VoiceInteractionSession = BranchVoiceInteractionSession(this)
}

class BranchVoiceInteractionSession(service: VoiceInteractionSessionService) : VoiceInteractionSession(service) {
  override fun onShow(args: Bundle?, showFlags: Int) {
    super.onShow(args, showFlags)
    AssistLaunch.offer()
    AssistLaunch.appIntent(context)?.let { startAssistantActivity(it) }
    finish()
  }
}

/** Android requires a recognition service next to a voice interaction service. Branch has no system recognizer, so it declines. */
class BranchRecognitionService : RecognitionService() {
  override fun onStartListening(recognizerIntent: Intent?, listener: Callback?) {
    listener?.error(SpeechRecognizer.ERROR_RECOGNIZER_BUSY)
  }

  override fun onCancel(listener: Callback?) {}

  override fun onStopListening(listener: Callback?) {}
}
