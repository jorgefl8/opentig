import { useEffect } from 'react';
import { isLowEndDevice, type DeviceHints } from '@/lib/low-end-device';

/** Marks a low-end phone on `<html data-low-end>`, so the phone styles leave out the bottom bar's glass blur. */
export function LowEndDevice() {
  useEffect(() => {
    if (isLowEndDevice(navigator as DeviceHints)) document.documentElement.dataset.lowEnd = '';
    return () => { delete document.documentElement.dataset.lowEnd; };
  }, []);
  return null;
}
