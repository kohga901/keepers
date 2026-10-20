/**
 * File: TagFilter.tsx
 * Description: Filter button and tag picker for the swiper. The sheet edits a draft selection and
 *              reports it through `onChange` once, when it closes, so choosing several tags
 *              costs one reload of the feed instead of one per tag.
 * Author: Derek Tinoco
 * Date: 2026-10-19
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { useAppTheme } from '../hooks/useAppTheme';
import { groupByCategory, toggleTag, type Tag } from '../utils/tagFilter';
import { Text } from './Text';

type Props = {
  tags: readonly Tag[];
  selected: readonly string[];
  onChange: (selected: readonly string[]) => void;
};

export const TagFilter: React.FC<Props> = ({ tags, selected, onChange }) => {
  const { theme } = useAppTheme();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<readonly string[]>(selected);

  const openSheet = () => {
    setDraft(selected);
    setOpen(true);
  };
  const commit = () => {
    setOpen(false);
    onChange(draft);
  };

  return (
    <>
      <Pressable
        accessibilityLabel="Filter items"
        accessibilityRole="button"
        onPress={openSheet}
        style={[styles.button, { backgroundColor: theme.tabBg, borderColor: theme.border }]}
      >
        <Ionicons name="filter" size={20} color={theme.tabActive} />
        {selected.length > 0 && (
          <View style={[styles.badge, { backgroundColor: theme.primary }]}>
            <Text style={styles.badgeText}>{selected.length}</Text>
          </View>
        )}
      </Pressable>

      <Modal animationType="slide" transparent visible={open} onRequestClose={commit}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { backgroundColor: theme.tabBg }]}>
            <View style={styles.header}>
              <Text style={styles.title}>Filter items</Text>
              <Pressable accessibilityRole="button" onPress={() => setDraft([])} disabled={draft.length === 0}>
                <Text style={[styles.clear, { color: theme.primary }, draft.length === 0 && styles.disabled]}>
                  Clear
                </Text>
              </Pressable>
            </View>

            <ScrollView>
              {tags.length === 0 && <Text style={{ color: theme.mutedText }}>No filters available.</Text>}
              {groupByCategory(tags).map(({ category, tags: members }) => (
                <View key={category} style={styles.group}>
                  <Text style={[styles.groupTitle, { color: theme.mutedText }]}>{category}</Text>
                  <View style={styles.chips}>
                    {members.map(({ Tag: tag }) => {
                      const isOn = draft.includes(tag);
                      return (
                        <Pressable
                          key={tag}
                          accessibilityRole="button"
                          accessibilityState={{ selected: isOn }}
                          onPress={() => setDraft(toggleTag(draft, tag))}
                          style={[
                            styles.chip,
                            { borderColor: theme.primary },
                            isOn && { backgroundColor: theme.primary },
                          ]}
                        >
                          <Text style={[styles.chipText, { color: isOn ? '#FFFFFF' : theme.primary }]}>{tag}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))}
            </ScrollView>

            <Pressable
              accessibilityRole="button"
              onPress={commit}
              style={[styles.done, { backgroundColor: theme.primary }]}
            >
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    top: 8,
    right: 16,
    zIndex: 20,
    elevation: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { maxHeight: '75%', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, gap: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 20, fontWeight: '700' },
  clear: { fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.4 },
  group: { marginBottom: 16, gap: 8 },
  groupTitle: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { fontSize: 14, fontWeight: '600' },
  done: { borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  doneText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
