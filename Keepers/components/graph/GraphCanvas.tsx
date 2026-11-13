import React, { useImperativeHandle, useRef } from 'react';
import { WebView as RNWebView } from 'react-native-webview';
import type { GraphCanvasProps } from './GraphCanvas.types';

// WebView 14's default extra-props generic collapses its props to never.
const WebView = RNWebView<object>;

export default function GraphCanvas({ ref, source, onMessage, onError }: GraphCanvasProps) {
  const web = useRef<RNWebView<object>>(null);
  useImperativeHandle(ref, () => ({
    send(message) {
      web.current?.injectJavaScript(`window.keepersMap && window.keepersMap(${JSON.stringify(message).replace(/</g, '\\u003c')}); true;`);
    },
  }), []);

  return <WebView ref={web} source={source} originWhitelist={['*']} javaScriptEnabled
    style={{ flex: 1, backgroundColor: 'transparent' }}
    onMessage={(event) => onMessage(event.nativeEvent.data)} scrollEnabled={false} bounces={false}
    accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    onShouldStartLoadWithRequest={(request) => request.url === 'about:blank' || request.url.startsWith('about:srcdoc')}
    onError={onError} onContentProcessDidTerminate={onError} onRenderProcessGone={onError} />;
}
