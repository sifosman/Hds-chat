import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

export type NativePushStatus = 'granted' | 'denied' | 'default' | 'unavailable';

const PROJECT_ID: string = Constants.expoConfig?.extra?.eas?.projectId || '';

/** Set by the Chat screen's focus effect — bot replies already render live there. */
let chatVisible = false;
export function setChatVisible(v: boolean) { chatVisible = v; }

/** Foreground alerts are suppressed while the chat is on screen; taps route via the response listener. */
export function initNotifications() {
  Notifications.setNotificationHandler({
    handleNotification: async () => {
      const show = !chatVisible;
      return {
        shouldShowBanner: show,
        shouldShowList: show,
        shouldPlaySound: show,
        shouldSetBadge: false,
      };
    },
  });
  if (Platform.OS === 'android') {
    void Notifications.setNotificationChannelAsync('messages', {
      name: 'Messages',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      enableVibrate: true,
      vibrationPattern: [0, 250, 250, 250],
    }).catch(() => {});
  }
}

export async function pushPermissionStatus(): Promise<NativePushStatus> {
  if (!Device.isDevice) return 'unavailable';
  try {
    const perms = await Notifications.getPermissionsAsync();
    if (perms.status === 'granted') return 'granted';
    return perms.canAskAgain === false ? 'denied' : 'default';
  } catch { return 'unavailable'; }
}

/** Explicit registration (user tapped enable, or granted permission needs a token refresh). */
export async function registerPush(): Promise<{ status: NativePushStatus; token?: string }> {
  if (!Device.isDevice) return { status: 'unavailable' };
  try {
    let perms = await Notifications.getPermissionsAsync();
    if (perms.status !== 'granted') perms = await Notifications.requestPermissionsAsync();
    if (perms.status !== 'granted') return { status: perms.canAskAgain === false ? 'denied' : 'default' };
    const token = (await Notifications.getExpoPushTokenAsync({ projectId: PROJECT_ID })).data;
    return { status: 'granted', token };
  } catch { return { status: 'unavailable' }; }
}
