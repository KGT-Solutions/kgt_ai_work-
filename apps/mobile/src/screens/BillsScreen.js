import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, StatusBar, Image, Modal, Pressable, ActivityIndicator
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import BrandLogo from '../components/BrandLogo';
import { api, mediaUrl } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { showAlert } from '../utils/alert';

/** Tokens from design-system.md (Emerald Fresh) */
const ds = {
  surface: '#ffffff',
  primary: '#059669',
  primaryLight: '#34d39a',
  heading: '#06231a',
  secondary: '#2f5c4a',
  muted: '#7ba392',
  onPrimary: '#ffffff',
  paidFg: '#0a7a55',
  paidBg: '#cdf3e2',
  dueFg: '#8a6a2f',
  dueBg: '#f4ead1',
  neutralFg: '#4f7a67',
  neutralBg: '#dbeee5'
};

function statusStyle(status, pendingPayment) {
  if (pendingPayment) return { bg: '#e8f0fe', fg: '#3D6B8C', label: 'Pending review' };
  if (status === 'paid') return { bg: ds.paidBg, fg: ds.paidFg, label: 'Paid' };
  if (status === 'due') return { bg: ds.dueBg, fg: ds.dueFg, label: 'Due' };
  if (status === 'partial') return { bg: ds.dueBg, fg: ds.dueFg, label: 'Partial' };
  return { bg: ds.neutralBg, fg: ds.neutralFg, label: status || 'Upcoming' };
}

