package expo.modules.assistant

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AssistantModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("Assistant")

    Events("onAssist")

    OnCreate {
      AssistLaunch.listener = { sendEvent("onAssist", emptyMap<String, Any>()) }
    }

    OnDestroy {
      AssistLaunch.listener = null
    }

    Function("takeAssist") {
      AssistLaunch.take()
    }
  }
}
