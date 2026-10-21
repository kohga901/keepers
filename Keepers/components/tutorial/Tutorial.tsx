/**
 * File: Tutorial.tsx
 * Description: Full-screen walkthrough shown to new users. Steps slide in one at a time, each with
 *              a looping demo of the gesture or screen it explains.
 * Author: Kai Markley
 * Date: 2026-10-20
 */

import React, { useEffect, useState } from 'react';
import { Animated, Easing, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Fonts } from '../../constants/fonts';
import { useAppTheme } from '../../hooks/useAppTheme';
import { Text } from '../Text';
import { FilterDemo, FindItDemo, SwipeDemo, TabsDemo, WelcomeDemo } from './TutorialDemos';

const NATIVE = Platform.OS !== 'web';
const SLIDE_DISTANCE = 40;

type Step = {
  title: string;
  body: string;
  Demo: React.ComponentType;
};

const STEPS: Step[] = [
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
];

type Props = {
  visible: boolean;
  onFinish: () => void;
};

export function Tutorial({ visible, onFinish }: Props) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [stepIndex, setStepIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [enter] = useState(() => new Animated.Value(1));

  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;

  useEffect(() => {
    enter.setValue(0);
    Animated.timing(enter, {
      toValue: 1,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: NATIVE,
    }).start();
  }, [stepIndex, enter]);

  const goTo = (next: number) => {
    setDirection(next > stepIndex ? 1 : -1);
    setStepIndex(next);
  };

  // Rewind on close so a replay starts from the first step.
  const finish = () => {
    onFinish();
    setDirection(1);
    setStepIndex(0);
  };

  const handleNext = () => {
    if (isLast) {
      finish();
    } else {
      goTo(stepIndex + 1);
    }
  };

  const slide = enter.interpolate({
    inputRange: [0, 1],
    outputRange: [direction * SLIDE_DISTANCE, 0],
  });

  return (
    <Modal animationType="fade" visible={visible} onRequestClose={finish}>
      <View
        style={[
          styles.container,
          { backgroundColor: theme.background, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 20 },
        ]}
      >
        <View style={styles.topBar}>
          <Text style={[styles.counter, { color: theme.mutedText }]}>
            {stepIndex + 1} / {STEPS.length}
          </Text>
          {!isLast && (
            <Pressable accessibilityRole="button" accessibilityLabel="Skip tutorial" hitSlop={12} onPress={finish}>
              <Text style={[styles.skip, { color: theme.primary }]}>Skip</Text>
            </Pressable>
          )}
        </View>

        <Animated.View style={[styles.body, { opacity: enter, transform: [{ translateX: slide }] }]}>
          {/* Keyed so a demo's loop restarts from the beginning whenever its step is shown. */}
          <step.Demo key={stepIndex} />
          <Text style={[styles.title, { color: theme.text }]}>{step.title}</Text>
          <Text style={[styles.description, { color: theme.mutedText }]}>{step.body}</Text>
        </Animated.View>

        <View style={styles.dots}>
          {STEPS.map((item, index) => (
            <Pressable
              key={item.title}
              accessibilityLabel={`Go to step ${index + 1}`}
              accessibilityRole="button"
              hitSlop={6}
              onPress={() => goTo(index)}
              style={[
                styles.dot,
                { backgroundColor: index === stepIndex ? theme.primary : theme.border },
                index === stepIndex && styles.dotActive,
              ]}
            />
          ))}
        </View>

        <View style={styles.buttons}>
          {stepIndex > 0 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => goTo(stepIndex - 1)}
              style={({ pressed }) => [
                styles.button,
                styles.backButton,
                { borderColor: theme.primary, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Text style={[styles.buttonText, { color: theme.primary }]}>Back</Text>
            </Pressable>
          ) : (
            <View style={styles.button} />
          )}
          <Pressable
            accessibilityRole="button"
            onPress={handleNext}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: theme.primary, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={[styles.buttonText, { color: '#FFFFFF' }]}>{isLast ? 'Start swiping' : 'Next'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 28,
  },
  counter: {
    fontSize: 13,
    fontWeight: '600',
  },
  skip: {
    fontSize: 15,
    fontWeight: '700',
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  title: {
    fontFamily: Fonts.black,
    fontSize: 28,
    textAlign: 'center',
    marginTop: 16,
  },
  description: {
    fontSize: 16,
    fontWeight: '500',
    lineHeight: 23,
    textAlign: 'center',
    maxWidth: 340,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 20,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotActive: {
    width: 22,
  },
  buttons: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  backButton: {
    borderWidth: 1.5,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
  },
});
