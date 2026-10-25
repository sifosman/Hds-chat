export interface ChatActions<MsgT = unknown> {
  send(p: { type: string; body?: string }): Promise<unknown>;
  retry(m: MsgT): void;
  discard(m: MsgT): void;
  quote(ref: string): void;
  external(url: string): void;
}

export interface ChatSeam<MsgT = unknown> extends ChatActions<MsgT> {
  disabledActions: boolean;
  showNotify: boolean;
}

export function seamActions<MsgT>(inert: boolean, real: ChatActions<MsgT>, toast: (m: string) => void): ChatSeam<MsgT> {
  if (!inert) return { ...real, disabledActions: false, showNotify: true };
  const note = () => toast('Preview only — nothing is sent.');
  return {
    send: () => { note(); return Promise.resolve(); },
    retry: note,
    discard: note,
    quote: note,
    external: note,
    disabledActions: true,
    showNotify: false,
  };
}
