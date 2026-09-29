/**
 *File: theme.ts
 *Description: Defines the AppTheme type and exports light and dark theme objects for use in the app.
 *Author: Kai Markley
  *Date: 2026-04-18 
*/

export type AppTheme = {
  background: string;
  surface: string;
  text: string;
  mutedText: string;
  border: string;
  primary: string;
  tabBg: string;
  tabActive: string;
  tabInactive: string;
  headerBg: string;
  headerText: string;
  accentGold: string;
  accentBrown: string;
};

// Palette: sage #6D9773, dark green #0C3B2E, brown #B46617, gold #FFBA00, white.
export const lightTheme: AppTheme = {
  background: '#F4F7F5',
  surface: '#FFFFFF',
  text: '#0C3B2E',
  mutedText: '#6D9773',
  border: '#D9E2DC',
  primary: '#6D9773',
  tabBg: '#FFFFFF',
  tabActive: '#0C3B2E',
  tabInactive: '#7E9787',
  headerBg: '#0C3B2E',
  headerText: '#FFFFFF',
  accentGold: '#FFBA00',
  accentBrown: '#B46617',
};

export const darkTheme: AppTheme = {
  background: '#F4F7F5',
  surface: '#FFFFFF',
  text: '#0C3B2E',
  mutedText: '#6D9773',
  border: '#D9E2DC',
  primary: '#6D9773',
  tabBg: '#FFFFFF',
  tabActive: '#0C3B2E',
  tabInactive: '#7E9787',
  headerBg: '#0C3B2E',
  headerText: '#FFFFFF',
  accentGold: '#FFBA00',
  accentBrown: '#B46617',
};
