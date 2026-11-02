# Keep the digital-assistant entry points. Settings and VoiceInteractionManagerService
# resolve these by class name from the manifest / voice-interaction XML.
-keep class expo.modules.assistant.AssistActivity { <init>(); }
-keep class expo.modules.assistant.BranchVoiceInteractionService { <init>(); }
-keep class expo.modules.assistant.BranchVoiceInteractionSessionService { <init>(); }
-keep class expo.modules.assistant.BranchVoiceInteractionSession { <init>(...); }
-keep class expo.modules.assistant.BranchRecognitionService { <init>(); }
-keep class expo.modules.assistant.AssistLaunch { *; }
