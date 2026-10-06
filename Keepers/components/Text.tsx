/**
 * File: Text.tsx
 * Description: Drop-in replacements for React Native's Text and TextInput that render in Public Sans,
 *              picking the font file that matches the style's fontWeight/fontStyle.
 * Author: Kai Markley
 * Date: 2026-10-06
 */

import { createContext, forwardRef, useContext } from 'react';
import {
  StyleSheet,
  Text as RNText,
  TextInput as RNTextInput,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from 'react-native';

import { resolveFontFamily } from '../constants/fonts';

// Nested <Text> inherits its parent's font unless it sets its own weight/style.
const InsideText = createContext(false);

function withPublicSans(style: StyleProp<TextStyle>, inherit: boolean): StyleProp<TextStyle> {
  const flat = StyleSheet.flatten(style) ?? {};
  if (flat.fontFamily) return style;
  if (inherit && !flat.fontWeight && !flat.fontStyle) return style;

  // Drop weight/style so the platform doesn't synthesize bold/italic on top of the real font file.
  const { fontWeight, fontStyle, ...rest } = flat;
  return { ...rest, fontFamily: resolveFontFamily(fontWeight, fontStyle) };
}

export const Text = forwardRef<RNText, TextProps>(function Text({ style, ...props }, ref) {
  const insideText = useContext(InsideText);
  return (
    <InsideText.Provider value>
      <RNText ref={ref} {...props} style={withPublicSans(style, insideText)} />
    </InsideText.Provider>
  );
});

export const TextInput = forwardRef<RNTextInput, TextInputProps>(function TextInput({ style, ...props }, ref) {
  return <RNTextInput ref={ref} {...props} style={withPublicSans(style, false)} />;
});