function formatStatusLabel(status, pendingPayment) {
  if (pendingPayment) return 'Pending review';
  if (!status) return 'Upcoming';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export default function BillsScreen({ navigation }) {
  const { activeBuildingId, activeMembership, activeMembershipId } = useAuth();
  const [bills, setBills] = useState([]);
  const [account, setAccount] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [qrImageUrl, setQrImageUrl] = useState(null);
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [selectedBill, setSelectedBill] = useState(null);
  const [receiptImage, setReceiptImage] = useState(null);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState('');

  const load = useCallback(async () => {
    const [data, unread] = await Promise.all([
      api.getBills(activeBuildingId),
      api.getUnreadNotificationCount(activeBuildingId).catch(() => ({ count: 0 }))
    ]);
    setBills(data.bills || []);
    setAccount(data.account || null);
    setUnreadCount(unread.count || 0);
    let qr = data.qrImageUrl || null;
    if (!qr) {
      try {
        const qrRes = await api.getPaymentQr(activeBuildingId);
        qr = qrRes.qrImageUrl || null;
      } catch {
        qr = null;
      }
    }
    setQrImageUrl(qr);
  }, [activeBuildingId, activeMembershipId]);

  useEffect(() => { load().catch(() => {}); }, [load]);
  useFocusEffect(useCallback(() => { load().catch(() => {}); }, [load]));

  const dueBalance = account?.dueBalance != null
    ? account.dueBalance
    : bills
      .filter((b) => b.status === 'due' || b.status === 'partial')
      .reduce((sum, b) => sum + (b.remaining != null ? b.remaining : b.amount), 0);
  const advanceBalance = account?.advanceBalance || 0;

  const openPayModal = async (bill) => {
    setSelectedBill(bill);
    setReceiptImage(null);
    setPayError('');
    setPayModalOpen(true);
    // Always refresh society QR when opening Pay (avoids stale "not available")
    if (activeBuildingId) {
      try {
        const [billsData, qrRes] = await Promise.all([
          api.getBills(activeBuildingId).catch(() => null),
          api.getPaymentQr(activeBuildingId).catch(() => null)
        ]);
        const next =
          (billsData && billsData.qrImageUrl) ||
          (qrRes && qrRes.qrImageUrl) ||
          null;
        if (next) setQrImageUrl(next);
      } catch {
        /* keep existing qrImageUrl */
      }
    }
  };

  const closePayModal = () => {
    setPayModalOpen(false);
    setSelectedBill(null);
    setReceiptImage(null);
    setPayError('');
    setPaying(false);
  };

  const pickReceipt = async () => {
    if (paying) return;
    setPayError('');
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showAlert('Permission needed', 'Allow photo access to upload your payment screenshot.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8
    });
    if (!result.canceled && result.assets[0]) {
      setReceiptImage(result.assets[0]);
    }
  };

  const confirmPaid = async () => {
    if (!selectedBill || !receiptImage) {
      setPayError('Upload your payment screenshot to confirm.');
      return;
    }
    setPaying(true);
    setPayError('');
    try {
      await api.payBill(selectedBill.id, activeBuildingId, receiptImage);
      setPayModalOpen(false);
      setSelectedBill(null);
      setReceiptImage(null);
      await load();
      showAlert(
        'Submitted for review',
        'Your payment screenshot was sent to the building admin. The bill will update after they approve it.'
      );
    } catch (e) {
      setPayError(e.message || 'Could not confirm payment.');
    } finally {
      setPaying(false);
    }
  };

  const selectedRemaining = selectedBill
    ? (selectedBill.remaining != null
      ? selectedBill.remaining
      : Math.max(0, Number(selectedBill.amount) - Number(selectedBill.amountPaid || 0)))
    : 0;

  const locationLabel = [
    activeMembership?.buildingName,
    activeMembership?.flat
  ].filter(Boolean).join(' · ') || 'Your society';

  const topPad = Platform.OS === 'android'
    ? (StatusBar.currentHeight || 12)
    : Platform.OS === 'web'
      ? 16
      : 8;

  const headerLabel = advanceBalance > 0 && dueBalance <= 0 ? 'Advance balance' : 'Total due';
  const headerAmount = advanceBalance > 0 && dueBalance <= 0 ? advanceBalance : dueBalance;

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingTop: topPad + 8 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.shell}>
          <View style={styles.topBar}>
            <View style={styles.topBarLeft}>
              <BrandLogo variant="icon-color" height={28} />
              <View style={styles.chip}>
                <Ionicons name="business-outline" size={14} color={ds.primary} />
                <Text style={styles.chipText} numberOfLines={1}>{locationLabel}</Text>
                <Ionicons name="chevron-down" size={14} color={ds.primary} />
              </View>
            </View>
            {navigation ? (
              <TouchableOpacity
                onPress={() => navigation.navigate('Notifications')}
                style={styles.bellBtn}
                accessibilityRole="button"
                accessibilityLabel="Notifications"
              >
                <Ionicons name="notifications-outline" size={20} color={ds.heading} />
                {unreadCount > 0 && (
                  <View style={styles.bellBadge}>
                    <Text style={styles.bellBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
                  </View>
                )}
              </TouchableOpacity>
            ) : null}
          </View>

          <View style={styles.titleRow}>
            <View style={styles.titleIcon}>
              <Ionicons name="receipt" size={18} color={ds.onPrimary} />
            </View>
            <Text style={styles.title}>My bills</Text>
          </View>

          <LinearGradient
            colors={['#047857', ds.primary, ds.primaryLight]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.dueCard}
          >
            <View style={styles.dueLeft}>
              <Text style={styles.dueLabel}>{headerLabel}</Text>
              <Text style={styles.dueAmount}>₹{headerAmount.toLocaleString('en-IN')}</Text>
              {advanceBalance > 0 && dueBalance > 0 ? (
                <Text style={styles.dueSub}>Advance ₹{advanceBalance.toLocaleString('en-IN')} on file</Text>
              ) : null}
            </View>
            <View style={styles.dueWatermark} pointerEvents="none">
              <Ionicons name="receipt-outline" size={72} color="rgba(255,255,255,0.18)" />
            </View>
          </LinearGradient>

          <Text style={styles.sectionLabel}>Charges</Text>

          {bills.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="receipt-outline" size={44} color="#9dc4b3" />
              <Text style={styles.emptyTitle}>No bills yet</Text>
              <Text style={styles.emptyHint}>Paid and due bills will show up here.</Text>
            </View>
          ) : (
            bills.map((item) => {
              const st = statusStyle(item.status, item.pendingPayment);
              const remaining = item.remaining != null
                ? item.remaining
                : Math.max(0, Number(item.amount) - Number(item.amountPaid || 0));
              const canPay = remaining > 0 && !item.pendingPayment;
              return (
                <View key={item.id} style={styles.billCard}>
                  <View style={styles.billLeft}>
                    <Text style={styles.month}>
                      {item.title || item.month}
                      {item.type === 'misc_split' ? ' · Misc' : ''}
                    </Text>
                    <Text style={styles.amount}>
                      {item.pendingPayment
                        ? `₹${Number(item.pendingPayment.amount).toLocaleString('en-IN')} awaiting admin review`
                        : canPay
                        ? `₹${remaining.toLocaleString('en-IN')} remaining`
                        : `₹${Number(item.amount).toLocaleString('en-IN')}`}
                      {!item.pendingPayment && item.dueDate
                        ? ` · Due ${new Date(item.dueDate).toLocaleDateString('en-IN')}`
                        : ''}
                    </Text>
                  </View>
                  <View style={styles.billRight}>
                    <View style={[styles.badge, { backgroundColor: st.bg }]}>
                      <Text style={[styles.badgeText, { color: st.fg }]}>
                        {formatStatusLabel(item.status, item.pendingPayment)}
                      </Text>
                    </View>
                    {canPay && (
                      <TouchableOpacity
                        style={styles.payBtn}
                        onPress={() => openPayModal(item)}
                        activeOpacity={0.88}
                      >
                        <Text style={styles.payText}>Pay</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>

      <Modal visible={payModalOpen} transparent animationType="fade" onRequestClose={closePayModal}>
        <Pressable style={styles.qrModalBackdrop} onPress={closePayModal}>
          <ScrollView
            contentContainerStyle={styles.qrModalScroll}
            keyboardShouldPersistTaps="handled"
            bounces={false}
          >
            <Pressable onPress={(e) => e.stopPropagation?.()}>
              <View style={styles.qrModalCard}>
                <View style={styles.payModalHeader}>
                  <View style={styles.qrIcon}>
                    <Ionicons name="qr-code-outline" size={18} color={ds.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.qrTitle}>Pay via UPI / QR</Text>
                    <Text style={styles.qrHint}>
                      {selectedBill
                        ? `Scan to pay ₹${selectedRemaining.toLocaleString('en-IN')} for ${selectedBill.title || selectedBill.month}`
                        : 'Scan the society QR to pay'}
                    </Text>
                  </View>
                </View>

                {qrImageUrl ? (
                  <Image
                    source={{ uri: mediaUrl(qrImageUrl) }}
                    style={styles.qrModalImage}
                    resizeMode="contain"
                  />
                ) : (
                  <View style={styles.qrMissing}>
                    <Ionicons name="qr-code-outline" size={40} color="#9dc4b3" />
                    <Text style={styles.qrMissingTitle}>QR not available yet</Text>
                    <Text style={styles.qrMissingHint}>
                      Ask your building admin to upload the society UPI / QR image in Finance.
                    </Text>
                  </View>
                )}

                <Text style={styles.receiptLabel}>Upload payment screenshot *</Text>
                <TouchableOpacity
                  style={styles.receiptUpload}
                  onPress={pickReceipt}
                  activeOpacity={0.85}
                  disabled={paying}
                >
                  {receiptImage ? (
                    <Image
                      source={{ uri: receiptImage.uri }}
                      style={styles.receiptPreview}
                      resizeMode="cover"
                    />
                  ) : (
                    <>
                      <Ionicons name="cloud-upload-outline" size={22} color={ds.primary} />
                      <Text style={styles.receiptUploadText}>Browse payment screenshot</Text>
                      <Text style={styles.receiptFormats}>jpg, jpeg, png</Text>
                    </>
                  )}
                </TouchableOpacity>
                {receiptImage ? (
                  <TouchableOpacity onPress={() => setReceiptImage(null)} disabled={paying}>
                    <Text style={styles.receiptChange}>Remove / choose another</Text>
                  </TouchableOpacity>
                ) : null}

                <Text style={styles.payModalNote}>
                  Pay using the QR above, then upload your UPI success screenshot. Confirm paid sends it for admin review — it enters the ledger only after approval.
                </Text>

                {payError ? <Text style={styles.payError}>{payError}</Text> : null}

                <View style={styles.payActions}>
                  <TouchableOpacity
                    style={styles.payCancelBtn}
                    onPress={closePayModal}
                    disabled={paying}
                  >
                    <Text style={styles.payCancelText}>Close</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.payConfirmBtn,
                      (!receiptImage || paying) && styles.payConfirmBtnDisabled
                    ]}
                    onPress={confirmPaid}
                    disabled={!receiptImage || paying}
                    activeOpacity={0.88}
                  >
                    {paying ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.payConfirmText}>Confirm paid</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </Pressable>
          </ScrollView>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  scroll: { flex: 1, backgroundColor: 'transparent' },
  content: {
    flexGrow: 1,
    paddingBottom: 110
  },
  shell: {
    width: '100%',
    paddingHorizontal: 20
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20
  },
  topBarLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginRight: 12
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
    backgroundColor: ds.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    shadowColor: '#063c28',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2
  },
  chipText: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '600',
    color: ds.secondary
  },
  bellBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: ds.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#063c28',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2
  },
  bellBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: ds.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3
  },
  bellBadgeText: {
    color: ds.onPrimary,
    fontSize: 9,
    fontWeight: '700'
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 18
  },
  titleIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: ds.primary,
    alignItems: 'center',
    justifyContent: 'center'
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: ds.heading,
    letterSpacing: -0.5
  },
  dueCard: {
    borderRadius: 18,
    paddingHorizontal: 20,
    paddingVertical: 22,
    marginBottom: 24,
    minHeight: 110,
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#059669',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4
  },
  dueLeft: { zIndex: 1 },
  dueLabel: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8
  },
  dueAmount: {
    color: ds.onPrimary,
    fontSize: 36,
    fontWeight: '800',
    marginTop: 6,
    letterSpacing: -1
  },
  dueSub: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6
  },
  dueWatermark: {
    position: 'absolute',
    right: 16,
    bottom: 8
  },
  qrIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#cdf3e2',
    alignItems: 'center',
    justifyContent: 'center'
  },
  qrTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: ds.heading
  },
  qrHint: {
    fontSize: 12,
    color: ds.muted,
    marginTop: 2
  },
  payModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
    width: '100%'
  },
  qrModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(6, 35, 26, 0.72)',
    justifyContent: 'center',
    padding: 24
  },
  qrModalScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 24
  },
  qrModalCard: {
    backgroundColor: ds.surface,
    borderRadius: 18,
    padding: 18,
    alignItems: 'center',
    alignSelf: 'center',
    width: '100%',
    maxWidth: 380
  },
  qrModalImage: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    backgroundColor: '#f3faf6'
  },
  qrMissing: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 12,
    gap: 8
  },
  qrMissingTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: ds.heading
  },
  qrMissingHint: {
    fontSize: 12,
    color: ds.muted,
    textAlign: 'center',
    lineHeight: 18
  },
  receiptLabel: {
    alignSelf: 'flex-start',
    marginTop: 16,
    marginBottom: 8,
    fontSize: 12,
    fontWeight: '700',
    color: ds.heading
  },
  receiptUpload: {
    width: '100%',
    minHeight: 96,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#d5e5dc',
    borderRadius: 12,
    backgroundColor: '#f3faf6',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    padding: 12,
    overflow: 'hidden'
  },
  receiptUploadText: {
    fontSize: 13,
    fontWeight: '700',
    color: ds.secondary
  },
  receiptFormats: {
    fontSize: 11,
    color: ds.muted
  },
  receiptPreview: {
    width: '100%',
    height: 120,
    borderRadius: 8
  },
  receiptChange: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '700',
    color: ds.primary
  },
  payModalNote: {
    marginTop: 12,
    fontSize: 12,
    color: ds.muted,
    textAlign: 'center',
    lineHeight: 18
  },
  payError: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '600',
    color: '#B4483A',
    textAlign: 'center'
  },
  payActions: {
    marginTop: 16,
    flexDirection: 'row',
    gap: 10,
    width: '100%'
  },
  payCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d5e5dc',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff'
  },
  payCancelText: {
    color: ds.heading,
    fontWeight: '700',
    fontSize: 13
  },
  payConfirmBtn: {
    flex: 1.2,
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ds.primary,
    minHeight: 44
  },
  payConfirmBtnDisabled: {
    opacity: 0.45
  },
  payConfirmText: {
    color: ds.onPrimary,
    fontWeight: '700',
    fontSize: 13
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: ds.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 12
  },
  billCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: ds.surface,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 12,
    shadowColor: '#063c28',
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2
  },
  billLeft: { flex: 1, paddingRight: 12 },
  month: {
    fontSize: 15,
    fontWeight: '700',
    color: ds.heading
  },
  amount: {
    fontSize: 13,
    fontWeight: '500',
    color: ds.muted,
    marginTop: 4
  },
  billRight: {
    alignItems: 'flex-end',
    gap: 8
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700'
  },
  payBtn: {
    backgroundColor: ds.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999
  },
  payText: {
    color: ds.onPrimary,
    fontSize: 13,
    fontWeight: '700'
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 8
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: ds.heading
  },
  emptyHint: {
    fontSize: 12,
    color: ds.muted
  }
});
