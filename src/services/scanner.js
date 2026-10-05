/**
 * QR & Barcode Camera and Image Scanner Service using Html5Qrcode
 */
import { Html5Qrcode } from 'html5-qrcode';

let html5QrcodeScanner = null;
let lastScannedText = null;
let lastScanTimestamp = 0;
const SCAN_COOLDOWN_MS = 2500; // 2.5s cooldown for continuous scanning of same item

/**
 * Play a pleasant futuristic scan success beep using Web Audio API
 */
export function playScanSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 note
    osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.12); // E6 note

    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch (e) {
    // Audio context may be restricted before user gesture
  }
}

/**
 * Initialize camera scan on element ID
 */
export async function startCameraScanner(elementId, onScanSuccess, onError) {
  if (html5QrcodeScanner) {
    try {
      await stopCameraScanner();
    } catch (e) {
      console.warn('Scanner cleanup warning:', e);
    }
  }

  html5QrcodeScanner = new Html5Qrcode(elementId);

  const config = {
    fps: 15,
    qrbox: { width: 260, height: 260 },
    aspectRatio: 1.0,
    experimentalFeatures: {
      useBarCodeDetectorIfSupported: true
    }
  };

  const handleDecoded = (decodedText, decodedResult) => {
    const now = Date.now();
    // Cooldown check for identical continuous scan
    if (decodedText === lastScannedText && (now - lastScanTimestamp) < SCAN_COOLDOWN_MS) {
      return;
    }

    lastScannedText = decodedText;
    lastScanTimestamp = now;

    playScanSound();
    if (onScanSuccess) {
      onScanSuccess(decodedText, decodedResult);
    }
  };

  try {
    const cameras = await Html5Qrcode.getCameras();
    if (!cameras || cameras.length === 0) {
      throw new Error('No camera found on this device.');
    }

    // Prefer environment/back camera if available
    const backCam = cameras.find(c => c.label.toLowerCase().includes('back') || c.label.toLowerCase().includes('rear')) || cameras[0];

    await html5QrcodeScanner.start(
      backCam.id,
      config,
      handleDecoded,
      (errorMessage) => {
        // Ignore noise errors during camera scanning
      }
    );
    return true;
  } catch (err) {
    console.error('Camera Scanner start failed:', err);
    if (onError) onError(err);
    return false;
  }
}

/**
 * Stop camera scanner instance
 */
export async function stopCameraScanner() {
  if (html5QrcodeScanner) {
    try {
      if (html5QrcodeScanner.isScanning) {
        await html5QrcodeScanner.stop();
      }
      html5QrcodeScanner.clear();
    } catch (e) {
      console.warn('Error stopping scanner:', e);
    } finally {
      html5QrcodeScanner = null;
    }
  }
}

/**
 * Scan an uploaded image file for QR code or Barcode
 */
export async function scanImageFile(file) {
  const scanner = new Html5Qrcode('temp-image-scanner');
  try {
    const result = await scanner.scanFile(file, true);
    playScanSound();
    scanner.clear();
    return result;
  } catch (err) {
    scanner.clear();
    throw new Error('Could not detect a clear QR code or Barcode in this image. Please try another image or manual entry.');
  }
}
