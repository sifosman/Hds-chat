// Client-side media helpers: photo compression (saves data on SA networks) and voice
// notes. The web client records WAV for the transcriber; natively we record AAC/m4a,
// which is on the server's accepted-mime list — verify transcription before release.
import { Image } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { AudioModule, RecordingPresets, setAudioModeAsync } from 'expo-audio';
import { VoiceRecorder as BaseVoiceRecorder, type NativeRecorder } from './voicerecorder';
export type { NativeRecorder } from './voicerecorder';

export async function compressImage(uri: string, mime = 'image/jpeg', size = 0, maxDim = 1600, quality = 0.82): Promise<{ uri: string; mime: string }> {
  if (!/^image\/(jpeg|png|webp|heic|heif)/.test(mime) || (size > 0 && size < 250_000)) return { uri, mime };
  try {
    const dims = await new Promise<{ width: number; height: number }>((res, rej) => Image.getSize(uri, (width, height) => res({ width, height }), rej));
    if (Math.max(dims.width, dims.height) <= maxDim && mime === 'image/jpeg') return { uri, mime };
    const actions = Math.max(dims.width, dims.height) > maxDim
      ? [{ resize: dims.width >= dims.height ? { width: maxDim } : { height: maxDim } }]
      : [];
    const out = await ImageManipulator.manipulateAsync(uri, actions, { compress: quality, format: ImageManipulator.SaveFormat.JPEG });
    return { uri: out.uri, mime: 'image/jpeg' };
  } catch {
    return { uri, mime };
  }
}

// Native recorder surface, injectable so the lifecycle is testable off-device.
export class VoiceRecorder extends BaseVoiceRecorder {
  constructor() {
    super({
      requestPermission: () => AudioModule.requestRecordingPermissionsAsync(),
      setMode: mode => setAudioModeAsync(mode),
      createRecorder: () => new AudioModule.AudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true }) as unknown as NativeRecorder,
    });
  }
}

export async function fileSize(uri: string) {
  const info = await FileSystem.getInfoAsync(uri).catch(() => null);
  return info && info.exists && 'size' in info ? info.size || 0 : 0;
}
