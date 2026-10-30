import { NativeModule, requireNativeModule } from 'expo';

export type AssistantModuleEvents = {
  onAssist: () => void;
};

declare class AssistantModule extends NativeModule<AssistantModuleEvents> {
  takeAssist(): boolean;
}

export default requireNativeModule<AssistantModule>('Assistant');
