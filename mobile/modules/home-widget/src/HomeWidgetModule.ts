import { NativeModule, requireNativeModule } from 'expo';

export type HomeWidgetModuleEvents = {
  onLaunchAction: (event: { action: string }) => void;
};

declare class HomeWidgetModule extends NativeModule<HomeWidgetModuleEvents> {
  publish(title: string, detail: string, counts: string, askLabel: string, work: string, action: string): void;
  takeLaunchAction(): string | null;
}

export default requireNativeModule<HomeWidgetModule>('HomeWidget');
