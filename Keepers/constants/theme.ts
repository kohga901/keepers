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
};

export const lightTheme: AppTheme = {
  background: '#F7F2EC',
  surface: '#1a2329',
  text: '#4caf85',
  mutedText: '#9fb0ba',
  border: '#2e3a43',
  primary: '#4caf85',
  tabBg: '#101519',
  tabActive: '#4caf85',
  tabInactive: '#7f909a',
  headerBg: '#f6f8fa',
  headerText: '#4caf85',
};

export const darkTheme: AppTheme = {
  background: '#F7F2EC',
  surface: '#1a2329',
  text: '#4caf85',
  mutedText: '#9fb0ba',
  border: '#2e3a43',
  primary: '#4caf85',
  tabBg: '#101519',
  tabActive: '#4caf85',
  tabInactive: '#7f909a',
  headerBg: '#f6f8fa',
  headerText: '#4caf85',
};
