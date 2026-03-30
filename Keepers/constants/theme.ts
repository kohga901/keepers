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
  background: '#f4f7fb',
  surface: '#ffffff',
  text: '#0f1720',
  mutedText: '#5b6770',
  border: '#d7e0e8',
  primary: '#4caf85',
  tabBg: '#ffffff',
  tabActive: '#4caf85',
  tabInactive: '#7a8791',
  headerBg: '#ffffff',
  headerText: '#0f1720',
};

export const darkTheme: AppTheme = {
  background: '#101519',
  surface: '#1a2329',
  text: '#f6f8fa',
  mutedText: '#9fb0ba',
  border: '#2e3a43',
  primary: '#4caf85',
  tabBg: '#101519',
  tabActive: '#4caf85',
  tabInactive: '#7f909a',
  headerBg: '#101519',
  headerText: '#f6f8fa',
};
