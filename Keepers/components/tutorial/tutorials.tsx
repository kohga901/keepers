/**
 * File: tutorials.tsx
 * Description: The step lists for each tutorial in the app. Add a new entry here to give another screen its own walkthrough.
 * Author: Kai Markley
 * Date: 2026-10-20
 */

import type { TutorialStep } from './Tutorial';
import {
  HistoryDetailDemo,
  HistoryListDemo,
  HistoryRemoveDemo,
  HistoryScrollDemo,
  HistoryToggleDemo,
} from './HistoryDemos';
import { FilterDemo, FindItDemo, SwipeDemo, TabsDemo, WelcomeDemo } from './TutorialDemos';

export type TutorialId = 'welcome' | 'history';

type TutorialConfig = {
  steps: readonly TutorialStep[];
  finishLabel: string;
};

export const TUTORIALS: Record<TutorialId, TutorialConfig> = {
  welcome: {
    finishLabel: 'Start swiping',
    steps: [
      {
        title: 'Welcome to Keepers',
        body: 'Swipe through clothes and Keepers learns your style. Here’s a quick look at how it works.',
        Demo: WelcomeDemo,
      },
      {
        title: 'Swipe right to keep',
        body: 'Like something? Swipe it right. Every like helps us find more pieces you’ll love.',
        Demo: () => <SwipeDemo direction="right" />,
      },
      {
        title: 'Swipe left to pass',
        body: 'Not your thing? Swipe left and we’ll show you less like it.',
        Demo: () => <SwipeDemo direction="left" />,
      },
      {
        title: 'Swipe up to shop',
        body: 'Swipe up to open the item’s listing. The card stays in your deck so you can still decide.',
        Demo: () => <SwipeDemo direction="up" />,
      },
      {
        title: 'Find it anywhere',
        body: 'Tap Find it and AI searches the web for places to buy the piece. Add your AI key in Settings first.',
        Demo: FindItDemo,
      },
      {
        title: 'Filter your feed',
        body: 'Use the filter button at the top of the swiper to only see the styles, colors, or categories you want.',
        Demo: FilterDemo,
      },
      {
        title: 'Explore the tabs',
        body: 'Look back at your likes, see your taste on a map, and get a recap of your style.',
        Demo: TabsDemo,
      },
    ],
  },
  history: {
    finishLabel: 'Got it',
    steps: [
      {
        title: 'Your history',
        body: 'Every item you swipe on is saved here, so you can come back to the pieces you loved.',
        Demo: HistoryListDemo,
      },
      {
        title: 'Liked and Disliked',
        body: 'Use the toggle at the top to switch between items you kept and items you passed on.',
        Demo: HistoryToggleDemo,
      },
      {
        title: 'Tap for details',
        body: 'Tap any item to see it up close, then tap Go to Store Page to shop it.',
        Demo: HistoryDetailDemo,
      },
      {
        title: 'Swipe left to remove',
        body: 'Changed your mind? Swipe an item all the way left to take it off your list.',
        Demo: HistoryRemoveDemo,
      },
      {
        title: 'More room to browse',
        body: 'The header tucks away as you scroll down and comes back when you scroll up.',
        Demo: HistoryScrollDemo,
      },
    ],
  },
};
