import { NativeModule, requireNativeModule } from 'expo';

export type LendServiceModuleEvents = {
  onStopLending: () => void;
};

declare class LendServiceModule extends NativeModule<LendServiceModuleEvents> {
  start(title: string, text: string, stopLabel: string): boolean;
  stop(): void;
  takeStopRequest(): boolean;
}

export default requireNativeModule<LendServiceModule>('LendService');
