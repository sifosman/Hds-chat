import { useColorScheme } from 'react-native';

export interface Theme {
  dark: boolean;
  red: string; redD: string; blue: string; green: string;
  bg: string; panel: string; ink: string; muted: string; line: string;
  mine: string; theirs: string; tick: string; tickRead: string;
  accentSoft: string; chipBorder: string; dayBg: string; dayInk: string; appStartBg: string; appStartInk: string;
}

export const light: Theme = {
  dark: false,
  red: '#e3242b', redD: '#b81c22', blue: '#1b4f9c', green: '#6aa84f',
  bg: '#efeae2', panel: '#ffffff', ink: '#111b21', muted: '#667781', line: '#e2e2e2',
  mine: '#f8d8d9', theirs: '#ffffff', tick: '#8696a0', tickRead: '#34b7f1',
  accentSoft: 'rgba(227,36,43,.13)', chipBorder: '#f2b8ba',
  dayBg: '#ffffff', dayInk: '#667781', appStartBg: '#fff4d6', appStartInk: '#6b5200',
};

export const dark: Theme = {
  ...light,
  dark: true,
  bg: '#0b141a', panel: '#111b21', ink: '#e9edef', muted: '#8696a0', line: '#2a3942',
  mine: '#59262a', theirs: '#202c33',
  accentSoft: 'rgba(227,36,43,.22)', chipBorder: '#5a3a3c',
  dayBg: '#111b21', dayInk: '#8696a0', appStartBg: '#3a2f10', appStartInk: '#e8c96a',
};

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
