import type { Ref } from 'react';

export interface GraphCanvasHandle {
  send: (message: object) => void;
}

export interface GraphCanvasProps {
  ref?: Ref<GraphCanvasHandle>;
  source: { html: string };
  onMessage: (data: string) => void;
  onError: () => void;
}
