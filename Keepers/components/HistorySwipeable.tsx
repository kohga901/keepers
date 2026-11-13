import React from 'react';
import { Platform, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Swipeable, { type SwipeableProps } from 'react-native-gesture-handler/ReanimatedSwipeable';

export function HistorySwipeable(props: SwipeableProps) {
  // Reject deletion once a web drag becomes vertical, before sideways drift can capture it.
  const verticalDrag = usePanGesture({
    activeOffsetY: [-10, 10],
    failOffsetX: [-24, 24],
  });

  if (Platform.OS !== 'web') return <Swipeable {...props} />;

  return (
    <GestureDetector gesture={verticalDrag} touchAction="pan-y">
      <View>
        <Swipeable {...props} requireToFail={verticalDrag}
          dragOffsetFromLeft={24} dragOffsetFromRight={-24} />
      </View>
    </GestureDetector>
  );
}
