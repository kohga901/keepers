/**
 * File: index.tsx
 * Description: This is the main entry point for the tab navigator in the Keepers app.
 *  It redirects to the Swiper.
 * Author: Kai Markley
 * Date: 2026-04-01
 */

import { Redirect } from 'expo-router';

export default function Index() {
  return <Redirect href="/swiper" />;
}