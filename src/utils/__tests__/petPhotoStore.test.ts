import AsyncStorage from '@react-native-async-storage/async-storage';

import { getPhoto, savePhoto, removePhoto } from '../petPhotoStore';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

describe('petPhotoStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return null if photo not found', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    const photo = await getPhoto('pet-1');
    expect(photo).toBeNull();
  });

  it('should save and retrieve photo', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify({ 'pet-1': 'uri-1' }));

    const photo = await getPhoto('pet-1');
    expect(photo).toBe('uri-1');

    await savePhoto('pet-2', 'uri-2');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      '@pet_photos',
      expect.stringContaining('"pet-2":"uri-2"'),
    );
  });

  it('should remove photo', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify({ 'pet-1': 'uri-1' }));

    await removePhoto('pet-1');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('@pet_photos', '{}');
  });
});
