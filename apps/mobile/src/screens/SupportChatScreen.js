import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, Animated
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '../components/ScreenShell';
import { colors, spacing, radius } from '../theme';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

/** Membership roles (role.key) -> the 3-value enum POST /api/v1/chat/support expects. */
function toChatRole(membershipRole) {
  if (membershipRole === 'guard') return 'guard';
  if (membershipRole === 'resident') return 'resident';
  return 'admin'; // building_admin, committee_member, super_admin
}

const GREETING = {
  resident:
    "Hi! I'm the FLATBRIZ Support Assistant. Ask me anything about bills, visitors, facilities, complaints, and more.",
  guard:
    "Hi! I'm the FLATBRIZ Support Assistant. Ask me about visitor logging, Gate Passes, or emergency contacts.",
  admin:
    "Hi! I'm the FLATBRIZ Support Assistant. Ask me about memberships, maintenance configuration, complaints, and more."
};

const QUICK_PROMPTS = {
  resident: [
    { label: 'Pay a bill', query: 'How do I pay my maintenance bill?' },
    { label: 'Log a visitor', query: 'How do I pre-approve a visitor?' },
    { label: 'Building code', query: 'Where do I find my building code?' },
    { label: 'Book a facility', query: 'How do I book a facility?' },
    { label: 'Raise a complaint', query: 'How do I raise a complaint?' }
  ],
  guard: [
    { label: 'Log a visitor', query: 'How do I log a walk-in visitor at the gate?' },
    { label: 'Verify a Gate Pass', query: "How do I verify a resident's pre-approved Gate Pass?" },
    { label: 'Emergency contacts', query: 'Where do I find emergency contact numbers?' },
    { label: 'Report a bug', query: 'How do I report an app issue?' }
  ],
  admin: [
    { label: 'Approve memberships', query: 'How do I approve a pending resident membership?' },
    { label: 'Maintenance config', query: 'How do I configure the maintenance billing cycle?' },
    { label: 'Post an announcement', query: 'How do I post an announcement?' },
    { label: 'Manage complaints', query: 'How do I manage resident complaints?' }
  ]
};

const FALLBACK_ERROR =
  "Sorry, I couldn't reach FLATBRIZ right now. Please check your connection and try again.";

function TypingDots() {
  const anims = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;

  useEffect(() => {
    const loops = anims.map((val, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 150),
          Animated.timing(val, { toValue: 1, duration: 350, useNativeDriver: true }),
          Animated.timing(val, { toValue: 0, duration: 350, useNativeDriver: true }),
          Animated.delay((2 - i) * 150)
        ])
      )
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [anims]);

  return (
    <View style={styles.typingRow}>
      {anims.map((val, i) => (
        <Animated.View
          key={i}
          style={[
            styles.typingDot,
            {
              opacity: val.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
              transform: [{ translateY: val.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }]
            }
          ]}
        />
      ))}
    </View>
  );
}

