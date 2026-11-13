import React from 'react';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';

export interface HistorySwipeableProps {
  children: React.ReactNode;
  renderRightActions: () => React.ReactNode;
  onSwipeableOpen: () => void;
}

export function HistorySwipeable(props: HistorySwipeableProps) {
  return <Swipeable {...props} />;
}
