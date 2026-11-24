import iphone15Img from '../assets/images/phone_iphone_15_1795507570498.jpg';
import iphone16ProImg from '../assets/images/phone_iphone_16_pro_1795507571797.jpg';
import galaxyS24Img from '../assets/images/phone_galaxy_s24_1795507571512.jpg';
import galaxyA55Img from '../assets/images/phone_galaxy_a55_1795507572672.jpg';
import pixel8aImg from '../assets/images/phone_pixel_8a_1795507573760.jpg';
import type { PhoneProductRecord } from '../types/domain';

const PHONE_IMAGE_MAP: Record<string, string> = {
  'iphone-15': iphone15Img,
  'iphone-16-pro': iphone16ProImg,
  'galaxy-s24': galaxyS24Img,
  'galaxy-a55': galaxyA55Img,
  'pixel-8a': pixel8aImg,
};

export function resolvePhoneImage(phone: Pick<PhoneProductRecord, 'imageKey' | 'imageUrl'>): string | null {
  if (phone.imageKey && PHONE_IMAGE_MAP[phone.imageKey]) {
    return PHONE_IMAGE_MAP[phone.imageKey];
  }
  if (phone.imageUrl && /^https?:\/\//i.test(phone.imageUrl)) {
    return phone.imageUrl;
  }
  return null;
}

export const AVAILABLE_PHONE_IMAGE_KEYS: Array<{ value: string; label: string }> = [
  { value: '', label: 'None (Minimal Device Placeholder)' },
  { value: 'iphone-15', label: 'iPhone 15 Studio' },
  { value: 'iphone-16-pro', label: 'iPhone 16 Pro Studio' },
  { value: 'galaxy-s24', label: 'Samsung Galaxy S24 Studio' },
  { value: 'galaxy-a55', label: 'Samsung Galaxy A55 Studio' },
  { value: 'pixel-8a', label: 'Google Pixel 8a Studio' },
];
