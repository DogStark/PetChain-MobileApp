import { launchImageLibrary } from 'react-native-image-picker';
import ImageResizer from 'react-native-image-resizer';

import { pickImage, compressImage } from '../imageUtils';

jest.mock('react-native-image-picker', () => ({
  launchImageLibrary: jest.fn(),
}));

jest.mock('react-native-image-resizer', () => ({
  __esModule: true,
  default: { createResizedImage: jest.fn() },
}));

const mockLaunchImageLibrary = launchImageLibrary as jest.Mock;
const mockCreateResizedImage = ImageResizer.createResizedImage as jest.Mock;

describe('imageUtils', () => {
  describe('pickImage', () => {
    it('should return null when user cancels', async () => {
      mockLaunchImageLibrary.mockImplementation((_options, callback) => {
        callback({ didCancel: true });
      });
      const result = await pickImage();
      expect(result).toBeNull();
    });

    it('should return image data when successful', async () => {
      mockLaunchImageLibrary.mockImplementation((_options, callback) => {
        callback({
          assets: [
            { uri: 'file://test.jpg', type: 'image/jpeg', fileName: 'test.jpg', fileSize: 1024 },
          ],
        });
      });
      const result = await pickImage();
      expect(result).toEqual({
        uri: 'file://test.jpg',
        type: 'image/jpeg',
        name: 'test.jpg',
        size: 1024,
      });
    });
  });

  describe('compressImage', () => {
    it('should compress image successfully', async () => {
      mockCreateResizedImage.mockResolvedValue({
        uri: 'file://compressed.jpg',
        size: 512,
        width: 800,
        height: 600,
      });
      const result = await compressImage('file://test.jpg');
      expect(result).toEqual({ uri: 'file://compressed.jpg', size: 512, width: 800, height: 600 });
    });
  });
});
