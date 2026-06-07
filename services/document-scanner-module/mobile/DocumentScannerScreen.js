import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import DocumentScanner from 'react-native-document-scanner-plugin';
import NetInfo from '@react-native-community/netinfo';
import {
  addToUploadQueue,
  getQueuedDocuments,
  removeQueuedDocument,
  updateQueuedDocument,
  uploadQueuedDocuments,
} from './offlineQueueManager';

const DOCUMENT_TYPES = [
  'BOL',
  'POD',
  'Delivery Receipt',
  'Lumper Receipt',
  'Rate Confirmation',
  'Other',
];

const API_BASE_URL = 'https://your-api.example.com';

export default function DocumentScannerScreen({
  loadNumber: initialLoadNumber = '',
  driverId,
  apiBaseUrl = API_BASE_URL,
  authToken,
}) {
  const [loadNumber, setLoadNumber] = useState(initialLoadNumber);
  const [documentType, setDocumentType] = useState('POD');
  const [scannedPages, setScannedPages] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [queue, setQueue] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const canUpload = useMemo(
    () => loadNumber.trim() && documentType && scannedPages.length > 0,
    [documentType, loadNumber, scannedPages]
  );

  const refreshQueue = useCallback(async () => {
    setQueue(await getQueuedDocuments());
  }, []);

  const refreshDocuments = useCallback(async () => {
    if (!loadNumber.trim() || !authToken) return;

    try {
      const res = await fetch(`${apiBaseUrl}/api/documents/${encodeURIComponent(loadNumber.trim())}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      if (!res.ok) throw new Error('Unable to load documents.');
      setDocuments(await res.json());
    } catch (error) {
      console.warn('Document list refresh failed:', error.message);
    }
  }, [apiBaseUrl, authToken, loadNumber]);

  useEffect(() => {
    refreshQueue();
    refreshDocuments();
  }, [refreshDocuments, refreshQueue]);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(async (state) => {
      if (state.isConnected && authToken) {
        await uploadQueuedDocuments({ apiBaseUrl, authToken });
        await refreshQueue();
        await refreshDocuments();
      }
    });

    return unsubscribe;
  }, [apiBaseUrl, authToken, refreshDocuments, refreshQueue]);

  const scanDocument = async () => {
    try {
      setIsScanning(true);

      const result = await DocumentScanner.scanDocument({
        croppedImageQuality: 95,
        letUserAdjustCrop: true,
        maxNumDocuments: 12,
        responseType: 'imageFilePath',
      });

      const pages = result?.scannedImages || [];
      if (!pages.length) return;

      setScannedPages(pages);
      setPreviewOpen(true);
    } catch (error) {
      Alert.alert('Scan failed', error.message || 'Unable to scan document.');
    } finally {
      setIsScanning(false);
    }
  };

  const uploadNowOrQueue = async () => {
    if (!canUpload) {
      Alert.alert('Missing details', 'Select a document type, load number, and scan at least one page.');
      return;
    }

    const queueItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      loadId: loadNumber.trim(),
      loadNumber: loadNumber.trim(),
      documentType,
      driverId,
      pageUris: scannedPages,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    const connection = await NetInfo.fetch();
    if (!connection.isConnected) {
      await addToUploadQueue(queueItem);
      await refreshQueue();
      setPreviewOpen(false);
      setScannedPages([]);
      Alert.alert('Saved offline', 'This document will upload when internet returns.');
      return;
    }

    try {
      setIsUploading(true);
      await addToUploadQueue(queueItem);
      await updateQueuedDocument(queueItem.id, { status: 'uploading' });
      await uploadQueuedDocuments({ apiBaseUrl, authToken });
      await removeQueuedDocument(queueItem.id);
      await refreshQueue();
      await refreshDocuments();
      setPreviewOpen(false);
      setScannedPages([]);
      Alert.alert('Uploaded', 'Document uploaded successfully.');
    } catch (error) {
      await updateQueuedDocument(queueItem.id, {
        status: 'failed',
        error: error.message,
      });
      await refreshQueue();
      Alert.alert('Upload failed', 'Saved to retry queue. It will retry when connection is available.');
    } finally {
      setIsUploading(false);
    }
  };

  const replaceDocument = async (doc) => {
    setDocumentType(doc.documentType || doc.category || 'POD');
    await scanDocument();
  };

  const deleteDocument = async (documentId) => {
    try {
      const res = await fetch(`${apiBaseUrl}/api/documents/${documentId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      });

      if (!res.ok) throw new Error('Delete failed.');
      await refreshDocuments();
      Alert.alert('Deleted', 'Document removed.');
    } catch (error) {
      Alert.alert('Delete failed', error.message);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Driver Paperwork</Text>
        <Text style={styles.subtitle}>Scan BOLs, PODs, receipts, and load documents.</Text>
      </View>

      <View style={styles.panel}>
        <Text style={styles.label}>Load Number</Text>
        <TextInput
          style={styles.input}
          value={loadNumber}
          onChangeText={setLoadNumber}
          placeholder="Enter load number"
          autoCapitalize="characters"
        />

        <Text style={styles.label}>Document Type</Text>
        <View style={styles.typeGrid}>
          {DOCUMENT_TYPES.map((type) => (
            <Pressable
              key={type}
              style={[styles.typeButton, documentType === type && styles.typeButtonActive]}
              onPress={() => setDocumentType(type)}
            >
              <Text style={[styles.typeButtonText, documentType === type && styles.typeButtonTextActive]}>
                {type}
              </Text>
            </Pressable>
          ))}
        </View>

        <Pressable style={styles.scanButton} onPress={scanDocument} disabled={isScanning}>
          {isScanning ? <ActivityIndicator color="#fff" /> : <Text style={styles.scanButtonText}>Scan Document</Text>}
        </Pressable>
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Documents for Load</Text>
        <FlatList
          data={documents}
          keyExtractor={(item) => String(item.id)}
          ListEmptyComponent={<Text style={styles.emptyText}>No uploaded documents yet.</Text>}
          renderItem={({ item }) => (
            <View style={styles.documentRow}>
              <View>
                <Text style={styles.documentTitle}>{item.documentType || item.category || 'Document'}</Text>
                <Text style={styles.documentMeta}>{item.fileName || item.name}</Text>
              </View>
              <View style={styles.rowActions}>
                <Pressable style={styles.smallButton} onPress={() => replaceDocument(item)}>
                  <Text style={styles.smallButtonText}>Re-scan</Text>
                </Pressable>
                <Pressable style={styles.smallDangerButton} onPress={() => deleteDocument(item.id)}>
                  <Text style={styles.smallDangerText}>Delete</Text>
                </Pressable>
              </View>
            </View>
          )}
        />
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Upload Queue</Text>
        {queue.length === 0 ? (
          <Text style={styles.emptyText}>No pending uploads.</Text>
        ) : (
          queue.map((item) => (
            <View key={item.id} style={styles.queueRow}>
              <Text style={styles.documentTitle}>{item.documentType} - Load {item.loadNumber}</Text>
              <Text style={styles.statusText}>{item.status}</Text>
            </View>
          ))
        )}
      </View>

      <Modal visible={previewOpen} animationType="slide">
        <SafeAreaView style={styles.previewScreen}>
          <Text style={styles.title}>Preview Scan</Text>
          <ScrollView horizontal pagingEnabled style={styles.previewScroller}>
            {scannedPages.map((uri) => (
              <Image key={uri} source={{ uri }} style={styles.previewImage} resizeMode="contain" />
            ))}
          </ScrollView>
          <View style={styles.previewActions}>
            <Pressable style={styles.secondaryButton} onPress={() => setPreviewOpen(false)}>
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={scanDocument}>
              <Text style={styles.secondaryButtonText}>Re-scan</Text>
            </Pressable>
            <Pressable style={styles.scanButton} onPress={uploadNowOrQueue} disabled={isUploading}>
              {isUploading ? <ActivityIndicator color="#fff" /> : <Text style={styles.scanButtonText}>Confirm Upload</Text>}
            </Pressable>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f7fb', padding: 16 },
  header: { marginBottom: 16 },
  title: { fontSize: 28, fontWeight: '800', color: '#0f172a' },
  subtitle: { fontSize: 15, color: '#64748b', marginTop: 4 },
  panel: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 14 },
  label: { fontSize: 14, fontWeight: '700', color: '#334155', marginBottom: 8 },
  input: { minHeight: 52, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, paddingHorizontal: 14, fontSize: 18 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  typeButton: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#e2e8f0' },
  typeButtonActive: { backgroundColor: '#0f766e' },
  typeButtonText: { fontWeight: '700', color: '#334155' },
  typeButtonTextActive: { color: '#fff' },
  scanButton: { minHeight: 56, borderRadius: 12, backgroundColor: '#0f766e', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  scanButtonText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: '#0f172a', marginBottom: 10 },
  emptyText: { color: '#64748b' },
  documentRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#e2e8f0' },
  documentTitle: { fontSize: 15, fontWeight: '800', color: '#0f172a' },
  documentMeta: { color: '#64748b', marginTop: 2 },
  rowActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  smallButton: { paddingVertical: 8, paddingHorizontal: 10, backgroundColor: '#e0f2fe', borderRadius: 8 },
  smallButtonText: { color: '#0369a1', fontWeight: '800' },
  smallDangerButton: { paddingVertical: 8, paddingHorizontal: 10, backgroundColor: '#fee2e2', borderRadius: 8 },
  smallDangerText: { color: '#b91c1c', fontWeight: '800' },
  queueRow: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#e2e8f0' },
  statusText: { color: '#475569', marginTop: 2 },
  previewScreen: { flex: 1, backgroundColor: '#0f172a', padding: 16 },
  previewScroller: { flex: 1, marginVertical: 16 },
  previewImage: { width: 360, height: 560, marginRight: 12, backgroundColor: '#111827' },
  previewActions: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  secondaryButton: { minHeight: 56, borderRadius: 12, backgroundColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  secondaryButtonText: { color: '#0f172a', fontWeight: '800' },
});

