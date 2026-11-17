import React, { useImperativeHandle, useLayoutEffect, useRef } from 'react';
import type { GraphCanvasProps } from './GraphCanvas.types';

export default function GraphCanvas({ ref, source, onMessage, onError }: GraphCanvasProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  function send(message: object) {
    // The sandbox has an opaque origin; restrict incoming events by their source window.
    frame.current?.contentWindow?.postMessage({ type: 'keepers-map-command', message }, '*');
  }
  useImperativeHandle(ref, () => ({ send }), []);
  useLayoutEffect(() => {
    function receive(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow || event.data?.type !== 'keepers-map-event') return;
      if (typeof event.data.data === 'string') onMessage(event.data.data);
    }
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [onMessage]);

  return <iframe ref={frame} title="Interactive clothing style map" srcDoc={source.html}
    sandbox="allow-scripts" onLoad={() => send({ type: 'connect' })} onError={onError}
    style={{ display: 'block', width: '100%', height: '100%', flex: 1, border: 0, backgroundColor: 'transparent' }} />;
}
