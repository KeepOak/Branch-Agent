/**
 * Inventory of working phone screens and features. The r50 rebuild must keep every
 * entry: the guard test fails if a listed file or marker is removed.
 */
export type FeatureKind = 'screen' | 'feature';

export type FeatureEntry = {
  id: string;
  kind: FeatureKind;
  title: string;
  /** Path relative to mobile/. */
  file: string;
  /** Must still appear in that file. */
  marker: string;
};

export const MOBILE_FEATURE_MAP: FeatureEntry[] = [
  { id: 'welcome-screen', kind: 'screen', title: 'Welcome', file: 'src/screens/WelcomeScreen.tsx', marker: 'export function WelcomeScreen' },
  { id: 'scan-screen', kind: 'screen', title: 'Scan pairing code', file: 'src/screens/ScanScreen.tsx', marker: 'export function ScanScreen' },
  { id: 'enter-code-screen', kind: 'screen', title: 'Enter pairing code', file: 'src/screens/EnterCodeScreen.tsx', marker: 'export function EnterCodeScreen' },
  { id: 'pairing-approval-screen', kind: 'screen', title: 'Waiting for computer approval', file: 'src/screens/ApprovalScreen.tsx', marker: 'export function ApprovalScreen' },
  { id: 'pairing-refused-screen', kind: 'screen', title: 'Pairing refused', file: 'src/screens/RefusedScreen.tsx', marker: 'export function RefusedScreen' },
  { id: 'paired-screen', kind: 'screen', title: 'Your computer', file: 'src/screens/PairedScreen.tsx', marker: 'export function PairedScreen' },
  { id: 'chats-screen', kind: 'screen', title: 'Chats', file: 'src/screens/ChatsScreen.tsx', marker: 'export function ChatsScreen' },
  { id: 'chat-screen', kind: 'screen', title: 'Chat', file: 'src/screens/ChatScreen.tsx', marker: 'export function ChatScreen' },
  { id: 'approvals-screen', kind: 'screen', title: 'Approvals', file: 'src/screens/ApprovalsScreen.tsx', marker: 'export function ApprovalsScreen' },
  { id: 'agents-screen', kind: 'screen', title: 'Agents', file: 'src/screens/AgentsScreen.tsx', marker: 'export function AgentsScreen' },
  { id: 'computers-screen', kind: 'screen', title: 'Computers', file: 'src/screens/ComputersScreen.tsx', marker: 'export function ComputersScreen' },
  { id: 'settings-screen', kind: 'screen', title: 'Settings', file: 'src/screens/SettingsScreen.tsx', marker: 'export function SettingsScreen' },

  { id: 'welcome-wired', kind: 'feature', title: 'Welcome is routed', file: 'App.tsx', marker: "from './src/screens/WelcomeScreen'" },
  { id: 'scan-wired', kind: 'feature', title: 'Scan is routed', file: 'App.tsx', marker: "from './src/screens/ScanScreen'" },
  { id: 'enter-code-wired', kind: 'feature', title: 'Enter code is routed', file: 'App.tsx', marker: "from './src/screens/EnterCodeScreen'" },
  { id: 'pairing-approval-wired', kind: 'feature', title: 'Pairing wait is routed', file: 'App.tsx', marker: "from './src/screens/ApprovalScreen'" },
  { id: 'pairing-refused-wired', kind: 'feature', title: 'Refused pairing is routed', file: 'App.tsx', marker: "from './src/screens/RefusedScreen'" },
  { id: 'paired-wired', kind: 'feature', title: 'Your computer is routed', file: 'App.tsx', marker: "from './src/screens/PairedScreen'" },
  { id: 'chats-wired', kind: 'feature', title: 'Chats is routed', file: 'App.tsx', marker: "from './src/screens/ChatsScreen'" },
  { id: 'chat-wired', kind: 'feature', title: 'Chat is routed', file: 'App.tsx', marker: "from './src/screens/ChatScreen'" },
  { id: 'approvals-wired', kind: 'feature', title: 'Approvals is routed', file: 'App.tsx', marker: "from './src/screens/ApprovalsScreen'" },
  { id: 'agents-wired', kind: 'feature', title: 'Agents is routed', file: 'App.tsx', marker: "from './src/screens/AgentsScreen'" },
  { id: 'computers-wired', kind: 'feature', title: 'Computers is routed', file: 'App.tsx', marker: "from './src/screens/ComputersScreen'" },
  { id: 'settings-wired', kind: 'feature', title: 'Settings is routed', file: 'App.tsx', marker: "from './src/screens/SettingsScreen'" },

  { id: 'pair-button', kind: 'feature', title: 'Pair with your computer', file: 'src/screens/WelcomeScreen.tsx', marker: 'testID="pair-button"' },
  { id: 'scan-camera', kind: 'feature', title: 'QR camera scan', file: 'src/screens/ScanScreen.tsx', marker: 'testID="scan-screen"' },
  { id: 'enter-code-input', kind: 'feature', title: 'Paste pairing code', file: 'src/screens/EnterCodeScreen.tsx', marker: 'testID="code-input"' },
  { id: 'unpair', kind: 'feature', title: 'Unpair this phone', file: 'src/screens/PairedScreen.tsx', marker: 'testID="unpair"' },
  { id: 'pair-again', kind: 'feature', title: 'Pair again after refuse', file: 'src/screens/RefusedScreen.tsx', marker: 'testID="pair-again"' },

  { id: 'chats-search', kind: 'feature', title: 'Search chats and messages', file: 'src/screens/ChatsScreen.tsx', marker: 'testID="chat-search"' },
  { id: 'chats-filters', kind: 'feature', title: 'Chat filter chips', file: 'src/screens/ChatsScreen.tsx', marker: 'testID="chat-filters"' },
  { id: 'chats-approvals-button', kind: 'feature', title: 'Approvals from Chats', file: 'src/screens/ChatsScreen.tsx', marker: 'testID="approvals-button"' },
  { id: 'chats-settings-button', kind: 'feature', title: 'Settings from Chats', file: 'src/screens/ChatsScreen.tsx', marker: 'testID="settings-button"' },
  { id: 'chats-agents-button', kind: 'feature', title: 'Agents from Chats', file: 'src/screens/ChatsScreen.tsx', marker: 'testID="agents-button"' },
  { id: 'chats-computers-button', kind: 'feature', title: 'Computers from Chats', file: 'src/screens/ChatsScreen.tsx', marker: 'testID="computer-button"' },
  { id: 'chats-needs-you', kind: 'feature', title: 'Needs your yes banner', file: 'src/screens/ChatsScreen.tsx', marker: 'testID="needs-you-banner"' },
  { id: 'chats-new', kind: 'feature', title: 'New chat', file: 'src/screens/ChatsScreen.tsx', marker: 'testID="chats-new"' },
  { id: 'chats-pinned', kind: 'feature', title: 'Pinned Trunks', file: 'src/screens/ChatsScreen.tsx', marker: 'testID="pinned-trunks"' },
  { id: 'chats-filter-sheet', kind: 'feature', title: 'Filter and sort', file: 'src/screens/ChatsScreen.tsx', marker: 'testID="chats-filter"' },
  { id: 'chats-offline', kind: 'feature', title: 'Chats offline banner', file: 'src/screens/ChatsScreen.tsx', marker: 'testID="chats-offline"' },

  { id: 'chat-messages', kind: 'feature', title: 'Live chat transcript', file: 'src/screens/ChatScreen.tsx', marker: 'testID="chat-messages"' },
  { id: 'chat-send', kind: 'feature', title: 'Send a message', file: 'src/screens/ChatScreen.tsx', marker: 'testID="send"' },
  { id: 'chat-stop', kind: 'feature', title: 'Stop a live reply', file: 'src/screens/ChatScreen.tsx', marker: 'testID="stop-reply"' },
  { id: 'chat-attach', kind: 'feature', title: 'Attach a photo or file', file: 'src/screens/ChatScreen.tsx', marker: 'testID="attach"' },
  { id: 'chat-work-line', kind: 'feature', title: 'Folded work line', file: 'src/screens/ChatScreen.tsx', marker: 'export function workedFor' },
  { id: 'chat-composer', kind: 'feature', title: 'Composer', file: 'src/screens/ChatScreen.tsx', marker: 'testID="composer"' },

  { id: 'approvals-allow', kind: 'feature', title: 'Allow an approval', file: 'src/screens/ApprovalsScreen.tsx', marker: 'testID={`allow-${approval.id}`}' },
  { id: 'approvals-deny', kind: 'feature', title: 'Deny an approval', file: 'src/screens/ApprovalsScreen.tsx', marker: 'testID={`deny-${approval.id}`}' },
  { id: 'approvals-always', kind: 'feature', title: 'Always allow', file: 'src/screens/ApprovalsScreen.tsx', marker: 'Always allow' },
  { id: 'approvals-look', kind: 'feature', title: 'Look at the chat first', file: 'src/screens/ApprovalsScreen.tsx', marker: 'Look at the chat first' },
  { id: 'approvals-notifications', kind: 'feature', title: 'Notification permission on Approvals', file: 'src/screens/ApprovalsScreen.tsx', marker: 'testID="notifications-card"' },
  { id: 'approvals-test', kind: 'feature', title: 'Send a test approval', file: 'src/screens/ApprovalsScreen.tsx', marker: 'testID="test-approval-card"' },

  { id: 'agents-list', kind: 'feature', title: 'Agents list', file: 'src/screens/AgentsScreen.tsx', marker: 'testID="agents-screen"' },
  { id: 'computers-list', kind: 'feature', title: 'Computers list', file: 'src/screens/ComputersScreen.tsx', marker: 'testID="computers-screen"' },
  { id: 'this-phone', kind: 'feature', title: 'This phone from Computers', file: 'src/screens/ComputersScreen.tsx', marker: 'testID="this-phone"' },

  { id: 'settings-appearance', kind: 'feature', title: 'Appearance (system, light, dark)', file: 'src/screens/SettingsScreen.tsx', marker: 'testID="theme-picker"' },
  { id: 'settings-notifications', kind: 'feature', title: 'Notification settings', file: 'src/screens/SettingsScreen.tsx', marker: 'testID="settings-notifications"' },
  { id: 'settings-about', kind: 'feature', title: 'About this app', file: 'src/screens/SettingsScreen.tsx', marker: 'testID="about-card"' },

  { id: 'offline-banner', kind: 'feature', title: 'Offline reconnect banner', file: 'src/ui/OfflineBanner.tsx', marker: 'export function OfflineBanner' },
  { id: 'update-banner', kind: 'feature', title: 'APK update banner', file: 'src/updates/UpdateBanner.tsx', marker: 'export function UpdateBanner' },
  { id: 'settings-update-card', kind: 'feature', title: 'Settings update card', file: 'src/updates/UpdateBanner.tsx', marker: 'export function SettingsUpdateCard' },
  { id: 'experience-level', kind: 'feature', title: 'Regular / Advanced / Technical level', file: 'src/settings/level.ts', marker: 'export function laterUpdate' },
];

export function missingFeatures(
  entries: readonly FeatureEntry[],
  readFile: (file: string) => string | null,
): string[] {
  const missing: string[] = [];
  for (const entry of entries) {
    const source = readFile(entry.file);
    if (source === null) {
      missing.push(`${entry.id}: removed file ${entry.file} (${entry.title})`);
      continue;
    }
    if (!source.includes(entry.marker)) {
      missing.push(`${entry.id}: removed marker in ${entry.file} (${entry.title})`);
    }
  }
  return missing;
}
