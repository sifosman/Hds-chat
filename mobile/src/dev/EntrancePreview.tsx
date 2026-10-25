import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { Login } from '../screens/Login';
import { Invite } from '../screens/Invite';
import { Chat } from '../screens/Chat';
import { SignedInTabs } from '../components/SignedInTabs';
import { CHAT_FIXTURE } from './chatfixture';
import { entranceTheme, PREVIEW_STATES, type PreviewState } from '../lib/entrance';

// Development-only visual harness (hds-chat://dev-preview?state=NAME). Every
// screen gets a fixture prop: Login's preview prop disables start/verify and
// external links, Invite's demo prop skips peek/redeem, and callbacks are
// inert — nothing here can reach the backend or create a session.
const FIXTURE_STATES = PREVIEW_STATES.filter(s => s !== 'off');
type State = Exclude<PreviewState, 'off'>;

export function EntrancePreview({ state, jostLoaded }: { state: string; jostLoaded: boolean }) {
  const t = entranceTheme(false);
  const [st, setSt] = useState<State>((FIXTURE_STATES as readonly string[]).includes(state) ? state as State : 'phone');
  useEffect(() => { if ((FIXTURE_STATES as readonly string[]).includes(state)) setSt(state as State); }, [state]);
  const noop = () => {};
  const body = (() => {
    switch (st) {
      case 'otp': return <Login onDone={noop} jostLoaded={jostLoaded} preview={{ step: 'code', phone: '82 123 4567', channel: 'whatsapp' }} />;
      case 'no_channel': return <Login onDone={noop} jostLoaded={jostLoaded} preview={{ noChannel: true, err: "We couldn't reach this number. Check it or message us — we'll sign you in.", phone: '82 123 4567' }} />;
      case 'error': return <Login onDone={noop} jostLoaded={jostLoaded} preview={{ err: 'Too many attempts. Try again in a few minutes.', phone: '82 123 4567' }} />;
      case 'invite': return <Invite token="preview" onDone={noop} onFallback={noop} jostLoaded={jostLoaded} demo={{ info: { name: 'Sipho', phone: '+27 82 555 0134' } }} />;
      case 'invite_long': return <Invite token="preview" onDone={noop} onFallback={noop} jostLoaded={jostLoaded} demo={{ info: { name: 'Christopher Alexander van der Merwe-Smith', phone: '+27 82 555 0134' } }} />;
      case 'invite_invalid': return <Invite token="preview" onDone={noop} onFallback={noop} jostLoaded={jostLoaded} demo={{ err: 'This link has expired or was already used.' }} />;
      case 'invite_loading': return <Invite token="preview" onDone={noop} onFallback={noop} jostLoaded={jostLoaded} demo={{ loading: true }} />;
      case 'chat': return (
        <NavigationContainer>
          <SignedInTabs
            chat={<Chat preview={{ messages: CHAT_FIXTURE }} onAskTab={noop} />}
            quotes={<PreviewStub label="Quotes" />}
            account={<PreviewStub label="Account" />}
          />
        </NavigationContainer>
      );
      default: return <Login onDone={noop} jostLoaded={jostLoaded} preview={{}} />;
    }
  })();
  if (st === 'chat') return <View style={{ flex: 1, backgroundColor: t.bg }} key={st}>{body}</View>;
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }} key={st}>
      {body}
      <View style={s.bar}>
        <Text style={s.barTitle}>DEV preview</Text>
        <View style={s.row}>
          {FIXTURE_STATES.map(x => (
            <Pressable key={x} onPress={() => setSt(x)} style={[s.chip, x === st && s.chipOn]}>
              <Text style={[s.chipText, x === st && s.chipOnText]}>{x}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

function PreviewStub({ label }: { label: string }) {
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Text>{label} (preview stub)</Text></View>;
}

const s = StyleSheet.create({
  bar: { backgroundColor: 'rgba(0,0,0,0.85)', padding: 8 },
  barTitle: { color: '#ffd27f', fontSize: 10, textAlign: 'center', marginBottom: 4 },
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 4 },
  chip: { borderRadius: 10, backgroundColor: '#333', paddingHorizontal: 7, paddingVertical: 3 },
  chipOn: { backgroundColor: '#e3242b' },
  chipText: { color: '#ccc', fontSize: 10 },
  chipOnText: { color: '#fff' },
});