export default function SupportChatScreen({ navigation }) {
  const { activeMembership, activeBuildingId } = useAuth();
  const chatRole = toChatRole(activeMembership?.role);
  const prompts = QUICK_PROMPTS[chatRole] || QUICK_PROMPTS.resident;

  const [messages, setMessages] = useState(() => [
    { id: 'greeting', sender: 'bot', text: GREETING[chatRole] || GREETING.resident }
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd?.({ animated: true }));
  }, [messages, sending]);

  const sendMessage = useCallback(
    async (rawText) => {
      const text = (rawText ?? input).trim();
      if (!text || sending) return;

      setMessages((prev) => [...prev, { id: `u-${Date.now()}`, sender: 'user', text }]);
      setInput('');
      setSending(true);

      try {
        const res = await api.chatSupport(text, chatRole, activeBuildingId);
        setMessages((prev) => [
          ...prev,
          { id: `b-${Date.now()}`, sender: 'bot', text: res.answer, sourceSection: res.sourceSection }
        ]);
      } catch (e) {
        const friendly = e.message && e.message !== 'Request failed' ? e.message : FALLBACK_ERROR;
        setMessages((prev) => [...prev, { id: `e-${Date.now()}`, sender: 'bot', text: friendly, isError: true }]);
      } finally {
        setSending(false);
      }
    },
    [input, sending, chatRole, activeBuildingId]
  );

  const renderItem = ({ item }) => {
    if (item.typing) {
      return (
        <View style={[styles.bubbleRow, styles.bubbleRowLeft]}>
          <View style={[styles.bubble, styles.botBubble]}>
            <TypingDots />
          </View>
        </View>
      );
    }

    const isUser = item.sender === 'user';
    return (
      <View style={[styles.bubbleRow, isUser ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
        <View
          style={[
            styles.bubble,
            isUser ? styles.userBubble : styles.botBubble,
            item.isError && styles.errorBubble
          ]}
        >
          <Text style={[styles.bubbleText, isUser && styles.userBubbleText]}>{item.text}</Text>
          {item.sourceSection ? (
            <View style={styles.sourceBadge}>
              <Ionicons name="book-outline" size={11} color={colors.accent} />
              <Text style={styles.sourceBadgeText}>Source: {item.sourceSection}</Text>
            </View>
          ) : null}
        </View>
      </View>
    );
  };

  const listData = sending ? [...messages, { id: 'typing', typing: true }] : messages;

  return (
    <View style={styles.container}>
      <View style={styles.pad}>
        <ScreenHeader
          title="Support Chat"
          subtitle="Answers are grounded in the FLATBRIZ manual"
          onBackPress={() => navigation.goBack()}
        />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
      >
        <FlatList
          ref={listRef}
          data={listData}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />

        <View style={styles.promptsWrap}>
          <FlatList
            data={prompts}
            keyExtractor={(item) => item.label}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.promptsRow}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.promptChip}
                onPress={() => sendMessage(item.query)}
                disabled={sending}
                activeOpacity={0.85}
              >
                <Text style={styles.promptChipText}>{item.label}</Text>
              </TouchableOpacity>
            )}
          />
        </View>

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Ask about FLATBRIZ..."
            placeholderTextColor={colors.textMuted}
            multiline
            editable={!sending}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (sending || !input.trim()) && styles.sendBtnDisabled]}
            onPress={() => sendMessage()}
            disabled={sending || !input.trim()}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Send message"
          >
            <Ionicons name="send" size={16} color="#fff" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  flex: { flex: 1 },
  pad: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  listContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },

  bubbleRow: { marginBottom: spacing.sm, flexDirection: 'row' },
  bubbleRowLeft: { justifyContent: 'flex-start' },
  bubbleRowRight: { justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '84%',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    shadowColor: '#063c28',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1
  },
  userBubble: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  botBubble: { backgroundColor: colors.card, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: colors.border },
  errorBubble: { borderColor: '#f0c4bd' },
  bubbleText: { fontSize: 14, lineHeight: 20, color: colors.text },
  userBubbleText: { color: '#fff' },

  sourceBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-start', marginTop: 8,
    backgroundColor: colors.accentSoft, borderRadius: radius.pill,
    paddingHorizontal: 8, paddingVertical: 3
  },
  sourceBadgeText: { fontSize: 10.5, fontWeight: '600', color: colors.accent },

  typingRow: { flexDirection: 'row', gap: 4, paddingVertical: 2, paddingHorizontal: 2 },
  typingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.textMuted },

  promptsWrap: { borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: spacing.sm },
  promptsRow: { paddingHorizontal: spacing.lg, gap: 8 },
  promptChip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border
  },
  promptChipText: { fontSize: 12.5, fontWeight: '600', color: colors.textBody },

  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm,
    paddingBottom: Platform.OS === 'ios' ? spacing.md : spacing.sm,
    backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border
  },
  input: {
    flex: 1, maxHeight: 100, minHeight: 40,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    backgroundColor: '#f2fbf6', paddingHorizontal: spacing.md, paddingVertical: 10,
    fontSize: 14, color: colors.text
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary
  },
  sendBtnDisabled: { opacity: 0.4 }
});
