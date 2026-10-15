/**
 * File: fonts.ts
 * Description: Public Sans font assets and helpers that map fontWeight/fontStyle to the matching loaded font family.
 * Author: Kai Markley
 * Date: 2026-10-06
 */

import {
  PublicSans_100Thin,
  PublicSans_100Thin_Italic,
  PublicSans_200ExtraLight,
  PublicSans_200ExtraLight_Italic,
  PublicSans_300Light,
  PublicSans_300Light_Italic,
  PublicSans_400Regular,
  PublicSans_400Regular_Italic,
  PublicSans_500Medium,
  PublicSans_500Medium_Italic,
  PublicSans_600SemiBold,
  PublicSans_600SemiBold_Italic,
  PublicSans_700Bold,
  PublicSans_700Bold_Italic,
  PublicSans_800ExtraBold,
  PublicSans_800ExtraBold_Italic,
  PublicSans_900Black,
  PublicSans_900Black_Italic,
} from '@expo-google-fonts/public-sans';
import type { TextStyle } from 'react-native';

// Passed to useFonts in the root layout; keys become the fontFamily names.
export const fontAssets = {
  PublicSans_100Thin,
  PublicSans_100Thin_Italic,
  PublicSans_200ExtraLight,
  PublicSans_200ExtraLight_Italic,
  PublicSans_300Light,
  PublicSans_300Light_Italic,
  PublicSans_400Regular,
  PublicSans_400Regular_Italic,
  PublicSans_500Medium,
  PublicSans_500Medium_Italic,
  PublicSans_600SemiBold,
  PublicSans_600SemiBold_Italic,
  PublicSans_700Bold,
  PublicSans_700Bold_Italic,
  PublicSans_800ExtraBold,
  PublicSans_800ExtraBold_Italic,
  PublicSans_900Black,
  PublicSans_900Black_Italic,
};

export const Fonts = {
  thin: 'PublicSans_100Thin',
  extraLight: 'PublicSans_200ExtraLight',
  light: 'PublicSans_300Light',
  regular: 'PublicSans_400Regular',
  medium: 'PublicSans_500Medium',
  semiBold: 'PublicSans_600SemiBold',
  bold: 'PublicSans_700Bold',
  extraBold: 'PublicSans_800ExtraBold',
  black: 'PublicSans_900Black',
} as const;

const WEIGHT_TO_FAMILY: Record<string, string> = {
  '100': Fonts.thin,
  '200': Fonts.extraLight,
  '300': Fonts.light,
  '400': Fonts.regular,
  normal: Fonts.regular,
  '500': Fonts.medium,
  '600': Fonts.semiBold,
  '700': Fonts.bold,
  bold: Fonts.bold,
  '800': Fonts.extraBold,
  '900': Fonts.black,
};

// Custom fonts ship one file per weight, so the weight has to be picked via the family name.
export function resolveFontFamily(fontWeight?: TextStyle['fontWeight'], fontStyle?: TextStyle['fontStyle']) {
  const family = WEIGHT_TO_FAMILY[String(fontWeight ?? '400')] ?? Fonts.regular;
  return fontStyle === 'italic' ? `${family}_Italic` : family;
}
